// 과거 세션 검색 묶기 (0.6 §4) — 최근 대화 먼저, 대화 안은 시간 순, 슬롯 매핑은 대화 단위로 남는다
import { describe, expect, test } from "vitest";
import { groupByConversation, resumeCommand } from "./history";
import type { HistoryHit } from "./history";

const hit = (uuid: string, ts: number, extra: Partial<HistoryHit> = {}): HistoryHit => ({
  uuid,
  ts,
  role: "user",
  snippet: `${uuid}@${ts}`,
  resumable: false,
  ...extra,
});

describe("groupByConversation", () => {
  test("최근 매치가 있는 대화 먼저, 대화 안은 시간 순", () => {
    const g = groupByConversation([hit("a", 30), hit("a", 10), hit("b", 20, { session: "kai@w", resumable: true }), hit("a", 5)]);
    expect(g.map((x) => x.uuid)).toEqual(["a", "b"]);
    expect(g[0].hits.map((h) => h.ts)).toEqual([5, 10, 30]);
    expect(g[0].last).toBe(30);
    expect(g[1]).toMatchObject({ session: "kai@w", resumable: true });
    expect(g[0].session).toBeUndefined(); // null(Rust None)도 undefined로
  });

  test("빈 결과", () => {
    expect(groupByConversation([])).toEqual([]);
  });

  test("앱 밖 재개 명령", () => {
    expect(resumeCommand("abc-1")).toBe("claude --resume abc-1");
  });
});
