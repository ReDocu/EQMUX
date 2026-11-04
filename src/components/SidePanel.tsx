// 사이드 패널 (화면 #10) — 도구 서랍. 페인이 아니라 분할 그리드 밖에 있다 (§2.1).
// 0.6 탭 구성 — 그룹 5개: 대화[대화|로그] · 코드[git|파일|문서] · 실행[서버|포트|환경변수] · 브라우저 · 확장[MCP|플러그인|스킬].
// 환경변수 탭은 늘 보인다 — .env가 없을 때 만들기의 입구가 그 탭이다 (§16 V2).
// 하위 키(PanelTab)는 그대로라 openPanel("git") 같은 호출부가 그대로 그 하위 탭을 연다.
// 파일 탐색기는 임무 팝업에서 코드 그룹으로 옮겼다 (결정 21) — 임무 팝업은 임무만 그린다.
// 파일 탭은 한 번 열면 숨겨도 살려 둔다 — 탭을 오가도 편집 중인 내용이 사라지지 않게. 환경변수 · 확장 탭은
// 저장 안 한 편집이 있는 동안만 살려 둔다 (B302). 패널을 닫을 때만 묻는다.
// 위치 전환 — 플렉스 order로 좌/우를 오간다 (app-row · tf-body 양쪽 컨테이너 공용).
import { createEffect, createResource, createSignal, For, lazy, onCleanup, Show } from "solid-js";
import { loadEnvFiles } from "../backend/env";
import { envDirty, skillDirty, unsavedWhere } from "../backend/panels";
import { priorLayout } from "../backend/layout";
import { unseenPortCount } from "../backend/ports";
import {
  panelCloseAsk,
  panelNote,
  panelSide,
  panelTab,
  scopeWorkspace,
  setPanelCloseAsk,
  setPanelGuard,
  setPanelOpen,
  setPanelSide,
  setPanelTab,
} from "../state";
import type { PanelTab } from "../state";
import { t, tf } from "../i18n";
import { BrowserPanelTab } from "./BrowserPanelTab";
import { EnvPanelTab } from "./EnvPanelTab";
import { editorGuard, MissionExplorerTab } from "./MissionExplorerTab";
import { ConversationTab } from "./ConversationTab";
import { GitPanelTab } from "./GitPanelTab";
import { LogsPanelTab } from "./LogsPanelTab";
import { PortsPanelTab } from "./PortsPanelTab";
import { ServerPanelTab } from "./ServerPanelTab";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { ConfirmDialog, Segmented } from "./ui";

// 마크다운 파서(lezer)를 끌고 오는 두 탭은 처음 열 때 받는다 — 메인 청크에서 뺀다.
// 상위에 Suspense가 없어 첫 방문에만 잠깐 비고, 그 뒤로는 바로 그린다. 상태는 원래대로(Show 언마운트) 그대로다
const MdViewTab = lazy(() => import("./MdViewTab").then((m) => ({ default: m.MdViewTab })));
const ExtensionsPanelTab = lazy(() => import("./ExtensionsPanelTab").then((m) => ({ default: m.ExtensionsPanelTab })));

const GROUPS: { key: string; label: string; icon: IconName; tabs: { key: PanelTab; label: string }[] }[] = [
  { key: "talk", label: "대화", icon: "messages-square", tabs: [{ key: "conversation", label: "대화" }, { key: "logs", label: "로그" }] },
  {
    key: "code",
    label: "코드",
    icon: "git-branch",
    tabs: [{ key: "git", label: "git" }, { key: "files", label: "파일" }, { key: "mdview", label: "문서" }],
  },
  {
    key: "run",
    label: "실행",
    icon: "play",
    tabs: [{ key: "server", label: "서버" }, { key: "ports", label: "포트" }, { key: "env", label: "환경변수" }],
  },
  { key: "browser", label: "브라우저", icon: "globe", tabs: [{ key: "browser", label: "브라우저" }] },
  // 엔진 확장 (§12, ExtensionsPanelTab은 W1) — 범위 칩은 컴포넌트 안에 있다
  {
    key: "ext",
    label: "확장",
    icon: "sparkle",
    tabs: [{ key: "mcp", label: "MCP" }, { key: "plugins", label: "플러그인" }, { key: "skills", label: "스킬" }],
  },
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
  // .env 계열 — 워크스페이스가 바뀌면 다시 읽고, 탭의 [다시 읽기]·저장도 같은 결과를 고친다
  // 결과에 경로를 붙여 둔다 — 다른 워크스페이스로 옮긴 직후 다시 읽는 동안 이전 워크스페이스 값이 보이지 않게 (B147)
  const [envRes, { refetch: reloadEnv }] = createResource(
    () => scopeWorkspace()?.path,
    async (p) => ({ path: p, files: await loadEnvFiles(p) }),
  );
  const envFiles = () => (envRes()?.path === scopeWorkspace()?.path ? envRes()?.files : undefined);
  const active = () => groupOf(panelTab());
  // 파일 탭은 한 번 열면 살려 둔다 (머리 주석)
  const [filesSeen, setFilesSeen] = createSignal(false);
  createEffect(() => panelTab() === "files" && setFilesSeen(true));
  // 패널 닫기 — 파일 · 환경변수 원문 · 스킬에 저장하지 않은 편집이 있으면 묻는다 (B302). 닫는 길(앱 바 · git ·
  // 로컬 폴더 · 이 버튼)이 모두 setPanelOpen을 지나므로 거기에 건 가드 하나로 지킨다 (state.ts). 확인창은 여기서 띄운다.
  // 하위 탭 이동은 묻지 않는다 — 편집 중인 탭은 숨겨 두고 살린다(아래 env · ext).
  // ponytail: 전체 화면 터미널로 패널이 가려질 때도 내려가 편집이 사라진다 — 닫기가 아니라 가드 밖이다
  const unsaved = () => unsavedWhere(editorGuard(), envDirty(), skillDirty());
  onCleanup(setPanelGuard(() => unsaved().length > 0));
  const isExt = (k: PanelTab) => k === "mcp" || k === "plugins" || k === "skills";
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
              // 좁은 창에서는 고르지 않은 탭이 아이콘만 남는다 (U181, screens.css) — 이름은 title · aria-label로 남긴다
              title={g.key === "run" && unseenPortCount() > 0 ? `${t(g.label)} — ${t("세션이 연 새 포트가 있습니다")}` : t(g.label)}
              aria-label={t(g.label)}
              onClick={() => setPanelTab(lastSub.get(g.key) ?? g.tabs[0].key)}
            >
              <Icon name={g.icon} size={13} />
              <span class="panel-tab-label">{t(g.label)}</span>
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
          <span>{t("탭이 묶였습니다 — 대화 [대화 | 로그] · 코드 [git | 파일 | 문서] · 실행 [서버 | 포트 | 환경변수] · 브라우저 · 확장 [MCP | 플러그인 | 스킬]")}</span>
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
        {/* 고친 원문이 있으면 다른 탭에 가도 숨겨 두고 살린다 (B302). 그 밖에는 원래대로 들어올 때마다 새로 그린다 (P67) */}
        <Show when={panelTab() === "env" || envDirty()}>
          <div style={{ display: panelTab() === "env" ? "contents" : "none" }}>
            <EnvPanelTab files={envFiles() ?? []} loading={!!scopeWorkspace() && envFiles() === undefined} wsPath={scopeWorkspace()?.path} onReload={() => void reloadEnv()} />
          </div>
        </Show>
        <Show when={filesSeen()}>
          <div class="panel-files" style={{ display: panelTab() === "files" ? undefined : "none" }}>
            <MissionExplorerTab />
          </div>
        </Show>
        {/* 스킬 편집이 남아 있으면 확장 그룹 밖에서도 숨겨 두고 살린다 (B302) — 숨은 동안 kind는 스킬이다 */}
        <Show when={isExt(panelTab()) || skillDirty()}>
          <div style={{ display: isExt(panelTab()) ? "contents" : "none" }}>
            <ExtensionsPanelTab kind={isExt(panelTab()) ? (panelTab() as "mcp" | "plugins" | "skills") : "skills"} />
          </div>
        </Show>
      </div>
      <Show when={panelCloseAsk()}>
        <ConfirmDialog
          danger
          title={t("저장하지 않은 편집")}
          body={<span>{tf("저장하지 않은 편집이 있습니다 — {where}. 패널을 닫으면 사라집니다.", { where: unsaved().map((w) => t(w)).join(" · ") })}</span>}
          confirmLabel={t("버리고 닫기")}
          onConfirm={() => {
            setPanelCloseAsk(false);
            setPanelOpen(false, true);
          }}
          onCancel={() => setPanelCloseAsk(false)}
        />
      </Show>
    </div>
  );
}
