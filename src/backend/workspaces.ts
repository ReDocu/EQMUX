// 워크스페이스 레지스트리 브리지 (PRD E §4.1) — Rust ws_* 커맨드의 프런트 소비 표면.
// Tauri에서는 workspaces.json 실물 레지스트리가 목 목록을 대체(hydrate)하고,
// 브라우저 dev에서는 기존 목 데이터가 그대로 남는다.
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { refreshConversation } from "./conversation";
import { restoreUnseen, startUnseenSync } from "./flags";
import { restoreRecaps } from "./recap";
import { restoreLayout, startLayoutSync } from "./layout";
import { loadSettings } from "./settings";
import { refreshLibrary } from "./library";
import { backend } from "./mock";
import { refreshMissions } from "./missions";
import { isTauri } from "./pty";
import { flushTeamNow, restoreTeams } from "./team";
import { setView, view } from "../state";
import { t, tf } from "../i18n";
import type { Workspace } from "../types";

export interface WsEntry {
  id: string;
  name: string;
  path: string;
  remote: string | null;
  branch: string | null;
  last_used: number;
  /** 다른 프로젝트 메시지 받기 (0.5, W2) — 없으면 받는다 */
  cross_project?: boolean;
}

export interface WsInfo {
  entry: WsEntry;
  exists: boolean;
  is_repo: boolean;
}

// 다른 프로젝트 메시지 받기 — 끈 워크스페이스만 기억한다(기본 켬). Workspace 타입을 넓히지 않고 여기 둔다
const [crossOff, setCrossOff] = createSignal<ReadonlySet<string>>(new Set());
export const crossProjectOn = (id: string): boolean => !crossOff().has(id);

/** 받기 토글 — Rust 레코드가 원본이다. 실패는 그대로 던져 호출부가 notify()로 보인다 */
export async function setCrossProject(id: string, on: boolean): Promise<void> {
  if (isTauri()) await invoke("ws_set_cross_project", { id, on });
  const next = new Set(crossOff());
  if (on) next.delete(id);
  else next.add(id);
  setCrossOff(next);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toWorkspace(w: WsInfo): Workspace {
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
    notRepo: w.exists && !w.is_repo, // 폴더는 있다 — 재지정만이 아니라 git init도 권한다 (0.6 QA P80)
    teamFile: ".eqmux/team.json",
    lastUsed: t
      ? `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`
      : undefined,
  };
}

/** 레지스트리를 다시 읽어 목 백엔드의 워크스페이스 목록을 실물로 교체하고 팀 슬롯을 복원한다 */
export async function refreshWorkspaces(): Promise<void> {
  if (!isTauri()) return;
  // 설정이 제일 먼저다 — restoreTeams·그리드가 maxSlots를, restoreLayout이 startView를 본다.
  // 모듈 로드 시점에 이미 시작된 로드를 기다리는 것뿐이라 추가 지연은 없다.
  await loadSettings();
  const list = await invoke<WsInfo[]>("ws_registry").catch(() => [] as WsInfo[]);
  backend.hydrateWorkspaces(list.map(toWorkspace));
  setCrossOff(new Set(list.filter((w) => w.entry.cross_project === false).map((w) => w.entry.id)));
  // 유령 뷰 정규화 — 현재 탭의 워크스페이스가 레지스트리에서 사라졌으면 관제로 돌아간다.
  // 방치하면 본문은 Dashboard 폴백인데 앱 바는 어떤 탭도 활성이 아닌 충돌 상태가 되고,
  // layout.json에 존재하지 않는 lastWorkspace가 계속 저장된다.
  const v = view();
  if (v.kind === "workspace" && !list.some((w) => w.entry.id === v.id)) {
    setView({ kind: "control" });
  }
  await refreshLibrary(); // 라이브러리 실파일 (FR-E-20~23) — 팀 복원이 이름·색을 참조하므로 먼저
  // 디바운스(500ms) 중인 팀 변경을 먼저 파일에 내린다 — 스테일 team.json을 다시 읽으면
  // 방금 지운 역할 세션이 복원되어 되살아난다
  flushTeamNow();
  await restoreTeams(); // team.json → 슬롯 복원 (에이전트 자동 실행 없음, S3)
  await restoreUnseen(); // 미확인 영속 (G) — 세션이 존재해야 점이 붙는다. 동기화는 복원 뒤 시작
  startUnseenSync();
  // 마지막 한 줄 요약 (M35) — 미확인과 같은 이유로 슬롯 복원 뒤다. 앱을 껐다 켰을 때
  // 페인 헤더가 "무엇을 하고 있었는지"를 말하는 것이 이 기능의 전부이므로 여기가 본 경로다
  await Promise.all(
    backend.listWorkspaces().filter((w) => !w.pathMissing).map((w) => restoreRecaps(w.id)),
  );
  // 임무 실측 (FR-E-59) — 슬롯 복원 뒤에 돌아야 배정이 세션 missionId에 얹힌다.
  // 대화 원장(PRD F)도 같은 타이밍에 읽는다 — 목 시드를 걷어내고 실물 스트림으로.
  await Promise.all(
    backend
      .listWorkspaces()
      .filter((w) => !w.pathMissing)
      .flatMap((w) => [refreshMissions(w.id), refreshConversation(w.id)]),
  );
  // 레이아웃 복원 (FR-C-22·30) — 워크스페이스가 실재해야 탭을 열 수 있다.
  // 동기화는 복원 뒤에 시작 — 부트스트랩 중간 상태로 저장본을 덮지 않는다.
  await restoreLayout();
  startLayoutSync();
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

/** 진행 중 clone 취소 (P72) — cloneRepo가 CLONE_CANCELLED|<남은 경로>로 끝난다 */
export function cancelClone(): void {
  void invoke("ws_clone_cancel").catch(() => {});
}

// git clone --progress 단계 이름 → 화면 문구 (P72). 모르는 단계 · 진행률 없는 줄은 원문 그대로
const CLONE_STAGE: Record<string, string> = {
  "Enumerating objects": "원격 객체 세는 중",
  "Counting objects": "원격 객체 세는 중",
  "Compressing objects": "원격 압축 중",
  "Receiving objects": "객체 받는 중",
  "Resolving deltas": "델타 정리 중",
  "Updating files": "파일 풀어놓는 중",
};

/** clone-progress 이벤트 한 줄 → '객체 받는 중 42%' (P72) */
export function cloneProgressText(line: string): string {
  const m = /^(?:remote: )?([A-Za-z ]+):\s+(\d+)%/.exec(line.trim());
  const stage = m && CLONE_STAGE[m[1]];
  return stage ? `${t(stage)} ${m[2]}%` : line.trim();
}

/** 취소 · 상한으로 끝난 clone의 오류 → 사람 문구 (P72). 받다 만 폴더를 지웠는지 함께 말한다. 그 밖의 실패는 undefined */
export function cloneStopText(err: string): { text: string; clean: boolean } | undefined {
  const m = /^CLONE_(CANCELLED|TIMEOUT)\|(.*)$/s.exec(err);
  if (!m) return undefined;
  const head = m[1] === "CANCELLED" ? t("clone을 취소했습니다") : t("clone이 60분 안에 끝나지 않아 멈췄습니다");
  const tail = m[2] ? tf("받다 만 폴더가 남았습니다 — {path}", { path: m[2] }) : t("받다 만 폴더를 지웠습니다");
  return { text: `${head} — ${tail}`, clean: !m[2] };
}

export function unregisterWorkspace(id: string): Promise<void> {
  return invoke("ws_unregister", { id });
}

/** 등록 해제 [되돌리기] (B289) — 같은 id로 되살린다. 경로로 다시 등록하면 재지정한 항목은 다른 id가 됐다 */
export function restoreWorkspace(id: string): Promise<WsInfo> {
  return invoke<WsInfo>("ws_restore", { id });
}

/** 비워 두면 돌아갈 이름 — 경로의 마지막 폴더 (Rust entry_name과 같은 규칙) */
export const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** 저장하면 붙을 이름 (S23) — 앞뒤 공백을 떼고, 비면 폴더 이름 */
export const wsNameAfter = (draft: string, path: string): string => draft.trim() || folderName(path);

/** 워크스페이스 이름 바꾸기 (S23) — 등록 정보의 이름만, 폴더는 그대로. 이미 있는 세션 이름은 그대로 두고
 *  새 세션 자동 이름(projectStem)과 다른 프로젝트 주소(projectLabels)가 새 이름을 쓴다. 실패는 던진다 */
export async function renameWorkspace(id: string, draft: string): Promise<void> {
  const ws = backend.listWorkspaces().find((w) => w.id === id);
  if (!ws) return;
  const name = isTauri() ? await invoke<string>("ws_rename", { id, name: draft }) : wsNameAfter(draft, ws.path);
  backend.renameWorkspace(id, name);
}

export function repathWorkspace(id: string, path: string): Promise<WsInfo> {
  return invoke<WsInfo>("ws_repath", { id, path });
}

export function touchWorkspace(id: string): void {
  if (!isTauri()) return;
  void invoke("ws_touch", { id }).catch(() => {});
}

/** 임무-브랜치 체크아웃 (FR-E-52) — 있으면 checkout, 없으면 -b 생성. 공유 repo 전체에
 *  영향이 있으므로(E1′ 공유 기본) 호출부는 반드시 2단 확인을 거친다. */
export function checkoutBranch(wsPath: string, branch: string): Promise<string> {
  return invoke<string>("ws_checkout", { wsPath, branch });
}
