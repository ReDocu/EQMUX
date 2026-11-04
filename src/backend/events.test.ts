// 이벤트 피드 — 셸 하나의 종료는 한 줄 (U175)
import { expect, test } from "vitest";
import { dropExitTwins, feedLevel } from "./events";
import type { EventRow } from "./events";

const row = (id: number, ts: number, kind: string, payload: string | null, sessionId = "shell1@w"): EventRow => ({ id, ts, sessionId, kind, payload });

test("같은 세션 · 같은 때의 dead와 '프로세스 종료'는 session-exit 한 줄로 접힌다", () => {
  const rows = [
    row(3, 1000, "session-exit", "None"),
    row(2, 1001, "agent-state", "dead"),
    row(1, 1002, "state", "프로세스 종료 · exit ?"),
  ];
  expect(dropExitTwins(rows).map((r) => r.id)).toEqual([3]);
});

test("짝 없는 dead · 다른 세션 · 먼 시각은 남긴다", () => {
  const rows = [
    row(4, 1000, "session-exit", "Some(0)"),
    row(3, 1000, "agent-state", "dead", "shell2@w"), // 다른 세션
    row(2, 60_000, "agent-state", "dead"), // 한참 뒤 — 다른 종료
    row(1, 1000, "agent-state", "busy"),
  ];
  expect(dropExitTwins(rows).map((r) => r.id)).toEqual([4, 3, 2, 1]);
});

// 0.6.2 QA eqmux-32
test("로그 레벨은 번역 전 원문으로 — 에이전트 종료는 '종료됨'으로 보여도 ERROR다 (B309)", () => {
  const lv = (kind: string, payload: string | null) => feedLevel({ kind, payload });
  expect(lv("agent-state", "dead")).toBe("error");
  expect(lv("agent-state", "waiting · 도구 승인")).toBe("warn");
  expect(lv("agent-state", "idle")).toBe("info");
  expect(lv("session-exit", "Some(1)")).toBe("error");
  expect(lv("session-exit", "Some(0)")).toBe("info");
  expect(lv("session-exit", "None")).toBe("info");
  expect(lv("state", "busy → dead")).toBe("error");
  expect(lv("state", "dead → busy · 재개")).toBe("info"); // 재개는 오류가 아니다
  expect(lv("state", "busy → waiting")).toBe("warn");
  expect(lv("state", "프로세스 종료 · exit 2")).toBe("error");
});
