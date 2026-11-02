// 순서 역전 가드 단위 테스트 (P-4) — 스냅숏(agent_snapshot)과 실시간 이벤트(agent-state)가
// 겹치는 창(웹뷰 재시작 직후)에서 더 오래된 페이로드가 신선한 상태를 덮지 않아야 한다.
// 화면 반영과 인박스 배출이 이 판정 하나를 공유한다 — 갈리면 버려진 idle로 인박스가 배출돼
// 이미 busy로 넘어간 세션에 주입이 끼어든다 (P-2).
import { describe, expect, test } from "vitest";
import { APPROVAL_WAIT_MS, approvalExpired, canRespondInline, staleSeq, stillWaitingFor } from "./agent";

describe("staleSeq", () => {
  test("순번이 앞으로 가면 받고, 뒤로 가면 버린다", () => {
    expect(staleSeq("a@ws", 10)).toBe(false);
    expect(staleSeq("a@ws", 11)).toBe(false);
    expect(staleSeq("a@ws", 9)).toBe(true); // 뒤늦게 도착한 스냅숏
    expect(staleSeq("a@ws", 12)).toBe(false); // 하한은 11 그대로 — 버린 값이 덮지 않았다
  });

  test("같은 순번은 통과시킨다 — 재적용은 멱등이고, 막으면 스냅숏 초기값을 잃는다", () => {
    expect(staleSeq("b@ws", 5)).toBe(false);
    expect(staleSeq("b@ws", 5)).toBe(false);
  });

  test("세션마다 하한이 따로다 — 남의 세션 순번이 내 이벤트를 버리지 않는다", () => {
    expect(staleSeq("c@ws", 100)).toBe(false);
    expect(staleSeq("d@ws", 1)).toBe(false);
  });

  test("순번 없는 페이로드는 그대로 받는다 (FR-D-64 부분 파싱)", () => {
    expect(staleSeq("e@ws", 50)).toBe(false);
    expect(staleSeq("e@ws", undefined)).toBe(false);
    expect(staleSeq("e@ws", 49)).toBe(true); // 하한은 여전히 50
  });
});

describe("승인함 (§13-4 · C2)", () => {
  const bash = { tool: "Bash", input: "npm publish", kind: "tool" as const };
  test("도구 승인만 바로 답하고, 질문·계획은 페인으로", () => {
    expect(canRespondInline({ status: "waiting", pendingTool: bash })).toBe(true);
    expect(canRespondInline({ status: "waiting", pendingTool: { ...bash, kind: "question" } })).toBe(false);
    expect(canRespondInline({ status: "busy", pendingTool: bash })).toBe(false);
  });
  test("Codex · 시한(570초)이 지난 대기는 버튼을 내지 않는다 (B212)", () => {
    expect(canRespondInline({ status: "waiting", pendingTool: bash, cli: "codex" })).toBe(false);
    expect(canRespondInline({ status: "waiting", pendingTool: bash, sinceMs: APPROVAL_WAIT_MS - 1 })).toBe(true);
    expect(canRespondInline({ status: "waiting", pendingTool: bash, sinceMs: APPROVAL_WAIT_MS })).toBe(false);
    expect(approvalExpired({ status: "waiting", pendingTool: bash, sinceMs: APPROVAL_WAIT_MS })).toBe(true);
    expect(approvalExpired({ status: "waiting", pendingTool: bash, sinceMs: 1000 })).toBe(false);
    expect(approvalExpired({ status: "waiting", pendingTool: bash, cli: "codex", sinceMs: APPROVAL_WAIT_MS })).toBe(false);
  });
  test("누르기 직전 — 같은 도구·원문으로 아직 기다릴 때만 넣는다", () => {
    expect(stillWaitingFor({ status: "waiting", pendingTool: bash }, bash)).toBe(true);
    expect(stillWaitingFor({ status: "busy", pendingTool: undefined }, bash)).toBe(false);
    expect(stillWaitingFor({ status: "waiting", pendingTool: { ...bash, input: "rm -rf x" } }, bash)).toBe(false);
    expect(stillWaitingFor(undefined, bash)).toBe(false);
  });
});
