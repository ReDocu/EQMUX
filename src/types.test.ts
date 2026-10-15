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

// 세션 이름 (0.5) — 자동 이름 `프로젝트명XX`와 입력 검증
import { pickAutoName, projectStem, sessionNameError } from "./types";

describe("세션 이름", () => {
  test("프로젝트명은 글자·숫자·-·_만 16자까지, 대소문자 그대로", () => {
    expect(projectStem("EQMUX")).toBe("EQMUX");
    expect(projectStem("my app.v2 (copy)")).toBe("myappv2copy");
    expect(projectStem("한글-프로젝트_이름이아주아주길다")).toBe("한글-프로젝트_이름이아주아주길");
  });

  test("슬롯 번호로 붙이고, 남이 쓰고 있으면 비어 있는 가장 작은 번호", () => {
    expect(pickAutoName("EQMUX", 3, new Set())).toBe("EQMUX03");
    expect(pickAutoName("EQMUX", 2, new Set(["eqmux02", "eqmux01"]))).toBe("EQMUX03");
  });

  test("24자 · 공백 · @ · 중복은 거부, 빈 값은 통과", () => {
    expect(sessionNameError("", new Set())).toBeUndefined();
    expect(sessionNameError("카이", new Set())).toBeUndefined();
    expect(sessionNameError("a".repeat(25), new Set())).toBeDefined();
    expect(sessionNameError("백엔드 카이", new Set())).toBeDefined();
    expect(sessionNameError("kai@ws", new Set())).toBeDefined();
    expect(sessionNameError("Kai", new Set(["kai"]))).toBeDefined();
  });
});

// 캐스팅 재적용 (0.5) — 남는 세션의 슬롯은 그대로, 새 페르소나만 빈 슬롯에
import { planCastingSlots } from "./types";

describe("planCastingSlots", () => {
  const cur = [
    { id: "lin@w", slot: 1, personaId: "lin" },
    { id: "kai@w", slot: 2, personaId: "kai" },
    { id: "noel@w", slot: 3, personaId: "noel" },
    { id: "shell4@w", slot: 4, personaId: "" },
  ];
  test("카이를 빼고 다시 적용해도 노엘은 03, 기본 터미널 자리도 그대로", () => {
    expect(planCastingSlots(cur, ["lin@w", "noel@w"], 8)).toEqual([1, 3]);
  });
  test("새 페르소나는 비워질 자리부터 앞에서 채운다", () => {
    expect(planCastingSlots(cur, ["lin@w", "noel@w", "rin@w", "mio@w"], 8)).toEqual([1, 3, 2, 5]);
  });
  test("빈 슬롯이 모자라면 undefined", () => {
    expect(planCastingSlots(cur, ["lin@w", "kai@w", "noel@w", "rin@w"], 4)).toEqual([1, 2, 3, undefined]);
  });
});
