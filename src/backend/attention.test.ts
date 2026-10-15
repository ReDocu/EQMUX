import { describe, expect, test, vi } from "vitest";
// 쌓인 메시지는 늘 2건 — 손으로 띄운 에이전트(shell + agent)에서만 세야 한다
vi.mock("./conversation", () => ({
  pendingCount: () => 2,
  unmanagedAgent: (s: { status: string; agent?: string }) => s.status === "shell" && !!s.agent,
}));
vi.mock("../state", () => ({ jumpToSession: () => true, modalOpen: () => false, setFocusRequest: () => {} }));
import {
  attentionOrder,
  attentionRank,
  fmtAgo,
  inboxWaiting,
  NOTIFY_MAX,
  pickNext,
  pushNotify,
  seenOnly,
  sessionNeedsLook,
  unlistedAttention,
} from "./attention";
import type { NotifyItem } from "./attention";
import type { Session } from "../types";

const s = (id: string, over: Partial<Session>): Session =>
  ({ id, status: "idle", sinceMs: 0, ...over }) as Session;

describe("attention", () => {
  test("순위 — waiting > 본 적 없는 dead > 메시지 대기 > 보고 전 > 완료 보고 > 턴 완료", () => {
    expect(attentionRank(s("a", { status: "waiting" }))).toBe(1);
    expect(attentionRank(s("a", { status: "dead", unseen: true }))).toBe(2);
    expect(attentionRank(s("a", { status: "dead" }))).toBe(0);
    expect(attentionRank(s("a", {}), 2)).toBe(3);
    expect(attentionRank(s("a", { reportPending: true, unseenDone: "turn" }))).toBe(4);
    expect(attentionRank(s("a", { unseenDone: "report" }))).toBe(5);
    expect(attentionRank(s("a", { unseenDone: "turn" }))).toBe(6);
    expect(attentionRank(s("a", { status: "busy" }))).toBe(0);
  });

  test("같은 순위는 오래 기다린 순, 봐야 할 것 없는 세션은 빠진다", () => {
    const order = attentionOrder([
      s("turn", { unseenDone: "turn", sinceMs: 999 }),
      s("w-new", { status: "waiting", sinceMs: 10 }),
      s("idle", {}),
      s("w-old", { status: "waiting", sinceMs: 500 }),
    ]);
    expect(order.map((x) => x.id)).toEqual(["w-old", "w-new", "turn"]);
  });

  test("메시지 대기는 손으로 띄운 에이전트만 — 관리 세션 인박스는 신호가 아니다", () => {
    const managed = s("m", { status: "idle" });
    const manual = s("u", { status: "shell", agent: "Claude" } as Partial<Session>);
    expect(inboxWaiting(managed)).toBe(0);
    expect(sessionNeedsLook(managed)).toBe(false);
    expect(inboxWaiting(manual)).toBe(2);
    expect(attentionOrder([managed, manual], inboxWaiting).map((x) => x.id)).toEqual(["u"]);
  });

  test("누를 때마다 다음으로, 끝이면 처음으로", () => {
    const order = [s("a", {}), s("b", {}), s("c", {})];
    expect(pickNext(order, undefined)?.id).toBe("a");
    expect(pickNext(order, "a")?.id).toBe("b");
    expect(pickNext(order, "c")?.id).toBe("a");
    expect(pickNext(order, "gone")?.id).toBe("a");
    expect(pickNext([], "a")).toBeUndefined();
  });

  test("벨 — 같은 세션 연속은 한 줄 ×N, 50건 상한", () => {
    const it = (session: string, ts: number) =>
      ({ id: `${session}${ts}`, session, workspace: "w", kind: "turn", title: "", body: "", ts, os: false }) as Omit<NotifyItem, "count">;
    let l: NotifyItem[] = [];
    l = pushNotify(l, it("a", 1));
    l = pushNotify(l, it("a", 2));
    l = pushNotify(l, it("a", 3));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ count: 3, ts: 3 });
    l = pushNotify(l, it("b", 4));
    l = pushNotify(l, it("a", 5));
    expect(l.map((x) => `${x.session}${x.count}`)).toEqual(["a1", "b1", "a3"]);
    for (let i = 0; i < 80; i++) l = pushNotify(l, it(`s${i}`, i));
    expect(l).toHaveLength(NOTIFY_MAX);
  });

  test("[확인 표시 지우기]는 확인만 남은 것만 — 할 일은 지울 대상이 아니다 (B75)", () => {
    expect(seenOnly(s("a", { status: "dead", unseen: true }))).toBe(true);
    expect(seenOnly(s("a", { unseenDone: "report" }))).toBe(true);
    expect(seenOnly(s("a", { unseenDone: "turn" }))).toBe(true);
    expect(seenOnly(s("a", { status: "waiting", unseenDone: "turn" }))).toBe(false);
    expect(seenOnly(s("a", { reportPending: true }))).toBe(false);
    expect(seenOnly(s("a", {}), 2)).toBe(false);
  });

  test("숫자에 들었는데 목록에 줄이 없는 세션만 따로 보인다 (U35)", () => {
    const order = [s("a", { status: "waiting" }), s("b", { status: "dead", unseen: true })];
    const item = { id: "1", session: "a", workspace: "w", kind: "waiting", title: "", body: "", ts: 0, os: false, count: 1 } as NotifyItem;
    expect(unlistedAttention(order, []).map((x) => x.id)).toEqual(["a", "b"]);
    expect(unlistedAttention(order, [item]).map((x) => x.id)).toEqual(["b"]);
  });

  test("알림 시각은 '~전' (U36)", () => {
    expect(fmtAgo(10_000)).toBe("방금");
    expect(fmtAgo(5 * 60_000)).toBe("5분 전");
    expect(fmtAgo(3 * 3_600_000)).toBe("3시간 전");
    expect(fmtAgo(2 * 86_400_000)).toBe("2일 전");
  });
});
