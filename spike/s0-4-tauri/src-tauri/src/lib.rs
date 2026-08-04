// S0-4 Tauri 스파이크 — WebView2 동작 확인 + WebGL 프로브 수집
//
// 프런트가 수집한 환경 정보를 이 명령으로 넘긴다.
// 창이 뜨는 것(WebView2 동작) + IPC 왕복 + WebGL 가용성을 한 번에 확인하기 위한 것이다.

use std::io::Write;

/// 프런트에서 받은 프로브 결과를 파일로 남긴다.
/// 반환값이 프런트로 돌아가므로 IPC 왕복(S1-1 DoD)도 함께 검증된다.
#[tauri::command]
fn save_probe(json: String) -> Result<String, String> {
    let path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("probe-result.json");

    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    let shown = path.display().to_string();
    println!("[spike] probe written -> {}", shown);
    Ok(shown)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_probe])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
