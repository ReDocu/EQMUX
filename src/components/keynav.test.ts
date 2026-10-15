import { describe, expect, test } from "vitest";
import { blocksNavKey, segKeyIndex, stepIndex } from "./keynav";

describe("키보드 이동 (U37)", () => {
  test("Tab 가두기 — 끝에서 처음으로, 처음에서 Shift+Tab은 끝으로, 밖에 있으면 안으로", () => {
    expect(stepIndex(3, 2, false)).toBe(0);
    expect(stepIndex(3, 0, true)).toBe(2);
    expect(stepIndex(3, 1, false)).toBe(2);
    expect(stepIndex(3, -1, false)).toBe(0);
    expect(stepIndex(3, -1, true)).toBe(2);
    expect(stepIndex(0, -1, false)).toBe(-1);
  });

  test("세그먼트 — 화살표는 돌고 Home·End는 양 끝, 다른 키는 무시", () => {
    expect(segKeyIndex("ArrowRight", 3, 2)).toBe(0);
    expect(segKeyIndex("ArrowLeft", 3, 0)).toBe(2);
    expect(segKeyIndex("ArrowDown", 3, 0)).toBe(1);
    expect(segKeyIndex("Home", 3, 2)).toBe(0);
    expect(segKeyIndex("End", 3, 0)).toBe(2);
    expect(segKeyIndex("Enter", 3, 0)).toBeUndefined();
    expect(segKeyIndex("ArrowRight", 0, -1)).toBeUndefined();
  });
});

describe("모달 중 이동 단축키 (B72)", () => {
  const k = (key: string, over: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    key,
    ...over,
  });
  test("모달이 떠 있으면 U·D·B·L을 막고, 배치 창의 L(닫기)과 다른 키는 통과", () => {
    for (const key of ["U", "d", "b", "l"]) expect(blocksNavKey(k(key), true, false)).toBe(true);
    expect(blocksNavKey(k("l"), true, true)).toBe(false);
    expect(blocksNavKey(k("c"), true, false)).toBe(false);
    expect(blocksNavKey(k("u", { altKey: true }), true, false)).toBe(false);
    expect(blocksNavKey(k("u"), false, false)).toBe(false);
  });
});
