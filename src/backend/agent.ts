// 에이전트 런타임 브리지 (PRD D) — agent_* 커맨드 + agent-state 이벤트 수신.
// 역할의 permissions → 실행 플래그 번역(§4.5.1)은 types.ts의 translatePermissions가 담당한다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { backend } from "./mock";
import { isTauri } from "./pty";
import { saveRoleFile } from "./roles";
import type { AgentStatus, Permissions } from "../types";
import { translatePermissions } from "../types";

export interface AgentStateEvt {
  session: string;
  agentSession: string;
  status: string;
  waitingFor: string | null;
  resumable: boolean;
  version: string | null;
  exitCode: number | null;
}

const STATUSES: AgentStatus[] = ["starting", "busy", "waiting", "shell", "idle", "dead"];

let ready: Promise<void> | undefined;

/** agent-state 이벤트 → 목 백엔드 세션 갱신 → 전 화면(대시보드·셀·뱃지) 자동 반영 */
export function ensureAgentListeners(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (!ready) {
    ready = listen<AgentStateEvt>("agent-state", (e) => {
      const p = e.payload;
      backend.applyAgentState({
        session: p.session,
        agentSession: p.agentSession,
        status: STATUSES.includes(p.status as AgentStatus) ? (p.status as AgentStatus) : undefined,
        waitingFor: p.waitingFor ?? undefined,
        resumable: p.resumable,
        version: p.version ?? undefined,
        exitCode: p.exitCode ?? undefined,
      });
    }).then(() => {});
  }
  return ready;
}

/** 에이전트 기동 (FR-D-01·02·40) — UUID는 Rust가 발급하고 반환한다.
 *  스폰 전에 역할 파일을 합성해 (FR-E-31) 주입(FR-D-05)이 항상 성립하게 한다. */
export async function spawnAgent(
  sessionId: string,
  wsId: string,
  cwd: string,
  name: string,
  permissions: Permissions,
  cols: number,
  rows: number,
): Promise<string> {
  await ensureAgentListeners();
  await saveRoleFile(sessionId);
  const f = translatePermissions(permissions);
  return invoke<string>("agent_spawn", {
    id: sessionId,
    workspace: wsId,
    cwd,
    name,
    permissionMode: f.permissionMode,
    disallowedTools: f.disallowedTools,
    cols,
    rows,
  });
}

/** 재개 (FR-D-21~23) — 사용자 트리거 전용. 앱 재시작 후엔 스토어 매핑으로 복원된다. */
export async function resumeAgent(
  sessionId: string,
  wsId: string,
  cwd: string,
  name: string,
  permissions: Permissions,
  cols: number,
  rows: number,
): Promise<string> {
  await saveRoleFile(sessionId); // 복원 세션도 최신 편성으로 합성한 뒤 재개한다
  const f = translatePermissions(permissions);
  return invoke<string>("agent_resume", {
    id: sessionId,
    workspace: wsId,
    cwd,
    name,
    permissionMode: f.permissionMode,
    disallowedTools: f.disallowedTools,
    cols,
    rows,
  });
}

/** 권한 변경 재시작 (E11′ · FR-D-26) — 재개 기반, 대화 유지 */
export async function restartAgent(
  sessionId: string,
  permissions: Permissions,
  cols: number,
  rows: number,
): Promise<string> {
  await saveRoleFile(sessionId); // 바뀐 permissions가 frontmatter에 실려야 한다 (FR-E-46)
  const f = translatePermissions(permissions);
  return invoke<string>("agent_restart", {
    id: sessionId,
    permissionMode: f.permissionMode,
    disallowedTools: f.disallowedTools,
    cols,
    rows,
  });
}
