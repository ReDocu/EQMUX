// 과거 세션 검색 (0.6 §4) — 워크스페이스 폴더에서 돈 Claude Code 대화(트랜스크립트 JSONL)를 읽기만 한다.
// 본문을 DB에 복사하지 않는다 (transcript.rs와 같은 V2 원칙). 재개는 새 경로를 만들지 않는다 —
// 그 대화가 슬롯의 마지막 대화(agent_session 매핑)일 때만 기존 agent_resume으로 연다.

use std::collections::HashMap;
use std::io::BufRead;
use std::path::Path;

use serde::Serialize;

/// 결과 상한 — 한 대화가 결과를 다 덮지 않게 대화당 상한도 둔다
const MAX_HITS: usize = 200;
const PER_CONVERSATION: usize = 20;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryHit {
    /// Claude Code 대화 id (파일 이름)
    pub uuid: String,
    /// 이 대화를 마지막으로 돌린 EQMUX 슬롯 — 매핑이 없으면(앱 밖에서 돈 대화 · 슬롯의 옛 대화) None
    pub session: Option<String>,
    /// 슬롯의 마지막 대화라 기존 재개 경로로 열 수 있다
    pub resumable: bool,
    /// epoch ms — 그 줄의 timestamp, 없으면 파일 수정 시각
    pub ts: i64,
    /// "user" | "agent"
    pub role: String,
    pub snippet: String,
}

/// 대화 줄 → (역할, 시각, 텍스트). 도구 호출·결과·메타 줄은 검색 대상이 아니다 (사람이 찾는 것은 대화다)
fn turn_text(line: &str) -> Option<(&'static str, Option<i64>, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let role = match v["type"].as_str()? {
        "user" => "user",
        "assistant" => "agent",
        _ => return None,
    };
    let ts = v["timestamp"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.timestamp_millis());
    let text = match &v["message"]["content"] {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let text = text.trim();
    (!text.is_empty()).then(|| (role, ts, text.to_string()))
}

/// 매치 둘레 한 줄 — 앞 60자 · 뒤 140자, 공백은 하나로
fn snippet(text: &str, q_lower: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = flat.chars().collect();
    let lower: Vec<char> = flat.to_lowercase().chars().collect();
    let q: Vec<char> = q_lower.chars().collect();
    // 소문자로 바꾸면 글자 수가 달라지는 드문 글자가 있으면 위치를 맞출 수 없다 — 앞에서부터 보인다
    let at = if lower.len() == chars.len() { lower.windows(q.len().max(1)).position(|w| w == q.as_slice()).unwrap_or(0) } else { 0 };
    let from = at.saturating_sub(60);
    let to = (at + q.len() + 140).min(chars.len());
    let mut s: String = chars[from..to].iter().collect();
    if from > 0 {
        s.insert(0, '…');
    }
    if to < chars.len() {
        s.push('…');
    }
    s
}

/// 폴더의 *.jsonl을 최근 수정 순으로 훑는다. slots: 대화 uuid → (슬롯 세션 id, 재개 가능)
fn search_dir(dir: &Path, query: &str, slots: &HashMap<String, (String, bool)>) -> Vec<HistoryHit> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut hits = Vec::new();
    for (mtime, path) in files {
        let Some(uuid) = path.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
        let Ok(f) = std::fs::File::open(&path) else { continue };
        let file_ms = mtime.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let slot = slots.get(&uuid);
        let mut n = 0;
        // ponytail: 파일 전체를 줄마다 훑는다 — 큰 저장소에서 느려지면 FTS 색인을 둔다
        for line in std::io::BufReader::new(f).lines().map_while(Result::ok) {
            if !line.to_lowercase().contains(&q) {
                continue; // 원문 줄로 먼저 거른다 — JSON 해석은 맞을 법한 줄에만
            }
            let Some((role, ts, text)) = turn_text(&line) else { continue };
            if !text.to_lowercase().contains(&q) {
                continue; // 도구 입력·메타 필드에서만 맞았다
            }
            hits.push(HistoryHit {
                uuid: uuid.clone(),
                session: slot.map(|s| s.0.clone()),
                resumable: slot.is_some_and(|s| s.1),
                ts: ts.unwrap_or(file_ms),
                role: role.into(),
                snippet: snippet(&text, &q),
            });
            n += 1;
            if n >= PER_CONVERSATION || hits.len() >= MAX_HITS {
                break;
            }
        }
        if hits.len() >= MAX_HITS {
            break;
        }
    }
    hits
}

/// 슬롯의 마지막 대화 매핑 (FR-D-24 agent_session) — 읽기 전용. 없으면 빈 표
fn slot_map(root: &Path, ws: &str) -> HashMap<String, (String, bool)> {
    let path = crate::store::db_path(root, ws);
    let Ok(conn) = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return HashMap::new();
    };
    let Ok(mut stmt) = conn.prepare("SELECT agent_session_id, session_id, resumable FROM agent_session WHERE agent_session_id IS NOT NULL") else {
        return HashMap::new();
    };
    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0))))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

/// 과거 세션 검색 — 워크스페이스 폴더(cwd)의 Claude Code 대화에서 query가 든 대화 줄
#[tauri::command(async)]
pub fn history_search(
    store_state: tauri::State<crate::StoreState>,
    workspace: String,
    cwd: String,
    query: String,
) -> Vec<HistoryHit> {
    let Some(dir) = crate::agent::transcript_path(&cwd, "_").parent().map(Path::to_path_buf) else { return Vec::new() };
    search_dir(&dir, &query, &slot_map(&store_state.0.root(), &workspace))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(kind: &str, ts: &str, content: serde_json::Value) -> String {
        serde_json::json!({ "type": kind, "timestamp": ts, "message": { "role": kind, "content": content } }).to_string()
    }

    #[test]
    fn searches_conversation_text_only() {
        let dir = std::env::temp_dir().join(format!("eqmux-hist-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = [
            line("user", "2026-11-02T01:00:00Z", serde_json::json!("login API를 고쳐 줘")),
            line("assistant", "2026-11-02T01:01:00Z", serde_json::json!([
                { "type": "text", "text": "Login API 수정을 시작합니다" },
                { "type": "tool_use", "name": "Edit", "input": { "file_path": "login.rs" } }
            ])),
            // 도구 결과·메타에서만 맞는 줄은 결과가 아니다
            line("user", "2026-11-02T01:02:00Z", serde_json::json!([{ "type": "tool_result", "content": "login ok" }])),
            r#"{"type":"summary","summary":"login"}"#.to_string(),
            "깨진 줄 login".to_string(),
        ];
        std::fs::write(dir.join("aaa.jsonl"), a.join("\n")).unwrap();
        std::fs::write(dir.join("bbb.jsonl"), line("user", "2026-11-01T00:00:00Z", serde_json::json!("다른 대화"))).unwrap();
        std::fs::write(dir.join("note.txt"), "login").unwrap();
        let slots = HashMap::from([("aaa".to_string(), ("kai@w".to_string(), true))]);

        let hits = search_dir(&dir, "  LOGIN ", &slots);
        assert_eq!(hits.len(), 2, "{hits:?}");
        assert_eq!((hits[0].role.as_str(), hits[1].role.as_str()), ("user", "agent"));
        assert_eq!(hits[1].snippet, "Login API 수정을 시작합니다"); // 도구 블록은 빠지고 텍스트만
        assert!(hits.iter().all(|h| h.uuid == "aaa" && h.session.as_deref() == Some("kai@w") && h.resumable));
        assert_eq!(hits[0].ts, chrono::DateTime::parse_from_rfc3339("2026-11-02T01:00:00Z").unwrap().timestamp_millis());
        let other = search_dir(&dir, "다른", &slots);
        assert_eq!((other.len(), other[0].session.clone(), other[0].resumable), (1, None, false)); // 매핑 없는 대화
        assert!(search_dir(&dir, " ", &slots).is_empty());
        assert!(search_dir(&dir.join("없음"), "login", &slots).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn snippet_centers_on_match() {
        let long = format!("{} 핵심 단어 {}", "앞".repeat(100), "뒤".repeat(300));
        let s = snippet(&long, "핵심");
        assert!(s.starts_with('…') && s.ends_with('…') && s.contains("핵심 단어"));
        assert!(s.chars().count() <= 60 + 2 + 140 + 2);
        assert_eq!(snippet("짧은\n\n  글", "글"), "짧은 글");
    }
}
