//! `S1-2` — ConPTY 연결. 그리고 `S1-4`의 백엔드 절반.
//!
//! > ⚠️ **작성: 서이안(PM). 원래 세아 몫이다** — 팀장님 지시로 대행했다.
//! > 구조 결정은 세아가 다시 볼 수 있게 아래에 근거를 남긴다. 마음에 안 들면 갈아엎어도 된다.
//!
//! # 무엇을 하나
//!
//! ```text
//! xterm.onData ──▶ pty_write ──▶ ConPTY ──▶ 셸(pwsh)
//!                                              │
//! xterm.write  ◀── pty://data 이벤트 ◀── 읽기 스레드
//! ```
//!
//! # 결정 셋
//!
//! **① `portable-pty`를 쓴다.** Windows에서는 ConPTY(`CreatePseudoConsole`)를 잡고,
//! 나중에 다른 OS로 갈 때 이 파일만 그대로 둔다. 직접 Win32를 부르면 지금은 짧지만
//! 핸들 수명·상속 규칙을 우리가 떠안는다.
//!
//! **② 출력은 이벤트로 밀고, 입력은 명령으로 당긴다.** 출력은 셸이 아무 때나 뱉으므로
//! 폴링하면 지연이 붙는다. 입력은 사용자가 칠 때만 있으니 명령 왕복으로 충분하다.
//!
//! **③ UTF-8 조립은 여기서 한다.** ConPTY가 주는 바이트는 **글자 경계에서 끊기지 않는다.**
//! `가`(3바이트)의 두 바이트만 먼저 오는 일이 실제로 일어나고, 그대로 문자열로 만들면
//! 한글이 깨진다. **관문 A-1·A-2가 걸린 자리라 프런트에 떠넘기지 않았다.**
//!
//! **④ 출력량도 여기서 센다** (`S2-13` ②). ③과 같은 이유다 — 디코드하고 나면 원래 바이트 수는
//! 사라지고, 프런트는 그걸 되감아야 한다. 세는 것은 읽기 스레드가, 올리는 것은 미터 스레드가
//! 나눠 맡는다(§미터). 이 파일에서 프런트로 나가는 것은 이벤트 셋뿐이다:
//! `pty://data` · `pty://exit` · `pty://bytes`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Error, Result};

/// 셸 출력 한 덩어리. 프런트가 그대로 `term.write()`에 넣는다.
pub const EVENT_DATA: &str = "pty://data";
/// 셸이 끝났다. 프런트가 상태를 바꾸고 재기동 여부를 정한다.
pub const EVENT_EXIT: &str = "pty://exit";
/// 출력 누적 바이트. **주기적으로**(`METER_TICK_MS`) 값이 변했을 때만 나간다 — 아래 §미터.
pub const EVENT_BYTES: &str = "pty://bytes";

/// 미터 보고 주기(ms). 사람이 읽을 수 있는 상한이 이 언저리고, 그 위는 전부 비용이다.
const METER_TICK_MS: u64 = 500;

#[derive(Debug, Clone, Serialize)]
pub struct PtyInfo {
    pub id: String,
    /// 실제로 띄운 실행 파일 경로. "pwsh를 띄웠다고 믿는 것"과 구분한다.
    pub shell: String,
    pub pid: Option<u32>,
    /// 셸을 **띄운** 폴더. 절대 경로다(`display_path`).
    ///
    /// ⚠️ 셸이 `cd`로 옮겨 간 현재 위치가 아니다 — 그건 셸 통합(OSC 7)이 필요한 별개 기능이다.
    pub cwd: String,
}

#[derive(Clone, Serialize)]
struct DataEvent<'a> {
    id: &'a str,
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent<'a> {
    id: &'a str,
    code: Option<u32>,
}

#[derive(Clone, Serialize)]
struct BytesEvent {
    /// 앱 기동 이후 누적. 세션이 죽어도 줄지 않는다 — 계량기지 잔량이 아니다.
    total: u64,
    sessions: Vec<SessionBytes>,
}

#[derive(Clone, Serialize)]
struct SessionBytes {
    id: String,
    bytes: u64,
}

struct Session {
    info: PtyInfo,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

// ── 미터 — 출력 누적 바이트 (`S2-13` ②) ──────────────────────────────────────
//
// **원래 바이트 수를 아는 유일한 지점이 읽기 스레드다.** 프런트가 받는 것은 이미 디코드된
// String이라 다시 세려면 UTF-8로 되감아야 하고, 그 되감기가 출력 폭주 경로에 통째로 얹힌다
// (`statusbar.ts::installOutputMeter`가 그 임시 구현이었다).
//
// 지키는 것 둘:
//   ① **읽기 스레드는 더하기만 한다.** 청크마다 이벤트를 올리면 그게 곧 A-3가 지나가는 자리다.
//   ② **유휴에는 깨지 않는다.** 폴링 타이머를 두면 A-4(유휴 RAM) 측정 중에도 500ms마다 스레드가
//      깬다. 그래서 `Pulse`로 재운다 — 출력이 없으면 미터 스레드는 완전히 파킹된다.

/// "출력이 있었다"를 미터 스레드에 알리는 문. 유휴에는 대기자를 깨우지 않는다.
#[derive(Default)]
struct Pulse {
    dirty: AtomicBool,
    lock: Mutex<()>,
    cv: Condvar,
}

impl Pulse {
    /// 출력 경로에서 부른다. **이미 dirty면 원자 연산 하나로 끝난다** — 잠금까지 안 간다.
    fn mark(&self) {
        if !self.dirty.swap(true, Ordering::Release) {
            let _g = self.lock.lock().unwrap();
            self.cv.notify_one();
        }
    }

    /// 출력이 생길 때까지 잔다. 깨어나면 dirty를 내리고 돌아간다.
    fn wait(&self) {
        let mut g = self.lock.lock().unwrap();
        // mark는 잠금을 잡아야 notify하므로, 여기서 파킹되기 전에는 신호가 유실되지 않는다.
        while !self.dirty.swap(false, Ordering::Acquire) {
            g = self.cv.wait(g).unwrap();
        }
    }
}

#[derive(Default)]
struct ByteMeter {
    total: Arc<AtomicU64>,
    per: Mutex<HashMap<String, Arc<AtomicU64>>>,
    pulse: Arc<Pulse>,
    started: AtomicBool,
}

/// 읽기 스레드가 들고 가는 미터 손잡이. 맵을 다시 뒤지지 않는다.
struct MeterHandle {
    session: Arc<AtomicU64>,
    total: Arc<AtomicU64>,
    pulse: Arc<Pulse>,
}

impl MeterHandle {
    fn add(&self, n: usize) {
        let n = n as u64;
        self.session.fetch_add(n, Ordering::Relaxed);
        self.total.fetch_add(n, Ordering::Relaxed);
        self.pulse.mark();
    }
}

impl ByteMeter {
    fn register(&self, id: &str) -> MeterHandle {
        let session = Arc::new(AtomicU64::new(0));
        self.per
            .lock()
            .unwrap()
            .insert(id.to_string(), session.clone());
        MeterHandle {
            session,
            total: self.total.clone(),
            pulse: self.pulse.clone(),
        }
    }

    /// 세션이 사라졌다. 누적 total은 그대로 두고 목록에서만 뺀다.
    fn unregister(&self, id: &str) {
        self.per.lock().unwrap().remove(id);
        // 목록이 줄어든 것도 보고할 값이다 — 안 깨우면 상태바에 죽은 세션이 남는다.
        self.pulse.mark();
    }

    fn snapshot(&self) -> BytesEvent {
        let mut sessions: Vec<SessionBytes> = self
            .per
            .lock()
            .unwrap()
            .iter()
            .map(|(id, b)| SessionBytes {
                id: id.clone(),
                bytes: b.load(Ordering::Relaxed),
            })
            .collect();
        sessions.sort_by(|a, b| a.id.cmp(&b.id));
        BytesEvent {
            total: self.total.load(Ordering::Relaxed),
            sessions,
        }
    }
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
    seq: AtomicU64,
    meter: ByteMeter,
}

impl PtyManager {
    /// 셸을 띄우고 읽기 스레드를 붙인다.
    pub fn spawn(
        &self,
        app: &AppHandle,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell: Option<String>,
    ) -> Result<PtyInfo> {
        // 0은 ConPTY가 거부한다. 프런트가 아직 크기를 모를 때 0을 보낼 수 있다.
        let cols = cols.max(2);
        let rows = rows.max(1);

        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Pty(format!("openpty: {e}")))?;

        let shell = shell
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(detect_shell);
        let cwd = cwd
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| ".".into());

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);
        // 터미널 종류를 알려 준다. 없으면 일부 TUI가 색을 포기한다.
        cmd.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| Error::Pty(format!("셸 실행 실패 ({shell}): {e}")))?;

        // slave를 여기서 떨군다. 붙들고 있으면 셸이 죽어도 EOF가 오지 않아
        // 읽기 스레드가 영원히 살아 있는다.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| Error::Pty(format!("reader: {e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| Error::Pty(format!("writer: {e}")))?;

        let id = format!("pty-{}", self.seq.fetch_add(1, Ordering::Relaxed) + 1);
        let info = PtyInfo {
            id: id.clone(),
            shell: shell.clone(),
            pid: child.process_id(),
            // 화면에 그대로 나가는 값이라 여기서 절대 경로로 확정한다 — `.`을 상태바에 띄우지 않는다.
            cwd: display_path(&cwd),
        };

        self.sessions.lock().unwrap().insert(
            id.clone(),
            Session {
                info: info.clone(),
                master: pair.master,
                writer,
                child,
            },
        );

        let meter = self.meter.register(&id);
        // 미터 스레드는 **첫 세션에서만** 뜬다. 계측 모드(`--latency-probe`)는 PTY를 안 띄우므로
        // A-3를 재는 실행에는 이 스레드가 존재하지 않는다.
        if !self.meter.started.swap(true, Ordering::Relaxed) {
            spawn_meter(app.clone());
        }
        spawn_reader(app.clone(), id, reader, meter);
        Ok(info)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let mut map = self.sessions.lock().unwrap();
        let s = map.get_mut(id).ok_or_else(|| not_found(id))?;
        s.writer.write_all(data.as_bytes())?;
        s.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let map = self.sessions.lock().unwrap();
        let s = map.get(id).ok_or_else(|| not_found(id))?;
        s.master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Pty(format!("resize: {e}")))
    }

    /// 세션을 **맵에서 걷어낸 뒤** 죽인다. 순서가 곧 수명이다 (`S2-2`에서 잡은 누수):
    ///
    /// 죽이기만 하고 맵에 남겨 두면 정리는 읽기 스레드의 EOF → `reap`에 걸리는데,
    /// ConPTY는 **마스터가 닫혀야** 읽기 파이프를 놓는 경우가 있다. 그러면 reap은 EOF를
    /// 기다리고 EOF는 drop을 기다리는 원형 대기가 되어, 죽인 셸의 ConPTY·conhost가
    /// 유휴 RAM으로 남는다 — 관문 A2가 재는 게 정확히 그 자리다.
    /// 여기서 세션을 꺼내 drop하면 마스터가 닫히고, 읽기 스레드는 EOF로 끝난다.
    pub fn kill(&self, id: &str) -> Result<()> {
        let mut s = self
            .sessions
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| not_found(id))?;
        self.meter.unregister(id);
        let r = s.child.kill().map_err(Error::from);
        // drop(s)가 master를 닫으며 ConPTY를 정리하는데, **이 닫기가 conhost 상태에 따라
        // 블로킹된다**(S2-3에서 실측 — 메모리 압박 하에서 layout_close가 메인 스레드째
        // 얼어붙어 창까지 멈췄다. 같은 코드가 세 번 통과한 적도 있다 — 그건 운이었다).
        // 동기 명령은 메인 스레드에서 돈다. 자원 반납이 입력을 막게 두지 않는다 —
        // 세션은 이미 맵에서 빠졌으므로 pty_list·A2 관점의 정리는 끝났고, drop은 반납만 남았다.
        std::thread::Builder::new()
            .name(format!("eqmux-pty-drop-{id}"))
            .spawn(move || drop(s))
            .map_err(|e| Error::Pty(format!("정리 스레드 생성 실패: {e}")))?;
        r
    }

    pub fn list(&self) -> Vec<PtyInfo> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| s.info.clone())
            .collect()
    }

    /// 세션을 걷어내고 종료 코드를 받는다. 읽기 스레드가 EOF를 만나면 부른다.
    ///
    /// `kill`이 먼저 걷어낸 세션이면 `None`이다 — 종료 코드는 못 주지만 누수는 아니다.
    fn reap(&self, id: &str) -> Option<u32> {
        self.meter.unregister(id);
        let mut s = self.sessions.lock().unwrap().remove(id)?;
        s.child.wait().ok().map(|st| st.exit_code())
    }
}

fn not_found(id: &str) -> Error {
    Error::Pty(format!("그런 PTY 세션이 없다: {id}"))
}

/// 읽기 전용 스레드. 블로킹 `read`를 쓰므로 async로 만들지 않았다.
fn spawn_reader(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>, meter: MeterHandle) {
    std::thread::Builder::new()
        .name(format!("eqmux-pty-{id}"))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            // 글자 경계에서 끊긴 바이트를 다음 읽기까지 들고 있는 자리.
            let mut pending: Vec<u8> = Vec::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // **여기가 원래 바이트 수를 아는 자리다.** 디코드 전에 센다 —
                        // 글자 경계에서 끊긴 바이트도 셸이 실제로 뱉은 출력이다.
                        meter.add(n);
                        pending.extend_from_slice(&buf[..n]);
                        let text = take_utf8(&mut pending);
                        if text.is_empty() {
                            // 아직 한 글자도 완성되지 않았다. 다음 읽기를 기다린다.
                            continue;
                        }
                        // 출력도 활동이다 (`S2-10`) — 긴 빌드가 찍는 동안 Low로 떨어지면
                        // 화면이 실시간으로 갱신되는 중에 캐시를 버리게 된다.
                        app.state::<crate::memlevel::MemoryPolicy>().touch();
                        if app
                            .emit(EVENT_DATA, DataEvent { id: &id, data: text })
                            .is_err()
                        {
                            // 창이 이미 닫힌 뒤다. 여기서 멈추지 않으면 스레드가 남는다.
                            break;
                        }
                    }
                    Err(e) => {
                        // ConPTY는 셸 종료 시 EOF 대신 오류를 주기도 한다. 종료로 취급한다.
                        eprintln!("[eqmux][pty:{id}] 읽기 종료: {e}");
                        break;
                    }
                }
            }

            let code = app.state::<PtyManager>().reap(&id);
            eprintln!("[eqmux][pty:{id}] 셸 종료 (code={code:?})");
            let _ = app.emit(EVENT_EXIT, ExitEvent { id: &id, code });
        })
        .expect("PTY 읽기 스레드 생성 실패");
}

/// 미터 스레드. **출력이 있을 때만 깨어나** 최대 `METER_TICK_MS`에 한 번 보고한다.
///
/// 순서가 중요하다 — `wait()`로 첫 출력을 기다린 뒤 `sleep`으로 그 뒤 500ms의 출력을 모은다.
/// 반대로 하면(자고 나서 확인) 유휴 상태에서도 계속 깬다.
fn spawn_meter(app: AppHandle) {
    std::thread::Builder::new()
        .name("eqmux-pty-meter".into())
        .spawn(move || {
            let mut last: Option<(u64, usize)> = None;
            loop {
                let Some(mgr) = app.try_state::<PtyManager>() else {
                    break; // 앱이 내려갔다
                };
                mgr.meter.pulse.wait();
                std::thread::sleep(Duration::from_millis(METER_TICK_MS));

                let ev = mgr.meter.snapshot();
                let now = (ev.total, ev.sessions.len());
                if last == Some(now) {
                    continue;
                }
                last = Some(now);
                if app.emit(EVENT_BYTES, ev).is_err() {
                    break; // 창이 닫혔다 — 여기서 멈추지 않으면 스레드가 남는다
                }
            }
        })
        .expect("PTY 미터 스레드 생성 실패");
}

/// 표시용 절대 경로.
///
/// 상대 경로(`.`)를 그대로 두면 상태바에 점 하나가 뜬다. Windows `canonicalize`는
/// `\\?\` 접두사를 붙이는데 **그건 사용자에게 보여 줄 값이 아니다** — 걷어낸다.
fn display_path(p: &str) -> String {
    let raw = Path::new(p);
    let abs: PathBuf = std::fs::canonicalize(raw)
        .or_else(|_| std::env::current_dir().map(|d| d.join(raw)))
        .unwrap_or_else(|_| raw.to_path_buf());
    let s = abs.to_string_lossy();
    // 네트워크 경로는 접두사를 통째로 벗기면 `UNC\server\share`가 되어 못 쓴다.
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// 완성된 글자까지만 잘라 내고, 덜 온 바이트는 `pending`에 남긴다.
///
/// **이 함수가 한글의 생사를 가른다.** ConPTY는 3바이트짜리 `가`를 2바이트+1바이트로
/// 나눠 줄 수 있고, 그대로 문자열로 만들면 화면에 `?`가 남는다.
fn take_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_owned();
            pending.clear();
            out
        }
        Err(e) => {
            let valid = e.valid_up_to();
            let mut out = String::from_utf8_lossy(&pending[..valid]).into_owned();
            match e.error_len() {
                // 마지막 글자가 덜 왔다 — 남겨 두고 다음 읽기를 기다린다.
                None => {
                    pending.drain(..valid);
                }
                // 진짜 깨진 바이트다. 버리고 대체 문자를 넣는다.
                // 여기서 멈추면 그 뒤 출력이 통째로 막힌다 — 한 글자를 잃는 쪽이 낫다.
                Some(bad) => {
                    out.push('\u{FFFD}');
                    pending.drain(..valid + bad);
                }
            }
            out
        }
    }
}

/// 띄울 셸을 정한다. `EQMUX_SHELL` → `pwsh` → Windows PowerShell → `cmd` 순.
///
/// `S3-3`에서 사용자 설정이 앞에 붙지만, 자동 감지는 그때도 마지막 폴백으로 남는다.
pub fn detect_shell() -> String {
    if let Ok(s) = std::env::var("EQMUX_SHELL") {
        if !s.trim().is_empty() {
            return s.trim().to_string();
        }
    }

    // PowerShell 7. 기준선 측정도 이걸로 쟀다 (BASELINE.md §1).
    if let Some(p) = which("pwsh.exe") {
        return p;
    }

    // Windows 기본 제공 PowerShell 5.1. PATH를 안 뒤지고 절대 경로로 확인한다 —
    // PATH가 오염된 환경에서 엉뚱한 powershell.exe를 잡는 사고를 막는다.
    if let Some(root) = std::env::var_os("SystemRoot") {
        let p = Path::new(&root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if p.is_file() {
            return p.to_string_lossy().into_owned();
        }
    }

    "cmd.exe".into()
}

fn which(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{display_path, take_utf8, ByteMeter, Pulse};
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    #[test]
    fn 상대_경로는_절대_경로로_확정된다() {
        let p = display_path(".");
        assert!(!p.starts_with(r"\\?\"), "UNC 접두사가 남았다: {p}");
        assert!(std::path::Path::new(&p).is_absolute(), "상대 경로다: {p}");
    }

    #[test]
    fn 미터는_세션별과_합계를_같이_센다() {
        let meter = ByteMeter::default();
        let a = meter.register("pty-1");
        let b = meter.register("pty-2");
        a.add(100);
        b.add(23);
        a.add(1);

        let snap = meter.snapshot();
        assert_eq!(snap.total, 124);
        assert_eq!(snap.sessions.len(), 2);
        assert_eq!(snap.sessions[0].bytes, 101); // id 순 — pty-1
        assert_eq!(snap.sessions[1].bytes, 23);

        // 세션이 죽으면 목록에서는 빠지지만 누적 합계는 계량기라 안 줄어든다.
        meter.unregister("pty-1");
        let snap = meter.snapshot();
        assert_eq!(snap.total, 124);
        assert_eq!(snap.sessions.len(), 1);
    }

    #[test]
    fn 펄스는_출력_전에_켜져_있어도_신호를_잃지_않는다() {
        // mark가 wait보다 먼저 와도 대기자는 즉시 돌아온다 — 그러지 않으면 첫 출력이 유실된다.
        let p = Pulse::default();
        p.mark();
        p.wait();
        assert!(!p.dirty.load(Ordering::Relaxed));

        // 파킹된 대기자를 다른 스레드의 mark가 깨운다.
        let p = Arc::new(Pulse::default());
        let waiter = {
            let p = p.clone();
            std::thread::spawn(move || p.wait())
        };
        std::thread::sleep(std::time::Duration::from_millis(30));
        p.mark();
        waiter.join().expect("mark가 대기자를 못 깨웠다");
    }

    #[test]
    fn 글자_중간에서_끊긴_바이트는_남겨_둔다() {
        let full = "가나".as_bytes().to_vec(); // 6바이트
        let mut pending = full[..4].to_vec(); // '가' + '나'의 첫 바이트
        assert_eq!(take_utf8(&mut pending), "가");
        assert_eq!(pending.len(), 1);

        pending.extend_from_slice(&full[4..]);
        assert_eq!(take_utf8(&mut pending), "나");
        assert!(pending.is_empty());
    }

    #[test]
    fn 깨진_바이트는_버리고_계속_간다() {
        let mut pending = vec![0x41, 0xFF, 0x42]; // A, 잘못된 바이트, B
        assert_eq!(take_utf8(&mut pending), "A\u{FFFD}");
        assert_eq!(take_utf8(&mut pending), "B");
    }
}
