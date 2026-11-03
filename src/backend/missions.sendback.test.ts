// 되돌려 보내기 — 받은 세션 · 못 받은 세션을 나누고, 다시 보내기는 못 받은 쪽에만 (B255)
import { expect, test, vi } from "vitest";
vi.mock("../components/ui", () => ({ notify: () => {} })); // node 테스트에서 JSX 부품을 싣지 않는다
const sendConversation = vi.fn();
vi.mock("./conversation", async (orig) => ({ ...(await orig<object>()), sendConversation: (...a: unknown[]) => sendConversation(...a) }));
import { sendBackMission } from "./missions";
import type { Mission } from "../types";

const m = { id: "nope", name: "B 임무", workspaceId: "w", assigned: ["kai@w", "jun@w"] } as unknown as Mission;

test("하나만 실패하면 나눠 돌려주고, 다시 보낼 때는 그 세션에만 간다 (B255)", async () => {
  sendConversation.mockImplementation(async (_ws: string, to: string) => (to === "jun@w" ? "rate" : null));
  expect(await sendBackMission("w", m, "고칠 점")).toEqual({ sent: ["kai@w"], failed: [{ sid: "jun@w", err: "rate" }] });

  sendConversation.mockClear();
  sendConversation.mockImplementation(async () => {
    throw new Error("ipc");
  });
  const r = await sendBackMission("w", m, "고칠 점", ["jun@w"]);
  expect(sendConversation.mock.calls.map((c) => c[1])).toEqual(["jun@w"]); // 받은 kai@w에는 다시 가지 않는다
  expect(r.sent).toEqual([]);
  expect(r.failed[0].sid).toBe("jun@w"); // 던져도(allSettled) 실패로 모인다
});
