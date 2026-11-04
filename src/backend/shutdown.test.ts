import { describe, expect, it, vi } from "vitest";

let exitFails = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "app_exit" && exitFails ? Promise.reject(new Error("denied")) : Promise.resolve(true)),
}));
vi.mock("./pty", () => ({ isTauri: () => true }));
vi.mock("./flags", () => ({ flushUnseenNow: () => {} }));
vi.mock("./layout", () => ({ flushLayoutNow: () => {} }));
vi.mock("./team", () => ({ flushTeamNow: () => {} }));

import { liveSessions, performShutdown } from "./shutdown";
import type { Session } from "../types";

describe("'실행 중' 세기 (B292)", () => {
  const s = (id: string, status: Session["status"]) => ({ id, status }) as Session;
  const list = [s("lead@a", "shell"), s("dev@b", "shell"), s("qa@a", "busy"), s("old@a", "dead")];
  it("살아 있는 PTY가 있는 세션만 — team.json으로 복원만 된 슬롯은 세지 않는다", () => {
    expect(liveSessions(list, [])).toEqual([]); // 재기동 뒤 관제에만 머물렀다
    expect(liveSessions(list, ["qa@a", "server@a"]).map((x) => x.id)).toEqual(["qa@a"]);
    expect(liveSessions(list, ["old@a"])).toEqual([]); // 죽은 세션은 세지 않는다
  });
  it("PTY 목록이 없으면(브라우저 목 · 목록 실패) 상태로 센다 — 묻지 않고 끄지 않게", () => {
    expect(liveSessions(list, undefined).map((x) => x.id)).toEqual(["lead@a", "dev@b", "qa@a"]);
  });
});

describe("performShutdown", () => {
  // B110 — app_exit가 실패하면 false로 돌아와야 종료 다이얼로그가 '종료 중…'에서 풀린다
  it("app_exit 실패를 false로 알린다", async () => {
    exitFails = true;
    expect(await performShutdown()).toBe(false);
    exitFails = false;
    expect(await performShutdown()).toBe(true);
  });
});
