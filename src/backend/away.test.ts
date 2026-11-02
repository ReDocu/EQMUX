import { describe, expect, test, vi } from "vitest";
vi.mock("./mock", () => ({ backend: { listSessions: () => [], listMessages: () => [] } }));
import { awayRows, snapAway } from "./away";
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
});
