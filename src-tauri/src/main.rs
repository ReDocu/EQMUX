// EQMUX — Tauri 엔트리. SessionService(PRD C)는 이 프로세스의 Rust 백엔드가 소유한다 (C1).
// 같은 바이너리가 CLI(PRD I)도 겸한다 — `eqmux send|report|_hook|_statusline|ping ...`은
// GUI를 띄우지 않고 파이프로 실행 중인 앱에 전달한다. 에이전트 PTY의 PATH에 앱 폴더가
// 앞서 있어 `eqmux`가 바로 잡힌다. 서브커맨드 목록은 cli.rs가 소유한다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(first) = std::env::args().nth(1) {
        if eqmux_lib::is_cli_command(&first) {
            std::process::exit(eqmux_lib::cli_main());
        }
    }
    eqmux_lib::run()
}
