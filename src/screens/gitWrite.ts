// git 화면 쓰기 쪽 순수 함수 (§17 2단계) — 화면 밖에서 테스트한다.
// · workGuard: §4-1 작업 중 경고 — HEAD · 작업 트리를 바꾸기 전에 그 폴더 세션의 상태를 본다
// · splitHunks · hunkPatch: 덩어리 스테이징 — `git diff` 원문을 덩어리로 나눠 하나짜리 패치를 만든다
import type { Session } from "../types";
import type { GitRefs } from "../backend/git";
import { EXAMPLE_FILES } from "../backend/env";

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

/** B154 — 값을 가려 보일 .env 계열 파일인가. `.env` · `.env.*`, 예시 파일(.env.example · .env.sample)은 뺀다 */
export function isDotenvPath(path: string | undefined): boolean {
  const name = path?.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return (name === ".env" || name.startsWith(".env.")) && !EXAMPLE_FILES.includes(name);
}

// ── §17 3단계 충돌 — 작업 트리 파일의 표식(<<<<<<< ======= >>>>>>>)을 덩어리별로 고른다 ──

export type ConflictPick = "ours" | "theirs" | "both";

/** 충돌 표식이 든 원문의 조각 — 그대로인 글과 충돌 덩어리가 번갈아 온다. 줄 끝(\n · \r\n)은 그대로 남긴다 */
export type ConflictPart = { kind: "text"; text: string } | { kind: "conflict"; ours: string; theirs: string; oursLabel: string; theirsLabel: string };

export function conflictParts(text: string): ConflictPart[] {
  const parts: ConflictPart[] = [];
  const lines = text.split(/(?<=\n)/);
  let plain = "";
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.startsWith("<<<<<<< ") && l.replace(/\r?\n$/, "") !== "<<<<<<<") {
      plain += l;
      i++;
      continue;
    }
    // 끝 표식이 없으면 충돌이 아니다 — 남은 것을 글로 둔다
    const end = lines.findIndex((x, j) => j > i && x.startsWith(">>>>>>>"));
    const mid = lines.findIndex((x, j) => j > i && j < end && x.startsWith("=======") && x.replace(/\r?\n$/, "") === "=======");
    if (end < 0 || mid < 0) {
      plain += lines.slice(i).join("");
      break;
    }
    if (plain) parts.push({ kind: "text", text: plain });
    plain = "";
    // diff3 꼴 (`||||||| base`) — 공통 조상 쪽은 고를 대상이 아니다
    const base = lines.findIndex((x, j) => j > i && j < mid && x.startsWith("|||||||"));
    parts.push({
      kind: "conflict",
      ours: lines.slice(i + 1, base < 0 ? mid : base).join(""),
      theirs: lines.slice(mid + 1, end).join(""),
      oursLabel: l.slice(8).trim(),
      theirsLabel: lines[end].slice(8).trim(),
    });
    i = end + 1;
  }
  if (plain) parts.push({ kind: "text", text: plain });
  return parts;
}

/** 덩어리마다 고른 쪽으로 바꾼 원문. 고르지 않은 덩어리는 표식째 남는다 (git이 아직 충돌로 본다) */
export function resolveConflicts(parts: ConflictPart[], picks: (ConflictPick | undefined)[]): string {
  let n = 0;
  return parts
    .map((p) => {
      if (p.kind === "text") return p.text;
      const pick = picks[n++];
      if (pick === "ours") return p.ours;
      if (pick === "theirs") return p.theirs;
      if (pick === "both") return p.ours + p.theirs;
      return `<<<<<<< ${p.oursLabel}\n${p.ours}=======\n${p.theirs}>>>>>>> ${p.theirsLabel}\n`;
    })
    .join("");
}

/** 업스트림 없는 브랜치를 올릴 원격 — origin이 있거나 원격을 모르면 origin, 원격이 하나뿐이면 그것.
 *  remoteRefs = 원격 브랜치 이름(`upstream/main`). ponytail: 한 번도 fetch 안 한 원격은 목록에 없다 — 그때는 origin */
export function pushRemote(remoteRefs: string[]): string {
  const names = [...new Set(remoteRefs.map((r) => r.split("/")[0]).filter(Boolean))];
  return names.length === 1 ? names[0] : "origin";
}

/** push 인자 — 업스트림 없는 브랜치면 `push -u <원격> <브랜치>`. git 화면 · 사이드 패널이 같이 쓴다 (B180) */
export function pushArgs(refs: GitRefs | undefined): string[] {
  const b = refs?.local.find((x) => x.head);
  return b && !b.upstream ? ["push", "-u", pushRemote((refs?.remote ?? []).map((r) => r.name)), b.name] : ["push"];
}

/** 경로를 명령 줄 상한 안쪽 묶음으로 나눈다 (B179) — Windows 명령 줄은 32,767자까지다 */
export function chunkPaths(paths: string[], max = 8000): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const p of paths) {
    if (cur.length && len + p.length + 3 > max) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += p.length + 3; // 빈칸 · 따옴표
  }
  if (cur.length) out.push(cur);
  return out;
}

