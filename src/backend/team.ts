// 팀 편성 파일 브리지 (PRD E §4.2) — .eqmux/team.json 로드·자동 저장.
// 저장: 백엔드 방송을 구독해 역할 슬롯이 바뀔 때마다 500ms 디바운스로 team.json/team.md를 갱신한다.
// 로드: 워크스페이스 목록 갱신 시 슬롯을 복원한다 — 에이전트는 자동 실행하지 않는다 (C5 · FR-D-22).
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../components/ui";
import { t, tf } from "../i18n";
import { castingChanges, sessionName } from "../types";
import { applyAgentSnapshot } from "./agent";
import { backend, libraryRev } from "./mock";
import { isServerTermId } from "./ports";
import { isTauri, listAlivePty } from "./pty";
import { buildRolePayload } from "./roles";

export interface TeamSlotInfo {
  slot: number;
  persona: string;
  personaName: string;
  job: string;
  jobName: string;
  name?: string | null; // 세션 표시 이름 (P5 · FR-E-36) — 페르소나 이름과 분리 가능
  worktree: boolean; // 격리 옵트인 (FR-E-62) — 경로가 아니라 플래그 (team.json은 커밋 대상)
  permissions?: { write: boolean; commit: boolean; push: boolean } | null; // 슬롯 권한 오버라이드 (FR-E-34)
  cli?: string | null; // 관리 기동 엔진 (M37) — "claude" | "codex", 없으면 claude
  title?: string | null; // 직함 덮어쓰기 (0.5) — 없으면 생략
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
      name: s.name ?? null, // 분리된 세션 이름 (P5) — 없으면 null (파일에는 생략)
      worktree: !!s.worktree,
      permissions: s.permOverride ?? null, // 슬롯 권한 오버라이드 (FR-E-34) — 없으면 생략
      cli: s.cli ?? null, // 관리 기동 엔진 (M37) — claude면 생략 (옛 파일과 같은 모양)
      title: s.title?.trim() || null, // 직함 덮어쓰기 (0.5) — 없으면 생략
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
  // 방송은 메모리 샘플·프로브·activity에도 온다 (D3) — 편성 키가 바뀐 때만 저장 판정을 예약한다
  let lastKey = "";
  backend.subscribe(() => {
    const key = compositionKey();
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    timer = setTimeout(flushTeamNow, 500);
  });
}

/** team.json·역할 파일을 바꿀 수 있는 필드만 모은 키 — 상태·출력·메모리는 들어가지 않는다 */
function compositionKey(): string {
  const ws = backend
    .listWorkspaces()
    .map((w) => `${w.id}:${w.path}:${w.pathMissing}`)
    .join(",");
  const ss = backend
    .listSessions()
    .map((s) =>
      [s.id, s.workspaceId, s.slot, s.personaId, s.jobId, s.name, s.title, s.cli, s.worktree, s.cwd, JSON.stringify(s.permOverride ?? null)].join("|"),
    )
    .join("\n");
  return `${libraryRev()}\n${ws}\n${ss}`;
}

/** 디바운스 즉시 flush — 종료 시퀀스가 부른다. 대기 타이머만 믿으면 마지막 0.5초 변경이 유실된다.
 *  sync 시작 전(부트스트랩 중)에는 no-op — 빈 상태로 파일을 덮으면 안 된다. */
export function flushTeamNow(): void {
  if (!syncStarted) return;
  clearTimeout(timer);
  for (const ws of backend.listWorkspaces()) {
    if (ws.pathMissing) continue;
    const slots = slotsOf(ws.id);
    const json = JSON.stringify(slots);
    // 세션이 하나도 로드된 적 없는 워크스페이스는 건드리지 않는다 (파일이 원본)
    if (json !== "[]" || lastSaved.has(ws.id)) {
      if (lastSaved.get(ws.id) !== json) {
        lastSaved.set(ws.id, json);
        // 실패를 삼키지 않는다 — 더 새 EQMUX가 쓴 team.json은 Rust가 덮어쓰기를 거부한다 (FR-E-75)
        void invoke("team_save", { wsPath: ws.path, slots }).catch((e) =>
          notify(tf("팀 편성 저장 실패 — {err}", { err: String(e) })),
        );
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
      lastSaved.set(ws.id, JSON.stringify(slots.map(({ slot, persona, personaName, job, jobName, name, worktree, permissions, cli, title }) => ({ slot, persona, personaName, job, jobName, name: name ?? null, worktree, permissions: permissions ?? null, cli: cli ?? null, title: title ?? null }))));
      backend.hydrateTeam(ws.id, slots, alive);
    }
  }
  // 팀 파일에 없는 생존 PTY(기본 터미널) — 화면에 되살린다. 세션 id 관례가 `이름@wsId`라
  // 워크스페이스 귀속을 id에서 푼다 (pty_spawn의 폴백과 같은 규칙).
  const known = new Set(backend.listSessions().map((x) => x.id));
  for (const id of alive) {
    if (known.has(id) || isServerTermId(id)) continue; // 서버 탭 PTY는 페인이 아니다 — 탭이 재부착한다
    const wsId = id.split("@")[1];
    if (wsId && backend.listWorkspaces().some((w) => w.id === wsId && !w.pathMissing)) {
      backend.reviveOrphan(id, wsId);
    }
  }
  // 생존 세션의 에이전트 상태 초기값 (FR-C-06) — 스트림은 다음 변화부터만 온다
  await applyAgentSnapshot();
}

/** 캐스팅 확인창 줄 (B69 · P35) — 세션 종료·직무 변경·자리 없음이 없으면 빈 배열 = 확인 없이 적용.
 *  팀 캐스팅 [편성 선택 →]·[편성 저장]과 팀 편성 [기본 편성 채우기]가 같이 쓴다 */
export function castingConfirmLines(wsId: string, wanted: readonly { personaId: string; jobId: string }[]): string[] {
  const sessions = backend.listSessions().filter((s) => s.workspaceId === wsId);
  const c = castingChanges(sessions, wanted, backend.planCasting(wsId, wanted.map((w) => w.personaId)), wsId);
  if (c.stopped.length + c.jobChanged.length + c.dropped.length === 0) return [];
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id)?.name ?? id;
  const sess = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    return s ? sessionName(s, persona(s.personaId)) : id;
  };
  return [
    ...c.stopped.map((id) => tf("{name} 종료 — 세션과 PTY가 끝납니다", { name: sess(id) })),
    ...c.jobChanged.map((j) => tf("{name} 직무 {from} → {to} — 재시작해야 반영됩니다", { name: sess(j.id), from: job(j.from), to: job(j.to) })),
    ...c.added.map((p) => tf("{name} 새로 — 빈 슬롯에 셸로", { name: persona(p)?.name ?? p })),
    ...c.dropped.map((p) => tf("{name} 자리 없음 — 빠집니다", { name: persona(p)?.name ?? p })),
    ...(c.dropped.length ? [t("자리를 늘리려면 설정에서 슬롯 수를 올리거나 기본 터미널을 닫으세요")] : []),
  ];
}

/** 페르소나 직함이 바뀌었다 — 슬롯 직렬화는 그대로라 디바운스 저장이 건너뛴다. team.md의 직함 열은
 *  Rust가 저장 때 페르소나 직함으로 채우므로 한 번 강제로 다시 저장한다 (W2 team_save) */
export function resaveTeams(): void {
  lastSaved.clear();
  flushTeamNow();
}
