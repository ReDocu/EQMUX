// 메시지 버스 (PRD F) — 워크스페이스 DB의 message 테이블이 원장이다 (M5 평면 스트림).
// 여기는 검증(M2 강제 5종)·상한(M6)·저장만 맡는다. 전달(M3 인박스 + 상태 기반)은
// 세션 상태를 아는 프런트가 PTY 주입으로 수행한다 — 버스는 원장이고 배달은 관제의 일.

use std::path::Path;

use rusqlite::params;
use serde::Serialize;

pub const TYPES: [&str; 5] = ["ask", "handoff", "report", "review", "escalate"];
pub const MAX_BODY_CHARS: usize = 2000; // M6 길이 상한
pub const RATE_PER_MIN: usize = 10; // M6 세션(발신자)당 분당 상한

#[derive(Serialize, Clone)]
pub struct MsgRow {
    pub id: i64,
    pub ts: i64,
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub body: String,
    pub read: bool,
}

/// M2 — 자유 텍스트 금지. 타입은 5종뿐이고 본문은 비어 있을 수 없다.
pub fn validate(kind: &str, body: &str) -> Result<(), String> {
    if !TYPES.contains(&kind) {
        return Err("BAD_TYPE".into());
    }
    let b = body.trim();
    if b.is_empty() {
        return Err("EMPTY".into());
    }
    if b.chars().count() > MAX_BODY_CHARS {
        return Err("TOO_LONG".into());
    }
    Ok(())
}

/// M6 분당 상한 — times는 이 발신자의 최근 전송 시각(ms). 허용되면 기록하고 true.
pub fn allow_rate(times: &mut Vec<i64>, now: i64) -> bool {
    times.retain(|t| now - *t < 60_000);
    if times.len() >= RATE_PER_MIN {
        return false;
    }
    times.push(now);
    true
}

/// 원장에 적재하고 저장된 행을 돌려준다. 사람("나")이 보낸 것은 읽음으로 태어난다 —
/// unread는 사람의 미확인 표시이지 에이전트 전달 상태가 아니다.
pub fn send(
    root: &Path,
    ws: &str,
    from: &str,
    to: &str,
    kind: &str,
    body: &str,
) -> Result<MsgRow, String> {
    validate(kind, body)?;
    let conn = crate::store::open_db(root, ws).map_err(|e| e.to_string())?;
    let now = crate::workspace::now_ms() as i64;
    let body = body.trim();
    let read = from == "나";
    conn.execute(
        "INSERT INTO message (ts, sender, recipient, kind, body, read) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![now, from, to, kind, body, read as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(MsgRow {
        id: conn.last_insert_rowid(),
        ts: now,
        from: from.into(),
        to: to.into(),
        kind: kind.into(),
        body: body.into(),
        read,
    })
}

/// before_id 커서로 최신 limit건을 골라 시간 오름차순으로 돌려준다 (대화는 위→아래로 흐른다).
pub fn list(
    root: &Path,
    ws: &str,
    before_id: Option<i64>,
    limit: u32,
) -> Result<Vec<MsgRow>, String> {
    if !crate::store::db_path(root, ws).exists() {
        return Ok(Vec::new());
    }
    let conn = crate::store::open_db(root, ws).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, ts, sender, recipient, kind, body, read FROM
               (SELECT * FROM message WHERE id < ?1 ORDER BY id DESC LIMIT ?2)
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![before_id.unwrap_or(i64::MAX), limit.min(500) as i64], |r| {
            Ok(MsgRow {
                id: r.get(0)?,
                ts: r.get(1)?,
                from: r.get(2)?,
                to: r.get(3)?,
                kind: r.get(4)?,
                body: r.get(5)?,
                read: r.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 모두 읽음 (FR-G-44 계열) — 사람의 미확인 표시만 내린다.
pub fn mark_read(root: &Path, ws: &str) -> Result<(), String> {
    let conn = crate::store::open_db(root, ws).map_err(|e| e.to_string())?;
    conn.execute("UPDATE message SET read = 1 WHERE read = 0", [])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_type_and_length() {
        assert!(validate("ask", "질문").is_ok());
        assert_eq!(validate("chat", "x"), Err("BAD_TYPE".into()));
        assert_eq!(validate("ask", "  "), Err("EMPTY".into()));
        let long = "a".repeat(MAX_BODY_CHARS + 1);
        assert_eq!(validate("ask", &long), Err("TOO_LONG".into()));
    }

    #[test]
    fn rate_limit_window_slides() {
        let mut times = Vec::new();
        for _ in 0..RATE_PER_MIN {
            assert!(allow_rate(&mut times, 1_000));
        }
        assert!(!allow_rate(&mut times, 30_000)); // 같은 분 안에서는 상한
        assert!(allow_rate(&mut times, 62_000)); // 60초 창이 지나면 다시 허용
    }

    #[test]
    fn send_list_roundtrip() {
        let dir = std::env::temp_dir().join(format!("eqmux-msg-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = send(&dir, "ws1", "나", "@all", "ask", "  범위 알려줘  ").unwrap();
        let b = send(&dir, "ws1", "카이", "나", "report", "완료").unwrap();
        assert!(a.read); // 사람 발신은 읽음으로 태어난다
        assert!(!b.read);
        let rows = list(&dir, "ws1", None, 50).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].body, "범위 알려줘"); // trim + 오름차순
        assert_eq!(rows[1].from, "카이");
        mark_read(&dir, "ws1").unwrap();
        assert!(list(&dir, "ws1", None, 50).unwrap().iter().all(|m| m.read));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
