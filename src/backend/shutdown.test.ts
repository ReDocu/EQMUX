import { describe, expect, it, vi } from "vitest";

let exitFails = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "app_exit" && exitFails ? Promise.reject(new Error("denied")) : Promise.resolve(true)),
}));
vi.mock("./pty", () => ({ isTauri: () => true }));
vi.mock("./flags", () => ({ flushUnseenNow: () => {} }));
vi.mock("./layout", () => ({ flushLayoutNow: () => {} }));
vi.mock("./team", () => ({ flushTeamNow: () => {} }));

import { performShutdown } from "./shutdown";

describe("performShutdown", () => {
  // B110 — app_exit가 실패하면 false로 돌아와야 종료 다이얼로그가 '종료 중…'에서 풀린다
  it("app_exit 실패를 false로 알린다", async () => {
    exitFails = true;
    expect(await performShutdown()).toBe(false);
    exitFails = false;
    expect(await performShutdown()).toBe(true);
  });
});
