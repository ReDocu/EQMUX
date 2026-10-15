// 사이드 패널 (화면 #10) — 도구 서랍. 페인이 아니라 분할 그리드 밖에 있다 (§2.1).
// 0.5 탭 구성 — 그룹 4개: 대화[대화|로그] · 코드[git|문서] · 실행[서버|포트] · 브라우저.
// 하위 키(PanelTab)는 그대로라 openPanel("git") 같은 호출부가 그대로 그 하위 탭을 연다.
// 임무(탐색기)는 M25에서 전체 화면 팝업으로 승격 — 앱 바의 임무 버튼이 연다.
// 위치 전환 — 플렉스 order로 좌/우를 오간다 (app-row · tf-body 양쪽 컨테이너 공용).
import { createEffect, createSignal, For, Show } from "solid-js";
import { unseenPortCount } from "../backend/ports";
import { panelSide, panelTab, setPanelOpen, setPanelSide, setPanelTab } from "../state";
import type { PanelTab } from "../state";
import { t, tf } from "../i18n";
import { BrowserPanelTab } from "./BrowserPanelTab";
import { ConversationTab } from "./ConversationTab";
import { GitPanelTab } from "./GitPanelTab";
import { LogsPanelTab } from "./LogsPanelTab";
import { MdViewTab } from "./MdViewTab";
import { PortsPanelTab } from "./PortsPanelTab";
import { ServerPanelTab } from "./ServerPanelTab";
import { Segmented } from "./ui";

const GROUPS: { key: string; label: string; tabs: { key: PanelTab; label: string }[] }[] = [
  { key: "talk", label: "대화", tabs: [{ key: "conversation", label: "대화" }, { key: "logs", label: "로그" }] },
  { key: "code", label: "코드", tabs: [{ key: "git", label: "git" }, { key: "mdview", label: "문서" }] },
  { key: "run", label: "실행", tabs: [{ key: "server", label: "서버" }, { key: "ports", label: "포트" }] },
  { key: "browser", label: "브라우저", tabs: [{ key: "browser", label: "브라우저" }] },
];
const groupOf = (tab: PanelTab) => GROUPS.find((g) => g.tabs.some((x) => x.key === tab)) ?? GROUPS[0];

/** 그룹마다 마지막으로 본 하위 탭 — 그룹 탭을 다시 누르면 거기로 간다. 앱 수명 동안만 */
const lastSub = new Map<string, PanelTab>();

// "탭이 묶였습니다" 안내 — 0.5로 처음 켰을 때 한 번만. 저장소가 막혀 있으면 매번 떠도 해가 없다
const NOTICE_KEY = "eq-panel-groups-notice";
const [notice, setNotice] = createSignal(
  (() => {
    try {
      return localStorage.getItem(NOTICE_KEY) === null;
    } catch {
      return false;
    }
  })(),
);
const dismissNotice = () => {
  setNotice(false);
  try {
    localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* 기억 못 해도 닫기는 된다 */
  }
};

export function SidePanel() {
  const active = () => groupOf(panelTab());
  createEffect(() => lastSub.set(groupOf(panelTab()).key, panelTab()));
  return (
    <div class="side-panel" classList={{ left: panelSide() === "left" }} style={{ order: panelSide() === "left" ? "-1" : "1" }}>
      <div class="panel-tabs">
        <For each={GROUPS}>
          {(g) => (
            <button
              class="panel-tab"
              classList={{ active: active().key === g.key }}
              title={g.key === "run" && unseenPortCount() > 0 ? t("세션이 연 새 포트가 있습니다") : undefined}
              onClick={() => setPanelTab(lastSub.get(g.key) ?? g.tabs[0].key)}
            >
              {t(g.label)}
              {/* 새 세션 포트 (M31) — 배지는 그룹 단위다. 여는 것은 포트 패널 안의 클릭이다 */}
              <Show when={g.key === "run" && unseenPortCount() > 0}>
                <span class="unread-dot" />
              </Show>
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
      <Show when={notice()}>
        <div class="panel-notice">
          <span>{t("탭이 묶였습니다 — 대화 [대화 | 로그] · 코드 [git | 문서] · 실행 [서버 | 포트] · 브라우저")}</span>
          <button class="btn ghost" onClick={dismissNotice}>
            {t("확인")}
          </button>
        </div>
      </Show>
      <Show when={active().tabs.length > 1}>
        <div class="panel-seg">
          <Segmented
            label={t(active().label)}
            items={active().tabs.map((x) => ({
              value: x.key,
              label: x.key === "ports" && unseenPortCount() > 0 ? tf("포트 · {n}", { n: unseenPortCount() }) : t(x.label),
            }))}
            value={panelTab()}
            onChange={setPanelTab}
          />
        </div>
      </Show>
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
        <Show when={panelTab() === "server"}>
          <ServerPanelTab />
        </Show>
        <Show when={panelTab() === "logs"}>
          <LogsPanelTab />
        </Show>
        <Show when={panelTab() === "browser"}>
          <BrowserPanelTab />
        </Show>
        <Show when={panelTab() === "mdview"}>
          <MdViewTab />
        </Show>
      </div>
    </div>
  );
}
