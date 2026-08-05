//! 레이아웃 트리 명령 (S2-1).
//!
//! 트리를 **백엔드가 들고 있는 이유**는 하나다 — PTY를 죽이는 책임이 여기 있기 때문이다.
//! 잎이 사라지면 그 잎이 참조하던 PTY도 죽어야 하는데, 프런트가 그 일을 맡으면
//! 새로고침·크래시·창 닫힘에서 고아 프로세스가 남는다 (`layout.rs` §소유권).
//!
//! 프런트는 이 트리를 **읽어서 그린다**(`S2-2`). 드래그처럼 프레임마다 바뀌는 값은
//! 프런트가 자기 사본으로 먼저 움직이고, 놓는 순간 `layout_set_weights`로 확정한다 —
//! 60 Hz로 IPC를 왕복시키지 않는다 (`S2-3`).

use tauri::State;

use crate::error::Result;
use crate::layout::{Direction, LayoutState, LayoutStore, TabClosed};
use crate::presets::{self, PresetInfo};
use crate::pty::PtyManager;

/// 지금 트리를 통째로 준다. `S2-2`가 이걸로 화면을 그린다.
#[tauri::command]
pub fn layout_get(store: State<'_, LayoutStore>) -> Result<LayoutState> {
    Ok(store.get())
}

/// 잎 하나를 나눈다. 새 잎의 id를 돌려준다 — 호출자는 그 잎에 붙일 PTY를 띄우면 된다.
#[tauri::command]
pub fn layout_split(
    store: State<'_, LayoutStore>,
    target_leaf: String,
    direction: Direction,
) -> Result<String> {
    store.update(|st| st.split(&target_leaf, direction))
}

/// 잎을 닫고 **그 잎이 참조하던 PTY를 죽인다.** 죽인 id를 돌려준다.
///
/// 트리에서 빠지는 것과 프로세스가 죽는 것이 한 명령 안에서 끝나야 한다.
/// 둘로 나누면 그 사이에 죽는 경로가 생기고, 그때 PTY만 남는다.
#[tauri::command]
pub fn layout_close(
    store: State<'_, LayoutStore>,
    pty: State<'_, PtyManager>,
    leaf_id: String,
) -> Result<Vec<String>> {
    let killed = store.update(|st| st.close(&leaf_id))?;
    for id in &killed {
        // 이미 죽은 PTY를 다시 죽이는 것은 실패가 아니다 — 트리에서는 이미 뺐다.
        if let Err(e) = pty.kill(id) {
            eprintln!("[eqmux][layout] PTY {id} 정리 실패(무시): {e}");
        }
    }
    Ok(killed)
}

/// 한 분할의 비율을 확정한다. 합은 자동으로 1.0으로 정규화된다.
#[tauri::command]
pub fn layout_set_weights(
    store: State<'_, LayoutStore>,
    split_id: String,
    weights: Vec<f64>,
) -> Result<()> {
    store.update(|st| st.set_weights(&split_id, &weights))
}

#[tauri::command]
pub fn layout_focus(store: State<'_, LayoutStore>, leaf_id: String) -> Result<()> {
    store.update(|st| st.set_focus(&leaf_id))
}

/// **탭에** PTY id를 붙이거나(`Some`) 뗀다(`None`). 소유가 아니라 참조다.
///
/// `S2-5` 전에는 잎이 대상이었다. 한 패널에 셸이 여럿 생겼으므로 대상도 탭으로 내려왔다.
#[tauri::command]
pub fn layout_attach_pty(
    store: State<'_, LayoutStore>,
    tab_id: String,
    pty_id: Option<String>,
) -> Result<()> {
    store.update(|st| st.attach_pty(&tab_id, pty_id))
}

// ── 탭 (`S2-5`) ──────────────────────────────────────────────────────────────
//
// 경계는 `layout_close`와 같다 — **트리에서 빼는 것과 프로세스를 죽이는 것이 한 명령 안에서**
// 끝나야 한다. 둘로 나누면 그 사이에 죽는 경로가 생기고, 그때 PTY만 남는다.
//
// 프런트는 `panels.ts`의 newTab/selectTab/closeTab으로만 접근한다 — 이 명령을 직접 부르면
// 트리만 바뀌고 화면(터미널 요소·포커스)이 안 따라온다(`layout_apply_preset`과 같은 이유).

/// 패널에 탭을 하나 더 연다. 새 탭의 id를 돌려준다 — 호출자는 그 탭에 붙일 셸을 띄우면 된다.
#[tauri::command]
pub fn layout_tab_new(store: State<'_, LayoutStore>, leaf_id: String) -> Result<String> {
    store.update(|st| st.tab_new(&leaf_id))
}

/// 탭을 고른다. **트리 모양을 안 건드린다** — 그래서 세션이 죽지 않는다.
#[tauri::command]
pub fn layout_tab_select(store: State<'_, LayoutStore>, tab_id: String) -> Result<()> {
    store.update(|st| st.tab_select(&tab_id))
}

/// 탭을 닫고 **그 탭이 참조하던 PTY를 죽인다.** 마지막 탭이면 패널째 닫힌다.
#[tauri::command]
pub fn layout_tab_close(
    store: State<'_, LayoutStore>,
    pty: State<'_, PtyManager>,
    tab_id: String,
) -> Result<TabClosed> {
    let closed = store.update(|st| st.tab_close(&tab_id))?;
    for id in &closed.killed {
        // 이미 죽은 PTY를 다시 죽이는 것은 실패가 아니다 — 트리에서는 이미 뺐다.
        if let Err(e) = pty.kill(id) {
            eprintln!("[eqmux][layout] PTY {id} 정리 실패(무시): {e}");
        }
    }
    Ok(closed)
}

// ── 배치 프리셋 (`S2-11`) ────────────────────────────────────────────────────
//
// 경계 API는 이 둘뿐이다. `S2-12`(피커 · 해원)와 `S2-13`(상태바 · 이안)은
// **프런트 `panels.ts`의 applyPreset/currentPreset/listPresets**로만 접근한다 —
// 이 명령을 직접 부르지 않는다. 화면 상태(줌·포커스)와 어긋나지 않게 하는 것이
// `PanelManager`의 일이기 때문이다(`S2-4`에서 요소 접근자를 안 연 이유와 같다).

/// 프리셋을 적용한다 — **트리 모양만 바꾸고 세션은 그대로 옮겨 담는다**(`presets.rs`).
///
/// PTY를 죽이지 않는다. 죽는 경로는 `layout_close` 하나뿐이고, 여기는 그 경로를 지나지 않는다.
#[tauri::command]
pub fn layout_apply_preset(store: State<'_, LayoutStore>, preset: String) -> Result<()> {
    store.update(|st| presets::apply(st, &preset))
}

/// 프리셋 6종 메타. **지금 세션 수 N 기준**의 실제 배치가 같이 실려 나간다.
///
/// 피커가 목록을 하드코딩하지 않게 하려고 연다(`S2-12` 브리프 §2) —
/// 종류가 늘거나 이름이 바뀌면 이 파일만 고치면 된다.
#[tauri::command]
pub fn layout_presets(store: State<'_, LayoutStore>) -> Vec<PresetInfo> {
    presets::list(&store.get())
}

/// 지금 트리를 상태 파일로 남긴다.
///
/// 주기적 저장은 `S3-4`다. 지금은 **호출해야 저장된다** — 자동 저장을 여기서 만들면
/// 30초마다 쓰는 파일이 생기는데, 그 파일이 커지지 않는지는 아직 아무도 안 재 봤다.
#[tauri::command]
pub fn layout_save(store: State<'_, LayoutStore>) -> Result<()> {
    store.persist()
}
