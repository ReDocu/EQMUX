// 앱 바 (DdrkL) — 관제 고정 탭(맨 왼쪽, G1) + 워크스페이스 탭(B3, 닫기/추가) + 전역 도구.
// 대화는 전역 도구다 — 앱 바는 터미널 전체 화면에서도 보이므로 어느 모드에서든 접근된다 (M1).
// 나머지 패널 도구(git·포트·로그·브라우저·임무)는 사이드 패널 탭과 화면 버튼으로만 접근한다.
// 0.5 — "워크스페이스" 도구는 지웠다(탭 줄 "+"와 같은 동작이었다). 벨(알림 센터)과 탭 메뉴를 더했다.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { bellCount, nextUnseen, notifyItems, sessionNeedsLook } from "../backend/attention";
import type { NotifyItem } from "../backend/attention";
import { remoteWebUrl } from "../backend/git";
import { backend } from "../backend/mock";
import { openExternal, revealPath } from "../backend/pty";
import { settings, toggleMuted } from "../backend/settings";
import { crossProjectOn, setCrossProject } from "../backend/workspaces";
import {
  jumpToSession,
  openPanel,
  overlay,
  panelOpen,
  panelTab,
  setExitOpen,
  setPanelOpen,
  setView,
  tick,
  toggleExplorer,
  toggleOverlay,
  view,
} from "../state";
import { t, tf } from "../i18n";
import { ATTENTION_ORDER, fmtSince, sessionName, slotNo } from "../types";
import type { Workspace } from "../types";
import { ContextMenu, notify } from "./ui";
import type { MenuGroup } from "./ui";

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
  // 미확인 상위 전파 (FR-G-45·46) — 세션 → 워크스페이스 탭 → 관제 탭
  const wsUnseen = (wsId: string) => {
    tick();
    return backend.listSessions().some((s) => s.workspaceId === wsId && s.unseen);
  };
  const anyUnseen = () => {
    tick();
    return backend.listSessions().some((s) => s.unseen);
  };
  // 대화 미확인 (M1) — 스트림의 안 읽은 메시지. 세션 미확인(unseen)과 별개의 신호다
  const unreadMsgs = () => {
    tick();
    return backend.listMessages().some((m) => m.unread);
  };
  // 토글 — 이미 대화 탭이 열려 있으면 닫는다. 다른 탭이 열려 있으면 대화 탭으로 전환.
  const toggleConversation = () => {
    if (panelOpen() && panelTab() === "conversation") setPanelOpen(false);
    else openPanel("conversation");
  };
  const closeWs = (id: string) => {
    backend.closeWorkspace(id);
    if (view().kind === "workspace" && (view() as { id?: string }).id === id) setView({ kind: "control" });
  };

  // 워크스페이스 탭 메뉴 (0.5 iGjf9) — 우클릭 또는 `⋯`. 열기 · 알림 · 닫기 묶음 순서
  const [tabMenu, setTabMenu] = createSignal<{ x: number; y: number; ws: Workspace } | undefined>(undefined);
  const tabMenuGroups = (ws: Workspace): MenuGroup[] => {
    const web = remoteWebUrl(ws.remote);
    const reveal = async () => {
      if (!(await revealPath(ws.path))) notify(t("폴더를 열 수 없습니다 — 경로가 없어졌습니다"));
    };
    const toggleCross = () => {
      setCrossProject(ws.id, !crossProjectOn(ws.id)).catch((e) =>
        notify(tf("받기 설정을 바꾸지 못했습니다 — {err}", { err: String(e) })),
      );
    };
    return [
      [
        { label: t("탐색기에서 열기"), disabled: ws.pathMissing, action: () => void reveal() },
        // 웹 주소로 바꿀 수 없는 원격(로컬 경로·없음)은 숨긴다 — 조건이 영영 맞지 않는 동작이다
        ...(web ? [{ label: t("원격 저장소 열기"), action: () => openExternal(web) }] : []),
        { label: t("워크스페이스 관리…"), action: () => toggleOverlay("connect") },
      ],
      [
        { label: t("알림 음소거"), checked: settings().muted.includes(ws.id), action: () => toggleMuted(ws.id) },
        { label: t("다른 프로젝트 메시지 받기"), checked: crossProjectOn(ws.id), action: toggleCross },
      ],
      [{ label: t("닫기 (세션은 유지)"), action: () => closeWs(ws.id) }],
    ];
  };

  // 벨 — 알림 센터 (0.5 QjESu). 미확인 수는 세션 신호에서 계산한다(따로 세지 않는다)
  const [bellOpen, setBellOpen] = createSignal(false);
  const bellUnseen = () => {
    tick();
    return bellCount();
  };
  const itemSession = (it: NotifyItem) => {
    tick();
    return backend.listSessions().find((s) => s.id === it.session);
  };
  const itemRead = (it: NotifyItem) => {
    const s = itemSession(it);
    return !s || !sessionNeedsLook(s);
  };
  const itemName = (it: NotifyItem) => {
    const s = itemSession(it);
    if (!s) return it.session;
    return `${slotNo(s.slot)} ${sessionName(s, backend.listPersonas().find((p) => p.id === s.personaId))}`;
  };
  // 지금 보고 있는 워크스페이스가 아니면 어디 것인지 붙인다
  const itemWsName = (it: NotifyItem) => {
    const v = view();
    const cur = v.kind === "workspace" ? (v as { id: string }).id : undefined;
    return it.workspace === cur ? undefined : backend.listWorkspaces().find((w) => w.id === it.workspace)?.name;
  };
  const openItem = (it: NotifyItem) => {
    setBellOpen(false);
    jumpToSession(it.workspace, it.session); // 이동만 — 세션에 아무것도 입력하지 않는다
  };
  let bellEl: HTMLDivElement | undefined;
  onMount(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBellOpen(false);
    const onDown = (e: MouseEvent) => bellEl && !bellEl.contains(e.target as Node) && setBellOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    });
  });

  return (
    <div class="appbar">
      <div class="brand">EQMUX</div>
      <div class="tabs">
        <button
          class="tab"
          classList={{ active: view().kind === "control" }}
          onClick={() => setView({ kind: "control" })}
        >
          {t("관제")}
          <Show when={anyUnseen()}>
            <span class="unread-dot" />
          </Show>
        </button>
        <For each={workspaces()}>
          {(ws) => (
            <button
              class="tab"
              classList={{ active: view().kind === "workspace" && (view() as { id?: string }).id === ws.id }}
              onClick={() => setView({ kind: "workspace", id: ws.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, ws });
              }}
            >
              <Show when={wsSignal(ws.id)}>
                {(color) => <span class="dot" style={{ background: color() }} />}
              </Show>
              {ws.name}
              <Show when={wsUnseen(ws.id)}>
                <span class="unread-dot" />
              </Show>
              {/* 우클릭만 두면 찾기 어렵다 — 마우스를 올리면 `⋯`가 보인다 */}
              <span
                class="tab-more"
                title={t("워크스페이스 메뉴")}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setTabMenu({ x: r.left, y: r.bottom + 2, ws });
                }}
              >
                ⋯
              </span>
              <span
                class="tab-close"
                title={t("워크스페이스 닫기 (세션은 백그라운드 유지)")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeWs(ws.id);
                }}
              >
                ✕
              </span>
            </button>
          )}
        </For>
        <button
          class="tab tab-add"
          title={t("워크스페이스 열기·관리")}
          aria-label={t("워크스페이스 열기·관리")}
          onClick={() => toggleOverlay("connect")}
        >
          +
        </button>
      </div>
      <div class="tools">
        <button
          class="tool"
          classList={{ active: panelOpen() }}
          title={t("대화 패널 토글 — 전체 화면에서도 열립니다")}
          onClick={toggleConversation}
        >
          {t("대화")}
          <Show when={unreadMsgs()}>
            <span class="unread-dot" />
          </Show>
        </button>
        {/* 도구는 전부 전체 화면 팝업이다 — overlay 신호 하나라서 동시에 하나만 열린다 */}
        {/* 이름대로 임무 자리에서 연다 (0.3.7) — 파일 탐색기는 같은 팝업의 옆 세그먼트다.
            컨트롤 센터의 "로컬 폴더"는 같은 팝업을 탐색기 자리에서 연다 */}
        <button
          class="tool"
          classList={{ active: overlay() === "explorer" }}
          title={t("임무 배정 — 전체 화면 팝업 (헤더에서 파일 탐색기로 전환)")}
          onClick={() => toggleExplorer("missions")}
        >
          {t("임무")}
        </button>
        <button
          class="tool"
          classList={{ active: overlay() === "roles" }}
          title={t("역할 라이브러리 — 전체 화면 팝업")}
          onClick={() => toggleOverlay("roles")}
        >
          {t("역할")}
        </button>
        <button
          class="tool"
          classList={{ active: overlay() === "settings" }}
          title={t("설정 — 전체 화면 팝업")}
          onClick={() => toggleOverlay("settings")}
        >
          {t("설정")}
        </button>
        <button class="tool" onClick={() => setExitOpen(true)}>
          {t("종료")}
        </button>
        <div class="bell-wrap" ref={bellEl}>
          <button
            class="tool"
            classList={{ active: bellOpen() }}
            title={t("알림 센터")}
            aria-label={tf("알림 센터 · 미확인 {n}", { n: bellUnseen() })}
            aria-expanded={bellOpen()}
            onClick={() => setBellOpen(!bellOpen())}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <Show when={bellUnseen() > 0}>
              <span class="bell-count">{bellUnseen()}</span>
            </Show>
          </button>
          <Show when={bellOpen()}>
            <div class="card bell-pop">
              <div class="bell-head">
                <span class="eyebrow">{tf("알림 · 미확인 {n}", { n: bellUnseen() })}</span>
                <button
                  class="btn ghost"
                  onClick={() => {
                    setBellOpen(false);
                    toggleOverlay("settings");
                  }}
                >
                  {t("알림 설정")}
                </button>
              </div>
              <div class="bell-actions">
                <button class="btn primary" disabled={bellUnseen() === 0} onClick={() => nextUnseen()}>
                  {t("다음 미확인으로 · Ctrl+Shift+U")}
                </button>
                <button class="btn" disabled={bellUnseen() === 0} onClick={() => backend.markAllSeen()}>
                  {t("모두 읽음")}
                </button>
              </div>
              <div class="bell-list">
                <For each={notifyItems()} fallback={<div class="muted bell-empty">{t("알림이 없습니다")}</div>}>
                  {(it) => (
                    <button class="bell-item" classList={{ read: itemRead(it) }} onClick={() => openItem(it)}>
                      <span class={`bell-dot ${it.kind}`} />
                      <span class="bell-body">
                        <span class="bell-line">
                          <b class="mono">{itemName(it)}</b>
                          <Show when={itemWsName(it)}>{(n) => <span class="badge">{n()}</span>}</Show>
                          <Show when={it.count > 1}>
                            <span class="mono muted">×{it.count}</span>
                          </Show>
                          <span class="mono muted bell-age">{fmtSince(Date.now() - it.ts)}</span>
                        </span>
                        <span class="bell-title">{it.title}</span>
                        <Show when={it.body}>
                          <span class="muted bell-text">{it.body}</span>
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </div>
              <div class="muted bell-foot">{t("최근 50건 · 앱을 다시 켜면 비웁니다 · 음소거는 소리·OS 알림만 끕니다")}</div>
            </div>
          </Show>
        </div>
      </div>
      <Show when={tabMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={m().ws.name}
            groups={tabMenuGroups(m().ws)}
            onClose={() => setTabMenu(undefined)}
          />
        )}
      </Show>
    </div>
  );
}
