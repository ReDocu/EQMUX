// D1·D2·D3·D4 — 관제 화면. 터미널 세션을 카드로 본다. (이안)
//
// ⚠️ 2026-08-06 팀장님 지시로 **design.pen `Q2sqrD`를 그대로 옮긴다.** 이전 판은
// "제품에 없는 개념은 안 그린다"(PLAN §4)로 팀 통계·슬라이더·헤더 액션·하단 패널을
// 뺐는데, 그 판단을 시안 위에 두지 않는다. 화면 구조·색·타이포는 pen 그대로 가고,
// **값만 정직하게** 채운다: 실데이터가 있으면 실데이터, 없으면 "—"·"연동 대기" —
// 숫자를 지어내지는 않는다(커밋 내역·포트 목록이 그 자리다. P트랙이 붙으면 채워진다).
//
// 옮기는 pen 구획: `Dashboard Header`(제목 + 액션 5) · `Session Statistics`(통계 5칸) ·
// `Team Slider Navigation` · `Current Team Operations`(TEAM 배지 + 그리드) ·
// 카드 `m1GupV` · 추가 카드 `U0CYyW` · `Operations Quick Panels`(git · 임무 · 포트).
//
// pen의 절대 치수는 참고값이다(`styles.css` 피커 절의 규칙) — 위계·비율·색만 가져오고
// 글자는 읽히는 크기로 올린다. 색은 토큰만 쓴다(리터럴 금지 — 새 pen색은 토큰으로 등록).
//
// # 경계 (`CLAUDE.md` §소유 경계)
//
// `panels.ts`는 세아 소유다 — **안 건드린다.** 여기서 쓰는 것은 공개 API뿐이다:
//   leafIds · activeLeaf · focus · size · ptyReport · onLayoutChanged
// 상태(활성/진행/대기/주의)는 **페인 헤더가 이미 재고 있다.** 그 값을 읽어 온다 —
// 같은 사실을 두 곳에서 세면 값도 갈린다(`statusbar.ts` 머리말).
//
// # A-3 규율 (`statusbar.ts`·`pane-header.ts`와 같은 규칙)
//
// 이 화면은 **보일 때만 갱신한다.** 터미널 화면을 보고 있는 동안 관제는 DOM을 만지지 않는다.

import { icon, type IconName } from "./icons";
import { logError } from "./log";
import type { PaneStatus } from "./pane-header";
import type { PtyReport } from "./panels";

/** `panels.ts` 공개 API 중 이 파일이 쓰는 부분 — 구조적 타입이라 PanelManager를 import하지 않는다. */
export interface DashHost {
  readonly size: number;
  leafIds(): string[];
  activeLeaf(): string | null;
  focus(leafId: string): Promise<void>;
  ptyReport(): PtyReport[];
  onLayoutChanged(cb: () => void): () => void;
}

/** 카드 상태의 출처 — `installPaneHeaders()` 핸들. 없으면 활성/대기만 그린다(지어내지 않는다). */
export interface DashStatusSource {
  statusOf(leafId: string): PaneStatus;
}

export interface DashOptions {
  host: DashHost;
  status: DashStatusSource | null;
  /** 기동 시 확인된 셸 (`app_info.shell`) — 헤더의 셸 버튼. 없으면 안 그린다. */
  shell?: string;
  /** 앱이 잡은 작업 폴더 — 팀 프레임·슬라이더·git/임무 패널의 이름. */
  workspaceRoot?: string;
  /** 새 세션 — 셸 버튼과 `U0CYyW` 추가 카드가 누른다. */
  onAddSession?: () => void;
  /** 배치 피커 열기 — 팀 프레임의 격자 버튼. */
  onOpenPicker?: () => void;
  /** 전체 종료 — 창을 닫는다. */
  onCloseAll?: () => void;
  /** 카드를 눌러 그 터미널로 갈 때(D4). 화면 전환은 이 파일 밖의 일이다. */
  onGoToTerminal?: (leafId: string) => void;
}

export interface Dash {
  setVisible(on: boolean): void;
  visible(): boolean;
  refresh(): void;
  dispose(): void;
}

/** 표시 갱신 주기(ms) — `statusbar.ts`·`pane-header.ts`와 같은 값. */
const REFRESH_MS = 500;

/** 그리드 열 수 — pen `Team Session Grid`가 4열이다. */
const COLUMNS = 4;

/**
 * 통계 다섯 칸 — pen `Session Statistics` 그대로 (색·아이콘 포함).
 * `팀`은 워크스페이스 수다(지금은 1). `진행`은 running(파랑 — 상태색과 일치),
 * `대기`는 pen이 amber다.
 */
const STATS: { key: string; label: string; icon: IconName; tone: string }[] = [
  { key: "team", label: "팀", icon: "users", tone: "blue" },
  { key: "total", label: "전체 세션", icon: "square-terminal", tone: "plain" },
  { key: "active", label: "활성", icon: "activity", tone: "green" },
  { key: "running", label: "진행", icon: "loader-circle", tone: "blue" },
  { key: "waiting", label: "대기", icon: "pause", tone: "amber" },
];

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

/** 값이 그대로면 DOM을 안 만진다 — 500ms 주기 갱신이 hot path에 얹히는 걸 막는다. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** 셸 실행 파일 → 사람이 읽는 이름 (pen의 `PowerShell 7` 자리). */
function shellLabel(p: string): string {
  const b = baseName(p).toLowerCase();
  if (b.startsWith("pwsh")) return "PowerShell 7";
  if (b.startsWith("powershell")) return "Windows PowerShell";
  if (b.startsWith("cmd")) return "cmd";
  return baseName(p);
}

/** 경로를 끝에서부터 남긴다 — 끝 폴더가 가장 많은 정보를 담는다(`statusbar.ts` tailPath). */
function tailPath(p: string, max = 30): string {
  if (p.length <= max) return p;
  return `…${p.slice(-(max - 1))}`;
}

/** [아이콘 + 라벨] 버튼. `run`이 없으면 예정 기능 — 모양은 pen 그대로, 툴팁으로 알린다. */
function actButton(cls: string, glyph: IconName, label: string, run?: () => void, tip?: string): HTMLButtonElement {
  const b = el("button", cls);
  b.type = "button";
  b.append(icon(glyph), el("span", "dash-act-label", label));
  if (run) {
    if (tip) b.title = tip;
    b.addEventListener("click", run);
  } else {
    b.title = tip ?? `${label} — 예정 기능입니다`;
    b.setAttribute("aria-disabled", "true");
  }
  return b;
}

// ── 카드 (pen `m1GupV`) ──────────────────────────────────────────────────────

interface Card {
  root: HTMLButtonElement;
  dot: HTMLElement;
  name: HTMLElement;
  mode: HTMLElement;
  cwd: HTMLElement;
}

/**
 * 세션 카드. `button`이다 — 누르면 그 터미널로 간다(D4). 우상단은 pen대로 TERMINAL 배지,
 * 모드 줄은 pen 문구 "단순 터미널 세션"(EQMUX 세션은 전부 이 모드라 참이다).
 * pid는 툴팁에 둔다. 메트릭 줄의 `CLAUDE.md`는 여기 없는 파일이라 **폴더**를 둔다 —
 * 자리·색·배치는 pen 그대로다.
 */
function createCard(leafId: string, onGo: (leafId: string) => void): Card {
  const root = el("button", "dash-card");
  root.type = "button";
  root.dataset.leaf = leafId;

  const head = el("div", "dash-card-head");
  const ident = el("div", "dash-card-ident");
  const dot = el("span", "dash-card-dot");
  const name = el("span", "dash-card-name");
  ident.append(dot, name);
  const badge = el("span", "dash-card-badge");
  badge.append(icon("square-terminal"), el("span", "dash-card-badge-label", "TERMINAL"));
  head.append(ident, badge);

  const modeRow = el("div", "dash-card-mode");
  const mode = el("span", "dash-card-shell");
  modeRow.append(icon("terminal"), mode);

  const metric = el("div", "dash-card-metric");
  const metricKey = el("span", "dash-card-metric-key");
  metricKey.append(icon("folder"), el("span", "dash-card-metric-label", "폴더"));
  const cwd = el("span", "dash-card-cwd");
  metric.append(metricKey, cwd);

  root.append(head, modeRow, metric);
  root.addEventListener("click", () => onGo(leafId));

  return { root, dot, name, mode, cwd };
}

/** 추가 카드 (`U0CYyW`). */
function createAddCard(onAdd: () => void): HTMLButtonElement {
  const b = el("button", "dash-card dash-add");
  b.type = "button";
  const ic = el("span", "dash-add-icon");
  ic.append(icon("plus"));
  b.append(ic, el("span", "dash-add-label", "세션 추가"));
  b.addEventListener("click", onAdd);
  return b;
}

// ── 하단 퀵 패널 (pen `Operations Quick Panels`) ─────────────────────────────
//
// git(넓게) + 임무/포트(좁게). 프레임·헤더·색은 pen 그대로, **내용은 정직하게**:
// git 내역·포트 목록은 백엔드가 아직 없다(P4·P1 세아) — 지어내지 않고 대기 문구를 둔다.

function buildGitPanel(wsName: string): HTMLElement {
  const panel = el("section", "dash-panel dash-git");

  const head = el("div", "dash-panel-head");
  const title = el("div", "dash-git-title");
  title.append(icon("git-branch"), el("span", "dash-git-name", `${wsName} / —`));
  const acts = el("div", "dash-git-acts");
  const GIT_ACTS: [IconName, string][] = [
    ["arrow-down", "pull"],
    ["arrow-up", "push"],
    ["git-commit-horizontal", "commit"],
    ["diff", "diff"],
  ];
  for (const [glyph, label] of GIT_ACTS) {
    const b = el("button", "dash-git-act");
    b.type = "button";
    b.append(icon(glyph), el("span", undefined, label));
    b.title = `git ${label} — P4 git 패널에서 연결됩니다`;
    b.setAttribute("aria-disabled", "true");
    acts.appendChild(b);
  }
  head.append(title, acts);

  const summary = el("div", "dash-git-summary");
  summary.append(
    el("span", "dash-git-branch", "—"),
    el("span", "dash-git-sync", "↑– ↓–"),
    el("span", "dash-git-changes", "– changes"),
    el("span", "dash-git-remote", "git 연동 대기"),
  );

  const body = el("div", "dash-panel-empty", "커밋 내역 — P4 git 패널이 붙으면 여기 채워집니다");

  panel.append(head, summary, body);
  return panel;
}

function buildMissionPanel(wsName: string): HTMLElement {
  const panel = el("section", "dash-panel dash-missions");

  const head = el("div", "dash-panel-head");
  head.append(el("span", "dash-panel-title", "임무 / 프로젝트"), el("span", "dash-mission-count", "1 ACTIVE"));

  const row = el("div", "dash-mission-row");
  const ident = el("div", "dash-mission-ident");
  ident.append(icon("folder-git-2"), el("span", "dash-mission-name", wsName));
  row.append(ident, el("span", "dash-mission-state", "담당"));

  panel.append(head, row);
  return panel;
}

function buildPortPanel(): HTMLElement {
  const panel = el("section", "dash-panel dash-ports");

  const head = el("div", "dash-panel-head");
  head.append(el("span", "dash-panel-title", "세션 포트"), el("span", "dash-port-refresh", "— refresh"));

  const body = el("div", "dash-port-list");
  body.append(el("span", "dash-panel-empty", "포트 감지 — P1 포트 패널이 붙으면 여기 채워집니다"));

  panel.append(head, body);
  return panel;
}

// ── 설치 ─────────────────────────────────────────────────────────────────────

/** 관제 화면을 `mount` 안에 짓는다. 계측 모드에서는 부르지 않는다(A-3). */
export function installDash(mount: HTMLElement, opts: DashOptions): Dash {
  const { host } = opts;
  const wsName = opts.workspaceRoot ? baseName(opts.workspaceRoot) : "워크스페이스";

  // 헤더 — pen `Dashboard Header`: 제목 블록 + 액션 5종 (새 팀 · 페르소나 생성 ·
  // 워크스페이스 · PowerShell 7 · 전체 종료). 동작 없는 셋은 모양 그대로 두고 툴팁으로 알린다.
  const head = el("header", "dash-head");
  const titleBlock = el("div", "dash-title-block");
  titleBlock.append(
    el("h1", "dash-title", "관제 대시보드"),
    el("p", "dash-sub", "팀, 세션, 임무와 개발 흐름을 실시간으로 관리합니다"),
  );
  const actions = el("div", "dash-actions");
  actions.append(actButton("dash-act primary", "plus", "새 팀"));
  actions.append(actButton("dash-act purple", "user-pen", "페르소나 생성"));
  actions.append(actButton("dash-act", "folder", "워크스페이스"));
  if (opts.shell) {
    actions.append(
      actButton("dash-act", "terminal", shellLabel(opts.shell), opts.onAddSession, `새 ${shellLabel(opts.shell)} 세션을 엽니다`),
    );
  }
  if (opts.onCloseAll) {
    actions.append(
      actButton("dash-act danger", "power", "전체 종료", opts.onCloseAll, "창을 닫습니다 — 모든 세션이 종료됩니다"),
    );
  }
  head.append(titleBlock, actions);

  // 통계 줄 — pen `Session Statistics` 다섯 칸.
  const statsRow = el("div", "dash-stats");
  const statValues = new Map<string, HTMLElement>();
  for (const s of STATS) {
    const box = el("div", "dash-stat");
    box.dataset.tone = s.tone;
    const header = el("div", "dash-stat-head");
    header.append(el("span", "dash-stat-label", s.label), icon(s.icon, "dash-stat-icon"));
    const value = el("div", "dash-stat-value", "—");
    box.append(header, value);
    statsRow.appendChild(box);
    statValues.set(s.key, value);
  }

  // 팀 슬라이더 — pen `Team Slider Navigation`. 워크스페이스가 하나라 1 / 1 · 점 하나다.
  // 넘어갈 곳이 없으므로 화살표는 잠근다 — 모양은 pen 그대로 둔다.
  const slider = el("div", "dash-slider");
  const sliderLeft = el("div", "dash-slider-left");
  const prevBtn = el("button", "dash-slider-btn");
  prevBtn.type = "button";
  prevBtn.append(icon("chevron-left"));
  prevBtn.disabled = true;
  prevBtn.title = "이전 팀 — 팀이 하나뿐입니다";
  sliderLeft.append(prevBtn, el("span", "dash-slider-name", wsName), el("span", "dash-slider-index", "1 / 1"));
  const dots = el("div", "dash-slider-dots");
  dots.append(el("span", "dash-slider-dot on"));
  const sliderRight = el("div", "dash-slider-right");
  const nextBtn = el("button", "dash-slider-btn next");
  nextBtn.type = "button";
  nextBtn.append(icon("chevron-right"));
  nextBtn.disabled = true;
  nextBtn.title = "다음 팀 — 팀이 하나뿐입니다";
  sliderRight.append(nextBtn);
  slider.append(sliderLeft, dots, sliderRight);

  // 팀 프레임 — pen `Current Team Operations — Terminal Mode`. 배지 문구까지 pen 그대로.
  const frame = el("section", "dash-frame");
  const frameHead = el("div", "dash-frame-head");

  const identity = el("div", "dash-frame-ident");
  const badge = el("span", "dash-frame-badge");
  badge.append(icon("shield"), el("span", "dash-frame-badge-label", "TEAM / 01"));
  const nameBlock = el("div", "dash-frame-names");
  const frameName = el("div", "dash-frame-name", wsName);
  const frameSub = el("div", "dash-frame-sub");
  if (opts.workspaceRoot) frameSub.title = opts.workspaceRoot;
  nameBlock.append(frameName, frameSub);
  identity.append(badge, nameBlock);

  const frameActs = el("div", "dash-frame-acts");
  const termChip = el("button", "dash-frame-chip");
  termChip.type = "button";
  const termChipLabel = el("span", "dash-frame-chip-label", "터미널 모드");
  termChip.append(icon("square-terminal"), termChipLabel);
  termChip.title = "터미널 화면으로 전환";
  termChip.addEventListener("click", () => goTo(host.activeLeaf() ?? host.leafIds()[0] ?? ""));
  frameActs.append(termChip);
  const FRAME_ACTS: [IconName, string, (() => void) | undefined][] = [
    ["briefcase-business", "임무 — P2 임무 패널에서 연결됩니다", undefined],
    ["folder-open", "폴더 열기 — 예정 기능입니다", undefined],
    ["layout-grid", "페인 배치 (Ctrl+Shift+L)", opts.onOpenPicker],
  ];
  for (const [glyph, tip, run] of FRAME_ACTS) {
    const b = el("button", "dash-frame-act");
    b.type = "button";
    b.append(icon(glyph));
    b.title = tip;
    if (run) b.addEventListener("click", run);
    else b.setAttribute("aria-disabled", "true");
    frameActs.appendChild(b);
  }

  frameHead.append(identity, frameActs);

  const grid = el("div", "dash-grid");
  grid.style.setProperty("--dash-columns", String(COLUMNS));
  frame.append(frameHead, grid);

  // 하단 퀵 패널 — pen `Operations Quick Panels`: git(넓게) + [임무 · 포트](좁게).
  const quick = el("div", "dash-quick");
  const rightCol = el("div", "dash-quick-right");
  rightCol.append(buildMissionPanel(wsName), buildPortPanel());
  quick.append(buildGitPanel(wsName), rightCol);

  mount.textContent = "";
  mount.append(head, statsRow, slider, frame, quick);

  const cards = new Map<string, Card>();
  const addCard = opts.onAddSession ? createAddCard(opts.onAddSession) : null;

  const goTo = (leafId: string): void => {
    if (!leafId) return;
    // 포커스를 먼저 옮긴다 — 화면 전환이 실패해도 "어느 세션을 골랐는가"는 남아야 한다.
    void host.focus(leafId).catch((e) => logError(`관제 — 세션 포커스 실패 ${leafId}`, e));
    opts.onGoToTerminal?.(leafId);
  };

  let shown = false;

  const refresh = (): void => {
    // 숨어 있으면 아무것도 하지 않는다. 이 한 줄이 A-3 규율의 본체다(머리말).
    if (!shown) return;

    const leaves = host.leafIds();
    const active = host.activeLeaf();
    const ptys = new Map(host.ptyReport().map((p) => [p.leaf, p]));
    const alive = new Set(leaves);

    for (const [id, card] of [...cards]) {
      if (!alive.has(id)) {
        card.root.remove();
        cards.delete(id);
      }
    }

    const counts: Record<string, number> = {
      team: opts.workspaceRoot ? 1 : 0,
      total: leaves.length,
      active: 0,
      running: 0,
      waiting: 0,
    };

    for (const leafId of leaves) {
      let card = cards.get(leafId);
      if (!card) {
        card = createCard(leafId, goTo);
        cards.set(leafId, card);
      }
      // 순서가 트리와 같아야 한다 — 카드 위치가 화면의 페인 위치와 어긋나면 카드를 못 믿는다.
      grid.appendChild(card.root);

      const pty = ptys.get(leafId);
      const status: PaneStatus = opts.status
        ? opts.status.statusOf(leafId)
        : leafId === active
          ? "active"
          : "waiting";

      if (status === "active") counts.active++;
      else if (status === "running") counts.running++;
      else if (status === "waiting") counts.waiting++;
      // attention(셸이 끝났다)은 어디에도 안 더한다 — 대기로 세면 끝난 셸이 숨는다.

      setAttr(card.root, "data-pane-status", status);
      setAttr(card.root, "aria-current", leafId === active ? "true" : "false");
      setText(card.name, pty ? `${baseName(pty.shell)} · ${leafId}` : leafId);

      // 모드 줄 — pen 문구. 셸이 죽었으면 그 사실이 문구를 이긴다.
      setText(card.mode, pty ? (pty.alive ? "단순 터미널 세션" : "셸 종료됨") : "셸 없음");

      if (pty) {
        setText(card.cwd, tailPath(pty.cwd));
        setAttr(card.cwd, "title", pty.cwd);
      } else {
        setText(card.cwd, "—");
        setAttr(card.cwd, "title", "이 패널에는 셸이 붙지 않았다");
      }

      setAttr(
        card.root,
        "title",
        `${leafId} — 눌러서 이 터미널로 이동${pty ? `\npid ${pty.pid ?? "?"}\n${pty.shell}\n${pty.cwd}` : ""}`,
      );
    }

    if (addCard) grid.appendChild(addCard);

    for (const s of STATS) setText(statValues.get(s.key)!, String(counts[s.key] ?? 0));
    setText(termChipLabel, `터미널 모드 · ${leaves.length}`);
    setText(
      frameSub,
      opts.workspaceRoot
        ? `${tailPath(opts.workspaceRoot, 44)} · ${leaves.length} terminal sessions`
        : `${leaves.length} terminal sessions`,
    );
  };

  const offLayout = host.onLayoutChanged(refresh);
  const timer = window.setInterval(refresh, REFRESH_MS);

  return {
    setVisible: (on) => {
      if (shown === on) return;
      shown = on;
      mount.hidden = !on;
      if (on) refresh();
    },
    visible: () => shown,
    refresh,
    dispose: () => {
      window.clearInterval(timer);
      offLayout();
      cards.clear();
      mount.textContent = "";
    },
  };
}

// ── 세아에게 요청한 것 (`#18` 규칙 3 — 경계를 고치지 않고 멈춰서 요청한다) ────────────
//
//   1. 세션 생성 API `addSession()` — 지금은 밖에서 제일 넓은 잎을 골라 나눈다(ensurePanes).
//   2. 셸 현재 위치(OSC 7) — 카드의 폴더는 셸을 띄운 폴더지 `cd`로 옮긴 위치가 아니다.
//   3. git 요약·포트 목록 — 하단 퀵 패널이 P4·P1에서 이 데이터를 받는다(지금은 대기 문구).
