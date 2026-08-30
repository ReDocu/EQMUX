// 브라우저 패널 (M17 확장) — 사이드 패널 자리에 실제 WebView2 자식 웹뷰를 얹는다.
// iframe 미리보기는 X-Frame-Options·frame-ancestors에 막혀 외부 웹을 못 그린다 —
// 자식 웹뷰는 최상위 프레임이라 그 제약이 없고, 세션 dev 서버(localhost)도 같은 경로로 본다.
// 좌표는 CSS(논리) 픽셀 — 프런트가 패널 영역의 getBoundingClientRect를 그대로 보낸다.
// 원격 페이지에는 Tauri IPC가 열리지 않는다 (capabilities에 이 라벨이 없다) — 관측 전용 표면.
use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

/// 자식 웹뷰 라벨 — 창에 하나만 둔다. 탭 전환·다이얼로그는 파괴가 아니라 숨김/표시로 다룬다
const LABEL: &str = "panel-browser";

#[derive(Serialize, Clone)]
struct NavPayload {
    url: String,
}

/// http·https만 — file:// 등 로컬 자원이 브라우저 패널로 열리는 것을 막는다
fn parse_http(url: &str) -> Result<Url, String> {
    let u: Url = url.parse().map_err(|_| format!("잘못된 주소: {url}"))?;
    match u.scheme() {
        "http" | "https" => Ok(u),
        s => Err(format!("{s}:// 주소는 열 수 없습니다 — http·https만")),
    }
}

/// 열기 — 웹뷰가 없으면 만들고, 있으면 이동·재배치 후 보여준다
#[tauri::command]
pub fn browser_open(app: AppHandle, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let target = parse_http(&url)?;
    if let Some(wv) = app.get_webview(LABEL) {
        wv.navigate(target).map_err(|e| e.to_string())?;
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
        return wv.show().map_err(|e| e.to_string());
    }
    let win = app.get_window("main").ok_or("메인 창을 찾지 못했습니다")?;
    let emitter = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(target))
        // 주소 바 동기화 — 웹뷰 안에서 링크를 따라가도 패널 입력칸이 따라온다.
        // 스킴 제한도 여기서 계속 지킨다 (페이지 안 링크가 http·https 밖으로 못 나가게)
        .on_navigation(move |u| {
            let allowed = matches!(u.scheme(), "http" | "https");
            if allowed {
                let _ = emitter.emit_to("main", "browser-nav", NavPayload { url: u.to_string() });
            }
            allowed
        });
    win.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| format!("웹뷰 생성 실패: {e}"))?;
    Ok(())
}

/// 재배치 — 패널 크기·위치가 바뀔 때 (ResizeObserver · 창 리사이즈 · 패널 좌우 전환)
#[tauri::command]
pub fn browser_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())
}

/// 표시/숨김 — 자식 웹뷰는 항상 메인 웹뷰 위에 그려지므로, 다른 탭·다이얼로그·전체 화면
/// 팝업이 뜨는 동안은 숨겨야 한다. 페이지 상태(스크롤·폼)는 유지된다
#[tauri::command]
pub fn browser_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    if visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())
}

/// 탐색 — back·forward는 웹뷰 안 history로, reload는 네이티브 리로드로
#[tauri::command]
pub fn browser_nav(app: AppHandle, action: String) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    match action.as_str() {
        "back" => wv.eval("history.back()").map_err(|e| e.to_string()),
        "forward" => wv.eval("history.forward()").map_err(|e| e.to_string()),
        "reload" => wv.reload().map_err(|e| e.to_string()),
        other => Err(format!("모르는 탐색 동작: {other}")),
    }
}

/// 닫기 — 웹뷰를 파괴한다 (✕ 버튼). 다음 열기는 새로 만든다
#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    wv.close().map_err(|e| e.to_string())
}
