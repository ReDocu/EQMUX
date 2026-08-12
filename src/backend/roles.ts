// 역할 파일 브리지 (PRD E §4.4·4.5) — .eqmux/roles/<세션>.md 합성 저장·삭제·갱신 안내.
// 합성 소스는 셋 — 직무·페르소나 라이브러리(프런트 소유) + team 편성 (FR-E-32).
// 파일이 원본, 프롬프트는 포인터 (FR-E-40) — 본문 전재는 Rust 주입 경로에도 없다.
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri, writePty } from "./pty";
import type { Session } from "../types";

export interface RolePayload {
  session: string;
  persona: string;
  personaName: string;
  hint: string;
  job: string;
  jobName: string;
  permissions: { write: boolean; commit: boolean; push: boolean };
  responsibility: string;
  forbidden: string;
  teammates: { slot: number; name: string; jobName: string; me: boolean }[];
}

/** 목 상태(라이브러리 + 편성)에서 합성 페이로드를 만든다 — 역할 없는 세션이면 undefined */
export function buildRolePayload(s: Session): RolePayload | undefined {
  const personas = backend.listPersonas();
  const jobs = backend.listJobs();
  const persona = personas.find((p) => p.id === s.personaId);
  const job = jobs.find((j) => j.id === s.jobId);
  if (!persona || !job) return undefined;
  const teammates = backend
    .listSessions()
    .filter((x) => x.workspaceId === s.workspaceId && x.personaId)
    .sort((a, b) => a.slot - b.slot)
    .map((x) => ({
      slot: x.slot,
      name: personas.find((p) => p.id === x.personaId)?.name ?? x.personaId,
      jobName: jobs.find((j) => j.id === x.jobId)?.name ?? x.jobId,
      me: x.id === s.id,
    }));
  return {
    session: s.id,
    persona: persona.id,
    personaName: persona.name,
    hint: persona.hint,
    job: job.id,
    jobName: job.name,
    permissions: job.permissions,
    responsibility: job.responsibility,
    forbidden: job.forbidden,
    teammates,
  };
}

/** 역할 파일 합성 저장 (FR-E-31) — 반환값은 절대 경로. 조건이 안 되면 no-op */
export async function saveRoleFile(sessionId: string): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const s = backend.listSessions().find((x) => x.id === sessionId);
  const ws = s && backend.listWorkspaces().find((w) => w.id === s.workspaceId);
  const payload = s && buildRolePayload(s);
  if (!ws || ws.pathMissing || !payload) return undefined;
  return invoke<string>("role_save", { wsPath: ws.path, payload }).catch(() => undefined);
}

/** 역할 해제·세션 제거 시 파일 삭제 — roles/는 gitignore라 repo 이력에 흔적이 없다 */
export function removeRoleFile(wsPath: string, sessionId: string): void {
  if (!isTauri()) return;
  void invoke("role_remove", { wsPath, session: sessionId }).catch(() => {});
}

/** 비권한 변경 안내 (FR-E-44) — 파일 갱신 후 "다시 읽어라" 한 줄을 세션에 전달한다.
 *  권한 변경은 여기 오지 않는다 — 재시작 배지(E11′)가 담당한다. */
export function nudgeRoleReload(sessionId: string, roleFile: string): void {
  if (!isTauri()) return;
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s?.agentSessionId || s.status === "dead" || s.restored) return;
  writePty(sessionId, `[EQMUX] 역할 파일이 갱신되었습니다 — ${roleFile} 를 다시 읽어주세요\r`);
}
