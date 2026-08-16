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

#[cfg(test)]
mod tests {
    use super::*;

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
