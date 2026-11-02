import { expect, test } from "vitest";
import { fileManagerName, jobName, revealLabel } from "./labels";

test("플랫폼 표기 (U76) · 직무 이름 (U112)", () => {
  expect(revealLabel(true)).toBe("Finder에서 보기");
  expect(revealLabel(false)).toBe("탐색기에서 열기");
  expect(fileManagerName(true)).toBe("Finder");
  expect(jobName({ name: "개발" })).toBe("개발");
  expect(jobName(undefined, "셸")).toBe("셸");
});
