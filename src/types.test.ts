// 엔진별 실행 플래그 문자열 (M37) — Rust agent.rs의 codex_permission_args·codex_git_rules와 같은
// 번역이어야 한다. 화면(세션 상세 "실제/예상 실행 플래그")이 이 문자열을 그대로 보여주므로,
// 여기가 틀리면 사람은 막혀 있지 않은 것을 막혀 있다고 믿는다.
import { describe, expect, test } from "vitest";
import { agentFlagsToString, codexFlagsToString, flagsToString, translatePermissions } from "./types";

describe("codexFlagsToString", () => {
  test("write:false는 읽기 전용 샌드박스, 승인은 언제나 on-request — bypass는 없다", () => {
    const s = codexFlagsToString(translatePermissions({ write: false, commit: false, push: false }));
    expect(s).toContain("--sandbox read-only");
    expect(s).toContain("--ask-for-approval on-request");
    expect(s).not.toContain("dangerously");
  });

  test("write:true는 워크스페이스 쓰기이고, git 금지는 플래그가 아니라 지시라고 밝힌다", () => {
    const s = codexFlagsToString(translatePermissions({ write: true, commit: false, push: false }));
    expect(s).toContain("--sandbox workspace-write");
    expect(s).toContain("(지시로만: Bash(git commit *) Bash(git push *))");
    // Claude 전용 플래그는 섞이지 않는다
    expect(s).not.toContain("--permission-mode");
    expect(s).not.toContain("--disallowedTools");
  });

  test("전권이면 지시 꼬리가 없고, 세션 id는 재개 앵커로만 보인다", () => {
    const s = codexFlagsToString(translatePermissions({ write: true, commit: true, push: true }), "01a0c1fc");
    expect(s).toBe("--sandbox workspace-write --ask-for-approval on-request resume 01a0c1fc");
  });

  test("agentFlagsToString은 엔진으로 갈린다 — 없으면 Claude", () => {
    const f = translatePermissions({ write: true, commit: true, push: false });
    expect(agentFlagsToString(undefined, f, "u1")).toBe(flagsToString(f, "u1"));
    expect(agentFlagsToString("claude", f)).toBe(flagsToString(f));
    expect(agentFlagsToString("codex", f)).toBe(codexFlagsToString(f));
  });
});
