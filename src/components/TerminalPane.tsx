// 실터미널 페인 — xterm.js 렌더 + PTY 브리지.
// 세션당 Terminal 인스턴스는 정확히 1개를 만들어 REGISTRY에 유지한다 (세션은 페인보다 오래 산다).
// 페인이 리마운트되면(줌·전체 화면·탭 전환) DOM 요소만 재부착한다 — 버퍼를 다시 쓰지 않으므로
// ConPTY 리페인트가 중복 재생되지 않고 스크롤백이 온전히 이어진다.
// 링버퍼 꼭대기(FR-C-13)에서는 디스크 기록 칩이 떠서 스토어 스크롤백을 조각 로드한다 (FR-C-14).
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "@xterm/xterm/css/xterm.css";
import { pageScrollback } from "../backend/panels";
import type { ScrollbackHit } from "../backend/panels";
import {
  clipReadText,
  clipSaveImage,
  clipWriteText,
  isTauri,
  onPtyExit,
  onPtyOutput,
  resizePty,
  scrollbackTail,
  spawnPty,
  writePty,
} from "../backend/pty";
import { resumeAgent, spawnAgent } from "../backend/agent";
import { backend } from "../backend/mock";
import { settings } from "../backend/settings";
import { tick } from "../state";
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
};

interface TermEntry {
  term: Terminal;
  fit: FitAddon;
  opened: boolean;
  initialized: boolean;
  lastCols: number;
  lastRows: number;
  /** 재개 제안 대기 (FR-C-33·34) — 복원된 역할 세션. 사용자가 선택할 때까지 아무것도 스폰하지 않는다 */
  pendingRestore?: { resumable: boolean; reason?: string };
}

const REGISTRY = new Map<string, TermEntry>();

// pendingRestore는 REGISTRY(비반응형)에 살므로, 변경을 화면에 알리는 전용 틱을 둔다
const [restoreTick, setRestoreTick] = createSignal(0);
function setPendingRestore(entry: TermEntry, v: TermEntry["pendingRestore"]) {
  entry.pendingRestore = v;
  setRestoreTick((t) => t + 1);
}

/** 세션의 현재 터미널 크기 — 재개/재시작 커맨드가 PTY 크기를 맞추는 데 쓴다 */
export function sessionTermSize(id: string): { cols: number; rows: number } {
  const e = REGISTRY.get(id);
  return e ? { cols: e.term.cols, rows: e.term.rows } : { cols: 120, rows: 30 };
}

/** 세션 제거 시 호출 — PTY와 함께 터미널 인스턴스도 폐기한다 */
export function disposeSessionTerminal(id: string) {
  const e = REGISTRY.get(id);
  if (e) {
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
  return { term, fit, opened: false, initialized: false, lastCols: 0, lastRows: 0 };
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

  // Ctrl+Shift+C = 선택 복사 · Ctrl(+Shift)+V = 붙여넣기(이미지 포함). Ctrl+C는 그대로 SIGINT.
  // Tauri에서는 Ctrl+V도 네이티브 클립보드 경로로 가로챈다 (WebView2 웹 API 우회).
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === "keydown" && ev.ctrlKey) {
      const k = ev.key.toLowerCase();
      if (ev.shiftKey && k === "c") {
        copySelection(term);
        return false;
      }
      if (k === "v" && (ev.shiftKey || isTauri())) {
        void pasteFromClipboard(props.sessionId, term);
        return false;
      }
    }
    return true;
  });

  if (isTauri()) {
    onPtyOutput(props.sessionId, (data) => term.write(data));
    onPtyExit(props.sessionId, (code) => {
      term.write(`\r\n\x1b[31m프로세스 종료 · exit ${code ?? "?"}\x1b[0m\r\n`);
    });
    term.onData((data) => writePty(props.sessionId, data));

    // 앱 재시작 복구 (FR-C-31·32) — 스토어의 확정 줄을 흐리게 재생하고 경계를 긋는다.
    // 기존 DB에 남은 TUI 잔해(상자 문자 프레임 조각·연속 중복)는 재생에서 걸러낸다.
    const BOXY = /[─│╭╮╯╰┌┐└┘═║╔╗╚╝┃━╌╍┤├┬┴┼]/g;
    const isNoise = (l: string) => {
      const t = l.replace(/\s/g, "");
      if (!t) return true;
      return ((t.match(BOXY) ?? []).length * 2) >= t.length;
    };
    const tail = await scrollbackTail(props.wsId ?? "default", props.sessionId, settings().scrollbackReplay);
    let prevLine = "";
    const cleaned = tail.filter((l) => {
      if (isNoise(l) || l === prevLine) return false;
      prevLine = l;
      return true;
    });
    if (cleaned.length > 0) {
      term.writeln(`\x1b[90m─── 이전 세션 스크롤백 · 마지막 ${cleaned.length}줄 재생 ───\x1b[0m`);
      for (const line of cleaned) term.writeln(`\x1b[2m${line}\x1b[0m`);
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
    // 역할 세션 = Claude Code 에이전트 기동 (PRD D) / 기본 터미널 = 일반 셸
    if (props.agent) {
      try {
        await spawnAgent(
          props.sessionId,
          props.wsId ?? "default",
          props.cwd,
          props.agent.name,
          props.agent.permissions,
          term.cols,
          term.rows,
        );
      } catch (err) {
        // 기동 실패 이유를 페인에 정직하게 표시 (FR-D-08)
        term.writeln(`\r\n\x1b[31m에이전트 기동 실패 — ${String(err)}\x1b[0m`);
        term.writeln("\x1b[90mclaude CLI 설치/로그인 상태를 확인하세요\x1b[0m");
      }
    } else {
      await spawnPty(props.sessionId, props.cwd, term.cols, term.rows, props.wsId, props.shell);
    }
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
      const prevCols = e.term.cols;
      const prevRows = e.term.rows;
      e.fit.fit();
      if (isTauri() && e.initialized && (e.term.cols !== e.lastCols || e.term.rows !== e.lastRows)) {
        e.lastCols = e.term.cols;
        e.lastRows = e.term.rows;
        resizePty(props.sessionId, e.term.cols, e.term.rows);
      }
      // 크기가 실제로 바뀌었으면 전체 리페인트 — 리사이즈 직후 렌더 찌꺼기 방지
      if (e.term.cols !== prevCols || e.term.rows !== prevRows) {
        try {
          e.term.refresh(0, Math.max(0, e.term.rows - 1));
        } catch {
          /* 렌더러 미준비 시 무시 */
        }
        e.term.scrollToBottom();
      }
    };

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
          <div
            class="card term-menu"
            style={{ left: `${m().x}px`, top: `${m().y}px` }}
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            <button class="term-menu-item" disabled={!m().hasSel} onClick={() => menuAction(copySelection)}>
              복사 <span class="mono muted">Ctrl+Shift+C</span>
            </button>
            <button
              class="term-menu-item"
              onClick={() => menuAction((t) => void pasteFromClipboard(props.sessionId, t))}
            >
              붙여넣기 <span class="mono muted">Ctrl+Shift+V</span>
            </button>
            <button class="term-menu-item" onClick={() => menuAction((t) => t.selectAll())}>
              모두 선택
            </button>
            <button class="term-menu-item" onClick={() => menuAction((t) => t.clear())}>
              화면 지우기
            </button>
            <div class="term-menu-note muted">이미지 붙여넣기 → 파일 저장 후 경로 삽입</div>
          </div>
        )}
      </Show>
    </>
  );
}
