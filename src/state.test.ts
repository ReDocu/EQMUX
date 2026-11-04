import { describe, expect, test, vi } from "vitest";
import { backend } from "./backend/mock";
import { draftRequest, escapeTopLayer, guardOverlay, jumpToSession, modalOpen, openDraft, overlay, previewTracks, pushLayer, setDraftRequest, setOverlay, view } from "./state";

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

  test("조건은 가려던 팝업을 받는다 — 확인 뒤 그리로 다시 간다 (B225)", () => {
    setOverlay("roles");
    const asked: (string | undefined)[] = [];
    const off = guardOverlay((next) => (asked.push(next), true));
    setOverlay("settings");
    setOverlay(undefined);
    expect(asked).toEqual(["settings", undefined]);
    off();
    setOverlay(undefined);
  });
});

describe("점프 — 열 수 없는 워크스페이스 (B238)", () => {
  test("동시 열기 상한으로 못 열면 데려가지 않는다 · 경로 소실은 지금처럼 둔다", () => {
    const ws = { id: "ws-cap", name: "cap", path: "x", open: false } as ReturnType<typeof backend.listWorkspaces>[number];
    const list = vi.spyOn(backend, "listWorkspaces").mockReturnValue([ws]);
    const open = vi.spyOn(backend, "openWorkspace").mockImplementation(() => {});
    const before = view();
    expect(jumpToSession("ws-cap", "s-cap")).toBe(false);
    expect(view()).toEqual(before);
    open.mockImplementation(() => void (ws.open = true));
    expect(jumpToSession("ws-cap", "s-cap")).toBe(true);
    expect(view()).toEqual({ kind: "workspace", id: "ws-cap" });
    list.mockRestore();
    open.mockRestore();
  });

  test("동시 편집 경고 [알리기](openDraft)도 상한이면 데려가지 않고 초안을 채우지 않는다 (B284)", () => {
    const ws = { id: "ws-cap2", name: "cap2", path: "x", open: false } as ReturnType<typeof backend.listWorkspaces>[number];
    const list = vi.spyOn(backend, "listWorkspaces").mockReturnValue([ws]);
    const open = vi.spyOn(backend, "openWorkspace").mockImplementation(() => {});
    setDraftRequest(undefined);
    const before = view();
    openDraft("ws-cap2", "s-cap2", "hi");
    expect(view()).toEqual(before);
    expect(draftRequest()).toBeUndefined();
    open.mockImplementation(() => void (ws.open = true));
    openDraft("ws-cap2", "s-cap2", "hi");
    expect(view()).toEqual({ kind: "workspace", id: "ws-cap2" });
    expect(draftRequest()?.session).toBe("s-cap2");
    setDraftRequest(undefined);
    list.mockRestore();
    open.mockRestore();
  });
});

describe("배치 창 축소 그림 (0.6 QA U151)", () => {
  test("트랙은 실제 그리드처럼 슬롯 상한을 따른다 — 그리드 2행, 메인 + 스택은 나머지 수만큼", () => {
    expect(previewTracks("grid-row", 6)).toEqual({ cols: "repeat(3, 1fr)", rows: "repeat(2, 1fr)" });
    expect(previewTracks("stack-v", 4)).toEqual({ cols: "repeat(1, 1fr)", rows: "repeat(4, 1fr)" });
    expect(previewTracks("row-h", 8)).toEqual({ cols: "repeat(8, 1fr)", rows: "repeat(1, 1fr)" });
    expect(previewTracks("main-right", 6)).toEqual({ cols: "2fr 1fr", rows: "repeat(5, 1fr)" });
    expect(previewTracks("main-bottom", 4)).toEqual({ cols: "repeat(3, 1fr)", rows: "2fr 1fr" });
  });
});
