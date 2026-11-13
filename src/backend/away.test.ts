import { describe, expect, test, vi } from "vitest";
vi.mock("./mock", () => ({ backend: { listSessions: () => [], listMessages: () => [] } }));
import { awayRows, mergeAway, snapAway } from "./away";
import type { ConversationMessage, Session } from "../types";

const sess = (id: string, status: Session["status"], costUsd?: number) => ({ id, workspaceId: "w", status, costUsd }) as Session;
const msg = (from: string, to: string, ts: number, done = false) =>
  ({ id: `${from}-${ts}`, time: "", from, to, type: "report", body: "끝\n둘째 줄", unread: true, ts, done }) as ConversationMessage;

describe("자리 비운 사이 요약 (§13-5)", () => {
  test("바뀐 세션만 — 상태 · 메시지 · 비용 증분 · 완료 보고", () => {
    const snap = snapAway([sess("kai", "busy", 1), sess("rin", "idle", 2), sess("sol", "idle")], 100);
    const now = [sess("kai", "waiting", 1.5), sess("rin", "idle", 2), sess("sol", "idle")];
    const rows = awayRows(snap, now, [msg("sol", "나", 150, true), msg("나", "kai", 50)]);
    expect(rows).toEqual([
      { session: "kai", workspace: "w", was: "busy", status: "waiting", msgsIn: 0, msgsOut: 0, cost: 0.5, done: undefined },
      { session: "sol", workspace: "w", was: undefined, status: "idle", msgsIn: 0, msgsOut: 1, cost: 0, done: "끝" },
    ]);
  });
  test("바뀐 것이 없으면 빈 목록", () => {
    const s = [sess("kai", "idle", 1)];
    expect(awayRows(snapAway(s, 0), s, [])).toEqual([]);
  });
  test("팀 전체(@all)도 받은 메시지 — 보낸 본인과 다른 팀 원장은 빼고 (B235)", () => {
    const s = [sess("kai", "idle"), sess("rin", "idle")];
    const all = { ...msg("kai", "@all", 10), workspaceId: "w" };
    const other = { ...msg("나", "rin", 11), workspaceId: "다른팀" }; // 프로젝트 간 사본 — 내 팀 원장이 아니다
    const rows = awayRows(snapAway(s, 0), s, [all, other]);
    expect(rows.map((r) => [r.session, r.msgsIn, r.msgsOut])).toEqual([
      ["kai", 0, 1],
      ["rin", 1, 0],
    ]);
  });
  test("닫지 않은 카드는 처음 떠난 때부터 다시 세고, 이번에 바뀐 게 없으면 그대로 둔다 (B213)", () => {
    const first = snapAway([sess("kai", "busy")], 0);
    const card = mergeAway(undefined, first, [sess("kai", "idle")], []);
    expect(card?.rows.map((r) => [r.was, r.status])).toEqual([["busy", "idle"]]);
    // 두 번째 공백 — 그사이 변화 없음: 카드가 지워지지 않는다
    expect(mergeAway(card, snapAway([sess("kai", "idle")], 500), [sess("kai", "idle")], [])).toEqual(card);
    // 두 번째 공백에 다시 바뀌었다 — 기준은 처음 것(busy)이다
    const next = mergeAway(card, snapAway([sess("kai", "idle")], 500), [sess("kai", "waiting")], []);
    expect(next?.snap.since).toBe(0);
    expect(next?.rows.map((r) => [r.was, r.status])).toEqual([["busy", "waiting"]]);
    expect(mergeAway(undefined, first, [sess("kai", "busy")], [])).toBeUndefined();
  });
});
