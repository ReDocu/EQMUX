// 사이드 패널 (화면 #10) — 도구 서랍. 페인이 아니라 분할 그리드 밖에 있다 (§2.1).
// 탭 구성: 개요(대화 스트림) · git · 포트 · 로그 · 브라우저. 임무(탐색기)는 M25에서
// 전체 화면 팝업으로 승격 — 앱 바의 임무 버튼이 연다.
// 위치 전환 — 플렉스 order로 좌/우를 오간다 (app-row · tf-body 양쪽 컨테이너 공용).
import { For, Show } from "solid-js";
import { panelSide, panelTab, setPanelOpen, setPanelSide, setPanelTab } from "../state";
import type { PanelTab } from "../state";
import { t } from "../i18n";
import { BrowserPanelTab } from "./BrowserPanelTab";
import { ConversationTab } from "./ConversationTab";
import { GitPanelTab } from "./GitPanelTab";
import { LogsPanelTab } from "./LogsPanelTab";
import { PortsPanelTab } from "./PortsPanelTab";

const TABS: { key: PanelTab; label: string }[] = [
  { key: "conversation", label: "개요" },
  { key: "git", label: "git" },
  { key: "ports", label: "포트" },
  { key: "logs", label: "로그" },
  { key: "browser", label: "브라우저" },
];

export function SidePanel() {
  return (
    <div class="side-panel" classList={{ left: panelSide() === "left" }} style={{ order: panelSide() === "left" ? "-1" : "1" }}>
      <div class="panel-tabs">
        <For each={TABS}>
          {(tb) => (
            <button class="panel-tab" classList={{ active: panelTab() === tb.key }} onClick={() => setPanelTab(tb.key)}>
              {t(tb.label)}
            </button>
          )}
        </For>
        <button
          class="panel-tab side-toggle mono"
          title={t(panelSide() === "right" ? "패널을 왼쪽으로" : "패널을 오른쪽으로")}
          onClick={() => setPanelSide(panelSide() === "right" ? "left" : "right")}
        >
          {panelSide() === "right" ? "◧" : "◨"}
        </button>
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
        <Show when={panelTab() === "browser"}>
          <BrowserPanelTab />
        </Show>
      </div>
    </div>
  );
}
