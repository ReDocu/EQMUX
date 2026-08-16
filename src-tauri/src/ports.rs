// 포트 패널 실측 (PRD H) — netstat 파싱으로 LISTENING TCP 소켓을 열거하고,
// 소유 pid를 세션의 Job Object pid 목록과 대조해 세션 포트를 가려낸다.
// 관측 전용 — 프로세스 종료는 제공하지 않는다 (git 패널과 같은 원칙).

use std::collections::HashMap;
use std::process::Command;

use serde::Serialize;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PortRow {
    pub port: u16,
    pub host: String,
    pub pid: u32,
    pub process: String,
    pub session: Option<String>, // 세션 귀속 (Job pid 일치)
}

/// pid → 실행 파일 이름 (확장자 제외). 실패는 "?" — 표시에만 쓴다.
/// 에이전트 감지(agentscan)도 같은 해석을 쓴다.
#[cfg(windows)]
pub(crate) fn process_name(pid: u32) -> String {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return "?".into();
        }
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        if ok == 0 {
            return "?".into();
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&full)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "?".into())
    }
}

#[cfg(not(windows))]
pub(crate) fn process_name(_pid: u32) -> String {
    "?".into()
}

/// `netstat -ano -p TCP`의 LISTENING 줄 파싱 —
/// "  TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    12345"
fn parse_netstat(out: &str) -> Vec<(String, u16, u32)> {
    let mut rows = Vec::new();
    for line in out.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || cols[0] != "TCP" || cols[3] != "LISTENING" {
            continue;
        }
        let Some((host, port)) = cols[1].rsplit_once(':') else { continue };
        let (Ok(port), Ok(pid)) = (port.parse::<u16>(), cols[4].parse::<u32>()) else {
            continue;
        };
        rows.push((host.to_string(), port, pid));
    }
    rows
}

/// 현재 LISTENING TCP 포트 스냅숏 + 세션 귀속.
/// session_pids: 세션 id → 그 세션 Job에 속한 pid들.
pub fn snapshot(session_pids: &HashMap<String, Vec<u32>>) -> Vec<PortRow> {
    let mut cmd = Command::new("netstat");
    cmd.args(["-ano", "-p", "TCP"]);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — GUI 앱에서 콘솔 창 억제
    let Ok(out) = cmd.output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut seen = std::collections::HashSet::new();
    let mut names: HashMap<u32, String> = HashMap::new();
    parse_netstat(&text)
        .into_iter()
        .filter(|(host, port, pid)| seen.insert((host.clone(), *port, *pid)))
        .map(|(host, port, pid)| {
            let process = names.entry(pid).or_insert_with(|| process_name(pid)).clone();
            let session = session_pids
                .iter()
                .find(|(_, pids)| pids.contains(&pid))
                .map(|(id, _)| id.clone());
            PortRow { port, host, pid, process, session }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_listening_lines_only() {
        let out = "\n  프로토콜  로컬 주소  외부 주소  상태  PID\n  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4321\n  TCP    [::1]:1420             [::]:0                 LISTENING       99\n  TCP    10.0.0.5:52000         142.250.0.1:443        ESTABLISHED     7\n  UDP    0.0.0.0:5353           *:*                                    8\n";
        let rows = parse_netstat(out);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], ("127.0.0.1".into(), 5173, 4321));
        assert_eq!(rows[1], ("[::1]".into(), 1420, 99));
    }
}
