import { describe, expect, test } from "vitest";
import { slotCells } from "./gridSlots";

describe("slotCells (B208)", () => {
  test("칸 위치 = 슬롯 번호 — 빈 슬롯은 그 자리에", () => {
    const a = { slot: 3 };
    const b = { slot: 1 };
    expect(slotCells([a, b], 4)).toEqual([b, 2, a, 4]);
  });
  test("상한을 넘은 슬롯의 세션도 뒤에 남는다", () => {
    const c = { slot: 6 };
    expect(slotCells([c], 4)).toEqual([1, 2, 3, 4, c]);
  });
});
