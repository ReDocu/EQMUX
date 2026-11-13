import { expect, test } from "vitest";
import { fileManagerName, jobName, reasonText, revealLabel } from "./labels";

test("플랫폼 표기 (U76) · 직무 이름 (U112)", () => {
  expect(revealLabel(true)).toBe("Finder에서 보기");
  expect(revealLabel(false)).toBe("탐색기에서 열기");
  expect(fileManagerName(true)).toBe("Finder");
  expect(jobName({ name: "개발" })).toBe("개발");
  expect(jobName(undefined, "셸")).toBe("셸");
});

test("상태 판정 근거 (§4)", () => {
  const now = 10 * 60_000;
  expect(reasonText({ event: "Stop", ts: now - 5 * 60_000 }, now)).toBe("Stop · 5분 전");
  expect(reasonText({ event: "PostToolUse", ts: 0, note: "stalled" }, now)).toBe("PostToolUse 뒤로 훅 없음 · 10분 전");
  expect(reasonText({ event: "registry", ts: now, note: "adopted" }, now)).toBe("직접 띄운 claude를 붙임 · 방금");
  expect(reasonText({ event: "pty-exit", ts: now, note: "exit 1" }, now)).toBe("프로세스 종료 · exit 1 · 방금");
});
