// 엔진별 실행 플래그 문자열 (M37) — Rust agent.rs의 codex_permission_args·codex_git_rules와 같은
// 번역이어야 한다. 화면(세션 상세 "실제/예상 실행 플래그")이 이 문자열을 그대로 보여주므로,
// 여기가 틀리면 사람은 막혀 있지 않은 것을 막혀 있다고 믿는다.
import { describe, expect, test } from "vitest";
import { agentFlagsToString, codexFlagsToString, detectedCli, engineSwitched, flagsToString, handoffReport, nameBesideNo, paneNo, slotBesideNo, statusText, translatePermissions, trimStream } from "./types";
import type { ConversationMessage } from "./types";

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

// 번호 칸 옆 이름 — `03 EQMUX03`처럼 번호가 두 번 보이지 않게, 이름 끝 숫자가 슬롯과 같을 때만 뗀다
describe("nameBesideNo", () => {
  test("자동 이름과 직접 쓴 구분자 이름의 끝 번호를 뗀다", () => {
    expect(nameBesideNo(3, "EQMUX03")).toBe("EQMUX");
    expect(nameBesideNo(3, "app-03")).toBe("app");
    expect(nameBesideNo(12, "my_proj_12")).toBe("my_proj");
  });

  test("슬롯과 다른 번호·숫자로 끝나지 않는 이름·숫자만인 이름은 그대로", () => {
    expect(nameBesideNo(3, "EQMUX04")).toBe("EQMUX04");
    expect(nameBesideNo(4, "카이")).toBe("카이");
    expect(nameBesideNo(3, "03")).toBe("03");
    expect(nameBesideNo(3, "R2D203")).toBe("R2D203");
  });
});

// 페인 번호 칸 — Claude Code가 붙인 세션 이름(`redocu-92`)이 있으면 그 끝 조각, 없으면 슬롯 번호
describe("paneNo", () => {
  test("Claude Code 세션 이름의 끝 조각", () => {
    expect(paneNo({ slot: 1, peerName: "redocu-92" })).toBe("92");
    expect(paneNo({ slot: 2, peerName: "redocu-ca" })).toBe("ca");
    expect(paneNo({ slot: 3, peerName: "my-app-7f" })).toBe("7f");
  });

  test("이름이 없거나 구분자가 없으면 슬롯 번호", () => {
    expect(paneNo({ slot: 3 })).toBe("03");
    expect(paneNo({ slot: 4, peerName: "kai" })).toBe("04");
  });

  test("끝 조각이 다른 슬롯 번호로 읽히면 슬롯 번호 (B83)", () => {
    expect(paneNo({ slot: 3, peerName: "redocu-05" })).toBe("03");
    expect(paneNo({ slot: 5, peerName: "redocu-05" })).toBe("05");
  });
});

// 번호 칸이 피어 끝 조각이면 이름의 슬롯 번호를 떼지 않는다 — 03이 화면에서 사라졌다 (B83)
describe("nameBesideNo · 번호 칸 글자 기준", () => {
  test("번호 칸 글자와 같을 때만 뗀다", () => {
    expect(nameBesideNo("92", "EQMUX03")).toBe("EQMUX03");
    expect(nameBesideNo("03", "EQMUX03")).toBe("EQMUX");
  });
});

// 엔진이 바뀐 재시작 (B82) — 참이면 재시작은 '대화 유지'가 아니라 새 엔진으로 새로 시작이다
describe("engineSwitched", () => {
  test("띄운 엔진과 슬롯 엔진이 다를 때만 참", () => {
    expect(engineSwitched({ spawnCli: "claude", cli: "codex" })).toBe(true);
    expect(engineSwitched({ spawnCli: "codex" })).toBe(true); // cli 없음 = claude
    expect(engineSwitched({ spawnCli: "codex", cli: "codex" })).toBe(false);
    expect(engineSwitched({ cli: "codex" })).toBe(false); // 이 앱이 띄운 기록이 없으면 모른다
  });
});

// 맡은 일의 보고 상태 (U31) — 진척 report를 보냈으면 '보고 전'이 아니다
describe("handoffReport", () => {
  const m = (from: string, to: string, type: ConversationMessage["type"], done?: boolean): ConversationMessage => ({
    id: Math.random().toString(),
    time: "",
    from,
    to,
    type,
    body: "",
    unread: false,
    done,
  });
  test("handoff만 있으면 none, 그 뒤 진척 report면 progress, report --done이면 닫힘", () => {
    const h = m("a", "b", "handoff");
    expect(handoffReport([h], "b")).toBe("none");
    expect(handoffReport([h, m("b", "a", "report")], "b")).toBe("progress");
    expect(handoffReport([h, m("b", "a", "report"), m("b", "a", "report", true)], "b")).toBeUndefined();
  });
  test("handoff보다 앞선 report는 세지 않고, 사람의 ask는 맡긴 일이 아니다", () => {
    expect(handoffReport([m("b", "a", "report"), m("a", "b", "handoff")], "b")).toBe("none");
    expect(handoffReport([m("나", "b", "ask")], "b")).toBeUndefined();
  });
});

// 감지된 에이전트 이름 → 엔진 (U42) — 같으면 대시보드가 배지를 숨기고, 다르면 어긋남을 보인다
describe("detectedCli", () => {
  test("Claude·Codex 표시 이름을 엔진 id로, 모르는 CLI는 undefined", () => {
    expect(detectedCli("Claude")).toBe("claude");
    expect(detectedCli("Codex")).toBe("codex");
    expect(detectedCli("aider")).toBeUndefined();
    expect(detectedCli(undefined)).toBeUndefined();
  });
});

// 번호 칸 옆 작은 슬롯 번호 (B83 2차) — 피어 끝 조각일 때만
describe("slotBesideNo", () => {
  test("번호 칸이 슬롯 번호가 아니면 슬롯 번호를 함께", () => {
    expect(slotBesideNo(3, "92")).toBe("03");
    expect(slotBesideNo(3, "03")).toBeUndefined();
  });
});

// 상태 표시 (U29) — 한국어 화면(기본)은 한국어
describe("statusText", () => {
  test("한국어 기본 설정에서 상태를 한국어로", () => {
    expect(statusText("waiting")).toBe("응답 대기");
    expect(statusText("idle")).toBe("유휴");
  });
});

describe("trimStream (CPU·RAM M3)", () => {
  const msg = (id: string, ws?: string): ConversationMessage => ({ id, time: "", from: "a", to: "b", type: "ask", body: "", unread: false, workspaceId: ws });
  test("그 워크스페이스의 가장 오래된 것부터 상한까지만 걷어내고, 다른 워크스페이스는 건드리지 않는다", () => {
    const list = [msg("1", "A"), msg("x", "B"), msg("2", "A"), msg("3", "A")];
    expect(trimStream(list, "A", 2)).toBe(1);
    expect(list.map((m) => m.id)).toEqual(["x", "2", "3"]);
    expect(trimStream(list, "A", 2)).toBe(0);
    expect(trimStream(list, "B", 0)).toBe(1);
    expect(list.map((m) => m.id)).toEqual(["2", "3"]);
  });
});
