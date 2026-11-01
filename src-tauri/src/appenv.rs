//! 기동 환경 위생 (B136·B167·B120) — 터미널(cmux·iTerm·VS Code·Ghostty·tmux…)이나 Claude Code
//! 세션 안에서 앱을 띄우면 그 도구의 세션 변수·래퍼 shim이 앱 프로세스에 실려 온다. 그대로면
//! 모든 페인·에이전트·git이 그것을 물려받아, EQMUX가 띄운 claude가 다른 도구의 래퍼·훅을 탄다.
//! macOS는 기동 때 프로세스 환경에서 한 번 걷는다(run 첫머리, 스레드를 띄우기 전) — PTY뿐 아니라
//! 앱이 직접 부르는 git·lsof·셸까지 한 관문에서 깨끗해진다. Windows는 손대지 않는다(동작 유지).
//!
//! 걷는 것 = 부모 도구의 '세션 표식'뿐이다. 사용자 설정(CLAUDE_CODE_USE_BEDROCK·
//! CLAUDE_CODE_MAX_OUTPUT_TOKENS·ANTHROPIC_* 등)은 남긴다 — Finder 기동과 터미널 기동이 같은
//! 결과가 되게 하는 것이 목적이지, 사용자가 일부러 켠 값을 지우는 것이 아니다.

/// 이름 그대로 걷는 변수
const EXACT: &[&str] = &[
    // Claude Code 세션 — 부모가 Claude Code 도구 셸일 때. 남으면 여기서 켠 claude가 자식 세션으로
    // 인식돼 트랜스크립트 저장을 끄고(sanitize_pty_env ②), 부모의 메시징 소켓으로 말을 건다
    "CLAUDECODE",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CLAUDE_ENV_FILE",
    "CLAUDE_PROJECT_DIR",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "AI_AGENT",
    // 터미널 앱 정체 — 페인 안 CLI가 자기가 cmux·iTerm 안에 있다고 오인한다
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TERM_SESSION_ID",
    "LC_TERMINAL",
    "LC_TERMINAL_VERSION",
    "COLORFGBG",
    "__CFBundleIdentifier",
    // 멀티플렉서 — 남으면 페인에서 친 tmux가 '중첩 세션'으로 거부되고, zellij가 바깥 세션에 붙는다
    "TMUX",
    "TMUX_PANE",
    "STY",
    "ZELLIJ",
    "ZELLIJ_PANE_ID",
    "ZELLIJ_SESSION_NAME",
];

/// 이 접두어로 시작하면 걷는다 — 도구가 버전마다 변수를 늘려도 따라간다
const PREFIXES: &[&str] = &[
    "CMUX_",
    "CLAUDE_CODE_SESSION_",
    "CLAUDE_CODE_BRIDGE_",
    "ITERM_",
    "VSCODE_",
    "WEZTERM_",
    "GHOSTTY_",
    "KITTY_",
    "ALACRITTY_",
    "WARP_",
];

/// 값이 터미널 앱 번들 안을 가리킬 때만 걷는다 — 사용자가 직접 정한 값일 수도 있는 이름들
/// (TERMINFO=…/cmux.app/…/terminfo, GIT_ASKPASS=…/Visual Studio Code.app/…/askpass.sh)
const BUNDLE_VALUED: &[&str] = &["TERMINFO", "GIT_ASKPASS", "SSH_ASKPASS"];

/// 부모 도구가 남긴 세션 변수인가
pub fn is_inherited(key: &str, value: &str) -> bool {
    EXACT.contains(&key)
        || PREFIXES.iter().any(|p| key.starts_with(p))
        // 표면(페인) 식별자 — cmux·Ghostty 말고도 같은 꼴을 쓰는 도구가 많다
        || key.ends_with("_SURFACE_ID")
        || (BUNDLE_VALUED.contains(&key) && value.contains(".app/"))
}

/// 걷은 변수가 가리키던 PATH 자리 — 도구의 래퍼 shim 폴더와 번들 CLI 폴더.
/// cmux는 PATH 맨 앞에 claude·codex 래퍼 폴더를 끼워 둔다(B136 'PATH shim'). 변수만 걷고
/// PATH를 두면 래퍼는 그대로 탄다. 시스템 폴더를 잘못 지우지 않게 'shim'이 이름에 있거나
/// 앱 번들(.app/) 안인 자리만 고른다
fn shim_roots(key: &str, value: &str) -> Vec<String> {
    if !value.starts_with('/') {
        return Vec::new();
    }
    let parent = value.rsplit_once('/').map(|(p, _)| p.to_string()).filter(|p| !p.is_empty());
    let mut out = Vec::new();
    if key.contains("SHIM") {
        out.push(value.to_string()); // …_SHIM_ROOT는 폴더, …_WRAPPER_SHIM은 그 안의 파일
        out.extend(parent.clone());
    }
    if key.ends_with("_CLI_PATH") || key.ends_with("_BIN") {
        out.extend(parent);
    }
    out.retain(|r| r.to_lowercase().contains("shim") || r.contains(".app/"));
    out
}

fn under(entry: &str, root: &str) -> bool {
    entry == root || entry.strip_prefix(root).is_some_and(|rest| rest.starts_with('/'))
}

/// 걷을 변수 이름들과 새 PATH(바뀔 때만) — 순수 함수라 시험한다
pub fn plan(vars: &[(String, String)]) -> (Vec<String>, Option<String>) {
    let mut remove = Vec::new();
    let mut roots = Vec::new();
    for (k, v) in vars {
        if is_inherited(k, v) {
            remove.push(k.clone());
            roots.extend(shim_roots(k, v));
        }
    }
    let path = vars.iter().find(|(k, _)| k == "PATH").map(|(_, v)| v.as_str()).unwrap_or("");
    let kept: Vec<&str> = path
        .split(':')
        .filter(|e| !e.is_empty() && !roots.iter().any(|r| under(e, r)))
        .collect();
    let new_path = kept.join(":");
    (remove, (new_path != path).then_some(new_path))
}

/// 프로세스 환경에서 걷는다 — set_var·remove_var는 다른 스레드가 환경을 읽는 동안 부르면 안 된다.
/// run() 첫머리(스레드를 띄우기 전)에서만 부른다
#[cfg(target_os = "macos")]
pub fn scrub_process_env() {
    let vars: Vec<(String, String)> = std::env::vars().collect();
    let (remove, path) = plan(&vars);
    for k in &remove {
        std::env::remove_var(k);
    }
    if let Some(p) = path {
        std::env::set_var("PATH", p);
    }
    if !remove.is_empty() {
        // 값은 남기지 않는다 — 토큰·소켓 경로가 섞여 있다
        crate::diag::write(&format!("ENV-SCRUB {} vars: {}", remove.len(), remove.join(",")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// B136 — cmux 안의 Claude Code 도구 셸에서 띄운 실제 환경(이 기기에서 본 이름들)
    #[test]
    fn scrubs_cmux_and_claude_session_but_keeps_user_config() {
        let shim = "/Users/u/.cmuxterm/cmux-cli-shims/F676";
        let vars = env(&[
            ("CMUX_SURFACE_ID", "abc"),
            ("CMUX_SOCKET_PATH", "/tmp/cmux.sock"),
            ("CMUX_CLAUDE_WRAPPER_SHIM", "/Users/u/.cmuxterm/cmux-cli-shims/F676/claude"),
            ("CMUX_AGENT_COMMAND_SHIM_ROOT", shim),
            ("CMUX_BUNDLED_CLI_PATH", "/Volumes/cmux/cmux.app/Contents/Resources/bin/cmux"),
            ("GHOSTTY_SURFACE_ID", "1"),
            ("GHOSTTY_RESOURCES_DIR", "/Volumes/cmux/cmux.app/Contents/Resources/ghostty"),
            ("TERMINFO", "/Volumes/cmux/cmux.app/Contents/Resources/terminfo"),
            ("TERM_PROGRAM", "ghostty"),
            ("CLAUDECODE", "1"),
            ("CLAUDE_CODE_SESSION_ID", "s"),
            ("CLAUDE_CODE_SESSION_ATTENDED", "1"),
            ("CLAUDE_CODE_MESSAGING_TOKEN", "t"),
            ("AI_AGENT", "claude"),
            ("CLAUDE_CODE_USE_BEDROCK", "1"),
            ("ANTHROPIC_MODEL", "x"),
            ("HOME", "/Users/u"),
            ("LANG", "ko_KR.UTF-8"),
            ("SSH_AUTH_SOCK", "/private/tmp/launchd/Listeners"),
            (
                "PATH",
                "/Users/u/.cmuxterm/cmux-cli-shims/F676:/Volumes/cmux/cmux.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            ),
        ]);
        let (remove, path) = plan(&vars);
        for k in [
            "CMUX_SURFACE_ID",
            "CMUX_SOCKET_PATH",
            "CMUX_CLAUDE_WRAPPER_SHIM",
            "GHOSTTY_SURFACE_ID",
            "TERMINFO",
            "TERM_PROGRAM",
            "CLAUDECODE",
            "CLAUDE_CODE_SESSION_ID",
            "CLAUDE_CODE_SESSION_ATTENDED",
            "CLAUDE_CODE_MESSAGING_TOKEN",
            "AI_AGENT",
        ] {
            assert!(remove.iter().any(|r| r == k), "{k}를 걷어야 한다");
        }
        for k in ["CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_MODEL", "HOME", "LANG", "SSH_AUTH_SOCK", "PATH"] {
            assert!(!remove.iter().any(|r| r == k), "{k}는 사용자 환경이다 — 남긴다");
        }
        // 래퍼 shim과 번들 CLI 폴더만 빠지고 시스템·Homebrew 폴더는 남는다
        assert_eq!(path.as_deref(), Some("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"));
    }

    #[test]
    fn terminal_tools_and_multiplexers() {
        for (k, v) in [
            ("ITERM_SESSION_ID", "w0t0p0"),
            ("LC_TERMINAL", "iTerm2"),
            ("VSCODE_GIT_IPC_HANDLE", "/var/x.sock"),
            ("WEZTERM_PANE", "3"),
            ("KITTY_WINDOW_ID", "1"),
            ("TMUX", "/private/tmp/tmux-501/default,1,0"),
            ("ZELLIJ", "0"),
            ("GIT_ASKPASS", "/Applications/Visual Studio Code.app/Contents/Resources/app/askpass.sh"),
            ("FOO_SURFACE_ID", "9"),
        ] {
            assert!(is_inherited(k, v), "{k}");
        }
        // 사용자가 직접 정한 값은 번들 밖이다 — 남긴다
        assert!(!is_inherited("GIT_ASKPASS", "/usr/local/bin/my-askpass"));
        assert!(!is_inherited("TERMINFO", "/Users/u/.terminfo"));
        assert!(!is_inherited("TERM", "xterm-ghostty")); // TERM은 sanitize_pty_env가 덮어쓴다
    }

    /// 걷을 것이 없으면 PATH를 건드리지 않는다 — 시스템 폴더는 어떤 *_BIN 값이 가리켜도 지우지 않는다
    #[test]
    fn leaves_clean_env_and_system_dirs_alone() {
        let clean = env(&[("HOME", "/Users/u"), ("PATH", "/usr/bin:/bin")]);
        assert_eq!(plan(&clean), (Vec::new(), None));
        let odd = env(&[("GHOSTTY_BIN", "/usr/local/bin/ghostty"), ("PATH", "/usr/local/bin:/usr/bin")]);
        let (remove, path) = plan(&odd);
        assert_eq!(remove, vec!["GHOSTTY_BIN".to_string()]);
        assert_eq!(path, None, "/usr/local/bin은 shim도 번들도 아니다");
    }
}
