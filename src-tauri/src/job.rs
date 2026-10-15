// 세션별 Job Object (FR-C-05) — 자식 프로세스 트리 전체를 하나의 잡으로 묶는다.
// KILL_ON_JOB_CLOSE라서 마지막 핸들이 닫히면(= PtySession drop) OS가 트리를 정리한다 —
// 앱이 크래시해도 고아 프로세스가 남지 않는다. 명시적 종료는 terminate()로 즉시 수행한다.
// C11(메모리 계측)도 이 핸들을 재사용할 예정이다 (FR-C-09).

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicProcessIdList,
        JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA,
        PROCESS_TERMINATE,
    };

    pub struct Job(HANDLE);

    // HANDLE은 스레드 간 이동이 안전하다 (커널 오브젝트 참조)
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        /// 잡 생성 + KILL_ON_JOB_CLOSE. 실패하면 None — 세션은 잡 없이도 동작한다 (다운그레이드).
        pub fn new_kill_on_close() -> Option<Job> {
            unsafe {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    h,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    CloseHandle(h);
                    return None;
                }
                Some(Job(h))
            }
        }

        /// 프로세스(pid)를 잡에 편입 — 이후 생기는 자식들도 같은 잡에 속한다
        pub fn assign_pid(&self, pid: u32) -> bool {
            unsafe {
                let ph = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if ph.is_null() {
                    return false;
                }
                let ok = AssignProcessToJobObject(self.0, ph) != 0;
                CloseHandle(ph);
                ok
            }
        }

        /// 트리 즉시 종료 — kill 경로에서 명시적으로 부른다 (drop만 기다리지 않는다)
        /// 잡을 벗어난 자손(escaped)도 함께 끝낸다 — 잡이 죽으면 부모 연결을 더는 찾을 수 없으므로
        /// 먼저 모아 두고, 잡 종료(지금과 같은 순서) 뒤에 하나씩 끝낸다
        pub fn terminate(&self) {
            let escaped = self.escaped();
            unsafe {
                TerminateJobObject(self.0, 1);
                for pid in escaped {
                    let ph = OpenProcess(PROCESS_TERMINATE, 0, pid);
                    if !ph.is_null() {
                        TerminateProcess(ph, 1);
                        CloseHandle(ph);
                    }
                }
            }
        }

        /// 잡 pid + 잡을 벗어난 자손 (super::tree_pids). 조상 잡이 breakaway를 허용하는 환경
        /// (예: 개발 셸 안에서 띄운 EQMUX)에서는 pwsh가 띄운 자식이 세션 잡 밖으로 나간다 —
        /// 손으로 띄운 claude가 감지·포트·메모리·종료에서 통째로 빠지던 자리다.
        /// 잡 안에만 있는 세션은 pids()와 같은 목록이다
        pub fn tree_pids(&self) -> Vec<u32> {
            super::tree_pids(&self.pids(), &process_table(), start_time)
        }

        /// 잡을 벗어난 자손만
        pub fn escaped(&self) -> Vec<u32> {
            let job = self.pids();
            super::tree_pids(&job, &process_table(), start_time).split_off(job.len())
        }

        /// 잡에 속한 pid 목록 — 포트 귀속(H)·에이전트 감지·메모리 합산이 같은 원천을 쓴다.
        ///
        /// 버퍼는 늘려 가며 묻는다. 고정 크기로 두면 프로세스가 그보다 많은 잡에서
        /// QueryInformationJobObject가 ERROR_MORE_DATA로 실패하고 목록이 통째로 비는데,
        /// 그러면 그 세션이 연 포트가 전부 "시스템 포트"로 떨어져 포트 패널에서 사라진다.
        /// 실패해도 assigned는 채워 주므로 보통 두 번째 시도에서 끝난다.
        pub fn pids(&self) -> Vec<u32> {
            // JOBOBJECT_BASIC_PROCESS_ID_LIST — DWORD 둘 뒤에 ULONG_PTR 배열.
            // 배열 오프셋은 x86·x64 모두 8이다 (x86은 정렬 4로 딱 맞고, x64는 정렬 8로 채워진다).
            const HEADER: usize = 8;
            // usize 벡터로 잡는다 — 커널이 ULONG_PTR을 쓰므로 정렬이 보장돼야 한다 (u8 벡터는 정렬 1)
            let words = HEADER / std::mem::size_of::<usize>();
            let mut cap = 128usize; // 대부분의 세션은 여기서 끝난다
            for _ in 0..4 {
                let mut buf: Vec<usize> = vec![0; words + cap];
                let bytes = (words + cap) * std::mem::size_of::<usize>();
                unsafe {
                    let ok = QueryInformationJobObject(
                        self.0,
                        JobObjectBasicProcessIdList,
                        buf.as_mut_ptr() as *mut std::ffi::c_void,
                        bytes as u32,
                        std::ptr::null_mut(),
                    ) != 0;
                    let head = buf.as_ptr() as *const u32;
                    let assigned = *head as usize;
                    let in_list = *head.add(1) as usize;
                    if !ok {
                        // 모자랐다 — 실측 assigned가 있으면 그만큼, 없으면 두 배로 다시 묻는다
                        cap = if assigned > cap { assigned } else { cap * 2 } + 8;
                        continue;
                    }
                    return (0..in_list.min(cap)).map(|i| buf[words + i] as u32).collect();
                }
            }
            Vec::new()
        }

        /// 프로세스 트리 메모리 (FR-C-09 · C11) — (현재 워킹셋 합, 잡 피크 커밋).
        /// 실패는 None — 호출부가 "측정 불가"로 보고한다. 정확한 척하지 않는다.
        pub fn memory_bytes(&self) -> Option<(u64, u64)> {
            unsafe {
                // 피크 — 잡 계정 정보
                let mut ext: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                if QueryInformationJobObject(
                    self.0,
                    JobObjectExtendedLimitInformation,
                    &mut ext as *mut _ as *mut std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    std::ptr::null_mut(),
                ) == 0
                {
                    return None;
                }
                let peak = ext.PeakJobMemoryUsed as u64;

                // 현재 — 잡 소속 + 잡을 벗어난 자손의 워킹셋 합산. 목록은 중복이 없다 (tree_pids)
                let mut total = 0u64;
                for pid in self.tree_pids() {
                    let ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if ph.is_null() {
                        continue; // 이미 종료된 pid 등 — 합산에서 제외
                    }
                    let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
                    c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                    if K32GetProcessMemoryInfo(ph, &mut c, c.cb) != 0 {
                        total += c.WorkingSetSize as u64;
                    }
                    CloseHandle(ph);
                }
                Some((total, peak))
            }
        }
    }

    /// 시스템 전체 (pid, 부모 pid) — 스냅숏 한 번. 실패하면 빈 목록 (= 잡 pid만 쓴다)
    fn process_table() -> Vec<(u32, u32)> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap.is_null() || snap as isize == -1 {
                return out;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e) != 0;
            while ok {
                out.push((e.th32ProcessID, e.th32ParentProcessID));
                ok = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
        }
        out
    }

    /// 프로세스 시작 시각 (FILETIME 100ns) — pid 재사용을 가르는 근거
    fn start_time(pid: u32) -> Option<u64> {
        unsafe {
            let ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if ph.is_null() {
                return None;
            }
            let z = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
            let (mut c, mut x, mut k, mut u) = (z, z, z, z);
            let ok = GetProcessTimes(ph, &mut c, &mut x, &mut k, &mut u) != 0;
            CloseHandle(ph);
            ok.then(|| ((c.dwHighDateTime as u64) << 32) | c.dwLowDateTime as u64)
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0); // KILL_ON_JOB_CLOSE — 마지막 핸들 닫힘 = 트리 정리
            }
        }
    }
}

#[cfg(windows)]
pub use win::Job;

/// 잡 pid에서 시작해 부모 pid를 따라 자손을 붙인다 — 앞쪽은 잡 pid 그대로, 뒤쪽이 잡을 벗어난 자손.
/// 자식으로 인정하는 조건: 부모 pid가 목록에 있고, 자식이 부모보다 늦게 시작했다. 부모 pid 필드는
/// 생성 때의 값이라, 죽은 프로세스의 pid를 잡 프로세스가 물려받으면 엉뚱한 프로세스가 자식처럼
/// 보인다 — 종료 경로가 그것을 죽이면 안 되므로 시작 시각으로 거른다. 시각을 모르면 붙이지 않는다.
/// 이미 목록에 있는 자식(잡 안의 자손)에는 시각을 묻지 않는다 — 잡 안 세션의 비용은 스냅숏 한 번뿐이다.
pub fn tree_pids(job: &[u32], table: &[(u32, u32)], start: impl Fn(u32) -> Option<u64>) -> Vec<u32> {
    let mut out = job.to_vec();
    let mut i = 0;
    while i < out.len() {
        let parent = out[i];
        let mut parent_start = None;
        for &(pid, ppid) in table {
            if ppid != parent || pid == parent || out.contains(&pid) {
                continue;
            }
            let ps = *parent_start.get_or_insert_with(|| start(parent));
            if ps.zip(start(pid)).is_some_and(|(p, c)| c >= p) {
                out.push(pid);
            }
        }
        i += 1;
    }
    out
}

#[cfg(not(windows))]
pub struct Job;

#[cfg(not(windows))]
impl Job {
    pub fn new_kill_on_close() -> Option<Job> {
        None
    }
    pub fn assign_pid(&self, _pid: u32) -> bool {
        false
    }
    pub fn terminate(&self) {}
    pub fn pids(&self) -> Vec<u32> {
        Vec::new()
    }
    pub fn tree_pids(&self) -> Vec<u32> {
        Vec::new()
    }
    pub fn memory_bytes(&self) -> Option<(u64, u64)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::tree_pids;
    use std::collections::HashMap;

    fn starts(t: &[(u32, u64)]) -> impl Fn(u32) -> Option<u64> {
        let m: HashMap<u32, u64> = t.iter().copied().collect();
        move |pid| m.get(&pid).copied()
    }

    /// 잡 안의 세션은 지금과 같다 — 잡 pid가 그대로, 중복 없이
    #[test]
    fn in_job_tree_is_just_the_job() {
        let table = [(10, 1), (11, 10), (12, 11)];
        let got = tree_pids(&[10, 11, 12], &table, starts(&[]));
        assert_eq!(got, vec![10, 11, 12]);
    }

    /// pwsh(10)가 띄운 claude(20)와 그 자식(21)이 잡을 벗어났다 — 부모 pid를 따라 뒤에 붙는다
    #[test]
    fn escaped_descendants_are_appended() {
        let table = [(10, 1), (20, 10), (21, 20), (30, 99)];
        let got = tree_pids(&[10], &table, starts(&[(10, 100), (20, 200), (21, 300), (30, 50)]));
        assert_eq!(got, vec![10, 20, 21]);
    }

    /// 실기 확인용 (수동: `cargo test -- --ignored`) — breakaway를 허용하는 조상 잡 안에서 돌릴 때만
    /// 의미가 있다 (개발 셸). pwsh가 띄운 ping이 잡 pid에는 없고 tree_pids에는 있어야 한다
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn pwsh_child_escapes_job_but_tree_finds_it() {
        let job = super::Job::new_kill_on_close().unwrap();
        let mut child = std::process::Command::new("pwsh.exe")
            .args(["-NoProfile", "-Command", "Start-Sleep -Milliseconds 300; ping -n 4 127.0.0.1 | Out-Null"])
            .spawn()
            .unwrap();
        assert!(job.assign_pid(child.id()));
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let (inside, tree) = (job.pids(), job.tree_pids());
        eprintln!("job pids {inside:?} · tree {tree:?}");
        assert!(tree.len() > 1, "pwsh의 자식이 트리에 있어야 한다");
        job.terminate();
        let _ = child.wait();
    }

    /// 재사용된 pid — 잡의 pid 10이 생기기 전에 시작한 프로세스는 자식이 아니다 (종료 경로가 죽이면 안 된다)
    #[test]
    fn older_process_with_reused_parent_pid_is_not_a_child() {
        let table = [(10, 1), (40, 10)];
        let got = tree_pids(&[10], &table, starts(&[(10, 500), (40, 100)]));
        assert_eq!(got, vec![10]);
        // 시각을 모르면 붙이지 않는다
        assert_eq!(tree_pids(&[10], &table, starts(&[(10, 500)])), vec![10]);
    }
}
