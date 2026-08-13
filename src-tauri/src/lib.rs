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

pub(crate) mod agent;
mod cli;
mod diff;
mod fsx;
pub(crate) mod ipc;
mod job;
pub(crate) mod library;
pub(crate) mod messages;
mod missions;
mod ports;
mod roles;
pub(crate) mod store;
mod team;
mod transcript;
pub(crate) mod workspace;
use store::{LineAssembler, Store, StoreMsg};
use workspace::{WsEntry, WsInfo};

pub(crate) struct StoreState(pub(crate) Store);

/// 비정상 종료 감지 (FR-C-35) — 시작 시 running.flag가 이미 있으면 직전 실행이
/// 정상 종료(app_exit의 표식 제거)를 거치지 못한 것이다. 이번 실행 동안 값은 불변.
struct DirtyStart(bool);

/// 설정 (PRD J) — 앱데이터 settings.json. 스키마는 프런트 소유(JSON 통과)이며
/// Rust는 알림 게이트(FR-G-30 라우팅) 같은 즉시 참조를 위해 메모리 사본을 든다.
pub(crate) struct SettingsState(pub(crate) Mutex<serde_json::Value>);

pub(crate) fn setting_str(app: &AppHandle, key: &str) -> Option<String> {
    let s: State<SettingsState> = app.state();
    let v = s.0.lock().ok()?;
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    gen: u64, // 같은 id로 재기동 시 이전 리더 스레드의 정리를 무효화하는 세대 표식
    job: Option<job::Job>, // FR-C-05 — 자식 트리 정리. drop = KILL_ON_JOB_CLOSE
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

    // FR-C-05 — 세션 트리를 Job Object로 묶는다. 실패해도 세션은 동작한다 (child.kill 폴백).
    let job = job::Job::new_kill_on_close();
    if let (Some(j), Some(pid)) = (job.as_ref(), child.process_id()) {
        j.assign_pid(pid);
    }

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
            job,
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
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));
    let builders = shell_candidates(shell)
        .into_iter()
        .map(|c| {
            let mut b = CommandBuilder::new(&c);
            b.cwd(&dir);
            // 일반 셸에서도 `eqmux ping` 같은 CLI(PRD I)가 잡히게 PATH 앞에 앱 폴더를 붙인다
            if let Some(d) = &exe_dir {
                let path = std::env::var("PATH").unwrap_or_default();
                b.env("PATH", format!("{};{}", d.display(), path));
            }
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
fn pty_kill(
    state: State<PtyState>,
    store_state: State<StoreState>,
    rt: State<agent::AgentRt>,
    id: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut s) = sessions.remove(&id) {
        // 사용자가 의도한 종료 — dead 전이는 나되 OS 알림은 내지 않는다 (G3)
        if let Ok(mut expected) = rt.expected_exit.lock() {
            expected.insert(id.clone());
        }
        if let Some(j) = &s.job {
            j.terminate(); // FR-C-05 — 자식 트리까지 즉시 정리
        }
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
#[serde(rename_all = "camelCase")]
struct EventRow {
    id: i64,
    ts: i64,
    session_id: Option<String>,
    kind: String,
    payload: Option<String>,
}

/// 이벤트 피드 조회 (FR-G-40·41·43) — 원천은 event 테이블, G는 별도 저장을 하지 않는다.
/// 스코프: session 지정 시 세션 / 미지정 시 워크스페이스. 전역은 프런트가 워크스페이스별로
/// 모아 병합한다 (DB가 워크스페이스 단위라서). 페이징은 before_id 커서.
#[tauri::command]
fn events_query(
    store_state: State<StoreState>,
    workspace: String,
    session: Option<String>,
    before_id: Option<i64>,
    limit: u32,
) -> Result<Vec<EventRow>, String> {
    let path = store::db_path(&store_state.0.root(), &workspace);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let cursor = before_id.unwrap_or(i64::MAX);
    let limit = limit.min(500) as i64;
    let map = |r: &rusqlite::Row| -> rusqlite::Result<EventRow> {
        Ok(EventRow {
            id: r.get(0)?,
            ts: r.get(1)?,
            session_id: r.get(2)?,
            kind: r.get(3)?,
            payload: r.get(4)?,
        })
    };
    let rows = if let Some(sess) = session {
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, session_id, kind, payload FROM event
                 WHERE session_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let out = stmt
            .query_map(params![sess, cursor, limit], map)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        out
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, session_id, kind, payload FROM event
                 WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let out = stmt
            .query_map(params![cursor, limit], map)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        out
    };
    Ok(rows)
}

// ── 메시지 버스 (PRD F) — 원장은 message 테이블, 전달은 프런트의 PTY 주입 (M3) ──

/// M6 분당 발신 상한의 창 상태 — key = "워크스페이스/발신자". 사람(커맨드)과
/// 에이전트(파이프 IPC) 발신이 같은 창을 공유한다.
#[derive(Default)]
pub(crate) struct MsgRate(pub(crate) Mutex<HashMap<String, Vec<i64>>>);

#[tauri::command]
fn msg_list(
    store_state: State<StoreState>,
    workspace: String,
    before_id: Option<i64>,
    limit: u32,
) -> Result<Vec<messages::MsgRow>, String> {
    messages::list(&store_state.0.root(), &workspace, before_id, limit)
}

/// 발신 (M2 강제 5종 · M6 상한) — 적재 후 message-new를 방송해 스트림·전달이 한 경로로 흐른다.
/// PRD I의 `eqmux send` CLI도 이 함수로 들어오게 된다.
#[tauri::command]
fn msg_send(
    app: AppHandle,
    store_state: State<StoreState>,
    rate: State<MsgRate>,
    workspace: String,
    from: String,
    to: String,
    msg_type: String,
    body: String,
) -> Result<messages::MsgRow, String> {
    messages::validate(&msg_type, &body)?; // 무효 발신은 상한을 소모하지 않는다
    {
        let mut map = rate.0.lock().map_err(|e| e.to_string())?;
        let times = map.entry(format!("{workspace}/{from}")).or_default();
        if !messages::allow_rate(times, workspace::now_ms() as i64) {
            return Err("RATE_LIMIT".into());
        }
    }
    let row = messages::send(&store_state.0.root(), &workspace, &from, &to, &msg_type, &body)?;
    let _ = app.emit(
        "message-new",
        serde_json::json!({ "workspace": workspace, "message": row }),
    );
    Ok(row)
}

#[tauri::command]
fn msg_mark_read(store_state: State<StoreState>, workspace: String) -> Result<(), String> {
    messages::mark_read(&store_state.0.root(), &workspace)
}

/// 스크롤백 전문 검색 (FR-C-16) — FTS5 인덱스, 없으면 LIKE 폴백. 읽기 전용.
#[tauri::command]
fn scrollback_search(
    store_state: State<StoreState>,
    workspace: String,
    query: String,
    session: Option<String>,
    limit: u32,
) -> Result<Vec<store::SearchHit>, String> {
    store::search(&store_state.0.root(), &workspace, &query, session.as_deref(), limit)
}

/// 디스크 페이징 (FR-C-13·14) — 인메모리 링버퍼 위쪽 기록을 조각 로드
#[tauri::command]
fn scrollback_page(
    store_state: State<StoreState>,
    workspace: String,
    session: String,
    before_seq: Option<i64>,
    limit: u32,
) -> Result<Vec<store::SearchHit>, String> {
    store::page(&store_state.0.root(), &workspace, &session, before_seq, limit)
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
    // 훅 2차 소스 주입 (D3 · FR-D-30 계열) — 사용자의 ~/.claude/settings.json과 repo의
    // .claude/는 건드리지 않고, 앱데이터의 합성 설정을 --settings로만 얹는다 (FR-E-70과 일관)
    if let Some(hs) = app
        .path()
        .app_data_dir()
        .ok()
        .map(|r| r.join("hook-settings.json"))
        .filter(|p| p.exists())
    {
        args.push("--settings".into());
        args.push(hs.to_string_lossy().into_owned());
    }
    let mut sys = String::new();
    if let Some(rf) = &role_file {
        sys.push_str(&format!(
            "당신의 역할 파일: {rf} — 시작 전에 읽고 따르십시오.\n팀 편성: .eqmux/team.md · 임무 정의: .eqmux/missions/\n"
        ));
    }
    // 메시지 버스 표면 (PRD I) — 팀 대화·자기 보고의 공식 통로를 알려준다
    sys.push_str(
        "팀 메시지: eqmux send --type ask|handoff|report|review|escalate [--to @이름] \"내용\" · 진척 보고: eqmux report \"한 줄\"",
    );
    args.push("--append-system-prompt".into());
    args.push(sys);
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
        if let Some(j) = &s.job {
            j.terminate(); // FR-C-05 — 재시작도 트리째 정리 후 새로 띄운다
        }
        let _ = s.child.kill();
    }
}

pub(crate) fn find_tracked(app: &AppHandle, id: &str) -> Option<(String, agent::Tracked)> {
    let rt: State<agent::AgentRt> = app.state();
    let map = rt.by_uuid.lock().ok()?;
    map.iter()
        .find(|(_, t)| t.app_session == id)
        .map(|(u, t)| (u.clone(), t.clone()))
}

/// 세션의 Claude sessionId — 추적 맵 우선, 앱 재시작 후엔 agent_session 테이블 (FR-D-24)
fn agent_uuid_for(app: &AppHandle, workspace: &str, id: &str) -> Option<String> {
    if let Some((uuid, _)) = find_tracked(app, id) {
        return Some(uuid);
    }
    let store: State<StoreState> = app.state();
    let path = store::db_path(&store.0.root(), workspace);
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    conn.query_row(
        "SELECT agent_session_id FROM agent_session WHERE session_id = ?1",
        params![id],
        |r| r.get(0),
    )
    .ok()
}

/// 트랜스크립트 열람 (FR-G-80~82) — 참조만: 경로에서 그때그때 읽는다 (V2).
/// 파싱 불가·파일 없음은 Err → 프런트가 스크롤백 폴백으로 전환한다 (FR-G-86).
#[tauri::command]
fn transcript_read(
    app: AppHandle,
    workspace: String,
    id: String,
    cwd: String,
) -> Result<transcript::TranscriptData, String> {
    let uuid = agent_uuid_for(&app, &workspace, &id)
        .ok_or("이 세션에서 실행된 에이전트가 없습니다")?;
    transcript::read(&agent::transcript_path(&cwd, &uuid), 200)
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

// ── 역할 라이브러리 (PRD E §4.3) — 전역 앱데이터 + 워크스페이스 오버라이드 2단 ──

/// 라이브러리 목록 (FR-E-20·21) — ws_path를 주면 오버라이드가 병합된다
#[tauri::command]
fn library_list(store_state: State<StoreState>, ws_path: Option<String>) -> library::LibraryData {
    library::list(&store_state.0.root(), ws_path.as_deref())
}

/// 페르소나 저장 (FR-E-28) — 전역 계층에 쓴다
#[tauri::command]
fn library_save_persona(store_state: State<StoreState>, persona: library::PersonaInfo) -> Result<(), String> {
    library::save_persona(&store_state.0.root(), &persona)
}

#[tauri::command]
fn library_delete_persona(store_state: State<StoreState>, id: String) -> Result<(), String> {
    library::delete_persona(&store_state.0.root(), &id)
}

/// 직무 저장 (FR-E-28) — 전역 계층에 쓴다. 편집·복제(새 id로 저장)가 이 경로 하나다
#[tauri::command]
fn library_save_job(store_state: State<StoreState>, job: library::JobInfo) -> Result<(), String> {
    library::save_job(&store_state.0.root(), &job)
}

#[tauri::command]
fn library_delete_job(store_state: State<StoreState>, id: String) -> Result<(), String> {
    library::delete_job(&store_state.0.root(), &id)
}

/// 편성 프리셋 목록 (FR-E-26) — 전역 앱데이터 presets/*.json이 원본
#[tauri::command]
fn preset_list(store_state: State<StoreState>) -> Vec<library::PresetInfo> {
    library::list_presets(&store_state.0.root())
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

/// git 패널 실데이터 (PRD H) — 읽기 전용. git CLI 호출이라 blocking 스레드에서 돈다.
#[tauri::command]
async fn git_overview(ws_path: String) -> Result<workspace::GitOverview, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::overview(&ws_path))
        .await
        .map_err(|e| e.to_string())?
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemSample {
    id: String,
    bytes: u64,
    peak_bytes: u64,
}

/// 세션 메모리 실측 (FR-C-09 · C11) — Job Object 계정 정보. 프런트가 10초 주기로 폴링하며
/// 샘플은 event 테이블에 적재하지 않는다. 측정 실패 세션은 목록에서 빠진다 → "측정 불가".
#[tauri::command]
fn sessions_memory(state: State<PtyState>) -> Vec<MemSample> {
    let Ok(sessions) = state.0.lock() else {
        return Vec::new();
    };
    sessions
        .iter()
        .filter_map(|(id, s)| {
            let (bytes, peak_bytes) = s.job.as_ref()?.memory_bytes()?;
            Some(MemSample { id: id.clone(), bytes, peak_bytes })
        })
        .collect()
}

/// 포트 스냅숏 (PRD H) — LISTENING TCP + 세션 귀속(Job pid 대조). 관측 전용.
#[tauri::command]
async fn ports_snapshot(app: AppHandle) -> Vec<ports::PortRow> {
    let session_pids: HashMap<String, Vec<u32>> = {
        let state: State<PtyState> = app.state();
        let Ok(sessions) = state.0.lock() else {
            return Vec::new();
        };
        sessions
            .iter()
            .filter_map(|(id, s)| s.job.as_ref().map(|j| (id.clone(), j.pids())))
            .collect()
    };
    tauri::async_runtime::spawn_blocking(move || ports::snapshot(&session_pids))
        .await
        .unwrap_or_default()
}

/// 변경 파일 목록 (PRD H diff) — porcelain 상태 + numstat 집계
#[tauri::command]
async fn diff_changed_files(ws_path: String) -> Result<Vec<diff::ChangedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || diff::changed_files(&ws_path))
        .await
        .map_err(|e| e.to_string())?
}

/// HEAD ↔ 워크트리 양측 비교 (PRD H diff) — 읽기 전용
#[tauri::command]
async fn diff_file(ws_path: String, path: String) -> Result<diff::FileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || diff::file_diff(&ws_path, &path))
        .await
        .map_err(|e| e.to_string())?
}

/// 탐색기 파일 트리 (PRD H) — 깊이·개수 상한, 무거운 디렉터리 제외
#[tauri::command]
fn fs_tree(ws_path: String) -> Vec<fsx::FsNode> {
    fsx::tree(&ws_path)
}

/// 텍스트 미리보기 — 경로 탈출 방지 + 64KB 상한
#[tauri::command]
fn fs_preview(ws_path: String, rel: String) -> Result<String, String> {
    fsx::preview(&ws_path, &rel)
}

// ── 종료 시퀀스 (FR-C-60~63) — ①입력 차단(프런트) → ②flush → ③정상 종료 신호 → ④유예 후 트리 종료 ──

/// ② 스크롤백·세션 매핑 flush — 2초 목표 (FR-C-63). true = 완료, false = 시한 초과(진행은 계속).
#[tauri::command]
fn shutdown_flush(store_state: State<StoreState>) -> bool {
    let (ack_tx, ack_rx) = std::sync::mpsc::channel();
    if store_state.0.sender().send(StoreMsg::Flush(ack_tx)).is_err() {
        return false;
    }
    ack_rx.recv_timeout(std::time::Duration::from_secs(2)).is_ok()
}

/// ③④ 전 세션에 Ctrl+C(정상 종료 신호) → 유예 → Job Object 트리 종료 → 앱 종료.
/// 종료 직전 마지막 flush를 한 번 더 시도한다 (세션 exit 이벤트까지 적재).
#[tauri::command]
async fn app_exit(app: AppHandle) {
    let state: State<PtyState> = app.state();
    // ③ 정상 종료 신호 — TUI 에이전트가 스스로 정리할 기회
    if let Ok(mut sessions) = state.0.lock() {
        for s in sessions.values_mut() {
            let _ = s.writer.write_all(b"\x03");
            let _ = s.writer.flush();
        }
    }
    tokio_sleep(std::time::Duration::from_millis(500)).await; // ④ 유예
    if let Ok(mut sessions) = state.0.lock() {
        for (_, s) in sessions.drain() {
            if let Some(j) = &s.job {
                j.terminate(); // FR-C-05 — 트리째
            }
            let mut child = s.child;
            let _ = child.kill();
        }
    }
    // 세션 exit 기록까지 flush (최대 1초 — 이미 ②를 거쳤으므로 잔량은 적다)
    let store: State<StoreState> = app.state();
    let (ack_tx, ack_rx) = std::sync::mpsc::channel();
    if store.0.sender().send(StoreMsg::Flush(ack_tx)).is_ok() {
        let _ = ack_rx.recv_timeout(std::time::Duration::from_secs(1));
    }
    // 클린 종료 표식 제거 (FR-C-35) — 이 줄에 도달했다는 것이 곧 정상 종료의 정의다
    let _ = std::fs::remove_file(store.0.root().join("running.flag"));
    app.exit(0);
}

// ── 비정상 종료 복구 (FR-C-35) — 첫 실행에서 직전 세션 목록 + 마지막 활동 시각 ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CrashSession {
    workspace: String,
    id: String,
    cwd: String,
    shell: Option<String>,
    last_output_at: Option<i64>,
    resumable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CrashReport {
    dirty: bool,
    sessions: Vec<CrashSession>,
}

/// 크래시 시점에 살아 있었을 세션 스캔 — 각 워크스페이스 DB에서 exit 기록 없이 끝난
/// 세션을 최근 활동순으로 모은다. 재개 가능 여부는 agent_session 매핑 +
/// 트랜스크립트 실측 (FR-D-20)으로 다시 판정한다.
fn crash_scan(root: &Path) -> Vec<CrashSession> {
    let mut out = Vec::new();
    let ws_root = root.join("workspaces");
    if let Ok(entries) = std::fs::read_dir(&ws_root) {
        for entry in entries.flatten() {
            let ws = entry.file_name().to_string_lossy().into_owned();
            let db = entry.path().join("session.db");
            let Ok(conn) = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
                continue;
            };
            let Ok(mut stmt) = conn.prepare(
                "SELECT s.id, s.cwd, s.shell, s.last_output_at, a.agent_session_id
                 FROM session s LEFT JOIN agent_session a ON a.session_id = s.id
                 WHERE s.exit_code IS NULL AND s.last_output_at IS NOT NULL
                 ORDER BY s.last_output_at DESC LIMIT 8",
            ) else {
                continue;
            };
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            });
            let Ok(rows) = rows else { continue };
            for (id, cwd, shell, last_output_at, uuid) in rows.flatten() {
                let cwd = cwd.unwrap_or_default();
                let resumable = uuid.as_deref().map(|u| agent::resumable(&cwd, u)).unwrap_or(false);
                out.push(CrashSession { workspace: ws.clone(), id, cwd, shell, last_output_at, resumable });
            }
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.last_output_at));
    out.truncate(16);
    out
}

/// 직전 실행이 비정상 종료였을 때만 dirty=true + 직전 세션 목록 (FR-C-35)
#[tauri::command]
fn crash_recovery(store_state: State<StoreState>, dirty: State<DirtyStart>) -> CrashReport {
    if !dirty.0 {
        return CrashReport { dirty: false, sessions: Vec::new() };
    }
    CrashReport { dirty: true, sessions: crash_scan(&store_state.0.root()) }
}

#[cfg(test)]
mod crash_tests {
    use super::*;

    /// exit 기록이 없는 세션만, 최근 활동순으로 잡힌다 (FR-C-35)
    #[test]
    fn crash_scan_finds_unexited_sessions_only() {
        let root = std::env::temp_dir().join(format!("eqmux-crash-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let conn = store::open_db(&root, "ws1").expect("db open");
        conn.execute(
            "INSERT INTO session (id, workspace, cwd, shell, created_at, last_output_at, exit_code)
             VALUES ('alive@ws1', 'ws1', 'C:\\w', 'claude', 1, 2000, NULL),
                    ('older@ws1', 'ws1', 'C:\\w', 'pwsh', 1, 1000, NULL),
                    ('exited@ws1', 'ws1', 'C:\\w', 'pwsh', 1, 3000, 0),
                    ('silent@ws1', 'ws1', 'C:\\w', 'pwsh', 1, NULL, NULL)",
            [],
        )
        .expect("seed");
        drop(conn);

        let found = crash_scan(&root);
        let ids: Vec<&str> = found.iter().map(|s| s.id.as_str()).collect();
        // exit 0 기록·활동 전무 세션은 제외, 최근 활동이 위
        assert_eq!(ids, vec!["alive@ws1", "older@ws1"]);
        assert_eq!(found[0].last_output_at, Some(2000));
        assert!(!found[0].resumable); // agent_session 매핑 없음 = 재개 불가
        let _ = std::fs::remove_dir_all(&root);
    }
}

async fn tokio_sleep(d: std::time::Duration) {
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d))
        .await
        .ok();
}

// ── 레이아웃 영속 (FR-C-22·30) — 열린 탭·페인 배치·포커스를 앱데이터 layout.json에 ──
// 스키마는 프런트 소유(JSON 통과) — 여기는 원자적 읽기·쓰기만 책임진다.

// ── 설정 (PRD J) — settings.json 원자적 읽기·쓰기 + 메모리 사본 갱신 ──

#[tauri::command]
fn settings_load(settings: State<SettingsState>) -> serde_json::Value {
    settings.0.lock().map(|v| v.clone()).unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
fn settings_save(
    store_state: State<StoreState>,
    settings: State<SettingsState>,
    data: serde_json::Value,
) -> Result<(), String> {
    let root = store_state.0.root();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    let tmp = root.join("settings.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, root.join("settings.json")).map_err(|e| e.to_string())?;
    if let Ok(mut v) = settings.0.lock() {
        *v = data;
    }
    Ok(())
}

#[tauri::command]
fn layout_load(store_state: State<StoreState>) -> Option<serde_json::Value> {
    let path = store_state.0.root().join("layout.json");
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
fn layout_save(store_state: State<StoreState>, data: serde_json::Value) -> Result<(), String> {
    let root = store_state.0.root();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    let tmp = root.join("layout.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, root.join("layout.json")).map_err(|e| e.to_string())
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

/// 훅 합성 설정 (D3) — 세션별 `--settings`로만 주입한다. 사용자의 ~/.claude/settings.json과
/// repo .claude/는 절대 수정하지 않는다 (FR-E-70). 커맨드는 PATH의 eqmux를 부른다
/// (claude_builders가 앱 폴더를 PATH 앞에 붙인다). 매 기동 때 다시 써서 형식을 앱이 소유한다.
fn write_hook_settings(root: &Path) {
    let hook = |event: &str| {
        serde_json::json!([{ "hooks": [{ "type": "command", "command": format!("eqmux _hook {event}"), "timeout": 5 }] }])
    };
    let v = serde_json::json!({
        "hooks": {
            "UserPromptSubmit": hook("UserPromptSubmit"),
            "Stop": hook("Stop"),
            "Notification": hook("Notification"),
        }
    });
    let _ = std::fs::create_dir_all(root);
    let _ = std::fs::write(root.join("hook-settings.json"), v.to_string());
}

/// CLI 모드 엔트리 (PRD I) — main.rs가 argv 첫 토큰으로 분기한다. GUI를 띄우지 않는다.
pub fn cli_main() -> i32 {
    cli::run(std::env::args().skip(1).collect())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(PtyState::default())
        .setup(|app| {
            // 스토어 루트 = 앱 데이터 (FR-C-20a — repo 안에 바이너리를 두지 않는다)
            let root = app.path().app_data_dir()?;
            library::seed(&root); // 역할 라이브러리 시드 (FR-E-27) — 디렉터리가 없을 때만
            write_hook_settings(&root); // --settings 주입용 훅 합성 파일 (D3)
            // 비정상 종료 감지 (FR-C-35) — 표식이 남아 있으면 직전 실행이 크래시였다.
            // 정상 종료는 app_exit 끝에서 표식을 지운다.
            let dirty = root.join("running.flag").exists();
            let _ = std::fs::write(root.join("running.flag"), b"1");
            app.manage(DirtyStart(dirty));
            // 설정 로드 (PRD J) — 손상되면 Null로 시작 (프런트 기본값이 받친다)
            let settings = std::fs::read_to_string(root.join("settings.json"))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Null);
            app.manage(SettingsState(Mutex::new(settings)));
            app.manage(StoreState(Store::new(root)));
            // 에이전트 런타임 (PRD D) — 세션 레지스트리 watch 시작 (FR-D-11)
            app.manage(agent::AgentRt::default());
            app.manage(MsgRate::default()); // 메시지 버스 발신 상한 (M6)
            agent::start_registry_watch(app.handle().clone());
            ipc::start_server(app.handle().clone()); // eqmux CLI 파이프 (PRD I)
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
            transcript_read,
            team_load,
            team_save,
            role_save,
            role_remove,
            library_list,
            library_save_persona,
            library_delete_persona,
            library_save_job,
            library_delete_job,
            preset_list,
            mission_list,
            mission_create,
            mission_set_status,
            mission_assign,
            scrollback_tail,
            scrollback_search,
            scrollback_page,
            store_usage_real,
            events_query,
            msg_list,
            msg_send,
            msg_mark_read,
            ws_pick_folder,
            ws_registry,
            ws_register,
            ws_git_init,
            git_overview,
            ws_clone,
            ws_unregister,
            ws_repath,
            ws_touch,
            clip_read_text,
            clip_write_text,
            clip_save_image,
            sessions_memory,
            ports_snapshot,
            fs_tree,
            fs_preview,
            diff_changed_files,
            diff_file,
            shutdown_flush,
            app_exit,
            crash_recovery,
            layout_load,
            layout_save,
            settings_load,
            settings_save,
            session_log_dir,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("EQMUX 실행 실패");
}
