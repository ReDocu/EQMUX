// git 패널 브리지 (PRD H) — 활성 워크스페이스의 저장소 개요를 읽기 전용으로 실측한다.
// 쓰기 작업(pull·push·commit)은 제공하지 않는다 — 실행은 터미널 페인에서 사람이 한다 (G7과 같은 원칙).
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { isTauri } from "./pty";

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  when: string;
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
}

export async function worktreeList(wsPath: string): Promise<WorktreeInfo[] | undefined> {
  if (!isTauri()) return undefined;
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
