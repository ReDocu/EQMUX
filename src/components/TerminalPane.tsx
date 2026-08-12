// 실터미널 페인 — xterm.js 렌더 + PTY 브리지.
// 세션당 Terminal 인스턴스는 정확히 1개를 만들어 REGISTRY에 유지한다 (세션은 페인보다 오래 산다).
// 페인이 리마운트되면(줌·전체 화면·탭 전환) DOM 요소만 재부착한다 — 버퍼를 다시 쓰지 않으므로
// ConPTY 리페인트가 중복 재생되지 않고 스크롤백이 온전히 이어진다.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  isTauri,
  onPtyExit,
  onPtyOutput,
  resizePty,
  savePastedImage,
  scrollbackTail,
  spawnPty,
  writePty,
} from "../backend/pty";

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
}

const REGISTRY = new Map<string, TermEntry>();

/** 세션 제거 시 호출 — PTY와 함께 터미널 인스턴스도 폐기한다 */
export function disposeSessionTerminal(id: string) {
  const e = REGISTRY.get(id);
  if (e) {
    e.term.dispose();
    REGISTRY.delete(id);
  }
}

// ── 클립보드 — 텍스트/이미지 붙여넣기 + 선택 복사 ──

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 이미지 붙여넣기 → %TEMP%\eqmux-pastes에 저장 → 따옴표 친 경로를 입력에 삽입 */
async function pasteImageFlow(sessionId: string, term: Terminal, blob: Blob): Promise<void> {
  if (!isTauri()) {
    term.write("\r\n\x1b[90m(이미지 붙여넣기는 Tauri 앱에서만 파일로 저장됩니다)\x1b[0m\r\n");
    return;
  }
  try {
    const ext = (blob.type.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "") || "png";
    const path = await savePastedImage(await blobToB64(blob), ext);
    writePty(sessionId, `"${path}" `);
  } catch {
    term.write("\r\n\x1b[31m이미지 저장 실패\x1b[0m\r\n");
  }
}

/** 우클릭·Ctrl+Shift+V 붙여넣기 — 이미지가 있으면 파일 경로로, 아니면 텍스트로 */
async function pasteFromClipboard(sessionId: string, term: Terminal): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith("image/"));
      if (imgType) {
        await pasteImageFlow(sessionId, term, await item.getType(imgType));
        return;
      }
    }
  } catch {
    /* 이미지 읽기 미지원/거부 → 텍스트 폴백 */
  }
  const text = await navigator.clipboard.readText().catch(() => "");
  if (text) term.paste(text);
}

function copySelection(term: Terminal): void {
  if (term.hasSelection()) {
    void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
  }
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

/** 최초 1회 — 스트림 구독·재생·스폰. 리마운트에서는 다시 실행되지 않는다. */
async function initSession(
  entry: TermEntry,
  props: { sessionId: string; cwd: string; wsId?: string; shell?: string; mockLines?: string[] },
) {
  const term = entry.term;

  // Ctrl+Shift+C = 선택 복사 · Ctrl+Shift+V = 붙여넣기(이미지 포함). Ctrl+C는 그대로 SIGINT.
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey) {
      const k = ev.key.toLowerCase();
      if (k === "c") {
        copySelection(term);
        return false;
      }
      if (k === "v") {
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

    // 앱 재시작 복구 (FR-C-31·32) — 스토어의 확정 줄을 흐리게 재생하고 경계를 긋는다
    const tail = await scrollbackTail(props.wsId ?? "default", props.sessionId, 500);
    if (tail.length > 0) {
      term.writeln(`\x1b[90m─── 이전 세션 스크롤백 · 마지막 ${tail.length}줄 재생 ───\x1b[0m`);
      for (const line of tail) term.writeln(`\x1b[2m${line}\x1b[0m`);
      term.writeln("\x1b[90m─── 새 세션 시작 ───\x1b[0m");
    }
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
  mockLines?: string[];
}) {
  let host!: HTMLDivElement;
  const [menu, setMenu] = createSignal<{ x: number; y: number; hasSel: boolean } | undefined>(undefined);

  onMount(() => {
    let entry = REGISTRY.get(props.sessionId);
    if (!entry) {
      entry = createEntry();
      REGISTRY.set(props.sessionId, entry);
    }
    const e = entry;
    let cancelled = false;

    // Ctrl+V 붙여넣기에서 이미지가 잡히면 가로채 파일로 저장한다 (텍스트는 xterm 기본 처리)
    const onPaste = (ev: ClipboardEvent) => {
      const items = ev.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          ev.preventDefault();
          ev.stopPropagation();
          const file = items[i].getAsFile();
          if (file) void pasteImageFlow(props.sessionId, e.term, file);
          return;
        }
      }
    };
    host.addEventListener("paste", onPaste, true);

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
      e.fit.fit();
      if (isTauri() && e.initialized && (e.term.cols !== e.lastCols || e.term.rows !== e.lastRows)) {
        e.lastCols = e.term.cols;
        e.lastRows = e.term.rows;
        resizePty(props.sessionId, e.term.cols, e.term.rows);
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
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncSize, 120);
    });
    ro.observe(host);

    onCleanup(() => {
      cancelled = true;
      clearTimeout(resizeTimer);
      ro.disconnect();
      host.removeEventListener("paste", onPaste, true);
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
      <div class="xterm-host" ref={host} />
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
