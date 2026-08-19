// 임무 파일 브리지 (PRD E §4.6) — .eqmux/missions/*.md가 원본, UI는 하이드레이트만 한다.
// 배정의 원본은 역할 파일의 임무 블록 (FR-E-58) — 토글은 mission_assign으로 파일을 고치고
// 목록을 다시 실측한다 (FR-E-59). 브라우저 dev에서는 기존 목 동작으로 폴백한다.
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri, writePty } from "./pty";
import { canInject } from "../types";
import type { Mission, MissionStatus } from "../types";

interface MissionFile {
  id: string;
  name: string;
  status: MissionStatus;
  branch: string | null;
  goal: string;
  outputs: string[];
  file: string;
  assigned: string[];
  isDefault: boolean; // 기본 임무 (FR-E-56)
}

function wsPath(wsId: string): string | undefined {
  const ws = backend.listWorkspaces().find((w) => w.id === wsId);
  return ws && !ws.pathMissing ? ws.path : undefined;
}

/** 임무 파일 실측 → 목 목록 교체. 파일과 UI가 충돌하면 파일이 이긴다 (FR-E-74) */
export async function refreshMissions(wsId: string): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) return;
  const list = await invoke<MissionFile[]>("mission_list", { wsPath: path }).catch(
    () => undefined,
  );
  if (list) {
    backend.hydrateMissions(
      wsId,
      list.map((m) => ({ ...m, branch: m.branch ?? undefined, workspaceId: wsId })),
    );
  }
}

export async function createMission(
  wsId: string,
  name: string,
  goal: string,
  branch?: string,
): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    backend.createMission(wsId, name, goal, branch);
    return;
  }
  await invoke("mission_create", { wsPath: path, name, goal, branch: branch ?? null }).catch(
    () => {},
  );
  await refreshMissions(wsId);
}

const ORDER: MissionStatus[] = ["todo", "in-progress", "in-review", "done"];

export async function cycleMissionStatus(wsId: string, missionId: string): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    backend.cycleMissionStatus(missionId);
    return;
  }
  const m = backend.listMissions().find((x) => x.id === missionId && x.workspaceId === wsId);
  if (!m) return;
  const next = ORDER[(ORDER.indexOf(m.status) + 1) % ORDER.length];
  await invoke("mission_set_status", { wsPath: path, id: missionId, status: next }).catch(() => {});
  await refreshMissions(wsId);
}

/** 배정 토글 (FR-E-53·54) — 역할 파일의 임무 블록을 고치고 실측으로 되읽는다 */
export async function toggleAssign(
  wsId: string,
  missionId: string,
  sessionId: string,
): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    backend.toggleAssign(missionId, sessionId);
    return;
  }
  const m = backend.listMissions().find((x) => x.id === missionId && x.workspaceId === wsId);
  if (!m) return;
  const wasAssigned = m.assigned.includes(sessionId);
  await invoke("mission_assign", {
    wsPath: path,
    session: sessionId,
    missionId: wasAssigned ? null : missionId,
  }).catch(() => {});
  await refreshMissions(wsId);
  if (!wasAssigned) sendBrief(sessionId, m);
}

/** 배정 브리프 (FR-E-55) — 지금 받을 수 있는 에이전트 세션에만 자연어 한 줄을 전달한다.
 *  못 보낸 경우(맨 셸·승인 대기·작업 중·복원·종료)는 흘린다 — 배정의 원본은 역할 파일의
 *  임무 블록이라(FR-E-58) 다음 기동·다음 턴에 어차피 전달된다.
 *  판정은 canInject 하나로 한다 (P-2 · G7) — 예전 가드(agentSessionId)는 지워지지 않는
 *  과거 기록이라 셸로 돌아온 페인에 브리프를 명령으로 실행시켰다. */
function sendBrief(sessionId: string, m: Mission): void {
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s?.personaId || !canInject(s)) return;
  const goal = m.goal ? ` — ${m.goal}` : "";
  writePty(sessionId, `[EQMUX] 임무 배정: ${m.name}${goal} · 정의 ${m.file}\r`);
}

/** 기본 임무 지정·해제 (FR-E-56, M33) — frontmatter default: true, 워크스페이스당 1개 */
export async function setDefaultMission(wsId: string, missionId: string, on: boolean): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) return;
  await invoke("mission_set_default", { wsPath: path, id: missionId, on }).catch(() => {});
  await refreshMissions(wsId);
}

/** 임무 없는 세션의 기본 임무 자동 배정 (FR-E-56) — 세션 생성·역할 부여 시점에 부른다.
 *  수동 해제와 싸우지 않도록 여기 말고는 자동 경로가 없다 (배정 화면 재실측이 재배정하지 않는다). */
export async function autoAssignDefault(wsId: string, sessionId: string): Promise<void> {
  if (!isTauri() || !wsPath(wsId)) return;
  await refreshMissions(wsId); // 파일 실측 — 기본 임무·기존 배정을 최신으로
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s?.personaId || s.missionId) return;
  const def = backend
    .listMissions()
    .find((m) => m.workspaceId === wsId && m.isDefault && m.status !== "done");
  if (def) await toggleAssign(wsId, def.id, sessionId); // 같은 경로 — 임무 블록 + 브리프
}
