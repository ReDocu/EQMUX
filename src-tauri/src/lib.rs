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
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

mod store;
mod workspace;
use store::{LineAssembler, Store, StoreMsg};
use workspace::{WsEntry, WsInfo};

struct StoreState(Store);

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
    store_state: State<StoreState>,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    workspace: Option<String>,
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

    // 스토어에 세션 시작을 기록 (FR-C-03) — 워크스페이스 미지정 시 id의 @뒤를 쓴다
    let ws = workspace.unwrap_or_else(|| id.split('@').nth(1).unwrap_or("default").to_string());
    let store_tx = store_state.0.sender();
    let _ = store_tx.send(StoreMsg::SessionStart {
        ws: ws.clone(),
        id: id.clone(),
        cwd: dir.clone(),
        shell: "pwsh".into(),
    });

    // 출력 중계 스레드 — 로그 파일 append + VT 통과 줄을 스토어로 스필 + EOF 정리
    std::thread::spawn(move || {
        let mut log_file = {
            let dir = log_dir();
            let _ = create_dir_all(&dir);
            OpenOptions::new().create(true).append(true).open(dir.join(log_file_name(&id))).ok()
        };
        if let Some(f) = log_file.as_mut() {
            let _ = writeln!(f, "\n=== EQMUX session start · {} · epoch {} ===", id, epoch_secs());
        }
        let mut assembler = LineAssembler::new();
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Some(f) = log_file.as_mut() {
                        let _ = f.write_all(&buf[..n]);
                    }
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    assembler.push(&data, |line| {
                        let _ = store_tx.send(StoreMsg::Line {
                            ws: ws.clone(),
                            id: id.clone(),
                            text: line,
                        });
                    });
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
        assembler.finish(|line| {
            let _ = store_tx.send(StoreMsg::Line { ws: ws.clone(), id: id.clone(), text: line });
        });
        let _ = store_tx.send(StoreMsg::SessionExit { ws: ws.clone(), id: id.clone(), code });
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
fn pty_kill(state: State<PtyState>, store_state: State<StoreState>, id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut s) = sessions.remove(&id) {
        let _ = s.child.kill();
        let ws = id.split('@').nth(1).unwrap_or("default").to_string();
        let _ = store_state.0.sender().send(StoreMsg::Event {
            ws,
            id: Some(id.clone()),
            kind: "session-kill".into(),
            message: "사용자 요청으로 종료".into(),
        });
    }
    Ok(())
}

#[tauri::command]
fn pty_list(state: State<PtyState>) -> Result<Vec<String>, String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    Ok(sessions.keys().cloned().collect())
}

/// 재시작 복구 (FR-C-31) — 세션의 마지막 N줄. WAL이라 쓰기 스레드와 동시 읽기가 안전하다.
#[tauri::command]
fn scrollback_tail(
    store_state: State<StoreState>,
    workspace: String,
    session: String,
    count: u32,
) -> Result<Vec<String>, String> {
    let path = store::db_path(&store_state.0.root(), &workspace);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT text FROM (SELECT seq, text FROM scrollback WHERE session_id = ?1 ORDER BY seq DESC LIMIT ?2) ORDER BY seq ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session, count], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Serialize)]
struct SessionUsage {
    id: String,
    lines: i64,
    bytes: i64,
}

#[derive(Serialize)]
struct StoreUsageReal {
    db_file: String,
    db_size_bytes: u64,
    total_lines: i64,
    sessions: Vec<SessionUsage>,
}

/// 저장 사용량 실측 (FR-C-52) — 설정·컨트롤 센터 스트립의 원천
#[tauri::command]
fn store_usage_real(store_state: State<StoreState>, workspace: String) -> Result<StoreUsageReal, String> {
    let path = store::db_path(&store_state.0.root(), &workspace);
    if !path.exists() {
        return Ok(StoreUsageReal {
            db_file: path.to_string_lossy().into_owned(),
            db_size_bytes: 0,
            total_lines: 0,
            sessions: Vec::new(),
        });
    }
    let mut size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let wal = path.with_extension("db-wal");
    if let Ok(m) = std::fs::metadata(&wal) {
        size += m.len();
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM scrollback", [], |r| r.get(0))
        .unwrap_or(0);
    let mut stmt = conn
        .prepare(
            "SELECT s.id, COUNT(b.seq), COALESCE(s.bytes_received, 0) FROM session s LEFT JOIN scrollback b ON b.session_id = s.id GROUP BY s.id ORDER BY s.id",
        )
        .map_err(|e| e.to_string())?;
    let sessions = stmt
        .query_map([], |r| {
            Ok(SessionUsage { id: r.get(0)?, lines: r.get(1)?, bytes: r.get(2)? })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(StoreUsageReal {
        db_file: path.to_string_lossy().into_owned(),
        db_size_bytes: size,
        total_lines: total,
        sessions,
    })
}

// ── 워크스페이스 레지스트리 (PRD E §4.1) ──

#[tauri::command]
fn ws_pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("워크스페이스로 등록할 폴더 선택")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn ws_registry(store_state: State<StoreState>) -> Vec<WsInfo> {
    workspace::load(&store_state.0.root())
        .iter()
        .map(workspace::inspect)
        .collect()
}

/// 등록 (FR-E-01) — git 저장소가 아니면 "NOT_A_REPO"를 돌려주고 프런트가 git init을 묻는다
#[tauri::command]
fn ws_register(store_state: State<StoreState>, path: String) -> Result<WsInfo, String> {
    if !Path::new(&path).is_dir() {
        return Err("폴더를 찾을 수 없습니다".into());
    }
    if !workspace::is_repo(&path) {
        return Err("NOT_A_REPO".into());
    }
    let root = store_state.0.root();
    let mut list = workspace::load(&root);
    if let Some(existing) = list.iter_mut().find(|e| e.path.eq_ignore_ascii_case(&path)) {
        existing.last_used = workspace::now_ms();
        let info = workspace::inspect(existing);
        workspace::save(&root, &list)?;
        return Ok(info);
    }
    let entry = WsEntry {
        id: workspace::make_id(&path),
        name: workspace::entry_name(&path),
        path: path.clone(),
        remote: None,
        branch: None,
        last_used: workspace::now_ms(),
    };
    list.push(entry.clone());
    workspace::save(&root, &list)?;
    Ok(workspace::inspect(&entry))
}

#[tauri::command]
fn ws_git_init(path: String) -> Result<(), String> {
    workspace::git(&["init"], &path).map(|_| ())
}

/// 원격 clone 후 등록용 (FR-E-02) — clone된 로컬 경로를 돌려준다
#[tauri::command]
async fn ws_clone(url: String, parent: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = url
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .rsplit('/')
            .next()
            .unwrap_or("repo")
            .to_string();
        workspace::git(&["clone", &url], &parent)?;
        Ok(Path::new(&parent).join(name).to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 등록 해제 (FR-E-09) — 레지스트리에서만 지운다
#[tauri::command]
fn ws_unregister(store_state: State<StoreState>, id: String) -> Result<(), String> {
    let root = store_state.0.root();
    let mut list = workspace::load(&root);
    list.retain(|e| e.id != id);
    workspace::save(&root, &list)
}

/// 경로 재지정 (FR-E-08)
#[tauri::command]
fn ws_repath(store_state: State<StoreState>, id: String, path: String) -> Result<WsInfo, String> {
    if !Path::new(&path).is_dir() {
        return Err("폴더를 찾을 수 없습니다".into());
    }
    let root = store_state.0.root();
    let mut list = workspace::load(&root);
    let entry = list.iter_mut().find(|e| e.id == id).ok_or("등록 항목 없음")?;
    entry.path = path;
    entry.name = workspace::entry_name(&entry.path);
    entry.last_used = workspace::now_ms();
    let info = workspace::inspect(entry);
    workspace::save(&root, &list)?;
    Ok(info)
}

#[tauri::command]
fn ws_touch(store_state: State<StoreState>, id: String) -> Result<(), String> {
    let root = store_state.0.root();
    let mut list = workspace::load(&root);
    if let Some(entry) = list.iter_mut().find(|e| e.id == id) {
        entry.last_used = workspace::now_ms();
    }
    workspace::save(&root, &list)
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
        .setup(|app| {
            // 스토어 루트 = 앱 데이터 (FR-C-20a — repo 안에 바이너리를 두지 않는다)
            let root = app.path().app_data_dir()?;
            app.manage(StoreState(Store::new(root)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_list,
            scrollback_tail,
            store_usage_real,
            ws_pick_folder,
            ws_registry,
            ws_register,
            ws_git_init,
            ws_clone,
            ws_unregister,
            ws_repath,
            ws_touch,
            session_log_dir,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("EQMUX 실행 실패");
}
