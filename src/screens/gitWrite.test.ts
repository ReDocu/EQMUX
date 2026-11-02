import { expect, test } from "vitest";
import { guardWorsened, hunkPatch, hunkRange, refNameProblem, splitHunks, workGuard } from "./gitWrite";

test("§4-1 작업 중 경고 — busy > waiting > 없음, 다른 워크스페이스 · 자기 워크트리 세션은 뺀다", () => {
  const s = (workspaceId: string, status: "busy" | "waiting" | "idle" | "starting" | "shell", wt = false, missing = false) => ({
    workspaceId,
    status,
    worktree: wt,
    worktreeMissing: missing,
  });
  expect(workGuard([], "w").level).toBe("none");
  expect(workGuard([s("w", "idle"), s("w", "shell")], "w").level).toBe("none");
  expect(workGuard([s("w", "waiting"), s("x", "busy")], "w")).toEqual({ level: "waiting", busy: 0, waiting: 1 });
  expect(workGuard([s("w", "waiting"), s("w", "starting")], "w").level).toBe("busy");
  expect(workGuard([s("w", "busy", true)], "w").level).toBe("none"); // 자기 워크트리
  expect(workGuard([s("w", "busy", true, true)], "w").level).toBe("busy"); // 워크트리가 없어 루트에서 돈다
  expect(guardWorsened("waiting", "busy")).toBe(true);
  expect(guardWorsened("none", "waiting")).toBe(true);
  expect(guardWorsened("busy", "none")).toBe(false);
});

const DIFF = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
-1
+1x
 2
 3
@@ -8,3 +8,3 @@ fn tail
 8
 9
-10
+10x
\\ No newline at end of file
`;

test("덩어리 나누기 — 머리 + 덩어리 2개, 덩어리 하나짜리 패치", () => {
  const p = splitHunks(DIFF);
  expect(p.header.startsWith("diff --git") && p.header.endsWith("+++ b/a.txt\n")).toBe(true);
  expect(p.hunks.length).toBe(2);
  expect(p.hunks[1]).toContain("\\ No newline at end of file\n");
  const one = hunkPatch(p, 0);
  expect(one).toContain("+1x");
  expect(one).not.toContain("+10x");
  expect(hunkRange(p.hunks[1])).toBe("-8,3 +8,3");
  expect(splitHunks("").hunks).toEqual([]);
  expect(splitHunks("diff --git a/x b/x\nBinary files differ\n").hunks).toEqual([]);
});

test("브랜치 이름 — -로 시작 · 공백 · .. · .lock 거부", () => {
  expect(refNameProblem("feature/x")).toBeUndefined();
  expect(refNameProblem("6.0-dev")).toBeUndefined();
  for (const bad of ["", "-x", "a b", "a..b", "x.lock", "a:b", "a/", "/a", "a@{1}", "a~1"]) {
    expect(refNameProblem(bad), bad).toBeDefined();
  }
});
