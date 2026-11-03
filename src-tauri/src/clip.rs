// 네이티브 클립보드 (arboard) — WebView2의 웹 Clipboard API는 권한 문제로 조용히 실패하므로
// 텍스트·이미지 모두 네이티브 경로를 쓴다. 이미지는 파일로 저장해 경로를 터미널에 삽입한다
// (Claude Code 멀티모달 입력용).

use std::fs::create_dir_all;

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
    let dir = std::env::temp_dir().join("eqmux-pastes");
    create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("paste-{}.png", crate::workspace::now_ms()));
    rgba.save(&path).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
