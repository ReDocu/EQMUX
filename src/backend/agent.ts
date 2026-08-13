// 에이전트 런타임 브리지 (PRD D) — agent_* 커맨드 + agent-state 이벤트 수신.
// 역할의 permissions → 실행 플래그 번역(§4.5.1)은 types.ts의 translatePermissions가 담당한다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { flushInboxOnState } from "./conversation";
import { backend } from "./mock";
import { isTauri } from "./pty";
import { saveRoleFile } from "./roles";
import { settings } from "./settings";
import { beepWaiting } from "./sound";
import type { AgentStatus, Permissions } from "../types";
import { translatePermissions } from "../types";

export interface AgentStateEvt {
  session: string;
  agentSession: string;
  status: string;
  waitingFor: string | null;
  activity: string | null; // 훅 2차 소스 (FR-D-15) — 현재 도구명
  subagents: number; // 동시 실행 서브에이전트 수 (FR-D-18)
  costUsd: number | null; // statusLine 누적 비용 (FR-D-19)
  resumable: boolean;
  version: string | null;
  exitCode: number | null;
  degraded: boolean; // 관측 저하 (FR-D-62·63, M34) — 낮은 신뢰 표시 (FR-G-27)
}

const STATUSES: AgentStatus[] = ["starting", "busy", "waiting", "shell", "idle", "dead"];

/** Rust 이벤트(null 표기) → 목 백엔드 반영 페이로드(undefined 표기) — 수신부 공용 변환 */
function applyEvt(p: AgentStateEvt): void {
  // waiting 사운드 (FR-G-34) — 진입 전이에만, 설정이 켜져 있을 때만 (기본 꺼짐, G6).
  // 음소거(FR-G-35) 대상이면 내지 않는다 — 세션 id 또는 소속 워크스페이스 id
  const prevSess = backend.listSessions().find((x) => x.id === p.session);
  const mutedList = settings().muted;
  const isMuted = mutedList.includes(p.session) || (prevSess && mutedList.includes(prevSess.workspaceId));
  if (p.status === "waiting" && prevSess?.status !== "waiting" && settings().waitingSound && !isMuted) {
    beepWaiting();
  }
  backend.applyAgentState({
    session: p.session,
    agentSession: p.agentSession,
    status: STATUSES.includes(p.status as AgentStatus) ? (p.status as AgentStatus) : undefined,
    waitingFor: p.waitingFor ?? undefined,
    activity: p.activity ?? undefined,
    subagents: p.subagents,
    costUsd: p.costUsd ?? undefined,
    resumable: p.resumable,
    version: p.version ?? undefined,
    exitCode: p.exitCode ?? undefined,
    degraded: p.degraded,
  });
}

let ready: Promise<void> | undefined;

/** agent-state 이벤트 → 목 백엔드 세션 갱신 → 전 화면(대시보드·셀·뱃지) 자동 반영 */
export function ensureAgentListeners(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (!ready) {
    ready = listen<AgentStateEvt>("agent-state", (e) => {
      applyEvt(e.payload);
      // 인박스 전달 (M3) — idle 전이가 곧 턴 종료 신호다
      flushInboxOnState(e.payload.session, e.payload.status);
    }).then(() => {});
  }
  return ready;
}

/** 웹뷰 재시작 복구 (FR-C-06) — 살아 있는 PTY의 에이전트 상태 스냅숏을 끌어와
 *  목 백엔드에 반영한다. 스트림(agent-state)은 다음 변화부터만 오므로 초기값이 필요하다. */
export async function applyAgentSnapshot(): Promise<void> {
  if (!isTauri()) return;
  const states = await invoke<AgentStateEvt[]>("agent_snapshot").catch(() => [] as AgentStateEvt[]);
  for (const p of states) applyEvt(p);
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
