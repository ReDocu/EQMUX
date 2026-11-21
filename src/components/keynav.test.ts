import { describe, expect, test } from "vitest";
import { blocksNavKey, neighborPane, segKeyIndex, stepIndex } from "./keynav";

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
    for (const key of ["U", "d", "b", "l", "k"]) expect(blocksNavKey(k(key), true, false, false)).toBe(true);
    expect(blocksNavKey(k("l"), true, true, false)).toBe(false);
    expect(blocksNavKey(k("c"), true, false, false)).toBe(false);
    expect(blocksNavKey(k("u", { altKey: true }), true, false, false)).toBe(false);
    expect(blocksNavKey(k("u"), false, false, false)).toBe(false);
  });
  test("macOS는 ⌘⇧가 이동 단축키이고 Ctrl+Shift는 셸 몫이라 막지 않는다 (U67)", () => {
    const cmd = { ctrlKey: false, metaKey: true, shiftKey: true, altKey: false, key: "u" };
    expect(blocksNavKey(cmd, true, false, true)).toBe(true);
    expect(blocksNavKey(k("u"), true, false, true)).toBe(false);
  });
});

describe("neighborPane — Ctrl+Shift+화살표 페인 이동", () => {
  const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
  // 2×2: 0 1 / 2 3, 간격 8
  const grid = [box(0, 0, 100, 100), box(108, 0, 100, 100), box(0, 108, 100, 100), box(108, 108, 100, 100)];
  test("2×2 네 방향", () => {
    expect(neighborPane(grid, 0, "ArrowRight")).toBe(1);
    expect(neighborPane(grid, 0, "ArrowDown")).toBe(2);
    expect(neighborPane(grid, 3, "ArrowLeft")).toBe(2);
    expect(neighborPane(grid, 3, "ArrowUp")).toBe(1);
  });
  test("그쪽에 없으면 -1 · 화살표가 아니면 -1", () => {
    expect(neighborPane(grid, 0, "ArrowLeft")).toBe(-1);
    expect(neighborPane(grid, 0, "ArrowUp")).toBe(-1);
    expect(neighborPane(grid, 0, "Enter")).toBe(-1);
  });
  test("간격 0 — 맞닿은 변도 이웃", () => {
    const g0 = [box(0, 0, 100, 100), box(100, 0, 100, 100)];
    expect(neighborPane(g0, 0, "ArrowRight")).toBe(1);
    expect(neighborPane(g0, 1, "ArrowLeft")).toBe(0);
  });
  test("왼쪽 큰 페인 + 오른쪽 세로 셋 — 가운데 줄에 걸린 페인으로", () => {
    const main = [box(0, 0, 200, 300), box(208, 0, 100, 96), box(208, 104, 100, 96), box(208, 208, 100, 92)];
    expect(neighborPane(main, 0, "ArrowRight")).toBe(2);
    expect(neighborPane(main, 3, "ArrowLeft")).toBe(0);
    expect(neighborPane(main, 1, "ArrowDown")).toBe(2);
  });
});
