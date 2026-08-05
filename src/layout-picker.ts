// S2-12 — 배치 피커(`Ctrl+Shift+L`). (해원)
//
// 경계 (BRIEF-2026-08-05-S2-12 §1 · panels.ts `S2-11` 경계 API 머리말):
//   panels.ts의 공개 API만 쓴다 — listPresets · applyPreset · currentPreset ·
//   activeLeaf · focus · onLayoutChanged · size. 내부(DOM 구조·Panel 필드)에 기대지 않는다.
//   `layout_apply_preset`을 직접 부르지 않는다 — 트리만 바꾸면 화면이 안 따라온다(그 파일 머리말).
//   프리셋 목록은 **하드코딩하지 않는다.** 6종이 늘거나 이름이 바뀌면 백엔드만 고치면 된다.
//
// 키 규칙 (KEYMAP-S2-7 §1-① · S2-4와 같은 방식):
//   닫혀 있을 때 가로채는 것은 `Ctrl+Shift+L` 하나뿐이다. Ctrl 단독 조합은 안 건드린다.
//   상시 비용은 분기 둘(열림 여부 · !ctrlKey)이다 — 계측 모드에도 리스너를 걸어
//   이 비용이 A-3 표본에 포함되게 한다(회귀 근거. `focus.ts`와 같은 이유).
//   열려 있는 동안은 **모달이다** — 모든 키가 터미널로 내려가지 않는다.
//
// 디자인 모순 판단 (브리프 §3 — 해원 몫):
//   부제 "선택 즉시 재배열" vs 푸터 [적용] 버튼. **즉시 적용을 택했다.**
//   근거: applyPreset이 **비파괴적**이다 — 잎(세션)을 옮겨 담을 뿐 PTY도 xterm 버퍼도 안 죽는다
//   (`S2-11` 브리프 §2 "재배열이지 재생성이 아니다"). 확정 단계는 **되돌릴 수 없는 것** 앞에 두는
//   장치인데, 여기는 잘못 골라도 다른 프리셋을 고르면 그만이라 지켜 줄 것이 없다.
//   그래서 [적용]은 "이 배치로 하겠다"는 **확정·닫기**이고 Enter가 같은 일을 한다.
//   자세한 근거와 대안 검토는 docs/PICKER-S2-12.md §1.
//
//   ⚠️ **되돌리기(Esc 취소)는 넣지 않았다.** 프리셋에서 벗어난 배치(드래그로 만든 비율)는
//   복원할 API가 없어서 **반만 되는 되돌리기**가 된다 — "Esc면 안전하다"는 잘못된 기대를
//   만드느니 안 넣는 쪽이 정직하다. 필요해지면 레이아웃 스냅숏 API가 선행이다(→ 세아).

import type { PresetInfo } from "./panels";

/** panels.ts 공개 API 중 이 파일이 쓰는 부분 — 구조적 타입이라 PanelManager를 import하지 않는다. */
export interface PickerHost {
  /** 살아 있는 패널 수 — 부제의 "세션 N개". 8을 박지 않는다(브리프 §2). */
  readonly size: number;
  listPresets(): Promise<PresetInfo[]>;
  currentPreset(): PresetInfo | null;
  applyPreset(id: string): Promise<void>;
  activeLeaf(): string | null;
  focus(leafId: string): Promise<void>;
  onLayoutChanged(cb: () => void): () => void;
}

/** 디자인 실물 `M0FL0` 프리셋 그리드가 3열이다 — 화살표 이동이 이 수를 쓴다. */
const COLUMNS = 3;

let installed = false;
let host: PickerHost | null = null;
let unsubscribeLayout: (() => void) | null = null;

let open = false;
/** 열기 진행 중 — `listPresets()` 왕복 사이에 같은 키가 또 오면 두 번 열린다. */
let opening = false;
let overlayEl: HTMLElement | null = null;
let gridEl: HTMLElement | null = null;
let subEl: HTMLElement | null = null;
let cells: HTMLButtonElement[] = [];
let metas: PresetInfo[] = [];
let cursor = 0;

/**
 * 캡처 단계 keydown 리스너를 건다 — xterm(타깃 단계)보다 먼저 돈다.
 * 계측 모드 포함 모든 기동 경로에서 한 번 부른다. 연결(connectPicker) 전에는
 * 어떤 키도 가로채지 않고 통과시킨다 — 비용(분기)만 하고 동작은 없다.
 */
export function installPickerKeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", onKeydown, { capture: true });
}

/** 일반 기동에서 PanelManager가 준비된 뒤 연결한다. 이때부터 `Ctrl+Shift+L`이 동작한다. */
export function connectPicker(h: PickerHost): void {
  host = h;
  unsubscribeLayout?.();
  // 열려 있는 동안 배치가 밖에서 바뀌면(다른 경로의 분할·닫기) 선택 표시가 낡는다.
  // **강조만 고친다** — 여기서 다시 그리면 applyPreset → onLayoutChanged → 재그리기로 돈다.
  unsubscribeLayout = h.onLayoutChanged(() => {
    if (open) markCurrent();
  });
}

/** 테스트·교차검증용 — 지금 피커가 열려 있는가. */
export function isPickerOpen(): boolean {
  return open;
}

/**
 * 키 없이 피커를 연다 — 관제 화면의 배치 버튼(D 트랙, `dash.ts`)이 부른다.
 * 미연결(계측 모드)이면 조용히 아무 일도 안 한다 — `Ctrl+Shift+L`과 같은 조건이다.
 */
export function openPickerNow(): void {
  void openPicker();
}

// ── 키 처리 ──────────────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  if (open) {
    // 모달이다 — 열려 있는 동안 어떤 키도 터미널로 안 내려간다.
    e.stopPropagation();
    handleOpenKey(e);
    return;
  }
  if (!e.ctrlKey) return; // 상시 비용은 이 분기 — Ctrl 없는 키는 여기서 끝난다.
  if (!host) return; // 미연결(계측 모드) — 통과.
  if (e.metaKey || e.altKey || !e.shiftKey) return;
  // `e.code` — 한글 자판 상태에서도 물리 L 키로 잡는다. `e.key`는 IME 상태에 흔들린다.
  if (e.code !== "KeyL") return;
  e.preventDefault();
  e.stopPropagation(); // 캡처 단계라 xterm 핸들러까지 안 내려간다 — 터미널 키 누수 차단.
  if (e.repeat) return; // 누르고 있으면 열고 닫기가 깜빡인다 — 반복은 삼킨다.
  void openPicker();
}

function handleOpenKey(e: KeyboardEvent): void {
  // 토글 — 열려 있을 때 같은 키면 닫는다.
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyL") {
    e.preventDefault();
    if (!e.repeat) closePicker();
    return;
  }
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      closePicker();
      return;
    case "Enter":
      // 선택은 이미 적용돼 있다 — Enter는 [적용] 버튼과 같은 "확정·닫기"다.
      e.preventDefault();
      closePicker();
      return;
    // ⚠️ 반복(누르고 있기)은 **이동도 안 시킨다.** `focus.ts`는 반복 이동을 허용했지만
    // 거기서 이동은 공짜였다 — 여기서 이동은 곧 적용이다. 반복을 이동만 시키고 적용을 빼면
    // 강조된 칸(적용된 배치)과 커서가 갈려서, Enter를 눌렀을 때 커서 칸이 아닌 배치로 닫힌다.
    // 6칸짜리 그리드에 빠른 이동이 필요하지도 않다.
    case "ArrowLeft":
      e.preventDefault();
      if (!e.repeat) setCursor(cursor - 1);
      return;
    case "ArrowRight":
      e.preventDefault();
      if (!e.repeat) setCursor(cursor + 1);
      return;
    case "ArrowUp":
      e.preventDefault();
      if (!e.repeat) setCursor(cursor - COLUMNS);
      return;
    case "ArrowDown":
      e.preventDefault();
      if (!e.repeat) setCursor(cursor + COLUMNS);
      return;
    case "Home":
      e.preventDefault();
      if (!e.repeat) setCursor(0);
      return;
    case "End":
      e.preventDefault();
      if (!e.repeat) setCursor(metas.length - 1);
      return;
  }
  // 나머지는 삼키기만 한다(위에서 stopPropagation). preventDefault는 안 건다 —
  // Tab으로 버튼 사이를 걷는 브라우저 기본 동작까지 죽일 이유는 없다.
}

function setCursor(next: number): void {
  if (metas.length === 0) return;
  const clamped = Math.max(0, Math.min(metas.length - 1, next));
  if (clamped === cursor) return; // 끝에서 더 가면 아무 일도 안 한다 — 감아 돌지 않는다(focus.ts와 같은 판단).
  cursor = clamped;
  cells[cursor]?.focus();
  // **선택이 곧 적용이다** — 부제가 약속한 그대로. 화살표로 훑으면 화면이 따라 바뀐다.
  void choose(cursor);
}

// ── 열기 / 닫기 ──────────────────────────────────────────────────────────────

async function openPicker(): Promise<void> {
  if (!host || open || opening) return;
  opening = true;
  try {
    // 목록은 **열 때마다 다시 받는다.** `groups`가 지금 세션 수 기준이라(panels.ts §S2-11)
    // 패널을 나눈 뒤에 열면 다른 배치가 나와야 맞다.
    metas = await host.listPresets();
  } finally {
    opening = false;
  }
  open = true;
  // 현재 배치를 고른 상태로 연다 — 컨텍스트 바가 이미 `2 × 4`를 보여주고 있는데
  // 피커만 아무것도 안 고른 얼굴이면 어긋난다(브리프 §2).
  const curIdx = metas.findIndex((m) => m.id === host?.currentPreset()?.id);
  cursor = curIdx >= 0 ? curIdx : 0;
  render();
  markCurrent();
  cells[cursor]?.focus();
}

function closePicker(): void {
  if (!open) return;
  open = false;
  overlayEl?.setAttribute("hidden", "");
  // 터미널로 포커스를 돌려준다. `focus()`는 이미 포커스된 잎이어도 applyFocus()를 타서
  // xterm에 DOM 포커스를 다시 준다(panels.ts:376-388) — 피커가 가져간 포커스가 여기서 풀린다.
  const leaf = host?.activeLeaf();
  if (leaf) void host?.focus(leaf);
}

/** 칸 하나를 고른다 = 적용한다. 모르는 이름은 panels.ts가 삼키고 남긴다 — 피커는 안 죽는다. */
async function choose(idx: number): Promise<void> {
  const meta = metas[idx];
  if (!host || !meta) return;
  await host.applyPreset(meta.id);
  markCurrent();
  // ⚠️ applyPreset은 끝에 reconcile → applyFocus()를 타고, 거기서 `term.focus()`가
  // **DOM 포커스를 터미널로 가져간다**(panels.ts:673-683). 피커가 아직 열려 있으면
  // 방금 고른 칸의 포커스 링이 사라지고 Tab 기점도 터미널로 옮겨간다 — 되돌려 놓는다.
  // (키 입력 자체는 캡처 단계에서 막고 있어 새지 않는다. 여기서 고치는 건 포커스 위치다.)
  if (open) cells[cursor]?.focus();
}

// ── 그리기 ───────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * 오버레이는 **첫 열기 때 만든다.** 안 열면 DOM이 0이다 —
 * 관문 A2가 재는 것이 "유휴 RAM"이라, 안 쓰는 화면을 미리 지어 둘 이유가 없다.
 */
function ensureShell(): void {
  if (overlayEl) return;

  overlayEl = el("div", "picker-overlay");
  overlayEl.setAttribute("hidden", "");
  // 바깥을 누르면 닫는다. 안쪽 클릭은 아래 dialog에서 멈춘다.
  overlayEl.addEventListener("mousedown", (ev) => {
    if (ev.target === overlayEl) closePicker();
  });

  const dialog = el("div", "picker");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "페인 배치");
  dialog.addEventListener("mousedown", (ev) => ev.stopPropagation());

  // 헤더 — design.pen `DVZE9`
  const head = el("header", "picker-head");
  const headRow = el("div", "picker-head-row");
  headRow.appendChild(el("h2", "picker-title", "페인 배치"));
  const close = el("button", "picker-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "닫기");
  close.addEventListener("click", () => closePicker());
  headRow.appendChild(close);
  head.appendChild(headRow);
  subEl = el("p", "picker-sub");
  head.appendChild(subEl);

  // 프리셋 그리드 — design.pen `M0FL0`
  gridEl = el("div", "picker-grid");

  // 푸터 — design.pen `kzXeb`
  const foot = el("footer", "picker-foot");
  foot.appendChild(
    el("span", "picker-hint", "적용 후에도 분할선을 드래그해 비율을 조정할 수 있습니다"),
  );
  const apply = el("button", "picker-apply", "적용");
  apply.type = "button";
  apply.addEventListener("click", () => closePicker());
  foot.appendChild(apply);

  dialog.append(head, gridEl, foot);
  overlayEl.appendChild(dialog);
  document.body.appendChild(overlayEl);
}

function render(): void {
  ensureShell();
  if (!overlayEl || !gridEl || !subEl) return;

  const n = host?.size ?? 0;
  subEl.textContent = `현재 팀의 세션 ${n}개 · 선택 즉시 재배열`;

  gridEl.textContent = "";
  cells = metas.map((m, i) => {
    const cell = el("button", "picker-cell");
    cell.type = "button";
    cell.dataset.preset = m.id;
    cell.appendChild(thumb(m));
    cell.appendChild(el("span", "picker-cell-label", m.label));
    cell.addEventListener("click", () => {
      cursor = i;
      void choose(i);
    });
    gridEl!.appendChild(cell);
    return cell;
  });

  if (metas.length === 0) {
    // 목록을 못 받은 경우다(panels.ts가 이미 stderr에 남겼다). 빈 상자를 조용히 보여주지 않는다.
    gridEl.appendChild(el("p", "picker-empty", "배치 목록을 불러오지 못했습니다 — 로그를 확인하세요"));
  }

  overlayEl.removeAttribute("hidden");
}

/**
 * 미리보기 썸네일 — `axis`/`groups`로 그린다.
 * `axis: "row"`면 `groups`가 **열**이고 각 열에 `groups[i]`개가 세로로 쌓인다(열 우선 · GRID-COL).
 * 정원(capacity)이 아니라 **지금 세션 수 기준의 실제 배치**라, 세션이 3개면 3칸짜리 그림이 나온다.
 */
function thumb(p: PresetInfo): HTMLElement {
  const t = el("div", "picker-thumb");
  t.classList.add(p.axis === "row" ? "axis-row" : "axis-column");
  for (const count of p.groups) {
    const g = el("div", "picker-thumb-group");
    for (let i = 0; i < count; i++) g.appendChild(el("div", "picker-thumb-cell"));
    t.appendChild(g);
  }
  return t;
}

/** 지금 걸린 배치에 표시를 준다. 다시 그리지 않는다 — 강조만 바꾼다. */
function markCurrent(): void {
  const curId = host?.currentPreset()?.id ?? null;
  cells.forEach((c, i) => {
    const on = metas[i]?.id === curId;
    c.classList.toggle("current", on);
    c.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
