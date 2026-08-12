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
  defaultShell,
  paneLayout,
  PANE_LAYOUTS,
  selectedSession,
  setDefaultShell,
  setPaneLayout,
  setSelectedSession,
  setView,
  SHELLS,
  view,
} from "../state";
import type { PaneLayout } from "../state";

interface LayoutData {
  openWorkspaces?: string[];
  paneLayout?: string;
  shell?: string;
  selectedSession?: string;
  lastWorkspace?: string; // 마지막으로 보던 워크스페이스 탭 — startView="last"일 때만 복원
}

/** 저장본 복원 — refreshWorkspaces가 워크스페이스를 하이드레이트한 뒤에 불린다 */
export async function restoreLayout(): Promise<void> {
  if (!isTauri()) return;
  const data = await invoke<LayoutData | null>("layout_load").catch(() => null);
  if (!data) return;
  if (data.paneLayout && PANE_LAYOUTS.some((l) => l.key === data.paneLayout)) {
    setPaneLayout(data.paneLayout as PaneLayout);
  }
  const sh = SHELLS.find((s) => s.label === data.shell);
  if (sh) setDefaultShell(sh);
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

/** 변경 감지 → 800ms 디바운스 저장. 반드시 restoreLayout 이후에 시작한다. */
export function startLayoutSync(): void {
  if (syncStarted || !isTauri()) return;
  syncStarted = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = "";
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = view();
      const data: LayoutData = {
        openWorkspaces: backend
          .listWorkspaces()
          .filter((w) => w.open)
          .map((w) => w.id),
        paneLayout: paneLayout(),
        shell: defaultShell().label,
        selectedSession: selectedSession(),
        lastWorkspace: v.kind === "workspace" ? (v as { id: string }).id : lastWs,
      };
      lastWs = data.lastWorkspace;
      const json = JSON.stringify(data);
      if (json === last) return;
      last = json;
      void invoke("layout_save", { data }).catch(() => {});
    }, 800);
  };
  backend.subscribe(save); // 워크스페이스 열기/닫기
  createRoot(() => {
    createEffect(() => {
      paneLayout();
      defaultShell();
      selectedSession();
      view();
      save(); // 시그널 변경
    });
  });
}
