// IPC (PRD C FR-C-40 계열 · PRD I 운반로) — Windows 명명 파이프 한 줄 요청 / 한 줄 응답.
// 서버는 앱(GUI 1)이고 클라이언트는 eqmux CLI 다수(C7 — 같은 OS 사용자, 파이프 기본 DACL).
// 프로토콜: JSON 한 줄 {"cmd":"ping"|"send"|"report"|"hook", ...} → {"ok":bool, ...} 한 줄.
// send가 여기로 합류하면서 발신 경로는 msg_send 커맨드(사람)와 이 파이프(에이전트) 둘이지만
// 둘 다 messages::send + message-new 방송이라는 같은 원장 경로를 탄다.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

/// 동시 연결 스레드 상한 — CLI는 한 줄 요청/응답이라 정상 부하에서는 한 자릿수다
const MAX_CONNS: usize = 32;
static CONN_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn pipe_path() -> String {
    let user: String = std::env::var("USERNAME")
        .unwrap_or_else(|_| "default".into())
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    format!(r"\\.\pipe\eqmux-bus-{user}")
}

// ── 클라이언트 (CLI 모드) — 명명 파이프는 파일처럼 열린다 ──

#[cfg(windows)]
pub fn request(line: &str) -> std::io::Result<String> {
    use std::io::{BufRead, BufReader, Write};
    let mut last = None;
    for _ in 0..3 {
        match std::fs::OpenOptions::new().read(true).write(true).open(pipe_path()) {
            Ok(mut f) => {
                writeln!(f, "{line}")?;
                let mut resp = String::new();
                BufReader::new(f).read_line(&mut resp)?;
                return Ok(resp.trim().to_string());
            }
            Err(e) => {
                last = Some(e); // 인스턴스 교체 사이의 짧은 창 — 잠깐 쉬고 재시도
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("pipe open failed")))
}

#[cfg(not(windows))]
pub fn request(_line: &str) -> std::io::Result<String> {
    Err(std::io::Error::other("named pipe is windows-only"))
}

// ── 서버 (앱) ──

#[cfg(windows)]
pub fn start_server(app: AppHandle) {
    std::thread::spawn(move || server_loop(app));
}

#[cfg(not(windows))]
pub fn start_server(_app: AppHandle) {}

#[cfg(windows)]
fn server_loop(app: AppHandle) {
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
        PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };
    const PIPE_ACCESS_DUPLEX: u32 = 0x0000_0003;

    let name: Vec<u16> = pipe_path().encode_utf16().chain(std::iter::once(0)).collect();
    loop {
        let h = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                64 * 1024,
                64 * 1024,
                0,
                std::ptr::null_mut(),
            )
        };
        if h == INVALID_HANDLE_VALUE {
            std::thread::sleep(std::time::Duration::from_secs(5));
            continue;
        }
        let connected = unsafe { ConnectNamedPipe(h, std::ptr::null_mut()) } != 0
            || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
        if !connected {
            unsafe { CloseHandle(h) };
            continue;
        }
        // 동시 연결 상한 — 한 줄도 안 보내는 클라이언트가 read_line에 영구 블록되면
        // 스레드+핸들이 무한 누적된다. ponytail: 상한 거부로 막는다, read 타임아웃이 필요해지면 그때
        if CONN_COUNT.load(std::sync::atomic::Ordering::Relaxed) >= MAX_CONNS {
            unsafe { CloseHandle(h) };
            continue;
        }
        CONN_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let app2 = app.clone();
        let h_addr = h as usize; // HANDLE(*mut c_void)은 Send가 아니라 usize로 건넨다
        // 연결당 스레드 — 요청 한 줄이라 수명이 짧다. 파일 래핑으로 drop 시 핸들이 닫힌다.
        std::thread::spawn(move || {
            let file = unsafe { std::fs::File::from_raw_handle(h_addr as _) };
            handle_conn(&app2, file);
            CONN_COUNT.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        });
    }
}

#[cfg(windows)]
fn handle_conn(app: &AppHandle, file: std::fs::File) {
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::FlushFileBuffers;
    use windows_sys::Win32::System::Pipes::DisconnectNamedPipe;

    let mut line = String::new();
    if BufReader::new(&file).read_line(&mut line).is_err() {
        return;
    }
    let resp = match handle(app, line.trim()) {
        Ok(v) => v.to_string(),
        Err(e) => json!({"ok": false, "error": e}).to_string(),
    };
    let _ = writeln!(&file, "{resp}");
    // Disconnect가 미수신 데이터를 버리므로 클라이언트가 읽을 때까지 flush로 기다린다
    unsafe {
        FlushFileBuffers(file.as_raw_handle() as _);
        DisconnectNamedPipe(file.as_raw_handle() as _);
    }
}

/// 세션 신원 검증 (P-1) — 세션 id는 공개 관례(`이름@ws`)라 추측 가능하다. 스폰 시 발급되어
/// EQMUX_TOKEN으로 주입된 논스가 일치해야 그 세션의 발신으로 인정한다. 같은 OS 사용자는
/// 수용 위협이지만(파이프 DACL), 에이전트가 다른 세션을 사칭하는 것은 여기서 막는다.
#[cfg_attr(not(windows), allow(dead_code))]
fn verify_session(app: &AppHandle, session: &str, req: &serde_json::Value) -> Result<(), String> {
    let claimed = req["token"].as_str().unwrap_or("");
    let rt: State<crate::agent::AgentRt> = app.state();
    let ok = rt
        .session_tokens
        .lock()
        .map(|m| m.get(session).map(|t| !claimed.is_empty() && t == claimed).unwrap_or(false))
        .unwrap_or(false);
    if ok { Ok(()) } else { Err("BAD_TOKEN".into()) }
}

/// 요청 디스패치 — 발신자 신원은 EQMUX_SESSION(세션 id) + EQMUX_TOKEN(논스) 쌍이고,
/// 워크스페이스·cwd는 앱의 추적 맵(AgentRt)에서 푼다.
#[cfg_attr(not(windows), allow(dead_code))]
fn handle(app: &AppHandle, line: &str) -> Result<serde_json::Value, String> {
    let req: serde_json::Value = serde_json::from_str(line).map_err(|_| "BAD_JSON".to_string())?;
    let cmd = req["cmd"].as_str().ok_or("BAD_CMD")?;
    match cmd {
        "ping" => Ok(json!({"ok": true, "app": "eqmux", "version": env!("CARGO_PKG_VERSION")})),
        "send" => {
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            verify_session(app, session, &req)?;
            let kind = req["type"].as_str().ok_or("BAD_TYPE")?;
            let body = req["body"].as_str().ok_or("EMPTY")?;
            let to_raw = req["to"].as_str().unwrap_or("@all");
            // 원점은 스폰 관문이 남긴다 — 에이전트 추적 맵을 요구하면 셸 세션은 영영 못 보낸다
            let (ws, cwd) = crate::session_origin(app, session).ok_or("UNKNOWN_SESSION")?;
            let mut extra = crate::messages::Extra::default();
            if let Some(f) = req["file"].as_str() {
                extra.file = Some(crate::messages::attach_file(&cwd, f)?);
            }
            let attached = extra.file.as_ref().map(|f| format!(" · 첨부 {} ({})", rel_path(&cwd, &f.path), fmt_size(f.size)));
            let target = resolve_target(app, &ws, &cwd, to_raw)?;
            let mut resp = send_to(app, &ws, session, target, kind, body, extra)?;
            if let (Some(a), Some(d)) = (attached, resp["delivery"].as_str().map(str::to_string)) {
                resp["delivery"] = json!(format!("{d}{a}"));
            }
            Ok(resp)
        }
        "report" => {
            // V4 자기 보고 (FR-G-88) — 스트림에는 report 타입으로, 세션 피드에는 event로
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            verify_session(app, session, &req)?;
            let body = req["body"].as_str().ok_or("EMPTY")?;
            let done = req["done"].as_bool().unwrap_or(false);
            let (ws, _) = crate::session_origin(app, session).ok_or("UNKNOWN_SESSION")?;
            // 회신 대상은 이번 보고를 적기 전에 찾는다 — 적고 나면 열린 handoff가 닫힌다
            let store: State<crate::StoreState> = app.state();
            let requesters = if done {
                crate::messages::open_requesters(&store.0.root(), &ws, session).unwrap_or_default()
            } else {
                Vec::new()
            };
            let _ = store.0.sender().send(crate::store::StoreMsg::Event {
                ws: ws.clone(),
                id: Some(session.to_string()),
                kind: "report".into(),
                message: body.chars().take(200).collect(),
            });
            let extra = crate::messages::Extra { done, ..Default::default() };
            let mut resp = publish(app, &ws, session, "나", "report", body, &extra)?;
            // 완료 보고는 일을 맡긴 팀원에게도 한 건씩 (작업 완료 신호) — 닫힌 프로젝트 팀원은 건너뛴다
            let dir = directory();
            let mut sent = vec!["나".to_string()];
            for r in &requesters {
                let target = dir.iter().find(|e| e.session == r.sender).cloned();
                if target.is_some() || r.sender.ends_with(&format!("@{ws}")) {
                    let who = target.as_ref().map(|e| e.name.clone()).unwrap_or_else(|| r.sender.split('@').next().unwrap_or(&r.sender).to_string());
                    let who = match &target {
                        Some(e) if e.workspace != ws => format!("{who}@{}", e.project),
                        _ => who,
                    };
                    if send_to(app, &ws, session, Target::One(r.sender.clone(), target), "report", body, extra.clone()).is_ok() {
                        sent.push(format!("{who} (열린 {} {})", r.kind, hhmm(r.ts)));
                    }
                }
            }
            if done {
                crate::agent::notify_report(app, session, body);
            }
            resp["result"] = json!(format!("보고함 → {}", sent.join(" · ")));
            Ok(resp)
        }
        "who" => {
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            verify_session(app, session, &req)?;
            let (ws, _) = crate::session_origin(app, session).ok_or("UNKNOWN_SESSION")?;
            // 직무 칸은 이름으로 (디렉터리에는 id가 온다) — 직무 8종 고정 로스터
            let store: State<crate::StoreState> = app.state();
            let jobs: std::collections::HashMap<String, String> =
                crate::library::list(&store.0.root(), None).jobs.into_iter().map(|j| (j.id, j.name)).collect();
            let dir: Vec<DirEntry> = directory()
                .into_iter()
                .map(|mut e| {
                    if let Some((_, t)) = crate::find_tracked(app, &e.session) {
                        e.status = t.last_status; // 실측 상태가 우선 (C4)
                    }
                    if let Some(n) = jobs.get(&e.job) {
                        e.job = n.clone();
                    }
                    e
                })
                .collect();
            Ok(json!({"ok": true, "result": who_text(&dir, &ws, session)}))
        }
        "hook" => {
            // 훅 2차 상태 소스 (D3 · FR-D-30 계열) — 모르는 이벤트는 조용히 무시
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            verify_session(app, session, &req)?;
            let event = req["event"].as_str().ok_or("BAD_EVENT")?;
            crate::agent::apply_hook(app, session, event, &req["payload"]);
            Ok(json!({"ok": true}))
        }
        "browser" => {
            // 브라우저 패널 조종 (M17 확장) — 결과 문자열은 페이지가 만든 것이라
            // 앱 상태에는 쓰지 않고 CLI 응답으로만 흘린다 (browser.rs 머리말 참고)
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            verify_session(app, session, &req)?;
            let action = req["action"].as_str().ok_or("BAD_ACTION")?;
            let args: Vec<String> = req["args"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            Ok(json!({"ok": true, "result": crate::browser::cli(app, action, &args)?}))
        }
        "statusline" => {
            // statusLine 채널 (FR-D-19) — 세션 누적 비용 수집. 실패도 ok (상태 줄 불가침)
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            verify_session(app, session, &req)?;
            crate::agent::apply_statusline(app, session, &req["payload"]);
            Ok(json!({"ok": true}))
        }
        _ => Err("BAD_CMD".into()),
    }
}

/// 원장 적재 + message-new 방송 — msg_send 커맨드(사람 발신)와 같은 경로
#[cfg_attr(not(windows), allow(dead_code))]
fn publish(
    app: &AppHandle,
    ws: &str,
    from: &str,
    to: &str,
    kind: &str,
    body: &str,
    extra: &crate::messages::Extra,
) -> Result<serde_json::Value, String> {
    crate::messages::validate(kind, body)?;
    crate::messages::check_len(from, body)?; // 무효 발신은 상한을 소모하지 않는다
    {
        // 상한은 받는 프로젝트와 상관없이 발신자 하나로 센다 (프로젝트 간 통신 — 상한 공유)
        let rate: State<crate::MsgRate> = app.state();
        let mut map = rate.0.lock().map_err(|e| e.to_string())?;
        let times = map.entry(format!("{ws}/{from}")).or_default();
        if !crate::messages::allow_rate(times, crate::workspace::now_ms() as i64) {
            return Err("RATE_LIMIT".into());
        }
    }
    let store: State<crate::StoreState> = app.state();
    let row = crate::messages::send_with(&store.0.root(), ws, from, to, kind, body, extra)?;
    let _ = app.emit_to("main", "message-new", json!({ "workspace": ws, "message": row }));
    Ok(json!({"ok": true, "id": row.id}))
}

// ── 세션 디렉터리 (계약 C4) — 프런트가 세션 목록이 바뀔 때마다 통째로 밀어 넣는다 ──

#[derive(serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// 세션 id (`kai@eqmux-1e3b93`) — 원장의 발신·수신 값
    pub session: String,
    /// 워크스페이스 id — 원장(session.db)의 키
    pub workspace: String,
    /// 주소용 프로젝트 이름 — 표시 이름, 겹치면 `-2` (결정 20)
    pub project: String,
    /// 세션 이름
    pub name: String,
    #[serde(default)]
    pub persona: String,
    #[serde(default)]
    pub job: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub slot: Option<u32>,
    #[serde(default)]
    pub status: String,
    /// 손으로 띄운 에이전트 이름 (agentscan) — 상태가 shell인데 이것이 있으면 자동 주입하지 않는다
    #[serde(default)]
    pub agent: String,
}

/// 세션 표시 이름 — 디렉터리(C4)의 세션 이름. 알림 제목 등 Rust가 사람에게 이름을 보일 때 쓴다
pub fn session_name(session: &str) -> Option<String> {
    DIRECTORY.lock().ok()?.iter().find(|e| e.session == session).map(|e| e.name.clone())
}

// ponytail: 전역 잠금 하나 — 세션 수십 개라 충분하다
static DIRECTORY: std::sync::Mutex<Vec<DirEntry>> = std::sync::Mutex::new(Vec::new());

#[tauri::command]
pub fn directory_set(entries: Vec<DirEntry>) {
    if let Ok(mut d) = DIRECTORY.lock() {
        *d = entries;
    }
}

fn directory() -> Vec<DirEntry> {
    DIRECTORY.lock().map(|d| d.clone()).unwrap_or_default()
}

/// 받는 쪽 — 팀 전체(@all, 자기 프로젝트만) 또는 세션 하나. 디렉터리 항목이 없으면(디렉터리를
/// 아직 못 받았을 때의 team.json 폴백) 같은 워크스페이스 세션이다.
#[derive(Debug)]
#[cfg_attr(not(windows), allow(dead_code))]
enum Target {
    All,
    One(String, Option<DirEntry>),
}

fn name_matches(e: &DirEntry, n: &str) -> bool {
    e.name == n || e.persona == n || e.session.split('@').next() == Some(n)
}

/// 복사해서 어디서든 그대로 쓸 수 있는 주소 — 열린 프로젝트 전체에서 이름이 하나뿐이면 `@이름`,
/// 겹치면 `@이름@프로젝트` (시안 T36ZZ `eqmux who`)
fn address(dir: &[DirEntry], e: &DirEntry) -> String {
    if dir.iter().filter(|x| x.name == e.name).count() <= 1 {
        format!("@{}", e.name)
    } else {
        format!("@{}@{}", e.name, e.project)
    }
}

fn pick(found: Vec<&DirEntry>) -> Result<Option<DirEntry>, String> {
    match found.len() {
        0 => Ok(None),
        1 => Ok(Some(found[0].clone())),
        _ => Err(format!(
            "AMBIGUOUS:{}",
            found.iter().map(|e| format!("@{}@{}", e.name, e.project)).collect::<Vec<_>>().join(" · ")
        )),
    }
}

/// 주소 해석 (프로젝트 간 통신 · BR-01) — 열린 모든 워크스페이스의 디렉터리에서 찾는다.
/// 자기 프로젝트에 그 이름이 있으면 그쪽이 이긴다 — 기본 페르소나(카이·노엘…)는 프로젝트마다
/// 겹치므로, 그렇지 않으면 팀 안 메시지마저 모호성 오류가 된다. None = @all.
fn resolve_in(dir: &[DirEntry], my_ws: &str, raw: &str) -> Result<Option<DirEntry>, String> {
    let m = raw.trim().trim_start_matches('@');
    if m.is_empty() || m == "all" {
        return Ok(None);
    }
    if let Some(e) = dir.iter().find(|e| e.session == m) {
        return Ok(Some(e.clone()));
    }
    let hit = if let Some((n, p)) = m.rsplit_once('@') {
        pick(dir.iter().filter(|e| e.project == p && name_matches(e, n)).collect())?
    } else {
        match pick(dir.iter().filter(|e| e.workspace == my_ws && name_matches(e, m)).collect())? {
            Some(e) => Some(e),
            None => pick(dir.iter().filter(|e| name_matches(e, m)).collect())?,
        }
    };
    hit.map(Some).ok_or_else(|| "UNKNOWN_RECIPIENT".into())
}

#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_target(app: &AppHandle, ws: &str, cwd: &str, raw: &str) -> Result<Target, String> {
    let dir = directory();
    // 디렉터리를 아직 못 받았으면(앱 기동 직후) 자기 팀 로스터로만 푼다 — 0.4.2 경로
    if !dir.iter().any(|e| e.workspace == ws) {
        let to = resolve_recipient(ws, cwd, raw)?;
        return Ok(if to == "@all" { Target::All } else { Target::One(to, None) });
    }
    let Some(e) = resolve_in(&dir, ws, raw)? else { return Ok(Target::All) };
    if e.workspace != ws {
        let store: State<crate::StoreState> = app.state();
        let on = crate::workspace::load(&store.0.root())
            .iter()
            .find(|w| w.id == e.workspace)
            .map(|w| w.cross_project)
            .unwrap_or(true);
        if !on {
            return Err(format!("CROSS_PROJECT_OFF:{}", e.project));
        }
    }
    Ok(Target::One(e.session.clone(), Some(e)))
}

/// 발신 + 전달 결과. 다른 프로젝트로 가는 메시지는 두 원장에 적는다 — 각 줄의 project는
/// 상대 쪽 프로젝트 이름이다. 전달(PTY 주입)은 받는 워크스페이스의 message-new가 맡는다.
#[cfg_attr(not(windows), allow(dead_code))]
fn send_to(
    app: &AppHandle,
    ws: &str,
    from: &str,
    target: Target,
    kind: &str,
    body: &str,
    extra: crate::messages::Extra,
) -> Result<serde_json::Value, String> {
    let dir = directory();
    let mine = dir.iter().find(|e| e.workspace == ws).map(|e| e.project.clone()).unwrap_or_else(|| ws.to_string());
    let (to, entry) = match target {
        Target::All => {
            let mut resp = publish(app, ws, from, "@all", kind, body, &extra)?;
            resp["delivery"] = json!(format!("보냄 → 팀 전체 ({mine})"));
            return Ok(resp);
        }
        Target::One(to, entry) => (to, entry),
    };
    let target_ws = entry.as_ref().map(|e| e.workspace.clone()).unwrap_or_else(|| ws.to_string());
    let mut resp = if target_ws == ws {
        publish(app, ws, from, &to, kind, body, &extra)?
    } else {
        let theirs = entry.as_ref().map(|e| e.project.clone());
        let out = crate::messages::Extra { project: theirs, ..extra.clone() };
        let resp = publish(app, ws, from, &to, kind, body, &out)?;
        // 받는 쪽 원장 — 상한은 위에서 이미 한 번 셌다
        let store: State<crate::StoreState> = app.state();
        let inn = crate::messages::Extra { project: Some(mine.clone()), ..extra };
        let row = crate::messages::send_with(&store.0.root(), &target_ws, from, &to, kind, body, &inn)?;
        let _ = app.emit_to("main", "message-new", json!({ "workspace": target_ws, "message": row }));
        resp
    };
    let mut d = delivery(app, &target_ws, &to, entry.as_ref());
    if d == "전달함" {
        // 시안 T36ZZ — `전달함 → 린 (EQMUX)`: 누구에게, 어느 프로젝트로
        let name = entry.as_ref().map(|e| e.name.clone()).unwrap_or_else(|| to.split('@').next().unwrap_or(&to).to_string());
        let project = entry.as_ref().map(|e| e.project.clone()).unwrap_or(mine);
        d = format!("전달함 → {name} ({project})");
    }
    resp["delivery"] = json!(d);
    Ok(resp)
}

/// 첨부 경로 표시 — 세션 작업 폴더 기준 상대 경로 (`.eqmux/notes/a.md`), 밖이면 그대로
fn rel_path(cwd: &str, path: &str) -> String {
    let base = std::fs::canonicalize(cwd).ok().map(|p| p.to_string_lossy().trim_start_matches(r"\\?\").to_string());
    base.and_then(|b| std::path::Path::new(path).strip_prefix(b).ok().map(|r| r.to_string_lossy().replace('\\', "/")))
        .unwrap_or_else(|| path.to_string())
}

/// 3.2KB 꼴
fn fmt_size(n: u64) -> String {
    match n {
        n if n < 1024 => format!("{n}B"),
        n if n < 1024 * 1024 => format!("{:.1}KB", n as f64 / 1024.0),
        n => format!("{:.1}MB", n as f64 / (1024.0 * 1024.0)),
    }
}

/// ms 에포크 → 로컬 HH:MM
fn hhmm(ts: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ts)
        .map(|t| t.with_timezone(&chrono::Local).format("%H:%M").to_string())
        .unwrap_or_default()
}

/// 전달 결과 — conversation.ts deliver()와 같은 규칙(idle이면 전달, 그 밖이면 대기).
/// 상태는 agent.rs 실측이 우선, 맨 셸 세션은 디렉터리 상태. 사람이 그 페인에 치는 중이라
/// 프런트가 미루는 경우는 여기서 모른다 — 메시지는 어쨌든 인박스에 남는다.
#[cfg_attr(not(windows), allow(dead_code))]
fn delivery(app: &AppHandle, ws: &str, session: &str, entry: Option<&DirEntry>) -> String {
    let (status, since) = match crate::find_tracked(app, session) {
        Some((_, t)) => (t.last_status, t.status_ms),
        None => (entry.map(|e| e.status.clone()).unwrap_or_default(), crate::workspace::now_ms()),
    };
    let store: State<crate::StoreState> = app.state();
    let waiting = || crate::messages::count_to_since(&store.0.root(), ws, session, since).unwrap_or(1);
    let role = entry.is_none_or(|e| !e.persona.is_empty()); // 디렉터리 없음(폴백) = team.json 역할 세션
    let manual = entry.is_some_and(|e| !e.agent.is_empty());
    delivery_text(&status, role, manual, waiting)
}

/// conversation.ts deliver()와 같은 갈래 — 어긋나면 CLI는 "전달함"인데 메시지는 인박스에 잔다
fn delivery_text(status: &str, role: bool, manual: bool, waiting: impl FnOnce() -> i64) -> String {
    match status {
        // 기본 터미널에서 손으로 띄운 에이전트 — 레지스트리가 채택하면 idle·busy로도 보인다.
        // 역할 없는 페인의 에이전트는 상태와 상관없이 손으로 띄운 것이다 (BR-02)
        _ if manual && !role => "대기 — 손으로 띄운 에이전트 · 사람이 넣기를 누르면 전달".into(),
        "idle" => "전달함".into(),
        // 꺼진 세션도 프런트 인박스에 남아 재개 때 받는다 — 실패는 영영 안 닿는 경우(이름 없음·닫힘·받기 끔)만
        "dead" => "대기 — 상대 세션 꺼짐 · 켜지면 전달".into(),
        // 사람이 페인에 직접 띄운 에이전트 — 자동으로 넣지 않는다 (BR-02)
        "shell" | "" if manual => "대기 — 손으로 띄운 에이전트 · 사람이 넣기를 누르면 전달".into(),
        "shell" | "" if role => "대기 — 에이전트가 아직 안 떴음 · 뜨면 전달".into(),
        "shell" | "" => "전달함".into(), // 기본 터미널 — 화면에 바로 찍힌다
        "starting" => "대기 — 에이전트 기동 중 · 뜨면 전달".into(),
        _ => format!("대기 — 상대 작업 중 (대기 {}건) · 턴이 끝나면 전달", waiting().max(1)),
    }
}

/// 고정폭 터미널에서의 칸 수 — 한글·CJK·전각은 두 칸
fn cols(s: &str) -> usize {
    s.chars()
        .map(|c| match c as u32 {
            0x1100..=0x115F | 0x2E80..=0xA4CF | 0xAC00..=0xD7A3 | 0xF900..=0xFAFF | 0xFE30..=0xFE4F | 0xFF00..=0xFF60 | 0xFFE0..=0xFFE6 => 2,
            _ => 1,
        })
        .sum()
}

fn pad(s: &str, w: usize) -> String {
    format!("{s}{}", " ".repeat(w.saturating_sub(cols(s))))
}

/// eqmux who (시안 T36ZZ) — 내 프로젝트 먼저, 그다음 프로젝트 이름순 · 슬롯순. 줄 끝 주소는 그대로 --to에 쓴다
fn who_text(dir: &[DirEntry], my_ws: &str, me: &str) -> String {
    let mut rows: Vec<&DirEntry> = dir.iter().collect();
    rows.sort_by_key(|e| (e.workspace != my_ws, e.project.clone(), e.slot.unwrap_or(u32::MAX), e.name.clone()));
    if rows.is_empty() {
        return "열린 세션이 없습니다".into();
    }
    let line = |no: &str, name: &str, project: &str, job: &str, status: &str, addr: &str| {
        format!(" {} {} {} {} {} {addr}", pad(no, 3), pad(name, 15), pad(project, 10), pad(job, 25), pad(status, 9))
            .trim_end()
            .to_string()
    };
    let mut out = vec![line("#", "이름", "프로젝트", "직무 (직함)", "상태", "주소")];
    for e in rows {
        let no = e.slot.map(|n| format!("{n:02}")).unwrap_or_else(|| "--".into());
        let mut name = e.name.clone();
        if !e.persona.is_empty() && e.persona != e.name {
            name = format!("{name} ({})", e.persona);
        }
        if e.session == me {
            name.push_str(" (나)");
        }
        let job = match (e.job.as_str(), e.title.as_deref().filter(|t| !t.is_empty())) {
            ("", None) => "—".to_string(),
            ("", Some(t)) => t.to_string(),
            (j, None) => j.to_string(),
            (j, Some(t)) => format!("{j} ({t})"),
        };
        let status = if e.status.is_empty() { "-" } else { &e.status };
        out.push(line(&no, &name, &e.project, &job, status, &address(dir, e)));
    }
    out.join("\n")
}

/// "@이름" → 세션 id (M4) — 세션 id 그대로 / 슬롯 표시 이름 / 페르소나 id / 페르소나 이름 순서.
/// 세션 id 형식이 `<페르소나>@<워크스페이스>`라서 합성으로 충분하다.
///
/// 후보는 그 워크스페이스의 team.json 로스터다 (B52). 라이브러리 전체를 훑으면 팀에 편성되지
/// 않은 페르소나 이름으로도 '그럴듯한' 세션 id가 합성돼, CLI는 "전송됨"을 찍고 원장에는 적재되고
/// 대화창에는 날 id가 뜨는데 아무도 받지 않는다. 슬롯 표시 이름(P5)을 후보에 넣어 대화 패널의
/// 멘션 규칙과 범위도 맞춘다 — 그쪽에서 되는 이름이 CLI에서만 안 되던 반대 방향의 어긋남.
///
/// 0.5부터는 디렉터리(C4)를 아직 못 받았을 때의 폴백이다. `@`가 든 주소는 자기 워크스페이스
/// 세션 id만 받는다 — 남의 id를 그냥 통과시키면 아무도 받지 않는데 "전송됨"이 찍혔다 (BR-01).
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_recipient(ws: &str, ws_path: &str, raw: &str) -> Result<String, String> {
    let m = raw.trim().trim_start_matches('@');
    if m.is_empty() || m == "all" {
        return Ok("@all".into());
    }
    if m.contains('@') {
        return if m.ends_with(&format!("@{ws}")) { Ok(m.to_string()) } else { Err("UNKNOWN_RECIPIENT".into()) };
    }
    for sl in &crate::team::load(ws_path).slots {
        let display = sl.name.as_deref().unwrap_or(&sl.persona_name);
        if sl.persona == m || sl.persona_name == m || display == m {
            return Ok(format!("{}@{ws}", sl.persona));
        }
    }
    Err("UNKNOWN_RECIPIENT".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(session: &str, ws: &str, project: &str, name: &str) -> DirEntry {
        DirEntry {
            session: session.into(),
            workspace: ws.into(),
            project: project.into(),
            name: name.into(),
            persona: session.split('@').next().unwrap().into(),
            ..Default::default()
        }
    }

    fn dir() -> Vec<DirEntry> {
        vec![
            e("kai@w1", "w1", "app", "카이"),
            e("noel@w1", "w1", "app", "노엘"),
            e("kai@w2", "w2", "app-2", "카이"),
            e("b02@w2", "w2", "app-2", "B02"),
            e("kai@w3", "w3", "tool", "카이"),
        ]
    }

    fn sid(r: Result<Option<DirEntry>, String>) -> Option<String> {
        r.unwrap().map(|e| e.session)
    }

    #[test]
    fn resolves_addresses_across_projects() {
        let d = dir();
        assert_eq!(sid(resolve_in(&d, "w1", "@all")), None); // @all은 자기 프로젝트 (호출부)
        assert_eq!(sid(resolve_in(&d, "w1", "@카이")), Some("kai@w1".into())); // 자기 프로젝트가 이긴다
        assert_eq!(sid(resolve_in(&d, "w1", "@B02")), Some("b02@w2".into())); // 하나뿐이면 다른 프로젝트로
        assert_eq!(sid(resolve_in(&d, "w1", "@카이@app-2")), Some("kai@w2".into()));
        assert_eq!(sid(resolve_in(&d, "w1", "kai@w3")), Some("kai@w3".into())); // 세션 id 그대로
        assert_eq!(sid(resolve_in(&d, "w1", "@kai@tool")), Some("kai@w3".into())); // 페르소나 id도
    }

    #[test]
    fn rejects_unknown_closed_and_ambiguous() {
        let d = dir();
        // BR-01 — 닫힌 프로젝트의 세션 id는 통과시키지 않는다
        assert_eq!(resolve_in(&d, "w1", "@kai@closed-ws").unwrap_err(), "UNKNOWN_RECIPIENT");
        assert_eq!(resolve_in(&d, "w1", "@없는이름").unwrap_err(), "UNKNOWN_RECIPIENT");
        // 내 프로젝트(w9)에 없고 다른 프로젝트 둘 이상 — 복사 가능한 후보 주소
        let err = resolve_in(&d, "w9", "@카이").unwrap_err();
        assert_eq!(err, "AMBIGUOUS:@카이@app · @카이@app-2 · @카이@tool");
    }

    #[test]
    fn fallback_rejects_foreign_session_ids() {
        assert_eq!(resolve_recipient("w1", "", "@kai@w1").unwrap(), "kai@w1");
        assert_eq!(resolve_recipient("w1", "", "@kai@other").unwrap_err(), "UNKNOWN_RECIPIENT");
        assert_eq!(resolve_recipient("w1", "", "@all").unwrap(), "@all");
    }

    #[test]
    fn delivery_text_by_status() {
        assert_eq!(delivery_text("idle", true, false, || 0), "전달함");
        assert_eq!(delivery_text("shell", false, false, || 0), "전달함"); // 기본 터미널 — 화면 에코
        assert!(delivery_text("shell", true, false, || 0).starts_with("대기 — 에이전트가 아직")); // 인박스
        assert!(delivery_text("shell", false, true, || 0).starts_with("대기 — 손으로")); // BR-02 쌓기
        assert!(delivery_text("idle", false, true, || 0).starts_with("대기 — 손으로")); // 채택돼 idle이어도
        assert!(delivery_text("starting", true, false, || 0).starts_with("대기 — "));
        assert_eq!(delivery_text("busy", true, false, || 2), "대기 — 상대 작업 중 (대기 2건) · 턴이 끝나면 전달");
        assert_eq!(delivery_text("waiting", true, false, || 0), "대기 — 상대 작업 중 (대기 1건) · 턴이 끝나면 전달");
        assert_eq!(delivery_text("dead", true, false, || 0), "대기 — 상대 세션 꺼짐 · 켜지면 전달");
    }

    #[test]
    fn size_and_display_width() {
        assert_eq!(fmt_size(900), "900B");
        assert_eq!(fmt_size(3277), "3.2KB");
        assert_eq!(cols("카이 (나)"), 9);
        assert_eq!(cols("—"), 1);
    }

    /// eqmux who (시안 T36ZZ) — 고정폭 표, 내 프로젝트 먼저, 겹치는 이름만 프로젝트를 붙인 주소
    #[test]
    fn who_table_matches_mockup() {
        let mut d = dir();
        d[0].slot = Some(3);
        d[0].persona = "카이".into(); // 디렉터리의 persona는 표시 이름이다 (C4)
        d[0].job = "개발".into();
        d[0].title = Some("클라이언트 개발자".into());
        d[0].status = "busy".into();
        d[1].slot = Some(4);
        d[1].name = "백엔드".into();
        d[1].persona = "노엘".into();
        d[1].job = "개발".into();
        d[1].title = Some("서버 개발자".into());
        d[1].status = "idle".into();
        let t = who_text(&d, "w1", "kai@w1");
        let lines: Vec<&str> = t.lines().collect();
        assert_eq!(lines[0], " #   이름            프로젝트   직무 (직함)               상태      주소");
        assert_eq!(lines[1], " 03  카이 (나)       app        개발 (클라이언트 개발자)  busy      @카이@app");
        assert_eq!(lines[2], " 04  백엔드 (노엘)   app        개발 (서버 개발자)        idle      @백엔드");
        assert!(lines.iter().any(|l| l.ends_with("@B02") && l.contains(" —  "))); // 하나뿐인 이름 · 직무 없음
        assert_eq!(who_text(&[], "w1", "x"), "열린 세션이 없습니다");
    }
}
