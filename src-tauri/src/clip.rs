// 네이티브 클립보드 (arboard) — WebView2의 웹 Clipboard API는 권한 문제로 조용히 실패하므로
// 텍스트·이미지 모두 네이티브 경로를 쓴다. 이미지는 파일로 저장해 경로를 터미널에 삽입한다
// (Claude Code 멀티모달 입력용).

use std::fs::create_dir_all;
use std::path::PathBuf;
use std::time::Duration;

/// 붙여넣은 이미지 폴더 — %TEMP%\eqmux-pastes (macOS는 사용자 임시 폴더 아래)
pub fn paste_dir() -> PathBuf {
    std::env::temp_dir().join("eqmux-pastes")
}

/// 붙여넣은 이미지 보관 기간 (S27) — 넘은 것은 앱 시작 때 지운다(prune_stale). 이미지를 붙일 때마다 새 파일이
/// 생기고, Windows 임시 폴더는 저장 공간 센서를 켜지 않으면 비워지지 않는다. 막 붙인 것은 에이전트가 아직 읽는다
pub const PASTE_KEEP: Duration = Duration::from_secs(7 * 24 * 3600);

/// 앱이 저장한 붙여넣기 이미지인가 — 같은 폴더의 다른 파일은 건드리지 않는다
pub fn is_paste_file(name: &str) -> bool {
    name.starts_with("paste-") && name.ends_with(".png")
}

#[tauri::command]
pub fn clip_read_text() -> String {
    let mut cb = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    cb.get_text().unwrap_or_default()
}

/// `concealed`면 비밀값이다 (B148 — 환경변수 탭의 값 복사) — 붙여넣기는 되지만 클립보드 기록·
/// 클라우드 동기화(Windows)·기록(macOS)에는 남기지 않는다
#[tauri::command]
pub fn clip_write_text(text: String, concealed: Option<bool>) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let set = cb.set();
    #[cfg(windows)]
    let set = if concealed == Some(true) {
        use arboard::SetExtWindows;
        set.exclude_from_history().exclude_from_cloud()
    } else {
        set
    };
    #[cfg(target_os = "macos")]
    let set = if concealed == Some(true) {
        use arboard::SetExtApple;
        set.exclude_from_history()
    } else {
        set
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = concealed;
    set.text(text).map_err(|e| e.to_string())
}

/// 클립보드 이미지 → %TEMP%\eqmux-pastes\*.png 저장 후 경로 반환. 이미지가 없으면 None.
#[tauri::command]
pub fn clip_save_image() -> Result<Option<String>, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img = match cb.get_image() {
        Ok(i) => i,
        Err(_) => return Ok(None),
    };
    let (w, h) = (img.width as u32, img.height as u32);
    let rgba = image::RgbaImage::from_raw(w, h, img.bytes.into_owned())
        .ok_or("클립보드 이미지 변환 실패")?;
    let dir = paste_dir();
    create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("paste-{}.png", crate::workspace::now_ms()));
    rgba.save(&path).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
