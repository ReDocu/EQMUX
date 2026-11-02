//! 트레이 · 창 닫기 동작 (0.6 §1-1 · §10) — 창을 닫아도 세션이 돌고 있으면 숨기기만 한다.
//! 사람이 껐다고 착각하지 않게 트레이 툴팁과 메뉴 첫 줄에 "백그라운드 N개 실행 중"을 늘 보인다.
//!
//! 닫기 결정은 여기 한 곳이다: 프런트 onCloseRequested가 `window_close_to_tray`를 먼저 묻고,
//! false면 기존 종료 흐름(확인창 → performShutdown → app_exit)을 탄다.
//! 설정 `closeAction`: "tray"(기본) | "quit". 도는 세션이 없으면 숨길 이유가 없으니 설정과 상관없이 종료한다.
//! macOS는 같은 숨기기로 Dock에 남고(U70), Dock 아이콘을 누르면(RunEvent::Reopen) 창이 돌아온다.
//! "전부 종료"는 ⌘Q와 같은 길(quit::decide)이다 — 창을 앞으로 부르고 'app-quit-requested'.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

const TRAY_ID: &str = "main";

/// 이번 실행에서 숨기기 안내를 이미 냈다 — 닫을 때마다 알림이 오면 성가시다
static HINTED: AtomicBool = AtomicBool::new(false);

struct TrayItems {
    count: MenuItem<Wry>,
    open: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

fn english(app: &AppHandle) -> bool {
    crate::setting_str(app, "language").as_deref() == Some("en")
}

fn running(app: &AppHandle) -> usize {
    let state: State<crate::PtyState> = app.state();
    state.0.lock().map(|s| s.len()).unwrap_or(0)
}

/// 닫기를 숨기기로 바꿀지 — 순수 함수라 시험한다
fn should_hide(close_action: Option<&str>, running: usize) -> bool {
    close_action != Some("quit") && running > 0
}

/// (툴팁, 메뉴 첫 줄, 창 열기, 전부 종료)
fn labels(n: usize, en: bool) -> (String, String, &'static str, &'static str) {
    if en {
        let tip = if n == 0 { "EQMUX".into() } else { format!("EQMUX — {n} running in background") };
        (tip, format!("{n} sessions running"), "Open window", "Quit all")
    } else {
        let tip = if n == 0 { "EQMUX".into() } else { format!("EQMUX — 백그라운드 {n}개 실행 중") };
        (tip, format!("실행 중 세션 {n}개"), "창 열기", "전부 종료")
    }
}

/// R1 (§6) — 창이 최소화되거나 트레이로 숨으면 WebView2 메모리 목표를 LOW로, 다시 보이면 NORMAL로.
/// 브라우저 패널 웹뷰도 같이 건다. 런타임이 _19(1.0.1661+)보다 낡으면 조용히 건너뛴다. mac은 아무것도 안 한다
#[cfg(windows)]
pub(crate) fn sync_memory_target(app: &AppHandle) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;
    // ponytail: 바뀔 때만 건다 — 숨은 동안 새로 만든 브라우저 패널 웹뷰는 다음 복원·숨김까지 NORMAL (W6 확인, 손해는 메모리 조금)
    static LOW: AtomicBool = AtomicBool::new(false);
    fn apply(pw: tauri::webview::PlatformWebview, level: COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL) {
        unsafe {
            if let Ok(core) = pw.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_19>()) {
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        }
    }
    let Some(w) = app.get_webview_window("main") else { return };
    let low = w.is_minimized().unwrap_or(false) || !w.is_visible().unwrap_or(true);
    if LOW.swap(low, Ordering::SeqCst) == low {
        return;
    }
    let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
    let _ = w.with_webview(move |pw| apply(pw, level));
    if let Some(b) = app.get_webview(crate::browser::LABEL) {
        let _ = b.with_webview(move |pw| apply(pw, level));
    }
}

#[cfg(not(windows))]
pub(crate) fn sync_memory_target(_app: &AppHandle) {}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn quit_all(app: &AppHandle) {
    use crate::quit::{decide, Reply, EXITING};
    match decide(false, EXITING.load(Ordering::SeqCst), crate::diag::webview_silent()) {
        Reply::CleanupNow => {
            crate::finish_exit_sync(app);
            app.exit(0);
        }
        Reply::Ignore => {}
        Reply::AskFrontend => {
            show_main(app);
            let _ = app.emit_to("main", "app-quit-requested", ());
        }
    }
}

/// setup에서 한 번. 실패해도 앱은 돈다 — 닫기는 숨기기 대신 종료로 간다(running이 없으면 그렇듯)
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let (tip, count, open, quit) = labels(0, english(app));
    let count = MenuItem::with_id(app, "count", count, false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", open, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&count, &sep, &open, &quit])?;
    let mut b = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(tip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show_main(app),
            "quit" => quit_all(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    app.manage(TrayItems { count, open, quit });
    Ok(())
}

/// 세션 수·언어가 바뀌었을 때 — PTY 스폰·종료와 숨기기에서 부른다. 어느 스레드에서 불러도 된다
pub(crate) fn refresh(app: &AppHandle) {
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let (tip, count, open, quit) = labels(running(app), english(app));
    let _ = items.count.set_text(count);
    let _ = items.open.set_text(open);
    let _ = items.quit.set_text(quit);
    if let Some(t) = app.tray_by_id(TRAY_ID) {
        let _ = t.set_tooltip(Some(tip));
    }
}

/// 창 닫기 요청 (프런트 onCloseRequested) — true면 숨겼다, false면 부른 쪽이 종료 흐름을 탄다
#[tauri::command]
pub(crate) fn window_close_to_tray(app: AppHandle) -> bool {
    let n = running(&app);
    if app.try_state::<TrayItems>().is_none() || !should_hide(crate::setting_str(&app, "closeAction").as_deref(), n) {
        return false;
    }
    let Some(w) = app.get_webview_window("main") else { return false };
    if w.hide().is_err() {
        return false;
    }
    sync_memory_target(&app); // 숨김은 창 이벤트가 없어 여기서 건다
    refresh(&app);
    if !HINTED.swap(true, Ordering::SeqCst) {
        use tauri_plugin_notification::NotificationExt;
        let body = match (english(&app), cfg!(target_os = "macos")) {
            (true, false) => format!("EQMUX keeps running in the tray — {n} sessions. Use [Quit all] in the tray menu to exit."),
            (true, true) => format!("EQMUX keeps running in the Dock — {n} sessions. Use [Quit all] in the menu bar icon to exit."),
            (false, false) => format!("EQMUX가 트레이에서 계속 실행 중입니다 — 세션 {n}개. 끄려면 트레이 메뉴의 [전부 종료]."),
            (false, true) => format!("EQMUX가 Dock에서 계속 실행 중입니다 — 세션 {n}개. 끄려면 메뉴 막대 아이콘의 [전부 종료]."),
        };
        let _ = app.notification().builder().title("EQMUX").body(body).show();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_only_when_something_runs_and_quit_is_not_chosen() {
        assert!(should_hide(None, 2), "기본은 트레이");
        assert!(should_hide(Some("tray"), 1));
        assert!(!should_hide(Some("quit"), 3), "닫으면 종료를 골랐다");
        assert!(!should_hide(None, 0), "도는 것이 없으면 숨길 이유가 없다");
    }
}
