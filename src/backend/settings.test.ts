import { expect, test } from "vitest";
import { sanitize } from "./settings";

test("스크롤백 재생은 저장 상한 1,000줄 이하만 — 옛 2,000은 1,000으로 옮긴다 (B78)", () => {
  expect(sanitize({ scrollbackReplay: 250 }).scrollbackReplay).toBe(250);
  expect(sanitize({ scrollbackReplay: 1000 }).scrollbackReplay).toBe(1000);
  expect(sanitize({ scrollbackReplay: 2000 }).scrollbackReplay).toBe(1000);
  expect(sanitize({ scrollbackReplay: 777 }).scrollbackReplay).toBe(500);
});
