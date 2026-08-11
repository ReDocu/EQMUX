// EQMUX — Tauri 엔트리. SessionService(PRD C)는 이 프로세스의 Rust 백엔드가 소유한다 (C1).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eqmux_lib::run()
}
