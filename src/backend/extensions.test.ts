import { describe, expect, test } from "vitest";
import { duplicateNames, mcpCommand, parseAlwaysOn, parseMcpList, parsePluginList, sessionCell, validSkillName } from "./extensions";
import type { SkillRow } from "./extensions";

describe("확장 출력 해석 (§12)", () => {
  test("plugin list --json — 모양이 어긋난 항목은 버리고, 깨진 출력은 빈 목록", () => {
    const rows = parsePluginList(
      JSON.stringify([
        { id: "ponytail@ponytail", version: "4.8.4", scope: "user", enabled: true, installPath: "C:\\p", projectEnabled: false },
        { version: "1" },
        { id: "off@m", scope: "local", enabled: false },
      ]),
    );
    expect(rows.map((r) => [r.id, r.enabled])).toEqual([
      ["ponytail@ponytail", true],
      ["off@m", false],
    ]);
    expect(parsePluginList("not json")).toEqual([]);
    expect(parsePluginList("{}")).toEqual([]);
  });

  test("details의 상시 토큰 비용", () => {
    expect(parseAlwaysOn("Projected token cost\n  Always-on:   ~985 tok   added to every session")).toBe(985);
    expect(parseAlwaysOn("Always-on: ~1.2k tok")).toBe(1200);
    expect(parseAlwaysOn("nothing")).toBeUndefined();
  });

  test("mcp list 줄 — 상태 기호를 읽고 모르는 줄은 원문으로", () => {
    const out = parseMcpList(
      [
        "Checking MCP server health…",
        "",
        "claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected",
        "pencil: C:\\Pen\\mcp.exe --app desktop - ✗ Failed to connect",
        "figma: npx figma-mcp - ⏸ Pending approval",
        "sentry: https://mcp.sentry.dev/mcp (HTTP) - ! Needs authentication",
        "something new",
      ].join("\n"),
    );
    expect(out.map((r) => [r.name, r.state])).toEqual([
      ["claude.ai Claude Docs", "ok"],
      ["pencil", "fail"],
      ["figma", "pending"],
      ["sentry", "auth"],
      ["something new", "unknown"],
    ]);
  });

  test("스킬 이름 규칙과 같은 이름 표시", () => {
    expect(validSkillName("review-pr")).toBe(true);
    expect(validSkillName("Review")).toBe(false);
    expect(validSkillName("-x")).toBe(false);
    expect(validSkillName("a".repeat(65))).toBe(false);
    const r = (name: string, scope: SkillRow["scope"]) => ({ name, scope }) as SkillRow;
    expect([...duplicateNames([r("a", "user"), r("a", "project"), r("b", "user")])]).toEqual(["a"]);
  });

  test("세션별 칸 — Claude만, 켜진 것만 실린다 (Codex는 X5로 숨김)", () => {
    const p = { id: "x", version: "", scope: "user", enabled: true };
    expect(sessionCell(p, "claude")).toBe("on");
    expect(sessionCell({ ...p, enabled: false }, "claude")).toBe("none");
    expect(sessionCell(p, "codex")).toBe("none");
  });
});

describe("mcpCommand.add — 그대로 Enter해도 아무것도 돌지 않는 자리표시 (P68)", () => {
  test("셸 주석 줄로 채운다 — cmd는 rem", () => {
    expect(mcpCommand.add("local", "pwsh")).toBe("# claude mcp add --scope local <이름> -- <명령>");
    expect(mcpCommand.add("user")).toMatch(/^# claude mcp add --scope user /);
    expect(mcpCommand.add("local", "cmd")).toMatch(/^rem claude mcp add /);
  });
});
