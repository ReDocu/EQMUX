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
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
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
        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }

        /// 잡에 속한 pid 목록 — 포트 귀속(H)·메모리 합산이 같은 원천을 쓴다
        pub fn pids(&self) -> Vec<u32> {
            unsafe {
                const CAP: usize = 128;
                #[repr(C)]
                struct PidList {
                    assigned: u32,
                    in_list: u32,
                    pids: [usize; CAP],
                }
                let mut list = PidList { assigned: 0, in_list: 0, pids: [0; CAP] };
                if QueryInformationJobObject(
                    self.0,
                    JobObjectBasicProcessIdList,
                    &mut list as *mut _ as *mut std::ffi::c_void,
                    std::mem::size_of::<PidList>() as u32,
                    std::ptr::null_mut(),
                ) == 0
                {
                    return Vec::new();
                }
                (0..(list.in_list as usize).min(CAP)).map(|i| list.pids[i] as u32).collect()
            }
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

                // 현재 — 잡 소속 pid 열거 후 워킹셋 합산 (자식 누락·경합 없음: 잡이 원본)
                const CAP: usize = 128;
                #[repr(C)]
                struct PidList {
                    assigned: u32,
                    in_list: u32,
                    pids: [usize; CAP],
                }
                let mut list = PidList { assigned: 0, in_list: 0, pids: [0; CAP] };
                if QueryInformationJobObject(
                    self.0,
                    JobObjectBasicProcessIdList,
                    &mut list as *mut _ as *mut std::ffi::c_void,
                    std::mem::size_of::<PidList>() as u32,
                    std::ptr::null_mut(),
                ) == 0
                {
                    return None;
                }
                let mut total = 0u64;
                for i in 0..(list.in_list as usize).min(CAP) {
                    let ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, list.pids[i] as u32);
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
    pub fn memory_bytes(&self) -> Option<(u64, u64)> {
        None
    }
}
