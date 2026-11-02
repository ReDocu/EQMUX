// 자리 비운 사이 요약 (0.6 §13-5) — 앱 창이 포커스를 잃은 시각부터 다시 받을 때까지 무엇이 바뀌었나.
// 이미 있는 데이터만 모은다(상태 · 메시지 원장 · statusLine 비용 · 완료 보고). 요약 문장을 AI로 만들지 않는다.
// ponytail: 편집 파일(file_touch) · Bash 횟수 · 새 커밋은 아직 프런트에 값이 없다 — 커맨드가 생기면 행에 칸을 더한다
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";
import { backend } from "./mock";
import { isTauri } from "./pty";
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
    // 그 세션 팀의 원장만 — 프로젝트 간 메시지는 두 원장에 한 줄씩 있어 두 번 셌다. 목 시드는 workspaceId가 없다
    const mine = recent.filter((m) => (m.workspaceId ?? s.workspaceId) === s.workspaceId);
    // 팀 전체(@all)도 받은 메시지다 — 보낸 본인은 빼고 (B235)
    const msgsIn = mine.filter((m) => m.to === s.id || (m.to === "@all" && m.from !== s.id)).length;
    const out = mine.filter((m) => m.from === s.id);
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

export interface AwayCard {
  snap: AwaySnap; // 카드가 세는 기준 — 닫기 전까지는 처음 떠난 때의 것
  rows: AwayRow[];
}

/** 돌아왔을 때 카드 — 닫지 않은 카드가 있으면 처음 떠난 때부터 다시 센다(앞 공백의 요약이 덮이지 않게).
 *  이번에 바뀐 것이 없으면 있던 카드를 그대로 둔다 (B213). 순수 함수 */
export function mergeAway(
  prev: AwayCard | undefined,
  snap: AwaySnap,
  sessions: readonly Session[],
  messages: readonly ConversationMessage[],
): AwayCard | undefined {
  const base = prev?.snap ?? snap;
  const rows = awayRows(base, sessions, messages);
  return rows.length > 0 ? { snap: base, rows } : prev;
}

const [awayCard, setAwayCard] = createSignal<AwayCard | undefined>(undefined);
export { awayCard };
export const dismissAway = (): void => void setAwayCard(undefined);

let snap: AwaySnap | undefined;
let started = false;
/** 앱 셸이 1회 켠다 — 창이 포커스를 잃을 때 찍고 받을 때 비교한다.
 *  Tauri에서는 창 포커스 이벤트를 쓴다 (B187) — 브라우저 패널은 같은 창의 자식 웹뷰라 그 페이지를 누르면
 *  메인 문서의 window blur가 난다. 창 포커스는 그대로라 앱 안에서 패널을 쓴 시간을 자리 비움으로 세지 않는다 */
export function startAwayWatch(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const onFocus = (focused: boolean) => {
    if (!focused) {
      snap ??= snapAway(backend.listSessions(), Date.now());
      return;
    }
    const s = snap;
    snap = undefined;
    if (!s || Date.now() - s.since < AWAY_MIN_MS) return;
    setAwayCard(mergeAway(awayCard(), s, backend.listSessions(), backend.listMessages()));
  };
  if (isTauri()) {
    void getCurrentWindow().onFocusChanged((e) => onFocus(e.payload));
    return;
  }
  window.addEventListener("blur", () => onFocus(false));
  window.addEventListener("focus", () => onFocus(true));
}
