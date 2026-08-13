// 비정상 종료 복구 브리지 (FR-C-35) — running.flag 표식이 남은 채 시작한 첫 실행에서만
// dirty=true. 목록은 각 워크스페이스 DB에서 exit 기록 없이 끝난 세션(크래시 시점 실행분)이다.
import { invoke } from "@tauri-apps/api/core";
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
