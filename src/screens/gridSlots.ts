/** 관제 칸 순서 — 슬롯 1..max를 차례로, 세션이 있으면 세션, 없으면 빈 슬롯 번호 (B208).
 *  그리드 칸 위치 · 레일 행 순서가 곧 슬롯 번호다 — Ctrl+Alt+N과 '+' 칸이 같은 자리를 가리킨다.
 *  상한을 줄여 넘친 슬롯의 세션도 버리지 않고 번호 순으로 뒤에 둔다 */
export function slotCells<T extends { slot: number }>(sessions: readonly T[], max: number): (T | number)[] {
  const used = new Set(sessions.map((s) => s.slot));
  const empty = Array.from({ length: max }, (_, i) => i + 1).filter((n) => !used.has(n));
  return [...sessions, ...empty].sort((x, y) => (typeof x === "number" ? x : x.slot) - (typeof y === "number" ? y : y.slot));
}
