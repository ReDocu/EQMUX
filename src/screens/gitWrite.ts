// git 화면 쓰기 쪽 순수 함수 (§17 2단계) — 화면 밖에서 테스트한다.
// · workGuard: §4-1 작업 중 경고 — HEAD · 작업 트리를 바꾸기 전에 그 폴더 세션의 상태를 본다
// · splitHunks · hunkPatch: 덩어리 스테이징 — `git diff` 원문을 덩어리로 나눠 하나짜리 패치를 만든다
import type { Session } from "../types";

export type GuardLevel = "busy" | "waiting" | "none";

type GuardSession = Pick<Session, "workspaceId" | "status" | "worktree" | "worktreeMissing">;

/** 경고에 이름을 올릴 세션 — 그 폴더에서 돌고 작업 중 · 시작 중 · 승인 대기인 것 */
export function guardSessions<S extends GuardSession>(sessions: S[], wsId: string): S[] {
  return sessions.filter(
    (s) => s.workspaceId === wsId && !(s.worktree && !s.worktreeMissing) && ["busy", "starting", "waiting"].includes(s.status),
  );
}

/** busy(작업 중 · 시작 중)가 있으면 강한 경고, waiting만 있으면 약한 경고, 아니면 확인 없이 간다.
 *  자기 워크트리에서 도는 세션은 발밑 파일이 안 바뀌므로 뺀다 (워크트리 디렉터리가 없어 루트로 폴백한 세션은 넣는다) */
export function workGuard(sessions: GuardSession[], wsId: string): { level: GuardLevel; busy: number; waiting: number } {
  const here = guardSessions(sessions, wsId);
  const busy = here.filter((s) => s.status === "busy" || s.status === "starting").length;
  const waiting = here.filter((s) => s.status === "waiting").length;
  return { level: busy ? "busy" : waiting ? "waiting" : "none", busy, waiting };
}

/** 확인창이 떠 있는 사이 상태가 바뀌었는가 — 더 나빠졌으면 다시 묻는다 (§4-1 경쟁 조건) */
export function guardWorsened(before: GuardLevel, now: GuardLevel): boolean {
  const rank = { none: 0, waiting: 1, busy: 2 } as const;
  return rank[now] > rank[before];
}

export interface FilePatch {
  header: string; // `diff --git` ~ `+++` 줄
  hunks: string[]; // `@@`로 시작하는 덩어리, 끝 줄바꿈 포함
}

/** 한 파일의 `git diff` 원문 → 머리 + 덩어리. 바이너리 · 빈 diff는 덩어리가 없다 */
export function splitHunks(diff: string): FilePatch {
  const lines = diff.split(/(?<=\n)/); // 줄바꿈을 줄에 남긴다 — apply가 그대로 받게
  const first = lines.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return { header: diff, hunks: [] };
  const hunks: string[] = [];
  for (const l of lines.slice(first)) {
    if (l.startsWith("@@")) hunks.push(l);
    else hunks[hunks.length - 1] += l;
  }
  return { header: lines.slice(0, first).join(""), hunks: hunks.map((h) => (h.endsWith("\n") ? h : h + "\n")) };
}

/** 덩어리 하나만 담은 패치 — `git apply --cached`가 받는다 */
export function hunkPatch(p: FilePatch, i: number): string {
  return p.header + p.hunks[i];
}

/** 덩어리 머리의 범위 표시 — `@@ -3,7 +3,8 @@ fn x` → `-3,7 +3,8` */
export function hunkRange(hunk: string): string {
  return /^@@ ([^@]+) @@/.exec(hunk)?.[1].trim() ?? "";
}

/** 브랜치 · 태그 이름 검사 (git check-ref-format의 흔한 규칙만) — 틀리면 이유, 맞으면 undefined.
 *  git이 어차피 거부하지만, `-`로 시작하는 이름은 허용 목록이 옵션으로 보고 막으므로 먼저 알린다 */
export function refNameProblem(name: string): string | undefined {
  const n = name.trim();
  if (!n) return "이름이 비었습니다";
  if (n.startsWith("-")) return "이름은 -로 시작할 수 없습니다";
  if (/[\s~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.lock$|\.$/.test(n)) return "git이 받지 않는 이름입니다";
  return undefined;
}
