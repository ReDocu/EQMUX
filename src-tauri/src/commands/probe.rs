//! 계측 결과 수집 명령.

use std::io::Write;

use tauri::{AppHandle, State};

use crate::error::Result;
use crate::probe::{self, FontProbeConfig, PanesConfig, PresetProbeConfig, ProbeConfig};

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

/// `S2-2` 패널 무인 검증(`--panes-probe`)이 끝났을 때 프런트가 부른다.
///
/// **통과 여부가 곧 종료 코드다**(통과 0 · 미달 1) — `--layout-probe`와 같은 규약이라
/// 스크립트가 stderr 한 줄과 코드만 보면 된다. 판정 내용은 프런트가 만든다:
/// 열림/닫힘/PTY 수/캔버스 수는 전부 웹뷰 쪽에서만 보이는 값이다.
#[tauri::command]
pub fn panes_probe_finish(
    app: AppHandle,
    cfg: State<'_, PanesConfig>,
    json: String,
    verdict: String,
    pass: bool,
) -> Result<()> {
    if let Some(parent) = cfg.out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = std::fs::File::create(&cfg.out_path)?;
    writeln!(f, "{json}")?;

    for line in verdict.lines() {
        eprintln!("[eqmux][panes-probe] {line}");
    }
    eprintln!("[eqmux][panes-probe] out = {}", cfg.out_path.display());
    // `app.exit(1)`은 이벤트 루프 정리를 거치며 코드가 0으로 바뀌는 것을 실측했다(S2-2).
    // 판정이 코드로 살아남아야 하는 자리라 `--layout-probe`와 같은 즉시 종료를 쓴다.
    // 파일·stderr는 위에서 이미 버퍼 없이 나갔다.
    let _ = app;
    std::process::exit(if pass { 0 } else { 1 });
}

/// `S2-11` 배치 프리셋 무인 확인(`--preset-probe`)이 끝났을 때 프런트가 부른다.
///
/// `--panes-probe`와 같은 규약이다 — **통과 여부가 곧 종료 코드**(통과 0 · 미달 1)라
/// 스크립트가 stderr 한 줄과 코드만 보면 된다. 판정 내용은 프런트가 만든다:
/// 잎 id·PTY 목록·캔버스 수는 웹뷰 쪽에서만 보이는 값이다.
#[tauri::command]
pub fn preset_probe_finish(
    app: AppHandle,
    cfg: State<'_, PresetProbeConfig>,
    json: String,
    verdict: String,
    pass: bool,
) -> Result<()> {
    if let Some(parent) = cfg.out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = std::fs::File::create(&cfg.out_path)?;
    writeln!(f, "{json}")?;

    for line in verdict.lines() {
        eprintln!("[eqmux][preset-probe] {line}");
    }
    eprintln!("[eqmux][preset-probe] out = {}", cfg.out_path.display());
    // `app.exit(1)`은 이벤트 루프 정리에서 코드가 0으로 바뀐다(S2-2 실측) — 즉시 종료한다.
    let _ = app;
    std::process::exit(if pass { 0 } else { 1 });
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
