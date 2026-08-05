// ① 페인 헤더 — design.pen `yfkfh` UI Container / Terminal Pane. (해원)
//
// 경계 (CLAUDE.md §소유 경계 · panels.ts `S2-4` 경계 API 머리말):
//   `panels.ts`는 세아 소유다 — **고치지 않는다.** 헤더 막대(`.panel-bar`)는 그 파일이 만들고,
//   여기서는 그 막대에 **오른쪽 묶음을 덧붙이고 상태를 칠하기만** 한다.
//   `S2-12` 피커가 자기 DOM을 따로 지은 것과 같은 방식이고, 다른 점은 붙이는 자리가
//   남의 요소라는 것뿐이다. 그래서 규칙을 하나 더 건다:
//
//     **남이 만든 요소는 지우지도 옮기지도 않는다.**
//
//   임시 버튼(`＋ ◫ ⬓ ×`)도 지우지 않는다 — `styles.css`에서 감춘다.
//   ⚠️ `⋯` 메뉴(새 탭·분할)는 팀장님 지시로 **제거됐다**(2026-08-06). 헤더 조작은
//   [상태 · 줌 · ×] 셋이 전부다. 분할은 관제의 새 세션·배치 피커가, 탭은 `T10`이 받는다.
//
// 조작은 전부 공개 API로만 한다 — split · close · setZoom/zoomedLeaf · focus ·
// leafIds · activeLeaf · onLayoutChanged. `layout_*` 명령을 직접 부르는 곳은 아래
// `refreshPtyMap` 하나이고 그것도 **읽기(`layout_get`)뿐**이다. 트리를 바꾸는 명령을
// 직접 부르면 화면이 안 따라온다는 게 panels.ts 머리말의 경고고, 읽기는 거기 해당이 없다.
//
// A-3 규율 (`statusbar.ts` 머리말과 같은 규칙):
//   `pty://data`는 출력 한 청크마다 오는 hot path다. 여기 콜백은 **Map에 시각 하나 적는 것**이
//   전부다. DOM은 주기(500ms)에만, 그것도 값이 변했을 때만 만진다.
//
// 상태 4단계 (브리프 ① · 색은 팀장님 결과 시안 2026-08-06):
//   attention = --red · active = --green · running = --blue · waiting = --muted
//   (running이 amber였다가 시안대로 blue가 됐다 — 통계 `진행`의 pen 원색과도 이제 일치한다.
//    비운 amber는 어디에도 재배정하지 않았다. attention은 "셸이 끝났다"라 red가 맞다.)
//   🔴 **강조는 하나일 때만 강조다.** `attention`만 테두리까지 먹고(styles.css),
//   나머지는 점과 라벨 색만 바꾼다.
//
//   어디서 오는 값인가 — 지어내지 않는다:
//     active     포커스된 페인. 항상 하나다.
//     running    포커스가 아닌 페인에서 최근 출력이 흐른다. 포커스 페인을 running으로 안 치는
//                이유: 타이핑 에코도 출력이라 글자를 칠 때마다 ACTIVE↔RUNNING이 깜빡인다.
//                그리고 "저쪽 페인이 뭔가 하고 있다"가 이 상태가 알려 줄 유일한 사실이다.
//     attention  셸이 끝났다(`pty://exit`). 사용자가 그 페인을 보면(포커스) 풀린다.
//     waiting    그 밖.
//   `setPaneStatus`로 밖에서 덮어쓸 수 있다 — 3·4차 개념(임무 상태)이 붙을 자리다.
//   **임무칩은 그리지 않는다** (브리프 ①).

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { icon, setIcon, type IconName } from "./icons";
import { logError } from "./log";

export type PaneStatus = "attention" | "active" | "running" | "waiting";

/** panels.ts 공개 API 중 이 파일이 쓰는 부분 — 구조적 타입이라 PanelManager를 import하지 않는다. */
export interface PaneHeaderHost {
  leafIds(): string[];
  activeLeaf(): string | null;
  focus(leafId: string): Promise<void>;
  setZoom(leafId: string | null): void;
  zoomedLeaf(): string | null;
  close(leafId: string): Promise<string[]>;
  onLayoutChanged(cb: () => void): () => void;
  /** `S2-13` 요청 1 — 잎별 PTY. 세아가 열어 줬다(`panels.ts`). */
  ptyReport(): { leaf: string; id: string; alive: boolean }[];
}

export interface PaneHeaders {
  /** 즉시 한 번 갱신 — 주기를 기다릴 이유가 없을 때. */
  refresh(): void;
  /** 상태를 밖에서 고정한다. `null`이면 자동 판정으로 되돌린다. */
  setPaneStatus(leafId: string, status: PaneStatus | null): void;
  /**
   * 지금 그 페인의 상태 — `D1`·`D3` 관제 카드가 읽는다 (`dash.ts`).
   *
   * **왜 읽기 창구를 여는가**: `running` 판정은 `pty://data`(출력 한 청크마다 오는 hot path)를
   * 듣고 있어야 나온다. 관제가 자기 리스너를 하나 더 걸면 그 비용이 A-3에 그대로 얹히고,
   * 같은 사실을 두 곳에서 세니 값도 갈린다. 여기 있는 값을 넘겨주는 편이 싸고 정확하다.
   */
  statusOf(leafId: string): PaneStatus;
  dispose(): void;
}

/** 표시 갱신 주기(ms). `statusbar.ts`와 같은 값 — 사람이 읽을 수 있는 상한이 그 언저리다. */
const REFRESH_MS = 500;

/** 이 시간 안에 출력이 있었으면 `running`. 짧으면 깜빡이고, 길면 끝난 뒤에도 도는 척한다. */
const RUNNING_IDLE_MS = 1200;

/** 디자인이 쓰는 대문자 토큰 그대로다(`ACTIVE` · 대기는 시안 실물이 `IDLE`이다, 2026-08-06).
    설명은 툴팁에 한국어로 둔다. */
const LABEL: Record<PaneStatus, string> = {
  attention: "ATTENTION",
  active: "ACTIVE",
  running: "RUNNING",
  waiting: "IDLE",
};

const TIP: Record<PaneStatus, string> = {
  attention: "확인이 필요합니다",
  active: "지금 입력이 가는 페인입니다",
  running: "출력이 흐르고 있습니다",
  waiting: "대기 중입니다",
};

// ── 설치 ─────────────────────────────────────────────────────────────────────

/**
 * 페인 헤더를 디자인 모양으로 만든다. **계측 모드(`--latency-probe` 등)에서는 부르지 않는다** —
 * A-3를 재는 조건에 표시 코드를 얹으면 재는 대상이 달라진다 (`statusbar.ts`와 같은 이유).
 */
export function installPaneHeaders(host: PaneHeaderHost): PaneHeaders {
  const clusters = new Map<string, Cluster>();
  /** 마지막 출력 시각 — **키는 PTY id다.** hot path에서 잎을 되찾는 조회를 없앤다. */
  const lastOutput = new Map<string, number>();
  /** 잎 → 그 패널의 PTY들. `S2-5` 이후 **탭마다 셸이라 여럿이다.** */
  const ptysOfLeaf = new Map<string, string[]>();
  const leafOfPty = new Map<string, string>();
  /** 셸이 끝난 페인 → 사유. 사용자가 그 페인을 보면(포커스) 지운다. */
  const attention = new Map<string, string>();
  /** 밖에서 고정한 상태. 자동 판정을 이긴다. */
  const forced = new Map<string, PaneStatus>();

  const unlisten: UnlistenFn[] = [];

  // hot path — Map에 시각 하나. 여기서 DOM을 만지면 그게 곧 A-3에 얹힌다.
  void listen<{ id: string }>("pty://data", (ev) => {
    lastOutput.set(ev.payload.id, performance.now());
  })
    .then((un) => unlisten.push(un))
    .catch((e) => logError("페인 헤더 — 출력 감지 리스너 등록 실패", e));

  void listen<{ id: string; code: number | null }>("pty://exit", (ev) => {
    const leaf = leafOfPty.get(ev.payload.id);
    if (!leaf) return;
    attention.set(leaf, `셸이 끝났습니다 — code=${ev.payload.code ?? "?"}`);
    refresh();
  })
    .then((un) => unlisten.push(un))
    .catch((e) => logError("페인 헤더 — 셸 종료 리스너 등록 실패", e));

  /**
   * 잎 ↔ PTY 지도를 다시 만든다.
   *
   * `ptyReport()`(세아 · `S2-13` 요청 1)를 쓴다 — 예전에는 `layout_get`을 직접 읽어 만들었다.
   * **왕복이 없고 잎이 이미 붙어 있다.** 구조가 바뀔 때만 부른다(분할·닫기·프리셋·탭).
   */
  const refreshPtyMap = (): void => {
    try {
      ptysOfLeaf.clear();
      leafOfPty.clear();
      for (const p of host.ptyReport()) {
        const list = ptysOfLeaf.get(p.leaf);
        if (list) list.push(p.id);
        else ptysOfLeaf.set(p.leaf, [p.id]);
        leafOfPty.set(p.id, p.leaf);
      }
      refresh();
    } catch (e) {
      // 지도가 없으면 running 판정만 못 한다 — 헤더 자체는 계속 그린다.
      logError("페인 헤더 — PTY 지도 갱신 실패", e);
    }
  };

  function statusOf(leafId: string, active: string | null, now: number): PaneStatus {
    const fixed = forced.get(leafId);
    if (fixed) return fixed;
    // 본 것은 더 이상 알릴 일이 아니다 — 포커스가 곧 확인이다.
    if (leafId === active) {
      attention.delete(leafId);
      return "active";
    }
    if (attention.has(leafId)) return "attention";
    // 탭 중 **하나라도** 최근 출력이 있으면 그 페인은 도는 중이다 — 숨은 탭의 셸도 돈다.
    const ptys = ptysOfLeaf.get(leafId);
    if (ptys?.some((p) => now - (lastOutput.get(p) ?? 0) < RUNNING_IDLE_MS)) return "running";
    return "waiting";
  }

  function refresh(): void {
    const leaves = host.leafIds();
    const active = host.activeLeaf();
    const zoomed = host.zoomedLeaf();
    const now = performance.now();
    const alive = new Set(leaves);

    // 사라진 잎의 묶음은 요소째 없어졌다(panels.ts disposePanel) — 지도만 정리한다.
    for (const id of [...clusters.keys()]) {
      if (!alive.has(id)) clusters.delete(id);
    }
    for (const id of [...attention.keys()]) {
      if (!alive.has(id)) attention.delete(id);
    }

    for (const leafId of leaves) {
      const panel = panelElement(leafId);
      if (!panel) continue;
      const cluster = ensureCluster(clusters, panel, leafId, host);
      if (!cluster) continue;

      const status = statusOf(leafId, active, now);
      // 상태는 **패널 요소의 속성**으로 둔다 — 테두리(.panel)와 배경(.panel-bar)과
      // 점·라벨이 모두 이 한 값을 보고 칠해진다. 칠하는 규칙은 styles.css에 있다.
      if (panel.dataset.paneStatus !== status) panel.dataset.paneStatus = status;
      setText(cluster.state, LABEL[status]);
      setAttr(cluster.state, "title", attention.get(leafId) ?? TIP[status]);

      const on = zoomed === leafId;
      // 디자인 글리프: 줌 = maximize-2, 해제 = minimize-2 (yfkfh `Terminal Zoom`).
      setIcon(cluster.zoom, on ? "minimize-2" : "maximize-2");
      cluster.zoom.classList.toggle("on", on);
      setAttr(cluster.zoom, "title", on ? "줌 해제 (Ctrl+Shift+Z)" : "이 페인만 크게 (Ctrl+Shift+Z)");
      setAttr(cluster.zoom, "aria-pressed", on ? "true" : "false");

      // × — 마지막 페인은 백엔드가 안 닫아 준다(layout.rs). 눌러서 아무 일도 안 나는
      // 버튼을 두지 않는다 — 메뉴의 닫기 항목과 같은 규칙으로 잠근다.
      const lastOne = leaves.length < 2;
      if (cluster.close.disabled !== lastOne) cluster.close.disabled = lastOne;
      setAttr(cluster.close, "title", lastOne ? "마지막 페인은 닫을 수 없습니다" : "페인 닫기");
    }
  }

  const offLayout = host.onLayoutChanged(() => {
    refreshPtyMap();
  });

  refreshPtyMap();
  refresh();
  const timer = window.setInterval(refresh, REFRESH_MS);

  return {
    refresh,
    setPaneStatus: (leafId, status) => {
      if (status) forced.set(leafId, status);
      else forced.delete(leafId);
      refresh();
    },
    // 판정을 여기서 다시 하지 않는다 — 위 `statusOf`를 그대로 부른다.
    // 두 번째 구현을 두면 페인 헤더와 관제 카드가 다른 색을 보여주는 날이 온다.
    statusOf: (leafId) => statusOf(leafId, host.activeLeaf(), performance.now()),
    dispose: () => {
      window.clearInterval(timer);
      offLayout();
      for (const un of unlisten) un();
      unlisten.length = 0;
      clusters.clear();
    },
  };
}

// ── 헤더 오른쪽 묶음 ─────────────────────────────────────────────────────────
//
// 팀장님 결과 시안(2026-08-06): 상태 라벨 → 줌 → ×. 이게 전부다 — `⋯` 메뉴는 제거됐다.
// 왼쪽(상태점 · 이름)은 이미 `panels.ts`가 만들어 두었으므로 **다시 만들지 않는다** —
// 모양만 styles.css에서 디자인에 맞춘다.

interface Cluster {
  root: HTMLElement;
  state: HTMLElement;
  zoom: HTMLButtonElement;
  close: HTMLButtonElement;
}

function ensureCluster(
  cache: Map<string, Cluster>,
  panel: HTMLElement,
  leafId: string,
  host: PaneHeaderHost,
): Cluster | null {
  const cached = cache.get(leafId);
  // isConnected 확인: 캐시가 죽은 요소를 들고 있으면 화면은 안 바뀌는데 코드는 도는 상태가 된다.
  if (cached && cached.root.isConnected) return cached;

  const bar = panel.querySelector<HTMLElement>(":scope > .panel-bar");
  if (!bar) return null; // 계측용 정적 격자에는 막대가 없다 — 조용히 건너뛴다.

  const root = document.createElement("div");
  root.className = "pane-right";

  const state = document.createElement("span");
  state.className = "pane-state";

  const zoom = actionButton("maximize-2");
  zoom.classList.add("pane-zoom");
  zoom.addEventListener("click", (e) => {
    e.stopPropagation();
    // 토글 — 다른 페인이 줌 중이었으면 이 페인으로 옮겨 온다.
    host.setZoom(host.zoomedLeaf() === leafId ? null : leafId);
  });

  const close = actionButton("x");
  close.classList.add("pane-close");
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    void host.close(leafId).catch((err) => logError(`페인 닫기 실패 ${leafId}`, err));
  });

  root.append(state, zoom, close);
  bar.appendChild(root);

  const cluster: Cluster = { root, state, zoom, close };
  cache.set(leafId, cluster);
  return cluster;
}

function actionButton(name: IconName): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "pane-act";
  b.type = "button";
  b.dataset.icon = name;
  b.appendChild(icon(name));
  return b;
}

// ── 잔손 ─────────────────────────────────────────────────────────────────────

function panelElement(leafId: string): HTMLElement | null {
  const key = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(leafId) : leafId;
  return document.querySelector<HTMLElement>(`.panel[data-leaf="${key}"]`);
}

/** 값이 그대로면 DOM을 안 만진다 — 500ms마다 도는 갱신이 hot path에 얹히는 걸 막는다. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// ── 세아에게 요청한 것 (`#18` 규칙 3 — 경계를 고치지 않고 멈춰서 요청한다) ────────────
//
//   1. 헤더 DOM을 디자인(`yfkfh`)대로: 왼쪽 [상태점 · 이름], 오른쪽 자리 하나(빈 컨테이너).
//      · 지금은 `panels.ts`가 만든 막대에 이 파일이 오른쪽 묶음을 **덧붙이고**,
//        임시 분할·닫기 버튼(`◫ ⬓ ×`)은 styles.css에서 감추고 있다.
//        오른쪽 자리만 열어 주면 `ensureCluster`의 덧붙이기와 그 감추기 규칙이 같이 사라진다.
//   2. ~~잎별 PTY 정보 — `ptyReport()`~~ ✅ **들어왔다** — `layout_get` 우회를 걷어냈다.
//      · `S2-5`(탭)부터 **한 페인에 셸이 여럿이다.** running 판정은 그중 하나라도 최근 출력이
//        있으면 참으로 본다 — 숨은 탭의 셸도 돌고, 그게 이 상태가 알려 줄 사실이다.
//   3. 터미널 테마를 `S2-8` 토큰에 맞추기 — `terminal.ts` THEME
//      · 본문 배경은 디자인이 `--deep`(#080c11) · 전경이 `--term-fg`(#c1cdd9)인데
//        지금 xterm은 `#0d1220` / `#d7dceb`이다. 캔버스 색은 그 파일이 정본이라
//        여기서는 `.panel-body`(여백)만 맞춰 두었다 — 두 색이 갈리면 이음매가 보인다.
