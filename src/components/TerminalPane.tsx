// 실터미널 페인 — xterm.js 렌더 + PTY 브리지.
// 세션당 Terminal 인스턴스는 정확히 1개를 만들어 REGISTRY에 유지한다 (세션은 페인보다 오래 산다).
// 페인이 리마운트되면(줌·전체 화면·탭 전환) DOM 요소만 재부착한다 — 버퍼를 다시 쓰지 않으므로
// ConPTY 리페인트가 중복 재생되지 않고 스크롤백이 온전히 이어진다.
// 링버퍼 꼭대기(FR-C-13)에서는 디스크 기록 칩이 떠서 스토어 스크롤백을 조각 로드한다 (FR-C-14).
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "@xterm/xterm/css/xterm.css";
import { cleanScrollback, pageScrollback } from "../backend/panels";
import type { ScrollbackHit } from "../backend/panels";
import {
  clipReadText,
  clipSaveImage,
  clipWriteText,
  isTauri,
  killPty,
  onPtyExit,
  onPtyOutput,
  openExternal,
  resizePty,
  scrollbackTail,
  spawnPty,
  writePty,
} from "../backend/pty";
import { resumeAgent, spawnAgent } from "../backend/agent";
import { backend } from "../backend/mock";
import { settings } from "../backend/settings";
import { selectedSession, tick } from "../state";
import { ContextMenu } from "./ui";
import type { MenuGroup } from "./ui";
import type { Permissions } from "../types";

const EQ_THEME = {
  background: "#080b10",
  foreground: "#aab7c8",
  cursor: "#6e9eff",
  cursorAccent: "#080b10",
  selectionBackground: "#233a61",
  black: "#0b0f14",
  blue: "#6e9eff",
  cyan: "#55d1cf",
  green: "#6bd38e",
  magenta: "#b68af2",
  red: "#ef6b73",
  yellow: "#ddb34c",
  white: "#e8eef8",
  brightBlack: "#5c6f85",
  brightBlue: "#8fb5ff",
  brightCyan: "#7ce4e2",
  brightGreen: "#8fe2ab",
  brightMagenta: "#cfaef7",
  brightRed: "#ff8d94",
  brightWhite: "#f2f7ff",
  brightYellow: "#eec96f",
};

interface TermEntry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  opened: boolean;
  initialized: boolean;
  lastCols: number;
  lastRows: number;
  /** 재개 제안 대기 (FR-C-33·34) — 복원된 역할 세션. 사용자가 선택할 때까지 아무것도 스폰하지 않는다 */
  pendingRestore?: { resumable: boolean; reason?: string };
  /** pty 구독 해제 — dispose 시 함께 정리하지 않으면 disposed 터미널이 클로저로 영구 잔류한다 */
  unsubs?: (() => void)[];
  /** 마운트 중인 페인의 즉시 fit — 줌 같은 이산 크기 변화가 RO 디바운스를 건너뛰게 한다 */
  sync?: () => void;
}

const REGISTRY = new Map<string, TermEntry>();

// pendingRestore는 REGISTRY(비반응형)에 살므로, 변경을 화면에 알리는 전용 틱을 둔다
const [restoreTick, setRestoreTick] = createSignal(0);
function setPendingRestore(entry: TermEntry, v: TermEntry["pendingRestore"]) {
  entry.pendingRestore = v;
  setRestoreTick((t) => t + 1);
}

// 터미널 내 검색 (PRD A, M30) — Ctrl+F로 연다. 한 번에 한 페인만 검색 바를 띄운다.
// 상태는 모듈 시그널에 둔다 — 키 핸들러는 initSession(1회)에 등록되고 페인 컴포넌트는 리마운트되기 때문.
const [searchSession, setSearchSession] = createSignal<string | undefined>(undefined);

/** 즉시 fit — 줌/레이아웃 전환처럼 이산적인 크기 변화 직후 호출한다.
 *  RO 디바운스(100ms)를 기다리면 ConPTY 리페인트 스왑이 늦게 일어나 별개의 깜빡임으로 보인다. */
export function syncSessionTerminal(id: string): void {
  REGISTRY.get(id)?.sync?.();
}

/** 세션의 현재 터미널 크기 — 재개/재시작 커맨드가 PTY 크기를 맞추는 데 쓴다 */
export function sessionTermSize(id: string): { cols: number; rows: number } {
  const e = REGISTRY.get(id);
  return e ? { cols: e.term.cols, rows: e.term.rows } : { cols: 120, rows: 30 };
}

/** 브랜치 부여 (워크트리 이동) — 기존 셸 PTY를 끝내고 같은 세션 id로 새 cwd에서 다시 연다.
 *  출력·종료 구독은 세션 id 키라 재스폰 후에도 그대로 이어진다. pty-exit(→ dead 전이)가
 *  새 스폰 뒤에 늦게 도착해 산 세션을 dead로 덮지 않게, 종료 수신을 기다린 뒤 스폰한다. */
export async function respawnSessionShell(id: string, cwd: string, wsId?: string, shell?: string): Promise<void> {
  if (!isTauri()) return;
  const e = REGISTRY.get(id); // 페인 미마운트 세션도 이동은 된다 — 크기만 기본값 폴백
  const alive = backend.listSessions().find((x) => x.id === id)?.status !== "dead";
  if (alive) {
    await new Promise<void>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        unsub();
        clearTimeout(timer);
        resolve();
      };
      const unsub = onPtyExit(id, finish);
      timer = setTimeout(finish, 2000); // exit 유실 폴백 — Rust는 세대 추적으로 같은 id 재기동을 허용한다
      killPty(id);
    });
  }
  e?.term.writeln(`\x1b[90m─── 브랜치 부여 → ${cwd} ───\x1b[0m`);
  const size = sessionTermSize(id); // 재개/재시작과 같은 크기 규약 — 미마운트면 기본값 폴백
  await spawnPty(id, cwd, size.cols, size.rows, wsId, shell);
  if (e) {
    e.lastCols = e.term.cols;
    e.lastRows = e.term.rows;
    e.term.focus();
  }
}

/** 세션 제거 시 호출 — PTY와 함께 터미널 인스턴스도 폐기한다 */
export function disposeSessionTerminal(id: string) {
  const e = REGISTRY.get(id);
  if (e) {
    e.unsubs?.forEach((u) => u());
    e.term.dispose();
    REGISTRY.delete(id);
  }
}

// ── 클립보드 — 네이티브(arboard) 경로. WebView2의 웹 Clipboard API는 권한 문제로 조용히 실패한다 ──

/** 붙여넣기 — 클립보드에 이미지가 있으면 파일로 저장해 경로를 삽입, 아니면 텍스트 */
async function pasteFromClipboard(sessionId: string, term: Terminal): Promise<void> {
  const imgPath = await clipSaveImage();
  if (imgPath) {
    writePty(sessionId, `"${imgPath}" `);
    return;
  }
  const text = await clipReadText();
  if (text) term.paste(text);
}

function copySelection(term: Terminal): void {
  if (term.hasSelection()) clipWriteText(term.getSelection());
}

/**
 * 지금 사용자가 터미널 밖 입력 요소에 타이핑 중인가.
 * 다이얼로그가 떠 있거나 input/textarea/select·contenteditable에 커서가 있으면 참.
 * 다른 터미널의 히든 textarea(.xterm 안)는 넘겨받아도 되므로 제외한다.
 */
function isTypingOutsideTerminal(): boolean {
  if (document.querySelector(".overlay")) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return false;
  if (el.closest(".xterm")) return false;
  return el.matches("input, textarea, select") || el.isContentEditable;
}

// ── 파일 끌어다 놓기 — Tauri가 OS 드래그를 가로채므로 웹 drop 대신 webview 이벤트를 쓴다 ──
// 드롭 지점 아래의 페인을 찾아 따옴표 친 경로(들)를 그 세션 입력에 삽입한다.

let dragDropInit = false;
let dropTarget: HTMLElement | null = null;

function hostAt(position: { x: number; y: number }): HTMLElement | null {
  const scale = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / scale, position.y / scale);
  return (el?.closest("[data-session-id]") as HTMLElement | null) ?? null;
}

function clearDropTarget() {
  dropTarget?.classList.remove("drop-target");
  dropTarget = null;
}

async function ensureDragDrop(): Promise<void> {
  if (dragDropInit || !isTauri()) return;
  dragDropInit = true;
  await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") {
      const host = hostAt(p.position);
      if (host !== dropTarget) {
        clearDropTarget();
        dropTarget = host;
        host?.classList.add("drop-target");
      }
    } else if (p.type === "drop") {
      const host = hostAt(p.position);
      clearDropTarget();
      const sessionId = host?.getAttribute("data-session-id");
      if (sessionId && p.paths.length > 0) {
        writePty(sessionId, p.paths.map((f) => `"${f}"`).join(" ") + " ");
        REGISTRY.get(sessionId)?.term.focus();
      }
    } else {
      clearDropTarget();
    }
  });
}

function createEntry(): TermEntry {
  const term = new Terminal({
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 12,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000, // FR-C-10 — 인메모리 링버퍼, 초과분은 스토어가 갖고 있다
    theme: EQ_THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  // 링크 감지 (PRD A, M30) — URL 클릭은 기본 브라우저로 보낸다 (브라우저 패널은 localhost 전용)
  term.loadAddon(new WebLinksAddon((_ev, uri) => openExternal(uri)));
  return { term, fit, search, opened: false, initialized: false, lastCols: 0, lastRows: 0 };
}

/** 최초 1회 — 스트림 구독·재생·스폰. 리마운트에서는 다시 실행되지 않는다.
 *  복원 세션(restore)은 스폰하지 않고 재개 제안을 띄운다 (FR-C-33 — 자동 실행 없음).
 *  재부착 세션(revive, FR-C-06)은 PTY가 이미 살아 있다 — 아무것도 스폰하지 않고 이어 그린다. */
async function initSession(
  entry: TermEntry,
  props: {
    sessionId: string;
    cwd: string;
    wsId?: string;
    shell?: string;
    agent?: { name: string; permissions: Permissions };
    restore?: { resumable: boolean; reason?: string };
    revive?: boolean;
    mockLines?: string[];
  },
) {
  const term = entry.term;

  // Ctrl+C = 선택 있으면 복사, 없으면 SIGINT (Windows Terminal 방식) · Ctrl+Shift+C = 항상 선택 복사.
  // Ctrl(+Shift)+V = 붙여넣기(이미지 포함) — Tauri에서는 Ctrl+V도 네이티브 클립보드 경로로 가로챈다
  // (WebView2 웹 API 우회).
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === "keydown" && ev.ctrlKey) {
      const k = ev.key.toLowerCase();
      if (ev.shiftKey && k === "c") {
        copySelection(term);
        return false;
      }
      if (k === "c" && !ev.shiftKey && !ev.altKey && term.hasSelection()) {
        copySelection(term);
        term.clearSelection();
        return false;
      }
      if (k === "v" && (ev.shiftKey || isTauri())) {
        void pasteFromClipboard(props.sessionId, term);
        return false;
      }
      // 터미널 내 검색 (M30) — TUI로 Ctrl+F를 흘리지 않고 검색 바를 연다
      if (k === "f" && !ev.shiftKey && !ev.altKey) {
        setSearchSession(props.sessionId);
        return false;
      }
    }
    return true;
  });

  if (isTauri()) {
    entry.unsubs = [
      onPtyOutput(props.sessionId, (data) => term.write(data)),
      onPtyExit(props.sessionId, (code) => {
        term.write(`\r\n\x1b[31m프로세스 종료 · exit ${code ?? "?"}\x1b[0m\r\n`);
      }),
    ];
    term.onData((data) => writePty(props.sessionId, data));

    // 앱 재시작 복구 (FR-C-31·32) — 스토어의 확정 줄을 흐리게 재생하고 경계를 긋는다.
    // 기존 DB에 남은 TUI 잔해(프레임 조각·연속 중복)는 재생에서 걸러낸다 — 판정은 공용(cleanScrollback)
    const tail = await scrollbackTail(props.wsId ?? "default", props.sessionId, settings().scrollbackReplay);
    const cleaned = cleanScrollback(tail);
    if (cleaned.length > 0) {
      term.writeln(`\x1b[90m─── 이전 세션 스크롤백 · 마지막 ${cleaned.length}줄 재생 ───\x1b[0m`);
      // SGR 보존본(FR-C-15)이 있으면 색 그대로, 없으면 흐리게 (FR-C-31)
      for (const line of cleaned) term.writeln(line.styled ?? `\x1b[2m${line.text}\x1b[0m`);
      // FR-C-32 경계 — 복원 대기 중에는 "새 세션 시작"이 아니다 (아직 아무것도 안 떴다)
      term.writeln(
        props.revive
          ? "\x1b[90m─── 웹뷰 재시작 — 실행 중인 세션에 재부착 (FR-C-06) ───\x1b[0m"
          : props.restore
            ? "\x1b[90m─── 재개 대기 — 이전 PTY는 종료되었습니다 (자동 실행 안 함) ───\x1b[0m"
            : "\x1b[90m─── 새 세션 시작 ───\x1b[0m",
      );
    }
    // 웹뷰 재시작 재부착 (FR-C-06) — PTY는 Rust에 살아 있다. 스폰 없이 출력 구독만 잇고,
    // ConPTY가 resize에 전체 리페인트로 응답하는 성질로 현재 화면을 다시 그리게 한다.
    if (props.revive) {
      if (cleaned.length === 0) {
        term.writeln("\x1b[90m─── 웹뷰 재시작 — 실행 중인 세션에 재부착 (FR-C-06) ───\x1b[0m");
      }
      entry.lastCols = term.cols;
      entry.lastRows = term.rows;
      resizePty(props.sessionId, term.cols, Math.max(2, term.rows - 1));
      setTimeout(() => resizePty(props.sessionId, term.cols, term.rows), 150);
      return;
    }
    // 복원된 역할 세션 (FR-C-33) — 재개 가능 여부를 판별해 제안만 하고, 실행은 사용자 몫이다 (C5)
    if (props.restore && props.agent) {
      if (props.restore.resumable) {
        term.writeln("\x1b[90m이전 에이전트 세션이 있습니다 — 아래 제안에서 재개하거나 새로 시작하세요\x1b[0m");
      } else {
        // 재개 불가는 페인에 명시한다 (FR-C-34)
        term.writeln(`\x1b[33m재개 불가 — ${props.restore.reason ?? "트랜스크립트 없음"}\x1b[0m`);
        term.writeln("\x1b[90m새 대화로 시작하거나 셸로 시작할 수 있습니다\x1b[0m");
      }
      entry.lastCols = term.cols;
      entry.lastRows = term.rows;
      setPendingRestore(entry, props.restore);
      return;
    }
    // 셸 우선 모델 — 처음 켜는 세션은 역할이 있어도 전부 일반 셸이다. 여기는 유일한
    // 자동 스폰 게이트라, 이 자리에서 에이전트를 띄우지 않는 것이 "자동 실행 없음"의 구조적 보장이다.
    // 에이전트 기동은 명시 액션(재개 버튼·세션 상세)만 남는다.
    await spawnPty(props.sessionId, props.cwd, term.cols, term.rows, props.wsId, props.shell);
    entry.lastCols = term.cols;
    entry.lastRows = term.rows;
  } else {
    // 목 폴백 — 브라우저 dev에서는 정적 라인 + 로컬 에코 (1회만 기록)
    const prompt = `\x1b[38;5;110mPS ${props.cwd}>\x1b[0m `;
    for (const line of props.mockLines ?? []) term.writeln(line);
    term.write(prompt);
    let input = "";
    term.onData((data) => {
      if (data === "\r") {
        term.write(`\r\n\x1b[90m(목 세션 — Tauri에서 실행하면 실제 셸이 붙습니다)\x1b[0m\r\n${prompt}`);
        input = "";
      } else if (data === "\x7f") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          term.write("\b \b");
        }
      } else if (data >= " " || data === "\t") {
        input += data;
        term.write(data);
      }
    });
  }
}

export function TerminalPane(props: {
  sessionId: string;
  cwd: string;
  wsId?: string;
  shell?: string;
  agent?: { name: string; permissions: Permissions };
  restore?: { resumable: boolean; reason?: string };
  revive?: boolean;
  mockLines?: string[];
  /** 페인 소유 화면(컨트롤 센터)이 얹는 세션 액션 그룹 — 편집 그룹 뒤에 붙는다 (시안 §06) */
  extraMenu?: () => MenuGroup[];
}) {
  let host!: HTMLDivElement;
  let historyEl: HTMLDivElement | undefined;
  const [menu, setMenu] = createSignal<{ x: number; y: number; hasSel: boolean } | undefined>(undefined);

  // ── 재개 제안 (FR-C-33·34) — 복원된 역할 세션은 사용자가 고를 때까지 아무것도 뜨지 않는다 ──
  const [restoreErr, setRestoreErr] = createSignal<string | undefined>(undefined);
  const pendingRestore = () => {
    restoreTick();
    return REGISTRY.get(props.sessionId)?.pendingRestore;
  };
  // 다른 표면(세션 상세 패널)에서 재개했으면 제안을 접는다 — restored 해제가 그 신호다
  const stillRestored = () => {
    tick();
    return backend.listSessions().find((x) => x.id === props.sessionId)?.restored !== false;
  };
  const clearRestore = () => {
    const e = REGISTRY.get(props.sessionId);
    if (e) setPendingRestore(e, undefined);
  };
  const restoreAction = async (kind: "resume" | "fresh" | "shell") => {
    const e = REGISTRY.get(props.sessionId);
    if (!e) return;
    setRestoreErr(undefined);
    try {
      if (kind === "resume" && props.agent) {
        await resumeAgent(
          props.sessionId,
          props.wsId ?? "default",
          props.cwd,
          props.agent.name,
          props.agent.permissions,
          e.term.cols,
          e.term.rows,
        );
        backend.resumeSession(props.sessionId);
      } else if (kind === "fresh" && props.agent) {
        await spawnAgent(
          props.sessionId,
          props.wsId ?? "default",
          props.cwd,
          props.agent.name,
          props.agent.permissions,
          e.term.cols,
          e.term.rows,
        );
      } else {
        await spawnPty(props.sessionId, props.cwd, e.term.cols, e.term.rows, props.wsId, props.shell);
      }
    } catch (err) {
      // 실패 이유를 페인에 정직하게 표시 (FR-D-08) — 제안은 남겨 다시 시도할 수 있게 한다
      setRestoreErr(String(err));
      e.term.writeln(`\r\n\x1b[31m${kind === "resume" ? "재개" : "기동"} 실패 — ${String(err)}\x1b[0m`);
      return;
    }
    e.lastCols = e.term.cols;
    e.lastRows = e.term.rows;
    clearRestore();
    e.term.focus();
  };

  // ── 터미널 내 검색 (PRD A, M30) — Enter 다음 · Shift+Enter 이전 · ESC 닫기 ──
  let searchInput: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal("");
  const searchOpen = () => searchSession() === props.sessionId;
  const closeSearch = () => {
    if (searchSession() === props.sessionId) setSearchSession(undefined);
    const e = REGISTRY.get(props.sessionId);
    e?.term.clearSelection();
    e?.term.focus();
  };
  const findNext = (incremental = false) => {
    const e = REGISTRY.get(props.sessionId);
    if (e && query()) e.search.findNext(query(), { incremental });
  };
  const findPrev = () => {
    const e = REGISTRY.get(props.sessionId);
    if (e && query()) e.search.findPrevious(query());
  };
  createEffect(() => {
    if (searchOpen()) requestAnimationFrame(() => searchInput?.focus());
  });

  // 선택된 세션이 되면 터미널로 포커스를 옮긴다 (대시보드 1클릭 점프·페인 클릭) — 단,
  // 사용자가 다른 입력 요소에 타이핑 중이거나 다이얼로그가 떠 있으면 뺏지 않는다.
  // 규칙은 이 함수 하나 — 선택 효과와 attach 마무리가 같은 판정을 쓴다.
  const focusIfSelected = () => {
    const e = REGISTRY.get(props.sessionId);
    if (e?.opened && selectedSession() === props.sessionId && !isTypingOutsideTerminal()) e.term.focus();
  };
  createEffect(focusIfSelected);

  // ── 디스크 스크롤백 (FR-C-13·14) — 링버퍼 최상단에서만 칩이 뜬다 ──
  const [atTop, setAtTop] = createSignal(false);
  const [history, setHistory] = createSignal<ScrollbackHit[] | null>(null);

  const openHistory = async () => {
    const lines = await pageScrollback(props.wsId ?? "default", props.sessionId, null, 200);
    setHistory(lines);
    requestAnimationFrame(() => historyEl?.scrollTo(0, historyEl.scrollHeight));
  };
  const loadOlderHistory = async () => {
    const h = history();
    if (!h) return;
    const older = await pageScrollback(props.wsId ?? "default", props.sessionId, h[0]?.seq ?? null, 200);
    if (older.length === 0) return;
    const prevHeight = historyEl?.scrollHeight ?? 0;
    setHistory([...older, ...h]);
    // 이어 보던 지점 유지 — 앞에 붙인 만큼 스크롤을 내린다
    requestAnimationFrame(() => historyEl?.scrollTo(0, (historyEl.scrollHeight - prevHeight)));
  };

  onMount(() => {
    let entry = REGISTRY.get(props.sessionId);
    if (!entry) {
      entry = createEntry();
      REGISTRY.set(props.sessionId, entry);
    }
    const e = entry;
    let cancelled = false;
    void ensureDragDrop();

    // 위로 스크롤 최상단 감지 (FR-C-13) — 인메모리 5,000줄의 꼭대기 = 디스크 기록의 입구
    const scrollDisp = isTauri()
      ? e.term.onScroll((y) => setAtTop(y === 0 && e.term.buffer.active.baseY > 0))
      : undefined;

    // 우클릭 컨텍스트 메뉴
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      setMenu({ x: ev.clientX, y: ev.clientY, hasSel: e.term.hasSelection() });
    };
    host.addEventListener("contextmenu", onContextMenu);
    const closeMenu = () => setMenu(undefined);
    window.addEventListener("mousedown", closeMenu);

    const syncSize = () => {
      if (host.clientWidth < 40 || host.clientHeight < 24) return; // 0-크기 측정 방지
      // 렌더러가 아직 셀 크기를 못 재면 fit이 비정상 값(cols<2)을 내놓는다 — 그 프레임은 건너뛴다
      const dims = e.fit.proposeDimensions();
      if (!dims || !isFinite(dims.cols) || dims.cols < 2 || dims.rows < 1) return;
      // fit()은 내부에서 proposeDimensions를 다시 돌린다(강제 레이아웃 2회) — 이미 잰 값으로 직접 resize
      const changed = dims.cols !== e.term.cols || dims.rows !== e.term.rows;
      if (changed) e.term.resize(dims.cols, dims.rows);
      if (isTauri() && e.initialized && (e.term.cols !== e.lastCols || e.term.rows !== e.lastRows)) {
        e.lastCols = e.term.cols;
        e.lastRows = e.term.rows;
        resizePty(props.sessionId, e.term.cols, e.term.rows);
      }
      // 크기가 실제로 바뀌었으면 전체 리페인트 — 리사이즈 직후 렌더 찌꺼기 방지
      if (changed) {
        try {
          e.term.refresh(0, Math.max(0, e.term.rows - 1));
        } catch {
          /* 렌더러 미준비 시 무시 */
        }
        e.term.scrollToBottom();
      }
    };

    e.sync = syncSize;

    // 컨테이너가 실제 크기를 가진 뒤에만 open/재부착한다 — 0-크기에서 열면 렌더러 측정이 깨진다
    const attach = (tries: number) => {
      if (cancelled) return;
      if ((host.clientWidth < 40 || host.clientHeight < 24) && tries > 0) {
        requestAnimationFrame(() => attach(tries - 1));
        return;
      }
      if (!e.opened) {
        e.term.open(host);
        e.opened = true;
        // WebGL 렌더러 — 컨텍스트가 유실되면 애드온을 폐기해 기본 렌더러로 폴백한다
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          e.term.loadAddon(webgl);
        } catch {
          /* WebGL 미지원 환경 — 기본 렌더러 사용 */
        }
      } else if (e.term.element && e.term.element.parentElement !== host) {
        host.appendChild(e.term.element); // 리마운트 = DOM 재부착만
      }
      syncSize();
      if (!e.initialized) {
        e.initialized = true;
        void initSession(e, props);
      }
      // 재부착 후 전체 리페인트 — 캔버스/행 렌더가 detach 중 비워질 수 있다
      try {
        e.term.refresh(0, Math.max(0, e.term.rows - 1));
      } catch {
        /* 렌더러 미준비 시 무시 */
      }
      e.term.scrollToBottom();
      // 마운트 시점에 이미 선택된 세션이면 포커스 — 선택 효과는 open 전에 지나갔을 수 있다
      focusIfSelected();
    };
    requestAnimationFrame(() => attach(60));

    // 크기 추적 — 디바운스 + 실변경시에만 PTY resize (ConPTY는 resize마다 리페인트한다)
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const queueSync = () => {
      clearTimeout(resizeTimer);
      clearTimeout(settleTimer);
      resizeTimer = setTimeout(() => {
        syncSize();
        // 드래그가 끝난 뒤 한 번 더 수렴 — PTY와 xterm 열 수가 어긋난 채 남지 않게
        settleTimer = setTimeout(syncSize, 350);
      }, 100);
    };
    const ro = new ResizeObserver(queueSync);
    ro.observe(host);
    // 창 최대화·모니터 이동 등 RO가 놓치는 경우의 백업 경로
    window.addEventListener("resize", queueSync);

    onCleanup(() => {
      cancelled = true;
      if (e.sync === syncSize) e.sync = undefined;
      scrollDisp?.dispose();
      clearTimeout(resizeTimer);
      clearTimeout(settleTimer);
      ro.disconnect();
      window.removeEventListener("resize", queueSync);
      host.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousedown", closeMenu);
      // 터미널은 dispose하지 않는다 — REGISTRY가 세션 수명 동안 유지한다
    });
  });

  const menuAction = (fn: (term: Terminal) => void) => {
    const e = REGISTRY.get(props.sessionId);
    if (e) fn(e.term);
    setMenu(undefined);
  };

  return (
    <>
      <div class="xterm-host" data-session-id={props.sessionId} ref={host}>
        {/* 터미널 내 검색 (M30) — Ctrl+F. 링버퍼(5,000줄) 범위 검색, 디스크 기록은 로그 패널 FTS가 담당 */}
        <Show when={searchOpen()}>
          <div class="card term-search mono" onMouseDown={(ev) => ev.stopPropagation()}>
            <input
              ref={searchInput}
              value={query()}
              placeholder="터미널 검색"
              spellcheck={false}
              onInput={(ev) => {
                setQuery(ev.currentTarget.value);
                findNext(true);
              }}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  if (ev.shiftKey) findPrev();
                  else findNext();
                } else if (ev.key === "Escape") {
                  ev.preventDefault();
                  ev.stopPropagation(); // 전체 화면 ESC 핸들러로 새지 않게
                  closeSearch();
                }
              }}
            />
            <button class="btn ghost" title="이전 일치 (Shift+Enter)" onClick={findPrev}>
              ↑
            </button>
            <button class="btn ghost" title="다음 일치 (Enter)" onClick={() => findNext()}>
              ↓
            </button>
            <button class="btn ghost" title="닫기 (ESC)" onClick={closeSearch}>
              ✕
            </button>
          </div>
        </Show>
        <Show when={isTauri() && atTop() && !history()}>
          <button class="btn term-history-chip" onClick={() => void openHistory()}>
            ▲ 디스크 기록 보기 — 링버퍼 위 기록 (FR-C-13)
          </button>
        </Show>
        {/* 재개 제안 (FR-C-33) — 자동 실행 없음. 재개 불가는 명시한다 (FR-C-34) */}
        <Show when={pendingRestore() && stillRestored()}>
          {(_) => {
            const r = () => pendingRestore()!;
            return (
              <div class="card pane-restore" onMouseDown={(ev) => ev.stopPropagation()}>
                <div class="mono" style={{ "font-size": "11px", "font-weight": 700 }}>
                  <Show
                    when={r().resumable}
                    fallback={<span class="st-dead">재개 불가 — {r().reason ?? "트랜스크립트 없음"}</span>}
                  >
                    <span class="st-busy">이전 에이전트 세션 발견 — 재개 대기</span>
                  </Show>
                </div>
                <div class="muted" style={{ "font-size": "10px" }}>
                  {r().resumable
                    ? "같은 대화를 --resume으로 이어갑니다. 자동 실행하지 않습니다 (C5)."
                    : "이전 대화를 이어갈 수 없습니다 — 새 대화 또는 셸로 시작하세요."}
                </div>
                <div class="pane-restore-actions">
                  <Show when={r().resumable}>
                    <button class="btn primary" onClick={() => void restoreAction("resume")}>
                      ▶ 이전 대화 재개
                    </button>
                  </Show>
                  <button class="btn" classList={{ primary: !r().resumable }} onClick={() => void restoreAction("fresh")}>
                    새 대화 시작
                  </button>
                  <button class="btn ghost" onClick={() => void restoreAction("shell")}>
                    셸로 시작
                  </button>
                </div>
                <Show when={restoreErr()}>
                  <div class="mono st-dead" style={{ "font-size": "10px" }}>
                    {restoreErr()}
                  </div>
                </Show>
              </div>
            );
          }}
        </Show>
        <Show when={history()}>
          {(h) => (
            <div class="card term-history" onMouseDown={(ev) => ev.stopPropagation()}>
              <div style={{ display: "flex", "align-items": "center", padding: "3px 8px", gap: "6px" }}>
                <span class="eyebrow">디스크 스크롤백 · {h().length}줄 로드됨</span>
                <button
                  class="btn ghost"
                  style={{ "margin-left": "auto", padding: "1px 6px" }}
                  onClick={() => setHistory(null)}
                >
                  ✕
                </button>
              </div>
              <button class="btn ghost" style={{ padding: "2px" }} onClick={() => void loadOlderHistory()}>
                ▲ 더 이전 200줄
              </button>
              <div class="mono term-history-lines" ref={historyEl}>
                <For each={h()}>{(l) => <div>{l.text}</div>}</For>
                <Show when={h().length === 0}>
                  <div class="muted" style={{ padding: "8px" }}>
                    디스크에 저장된 확정 줄이 없습니다
                  </div>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
      <Show when={menu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={props.agent ? `${props.agent.name} · 터미널` : "기본 터미널"}
            onClose={() => setMenu(undefined)}
            groups={[
              // 주 동작 — 편집
              [
                { label: "복사", kbd: "Ctrl+Shift+C", disabled: !m().hasSel, action: () => menuAction(copySelection) },
                { label: "붙여넣기", kbd: "Ctrl+Shift+V", action: () => menuAction((t) => void pasteFromClipboard(props.sessionId, t)) },
                { label: "모두 선택", action: () => menuAction((t) => t.selectAll()) },
                { label: "검색", kbd: "Ctrl+F", action: () => menuAction(() => setSearchSession(props.sessionId)) },
                { label: "화면 지우기", action: () => menuAction((t) => t.clear()) },
              ],
              // 보기·이동·세션 — 소유 화면이 얹는다 (danger 항목은 컴포넌트가 마지막으로 모은다)
              ...(props.extraMenu?.() ?? []),
              [{ label: "이미지 붙여넣기 → 파일 저장 후 경로 삽입", note: true }],
            ]}
          />
        )}
      </Show>
    </>
  );
}
