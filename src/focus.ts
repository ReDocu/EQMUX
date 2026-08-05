// S2-4 — 방향 포커스 이동(Ctrl+Alt+화살표) + 패널 줌(Ctrl+Shift+Z). (해원)
//
// 경계 (BRIEF-2026-08-05-S2-4 §1 · LAYOUT-S2-3 §3):
//   panels.ts의 공개 API만 쓴다 — leafIds · activeLeaf · panelRect(s) · focus · onLayoutChanged.
//   내부(DOM 구조·Panel 필드)에 기대지 않는다. 줌에 필요한 요소 접근자(panelElement)는
//   세아에게 요청해 뒀고, 열리기 전까지 줌은 "보류" 로그만 남긴다 — 조용히 실패하지 않는다.
//
// 키 규칙 (KEYMAP-S2-7 §1-①):
//   가로채는 것은 앱 층 키 둘뿐이다 — Ctrl+Alt+화살표 · Ctrl+Shift+Z.
//   Ctrl 단독 조합은 절대 건드리지 않는다. 리스너의 상시 비용은 `!e.ctrlKey` 분기 하나다 —
//   계측 모드에도 리스너를 걸어 이 비용이 A-3 표본에 포함되게 한다(회귀 근거).
//
// 방향 규칙 (브리프 §2):
//   트리가 아니라 화면 기하다. 활성 잎에서 그 방향에 있는 잎 중 **수직 축 겹침이 가장 큰** 잎.
//   겹침이 같으면(±0.5px) 가장 가까운 잎. 겹침이 전부 0이면(계단형 배치) 가까운 잎.
//   그 방향에 잎이 없으면 아무 일도 안 한다 — 감아 돌지 않는다(wrap 없음. 예측 가능성이 먼저다).

import type { PanelRect } from "./panels";
import { logError, logInfo } from "./log";

/** panels.ts 공개 API 중 이 파일이 쓰는 부분 — 구조적 타입이라 PanelManager를 import하지 않는다. */
export interface FocusHost {
  leafIds(): string[];
  activeLeaf(): string | null;
  panelRect(leafId: string): PanelRect | null;
  focus(leafId: string): Promise<void>;
  onLayoutChanged(cb: () => void): () => void;
}

/** 요소 접근자 — 세아에게 개방 요청한 API (2026-08-05). 열리면 줌이 그대로 동작한다. */
interface MaybeElementHost {
  panelElement?(leafId: string): HTMLElement | null;
}

type Direction = "left" | "right" | "up" | "down";
type Action = { kind: "move"; dir: Direction } | { kind: "zoom" };

let installed = false;
let host: FocusHost | null = null;
let zoomedId: string | null = null;
let unsubscribeLayout: (() => void) | null = null;

/**
 * 캡처 단계 keydown 리스너를 건다 — xterm(타깃 단계)보다 먼저 돈다.
 * 계측 모드 포함 모든 기동 경로에서 한 번 부른다. 연결(connectFocus) 전에는
 * 어떤 키도 가로채지 않고 통과시킨다 — 비용(분기 1회)만 하고 동작은 없다.
 */
export function installFocusKeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", onKeydown, { capture: true });
  injectZoomCss();
}

/** 일반 기동에서 PanelManager가 준비된 뒤 연결한다. 이때부터 키가 실제로 동작한다. */
export function connectFocus(h: FocusHost): void {
  host = h;
  // 구조가 바뀌면(분할·닫기·드래그 확정) 줌을 푼다 — 숨은 패널 위에서 구조를 바꾸면
  // 풀었을 때 화면이 다른 모양이 되어 있다. "줌 중 조작은 줌을 풀고 수행"이 그 결정이다.
  unsubscribeLayout?.();
  unsubscribeLayout = h.onLayoutChanged(() => {
    if (zoomedId) unzoom();
  });
}

// ── 키 처리 ──────────────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  if (!e.ctrlKey) return; // 상시 비용은 이 분기 하나 — Ctrl 없는 키는 여기서 끝난다(①).
  const action = match(e);
  if (!action || !host) return; // 앱 층 키가 아니거나 미연결(계측 모드) — 전부 통과.
  e.preventDefault();
  e.stopPropagation(); // 캡처 단계라 xterm 핸들러까지 내려가지 않는다 — 터미널 키 누수 차단.
  run(action);
}

function match(e: KeyboardEvent): Action | null {
  if (e.metaKey) return null;
  if (e.altKey && !e.shiftKey) {
    switch (e.key) {
      case "ArrowLeft":
        return { kind: "move", dir: "left" };
      case "ArrowRight":
        return { kind: "move", dir: "right" };
      case "ArrowUp":
        return { kind: "move", dir: "up" };
      case "ArrowDown":
        return { kind: "move", dir: "down" };
    }
    return null;
  }
  // `e.code` — 한글 자판 상태에서도 물리 Z 키로 잡는다. `e.key`는 IME 상태에 흔들린다.
  if (e.shiftKey && !e.altKey && e.code === "KeyZ") return { kind: "zoom" };
  return null;
}

function run(action: Action): void {
  if (action.kind === "zoom") {
    toggleZoom();
    return;
  }
  // 줌 상태에서의 방향 이동 — 줌을 풀고 이동한다. 숨은 패널로 포커스만 옮기면
  // "입력은 가는데 안 보이는" 상태가 된다. 확대는 일시적 상태고 이동이 이긴다.
  if (zoomedId) unzoom();
  const target = pickDirectional(action.dir);
  if (target) void host!.focus(target);
}

// ── 방향 탐색 — 화면 기하 ────────────────────────────────────────────────────

function pickDirectional(dir: Direction): string | null {
  const h = host!;
  const activeId = h.activeLeaf();
  if (!activeId) return null;
  const from = h.panelRect(activeId);
  if (!from) return null;

  // 분할선(잡는 폭 5px·선 1px)과 반올림을 흡수하는 허용치.
  const TOL = 2;
  const horizontal = dir === "left" || dir === "right";

  const candidates = h
    .leafIds()
    .filter((id) => id !== activeId)
    .map((id) => h.panelRect(id))
    .filter((r): r is PanelRect => !!r)
    .filter((r) => {
      switch (dir) {
        case "right":
          return r.left >= from.left + from.width - TOL;
        case "left":
          return r.left + r.width <= from.left + TOL;
        case "down":
          return r.top >= from.top + from.height - TOL;
        case "up":
          return r.top + r.height <= from.top + TOL;
      }
    });
  if (candidates.length === 0) return null; // 그 방향에 잎이 없다 — wrap 없음.

  const overlap = (r: PanelRect): number =>
    horizontal
      ? Math.max(0, Math.min(from.top + from.height, r.top + r.height) - Math.max(from.top, r.top))
      : Math.max(0, Math.min(from.left + from.width, r.left + r.width) - Math.max(from.left, r.left));

  const gap = (r: PanelRect): number => {
    switch (dir) {
      case "right":
        return r.left - (from.left + from.width);
      case "left":
        return from.left - (r.left + r.width);
      case "down":
        return r.top - (from.top + from.height);
      case "up":
        return from.top - (r.top + r.height);
    }
  };

  candidates.sort((a, b) => {
    const oa = overlap(a);
    const ob = overlap(b);
    if (Math.abs(oa - ob) > 0.5) return ob - oa; // ① 겹침 최대
    return gap(a) - gap(b); // ② 겹침이 같으면(전부 0 포함) 가장 가까운 잎
  });
  return candidates[0].leafId;
}

// ── 줌 ──────────────────────────────────────────────────────────────────────
//
// AgentCommender 방식 계승(브리프 §2 · FEATURE-DIFF B6): 다른 패널은 `visibility: hidden` —
// DOM을 떼지 않으므로 세션이 안 죽고, 레이아웃이 유지되므로 숨은 패널에 크기 변화가 없다
// (fit → pty_resize 폭주 없음). 확대 패널만 absolute로 컨테이너 전체를 덮는다 —
// 크기가 바뀐 것은 이 패널 하나뿐이라 panels.ts의 ResizeObserver가 fit을 정확히 1회 돌린다.

function toggleZoom(): void {
  if (zoomedId) {
    unzoom();
    return;
  }
  const h = host!;
  if (h.leafIds().length < 2) return; // 패널 하나는 이미 전체 화면이다.
  const activeId = h.activeLeaf();
  if (!activeId) return;

  const elOf = (h as unknown as MaybeElementHost).panelElement?.bind(h);
  if (!elOf) {
    // API가 아직 없다 — 조용히 무시하면 "키가 죽었다"로 읽힌다. 이유를 남긴다.
    logInfo("줌 보류 — panels.ts panelElement API 대기 중 (세아에게 요청함, 2026-08-05)");
    return;
  }
  const target = elOf(activeId);
  if (!target) {
    logError("줌 실패 — 활성 잎의 요소를 찾을 수 없다", activeId);
    return;
  }
  for (const id of h.leafIds()) {
    if (id === activeId) continue;
    elOf(id)?.classList.add("eq-zoom-hidden");
  }
  target.classList.add("eq-zoomed");
  zoomedId = activeId;
}

function unzoom(): void {
  zoomedId = null;
  // 기억해 둔 id가 아니라 **지금 화면의 전 잎**을 훑는다 — 줌 중에 잎이 죽었어도(닫기)
  // 남은 요소의 클래스를 전부 걷어야 숨은 패널이 남지 않는다.
  const h = host;
  const elOf = h && (h as unknown as MaybeElementHost).panelElement?.bind(h);
  if (h && elOf) {
    for (const id of h.leafIds()) {
      elOf(id)?.classList.remove("eq-zoomed", "eq-zoom-hidden");
    }
  }
  // 요소를 못 얻는 경로가 남아 있는 동안의 안전망 — 클래스가 남으면 패널이 안 보인다.
  for (const el of document.querySelectorAll(".eq-zoomed, .eq-zoom-hidden")) {
    el.classList.remove("eq-zoomed", "eq-zoom-hidden");
  }
}

/**
 * 줌 CSS — focus.ts가 자기 스타일을 자기 파일에서 주입한다(styles.css는 세아 영역과 섞이지 않게).
 * `#layout`에 `position: relative`가 필요하다 — absolute 확대의 기준 상자다.
 * 기존 styles.css는 #layout에 position을 주지 않으므로 추가이지 변경이 아니다.
 */
function injectZoomCss(): void {
  const style = document.createElement("style");
  style.textContent = [
    "#layout { position: relative; }",
    ".panel.eq-zoomed { position: absolute; inset: 0; z-index: 10; }",
    ".panel.eq-zoom-hidden { visibility: hidden; }",
  ].join("\n");
  document.head.appendChild(style);
}
