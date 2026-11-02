// Jump 팔레트 순위 (0.6 §4) — 앞부분 일치 먼저, 단어 앞, 어디든, 보조 줄 순. 같은 점수는 원래 순서
import { describe, expect, test } from "vitest";
import { rankItems } from "./jump";
import type { JumpItem } from "./jump";

const it = (label: string, sub?: string): JumpItem => ({ id: label, kind: "screen", label, sub, run: () => {} });

describe("rankItems", () => {
  const items = [it("Settings"), it("git"), it("my git log"), it("legit"), it("kai", "git 담당"), it("logs")];

  test("앞부분 > 단어 앞 > 어디든 > 보조 줄, 안 맞으면 뺀다", () => {
    expect(rankItems(items, "GIT").map((x) => x.id)).toEqual(["git", "my git log", "legit", "kai"]);
  });

  test("빈 질의는 원래 순서 그대로, max까지", () => {
    expect(rankItems(items, "  ", 3).map((x) => x.id)).toEqual(["Settings", "git", "my git log"]);
  });

  test("한글 부분 일치", () => {
    expect(rankItems([it("과거 세션 검색"), it("세션 저장")], "세션").map((x) => x.id)).toEqual(["세션 저장", "과거 세션 검색"]);
  });
});
