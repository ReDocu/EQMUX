//! macOS 앱 종료 경로 (B112·B115·B137·B138) — ⌘Q·Dock '종료'·로그아웃은 창 닫기(onCloseRequested)를
//! 거치지 않는다. NSApp terminate:가 바로 applicationWillTerminate(tao → RunEvent::Exit)로 가서
//! 확인창·flush·트리 종료·running.flag 지우기가 통째로 빠졌다 — 서버는 고아로 남고 다음 기동은
//! 크래시 창으로 시작했다. RunEvent::ExitRequested는 이 경로에서 오지 않아 prevent_exit로는 못 막는다.
//!
//! 그래서 tao의 앱 델리게이트에 applicationShouldTerminate:를 붙인다 (NSApp이 terminate: 때 묻는 곳):
//!   사람이 누른 종료(⌘Q·Dock)  → 창을 앞으로 부르고 프런트에 'app-quit-requested' → 취소로 답한다.
//!                                 프런트가 창 닫기와 같은 흐름(확인창 → performShutdown → app_exit)을 탄다
//!   시스템 종료(로그아웃·재시동·시스템 종료) → 기다려 줄 사람이 없다. 그 자리에서 정리하고 바로 끝낸다
//!   웹뷰가 죽어 답할 수 없을 때 → 위와 같이 정리하고 바로 끝낸다(⌘Q가 영영 안 먹는 일이 없게)
//!   app_exit가 이미 도는 중      → 사람 종료는 무시(곧 끝난다), 시스템 종료는 바로 끝낸다
//! tao는 정상 종료를 [NSApp stop:]으로 하므로 app_exit의 app.exit(0)이 여기를 다시 부르지 않는다.

use std::sync::atomic::{AtomicBool, Ordering};

/// app_exit가 시작됐다 — 그 뒤의 종료 요청은 확인창을 다시 띄우지 않는다
pub static EXITING: AtomicBool = AtomicBool::new(false);

/// NSApplicationTerminateReply
const TERMINATE_CANCEL: usize = 0;
const TERMINATE_NOW: usize = 1;

/// 종료 요청에 어떻게 답할지 — 순수 함수라 시험한다
#[derive(Debug, PartialEq)]
pub enum Reply {
    /// 프런트에 물어보고 지금은 취소한다
    AskFrontend,
    /// 그 자리에서 정리하고 끝낸다
    CleanupNow,
    /// 이미 끝나는 중 — 아무것도 하지 않고 취소한다
    Ignore,
}

pub fn decide(system_quit: bool, exiting: bool, webview_silent: bool) -> Reply {
    match (system_quit, exiting, webview_silent) {
        (true, _, _) => Reply::CleanupNow,
        (false, true, _) => Reply::Ignore,
        (false, false, true) => Reply::CleanupNow,
        (false, false, false) => Reply::AskFrontend,
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::runtime::{AnyClass, AnyObject, Sel};
    use objc2::{class, msg_send, sel};
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter, Manager};

    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// kAEQuitReason('why?') — 로그아웃·재시동·시스템 종료가 보낸 quit Apple event에만 붙는다.
    /// ⌘Q 메뉴·Dock '종료'에는 없다
    const KAE_QUIT_REASON: u32 = u32::from_be_bytes(*b"why?");

    unsafe fn system_quit() -> bool {
        let mgr: *mut AnyObject = msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
        if mgr.is_null() {
            return false;
        }
        let ev: *mut AnyObject = msg_send![mgr, currentAppleEvent];
        if ev.is_null() {
            return false;
        }
        let reason: *mut AnyObject = msg_send![ev, attributeDescriptorForKeyword: KAE_QUIT_REASON];
        !reason.is_null()
    }

    extern "C-unwind" fn should_terminate(_this: *mut AnyObject, _sel: Sel, _sender: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else { return TERMINATE_NOW };
        let system = unsafe { system_quit() };
        match decide(system, EXITING.load(Ordering::SeqCst), crate::diag::webview_silent()) {
            Reply::CleanupNow => {
                crate::diag::write(&format!("QUIT-NOW system={system}"));
                crate::finish_exit_sync(app);
                TERMINATE_NOW
            }
            Reply::Ignore => TERMINATE_CANCEL,
            Reply::AskFrontend => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                let _ = app.emit_to("main", "app-quit-requested", ());
                TERMINATE_CANCEL
            }
        }
    }

    /// setup에서 한 번 — 메인 스레드에서 불린다. 델리게이트를 못 찾으면 RunEvent::Exit 정리만 남는다
    pub fn install(app: &AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = if ns_app.is_null() { std::ptr::null_mut() } else { msg_send![ns_app, delegate] };
            if delegate.is_null() {
                crate::diag::write("QUIT-HOOK no app delegate");
                return;
            }
            let cls = (*delegate).class() as *const AnyClass as *mut AnyClass;
            let imp: objc2::runtime::Imp = std::mem::transmute(
                should_terminate as extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
            );
            // Q = NSUInteger 반환, @ self, : _cmd, @ sender
            let added = objc2::ffi::class_addMethod(cls, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
            if !added.as_bool() {
                crate::diag::write("QUIT-HOOK applicationShouldTerminate: already defined");
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::install;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn people_are_asked_system_is_not_kept_waiting() {
        assert_eq!(decide(false, false, false), Reply::AskFrontend, "⌘Q·Dock → 확인창 흐름");
        assert_eq!(decide(true, false, false), Reply::CleanupNow, "로그아웃은 막지 않고 정리만 한다");
        assert_eq!(decide(true, true, false), Reply::CleanupNow);
        assert_eq!(decide(false, true, false), Reply::Ignore, "종료 중 ⌘Q를 또 누르면 무시");
        assert_eq!(decide(false, false, true), Reply::CleanupNow, "웹뷰가 죽었으면 물을 곳이 없다");
    }
}
