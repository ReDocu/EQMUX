// 배정 토글 — 임무는 repo 루트에서 읽고(B277), 쓰기가 실패하면 배정 시각 · 브리프로 가지 않는다(B278)
import { expect, test, vi } from "vitest";
vi.mock("../components/ui", () => ({ notify: () => {} })); // node 테스트에서 JSX 부품을 싣지 않는다
// 모듈을 싣는 동안(settings.ts)에도 invoke가 불린다 — 목 함수는 hoisted로 먼저 만든다
// 실모드는 테스트 안에서만 켠다 — 싣는 동안 켜면 settings.ts가 document를 만진다
const { invoke, injectLine, queueBrief, mode } = vi.hoisted(() => ({ invoke: vi.fn(), injectLine: vi.fn(), queueBrief: vi.fn(), mode: { tauri: false } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("./pty", async (orig) => ({ ...(await orig<object>()), isTauri: () => mode.tauri }));
vi.mock("./conversation", async (orig) => ({
  ...(await orig<object>()),
  injectLine: (...a: unknown[]) => injectLine(...a),
  queueBrief: (...a: unknown[]) => queueBrief(...a),
}));
import { toggleAssign } from "./missions";
import { backend } from "./mock";

const pick = () => {
  mode.tauri = true;
  const ws = backend.listWorkspaces().find((w) => !w.pathMissing && backend.listSessions().some((s) => s.workspaceId === w.id && s.personaId))!;
  const sess = backend.listSessions().find((s) => s.workspaceId === ws.id && s.personaId)!;
  const m = backend.listMissions().find((x) => x.workspaceId === ws.id && !x.assigned.includes(sess.id))!;
  return { ws, sess, m };
};

test("mission_assign이 실패하면 배정 시각 · 브리프 단계로 가지 않는다 (B278)", async () => {
  const { ws, sess, m } = pick();
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "mission_assign") throw "임무 파일을 찾을 수 없습니다";
  });
  await toggleAssign(ws.id, m.id, sess.id);
  expect(invoke.mock.calls.map((c) => c[0])).toEqual(["mission_assign"]);
  expect(injectLine).not.toHaveBeenCalled();
  expect(queueBrief).not.toHaveBeenCalled();
});

test("배정은 세션 cwd에 쓰고 임무는 repo 루트에서 읽는다 (B277)", async () => {
  const { ws, sess, m } = pick();
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => (cmd === "mission_list" ? undefined : null));
  await toggleAssign(ws.id, m.id, sess.id);
  const args = invoke.mock.calls.find((c) => c[0] === "mission_assign")![1];
  expect(args).toMatchObject({ wsPath: sess.cwd || ws.path, root: ws.path, missionId: m.id });
  expect(invoke.mock.calls.some((c) => c[0] === "mission_mark_assigned")).toBe(true);
});
