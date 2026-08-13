// 앱 셸 상태 — 내비게이션은 result_prd.md §2 순서도의 계약을 따른다:
// 상태를 바꾸는 것은 언제나 사용자 버튼이며, 자동 실행 경로는 없다.
import { createSignal } from "solid-js";
import { backend } from "./backend/mock";

export type View =
  | { kind: "control" } // 관제 고정 탭 (FR-G-01·02) — 다중 워크스페이스 대시보드
  | { kind: "workspace"; id: string } // 워크스페이스 탭 = 컨트롤 센터 (bi8Au)
  | { kind: "connect" } // 레인 01 — 워크스페이스 연결
  | { kind: "launch"; wsId: string } // 레인 01 — 실행 방식 선택 (ChIvy)
  | { kind: "terminalSetup"; wsId: string } // 레인 01 — 기본 터미널 구성 (S9u2S)
  | { kind: "casting"; wsId: string } // 레인 01 — 팀 캐스팅
  | { kind: "composition"; wsId: string } // 레인 01 — 팀 편성
  | { kind: "roles" } // 역할 라이브러리 (화면 #7)
  | { kind: "missions"; wsId: string } // 임무 배정 (화면 #8)
  | { kind: "gitdiff"; wsId?: string } // Git Diff & Editor (AXXhV) — wsId 없으면 활성 워크스페이스
  | { kind: "settings" };

export type PanelTab = "conversation" | "git" | "ports" | "logs" | "browser";

export const [view, setView] = createSignal<View>({ kind: "control" });
export const [selectedSession, setSelectedSession] = createSignal<string | undefined>(undefined);
export const [exitOpen, setExitOpen] = createSignal(false);

/** 사이드 패널 (M1 — 대화는 패널 탭이며 메인 화면이 아니다) */
export const [panelOpen, setPanelOpen] = createSignal(false);
export const [panelTab, setPanelTab] = createSignal<PanelTab>("conversation");

/** 패널 탭을 지정해 열기 — 앱 바 도구 버튼(DdrkL)의 진입 경로 */
export function openPanel(tab: PanelTab) {
  setPanelTab(tab);
  setPanelOpen(true);
}

/** 페인 배치 (srpYm) — 6종 배치 모드. 배치 적용은 즉시 터미널 그리드에 반영된다. */
export type PaneLayout = "grid-col" | "grid-row" | "stack-v" | "row-h" | "main-right" | "main-bottom";
export const PANE_LAYOUTS: { key: PaneLayout; name: string; desc: string }[] = [
  { key: "grid-col", name: "그리드 · 열 우선", desc: "열을 먼저 채웁니다" },
  { key: "grid-row", name: "그리드 · 행 우선", desc: "행을 먼저 채웁니다" },
  { key: "stack-v", name: "세로 스택", desc: "위에서 아래로 나열" },
  { key: "row-h", name: "가로 나열", desc: "왼쪽에서 오른쪽으로 나열" },
  { key: "main-right", name: "메인 + 우측 스택", desc: "첫 세션 크게, 나머지 우측" },
  { key: "main-bottom", name: "메인 + 하단 나열", desc: "첫 세션 크게, 나머지 하단" },
];
export const [paneLayout, setPaneLayout] = createSignal<PaneLayout>("grid-row");
export const [layoutPickerOpen, setLayoutPickerOpen] = createSignal(false);

/** 터미널 전체 화면 (포커스 모드) — 앱 바는 유지되고 그 아래 영역만 덮는다 */
export const [terminalFull, setTerminalFull] = createSignal(false);

/** 임무 · 파일 탐색기 전체 화면 팝업 (M25) — 사이드 패널 탭에서 승격, 앱 바 임무 버튼이 토글 */
export const [explorerOpen, setExplorerOpen] = createSignal(false);

/** 새 터미널 셸 선택 — 실패 시 Rust 쪽 폴백 체인(pwsh → powershell → cmd)이 받친다 */
export interface ShellChoice {
  label: string; // Session.shell에 기록되는 식별자
  name: string;
  cmd: string;
}
export const SHELLS: ShellChoice[] = [
  { label: "pwsh", name: "PowerShell 7", cmd: "pwsh.exe" },
  { label: "powershell", name: "Windows PowerShell", cmd: "powershell.exe" },
  { label: "git-bash", name: "Git Bash", cmd: "C:\\Program Files\\Git\\bin\\bash.exe" },
  { label: "cmd", name: "cmd", cmd: "cmd.exe" },
];
export const [defaultShell, setDefaultShell] = createSignal<ShellChoice>(SHELLS[0]);

/** 백엔드 방송(FR-C-43) 수신 틱 — 화면은 tick()을 구독해 다시 그린다 */
export const [tick, setTick] = createSignal(0);
backend.subscribe(() => setTick((t) => t + 1));

/** 대시보드 셀 클릭 = 1클릭 점프 (FR-G-50). 페인을 보는 것이므로 미확인도 해제된다 (FR-G-44) */
export function jumpToSession(workspaceId: string, sessionId: string) {
  setSelectedSession(sessionId);
  backend.markSeen(sessionId);
  setView({ kind: "workspace", id: workspaceId });
}
