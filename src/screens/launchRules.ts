// 워크스페이스 열기 · 기본 터미널 구성의 갈래 — 화면에서 떼어 둔 순수 판정 (테스트 대상)
import type { View } from "../state";

/** [열기] 뒤에 갈 화면 (U60 · B107) — 세션이 없으면 첫 세션 마법사, 있으면 그 탭 */
export function openView(id: string, sessionCount: number): View {
  return sessionCount === 0 ? { kind: "launch", wsId: id } : { kind: "workspace", id };
}

/** 기본 터미널을 어느 슬롯에 열지 (B107) — mock.startDefaultTerminal·addTerminal과 같은 갈래.
 *  살아 있는 기본 터미널이 있으면 새로 만들지 않고, 꺼진 것은 그 슬롯에서 되살리고,
 *  아니면 첫 빈 슬롯. 빈 슬롯이 없으면 열 수 없다 */
export function defaultTerminalPlan(
  sessions: readonly { slot: number; personaId: string; status: string }[],
  maxSlots: number,
): { slot: number } | { blocked: "live" | "full" } {
  const def = sessions.find((s) => s.personaId === "");
  if (def && def.status !== "dead") return { blocked: "live" };
  if (def) return { slot: def.slot };
  for (let n = 1; n <= maxSlots; n++) if (!sessions.some((s) => s.slot === n)) return { slot: n };
  return { blocked: "full" };
}

/** 마법사 갈래 — 실행 방식에서 고른 것. 빠른 시작은 실행 방식에서 바로 워크스페이스로 간다 (§10) */
export type WizardPath = "quick" | "terminal" | "team";

/** 단계 표시 (P49) — 마법사 모든 화면의 머리에 같은 줄을 둔다. 끝은 늘 도착지(워크스페이스)라
 *  '시작'이 언제 일어나는지 보인다 (P50) */
export function wizardSteps(path: WizardPath): string[] {
  const mid = path === "terminal" ? ["기본 터미널 구성"] : path === "team" ? ["팀 캐스팅", "팀 편성"] : [];
  return ["워크스페이스 열기", "실행 방식", ...mid, "워크스페이스"];
}

/** 빠른 시작 편성 (§10) — 리드 + 개발 2세션. 기본 직무가 맞는 페르소나를 먼저, 없으면 라이브러리 순서.
 *  직무가 라이브러리에 없으면 그 자리는 뺀다. 캐스팅 화면을 거치지 않으므로 고르는 규칙은 여기 하나다 */
export function quickStartSlots(
  personas: readonly { id: string; job?: string }[],
  jobIds: readonly string[],
): { personaId: string; jobId: string }[] {
  const out: { personaId: string; jobId: string }[] = [];
  for (const jobId of ["lead", "dev"]) {
    if (!jobIds.includes(jobId)) continue;
    const free = personas.filter((p) => !out.some((o) => o.personaId === p.id));
    const p = free.find((x) => x.job === jobId) ?? free[0];
    if (p) out.push({ personaId: p.id, jobId });
  }
  return out;
}
