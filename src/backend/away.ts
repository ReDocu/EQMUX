// 자리 비운 사이 요약 (0.6 §13-5) — 앱 창이 포커스를 잃은 시각부터 다시 받을 때까지 무엇이 바뀌었나.
// 이미 있는 데이터만 모은다(상태 · 메시지 원장 · statusLine 비용 · 완료 보고). 요약 문장을 AI로 만들지 않는다.
// ponytail: 편집 파일(file_touch) · Bash 횟수 · 새 커밋은 아직 프런트에 값이 없다 — 커맨드가 생기면 행에 칸을 더한다
import { createSignal } from "solid-js";
import { backend } from "./mock";
import type { AgentStatus, ConversationMessage, Session } from "../types";

export interface AwaySnap {
  since: number;
  sessions: Record<string, { status: AgentStatus; cost?: number }>;
}

export interface AwayRow {
  session: string;
  workspace: string;
  was?: AgentStatus; // 떠날 때 상태 — 바뀌었을 때만
  status: AgentStatus;
  msgsIn: number;
  msgsOut: number;
  cost: number; // 비용 증분 USD
  done?: string; // 그사이 온 완료 보고 한 줄
}

/** 떠날 때 찍는다 */
export function snapAway(sessions: readonly Session[], now: number): AwaySnap {
  return { since: now, sessions: Object.fromEntries(sessions.map((s) => [s.id, { status: s.status, cost: s.costUsd }])) };
}

/** 돌아왔을 때 — 바뀐 세션만 행으로. 바뀐 것이 없으면 빈 목록(카드를 띄우지 않는다). 순수 함수 */
export function awayRows(snap: AwaySnap, sessions: readonly Session[], messages: readonly ConversationMessage[]): AwayRow[] {
  const recent = messages.filter((m) => (m.ts ?? 0) >= snap.since);
  const rows: AwayRow[] = [];
  for (const s of sessions) {
    const before = snap.sessions[s.id];
    const msgsIn = recent.filter((m) => m.to === s.id).length;
    const out = recent.filter((m) => m.from === s.id);
    const cost = Math.max(0, (s.costUsd ?? 0) - (before?.cost ?? 0));
    const done = out.find((m) => m.done)?.body.split("\n")[0];
    const was = before && before.status !== s.status ? before.status : undefined;
    if (!was && msgsIn === 0 && out.length === 0 && cost < 0.01 && !done) continue;
    rows.push({ session: s.id, workspace: s.workspaceId, was, status: s.status, msgsIn, msgsOut: out.length, cost, done });
  }
  return rows;
}

/** 이보다 짧게 비운 것은 요약하지 않는다 — Alt-Tab 한 번에 카드가 뜨면 소음이다 */
export const AWAY_MIN_MS = 60_000;

const [awayCard, setAwayCard] = createSignal<{ since: number; rows: AwayRow[] } | undefined>(undefined);
export { awayCard };
export const dismissAway = (): void => void setAwayCard(undefined);

let snap: AwaySnap | undefined;
let started = false;
/** 앱 셸이 1회 켠다 — 창 blur에 찍고 focus에 비교한다 */
export function startAwayWatch(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("blur", () => {
    snap ??= snapAway(backend.listSessions(), Date.now());
  });
  window.addEventListener("focus", () => {
    const s = snap;
    snap = undefined;
    if (!s || Date.now() - s.since < AWAY_MIN_MS) return;
    const rows = awayRows(s, backend.listSessions(), backend.listMessages());
    setAwayCard(rows.length > 0 ? { since: s.since, rows } : undefined);
  });
}
