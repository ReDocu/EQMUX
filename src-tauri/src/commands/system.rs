//! 앱 자체에 대한 조회 명령.
//!
//! `app_info`가 S1-1의 완료 기준(프런트↔Rust 왕복 1회)을 담당한다.
//! 동시에 이 인스턴스가 격리 인스턴스인지 화면에서 확인하는 창구이기도 하다.

use serde::Serialize;
use tauri::State;

use crate::config::Paths;
use crate::error::Result;

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub paths: Paths,
}

#[tauri::command]
pub fn app_info(paths: State<'_, Paths>) -> Result<AppInfo> {
    Ok(AppInfo {
        name: "EQMUX",
        version: env!("CARGO_PKG_VERSION"),
        paths: paths.inner().clone(),
    })
}

/// 왕복 지연을 눈으로 보려고 두는 최소 명령.
///
/// 프런트가 보낸 값을 그대로 돌려준다. S1-4에서 PTY 스트림을 붙이기 전까지
/// IPC 경로가 살아 있는지 확인하는 용도다.
#[tauri::command]
pub fn echo(value: String) -> String {
    value
}
