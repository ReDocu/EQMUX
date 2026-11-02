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

test("기본 터미널은 넘겨받은 셸로 뜬다 (0.6 QA B202)", () => {
  const ws = backend
    .listWorkspaces()
    .find((w) => {
      const own = backend.listSessions().filter((x) => x.workspaceId === w.id);
      return own.length < 4 && !own.some((x) => x.personaId === "");
    });
  expect(ws).toBeDefined();
  backend.startDefaultTerminal(ws!.id, "Git Bash");
  const term = backend.listSessions().find((x) => x.workspaceId === ws!.id && x.personaId === "");
  expect(term?.shell).toBe("Git Bash");
});

test("누른 빈 슬롯 번호에 만든다 — 첫 빈 슬롯이 아니라 (0.6 QA B208)", () => {
  const free = (wsId: string) => {
    const used = new Set(backend.listSessions().filter((x) => x.workspaceId === wsId).map((x) => x.slot));
    return [1, 2, 3, 4].filter((n) => !used.has(n));
  };
  const ws = backend.listWorkspaces().find((w) => free(w.id).length >= 2);
  expect(ws).toBeDefined();
  const want = free(ws!.id).at(-1)!;
  expect(backend.addTerminal(ws!.id, "pwsh", undefined, undefined, want)?.slot).toBe(want);
  // 이미 찬 번호를 달라고 하면 첫 빈 슬롯으로 물러선다
  const first = free(ws!.id)[0];
  expect(backend.addTerminal(ws!.id, "pwsh", undefined, undefined, want)?.slot).toBe(first);
});
