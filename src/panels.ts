// S2-2 — 레이아웃 트리를 실제 화면으로 그린다.
//
// 백엔드(`layout.rs`)가 트리의 정본을 들고, 여기는 그 트리를 **읽어서** DOM으로 편다.
// 분할·닫기는 조작마다 다시 읽는다. 예외는 드래그(`S2-3`) 하나 — 드래그 중에는 프런트가
// flex-grow로 선행하고, **놓는 순간** `layout_set_weights`로 백엔드에 확정한다.
//
// 지키는 것 셋 (BRIEF-2026-08-05-S2-2 §2):
//   ① **닫으면 진짜로 없어진다.** PTY는 백엔드(`layout_close`)가 죽이고, 트리에서 사라진
//      잎의 xterm·WebGL 컨텍스트는 여기 `reconcile`이 정리한다. A2가 유휴 RAM을 잰다.
//   ② **폰트 스택은 한 곳에서만 만든다** — 모든 패널이 `createTerminal`을 지나간다.
//   ③ DOM 캐싱은 **잎 id로만** 한다. 분할(split-N) id는 `normalize`가 걷어내며 사라진다
//      (`LAYOUT-S2-1.md` §7-4). 분할 껍데기는 렌더마다 새로 짠다 — 잎 패널 요소는
//      트리 위치로 **옮겨질 뿐** 파괴되지 않으므로 버퍼·컨텍스트가 산다.

import { invoke } from "@tauri-apps/api/core";

import { createTerminal, verdictOf, type TerminalHandle } from "./terminal";
import { PtyLink } from "./pty";
import { logError, logInfo } from "./log";

export type SplitDirection = "row" | "column";

export type LeafNode = {
  type: "leaf";
  id: string;
  kind: string;
  pty_id?: string | null;
  title?: string | null;
  cwd?: string | null;
};

export type SplitNode = {
  type: "split";
  id: string;
  direction: SplitDirection;
  children: { weight: number; node: LayoutNode }[];
};

export type LayoutNode = LeafNode | SplitNode;

export interface LayoutStateDto {
  version: number;
  root: LayoutNode;
  focus?: string | null;
}

/** 화면에 살아 있는 패널 하나. `handle`은 요소가 DOM에 붙어 크기를 가진 뒤에 생긴다. */
export interface Panel {
  leafId: string;
  el: HTMLElement;
  body: HTMLElement;
  bar: HTMLElement;
  title: HTMLElement;
  rend: HTMLElement;
  handle: TerminalHandle | null;
  link: PtyLink | null;
}

export interface PanelManagerOptions {
  /** 폰트 스택 강제(`--font-stack`). 모든 패널이 같은 값을 받는다 — §2-3. */
  fontStack: string | null;
  /** 셸을 붙일 것인가. 계측 모드가 아니면 참이다. */
  usePty: boolean;
  /** 첫 터미널이 생긴 직후, PTY가 붙기 전 — 셀 폭 계측·데모 출력·상태줄 자리. */
  onFirstTerminal?: (handle: TerminalHandle) => Promise<void> | void;
  /** 포커스 패널이 바뀌었을 때 — 상태줄 갱신 자리. */
  onFocus?: (panel: Panel) => void;
}

/** 프런트 쪽 패널 상한. 백엔드 `--panes` 상한(`probe.rs` MAX_PANES)과 같은 수다. */
const MAX_PANELS = 16;

/**
 * 드래그 최소 패널 크기(px) — 프런트 가드 (`S2-3` 제약 ③).
 *
 * 패널 막대(제목+버튼 3개)가 뭉개지지 않는 하한이다. 이건 UX 가드고,
 * **불변식은 백엔드가 든다** — `layout.rs::set_weights`가 0·음수·비유한 비율을 거부한다.
 */
const MIN_PANEL_PX = 100;

/** `S2-4`(해원)가 쓰는 화면 기하 — viewport 좌표다 (`getBoundingClientRect` 기준). */
export interface PanelRect {
  leafId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export class PanelManager {
  private readonly container: HTMLElement;
  private readonly opts: PanelManagerOptions;
  private readonly panels = new Map<string, Panel>();
  private readonly ro: ResizeObserver;
  private state: LayoutStateDto | null = null;
  private firstDone = false;
  /** 조작 직렬화. 분할 버튼 연타가 refresh 중간에 끼어들면 트리와 화면이 갈린다. */
  private mutating: Promise<unknown> = Promise.resolve();
  /** 드래그 중인가. 참이면 fit(→`pty_resize`)을 멈춘다 — `S2-3` 제약 ①. */
  private dragging = false;
  /** 구조·기하 변경 구독자 (`S2-4` 경계 API). */
  private readonly layoutListeners = new Set<() => void>();

  constructor(container: HTMLElement, opts: PanelManagerOptions) {
    this.container = container;
    this.opts = opts;
    this.ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.leaf;
        const p = id ? this.panels.get(id) : undefined;
        if (p) this.fitPanel(p);
      }
    });
  }

  async boot(): Promise<void> {
    this.state = await invoke<LayoutStateDto>("layout_get");
    await this.reconcile();
    // 새로고침이면 이전 페이지의 PTY가 죽지 않고 남는다 — 여기서 반드시 정리한다.
    window.addEventListener("beforeunload", () => {
      for (const p of this.panels.values()) void p.link?.dispose();
    });
  }

  get size(): number {
    return this.panels.size;
  }

  /** 트리 순서(왼쪽부터)의 잎 id들. */
  leafIds(): string[] {
    return this.state ? leavesOf(this.state.root).map((l) => l.id) : [];
  }

  focused(): Panel | null {
    const f = this.state?.focus;
    return (f && this.panels.get(f)) || this.panels.values().next().value || null;
  }

  // ── `S2-4` 경계 API (#18 규칙 3) ──────────────────────────────────────────
  //
  // 포커스 이동·줌(해원)은 **새 파일에서 아래 넷만** 쓴다 — `panels.ts` 내부(DOM 구조·
  // Panel 필드)에 기대지 않는다. 모자라면 여기에 여는 것이지 내부를 잡는 게 아니다.
  //   leafIds()          — 트리 순서(왼쪽부터)의 잎 id
  //   activeLeaf()       — 포커스 잎 id
  //   panelRect(s)()     — 화면 기하 (방향 탐색은 이 좌표로 계산한다)
  //   focus(id)          — 포커스 이동 (백엔드 확정 포함)
  //   onLayoutChanged(f) — 분할·닫기·드래그 확정 뒤 알림. 해지 함수를 돌려준다

  /** 포커스된 잎 id. 패널이 아직 없으면 `null`. */
  activeLeaf(): string | null {
    return this.state?.focus ?? null;
  }

  /** 잎 하나의 화면 기하. 없는 id면 `null`. */
  panelRect(leafId: string): PanelRect | null {
    const p = this.panels.get(leafId);
    if (!p) return null;
    const r = p.el.getBoundingClientRect();
    return { leafId, left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /** 모든 잎의 화면 기하 — 트리 순서. */
  panelRects(): PanelRect[] {
    const out: PanelRect[] = [];
    for (const id of this.leafIds()) {
      const r = this.panelRect(id);
      if (r) out.push(r);
    }
    return out;
  }

  /** 구조·기하가 바뀔 때(분할·닫기·드래그 확정) 불린다. 반환값이 구독 해지다. */
  onLayoutChanged(cb: () => void): () => void {
    this.layoutListeners.add(cb);
    return () => this.layoutListeners.delete(cb);
  }

  private notifyLayoutChanged(): void {
    for (const cb of this.layoutListeners) {
      try {
        cb();
      } catch (e) {
        // 구독자 예외가 레이아웃 갱신을 막으면 안 된다 — 남기고 계속 간다.
        logError("레이아웃 변경 구독자 예외", e);
      }
    }
  }

  /** 무인 검증용 — 패널별 렌더 판정. */
  rendererReport(): { leaf: string; verdict: string; alive: boolean }[] {
    return [...this.panels.values()].map((p) => ({
      leaf: p.leafId,
      verdict: p.handle ? verdictOf(p.handle.status).text : "터미널 없음",
      alive: !!p.handle && p.handle.status.canvasPresent && !p.handle.status.contextLost,
    }));
  }

  /** 잎 하나를 나눈다. 비율은 균등으로 고정한다 — 드래그는 `S2-3`이다. */
  split(leafId: string, direction: SplitDirection): Promise<void> {
    return this.serialize(async () => {
      if (this.panels.size >= MAX_PANELS) {
        logInfo(`패널 상한 ${MAX_PANELS} — 더 나누지 않는다`);
        return;
      }
      const newId = await invoke<string>("layout_split", { targetLeaf: leafId, direction });
      await this.refreshState();

      // 균등 고정(S2-2 범위). 같은 방향 분할에 형제로 끼면 backend는 낀 칸만 반으로
      // 나눠 [¼,¼,½]이 된다 — 그 분할 하나만 등분으로 되돌린다.
      const parent = parentSplitOf(this.state!.root, newId);
      if (parent && parent.children.some((c) => c.weight !== parent.children[0].weight)) {
        await invoke("layout_set_weights", {
          splitId: parent.id,
          weights: parent.children.map(() => 1),
        }).catch((e) => logError("비율 등분 실패(무시)", e));
        await this.refreshState();
      }
      await this.reconcile();
    });
  }

  /**
   * 잎을 닫는다. 백엔드가 죽인 PTY id들을 돌려준다.
   *
   * 마지막 잎은 백엔드가 거부한다(`layout.rs`) — 거부는 화면·stderr에 남기고 삼킨다.
   */
  close(leafId: string): Promise<string[]> {
    return this.serialize(async () => {
      let killed: string[];
      try {
        killed = await invoke<string[]>("layout_close", { leafId });
      } catch (e) {
        logInfo(`닫기 거부 — ${e}`);
        return [];
      }
      if (killed.length) logInfo(`패널 ${leafId} 닫힘 — PTY 정리: ${killed.join(", ")}`);
      await this.refreshState();
      await this.reconcile();
      return killed;
    });
  }

  async focus(leafId: string): Promise<void> {
    if (!this.panels.has(leafId)) return;
    if (this.state?.focus !== leafId) {
      try {
        await invoke("layout_focus", { leafId });
      } catch (e) {
        logError("포커스 실패", e);
        return;
      }
      if (this.state) this.state.focus = leafId;
    }
    this.applyFocus();
  }

  // ── 내부 ──────────────────────────────────────────────────────────────────

  private serialize<T>(f: () => Promise<T>): Promise<T> {
    const run = this.mutating.then(f, f);
    this.mutating = run.catch(() => undefined);
    return run;
  }

  private async refreshState(): Promise<void> {
    this.state = await invoke<LayoutStateDto>("layout_get");
  }

  /** 트리와 화면을 맞춘다. 순서가 곧 §2-1이다 — 사라진 것부터 정리한다. */
  private async reconcile(): Promise<void> {
    const st = this.state!;
    const leaves = leavesOf(st.root);
    const alive = new Set(leaves.map((l) => l.id));

    // ① 트리에서 사라진 잎 → 화면에서도 없앤다. 새 컨텍스트를 만들기 전에 먼저 놓는다.
    for (const [id, panel] of [...this.panels]) {
      if (!alive.has(id)) {
        this.panels.delete(id);
        await this.disposePanel(panel);
      }
    }

    // ② 새 잎 → 빈 껍데기부터. 터미널은 요소가 DOM에 붙어 크기를 가진 뒤에 연다.
    const created: Panel[] = [];
    for (const leaf of leaves) {
      if (!this.panels.has(leaf.id)) {
        const panel = this.createShell(leaf);
        this.panels.set(leaf.id, panel);
        created.push(panel);
      }
    }

    // ③ 트리 모양대로 편다. 살아 있는 패널 요소는 새 위치로 옮겨질 뿐이다.
    this.render();

    // ④ 크기가 확정됐다 — 이제 터미널을 연다.
    for (const panel of created) {
      const handle = createTerminal(panel.body, this.opts.fontStack, () => {
        // 유실은 나중에 온다 — 그 순간 표시등이 뒤집혀야 조용한 폴백이 안 생긴다.
        this.paintVerdict(panel);
        logError(`패널 ${panel.leafId} WebGL 컨텍스트 유실 — DOM 폴백`);
      });
      panel.handle = handle;
      this.paintVerdict(panel);
      if (!this.firstDone) {
        this.firstDone = true;
        await this.opts.onFirstTerminal?.(handle);
      }
    }

    // ⑤ 구조가 바뀌면 살아남은 패널 크기도 바뀐다 — 전부 다시 맞춘다.
    //    같은 크기면 xterm이 onResize를 안 내므로 pty_resize 폭주는 없다.
    for (const p of this.panels.values()) this.fitPanel(p);

    // ⑥ 셸은 맨 끝이다. 크기가 맞은 뒤 붙어야 첫 프롬프트부터 제 폭으로 그려진다.
    if (this.opts.usePty) {
      for (const p of created) await this.attachPty(p);
    }

    this.applyFocus();
    this.notifyLayoutChanged();
  }

  private render(): void {
    this.container.textContent = "";
    const rootEl = this.renderNode(this.state!.root);
    rootEl.style.flex = "1 1 0";
    this.container.appendChild(rootEl);
  }

  private renderNode(node: LayoutNode): HTMLElement {
    if (node.type === "leaf") {
      return this.panels.get(node.id)!.el;
    }
    const box = document.createElement("div");
    box.className = `split ${node.direction}`;
    node.children.forEach((child, i) => {
      // 분할선은 매 렌더 새로 만든다 — split id는 normalize가 걷어내며 사라지는 값이라
      // 오래 붙잡지 않는다(§머리말 ③). 드래그 핸들러가 잡는 id도 이 렌더의 것이다.
      if (i > 0) box.appendChild(this.makeDivider(node.id, node.direction));
      const el = this.renderNode(child.node);
      el.style.flexGrow = String(child.weight);
      el.style.flexBasis = "0";
      box.appendChild(el);
    });
    return box;
  }

  // ── 드래그 리사이즈 (`S2-3`) ──────────────────────────────────────────────
  //
  // 드래그 중에는 **프런트가 선행한다** — 이웃 두 칸의 flex-grow만 만진다(CSS가 화면을
  // 따라온다). 터미널 격자·PTY는 건드리지 않다가, 놓는 순간 한 번에 확정한다:
  // fit(→크기가 실제로 바뀐 패널만 `pty_resize`) + `layout_set_weights`.
  // ConPTY reflow는 싸지 않다 — 매 프레임 보내면 그게 A-3에 얹힌다 (브리프 제약 ①).

  private makeDivider(splitId: string, direction: SplitDirection): HTMLElement {
    const d = document.createElement("div");
    d.className = "split-divider";
    d.addEventListener("pointerdown", (e) => this.beginDrag(e, d, splitId, direction));
    return d;
  }

  private beginDrag(
    e: PointerEvent,
    divider: HTMLElement,
    splitId: string,
    direction: SplitDirection,
  ): void {
    const prev = divider.previousElementSibling as HTMLElement | null;
    const next = divider.nextElementSibling as HTMLElement | null;
    if (!prev || !next) return;

    const horizontal = direction === "row";
    const prevSize = horizontal ? prev.offsetWidth : prev.offsetHeight;
    const nextSize = horizontal ? next.offsetWidth : next.offsetHeight;
    const pairSize = prevSize + nextSize;
    // 창이 최소 크기 둘을 못 담으면 드래그 자체가 무의미하다 — 시작하지 않는다.
    if (pairSize < MIN_PANEL_PX * 2) return;

    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    this.dragging = true;
    divider.classList.add("active");

    const startPos = horizontal ? e.clientX : e.clientY;
    const pairGrow = growOf(prev) + growOf(next);

    const onMove = (ev: PointerEvent): void => {
      const delta = (horizontal ? ev.clientX : ev.clientY) - startPos;
      // 최소 크기 가드(프런트 · 제약 ③). 불변식 쪽은 layout.rs::set_weights가 든다 —
      // 여기 클램프 덕에 0이나 음수 비율은 애초에 만들어지지 않는다.
      const newPrev = clamp(prevSize + delta, MIN_PANEL_PX, pairSize - MIN_PANEL_PX);
      prev.style.flexGrow = String((pairGrow * newPrev) / pairSize);
      next.style.flexGrow = String((pairGrow * (pairSize - newPrev)) / pairSize);
    };
    const onEnd = (): void => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onEnd);
      divider.removeEventListener("pointercancel", onEnd);
      divider.classList.remove("active");
      this.dragging = false;
      void this.commitWeights(splitId, divider.parentElement);
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onEnd);
    divider.addEventListener("pointercancel", onEnd);
  }

  /** 드래그가 끝났다 — 격자·PTY·트리를 **여기서 한 번만** 맞춘다. */
  private async commitWeights(splitId: string, splitEl: HTMLElement | null): Promise<void> {
    for (const p of this.panels.values()) this.fitPanel(p);
    if (!splitEl) return;
    const weights = [...splitEl.children]
      .filter((c) => !c.classList.contains("split-divider"))
      .map((c) => growOf(c as HTMLElement));
    try {
      await invoke("layout_set_weights", { splitId, weights });
      await this.refreshState();
    } catch (e) {
      // 확정 실패 — 화면과 트리가 갈린 채로 두지 않는다. 트리 값으로 화면을 되돌린다.
      logError("비율 확정 실패 — 트리 값으로 되돌린다", e);
      await this.refreshState();
      await this.reconcile();
    }
    this.notifyLayoutChanged();
  }

  private createShell(leaf: LeafNode): Panel {
    const el = document.createElement("section");
    el.className = "panel";
    el.dataset.leaf = leaf.id;

    const bar = document.createElement("div");
    bar.className = "panel-bar";

    const rend = document.createElement("span");
    rend.className = "panel-rend";
    rend.textContent = "●";

    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = leaf.title ?? leaf.id;

    bar.append(
      rend,
      title,
      this.button("◫", "좌우 분할", () => void this.split(leaf.id, "row")),
      this.button("⬓", "상하 분할", () => void this.split(leaf.id, "column")),
      this.button("×", "닫기", () => void this.close(leaf.id)),
    );

    const body = document.createElement("div");
    body.className = "panel-body";
    body.dataset.leaf = leaf.id;

    el.append(bar, body);
    // mousedown — 클릭이 터미널 안이든 막대든, 포커스가 먼저 온다.
    el.addEventListener("mousedown", () => void this.focus(leaf.id));
    this.ro.observe(body);

    // 이전 페이지(새로고침)가 남긴 참조다. 그 프로세스는 beforeunload에서 죽었어야 하지만,
    // 크래시였다면 살아 있다 — 어느 쪽이든 여기서 확실히 끊는다. 새 셸은 ⑥에서 붙는다.
    if (this.opts.usePty && leaf.pty_id) {
      const stale = leaf.pty_id;
      void invoke("pty_kill", { id: stale }).catch(() => undefined);
      void invoke("layout_attach_pty", { leafId: leaf.id, ptyId: null }).catch(() => undefined);
    }

    return { leafId: leaf.id, el, body, bar, title, rend, handle: null, link: null };
  }

  private button(label: string, tip: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "panel-btn";
    b.textContent = label;
    b.title = tip;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private paintVerdict(panel: Panel): void {
    if (!panel.handle) return;
    const v = verdictOf(panel.handle.status);
    panel.rend.title = v.text;
    panel.rend.classList.remove("ok", "warn", "bad");
    panel.rend.classList.add(v.sgr === "32" ? "ok" : v.sgr === "33" ? "warn" : "bad");
  }

  private async attachPty(panel: Panel): Promise<void> {
    if (!panel.handle) return;
    const link = new PtyLink(panel.handle.term, panel.handle.fit);
    try {
      const info = await link.start();
      panel.link = link;
      await invoke("layout_attach_pty", { leafId: panel.leafId, ptyId: info.id });
      panel.title.textContent = `${baseName(info.shell)} · ${panel.leafId}`;
    } catch (e) {
      // 실패해도 패널은 살려 둔다 — 검은 칸만 남기면 사용자는 원인을 모른다.
      logError(`셸 실행 실패 — 패널 ${panel.leafId}`, e);
      panel.title.textContent = `셸 실패 · ${panel.leafId}`;
      panel.handle.term.write(`\r\n\x1b[31m[셸 실행 실패 — ${e}]\x1b[0m\r\n`);
    }
  }

  private async disposePanel(panel: Panel): Promise<void> {
    this.ro.unobserve(panel.body);
    try {
      // PTY는 이미 백엔드가 죽였다 — 여기서는 이벤트 구독 해제가 목적이다.
      // (kill을 한 번 더 시도하지만 죽은 id는 조용히 무시된다)
      await panel.link?.dispose();
    } catch {
      /* 이미 죽은 PTY */
    }
    panel.link = null;
    panel.handle?.dispose();
    panel.handle = null;
    panel.el.remove();
  }

  private fitPanel(panel: Panel): void {
    // 드래그 중에는 격자를 다시 재지 않는다 — fit이 돌면 xterm onResize → pty_resize가
    // 매 프레임 나간다(제약 ①). 화면 상자는 CSS가 따라가고, 격자는 놓는 순간 맞춘다.
    if (this.dragging) return;
    try {
      panel.handle?.fit.fit();
    } catch {
      /* 최소화되면 크기가 0이 된다 — 무시한다 */
    }
  }

  private applyFocus(): void {
    const focus = this.state?.focus ?? null;
    for (const [id, p] of this.panels) {
      p.el.classList.toggle("focused", id === focus);
    }
    const fp = focus ? this.panels.get(focus) : undefined;
    if (fp) {
      fp.handle?.term.focus();
      this.opts.onFocus?.(fp);
    }
  }
}

// ── 기동 분할 (`--panes=N`) ────────────────────────────────────────────────────

/**
 * 패널이 `target`개가 될 때까지 나눈다 — **제일 넓은 패널을 긴 축으로** (`probe.rs` 머리말).
 * 4개면 2×2가 나오고, 개수가 달라져도 한쪽으로 길쭉해지지 않는다.
 */
export async function ensurePanes(manager: PanelManager, target: number): Promise<void> {
  let guard = 0;
  while (manager.size < target && guard++ < MAX_PANELS) {
    let widestId: string | null = null;
    let widestDir: SplitDirection = "row";
    let area = -1;
    for (const id of manager.leafIds()) {
      const body = document.querySelector<HTMLElement>(`.panel-body[data-leaf="${id}"]`);
      if (!body) continue;
      const a = body.clientWidth * body.clientHeight;
      if (a > area) {
        area = a;
        widestId = id;
        widestDir = body.clientWidth >= body.clientHeight ? "row" : "column";
      }
    }
    if (!widestId) break;
    await manager.split(widestId, widestDir);
  }
}

// ── 계측 전용 정적 그리드 (`--latency-probe --panes=N`) ───────────────────────
//
// 측정 모드는 라이브 `state.json`을 만들지도 않는다(BRIEF §2-4) —
// 그래서 백엔드 layout_* 명령을 **아예 부르지 않고** 화면만 N개로 나눈다.
// PTY도 없다: A-3은 렌더 경로만 잰다 (`docs/issue.md` #10).

/** 계측 그리드의 패널 하나. 첫 번째(index 0)에 계측기가 붙는다. */
export function renderStaticGrid(
  container: HTMLElement,
  n: number,
  fontStack: string | null,
): TerminalHandle[] {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const grid = document.createElement("div");
  grid.className = "split column";
  grid.style.flex = "1 1 0";
  container.appendChild(grid);

  // 격자를 **다 짠 뒤에** 터미널을 연다. 만들면서 열면 첫 셀이 아직 전체 높이일 때
  // 크기를 재서, 다음 행이 붙는 순간 격자가 틀어진 채 계측이 돈다.
  //
  // 분할선은 실제 앱과 같은 요소를 **드래그 없이** 둔다(`S2-3`) — 계측 화면의 기하가
  // 실사용 4분할과 같아야 A-3·A2 숫자를 같은 조건이라 말할 수 있다.
  const bodies: HTMLElement[] = [];
  for (let r = 0; r < rows; r++) {
    if (r > 0) grid.appendChild(staticDivider());
    const rowEl = document.createElement("div");
    rowEl.className = "split row";
    rowEl.style.flexGrow = "1";
    rowEl.style.flexBasis = "0";
    grid.appendChild(rowEl);
    for (let c = 0; c < cols && bodies.length < n; c++) {
      if (c > 0) rowEl.appendChild(staticDivider());
      const cell = document.createElement("section");
      cell.className = "panel";
      cell.style.flexGrow = "1";
      cell.style.flexBasis = "0";
      const body = document.createElement("div");
      body.className = "panel-body";
      cell.appendChild(body);
      rowEl.appendChild(cell);
      bodies.push(body);
    }
  }
  return bodies.map((body) => createTerminal(body, fontStack));
}

function staticDivider(): HTMLElement {
  const d = document.createElement("div");
  d.className = "split-divider static";
  return d;
}

// ── 트리 헬퍼 ────────────────────────────────────────────────────────────────

export function leavesOf(node: LayoutNode): LeafNode[] {
  if (node.type === "leaf") return [node];
  return node.children.flatMap((c) => leavesOf(c.node));
}

function growOf(el: HTMLElement): number {
  const g = parseFloat(el.style.flexGrow || "");
  return Number.isFinite(g) && g > 0 ? g : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function parentSplitOf(node: LayoutNode, leafId: string): SplitNode | null {
  if (node.type === "leaf") return null;
  for (const c of node.children) {
    if (c.node.type === "leaf" && c.node.id === leafId) return node;
    const found = parentSplitOf(c.node, leafId);
    if (found) return found;
  }
  return null;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}
