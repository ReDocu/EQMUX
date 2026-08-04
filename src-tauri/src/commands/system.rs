//! 앱 자체에 대한 조회 명령.
//!
//! `app_info`가 S1-1의 완료 기준(프런트↔Rust 왕복 1회)을 담당한다.
//! 동시에 이 인스턴스가 격리 인스턴스인지 화면에서 확인하는 창구이기도 하다.

use serde::Serialize;
use tauri::State;

use crate::config::Paths;
use crate::error::Result;
use crate::probe::ProbeConfig;

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub paths: Paths,
    pub probe: ProbeConfig,
}

#[tauri::command]
pub fn app_info(paths: State<'_, Paths>, probe: State<'_, ProbeConfig>) -> Result<AppInfo> {
    Ok(AppInfo {
        name: "EQMUX",
        version: env!("CARGO_PKG_VERSION"),
        paths: paths.inner().clone(),
        probe: probe.inner().clone(),
    })
}

/// 렌더 경로를 stdout으로 남긴다.
///
/// 화면을 보지 않고 렌더러를 확인할 수 있어야 한다 — 관문 A 재측정도, CI도 사람이 안 본다.
/// WebGL이 조용히 DOM으로 폴백해도 글자는 그려지므로, 스크린샷만으로는 판정할 수 없다.
/// 로그는 전부 stderr로 낸다. GUI 서브시스템(`windows_subsystem = "windows"`)에서는
/// stdout 핸들이 붙지 않아 `println!`이 사라진다 — 실제로 여기서 한 번 잃었다.
#[tauri::command]
pub fn report_renderer(status: String) {
    eprintln!("[eqmux][renderer] {status}");
}

/// 프런트 로그·예외를 프로세스 stderr로 끌어낸다.
///
/// 웹뷰 콘솔은 창을 열어야 보인다. 무인 실행에서 프런트가 죽으면
/// **아무 흔적도 남지 않는다** — 실제로 여기서 한 번 눈이 멀었다.
/// 예외·거부는 전부 이 경로로 나온다.
#[tauri::command]
pub fn log_front(level: String, msg: String) {
    eprintln!("[eqmux][front:{level}] {msg}");
}

/// 왕복 지연을 눈으로 보려고 두는 최소 명령.
///
/// 프런트가 보낸 값을 그대로 돌려준다. S1-4에서 PTY 스트림을 붙이기 전까지
/// IPC 경로가 살아 있는지 확인하는 용도다.
#[tauri::command]
pub fn echo(value: String) -> String {
    value
}
