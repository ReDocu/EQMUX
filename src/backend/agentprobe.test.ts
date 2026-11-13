import { expect, test } from "vitest";
import { agentClisReady } from "./agentprobe";

test("ready만 읽어도 실측이 시작된다 — 설정부터 열면 '확인 중…'에 갇혔다 (0.6 QA B226)", () => {
  // 브라우저 경로: 실측을 시작하면 바로 '확인 끝'이 된다. agentClis()를 먼저 부르지 않는다
  expect(agentClisReady()).toBe(true);
});
