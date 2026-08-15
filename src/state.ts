// 앱 셸 상태 — 내비게이션은 result_prd.md §2 순서도의 계약을 따른다:
// 상태를 바꾸는 것은 언제나 사용자 버튼이며, 자동 실행 경로는 없다.
import { createSignal } from "solid-js";
import { backend } from "./backend/mock";
import type { Workspace } from "./types";

export type View =
  | { kind: "control" } // 관제 고정 탭 (FR-G-01·02) — 다중 워크스페이스 대시보드
  | { kind: "workspace"; id: string } // 워크스페이스 탭 = 컨트롤 센터 (bi8Au)
  | { kind: "launch"; wsId: string } // 레인 01 — 실행 방식 선택 (ChIvy)
  | { kind: "terminalSetup"; wsId: string } // 레인 01 — 기본 터미널 구성 (S9u2S)
  | { kind: "casting"; wsId: string } // 레인 01 — 팀 캐스팅
  | { kind: "composition"; wsId: string } // 레인 01 — 팀 편성
  | { kind: "missions"; wsId: string } // 임무 배정 (화면 #8)
  // Git Diff (AXXhV) — wsId 없으면 활성 워크스페이스, ✕/Esc는 back으로 복귀 (U11).
  // commit이 있으면 부모 커밋 ↔ 이 커밋 비교(UI 리파인 §git), 없으면 HEAD ↔ 워크트리
  | { kind: "gitdiff"; wsId?: string; back?: View; commit?: { hash: string; message: string } };
// 워크스페이스 연결·역할 라이브러리·설정은 View가 아니라 팝업(OverlayKind)이다 — 아래 overlay 참조

/** 전체 화면 팝업 (M25 확장) — NAV 도구 4종(임무·워크스페이스·역할·설정)이 전부 팝업이다.
 *  신호가 하나라서 동시에 하나만 열린다. 화면 전환(setView)은 열린 팝업을 닫는다. */
export type OverlayKind = "explorer" | "connect" | "roles" | "settings";
export const [overlay, setOverlay] = createSignal<OverlayKind | undefined>(undefined);
export function toggleOverlay(k: OverlayKind): void {
  setOverlay(overlay() === k ? undefined : k);
}

export type PanelTab = "conversation" | "git" | "ports" | "logs" | "browser";

const [viewSig, setViewRaw] = createSignal<View>({ kind: "control" });
export const view = viewSig;
/** 마지막으로 있던 워크스페이스 — 관제·설정 같은 전역 화면에서도 패널 스코프가 유지되게 한다 */
export const [lastWorkspaceId, setLastWorkspaceId] = createSignal<string | undefined>(undefined);
export function setView(v: View): View {
  // 워크스페이스 문맥을 가진 화면 전부가 기록 대상이다 — 임무 배정·캐스팅·diff에서
  // 대화를 열어도 그 워크스페이스의 스트림이 나와야 한다
  const wsId = v.kind === "workspace" ? v.id : "wsId" in v ? v.wsId : undefined;
  if (wsId) setLastWorkspaceId(wsId);
  setOverlay(undefined); // 화면 전환 = 팝업 문맥을 떠난다 — 열린 팝업이 새 화면을 가리지 않게
  return setViewRaw(v);
}
export const [selectedSession, setSelectedSession] = createSignal<string | undefined>(undefined);
export const [exitOpen, setExitOpen] = createSignal(false);

/** 패널 스코프의 단일 소스 — 대화·임무 탐색기·git 패널이 전부 이 판정을 본다.
 *  규칙: 워크스페이스 문맥이 있는 화면이 활성이면 그것, 아니면 마지막으로 있던 워크스페이스.
 *  "첫 번째 열린 것" 폴백은 없다 — 조용히 다른 팀을 보여주는 것이 최악이라서다. */
export function activeWorkspaceId(): string | undefined {
  const v = view();
  if (v.kind === "workspace") return v.id;
  if ("wsId" in v && v.wsId) return v.wsId;
  return lastWorkspaceId();
}

/** activeWorkspaceId를 실제 워크스페이스로 해석 — 등록 해제됐으면 undefined (스코프 없음) */
export function scopeWorkspace(): Workspace | undefined {
  tick();
  const id = activeWorkspaceId();
  return id ? backend.listWorkspaces().find((w) => w.id === id) : undefined;
}

/** 사이드 패널 (M1 — 대화는 패널 탭이며 메인 화면이 아니다) */
export const [panelOpen, setPanelOpen] = createSignal(false);
export const [panelTab, setPanelTab] = createSignal<PanelTab>("conversation");
/** 사이드 패널 위치 — 패널 탭 줄의 전환 버튼이 토글하고 layout.json에 영속된다 */
export const [panelSide, setPanelSide] = createSignal<"left" | "right">("right");

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
/** 배치는 워크스페이스별이다 (U7) — EQMux에서 바꾼 배치가 Atlas까지 따라가지 않는다.
 *  paneLayout()/setPaneLayout()은 기존 시그니처를 유지하고 현재 워크스페이스 탭에 바인딩된다. */
export const [paneLayouts, setPaneLayouts] = createSignal<Partial<Record<string, PaneLayout>>>({});
const layoutScope = () => {
  const v = view();
  return v.kind === "workspace" ? v.id : "_default";
};
export function paneLayout(): PaneLayout {
  return paneLayouts()[layoutScope()] ?? "grid-row";
}
export function setPaneLayout(l: PaneLayout): void {
  setPaneLayouts({ ...paneLayouts(), [layoutScope()]: l });
}
export const [layoutPickerOpen, setLayoutPickerOpen] = createSignal(false);

/** 분할선 드래그 (PRD B 잔여, M30) — 배치별 트랙 비율. 축이 있는 배치만 해당 축을 갖는다.
 *  합은 1, 트랙당 최소 0.08. layout.json에 배치별로 영속된다 (FR-C-22와 같은 파일). */
export interface PaneRatio {
  cols?: number[];
  rows?: number[];
}
export const DEFAULT_RATIOS: Record<PaneLayout, PaneRatio> = {
  "grid-col": { cols: [0.5, 0.5], rows: [0.5, 0.5] },
  "grid-row": { cols: [0.5, 0.5], rows: [0.5, 0.5] },
  "stack-v": { rows: [0.25, 0.25, 0.25, 0.25] },
  "row-h": { cols: [0.25, 0.25, 0.25, 0.25] },
  "main-right": { cols: [2 / 3, 1 / 3] },
  "main-bottom": { rows: [2 / 3, 1 / 3] },
};
export const [paneRatios, setPaneRatios] = createSignal<Partial<Record<PaneLayout, PaneRatio>>>({});
/** 현재 배치의 유효 비율 — 저장본이 없으면 기본값 */
export function ratioFor(layout: PaneLayout): PaneRatio {
  const d = DEFAULT_RATIOS[layout];
  const o = paneRatios()[layout];
  return { cols: o?.cols ?? d.cols, rows: o?.rows ?? d.rows };
}
/** 한 축 갱신 — 분할선 드래그가 부른다 */
export function setRatioAxis(layout: PaneLayout, axis: "cols" | "rows", fractions: number[]): void {
  setPaneRatios({ ...paneRatios(), [layout]: { ...ratioFor(layout), [axis]: fractions } });
}

/** 터미널 전체 화면 (포커스 모드) — 앱 바는 유지되고 그 아래 영역만 덮는다 */
export const [terminalFull, setTerminalFull] = createSignal(false);

// 임무 탐색기 팝업(M25)의 explorerOpen은 overlay("explorer")로 통합됐다 — 위 OverlayKind 참조

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
