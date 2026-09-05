// 주입 본문 단위 테스트 — 전달 경로(PTY·인박스)는 통합의 몫이고, 여기서는 "여러 건을 어떻게
// 한 줄로 접는가"만 본다: 단건/묶음 접두 · 개행 평탄화 · 상한에서 덩어리 갈리기.
import { describe, expect, test } from "vitest";
import { batches, fmt } from "./conversation";
import type { ConversationMessage } from "../types";

const msg = (from: string, body: string, type: ConversationMessage["type"] = "ask"): ConversationMessage => ({
  id: `${from}:${body.length}`,
  time: "12:00",
  from,
  type,
  to: "@all",
  body,
  unread: true,
});

describe("fmt", () => {
  test("단건은 짧은 접두 하나", () => {
    expect(fmt([msg("나", "빌드 봐줘")])).toBe("[EQ·ask] 나: 빌드 봐줘");
  });

  test("줄바꿈은 공백으로 눌린다 — TUI에서 개행은 곧 제출이라", () => {
    expect(fmt([msg("나", "첫 줄\n  둘째 줄")])).toBe("[EQ·ask] 나: 첫 줄 둘째 줄");
  });

  test("여러 건은 한 줄 — 래퍼도 턴도 하나", () => {
    const line = fmt([msg("나", "a"), msg("코더", "b", "report")]);
    expect(line).toBe("[EQ 2건] 1) 나·ask: a 2) 코더·report: b");
  });

  test("꼬리는 맨 끝에 한 번만", () => {
    const line = fmt([msg("나", "a"), msg("나", "b")], " (답신은 코더의 말투로)");
    expect(line.match(/답신은/g)).toHaveLength(1);
    expect(line.endsWith(" (답신은 코더의 말투로)")).toBe(true);
  });
});

describe("batches", () => {
  test("상한 아래면 한 덩어리", () => {
    expect(batches([msg("나", "a"), msg("나", "b")])).toHaveLength(1);
  });

  test("상한을 넘으면 갈린다", () => {
    const big = () => msg("나", "x".repeat(1500));
    expect(batches([big(), big(), big(), big()]).map((b) => b.length)).toEqual([2, 2]);
  });

  test("혼자서 상한을 넘는 한 건도 버려지지 않는다", () => {
    const huge = msg("나", "x".repeat(9000));
    expect(batches([huge, msg("나", "a")])).toEqual([[huge], [msg("나", "a")]]);
  });

  test("빈 입력은 빈 결과", () => {
    expect(batches([])).toEqual([]);
  });
});
