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

test("종료된 역할 없는 셸은 같은 슬롯 · 같은 이름으로 되살린다, 역할 세션 · 산 세션은 아니다 (S25)", () => {
  const ws = backend.listWorkspaces().find((w) => backend.listSessions().filter((x) => x.workspaceId === w.id).length < 4)!;
  const term = backend.addTerminal(ws.id, "pwsh", undefined, "내 셸")!;
  expect(backend.reviveTerminal(term.id)).toBeUndefined(); // 살아 있다
  backend.sessionExited(term.id, 0);
  const back = backend.reviveTerminal(term.id);
  expect(back).toMatchObject({ id: term.id, slot: term.slot, name: "내 셸", status: "shell" });
  expect(back?.exitCode).toBeUndefined();
  const role = backend.listSessions().find((x) => x.personaId)!;
  backend.sessionExited(role.id, 1);
  expect(backend.reviveTerminal(role.id)).toBeUndefined();
});

test("워크스페이스 이름 바꾸기는 새 객체로 바꾼다 — 같은 객체면 목록(For)이 옛 이름을 그대로 둔다 (S23)", () => {
  const before = backend.listWorkspaces()[0];
  backend.renameWorkspace(before.id, "새 이름");
  const after = backend.listWorkspaces().find((w) => w.id === before.id)!;
  expect(after.name).toBe("새 이름");
  expect(after).not.toBe(before);
  backend.renameWorkspace(before.id, before.name);
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
