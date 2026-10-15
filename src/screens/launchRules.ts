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
