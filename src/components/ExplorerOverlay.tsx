// 임무 · 파일 탐색기 전체 화면 팝업 (M25) — 사이드 패널 탭(440px)에서 승격.
// 앱 바(항상 보임)의 임무 버튼이 토글하므로 터미널 전체 화면 위에서도 열린다 (z 50 > 40).
import { onCleanup, onMount } from "solid-js";
import { setExplorerOpen } from "../state";
import { editorGuard, MissionExplorerTab } from "./MissionExplorerTab";

export function ExplorerOverlay() {
  onMount(() => {
    // 캡처 단계 + 전파 중단 — 아래 깔린 터미널 전체 화면의 ESC 핸들러가 함께 닫히지 않게.
    // 편집 중(미저장)에는 닫지 않는다 — 저장 또는 취소가 먼저다 (유실 보호)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!editorGuard()) setExplorerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  return (
    <div class="explorer-fullscreen">
      <div class="tf-head">
        <span class="mono tf-title">
          ≡ 임무 · 파일 탐색기 <span class="muted">· FULL VIEW</span>
        </span>
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <span class="mono muted" style={{ "font-size": "10px" }}>
            ESC 닫기
          </span>
          <button class="btn" onClick={() => setExplorerOpen(false)}>
            ✕ 닫기
          </button>
        </div>
      </div>
      <MissionExplorerTab />
    </div>
  );
}
