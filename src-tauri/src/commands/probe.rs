//! 계측 결과 수집 명령.

use tauri::{AppHandle, State};

use crate::error::Result;
use crate::probe::{self, ProbeConfig};

/// 표본 묶음을 JSONL로 이어 쓴다.
#[tauri::command]
pub fn probe_append(cfg: State<'_, ProbeConfig>, lines: Vec<String>) -> Result<String> {
    probe::append(cfg.inner(), &lines)?;
    Ok(cfg.out_path.display().to_string())
}

/// 무인 측정(`--latency-probe-run=N`)이 끝났을 때 프런트가 부른다.
///
/// 요약을 stderr에도 찍는다 — 파일을 안 열어도 스크립트가 결과를 집어갈 수 있어야 한다.
/// GUI 서브시스템에서는 stdout 핸들이 붙지 않으므로 stdout을 쓰면 안 된다.
#[tauri::command]
pub fn probe_finish(app: AppHandle, cfg: State<'_, ProbeConfig>, summary: String) -> Result<()> {
    probe::append(cfg.inner(), &[summary.clone()])?;
    eprintln!("[eqmux][probe] {summary}");
    eprintln!("[eqmux][probe] out = {}", cfg.out_path.display());
    app.exit(0);
    Ok(())
}
