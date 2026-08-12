// 앱 바 (DdrkL) — 관제 고정 탭(맨 왼쪽, G1) + 워크스페이스 탭(B3, 닫기/추가) + 도구 열.
// 도구 열은 design.pen DdrkL 구성을 따른다: 배치 · 임무 · git · 포트 · 로그 · 브라우저 · 팀 · 대화 · 설정.
import { For, Show } from "solid-js";
import { backend } from "../backend/mock";
import {
  openPanel,
  panelOpen,
  panelTab,
  setExitOpen,
  setLayoutPickerOpen,
  setView,
  tick,
  view,
} from "../state";
import type { PanelTab } from "../state";
import { ATTENTION_ORDER } from "../types";

const PANEL_TOOLS: { key: PanelTab; label: string }[] = [
  { key: "missions", label: "임무" },
  { key: "git", label: "git" },
  { key: "ports", label: "포트" },
  { key: "logs", label: "로그" },
  { key: "browser", label: "브라우저" },
];

export function AppBar() {
  const workspaces = () => {
    tick();
    return backend.listWorkspaces().filter((w) => w.open);
  };
  // 탭 뱃지 — 미확인 신호는 상위 전파된다 (FR-G-46). waiting > dead 만 색을 갖는다.
  const wsSignal = (wsId: string) => {
    tick();
    const sessions = backend.listSessions().filter((s) => s.workspaceId === wsId);
    const top = sessions.slice().sort((a, b) => ATTENTION_ORDER[a.status] - ATTENTION_ORDER[b.status])[0];
    if (!top) return undefined;
    if (top.status === "waiting") return "var(--eq-amber)";
    if (top.status === "dead") return "var(--eq-red)";
    return undefined;
  };

  const panelToolActive = (key: PanelTab) => panelOpen() && panelTab() === key;

  return (
    <div class="appbar">
      <div class="brand">EQMUX</div>
      <div class="tabs">
        <button
          class="tab"
          classList={{ active: view().kind === "control" }}
          onClick={() => setView({ kind: "control" })}
        >
          관제
        </button>
        <For each={workspaces()}>
          {(ws) => (
            <button
              class="tab"
              classList={{ active: view().kind === "workspace" && (view() as { id?: string }).id === ws.id }}
              onClick={() => setView({ kind: "workspace", id: ws.id })}
            >
              <Show when={wsSignal(ws.id)}>
                {(color) => <span class="dot" style={{ background: color() }} />}
              </Show>
              {ws.name}
              <span
                class="tab-close"
                title="워크스페이스 닫기 (세션은 백그라운드 유지)"
                onClick={(e) => {
                  e.stopPropagation();
                  backend.closeWorkspace(ws.id);
                  if (view().kind === "workspace" && (view() as { id?: string }).id === ws.id) {
                    setView({ kind: "control" });
                  }
                }}
              >
                ✕
              </span>
            </button>
          )}
        </For>
        <button class="tab tab-add" title="워크스페이스 연결" onClick={() => setView({ kind: "connect" })}>
          +
        </button>
      </div>
      <div class="tools">
        <button class="tool" title="페인 배치 (CTRL+SHIFT+L)" onClick={() => setLayoutPickerOpen(true)}>
          배치
        </button>
        <For each={PANEL_TOOLS}>
          {(t) => (
            <button class="tool" classList={{ active: panelToolActive(t.key) }} onClick={() => openPanel(t.key)}>
              {t.label}
            </button>
          )}
        </For>
        <button
          class="tool"
          classList={{ active: view().kind === "connect" }}
          onClick={() => setView({ kind: "connect" })}
        >
          워크스페이스
        </button>
        <button class="tool" classList={{ active: view().kind === "roles" }} onClick={() => setView({ kind: "roles" })}>
          역할
        </button>
        <button
          class="tool"
          classList={{ active: view().kind === "settings" }}
          onClick={() => setView({ kind: "settings" })}
        >
          설정
        </button>
        <button class="tool" onClick={() => setExitOpen(true)}>
          종료
        </button>
      </div>
    </div>
  );
}
