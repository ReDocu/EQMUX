// 캐스팅 변화 계산 (B69 · B70) — 확인창이 무엇을 알릴지. applyCasting과 같은 규칙이어야 한다
import { describe, expect, test } from "vitest";
import { castingChanges } from "../types";

const ws = "w";
const cur = [
  { id: "hana@w", personaId: "hana", jobId: "dev" },
  { id: "jun@w", personaId: "jun", jobId: "qa" },
  { id: "shell1@w", personaId: "", jobId: "" }, // 기본 터미널 — 편성 대상 아님
];

describe("castingChanges", () => {
  test("지금 편성 그대로면 변화 없음", () => {
    const c = castingChanges(cur, [{ personaId: "hana", jobId: "dev" }, { personaId: "jun", jobId: "qa" }], [2, 3], ws);
    expect(c).toEqual({ stopped: [], jobChanged: [], added: [], dropped: [] });
  });

  test("목록 밖 세션은 종료, 남는 세션의 직무 변경, 기본 터미널은 그대로", () => {
    const c = castingChanges(cur, [{ personaId: "jun", jobId: "lead" }, { personaId: "luka", jobId: "dev" }], [3, 2], ws);
    expect(c.stopped).toEqual(["hana@w"]);
    expect(c.jobChanged).toEqual([{ id: "jun@w", from: "qa", to: "lead" }]);
    expect(c.added).toEqual(["luka"]);
    expect(c.dropped).toEqual([]);
  });

  test("빈 슬롯이 모자라면 남는 새 페르소나는 빠진다 (B70)", () => {
    const c = castingChanges([], [{ personaId: "a", jobId: "lead" }, { personaId: "b", jobId: "qa" }], [2, undefined], ws);
    expect(c.added).toEqual(["a"]);
    expect(c.dropped).toEqual(["b"]);
  });
});
