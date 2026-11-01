// 워크스페이스 연결 (mmBPm · PRD E §4.1) — 레인 01의 시작. git repo 1개 = 팀 1개 = 탭 1개 (W0).
// Tauri: 실제 폴더 선택 → git 검증 → workspaces.json 등록. 브라우저: 목 폴백.
import { createSignal, For, onCleanup, Show } from "solid-js";
import { backend, MAX_OPEN_WORKSPACES } from "../backend/mock";
import { remoteWebUrl } from "../backend/git";
import { isTauri, revealPath } from "../backend/pty";
import { openLink } from "../backend/browser";
import {
  cloneRepo,
  gitInit,
  pickFolder,
  refreshWorkspaces,
  registerWorkspace,
  repathWorkspace,
  touchWorkspace,
  unregisterWorkspace,
} from "../backend/workspaces";
import { pushLayer, setView, tick } from "../state";
import { t, tf } from "../i18n";
import { ConfirmDialog, KV, notify } from "../components/ui";
import { Icon } from "../components/icons";
import type { Workspace } from "../types";
import { openView } from "./launchRules";
import { isSubmitEnter } from "../platform"; // 한글 조합 중 Enter는 제출이 아니다 (B130)

/** 안쪽 창을 레이어 스택에 올린다 — Esc가 관리 화면 전체가 아니라 이 창만 닫는다 (B108).
 *  box를 주면 모달이다 — Tab이 창 안에서 돌고 단축키 이동이 막힌다 (B72 · U37) */
function Layer(props: { close: () => void; box?: () => HTMLElement | undefined }) {
  onCleanup(pushLayer(() => props.close(), props.box));
  return null;
}

export function WorkspaceConnection() {
  const workspaces = () => {
    tick();
    return backend.listWorkspaces();
  };
  const selected = () => workspaces().find((w) => w.id === selectedId());
  const openCount = () => workspaces().filter((w) => w.open).length;
  // 동시 오픈 상한 (BR-11) — 넘으면 openWorkspace가 조용히 아무것도 안 한다. 미리 흐리게 두고 이유를 보인다
  const openFull = () => openCount() >= MAX_OPEN_WORKSPACES;
  const fullReason = () =>
    tf("동시에 열 수 있는 워크스페이스는 {n}개입니다 — 하나를 닫고 다시 시도하세요", { n: MAX_OPEN_WORKSPACES });
  // 닫아 둔 워크스페이스가 위 — 다시 여는 것이 이 화면에 오는 가장 흔한 이유다 (0.5, 시안 EYy9T)
  const groups = () =>
    [
      { label: t("열려 있지 않음"), items: workspaces().filter((w) => !w.open) },
      { label: t("열림"), items: workspaces().filter((w) => w.open) },
    ].filter((g) => g.items.length > 0);
  // 첫 선택은 화면 맨 위 행 — 레지스트리 첫 항목은 아래 '열림' 그룹일 수 있다 (U62)
  const [selectedId, setSelectedId] = createSignal(groups()[0]?.items[0]?.id);
  const sessionsOf = (id: string) => backend.listSessions().filter((s) => s.workspaceId === id);
  // 행의 보조 글 — 브랜치 · 세션 수. 경로가 없으면 그 사실(branchNote)이 먼저다
  const rowNote = (ws: Workspace) => {
    if (ws.pathMissing) return ws.branchNote;
    const n = sessionsOf(ws.id).length;
    const branch = ws.branch ?? "—";
    if (n === 0) return branch;
    return tf(ws.open ? "{branch} · {n} 세션" : "{branch} · {n} 세션 저장됨", { branch, n });
  };
  // 원격 표시 — 토큰·사용자 정보를 뗀 주소만 보인다. 웹 주소로 못 바꾸는 것(로컬 경로)은 그대로
  const remoteText = (r: string | undefined) => (r ? (remoteWebUrl(r)?.replace(/^https:\/\//, "") ?? r) : "—");
  const reveal = async (path: string) => {
    if (!(await revealPath(path))) notify(t("폴더를 열 수 없습니다 — 경로가 없어졌습니다"));
  };

  const [error, setError] = createSignal<string | undefined>(undefined);
  const [initTarget, setInitTarget] = createSignal<string | undefined>(undefined); // FR-E-01 — git init 확인
  const [cloneOpen, setCloneOpen] = createSignal(false);
  const [cloneUrl, setCloneUrl] = createSignal("");
  const [cloneBusy, setCloneBusy] = createSignal(false);
  let cloneBox: HTMLDivElement | undefined;

  // 선택 창이 열려 있는 동안 [폴더 찾기…]를 막는다 (B135) — 다시 누르면 선택 창이 하나 더 열렸다
  const [picking, setPicking] = createSignal(false);
  const connectLocal = async () => {
    setError(undefined);
    if (!isTauri()) {
      backend.addWorkspace();
      return;
    }
    if (picking()) return;
    setPicking(true);
    const path = await pickFolder().finally(() => setPicking(false));
    if (!path) return;
    try {
      const info = await registerWorkspace(path);
      await refreshWorkspaces();
      setSelectedId(info.entry.id);
    } catch (e) {
      if (String(e).includes("NOT_A_REPO")) setInitTarget(path);
      else setError(String(e));
    }
  };

  const confirmInit = async () => {
    const path = initTarget();
    if (!path) return;
    try {
      await gitInit(path);
      const info = await registerWorkspace(path);
      setInitTarget(undefined);
      await refreshWorkspaces();
      setSelectedId(info.entry.id);
    } catch (e) {
      setInitTarget(undefined);
      setError(String(e));
    }
  };

  const runClone = async () => {
    const url = cloneUrl().trim();
    if (!url) return;
    setError(undefined);
    if (!isTauri()) {
      backend.addWorkspace(url);
      setCloneOpen(false);
      return;
    }
    const parent = await pickFolder();
    if (!parent) return;
    setCloneBusy(true);
    try {
      const clonedPath = await cloneRepo(url, parent);
      const info = await registerWorkspace(clonedPath);
      await refreshWorkspaces();
      setSelectedId(info.entry.id);
      setCloneOpen(false);
      setCloneUrl("");
    } catch (e) {
      setError(`${t("clone 실패")} · ${String(e)}`);
    } finally {
      setCloneBusy(false);
    }
  };

  const repath = async (id: string) => {
    if (!isTauri()) {
      backend.repairWorkspace(id);
      return;
    }
    const path = await pickFolder();
    if (!path) return;
    try {
      await repathWorkspace(id, path);
      await refreshWorkspaces();
    } catch (e) {
      setError(String(e));
    }
  };

  // 등록 해제는 레지스트리에서만 지우지만, 그 워크스페이스의 세션 PTY·잡 트리는 함께 죽는다
  // (hydrateWorkspaces가 정리한다). 라벨의 "디스크는 그대로"가 그 사실을 가리므로, 살아 있는
  // 세션이 있으면 종료 확인창과 같은 확인을 먼저 받는다 (B43).
  const liveOf = (id: string) => backend.listSessions().filter((s) => s.workspaceId === id && s.status !== "dead");
  const [unregTarget, setUnregTarget] = createSignal<string | undefined>(undefined);

  const askUnregister = (id: string) => {
    if (liveOf(id).length > 0) setUnregTarget(id);
    else void unregister(id);
  };

  const unregister = async (id: string) => {
    setUnregTarget(undefined);
    if (isTauri()) {
      await unregisterWorkspace(id).catch(() => {});
      await refreshWorkspaces();
    } else {
      backend.removeWorkspace(id);
    }
    if (selectedId() === id) setSelectedId(workspaces()[0]?.id);
  };

  // 목록 행과 상세의 [열기]는 같은 일을 한다 (U60) — 열고 그 워크스페이스로 간다. 세션이 없으면
  // 첫 세션 마법사, 있으면 탭으로 (B107: 이미 세션이 있는 워크스페이스를 '첫 세션' 마법사로 들이지 않는다)
  const open = (id: string) => {
    if (!workspaces().find((w) => w.id === id)?.open && openFull()) return notify(fullReason());
    backend.openWorkspace(id);
    touchWorkspace(id);
    setView(openView(id, sessionsOf(id).length));
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("워크스페이스 열기 · 관리")}</h1>
          <div class="sub mono">{t("탭 줄의 + 로 연다 · 열려 있지 않은 워크스페이스가 위")}</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn" disabled={picking()} onClick={() => void connectLocal()}>
            <Icon name="folder" size={12} />
            {t("폴더 찾기…")}
          </button>
          <button class="btn primary" onClick={() => setCloneOpen(true)}>
            <Icon name="git-branch" size={12} />
            {t("클론…")}
          </button>
        </div>
      </div>
      <div class="screen-body conn-body">
        <div class="conn-list">
          <Show when={error()}>
            <div class="card conn-error mono">{error()}</div>
          </Show>
          <div class="conn-registry" role="list">
            <For each={groups()}>
              {(g) => (
                <>
                  <div class="conn-group-head mono">
                    {g.label} · {g.items.length}
                  </div>
                  <For each={g.items}>
                    {(ws) => (
                      // 행은 목록 항목이고, 안의 동작(선택·탐색기·원격·열기)은 각자 버튼이다 (U61) —
                      // 버튼 안에 대화형 요소를 넣으면 Tab으로 닿지 않고 스크린리더는 행 전체를 한 버튼으로 읽는다
                      <div
                        class="ws-row"
                        role="listitem"
                        classList={{ selected: selectedId() === ws.id, missing: ws.pathMissing }}
                        onClick={() => setSelectedId(ws.id)}
                      >
                        <span class="ws-row-ic" classList={{ open: ws.open }}>
                          <Icon name={ws.open ? "circle-dot" : "circle"} size={12} />
                        </span>
                        <span class="ws-row-copy">
                          <span class="ws-row-top">
                            <button class="ws-row-name" aria-pressed={selectedId() === ws.id}>
                              {ws.name}
                            </button>
                            <span class="mono muted ws-row-note" classList={{ "st-dead": ws.pathMissing }}>
                              {rowNote(ws)}
                            </span>
                          </span>
                          <span class="ws-row-line mono muted">
                            <span class="ws-row-text" title={ws.path}>
                              {ws.path}
                            </span>
                            <button
                              class="ws-row-link"
                              classList={{ off: ws.pathMissing }}
                              disabled={ws.pathMissing}
                              title={t(ws.pathMissing ? "경로를 찾을 수 없음" : "탐색기에서 열기")}
                              aria-label={t(ws.pathMissing ? "경로를 찾을 수 없음" : "탐색기에서 열기")}
                              onClick={(e) => {
                                e.stopPropagation();
                                void reveal(ws.path);
                              }}
                            >
                              <Icon name="folder-open" size={11} />
                            </button>
                          </span>
                          <Show when={ws.remote}>
                            <Show
                              when={remoteWebUrl(ws.remote)}
                              fallback={<span class="ws-row-line mono muted">{remoteText(ws.remote)}</span>}
                            >
                              {(web) => (
                                <button
                                  class="ws-row-line mono ws-row-remote"
                                  title={web()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openLink(web());
                                  }}
                                >
                                  <span class="ws-row-text">{remoteText(ws.remote)}</span>
                                  <Icon name="external-link" size={10} />
                                </button>
                              )}
                            </Show>
                          </Show>
                        </span>
                        <span class="ws-row-act">
                          <Show
                            when={!ws.pathMissing}
                            fallback={
                              <button
                                class="btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void repath(ws.id);
                                }}
                              >
                                {t("경로 재지정")}
                              </button>
                            }
                          >
                            <Show when={!ws.open} fallback={<span class="mono ws-row-open">{t("열림")}</span>}>
                              <button
                                class="btn primary"
                                style={{ opacity: openFull() ? 0.45 : undefined }}
                                title={openFull() ? fullReason() : undefined}
                                aria-disabled={openFull()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  open(ws.id);
                                }}
                              >
                                {t("열기")}
                              </button>
                            </Show>
                          </Show>
                        </span>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
            <Show when={workspaces().length === 0}>
              <div class="muted conn-empty">{t('등록된 저장소가 없습니다. "폴더 찾기…"로 시작하세요.')}</div>
            </Show>
          </div>
        </div>

        <div class="conn-detail">
          <Show when={selected()} fallback={<div class="muted">{t("저장소를 선택하세요")}</div>}>
            {(ws) => (
              <>
                <div class="eyebrow conn-detail-eyebrow">{t("선택한 워크스페이스")}</div>
                <div class="conn-detail-name">{ws().name}</div>
                <div class="conn-detail-kv">
                  <KV k={t("경로")} v={ws().path} />
                  <KV k={t("브랜치")} v={ws().branch ?? "—"} />
                  <KV
                    k={t("원격 (origin)")}
                    v={
                      <Show when={remoteWebUrl(ws().remote)} fallback={remoteText(ws().remote)}>
                        {(web) => (
                          <a
                            class="conn-remote-link"
                            href={web()}
                            title={web()}
                            onClick={(e) => (e.preventDefault(), openLink(web()))}
                          >
                            {remoteText(ws().remote)}
                            <Icon name="external-link" size={11} />
                          </a>
                        )}
                      </Show>
                    }
                  />
                  <KV
                    k={t("저장된 세션")}
                    v={tf("{n} · 재개 가능 {m}", {
                      n: sessionsOf(ws().id).length,
                      m: sessionsOf(ws().id).filter((s) => s.resumable).length,
                    })}
                  />
                </div>
                <div class="conn-detail-btns">
                  <button
                    class="btn primary"
                    disabled={ws().pathMissing || (!ws().open && openFull())}
                    title={!ws().open && openFull() ? fullReason() : undefined}
                    onClick={() => open(ws().id)}
                  >
                    {ws().pathMissing ? t("경로 재지정 필요") : ws().open ? t("탭으로 가기") : t("열기")}
                  </button>
                  <button
                    class="btn"
                    disabled={ws().pathMissing}
                    title={ws().pathMissing ? t("경로를 찾을 수 없음") : undefined}
                    onClick={() => void reveal(ws().path)}
                  >
                    <Icon name="folder-open" size={12} />
                    {t("탐색기에서 열기")}
                  </button>
                  <button
                    class="btn conn-unreg"
                    title={t("레지스트리에서만 제거 — 디스크의 저장소는 그대로 · 실행 중 세션은 종료됩니다")}
                    onClick={() => askUnregister(ws().id)}
                  >
                    {t("등록 해제…")}
                  </button>
                </div>
              </>
            )}
          </Show>
        </div>
      </div>

      {/* git init 확인 (FR-E-01) · 등록 해제 확인 (B43) — 공통 확인창이라 포커스·Enter·Esc 규칙이 같다 (U61 · B108) */}
      <Show when={initTarget()}>
        {(path) => (
          <ConfirmDialog
            title={t("git 저장소가 아닙니다")}
            body={t("이 폴더에서 `git init`을 실행해 저장소로 만든 뒤 등록할까요? 기존 파일은 변경되지 않습니다.")}
            info={[path()]}
            confirmLabel={t("git init 후 등록")}
            onConfirm={() => void confirmInit()}
            onCancel={() => setInitTarget(undefined)}
          />
        )}
      </Show>
      <Show when={unregTarget()}>
        {(id) => (
          <ConfirmDialog
            danger
            title={t("등록을 해제할까요?")}
            body={
              <>
                {tf("실행 중인 세션 {n}개가 지금 종료됩니다 — 재등록해도 돌아오지 않습니다.", {
                  n: String(liveOf(id()).length),
                })}
                <div class="muted" style={{ "margin-top": "4px" }}>
                  {t("디스크의 저장소와 .eqmux 파일은 그대로 남습니다.")}
                </div>
              </>
            }
            info={[workspaces().find((w) => w.id === id())?.path ?? ""]}
            confirmLabel={t("세션 종료 후 등록 해제")}
            onConfirm={() => void unregister(id())}
            onCancel={() => setUnregTarget(undefined)}
          />
        )}
      </Show>

      {/* 원격 Clone (FR-E-02) */}
      <Show when={cloneOpen()}>
        <Layer close={() => !cloneBusy() && setCloneOpen(false)} box={() => cloneBox} />
        <div class="overlay" onClick={() => !cloneBusy() && setCloneOpen(false)}>
          <div
            ref={cloneBox}
            class="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("원격에서 Clone")}
            style={{ width: "480px", padding: "16px 18px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ "font-weight": 800, "font-size": "14px" }}>{t("원격에서 Clone")}</div>
            <div class="muted" style={{ "font-size": "11px", margin: "4px 0 10px" }}>
              {t("URL 입력 → 부모 폴더 선택 → clone 후 자동 등록")}
            </div>
            <input
              class="mono"
              style={{ width: "100%", "font-size": "12px" }}
              placeholder="https://github.com/user/repo.git"
              value={cloneUrl()}
              disabled={cloneBusy()}
              onInput={(e) => setCloneUrl(e.currentTarget.value)}
              ref={(el) => queueMicrotask(() => el.focus())}
              onKeyDown={(e) => {
                if (isSubmitEnter(e)) void runClone(); // 한글 조합 확정 Enter는 넘긴다 (B130)
                // 입력칸의 Esc는 레이어 스택이 양보한다 — 이 창만 닫는다 (B108)
                if (e.key === "Escape" && !cloneBusy()) {
                  e.stopPropagation();
                  setCloneOpen(false);
                }
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "8px",
                "justify-content": "flex-end",
                "margin-top": "14px",
              }}
            >
              <button class="btn" disabled={cloneBusy()} onClick={() => setCloneOpen(false)}>
                {t("취소")}
              </button>
              <button class="btn primary" disabled={cloneBusy() || !cloneUrl().trim()} onClick={() => void runClone()}>
                {t(cloneBusy() ? "clone 중…" : "폴더 선택 후 Clone")}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
