import { describe, expect, test } from "vitest";
import { escapeTopLayer, guardOverlay, jumpToSession, modalOpen, overlay, pushLayer, setOverlay, view } from "./state";

describe("레이어 스택 (P30 · B73)", () => {
  test("ESC는 맨 위 하나만 닫고, 빠진 레이어는 건너뛴다", () => {
    const closed: string[] = [];
    const offA = pushLayer(() => closed.push("팝업"));
    const offB = pushLayer(() => closed.push("확인창"));
    expect(escapeTopLayer()).toBe(true);
    expect(closed).toEqual(["확인창"]);
    offB();
    escapeTopLayer();
    expect(closed).toEqual(["확인창", "팝업"]);
    offA();
    expect(escapeTopLayer()).toBe(false);
  });

  test("대화상자 요소를 넘긴 레이어만 모달이다 — 메뉴·벨·팝업은 이동을 막지 않는다 (B72)", () => {
    const offMenu = pushLayer(() => {});
    expect(modalOpen()).toBe(false);
    const offExit = pushLayer(() => {}, () => undefined);
    expect(modalOpen()).toBe(true);
    offExit();
    expect(modalOpen()).toBe(false);
    offMenu();
  });
});

describe("팝업 닫기 거부 (B72)", () => {
  test("미저장 편집이 있으면 ESC·이동 모두 팝업을 닫지 않고 데려가지도 않는다", () => {
    expect(setOverlay("explorer")).toBe(true);
    let dirty = true;
    const off = guardOverlay(() => dirty);
    expect(setOverlay(undefined)).toBe(false);
    expect(jumpToSession("ws-x", "s-x")).toBe(false);
    expect(overlay()).toBe("explorer");
    expect(view()).toEqual({ kind: "control" });
    dirty = false;
    expect(setOverlay(undefined)).toBe(true);
    expect(overlay()).toBeUndefined();
    off();
  });

  test("다른 팝업이 바꿔 건 조건은 앞 팝업의 해제가 지우지 않는다", () => {
    const offOld = guardOverlay(() => false);
    const offNew = guardOverlay(() => true);
    offOld();
    setOverlay("roles");
    expect(setOverlay(undefined)).toBe(false);
    offNew();
    expect(setOverlay(undefined)).toBe(true);
  });
});
