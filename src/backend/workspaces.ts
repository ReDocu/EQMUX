// 워크스페이스 레지스트리 브리지 (PRD E §4.1) — Rust ws_* 커맨드의 프런트 소비 표면.
// Tauri에서는 workspaces.json 실물 레지스트리가 목 목록을 대체(hydrate)하고,
// 브라우저 dev에서는 기존 목 데이터가 그대로 남는다.
import { invoke } from "@tauri-apps/api/core";
import { refreshLibrary } from "./library";
import { backend } from "./mock";
import { refreshMissions } from "./missions";
import { isTauri } from "./pty";
import { restoreTeams } from "./team";
import type { Workspace } from "../types";

export interface WsEntry {
  id: string;
  name: string;
  path: string;
  remote: string | null;
  branch: string | null;
  last_used: number;
}

export interface WsInfo {
  entry: WsEntry;
  exists: boolean;
  is_repo: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toWorkspace(w: WsInfo): Workspace {
  const t = w.entry.last_used ? new Date(w.entry.last_used) : undefined;
  return {
    id: w.entry.id,
    name: w.entry.name,
    path: w.entry.path,
    remote: w.entry.remote ?? undefined,
    branch: w.entry.branch ?? undefined,
    branchNote: !w.exists
      ? "경로를 찾을 수 없음"
      : !w.is_repo
        ? "git 저장소 아님"
        : `${w.entry.branch ?? "(브랜치 없음)"} · 실측`,
    open: false,
    pathMissing: !w.exists || !w.is_repo,
    teamFile: ".eqmux/team.json",
    lastUsed: t
      ? `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`
      : undefined,
  };
}

/** 레지스트리를 다시 읽어 목 백엔드의 워크스페이스 목록을 실물로 교체하고 팀 슬롯을 복원한다 */
export async function refreshWorkspaces(): Promise<void> {
  if (!isTauri()) return;
  const list = await invoke<WsInfo[]>("ws_registry").catch(() => [] as WsInfo[]);
  backend.hydrateWorkspaces(list.map(toWorkspace));
  await refreshLibrary(); // 라이브러리 실파일 (FR-E-20~23) — 팀 복원이 이름·색을 참조하므로 먼저
  await restoreTeams(); // team.json → 슬롯 복원 (에이전트 자동 실행 없음, S3)
  // 임무 실측 (FR-E-59) — 슬롯 복원 뒤에 돌아야 배정이 세션 missionId에 얹힌다
  await Promise.all(
    backend
      .listWorkspaces()
      .filter((w) => !w.pathMissing)
      .map((w) => refreshMissions(w.id)),
  );
}

export function pickFolder(): Promise<string | null> {
  return invoke<string | null>("ws_pick_folder").catch(() => null);
}

/** git 저장소가 아니면 "NOT_A_REPO" 문자열로 reject된다 (FR-E-01) */
export function registerWorkspace(path: string): Promise<WsInfo> {
  return invoke<WsInfo>("ws_register", { path });
}

export function gitInit(path: string): Promise<void> {
  return invoke("ws_git_init", { path });
}

export function cloneRepo(url: string, parent: string): Promise<string> {
  return invoke<string>("ws_clone", { url, parent });
}

export function unregisterWorkspace(id: string): Promise<void> {
  return invoke("ws_unregister", { id });
}

export function repathWorkspace(id: string, path: string): Promise<WsInfo> {
  return invoke<WsInfo>("ws_repath", { id, path });
}

export function touchWorkspace(id: string): void {
  if (!isTauri()) return;
  void invoke("ws_touch", { id }).catch(() => {});
}
