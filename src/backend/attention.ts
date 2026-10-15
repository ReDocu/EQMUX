// 주의 고리 (0.5 C7) — "봐야 할 세션"의 순위와 `다음 미확인으로`.
// 순위는 기획서 §UX 기반 › 주의 신호 표 하나를 따른다: 행동(waiting · dead) → 확인(메시지 대기 ·
// 보고 전 · 완료 보고 · 턴 완료). 벨 목록·대시보드 정렬·`응답 대기` 칩·Ctrl+Shift+U가 모두 이 순서다.
// 앱은 이동만 한다 — 세션에 아무것도 입력하지 않고 상태도 바꾸지 않는다(본 것 표시는 jumpToSession이 한다).
import { listen } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";
import { pendingCount, unmanagedAgent } from "./conversation";
import { backend } from "./mock";
import { isTauri } from "./pty";
import { jumpToSession, setFocusRequest } from "../state";
import type { Session } from "../types";

/** 주의 순위 — 작을수록 급하다. 0은 봐야 할 것이 없다.
 *  1 waiting · 2 dead(본 적 없음) · 3 메시지 대기 · 4 보고 전 · 5 완료 보고 · 6 턴 완료 */
export function attentionRank(s: Session, pending = 0): number {
  if (s.status === "waiting") return 1;
  if (s.status === "dead" && s.unseen) return 2;
  if (pending > 0) return 3;
  if (s.reportPending) return 4;
  if (s.unseenDone === "report") return 5;
  if (s.unseenDone === "turn") return 6;
  return 0;
}

/** "메시지 대기" 수 — 손으로 띄운 에이전트만 센다. 관리 세션의 인박스는 턴이 끝나면 저절로
 *  흘러가므로 사람이 할 일이 아니다(대시보드와 같은 규칙) */
export const inboxWaiting = (s: Session): number => (unmanagedAgent(s) ? pendingCount(s.id) : 0);

/** 순위 순, 같은 순위면 오래 기다린 순(sinceMs가 큰 쪽). 순수 함수 — 테스트가 여기를 겨눈다 */
export function attentionOrder(sessions: readonly Session[], pending: (s: Session) => number = () => 0): Session[] {
  return sessions
    .map((s) => ({ s, r: attentionRank(s, pending(s)) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => a.r - b.r || b.s.sinceMs - a.s.sinceMs)
    .map((x) => x.s);
}

/** 열린 모든 워크스페이스의 봐야 할 세션 — 벨 미확인 수·대시보드가 쓴다 */
export function attentionSessions(): Session[] {
  const open = new Set(backend.listWorkspaces().filter((w) => w.open).map((w) => w.id));
  return attentionOrder(
    backend.listSessions().filter((s) => open.has(s.workspaceId)),
    inboxWaiting,
  );
}

/** 직전에 데려간 세션 — waiting처럼 보기만 해서는 안 지워지는 신호가 있어, 누를 때마다
 *  목록에서 그 다음으로 넘어가야 같은 페인에 갇히지 않는다 */
let lastJump: string | undefined;

/** 목록과 직전 세션으로 다음 대상을 고른다 — 직전 것의 다음, 끝이면 처음으로 */
export function pickNext(order: readonly Session[], last: string | undefined): Session | undefined {
  if (order.length === 0) return undefined;
  const i = order.findIndex((s) => s.id === last);
  return order[(i + 1) % order.length];
}

/** 다음 미확인으로 (Ctrl+Shift+U · `⛶ 응답 대기` 칩) — 미확인이 없으면 아무것도 하지 않는다 */
export function nextUnseen(): Session | undefined {
  const next = pickNext(attentionSessions(), lastJump);
  if (!next) return undefined;
  lastJump = next.id;
  jumpToSession(next.workspaceId, next.id);
  setFocusRequest({ session: next.id }); // 줌 없이 키보드 포커스만 — 컨트롤 센터가 받는다
  return next;
}

// ── 알림 센터 (벨) — Rust `notify-item` 이벤트(계약 C2)를 쌓는다 ──
// 목록은 앱을 다시 켜면 비우고 최근 50건만 남긴다. 같은 세션의 연속 알림은 한 줄로 묶어 ×N.
// 읽음은 따로 세지 않는다 — 그 세션에 아직 봐야 할 신호가 있으면 미확인이다(§주의 신호).

export interface NotifyItem {
  id: string;
  session: string;
  workspace: string;
  kind: "waiting" | "dead" | "report" | "turn";
  title: string;
  body: string;
  ts: number;
  /** 실제로 OS 알림을 냈는가 — 창이 포커스였거나 음소거면 false */
  os: boolean;
  /** 같은 세션 연속 알림을 묶은 수 (프런트가 센다) */
  count: number;
}

export const NOTIFY_MAX = 50;

/** 새 항목을 목록 맨 앞에 넣는다. 맨 앞이 같은 세션이면 그 줄을 갱신하고 수만 올린다. 순수 함수 */
export function pushNotify(list: readonly NotifyItem[], it: Omit<NotifyItem, "count">): NotifyItem[] {
  const head = list[0];
  if (head && head.session === it.session) return [{ ...it, count: head.count + 1 }, ...list.slice(1)];
  return [{ ...it, count: 1 }, ...list].slice(0, NOTIFY_MAX);
}

const [notifyItems, setNotifyItems] = createSignal<NotifyItem[]>([]);
export { notifyItems };

let feedStarted = false;
/** 앱 셸이 1회 켠다 (App.tsx) */
export function startNotifyFeed(): void {
  if (feedStarted || !isTauri()) return;
  feedStarted = true;
  void listen<Omit<NotifyItem, "count">>("notify-item", (e) => setNotifyItems((l) => pushNotify(l, e.payload)));
  // OS 토스트 클릭 (P2 A2) — Rust가 창을 앞으로 올린 뒤 보낸다. 알림 센터 항목을 누른 것과 같은 길로 간다
  void listen<{ session: string }>("notify-activate", (e) => {
    const s = backend.listSessions().find((x) => x.id === e.payload.session);
    if (!s) return;
    jumpToSession(s.workspaceId, s.id);
    setFocusRequest({ session: s.id });
  });
}

/** 그 세션에 아직 봐야 할 신호가 있나 — 벨 항목의 읽음 판정과 미확인 수가 같은 규칙을 쓴다 */
export function sessionNeedsLook(s: Session): boolean {
  return !!(s.unseen || s.unseenDone || s.reportPending || inboxWaiting(s) > 0);
}

/** 벨 미확인 수 — 세션 신호에서 계산한다 (따로 세지 않는다) */
export function bellCount(): number {
  return backend.listSessions().filter(sessionNeedsLook).length;
}
