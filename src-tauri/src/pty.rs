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

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Error, Result};

/// 셸 출력 한 덩어리. 프런트가 그대로 `term.write()`에 넣는다.
pub const EVENT_DATA: &str = "pty://data";
/// 셸이 끝났다. 프런트가 상태를 바꾸고 재기동 여부를 정한다.
pub const EVENT_EXIT: &str = "pty://exit";

#[derive(Debug, Clone, Serialize)]
pub struct PtyInfo {
    pub id: String,
    /// 실제로 띄운 실행 파일 경로. "pwsh를 띄웠다고 믿는 것"과 구분한다.
    pub shell: String,
    pub pid: Option<u32>,
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

struct Session {
    info: PtyInfo,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
    seq: AtomicU64,
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
            cwd: cwd.clone(),
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

        spawn_reader(app.clone(), id, reader);
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
        s.child.kill().map_err(Error::from)
        // drop(s) — master·writer가 닫히고 ConPTY가 정리된다.
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
        let mut s = self.sessions.lock().unwrap().remove(id)?;
        s.child.wait().ok().map(|st| st.exit_code())
    }
}

fn not_found(id: &str) -> Error {
    Error::Pty(format!("그런 PTY 세션이 없다: {id}"))
}

/// 읽기 전용 스레드. 블로킹 `read`를 쓰므로 async로 만들지 않았다.
fn spawn_reader(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
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
                        pending.extend_from_slice(&buf[..n]);
                        let text = take_utf8(&mut pending);
                        if text.is_empty() {
                            // 아직 한 글자도 완성되지 않았다. 다음 읽기를 기다린다.
                            continue;
                        }
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
    use super::take_utf8;

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
