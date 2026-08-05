//! `S2-10` — 유휴 연동 메모리 정책 (`#19` 결정 · SPIKE-A4 §5 제안 그대로).
//!
//! **"입력·출력·포커스 획득 중 Normal ↔ 유휴 N초 후 Low."**
//! A-4가 재는 것이 정확히 "유휴 RAM"이다 — 관문이 재는 그 상태를 제품 행동으로 겨냥한다.
//!
//! # 활동의 정의 — 왜 "지속 포커스"는 활동이 아닌가
//!
//! 활동 = ① PTY 입력(`pty_write`) ② PTY 출력(reader 스레드) ③ 창 포커스 **획득**(이벤트).
//! 창이 포커스를 **들고만** 있는 것은 활동이 아니다 — 그걸 활동으로 치면 앞에 떠 있는
//! 유휴 창이 영원히 Low에 못 들어가고, A-4의 "유휴 4분할"이 정확히 그 상태다.
//! 읽는 중일 수는 있지만 복귀가 비동기 한 발이라 비용이 첫 상호작용 한 번에 그친다.
//!
//! # N = 60초의 근거
//!
//! 상태 모델의 `running → waiting` 경계가 60초다 (DESIGN-NOTES §3-③) — "일이 끝났다"고
//! 판단하는 기준을 이미 하나 갖고 있으므로 새 숫자를 만들지 않는다. A-4 규격(30초 안정화
//! 후 30초 간격 10표본)과도 맞물린다: 표본 3번째부터 Low 값이 잡힌다.
//!
//! # 복귀는 입력을 기다리게 하지 않는다 (브리프 요구 ①)
//!
//! `touch()`는 원자 스탬프 + `try_send` 뿐이다 — 적용(`SetMemoryUsageTargetLevel`)은
//! 전용 워커가 `with_webview`로 비동기 실행한다. 입력 경로(`pty_write`)에 동기 COM 호출을
//! 두면 정책이 지연을 만든다 — 그 순간 이 작업은 개선이 아니라 이동이다(브리프 §1-1).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::AppHandle;

/// 기본 유휴 판정선(초). 근거는 머리말 — 바꾸려면 `--memory-policy-idle=SECS`.
pub const DEFAULT_IDLE_SECS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Normal,
    Low,
}

enum Cmd {
    /// 활동이 감지됐다 — Low면 Normal로 복귀하라.
    Restore,
}

pub struct MemoryPolicy {
    enabled: bool,
    idle: Duration,
    start: Instant,
    /// 마지막 활동 시각 — `start` 기준 밀리초. 잠금 없이 어느 스레드에서든 스탬프한다.
    last_activity_ms: AtomicU64,
    /// 현재 Low인가. 워커만 쓰지만 touch가 읽어야 해서 원자다.
    low: AtomicBool,
    tx: Mutex<Option<Sender<Cmd>>>,
}

impl MemoryPolicy {
    /// | 플래그 | 뜻 |
    /// |---|---|
    /// | `--memory-policy=off` | 정책 끄기 (진단·대조 측정용) |
    /// | `--memory-policy-idle=SECS` | 유휴 판정선 변경 (기본 60 · 검증용 단축) |
    ///
    /// `--memory-target=low`(정적 · SPIKE-A4)가 있으면 정책은 자동으로 꺼진다 —
    /// 정적 레버는 "항상 Low"라는 뜻이고 정책이 그걸 되돌리면 안 된다.
    pub fn from_args() -> Self {
        let mut enabled = true;
        let mut idle_secs = DEFAULT_IDLE_SECS;
        let mut static_low = false;

        for a in std::env::args() {
            if a == "--memory-policy=off" {
                enabled = false;
            } else if a == "--memory-target=low" {
                static_low = true;
            } else if let Some(v) = a.strip_prefix("--memory-policy-idle=") {
                match v.parse::<u64>() {
                    Ok(n) if n >= 1 => idle_secs = n,
                    _ => eprintln!("[eqmux] --memory-policy-idle 값이 잘못됐다: {v:?} (무시)"),
                }
            }
        }
        if static_low && enabled {
            eprintln!("[eqmux][memlevel] --memory-target=low(정적)가 있어 유휴 정책을 끈다");
            enabled = false;
        }

        Self {
            enabled,
            idle: Duration::from_secs(idle_secs),
            start: Instant::now(),
            last_activity_ms: AtomicU64::new(0),
            low: AtomicBool::new(false),
            tx: Mutex::new(None),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn idle_secs(&self) -> u64 {
        self.idle.as_secs()
    }

    /// 활동 스탬프. **어떤 스레드에서 불러도 즉시 돌아온다** — 원자 저장 + try_send뿐이다.
    pub fn touch(&self) {
        if !self.enabled {
            return;
        }
        let now = self.start.elapsed().as_millis() as u64;
        self.last_activity_ms.store(now, Ordering::Relaxed);
        if self.low.load(Ordering::Relaxed) {
            // 복귀는 워커가 한다. 채널이 죽었어도(워커 패닉) 입력은 계속 흘러야 한다.
            if let Ok(guard) = self.tx.lock() {
                if let Some(tx) = guard.as_ref() {
                    let _ = tx.send(Cmd::Restore);
                }
            }
        }
    }

    /// 워커 기동. 창이 만들어진 뒤 한 번 부른다.
    pub fn spawn_worker(&self, app: AppHandle) {
        if !self.enabled {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel::<Cmd>();
        *self.tx.lock().unwrap() = Some(tx);
        let idle = self.idle;

        // 워커가 self를 못 들므로(수명) 상태 판단에 필요한 것을 AppHandle 경유로 다시 꺼낸다.
        std::thread::Builder::new()
            .name("eqmux-memlevel".into())
            .spawn(move || worker_loop(app, rx, idle))
            .expect("memlevel 워커 생성 실패");
        eprintln!(
            "[eqmux][memlevel] 유휴 정책 켜짐 — {}초 무활동이면 Low, 활동 시 Normal 복귀",
            idle.as_secs()
        );
    }

    fn elapsed_since_activity(&self) -> Duration {
        let last = self.last_activity_ms.load(Ordering::Relaxed);
        let now = self.start.elapsed().as_millis() as u64;
        Duration::from_millis(now.saturating_sub(last))
    }
}

fn worker_loop(app: AppHandle, rx: Receiver<Cmd>, idle: Duration) {
    use tauri::Manager;
    loop {
        // 1초 틱 — Low 진입 판정. 복귀 명령은 채널로 즉시 온다.
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(Cmd::Restore) => {
                // 몰린 Restore는 한 번으로 접는다 — 키 연타가 COM 호출 연타가 되면 안 된다.
                while let Ok(Cmd::Restore) = rx.try_recv() {}
                let policy = app.state::<MemoryPolicy>();
                if policy.low.swap(false, Ordering::Relaxed) {
                    let idle_was = policy.elapsed_since_activity();
                    apply(&app, Level::Normal);
                    eprintln!(
                        "[eqmux][memlevel] 활동 감지 — Normal 복귀 요청 (직전 유휴 {}s)",
                        idle_was.as_secs()
                    );
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let policy = app.state::<MemoryPolicy>();
                if !policy.low.load(Ordering::Relaxed) && policy.elapsed_since_activity() >= idle {
                    policy.low.store(true, Ordering::Relaxed);
                    apply(&app, Level::Low);
                    eprintln!(
                        "[eqmux][memlevel] 유휴 {}초 — Low 진입 요청",
                        idle.as_secs()
                    );
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// 실제 적용. `with_webview`는 메인 스레드로 넘겨 실행되므로 여기서 블로킹하지 않는다.
/// 적용 결과는 반드시 stderr로 — "걸었다고 믿는 것"과 실제 적용을 가른다(SPIKE-A4 §4).
pub fn apply(app: &AppHandle, level: Level) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[eqmux][memlevel] ⚠️ 창이 없다 — {level:?} 적용 불가");
        return;
    };
    let result = window.with_webview(move |wv| {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
            };
            use windows_core::Interface;
            let value = match level {
                Level::Normal => 0,
                Level::Low => 1,
            };
            let applied = (|| -> std::result::Result<(), windows_core::Error> {
                unsafe {
                    let core = wv.controller().CoreWebView2()?;
                    let core19: ICoreWebView2_19 = core.cast()?;
                    core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(value))
                }
            })();
            match applied {
                Ok(()) => eprintln!("[eqmux][memlevel] {level:?} 적용"),
                Err(e) => eprintln!("[eqmux][memlevel] ⚠️ {level:?} 적용 실패: {e}"),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (&wv, level);
        }
    });
    if let Err(e) = result {
        eprintln!("[eqmux][memlevel] ⚠️ {level:?} 전달 실패: {e}");
    }
}
