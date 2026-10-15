// 임무 완료 보고 한정 (B92) — 배정 뒤에 온 report --done만 그 임무 것이다
import { expect, test, vi } from "vitest";
vi.mock("../components/ui", () => ({ notify: () => {} })); // node 테스트에서 JSX 부품을 싣지 않는다
import { missionDoneReport } from "./missions";
import type { ConversationMessage } from "../types";

const rep = (from: string, ts: number): ConversationMessage => ({
  id: `${from}:${ts}`, time: "12:00", from, to: "@all", type: "report", body: `보고 ${ts}`, unread: false, workspaceId: "w", ts, done: true,
});
const b = { id: "B", workspaceId: "w", assigned: ["kai@w"] };

test("이전 임무의 완료 보고는 새 임무에 뜨지 않는다", () => {
  const old = rep("kai@w", 100);
  expect(missionDoneReport([old], b, () => 200)).toBeUndefined();
  expect(missionDoneReport([old, rep("kai@w", 300)], b, () => 200)?.ts).toBe(300);
});

test("배정 시각을 모르면(앱을 켜기 전 배정) 예전처럼 마지막 보고", () => {
  expect(missionDoneReport([rep("kai@w", 100)], b, () => undefined)?.ts).toBe(100);
  expect(missionDoneReport([rep("jun@w", 100)], b, () => undefined)).toBeUndefined(); // 배정 밖 세션
});
