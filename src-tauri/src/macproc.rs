// macOS 프로세스 조회 — Windows의 ToolHelp 스냅숏·PEB 읽기·이미지 이름 자리를 libproc·sysctl로 메운다.
// 세션 트리(job.rs)·포트 귀속(ports.rs)·에이전트 감지(agentscan.rs)가 같은 원천을 쓴다.
// 실패는 전부 None/빈 목록 — 표시·관측에만 쓰므로 정확한 척하지 않는다.

use std::ffi::{c_int, c_void, CStr};

/// 프로세스 한 줄 — (pid, 부모 pid, 제어 터미널 장치, 시작 시각 µs)
#[derive(Clone, Copy)]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: u32,
    pub tdev: u32,
    pub start: u64,
}

fn bsdinfo(pid: u32) -> Option<libc::proc_bsdinfo> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as c_int;
    let got = unsafe {
        libc::proc_pidinfo(pid as c_int, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut c_void, size)
    };
    (got == size).then_some(info)
}

pub fn info(pid: u32) -> Option<ProcInfo> {
    let b = bsdinfo(pid)?;
    Some(ProcInfo {
        pid,
        ppid: b.pbi_ppid,
        tdev: b.e_tdev,
        start: b.pbi_start_tvsec * 1_000_000 + b.pbi_start_tvusec,
    })
}

/// 시스템 전체 프로세스 — 스냅숏 한 번. 남의 사용자 프로세스는 정보를 못 읽어 빠진다 (관측 대상이 아니다)
pub fn all() -> Vec<ProcInfo> {
    let n = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if n <= 0 {
        return Vec::new();
    }
    // 그 사이 늘어난 프로세스 몫으로 여유를 둔다
    let mut pids = vec![0 as c_int; n as usize + 64];
    let bytes = (pids.len() * std::mem::size_of::<c_int>()) as c_int;
    let got = unsafe { libc::proc_listallpids(pids.as_mut_ptr() as *mut c_void, bytes) };
    if got <= 0 {
        return Vec::new();
    }
    pids.truncate(got as usize);
    pids.into_iter().filter(|&p| p > 0).filter_map(|p| info(p as u32)).collect()
}

/// 상주 메모리 (바이트)
pub fn resident_bytes(pid: u32) -> Option<u64> {
    let mut t: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_taskinfo>() as c_int;
    let got = unsafe {
        libc::proc_pidinfo(pid as c_int, libc::PROC_PIDTASKINFO, 0, &mut t as *mut _ as *mut c_void, size)
    };
    (got == size).then_some(t.pti_resident_size)
}

/// 실행 경로와 argv — sysctl KERN_PROCARGS2. 배치: argc(int) · 실행 경로 · NUL 채움 · argv… · 환경…
pub fn procargs(pid: u32) -> Option<(String, Vec<String>)> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as c_int];
    let mut size: libc::size_t = 0;
    let ok = unsafe { libc::sysctl(mib.as_mut_ptr(), 3, std::ptr::null_mut(), &mut size, std::ptr::null_mut(), 0) };
    if ok != 0 || size < 4 {
        return None;
    }
    let mut buf = vec![0u8; size];
    let ok = unsafe {
        libc::sysctl(mib.as_mut_ptr(), 3, buf.as_mut_ptr() as *mut c_void, &mut size, std::ptr::null_mut(), 0)
    };
    if ok != 0 || size < 4 {
        return None;
    }
    buf.truncate(size);
    let argc = i32::from_ne_bytes(buf[..4].try_into().ok()?).max(0) as usize;
    let mut rest = &buf[4..];
    let exe_end = rest.iter().position(|&b| b == 0)?;
    let exe = String::from_utf8_lossy(&rest[..exe_end]).into_owned();
    rest = &rest[exe_end..];
    let skip = rest.iter().position(|&b| b != 0).unwrap_or(rest.len());
    rest = &rest[skip..];
    let argv = rest
        .split(|&b| b == 0)
        .take(argc)
        .map(|a| String::from_utf8_lossy(a).into_owned())
        .collect();
    Some((exe, argv))
}

/// 표시 이름 — argv[0]의 파일 이름을 먼저 본다. Claude 네이티브 설치는 `claude` 심볼릭 링크가
/// 버전 이름 파일(`…/versions/2.1.3`)을 가리켜서, 실행 파일 이름만 보면 claude로 알아볼 수 없다
pub fn name(pid: u32) -> Option<String> {
    let base = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    if let Some((exe, argv)) = procargs(pid) {
        if let Some(a0) = argv.first().filter(|a| !a.is_empty()) {
            return Some(base(a0.trim_start_matches('-'))); // 로그인 셸은 `-zsh`로 뜬다
        }
        if !exe.is_empty() {
            return Some(base(&exe));
        }
    }
    let mut buf = [0u8; 64];
    let n = unsafe { libc::proc_name(pid as c_int, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
    (n > 0).then(|| CStr::from_bytes_until_nul(&buf).ok().map(|s| s.to_string_lossy().into_owned())).flatten()
}

#[cfg(test)]
mod tests {
    /// 심볼릭 링크로 띄운 실행 파일은 링크 이름으로 보인다 (claude → versions/2.x 와 같은 모양)
    #[test]
    fn name_and_args_follow_argv() {
        let dir = std::env::temp_dir().join(format!("eqmux-macproc-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let link = dir.join("claude");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink("/bin/sleep", &link).unwrap();
        let mut child = std::process::Command::new(&link).arg("5").spawn().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let name = super::name(child.id());
        let args = super::procargs(child.id()).map(|(_, a)| a);
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(name.as_deref(), Some("claude"));
        assert_eq!(args.and_then(|a| a.last().cloned()).as_deref(), Some("5"));
    }
}
