import { describe, expect, it } from "vitest";
import { worthShowing } from "./recovery";

describe("복구 보고 (U63)", () => {
  const s = { workspace: "w", id: "kai@w", cwd: "", shell: null, lastOutputAt: null, resumable: true };
  it("크래시였고 그때 돌던 세션이 있을 때만 창·알림 센터 항목을 낸다", () => {
    expect(worthShowing({ dirty: true, sessions: [s] })).toBe(true);
    expect(worthShowing({ dirty: true, sessions: [] })).toBe(false);
    expect(worthShowing({ dirty: false, sessions: [s] })).toBe(false);
    expect(worthShowing(undefined)).toBe(false);
  });
});
