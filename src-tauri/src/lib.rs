// M1 — PTY 계층 (portable-pty). 세션 1개 = PTY 1개 (도메인 모델 불변 규칙).
// VT 파싱은 프런트 xterm.js가 맡고, 여기는 바이트 스트림 중계와 수명 관리만 한다.
// 저장소(rusqlite)·에이전트 훅은 다음 단계에서 이 계층 뒤로 들어온다 (FR-C-01·02).

use std::collections::HashMap;
use std::fs::{create_dir_all, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub(crate) mod agent;
mod agentscan;
mod cli;
mod clip;
mod diff;
mod fsx;
pub(crate) mod ipc;
mod job;
pub(crate) mod library;
pub(crate) mod messages;
mod missions;
mod ports;
mod recovery;
mod roles;
pub(crate) mod store;
mod team;
mod transcript;
pub(crate) mod workspace;
use store::{LineAssembler, Store, StoreMsg};
use workspace::{WsEntry, WsInfo};

pub(crate) struct StoreState(pub(crate) Store);

/// 설정 (PRD J) — 앱데이터 settings.json. 스키마는 프런트 소유(JSON 통과)이며
/// Rust는 알림 게이트(FR-G-30 라우팅) 같은 즉시 참조를 위해 메모리 사본을 든다.
pub(crate) struct SettingsState(pub(crate) Mutex<serde_json::Value>);

pub(crate) fn setting_str(app: &AppHandle, key: &str) -> Option<String> {
    let s: State<SettingsState> = app.state();
    let v = s.0.lock().ok()?;
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

pub(crate) fn setting_bool(app: &AppHandle, key: &str, default: bool) -> bool {
    let s: State<SettingsState> = app.state();
    s.0.lock()
        .ok()
        .and_then(|v| v.get(key).and_then(|x| x.as_bool()))
        .unwrap_or(default)
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    /// 세션별 잠금 — 블로킹 파이프 쓰기를 전역 PtyState 잠금 밖으로 뺀다.
    /// 한 세션의 stdin이 막혀도(먹통 TUI 등) 다른 세션의 write/resize와 pty_kill이 살아 있어야 한다.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
    gen: u64, // 같은 id로 재기동 시 이전 리더 스레드의 정리를 무효화하는 세대 표식
    job: Option<job::Job>, // FR-C-05 — 자식 트리 정리. drop = KILL_ON_JOB_CLOSE
    /// 마지막 resize 시각 (epoch ms) — ConPTY는 리사이즈에 전체 리페인트로 응답하므로,
    /// 코얼레서가 이 직후의 리페인트 버스트를 한 덩어리로 묶는 힌트로 쓴다 (줌/분할 깜빡임 방지)
    resize_hint: Arc<std::sync::atomic::AtomicU64>,
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

fn epoch_ms() -> u64 {
    workspace::now_ms() as u64 // 크레이트 공용 구현 하나만 둔다
}

/// 스토어 대기 배치 flush — ack 채널 왕복 (FR-C-62②·63 공용). true = 시한 안 완료.
fn flush_store(store: &Store, timeout: std::time::Duration) -> bool {
    let (ack_tx, ack_rx) = std::sync::mpsc::channel();
    if store.sender().send(StoreMsg::Flush(ack_tx)).is_err() {
        return false;
    }
    ack_rx.recv_timeout(timeout).is_ok()
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

/// PTY 자식 환경 위생 — 모든 스폰(셸·에이전트)의 단일 관문에서 적용한다.
/// ① 색 계약: xterm.js 프런트는 truecolor를 그린다. 앱이 Claude Code 세션 안에서
///    실행되면(개발 중 `npm run tauri dev`) TERM=dumb이 상속돼 CLI가 무채색으로 떨어진다.
/// ② 세션 정체: 부모의 Claude 세션 마커가 상속되면 여기서 켠 claude가 자식 세션으로
///    인식돼 트랜스크립트 저장을 꺼 버린다 — 페인은 1급 소스(JSONL, FR-G-80)를 잃고
///    스크롤백 폴백으로 떨어진다. 마커를 걷어내고 저장을 강제한다.
fn sanitize_pty_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // NO_COLOR는 TERM보다 우선하는 표준 스위치 — 부모(Claude Code 도구 셸)가 켜 둔 값이
    // 상속되면 TERM을 아무리 올려도 무채색이다. 색이 정체성인 터미널 앱이므로 걷어낸다.
    cmd.env_remove("NO_COLOR");
    for k in [
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_SSE_PORT",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_BRIDGE_SESSION_ID",
        "CLAUDE_PID",
    ] {
        cmd.env_remove(k);
    }
    cmd.env("CLAUDE_CODE_FORCE_SESSION_PERSISTENCE", "1");
    // 부모 도구 셸은 git 프롬프트를 꺼 둔다(끊김 방지) — 여기는 사람이 앉은 대화형
    // 터미널이므로 되살린다. 안 그러면 자격 증명이 필요한 git이 묻지도 않고 실패한다.
    cmd.env_remove("GIT_TERMINAL_PROMPT");
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
    for mut cmd in builders.drain(..) {
        sanitize_pty_env(&mut cmd);
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

    let resize_hint = Arc::new(std::sync::atomic::AtomicU64::new(epoch_ms())); // 스폰 직후 첫 프레임도 크게 묶는다
    sessions.insert(
        id.clone(),
        PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            gen,
            job,
            resize_hint: resize_hint.clone(),
        },
    );
    drop(sessions);

    // 세션 원점 기록 — 셸이든 에이전트든 스폰은 전부 이 관문을 지나므로, 여기 한 곳이면
    // IPC 발신(PRD I)이 어떤 세션에서 와도 워크스페이스를 풀 수 있다 (session_origin).
    {
        let rt: State<agent::AgentRt> = app.state();
        if let Ok(mut origin) = rt.session_origin.lock() {
            origin.insert(id.clone(), (ws.clone(), dir.clone()));
        };
    }

    // 스토어에 세션 시작을 기록 (FR-C-03)
    let store_tx = store_state.0.sender();
    let _ = store_tx.send(StoreMsg::SessionStart {
        ws: ws.clone(),
        id: id.clone(),
        cwd: dir.clone(),
        shell: shell_label,
    });

    // 출력 더블 버퍼링 — 리더의 8KB 청크를 그대로 내보내면 TUI의 지우기+재출력 프레임이
    // 조각나 도착해 중간(지워진) 상태가 렌더되며 깜빡인다. 코얼레서 스레드가 3ms 무입력까지
    // 조각을 묶어 최종 상태만 화면 이벤트로 보낸다. 25ms 시한·256KB 상한으로 지연을 막는다.
    // 리사이즈 직후 400ms는 ConPTY 전체 리페인트가 띄엄띄엄 몰려오므로 25ms/250ms로 길게 묶는다
    // (줌·분할·전체 화면 전환 깜빡임 방지 — 그 동안은 타이핑 지연이 문제되지 않는다).
    let (out_tx, out_rx) = std::sync::mpsc::channel::<String>();
    let emit_hint = resize_hint.clone();
    let emit_app = app.clone();
    let emit_id = id.clone();
    let emitter = std::thread::spawn(move || {
        use std::sync::atomic::Ordering;
        use std::time::{Duration, Instant};
        const QUIET: Duration = Duration::from_millis(3);
        const DEADLINE: Duration = Duration::from_millis(25);
        const CAP: usize = 256 * 1024;
        while let Ok(first) = out_rx.recv() {
            let mut batch = first;
            let start = Instant::now();
            let resizing = epoch_ms().saturating_sub(emit_hint.load(Ordering::Relaxed)) < 400;
            let (quiet, deadline) = if resizing {
                (Duration::from_millis(25), Duration::from_millis(250))
            } else {
                (QUIET, DEADLINE)
            };
            // recv_timeout은 큐에 있으면 즉시 돌아온다 — quiet 무입력 gap·시한·상한이 규칙의 전부다
            while batch.len() < CAP && start.elapsed() < deadline {
                match out_rx.recv_timeout(quiet) {
                    Ok(c) => batch.push_str(&c),
                    Err(_) => break, // 조용/끊김 → 프레임 완성으로 보고 방출
                }
            }
            let _ = emit_app.emit("pty-output", PtyOutput { id: emit_id.clone(), data: batch });
        }
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
                    // SGR 저장 (FR-C-15) — 설정으로 끌 수 있다 (용량 절감). 평문 적재는 계속된다
                    let sgr_on = setting_bool(&app, "sgrStore", true);
                    assembler.push(&data, |line, styled| {
                        // TUI 프레임 잔해·연속 중복은 스필하지 않는다 (재생 오염 방지)
                        if store::is_tui_noise(&line) || line == last_spilled {
                            return;
                        }
                        last_spilled = line.clone();
                        let _ = store_tx.send(StoreMsg::Line {
                            ws: ws.clone(),
                            id: id.clone(),
                            text: line,
                            styled: if sgr_on { styled } else { None },
                        });
                    });
                    let _ = out_tx.send(data);
                }
            }
        }
        // 코얼레서가 잔여 배치를 모두 방출한 뒤에 pty-exit가 나가야 한다 — 순서 보장
        drop(out_tx);
        let _ = emitter.join();
        // 세대가 일치할 때만 정리한다 — 같은 id로 재기동된 새 세션을 지우면 안 된다.
        // 잠금 안에서는 꺼내기만 하고 child.wait()는 잠금 밖에서 한다 (B14) —
        // 잠금을 쥔 채 기다리면 그동안 모든 세션의 pty_write/resize가 멈춘다
        let owned = {
            let state: State<PtyState> = app.state();
            let mut sessions = state.0.lock().ok();
            sessions.as_mut().and_then(|s| {
                if s.get(&id).map(|e| e.gen) == Some(gen) {
                    s.remove(&id)
                } else {
                    None
                }
            })
        };
        let code = owned.and_then(|mut s| s.child.wait().ok()).map(|st| st.exit_code());
        if let Some(f) = log_file.as_mut() {
            let _ = writeln!(f, "\n=== session exit · {} · code {:?} · epoch {} ===", id, code, epoch_secs());
        }
        let sgr_on = setting_bool(&app, "sgrStore", true);
        assembler.finish(|line, styled| {
            let _ = store_tx.send(StoreMsg::Line {
                ws: ws.clone(),
                id: id.clone(),
                text: line,
                styled: if sgr_on { styled } else { None },
            });
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
    // 셸에도 세션 신원을 심는다 (FR-D-04 계열) — 셸 우선 모델이라 사용자가 이 셸에서 손으로
    // `claude`를 띄우는 일이 흔하다. 그 자식 프로세스는 환경을 물려받으므로, 최소한 자기가
    // 누구인지는 알게 된다: eqmux send/report(PRD I)가 성립하고 훅도 세션을 특정할 수 있다.
    // 훅 설정(--settings)과 역할 포인터(--append-system-prompt)는 CLI 플래그라 여기서는
    // 실을 수 없다 — 그건 "에이전트 기동"(agent_spawn) 경로가 담당한다.
    let token = uuid::Uuid::new_v4().to_string();
    {
        let rt: State<agent::AgentRt> = app.state();
        if let Ok(mut tokens) = rt.session_tokens.lock() {
            tokens.insert(id.clone(), token.clone());
        }; // 세미콜론 — if let의 임시값을 rt보다 먼저 떨군다 (agent_spawn과 같은 이유)
    }
    let role_file = {
        let p = roles::role_path(&dir, &id);
        p.exists().then(|| p.to_string_lossy().into_owned())
    };
    let team_md = std::path::Path::new(&dir).join(".eqmux").join("team.md");
    let team_md = team_md.exists().then(|| team_md.to_string_lossy().into_owned());
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
            b.env("EQMUX_SESSION", &id);
            b.env("EQMUX_TOKEN", &token);
            b.env("EQMUX_TERMINAL", "eqmux");
            if let Some(rf) = &role_file {
                b.env("EQMUX_ROLE_FILE", rf);
            }
            if let Some(tf) = &team_md {
                b.env("EQMUX_TEAM_FILE", tf);
            }
            b
        })
        .collect();
    let ws = workspace.unwrap_or_else(|| id.split('@').nth(1).unwrap_or("default").to_string());
    spawn_pty_session(app, id, ws, dir, label, builders, cols, rows).map(|_| ())
}

#[tauri::command]
fn pty_write(state: State<PtyState>, id: String, data: String) -> Result<(), String> {
    // 전역 잠금은 Arc 복제까지만 — 파이프 버퍼가 가득 찬 세션에서 write_all이 블록해도
    // 전역 잠금은 이미 풀려 있어 다른 세션의 write/resize·pty_kill이 막히지 않는다
    let writer = {
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions.get(&id).ok_or("세션 없음")?.writer.clone()
    };
    let mut w = writer.lock().map_err(|e| e.to_string())?;
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(state: State<PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let s = sessions.get(&id).ok_or("세션 없음")?;
    // resize 호출 전에 힌트를 찍는다 — ConPTY 리페인트가 힌트보다 먼저 도착하는 경합 방지
    s.resize_hint.store(epoch_ms(), std::sync::atomic::Ordering::Relaxed);
    s.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// 블록 가능성이 있는 PTY 정리(잡 종료·kill·ConPTY 닫기)를 백그라운드로 보낸다 (B14).
/// 동기 커맨드는 메인 스레드에서 돌므로, ConPTY 닫기가 리더 스레드의 드레인을 기다리는 동안
/// 메인 스레드나 PtyState 잠금을 쥐고 있으면 리더와 교착해 앱 전체가 멈춘다.
fn teardown_session_in_background(mut s: PtySession) {
    std::thread::spawn(move || {
        if let Some(j) = &s.job {
            j.terminate(); // FR-C-05 — 자식 트리까지 즉시 정리
        }
        let _ = s.child.kill();
        // s drop = ConPTY 닫기 — 리더가 남은 출력을 비울 때까지 이 스레드에서만 기다린다
    });
}

#[tauri::command]
fn pty_kill(
    state: State<PtyState>,
    store_state: State<StoreState>,
    rt: State<agent::AgentRt>,
    id: String,
) -> Result<(), String> {
    // 사용자가 의도한 종료 — dead 전이는 나되 OS 알림은 내지 않는다 (G3).
    // 리더 스레드가 pty-exit를 내기 전에 먼저 표시해 둔다 (kill 이후 삽입은 늦을 수 있다)
    if let Ok(mut expected) = rt.expected_exit.lock() {
        expected.insert(id.clone());
    }
    // 잠금 안에서는 map에서 꺼내기만 한다 (B14) — kill·drop을 잠금 아래서 하면
    // EOF를 맞은 리더 스레드(같은 잠금 대기)와 교착하고 모든 pty_write/resize가 따라 멈춘다
    let removed = state.0.lock().map_err(|e| e.to_string())?.remove(&id);
    match removed {
        Some(s) => {
            teardown_session_in_background(s);
            let ws = id.split('@').nth(1).unwrap_or("default").to_string();
            let _ = store_state.0.sender().send(StoreMsg::Event {
                ws,
                id: Some(id.clone()),
                kind: "session-kill".into(),
                message: "사용자 요청으로 종료".into(),
            });
        }
        None => {
            // 세션이 없으면 표시를 되돌린다 — 남겨두면 미래의 정당한 dead 알림 하나를 삼킨다
            if let Ok(mut expected) = rt.expected_exit.lock() {
                expected.remove(&id);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn pty_list(state: State<PtyState>) -> Result<Vec<String>, String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    Ok(sessions.keys().cloned().collect())
}

/// 재생 줄 — text는 평문(노이즈 필터·중복 판정용), styled는 SGR 보존본 (FR-C-15, 있을 때만)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TailLine {
    text: String,
    styled: Option<String>,
}

/// 재시작 복구 (FR-C-31) — 세션의 마지막 N줄. WAL이라 쓰기 스레드와 동시 읽기가 안전하다.
#[tauri::command]
fn scrollback_tail(
    store_state: State<StoreState>,
    workspace: String,
    session: String,
    count: u32,
) -> Result<Vec<TailLine>, String> {
    let path = store::db_path(&store_state.0.root(), &workspace);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    // styled 컬럼은 M32 마이그레이션(쓰기 열림 시 ALTER)이 추가한다 — 아직 없는 구 DB는 평문 폴백
    let styled_q = conn.prepare(
        "SELECT text, styled FROM (SELECT seq, text, styled FROM scrollback WHERE session_id = ?1 ORDER BY seq DESC LIMIT ?2) ORDER BY seq ASC",
    );
    match styled_q {
        Ok(mut stmt) => {
            let rows = stmt
                .query_map(params![session, count], |r| {
                    Ok(TailLine { text: r.get(0)?, styled: r.get(1)? })
                })
                .map_err(|e| e.to_string())?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        }
        Err(_) => {
            let mut stmt = conn
                .prepare(
                    "SELECT text FROM (SELECT seq, text FROM scrollback WHERE session_id = ?1 ORDER BY seq DESC LIMIT ?2) ORDER BY seq ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![session, count], |r| {
                    Ok(TailLine { text: r.get(0)?, styled: None })
                })
                .map_err(|e| e.to_string())?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        }
    }
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

/// 내보내기 결과 — 저장 경로와 실제 기록된 줄 수
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    lines: u64,
}

/// 세션 기록 내보내기 — 저장 대화상자(rfd, ws_pick_folder와 같은 패턴)로 위치를 고른 뒤
/// 스토어 대기 배치를 flush하고 스크롤백 전 줄(VT 제거 평문)을 텍스트로 쓴다.
/// 취소하면 Ok(None) — 취소는 에러가 아니다.
#[tauri::command]
fn scrollback_export(
    store_state: State<StoreState>,
    workspace: String,
    session: String,
    suggested: String,
) -> Result<Option<ExportResult>, String> {
    let Some(dest) = rfd::FileDialog::new()
        .set_title("세션 기록 저장")
        .set_file_name(&suggested)
        .add_filter("텍스트", &["txt"])
        .save_file()
    else {
        return Ok(None);
    };
    // 방금 출력까지 포함되게 flush 먼저 — SQL·스키마는 store 모듈 몫 (search/page와 같은 위임)
    let _ = flush_store(&store_state.0, std::time::Duration::from_secs(2));
    let file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    // 수십만 줄 내보내기 — 기본 8KB 버퍼는 syscall이 너무 잦다
    let mut w = std::io::BufWriter::with_capacity(256 * 1024, file);
    let count = store::export_lines(&store_state.0.root(), &workspace, &session, |line| {
        w.write_all(line.as_bytes())
            .and_then(|_| w.write_all(b"\r\n"))
            .map_err(|e| e.to_string())
    })?;
    w.flush().map_err(|e| e.to_string())?;
    Ok(Some(ExportResult { path: dest.to_string_lossy().into_owned(), lines: count }))
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
    // 이중 호출 가드 (P-8) — 같은 id의 PTY가 이미 살아 있으면 새 uuid로 Tracked를 교체하지
    // 않는다. 교체하면 레지스트리 매칭(FR-D-12)·agent_session 매핑이 전부 실행된 적 없는
    // uuid로 덮여 재개 정보가 파괴된다. 살아 있는 에이전트면 재부착, 셸 PTY면 정리 후 스폰.
    {
        let pty: State<PtyState> = app.state();
        let alive = pty.0.lock().map(|s| s.contains_key(&id)).unwrap_or(false);
        if alive {
            if let Some((cur, t)) = find_tracked(&app, &id) {
                if t.last_status != "dead" {
                    return Ok(cur);
                }
            }
            kill_pty_for_restart(&app, &id);
        }
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
    // 세션 토큰 발급 (P-1) — 파이프 IPC의 신원 증명. 스폰 전에 등록해 기동 직후의
    // 훅 이벤트도 검증을 통과하게 한다. 재스폰마다 새로 발급된다.
    let token = uuid::Uuid::new_v4().to_string();
    {
        let rt: State<agent::AgentRt> = app.state();
        if let Ok(mut tokens) = rt.session_tokens.lock() {
            tokens.insert(id.clone(), token.clone());
        };
    }
    // 상태 줄 표시 모드(FR-D-19)의 원본 경로 — settings_save가 쓰는 그 파일 그대로
    let settings_file = app
        .path()
        .app_data_dir()
        .ok()
        .map(|r| r.join("settings.json").to_string_lossy().into_owned());
    let builders = agent::claude_builders(
        &args,
        &cwd,
        &id,
        role_file.as_deref(),
        settings_file.as_deref(),
        &token,
    );
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

    let seq = agent::next_seq();
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
                seq,
                ..Default::default()
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
            activity: None,
            subagents: 0,
            cost_usd: None,
            resumable: resume,
            version: None,
            exit_code: None,
            degraded: false,
            seq,
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
    // 재시작으로 인한 exit — 구 PTY의 EOF가 새 Tracked 등록보다 빨라도(세대 경합)
    // "종료됨" OS 알림은 내지 않는다. 표식은 그 exit 처리에서 소비된다 (on_pty_exit).
    let rt: State<agent::AgentRt> = app.state();
    if let Ok(mut expected) = rt.expected_exit.lock() {
        expected.insert(id.to_string());
    }
    let state: State<PtyState> = app.state();
    let removed = state.0.lock().ok().and_then(|mut s| s.remove(id));
    if let Some(s) = removed {
        // FR-C-05 — 재시작도 트리째 정리 후 새로 띄운다. 정리는 백그라운드로 (B14 — 메인 스레드 블록 방지)
        teardown_session_in_background(s);
    }
}

pub(crate) fn find_tracked(app: &AppHandle, id: &str) -> Option<(String, agent::Tracked)> {
    let rt: State<agent::AgentRt> = app.state();
    let map = rt.by_uuid.lock().ok()?;
    map.iter()
        .find(|(_, t)| t.app_session == id)
        .map(|(u, t)| (u.clone(), t.clone()))
}

/// 세션의 워크스페이스·cwd — 관리되는 에이전트든 맨 셸이든 같은 답을 준다 (PRD I 발신 경로).
/// 추적 맵(by_uuid)은 agent_spawn에서만 채워지므로 그것만 보면 셸 세션이 발신할 수 없다.
/// 스폰 관문이 남긴 원점을 폴백으로 둔다 — 에이전트는 추적 맵이 더 신선하므로 먼저 본다
/// (워크트리 재기동 등으로 cwd가 바뀌면 추적 맵이 그 값을 들고 있다).
/// 세션별 (잡 프로세스 pid 목록, PTY 세대) — 레지스트리 레코드의 pid를 페인에 잇는 자리.
/// 앱이 띄우지 않은 claude(사용자가 셸에서 직접·재기동)는 sessionId가 앱 발급 UUID와 달라
/// 이름으로는 영영 매칭되지 않는다. 잡은 그 페인의 자식 트리 전체를 담으므로 pid가 답이다.
/// 스캔은 이걸 by_uuid 잠금을 잡기 전에 걷는다 — 두 잠금을 겹쳐 쥐지 않기 위해서다.
pub(crate) fn session_job_pids(app: &AppHandle) -> HashMap<String, (Vec<u32>, u64)> {
    let state: State<PtyState> = app.state();
    let Ok(sessions) = state.0.lock() else {
        return HashMap::new();
    };
    sessions
        .iter()
        .filter_map(|(id, s)| s.job.as_ref().map(|j| (id.clone(), (j.pids(), s.gen))))
        .collect()
}

pub(crate) fn session_origin(app: &AppHandle, id: &str) -> Option<(String, String)> {
    if let Some((_, t)) = find_tracked(app, id) {
        return Some((t.ws, t.cwd));
    }
    let rt: State<agent::AgentRt> = app.state();
    let origin = rt.session_origin.lock().ok()?;
    origin.get(id).cloned()
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
    // 1급 — 이 세션에서 EQMUX가 띄운 에이전트의 uuid 매핑 (FR-D-24)
    if let Some(uuid) = agent_uuid_for(&app, &workspace, &id) {
        if let Ok(d) = transcript::read(&agent::transcript_path(&cwd, &uuid), 200) {
            return Ok(d);
        }
    }
    // 셸 우선 폴백 — 터미널에서 직접 띄운 에이전트는 매핑이 없다. 같은 cwd의 최신
    // 트랜스크립트를 추정해 보여준다 (TUI 잔해투성이 스크롤백 폴백보다 낫다). 추정임은 표시한다.
    let p = agent::latest_transcript(&cwd).ok_or("이 세션에서 실행된 에이전트가 없습니다")?;
    let mut d = transcript::read(&p, 200)?;
    d.guessed = true;
    Ok(d)
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
                    ..Default::default()
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
    /// 워크트리 슬롯(FR-E-62)의 실제 cwd — 디렉터리가 실재할 때만. 없으면(다른 머신 clone 등)
    /// 프런트가 repo 루트 폴백으로 복원한다
    worktree_path: Option<String>,
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
            // 워크트리 세션의 재개는 워크트리 cwd 기준이다 — 트랜스크립트 경로가 cwd 파생(FR-D-03)
            let worktree_path = slot.worktree.then(|| {
                let p = workspace::worktree_dir(&ws_path, &session_id);
                p.join(".git").exists().then(|| p.to_string_lossy().into_owned())
            }).flatten();
            let cwd = worktree_path.as_deref().unwrap_or(&ws_path);
            let resumable = uuid
                .as_deref()
                .map(|u| agent::resumable(cwd, u))
                .unwrap_or(false);
            TeamSlotInfo { slot, agent_session_id: uuid, resumable, worktree_path }
        })
        .collect();
    Ok(out)
}

/// team.json + team.md 저장 (FR-E-11·12·17)
#[tauri::command]
fn team_save(ws_path: String, slots: Vec<team::TeamSlot>) -> Result<(), String> {
    team::save(&ws_path, &slots)
}

/// 세션 워크트리 보장 (FR-E-62 · E1′ 옵트인) — 멱등, 반환은 절대 경로.
/// 의존성(node_modules 등)은 워크트리마다 별도라는 것이 정책이다 (FR-E-64 — 공유하지 않는다).
#[tauri::command]
async fn worktree_ensure(ws_path: String, session: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::worktree_ensure(&ws_path, &session))
        .await
        .map_err(|e| e.to_string())?
}

/// 임무-브랜치 체크아웃 (FR-E-52) — 있으면 checkout, 없으면 -b 생성. E1′ 공유 기본에서는
/// repo 전체(모든 공유 세션)에 영향이 있으므로 호출은 화면의 2단 확인 뒤에만 온다.
#[tauri::command]
async fn ws_checkout(ws_path: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // --end-of-options — 브랜치명이 '-'로 시작해도(크래프트된 ref) git이 옵션으로 오인하지 않게.
        // (`--`는 뒤를 pathspec으로 만들어 브랜치 전환이 아니라 파일 복원이 되므로 쓰면 안 된다)
        if workspace::git(&["checkout", "--end-of-options", &branch], &ws_path).is_ok() {
            return Ok(branch);
        }
        workspace::git(&["checkout", "-b", &branch], &ws_path).map(|_| branch)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── git 패널 워크트리·브랜치 (M36 — orca식 안전 범위) — 커밋 이력을 바꾸지 않는
// 작업 트리 조작만 개방한다: 목록·생성·체크아웃·열기. 삭제(FR-E-64)와
// commit·push·stage(G7 — 실행은 터미널에서 사람이)는 계속 제공하지 않는다.

// 둘 다 git CLI를 띄우므로 blocking 스레드에서 돈다 (git_overview와 같은 이유) — 동기 커맨드는
// 메인 스레드에서 실행되고, 이 둘은 10초 폴링이라 UI 스레드가 매 주기 git을 기다리게 된다.
#[tauri::command]
async fn git_worktrees(ws_path: String) -> Result<Vec<workspace::WorktreeInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::worktree_list(&ws_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_branches(ws_path: String) -> Result<Vec<workspace::BranchInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::branch_list(&ws_path))
        .await
        .map_err(|e| e.to_string())?
}

/// 이름 있는 워크트리 생성 — base ref(브랜치·커밋)에서 분기. 큰 저장소의 체크아웃이
/// 느릴 수 있어 blocking 스레드에서 돈다. 반환은 절대 경로.
#[tauri::command]
async fn worktree_add(ws_path: String, name: String, base: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workspace::worktree_create(&ws_path, &name, base.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 기존 브랜치를 워크트리로 연결 (레일 §워크트리) — 새 브랜치 없이 그 브랜치를 체크아웃
#[tauri::command]
async fn worktree_attach(ws_path: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::worktree_attach(&ws_path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

// ── 경량 KV (assignment_cache 테이블, FR-C-23) — 미확인·인박스 같은 파생 상태의 영속 캐시.
// 파일이 원본인 것(팀·역할·임무)은 여기 넣지 않는다 — DB는 어디까지나 캐시다.

#[tauri::command]
fn cache_get(store_state: State<StoreState>, workspace: String, key: String) -> Option<String> {
    let path = store::db_path(&store_state.0.root(), &workspace);
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    conn.query_row(
        "SELECT value FROM assignment_cache WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .ok()
}

#[tauri::command]
fn cache_set(store_state: State<StoreState>, workspace: String, key: String, value: String) -> Result<(), String> {
    let conn = store::open_db(&store_state.0.root(), &workspace).map_err(|e| e.to_string())?;
    // 스토어 쓰기 스레드와 짧게 경합할 수 있다 — WAL + busy 대기로 흡수한다
    let _ = conn.busy_timeout(std::time::Duration::from_millis(500));
    conn.execute(
        "INSERT OR REPLACE INTO assignment_cache (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

/// 워크스페이스 기본 임무 (FR-E-56, M33) — frontmatter `default: true`, 워크스페이스당 1개
#[tauri::command]
fn mission_set_default(ws_path: String, id: String, on: bool) -> Result<(), String> {
    missions::set_default(&ws_path, &id, on)
}

// ── 역할 라이브러리 (PRD E §4.3) — 전역 앱데이터 + 워크스페이스 오버라이드 2단 ──

/// 라이브러리 목록 (FR-E-20·21) — ws_path를 주면 오버라이드가 병합된다
#[tauri::command]
fn library_list(store_state: State<StoreState>, ws_path: Option<String>) -> library::LibraryData {
    library::list(&store_state.0.root(), ws_path.as_deref())
}

/// 페르소나 저장 (FR-E-28) — 전역 계층에 쓴다. expected_mtime_ms가 있으면 외부 변경
/// 충돌을 검사한다 (P-7 — fsx의 편집 저장과 같은 규칙)
#[tauri::command]
fn library_save_persona(
    store_state: State<StoreState>,
    persona: library::PersonaInfo,
    expected_mtime_ms: Option<i64>,
) -> Result<(), String> {
    library::save_persona(&store_state.0.root(), &persona, expected_mtime_ms)
}

#[tauri::command]
fn library_delete_persona(store_state: State<StoreState>, id: String) -> Result<(), String> {
    library::delete_persona(&store_state.0.root(), &id)
}

// ── 고급 캐릭터 시트 (3단계 페르소나) — personas/<id>.character.md, 존재가 곧 고급 단계 ──

/// 시트 생성 (고급 승급) — 템플릿으로 만들고 절대 경로를 반환. 이미 있으면 그대로 (멱등)
#[tauri::command]
fn library_character_create(store_state: State<StoreState>, id: String, name: String) -> Result<String, String> {
    library::create_character(&store_state.0.root(), &id, &name)
}

#[tauri::command]
fn library_character_read(store_state: State<StoreState>, id: String) -> Result<library::CharacterSheet, String> {
    library::read_character(&store_state.0.root(), &id)
}

/// 시트 저장 — 페르소나 저장과 같은 외부 변경 충돌 규칙 (P-7)
#[tauri::command]
fn library_character_save(
    store_state: State<StoreState>,
    id: String,
    content: String,
    expected_mtime_ms: Option<i64>,
) -> Result<(), String> {
    library::save_character(&store_state.0.root(), &id, &content, expected_mtime_ms)
}

/// 시트 삭제 (중간 이하로 강등) — 없는 파일은 성공 (멱등)
#[tauri::command]
fn library_character_delete(store_state: State<StoreState>, id: String) -> Result<(), String> {
    library::delete_character(&store_state.0.root(), &id)
}

/// 직무 저장 (FR-E-28) — 전역 계층에 쓴다. 편집·복제(새 id로 저장)가 이 경로 하나다
#[tauri::command]
fn library_save_job(
    store_state: State<StoreState>,
    job: library::JobInfo,
    expected_mtime_ms: Option<i64>,
) -> Result<(), String> {
    library::save_job(&store_state.0.root(), &job, expected_mtime_ms)
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

// ── 외부 편집 watch (FR-E-73, M35) — 열린 워크스페이스의 .eqmux를 감시해 프런트에 알린다.
// 파일이 원본이고 UI는 따라간다 (FR-E-74) — 감지는 알림일 뿐, 반영은 프런트의 재실측이 한다.

pub(crate) struct WatchState(pub(crate) Mutex<HashMap<String, notify::RecommendedWatcher>>);

/// 감시 등록 — 멱등이 아니라 **교체**다: 프런트가 변경 이벤트 후 다시 부르면 그 사이 새로 생긴
/// 하위 디렉터리(missions/ 등)까지 다시 잡는다. worktrees/(에이전트 작업 폭주)·roles/(앱 산출)는
/// 아예 감시 경로에 넣지 않는다 — 재귀 감시가 아니라 존재하는 디렉터리별 비재귀 감시라서다.
#[tauri::command]
fn ws_watch(
    app: AppHandle,
    watch: State<WatchState>,
    workspace_id: String,
    ws_path: String,
) -> Result<(), String> {
    use notify::{recommended_watcher, RecursiveMode, Watcher};
    let eqmux = Path::new(&ws_path).join(".eqmux");
    if !eqmux.exists() {
        return Ok(()); // .eqmux가 아직 없다 — 편성이 저장되면 프런트가 다시 부른다
    }
    let app2 = app.clone();
    let ws_id = workspace_id.clone();
    let mut w = recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        let Ok(event) = res else { return };
        // 원자적 쓰기 중간 산출(*.tmp)과 앱 전용 경로는 무시한다
        let relevant = event.paths.iter().any(|p| {
            let s = p.to_string_lossy().replace('\\', "/");
            !s.ends_with(".tmp") && !s.contains("/.eqmux/roles/") && !s.contains("/.eqmux/worktrees/")
        });
        if relevant {
            let _ = app2.emit(
                "eqmux-file-change",
                serde_json::json!({ "workspaceId": ws_id }),
            );
        }
    })
    .map_err(|e| e.to_string())?;
    // .eqmux 직속(team.json·team.md·하위 디렉터리 생성) + 존재하는 원본 디렉터리들 — 전부 비재귀
    w.watch(&eqmux, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    for sub in ["missions", "jobs", "personas"] {
        let dir = eqmux.join(sub);
        if dir.is_dir() {
            let _ = w.watch(&dir, RecursiveMode::NonRecursive);
        }
    }
    let mut map = watch.0.lock().map_err(|e| e.to_string())?;
    map.insert(workspace_id, w); // 기존 watcher는 drop = 감시 해제
    Ok(())
}

#[tauri::command]
fn ws_unwatch(watch: State<WatchState>, workspace_id: String) {
    if let Ok(mut map) = watch.0.lock() {
        map.remove(&workspace_id);
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

/// 항목마다 git을 2번 부른다(inspect) — 등록 수만큼 늘어나므로 blocking 스레드에서 돈다.
/// 파일 워처가 .eqmux 변화마다 다시 부르는 경로라 메인 스레드에 두면 그때마다 UI가 멈춘다.
#[tauri::command]
async fn ws_registry(store_state: State<'_, StoreState>) -> Result<Vec<WsInfo>, String> {
    let root = store_state.0.root();
    tauri::async_runtime::spawn_blocking(move || {
        workspace::load(&root).iter().map(workspace::inspect).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// 등록 (FR-E-01) — git 저장소가 아니면 "NOT_A_REPO"를 돌려주고 프런트가 git init을 묻는다
#[tauri::command]
async fn ws_register(store_state: State<'_, StoreState>, path: String) -> Result<WsInfo, String> {
    let root = store_state.0.root();
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).is_dir() {
            return Err("폴더를 찾을 수 없습니다".to_string());
        }
        if !workspace::is_repo(&path) {
            return Err("NOT_A_REPO".to_string());
        }
        let mut list = workspace::load_strict(&root)?;
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn ws_git_init(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || workspace::git(&["init"], &path).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
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
        workspace::git_long(&["clone", &url], &parent)?; // 분 단위가 정상 — 기본 상한을 씌우면 잘린다
        Ok(Path::new(&parent).join(name).to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 등록 해제 (FR-E-09) — 레지스트리에서만 지운다
#[tauri::command]
fn ws_unregister(store_state: State<StoreState>, id: String) -> Result<(), String> {
    let root = store_state.0.root();
    let mut list = workspace::load_strict(&root)?;
    list.retain(|e| e.id != id);
    workspace::save(&root, &list)
}

/// 경로 재지정 (FR-E-08)
#[tauri::command]
async fn ws_repath(
    store_state: State<'_, StoreState>,
    id: String,
    path: String,
) -> Result<WsInfo, String> {
    let root = store_state.0.root();
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).is_dir() {
            return Err("폴더를 찾을 수 없습니다".to_string());
        }
        let mut list = workspace::load_strict(&root)?;
        let entry = list.iter_mut().find(|e| e.id == id).ok_or("등록 항목 없음")?;
        entry.path = path;
        entry.name = workspace::entry_name(&entry.path);
        entry.last_used = workspace::now_ms();
        let info = workspace::inspect(entry);
        workspace::save(&root, &list)?;
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn ws_touch(store_state: State<StoreState>, id: String) -> Result<(), String> {
    let root = store_state.0.root();
    let mut list = workspace::load_strict(&root)?;
    let Some(entry) = list.iter_mut().find(|e| e.id == id) else {
        return Ok(()); // 없는 id면 쓸 것도 없다 — 불필요한 덮어쓰기 방지
    };
    entry.last_used = workspace::now_ms();
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSample {
    id: String,
    agent: String,
}

/// 세션 에이전트 감지 (셸 우선 모델) — Job pid 트리에서 알려진 에이전트 CLI(claude/codex 등)를
/// 찾는다. 관측 전용 · 프런트가 주기 폴링 · 이벤트 적재 없음. 미검출 세션은 목록에서 빠진다.
#[tauri::command]
fn sessions_agents(state: State<PtyState>) -> Vec<AgentSample> {
    // 잠금 아래서는 pid 목록만 복사한다 — OpenProcess 등 시스템 호출로 잠금을 쥐지 않는다 (B14)
    let pid_sets: Vec<(String, Vec<u32>)> = {
        let Ok(sessions) = state.0.lock() else {
            return Vec::new();
        };
        sessions
            .iter()
            .filter_map(|(id, s)| s.job.as_ref().map(|j| (id.clone(), j.pids())))
            .collect()
    };
    pid_sets
        .into_iter()
        .filter_map(|(id, pids)| agentscan::detect(&pids).map(|a| AgentSample { id, agent: a.into() }))
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

/// 커밋의 변경 파일 목록 (UI 리파인 §git) — 부모 ↔ 커밋, 읽기 전용
#[tauri::command]
async fn commit_changed_files(ws_path: String, hash: String) -> Result<Vec<diff::ChangedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || diff::commit_changed_files(&ws_path, &hash))
        .await
        .map_err(|e| e.to_string())?
}

/// 부모 커밋 ↔ 커밋 양측 비교 (UI 리파인 §git) — 읽기 전용
#[tauri::command]
async fn commit_file_diff(ws_path: String, hash: String, path: String) -> Result<diff::FileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || diff::commit_file_diff(&ws_path, &hash, &path))
        .await
        .map_err(|e| e.to_string())?
}

// 탐색기 트리·미리보기·파일 CRUD 커맨드는 fsx.rs가 소유한다 (M24 · 리팩토링으로 이동)

// ── 종료 시퀀스 (FR-C-60~63) — ①입력 차단(프런트) → ②flush → ③정상 종료 신호 → ④유예 후 트리 종료 ──

/// ② 스크롤백·세션 매핑 flush — 2초 목표 (FR-C-63). true = 완료, false = 시한 초과(진행은 계속).
#[tauri::command]
fn shutdown_flush(store_state: State<StoreState>) -> bool {
    flush_store(&store_state.0, std::time::Duration::from_secs(2))
}

/// ③④ 전 세션에 Ctrl+C(정상 종료 신호) → 유예 → Job Object 트리 종료 → 앱 종료.
/// 종료 직전 마지막 flush를 한 번 더 시도한다 (세션 exit 이벤트까지 적재).
#[tauri::command]
async fn app_exit(app: AppHandle) {
    let state: State<PtyState> = app.state();
    // ③ 정상 종료 신호 — TUI 에이전트가 스스로 정리할 기회.
    // writer Arc만 복제해 전역 잠금 밖에서 쓴다 (B14) — 막힌 파이프가 종료를 못 멈추게
    let writers: Vec<_> = match state.0.lock() {
        Ok(sessions) => sessions.values().map(|s| s.writer.clone()).collect(),
        Err(_) => Vec::new(),
    };
    for w in writers {
        if let Ok(mut w) = w.lock() {
            let _ = w.write_all(b"\x03");
            let _ = w.flush();
        }
    }
    tokio_sleep(std::time::Duration::from_millis(500)).await; // ④ 유예
    // 잠금 안에서는 map을 비우기만 한다 (B14) — kill·ConPTY drop을 잠금 아래서 하면
    // EOF를 맞은 리더 스레드(같은 잠금 대기)와 교착해 종료 시퀀스가 영영 멈춘다
    let drained: Vec<(String, PtySession)> = match state.0.lock() {
        Ok(mut sessions) => sessions.drain().collect(),
        Err(_) => Vec::new(),
    };
    for (_, s) in drained {
        if let Some(j) = &s.job {
            j.terminate(); // FR-C-05 — 트리째
        }
        let mut child = s.child;
        let _ = child.kill();
        // 나머지 필드 drop = ConPTY 닫기. 리더가 잔여 출력을 비울 때까지 여기서(잠금 밖) 기다린다
    }
    // 리더들이 EOF 후 마지막 줄·SessionExit을 store 채널에 넣을 짧은 유예 —
    // flush보다 늦게 도착하면 exit 기록이 유실돼 다음 dirty 시작에서 크래시 세션으로 오인된다
    tokio_sleep(std::time::Duration::from_millis(200)).await;
    // 세션 exit 기록까지 flush (최대 1초 — 이미 ②를 거쳤으므로 잔량은 적다)
    let store: State<StoreState> = app.state();
    let _ = flush_store(&store.0, std::time::Duration::from_secs(1));
    // 클린 종료 표식 제거 (FR-C-35) — 이 줄에 도달했다는 것이 곧 정상 종료의 정의다
    let _ = std::fs::remove_file(store.0.root().join("running.flag"));
    app.exit(0);
}

/// 웹뷰 재시작 복구 (FR-C-06) — 추적 중인 에이전트 상태의 현재 스냅숏.
/// **살아 있는 PTY가 있는 세션만** 준다 — 죽은 세션은 재개 제안(FR-C-33)의 몫이라
/// 스냅숏이 restored 상태를 덮어 제안 카드를 지워버리면 안 된다.
#[tauri::command]
fn agent_snapshot(app: AppHandle) -> Vec<agent::AgentStateEvt> {
    let pty: State<PtyState> = app.state();
    let alive: std::collections::HashSet<String> = match pty.0.lock() {
        Ok(s) => s.keys().cloned().collect(),
        Err(_) => return Vec::new(),
    };
    let rt: State<agent::AgentRt> = app.state();
    let Ok(map) = rt.by_uuid.lock() else {
        return Vec::new();
    };
    map.iter()
        .filter(|(_, t)| alive.contains(&t.app_session))
        .map(|(uuid, t)| agent::AgentStateEvt {
            session: t.app_session.clone(),
            agent_session: uuid.clone(),
            status: t.last_status.clone(),
            waiting_for: t.last_waiting.clone(),
            activity: t.activity.clone(),
            subagents: t.subagents,
            cost_usd: t.cost_usd,
            resumable: agent::resumable(&t.cwd, uuid),
            version: None,
            exit_code: None,
            degraded: t.degraded,
            seq: t.seq, // P-4 — 스냅숏은 마지막 발급 순번 그대로 (실시간 이벤트와 역전 판별)
        })
        .collect()
}

/// 세션 영구 제거 (P-9) — 추적 맵·알림 게이트·IPC 토큰의 잔류 항목을 걷어낸다.
/// pty_kill과 별개다 — kill은 중지(재개 가능성 유지)일 수 있지만 제거는 정체성의 끝이다.
#[tauri::command]
fn agent_forget(app: AppHandle, id: String) {
    agent::forget_session(&app, &id);
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
    workspace::atomic_write(&root.join("settings.json"), json.as_bytes())?;
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
    workspace::atomic_write(&root.join("layout.json"), json.as_bytes())
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

/// 터미널 링크 열기 (PRD A 링크 감지, M30) — http/https만 기본 브라우저로.
/// rundll32는 인자를 셸 재파싱 없이 받으므로 URL의 `&`가 명령 분리로 새지 않는다.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("http/https URL만 열 수 있습니다".into());
    }
    use std::os::windows::process::CommandExt;
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 네이티브 클립보드 커맨드는 clip.rs가 소유한다 (리팩토링으로 이동)

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
            // 역할 주입 (FR-D-05 · §10.2) — 세션 시작에 역할 파일을 컨텍스트로 싣는다.
            // --append-system-prompt 포인터는 "읽어라"는 지시일 뿐이라 모델이 건너뛸 수 있다.
            "SessionStart": hook("SessionStart"),
            "UserPromptSubmit": hook("UserPromptSubmit"),
            "Stop": hook("Stop"),
            "Notification": hook("Notification"),
            // 2차 소스 부연 (FR-D-15·18) — 상태가 아니라 activity(도구명)·subagents를 채운다
            "PreToolUse": hook("PreToolUse"),
            "PostToolUse": hook("PostToolUse"),
            "SubagentStart": hook("SubagentStart"),
            "SubagentStop": hook("SubagentStop"),
        },
        // statusLine 채널 (FR-D-19 · §10.4) — 주기 호출의 stdin JSON에서 비용을 수집하고,
        // stdout 첫 줄로 Claude Code 상태 줄을 그린다 (eqmux _statusline)
        "statusLine": { "type": "command", "command": "eqmux _statusline" }
    });
    let _ = std::fs::create_dir_all(root);
    let _ = std::fs::write(root.join("hook-settings.json"), v.to_string());
}

/// CLI 모드 엔트리 (PRD I) — main.rs가 argv 첫 토큰으로 분기한다. GUI를 띄우지 않는다.
pub fn cli_main() -> i32 {
    cli::run(std::env::args().skip(1).collect())
}

/// main.rs의 분기 판별 — CLI 서브커맨드 목록의 단일 원천은 cli.rs다.
pub fn is_cli_command(cmd: &str) -> bool {
    cli::is_cli_command(cmd)
}

/// 모르는 인자로 불렸을 때의 종료 코드 (main.rs 게이트) — 사용법만 낸다.
pub fn cli_usage() -> i32 {
    cli::usage_exit()
}

/// 단일 인스턴스 (P-10) — 이미 떠 있으면 그 창을 앞으로 끌어오고 true를 준다.
/// 창이 여럿이면 파이프 서버가 이중화되어(PIPE_UNLIMITED_INSTANCES) 에이전트의 send가
/// 세션을 모르는 쪽으로 흘러 사라지고, running.flag가 서로의 크래시 표식을 덮어쓴다.
/// 뮤텍스 핸들은 일부러 닫지 않는다 — 프로세스가 살아 있는 동안 소유가 유지되어야 한다.
#[cfg(windows)]
fn another_instance_running() -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let name = wide("Local\\eqmux-single-instance");
    let h = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
    if h.is_null() {
        return false; // 뮤텍스를 못 만들면 가드를 포기한다 — 앱을 막지는 않는다
    }
    if unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
        // 우리가 첫 인스턴스다. 핸들은 닫지 않는다 — 프로세스가 끝날 때 OS가 회수하며,
        // 그 전까지 소유가 유지되어야 두 번째 프로세스가 여기서 걸린다.
        return false;
    }
    // 이미 하나 떠 있다 — 사람이 아이콘으로 연 것일 수 있으니 그 창을 앞으로 끌어온다
    let title = wide("EQMUX");
    let win = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
    if !win.is_null() {
        unsafe {
            ShowWindow(win, SW_RESTORE);
            SetForegroundWindow(win);
        }
    }
    true
}

#[cfg(not(windows))]
fn another_instance_running() -> bool {
    false
}

pub fn run() {
    if another_instance_running() {
        return; // 창은 하나뿐이다 — 두 번째 프로세스는 조용히 물러난다
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(PtyState::default())
        .setup(|app| {
            // 스토어 루트 = 앱 데이터 (FR-C-20a — repo 안에 바이너리를 두지 않는다)
            let root = app.path().app_data_dir()?;
            // 설치·갱신 후 첫 실행 감지 — 데이터 버전 표식이 현재 앱 버전과 다르면
            // 이전 설치가 남긴 데이터를 전부 비우고 새로 시작한다
            let ver_file = root.join("data.ver");
            let cur_ver = app.package_info().version.to_string();
            if std::fs::read_to_string(&ver_file).ok().as_deref() != Some(cur_ver.as_str()) {
                // 사용자 저작물은 wipe에서 제외한다 — 설정과 커스텀 페르소나·직무·프리셋은
                // 버전과 무관한 사용자 자산이다. 세션 기록·레지스트리·레이아웃만 비운다.
                const PRESERVED: [&str; 4] = ["settings.json", "jobs", "personas", "presets"];
                // 삭제가 실패하면(AV·열린 핸들 — Windows에서 흔함) 표식을 갱신하지 않는다.
                // 반쯤 지워진 상태에 새 버전이 찍히면 다음 실행부터 재시도조차 안 하기 때문.
                let mut wiped = true;
                if let Ok(entries) = std::fs::read_dir(&root) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if PRESERVED.contains(&name.as_str()) {
                            continue;
                        }
                        let p = entry.path();
                        let ok = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
                        if ok.is_err() {
                            wiped = false;
                        }
                    }
                }
                std::fs::create_dir_all(&root)?;
                if wiped {
                    let _ = std::fs::write(&ver_file, &cur_ver);
                }
            } else {
                std::fs::create_dir_all(&root)?;
            }
            library::seed(&root); // 역할 라이브러리 시드 (FR-E-27) — 디렉터리가 없을 때만
            write_hook_settings(&root); // --settings 주입용 훅 합성 파일 (D3)
            // 비정상 종료 감지 (FR-C-35) — 표식이 남아 있으면 직전 실행이 크래시였다.
            // 정상 종료는 app_exit 끝에서 표식을 지운다.
            let dirty = root.join("running.flag").exists();
            let _ = std::fs::write(root.join("running.flag"), b"1");
            app.manage(recovery::DirtyStart(Mutex::new(dirty)));
            // 설정 로드 (PRD J) — 손상되면 Null로 시작 (프런트 기본값이 받친다)
            let settings = std::fs::read_to_string(root.join("settings.json"))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Null);
            app.manage(SettingsState(Mutex::new(settings)));
            app.manage(StoreState(Store::new(root)));
            // 에이전트 런타임 (PRD D) — 세션 레지스트리 watch 시작 (FR-D-11)
            app.manage(agent::AgentRt::default());
            app.manage(WatchState(Mutex::new(HashMap::new()))); // 외부 편집 watch (FR-E-73)
            app.manage(MsgRate::default()); // 메시지 버스 발신 상한 (M6)
            agent::start_registry_watch(app.handle().clone());
            ipc::start_server(app.handle().clone()); // eqmux CLI 파이프 (PRD I)
            // 웹뷰 렌더러 크래시 생존 (FR-C-06) — ProcessFailed → Reload. PTY는 Rust가
            // 소유하므로 세션은 죽지 않고, 리로드된 프런트가 pty_list·agent_snapshot으로
            // 재부착한다 (restoreTeams). 실패해도 앱은 정상 — 등록은 최선 노력이다.
            #[cfg(windows)]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.with_webview(|wv| unsafe {
                    let controller = wv.controller();
                    let Ok(core) = controller.CoreWebView2() else { return };
                    let handler = webview2_com::ProcessFailedEventHandler::create(Box::new(
                        move |sender: Option<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2>, _args| {
                            if let Some(core) = sender {
                                let _ = core.Reload();
                            }
                            Ok(())
                        },
                    ));
                    let mut token: i64 = 0;
                    let _ = core.add_ProcessFailed(&handler, &mut token);
                });
            }
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
            agent_forget,
            transcript_read,
            team_load,
            team_save,
            worktree_ensure,
            worktree_add,
            worktree_attach,
            git_worktrees,
            git_branches,
            ws_checkout,
            cache_get,
            cache_set,
            role_save,
            role_remove,
            library_list,
            library_save_persona,
            library_delete_persona,
            library_character_create,
            library_character_read,
            library_character_save,
            library_character_delete,
            library_save_job,
            library_delete_job,
            preset_list,
            mission_list,
            mission_create,
            mission_set_status,
            mission_set_default,
            mission_assign,
            scrollback_tail,
            scrollback_search,
            scrollback_page,
            scrollback_export,
            store_usage_real,
            events_query,
            msg_list,
            msg_send,
            msg_mark_read,
            ws_pick_folder,
            ws_watch,
            ws_unwatch,
            ws_registry,
            ws_register,
            ws_git_init,
            git_overview,
            ws_clone,
            ws_unregister,
            ws_repath,
            ws_touch,
            clip::clip_read_text,
            clip::clip_write_text,
            clip::clip_save_image,
            sessions_memory,
            sessions_agents,
            ports_snapshot,
            fsx::fs_tree,
            fsx::fs_preview,
            fsx::fs_read,
            fsx::fs_write,
            fsx::fs_create,
            fsx::fs_rename,
            fsx::fs_delete,
            diff_changed_files,
            diff_file,
            commit_changed_files,
            commit_file_diff,
            shutdown_flush,
            app_exit,
            recovery::crash_recovery,
            agent_snapshot,
            layout_load,
            layout_save,
            settings_load,
            settings_save,
            session_log_dir,
            open_log_dir,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("EQMUX 실행 실패");
}
