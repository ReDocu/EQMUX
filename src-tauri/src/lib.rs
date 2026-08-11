// M0 스텁 — PTY(portable-pty) · VT(vte) · 저장소(rusqlite)는 M1에서 이 계층 뒤로 들어온다.
// UI·CLI는 SessionService 메시지 API로만 접근한다 (FR-C-01·02).

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("EQMUX 실행 실패");
}
