// 화면 손상 진단 계측 — "오래 켜놓으면 화면이 깨지고 창 크기를 바꾸면 돌아온다"를 잡기 위한 것.
//
// 두 후보를 가른다:
//   1) 자식 웹뷰(브라우저 패널)가 낡은 좌표에 앉아 메인 UI를 덮는다. 프런트는 논리 픽셀로
//      좌표를 보내고 ResizeObserver가 울릴 때만 다시 보내므로, 배율이 다른 모니터로 창을
//      옮기면 CSS 크기는 그대로라 아무도 그 순간을 모른다. 리사이즈가 고치는 이유도 이것이다.
//   2) 컴포지터 타일이 낡은 채로 남는다 — 위와 증상이 같지만 좌표는 안 어긋난다.
//
// 그래서 여기서는 판정하지 않고 "그 순간의 숫자"만 남긴다. 자동 보정도 하지 않는다 —
// 원인을 모르는 채로 보정을 넣으면 증상만 가려 원인을 영영 못 찾는다.
//
// 로그: %USERPROFILE%\.eqmux\logs\diagnostics.log (로그 패널의 "로그 폴더 열기"로 접근)
use std::io::Write as _;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 진단 로그 상한 — 넘으면 새로 시작한다. 진단이 디스크를 먹는 일이 없어야 한다
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// 브라우저 패널 자식 웹뷰 라벨 (browser.rs와 같은 값 — 여기서는 읽기만 한다)
const BROWSER_LABEL: &str = "panel-browser";

fn stamp() -> String {
    // 로컬 시각을 쓸 수 있으면 좋겠지만 크레이트를 늘리지 않는다 — epoch ms면 정렬·상관에 충분하다
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let secs = (ms / 1000) as u64;
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{ms} {:02}:{:02}:{:02}Z", h, m, s)
}

/// 한 줄 append. 실패는 삼킨다 — 진단이 앱을 방해하면 안 된다
pub fn write(line: &str) {
    let dir = crate::log_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("diagnostics.log");
    if std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {line}", stamp());
    }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// 그 순간의 창·모니터·자식 웹뷰 기하. 좌표는 전부 물리 픽셀이다 —
/// 프런트가 보낸 논리 좌표와 비교하려면 scale_factor로 나눠야 한다.
/// 어느 쪽이 기준인지(창 상대 / 화면 절대)를 추측하지 않고 원본 숫자를 그대로 남긴다.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub scale_factor: f64,
    pub window_outer: Rect,
    pub window_inner: Rect,
    pub monitor_name: Option<String>,
    pub monitor_scale: Option<f64>,
    pub monitor: Rect,
    /// 브라우저 패널 자식 웹뷰 — 없으면 None (패널을 안 열었거나 닫았다)
    pub browser: Option<Rect>,
}

/// 지금의 기하를 잰다. 창이 없으면 오류 — 호출부가 조용히 넘긴다
#[tauri::command]
pub fn diag_geometry(app: AppHandle) -> Result<Geometry, String> {
    let win = app.get_window("main").ok_or("메인 창 없음")?;
    let sf = win.scale_factor().unwrap_or(1.0);
    let mut g = Geometry { scale_factor: sf, ..Default::default() };

    if let (Ok(p), Ok(s)) = (win.outer_position(), win.outer_size()) {
        g.window_outer = Rect { x: p.x, y: p.y, w: s.width, h: s.height };
    }
    if let (Ok(p), Ok(s)) = (win.inner_position(), win.inner_size()) {
        g.window_inner = Rect { x: p.x, y: p.y, w: s.width, h: s.height };
    }
    if let Ok(Some(m)) = win.current_monitor() {
        g.monitor_name = m.name().cloned();
        g.monitor_scale = Some(m.scale_factor());
        let (p, s) = (m.position(), m.size());
        g.monitor = Rect { x: p.x, y: p.y, w: s.width, h: s.height };
    }
    if let Some(wv) = app.get_webview(BROWSER_LABEL) {
        if let (Ok(p), Ok(s)) = (wv.position(), wv.size()) {
            g.browser = Some(Rect { x: p.x, y: p.y, w: s.width, h: s.height });
        }
    }
    Ok(g)
}

/// 프런트가 남기는 한 줄 (드리프트 판정·사용자 표식·WebGL 컨텍스트 유실 등)
#[tauri::command]
pub fn diag_note(text: String) {
    write(&text);
}

// ── 창 이벤트 ────────────────────────────────────────────────────────────
// Moved는 드래그 중 계속 온다 — 그대로 적으면 로그가 그것만으로 찬다.
// 배율·모니터가 실제로 바뀐 순간만 남기고, 나머지는 500ms에 한 줄로 죈다.

struct Last {
    at_ms: u128,
    scale: f64,
    monitor: String,
}

static LAST: Mutex<Option<Last>> = Mutex::new(None);

/// 창 이벤트 한 건 기록. 의미 있는 변화(배율·모니터)면 항상, 아니면 죄어서 남긴다.
/// 반환값 = 프런트에도 알릴 만한 변화인가 (프런트가 같은 순간 자기 좌표를 남기도록)
pub fn note_window_event(app: &AppHandle, kind: &str) -> bool {
    let Ok(g) = diag_geometry(app.clone()) else { return false };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let monitor = g.monitor_name.clone().unwrap_or_default();

    let mut guard = LAST.lock().unwrap_or_else(|e| e.into_inner());
    let changed = match guard.as_ref() {
        // 배율이나 모니터가 바뀌었다 — 후보 1이 성립하는 바로 그 순간이다
        Some(l) => (l.scale - g.scale_factor).abs() > f64::EPSILON || l.monitor != monitor,
        None => true,
    };
    let throttled = guard.as_ref().map(|l| now.saturating_sub(l.at_ms) < 500).unwrap_or(false);
    *guard = Some(Last { at_ms: now, scale: g.scale_factor, monitor: monitor.clone() });
    drop(guard);

    if !changed && throttled {
        return false;
    }
    let tag = if changed { "GEOMETRY-CHANGED" } else { "window" };
    write(&format!(
        "{tag} {kind} sf={} monitor={:?} monScale={:?} inner={},{} {}x{} browser={:?}",
        g.scale_factor,
        monitor,
        g.monitor_scale,
        g.window_inner.x,
        g.window_inner.y,
        g.window_inner.w,
        g.window_inner.h,
        g.browser.as_ref().map(|b| (b.x, b.y, b.w, b.h)),
    ));
    changed
}

// ── 웹뷰 생사 (BR-18) ────────────────────────────────────────────────────
// 프런트가 10초마다 살아 있다고 알린다. 끊기면 그 사실을 진단 로그에 남긴다 — 웹뷰가 죽거나
// 굳어도 Rust 쪽에는 흔적이 없던 자리다. 숨은 창은 WebView2가 타이머를 분당 1회까지 죄므로
// 따로 넉넉한 한도를 둔다 (오탐 방지). 판정만 하고 복구는 하지 않는다 (위 원칙과 같다).

const ALIVE_LIMIT_MS: u128 = 30_000;
const ALIVE_LIMIT_HIDDEN_MS: u128 = 180_000;

struct Beat {
    at_ms: u128,
    hidden: bool,
    silent: bool,
}

static BEAT: Mutex<Option<Beat>> = Mutex::new(None);

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// 이 박동 뒤로 now까지 소식이 없으면 끊긴 것인가
fn overdue(b: &Beat, now: u128) -> bool {
    let limit = if b.hidden { ALIVE_LIMIT_HIDDEN_MS } else { ALIVE_LIMIT_MS };
    now.saturating_sub(b.at_ms) > limit
}

/// 프런트 하트비트 — 끊겼다 돌아온 것이면 그 길이를 남긴다
#[tauri::command]
pub fn diag_alive(hidden: bool) {
    let now = now_ms();
    let mut guard = BEAT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(b) = guard.as_ref().filter(|b| b.silent) {
        write(&format!("WEBVIEW-BACK silent {}ms hidden={hidden}", now.saturating_sub(b.at_ms)));
    }
    *guard = Some(Beat { at_ms: now, hidden, silent: false });
}

/// 감시 스레드 — 첫 박동 전에는 판정하지 않는다 (앱 시작·로딩 중은 끊김이 아니다)
pub fn start_alive_watch() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let mut guard = BEAT.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(b) = guard.as_mut().filter(|b| !b.silent) {
            let now = now_ms();
            if overdue(b, now) {
                b.silent = true;
                write(&format!(
                    "WEBVIEW-SILENT no heartbeat for {}ms hidden={}",
                    now.saturating_sub(b.at_ms),
                    b.hidden
                ));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_window_gets_a_longer_leash() {
        let shown = Beat { at_ms: 1_000, hidden: false, silent: false };
        let hidden = Beat { at_ms: 1_000, hidden: true, silent: false };
        assert!(!overdue(&shown, 1_000 + ALIVE_LIMIT_MS));
        assert!(overdue(&shown, 1_001 + ALIVE_LIMIT_MS));
        assert!(!overdue(&hidden, 1_001 + ALIVE_LIMIT_MS), "숨은 창의 타이머 스로틀은 끊김이 아니다");
        assert!(overdue(&hidden, 1_001 + ALIVE_LIMIT_HIDDEN_MS));
    }
}
