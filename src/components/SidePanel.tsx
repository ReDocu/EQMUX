// 사이드 패널 (화면 #10) — 도구 서랍. 페인이 아니라 분할 그리드 밖에 있다 (§2.1).
// 0.5 탭 구성 — 그룹 4개: 대화[대화|로그] · 코드[git|문서] · 실행[서버|포트|환경변수] · 브라우저.
// 환경변수는 워크스페이스 루트에 .env 계열 파일이 있을 때만 보인다.
// 하위 키(PanelTab)는 그대로라 openPanel("git") 같은 호출부가 그대로 그 하위 탭을 연다.
// 임무(탐색기)는 M25에서 전체 화면 팝업으로 승격 — 앱 바의 임무 버튼이 연다.
// 위치 전환 — 플렉스 order로 좌/우를 오간다 (app-row · tf-body 양쪽 컨테이너 공용).
import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { loadEnvFiles } from "../backend/env";
import { priorLayout } from "../backend/layout";
import { unseenPortCount } from "../backend/ports";
import { panelNote, panelSide, panelTab, scopeWorkspace, setPanelOpen, setPanelSide, setPanelTab } from "../state";
import type { PanelTab } from "../state";
import { t, tf } from "../i18n";
import { BrowserPanelTab } from "./BrowserPanelTab";
import { EnvPanelTab } from "./EnvPanelTab";
import { ConversationTab } from "./ConversationTab";
import { GitPanelTab } from "./GitPanelTab";
import { LogsPanelTab } from "./LogsPanelTab";
import { MdViewTab } from "./MdViewTab";
import { PortsPanelTab } from "./PortsPanelTab";
import { ServerPanelTab } from "./ServerPanelTab";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Segmented } from "./ui";

const GROUPS: { key: string; label: string; icon: IconName; tabs: { key: PanelTab; label: string }[] }[] = [
  { key: "talk", label: "대화", icon: "messages-square", tabs: [{ key: "conversation", label: "대화" }, { key: "logs", label: "로그" }] },
  { key: "code", label: "코드", icon: "git-branch", tabs: [{ key: "git", label: "git" }, { key: "mdview", label: "문서" }] },
  {
    key: "run",
    label: "실행",
    icon: "play",
    tabs: [{ key: "server", label: "서버" }, { key: "ports", label: "포트" }, { key: "env", label: "환경변수" }],
  },
  { key: "browser", label: "브라우저", icon: "globe", tabs: [{ key: "browser", label: "브라우저" }] },
];
const groupOf = (tab: PanelTab) => GROUPS.find((g) => g.tabs.some((x) => x.key === tab)) ?? GROUPS[0];

/** 그룹마다 마지막으로 본 하위 탭 — 그룹 탭을 다시 누르면 거기로 간다. 앱 수명 동안만 */
const lastSub = new Map<string, PanelTab>();

// "탭이 묶였습니다" 안내 — 0.5 이전부터 쓰던 사람이 처음 켰을 때 한 번만. 저장소가 막혀 있으면 매번 떠도 해가 없다
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
  // .env 계열 — 있을 때만 '환경변수' 탭을 보인다. 워크스페이스가 바뀌면 다시 읽고, 탭의 [다시 읽기]도 같은 결과를 고친다
  const [envFiles, { refetch: reloadEnv }] = createResource(
    () => scopeWorkspace()?.path,
    (p) => loadEnvFiles(p),
  );
  const hasEnv = () => (envFiles()?.length ?? 0) > 0;
  const tabsOf = (g: (typeof GROUPS)[number]) => g.tabs.filter((x) => x.key !== "env" || hasEnv());
  // 보던 워크스페이스에서 .env가 사라졌으면 포트로 물러난다
  createEffect(() => panelTab() === "env" && envFiles.state === "ready" && !hasEnv() && setPanelTab("ports"));
  const active = () => groupOf(panelTab());
  createEffect(() => lastSub.set(groupOf(panelTab()).key, panelTab()));
  // 새 사용자(이전 layout.json 없음)는 묶이기 전 탭을 본 적이 없다 — 안내 없이 본 것으로 적어 둔다 (U40)
  createEffect(() => priorLayout() === false && notice() && dismissNotice());
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
              <Icon name={g.icon} size={13} />
              {t(g.label)}
              {/* 새 세션 포트 (M31) — 배지는 그룹 단위다. 여는 것은 포트 패널 안의 클릭이다 */}
              <Show when={g.key === "run" && unseenPortCount() > 0}>
                <span class="panel-tab-count">{unseenPortCount()}</span>
              </Show>
            </button>
          )}
        </For>
        <div class="panel-tab-ctl">
          <button
            title={t(panelSide() === "right" ? "패널을 왼쪽으로" : "패널을 오른쪽으로")}
            aria-label={t(panelSide() === "right" ? "패널을 왼쪽으로" : "패널을 오른쪽으로")}
            onClick={() => setPanelSide(panelSide() === "right" ? "left" : "right")}
          >
            <Icon name={panelSide() === "right" ? "panel-right" : "panel-left"} size={13} />
          </button>
          <button title={t("패널 닫기")} aria-label={t("패널 닫기")} onClick={() => setPanelOpen(false)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      <Show when={notice() && priorLayout()}>
        <div class="panel-notice">
          <span>{t("탭이 묶였습니다 — 대화 [대화 | 로그] · 코드 [git | 문서] · 실행 [서버 | 포트] · 브라우저")}</span>
          <button class="btn ghost" onClick={dismissNotice}>
            {t("확인")}
          </button>
        </div>
      </Show>
      <Show when={tabsOf(active()).length > 1}>
        <div class="panel-seg">
          <Segmented
            label={t(active().label)}
            items={tabsOf(active()).map((x) => ({
              value: x.key,
              label: x.key === "ports" && unseenPortCount() > 0 ? tf("포트 · {n}", { n: unseenPortCount() }) : t(x.label),
            }))}
            value={panelTab()}
            onChange={setPanelTab}
          />
          <span class="panel-seg-note mono">{panelNote()}</span>
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
        <Show when={panelTab() === "env" && hasEnv()}>
          <EnvPanelTab files={envFiles() ?? []} onReload={() => void reloadEnv()} />
        </Show>
      </div>
    </div>
  );
}
