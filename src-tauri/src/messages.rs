// 메시지 버스 (PRD F) — 워크스페이스 DB의 message 테이블이 원장이다 (M5 평면 스트림).
// 여기는 검증(M2 강제 5종)·상한(M6)·저장만 맡는다. 전달(M3 인박스 + 상태 기반)은
// 세션 상태를 아는 프런트가 PTY 주입으로 수행한다 — 버스는 원장이고 배달은 관제의 일.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::params;
use serde::Serialize;

pub const TYPES: [&str; 5] = ["ask", "handoff", "report", "review", "escalate"];
pub const MAX_BODY_CHARS: usize = 800; // M6 길이 상한 (0.5 결정 8 — 긴 내용은 --file)
pub const RATE_PER_MIN: usize = 10; // M6 세션(발신자)당 분당 상한

/// --file 첨부 (0.5) — 본문 대신 저장소 안 파일을 가리킨다. 경로는 절대 경로
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FileRef {
    pub path: String,
    pub size: u64,
}

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
    /// report --done (0.5) — 에이전트가 맡은 일을 끝냈다고 밝힌 보고
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<FileRef>,
    /// 다른 프로젝트에서 온 메시지면 그 주소의 프로젝트 이름 (`카이@app-b`의 app-b)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// 보낸 때의 세션 이름 (C4 디렉터리) — 세션이 사라진 뒤에도 내부 id 대신 이 이름을 보인다
    #[serde(rename = "fromName", skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    #[serde(rename = "toName", skip_serializing_if = "Option::is_none")]
    pub to_name: Option<String>,
}

/// 원장 행의 0.5 부가 정보 — 없으면 0.4.2 메시지와 같다
#[derive(Default, Clone)]
pub struct Extra {
    pub done: bool,
    pub file: Option<FileRef>,
    pub project: Option<String>,
    /// 이름을 직접 줄 때만 (테스트) — 없으면 send_with가 C4 디렉터리에서 찾는다
    pub from_name: Option<String>,
    pub to_name: Option<String>,
}

/// M2 — 자유 텍스트 금지. 타입은 5종뿐이고 본문은 비어 있을 수 없다.
/// 길이 상한은 발신자를 알아야 해서 check_len이 따로 본다 (사람은 상한 밖 — 결정 18).
pub fn validate(kind: &str, body: &str) -> Result<(), String> {
    if !TYPES.contains(&kind) {
        return Err("BAD_TYPE".into());
    }
    if body.trim().is_empty() {
        return Err("EMPTY".into());
    }
    Ok(())
}

/// M6 길이 상한 — 받는 에이전트의 컨텍스트를 아끼는 장치라 사람("나")의 글은 세지 않는다
pub fn check_len(from: &str, body: &str) -> Result<(), String> {
    let n = body.trim().chars().count();
    if from != "나" && n > MAX_BODY_CHARS {
        return Err(format!("TOO_LONG:{n}")); // 글자 수는 CLI 오류 문구가 쓴다 (시안 T36ZZ)
    }
    Ok(())
}

/// --file 경로 검사 — 세션 작업 폴더(저장소) 안의 실재 파일만. 심볼릭 링크·`..`는 정규화로 푼다
pub fn attach_file(repo: &str, path: &str) -> Result<FileRef, String> {
    let canon = |p: &str| std::fs::canonicalize(p).map_err(|_| "FILE_NOT_FOUND".to_string());
    let file = canon(path)?;
    if !file.starts_with(canon(repo)?) {
        return Err("FILE_OUTSIDE_REPO".into());
    }
    let meta = std::fs::metadata(&file).map_err(|_| "FILE_NOT_FOUND".to_string())?;
    if !meta.is_file() {
        return Err("FILE_NOT_FOUND".into());
    }
    // canonicalize는 Windows에서 \\?\ 접두를 붙인다 — 사람·에이전트가 여는 경로로 돌려 놓는다
    let shown = file.to_string_lossy();
    let shown = shown.strip_prefix(r"\\?\").unwrap_or(&shown).to_string();
    Ok(FileRef { path: shown, size: meta.len() })
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
    send_with(root, ws, from, to, kind, body, &Extra::default())
}

/// send + 0.5 부가 정보(완료 보고·첨부·다른 프로젝트)
pub fn send_with(
    root: &Path,
    ws: &str,
    from: &str,
    to: &str,
    kind: &str,
    body: &str,
    extra: &Extra,
) -> Result<MsgRow, String> {
    validate(kind, body)?;
    check_len(from, body)?;
    let conn = crate::store::open_db(root, ws).map_err(|e| e.to_string())?;
    let now = crate::workspace::now_ms() as i64;
    let body = body.trim();
    let read = from == "나";
    let (fpath, fsize) = match &extra.file {
        Some(f) => (Some(f.path.as_str()), Some(f.size as i64)),
        None => (None, None),
    };
    // 보낸 때의 이름을 원장에 남긴다 — "나"·"@all"은 디렉터리에 없어 비고, 화면이 원문을 쓴다
    let from_name = extra.from_name.clone().or_else(|| crate::ipc::session_name(from));
    let to_name = extra.to_name.clone().or_else(|| crate::ipc::session_name(to));
    conn.execute(
        "INSERT INTO message (ts, sender, recipient, kind, body, read, done, file_path, file_size, project, sender_name, recipient_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![now, from, to, kind, body, read as i64, extra.done as i64, fpath, fsize, extra.project, from_name, to_name],
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
        done: extra.done,
        file: extra.file.clone(),
        project: extra.project.clone(),
        from_name,
        to_name,
    })
}

/// 전달 대기 수 — 받는 세션이 지금 상태(작업 중)로 들어간 뒤 그 세션에게 직접 온 메시지
pub fn count_to_since(root: &Path, ws: &str, to: &str, since_ms: i64) -> Result<i64, String> {
    let conn = crate::store::open_db(root, ws).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COUNT(*) FROM message WHERE recipient = ?1 AND ts >= ?2",
        params![to, since_ms],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// 열린 handoff·ask를 준 발신자 (report --done 회신 대상) — 이 세션이 직접 받은 handoff·ask
/// 가운데 마지막 report --done 뒤에 온 것. `@all`은 직접 받은 것이 아니라 빠진다.
/// "나"는 빠진다 — report는 원래 "나"에게 간다.
pub fn open_requesters(root: &Path, ws: &str, me: &str) -> Result<Vec<Requester>, String> {
    if !crate::store::db_path(root, ws).exists() {
        return Ok(Vec::new());
    }
    let conn = crate::store::open_db(root, ws).map_err(|e| e.to_string())?;
    // SQLite의 MIN() 집계는 같은 행의 맨 열(kind·ts)을 함께 준다 — 발신자별 가장 먼저 열린 건
    let mut stmt = conn
        .prepare(
            "SELECT sender, kind, ts, MIN(id) FROM message
             WHERE recipient = ?1 AND kind IN ('handoff', 'ask') AND sender NOT IN ('나', ?1)
               AND id > (SELECT COALESCE(MAX(id), 0) FROM message WHERE sender = ?1 AND kind = 'report' AND done = 1)
             GROUP BY sender ORDER BY MIN(id)",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![me], |r| Ok(Requester { sender: r.get(0)?, kind: r.get(1)?, ts: r.get(2)? }))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 열린 handoff·ask를 준 발신자 — 보고 회신 대상과 CLI 표기(`린 (열린 handoff 10:34)`)
#[derive(Debug, PartialEq)]
pub struct Requester {
    pub sender: String,
    pub kind: String,
    pub ts: i64,
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
            "SELECT id, ts, sender, recipient, kind, body, read, done, file_path, file_size, project, sender_name, recipient_name FROM
               (SELECT * FROM message WHERE id < ?1 ORDER BY id DESC LIMIT ?2)
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![before_id.unwrap_or(i64::MAX), limit.min(500) as i64], |r| {
            let file = r.get::<_, Option<String>>(8)?.map(|path| FileRef {
                path,
                size: r.get::<_, Option<i64>>(9).ok().flatten().unwrap_or(0) as u64,
            });
            Ok(MsgRow {
                id: r.get(0)?,
                ts: r.get(1)?,
                from: r.get(2)?,
                to: r.get(3)?,
                kind: r.get(4)?,
                body: r.get(5)?,
                read: r.get::<_, i64>(6)? != 0,
                done: r.get::<_, i64>(7)? != 0,
                file,
                project: r.get(10)?,
                from_name: r.get(11)?,
                to_name: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
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
        .prepare("SELECT ts, sender, recipient, kind, body, sender_name, recipient_name FROM message ORDER BY id ASC")
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
        // 프런트가 아는 이름이 우선, 없으면(사라진 세션) 원장에 남은 보낸 때의 이름
        let from = names.get(&from).cloned().or(r.get(5).ok().flatten()).unwrap_or(from);
        let to = names.get(&to).cloned().or(r.get(6).ok().flatten()).unwrap_or(to);
        let d = stamp(ts, "%Y-%m-%d");
        if d != day {
            on_chunk(&format!("\n## {d}\n"))?;
            day = d;
        }
        on_chunk(&format!(
            "\n**{} · {} → {}** `{}`\n\n{}\n",
            stamp(ts, "%H:%M"),
            from,
            to,
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
        assert_eq!(check_len("kai@ws", &long), Err(format!("TOO_LONG:{}", MAX_BODY_CHARS + 1)));
        assert!(check_len("kai@ws", &"a".repeat(MAX_BODY_CHARS)).is_ok());
        assert!(check_len("나", &long).is_ok()); // 사람의 글은 상한 밖 (결정 18)
    }

    #[test]
    fn attach_file_only_inside_repo() {
        let dir = std::env::temp_dir().join(format!("eqmux-attach-{}", crate::workspace::now_ms()));
        let repo = dir.join("repo");
        std::fs::create_dir_all(repo.join(".eqmux").join("notes")).unwrap();
        let note = repo.join(".eqmux").join("notes").join("n.md");
        std::fs::write(&note, "12345").unwrap();
        std::fs::write(dir.join("outside.md"), "x").unwrap();
        let r = repo.to_string_lossy();
        let f = attach_file(&r, &note.to_string_lossy()).unwrap();
        assert_eq!(f.size, 5);
        assert!(f.path.ends_with("n.md") && !f.path.starts_with(r"\\?\"));
        let up = repo.join("..").join("outside.md");
        assert_eq!(attach_file(&r, &up.to_string_lossy()), Err("FILE_OUTSIDE_REPO".into()));
        assert_eq!(attach_file(&r, &repo.join("none.md").to_string_lossy()), Err("FILE_NOT_FOUND".into()));
        assert_eq!(attach_file(&r, &r), Err("FILE_NOT_FOUND".into())); // 폴더는 첨부가 아니다
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 열린 handoff·ask — 보고 뒤에는 닫히고, @all·"나"는 회신 대상이 아니다
    #[test]
    fn open_requesters_close_after_done_report() {
        let dir = std::env::temp_dir().join(format!("eqmux-open-{}", crate::workspace::now_ms()));
        let me = "kai@ws1";
        assert!(open_requesters(&dir, "ws1", me).unwrap().is_empty()); // DB 없음
        send(&dir, "ws1", "lin@ws1", me, "handoff", "로그인 API").unwrap();
        send(&dir, "ws1", "noel@ws2", me, "ask", "스키마?").unwrap();
        send(&dir, "ws1", "lin@ws1", me, "ask", "진척?").unwrap();
        send(&dir, "ws1", "나", me, "handoff", "사람이 맡김").unwrap();
        send(&dir, "ws1", "rin@ws1", "@all", "handoff", "모두에게").unwrap();
        send(&dir, "ws1", "rin@ws1", me, "review", "리뷰는 맡긴 일이 아님").unwrap();
        let open = open_requesters(&dir, "ws1", me).unwrap();
        let who: Vec<(&str, &str)> = open.iter().map(|r| (r.sender.as_str(), r.kind.as_str())).collect();
        assert_eq!(who, vec![("lin@ws1", "handoff"), ("noel@ws2", "ask")]); // 발신자별 가장 먼저 열린 건
        // 진척 보고(--done 아님)로는 닫히지 않는다
        send(&dir, "ws1", me, "나", "report", "절반").unwrap();
        assert_eq!(open_requesters(&dir, "ws1", me).unwrap().len(), 2);
        let done = Extra { done: true, ..Default::default() };
        let row = send_with(&dir, "ws1", me, "나", "report", "완료", &done).unwrap();
        assert!(row.done);
        assert!(open_requesters(&dir, "ws1", me).unwrap().is_empty());
        send(&dir, "ws1", "lin@ws1", me, "handoff", "다음 일").unwrap();
        assert_eq!(open_requesters(&dir, "ws1", me).unwrap()[0].sender, "lin@ws1");
        // 원장 왕복 — done·file·project가 그대로 읽힌다
        let extra = Extra {
            done: false,
            file: Some(FileRef { path: "D:/r/.eqmux/notes/a.md".into(), size: 42 }),
            project: Some("app-2".into()),
            from_name: Some("엑스".into()),
            ..Default::default()
        };
        send_with(&dir, "ws1", "x@ws9", me, "ask", "첨부", &extra).unwrap();
        let rows = list(&dir, "ws1", None, 50).unwrap();
        assert!(rows.iter().any(|m| m.done && m.body == "완료"));
        let last = rows.last().unwrap();
        assert_eq!(last.file, extra.file);
        assert_eq!(last.project.as_deref(), Some("app-2"));
        assert_eq!(last.from_name.as_deref(), Some("엑스")); // 보낸 때의 이름이 원장에 남는다
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 세션이 사라진 뒤 — 프런트가 이름을 모르면 원장에 남은 보낸 때의 이름으로 내보낸다
    #[test]
    fn export_falls_back_to_the_name_at_send_time() {
        let dir = std::env::temp_dir().join(format!("eqmux-msgn-{}", crate::workspace::now_ms()));
        let named = Extra { from_name: Some("EQMUX01".into()), ..Default::default() };
        send_with(&dir, "ws1", "shell1@gone-ws", "나", "report", "끝", &named).unwrap();
        let mut out = String::new();
        export_markdown(&dir, "ws1", "EQMUX", &HashMap::new(), |c| {
            out.push_str(c);
            Ok(())
        })
        .unwrap();
        assert!(out.contains("EQMUX01 → 나"), "{out}");
        assert!(!out.contains("shell1@gone-ws"));
        let _ = std::fs::remove_dir_all(&dir);
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
