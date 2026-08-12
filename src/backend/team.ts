// 팀 편성 파일 브리지 (PRD E §4.2) — .eqmux/team.json 로드·자동 저장.
// 저장: 백엔드 방송을 구독해 역할 슬롯이 바뀔 때마다 500ms 디바운스로 team.json/team.md를 갱신한다.
// 로드: 워크스페이스 목록 갱신 시 슬롯을 복원한다 — 에이전트는 자동 실행하지 않는다 (C5 · FR-D-22).
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri } from "./pty";
import { buildRolePayload } from "./roles";

export interface TeamSlotInfo {
  slot: number;
  persona: string;
  personaName: string;
  job: string;
  jobName: string;
  agentSessionId: string | null;
  resumable: boolean;
}

export async function loadTeam(workspaceId: string, wsPath: string): Promise<TeamSlotInfo[]> {
  if (!isTauri()) return [];
  return invoke<TeamSlotInfo[]>("team_load", { workspaceId, wsPath }).catch(() => []);
}

/** 현재 목 상태에서 워크스페이스의 역할 슬롯을 직렬화 (기본 터미널은 팀 파일에 넣지 않는다) */
function slotsOf(wsId: string) {
  const personas = backend.listPersonas();
  const jobs = backend.listJobs();
  return backend
    .listSessions()
    .filter((s) => s.workspaceId === wsId && s.personaId)
    .sort((a, b) => a.slot - b.slot)
    .map((s) => ({
      slot: s.slot,
      persona: s.personaId,
      personaName: personas.find((p) => p.id === s.personaId)?.name ?? s.personaId,
      job: s.jobId,
      jobName: jobs.find((j) => j.id === s.jobId)?.name ?? s.jobId,
    }));
}

let syncStarted = false;
const lastSaved = new Map<string, string>();
const lastRoleSaved = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** 방송 구독 → 역할 슬롯 변경 감지 → team.json/team.md 자동 저장 (FR-E-11·12)
 *  + 역할 파일 합성 (FR-E-31) — 편성이 곧 합성 입력이므로 같은 디바운스에 편승한다 */
export function startTeamSync(): void {
  if (syncStarted || !isTauri()) return;
  syncStarted = true;
  backend.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const ws of backend.listWorkspaces()) {
        if (ws.pathMissing) continue;
        const slots = slotsOf(ws.id);
        const json = JSON.stringify(slots);
        // 세션이 하나도 로드된 적 없는 워크스페이스는 건드리지 않는다 (파일이 원본)
        if (json !== "[]" || lastSaved.has(ws.id)) {
          if (lastSaved.get(ws.id) !== json) {
            lastSaved.set(ws.id, json);
            void invoke("team_save", { wsPath: ws.path, slots }).catch(() => {});
          }
        }
        // 역할 파일 — 페르소나·직무·관계가 바뀐 워크스페이스만 다시 합성한다
        const payloads = backend
          .listSessions()
          .filter((s) => s.workspaceId === ws.id && s.personaId)
          .map(buildRolePayload)
          .filter((p) => p !== undefined);
        if (payloads.length === 0 && !lastRoleSaved.has(ws.id)) continue;
        const roleJson = JSON.stringify(payloads);
        if (lastRoleSaved.get(ws.id) === roleJson) continue;
        lastRoleSaved.set(ws.id, roleJson);
        for (const payload of payloads) {
          void invoke("role_save", { wsPath: ws.path, payload }).catch(() => {});
        }
      }
    }, 500);
  });
}

/** 워크스페이스의 팀 슬롯 복원 — refreshWorkspaces 이후 호출된다 */
export async function restoreTeams(): Promise<void> {
  if (!isTauri()) return;
  for (const ws of backend.listWorkspaces()) {
    if (ws.pathMissing) continue;
    const slots = await loadTeam(ws.id, ws.path);
    if (slots.length > 0) {
      lastSaved.set(ws.id, JSON.stringify(slots.map(({ slot, persona, personaName, job, jobName }) => ({ slot, persona, personaName, job, jobName }))));
      backend.hydrateTeam(ws.id, slots);
    }
  }
}
