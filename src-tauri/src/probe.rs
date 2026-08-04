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
//! | `--latency-probe` | 계측 켜기. 화면에 p50/p95/p99 표시 |
//! | `--latency-probe-run=N` | N회 자동 입력 후 결과를 쓰고 종료 (무인 측정용) |
//! | `--latency-probe-out=PATH` | 결과 파일 경로. 기본값은 앱 데이터 폴더 |

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
}

impl ProbeConfig {
    pub fn from_args(paths: &Paths) -> Self {
        let args: Vec<String> = std::env::args().collect();

        let mut enabled = false;
        let mut auto_samples = None;
        let mut out_path = None;

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
