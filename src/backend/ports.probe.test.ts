// 서버 명령 뒤 자동 실측 (B145·U91) — 서버 셸에 Enter로 끝난 줄이 들어오면 몇 초 뒤 실측이 돈다.
// 실측(portsSnapshot)과 Tauri 판정만 가짜로 바꾸고, 입력 훅은 진짜 경로(noteUserInput)를 탄다
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const snapshot = vi.fn(async () => []);
vi.mock("./panels", () => ({ portsSnapshot: () => snapshot() }));
vi.mock("./pty", async (orig) => ({ ...(await orig<typeof import("./pty")>()), isTauri: () => true }));

const { SERVER_PROBE_DELAYS_MS, serverTermId, startPortWatch } = await import("./ports");
const { noteUserInput } = await import("./pty");

describe("서버 명령 뒤 자동 실측", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startPortWatch(); // 기준선 1회
  });
  afterEach(() => vi.useRealTimers());

  test("서버 셸에서 Enter로 끝난 줄 → 정해진 지연마다 한 번씩 실측한다", async () => {
    await vi.runAllTimersAsync();
    snapshot.mockClear();
    noteUserInput(serverTermId("ws1"), "npm run dev\r");
    expect(snapshot).not.toHaveBeenCalled(); // 바로 보지 않는다 — 서버가 뜰 틈을 준다
    await vi.advanceTimersByTimeAsync(SERVER_PROBE_DELAYS_MS[0]);
    expect(snapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SERVER_PROBE_DELAYS_MS[1] - SERVER_PROBE_DELAYS_MS[0]);
    expect(snapshot).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(snapshot).toHaveBeenCalledTimes(2); // 주기 폴링은 없다
  });

  test("Enter를 연달아 쳐도 마지막 줄 기준으로 한 벌만 돈다", async () => {
    await vi.runAllTimersAsync();
    snapshot.mockClear();
    noteUserInput(serverTermId("ws1"), "cd web\r");
    await vi.advanceTimersByTimeAsync(1_000);
    noteUserInput(serverTermId("ws1"), "npm run dev\r");
    await vi.advanceTimersByTimeAsync(SERVER_PROBE_DELAYS_MS[1] + 1_000);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  test("서버 셸이 아닌 페인·Enter 없는 입력은 실측을 부르지 않는다", async () => {
    await vi.runAllTimersAsync();
    snapshot.mockClear();
    noteUserInput("s1@ws1", "npm run dev\r");
    noteUserInput(serverTermId("ws1"), "npm run de");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(snapshot).not.toHaveBeenCalled();
  });
});
