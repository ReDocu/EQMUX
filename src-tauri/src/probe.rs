//! 키 입력 지연 계측 (`--latency-probe`).
//!
//! # 왜 앱 안에 있어야 하나
//!
//! 관문 A-3의 기준은 **p99 ≤ 16ms**다. 60Hz 한 프레임이다.
//! 밖에서 재면 프로세스 기동 오버헤드가 수십~수백 ms라 **측정 대상보다 잡음이 크고**,
//! 로그 왕복으로 재면 **렌더 구간이 통째로 빠진다** — 그 구간이 바로 WebGL이 걸린 자리다.
//! (`docs/BASELINE.md` §5 — 해원이 여기서 막혀 A-3을 미측정으로 남겼다)
//!
//! 그래서 계측기는 렌더러와 같은 자리에 있어야 한다. S1-3에 넣는 이유다.
//!
//! # 플래그
//!
//! | 플래그 | 뜻 |
//! |---|---|
//! | `--latency-probe` | 계측 켜기. 화면에 실작업/대기/총지연 표시 |
//! | `--latency-probe-run=N` | N회 자동 입력 후 결과를 쓰고 종료 (무인 측정용) |
//! | `--latency-probe-out=PATH` | 결과 파일 경로. 기본값은 앱 데이터 폴더 |
//! | `--latency-probe-inject-ms=N` | **자가 검증 ②** 입력 처리 경로에 N ms 바쁜 루프를 넣는다 |
//! | `--latency-probe-frame-hold=K` | **자가 검증 ③** rAF 콜백을 K프레임마다 한 번만 흘린다 |
//! | `--latency-probe-gap-ms=N` | 합성 키 간격. 기본 8 |
//!
//! # `S1-3b` — 왜 4점인가
//!
//! `#10`에서 A-3 판정이 둘로 갈렸다. **① 프레임 대기를 뺀 실작업 p99 ≤ 8ms**(판정)와
//! **② 총지연 p99 ≤ 2프레임**이다. 3점 계측(`parse`/`render`/`total`)으로는 ①을 낼 수 없다.
//! 아래 두 플래그는 **계측기 자체의 인수 기준**(`docs/GATE-A.md` §2-2)을 무인으로 돌리려고 있다.
//! 계측기가 회귀를 잡는지 증명하지 못하면 그 계측기로 낸 판정도 못 믿는다.

use std::io::Write;
use std::path::PathBuf;

use serde::Serialize;

use crate::config::Paths;
use crate::error::Result;

#[derive(Debug, Clone, Serialize)]
pub struct ProbeConfig {
    pub enabled: bool,
    /// `Some(n)`이면 n회 자동 입력 후 종료한다.
    pub auto_samples: Option<usize>,
    pub out_path: PathBuf,
    /// 자가 검증 ② — 입력 처리 경로에 넣을 인위적 바쁜 루프(ms). 0이면 안 넣는다.
    pub inject_ms: f64,
    /// 자가 검증 ③ — rAF 콜백을 K프레임마다 한 번만 흘린다. 1이면 그대로 둔다.
    pub frame_hold: u32,
    /// 합성 키 간격(ms).
    pub gap_ms: u64,
    /// `S2-10` — 첫 키 전에 이만큼 유휴로 둔다(ms). 0이면 바로 시작(기존 동작).
    ///
    /// `--memory-policy-idle`보다 길게 주면 **Low 진입 후 첫 키**가 표본 1이 된다 —
    /// 인수 조건 3("유휴→첫 키가 A-3 이내")을 재는 자리다. 이 모드에서는 프런트가
    /// 키마다 `memlevel_touch`를 발사해 프로덕션 복귀 트리거를 재현한다.
    /// **기존 A-3 값과 직접 비교하지 말 것** — 조건이 다르고, 요약 config에 같이 찍힌다.
    pub idle_wait_ms: u64,
}

impl ProbeConfig {
    pub fn from_args(paths: &Paths) -> Self {
        let args: Vec<String> = std::env::args().collect();

        let mut enabled = false;
        let mut auto_samples = None;
        let mut out_path = None;
        let mut inject_ms = 0.0f64;
        let mut frame_hold = 1u32;
        let mut gap_ms = 8u64;
        let mut idle_wait_ms = 0u64;

        for a in &args {
            if a == "--latency-probe" {
                enabled = true;
            } else if let Some(v) = a.strip_prefix("--latency-probe-run=") {
                // 값이 이상하면 조용히 무시하지 않는다 — 측정이 안 돌았는지 모르는 게 더 나쁘다.
                match v.parse::<usize>() {
                    Ok(n) if n > 0 => {
                        enabled = true;
                        auto_samples = Some(n);
                    }
                    _ => eprintln!("[eqmux] --latency-probe-run 값이 잘못됐다: {v:?} (무시)"),
                }
            } else if let Some(v) = a.strip_prefix("--latency-probe-out=") {
                out_path = Some(PathBuf::from(v));
            } else if let Some(v) = a.strip_prefix("--latency-probe-inject-ms=") {
                match v.parse::<f64>() {
                    Ok(n) if n >= 0.0 => inject_ms = n,
                    _ => eprintln!("[eqmux] --latency-probe-inject-ms 값이 잘못됐다: {v:?} (무시)"),
                }
            } else if let Some(v) = a.strip_prefix("--latency-probe-frame-hold=") {
                match v.parse::<u32>() {
                    Ok(n) if n >= 1 => frame_hold = n,
                    _ => eprintln!("[eqmux] --latency-probe-frame-hold 값이 잘못됐다: {v:?} (무시)"),
                }
            } else if let Some(v) = a.strip_prefix("--latency-probe-gap-ms=") {
                match v.parse::<u64>() {
                    Ok(n) => gap_ms = n,
                    _ => eprintln!("[eqmux] --latency-probe-gap-ms 값이 잘못됐다: {v:?} (무시)"),
                }
            } else if let Some(v) = a.strip_prefix("--latency-probe-idle-wait=") {
                match v.parse::<u64>() {
                    Ok(n) => idle_wait_ms = n,
                    _ => eprintln!("[eqmux] --latency-probe-idle-wait 값이 잘못됐다: {v:?} (무시)"),
                }
            }
        }

        let out_path = out_path.unwrap_or_else(|| {
            paths
                .state_file
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("latency-probe.jsonl")
        });

        Self {
            enabled,
            auto_samples,
            out_path,
            inject_ms,
            frame_hold,
            gap_ms,
            idle_wait_ms,
        }
    }
}

/// `S1-2`·`S1-4` 무인 검증 (`--pty-probe`).
///
/// # 왜 있나
///
/// 셸이 붙었는지 확인하려면 창을 열고 눈으로 봐야 하고, 그건 **재현되지 않는다.**
/// 화면 캡처로 검증하려다 팀장님 화면을 찍은 적도 있다(`RENDERER-S1-3.md` §4-4).
/// 그래서 *입력을 넣고 → 셸을 거쳐 → xterm 버퍼에 실제로 찍힌 글자*를 파일로 남긴다.
/// 프런트가 터미널 버퍼를 읽어 보내므로 **S1-4(양방향 스트림) 전 구간이 증거에 들어간다.**
///
/// | 플래그 | 뜻 |
/// |---|---|
/// | `--pty-probe` | 무인 검증 켜기 |
/// | `--pty-probe-cmd=CMD` | 보낼 명령. 기본값 `dir` |
/// | `--pty-probe-ms=N` | 명령을 보낸 뒤 기다릴 시간(ms). 기본값 4000 |
/// | `--pty-probe-out=PATH` | 결과 파일 |
#[derive(Debug, Clone, Serialize)]
pub struct PtyProbeConfig {
    pub enabled: bool,
    pub command: String,
    pub wait_ms: u64,
    pub out_path: PathBuf,
}

impl PtyProbeConfig {
    pub fn from_args(paths: &Paths) -> Self {
        let args: Vec<String> = std::env::args().collect();

        let mut enabled = false;
        let mut command = None;
        let mut wait_ms = 4000u64;
        let mut out_path = None;

        for a in &args {
            if a == "--pty-probe" {
                enabled = true;
            } else if let Some(v) = a.strip_prefix("--pty-probe-cmd=") {
                enabled = true;
                command = Some(v.to_string());
            } else if let Some(v) = a.strip_prefix("--pty-probe-ms=") {
                match v.parse::<u64>() {
                    Ok(n) if n > 0 => wait_ms = n,
                    _ => eprintln!("[eqmux] --pty-probe-ms 값이 잘못됐다: {v:?} (무시)"),
                }
            } else if let Some(v) = a.strip_prefix("--pty-probe-out=") {
                out_path = Some(PathBuf::from(v));
            }
        }

        let out_path = out_path.unwrap_or_else(|| {
            paths
                .state_file
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("pty-probe.txt")
        });

        Self {
            enabled,
            command: command.unwrap_or_else(|| "dir".into()),
            wait_ms,
            out_path,
        }
    }
}

/// `A-2` 폭 계측 (`--font-probe`).
///
/// # 왜 있나
///
/// A-2(CJK 폭)는 지금까지 **사람 눈에 묶여 있었다.** 그런데 A-2가 묻는 것은 결국 숫자다 —
/// 한글 글리프의 advance width가 ASCII의 정확히 2배인가. 캔버스 `measureText`로 잴 수 있다.
///
/// **육안을 대체하지 않는다.** 폰트가 몇 픽셀로 그리는가이지 화면이 안 밀리는가가 아니다.
/// 육안 전에 싸게 거르는 자리다 — 비율이 틀리면 볼 것도 없이 미달이다.
///
/// | 플래그 | 뜻 |
/// |---|---|
/// | `--font-probe` | 폭 계측 켜기. 창을 열어 재고 결과를 쓴 뒤 종료한다 |
/// | `--font-probe-out=PATH` | 결과 JSON 경로 |
/// | `--font-stack=CSS` | **터미널 폰트 스택을 강제한다.** 계측과 무관하게도 먹는다 |
///
/// `EQMUX_FONT_STACK` 환경변수도 같은 일을 한다(플래그가 우선).
///
/// # `--font-stack`이 왜 계측의 핵심인가
///
/// `GATE-A.md` §1이 A-2를 "잠정"으로 둔 이유는 **확인한 기계에 D2Coding이 깔려 있어
/// 폴백 경로가 한 번도 안 돌았다**는 것이다. 스택에서 D2Coding만 빼면
/// **이 기계가 곧 사용자 기계 조건**이 된다. 폰트 없는 다른 기계를 기다리지 않아도 된다.
#[derive(Debug, Clone, Serialize)]
pub struct FontProbeConfig {
    pub enabled: bool,
    pub out_path: PathBuf,
    /// 강제할 CSS 폰트 스택. `None`이면 프런트 기본값(`terminal.ts` `FONT_STACK`).
    pub stack: Option<String>,
}

impl FontProbeConfig {
    pub fn from_args(paths: &Paths) -> Self {
        let mut enabled = false;
        let mut out_path = None;
        // 환경변수를 먼저 깔고 플래그로 덮는다. 같은 실행에서 둘이 다르면 플래그가 이긴다.
        let mut stack = std::env::var("EQMUX_FONT_STACK")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        for a in std::env::args() {
            if a == "--font-probe" {
                enabled = true;
            } else if let Some(v) = a.strip_prefix("--font-probe-out=") {
                enabled = true;
                out_path = Some(PathBuf::from(v));
            } else if let Some(v) = a.strip_prefix("--font-stack=") {
                let v = v.trim();
                if v.is_empty() {
                    // 빈 스택으로 터미널을 띄우면 폰트가 통째로 기본값이 된다.
                    // 조용히 그렇게 두면 "강제했다고 믿는 것"과 실제가 갈린다.
                    eprintln!("[eqmux] --font-stack 값이 비었다 (무시)");
                } else {
                    stack = Some(v.to_string());
                }
            }
        }

        let out_path = out_path.unwrap_or_else(|| {
            paths
                .state_file
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("font-probe.json")
        });

        Self {
            enabled,
            out_path,
            stack,
        }
    }
}

/// `S2-2` 패널 분할 (`--panes` · `--panes-probe`).
///
/// # 왜 플래그로 여는가
///
/// **관문 A2의 조건이 "터미널 4개"다**(`issue.md` #11). 손으로 세 번 분할해서 만든 상태는
/// 재현되지 않는다 — 누가 언제 어떤 순서로 눌렀는지가 값에 섞인다.
/// `--panes=4`는 **같은 화면을 매번 같은 방법으로** 만든다. 해원이 재기 전에 손을 안 대도 된다.
///
/// | 플래그 | 뜻 |
/// |---|---|
/// | `--panes=N` | 기동 직후 패널이 N개가 되게 나눈다. 창은 그대로 열려 있는다 |
/// | `--panes=0` | **진단(SPIKE-A4)** — 터미널·PTY·WebGL 없이 창만 띄운다. 플랫폼 바닥 B를 잰다 |
/// | `--panes-probe` | N개로 나눈 뒤 **전부 정상인지 확인하고 종료**한다 |
/// | `--panes-probe-out=PATH` | 결과 JSON 경로 |
///
/// 나누는 방법은 프런트가 정한다 — **제일 넓은 패널을 긴 축으로** 자른다.
/// 그래야 4개일 때 2×2가 나오고, 개수가 달라져도 한쪽으로 길쭉해지지 않는다.
#[derive(Debug, Clone, Serialize)]
pub struct PanesConfig {
    /// 무인 검증 모드인가.
    pub probe: bool,
    /// 목표 패널 수. 1이면 아무것도 안 나눈다.
    pub count: usize,
    pub out_path: PathBuf,
}

/// 패널 상한. WebGL 컨텍스트와 셸이 패널마다 하나씩 생긴다 —
/// 실수로 `--panes=400`을 치면 기계가 아니라 사람이 먼저 곤란해진다.
const MAX_PANES: usize = 16;

impl PanesConfig {
    pub fn from_args(paths: &Paths) -> Self {
        let mut probe = false;
        let mut count = 1usize;
        let mut out_path = None;

        for a in std::env::args() {
            if a == "--panes-probe" {
                probe = true;
            } else if let Some(v) = a.strip_prefix("--panes-probe-out=") {
                probe = true;
                out_path = Some(PathBuf::from(v));
            } else if let Some(v) = a.strip_prefix("--panes=") {
                match v.parse::<usize>() {
                    // 0 = 빈 화면(진단). 터미널이 하나도 없는 상태는 사용 상태가 아니라
                    // 측정 상태다 — SPIKE-A4의 바닥 B가 이걸로 나온다.
                    Ok(n) if n <= MAX_PANES => count = n,
                    _ => eprintln!(
                        "[eqmux] --panes 값이 잘못됐다: {v:?} (0~{MAX_PANES}) — 무시하고 1로 간다"
                    ),
                }
            }
        }

        // 검증 모드인데 개수를 안 줬으면(또는 빈 화면이면) 4다. 관문 A2가 묻는 수가 그것이다.
        if probe && count <= 1 {
            count = 4;
        }

        let out_path = out_path.unwrap_or_else(|| {
            paths
                .state_file
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("panes-probe.json")
        });

        Self {
            probe,
            count,
            out_path,
        }
    }
}

/// `S2-11` 배치 프리셋 무인 확인 (`--preset-probe`).
///
/// # 왜 있나
///
/// 이 작업의 완료 기준은 *"재배열이지 재생성이 아니다"* 인데, 그건 **화면으로는 구분이 안 된다.**
/// 8칸이 새 셸 8개로 다시 뜬 화면과, 살아 있는 세션을 옮겨 담은 화면은 똑같이 생겼다 —
/// 스크롤백을 눈으로 뒤져야 갈린다. 그래서 잎 id·PTY id·캔버스 수를 **적용 전후로 대조**해
/// 파일과 종료 코드로 남긴다. 교차 검증(해원·이안)은 이걸 그대로 돌리면 된다.
///
/// | 플래그 | 뜻 |
/// |---|---|
/// | `--preset-probe` | **6종 전수** 적용·대조 후 종료 |
/// | `--preset-probe=<id>` | 한 종만 (`grid-2x4` 등) |
/// | `--preset-probe-out=PATH` | 결과 JSON 경로 |
///
/// 세션 수는 `--panes=N`으로 준다. **안 주면 8**이다 — 디자인이 상정한 정원이 8이고,
/// 프리셋이 열게 만드는 그 수를 그대로 재는 편이 낫다(브리프 §3).
#[derive(Debug, Clone, Serialize)]
pub struct PresetProbeConfig {
    pub enabled: bool,
    /// 확인할 프리셋 id. `all`이면 6종 전수.
    pub target: String,
    pub out_path: PathBuf,
}

/// `--preset-probe`가 개수를 안 받았을 때 쓰는 세션 수.
pub const PRESET_PROBE_PANES: usize = 8;

impl PresetProbeConfig {
    pub fn from_args(paths: &Paths) -> Self {
        let mut enabled = false;
        let mut target = "all".to_string();
        let mut out_path = None;

        for a in std::env::args() {
            if a == "--preset-probe" {
                enabled = true;
            } else if let Some(v) = a.strip_prefix("--preset-probe-out=") {
                enabled = true;
                out_path = Some(PathBuf::from(v));
            } else if let Some(v) = a.strip_prefix("--preset-probe=") {
                enabled = true;
                // 없는 이름을 조용히 전수로 바꾸면 "한 종만 쟀다"고 믿은 채 다른 결과를 본다.
                if v == "all" || crate::presets::find(v).is_some() {
                    target = v.to_string();
                } else {
                    eprintln!(
                        "[eqmux] --preset-probe 값이 잘못됐다: {v:?} (있는 것: all, {}) — 전수로 간다",
                        crate::presets::PRESETS
                            .iter()
                            .map(|p| p.id)
                            .collect::<Vec<_>>()
                            .join(", ")
                    );
                }
            }
        }

        let out_path = out_path.unwrap_or_else(|| {
            paths
                .state_file
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("preset-probe.json")
        });

        Self {
            enabled,
            target,
            out_path,
        }
    }
}

/// JSONL 한 덩어리를 이어 쓴다.
///
/// 표본마다 왕복하면 계측 자체가 측정을 흔든다. 프런트가 모아서 한 번에 보낸다.
pub fn append(cfg: &ProbeConfig, lines: &[String]) -> Result<()> {
    if let Some(parent) = cfg.out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&cfg.out_path)?;
    for l in lines {
        writeln!(f, "{l}")?;
    }
    Ok(())
}
