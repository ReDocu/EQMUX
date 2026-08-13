// 팀 편성 파일 브리지 (PRD E §4.2) — .eqmux/team.json 로드·자동 저장.
// 저장: 백엔드 방송을 구독해 역할 슬롯이 바뀔 때마다 500ms 디바운스로 team.json/team.md를 갱신한다.
// 로드: 워크스페이스 목록 갱신 시 슬롯을 복원한다 — 에이전트는 자동 실행하지 않는다 (C5 · FR-D-22).
import { invoke } from "@tauri-apps/api/core";
import { applyAgentSnapshot } from "./agent";
import { backend } from "./mock";
import { isTauri, listAlivePty } from "./pty";
import { buildRolePayload } from "./roles";

export interface TeamSlotInfo {
  slot: number;
  persona: string;
  personaName: string;
  job: string;
  jobName: string;
  worktree: boolean; // 격리 옵트인 (FR-E-62) — 경로가 아니라 플래그 (team.json은 커밋 대상)
  agentSessionId: string | null;
  resumable: boolean;
  worktreePath: string | null; // 이 머신에 워크트리가 실재할 때만 — 없으면 repo 루트 폴백
}

export async function loadTeam(workspaceId: string, wsPath: string): Promise<TeamSlotInfo[]> {
  if (!isTauri()) return [];
  return invoke<TeamSlotInfo[]>("team_load", { workspaceId, wsPath }).catch(() => []);
}

/** 세션 워크트리 보장 (FR-E-62) — 멱등. `.eqmux/worktrees/<세션>` + 브랜치 `eqmux/<세션>` */
export async function ensureWorktree(wsPath: string, session: string): Promise<string> {
  return invoke<string>("worktree_ensure", { wsPath, session });
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
      worktree: !!s.worktree,
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
        // 역할 파일 — 페르소나·직무·관계가 바뀐 워크스페이스만 다시 합성한다.
        // 경로 규약은 세션 cwd 기준 (FR-E-63) — 워크트리 세션은 자기 사본에 합성된다.
        const payloads = backend
          .listSessions()
          .filter((s) => s.workspaceId === ws.id && s.personaId)
          .map((s) => ({ cwd: s.cwd || ws.path, payload: buildRolePayload(s) }))
          .filter((x): x is { cwd: string; payload: NonNullable<ReturnType<typeof buildRolePayload>> } => x.payload !== undefined);
        if (payloads.length === 0 && !lastRoleSaved.has(ws.id)) continue;
        const roleJson = JSON.stringify(payloads);
        if (lastRoleSaved.get(ws.id) === roleJson) continue;
        lastRoleSaved.set(ws.id, roleJson);
        for (const x of payloads) {
          void invoke("role_save", { wsPath: x.cwd, payload: x.payload }).catch(() => {});
        }
      }
    }, 500);
  });
}

/** 워크스페이스의 팀 슬롯 복원 — refreshWorkspaces 이후 호출된다.
 *  살아 있는 PTY(웹뷰만 재시작한 경우, FR-C-06)는 재개 대기가 아니라 재부착으로 복원한다. */
export async function restoreTeams(): Promise<void> {
  if (!isTauri()) return;
  const alive = new Set(await listAlivePty());
  for (const ws of backend.listWorkspaces()) {
    if (ws.pathMissing) continue;
    const slots = await loadTeam(ws.id, ws.path);
    if (slots.length > 0) {
      lastSaved.set(ws.id, JSON.stringify(slots.map(({ slot, persona, personaName, job, jobName, worktree }) => ({ slot, persona, personaName, job, jobName, worktree }))));
      backend.hydrateTeam(ws.id, slots, alive);
    }
  }
  // 팀 파일에 없는 생존 PTY(기본 터미널) — 화면에 되살린다. 세션 id 관례가 `이름@wsId`라
  // 워크스페이스 귀속을 id에서 푼다 (pty_spawn의 폴백과 같은 규칙).
  const known = new Set(backend.listSessions().map((x) => x.id));
  for (const id of alive) {
    if (known.has(id)) continue;
    const wsId = id.split("@")[1];
    if (wsId && backend.listWorkspaces().some((w) => w.id === wsId && !w.pathMissing)) {
      backend.reviveOrphan(id, wsId);
    }
  }
  // 생존 세션의 에이전트 상태 초기값 (FR-C-06) — 스트림은 다음 변화부터만 온다
  await applyAgentSnapshot();
}
