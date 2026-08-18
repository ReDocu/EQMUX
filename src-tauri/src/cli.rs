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
    /// statusLine 채널 (FR-D-19 · §10.4) — Claude Code가 주기 호출, stdin JSON에 비용이 온다
    StatusLine { session: String },
}

const USAGE: &str = "사용법:\n  eqmux send --type <ask|handoff|report|review|escalate> [--to @이름] \"내용\"\n  eqmux report \"진척 한 줄\"\n  eqmux ping";

/// main.rs의 CLI/GUI 분기 판별 — parse가 아는 서브커맨드 전부와 같이 움직여야 한다.
/// 여기 빠진 커맨드는 GUI 기동으로 흘러, Claude Code가 주기 호출하는 채널이면
/// 앱 창이 계속 늘어난다 (_statusline 누락이 그 사례).
pub fn is_cli_command(cmd: &str) -> bool {
    matches!(cmd, "ping" | "send" | "report" | "_hook" | "_statusline")
}

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
        "_statusline" => Ok(Req::StatusLine { session: need_session()? }),
        _ => Err(USAGE.into()),
    }
}

fn to_line(req: &Req, token: Option<&str>) -> String {
    // 세션 토큰 (P-1) — EQMUX_TOKEN 논스를 동봉해야 앱이 session 주장을 인정한다.
    // 세션이 필요한 요청 전부에 붙인다 (ping 제외).
    let with_token = |mut v: serde_json::Value| {
        if let (Some(t), Some(obj)) = (token, v.as_object_mut()) {
            obj.insert("token".into(), serde_json::Value::String(t.to_string()));
        }
        v.to_string()
    };
    match req {
        Req::Ping => serde_json::json!({"cmd": "ping"}).to_string(),
        Req::Send { session, to, kind, body } => with_token(serde_json::json!({
            "cmd": "send", "session": session, "to": to, "type": kind, "body": body
        })),
        Req::Report { session, body } => with_token(serde_json::json!({
            "cmd": "report", "session": session, "body": body
        })),
        Req::Hook { session, event } => {
            // 훅 입력(JSON)은 stdin으로 온다 — 64KB 상한으로 읽어 payload로 동봉
            let payload = read_stdin_json();
            with_token(serde_json::json!({
                "cmd": "hook", "session": session, "event": event, "payload": payload
            }))
        }
        Req::StatusLine { session } => {
            // stdin JSON에 모델·비용이 온다 (§10.4). 첫 stdout 줄 = Claude Code 상태 줄 —
            // 여기서 바로 찍는다 (앱 미실행이어도 상태 줄은 성립해야 한다)
            let payload = read_stdin_json();
            let model = payload
                .get("model")
                .and_then(|m| m.get("display_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Claude");
            match payload
                .get("cost")
                .and_then(|c| c.get("total_cost_usd"))
                .and_then(|v| v.as_f64())
            {
                Some(cost) => println!("EQMUX · {model} · ${cost:.2}"),
                None => println!("EQMUX · {model}"),
            }
            with_token(serde_json::json!({
                "cmd": "statusline", "session": session, "payload": payload
            }))
        }
    }
}

fn read_stdin_json() -> serde_json::Value {
    let mut buf = String::new();
    let _ = std::io::stdin().take(64 * 1024).read_to_string(&mut buf);
    serde_json::from_str(&buf).unwrap_or(serde_json::Value::Null)
}

fn friendly(err: &str) -> String {
    match err {
        e if e.contains("RATE_LIMIT") => "분당 발신 상한(10건)에 닿았습니다 — 잠시 후 다시".into(),
        e if e.contains("TOO_LONG") => "본문이 너무 깁니다 (2,000자 상한)".into(),
        e if e.contains("BAD_TYPE") => "타입은 ask·handoff·report·review·escalate 5종뿐입니다".into(),
        e if e.contains("UNKNOWN_RECIPIENT") => "수신자를 찾지 못했습니다 — 페르소나 이름으로 지정하세요".into(),
        e if e.contains("UNKNOWN_SESSION") => "이 세션을 앱이 추적하고 있지 않습니다".into(),
        e if e.contains("BAD_TOKEN") => "세션 토큰이 일치하지 않습니다 — EQMUX가 시작한 에이전트 세션 안에서만 쓸 수 있습니다".into(),
        e => e.into(),
    }
}

/// SessionStart 훅의 stdout (FR-D-05 · §10.2) — 역할 파일을 세션 컨텍스트로 싣는다.
///
/// --append-system-prompt의 2줄 포인터는 "읽어라"는 지시일 뿐이라, 가벼운 첫 메시지에는
/// 모델이 파일을 열지 않고 답해버린다 (페르소나가 첫 턴부터 빠지는 원인). 훅 컨텍스트는
/// 모델이 고를 수 없으므로 여기서 확정적으로 전달한다.
///
/// 파일은 여전히 유일한 원본이다 (FR-E-40의 취지) — 앱이 사본을 들고 있지 않고,
/// 매 세션 시작마다 이 자리에서 다시 읽는다. 역할 없는 세션이면 아무것도 내지 않는다.
/// 경로는 claude 프로세스에 심은 EQMUX_ROLE_FILE에서 온다 (훅은 그 환경을 물려받는다).
fn session_start_context() -> Option<String> {
    let path = std::env::var("EQMUX_ROLE_FILE").ok().filter(|p| !p.is_empty())?;
    role_context(&path)
}

/// 역할 파일 → 훅 출력 JSON. 환경변수를 벗겨 둬야 테스트할 수 있다 (env는 프로세스 전역).
fn role_context(path: &str) -> Option<String> {
    let body = std::fs::read_to_string(path).ok()?;
    if body.trim().is_empty() {
        return None;
    }
    let ctx = format!(
        "이 세션에 부여된 역할이다 (원본 파일: {path}). 첫 응답부터 이 인물·책임·금지·권한을 따른다.

{body}"
    );
    Some(
        serde_json::json!({
            "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": ctx }
        })
        .to_string(),
    )
}

/// CLI 모드 본체 — 종료 코드 반환. _hook·_statusline은 어떤 실패에도 0
/// (에이전트 흐름·상태 줄을 깨지 않는다).
pub fn run(args: Vec<String>) -> i32 {
    let session = std::env::var("EQMUX_SESSION").ok().filter(|s| !s.is_empty());
    let token = std::env::var("EQMUX_TOKEN").ok().filter(|s| !s.is_empty());
    let silent = matches!(args.first().map(String::as_str), Some("_hook") | Some("_statusline"));
    let req = match parse(&args, session.as_deref()) {
        Ok(r) => r,
        Err(e) => {
            if silent {
                return 0;
            }
            eprintln!("{e}");
            return 2;
        }
    };
    // 역할 컨텍스트는 파이프와 무관하게 먼저 낸다 — 앱이 안 떠 있어도 역할은 실려야 한다.
    // stdin은 아직 읽지 않았다 (to_line의 read_stdin_json이 뒤에서 읽는다).
    if let Req::Hook { event, .. } = &req {
        if event == "SessionStart" {
            if let Some(ctx) = session_start_context() {
                println!("{ctx}");
            }
        }
    }
    match crate::ipc::request(&to_line(&req, token.as_deref())) {
        Ok(resp) => {
            let v: serde_json::Value = serde_json::from_str(&resp).unwrap_or_default();
            if v["ok"].as_bool().unwrap_or(false) {
                if !silent {
                    match &req {
                        Req::Ping => println!("EQMUX 응답 · v{}", v["version"].as_str().unwrap_or("?")),
                        Req::Send { .. } => println!("전송됨"),
                        Req::Report { .. } => println!("보고됨"),
                        Req::Hook { .. } | Req::StatusLine { .. } => {}
                    }
                }
                0
            } else if silent {
                0
            } else {
                eprintln!("{}", friendly(v["error"].as_str().unwrap_or("전송 실패")));
                1
            }
        }
        Err(_) => {
            if silent {
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

    /// SessionStart 훅 (FR-D-05) — 역할 파일 본문이 additionalContext로 실려야 한다.
    /// 여기가 비면 에이전트는 첫 턴에서 페르소나 없이 답한다.
    #[test]
    fn session_start_context_carries_the_role_file() {
        let dir = std::env::temp_dir().join(format!("eqmux-hook-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("role.md");
        std::fs::write(&f, "# S[DevOps]실버울프 — 개발

## 금지
검증 없이 커밋 요청
").unwrap();
        let out = super::role_context(&f.to_string_lossy()).expect("역할 파일이 있으면 컨텍스트가 나온다");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "SessionStart");
        let ctx = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(ctx.contains("실버울프") && ctx.contains("검증 없이 커밋 요청")); // 본문이 실렸다
        assert!(ctx.contains(&*f.to_string_lossy())); // 원본 경로도 함께 — 파일이 원본이다

        // 역할 없는 세션 · 빈 파일 → 아무것도 싣지 않는다 (기본 터미널이 오염되지 않게)
        std::fs::write(&f, "   
").unwrap();
        assert!(super::role_context(&f.to_string_lossy()).is_none());
        assert!(super::role_context(&dir.join("없는파일.md").to_string_lossy()).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// GUI/CLI 분기 (main.rs) — parse가 아는 서브커맨드는 전부 CLI로 분기해야 한다.
    /// 하나라도 빠지면 Claude Code가 그 커맨드를 부를 때마다 앱 창이 새로 뜬다.
    #[test]
    fn cli_branch_covers_every_subcommand() {
        for cmd in ["ping", "send", "report", "_hook", "_statusline"] {
            assert!(is_cli_command(cmd), "{cmd}가 main.rs CLI 분기에서 빠졌다");
        }
        assert!(!is_cli_command("")); // 인자 없음 → GUI 기동
        assert!(!is_cli_command("--flag")); // 미지의 토큰 → GUI 기동
    }

    /// statusLine 채널 (FR-D-19) — 세션 필수, 인자 없음
    #[test]
    fn parses_statusline() {
        assert_eq!(
            parse(&s(&["_statusline"]), Some("kai@ws")).unwrap(),
            Req::StatusLine { session: "kai@ws".into() }
        );
        assert!(parse(&s(&["_statusline"]), None).is_err()); // EQMUX_SESSION 없으면 거부 (run이 0으로 삼킨다)
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

    /// 세션 토큰 동봉 (P-1) — 세션이 필요한 요청에는 token이 실리고 ping에는 없다
    #[test]
    fn to_line_carries_token() {
        let line = to_line(&Req::Report { session: "kai@ws".into(), body: "진척".into() }, Some("nonce-1"));
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["token"].as_str(), Some("nonce-1"));
        assert_eq!(v["session"].as_str(), Some("kai@ws"));
        let ping: serde_json::Value = serde_json::from_str(&to_line(&Req::Ping, Some("nonce-1"))).unwrap();
        assert!(ping.get("token").is_none());
    }

    #[test]
    fn requires_session_and_type() {
        assert!(parse(&s(&["send", "--type", "ask", "x"]), None).is_err()); // EQMUX_SESSION 없음
        assert!(parse(&s(&["send", "본문만"]), Some("a@b")).is_err()); // --type 없음
        assert!(parse(&s(&["report"]), Some("a@b")).is_err()); // 빈 본문
        assert!(parse(&s(&["ping"]), None).is_ok()); // ping은 세션 불요
    }
}
