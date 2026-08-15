// 트랜스크립트 파서 (PRD G §4.8) — 1급 소스는 에이전트 JSONL 로그 (V1 · FR-G-80).
// 참조만 저장한다 — 경로에서 그때그때 읽고 본문을 DB에 복사하지 않는다 (V2 · FR-G-81).
// JSONL은 비공개 계약이다 (R3): 라인 단위로 부분 파싱하고 실패는 건너뛰어 집계한다 (FR-G-85).
// 파일이 커도 메모리가 비례하지 않도록 끝에서 창 단위로만 읽는다 (NFR — 창 단위 로드).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use serde::Serialize;

/// 파일 끝에서 읽는 최대 바이트 — 이 창 안의 턴만 보여준다
const TAIL_WINDOW: u64 = 2 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub role: String, // "user" | "agent" | "tool"
    pub time: String, // HH:MM (로컬)
    pub text: String,
    pub detail: Option<String>, // 도구 호출의 입력·출력 — UI에서 접힘 (FR-G-83)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptData {
    pub file: String,
    pub turns: Vec<Turn>,
    pub skipped: u32,   // 파싱 실패로 건너뛴 줄 (FR-G-85 — 숨기지 않고 표시)
    pub windowed: bool, // 창 단위 로드로 앞부분이 잘렸는가
}

fn local_hhmm(ts: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|t| t.with_timezone(&chrono::Local).format("%H:%M").to_string())
        .unwrap_or_else(|_| ts.get(11..16).unwrap_or("--:--").to_string())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}

/// content 블록 배열에서 턴을 뽑는다. tool_result는 직전의 결과 없는 도구 턴에 붙인다.
fn push_blocks(turns: &mut Vec<Turn>, blocks: &[serde_json::Value], role: &str, time: &str) {
    for b in blocks {
        match b.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "text" => {
                if let Some(text) = b.get("text").and_then(|t| t.as_str()) {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        turns.push(Turn {
                            role: role.into(),
                            time: time.into(),
                            text: truncate(trimmed, 4000),
                            detail: None,
                        });
                    }
                }
            }
            "tool_use" => {
                let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("도구");
                let input = b
                    .get("input")
                    .map(|i| serde_json::to_string_pretty(i).unwrap_or_default())
                    .unwrap_or_default();
                turns.push(Turn {
                    role: "tool".into(),
                    time: time.into(),
                    text: format!("⚙ {name}"),
                    detail: Some(truncate(&format!("입력:\n{input}"), 2000)),
                });
            }
            "tool_result" => {
                // 도구 결과 — 짝이 되는 도구 턴(마지막 미완 tool)에 출력을 덧붙인다
                let content = b
                    .get("content")
                    .map(|c| match c {
                        serde_json::Value::String(s) => s.clone(),
                        other => serde_json::to_string_pretty(other).unwrap_or_default(),
                    })
                    .unwrap_or_default();
                let out = truncate(&content, 2000);
                if let Some(t) = turns
                    .iter_mut()
                    .rev()
                    .find(|t| t.role == "tool" && !t.detail.as_deref().unwrap_or("").contains("\n출력:"))
                {
                    if let Some(d) = t.detail.as_mut() {
                        d.push_str("\n출력:\n");
                        d.push_str(&out);
                    }
                } else if !out.trim().is_empty() {
                    turns.push(Turn {
                        role: "tool".into(),
                        time: time.into(),
                        text: "⚑ 도구 결과".into(),
                        detail: Some(out),
                    });
                }
            }
            _ => {}
        }
    }
}

/// 한 JSONL 라인 → 턴들. 인식 불가 형태는 Err (호출부가 skipped로 집계).
/// summary 등 대화가 아닌 타입은 Ok(무시)다 — 실패가 아니다.
fn parse_line(turns: &mut Vec<Turn>, line: &str) -> Result<(), ()> {
    let v: serde_json::Value = serde_json::from_str(line).map_err(|_| ())?;
    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if kind != "user" && kind != "assistant" {
        return Ok(()); // summary·system 등 — 대화 턴이 아니다
    }
    let time = local_hhmm(v.get("timestamp").and_then(|t| t.as_str()).unwrap_or(""));
    let role = if kind == "user" { "user" } else { "agent" };
    let content = v.get("message").and_then(|m| m.get("content"));
    match content {
        Some(serde_json::Value::String(s)) => {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                turns.push(Turn { role: role.into(), time, text: truncate(trimmed, 4000), detail: None });
            }
            Ok(())
        }
        Some(serde_json::Value::Array(blocks)) => {
            push_blocks(turns, blocks, role, &time);
            Ok(())
        }
        _ => Err(()), // message.content 부재 — 아는 형태가 아니다
    }
}

/// 파일 끝 창을 읽어 턴 목록으로. 유효 턴이 하나도 없으면 Err → 스크롤백 폴백 (FR-G-86).
pub fn read(path: &std::path::Path, limit: usize) -> Result<TranscriptData, String> {
    let mut f = File::open(path).map_err(|_| "트랜스크립트 파일이 없습니다".to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let windowed = len > TAIL_WINDOW;
    if windowed {
        f.seek(SeekFrom::Start(len - TAIL_WINDOW)).map_err(|e| e.to_string())?;
    }
    // lossy 읽기 — 2MB 창 경계가 멀티바이트(한글) 문자 중간을 자르면 read_to_string은
    // 파일 전체를 Err로 버린다. 바이트로 읽고 손상 바이트만 대체해, 깨진 줄은 파서가
    // 건너뛰고 나머지는 집계한다는 계약(FR-G-85)을 지킨다.
    let mut raw = Vec::new();
    f.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let buf = String::from_utf8_lossy(&raw).into_owned();
    let mut lines: Vec<&str> = buf.lines().collect();
    if windowed && !lines.is_empty() {
        lines.remove(0); // 창 경계의 부분 라인
    }
    let mut turns = Vec::new();
    let mut skipped = 0u32;
    for line in &lines {
        if line.trim().is_empty() {
            continue;
        }
        if parse_line(&mut turns, line).is_err() {
            skipped += 1;
        }
    }
    if turns.is_empty() {
        return Err(format!("인식할 수 있는 턴이 없습니다 (건너뜀 {skipped}줄)"));
    }
    if turns.len() > limit {
        turns.drain(..turns.len() - limit);
    }
    Ok(TranscriptData {
        file: path.to_string_lossy().into_owned(),
        turns,
        skipped,
        windowed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parses_turns_and_pairs_tool_results() {
        let dir = std::env::temp_dir().join(format!("eqmux-ts-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let mut f = File::create(&path).unwrap();
        writeln!(f, r#"{{"type":"summary","summary":"머리말"}}"#).unwrap();
        writeln!(f, r#"{{"type":"user","timestamp":"2026-08-13T01:00:00.000Z","message":{{"role":"user","content":"인증 리팩터 시작해줘"}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"assistant","timestamp":"2026-08-13T01:00:05.000Z","message":{{"role":"assistant","content":[{{"type":"text","text":"구조를 파악하겠습니다."}},{{"type":"tool_use","name":"Read","input":{{"file_path":"src/auth.ts"}}}}]}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"user","timestamp":"2026-08-13T01:00:06.000Z","message":{{"role":"user","content":[{{"type":"tool_result","content":"export function auth() {{}}"}}]}}}}"#).unwrap();
        writeln!(f, "이 줄은 JSON이 아니다 — 건너뛰어야 한다").unwrap();
        writeln!(f, r#"{{"type":"assistant","timestamp":"2026-08-13T01:00:10.000Z","message":{{"role":"assistant","content":[{{"type":"text","text":"파악 완료."}}]}}}}"#).unwrap();

        let data = read(&path, 200).unwrap();
        assert_eq!(data.skipped, 1); // 깨진 줄 1 (FR-G-85)
        let roles: Vec<&str> = data.turns.iter().map(|t| t.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "agent", "tool", "agent"]);
        let tool = &data.turns[2];
        assert!(tool.text.contains("Read"));
        let d = tool.detail.as_deref().unwrap();
        assert!(d.contains("입력:") && d.contains("출력:") && d.contains("auth()")); // 짝짓기
        assert!(!data.windowed);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unrecognizable_file_falls_back() {
        let dir = std::env::temp_dir().join(format!("eqmux-ts2-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bad.jsonl");
        std::fs::write(&path, "전부\n깨진\n줄\n").unwrap();
        assert!(read(&path, 200).is_err()); // → 스크롤백 폴백 (FR-G-86)
        std::fs::remove_dir_all(&dir).ok();
    }
}
