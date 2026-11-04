// 과거 세션 검색 묶기 (0.6 §4) — 최근 대화 먼저, 대화 안은 시간 순, 슬롯 매핑은 대화 단위로 남는다
import { describe, expect, test } from "vitest";
import { groupByConversation, resumeCommand, subagentCalls, subagentDone } from "./history";
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

  test("워크트리 대화는 그 워크트리 폴더를 대화 단위로 싣는다 (S24)", () => {
    const wt = "D:\\w\\app\\.eqmux\\worktrees\\kai@w";
    const g = groupByConversation([hit("a", 10, { worktree: wt }), hit("b", 5)]);
    expect(g.map((x) => x.worktree)).toEqual([wt, undefined]);
  });

  test("빈 결과", () => {
    expect(groupByConversation([])).toEqual([]);
  });

  test("앱 밖 재개 명령", () => {
    expect(resumeCommand("abc-1", "D:\\work\\내 앱")).toBe('cd "D:\\work\\내 앱"; claude --resume abc-1');
    // cmd는 ;를 구분자로 쓰지 않고 /d 없이는 드라이브를 바꾸지 않는다 (B259)
    expect(resumeCommand("abc-1", "D:\\work", "cmd")).toBe('cd /d "D:\\work" && claude --resume abc-1');
    expect(resumeCommand("abc-1", "D:\\work", "pwsh")).toBe('cd "D:\\work"; claude --resume abc-1');
  });
});

describe("subagentCalls", () => {
  test("Agent · Task 도구 턴만 고른다", () => {
    const turn = (role: string, text: string) => ({ role, text, summary: null });
    const turns = [turn("tool", "⚙ Agent"), turn("tool", "⚙ Bash"), turn("agent", "⚙ Agent"), turn("tool", "⚙ Task")];
    expect(subagentCalls(turns)).toEqual([turns[0], turns[3]]);
  });

  test("tool_result가 짝지어진 호출만 끝남 (U159)", () => {
    const input = (v: object) => `입력:\n${JSON.stringify(v, null, 2)}`; // transcript.rs와 같은 pretty JSON
    expect(subagentDone({ detail: `${input({ description: "출력: 정리" })}\n출력:\n완료` })).toBe(true);
    expect(subagentDone({ detail: input({ prompt: "a\n출력: b" }) })).toBe(false); // 입력 안의 줄바꿈은 \\n으로 이스케이프된다
    expect(subagentDone({ detail: null })).toBe(false);
  });
});
