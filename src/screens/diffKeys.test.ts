// diff 화면 키 (U66) — 맨 ↑↓는 스크롤에 남고, 수정키 조합은 점프하지 않는다
import { expect, test } from "vitest";
import { diffKeyAction } from "./diffKeys";

const k = (key: string, mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

test("맨 ↑↓는 파일을 옮기지 않고, Alt+↑↓·[ ]가 옮긴다", () => {
  expect(diffKeyAction(k("ArrowDown"), false)).toBeUndefined();
  expect(diffKeyAction(k("ArrowUp"), false)).toBeUndefined();
  expect(diffKeyAction(k("ArrowDown", { altKey: true }), false)).toBe("fileNext");
  expect(diffKeyAction(k("ArrowUp", { altKey: true }), false)).toBe("filePrev");
  expect(diffKeyAction(k("]"), false)).toBe("fileNext");
  expect(diffKeyAction(k("["), false)).toBe("filePrev");
});

test("n/p는 수정키가 없을 때만, 입력 필드에서는 모두 양보", () => {
  expect(diffKeyAction(k("n"), false)).toBe("next");
  expect(diffKeyAction(k("p"), false)).toBe("prev");
  expect(diffKeyAction(k("n", { ctrlKey: true }), false)).toBeUndefined();
  expect(diffKeyAction(k("p", { metaKey: true }), false)).toBeUndefined();
  expect(diffKeyAction(k("n", { altKey: true }), false)).toBeUndefined();
  expect(diffKeyAction(k("Escape"), false)).toBe("close");
  expect(diffKeyAction(k("Escape"), true)).toBeUndefined();
  expect(diffKeyAction(k("n"), true)).toBeUndefined();
});

test("목록을 읽은 뒤 고를 파일 — 고른 것 · 진입점이 넘긴 파일 · 첫 파일 순 (U192)", async () => {
  const { pickFile } = await import("./diffKeys");
  const paths = ["a.ts", "b.ts", "c.ts"];
  expect(pickFile(paths, undefined, "c.ts")).toBe("c.ts");
  expect(pickFile(paths, "b.ts", "c.ts")).toBe("b.ts"); // 사람이 고른 것이 이긴다 (⟳ 새로 읽기)
  expect(pickFile(paths, "gone.ts", "c.ts")).toBe("c.ts");
  expect(pickFile(paths, undefined, "없는 파일")).toBe("a.ts");
  expect(pickFile([], undefined, "c.ts")).toBeUndefined();
});
