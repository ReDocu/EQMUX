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

mod agent;
mod missions;
mod roles;
pub(crate) mod store;
mod team;
pub(crate) mod workspace;
use store::{LineAssembler, Store, StoreMsg};
use workspace::{WsEntry, WsInfo};

pub(crate) struct StoreState(pub(crate) Store);

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    gen: u64, // 같은 id로 재기동 시 이전 리더 스레드의 정리를 무효화하는 세대 표식
}

static NEXT_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

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

/// 공용 PTY 스폰 — 셸·에이전트가 같은 배관(로그·스토어 스필·수명 관리)을 탄다.
/// 반환값은 이 PTY의 세대(gen) — 같은 id 재기동 시 이전 스레드의 정리를 무효화한다.
fn spawn_pty_session(
    app: AppHandle,
    id: String,
    ws: String,
    dir: String,
    shell_label: String,
    mut builders: Vec<CommandBuilder>,
    cols: u16,
    rows: u16,
) -> Result<u64, String> {
    let state: State<PtyState> = app.state();
    let store_state: State<StoreState> = app.state();
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = sessions.get(&id) {
        return Ok(existing.gen); // 이미 실행 중 — 재부착만 한다
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

    let mut child = None;
    let mut last_err = String::new();
    for cmd in builders.drain(..) {
        let label = format!("{:?}", cmd.get_argv().first().cloned().unwrap_or_default());
        match pair.slave.spawn_command(cmd) {
            Ok(c) => {
                child = Some(c);
                break;
            }
            Err(e) => last_err = format!("{label}: {e}"),
        }
    }
    let child = child.ok_or(format!("실행 실패 — {last_err}"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let gen = NEXT_GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    sessions.insert(
        id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
            gen,
        },
    );
    drop(sessions);

    // 스토어에 세션 시작을 기록 (FR-C-03)
    let store_tx = store_state.0.sender();
    let _ = store_tx.send(StoreMsg::SessionStart {
        ws: ws.clone(),
        id: id.clone(),
        cwd: dir.clone(),
        shell: shell_label,
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
        let mut last_spilled = String::new();
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
                        // TUI 프레임 잔해·연속 중복은 스필하지 않는다 (재생 오염 방지)
                        if store::is_tui_noise(&line) || line == last_spilled {
                            return;
                        }
                        last_spilled = line.clone();
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
        // 세대가 일치할 때만 정리한다 — 같은 id로 재기동된 새 세션을 지우면 안 된다
        let code = {
            let state: State<PtyState> = app.state();
            let mut sessions = state.0.lock().ok();
            let owned = sessions.as_mut().and_then(|s| {
                if s.get(&id).map(|e| e.gen) == Some(gen) {
                    s.remove(&id)
                } else {
                    None
                }
            });
            owned.and_then(|mut s| s.child.wait().ok()).map(|st| st.exit_code())
        };
        if let Some(f) = log_file.as_mut() {
            let _ = writeln!(f, "\n=== session exit · {} · code {:?} · epoch {} ===", id, code, epoch_secs());
        }
        assembler.finish(|line| {
            let _ = store_tx.send(StoreMsg::Line { ws: ws.clone(), id: id.clone(), text: line });
        });
        let _ = store_tx.send(StoreMsg::SessionExit { ws: ws.clone(), id: id.clone(), code });
        let _ = app.emit("pty-exit", PtyExit { id: id.clone(), code });
        agent::on_pty_exit(&app, &id, code, gen); // 에이전트면 dead 전이 (FR-D-50)
    });

    Ok(gen)
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    workspace: Option<String>,
) -> Result<(), String> {
    let dir = resolve_cwd(cwd);
    let label = shell.clone().unwrap_or_else(|| "pwsh".into());
    let builders = shell_candidates(shell)
        .into_iter()
        .map(|c| {
            let mut b = CommandBuilder::new(&c);
            b.cwd(&dir);
            b
        })
        .collect();
    let ws = workspace.unwrap_or_else(|| id.split('@').nth(1).unwrap_or("default").to_string());
    spawn_pty_session(app, id, ws, dir, label, builders, cols, rows).map(|_| ())
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

// ── 에이전트 런타임 (PRD D) — 기동·재개·권한 재시작. Claude 지식은 agent.rs에만 있다 ──

#[allow(clippy::too_many_arguments)]
fn agent_spawn_inner(
    app: AppHandle,
    id: String,
    ws: String,
    cwd: String,
    name: String,
    permission_mode: String,
    disallowed: Vec<String>,
    cols: u16,
    rows: u16,
    uuid: String,
    resume: bool,
) -> Result<String, String> {
    if !Path::new(&cwd).is_dir() {
        return Err("워크스페이스 경로를 찾을 수 없습니다 — 재개는 같은 cwd에서만 성립합니다".into());
    }
    // §4.1.1 커맨드라인 계약 — bypassPermissions는 어떤 경로로도 만들지 않는다
    let mut args: Vec<String> = Vec::new();
    if resume {
        args.push("--resume".into());
        args.push(uuid.clone());
    } else {
        args.push("--session-id".into()); // FR-D-01 — 앱 발급 UUID가 재개 앵커
        args.push(uuid.clone());
    }
    args.push("--name".into());
    args.push(name.clone());
    args.push("--permission-mode".into());
    args.push(permission_mode.clone());
    if !disallowed.is_empty() {
        args.push("--disallowedTools".into());
        args.push(disallowed.join(","));
    }
    // 역할 주입 (FR-D-05 · FR-E-40~43) — 파일이 원본, 프롬프트는 2줄 포인터.
    // 역할 파일이 없는 세션(역할 미부여)은 아무것도 주입하지 않는다.
    let role_file = {
        let p = roles::role_path(&cwd, &id);
        p.exists().then(|| p.to_string_lossy().into_owned())
    };
    if let Some(rf) = &role_file {
        args.push("--append-system-prompt".into());
        args.push(format!(
            "당신의 역할 파일: {rf} — 시작 전에 읽고 따르십시오.\n팀 편성: .eqmux/team.md · 임무 정의: .eqmux/missions/"
        ));
    }
    let builders = agent::claude_builders(&args, &cwd, &id, role_file.as_deref());
    let gen = spawn_pty_session(
        app.clone(),
        id.clone(),
        ws.clone(),
        cwd.clone(),
        "claude".into(),
        builders,
        cols,
        rows,
    )?;

    let rt: State<agent::AgentRt> = app.state();
    if let Ok(mut map) = rt.by_uuid.lock() {
        map.retain(|u, t| !(t.app_session == id && *u != uuid));
        map.insert(
            uuid.clone(),
            agent::Tracked {
                app_session: id.clone(),
                ws: ws.clone(),
                cwd: cwd.clone(),
                name,
                permission_mode,
                disallowed,
                last_status: "starting".into(),
                last_waiting: None,
                pty_gen: gen,
            },
        );
    }
    // agent_session 매핑 저장 (FR-D-24 · FR-C-27)
    let store: State<StoreState> = app.state();
    let _ = store.0.sender().send(StoreMsg::AgentSession {
        ws,
        id: id.clone(),
        agent_session_id: uuid.clone(),
        log_path: agent::transcript_path(&cwd, &uuid).to_string_lossy().into_owned(),
        resumable: agent::resumable(&cwd, &uuid),
    });
    agent::emit_state(
        &app,
        &agent::AgentStateEvt {
            session: id,
            agent_session: uuid.clone(),
            status: "starting".into(),
            waiting_for: None,
            resumable: resume,
            version: None,
            exit_code: None,
        },
    );
    Ok(uuid)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn agent_spawn(
    app: AppHandle,
    id: String,
    workspace: String,
    cwd: String,
    name: String,
    permission_mode: String,
    disallowed_tools: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let uuid = uuid::Uuid::new_v4().to_string();
    agent_spawn_inner(app, id, workspace, cwd, name, permission_mode, disallowed_tools, cols, rows, uuid, false)
}

fn kill_pty_for_restart(app: &AppHandle, id: &str) {
    let state: State<PtyState> = app.state();
    let removed = state.0.lock().ok().and_then(|mut s| s.remove(id));
    if let Some(mut s) = removed {
        let _ = s.child.kill();
    }
}

fn find_tracked(app: &AppHandle, id: &str) -> Option<(String, agent::Tracked)> {
    let rt: State<agent::AgentRt> = app.state();
    let map = rt.by_uuid.lock().ok()?;
    map.iter()
        .find(|(_, t)| t.app_session == id)
        .map(|(u, t)| (u.clone(), t.clone()))
}

/// 재개 (FR-D-21~23) — 사용자 트리거 전용. 같은 uuid + 같은 cwd로 --resume.
/// 앱 재시작 후에는 추적 맵이 비어 있으므로 agent_session 테이블(FR-D-24)에서 복원한다.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn agent_resume(
    app: AppHandle,
    id: String,
    workspace: String,
    cwd: String,
    name: String,
    permission_mode: String,
    disallowed_tools: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let (uuid, t) = match find_tracked(&app, &id) {
        Some(x) => x,
        None => {
            // 스토어 폴백 — 재부팅 후 복귀 (S3)
            let store: State<StoreState> = app.state();
            let path = store::db_path(&store.0.root(), &workspace);
            let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "재개 정보 없음 — 스토어가 비어 있습니다".to_string())?;
            let uuid: String = conn
                .query_row(
                    "SELECT agent_session_id FROM agent_session WHERE session_id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .map_err(|_| "재개 정보 없음 — 이 세션에서 실행된 에이전트가 없습니다".to_string())?;
            (
                uuid,
                agent::Tracked {
                    app_session: id.clone(),
                    ws: workspace,
                    cwd,
                    name,
                    permission_mode,
                    disallowed: disallowed_tools,
                    last_status: "dead".into(),
                    last_waiting: None,
                    pty_gen: 0,
                },
            )
        }
    };
    if !agent::resumable(&t.cwd, &uuid) {
        return Err("재개 불가 — 트랜스크립트가 없습니다".into());
    }
    kill_pty_for_restart(&app, &id);
    agent_spawn_inner(app, id, t.ws, t.cwd, t.name, t.permission_mode, t.disallowed, cols, rows, uuid, true)
}

/// 권한 변경 재시작 (E11′ · FR-D-26) — 재개로 수행해 대화를 잃지 않는다.
/// 트랜스크립트가 아직 없으면(턴 0) 같은 uuid로 새로 뜬다.
#[tauri::command]
fn agent_restart(
    app: AppHandle,
    id: String,
    permission_mode: String,
    disallowed_tools: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let Some((uuid, t)) = find_tracked(&app, &id) else {
        return Err("재시작 대상 없음 — 이 세션에서 실행된 에이전트가 없습니다".into());
    };
    let can_resume = agent::resumable(&t.cwd, &uuid);
    kill_pty_for_restart(&app, &id);
    agent_spawn_inner(
        app,
        id,
        t.ws,
        t.cwd,
        t.name,
        permission_mode,
        disallowed_tools,
        cols,
        rows,
        uuid,
        can_resume,
    )
}

// ── 팀 편성 파일 (PRD E §4.2) ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamSlotInfo {
    #[serde(flatten)]
    slot: team::TeamSlot,
    agent_session_id: Option<String>,
    resumable: bool,
}

/// team.json 로드 + 슬롯별 재개 정보 결합 (agent_session 테이블 · 트랜스크립트 실측)
#[tauri::command]
fn team_load(
    store_state: State<StoreState>,
    workspace_id: String,
    ws_path: String,
) -> Result<Vec<TeamSlotInfo>, String> {
    let file = team::load(&ws_path);
    let db = store::db_path(&store_state.0.root(), &workspace_id);
    let conn = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok();
    let out = file
        .slots
        .into_iter()
        .map(|slot| {
            let session_id = format!("{}@{}", slot.persona, workspace_id);
            let uuid: Option<String> = conn.as_ref().and_then(|c| {
                c.query_row(
                    "SELECT agent_session_id FROM agent_session WHERE session_id = ?1",
                    params![session_id],
                    |r| r.get(0),
                )
                .ok()
            });
            let resumable = uuid
                .as_deref()
                .map(|u| agent::resumable(&ws_path, u))
                .unwrap_or(false);
            TeamSlotInfo { slot, agent_session_id: uuid, resumable }
        })
        .collect();
    Ok(out)
}

/// team.json + team.md 저장 (FR-E-11·12·17)
#[tauri::command]
fn team_save(ws_path: String, slots: Vec<team::TeamSlot>) -> Result<(), String> {
    team::save(&ws_path, &slots)
}

// ── 역할 파일 합성 & 임무 (PRD E §4.4~4.6) — 원본은 전부 .eqmux/ 아래 텍스트 파일 ──

/// 역할 파일 합성 저장 (FR-E-31) — 반환값은 절대 경로 (에이전트 주입에 쓰인다)
#[tauri::command]
fn role_save(ws_path: String, payload: roles::RolePayload) -> Result<String, String> {
    roles::save(&ws_path, &payload)
}

/// 역할 해제·세션 제거 시 파일 삭제 — roles/는 gitignore라 repo 이력에 흔적이 없다
#[tauri::command]
fn role_remove(ws_path: String, session: String) -> Result<(), String> {
    roles::remove(&ws_path, &session)
}

#[tauri::command]
fn mission_list(ws_path: String) -> Vec<missions::MissionInfo> {
    missions::list(&ws_path)
}

#[tauri::command]
fn mission_create(
    ws_path: String,
    name: String,
    goal: String,
    branch: Option<String>,
) -> Result<missions::MissionInfo, String> {
    missions::create(&ws_path, &name, &goal, branch)
}

#[tauri::command]
fn mission_set_status(ws_path: String, id: String, status: String) -> Result<(), String> {
    missions::set_status(&ws_path, &id, &status)
}

/// 배정·해제 (FR-E-53·54) — 역할 파일의 임무 블록을 삽입·교체·삭제한다 (멱등)
#[tauri::command]
fn mission_assign(ws_path: String, session: String, mission_id: Option<String>) -> Result<(), String> {
    match mission_id {
        Some(id) => {
            let m = missions::get(&ws_path, &id).ok_or("임무 파일을 찾을 수 없습니다")?;
            let block = roles::MissionBlock {
                id: m.id,
                name: m.name,
                status: m.status,
                goal: m.goal,
                outputs: m.outputs,
                branch: m.branch,
            };
            roles::set_mission(&ws_path, &session, Some(&block))
        }
        None => roles::set_mission(&ws_path, &session, None),
    }
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

// ── 네이티브 클립보드 (arboard) — WebView2의 웹 Clipboard API는 권한 문제로 조용히 실패한다 ──

#[tauri::command]
fn clip_read_text() -> String {
    let mut cb = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    cb.get_text().unwrap_or_default()
}

#[tauri::command]
fn clip_write_text(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

/// 클립보드 이미지 → %TEMP%\eqmux-pastes\*.png 저장 후 경로 반환. 이미지가 없으면 None.
/// 터미널에는 파일 경로가 삽입된다 (Claude Code 멀티모달 입력용).
#[tauri::command]
fn clip_save_image() -> Result<Option<String>, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img = match cb.get_image() {
        Ok(i) => i,
        Err(_) => return Ok(None),
    };
    let (w, h) = (img.width as u32, img.height as u32);
    let rgba = image::RgbaImage::from_raw(w, h, img.bytes.into_owned())
        .ok_or("클립보드 이미지 변환 실패")?;
    let dir = std::env::temp_dir().join("eqmux-pastes");
    create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("paste-{}.png", workspace::now_ms()));
    rgba.save(&path).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
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
            // 에이전트 런타임 (PRD D) — 세션 레지스트리 watch 시작 (FR-D-11)
            app.manage(agent::AgentRt::default());
            agent::start_registry_watch(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_list,
            agent_spawn,
            agent_resume,
            agent_restart,
            team_load,
            team_save,
            role_save,
            role_remove,
            mission_list,
            mission_create,
            mission_set_status,
            mission_assign,
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
            clip_read_text,
            clip_write_text,
            clip_save_image,
            session_log_dir,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("EQMUX 실행 실패");
}
