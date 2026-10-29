//! 창 위치·크기 기억 (B134·B141) — macOS 전용. tauri.conf.json의 maximized+center는 Windows에서는
//! 최대화로 맞지만, macOS에서는 1440×900 기준 가운데 원점을 둔 채 크기만 화면만큼 커져 창이
//! 화면 밖으로 밀렸다([종료]·벨·[✕ 닫기]가 잘림). macOS 설정(tauri.macos.conf.json)은 숨긴 창으로
//! 만들고, 여기서 자리를 정한 뒤 보인다:
//!   저장한 자리가 있으면 → 지금 붙은 모니터의 작업 영역 안으로 당겨 넣어 되살린다
//!   없으면(첫 기동)        → 작업 영역(메뉴 막대·Dock 뺀 화면)을 채운다 — Windows 최대화와 같은 첫인상
//! 자리는 정상 종료 때 저장한다(app_exit·시스템 종료 경로). 크래시면 직전 저장값을 쓴다.

use serde::{Deserialize, Serialize};

/// 물리 픽셀 사각형 — 모니터 배율이 달라도 tauri가 주는 단위 그대로 저장·비교한다
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// 이만큼은 화면 안에 보여야 '그 모니터에 있다'고 본다 — 제목 막대를 잡아 끌 수 있는 최소한
const MIN_VISIBLE: i64 = 120;

fn overlap(a: &Rect, b: &Rect) -> (i64, i64) {
    let w = (a.x as i64 + a.w as i64).min(b.x as i64 + b.w as i64) - (a.x as i64).max(b.x as i64);
    let h = (a.y as i64 + a.h as i64).min(b.y as i64 + b.h as i64) - (a.y as i64).max(b.y as i64);
    (w.max(0), h.max(0))
}

/// 사각형을 작업 영역 안으로 — 크기를 먼저 줄이고, 넘친 만큼 원점을 민다
fn clamp_into(r: &Rect, area: &Rect) -> Rect {
    let w = r.w.min(area.w);
    let h = r.h.min(area.h);
    let max_x = area.x as i64 + area.w as i64 - w as i64;
    let max_y = area.y as i64 + area.h as i64 - h as i64;
    Rect {
        x: (r.x as i64).clamp(area.x as i64, max_x) as i32,
        y: (r.y as i64).clamp(area.y as i64, max_y) as i32,
        w,
        h,
    }
}

/// 되살릴 자리 — 저장값이 가장 많이 걸친 작업 영역 안으로 당긴다. 어느 모니터에도 충분히
/// 걸치지 않으면(모니터를 뗐다) 첫 작업 영역(주 모니터)을 채운다. 작업 영역이 없으면 None
pub fn fit(saved: Option<Rect>, areas: &[Rect]) -> Option<Rect> {
    let first = *areas.first()?;
    let Some(s) = saved.filter(|s| s.w > 0 && s.h > 0) else { return Some(first) };
    let best = areas
        .iter()
        .map(|a| (a, overlap(&s, a)))
        .filter(|(_, (w, h))| *w >= MIN_VISIBLE && *h >= MIN_VISIBLE.min(s.h as i64))
        .max_by_key(|(_, (w, h))| w * h)
        .map(|(a, _)| *a);
    Some(match best {
        Some(a) => clamp_into(&s, &a),
        None => first,
    })
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{fit, Rect};
    use std::path::Path;
    use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

    const FILE: &str = "window.json";

    fn area_of(m: &tauri::Monitor) -> Rect {
        let wa = m.work_area();
        Rect { x: wa.position.x, y: wa.position.y, w: wa.size.width, h: wa.size.height }
    }

    /// 창을 정한 자리에 두고 보인다 — 실패해도 창은 반드시 보인다(숨은 채 남으면 앱이 없는 것과 같다)
    pub fn restore<R: Runtime>(win: &WebviewWindow<R>, root: &Path) {
        let saved: Option<Rect> = std::fs::read_to_string(root.join(FILE))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        // 주 모니터를 앞에 — 저장값이 쓸모없을 때 채울 곳
        let mut areas: Vec<Rect> = win.primary_monitor().ok().flatten().iter().map(area_of).collect();
        for m in win.available_monitors().unwrap_or_default() {
            let a = area_of(&m);
            if !areas.contains(&a) {
                areas.push(a);
            }
        }
        if let Some(r) = fit(saved, &areas) {
            let _ = win.set_size(PhysicalSize::new(r.w, r.h));
            let _ = win.set_position(PhysicalPosition::new(r.x, r.y));
        }
        let _ = win.show();
        let _ = win.set_focus();
    }

    /// 지금 자리를 남긴다 — 최소화·전체 화면 중이면 그 자리는 되살릴 자리가 아니므로 남기지 않는다
    pub fn save<R: Runtime>(win: &WebviewWindow<R>, root: &Path) {
        if win.is_minimized().unwrap_or(false) || win.is_fullscreen().unwrap_or(false) {
            return;
        }
        let (Ok(p), Ok(s)) = (win.outer_position(), win.outer_size()) else { return };
        let r = Rect { x: p.x, y: p.y, w: s.width, h: s.height };
        if let Ok(json) = serde_json::to_string(&r) {
            let _ = crate::workspace::atomic_write(&root.join(FILE), json.as_bytes());
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::{restore, save};

#[cfg(test)]
mod tests {
    use super::*;

    /// 1920×1080, 메뉴 막대 25px — 작업 영역은 그 아래
    const MAIN: Rect = Rect { x: 0, y: 25, w: 1920, h: 1055 };

    #[test]
    fn first_launch_fills_work_area() {
        assert_eq!(fit(None, &[MAIN]), Some(MAIN));
    }

    /// B141 — 실기에서 본 자리(214,102 · 1869×1055)는 화면 안으로 당겨진다
    #[test]
    fn pushed_off_screen_window_is_pulled_back_in() {
        let bad = Rect { x: 214, y: 102, w: 1869, h: 1055 };
        let r = fit(Some(bad), &[MAIN]).unwrap();
        assert!(r.x >= MAIN.x && r.y >= MAIN.y);
        assert!(r.x as i64 + r.w as i64 <= 1920 && r.y as i64 + r.h as i64 <= 25 + 1055);
        assert_eq!((r.w, r.h), (1869, 1055), "크기는 들어맞으면 그대로 둔다");
    }

    #[test]
    fn fitting_window_is_kept_as_is() {
        let ok = Rect { x: 100, y: 80, w: 1200, h: 800 };
        assert_eq!(fit(Some(ok), &[MAIN]), Some(ok));
    }

    /// 보조 모니터에 두고 끈 뒤 그 모니터를 떼면 주 모니터로 돌아온다
    #[test]
    fn detached_monitor_falls_back_to_primary() {
        let gone = Rect { x: 2200, y: 100, w: 1200, h: 800 };
        assert_eq!(fit(Some(gone), &[MAIN]), Some(MAIN));
        let side = Rect { x: 1920, y: 0, w: 2560, h: 1415 };
        assert_eq!(fit(Some(gone), &[MAIN, side]), Some(gone), "모니터가 그대로면 그 자리");
    }

    #[test]
    fn broken_or_missing_inputs() {
        assert_eq!(fit(Some(Rect { x: 0, y: 0, w: 0, h: 0 }), &[MAIN]), Some(MAIN));
        assert_eq!(fit(None, &[]), None);
    }
}
