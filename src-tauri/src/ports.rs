// 포트 패널 실측 (PRD H) — LISTENING TCP 소켓을 열거하고 (Windows 리스너 표 · macOS netstat -anv),
// 소유 pid를 세션의 Job Object pid 목록과 대조해 세션 포트를 가려낸다.
// 관측 전용 — 프로세스 종료는 제공하지 않는다 (git 패널과 같은 원칙).

use std::collections::HashMap;
#[cfg(not(windows))]
use std::process::Command;

use serde::Serialize;

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

#[cfg(target_os = "macos")]
pub(crate) fn process_name(pid: u32) -> String {
    crate::macproc::name(pid).unwrap_or_else(|| "?".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn process_name(_pid: u32) -> String {
    "?".into()
}

/// Windows 리스너 표 — iphlpapi `GetExtendedTcpTable(TCP_TABLE_OWNER_PID_LISTENER)`.
/// netstat을 쓰지 않는다: 어떤 Windows 빌드(11 26300에서 실측)는 TCP 표의 상태 칸에 엉뚱한 값을
/// 넣어서, netstat이 리스너를 CLOSED·FIN_WAIT_1로 찍거나 아예 빼 버린다. 리스너 표는 커널이
/// 상태 칸과 상관없이 리스너만 골라 주므로 상태 칸은 읽지 않는다. 표는 u32 칸으로 받는다.
#[cfg(windows)]
fn tcp_listener_table(af: u32) -> Vec<u32> {
    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetExtendedTcpTable(table: *mut u32, size: *mut u32, order: i32, af: u32, class: i32, reserved: u32) -> u32;
    }
    const TCP_TABLE_OWNER_PID_LISTENER: i32 = 3;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    let mut size = 0u32;
    for _ in 0..4 {
        // 크기를 물은 뒤 다시 부르는 사이에 표가 자랄 수 있다 — 그러면 새 크기로 한 번 더
        let mut buf = vec![0u32; size as usize / 4 + 1];
        size = (buf.len() * 4) as u32;
        match unsafe { GetExtendedTcpTable(buf.as_mut_ptr(), &mut size, 1, af, TCP_TABLE_OWNER_PID_LISTENER, 0) } {
            0 => return buf,
            ERROR_INSUFFICIENT_BUFFER => continue,
            _ => break,
        }
    }
    Vec::new()
}

/// 리스너 표 파싱 (순수 함수) — 머리 1칸(행 수) 뒤에 행이 이어진다. 주소·포트는 네트워크 바이트 순서다.
/// IPv4 행(6칸): state, addr, port, raddr, rport, pid
/// IPv6 행(14칸): addr×4, scope, port, raddr×4, rscope, rport, state, pid
/// 표기는 netstat과 같다 — 0.0.0.0 · 127.0.0.1 · [::] · [::1].
/// ponytail: IPv6 scope id(`%12`)는 붙이지 않는다 — 링크 로컬 리스너를 [열기]로 열 일이 생기면 붙이기
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_tcp_table(buf: &[u32], v6: bool) -> Vec<(String, u16, u32)> {
    let Some((&n, rows)) = buf.split_first() else { return Vec::new() };
    let port = |w: u32| {
        let b = w.to_ne_bytes();
        u16::from_be_bytes([b[0], b[1]])
    };
    rows.chunks_exact(if v6 { 14 } else { 6 })
        .take(n as usize)
        .map(|r| {
            if v6 {
                let mut ip = [0u8; 16];
                for (i, w) in r[..4].iter().enumerate() {
                    ip[i * 4..i * 4 + 4].copy_from_slice(&w.to_ne_bytes());
                }
                (format!("[{}]", std::net::Ipv6Addr::from(ip)), port(r[5]), r[13])
            } else {
                (std::net::Ipv4Addr::from(r[1].to_ne_bytes()).to_string(), port(r[2]), r[5])
            }
        })
        .collect()
}

/// macOS `netstat -anv -p tcp`의 LISTEN 줄 파싱 —
/// "tcp46  0  0  *.3000  *.*  LISTEN  0  0  131072  131072  4321  0 …" (11번째 열이 pid).
/// lsof는 자기 소유 프로세스 소켓만 내고(B144), 포크한 워커마다 같은 소켓을 따로 내며(B143),
/// IPv4·IPv6 와일드카드를 둘 다 `*`로 낸다(B142). netstat은 소켓마다 한 줄, 다른 사용자 소켓까지,
/// tcp4·tcp6·tcp46을 갈라 준다. 주소와 포트는 마지막 `.`으로 나뉜다 (`::1.5173`).
/// ponytail: 긴 IPv6 주소는 열 폭에 잘려 나온다(`fe80::aede:48ff:.49167`) — 노출 판정은 맞지만 표시는 잘린 채다
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_netstat_mac(out: &str) -> Vec<(String, u16, u32)> {
    let mut rows = Vec::new();
    for line in out.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 11 || !cols[0].starts_with("tcp") || cols[5] != "LISTEN" {
            continue;
        }
        let Some((addr, port)) = cols[3].rsplit_once('.') else { continue };
        let (Ok(port), Ok(pid)) = (port.parse::<u16>(), cols[10].parse::<u32>()) else {
            continue;
        };
        rows.push((mac_host(cols[0], addr), port, pid));
    }
    rows
}

/// netstat(Windows) 표기에 맞춘다 — IPv4 와일드카드는 0.0.0.0, IPv6는 대괄호.
/// tcp46(듀얼 스택)도 [::]다 — [::1]로 열면 IPv4 전용이 아닌 한 둘 다 받는다 (B142)
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn mac_host(proto: &str, addr: &str) -> String {
    let v6 = proto != "tcp4";
    match (addr, v6) {
        ("*", false) => "0.0.0.0".into(),
        ("*", true) => "[::]".into(),
        (a, true) if !a.starts_with('[') => format!("[{a}]"),
        (a, _) => a.to_string(),
    }
}

/// lsof `-F` 필드 출력 — netstat이 없을 때의 대체 경로다.
/// "p12345" 줄이 프로세스를 열고, "t"가 IPv4/IPv6를, 이어지는 "n…" 줄이 그 소켓을 말한다.
/// 와일드카드 `*`는 t로 갈라 0.0.0.0·[::]로 낸다 (B142)
#[cfg_attr(windows, allow(dead_code))]
fn parse_lsof(out: &str) -> Vec<(String, u16, u32)> {
    let mut rows = Vec::new();
    let mut pid = None;
    let mut v6 = false;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse::<u32>().ok();
        } else if line.starts_with('f') {
            v6 = false; // 새 fd — 이전 fd의 t가 새지 않게
        } else if let Some(t) = line.strip_prefix('t') {
            v6 = t == "IPv6";
        } else if let (Some(n), Some(pid)) = (line.strip_prefix('n'), pid) {
            let Some((host, port)) = n.rsplit_once(':') else { continue };
            let Ok(port) = port.parse::<u16>() else { continue };
            let host = match (host, v6) {
                ("*", false) => "0.0.0.0".to_string(),
                ("*", true) => "[::]".to_string(),
                (h, _) => h.to_string(),
            };
            rows.push((host, port, pid));
        }
    }
    rows
}

/// LISTENING TCP 소켓 (host, port, pid) — Windows는 리스너 표(IPv4·IPv6), macOS는 netstat -anv (없으면 lsof)
fn listening() -> Vec<(String, u16, u32)> {
    #[cfg(windows)]
    {
        const AF_INET: u32 = 2;
        const AF_INET6: u32 = 23;
        let mut rows = parse_tcp_table(&tcp_listener_table(AF_INET), false);
        rows.extend(parse_tcp_table(&tcp_listener_table(AF_INET6), true));
        rows
    }
    #[cfg(not(windows))]
    {
        // netstat은 커널 표를 읽을 뿐이라 파일 stat에 막히지 않는다 — lsof는 응답 없는 마운트에서 멈춘다 (B123)
        if let Ok(out) = Command::new("netstat").args(["-anv", "-p", "tcp"]).output() {
            if out.status.success() {
                return parse_netstat_mac(&String::from_utf8_lossy(&out.stdout));
            }
        }
        // -b·-w: 막히는 커널 호출을 피하고 그 경고는 끈다 (B123)
        let Ok(out) = Command::new("lsof").args(["-b", "-w", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpnt"]).output() else {
            return Vec::new();
        };
        parse_lsof(&String::from_utf8_lossy(&out.stdout))
    }
}

/// 같은 소켓(host, port)을 쥔 pid가 여럿이면 하나로 접는다 (B143) — pre-fork 서버의 워커가
/// 리슨 소켓을 물려받으면 lsof는 워커마다 한 줄을 낸다. 부모가 같은 묶음 안에 없는 pid(최상위)를
/// 대표로 남기고, 없으면 가장 작은 pid다. 묶음 전체도 돌려준다 — 세션 귀속은 그중 하나만 맞아도 된다.
/// 순수 함수 — ppid는 호출부가 넘긴다
#[cfg_attr(windows, allow(dead_code))]
fn fold_forks(rows: Vec<(String, u16, u32)>, ppid: impl Fn(u32) -> Option<u32>) -> Vec<(String, u16, u32, Vec<u32>)> {
    let mut groups: Vec<(String, u16, Vec<u32>)> = Vec::new();
    for (host, port, pid) in rows {
        match groups.iter_mut().find(|(h, p, _)| *h == host && *p == port) {
            Some((_, _, pids)) if !pids.contains(&pid) => pids.push(pid),
            Some(_) => {}
            None => groups.push((host, port, vec![pid])),
        }
    }
    groups
        .into_iter()
        .map(|(host, port, pids)| {
            let top = pids
                .iter()
                .copied()
                .filter(|&p| ppid(p).is_none_or(|pp| !pids.contains(&pp)))
                .min()
                .unwrap_or_else(|| pids.iter().copied().min().unwrap_or(0));
            (host, port, top, pids)
        })
        .collect()
}

/// libproc가 못 읽는 다른 사용자 프로세스(root 데몬 등)의 이름 — `ps`는 사용자를 가리지 않는다 (B144).
/// 한 번에 묶어 묻는다. 실패하면 비어 있고, 표시는 "?"로 남는다
#[cfg(target_os = "macos")]
fn ps_names(pids: &[u32]) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    if pids.is_empty() {
        return map;
    }
    let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let Ok(out) = Command::new("ps").args(["-o", "pid=,comm=", "-p", &list]).output() else { return map };
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let line = line.trim();
        let Some((pid, comm)) = line.split_once(char::is_whitespace) else { continue };
        let Ok(pid) = pid.parse::<u32>() else { continue };
        let name = comm.trim().rsplit('/').next().unwrap_or("").to_string();
        if !name.is_empty() {
            map.insert(pid, name);
        }
    }
    map
}

/// 현재 LISTENING TCP 포트 스냅숏 + 세션 귀속.
/// session_pids: 세션 id → 그 세션 Job에 속한 pid들.
pub fn snapshot(session_pids: &HashMap<String, Vec<u32>>) -> Vec<PortRow> {
    // Windows 리스너 표는 소켓을 연 pid 하나만 낸다 — 접을 것이 없으니 그대로 둔다
    #[cfg(windows)]
    let rows: Vec<_> = listening().into_iter().map(|(h, p, pid)| (h, p, pid, vec![pid])).collect();
    #[cfg(target_os = "macos")]
    let rows = fold_forks(listening(), |p| crate::macproc::info(p).map(|i| i.ppid));
    #[cfg(not(any(windows, target_os = "macos")))]
    let rows = fold_forks(listening(), |_| None);

    let mut names: HashMap<u32, String> = HashMap::new();
    for (_, _, pid, _) in &rows {
        names.entry(*pid).or_insert_with(|| process_name(*pid));
    }
    #[cfg(target_os = "macos")]
    {
        let unknown: Vec<u32> = names.iter().filter(|(_, n)| n.as_str() == "?").map(|(p, _)| *p).collect();
        names.extend(ps_names(&unknown));
    }
    let mut seen = std::collections::HashSet::new();
    rows.into_iter()
        .filter(|(host, port, pid, _)| seen.insert((host.clone(), *port, *pid)))
        .map(|(host, port, pid, group)| {
            let process = names.get(&pid).cloned().unwrap_or_else(|| "?".into());
            let session = session_pids
                .iter()
                .find(|(_, pids)| group.iter().any(|g| pids.contains(g)))
                .map(|(id, _)| id.clone());
            PortRow { port, host, pid, process, session }
        })
        .collect()
}

// ── 세션별 포트 범위 (§4) — 병렬 세션의 dev 서버가 같은 포트를 두고 부딪히지 않게 ──
// 세션마다 RANGE_SIZE칸 블록을 준다: RANGE_BASE + RANGE_SIZE × 슬롯. 슬롯은 살아 있는 세션 중
// 비어 있는 가장 작은 번호다. 포트는 머신 전역이라 워크스페이스를 가리지 않는다. 메모리에만 둔다 —
// 앱을 다시 켜면 PTY도 새로 뜨므로 그때 다시 받는다. 범위는 환경변수로 알릴 뿐 강제하지 않는다.
// ponytail: 42000대 고정 — 다른 프로그램이 그 대역을 쓰면 설정으로 꺼내기

pub const RANGE_BASE: u16 = 42000;
pub const RANGE_SIZE: u16 = 10;
const RANGE_SLOTS: u16 = 100;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortRange {
    pub session: String,
    pub base: u16,
    pub end: u16, // 포함
}

static RANGES: std::sync::Mutex<Vec<(String, u16)>> = std::sync::Mutex::new(Vec::new());

/// 쓰는 슬롯 → 비어 있는 가장 작은 슬롯 (순수 함수)
fn lowest_free(used: &[u16]) -> Option<u16> {
    (0..RANGE_SLOTS).find(|s| !used.contains(s))
}

fn range_of(session: &str, slot: u16) -> PortRange {
    let base = RANGE_BASE + RANGE_SIZE * slot;
    PortRange { session: session.to_string(), base, end: base + RANGE_SIZE - 1 }
}

/// 세션 스폰 때 — 이미 받았으면 같은 범위를 돌려준다(재스폰). 슬롯이 다 찼으면 None
pub fn assign_range(session: &str) -> Option<PortRange> {
    let mut map = RANGES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, slot)) = map.iter().find(|(s, _)| s == session) {
        return Some(range_of(session, *slot));
    }
    let used: Vec<u16> = map.iter().map(|(_, slot)| *slot).collect();
    let slot = lowest_free(&used)?;
    map.push((session.to_string(), slot));
    Some(range_of(session, slot))
}

/// PTY 종료 때 — 슬롯을 돌려준다
pub fn release_range(session: &str) {
    RANGES.lock().unwrap_or_else(|e| e.into_inner()).retain(|(s, _)| s != session);
}

/// 지금 나눠 준 범위 — 서버 탭 표시용
pub fn ranges() -> Vec<PortRange> {
    let map = RANGES.lock().unwrap_or_else(|e| e.into_inner());
    let mut v: Vec<PortRange> = map.iter().map(|(s, slot)| range_of(s, *slot)).collect();
    v.sort_by_key(|r| r.base);
    v
}

/// 서버 탭 표시 — 지금 나눠 준 세션 포트 범위
#[tauri::command]
pub fn port_ranges() -> Vec<PortRange> {
    ranges()
}

/// 스폰 빌더에 심을 환경변수 — `PORT`는 넣지 않는다: dotenv는 있는 환경변수를 덮지 않으므로
/// 심으면 사용자가 .env에 적은 PORT가 조용히 무시된다
pub fn range_env(r: &PortRange) -> [(&'static str, String); 2] {
    [("EQMUX_PORT_BASE", r.base.to_string()), ("EQMUX_PORT_END", r.end.to_string())]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 귀속 사슬 통합 테스트 (M31) — 세션이 연 포트가 정말 그 세션으로 잡히는가.
    /// GUI 없이 실제 사슬을 그대로 탄다: Job 생성 → assign_pid → 진짜 리슨 프로세스 →
    /// Job::pids() → 리스너 표 → 귀속 조인. "포트 패널에 뜬다"의 백엔드 절반이 이것이다.
    /// node가 없으면 조용히 건너뛴다 — 이 테스트의 주제는 node가 아니다.
    #[cfg(windows)]
    #[test]
    fn attributes_a_port_opened_inside_a_session_job() {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        const PORT: u16 = 47823; // 등록된 서비스가 없는 대역

        let Some(job) = crate::job::Job::new_kill_on_close() else {
            eprintln!("Job Object를 만들 수 없다 — 건너뜀");
            return;
        };
        let spawned = Command::new("node")
            .args(["-e", &format!("require('http').createServer().listen({PORT},'127.0.0.1')")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn();
        let Ok(mut child) = spawned else {
            eprintln!("node를 실행할 수 없다 — 건너뜀");
            return;
        };
        // 잡에 편입 — 실패하면 귀속이 성립할 수 없으므로 그대로 실패시킨다
        assert!(job.assign_pid(child.id()), "assign_pid 실패 — 세션 트리를 잡으로 묶지 못했다");

        // 리슨이 올라올 때까지 기다린다 (프로세스 기동 + 바인딩)
        let mut attributed = None;
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let pids = job.pids();
            assert!(!pids.is_empty(), "Job::pids()가 비었다 — 귀속이 통째로 무너지는 경로");
            let map = HashMap::from([("sess-1".to_string(), pids)]);
            if let Some(row) = snapshot(&map).into_iter().find(|r| r.port == PORT) {
                attributed = Some(row);
                break;
            }
        }

        let row = attributed.expect("47823 LISTENING을 리스너 표에서 찾지 못했다");
        assert_eq!(row.session.as_deref(), Some("sess-1"), "세션에 귀속되지 않았다");
        assert_eq!(row.pid, child.id());
        assert_eq!(row.process, "node");
        assert_eq!(row.host, "127.0.0.1");

        let _ = child.kill();
        let _ = child.wait();
    }

    /// 포트 범위 (§4) — 빈 가장 작은 슬롯 · 재스폰은 같은 범위 · 놓으면 다시 쓴다
    #[test]
    fn assigns_lowest_free_port_range() {
        assert_eq!(lowest_free(&[]), Some(0));
        assert_eq!(lowest_free(&[0, 1, 3]), Some(2));
        assert_eq!(lowest_free(&(0..RANGE_SLOTS).collect::<Vec<_>>()), None);

        // 전역 표를 다른 테스트와 나누지 않게 이 테스트만의 이름을 쓴다
        let a = assign_range("t-range-a").unwrap();
        let b = assign_range("t-range-b").unwrap();
        assert_ne!(a.base, b.base);
        assert_eq!(a.end, a.base + RANGE_SIZE - 1);
        assert_eq!(assign_range("t-range-a").unwrap(), a, "재스폰은 같은 범위");
        release_range("t-range-a");
        assert!(!ranges().iter().any(|r| r.session == "t-range-a"));
        let c = assign_range("t-range-c").unwrap();
        assert_eq!(c.base, a.base, "놓은 슬롯을 다시 쓴다");
        assert_eq!(range_env(&c)[0], ("EQMUX_PORT_BASE", c.base.to_string()));
        release_range("t-range-b");
        release_range("t-range-c");
    }

    /// 리스너 표 — 메모리 그대로의 바이트(네트워크 순서)를 netstat 표기로 읽고, 상태 칸은 보지 않으며,
    /// 행 수를 넘는 꼬리(버퍼 여유분)는 버린다
    #[test]
    fn parses_tcp_listener_table() {
        let w = u32::from_ne_bytes;
        let port = |p: u16| w([(p >> 8) as u8, p as u8, 0, 0]);
        let v4 = [
            2,
            99, w([127, 0, 0, 1]), port(5173), 0, 0, 4321, // 상태 칸이 엉뚱해도(99) 그대로 리스너다
            0, w([0, 0, 0, 0]), port(445), 0, 0, 4,
            0, 0, 0, 0, 0, 0, // 행 수 밖
        ];
        assert_eq!(
            parse_tcp_table(&v4, false),
            vec![("127.0.0.1".into(), 5173, 4321), ("0.0.0.0".into(), 445, 4)]
        );
        let lo = [0, 0, 0, w([0, 0, 0, 1])];
        let v6 = [
            2,
            lo[0], lo[1], lo[2], lo[3], 0, port(1420), 0, 0, 0, 0, 0, 0, 0, 99,
            0, 0, 0, 0, 0, port(47902), 0, 0, 0, 0, 0, 0, 0, 7,
        ];
        assert_eq!(
            parse_tcp_table(&v6, true),
            vec![("[::1]".into(), 1420, 99), ("[::]".into(), 47902, 7)]
        );
        assert!(parse_tcp_table(&[], false).is_empty());
    }

    /// lsof 필드 출력 — pid 줄 아래의 소켓 줄들이 그 pid로 귀속되고, 표기는 netstat과 같다
    #[test]
    fn parses_lsof_fields() {
        let out = "p4321\nf3\ntIPv4\nn127.0.0.1:5173\nf4\ntIPv6\nn[::1]:5173\np99\nf3\ntIPv4\nn*:3000\n";
        let rows = parse_lsof(out);
        assert_eq!(
            rows,
            vec![
                ("127.0.0.1".into(), 5173, 4321),
                ("[::1]".into(), 5173, 4321),
                ("0.0.0.0".into(), 3000, 99),
            ]
        );
    }

    /// lsof는 IPv4·IPv6 와일드카드를 둘 다 `*`로 낸다 — t 필드로 갈라야 [::] 전용 서버를 [::1]로 연다 (B142)
    #[test]
    fn lsof_splits_v4_and_v6_wildcards() {
        let out = "p7\nf3\ntIPv6\nn*:47902\nf4\ntIPv4\nn*:47903\nf5\nn*:47904\n";
        assert_eq!(
            parse_lsof(out),
            vec![("[::]".into(), 47902, 7), ("0.0.0.0".into(), 47903, 7), ("0.0.0.0".into(), 47904, 7)],
            "t가 없는 fd는 앞 fd의 t를 물려받지 않는다"
        );
    }

    /// macOS netstat -anv — tcp4·tcp6·tcp46을 가르고, 11번째 열이 pid다. LISTEN 아닌 줄은 버린다
    #[test]
    fn parses_mac_netstat() {
        let out = "Active Internet connections (including servers)\n\
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)          rxbytes      txbytes  rhiwat  shiwat    pid   epid\n\
tcp4       0      0  127.0.0.1.47906        *.*                    LISTEN                 0            0  131072  131072  24776      0\n\
tcp6       0      0  ::1.47905              *.*                    LISTEN                 0            0  131072  131072  24776      0\n\
tcp46      0      0  *.47904                *.*                    LISTEN                 0            0  131072  131072  24776      0\n\
tcp4       0      0  *.47903                *.*                    LISTEN                 0            0  131072  131072  24776      0\n\
tcp6       0      0  *.47902                *.*                    LISTEN                 0            0  131072  131072    107      0\n\
tcp4       0      0  192.168.0.40.49942     160.79.104.10.443      ESTABLISHED         9766        64988  131072  131768   1537      0\n";
        assert_eq!(
            parse_netstat_mac(out),
            vec![
                ("127.0.0.1".into(), 47906, 24776),
                ("[::1]".into(), 47905, 24776),
                ("[::]".into(), 47904, 24776),
                ("0.0.0.0".into(), 47903, 24776),
                ("[::]".into(), 47902, 107),
            ]
        );
    }

    /// pre-fork 워커 — 같은 소켓을 쥔 pid 넷이 한 줄로 접히고, 대표는 부모다 (B143)
    #[test]
    fn folds_forked_workers_to_parent() {
        let rows = vec![
            ("127.0.0.1".to_string(), 47901, 12),
            ("127.0.0.1".to_string(), 47901, 10),
            ("127.0.0.1".to_string(), 47901, 11),
            ("127.0.0.1".to_string(), 47901, 13),
            ("0.0.0.0".to_string(), 8080, 50),
        ];
        let ppid = |p: u32| match p {
            11..=13 => Some(10),
            10 => Some(1),
            _ => None,
        };
        let out = fold_forks(rows, ppid);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].0.as_str(), out[0].1, out[0].2), ("127.0.0.1", 47901, 10));
        assert_eq!(out[0].3, vec![12, 10, 11, 13], "묶음 전체가 남아야 세션 귀속을 살린다");
        assert_eq!((out[1].2, out[1].3.clone()), (50, vec![50]));
    }

    /// 부모를 못 읽으면(다른 사용자·이미 끝남) 가장 작은 pid가 대표다
    #[test]
    fn folds_forks_without_parent_info() {
        let rows = vec![("[::]".to_string(), 3000, 30), ("[::]".to_string(), 3000, 20)];
        assert_eq!(fold_forks(rows, |_| None)[0].2, 20);
    }

    /// 실측 사슬 (macOS) — 이 프로세스가 연 IPv4·IPv6 와일드카드와 루프백이 각자의 표기로,
    /// 이 프로세스 pid로 잡힌다. "외부 노출"과 [열기] 주소가 이 표기에 기대고 있다 (B139·B142)
    #[cfg(target_os = "macos")]
    #[test]
    fn snapshot_sees_own_wildcard_and_loopback_sockets() {
        use std::net::TcpListener;
        let v4 = TcpListener::bind("0.0.0.0:0").unwrap();
        let lo = TcpListener::bind("127.0.0.1:0").unwrap();
        let Ok(v6) = TcpListener::bind("[::]:0") else {
            eprintln!("IPv6를 열 수 없다 — 건너뜀");
            return;
        };
        let me = std::process::id();
        let rows = snapshot(&HashMap::from([("s1".to_string(), vec![me])]));
        let find = |port: u16| rows.iter().find(|r| r.port == port && r.pid == me);
        let (p4, plo, p6) = (v4.local_addr().unwrap().port(), lo.local_addr().unwrap().port(), v6.local_addr().unwrap().port());
        assert_eq!(find(p4).map(|r| r.host.as_str()), Some("0.0.0.0"));
        assert_eq!(find(plo).map(|r| r.host.as_str()), Some("127.0.0.1"));
        assert_eq!(find(p6).map(|r| r.host.as_str()), Some("[::]"));
        assert_eq!(find(p4).and_then(|r| r.session.as_deref()), Some("s1"));
        assert_ne!(find(p4).map(|r| r.process.as_str()), Some("?"));
    }
}
