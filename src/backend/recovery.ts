// 비정상 종료 복구 브리지 (FR-C-35) — running.flag 표식이 남은 채 시작한 첫 실행에서만
// dirty=true. 목록은 각 워크스페이스 DB에서 exit 기록 없이 끝난 세션(크래시 시점 실행분)이다.
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { isTauri } from "./pty";

export interface CrashSession {
  workspace: string;
  id: string;
  cwd: string;
  shell: string | null;
  lastOutputAt: number | null;
  resumable: boolean;
}

export interface CrashReport {
  dirty: boolean;
  sessions: CrashSession[];
}

export async function crashRecovery(): Promise<CrashReport | undefined> {
  if (!isTauri()) return undefined;
  return invoke<CrashReport>("crash_recovery").catch(() => undefined);
}

/** 보일 것이 있는 보고만 — 직전 실행이 크래시였고 그때 돌던 세션이 있을 때 */
export const worthShowing = (r: CrashReport | undefined): r is CrashReport => !!r?.dirty && r.sessions.length > 0;

/** 이번 실행의 복구 보고 (U63) — Rust 값은 첫 조회에 소비되므로 프런트가 들고 있다. 창을 닫아도
 *  남아서 알림 센터에서 다시 연다 (닫으면 '어떤 세션이 재개 가능했는지'가 사라지던 자리) */
export const [crashReport, setCrashReport] = createSignal<CrashReport | undefined>(undefined);
export const [crashOpen, setCrashOpen] = createSignal(false);

export async function loadCrashRecovery(): Promise<void> {
  const r = await crashRecovery();
  if (!worthShowing(r)) return;
  setCrashReport(r);
  setCrashOpen(true);
}
