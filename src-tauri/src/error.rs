//! 공통 에러 타입.
//!
//! Tauri 명령은 `Result<T, E>`를 돌려줄 때 `E: Serialize`를 요구한다.
//! 프런트에는 문자열 하나로 넘어가지만, Rust 안에서는 원인을 구분해 둔다 —
//! S1-2(PTY)부터 실패 종류가 늘어나고, 그때 `match`로 갈라야 한다.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("경로를 확인할 수 없다: {0}")]
    Path(String),

    #[error("입출력 실패: {0}")]
    Io(#[from] std::io::Error),

    /// PTY 계열 실패. `portable-pty`는 `anyhow::Error`를 돌려주므로 문자열로 눌러 담는다.
    /// 원인 문자열을 버리면 "셸이 안 뜬다"만 남고 왜인지는 영영 모른다.
    #[error("PTY 실패: {0}")]
    Pty(String),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl Serialize for Error {
    // 아래 `Result<T>` 별칭이 인자 1개짜리라 여기선 정규 경로를 쓴다.
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
