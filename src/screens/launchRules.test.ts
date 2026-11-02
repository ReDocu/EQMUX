import { describe, expect, it } from "vitest";
import { defaultTerminalPlan, openView, quickStartSlots, wizardSteps } from "./launchRules";

describe("워크스페이스 열기 (U60 · B107)", () => {
  it("세션이 없으면 마법사, 있으면 그 탭", () => {
    expect(openView("w1", 0)).toEqual({ kind: "launch", wsId: "w1" });
    expect(openView("w1", 4)).toEqual({ kind: "workspace", id: "w1" });
  });
});

describe("기본 터미널 슬롯 (B107)", () => {
  const role = (slot: number) => ({ slot, personaId: "kai", status: "idle" });
  it("첫 빈 슬롯에 연다", () => {
    expect(defaultTerminalPlan([role(1), role(3)], 4)).toEqual({ slot: 2 });
  });
  it("슬롯이 가득 차면 막는다 — 예전에는 아무 반응 없이 탭으로 넘어갔다", () => {
    expect(defaultTerminalPlan([1, 2, 3, 4].map(role), 4)).toEqual({ blocked: "full" });
  });
  it("살아 있는 기본 터미널이 있으면 새로 만들지 않고, 꺼진 것은 그 슬롯에서 되살린다", () => {
    const def = (status: string) => ({ slot: 4, personaId: "", status });
    expect(defaultTerminalPlan([role(1), def("shell")], 4)).toEqual({ blocked: "live" });
    expect(defaultTerminalPlan([1, 2, 3].map(role).concat(def("dead")), 4)).toEqual({ slot: 4 });
  });
});

describe("빠른 시작 · 단계 표시 (§10 · P49)", () => {
  it("리드·개발 직무가 맞는 페르소나를 먼저 고르고, 없으면 라이브러리 순서", () => {
    const ps = [{ id: "a", job: "qa" }, { id: "b", job: "dev" }, { id: "c", job: "lead" }];
    expect(quickStartSlots(ps, ["lead", "dev", "qa"])).toEqual([
      { personaId: "c", jobId: "lead" },
      { personaId: "b", jobId: "dev" },
    ]);
    expect(quickStartSlots([{ id: "a" }, { id: "b" }], ["lead", "dev"])).toEqual([
      { personaId: "a", jobId: "lead" },
      { personaId: "b", jobId: "dev" },
    ]);
  });
  it("페르소나가 하나면 리드만, 직무가 없으면 그 자리를 뺀다", () => {
    expect(quickStartSlots([{ id: "a", job: "dev" }], ["lead", "dev"])).toEqual([{ personaId: "a", jobId: "lead" }]);
    expect(quickStartSlots([{ id: "a" }, { id: "b" }], ["dev"])).toEqual([{ personaId: "a", jobId: "dev" }]);
  });
  it("모든 갈래의 끝은 워크스페이스다", () => {
    expect(wizardSteps("quick")).toEqual(["저장소 연결", "실행 방식", "워크스페이스"]);
    expect(wizardSteps("team").at(-1)).toBe("워크스페이스");
    expect(wizardSteps("terminal")).toHaveLength(4);
  });
});
