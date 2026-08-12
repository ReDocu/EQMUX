// 사이드 패널 (화면 #10) — 도구 서랍. 페인이 아니라 분할 그리드 밖에 있다 (§2.1).
// 탭 구성은 design.pen 앱 바 도구(DdrkL)를 따른다: 대화 · git · 포트 · 로그 · 임무(탐색기 연동) · 브라우저.
import { For, Show } from "solid-js";
import { panelTab, setPanelOpen, setPanelTab } from "../state";
import type { PanelTab } from "../state";
import { ConversationTab } from "./ConversationTab";
import { GitPanelTab } from "./GitPanelTab";
import { LogsPanelTab } from "./LogsPanelTab";
import { MissionExplorerTab } from "./MissionExplorerTab";
import { PortsPanelTab } from "./PortsPanelTab";

const TABS: { key: PanelTab; label: string }[] = [
  { key: "conversation", label: "대화" },
  { key: "git", label: "git" },
  { key: "ports", label: "포트" },
  { key: "logs", label: "로그" },
  { key: "missions", label: "임무" },
  { key: "browser", label: "브라우저" },
];

export function SidePanel() {
  return (
    <div class="side-panel">
      <div class="panel-tabs">
        <For each={TABS}>
          {(t) => (
            <button class="panel-tab" classList={{ active: panelTab() === t.key }} onClick={() => setPanelTab(t.key)}>
              {t.label}
            </button>
          )}
        </For>
        <button class="panel-tab close" onClick={() => setPanelOpen(false)}>
          ✕
        </button>
      </div>
      <div class="panel-body">
        <Show when={panelTab() === "conversation"}>
          <ConversationTab />
        </Show>
        <Show when={panelTab() === "git"}>
          <GitPanelTab />
        </Show>
        <Show when={panelTab() === "ports"}>
          <PortsPanelTab />
        </Show>
        <Show when={panelTab() === "logs"}>
          <LogsPanelTab />
        </Show>
        <Show when={panelTab() === "missions"}>
          <MissionExplorerTab />
        </Show>
        <Show when={panelTab() === "browser"}>
          <div class="browserp">
            <div class="panel-head-row">
              <span class="panel-title">브라우저</span>
              <span class="mono muted" style={{ "font-size": "10px" }}>
                PREVIEW
              </span>
            </div>
            <div class="card inset browserp-url mono">
              <span class="muted">⟳</span>
              <span>http://127.0.0.1:5173</span>
            </div>
            <div class="card inset browserp-view">
              <div class="muted" style={{ "text-align": "center" }}>
                <div style={{ "font-size": "22px", "margin-bottom": "8px" }}>◱</div>
                세션 포트 미리보기
                <div class="mono" style={{ "font-size": "10px", "margin-top": "6px" }}>
                  vite · 노엘 · :5173 — M1에서 웹뷰로 연결됩니다
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
