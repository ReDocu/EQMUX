// eqmux CLI (PRD I) — 에이전트가 앱과 대화하는 표면. 같은 바이너리의 CLI 모드로 동작한다
// (main.rs가 argv로 분기). 전송은 명명 파이프(ipc.rs) 한 줄 요청/한 줄 응답.
//   eqmux send --type ask|handoff|report|review|escalate [--to @이름] "내용"
//   eqmux report "진척 한 줄"          (V4 자기 보고)
//   eqmux _hook <Event>               (Claude Code 훅이 부른다 — stdin JSON, 항상 exit 0)
//   eqmux ping
// 세션 신원은 EQMUX_SESSION 환경변수 — 에이전트 세션 PTY에만 심어져 있다 (FR-D-04).

use std::io::Read;

#[derive(Debug, PartialEq)]
pub enum Req {
    Ping,
    Send { session: String, to: String, kind: String, body: String },
    Report { session: String, body: String },
    Hook { session: String, event: String },
}

const USAGE: &str = "사용법:\n  eqmux send --type <ask|handoff|report|review|escalate> [--to @이름] \"내용\"\n  eqmux report \"진척 한 줄\"\n  eqmux ping";

/// argv → 요청. session은 EQMUX_SESSION — 테스트를 위해 주입받는다.
pub fn parse(args: &[String], session: Option<&str>) -> Result<Req, String> {
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let need_session = || {
        session
            .map(str::to_string)
            .ok_or_else(|| String::from("EQMUX_SESSION이 없습니다 — 에이전트 세션 안에서만 쓸 수 있습니다"))
    };
    match cmd {
        "ping" => Ok(Req::Ping),
        "send" => {
            let mut kind = None;
            let mut to = "@all".to_string();
            let mut body: Vec<&str> = Vec::new();
            let mut i = 1;
            while i < args.len() {
                match args[i].as_str() {
                    "--type" | "-t" => {
                        kind = args.get(i + 1).cloned();
                        i += 2;
                    }
                    "--to" => {
                        if let Some(t) = args.get(i + 1) {
                            to = t.clone();
                        }
                        i += 2;
                    }
                    a => {
                        body.push(a);
                        i += 1;
                    }
                }
            }
            let kind = kind.ok_or(format!("--type이 필요합니다\n{USAGE}"))?;
            if body.is_empty() {
                return Err(format!("내용이 비어 있습니다\n{USAGE}"));
            }
            Ok(Req::Send { session: need_session()?, to, kind, body: body.join(" ") })
        }
        "report" => {
            let body = args[1..].join(" ");
            if body.trim().is_empty() {
                return Err(format!("내용이 비어 있습니다\n{USAGE}"));
            }
            Ok(Req::Report { session: need_session()?, body })
        }
        "_hook" => {
            let event = args.get(1).cloned().ok_or("_hook <Event>가 필요합니다")?;
            Ok(Req::Hook { session: need_session()?, event })
        }
        _ => Err(USAGE.into()),
    }
}

fn to_line(req: &Req) -> String {
    match req {
        Req::Ping => serde_json::json!({"cmd": "ping"}).to_string(),
        Req::Send { session, to, kind, body } => serde_json::json!({
            "cmd": "send", "session": session, "to": to, "type": kind, "body": body
        })
        .to_string(),
        Req::Report { session, body } => serde_json::json!({
            "cmd": "report", "session": session, "body": body
        })
        .to_string(),
        Req::Hook { session, event } => {
            // 훅 입력(JSON)은 stdin으로 온다 — 64KB 상한으로 읽어 payload로 동봉
            let mut buf = String::new();
            let _ = std::io::stdin().take(64 * 1024).read_to_string(&mut buf);
            let payload: serde_json::Value =
                serde_json::from_str(&buf).unwrap_or(serde_json::Value::Null);
            serde_json::json!({
                "cmd": "hook", "session": session, "event": event, "payload": payload
            })
            .to_string()
        }
    }
}

fn friendly(err: &str) -> String {
    match err {
        e if e.contains("RATE_LIMIT") => "분당 발신 상한(10건)에 닿았습니다 — 잠시 후 다시".into(),
        e if e.contains("TOO_LONG") => "본문이 너무 깁니다 (2,000자 상한)".into(),
        e if e.contains("BAD_TYPE") => "타입은 ask·handoff·report·review·escalate 5종뿐입니다".into(),
        e if e.contains("UNKNOWN_RECIPIENT") => "수신자를 찾지 못했습니다 — 페르소나 이름으로 지정하세요".into(),
        e if e.contains("UNKNOWN_SESSION") => "이 세션을 앱이 추적하고 있지 않습니다".into(),
        e => e.into(),
    }
}

/// CLI 모드 본체 — 종료 코드 반환. _hook은 어떤 실패에도 0 (에이전트 흐름을 깨지 않는다).
pub fn run(args: Vec<String>) -> i32 {
    let session = std::env::var("EQMUX_SESSION").ok().filter(|s| !s.is_empty());
    let is_hook = args.first().map(String::as_str) == Some("_hook");
    let req = match parse(&args, session.as_deref()) {
        Ok(r) => r,
        Err(e) => {
            if is_hook {
                return 0;
            }
            eprintln!("{e}");
            return 2;
        }
    };
    match crate::ipc::request(&to_line(&req)) {
        Ok(resp) => {
            let v: serde_json::Value = serde_json::from_str(&resp).unwrap_or_default();
            if v["ok"].as_bool().unwrap_or(false) {
                if !is_hook {
                    match &req {
                        Req::Ping => println!("EQMUX 응답 · v{}", v["version"].as_str().unwrap_or("?")),
                        Req::Send { .. } => println!("전송됨"),
                        Req::Report { .. } => println!("보고됨"),
                        Req::Hook { .. } => {}
                    }
                }
                0
            } else if is_hook {
                0
            } else {
                eprintln!("{}", friendly(v["error"].as_str().unwrap_or("전송 실패")));
                1
            }
        }
        Err(_) => {
            if is_hook {
                return 0;
            }
            eprintln!("EQMUX 앱이 실행 중이 아닙니다 (파이프 연결 실패)");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn parses_send_with_flags_anywhere() {
        let r = parse(&s(&["send", "--type", "ask", "--to", "@카이", "범위", "질문"]), Some("noel@ws"));
        assert_eq!(
            r.unwrap(),
            Req::Send {
                session: "noel@ws".into(),
                to: "@카이".into(),
                kind: "ask".into(),
                body: "범위 질문".into()
            }
        );
        // --to 없으면 @all, 플래그가 본문 뒤에 와도 된다
        let r = parse(&s(&["send", "한 줄", "--type", "report"]), Some("noel@ws")).unwrap();
        assert_eq!(r, Req::Send { session: "noel@ws".into(), to: "@all".into(), kind: "report".into(), body: "한 줄".into() });
    }

    #[test]
    fn requires_session_and_type() {
        assert!(parse(&s(&["send", "--type", "ask", "x"]), None).is_err()); // EQMUX_SESSION 없음
        assert!(parse(&s(&["send", "본문만"]), Some("a@b")).is_err()); // --type 없음
        assert!(parse(&s(&["report"]), Some("a@b")).is_err()); // 빈 본문
        assert!(parse(&s(&["ping"]), None).is_ok()); // ping은 세션 불요
    }
}
