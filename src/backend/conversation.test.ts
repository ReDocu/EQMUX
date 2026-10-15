// 주입 본문 단위 테스트 — 전달 경로(PTY·인박스)는 통합의 몫이고, 여기서는 "여러 건을 어떻게
// 한 줄로 접는가"만 본다: 단건/묶음 접두 · 개행 평탄화 · 상한에서 덩어리 갈리기.
import { describe, expect, test } from "vitest";
import { batches, fmt, fmtEcho, goneName, unmanagedAgent } from "./conversation";
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

// 발신자 표기 (BR-14) — 원장의 세션 id가 아니라 받은 그대로 `--to @이름`으로 답할 수 있는 이름
describe("fmt 발신자 이름", () => {
  test("label이 세션 id를 이름으로 푼다", () => {
    const m = msg("kai@eqmux-1e3b93", "로그인 API 봐줘");
    expect(fmt([m], "", () => "카이")).toBe("[EQ·ask] 카이: 로그인 API 봐줘");
  });

  test("묶음에서도 건마다 이름", () => {
    const line = fmt([msg("kai@ws", "a"), msg("noel@ws", "b")], "", (m) => (m.from === "kai@ws" ? "카이" : "노엘@app-b"));
    expect(line).toBe("[EQ 2건] 1) 카이·ask: a 2) 노엘@app-b·ask: b");
  });

  test("--file 첨부는 경로가 따라간다", () => {
    const m = { ...msg("나", "요약"), file: { path: ".eqmux/notes/a.md", size: 10 } };
    expect(fmt([m])).toBe("[EQ·ask] 나: 요약 (파일: .eqmux/notes/a.md)");
  });

  test("기본 터미널 에코도 같은 머리 — 내부 id가 나오지 않는다", () => {
    const line = fmtEcho(msg("kai@eqmux-1e3b93", "hi"), "카이");
    expect(line).toContain("[EQ·ask] 카이: hi");
    expect(line).not.toContain("@eqmux");
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

// 에코냐 주입이냐를 가르는 한 줄 — 여기가 틀리면 손으로 띄운 TUI 화면에 우리가 줄을 끼워 넣어
// 이후 재그리기가 전부 어긋난다(잔상·엉뚱한 커서), 또는 관리 세션의 유휴 판정을 건너뛴다.
describe("unmanagedAgent", () => {
  test("shell인데 프로세스 트리에 에이전트가 보이면 손으로 띄운 것", () => {
    expect(unmanagedAgent({ status: "shell", agent: "Codex" })).toBe(true);
  });

  test("맨 셸은 아니다 — 에코가 맞는 자리", () => {
    expect(unmanagedAgent({ status: "shell" })).toBe(false);
  });

  test("관리 세션은 아니다 — 돌고 있는 동안 status가 shell일 수 없다", () => {
    for (const status of ["starting", "busy", "waiting", "idle", "dead"]) {
      expect(unmanagedAgent({ status, agent: "Claude", personaId: "kai" })).toBe(false);
    }
  });

  test("기본 터미널의 에이전트는 레지스트리가 채택해 idle·busy여도 손으로 띄운 것", () => {
    for (const status of ["idle", "busy", "waiting"]) {
      expect(unmanagedAgent({ status, agent: "Claude", personaId: "" })).toBe(true);
    }
  });
});

// 사라진 세션의 이름 — 원장에 남은 보낸 때 이름 → id 앞부분 페르소나 → id 그대로
describe("goneName", () => {
  const personas = [{ id: "kai", name: "카이" }];
  test("원장 이름이 먼저다", () => {
    const ledger = new Map([["shell1@ws-1", "EQMUX01"]]);
    expect(goneName("shell1@ws-1", ledger, personas)).toBe("EQMUX01");
  });
  test("원장 이름이 없으면 id 앞부분의 페르소나 이름", () => {
    expect(goneName("kai@ws-1", new Map(), personas)).toBe("카이");
  });
  test("둘 다 없으면 id 그대로 — 나·@all도 원문으로 남는다", () => {
    expect(goneName("shell2@ws-1", new Map(), personas)).toBe("shell2@ws-1");
    expect(goneName("나", new Map(), personas)).toBe("나");
  });
});
