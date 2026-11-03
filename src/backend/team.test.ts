// 캐스팅 변화 계산 (B69 · B70) — 확인창이 무엇을 알릴지. applyCasting과 같은 규칙이어야 한다
import { describe, expect, test, vi } from "vitest";
import { castingChanges } from "../types";
import { backend } from "./mock";
import { autoAssignDefault } from "./missions";
import { applyCastingWithDefaults, presetSlots } from "./team";

vi.mock("../components/ui", () => ({ notify: () => {} })); // node 테스트에서 JSX 부품을 싣지 않는다
vi.mock("./missions", () => ({ autoAssignDefault: vi.fn(async () => {}) }));

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

// 프리셋 채우기 (0.6 QA P78 · P79) — 프리셋은 직무 구성이다. 지금 팀원을 갈아엎지 않는다
describe("presetSlots", () => {
  const personas = [{ id: "kai" }, { id: "noel", job: "qa" }, { id: "rin" }, { id: "mira", job: "lead" }, { id: "jun" }, { id: "hana" }];
  test("지금 팀원은 같은 직무 자리에 남고 빈 자리만 채운다 (P78)", () => {
    const cur = [{ personaId: "mira", jobId: "lead" }, { personaId: "jun", jobId: "dev" }, { personaId: "hana", jobId: "dev" }];
    expect(presetSlots(["lead", "dev", "dev", "qa"], cur, personas, 4)).toEqual([
      { personaId: "mira", jobId: "lead" },
      { personaId: "jun", jobId: "dev" },
      { personaId: "hana", jobId: "dev" },
      { personaId: "noel", jobId: "qa" }, // 기본 직무가 QA인 사람 (P79)
    ]);
  });
  test("빈 팀이면 기본 직무가 맞는 사람 먼저, 나머지는 라이브러리 순서 (P79)", () => {
    expect(presetSlots(["lead", "dev", "qa"], [], personas, 4)).toEqual([
      { personaId: "mira", jobId: "lead" },
      { personaId: "kai", jobId: "dev" },
      { personaId: "noel", jobId: "qa" },
    ]);
  });
  test("상한과 사람 수만큼만", () => {
    expect(presetSlots(["dev", "dev", "dev"], [], [{ id: "a" }], 2)).toEqual([{ personaId: "a", jobId: "dev" }]);
  });
});

// 적용 경로 하나 (0.6 QA B246) — 어느 버튼이든 역할 세션마다 기본 임무 배정을 부른다
test("applyCastingWithDefaults는 편성 뒤 역할 슬롯마다 기본 임무 배정을 부른다", () => {
  const apply = vi.spyOn(backend, "applyCasting").mockImplementation(() => {});
  applyCastingWithDefaults("w", [{ personaId: "a", jobId: "dev" }, { personaId: "", jobId: "" }]);
  expect(apply).toHaveBeenCalledOnce();
  expect(autoAssignDefault).toHaveBeenCalledTimes(1);
  expect(autoAssignDefault).toHaveBeenCalledWith("w", "a@w");
  apply.mockRestore();
});
