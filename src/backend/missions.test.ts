// 임무 완료 보고 한정 (B92) — 배정 뒤에 온 report --done만 그 임무 것이다
import { expect, test, vi } from "vitest";
vi.mock("../components/ui", () => ({ notify: () => {} })); // node 테스트에서 JSX 부품을 싣지 않는다
import { missionDoneReport, openDeps, outputsNotice, setMissionDepends, unlockedOrphans } from "./missions";
import { backend } from "./mock";
import type { ConversationMessage, Mission } from "../types";

const rep = (from: string, ts: number): ConversationMessage => ({
  id: `${from}:${ts}`, time: "12:00", from, to: "@all", type: "report", body: `보고 ${ts}`, unread: false, workspaceId: "w", ts, done: true,
});
const b = { id: "B", workspaceId: "w", assigned: ["kai@w"] };

test("이전 임무의 완료 보고는 새 임무에 뜨지 않는다", () => {
  const old = rep("kai@w", 100);
  expect(missionDoneReport([old], b, () => 200)).toBeUndefined();
  expect(missionDoneReport([old, rep("kai@w", 300)], b, () => 200)?.ts).toBe(300);
});

test("되돌려 보낸 뒤에는 그 의견보다 나중 보고만 센다 (B172)", () => {
  const back = (to: string, ts: number, name = "B 임무"): ConversationMessage => ({
    id: `back:${ts}`, time: "12:00", from: "나", to, type: "review", body: `임무 '${name}' 검토 의견 — 고칠 점`, unread: false, workspaceId: "w", ts,
  });
  const m = { ...b, name: "B 임무" };
  expect(missionDoneReport([rep("kai@w", 300), back("kai@w", 400)], m, () => 200)).toBeUndefined();
  expect(missionDoneReport([rep("kai@w", 300), back("kai@w", 400), rep("kai@w", 500)], m, () => 200)?.ts).toBe(500);
  // 다른 임무 · 다른 세션에 보낸 의견은 이 임무의 보고를 지우지 않는다
  expect(missionDoneReport([rep("kai@w", 300), back("kai@w", 400, "C 임무")], m, () => 200)?.ts).toBe(300);
  expect(missionDoneReport([rep("kai@w", 300), back("jun@w", 400)], m, () => 200)?.ts).toBe(300);
});

test("배정 시각을 모르면(앱을 켜기 전 배정) 예전처럼 마지막 보고", () => {
  expect(missionDoneReport([rep("kai@w", 100)], b, () => undefined)?.ts).toBe(100);
  expect(missionDoneReport([rep("jun@w", 100)], b, () => undefined)).toBeUndefined(); // 배정 밖 세션
});

test("미체크 산출물 안내 — 검토 중으로 옮길 때와 끝낼 때([승인]) 모두 (B188)", () => {
  expect(outputsNotice("done", 2)).toContain("2");
  expect(outputsNotice("in-review", 1)).toContain("1");
  expect(outputsNotice("done", 0)).toBeUndefined();
  expect(outputsNotice("in-progress", 3)).toBeUndefined();
});

test("선행 임무 — 남은 선행 · 담당 없이 풀린 후행 (P60)", () => {
  const mk = (id: string, status: Mission["status"], dependsOn: string[] = [], assigned: string[] = []) =>
    ({ id, name: id.toUpperCase(), status, dependsOn, assigned, workspaceId: "w", outputs: [] }) as unknown as Mission;
  const all = [mk("a", "done"), mk("b", "in-progress"), mk("c", "todo", ["a", "b", "gone"]), mk("d", "todo", ["a"]), mk("e", "todo", ["a"], ["kai@w"])];
  expect(openDeps(all[2], all).map((x) => x.id)).toEqual(["b"]); // 끝난 것 · 없는 id는 빠진다
  expect(unlockedOrphans("a", all).map((x) => x.id)).toEqual(["d"]); // c는 b가 남았고 e는 담당이 있다
});

test("목 백엔드의 선행 지정도 방송한다 (B270)", async () => {
  const m = backend.listMissions()[0];
  let heard = 0;
  const off = backend.subscribe(() => heard++);
  await setMissionDepends(m.workspaceId, m.id, ["x"]);
  off();
  expect(backend.listMissions().find((x) => x.id === m.id)?.dependsOn).toEqual(["x"]);
  expect(heard).toBeGreaterThan(0);
});

test("영어로 되돌려 보낸 의견도 그 뒤 보고만 센다 (U123)", () => {
  const back: ConversationMessage = {
    id: "back", time: "12:00", from: "나", to: "kai@w", type: "review", body: "Review notes on mission 'B 임무' — fix", unread: false, workspaceId: "w", ts: 400,
  };
  expect(missionDoneReport([rep("kai@w", 300), back], { ...b, name: "B 임무" }, () => 200)).toBeUndefined();
});
