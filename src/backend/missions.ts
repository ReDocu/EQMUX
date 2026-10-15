// 임무 파일 브리지 (PRD E §4.6) — .eqmux/missions/*.md가 원본, UI는 하이드레이트만 한다.
// 배정의 원본은 역할 파일의 임무 블록 (FR-E-58) — 토글은 mission_assign으로 파일을 고치고
// 목록을 다시 실측한다 (FR-E-59). 브라우저 dev에서는 기존 목 동작으로 폴백한다.
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { cancelBrief, injectLine, queueBrief } from "./conversation";
import { isTauri } from "./pty";
import { canInject } from "../types";
import type { ConversationMessage, Mission, MissionStatus } from "../types";
import { notify } from "../components/ui";
import { tf } from "../i18n";

interface MissionFile {
  id: string;
  name: string;
  status: MissionStatus;
  branch: string | null;
  goal: string;
  outputs: string[];
  outputsDone: boolean[]; // 산출물 체크 (C4)
  file: string;
  assigned: string[];
  isDefault: boolean; // 기본 임무 (FR-E-56)
  assignedAt?: Record<string, number>; // 배정 시각 (B92) — 세션 id → epoch ms, 임무 파일 frontmatter
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
    // 배정 시각은 파일이 원본 (B92) — 재시작 뒤에도 완료 보고를 같은 기준으로 가른다
    for (const m of list) {
      for (const [sid, ms] of Object.entries(m.assignedAt ?? {})) assignedAt.set(atKey(wsId, m.id, sid), ms);
    }
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
  outputs: string[] = [],
): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    backend.createMission(wsId, name, goal, branch);
    return;
  }
  await invoke("mission_create", { wsPath: path, name, goal, branch: branch ?? null, outputs }).catch(failed);
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
  await setMissionStatus(wsId, missionId, next);
}

/** 상태를 정해서 바꾼다 — 완료 보고를 본 사람이 누르는 `검토 중으로`가 쓴다. 앱이 스스로 부르지 않는다 */
export async function setMissionStatus(wsId: string, missionId: string, status: MissionStatus): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    const m = backend.listMissions().find((x) => x.id === missionId);
    while (m && m.status !== status) backend.cycleMissionStatus(missionId);
    return;
  }
  const ok = await invoke("mission_set_status", { wsPath: path, id: missionId, status }).then(
    () => true,
    (e) => (failed(e), false),
  );
  await refreshMissions(wsId);
  // 산출물 체크리스트 (C4) — 미체크가 남아도 막지 않고 알리기만 한다. 판단은 사람 몫
  const m = backend.listMissions().find((x) => x.id === missionId && x.workspaceId === wsId);
  const open = m?.outputs.filter((_, i) => !m.outputsDone?.[i]).length ?? 0;
  if (ok && status === "in-review" && open > 0) {
    notify(tf("산출물 {n}개가 아직 체크되지 않았습니다 — 검토 중으로 옮겼습니다", { n: open }));
  }
}

/** 임무 쓰기 실패 (BR-12) — 조용히 삼키면 버튼이 안 먹는 것으로 읽힌다 */
function failed(e: unknown): void {
  notify(tf("임무 저장 실패 — {err}", { err: String(e) }));
}

/** 배정 토글 (FR-E-53·54) — 역할 파일의 임무 블록을 고치고 실측으로 되읽는다 */
export async function toggleAssign(
  wsId: string,
  missionId: string,
  sessionId: string,
): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    if (!backend.listMissions().find((x) => x.id === missionId)?.assigned.includes(sessionId)) {
      assignedAt.set(atKey(wsId, missionId, sessionId), Date.now());
    }
    backend.toggleAssign(missionId, sessionId);
    return;
  }
  const m = backend.listMissions().find((x) => x.id === missionId && x.workspaceId === wsId);
  if (!m) return;
  const wasAssigned = m.assigned.includes(sessionId);
  if (!wasAssigned) assignedAt.set(atKey(wsId, missionId, sessionId), Date.now());
  const movedFrom = wasAssigned
    ? []
    : backend.listMissions().filter((x) => x.workspaceId === wsId && x.id !== missionId && x.assigned.includes(sessionId));
  // 역할 파일과 같은 cwd 규약 (FR-E-63 · B59) — repo 루트에 쓰면 워크트리 세션은 에이전트가
  // 읽는 파일이 아니라 루트의 반쪽 스텁에 임무가 들어가고, 화면만 ✓가 붙는다
  const sess = backend.listSessions().find((x) => x.id === sessionId);
  await invoke("mission_assign", {
    wsPath: sess?.cwd || path,
    session: sessionId,
    missionId: wasAssigned ? null : missionId,
  }).catch(failed);
  // 배정 시각 (B92) — repo 루트의 임무 파일에 남긴다(워크트리 세션도 같은 파일). 옮겨 온 임무의 항목은 지운다.
  // 실패해도 배정은 이미 됐다 — 그때는 시각을 몰라 예전처럼 모든 보고를 본다
  const mark = (id: string, assigned: boolean) =>
    invoke("mission_mark_assigned", { wsPath: path, id, session: sessionId, assigned }).catch(() => {});
  await Promise.all([mark(missionId, !wasAssigned), ...movedFrom.map((x) => mark(x.id, false))]);
  await refreshMissions(wsId);
  if (wasAssigned) cancelBrief(sessionId); // 해제된 임무의 브리프가 턴 끝에 늦게 들어가지 않게
  else sendBrief(sessionId, m);
}

/** 배정 시각 (B92) — 완료 보고를 이 임무 것으로 한정한다. 키 `워크스페이스|임무|세션`.
 *  원본은 임무 파일 frontmatter `assigned_at`이고, 배정 직후 파일을 되읽기 전에는 여기 값이 먼저 쓰인다.
 *  이 기록이 생기기 전(0.5.0)의 배정은 시각을 몰라 예전처럼 모든 보고를 본다 */
const assignedAt = new Map<string, number>();
const atKey = (wsId: string, missionId: string, sid: string) => `${wsId}|${missionId}|${sid}`;

/** 이 임무의 마지막 완료 보고 (B92) — 배정된 세션이 배정 뒤에 보낸 report --done만 센다.
 *  예전에는 이전 임무의 보고가 새 임무에 바로 '완료 보고'·[검토 중으로]로 떴다 */
export function missionDoneReport(
  msgs: readonly ConversationMessage[],
  m: Pick<Mission, "id" | "workspaceId" | "assigned">,
  since = (sid: string) => assignedAt.get(atKey(m.workspaceId, m.id, sid)),
): ConversationMessage | undefined {
  return msgs
    .filter((x) => x.done && x.workspaceId === m.workspaceId && m.assigned.includes(x.from) && (x.ts ?? 0) >= (since(x.from) ?? 0))
    .at(-1);
}

/** 배정 브리프 (FR-E-55) — 지금 받을 수 있으면 바로, 아니면(작업 중·승인 대기·셸·종료) 다음 idle
 *  전이(턴 끝·기동·재개)에 넣는다 (B93 — 예전에는 흘려서 화면 약속과 반대였다).
 *  판정은 canInject 하나로 한다 (P-2 · G7) — 예전 가드(agentSessionId)는 지워지지 않는
 *  과거 기록이라 셸로 돌아온 페인에 브리프를 명령으로 실행시켰다. */
function sendBrief(sessionId: string, m: Mission): void {
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s?.personaId) return;
  const goal = m.goal ? ` — ${m.goal}` : "";
  const line = `[EQ] 임무 배정: ${m.name}${goal} · 정의 ${m.file}`;
  if (canInject(s)) injectLine(sessionId, line); // 2단계 제출 (B94)
  else queueBrief(sessionId, line);
}

/** 기본 임무 지정·해제 (FR-E-56, M33) — frontmatter default: true, 워크스페이스당 1개 */
export async function setDefaultMission(wsId: string, missionId: string, on: boolean): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) return;
  await invoke("mission_set_default", { wsPath: path, id: missionId, on }).catch(failed);
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
