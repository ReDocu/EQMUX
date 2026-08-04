//! 계측 결과 수집 명령.

use std::io::Write;

use tauri::{AppHandle, State};

use crate::error::Result;
use crate::probe::{self, FontProbeConfig, ProbeConfig};

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

/// `A-2` 폭 계측(`--font-probe`)이 끝났을 때 프런트가 부른다.
///
/// 한 줄 판정을 stderr에도 찍는다. **파일을 안 열어도 통과/미달이 보여야 한다** —
/// 이 계측의 존재 이유가 "육안 전에 싸게 거른다"이므로 결과가 비싸면 안 된다.
#[tauri::command]
pub fn font_probe_finish(
    app: AppHandle,
    cfg: State<'_, FontProbeConfig>,
    json: String,
    verdict: String,
) -> Result<()> {
    if let Some(parent) = cfg.out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = std::fs::File::create(&cfg.out_path)?;
    writeln!(f, "{json}")?;

    for line in verdict.lines() {
        eprintln!("[eqmux][font-probe] {line}");
    }
    eprintln!("[eqmux][font-probe] out = {}", cfg.out_path.display());
    app.exit(0);
    Ok(())
}
