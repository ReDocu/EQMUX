//! 경로 해석과 **측정용 격리 스위치**.
//!
//! # 왜 이게 골격 단계에 있나
//!
//! 관문 B(도그푸딩) 중에는 EQMUX가 팀 세션을 물고 돌아간다.
//! 그 상태에서 성능을 재려고 앱을 새로 띄우면 살아 있는 세션이 죽는다 —
//! AgentCommender에서 실제로 그랬고, 해원이 `--user-data-dir` + 상태 경로 환경변수로
//! 격리 인스턴스를 만들어 피했다. (`docs/BASELINE.md` §1)
//!
//! **EQMUX는 그 장치를 처음부터 갖는다.** 나중에 넣으면 상태 경로가 코드 곳곳에
//! 하드코딩된 뒤라 훨씬 비싸진다.
//!
//! # 스위치
//!
//! | 환경변수 | 대체 대상 | 기본값 |
//! |---|---|---|
//! | `EQMUX_STATE_PATH` | 세션·레이아웃 상태 파일 | `<app_data>/state.json` |
//! | `EQMUX_WORKSPACE_ROOT` | 작업 폴더 루트 | `<app_data>/workspace` |
//! | `EQMUX_DATA_DIR` | **WebView2 사용자 데이터 폴더** | Tauri 기본값 |
//!
//! `EQMUX_DATA_DIR`이 Electron `--user-data-dir`에 대응한다. 이걸 나눠야
//! 브라우저 캐시·로컬스토리지가 라이브 인스턴스와 섞이지 않는다.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
pub struct Paths {
    /// 세션·레이아웃 상태 파일
    pub state_file: PathBuf,
    /// 작업 폴더 루트
    pub workspace_root: PathBuf,
    /// WebView2 사용자 데이터 폴더. `None`이면 Tauri 기본값을 쓴다.
    pub webview_data_dir: Option<PathBuf>,
    /// 셋 중 하나라도 환경변수로 덮였는가.
    ///
    /// 측정 인스턴스인지 라이브 인스턴스인지 눈으로 구분하려고 노출한다.
    /// 격리인 줄 알고 잰 값이 사실 라이브였으면 측정이 통째로 무의미해진다.
    pub isolated: bool,
}

impl Paths {
    pub fn resolve(app: &AppHandle) -> Result<Self> {
        let base = app
            .path()
            .app_data_dir()
            .map_err(|e| Error::Path(format!("app_data_dir: {e}")))?;

        let state_file = env_path("EQMUX_STATE_PATH").unwrap_or_else(|| base.join("state.json"));
        let workspace_root =
            env_path("EQMUX_WORKSPACE_ROOT").unwrap_or_else(|| base.join("workspace"));
        let webview_data_dir = env_path("EQMUX_DATA_DIR");

        let isolated = std::env::var_os("EQMUX_STATE_PATH").is_some()
            || std::env::var_os("EQMUX_WORKSPACE_ROOT").is_some()
            || webview_data_dir.is_some();

        Ok(Self {
            state_file,
            workspace_root,
            webview_data_dir,
            isolated,
        })
    }

    /// 상태 파일의 부모와 워크스페이스 루트를 만들어 둔다.
    ///
    /// 격리 인스턴스는 빈 임시 폴더를 가리키는 경우가 많아, 없으면 만들어 줘야 한다.
    pub fn ensure_dirs(&self) -> Result<()> {
        if let Some(parent) = self.state_file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::create_dir_all(&self.workspace_root)?;
        if let Some(dir) = &self.webview_data_dir {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

/// 값이 비어 있는 환경변수는 "설정 안 함"으로 본다.
/// 빈 문자열이 경로로 해석되면 앱이 저장소 루트에 파일을 흘린다.
fn env_path(key: &str) -> Option<PathBuf> {
    let raw = std::env::var(key).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}
