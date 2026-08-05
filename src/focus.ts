// S2-4 — 방향 포커스 이동(Ctrl+Alt+화살표) + 패널 줌(Ctrl+Shift+Z). (해원)
//
// 경계 (BRIEF-2026-08-05-S2-4 §1 · LAYOUT-S2-3 §3 · d3d9e80):
//   panels.ts의 공개 API만 쓴다 — leafIds · activeLeaf · panelRect · focus ·
//   setZoom/zoomedLeaf · onLayoutChanged. 내부(DOM 구조·Panel 필드)에 기대지 않는다.
//   줌의 정본 상태와 그리기는 panels.ts가 소유한다(요소 접근자를 안 여는 이유가 그 파일에 있다) —
//   여기는 **언제 걸고 언제 풀지**만 정한다.
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

/** panels.ts 공개 API 중 이 파일이 쓰는 부분 — 구조적 타입이라 PanelManager를 import하지 않는다. */
export interface FocusHost {
  leafIds(): string[];
  activeLeaf(): string | null;
  panelRect(leafId: string): PanelRect | null;
  focus(leafId: string): Promise<void>;
  setZoom(leafId: string | null): void;
  zoomedLeaf(): string | null;
  onLayoutChanged(cb: () => void): () => void;
}

type Direction = "left" | "right" | "up" | "down";
type Action = { kind: "move"; dir: Direction } | { kind: "zoom" };

let installed = false;
let host: FocusHost | null = null;
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
}

/** 일반 기동에서 PanelManager가 준비된 뒤 연결한다. 이때부터 키가 실제로 동작한다. */
export function connectFocus(h: FocusHost): void {
  host = h;
  unsubscribeLayout?.();

  // 줌 중 구조 변경(분할·닫기) → 줌을 풀고 보여준다. panels.ts는 새 잎을 숨은 채 만들고
  // 그대로 두는 쪽을 택했고("언제 걸지는 호출자 몫"), 여기가 그 호출자다 — 숨은 채 생긴
  // 패널을 사용자가 볼 방법이 없으면 "분할 키가 죽었다"로 읽힌다.
  //
  // ⚠️ setZoom 자체도 onLayoutChanged를 울린다 — 알림마다 무조건 풀면 줌이 걸리는 즉시
  // 풀린다. 그래서 **잎 집합이 실제로 바뀌었을 때만** 푼다. (줌된 잎이 닫히는 경우는
  // panels.ts reconcile이 스스로 푼다 — 여기서 할 일이 없다.)
  let lastLeaves = h.leafIds().join(",");
  unsubscribeLayout = h.onLayoutChanged(() => {
    const now = h.leafIds().join(",");
    const changed = now !== lastLeaves;
    lastLeaves = now;
    if (changed && h.zoomedLeaf()) h.setZoom(null);
  });
}

// ── 키 처리 ──────────────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  if (!e.ctrlKey) return; // 상시 비용은 이 분기 하나 — Ctrl 없는 키는 여기서 끝난다(①).
  const action = match(e);
  if (!action || !host) return; // 앱 층 키가 아니거나 미연결(계측 모드) — 전부 통과.
  e.preventDefault();
  e.stopPropagation(); // 캡처 단계라 xterm 핸들러까지 내려가지 않는다 — 터미널 키 누수 차단.
  // 줌은 누르고 있으면 keydown 반복으로 토글이 깜빡인다 — 반복은 삼키되 동작만 막는다
  // (통과시키면 반복분이 터미널로 샌다). 이동은 반복을 허용한다 — 화살표를 눌러 걷는 동작이다.
  if (action.kind === "zoom" && e.repeat) return;
  run(host, action);
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

function run(h: FocusHost, action: Action): void {
  if (action.kind === "zoom") {
    // 토글 — panels.ts 머리말이 권하는 그 한 줄이다. 패널 하나면 이미 전체 화면이다.
    if (h.zoomedLeaf() === null && h.leafIds().length < 2) return;
    h.setZoom(h.zoomedLeaf() ? null : h.activeLeaf());
    return;
  }
  // 줌 상태에서의 방향 이동 — 줌을 풀고 이동한다. 숨은 패널로 포커스만 옮기면
  // "입력은 가는데 안 보이는" 상태가 된다. 확대는 일시적 상태고 이동이 이긴다.
  if (h.zoomedLeaf()) h.setZoom(null);
  const target = pickDirectional(h, action.dir);
  if (target) void h.focus(target);
}

// ── 방향 탐색 — 화면 기하 ────────────────────────────────────────────────────

function pickDirectional(h: FocusHost, dir: Direction): string | null {
  const activeId = h.activeLeaf();
  if (!activeId) return null;
  const from = h.panelRect(activeId);
  if (!from) return null;

  // 경계 반올림 흡수용 허용치. 분할선 폭과는 무관하다 — 이웃 판정은 rect 경계로 한다.
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
