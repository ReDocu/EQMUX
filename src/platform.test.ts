import { describe, expect, test } from "vitest";
import { isImeEnter, isSubmitEnter, keyLabel, macFrom, modDown } from "./platform";

describe("플랫폼 판정", () => {
  test("Mac 계열 platform만 macOS다", () => {
    expect(macFrom("MacIntel")).toBe(true);
    expect(macFrom("Win32")).toBe(false);
    expect(macFrom("Linux x86_64")).toBe(false);
  });
});

describe("주 수정자 (U67·B126)", () => {
  const ev = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey });
  test("macOS는 ⌘만, Ctrl은 셸 몫이다", () => {
    expect(modDown(ev(false, true), true)).toBe(true);
    expect(modDown(ev(true, false), true)).toBe(false);
    expect(modDown(ev(true, true), true)).toBe(false);
  });
  test("Windows는 Ctrl 그대로다", () => {
    expect(modDown(ev(true, false), false)).toBe(true);
    expect(modDown(ev(false, true), false)).toBe(false);
  });
});

describe("IME 조합 Enter (B130)", () => {
  test("isComposing·keyCode 229는 조합 확정이라 제출하지 않는다", () => {
    expect(isImeEnter({ isComposing: true })).toBe(true);
    expect(isImeEnter({ keyCode: 229 })).toBe(true);
    expect(isSubmitEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", keyCode: 229 })).toBe(false);
  });
  test("조합이 끝난 Enter만 제출한다", () => {
    expect(isSubmitEnter({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(true);
    expect(isSubmitEnter({ key: "a", isComposing: false })).toBe(false);
  });
});

describe("단축키 표기 (U67)", () => {
  test("macOS에서는 바인딩과 같은 기호로 바꾼다", () => {
    expect(keyLabel("다음 미확인으로 · Ctrl+Shift+U", true)).toBe("다음 미확인으로 · ⌘⇧U");
    expect(keyLabel("Ctrl+Alt+1~8", true)).toBe("⌘1~8");
    expect(keyLabel("Ctrl+Alt+3", true)).toBe("⌘3");
    expect(keyLabel("Ctrl+Alt+D", true)).toBe("⌃⌥D");
    expect(keyLabel("Ctrl+F", true)).toBe("⌘F");
  });
  test("글자 단축키가 아닌 'Ctrl+Shift+글자' 같은 설명은 건드리지 않는다", () => {
    expect(keyLabel("Ctrl+Shift+글자", true)).toBe("Ctrl+Shift+글자");
    expect(keyLabel("Ctrl+Shift+Enter", true)).toBe("Ctrl+Shift+Enter");
  });
  test("Windows 표기는 그대로다", () => {
    expect(keyLabel("Ctrl+Shift+U", false)).toBe("Ctrl+Shift+U");
  });
});
