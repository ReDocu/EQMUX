import { describe, expect, it } from "vitest";
import { pickEvictions } from "./webglBudget";

const held = (...v: [boolean, number][]) => v.map(([mounted, touched]) => ({ mounted, touched }));
const touched = (r: { touched: number }[]) => r.map((x) => x.touched);

describe("pickEvictions", () => {
  it("상한 아래면 아무것도 회수하지 않는다", () => {
    expect(pickEvictions(held([true, 1], [false, 2]), 3)).toEqual([]);
  });

  it("상한에 닿으면 딱 하나 — 새 컨텍스트가 앉을 자리만 낸다", () => {
    expect(touched(pickEvictions(held([true, 1], [true, 2], [false, 3]), 3))).toEqual([3]);
  });

  it("안 보이는 페인을 먼저 고른다 — 더 오래된 마운트 페인보다 우선", () => {
    expect(touched(pickEvictions(held([true, 1], [true, 2], [false, 9]), 3))).toEqual([9]);
  });

  it("전부 보이면 가장 오래 붙은 것", () => {
    expect(touched(pickEvictions(held([true, 9], [true, 2], [true, 5]), 3))).toEqual([2]);
  });

  it("이미 넘겼으면 상한으로 수렴한다 — 회수 뒤 cap-1개가 남는다", () => {
    const r = pickEvictions(held([true, 1], [true, 2], [true, 3], [true, 4], [true, 5]), 3);
    expect(touched(r)).toEqual([1, 2, 3]);
    expect(5 - r.length + 1).toBe(3);
  });
});
