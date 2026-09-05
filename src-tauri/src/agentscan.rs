// 세션 에이전트 감지 (셸 우선 모델) — Job 프로세스 트리에서 알려진 에이전트 CLI를 찾는다.
// 관측 전용: 사용자가 터미널에 직접 띄운 claude/codex 등을 이름으로만 식별해 관제에 표시한다.
// 이미지 이름이 인터프리터(node 등)면 명령줄을 읽어 패키지 토큰으로 판별한다 (npm 설치 CLI 대응).

/// 알려진 에이전트 CLI — (토큰, 표시 이름). 토큰은 실행 파일 이름과 명령줄 양쪽에 쓴다.
const KNOWN: [(&str, &str); 10] = [
    ("claude", "Claude"),
    ("codex", "Codex"),
    ("gemini", "Gemini"),
    ("copilot", "Copilot"),
    ("aider", "Aider"),
    ("opencode", "OpenCode"),
    ("goose", "Goose"),
    ("cursor-agent", "Cursor"),
    ("qwen", "Qwen"),
    ("amp", "Amp"),
];

/// 명령줄까지 읽어볼 인터프리터 — 이 이름 자체는 에이전트가 아니다
fn is_interpreter(name: &str) -> bool {
    name == "node" || name == "bun" || name == "deno" || name == "uv" || name == "uvx" || name.starts_with("python")
}

/// 경계 있는 토큰 검색 — "example"이 "amp"에 걸리지 않게 앞뒤가 영숫자가 아닐 때만 인정한다
fn has_token(hay: &str, token: &str) -> bool {
    let bytes = hay.as_bytes();
    let mut from = 0;
    while let Some(i) = hay[from..].find(token) {
        let start = from + i;
        let end = start + token.len();
        let pre = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
        let post = end == bytes.len() || !bytes[end].is_ascii_alphanumeric();
        if pre && post {
            return true;
        }
        from = start + 1;
    }
    false
}

/// pid 목록(Job 트리)에서 첫 번째로 발견한 에이전트의 표시 이름
pub fn detect(pids: &[u32]) -> Option<&'static str> {
    for &pid in pids {
        let name = crate::ports::process_name(pid).to_ascii_lowercase();
        if let Some((_, disp)) = KNOWN.iter().find(|(tok, _)| has_token(&name, tok)) {
            return Some(disp);
        }
        if is_interpreter(&name) {
            if let Some(cmd) = cmdline(pid) {
                let cmd = cmd.to_ascii_lowercase();
                if let Some((_, disp)) = KNOWN.iter().find(|(tok, _)| has_token(&cmd, tok)) {
                    return Some(disp);
                }
            }
        }
    }
    None
}

/// 다른 프로세스의 명령줄 — PEB의 RTL_USER_PROCESS_PARAMETERS.CommandLine을 읽는다.
/// x64 고정 오프셋(PEB+0x20 → Parameters, +0x70 → CommandLine)은 문서화된 안정 레이아웃이다.
/// 실패는 전부 None — 표시에만 쓰므로 정확한 척하지 않는다.
#[cfg(windows)]
fn cmdline(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
    };

    #[repr(C)]
    struct Pbi {
        exit_status: i32,
        peb_base: u64,
        affinity: u64,
        priority: i32,
        pid: u64,
        parent: u64,
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(
            h: *mut core::ffi::c_void,
            class: i32,
            info: *mut core::ffi::c_void,
            len: u32,
            ret: *mut u32,
        ) -> i32;
    }

    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
        if h.is_null() {
            return None;
        }
        let result = (|| {
            let mut pbi: Pbi = std::mem::zeroed();
            if NtQueryInformationProcess(
                h,
                0, // ProcessBasicInformation
                &mut pbi as *mut _ as *mut core::ffi::c_void,
                std::mem::size_of::<Pbi>() as u32,
                std::ptr::null_mut(),
            ) != 0
                || pbi.peb_base == 0
            {
                return None;
            }
            let read = |addr: u64, buf: *mut u8, len: usize| -> bool {
                let mut got = 0usize;
                ReadProcessMemory(h, addr as *const core::ffi::c_void, buf as *mut core::ffi::c_void, len, &mut got) != 0
                    && got == len
            };
            let mut params: u64 = 0;
            if !read(pbi.peb_base + 0x20, &mut params as *mut _ as *mut u8, 8) || params == 0 {
                return None;
            }
            #[repr(C)]
            struct UStr {
                len: u16,
                max: u16,
                _pad: u32,
                buf: u64,
            }
            let mut cl: UStr = std::mem::zeroed();
            if !read(params + 0x70, &mut cl as *mut _ as *mut u8, std::mem::size_of::<UStr>()) || cl.buf == 0 {
                return None;
            }
            let n = (cl.len as usize / 2).min(2048); // 표식 검색엔 4KB면 충분 — 폭주 방지 상한
            if n == 0 {
                return None;
            }
            let mut wide = vec![0u16; n];
            if !read(cl.buf, wide.as_mut_ptr() as *mut u8, n * 2) {
                return None;
            }
            Some(String::from_utf16_lossy(&wide))
        })();
        CloseHandle(h);
        result
    }
}

#[cfg(not(windows))]
fn cmdline(_pid: u32) -> Option<String> {
    None
}

/// PATH에 그 CLI가 있는가 — 세션 추가 진입점이 "설치된 것만" 내놓는 데 쓴다.
/// `where.exe`는 PATHEXT까지 훑으므로 npm이 깔아 두는 `codex.cmd` 같은 래퍼도 잡힌다.
/// 실행 가능 여부까지는 보지 않는다 — 없는 것을 권하지 않는 데까지가 이 확인의 몫이다.
pub fn on_path(name: &str) -> bool {
    if !is_cli_name(name) {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("where.exe")
            .arg(name)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — GUI 앱에서 콘솔 창 억제
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// CLI 에이전트 한 줄 — 설정 화면과 세션 추가 진입점이 같은 명부를 본다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCli {
    /// 실행 명령이자 감지 토큰 — 둘이 같은 문자열이라 "열 수 있는 것은 관제에도 잡힌다"
    pub cmd: &'static str,
    pub name: &'static str,
    pub installed: bool,
    /// EQMUX가 관리하는 스폰 경로가 있는가 — 역할 주입·훅·재개(agent.rs의 ClaudeCodeAdapter).
    /// 나머지는 셸에 명령을 치는 것과 같아서 관제에는 "실행 중"으로만 보인다.
    pub managed: bool,
}

/// 명부 실측 — KNOWN(감지 목록)을 그대로 쓴다. 여는 목록과 알아보는 목록이 어긋나면
/// "띄웠는데 관제에는 안 보인다"가 되므로 두 목록은 하나여야 한다.
pub fn roster() -> Vec<AgentCli> {
    KNOWN
        .iter()
        .map(|(cmd, name)| AgentCli {
            cmd,
            name,
            installed: on_path(cmd),
            managed: *cmd == "claude",
        })
        .collect()
}

/// 물어봐도 되는 이름인가 — 알려진 CLI 이름만 오는 자리라 영숫자·하이픈으로 좁힌다.
/// 프런트에서 오는 문자열이 그대로 프로세스 인자가 되므로 여기가 신뢰 경계다.
fn is_cli_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_name_guard() {
        assert!(is_cli_name("codex"));
        assert!(is_cli_name("cursor-agent"));
        assert!(!is_cli_name("")); // 빈 이름
        assert!(!is_cli_name("codex & calc")); // 셸 메타문자
        assert!(!is_cli_name(r"..\..\evil.exe")); // 경로 탈출
        assert!(!is_cli_name(&"a".repeat(33))); // 길이 상한
    }

    #[test]
    fn token_boundaries() {
        assert!(has_token("claude", "claude")); // 이미지 이름 그대로
        assert!(has_token("codex-x86_64-pc-windows-msvc", "codex")); // npm 네이티브 바이너리 접두
        assert!(has_token(r"node c:\npm\@anthropic-ai\claude-code\cli.js", "claude")); // npm CLI 명령줄
        assert!(!has_token("example", "amp")); // 영숫자 경계 — 부분 문자열 오탐 방지
        assert!(!has_token("powershell", "shell"));
        assert!(has_token(r"c:\tools\amp.exe --run", "amp"));
    }
}
