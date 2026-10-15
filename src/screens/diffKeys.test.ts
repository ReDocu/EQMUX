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
