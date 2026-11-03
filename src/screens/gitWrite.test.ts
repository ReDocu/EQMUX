import { expect, test } from "vitest";
import { chunkPaths, guardWorsened, hunkPatch, hunkRange, pushArgs, pushRemote, refNameProblem, splitHunks, workGuard } from "./gitWrite";

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

test("B154 — 가릴 .env 계열 경로 (예시 파일 제외, 폴더 · 역슬래시 경로)", async () => {
  const { isDotenvPath } = await import("./gitWrite");
  for (const yes of [".env", "app/.env.local", "a\\b\\.env.production", ".ENV"]) expect(isDotenvPath(yes), yes).toBe(true);
  for (const no of [".env.example", "x/.env.sample", "env.ts", ".envrc", "my.env", undefined]) expect(isDotenvPath(no), String(no)).toBe(false);
});

test("브랜치 이름 — -로 시작 · 공백 · .. · .lock 거부", () => {
  expect(refNameProblem("feature/x")).toBeUndefined();
  expect(refNameProblem("6.0-dev")).toBeUndefined();
  for (const bad of ["", "-x", "a b", "a..b", "x.lock", "a:b", "a/", "/a", "a@{1}", "a~1"]) {
    expect(refNameProblem(bad), bad).toBeDefined();
  }
});

test("충돌 덩어리 — 나누기 · 우리 것/저쪽 것/둘 다 · diff3 · 미선택은 표식째", async () => {
  const { conflictParts, resolveConflicts } = await import("./gitWrite");
  const src = "a\n<<<<<<< HEAD\nours1\n=======\ntheirs1\n>>>>>>> feat\nb\n<<<<<<< HEAD\nx\n||||||| base\nold\n=======\ny\n>>>>>>> feat\nc\n";
  const p = conflictParts(src);
  expect(p.map((x) => x.kind)).toEqual(["text", "conflict", "text", "conflict", "text"]);
  expect(p[3]).toMatchObject({ kind: "conflict", ours: "x\n", theirs: "y\n", oursLabel: "HEAD", theirsLabel: "feat" });
  expect(resolveConflicts(p, ["ours", "theirs"])).toBe("a\nours1\nb\ny\nc\n");
  expect(resolveConflicts(p, ["both", "ours"])).toBe("a\nours1\ntheirs1\nb\nx\nc\n");
  const half = resolveConflicts(p, ["ours", undefined]);
  expect(conflictParts(half).filter((x) => x.kind === "conflict").length).toBe(1);
  expect(conflictParts("no markers\n")).toEqual([{ kind: "text", text: "no markers\n" }]);
  expect(conflictParts("<<<<<<< HEAD\nunterminated\n")).toEqual([{ kind: "text", text: "<<<<<<< HEAD\nunterminated\n" }]);
  // CRLF 파일 — 줄 끝을 그대로 둔다
  expect(resolveConflicts(conflictParts("<<<<<<< HEAD\r\no\r\n=======\r\nt\r\n>>>>>>> x\r\n"), ["theirs"])).toBe("t\r\n");
});

test("업스트림 없는 push — 원격이 하나뿐이면 그 이름, 아니면 origin", () => {
  expect(pushRemote([])).toBe("origin");
  expect(pushRemote(["origin/main", "origin/HEAD"])).toBe("origin");
  expect(pushRemote(["upstream/main", "upstream/dev"])).toBe("upstream");
  expect(pushRemote(["origin/main", "fork/main"])).toBe("origin");
  expect(pushRemote(["fork/main", "gh/main"])).toBe("origin");
});

test("push 인자 — 업스트림 없으면 -u <원격> <브랜치>, 있으면 그냥 push (B180)", () => {
  const refs = (upstream: string, remote: string[] = ["origin/main"]) => ({
    local: [{ name: "feat", hash: "a", upstream, ahead: 0, behind: 0, gone: false, head: true }],
    remote: remote.map((name) => ({ name, hash: "b" })),
    tags: [],
    stashes: [],
    head: "a",
  });
  expect(pushArgs(refs(""))).toEqual(["push", "-u", "origin", "feat"]);
  expect(pushArgs(refs("", ["fork/main"]))).toEqual(["push", "-u", "fork", "feat"]);
  expect(pushArgs(refs("origin/feat"))).toEqual(["push"]);
  expect(pushArgs(undefined)).toEqual(["push"]);
});

test("경로 묶음 — 명령 줄 상한 안쪽으로 나누고 순서 · 개수를 지킨다 (B179)", () => {
  const paths = Array.from({ length: 900 }, (_, i) => `generated/components/very_long_folder_name/file_number_${i}_component.tsx`);
  const chunks = chunkPaths(paths);
  expect(chunks.length).toBeGreaterThan(5);
  expect(chunks.flat()).toEqual(paths);
  for (const c of chunks) expect(c.join(" ").length).toBeLessThan(8000);
  expect(chunkPaths([])).toEqual([]);
  expect(chunkPaths(["x".repeat(9000)])).toEqual([["x".repeat(9000)]]); // 혼자 넘는 경로도 한 묶음
});
