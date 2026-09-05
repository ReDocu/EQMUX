// PTY 브리지 — Rust pty_* 커맨드의 프런트 소비 표면.
// Tauri 밖(순수 vite dev)에서는 모든 함수가 no-op이며, 화면은 목 폴백을 그린다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface PtyOutput {
  id: string;
  data: string;
}
interface PtyExit {
  id: string;
  code: number | null;
}

// 세션별 출력 버퍼 — 페인이 언마운트돼도 세션은 살아 있으므로(B1 줌·탭 전환)
// 재부착 시 스크롤백을 복원한다. 실제 저장은 M1 후반 rusqlite WAL로 이동한다.
const BUFFER_CAP = 200_000;
const buffers = new Map<string, string>();
const outputSubs = new Map<string, Set<(data: string) => void>>();
const exitSubs = new Map<string, Set<(code: number | null) => void>>();
const spawned = new Set<string>();
let listenerReady: Promise<void> | undefined;

function ensureListeners(): Promise<void> {
  if (!listenerReady) {
    listenerReady = (async () => {
      await listen<PtyOutput>("pty-output", (e) => {
        const { id, data } = e.payload;
        // 아는 세션만 버퍼링 — 제거된 세션의 늦은 출력이 buffers 항목을 되살려 누적되는 것 방지
        if (!spawned.has(id) && !outputSubs.get(id)?.size) return;
        const buf = (buffers.get(id) ?? "") + data;
        buffers.set(id, buf.length > BUFFER_CAP ? buf.slice(-BUFFER_CAP) : buf);
        outputSubs.get(id)?.forEach((cb) => cb(data));
      });
      await listen<PtyExit>("pty-exit", (e) => {
        spawned.delete(e.payload.id);
        exitHook?.(e.payload.id, e.payload.code);
        exitSubs.get(e.payload.id)?.forEach((cb) => cb(e.payload.code));
      });
    })();
  }
  return listenerReady;
}

/** 부트스트랩에서 반드시 1회 호출 — 전역 pty-output/exit 수신 등록.
 *  spawnPty 경로에서만 등록하면 에이전트 전용 실행(캐스팅만으로 시작)이나
 *  웹뷰 재시작 재부착(revive) 세션은 출력 이벤트를 아무도 구독하지 않아 빈 화면이 된다 */
export function ensurePtyListeners(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return ensureListeners();
}

let exitHook: ((id: string, code: number | null) => void) | undefined;

/** 전역 exit 훅 — 셸 세션의 dead 전이를 앱 상태에 반영한다 (에이전트는 agent-state가 관장) */
export function setPtyExitHook(cb: (id: string, code: number | null) => void): void {
  exitHook = cb;
}

export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  workspace?: string,
  shell?: string,
): Promise<void> {
  if (!isTauri()) return;
  await ensureListeners();
  await invoke("pty_spawn", {
    id,
    cwd,
    shell: shell ?? null,
    cols,
    rows,
    workspace: workspace ?? null,
  });
  spawned.add(id);
}

/** 재생 줄 (FR-C-31) — text는 평문(필터·중복 판정), styled는 SGR 색 보존본 (FR-C-15, 있을 때만) */
export interface TailLine {
  text: string;
  styled: string | null;
}

/** 재시작 복구 (FR-C-31) — 스토어에서 세션의 마지막 N줄 */
export async function scrollbackTail(workspace: string, session: string, count: number): Promise<TailLine[]> {
  if (!isTauri()) return [];
  return invoke<TailLine[]>("scrollback_tail", { workspace, session, count }).catch(() => []);
}

/** 살아 있는 PTY 세션 id 목록 (FR-C-06) — 웹뷰만 재시작했을 때 Rust 쪽 세션은 계속 돌고 있다 */
export async function listAlivePty(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("pty_list").catch(() => []);
}

export interface StoreUsageReal {
  db_file: string;
  db_size_bytes: number;
  total_lines: number;
  sessions: { id: string; lines: number; bytes: number }[];
}

/** 저장 사용량 실측 (FR-C-52) */
export async function storeUsageReal(workspace: string): Promise<StoreUsageReal | undefined> {
  if (!isTauri()) return undefined;
  return invoke<StoreUsageReal>("store_usage_real", { workspace }).catch(() => undefined);
}

export interface StorePurgeResult {
  lines: number;
  freedBytes: number;
}

/** 저장 기록 초기화 (FR-C-52 — 사용자 조작). 디스크의 스크롤백·검색 색인만 비운다 —
 *  화면에 떠 있는 링버퍼와 세션 메타·이벤트·대화는 그대로다. 실패는 그대로 던져 호출부가 보여 준다 */
export async function storePurgeScrollback(workspace: string): Promise<StorePurgeResult | undefined> {
  if (!isTauri()) return undefined;
  return invoke<StorePurgeResult>("store_purge_scrollback", { workspace });
}

// ── 사람의 미제출 입력 (B20) — 주입이 그 줄과 합쳐지지 않게 하는 근거 ──
// 터미널 onData(사람의 키 입력)만 여기로 온다. 주입은 writePty를 직접 부르므로 섞이지 않는다.
const typingSince = new Map<string, number>();
// ponytail: 미제출 여부를 프롬프트 버퍼가 아니라 키 입력으로 추정한다. 60초가 지나면 사람이
// 자리를 떴다고 보고 푼다 — 정확히 재려면 셸/TUI의 줄 편집 상태를 알아야 한다.
const TYPING_TTL_MS = 60_000;

/** 사람이 이 페인에 뭔가 쳤다 — Enter·Ctrl+C는 그 줄을 끝내므로 표식을 지운다 */
export function noteUserInput(id: string, data: string): void {
  if (data === "\r" || data === "\n" || data === "\x03" || data === "\x1b") typingSince.delete(id);
  else if (data) typingSince.set(id, Date.now());
}

/** 그 페인에 사람이 치다 만 입력이 남아 있는가 (B20) */
export function humanTyping(id: string): boolean {
  const t = typingSince.get(id);
  if (t === undefined) return false;
  if (Date.now() - t > TYPING_TTL_MS) {
    typingSince.delete(id);
    return false;
  }
  return true;
}

export function writePty(id: string, data: string): void {
  if (!isTauri()) return;
  void invoke("pty_write", { id, data }).catch(() => {});
}

/** 표시 전용 에코 (P-2) — PTY 입력을 거치지 않고 페인 화면·로컬 버퍼에만 쓴다.
 *  일반 셸에 키 입력으로 주입하면 뒤따르는 \r이 사용자가 치던 미제출 명령을 그대로
 *  실행하므로, 기본 터미널로 가는 메시지는 이 경로로만 표시한다. */
export function echoPty(id: string, data: string): void {
  const buf = (buffers.get(id) ?? "") + data;
  buffers.set(id, buf.length > BUFFER_CAP ? buf.slice(-BUFFER_CAP) : buf);
  outputSubs.get(id)?.forEach((cb) => cb(data));
}

/** 터미널 인스턴스 폐기 훅 — TerminalPane이 등록한다 (pty ← TerminalPane 순환 import 회피).
 *  화면 레이어를 모르는 mock이 제거 경로에서 이걸 부를 수 있게 하는 유일한 목적이다 (B44) */
let disposeTerm: ((id: string) => void) | undefined;
export function setTerminalDisposer(fn: (id: string) => void): void {
  disposeTerm = fn;
}

/** 세션 영구 제거 시 백엔드 잔류 상태 정리 (P-9) — 추적 맵·알림 게이트·IPC 토큰.
 *  killPty(중지)와 별개다 — 제거 경로에서만 부른다.
 *  터미널 인스턴스도 여기서 함께 폐기한다 (B44) — 남겨 두면 같은 세션 id로 슬롯이 다시 생겨도
 *  REGISTRY 항목의 initialized가 참이라 spawnPty가 영영 안 돌고, 죽은 세션의 마지막 화면이
 *  '실행 중'인 척 그대로 재부착된다. 세션 id는 `페르소나@워크스페이스` 결정적 관례라 반드시 충돌한다. */
export function forgetAgent(id: string): void {
  disposeTerm?.(id); // 브라우저 목에서도 화면 인스턴스는 폐기해야 한다 — isTauri 가드 앞에 둔다
  if (!isTauri()) return;
  void invoke("agent_forget", { id }).catch(() => {});
}

export function resizePty(id: string, cols: number, rows: number): void {
  if (!isTauri()) return;
  void invoke("pty_resize", { id, cols, rows }).catch(() => {});
}

export function killPty(id: string): void {
  if (!isTauri()) return;
  spawned.delete(id);
  buffers.delete(id);
  void invoke("pty_kill", { id }).catch(() => {});
}

export function getScrollback(id: string): string {
  return buffers.get(id) ?? "";
}

// ── 네이티브 클립보드 — WebView2 웹 Clipboard API 권한 문제를 우회한다 ──

export async function clipReadText(): Promise<string> {
  if (!isTauri()) return navigator.clipboard.readText().catch(() => "");
  return invoke<string>("clip_read_text").catch(() => "");
}

export function clipWriteText(text: string): void {
  if (!isTauri()) {
    void navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  void invoke("clip_write_text", { text }).catch(() => {});
}

/** 클립보드에 이미지가 있으면 %TEMP%\eqmux-pastes\*.png로 저장하고 경로를 준다. 없으면 null. */
export async function clipSaveImage(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("clip_save_image").catch(() => null);
}

/** 세션 로그 폴더 (~/.eqmux/logs) — 1차 파일 로그. Tauri 밖에서는 빈 문자열. */
export async function sessionLogDir(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("session_log_dir").catch(() => "");
}

export function openLogDir(): void {
  if (!isTauri()) return;
  void invoke("open_log_dir").catch(() => {});
}

/** 터미널 링크 클릭 → 기본 브라우저 (PRD A 링크 감지, M30). http/https만 Rust가 허용한다. */
export function openExternal(url: string): void {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  void invoke("open_external", { url }).catch(() => {});
}

/** 터미널 경로 더블클릭 → 탐색기에서 열기. 파일이면 그 파일이 선택된 채로, 폴더면 그 폴더가 열린다.
 *  상대 경로는 세션 cwd 기준으로 푼다. 실재하지 않으면 false — 더블클릭은 선택 제스처이기도 해서
 *  화면에 따라 조용히 넘길 자리가 있다. */
export async function revealPath(path: string, cwd?: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke("reveal_path", { path, cwd: cwd ?? null }).then(
    () => true,
    () => false,
  );
}

export function onPtyOutput(id: string, cb: (data: string) => void): () => void {
  if (!outputSubs.has(id)) outputSubs.set(id, new Set());
  outputSubs.get(id)!.add(cb);
  return () => outputSubs.get(id)?.delete(cb);
}

export function onPtyExit(id: string, cb: (code: number | null) => void): () => void {
  if (!exitSubs.has(id)) exitSubs.set(id, new Set());
  exitSubs.get(id)!.add(cb);
  return () => exitSubs.get(id)?.delete(cb);
}
