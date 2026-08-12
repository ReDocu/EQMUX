// IPC (PRD C FR-C-40 계열 · PRD I 운반로) — Windows 명명 파이프 한 줄 요청 / 한 줄 응답.
// 서버는 앱(GUI 1)이고 클라이언트는 eqmux CLI 다수(C7 — 같은 OS 사용자, 파이프 기본 DACL).
// 프로토콜: JSON 한 줄 {"cmd":"ping"|"send"|"report"|"hook", ...} → {"ok":bool, ...} 한 줄.
// send가 여기로 합류하면서 발신 경로는 msg_send 커맨드(사람)와 이 파이프(에이전트) 둘이지만
// 둘 다 messages::send + message-new 방송이라는 같은 원장 경로를 탄다.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

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
        let app2 = app.clone();
        let h_addr = h as usize; // HANDLE(*mut c_void)은 Send가 아니라 usize로 건넨다
        // 연결당 스레드 — 요청 한 줄이라 수명이 짧다. 파일 래핑으로 drop 시 핸들이 닫힌다.
        std::thread::spawn(move || {
            let file = unsafe { std::fs::File::from_raw_handle(h_addr as _) };
            handle_conn(&app2, file);
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

/// 요청 디스패치 — 발신자 신원은 EQMUX_SESSION(세션 id)이고, 워크스페이스·cwd는
/// 앱의 추적 맵(AgentRt)에서 푼다. 클라이언트가 주장하는 값은 세션 id 하나뿐이다.
#[cfg_attr(not(windows), allow(dead_code))]
fn handle(app: &AppHandle, line: &str) -> Result<serde_json::Value, String> {
    let req: serde_json::Value = serde_json::from_str(line).map_err(|_| "BAD_JSON".to_string())?;
    let cmd = req["cmd"].as_str().ok_or("BAD_CMD")?;
    match cmd {
        "ping" => Ok(json!({"ok": true, "app": "eqmux", "version": env!("CARGO_PKG_VERSION")})),
        "send" => {
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            let kind = req["type"].as_str().ok_or("BAD_TYPE")?;
            let body = req["body"].as_str().ok_or("EMPTY")?;
            let to_raw = req["to"].as_str().unwrap_or("@all");
            let (_, t) = crate::find_tracked(app, session).ok_or("UNKNOWN_SESSION")?;
            let to = resolve_recipient(app, &t.ws, &t.cwd, to_raw)?;
            publish(app, &t.ws, session, &to, kind, body)
        }
        "report" => {
            // V4 자기 보고 (FR-G-88) — 스트림에는 report 타입으로, 세션 피드에는 event로
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            let body = req["body"].as_str().ok_or("EMPTY")?;
            let (_, t) = crate::find_tracked(app, session).ok_or("UNKNOWN_SESSION")?;
            let store: State<crate::StoreState> = app.state();
            let _ = store.0.sender().send(crate::store::StoreMsg::Event {
                ws: t.ws.clone(),
                id: Some(session.to_string()),
                kind: "report".into(),
                message: body.chars().take(200).collect(),
            });
            publish(app, &t.ws, session, "나", "report", body)
        }
        "hook" => {
            // 훅 2차 상태 소스 (D3 · FR-D-30 계열) — 모르는 이벤트는 조용히 무시
            let session = req["session"].as_str().ok_or("NO_SESSION")?;
            let event = req["event"].as_str().ok_or("BAD_EVENT")?;
            crate::agent::apply_hook(app, session, event, &req["payload"]);
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
) -> Result<serde_json::Value, String> {
    crate::messages::validate(kind, body)?;
    {
        let rate: State<crate::MsgRate> = app.state();
        let mut map = rate.0.lock().map_err(|e| e.to_string())?;
        let times = map.entry(format!("{ws}/{from}")).or_default();
        if !crate::messages::allow_rate(times, crate::workspace::now_ms() as i64) {
            return Err("RATE_LIMIT".into());
        }
    }
    let store: State<crate::StoreState> = app.state();
    let row = crate::messages::send(&store.0.root(), ws, from, to, kind, body)?;
    let _ = app.emit("message-new", json!({ "workspace": ws, "message": row }));
    Ok(json!({"ok": true, "id": row.id}))
}

/// "@이름" → 세션 id (M4) — 세션 id 그대로 / 페르소나 id / 페르소나 이름(2단 라이브러리) 순서.
/// 세션 id 형식이 `<페르소나>@<워크스페이스>`라서 합성으로 충분하다.
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_recipient(
    app: &AppHandle,
    ws: &str,
    ws_path: &str,
    raw: &str,
) -> Result<String, String> {
    let m = raw.trim().trim_start_matches('@');
    if m.is_empty() || m == "all" {
        return Ok("@all".into());
    }
    if m.contains('@') {
        return Ok(m.to_string()); // 이미 세션 id
    }
    let store: State<crate::StoreState> = app.state();
    let lib = crate::library::list(&store.0.root(), Some(ws_path));
    for p in &lib.personas {
        if p.id == m || p.name == m {
            return Ok(format!("{}@{ws}", p.id));
        }
    }
    Err("UNKNOWN_RECIPIENT".into())
}
