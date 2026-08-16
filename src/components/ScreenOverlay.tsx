// 전체 화면 팝업 셸 (M25 확장) — NAV 도구 4종(임무·워크스페이스·역할·설정)이 공유한다.
// 앱 바(항상 보임)의 버튼이 토글하므로 터미널 전체 화면 위에서도 열린다 (z 50 > 40).
// overlay 신호가 하나라서 동시에 하나만 열린다 — 열림/닫힘 관리는 state.overlay가 소유한다.
import { onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { setOverlay } from "../state";
import { t } from "../i18n";

export function ScreenOverlay(props: {
  title: string;
  icon?: string;
  /** true를 돌려주면 ESC 닫기를 막는다 — 임무 탐색기의 미저장 편집 보호가 쓴다 */
  guard?: () => boolean;
  children: JSX.Element;
}) {
  onMount(() => {
    // 캡처 단계 + 전파 중단 — 아래 깔린 터미널 전체 화면의 ESC 핸들러가 함께 닫히지 않게
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!props.guard?.()) setOverlay(undefined);
      }
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  return (
    <div class="explorer-fullscreen">
      <div class="tf-head">
        <span class="mono tf-title">
          {props.icon ?? "≡"} {props.title} <span class="muted">· FULL VIEW</span>
        </span>
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <span class="mono muted" style={{ "font-size": "10px" }}>
            {t("ESC 닫기")}
          </span>
          <button class="btn" onClick={() => setOverlay(undefined)}>
            ✕ {t("닫기")}
          </button>
        </div>
      </div>
      <div class="overlay-screen-body">{props.children}</div>
    </div>
  );
}
