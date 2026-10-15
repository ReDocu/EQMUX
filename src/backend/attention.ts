// 주의 고리 (0.5 C7) — "봐야 할 세션"의 순위와 `다음 미확인으로`.
// 순위는 기획서 §UX 기반 › 주의 신호 표 하나를 따른다: 행동(waiting · dead) → 확인(메시지 대기 ·
// 보고 전 · 완료 보고 · 턴 완료). 벨 목록·대시보드 정렬·`응답 대기` 칩·Ctrl+Shift+U가 모두 이 순서다.
// 앱은 이동만 한다 — 세션에 아무것도 입력하지 않고 상태도 바꾸지 않는다(본 것 표시는 jumpToSession이 한다).
import { listen } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";
import { pendingCount, unmanagedAgent } from "./conversation";
import { backend } from "./mock";
import { isTauri } from "./pty";
import { jumpToSession, modalOpen, setFocusRequest } from "../state";
import { t, tf } from "../i18n";
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

/** 봐야 할 세션 전부 — 벨 미확인 수·`다음 미확인으로`·벨의 '지금 봐야 할 세션'이 같은 집합을 쓴다.
 *  닫은 워크스페이스(탭만 접기 — 세션은 돈다)도 넣는다. 예전엔 여기만 열린 것으로 걸러서 벨은
 *  1인데 `다음 미확인으로`는 무반응이었다 (B74). 데려갈 때 jumpToSession이 그 탭을 다시 연다 (B18) */
export function attentionSessions(): Session[] {
  return attentionOrder(backend.listSessions(), inboxWaiting);
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
  if (modalOpen()) return undefined; // 모달 뒤에서만 화면이 바뀌지 않게 (B72) — 단축키는 App이 안내를 띄운다
  const next = pickNext(attentionSessions(), lastJump);
  // 미저장 편집이 팝업을 붙들면 데려가지 않는다 — 그때 다음으로 넘기면 보지도 못한 세션을 건너뛴다
  if (!next || !jumpToSession(next.workspaceId, next.id)) return undefined;
  lastJump = next.id;
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
  kind: "waiting" | "dead" | "report" | "turn" | "message";
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
/** 앱 안에서 생긴 알림 — 손으로 띄운 에이전트에 메시지가 쌓였을 때(conversation.ts). Rust를 거치지 않는다 */
export function notifyLocal(it: Omit<NotifyItem, "count" | "id" | "ts" | "os">): void {
  const ts = Date.now();
  setNotifyItems((l) => pushNotify(l, { ...it, id: `${it.session}-${ts}`, ts, os: false }));
}

export function startNotifyFeed(): void {
  if (feedStarted || !isTauri()) return;
  feedStarted = true;
  void listen<Omit<NotifyItem, "count">>("notify-item", (e) => setNotifyItems((l) => pushNotify(l, e.payload)));
  // OS 토스트 클릭 (P2 A2) — Rust가 창을 앞으로 올린 뒤 보낸다. 알림 센터 항목을 누른 것과 같은 길로 간다
  void listen<{ session: string }>("notify-activate", (e) => {
    const s = backend.listSessions().find((x) => x.id === e.payload.session);
    // 모달이 떠 있으면 창만 앞으로 온다 — 모달 뒤에서 화면을 옮기지 않는다 (B72)
    if (!s || modalOpen() || !jumpToSession(s.workspaceId, s.id)) return;
    setFocusRequest({ session: s.id });
  });
}

/** 그 세션에 아직 봐야 할 신호가 있나 — 벨 항목의 읽음 판정과 미확인 수가 같은 규칙을 쓴다 */
export function sessionNeedsLook(s: Session): boolean {
  // 대시보드와 같은 규칙 — 주의 순위가 있는 세션만. unseen 하나로 세면 waiting·dead가 아닌데
  // 남은 옛 표식(재시작 복원 등)까지 세어, 벨은 1인데 목록·대시보드는 0인 어긋남이 났다
  return attentionRank(s, inboxWaiting(s)) > 0;
}

/** 벨 미확인 수 — 세션 신호에서 계산한다 (따로 세지 않는다) */
export function bellCount(): number {
  return attentionSessions().length;
}

/** 확인 표시만 남은 세션인가 — 본 적 없는 dead · 완료 보고 · 턴 완료. [확인 표시 지우기](markAllSeen)가
 *  지울 수 있는 것은 이것뿐이다. waiting·메시지 대기·보고 전은 할 일이라 남는다 (B75) */
export function seenOnly(s: Session, pending = 0): boolean {
  const r = attentionRank(s, pending);
  return r === 2 || r === 5 || r === 6;
}

/** 벨 목록(notify-item 기록)에 안 읽은 줄이 없는 봐야 할 세션 — 재시작으로 기록이 비었거나
 *  목 모드처럼 기록이 없을 때도 숫자에 든 세션이 목록에 보이게 한다 (U35). 순수 함수 */
export function unlistedAttention(order: readonly Session[], items: readonly NotifyItem[]): Session[] {
  const listed = new Set(items.map((it) => it.session));
  return order.filter((s) => !listed.has(s.id));
}

/** 알림이 온 지 얼마나 됐나 — '5분 전'. fmtSince('5분째')는 상태가 계속된 시간이라 뜻이 다르다 (U36) */
export function fmtAgo(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return t("방금");
  if (m < 60) return tf("{m}분 전", { m });
  if (m < 1440) return tf("{h}시간 전", { h: Math.floor(m / 60) });
  return tf("{d}일 전", { d: Math.floor(m / 1440) });
}
