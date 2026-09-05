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
import { flagsToString, translatePermissions } from "../types";

export interface AgentStateEvt {
  session: string;
  agentSession: string;
  status: string;
  waitingFor: string | null;
  sinceMs: number | null; // 이 상태로 들어간 시각 epoch ms (B19)
  activity: string | null; // 훅 2차 소스 (FR-D-15) — 현재 도구명
  subagents: number; // 동시 실행 서브에이전트 수 (FR-D-18)
  costUsd: number | null; // statusLine 누적 비용 (FR-D-19)
  resumable: boolean;
  version: string | null;
  exitCode: number | null;
  degraded: boolean; // 관측 저하 (FR-D-62·63, M34) — 낮은 신뢰 표시 (FR-G-27)
  seq?: number; // 순번 (P-4) — 전역 단조 증가. 스냅숏·이벤트 순서 역전 가드
}

const STATUSES: AgentStatus[] = ["starting", "busy", "waiting", "shell", "idle", "dead"];

// 순서 역전 가드 (P-4) — 스냅숏(agent_snapshot)과 실시간 이벤트(agent-state)가 겹치는
// 창(웹뷰 재시작 직후)에서 더 오래된 페이로드가 나중에 도착해 신선한 상태를 덮지 않게 한다
const lastSeq = new Map<string, number>();

/** 이 페이로드가 이미 지나간 순번인가 (P-4). 참이면 통째로 버린다.
 *  통과한 순번은 그 세션의 새 하한이 된다 — 판정과 기록이 한 함수인 이유다. */
export function staleSeq(session: string, seq?: number): boolean {
  if (typeof seq !== "number") return false; // 순번 없는 옛 페이로드는 그대로 받는다
  const last = lastSeq.get(session);
  if (last !== undefined && seq < last) return true;
  lastSeq.set(session, seq);
  return false;
}

/** 이벤트 1건 반영 — 화면과 인박스는 순서 역전 가드를 같이 통과해야 한다.
 *  가드를 화면 쪽(applyEvt)에만 두면, 버려진 스테일 idle 페이로드로 인박스가 배출돼
 *  이미 busy로 넘어간 세션에 사람이 치던 줄로 주입이 끼어든다 (P-2). */
function accept(p: AgentStateEvt, fromSnapshot = false): void {
  if (staleSeq(p.session, p.seq)) return;
  applyEvt(p, fromSnapshot);
  // 인박스 전달 (M3) — idle 전이가 곧 턴 종료 신호다
  flushInboxOnState(p.session, p.status);
}

/** waiting 사운드 합침 간격 (FR-G-32) — Rust의 OS 알림 게이트(NOTIFY_MIN_INTERVAL_MS)와 같은 값.
 *  승인을 자주 묻는 에이전트에서 waiting↔busy가 오갈 때마다 울리던 것을 막는다 (B55) */
const SOUND_MIN_INTERVAL_MS = 60_000;
const lastBeep = new Map<string, number>();

/** Rust 이벤트(null 표기) → 목 백엔드 반영 페이로드(undefined 표기) — 수신부 공용 변환.
 *  fromSnapshot: 웹뷰 복구 스냅숏 반영 — '전이'가 아니므로 사운드를 내지 않는다 (B55) */
function applyEvt(p: AgentStateEvt, fromSnapshot = false): void {
  // waiting 사운드 (FR-G-34) — 진입 전이에만, 설정이 켜져 있을 때만 (기본 꺼짐, G6).
  // 음소거(FR-G-35) 대상이면 내지 않는다 — 세션 id 또는 소속 워크스페이스 id
  const prevSess = backend.listSessions().find((x) => x.id === p.session);
  const mutedList = settings().muted;
  const isMuted = mutedList.includes(p.session) || (prevSess && mutedList.includes(prevSess.workspaceId));
  if (p.status === "waiting" && prevSess?.status !== "waiting" && settings().waitingSound && !isMuted) {
    // OS 알림과 같은 게이트를 통과시킨다 (B55) — 설정 카드가 "창 포커스 시 · 억제 (FR-G-31)"를
    // 고정 정책으로 선언하는데 사운드만 그 밖에 있었다. 스냅숏은 전이가 아니라 초기값이다.
    const now = Date.now();
    const recent = (lastBeep.get(p.session) ?? 0) + SOUND_MIN_INTERVAL_MS > now;
    if (!fromSnapshot && !document.hasFocus() && !recent) {
      lastBeep.set(p.session, now);
      beepWaiting();
    }
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
    sinceMs: p.sinceMs ?? undefined,
  });
}

let ready: Promise<void> | undefined;

/** agent-state 이벤트 → 목 백엔드 세션 갱신 → 전 화면(대시보드·셀·뱃지) 자동 반영 */
export function ensureAgentListeners(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (!ready) {
    ready = listen<AgentStateEvt>("agent-state", (e) => accept(e.payload)).then(() => {});
  }
  return ready;
}

/** 웹뷰 재시작 복구 (FR-C-06) — 살아 있는 PTY의 에이전트 상태 스냅숏을 끌어와
 *  목 백엔드에 반영한다. 스트림(agent-state)은 다음 변화부터만 오므로 초기값이 필요하다. */
export async function applyAgentSnapshot(): Promise<void> {
  if (!isTauri()) return;
  const states = await invoke<AgentStateEvt[]>("agent_snapshot").catch(() => [] as AgentStateEvt[]);
  // 스냅숏 시점에 이미 idle로 주차된 세션에는 앞으로 올 전이가 없다 (B49) — 여기서도 배출한다.
  // 그 사이 실시간 이벤트가 앞서 갔다면 스냅숏은 스테일이므로 accept가 통째로 버린다.
  for (const p of states) accept(p, true);
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
  const uuid = await invoke<string>("agent_spawn", {
    id: sessionId,
    workspace: wsId,
    cwd,
    name,
    permissionMode: f.permissionMode,
    disallowedTools: f.disallowedTools,
    cols,
    rows,
  });
  // 실제로 넘긴 플래그를 그대로 기억한다 (B39) — 권한 파일이 나중에 바뀌어도 돌고 있는
  // 프로세스의 플래그는 이 값이다. 다시 계산하면 '실제'가 아니라 '현재 설정'이 된다.
  backend.noteSpawnFlags(sessionId, flagsToString(f, uuid));
  return uuid;
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
  const uuid = await invoke<string>("agent_resume", {
    id: sessionId,
    workspace: wsId,
    cwd,
    name,
    permissionMode: f.permissionMode,
    disallowedTools: f.disallowedTools,
    cols,
    rows,
  });
  backend.noteSpawnFlags(sessionId, flagsToString(f, uuid));
  return uuid;
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
  const uuid = await invoke<string>("agent_restart", {
    id: sessionId,
    permissionMode: f.permissionMode,
    disallowedTools: f.disallowedTools,
    cols,
    rows,
  });
  backend.noteSpawnFlags(sessionId, flagsToString(f, uuid));
  return uuid;
}
