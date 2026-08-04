//! EQMUX 백엔드 진입점.
//!
//! # 구조
//!
//! ```text
//! lib.rs        빌더 구성 · 창 생성        (여기)
//! config.rs     경로 해석 · 격리 스위치
//! error.rs      공통 에러 타입
//! commands/     Tauri 명령 (도메인별)
//! ```
//!
//! S1-2에서 `pty/`가 붙고, 그 스트림을 S1-4에서 프런트로 잇는다.

mod commands;
mod config;
mod error;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use config::Paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::echo,
        ])
        .setup(|app| {
            // 경로를 먼저 확정한다. 창보다 앞이어야 WebView2 데이터 폴더를 갈아끼울 수 있다.
            let paths = Paths::resolve(app.handle())?;
            paths.ensure_dirs()?;

            if paths.isolated {
                // 격리 인스턴스라는 사실은 반드시 보이게 남긴다.
                // 라이브인 줄 모르고 잰 값은 측정이 아니라 오염이다.
                eprintln!("[eqmux] 격리 인스턴스로 기동한다");
                eprintln!("[eqmux]   state     = {}", paths.state_file.display());
                eprintln!("[eqmux]   workspace = {}", paths.workspace_root.display());
                if let Some(d) = &paths.webview_data_dir {
                    eprintln!("[eqmux]   webview   = {}", d.display());
                }
            }

            let mut win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("EQMUX")
                .inner_size(1100.0, 720.0)
                .min_inner_size(640.0, 400.0);

            // Electron의 --user-data-dir 대응. 이게 갈려야 캐시·로컬스토리지가 섞이지 않는다.
            if let Some(dir) = paths.webview_data_dir.clone() {
                win = win.data_directory(dir);
            }

            win.build()?;

            // 명령에서 State<Paths>로 꺼내 쓴다.
            app.manage(paths);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("EQMUX 기동 실패");
}
