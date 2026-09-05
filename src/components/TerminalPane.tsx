// 실터미널 페인 — xterm.js 렌더 + PTY 브리지.
// 세션당 Terminal 인스턴스는 정확히 1개를 만들어 REGISTRY에 유지한다 (세션은 페인보다 오래 산다).
// 페인이 리마운트되면(줌·전체 화면·탭 전환) DOM 요소만 재부착한다 — 버퍼를 다시 쓰지 않으므로
// ConPTY 리페인트가 중복 재생되지 않고 스크롤백이 온전히 이어진다.
// 링버퍼 꼭대기(FR-C-13)에서는 디스크 기록 칩이 떠서 스토어 스크롤백을 조각 로드한다 (FR-C-14).
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Terminal } from "@xterm/xterm";
import type { ILink, ILinkProvider, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { noteWebglContextLoss, provideTerminalStats } from "../backend/diag";
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
  revealPath,
  scrollbackTail,
  setTerminalDisposer,
  spawnPty,
  writePty,
} from "../backend/pty";
import { resumeAgent, spawnAgent } from "../backend/agent";
import { backend } from "../backend/mock";
import { settings } from "../backend/settings";
import { t, tf } from "../i18n";
import { selectedSession, tick } from "../state";
import { ContextMenu } from "./ui";
import type { MenuGroup } from "./ui";
import type { Permissions } from "../types";

/** 터미널 색 — styles.css의 --eq-term-* 토큰이 원본이다 (설정 · 색 팔레트가 이 토큰을 고른다).
 *  여기에 hex를 두면 팔레트와 어긋나므로 두지 않는다. 터미널은 어느 테마에서도 다크로 남는다. */
function readTermTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const bg = v("--eq-term-bg");
  return {
    background: bg,
    foreground: v("--eq-term-fg"),
    cursor: v("--eq-term-blue"),
    cursorAccent: bg,
    selectionBackground: v("--eq-term-sel"),
    black: v("--eq-term-black"),
    red: v("--eq-term-red"),
    green: v("--eq-term-green"),
    yellow: v("--eq-term-yellow"),
    blue: v("--eq-term-blue"),
    magenta: v("--eq-term-magenta"),
    cyan: v("--eq-term-cyan"),
    white: v("--eq-term-white"),
    brightBlack: v("--eq-term-bright-black"),
    brightRed: v("--eq-term-bright-red"),
    brightGreen: v("--eq-term-bright-green"),
    brightYellow: v("--eq-term-bright-yellow"),
    brightBlue: v("--eq-term-bright-blue"),
    brightMagenta: v("--eq-term-bright-magenta"),
    brightCyan: v("--eq-term-bright-cyan"),
    brightWhite: v("--eq-term-bright-white"),
  };
}
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
  /** 경로 링크 클릭이 실패했을 때(실재하지 않는 경로) — 마운트 중인 페인이 힌트 표시를 꽂는다 */
  onRevealFail?: () => void;
}

const REGISTRY = new Map<string, TermEntry>();

// 화면 손상 진단 (임시) — 살아 있는 터미널·열린 렌더러 수. 진단이 이 파일을 import하면
// 순환이 되므로 방향을 뒤집어 여기서 꽂는다. WebGL 컨텍스트는 열린 터미널당 하나다.
provideTerminalStats(() => ({
  terminals: REGISTRY.size,
  opened: [...REGISTRY.values()].filter((e) => e.opened).length,
}));

// 색 팔레트 교체 (설정 · 화면) — 살아 있는 터미널은 컴포넌트 밖 REGISTRY에 있어 반응성이 닿지 않는다.
// settings.applyTheme가 토큰을 세운 뒤 이 이벤트를 쏘면 전 터미널이 새 ANSI 팔레트를 다시 읽는다.
if (typeof window !== "undefined") {
  window.addEventListener("eq-tokens-changed", () => {
    const theme = readTermTheme();
    for (const e of REGISTRY.values()) e.term.options.theme = theme;
  });
}

/** 재스폰 중인 세션 (브랜치 부여 · 에이전트 기동) — kill과 spawn 사이의 짧은 dead 구간을
 *  화면이 진짜 종료로 오해하지 않게 한다. 재스폰이 끝나거나 실패하면 반드시 비운다. */
const [respawning, setRespawning] = createSignal<string[]>([]);
export const isRespawning = (id: string) => respawning().includes(id);
const doneRespawning = (id: string) => setRespawning((v) => v.filter((x) => x !== id));

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

/** 키보드 포커스를 이 세션 터미널로 (Focus) — 선택 전이에 붙은 이펙트로는 모자란 자리가 쓴다.
 *  이미 선택돼 있는 세션을 다시 잡을 때(대기 배지 클릭)는 selectedSession이 안 바뀌어
 *  그 이펙트가 다시 돌지 않는다. 여기서 답을 쳐야 하므로 포커스는 확실해야 한다. */
export function focusSessionTerminal(id: string): void {
  REGISTRY.get(id)?.term.focus();
}

/** 세션의 현재 터미널 크기 — 재개/재시작 커맨드가 PTY 크기를 맞추는 데 쓴다 */
export function sessionTermSize(id: string): { cols: number; rows: number } {
  const e = REGISTRY.get(id);
  return e ? { cols: e.term.cols, rows: e.term.rows } : { cols: 120, rows: 30 };
}

/** 살아 있는 PTY를 끝내고 종료 수신까지 기다린다 — 같은 세션 id로 다시 스폰하기 위한 전제.
 *  Rust의 spawn_pty_session은 같은 id가 이미 살아 있으면 재부착만 하고 새로 띄우지 않으므로,
 *  먼저 끝내지 않으면 재스폰이 조용한 no-op이 된다. pty-exit(→ dead 전이)가 새 스폰 뒤에
 *  늦게 도착해 산 세션을 dead로 덮지 않게, 종료를 받은 뒤 다음 단계로 넘어간다. */
async function killAndWait(id: string): Promise<void> {
  if (backend.listSessions().find((x) => x.id === id)?.status === "dead") return;
  // 아래 kill과 뒤따르는 spawn 사이에는 status가 잠깐 dead다 — 그 창에서 페인이
  // "종료된 슬롯" 화면으로 튀지 않도록 재스폰 중임을 표시해 둔다 (isRespawning)
  setRespawning((v) => (v.includes(id) ? v : [...v, id]));
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

/** 브랜치 부여 (워크트리 이동) — 기존 셸 PTY를 끝내고 같은 세션 id로 새 cwd에서 다시 연다.
 *  출력·종료 구독은 세션 id 키라 재스폰 후에도 그대로 이어진다. */
export async function respawnSessionShell(id: string, cwd: string, wsId?: string, shell?: string): Promise<void> {
  if (!isTauri()) return;
  const e = REGISTRY.get(id); // 페인 미마운트 세션도 이동은 된다 — 크기만 기본값 폴백
  await killAndWait(id);
  e?.term.writeln(`\x1b[90m─── 브랜치 부여 → ${cwd} ───\x1b[0m`);
  const size = sessionTermSize(id); // 재개/재시작과 같은 크기 규약 — 미마운트면 기본값 폴백
  try {
    await spawnPty(id, cwd, size.cols, size.rows, wsId, shell);
  } finally {
    doneRespawning(id);
  }
  if (e) {
    e.lastCols = e.term.cols;
    e.lastRows = e.term.rows;
    e.term.focus();
  }
}

/** 에이전트 기동 (FR-D-01·04·05) — 명시 액션 전용이라 "자동 실행 없음"(FR-C-33)은 그대로다.
 *
 *  셸 우선 모델이라 페인에는 맨 셸이 떠 있다. 그 셸에 사용자가 손으로 `claude`를 치면 EQMUX가
 *  붙이는 것이 하나도 실리지 않는다 — 환경변수(EQMUX_SESSION·ROLE_FILE·TOKEN), 훅 설정
 *  (--settings), 역할 포인터(--append-system-prompt), 세션 UUID(--session-id). 그래서 역할 주입도
 *  메시지 버스(eqmux send/report)도 재개도 전부 죽는다. 관리되는 에이전트는 이 경로로만 뜬다. */
export async function launchAgentInSession(
  id: string,
  wsId: string,
  cwd: string,
  name: string,
  permissions: Permissions,
): Promise<void> {
  if (!isTauri()) return;
  const e = REGISTRY.get(id);
  await killAndWait(id); // 셸이 살아 있으면 Rust가 재부착만 한다 — 반드시 먼저 끝낸다
  const size = sessionTermSize(id);
  try {
    await spawnAgent(id, wsId, cwd, name, permissions, size.cols, size.rows);
  } finally {
    doneRespawning(id);
  }
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
// 제거 경로는 여러 곳(캐스팅 적용·워크스페이스 등록 해제·수동 제거)이지만 전부 forgetAgent를
// 지난다 — 폐기를 그 한 자리에 걸어 호출부마다 빠뜨릴 여지를 없앤다 (B44)
setTerminalDisposer(disposeSessionTerminal);

// ── 클립보드 — 네이티브(arboard) 경로. WebView2의 웹 Clipboard API는 권한 문제로 조용히 실패한다 ──

/** 붙여넣기 — 클립보드에 이미지가 있으면 파일로 저장해 경로를 삽입, 아니면 텍스트 */
async function pasteFromClipboard(sessionId: string, term: Terminal): Promise<void> {
  const imgPath = await clipSaveImage();
  if (imgPath) {
    writePty(sessionId, `"${imgPath}" `);
    return;
  }
  const text = await clipReadText();
  if (!text) return;
  // 브래킷 붙여넣기(DECSET 2004)를 켠 TUI는 개행을 실행으로 바꾸지 않는다 — 그대로 넘긴다.
  // 맨 셸(pwsh·cmd)은 켜지 않으므로 xterm이 개행을 CR로 바꿔 붙는 즉시 실행된다 (B45):
  // 마지막 개행은 떼어 마지막 줄은 사용자가 Enter를 치게 하고, 그러고도 줄이 남으면 확인을 받는다.
  if (term.modes.bracketedPasteMode) {
    term.paste(text);
    return;
  }
  const body = text.replace(/\r?\n$/, "");
  if (/\r?\n/.test(body)) {
    setPasteAsk({ id: sessionId, text: body });
    return;
  }
  term.paste(body);
}

/** 여러 줄 붙여넣기 확인 (B45) — 세션별 1건. 페인이 카드로 그린다 */
const [pasteAsk, setPasteAsk] = createSignal<{ id: string; text: string } | undefined>(undefined);

function copySelection(term: Terminal): void {
  if (term.hasSelection()) clipWriteText(term.getSelection());
}

// ── 경로 더블클릭 → 탐색기 (M30) ────────────────────────────────────────
// 화면의 경로를 손으로 긁어 탐색기 주소창에 붙여 넣는 왕복을 없앤다.
// "실재하는 경로인가"는 Rust가 판정하고(reveal_path), 여기서는 "어디부터 어디까지가
// 경로인가"만 집는다. 더블클릭은 낱말 선택 제스처이기도 하므로, 아무 낱말에나 창이
// 뜨지 않도록 구분자가 없는 덩어리는 애초에 후보로 올리지 않는다.

/** 경로에 올 수 없는 글자 = 확실한 경계. 공백은 경로 안에 올 수 있으니 경계가 아니다 */
const PATH_BREAK = /["'`<>|*?\t]/;

/** 더블클릭한 셀이 놓인 논리 줄과 그 안의 문자 인덱스.
 *  줄바꿈으로 이어진 행(wrapped)은 한 줄로 잇는다 — 긴 경로는 행 끝에서 잘려 이어진다.
 *  전각 문자는 2칸을 쓰면서 1글자라 열 번호와 문자열 인덱스가 어긋난다 — 셀을 훑어 맞춘다. */
function logicalLineAt(term: Terminal, cellY: number, cellX: number): { line: string; index: number } | undefined {
  const buf = term.buffer.active;
  let top = cellY;
  while (top > 0 && buf.getLine(top)?.isWrapped) top--;
  let line = "";
  let index = -1;
  const cell = buf.getNullCell(); // 셀마다 새 객체를 만들지 않도록 한 개를 돌려 쓴다 (xterm 권장)
  for (let y = top; y < buf.length; y++) {
    const row = buf.getLine(y);
    if (!row || (y > top && !row.isWrapped)) break;
    for (let x = 0; x < term.cols; x++) {
      if (!row.getCell(x, cell)) break;
      const trailing = cell.getWidth() === 0; // 전각 문자의 뒤 칸 — 글자는 앞 칸이 이미 담았다
      if (y === cellY && x === cellX) index = trailing ? Math.max(0, line.length - 1) : line.length;
      if (!trailing) line += cell.getChars() || " ";
    }
  }
  return index < 0 ? undefined : { line, index };
}

/** 줄 안에서 index를 품은 경로 후보. 뒤에 딸려온 군더더기는 Rust가 실재 확인으로 떼어 내므로
 *  여기서는 넉넉히 집는다. 절대 경로는 클릭 앞의 드라이브 문자·UNC까지 되짚어 시작을 잡는다
 *  (경로 안 공백을 낱말 경계로 자르면 "Program Files"가 통째로 날아간다). */
function pathChunkAt(line: string, index: number): string | undefined {
  const ch = line[index];
  if (!ch || ch === " " || PATH_BREAK.test(ch)) return undefined;
  let s = index;
  while (s > 0 && !PATH_BREAK.test(line[s - 1])) s--;
  let e = index;
  while (e + 1 < line.length && !PATH_BREAK.test(line[e + 1])) e++;
  const span = line.slice(s, e + 1);
  const at = index - s;
  let begin = -1;
  const abs = /[A-Za-z]:[\\/]|\\\\[^\\/\s]/g;
  for (let m = abs.exec(span); m; m = abs.exec(span)) {
    if (m.index > at) break;
    begin = m.index;
  }
  let chunk: string;
  if (begin >= 0) {
    chunk = span.slice(begin);
  } else {
    // 상대 경로 — 공백으로 끊은 낱말 하나 (cwd 기준 해석은 Rust가 한다)
    let ws = at;
    while (ws > 0 && span[ws - 1] !== " ") ws--;
    let we = at;
    while (we + 1 < span.length && span[we + 1] !== " ") we++;
    chunk = span.slice(ws, we + 1);
  }
  chunk = chunk.trimEnd();
  return /[\\/]/.test(chunk) ? chunk : undefined;
}

/** 선택(더블클릭 직후 = xterm이 고른 낱말)에서 경로를 뽑아 탐색기에서 연다.
 *  손으로 그은 선택이 이미 경로 모양이면 그 경계를 먼저 믿고, 아니면 줄에서 집어 온 덩어리를 쓴다. */
async function revealFromTerminal(term: Terminal, cwd: string): Promise<boolean> {
  const sel = term.getSelection().trim();
  const range = term.getSelectionPosition();
  const at = range ? logicalLineAt(term, range.start.y, range.start.x) : undefined;
  const chunk = at ? pathChunkAt(at.line, at.index) : undefined;
  const tries = [/[\\/]/.test(sel) ? sel : undefined, chunk].filter((c): c is string => !!c);
  for (const cand of new Set(tries)) {
    if (await revealPath(cand, cwd)) return true;
  }
  return false;
}

// ── 경로 클릭 → 탐색기 — 절대 경로를 URL처럼 링크로 만든다 ─────────────────
// 붙여넣은 이미지 경로(`"%TEMP%\eqmux-pastes\*.png"`)처럼 화면에 찍힌 절대 경로는
// 호버하면 밑줄이 생기고 클릭하면 탐색기가 뜬다 (URL 링크와 같은 제스처).
// 감지는 모양만 본다 — 실재 여부는 클릭 시점에 Rust(reveal_path)가 판정하고,
// 없으면 페인이 힌트로 알린다. 상대 경로는 cwd 해석이 필요해 더블클릭 제스처가 담당한다.

/** 절대 경로 후보 — 따옴표로 감싼 것(공백 포함 가능)과 맨몸(공백에서 끊김). 드라이브 문자·UNC. */
const PATH_LINK = /"((?:[A-Za-z]:[\\/]|\\\\)[^"]+)"|(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>|*?]+/g;

/** 화면 행(y)이 속한 논리 줄의 텍스트와, 문자열 인덱스 → 셀 좌표 매핑.
 *  전각 문자는 2칸(w=2)이고, 자소 군집은 한 셀에 여러 코드 유닛이 담기므로
 *  코드 유닛마다 셀 항목을 넣어 인덱스가 어긋나지 않게 한다. */
function lineWithCells(
  term: Terminal,
  y: number,
): { text: string; cells: { x: number; y: number; w: number }[] } | undefined {
  const buf = term.buffer.active;
  let top = y;
  while (top > 0 && buf.getLine(top)?.isWrapped) top--;
  let text = "";
  const cells: { x: number; y: number; w: number }[] = [];
  const cell = buf.getNullCell(); // 셀마다 새 객체를 만들지 않도록 한 개를 돌려 쓴다 (xterm 권장)
  for (let row = top; row < buf.length; row++) {
    const line = buf.getLine(row);
    if (!line || (row > top && !line.isWrapped)) break;
    for (let x = 0; x < term.cols; x++) {
      if (!line.getCell(x, cell)) break;
      const w = cell.getWidth();
      if (w === 0) continue; // 전각 문자의 뒤 칸 — 글자는 앞 칸이 이미 담았다
      const chars = cell.getChars() || " ";
      text += chars;
      for (let i = 0; i < chars.length; i++) cells.push({ x, y: row, w });
    }
  }
  return cells.length > 0 ? { text, cells } : undefined;
}

/** 논리 줄에서 절대 경로를 찾아 링크로 돌려준다. 따옴표는 링크 범위에서 뺀다 —
 *  클릭이 넘기는 텍스트가 곧 경로가 되게. 뒤에 딸린 문장부호는 Rust가 실재 확인으로 떼어 낸다. */
function pathLinkProvider(term: Terminal, entry: TermEntry): ILinkProvider {
  return {
    provideLinks(lineNo: number, cb: (links: ILink[] | undefined) => void) {
      const info = lineWithCells(term, lineNo - 1); // xterm의 줄 번호는 1부터
      if (!info) return cb(undefined);
      const links: ILink[] = [];
      PATH_LINK.lastIndex = 0;
      for (let m = PATH_LINK.exec(info.text); m; m = PATH_LINK.exec(info.text)) {
        const text = m[1] ?? m[0];
        const begin = m[1] ? m.index + 1 : m.index;
        const s = info.cells[begin];
        const e = info.cells[begin + text.length - 1];
        if (!s || !e) continue;
        links.push({
          text,
          range: { start: { x: s.x + 1, y: s.y + 1 }, end: { x: e.x + e.w, y: e.y + 1 } },
          activate: () => {
            void revealPath(text).then((ok) => {
              if (!ok) entry.onRevealFail?.();
            });
          },
        });
      }
      cb(links.length > 0 ? links : undefined);
    },
  };
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

/** 뷰포트가 맨 아래에 붙어 있는가 — 크기 변화·재부착에서 읽던 자리를 지킬지 판단한다 (B46) */
function atBottom(term: Terminal): boolean {
  const b = term.buffer.active;
  return b.viewportY >= b.baseY;
}

function createEntry(): TermEntry {
  const term = new Terminal({
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: 12,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000, // FR-C-10 — 인메모리 링버퍼, 초과분은 스토어가 갖고 있다
    // 유니코드 애드온이 쓰는 term.unicode는 xterm의 proposed API다 — 이 플래그가 없으면
    // loadAddon이 던지고, 그 예외가 페인 생성 전체를 무너뜨린다 (터미널도 스폰도 없다).
    allowProposedApi: true,
    theme: readTermTheme(),
  });
  // 문자 폭 (유니코드 15 + 자소 군집) — 반드시 첫 write 전에. 폭은 파싱 시점에 버퍼에 박힌다.
  // xterm 기본은 유니코드 6 테이블이라 ✅(U+2705)·⚙️(VS16) 같은 이모지를 1칸으로 센다.
  // 에이전트 CLI는 string-width(유니코드 9+)를 써서 2칸으로 패딩하므로, 그 차이만큼
  // 셀이 밀리고 Ink의 차등 재그리기가 어긋난 자리에 덮어써 글자가 중복된다 (표가 깨져 보인다).
  // 폭 교정은 가독성 문제고 터미널 자체는 이것 없이도 성립한다 — 실패해도 페인은 살린다.
  try {
    term.loadAddon(new UnicodeGraphemesAddon()); // activeVersion = "15-graphemes"로 스스로 전환한다
  } catch {
    /* 유니코드 테이블은 xterm 기본값(6)으로 남는다 — 이모지 폭만 어긋난다 */
  }
  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  // 링크 감지 (PRD A, M30) — URL 클릭은 기본 브라우저로 보낸다 (브라우저 패널은 localhost 전용)
  term.loadAddon(new WebLinksAddon((_ev, uri) => openExternal(uri)));
  const entry: TermEntry = { term, fit, search, opened: false, initialized: false, lastCols: 0, lastRows: 0 };
  // 경로 클릭 → 탐색기 — 브라우저 dev에서는 탐색기를 열 수단이 없으므로 링크로 만들지 않는다
  if (isTauri()) term.registerLinkProvider(pathLinkProvider(term, entry));
  return entry;
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
  //
  // 가로챈 키는 false만 돌려서는 끝이 아니다. xterm은 손을 뗄 뿐 브라우저 기본 동작은 막지 않아서,
  // Ctrl+V는 그대로 paste 이벤트를 낳고 xterm이 textarea·컨테이너에 걸어 둔 paste 리스너가
  // 같은 글을 한 번 더 PTY로 흘려보낸다 — 붙여넣기가 2번 되는 원인. 그래서 우리가 처리한 키는
  // 기본 동작까지 같이 끊는다.
  const handled = (ev: KeyboardEvent) => {
    ev.preventDefault(); // 브라우저 기본 복사·붙여넣기 차단 — 중복 입력 방지
    return false; // xterm은 이 키를 처리하지 않는다
  };
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === "keydown" && ev.ctrlKey) {
      const k = ev.key.toLowerCase();
      if (ev.shiftKey && k === "c") {
        copySelection(term);
        return handled(ev);
      }
      if (k === "c" && !ev.shiftKey && !ev.altKey && term.hasSelection()) {
        copySelection(term);
        term.clearSelection();
        return handled(ev);
      }
      if (k === "v" && (ev.shiftKey || isTauri())) {
        void pasteFromClipboard(props.sessionId, term);
        return handled(ev);
      }
      // 터미널 내 검색 (M30) — TUI로 Ctrl+F를 흘리지 않고 검색 바를 연다.
      // 토글이다 (B48) — 열린 상태에서 또 누르면 닫힌다. 아니면 포커스가 터미널로 간 뒤
      // 그 키가 삼켜지기만 해 키보드로는 빠져나갈 길이 없어진다.
      if (k === "f" && !ev.shiftKey && !ev.altKey) {
        setSearchSession(searchSession() === props.sessionId ? undefined : props.sessionId);
        return handled(ev);
      }
    }
    // 검색 바가 열려 있을 때의 ESC는 바를 닫는다 (B48) — 그 조건에서만 PTY로 흘리지 않는다
    if (ev.type === "keydown" && ev.key === "Escape" && searchSession() === props.sessionId) {
      setSearchSession(undefined);
      return handled(ev);
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

  // ── 경로 더블클릭·링크 클릭 → 탐색기 (M30) — 실재하는 경로일 때만 창이 뜬다 ──
  const [hint, setHint] = createSignal<string | undefined>(undefined);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const showRevealFail = () => {
    setHint(t("탐색기에서 열 수 없습니다 — 실재하는 경로가 아닙니다"));
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setHint(undefined), 2600);
  };
  const revealSelection = async (loud: boolean) => {
    const e = REGISTRY.get(props.sessionId);
    if (!e) return;
    const ok = await revealFromTerminal(e.term, props.cwd);
    // 더블클릭은 낱말 선택 제스처이기도 하다 — 빗나간 더블클릭까지 알림으로 되받지 않는다.
    // 메뉴로 명시해 부른 경우(loud)에만 왜 안 열렸는지 말한다.
    if (!ok && loud) showRevealFail();
  };

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
    // 경로 링크 클릭 실패(실재하지 않는 경로) — 밑줄 있는 링크가 소리 없이 무시되면 고장처럼 보인다
    e.onRevealFail = showRevealFail;
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

    // 경로 더블클릭 → 탐색기 — xterm의 낱말 선택은 그대로 두고 그 위에 얹는다
    const onDblClick = () => void revealSelection(false);
    host.addEventListener("dblclick", onDblClick);

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
        const wasAtBottom = atBottom(e.term); // refresh 전에 잰다 (B46)
        try {
          e.term.refresh(0, Math.max(0, e.term.rows - 1));
        } catch {
          /* 렌더러 미준비 시 무시 */
        }
        if (wasAtBottom) e.term.scrollToBottom();
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
          // 유실은 조용히 DOM 렌더러로 강등된다 — 몇 번, 어느 세션에서 일어나는지 남긴다.
          // 브라우저는 컨텍스트 수가 한계를 넘으면 가장 오래된 것부터 강제로 잃게 만든다
          webgl.onContextLoss(() => {
            noteWebglContextLoss(props.sessionId);
            webgl.dispose();
          });
          e.term.loadAddon(webgl);
        } catch {
          /* WebGL 미지원 환경 — 기본 렌더러 사용 */
        }
      } else if (e.term.element && e.term.element.parentElement !== host) {
        host.appendChild(e.term.element); // 리마운트 = DOM 재부착만
      }
      const wasAtBottom = atBottom(e.term); // 재부착도 읽던 자리를 지킨다 (B46)
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
      if (wasAtBottom) e.term.scrollToBottom();
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
      if (e.onRevealFail === showRevealFail) e.onRevealFail = undefined;
      scrollDisp?.dispose();
      clearTimeout(resizeTimer);
      clearTimeout(settleTimer);
      ro.disconnect();
      window.removeEventListener("resize", queueSync);
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("mousedown", closeMenu);
      clearTimeout(hintTimer);
      // 검색 바 상태는 모듈 전역이라 언마운트해도 남는다 — 트랜스크립트 탭에 갔다 오면 검색어만
      // 빈 유령 바가 되살아나 마운트 즉시 키보드 포커스를 가져간다 (B48). 붙여넣기 확인도 같다.
      if (searchSession() === props.sessionId) setSearchSession(undefined);
      if (pasteAsk()?.id === props.sessionId) setPasteAsk(undefined);
      // 터미널은 dispose하지 않는다 — REGISTRY가 세션 수명 동안 유지한다
    });
  });

  /** 대체 화면(TUI)인가 — 그 위에서 clear를 부르면 화면이 어긋난 채 굳는다 (B47) */
  const altBuffer = () => REGISTRY.get(props.sessionId)?.term.buffer.active.type === "alternate";
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
              placeholder={t("터미널 검색")}
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
            <button class="btn ghost" title={t("이전 일치 (Shift+Enter)")} onClick={findPrev}>
              ↑
            </button>
            <button class="btn ghost" title={t("다음 일치 (Enter)")} onClick={() => findNext()}>
              ↓
            </button>
            <button class="btn ghost" title={t("닫기 (ESC)")} onClick={closeSearch}>
              ✕
            </button>
          </div>
        </Show>
        {/* 여러 줄 붙여넣기 확인 (B45) — 맨 셸에서는 붙는 즉시 줄마다 실행된다 */}
        <Show when={pasteAsk()?.id === props.sessionId}>
          <div class="card term-search mono" onMouseDown={(ev) => ev.stopPropagation()}>
            <span>
              {tf("{n}줄을 붙여넣어 실행합니다", { n: String(pasteAsk()!.text.split(/\r?\n/).length) })}
            </span>
            <button
              class="btn"
              onClick={() => {
                const ask = pasteAsk();
                setPasteAsk(undefined);
                const e = ask && REGISTRY.get(ask.id);
                if (e && ask) {
                  e.term.paste(ask.text);
                  e.term.focus();
                }
              }}
            >
              {t("붙여넣기")}
            </button>
            <button class="btn ghost" onClick={() => setPasteAsk(undefined)}>
              {t("취소")}
            </button>
          </div>
        </Show>
        <Show when={hint()}>
          <div class="card term-hint mono">{hint()}</div>
        </Show>
        <Show when={isTauri() && atTop() && !history()}>
          <button class="btn term-history-chip" onClick={() => void openHistory()}>
            {t("▲ 디스크 기록 보기 — 링버퍼 위 기록 (FR-C-13)")}
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
                    fallback={<span class="st-dead">{t("재개 불가")} — {t(r().reason ?? "트랜스크립트 없음")}</span>}
                  >
                    <span class="st-busy">{t("이전 에이전트 세션 발견 — 재개 대기")}</span>
                  </Show>
                </div>
                <div class="muted" style={{ "font-size": "10px" }}>
                  {r().resumable
                    ? t("같은 대화를 --resume으로 이어갑니다. 자동 실행하지 않습니다 (C5).")
                    : t("이전 대화를 이어갈 수 없습니다 — 새 대화 또는 셸로 시작하세요.")}
                </div>
                <div class="pane-restore-actions">
                  <Show when={r().resumable}>
                    <button class="btn primary" onClick={() => void restoreAction("resume")}>
                      {t("▶ 이전 대화 재개")}
                    </button>
                  </Show>
                  <button class="btn" classList={{ primary: !r().resumable }} onClick={() => void restoreAction("fresh")}>
                    {t("새 대화 시작")}
                  </button>
                  <button class="btn ghost" onClick={() => void restoreAction("shell")}>
                    {t("셸로 시작")}
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
                <span class="eyebrow">{tf("디스크 스크롤백 · {n}줄 로드됨", { n: h().length })}</span>
                <button
                  class="btn ghost"
                  style={{ "margin-left": "auto", padding: "1px 6px" }}
                  onClick={() => setHistory(null)}
                >
                  ✕
                </button>
              </div>
              <button class="btn ghost" style={{ padding: "2px" }} onClick={() => void loadOlderHistory()}>
                {t("▲ 더 이전 200줄")}
              </button>
              <div class="mono term-history-lines" ref={historyEl}>
                <For each={h()}>{(l) => <div>{l.text}</div>}</For>
                <Show when={h().length === 0}>
                  <div class="muted" style={{ padding: "8px" }}>
                    {t("디스크에 저장된 확정 줄이 없습니다")}
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
            header={props.agent ? `${props.agent.name} · ${t("터미널")}` : t("기본 터미널")}
            onClose={() => setMenu(undefined)}
            groups={[
              // 주 동작 — 편집
              [
                { label: t("복사"), kbd: "Ctrl+Shift+C", disabled: !m().hasSel, action: () => menuAction(copySelection) },
                { label: t("붙여넣기"), kbd: "Ctrl+Shift+V", action: () => menuAction((term) => void pasteFromClipboard(props.sessionId, term)) },
                { label: t("모두 선택"), action: () => menuAction((term) => term.selectAll()) },
                {
                  label: t("탐색기에서 열기"),
                  kbd: t("더블클릭"),
                  disabled: !m().hasSel,
                  action: () => menuAction(() => void revealSelection(true)),
                },
                { label: t("검색"), kbd: "Ctrl+F", action: () => menuAction(() => setSearchSession(props.sessionId)) },
                {
                  // 이름은 '화면'인데 실제로는 링버퍼 5,000줄을 통째로 버린다 — 이름을 사실에
                  // 맞추고 danger로 내린다. 대체 화면(TUI)에서는 커서 줄만 남기고 화면이
                  // 어긋난 채 굳으므로 아예 막는다 (B47)
                  label: altBuffer()
                    ? t("스크롤백까지 지우기 — 에이전트 화면(TUI)에서는 불가")
                    : t("스크롤백까지 지우기"),
                  danger: true,
                  disabled: altBuffer(),
                  action: () => menuAction((term) => term.clear()),
                },
              ],
              // 보기·이동·세션 — 소유 화면이 얹는다 (danger 항목은 컴포넌트가 마지막으로 모은다)
              ...(props.extraMenu?.() ?? []),
              [
                { label: t("이미지 붙여넣기 → 파일 저장 후 경로 삽입"), note: true },
                { label: t("경로 더블클릭 → 탐색기에서 열기 (실재하는 경로만)"), note: true },
              ],
            ]}
          />
        )}
      </Show>
    </>
  );
}
