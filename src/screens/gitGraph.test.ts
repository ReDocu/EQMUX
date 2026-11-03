import { expect, test } from "vitest";
import { computeGraph } from "./gitGraph";
import type { GraphLine } from "./gitGraph";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });
const has = (lines: GraphLine[], half: "top" | "bottom", from: number, to: number) =>
  lines.some((l) => l.half === half && l.from === from && l.to === to);

test("일자 이력 — 한 레인, 한 색, 첫 행 위 · 뿌리 아래에는 선이 없다", () => {
  const r = computeGraph([c("c", "b"), c("b", "a"), c("a")]);
  expect(r.map((x) => x.col)).toEqual([0, 0, 0]);
  expect(new Set(r.map((x) => x.color)).size).toBe(1);
  expect(r[0].lines.filter((l) => l.half === "top")).toEqual([]);
  expect(r[2].lines.filter((l) => l.half === "bottom")).toEqual([]);
  expect(has(r[1].lines, "top", 0, 0) && has(r[1].lines, "bottom", 0, 0)).toBe(true);
});

test("분기와 머지 — 머지 커밋이 둘째 부모 레인을 열고, 갈래점에서 다시 모인다", () => {
  // m = merge(a2, b1), a2 → a1, b1 → a1, a1 → root
  const r = computeGraph([c("m", "a2", "b1"), c("a2", "a1"), c("b1", "a1"), c("a1", "root"), c("root")]);
  expect(r[0].col).toBe(0);
  expect(has(r[0].lines, "bottom", 0, 1)).toBe(true); // 머지 → 둘째 부모 레인
  expect(r[1].col).toBe(0);
  expect(has(r[1].lines, "top", 1, 1) && has(r[1].lines, "bottom", 1, 1)).toBe(true); // 옆 레인이 지나간다
  expect(r[2].col).toBe(1);
  expect(r[2].color).not.toBe(r[1].color); // 가지마다 다른 색
  expect(r[3].col).toBe(0);
  expect(has(r[3].lines, "top", 1, 0)).toBe(true); // 갈래점으로 모인다
  expect(r[3].width).toBe(2);
  expect(r[4].width).toBe(1); // 끝난 레인은 줄어든다
});

test("여러 뿌리 — 서로 이어지지 않는 두 이력 (orphan 브랜치)", () => {
  const r = computeGraph([c("x2", "x1"), c("y1"), c("x1")]);
  expect(r[0].col).toBe(0);
  expect(r[1].col).toBe(1); // x1을 기다리는 레인 0을 비켜 간다
  expect(r[1].lines.filter((l) => l.half === "top" && l.from === 1)).toEqual([]); // 머리 — 위 선 없음
  expect(has(r[1].lines, "top", 0, 0) && has(r[1].lines, "bottom", 0, 0)).toBe(true);
  expect(r[2].col).toBe(0);
});

test("끝난 레인 자리는 다시 쓴다 — 레인 수가 계속 늘지 않는다", () => {
  // 두 브랜치 머리 f1 · g1이 각각 main(m1)에서 갈라졌다가, 그 뒤 새 머리 h1이 나온다
  const r = computeGraph([c("f1", "m2"), c("g1", "m1"), c("m2", "m1"), c("m1", "m0"), c("h1", "m0"), c("m0")]);
  expect(r[1].col).toBe(1);
  expect(r[3].col).toBe(0);
  expect(has(r[3].lines, "top", 1, 0)).toBe(true);
  expect(r[4].col).toBe(1); // 비었던 레인 1을 다시 쓴다
  expect(Math.max(...r.map((x) => x.width))).toBe(2);
});

test("읽어 온 범위 밖 부모 — 레인이 끝까지 이어진다 (다음 쪽에서 만난다)", () => {
  const r = computeGraph([c("b", "a")]);
  expect(has(r[0].lines, "bottom", 0, 0)).toBe(true);
});
