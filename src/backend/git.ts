// git 패널 · git 화면 브리지 (PRD H · §17). 읽기는 실측 그대로다.
// 쓰기(§17 G7′)는 gitRun 하나로만 간다 — 사람이 git 화면 · 패널에서 누를 때만 부르고, Rust가
// 허용 목록(gitx.rs check_args)으로 한 번 더 거른다. 에이전트 · 메시지 · 자동 규칙은 부르지 않는다.
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { t, tErr, tf } from "../i18n";
import { sendConversation } from "./conversation";
import { MOCK_WORKTREES } from "./mock";
import { isTauri } from "./pty";

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  /** 커밋 시각 epoch ms — 패널이 화면 언어의 상대 시각(fmtAgo)으로 그린다 (U173) */
  when: number;
  refs: string;
}

export interface GitOverview {
  branch: string;
  ahead: number;
  behind: number;
  changed: number;
  added: number;
  modified: number;
  deleted: number;
  commits: GitCommitInfo[];
}

/** 실패(비저장소·git 없음)는 undefined — 패널이 목/안내로 폴백한다 */
export async function gitOverview(wsPath: string): Promise<GitOverview | undefined> {
  if (!isTauri()) return undefined;
  return invoke<GitOverview>("git_overview", { wsPath }).catch(() => undefined);
}

// ── 워크트리 목록 (관제 레일 표시 전용) — 생성·삭제·체크아웃은 하지 않는다 ──

export interface WorktreeInfo {
  path: string;
  branch: string | null; // detached HEAD면 null
  head: string;
  isMain: boolean;
  isSession: boolean; // .eqmux/worktrees/ 아래 — 앱이 만든 것
  key?: string; // 비교 키 (실경로 · `/` · Windows 소문자) — 세션 cwd는 pathKeys로 같은 키를 받는다 (B132 · B151). 목업엔 없다
}

/** 경로 비교 키 — 워크트리 key와 같은 규칙. 브라우저 dev는 구분자 · 끝 `/` · 소문자만 맞춘다 */
export async function pathKeys(paths: string[]): Promise<string[]> {
  const local = () => paths.map((p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
  if (!isTauri() || paths.length === 0) return local();
  return invoke<string[]>("path_keys", { paths }).catch(local);
}

export async function worktreeList(wsPath: string): Promise<WorktreeInfo[] | undefined> {
  if (!isTauri()) return MOCK_WORKTREES[wsPath];
  return invoke<WorktreeInfo[]>("git_worktrees", { wsPath }).catch(() => undefined);
}

// ── diff 에디터 (PRD H) — HEAD ↔ 워크트리, 읽기 전용 ──

export interface ChangedFile {
  status: "A" | "M" | "D" | "R";
  path: string;
  stat: string;
  renamedFrom?: string | null; // 이름변경 (P-9) — 스테이징된 rename의 원래 경로
}

export interface DiffLine {
  no: number | null; // pad 필러 행은 번호가 없다 (B8)
  text: string;
  kind: "add" | "del" | "pad" | null;
}

export interface FileDiff {
  baseLabel: string;
  base: DiffLine[];
  current: DiffLine[];
  truncated: boolean;
}

export async function diffChangedFiles(wsPath: string): Promise<ChangedFile[] | undefined> {
  if (!isTauri()) return undefined;
  return invoke<ChangedFile[]>("diff_changed_files", { wsPath }).catch(() => undefined);
}

/** 실패 사유(바이너리 등)를 문자열로 돌려준다 */
/** renamedFrom — 변경 목록이 이미 아는 원래 경로. 넘기면 Rust가 git status를 다시 돌리지 않는다 (최적화 B8). "" = 이름변경 아님 */
export async function diffFile(wsPath: string, path: string, renamedFrom?: string | null): Promise<FileDiff | string> {
  if (!isTauri()) return t("브라우저 dev — 실측 없음");
  return invoke<FileDiff>("diff_file", { wsPath, path, renamedFrom: renamedFrom ?? "" }).catch((e) => String(e));
}

// ── 커밋 기준 diff (UI 리파인 §git) — 부모 커밋 ↔ 이 커밋, 읽기 전용 ──

export async function commitChangedFiles(wsPath: string, hash: string): Promise<ChangedFile[] | undefined> {
  if (!isTauri()) return undefined;
  return invoke<ChangedFile[]>("commit_changed_files", { wsPath, hash }).catch(() => undefined);
}

/** 실패 사유(바이너리 등)를 문자열로 돌려준다 — diffFile과 같은 계약 */
export async function commitFileDiff(wsPath: string, hash: string, path: string): Promise<FileDiff | string> {
  if (!isTauri()) return t("브라우저 dev — 실측 없음");
  return invoke<FileDiff>("commit_file_diff", { wsPath, hash, path }).catch((e) => String(e));
}

// ── 바로 가기 (0.5) — 원격 주소 → 웹 주소. 순수 함수라 테스트가 여기를 겨눈다 ──
// 사용자 정보(토큰)와 포트는 반드시 뗀다: 화면·툴팁·여는 주소 어디에도 토큰이 나오면 안 된다.
// 바꿀 수 없는 주소(로컬 경로·알 수 없는 형식)는 undefined — 부르는 쪽이 버튼을 숨긴다.

/** `git@github.com:acme/eqmux.git` · `ssh://git@host:2222/a/b.git` · `https://user:tok@host/a/b` → `https://host/a/b` */
export function remoteWebUrl(remote: string | undefined): string | undefined {
  const r = remote?.trim();
  if (!r || r.includes("\\")) return undefined; // Windows 로컬 경로
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(r); // scp 꼴 — `user@host:path`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(r)) {
    let u: URL;
    try {
      u = new URL(r);
    } catch {
      return undefined;
    }
    if (!/^(https?|ssh|git|git\+ssh):$/.test(u.protocol)) return undefined; // file:// 등
    host = u.hostname; // userinfo·포트는 여기서 떨어진다
    path = decodeURIComponent(u.pathname);
  } else if (scp && scp[1].length > 1) {
    // 한 글자 호스트는 드라이브 문자(`D:/repos/x`)다
    host = scp[1];
    path = scp[2];
  } else {
    return undefined;
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (!host || !path) return undefined;
  // Azure DevOps SSH — `ssh.dev.azure.com:v3/org/proj/repo` → `dev.azure.com/org/proj/_git/repo`
  if (host === "ssh.dev.azure.com") {
    const m = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
    return m ? `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}` : undefined;
  }
  return `https://${host}/${path}`;
}

/** 커밋 페이지 — GitHub·GitLab `/commit/<해시>`, Bitbucket `/commits/<해시>`. 그 밖의 호스트는 undefined */
export function commitWebUrl(remote: string | undefined, hash: string): string | undefined {
  const base = remoteWebUrl(remote);
  if (!base || !/^[0-9a-f]{4,40}$/i.test(hash)) return undefined;
  const host = new URL(base).hostname;
  if (host === "github.com" || host.includes("gitlab")) return `${base}/commit/${hash}`;
  if (host === "bitbucket.org") return `${base}/commits/${hash}`;
  return undefined;
}

// ── §17 git 화면 — 1단계 읽기 ──

export interface LogCommit {
  hash: string;
  parents: string[];
  author: string;
  time: number; // 유닉스 초
  subject: string;
  refs: string[]; // `HEAD -> main` · `origin/main` · `tag: v1`
}

export const LOG_PAGE = 300; // §17-5 — 처음 300개, 스크롤하면 더

export interface LogQuery {
  all: boolean;
  grep?: string;
  author?: string;
  file?: string; // 파일 히스토리 — 현재 브랜치, --follow
}

export async function gitLog(wsPath: string, skip: number, q: LogQuery): Promise<LogCommit[] | string> {
  if (!isTauri()) return t("브라우저 dev — 실측 없음");
  return invoke<LogCommit[]>("git_log", {
    wsPath,
    skip,
    limit: LOG_PAGE,
    all: q.all,
    grep: q.grep || null,
    author: q.author || null,
    file: q.file || null,
  }).catch((e) => String(e));
}

export interface BranchRef {
  name: string;
  hash: string;
  upstream: string;
  ahead: number;
  behind: number;
  gone: boolean;
  head: boolean;
}

export interface NamedRef {
  name: string;
  hash: string;
}

export interface GitRefs {
  local: BranchRef[];
  remote: NamedRef[];
  tags: NamedRef[];
  stashes: NamedRef[];
  head: string; // HEAD 커밋 해시 — 분리 HEAD도 · 빈 저장소면 ""
}

export async function gitRefs(wsPath: string): Promise<GitRefs | undefined> {
  if (!isTauri()) return undefined;
  return invoke<GitRefs>("git_refs", { wsPath }).catch(() => undefined);
}

/** HEAD 표시 겸 비교 값 — `main 1a2b3c4d` · 분리 HEAD면 해시만 · 빈 저장소면 "".
 *  해시까지 본다: 같은 브랜치의 pull · merge · reset · stash pop은 이름이 그대로다 (B175) */
export function headMark(r: GitRefs | undefined): string {
  if (!r?.head) return "";
  const b = r.local.find((x) => x.head)?.name;
  return b ? `${b} ${r.head.slice(0, 8)}` : r.head.slice(0, 8);
}

export const NOTIFY_KEY = "eqmux.git.notifyAgents"; // 바뀐 뒤 에이전트 알림 (§17-3) — 기본 꺼짐, 메시지 한 건만큼 토큰이 든다

/** 바뀐 뒤 알림 (§17-3) — 켜 두었고 op 전후로 HEAD가 달라졌을 때만, 그 폴더의 에이전트 전부에게 한 건.
 *  git 화면 guarded · 사이드 패널 pull이 같이 쓴다 */
export async function withHeadNotice<T>(wsId: string, wsPath: string, op: () => Promise<T>): Promise<T> {
  if (localStorage.getItem(NOTIFY_KEY) !== "1") return op();
  const before = headMark(await gitRefs(wsPath));
  const r = await op();
  const after = headMark(await gitRefs(wsPath));
  if (after && after !== before)
    void sendConversation(wsId, "@all", "report", tf("브랜치·HEAD가 {a} → {b}로 바뀌었습니다. 작업 중인 파일을 다시 읽으세요.", { a: before || "—", b: after }));
  return r;
}

export interface CommitDetail {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authorTime: number;
  committer: string;
  commitTime: number;
  body: string;
}

export async function gitCommitDetail(wsPath: string, hash: string): Promise<CommitDetail | undefined> {
  if (!isTauri()) return undefined;
  return invoke<CommitDetail>("git_commit_detail", { wsPath, hash }).catch(() => undefined);
}

export interface BlameLine {
  hash: string;
  author: string;
  time: number;
  text: string;
}

export async function gitBlame(wsPath: string, file: string): Promise<BlameLine[] | string> {
  if (!isTauri()) return t("브라우저 dev — 실측 없음");
  return invoke<BlameLine[]>("git_blame", { wsPath, file }).catch((e) => String(e));
}

// ── §17 2단계 — 작업 트리 · 쓰기 ──

export interface StatusFile {
  path: string;
  from: string | null;
  x: string; // 인덱스 쪽 — " "면 스테이지된 것 없음
  y: string; // 작업 트리 쪽 — "?"는 추적 안 됨
}

export interface WorkStatus {
  files: StatusFile[];
  headPushed: boolean; // amend가 푸시한 커밋을 바꾼다
  hasHead: boolean;
  progress: "merge" | "rebase" | "cherry-pick" | "revert" | null; // §17-4 진행 중 배너
}

/** 충돌 파일 — 양쪽이 고침(UU) · 둘 다 더함(AA) · 한쪽 지움(UD · DU) 등. Rust is_conflict와 같은 규칙 */
export const isConflict = (f: StatusFile): boolean => f.x === "U" || f.y === "U" || (f.x === "A" && f.y === "A") || (f.x === "D" && f.y === "D");

export async function gitStatus(wsPath: string): Promise<WorkStatus | undefined> {
  if (!isTauri()) return undefined;
  return invoke<WorkStatus>("git_status", { wsPath }).catch(() => undefined);
}

export async function gitFilePatch(wsPath: string, file: string, staged: boolean): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("git_file_patch", { wsPath, file, staged }).catch(() => "");
}

export interface RunResult {
  ok: boolean;
  command: string;
  output: string;
  auth: boolean; // 자격 증명 프롬프트가 필요했다 — "터미널에서 한 번 로그인" 안내
}

export interface RunLogEntry extends RunResult {
  ts: number;
  wsId: string;
}

/** 실행 로그 (§17-4) — 이번 실행 동안 앱이 돌린 git 쓰기. 로그 패널(event 테이블)에도 한 줄씩 남긴다 */
const [runLog, setRunLog] = createSignal<RunLogEntry[]>([]);
export { runLog };
/** 실행 로그 펼침 — 모듈에 둔다. 실패 알림 · 사이드 패널의 [실행 로그 열기]가 git 화면 밖에서 켠다 (B177) */
export const [runLogOpen, setRunLogOpen] = createSignal(false);

/** 실패 원인 줄 (B177) — git은 첫 줄에 진행 머리말(To · From · On branch)을 찍는다. 원인 줄을 먼저 찾는다 */
function causeLine(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(error|fatal):|^! \[|^CONFLICT\b/.test(l)) ?? lines[0] ?? "";
}

/** 실패 알림 문구 (B177 · U125) — 흔한 경우는 할 일을 앞에 붙이고, 원인 줄은 사전을 한 번 거친다(없으면 원문) */
export function failText(output: string): string {
  const cause = tErr(causeLine(output)) || t("실패");
  const hint = /\[rejected\].*\((fetch first|non-fast-forward)\)/.test(output)
    ? "원격에 새 커밋이 있습니다 — Pull 하세요"
    : /Not possible to fast-forward/.test(output)
      ? "원격과 갈라졌습니다 — Pull ▾에서 merge 또는 rebase를 고르세요"
      : /is now empty/.test(output)
        ? "이 커밋의 변경이 이미 있습니다 — 배너의 [건너뛰기]로 넘어가세요"
        : /^CONFLICT\b/m.test(output)
          ? "충돌이 났습니다 — 배너에서 [충돌 보기]를 고르세요"
          : undefined;
  return hint ? `${t(hint)} (${cause})` : cause;
}

function record(wsId: string, r: RunResult): RunResult {
  setRunLog((l) => [{ ...r, ts: Date.now(), wsId }, ...l].slice(0, 200));
  const head = r.ok ? (r.output.split("\n").find((x) => x.trim()) ?? "") : causeLine(r.output);
  void invoke("events_log", {
    workspace: wsId,
    session: null,
    kind: "git",
    message: `${r.ok ? "" : "실패 · "}${r.command}${head ? ` — ${head}` : ""}`,
  }).catch(() => {});
  return r;
}

/** 사람이 보는 명령 문자열 — Rust command_line과 같은 규칙 ([명령 복사]용, 실행 전에 필요하다) */
export function commandLine(args: string[]): string {
  return ["git", ...args.map((a) => (a === "" || /[\s"'&|<>;]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(" ");
}

/** G7′ 쓰기 — 허용 목록 밖이면 Rust가 실행하지 않고 거부한다. 결과는 실행 로그에 남는다 */
export async function gitRun(wsId: string, wsPath: string, args: string[]): Promise<RunResult> {
  if (!isTauri()) return { ok: false, command: commandLine(args), output: t("브라우저 dev — 실측 없음"), auth: false };
  const r = await invoke<RunResult>("git_run", { wsPath, args }).catch(
    (e): RunResult => ({ ok: false, command: commandLine(args), output: String(e), auth: false }),
  );
  return record(wsId, r);
}

/** 덩어리 스테이징 — reverse = 스테이지 내리기. 작업 트리는 건드리지 않는다 */
export async function gitApplyPatch(wsId: string, wsPath: string, patch: string, reverse: boolean): Promise<RunResult> {
  if (!isTauri()) return { ok: false, command: "git apply --cached", output: t("브라우저 dev — 실측 없음"), auth: false };
  const r = await invoke<RunResult>("git_apply_patch", { wsPath, patch, reverse }).catch(
    (e): RunResult => ({ ok: false, command: "git apply --cached", output: String(e), auth: false }),
  );
  return record(wsId, r);
}

// ── §17 3단계 · §17-3 ──

/** `from..to` 커밋 — reset --hard 확인창이 "사라질 수 있는 커밋"으로 보인다 */
export async function gitRange(wsPath: string, from: string, to = "HEAD"): Promise<LogCommit[]> {
  if (!isTauri()) return [];
  return invoke<LogCommit[]>("git_range", { wsPath, from, to }).catch(() => []);
}

/** 그래프 세션 배지 (§17-3) — 해시 → 만든 것으로 보이는 세션 id들 (편집 기록 C4 기준 추정) */
export async function gitCommitSessions(wsId: string, wsPath: string, hashes: string[]): Promise<Record<string, string[]>> {
  if (!isTauri() || hashes.length === 0) return {};
  return invoke<Record<string, string[]>>("git_commit_sessions", { wsId, wsPath, hashes }).catch(() => ({}));
}

// ── §13-3 임무 검토 (W4) — 기준 커밋(base_commit) ↔ 워크트리. diffChangedFiles · diffFile과 같은 계약 ──

export async function diffChangedFilesSince(wsPath: string, base: string): Promise<ChangedFile[] | undefined> {
  if (!isTauri()) return undefined;
  return invoke<ChangedFile[]>("diff_changed_files_since", { wsPath, base }).catch(() => undefined);
}

export async function diffFileSince(wsPath: string, base: string, path: string, renamedFrom?: string | null): Promise<FileDiff | string> {
  if (!isTauri()) return t("브라우저 dev — 실측 없음");
  return invoke<FileDiff>("file_diff_since", { wsPath, base, path, renamedFrom: renamedFrom ?? "" }).catch((e) => String(e));
}
