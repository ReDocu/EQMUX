// git 패널 브리지 (PRD H) — 활성 워크스페이스의 저장소 개요를 읽기 전용으로 실측한다.
// 쓰기 작업(pull·push·commit)은 제공하지 않는다 — 실행은 터미널 페인에서 사람이 한다 (G7과 같은 원칙).
import { invoke } from "@tauri-apps/api/core";
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

// ── 워크트리·브랜치 (M36 — orca식 안전 범위) ──
// 커밋 이력을 바꾸지 않는 작업 트리 조작만: 목록·생성·체크아웃·열기.
// 삭제(FR-E-64 — 정리는 사람 몫)와 commit·push·stage(G7)는 계속 제공하지 않는다.

export interface WorktreeInfo {
  path: string;
  branch: string | null; // detached HEAD면 null
  head: string;
  isMain: boolean;
  isSession: boolean; // .eqmux/worktrees/ 아래 — 앱이 만든 것
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean; // 원격에만 있는 이름 — checkout 시 추적 브랜치가 만들어진다
}

export async function worktreeList(wsPath: string): Promise<WorktreeInfo[] | undefined> {
  if (!isTauri()) return undefined;
  return invoke<WorktreeInfo[]>("git_worktrees", { wsPath }).catch(() => undefined);
}

export async function branchList(wsPath: string): Promise<BranchInfo[] | undefined> {
  if (!isTauri()) return undefined;
  return invoke<BranchInfo[]>("git_branches", { wsPath }).catch(() => undefined);
}

/** 이름 있는 워크트리 생성 — base ref에서 분기. 반환은 절대 경로. 실패는 throw */
export function worktreeAdd(wsPath: string, name: string, base?: string): Promise<string> {
  return invoke<string>("worktree_add", { wsPath, name, base: base ?? null });
}

// ── diff 에디터 (PRD H) — HEAD ↔ 워크트리, 읽기 전용 ──

export interface ChangedFile {
  status: "A" | "M" | "D";
  path: string;
  stat: string;
}

export interface DiffLine {
  no: number;
  text: string;
  kind: "add" | "del" | null;
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
export async function diffFile(wsPath: string, path: string): Promise<FileDiff | string> {
  if (!isTauri()) return "브라우저 dev — 실측 없음";
  return invoke<FileDiff>("diff_file", { wsPath, path }).catch((e) => String(e));
}
