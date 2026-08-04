//! 앱 자체에 대한 조회 명령.
//!
//! `app_info`가 S1-1의 완료 기준(프런트↔Rust 왕복 1회)을 담당한다.
//! 동시에 이 인스턴스가 격리 인스턴스인지 화면에서 확인하는 창구이기도 하다.

use serde::Serialize;
use tauri::State;

use crate::appdata::{self, AppDataReport, AppDataWatch};
use crate::config::Paths;
use crate::error::Result;
use crate::probe::{FontProbeConfig, ProbeConfig, PtyProbeConfig};

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub paths: Paths,
    pub probe: ProbeConfig,
    pub pty_probe: PtyProbeConfig,
    pub font_probe: FontProbeConfig,
    /// 자동 감지된 셸. 화면 없이도 무엇이 뜰지 알 수 있어야 한다.
    pub shell: String,
}

#[tauri::command]
pub fn app_info(
    paths: State<'_, Paths>,
    probe: State<'_, ProbeConfig>,
    pty_probe: State<'_, PtyProbeConfig>,
    font_probe: State<'_, FontProbeConfig>,
) -> Result<AppInfo> {
    Ok(AppInfo {
        name: "EQMUX",
        version: env!("CARGO_PKG_VERSION"),
        paths: paths.inner().clone(),
        probe: probe.inner().clone(),
        pty_probe: pty_probe.inner().clone(),
        font_probe: font_probe.inner().clone(),
        shell: crate::pty::detect_shell(),
    })
}

/// 앱 데이터 폴더 크기 (`S2-1b` · [`docs/issue.md`] #7).
///
/// **`async`인 이유** — 동기 명령은 메인 스레드에서 돈다. 지금은 폴더가 14 MB라 몇십 ms지만
/// 캐시는 자라라고 있는 물건이고(wmux 497.6 MB), 그때 이 훑기가 입력을 막으면
/// 용량을 보려다 지연을 만든다. 상태줄 하나 때문에 A-3을 깎을 이유가 없다.
#[tauri::command(async)]
pub fn app_data_report(paths: State<'_, Paths>, watch: State<'_, AppDataWatch>) -> AppDataReport {
    let report = appdata::scan(paths.inner());
    // 화면을 안 봐도 증가가 로그에 남아야 한다. 많이 움직였을 때만 찍는다.
    appdata::log_if_grown(&report, watch.inner());
    report
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
