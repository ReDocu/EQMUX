// 메시지 버스 (PRD F) — 워크스페이스 DB의 message 테이블이 원장이다 (M5 평면 스트림).
// 여기는 검증(M2 강제 5종)·상한(M6)·저장만 맡는다. 전달(M3 인박스 + 상태 기반)은
// 세션 상태를 아는 프런트가 PTY 주입으로 수행한다 — 버스는 원장이고 배달은 관제의 일.

use std::collections::HashMap;
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

/// 표시 이름 — 원장에는 세션 id가 남으므로, 프런트가 아는 이름(세션 이름·페르소나)을 받아
/// 갈아끼운다. 모르는 id는 원문 그대로 둔다 — 사라진 세션도 누가 말했는지는 남아야 한다.
fn label(names: &HashMap<String, String>, id: &str) -> String {
    names.get(id).cloned().unwrap_or_else(|| id.to_string())
}

/// ms 에포크 → 로컬 시각 문자열. 깨진 값이면 원본 숫자를 그대로 둔다 (원장을 각색하지 않는다).
fn stamp(ts: i64, fmt: &str) -> String {
    chrono::DateTime::from_timestamp_millis(ts)
        .map(|t| t.with_timezone(&chrono::Local).format(fmt).to_string())
        .unwrap_or_else(|| ts.to_string())
}

/// 문서 머리 — 어느 팀의 대화를 언제 몇 건 내보냈는지. 본문이 없어도 이건 남긴다.
fn head(ws_name: &str, total: i64) -> String {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    format!("# 팀 대화 — {ws_name}\n\n- 내보낸 시각: {now}\n- 메시지: {total}건\n")
}

/// 대화 원장 전체를 Markdown으로 흘려보낸다 — 화면에 올라온 최근 200건이 아니라 전부다.
/// 날짜가 바뀌면 날짜 제목을 새로 열고, 본문은 손대지 않는다 (원장을 각색하지 않는다).
/// 반환값은 쓴 메시지 수. 파일 쓰기는 호출부(lib.rs) 몫 — store::export_lines와 같은 콜백 위임이다.
pub fn export_markdown(
    root: &Path,
    ws: &str,
    ws_name: &str,
    names: &HashMap<String, String>,
    mut on_chunk: impl FnMut(&str) -> Result<(), String>,
) -> Result<u64, String> {
    if !crate::store::db_path(root, ws).exists() {
        on_chunk(&head(ws_name, 0))?; // 한 번도 안 쓴 워크스페이스 — 빈 문서라도 정직하게
        return Ok(0);
    }
    let conn = crate::store::open_db(root, ws).map_err(|e| e.to_string())?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM message", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    on_chunk(&head(ws_name, total))?;

    // 수만 건이어도 메모리에 모으지 않게 한 행씩 흘린다 (scrollback_export와 같은 태도)
    let mut stmt = conn
        .prepare("SELECT ts, sender, recipient, kind, body FROM message ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut day = String::new();
    let mut count = 0u64;
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
        let ts: i64 = r.get(0).map_err(|e| e.to_string())?;
        let from: String = r.get(1).map_err(|e| e.to_string())?;
        let to: String = r.get(2).map_err(|e| e.to_string())?;
        let kind: String = r.get(3).map_err(|e| e.to_string())?;
        let body: String = r.get(4).map_err(|e| e.to_string())?;
        let d = stamp(ts, "%Y-%m-%d");
        if d != day {
            on_chunk(&format!("\n## {d}\n"))?;
            day = d;
        }
        on_chunk(&format!(
            "\n**{} · {} → {}** `{}`\n\n{}\n",
            stamp(ts, "%H:%M"),
            label(names, &from),
            label(names, &to),
            kind.to_uppercase(),
            body,
        ))?;
        count += 1;
    }
    Ok(count)
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

    #[test]
    fn export_markdown_renders_names_and_days() {
        let dir = std::env::temp_dir().join(format!("eqmux-msgx-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        send(&dir, "ws1", "나", "s1", "ask", "범위 알려줘").unwrap();
        send(&dir, "ws1", "s1", "@all", "report", "1차 완료").unwrap();
        let names = HashMap::from([("s1".to_string(), "카이".to_string())]);
        let mut out = String::new();
        let n = export_markdown(&dir, "ws1", "EQMUX", &names, |c| {
            out.push_str(c);
            Ok(())
        })
        .unwrap();
        assert_eq!(n, 2);
        assert!(out.starts_with("# 팀 대화 — EQMUX"));
        assert!(out.contains("- 메시지: 2건"));
        assert!(out.contains("나 → 카이** `ASK`")); // id는 표시 이름으로 치환된다
        assert!(out.contains("카이 → @all** `REPORT`"));
        assert!(out.contains("1차 완료"));
        assert_eq!(out.matches("\n## ").count(), 1); // 같은 날이면 날짜 제목은 하나
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_markdown_without_db_still_writes_head() {
        let dir = std::env::temp_dir().join(format!("eqmux-msgx0-{}", crate::workspace::now_ms()));
        let mut out = String::new();
        let n = export_markdown(&dir, "none", "빈 팀", &HashMap::new(), |c| {
            out.push_str(c);
            Ok(())
        })
        .unwrap();
        assert_eq!(n, 0);
        assert!(out.contains("# 팀 대화 — 빈 팀"));
        assert!(out.contains("- 메시지: 0건"));
    }
}
