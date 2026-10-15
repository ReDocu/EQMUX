import { beforeEach, describe, expect, test, vi } from "vitest";

const panel = vi.fn();
const external = vi.fn();
let mode: "eqmux" | "chrome" = "eqmux";
vi.mock("../state", () => ({ openInBrowserPanel: (u: string) => panel(u) }));
vi.mock("./pty", () => ({ isTauri: () => false, openExternal: (u: string, c: boolean) => external(u, c) }));
vi.mock("./settings", () => ({ settings: () => ({ webOpen: mode }) }));

const { openLink } = await import("./browser");

// 웹 페이지 열기 설정 — 링크가 패널로 가는지, 앱 밖으로 가는지
describe("openLink", () => {
  beforeEach(() => {
    panel.mockClear();
    external.mockClear();
  });

  test("EQMUX 브라우저 설정이면 패널로", () => {
    mode = "eqmux";
    openLink("https://example.com");
    expect(panel).toHaveBeenCalledWith("https://example.com");
    expect(external).not.toHaveBeenCalled();
  });

  test("'외부로' 버튼은 EQMUX 설정이어도 기본 브라우저로", () => {
    mode = "eqmux";
    openLink("https://example.com", true);
    expect(panel).not.toHaveBeenCalled();
    expect(external).toHaveBeenCalledWith("https://example.com", false);
  });

  test("Chrome 설정이면 모든 링크가 Chrome으로", () => {
    mode = "chrome";
    openLink("http://127.0.0.1:5173");
    openLink("https://example.com", true);
    expect(panel).not.toHaveBeenCalled();
    expect(external.mock.calls).toEqual([
      ["http://127.0.0.1:5173", true],
      ["https://example.com", true],
    ]);
  });
});
