import { expect, test } from "vitest";
import { limitText, resetAt, worstLimit } from "./usage";

test("한도 문구 · 가장 급한 한도 (F1)", () => {
  expect(limitText({ window: "five_hour", usedPct: 71.6 })).toBe("5시간 한도 72%");
  expect(limitText({ window: "opus_week", usedPct: 3 })).toBe("opus_week 한도 3%");
  const a = { rateLimit: { window: "five_hour", usedPct: 40 } };
  const b = { rateLimit: { window: "seven_day", usedPct: 90 } };
  expect(worstLimit([a, {}, b])).toBe(b.rateLimit);
  expect(worstLimit([{}])).toBeUndefined();
});

test("재설정 시각 — 오늘이면 시:분만", () => {
  const now = new Date(2026, 10, 2, 9, 0).getTime();
  expect(resetAt({ window: "x", usedPct: 1, resetsAt: new Date(2026, 10, 2, 14, 5).getTime() / 1000 }, now)).toBe("14:05");
  expect(resetAt({ window: "x", usedPct: 1, resetsAt: new Date(2026, 10, 3, 1, 0).getTime() / 1000 }, now)).toBe("11/3 1:00");
  expect(resetAt({ window: "x", usedPct: 1 }, now)).toBeUndefined();
});
