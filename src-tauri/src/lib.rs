// M1 — PTY 계층 (portable-pty). 세션 1개 = PTY 1개 (도메인 모델 불변 규칙).
// VT 파싱은 프런트 xterm.js가 맡고, 여기는 바이트 스트림 중계와 수명 관리만 한다.
// 저장소(rusqlite)·에이전트 훅은 다음 단계에서 이 계층 뒤로 들어온다 (FR-C-01·02).

use std::collections::HashMap;
use std::fs::{create_dir_all, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct PtyState(Mutex<HashMap<String, PtySession>>);

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
    code: Option<u32>,
}

/// 세션 로그 (1차 — 파일 append). PRD 12의 rusqlite WAL 스토어가 오면 그 뒤로 들어간다.
fn log_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into());
    Path::new(&home).join(".eqmux").join("logs")
}

fn log_file_name(id: &str) -> String {
    let safe: String = id
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '@' | '-' | '_' | '.') { c } else { '_' })
        .collect();
    format!("{safe}.log")
}

fn epoch_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn resolve_cwd(cwd: Option<String>) -> String {
    if let Some(dir) = cwd {
        if Path::new(&dir).is_dir() {
            return dir;
        }
    }
    std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into())
}

/// 셸 후보를 순서대로 시도한다: 지정값 → pwsh → powershell → cmd
fn shell_candidates(shell: Option<String>) -> Vec<String> {
    let mut v = Vec::new();
    if let Some(s) = shell {
        if !s.is_empty() {
            v.push(s);
        }
    }
    v.extend(["pwsh.exe".into(), "powershell.exe".into(), "cmd.exe".into()]);
    v
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<PtyState>,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if sessions.contains_key(&id) {
        return Ok(()); // 이미 실행 중 — 재부착만 한다
    }

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let dir = resolve_cwd(cwd);
    let mut child = None;
    let mut last_err = String::new();
    for candidate in shell_candidates(shell) {
        let mut cmd = CommandBuilder::new(&candidate);
        cmd.cwd(&dir);
        match pair.slave.spawn_command(cmd) {
            Ok(c) => {
                child = Some(c);
                break;
            }
            Err(e) => last_err = format!("{candidate}: {e}"),
        }
    }
    let child = child.ok_or(format!("셸 실행 실패 — {last_err}"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    sessions.insert(
        id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );
    drop(sessions);

    // 출력 중계 스레드 — 로그 파일 append + EOF에서 세션 정리·종료 코드 방송
    std::thread::spawn(move || {
        let mut log_file = {
            let dir = log_dir();
            let _ = create_dir_all(&dir);
            OpenOptions::new().create(true).append(true).open(dir.join(log_file_name(&id))).ok()
        };
        if let Some(f) = log_file.as_mut() {
            let _ = writeln!(f, "\n=== EQMUX session start · {} · epoch {} ===", id, epoch_secs());
        }
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Some(f) = log_file.as_mut() {
                        let _ = f.write_all(&buf[..n]);
                    }
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit("pty-output", PtyOutput { id: id.clone(), data });
                }
            }
        }
        let code = {
            let state: State<PtyState> = app.state();
            let mut sessions = state.0.lock().ok();
            sessions
                .as_mut()
                .and_then(|s| s.remove(&id))
                .and_then(|mut s| s.child.wait().ok())
                .map(|st| st.exit_code())
        };
        if let Some(f) = log_file.as_mut() {
            let _ = writeln!(f, "\n=== session exit · {} · code {:?} · epoch {} ===", id, code, epoch_secs());
        }
        let _ = app.emit("pty-exit", PtyExit { id: id.clone(), code });
    });

    Ok(())
}

#[tauri::command]
fn pty_write(state: State<PtyState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let s = sessions.get_mut(&id).ok_or("세션 없음")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(state: State<PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let s = sessions.get(&id).ok_or("세션 없음")?;
    s.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(state: State<PtyState>, id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut s) = sessions.remove(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}

#[tauri::command]
fn pty_list(state: State<PtyState>) -> Result<Vec<String>, String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    Ok(sessions.keys().cloned().collect())
}

#[tauri::command]
fn session_log_dir() -> String {
    log_dir().to_string_lossy().into_owned()
}

#[tauri::command]
fn open_log_dir() -> Result<(), String> {
    let dir = log_dir();
    create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn run() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            app_version,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_list,
            session_log_dir,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("EQMUX 실행 실패");
}
