//! PTY 명령 (`S1-2` · `S1-4`).
//!
//! 출력은 명령이 아니라 이벤트(`pty://data`)로 나간다 — 이유는 `pty.rs` 머리말 ②.

use tauri::{AppHandle, State};

use crate::config::Paths;
use crate::error::Result;
use crate::probe::PtyProbeConfig;
use crate::pty::{PtyInfo, PtyManager};

/// 셸을 띄운다. `cwd`를 안 주면 워크스페이스 루트에서 시작한다.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    mgr: State<'_, PtyManager>,
    paths: State<'_, Paths>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<PtyInfo> {
    let cwd = cwd.or_else(|| Some(paths.workspace_root.display().to_string()));
    let info = mgr.spawn(&app, cols, rows, cwd, shell)?;
    // 어떤 셸이 실제로 떴는지 남긴다. 화면을 못 볼 때 이 줄이 유일한 단서다.
    eprintln!(
        "[eqmux][pty:{}] {} (pid={:?}) cwd={}",
        info.id, info.shell, info.pid, info.cwd
    );
    Ok(info)
}

#[tauri::command]
pub fn pty_write(mgr: State<'_, PtyManager>, id: String, data: String) -> Result<()> {
    mgr.write(&id, &data)
}

#[tauri::command]
pub fn pty_resize(mgr: State<'_, PtyManager>, id: String, cols: u16, rows: u16) -> Result<()> {
    mgr.resize(&id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(mgr: State<'_, PtyManager>, id: String) -> Result<()> {
    mgr.kill(&id)
}

#[tauri::command]
pub fn pty_list(mgr: State<'_, PtyManager>) -> Vec<PtyInfo> {
    mgr.list()
}

/// 무인 검증(`--pty-probe`)이 끝났을 때 프런트가 부른다.
///
/// 프런트가 **xterm 버퍼에서 읽은 글자**를 넘긴다 — 그래야 증거가 렌더까지 닿는다.
/// 요약은 stderr에도 찍는다. 파일을 안 열어도 스크립트가 판정을 집어갈 수 있어야 한다.
#[tauri::command]
pub fn pty_probe_finish(
    app: AppHandle,
    cfg: State<'_, PtyProbeConfig>,
    text: String,
    verdict: String,
) -> Result<()> {
    if let Some(parent) = cfg.out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&cfg.out_path, text.as_bytes())?;
    eprintln!("[eqmux][pty-probe] {verdict}");
    eprintln!("[eqmux][pty-probe] out = {}", cfg.out_path.display());
    app.exit(0);
    Ok(())
}
