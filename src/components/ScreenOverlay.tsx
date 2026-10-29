// 전체 화면 팝업 셸 (M25 확장) — NAV 도구 4종(임무·워크스페이스·역할·설정)이 공유한다.
// 앱 바(항상 보임)의 버튼이 토글하므로 터미널 전체 화면 위에서도 열린다 (z 50 > 40).
// overlay 신호가 하나라서 동시에 하나만 열린다 — 열림/닫힘 관리는 state.overlay가 소유한다.
import { onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { guardOverlay, pushLayer, setOverlay } from "../state";
import { t } from "../i18n";
import { notify } from "./ui";
import { Icon } from "./icons";
import type { IconName } from "./icons";

export function ScreenOverlay(props: {
  title: string;
  /** 앱 바 버튼과 같은 아이콘 — 글자 기호(⌂·◇·⚙)는 mac에서 폴백 글꼴로 작게 그려졌다 (UC-B03) */
  icon?: IconName;
  /** true를 돌려주면 닫기(ESC·✕·화면 이동)를 막는다 — 임무 탐색기의 미저장 편집 보호가 쓴다 */
  guard?: () => boolean;
  /** 헤더 아래 전환 줄 (0.3.7) — 팝업이 화면을 둘 이상 품을 때만 준다 (임무 탐색기) */
  nav?: JSX.Element;
  children: JSX.Element;
}) {
  // ESC는 레이어 스택이 맨 위 하나에만 준다 (P30) — 이 팝업 위에 뜬 확인창·메뉴가 먼저 닫힌다
  onCleanup(pushLayer(() => setOverlay(undefined)));
  const guard = props.guard;
  if (guard)
    onCleanup(
      guardOverlay(() => {
        if (!guard()) return false;
        notify(t("저장하지 않은 편집이 있어 팝업을 닫지 않았습니다 — 저장하거나 편집을 취소하세요"));
        return true;
      }),
    );

  return (
    <div class="explorer-fullscreen">
      <div class="tf-head">
        <span class="mono tf-title">
          <Icon name={props.icon ?? "file-text"} size={13} /> {props.title} <span class="muted">· {t("전체 화면")}</span>
        </span>
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <span class="mono muted" style={{ "font-size": "10px" }}>
            {t("ESC 닫기")}
          </span>
          <button class="btn" onClick={() => setOverlay(undefined)}>
            <Icon name="x" size={11} /> {t("닫기")}
          </button>
        </div>
      </div>
      <Show when={props.nav}>
        <div class="ov-nav">{props.nav}</div>
      </Show>
      <div class="overlay-screen-body">{props.children}</div>
    </div>
  );
}
