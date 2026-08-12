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
        const buf = (buffers.get(id) ?? "") + data;
        buffers.set(id, buf.length > BUFFER_CAP ? buf.slice(-BUFFER_CAP) : buf);
        outputSubs.get(id)?.forEach((cb) => cb(data));
      });
      await listen<PtyExit>("pty-exit", (e) => {
        spawned.delete(e.payload.id);
        exitSubs.get(e.payload.id)?.forEach((cb) => cb(e.payload.code));
      });
    })();
  }
  return listenerReady;
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

/** 재시작 복구 (FR-C-31) — 스토어에서 세션의 마지막 N줄 */
export async function scrollbackTail(workspace: string, session: string, count: number): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("scrollback_tail", { workspace, session, count }).catch(() => []);
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

/** 세션 로그 폴더 (~/.eqmux/logs) — 1차 파일 로그. Tauri 밖에서는 빈 문자열. */
export async function sessionLogDir(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("session_log_dir").catch(() => "");
}

export function openLogDir(): void {
  if (!isTauri()) return;
  void invoke("open_log_dir").catch(() => {});
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
