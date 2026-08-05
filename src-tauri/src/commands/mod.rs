//! Tauri 명령 모음.
//!
//! 명령은 도메인별 파일로 나눈다. 한 파일에 몰면 S2(레이아웃)·S3(설정)에서
//! 수십 개가 되고, 그때 나누려면 프런트 호출부까지 같이 건드려야 한다.
//!
//! 예정: `config`(S3-5)

pub mod layout;
pub mod probe;
pub mod pty;
pub mod system;
