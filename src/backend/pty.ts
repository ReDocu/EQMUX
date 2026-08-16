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

/** 세션 영구 제거 시 백엔드 잔류 상태 정리 (P-9) — 추적 맵·알림 게이트·IPC 토큰.
 *  killPty(중지)와 별개다 — 제거 경로에서만 부른다. */
export function forgetAgent(id: string): void {
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
