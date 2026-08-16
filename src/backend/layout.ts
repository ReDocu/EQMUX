// 레이아웃 영속 브리지 (FR-C-22·30) — 열린 워크스페이스 탭 · 페인 배치 · 기본 셸 · 선택 세션을
// 앱데이터 layout.json에 저장하고 재시작 시 복원한다. 시작 포커스는 관제 탭 기본값을 유지한다
// (FR-G-02 — 마지막 화면 복원은 설정 옵션으로 남겨둔 부분).
// 동기화는 복원이 끝난 뒤에만 시작한다 — 부트스트랩 중 빈 상태로 저장본을 덮어쓰지 않기 위해.
import { invoke } from "@tauri-apps/api/core";
import { createEffect, createRoot } from "solid-js";
import { backend } from "./mock";
import { isTauri } from "./pty";
import { settings } from "./settings";
import {
  defaultRatios,
  defaultShell,
  PANE_LAYOUTS,
  paneLayouts,
  panelSide,
  paneRatios,
  selectedSession,
  setDefaultShell,
  setPaneLayouts,
  setPanelSide,
  setPaneRatios,
  setSelectedSession,
  setView,
  SHELLS,
  view,
} from "../state";
import type { PaneLayout, PaneRatio } from "../state";

interface LayoutData {
  openWorkspaces?: string[];
  paneLayout?: string; // 구버전 — 전역 단일 배치. 읽기 폴백으로만 남는다
  paneLayoutsByWs?: Record<string, string>; // 배치는 워크스페이스별 (U7)
  shell?: string;
  selectedSession?: string;
  lastWorkspace?: string; // 마지막으로 보던 워크스페이스 탭 — startView="last"일 때만 복원
  paneRatios?: Record<string, PaneRatio>; // 분할선 드래그 비율 (M30) — 배치별
  panelSide?: string; // 사이드 패널 위치 — "left" | "right"
}

const isLayoutKey = (v: unknown): v is PaneLayout =>
  typeof v === "string" && PANE_LAYOUTS.some((l) => l.key === v);

/** 저장본 비율 검증 — 길이·합·범위가 맞는 축만 받는다. 깨진 값은 기본 비율로 조용히 폴백 */
function sanitizeRatio(layout: PaneLayout, raw: unknown): PaneRatio | undefined {
  const d = defaultRatios(layout); // 트랙 수가 현재 슬롯 상한과 다른 저장본은 여기서 걸러진다

  const v = (raw ?? {}) as PaneRatio;
  const axis = (def: number[] | undefined, got: unknown): number[] | undefined =>
    def &&
    Array.isArray(got) &&
    got.length === def.length &&
    got.every((x) => typeof x === "number" && x >= 0.05 && x <= 0.95) &&
    Math.abs(got.reduce((a, b) => a + b, 0) - 1) < 0.01
      ? got
      : undefined;
  const cols = axis(d.cols, v.cols);
  const rows = axis(d.rows, v.rows);
  if (!cols && !rows) return undefined;
  return { ...(cols ? { cols } : {}), ...(rows ? { rows } : {}) };
}

let restored = false;

/** 저장본 복원 — refreshWorkspaces가 워크스페이스를 하이드레이트한 뒤에 불린다.
 *  부트스트랩 1회만 실행한다 — 등록·해제가 부르는 재hydrate에서 또 돌면
 *  디바운스(800ms) 중인 스테일 layout.json이 현재 상태(닫은 탭·현재 화면)를 되돌린다. */
export async function restoreLayout(): Promise<void> {
  if (restored || !isTauri()) return;
  restored = true;
  const data = await invoke<LayoutData | null>("layout_load").catch(() => null);
  if (!data) return;
  // 배치 복원 — 워크스페이스별 맵 우선 (U7), 구버전 단일 값은 모든 워크스페이스의 초기값으로
  if (data.paneLayoutsByWs && typeof data.paneLayoutsByWs === "object") {
    const restored: Partial<Record<string, PaneLayout>> = {};
    for (const [wsId, l] of Object.entries(data.paneLayoutsByWs)) {
      if (isLayoutKey(l)) restored[wsId] = l;
    }
    if (Object.keys(restored).length > 0) setPaneLayouts(restored);
  } else if (isLayoutKey(data.paneLayout)) {
    const legacy: Partial<Record<string, PaneLayout>> = { _default: data.paneLayout };
    for (const w of backend.listWorkspaces()) legacy[w.id] = data.paneLayout;
    setPaneLayouts(legacy);
  }
  // 분할선 비율 복원 (M30) — 배치별로 검증해 통과한 것만
  if (data.paneRatios && typeof data.paneRatios === "object") {
    const restored: Partial<Record<PaneLayout, PaneRatio>> = {};
    for (const l of PANE_LAYOUTS) {
      const r = sanitizeRatio(l.key, data.paneRatios[l.key]);
      if (r) restored[l.key] = r;
    }
    if (Object.keys(restored).length > 0) setPaneRatios(restored);
  }
  const sh = SHELLS.find((s) => s.label === data.shell);
  if (sh) setDefaultShell(sh);
  if (data.panelSide === "left" || data.panelSide === "right") setPanelSide(data.panelSide);
  for (const id of data.openWorkspaces ?? []) {
    backend.openWorkspace(id); // 경로 소실·10개 상한은 openWorkspace가 거른다
  }
  if (data.selectedSession) setSelectedSession(data.selectedSession);
  // 시작 화면 옵션 (FR-G-02) — 기본은 관제 탭, 설정이 "last"일 때만 마지막 워크스페이스로
  if (settings().startView === "last" && data.lastWorkspace) {
    const ws = backend.listWorkspaces().find((w) => w.id === data.lastWorkspace && w.open);
    if (ws) setView({ kind: "workspace", id: ws.id });
  }
}

let syncStarted = false;
let lastWs: string | undefined; // 관제 탭에 있을 때도 직전 워크스페이스를 기억한다

let timer: ReturnType<typeof setTimeout> | undefined;
let last = "";

function doSaveLayout(): void {
  const v = view();
  const data: LayoutData = {
    openWorkspaces: backend
      .listWorkspaces()
      .filter((w) => w.open)
      .map((w) => w.id),
    paneLayoutsByWs: paneLayouts() as Record<string, string>,
    shell: defaultShell().label,
    selectedSession: selectedSession(),
    lastWorkspace: v.kind === "workspace" ? (v as { id: string }).id : lastWs,
    paneRatios: paneRatios(),
    panelSide: panelSide(),
  };
  lastWs = data.lastWorkspace;
  const json = JSON.stringify(data);
  if (json === last) return;
  last = json;
  void invoke("layout_save", { data }).catch(() => {});
}

/** 디바운스 즉시 flush — 종료 시퀀스가 부른다. sync 시작 전에는 no-op (부트스트랩 중간 상태 방지) */
export function flushLayoutNow(): void {
  if (!syncStarted) return;
  clearTimeout(timer);
  doSaveLayout();
}

/** 변경 감지 → 800ms 디바운스 저장. 반드시 restoreLayout 이후에 시작한다. */
export function startLayoutSync(): void {
  if (syncStarted || !isTauri()) return;
  syncStarted = true;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(doSaveLayout, 800);
  };
  backend.subscribe(save); // 워크스페이스 열기/닫기
  createRoot(() => {
    createEffect(() => {
      paneLayouts(); // 워크스페이스별 배치 (U7)
      paneRatios(); // 분할선 드래그 (M30)
      defaultShell();
      selectedSession();
      panelSide(); // 패널 위치 전환
      view();
      save(); // 시그널 변경
    });
  });
}
