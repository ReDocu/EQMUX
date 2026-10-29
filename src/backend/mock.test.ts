import { expect, test, vi } from "vitest";
import { backend } from "./mock";

test("Rust 이벤트발 방송은 16ms 안의 것을 한 번으로 묶는다 (CPU 점검 1)", () => {
  vi.useFakeTimers();
  const sess = backend.listSessions()[0];
  let calls = 0;
  const off = backend.subscribe(() => calls++);
  for (const activity of ["Read", "Edit", "Bash"]) {
    backend.applyAgentState({ session: sess.id, agentSession: "abcdef12", activity, resumable: false });
  }
  expect(calls).toBe(0);
  vi.advanceTimersByTime(16);
  expect(calls).toBe(1);
  off();
  vi.useRealTimers();
});
