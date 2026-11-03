import { describe, expect, test } from "vitest";
import { costDelta, dayKey, midnight } from "./budget";

describe("하루 비용 예산 (§13-6)", () => {
  test("처음 보는 세션은 기준선, 늘면 차이, 줄면 새 에이전트라 그 값", () => {
    expect(costDelta(undefined, 3)).toBe(0);
    expect(costDelta(1.25, 2)).toBe(0.75);
    expect(costDelta(5, 0.5)).toBe(0.5);
  });
  test("날짜 키는 로컬 자정에 바뀐다", () => {
    expect(dayKey(new Date(2026, 10, 2, 23, 59).getTime())).not.toBe(dayKey(new Date(2026, 10, 3, 0, 1).getTime()));
    expect(midnight(new Date(2026, 10, 2, 13, 7).getTime())).toBe(new Date(2026, 10, 2).getTime());
  });
});
