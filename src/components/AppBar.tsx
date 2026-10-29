// 앱 바 (DdrkL) — 관제 고정 탭(맨 왼쪽, G1) + 워크스페이스 탭(B3, 닫기/추가) + 전역 도구.
// 사이드 패널(대화·git·포트·로그·브라우저)은 [패널] 토글(마지막 탭으로 열기 · Ctrl+Shift+B)과 패널 탭으로 간다 (U33).
// 앱 바는 터미널 전체 화면에서도 보이므로 어느 모드에서든 열린다 (M1). [대화] 버튼은 [패널]과 겹쳐 지웠다.
// 0.5 — "워크스페이스" 도구는 지웠다(탭 줄 "+"와 같은 동작이었다). 벨(알림 센터)과 탭 메뉴를 더했다.
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  attentionSessions,
  bellCount,
  fmtAgo,
  inboxWaiting,
  nextUnseen,
  notifyItems,
  seenOnly,
  sessionNeedsLook,
  unlistedAttention,
} from "../backend/attention";
import type { NotifyItem } from "../backend/attention";
import { remoteWebUrl } from "../backend/git";
import { backend } from "../backend/mock";
import { unseenPortCount } from "../backend/ports";
import { revealPath } from "../backend/pty";
import { openLink } from "../backend/browser";
import { settings, toggleMuted } from "../backend/settings";
import { crossProjectOn, setCrossProject } from "../backend/workspaces";
import {
  jumpToSession,
  overlay,
  panelOpen,
  pushLayer,
  setExitOpen,
  setFocusRequest,
  setOverlay,
  setPanelOpen,
  setSettingsCat,
  setView,
  tick,
  toggleExplorer,
  toggleOverlay,
  view,
} from "../state";
import { t, tf } from "../i18n";
import { ATTENTION_ORDER, nameBesideNo, paneNo, sessionName } from "../types";
import type { Session, Workspace } from "../types";
import { Icon } from "./icons";
import { ContextMenu, notify } from "./ui";
import { crashReport, setCrashOpen } from "../backend/recovery";
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
        ...(web ? [{ label: t("원격 저장소 열기"), action: () => openLink(web) }] : []),
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
  const sessName = (s: Session) =>
    `${paneNo(s)} ${nameBesideNo(paneNo(s), sessionName(s, backend.listPersonas().find((p) => p.id === s.personaId)))}`;
  const itemName = (it: NotifyItem) => {
    const s = itemSession(it);
    return s ? sessName(s) : it.session;
  };
  // 지금 보고 있는 워크스페이스가 아니면 어디 것인지 붙인다
  const wsLabel = (wsId: string) => {
    const v = view();
    const cur = v.kind === "workspace" ? (v as { id: string }).id : undefined;
    return wsId === cur ? undefined : backend.listWorkspaces().find((w) => w.id === wsId)?.name;
  };
  // 이동 + 키보드 포커스 — Ctrl+Shift+U·OS 토스트와 같은 끝이다 (B79). 세션에 아무것도 입력하지 않는다
  const openSession = (wsId: string, sessionId: string) => {
    setBellOpen(false);
    if (jumpToSession(wsId, sessionId)) setFocusRequest({ session: sessionId });
  };
  // 숫자에 들었는데 목록(notify-item 기록)에 줄이 없는 세션 — 재시작으로 기록이 비었을 때·목 모드 (U35)
  const unlisted = () => {
    tick();
    return unlistedAttention(attentionSessions(), notifyItems());
  };
  // [확인 표시 지우기]가 지울 수 있는 것 — 할 일(waiting·메시지 대기·보고 전)은 남는다 (B75)
  const clearable = () => {
    tick();
    return backend.listSessions().filter((s) => seenOnly(s, inboxWaiting(s))).length;
  };
  const clearSeen = () => {
    backend.markAllSeen();
    const left = bellCount();
    if (left > 0) notify(tf("응답이 필요한 {n}건은 남습니다", { n: left }));
  };
  // 알림 시각은 팝오버가 열린 동안 30초마다 다시 센다 (U36)
  const [now, setNow] = createSignal(Date.now());
  let bellEl: HTMLDivElement | undefined;
  onMount(() => {
    const onDown = (e: MouseEvent) => bellEl && !bellEl.contains(e.target as Node) && setBellOpen(false);
    window.addEventListener("mousedown", onDown);
    onCleanup(() => window.removeEventListener("mousedown", onDown));
  });
  // 벨이 열린 동안만 산다 — ESC는 레이어 스택이 맨 위 하나에 준다 (P30)
  const bellLayer = () => {
    onCleanup(pushLayer(() => setBellOpen(false)));
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    onCleanup(() => clearInterval(timer));
    return null;
  };
  // 탭 줄이 넘치면 양끝에 ‹ › — 스크롤바를 숨겨서(scrollbar-width: none) 마우스로는 넘길 길이 없었다.
  // 화살표는 넘치는 동안 둘 다 자리를 지키고, 끝에 닿은 쪽만 흐려진다 (B159·B160).
  // 끝에서 사라지면 그 자리로 마지막 탭의 ✕가 밀려 들어와 연타가 탭 닫기가 됐고, 누르던 버튼의 포커스도 빠졌다.
  // 한쪽만 새로 생기면 탭 줄 폭이 28px 줄어 활성 탭 맞춤이 그만큼 모자랐다
  let tabsEl!: HTMLDivElement;
  let arrowsWidth = 0;
  const [tabsOverflow, setTabsOverflow] = createSignal(false);
  const [canLeft, setCanLeft] = createSignal(false);
  const [canRight, setCanRight] = createSignal(false);
  const updateTabArrows = () => {
    const shown = tabsOverflow();
    // 화살표가 이미 있으면 그 폭까지 돌려받았을 때 들어맞는지 본다 — 넓혔는데 화살표가 남아 있지 않게
    setTabsOverflow(tabsEl.scrollWidth - 1 > tabsEl.clientWidth + (shown ? arrowsWidth : 0));
    setCanLeft(tabsEl.scrollLeft > 1);
    setCanRight(tabsEl.scrollLeft + tabsEl.clientWidth < tabsEl.scrollWidth - 1);
  };
  const scrollTabs = (dir: -1 | 1) => {
    if (!(dir < 0 ? canLeft() : canRight())) return;
    const max = tabsEl.scrollWidth - tabsEl.clientWidth;
    let to = tabsEl.scrollLeft + dir * Math.max(120, tabsEl.clientWidth * 0.7);
    // 끝까지 한 뼘(48px) 남으면 끝까지 — 마지막 탭 ✕만 가려진 채 한 번 더 누르게 하지 않는다
    if (to > max - 48) to = max;
    if (to < 48) to = 0;
    tabsEl.scrollTo({ left: to, behavior: "smooth" });
  };
  // 활성 탭이 화면 밖이면 보이는 곳까지 넘긴다 — 단축키·알림으로 옮겨 갔을 때 어느 탭인지 보이게.
  // scrollIntoView는 WebKit에서 이 탭 줄을 넘기지 않았다 — 가려진 만큼 직접 민다
  const revealActiveTab = () => {
    const a = tabsEl?.querySelector<HTMLElement>(".tab.active");
    if (!a) return;
    const r = a.getBoundingClientRect();
    const c = tabsEl.getBoundingClientRect();
    if (r.left < c.left) tabsEl.scrollBy({ left: r.left - c.left, behavior: "smooth" });
    else if (r.right > c.right) tabsEl.scrollBy({ left: r.right - c.right, behavior: "smooth" });
  };
  onMount(() => {
    // 창 크기(ResizeObserver)와 탭 추가·이름 변경(MutationObserver) 모두 넘침을 바꾼다.
    // 화살표가 처음 생기면 탭 줄이 좁아져 ResizeObserver가 다시 돈다 — 그때 활성 탭을 다시 맞춘다 (B159).
    // 넘침이 바뀔 때만 — 포트 배지·벨 숫자로 도구 줄 폭이 바뀔 때마다 맞추면 ›로 넘겨 보던 자리를 되돌린다
    const ro = new ResizeObserver(() => {
      const was = tabsOverflow();
      updateTabArrows();
      if (tabsOverflow() !== was) revealActiveTab();
    });
    ro.observe(tabsEl);
    const mo = new MutationObserver(updateTabArrows);
    mo.observe(tabsEl, { childList: true, subtree: true, characterData: true });
    updateTabArrows();
    // 웹폰트(Inter)가 늦게 붙으면 탭 폭이 바뀐다 — 요소 크기·DOM 변화가 없어 위 두 관찰자는 모른다
    void document.fonts.ready.then(updateTabArrows);
    onCleanup(() => {
      ro.disconnect();
      mo.disconnect();
    });
  });
  // 실행 방식 마법사(실행 방식·기본 터미널 구성·캐스팅·편성) 중에도 그 워크스페이스 탭을 활성으로 보인다 (U30)
  const tabWs = () => {
    const v = view();
    if (v.kind === "workspace") return v.id;
    return v.kind === "launch" || v.kind === "terminalSetup" || v.kind === "casting" || v.kind === "composition"
      ? v.wsId
      : undefined;
  };
  // effect는 DOM 갱신 뒤에 돈다. rAF는 쓰지 않는다 — WebKit은 가려진 창에서 rAF를 멈춘다
  createEffect(() => {
    view();
    tabWs();
    revealActiveTab();
  });
  // 화살표 두 개 폭 — 넘침이 풀렸는지 볼 때 돌려받을 폭이다
  createEffect(() => {
    if (tabsOverflow()) {
      arrowsWidth = 0;
      for (const b of tabsEl.parentElement?.querySelectorAll<HTMLElement>(".tabs-arrow") ?? [])
        arrowsWidth += b.offsetWidth;
    }
  });

  return (
    <div class="appbar">
      <div class="brand">EQMUX</div>
      <div class="tabs-wrap">
        <Show when={tabsOverflow()}>
          <button
            class="tabs-arrow"
            title={t("이전 탭")}
            aria-label={t("이전 탭")}
            aria-disabled={!canLeft()}
            onClick={() => scrollTabs(-1)}
          >
            <Icon name="chevron-left" size={14} />
          </button>
        </Show>
        <div class="tabs" role="tablist" ref={tabsEl} onScroll={updateTabArrows}>
          <button
            class="tab"
            role="tab"
            aria-selected={view().kind === "control"}
            classList={{ active: view().kind === "control" }}
            onClick={() => setView({ kind: "control" })}
          >
            <Icon name="grid-2x2" size={13} />
            <span class="tab-label">{t("관제")}</span>
            <Show when={anyUnseen()}>
              <span class="unread-dot" />
            </Show>
          </button>
          <For each={workspaces()}>
            {(ws) => (
              <button
                class="tab ws-tab"
                role="tab"
                aria-selected={tabWs() === ws.id}
                classList={{ active: tabWs() === ws.id }}
                onClick={() => setView({ kind: "workspace", id: ws.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({ x: e.clientX, y: e.clientY, ws });
                }}
              >
                <Icon name="users" size={13} />
                <Show when={wsSignal(ws.id)}>
                  {(color) => <span class="dot" style={{ background: color() }} />}
                </Show>
                <span class="tab-label" title={ws.name}>
                  {ws.name}
                </span>
                <Show when={wsUnseen(ws.id)}>
                  <span class="unread-dot" />
                </Show>
                {/* 우클릭만 두면 찾기 어렵다 — 마우스를 올리면 `⋯`가 보인다 */}
                {/* 키보드로도 닿는다 (U37) — 탭 버튼의 Enter(탭 전환)로 새지 않게 키 처리를 끊는다 */}
                <span
                  class="tab-more"
                  role="button"
                  tabIndex={0}
                  title={t("워크스페이스 메뉴")}
                  aria-label={t("워크스페이스 메뉴")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTabMenu({ x: r.left, y: r.bottom + 2, ws });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.click();
                  }}
                >
                  <Icon name="ellipsis" size={12} />
                </span>
                <span
                  class="tab-close"
                  role="button"
                  tabIndex={0}
                  title={t("워크스페이스 닫기 (세션은 백그라운드 유지)")}
                  aria-label={t("워크스페이스 닫기 (세션은 백그라운드 유지)")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWs(ws.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    e.stopPropagation();
                    closeWs(ws.id);
                  }}
                >
                  <Icon name="x" size={11} />
                </span>
              </button>
            )}
          </For>
        </div>
        <Show when={tabsOverflow()}>
          <button
            class="tabs-arrow"
            title={t("다음 탭")}
            aria-label={t("다음 탭")}
            aria-disabled={!canRight()}
            onClick={() => scrollTabs(1)}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </Show>
        <button
          class="tab tab-add"
          title={t("워크스페이스 열기·관리")}
          aria-label={t("워크스페이스 열기·관리")}
          onClick={() => toggleOverlay("connect")}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div class="tools">
        {/* 패널 토글 (U33) — 마지막으로 본 탭으로 연다. 새 세션 포트 배지는 패널이 닫혀 있어도 여기 남는다 */}
        <button
          class="tool"
          aria-label={t("사이드 패널")}
          aria-pressed={panelOpen()}
          classList={{ active: panelOpen() }}
          title={t("사이드 패널 토글 — 마지막 탭으로 엽니다 · Ctrl+Shift+B")}
          onClick={() => setPanelOpen(!panelOpen())}
        >
          <Icon name="panel-right" size={13} />
          <span class="tool-label">{t("패널")}</span>
          <Show when={unseenPortCount() > 0}>
            <span class="bell-count">{unseenPortCount()}</span>
          </Show>
          {/* 대화 안 읽음 (M1) — [대화] 버튼을 패널 토글로 합친 뒤에도 신호는 앱 바에 남긴다 */}
          <Show when={unreadMsgs()}>
            <span class="unread-dot" />
          </Show>
        </button>
        {/* 도구는 전부 전체 화면 팝업이다 — overlay 신호 하나라서 동시에 하나만 열린다 */}
        {/* 이름대로 임무 자리에서 연다 (0.3.7) — 파일 탐색기는 같은 팝업의 옆 세그먼트다.
            컨트롤 센터의 "로컬 폴더"는 같은 팝업을 탐색기 자리에서 연다 */}
        <button
          class="tool"
          aria-label={t("임무")}
          classList={{ active: overlay() === "explorer" }}
          title={t("임무 배정 — 전체 화면 팝업 (헤더에서 파일 탐색기로 전환)")}
          onClick={() => toggleExplorer("missions")}
        >
          <Icon name="briefcase-business" size={13} />
          <span class="tool-label">{t("임무")}</span>
        </button>
        <button
          class="tool"
          aria-label={t("역할")}
          classList={{ active: overlay() === "roles" }}
          title={t("역할 라이브러리 — 전체 화면 팝업")}
          onClick={() => toggleOverlay("roles")}
        >
          <Icon name="id-card" size={13} />
          <span class="tool-label">{t("역할")}</span>
        </button>
        <button
          class="tool"
          aria-label={t("설정")}
          classList={{ active: overlay() === "settings" }}
          title={t("설정 — 전체 화면 팝업")}
          onClick={() => toggleOverlay("settings")}
        >
          <Icon name="settings" size={13} />
          <span class="tool-label">{t("설정")}</span>
        </button>
        <button class="tool exit" title={t("종료")} aria-label={t("종료")} onClick={() => setExitOpen(true)}>
          <Icon name="power" size={13} />
          <span class="tool-label">{t("종료")}</span>
        </button>
        <span class="tools-divider" aria-hidden="true" />
        <div class="bell-wrap" ref={bellEl}>
          <button
            class="tool"
            classList={{ active: bellOpen() }}
            title={t("알림 센터")}
            aria-label={tf("알림 센터 · 미확인 {n}", { n: bellUnseen() })}
            aria-expanded={bellOpen()}
            onClick={() => setBellOpen(!bellOpen())}
          >
            <Icon name="bell" size={14} />
            <Show when={bellUnseen() > 0}>
              <span class="bell-count">{bellUnseen()}</span>
            </Show>
          </button>
          <Show when={bellOpen()}>
            {bellLayer()}
            <div class="bell-pop">
              <div class="bell-head">
                <span class="bell-head-title">{tf("알림 · 미확인 {n}", { n: bellUnseen() })}</span>
                <button
                  class="bell-link"
                  onClick={() => {
                    setBellOpen(false);
                    setSettingsCat("notify"); // 이름대로 알림 탭에서 연다 (U34)
                    setOverlay("settings");
                  }}
                >
                  {t("알림 설정")}
                </button>
              </div>
              <div class="bell-actions">
                <button class="btn primary" disabled={bellUnseen() === 0} onClick={() => nextUnseen()}>
                  <Icon name="arrow-down-to-line" size={12} />
                  {t("다음 미확인으로 · Ctrl+Shift+U")}
                </button>
                <button
                  class="btn"
                  disabled={clearable() === 0}
                  title={t("완료 보고·턴 완료·본 적 없는 종료 표시만 지웁니다 — 응답 대기·메시지 대기·보고 전은 남습니다")}
                  onClick={clearSeen}
                >
                  {t("확인 표시 지우기")}
                </button>
              </div>
              <div class="bell-list">
                {/* 직전 비정상 종료 — 복구 창을 닫은 뒤에도 여기서 다시 연다 (U63) */}
                <Show when={crashReport()}>
                  {(r) => (
                    <button class="bell-item" onClick={() => (setBellOpen(false), setCrashOpen(true))}>
                      <span class="bell-dot" />
                      <span class="bell-body">
                        <span class="bell-line">
                          <b>{tf("직전 비정상 종료 · {n}세션", { n: r().sessions.length })}</b>
                        </span>
                      </span>
                    </button>
                  )}
                </Show>
                <Show when={unlisted().length > 0}>
                  <div class="muted bell-group">{t("지금 봐야 할 세션")}</div>
                  <For each={unlisted()}>
                    {(s) => (
                      <button class="bell-item" onClick={() => openSession(s.workspaceId, s.id)}>
                        <span class="bell-dot" />
                        <span class="bell-body">
                          <span class="bell-line">
                            <b class="mono">{sessName(s)}</b>
                            <Show when={wsLabel(s.workspaceId)}>{(n) => <span class="badge">{n()}</span>}</Show>
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                </Show>
                <For
                  each={notifyItems()}
                  fallback={
                    <Show when={unlisted().length === 0 && !crashReport()}>
                      <div class="muted bell-empty">{t("알림이 없습니다")}</div>
                    </Show>
                  }
                >
                  {(it) => (
                    <button
                      class="bell-item"
                      classList={{ read: itemRead(it) }}
                      onClick={() => openSession(it.workspace, it.session)}
                    >
                      <span class={`bell-dot ${itemRead(it) ? "" : it.kind}`} />
                      <span class="bell-body">
                        <span class="bell-line">
                          <b class="mono">{itemName(it)}</b>
                          <Show when={wsLabel(it.workspace)}>{(n) => <span class="badge">{n()}</span>}</Show>
                          <Show when={it.count > 1}>
                            <span class="mono muted">×{it.count}</span>
                          </Show>
                          <span class="mono muted bell-age">{fmtAgo(now() - it.ts)}</span>
                        </span>
                        <span class={`bell-title ${itemRead(it) ? "" : it.kind}`}>{it.title}</span>
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
