// 워크스페이스 연결 (mmBPm · PRD E §4.1) — 레인 01의 시작. git repo 1개 = 팀 1개 = 탭 1개 (W0).
// Tauri: 실제 폴더 선택 → git 검증 → workspaces.json 등록. 브라우저: 목 폴백.
import { createSignal, For, Show } from "solid-js";
import { backend, MAX_OPEN_WORKSPACES } from "../backend/mock";
import { remoteWebUrl } from "../backend/git";
import { isTauri, openExternal, revealPath } from "../backend/pty";
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
import { setView, tick } from "../state";
import { t, tf } from "../i18n";
import { KV, notify } from "../components/ui";
import { Icon } from "../components/icons";
import type { Workspace } from "../types";

export function WorkspaceConnection() {
  const workspaces = () => {
    tick();
    return backend.listWorkspaces();
  };
  const [selectedId, setSelectedId] = createSignal(workspaces()[0]?.id);
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

  const connectLocal = async () => {
    setError(undefined);
    if (!isTauri()) {
      backend.addWorkspace();
      return;
    }
    const path = await pickFolder();
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

  const open = (id: string) => {
    backend.openWorkspace(id);
    touchWorkspace(id);
    setView({ kind: "launch", wsId: id });
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("워크스페이스 열기 · 관리")}</h1>
          <div class="sub mono">{t("탭 줄의 + 로 연다 · 열려 있지 않은 워크스페이스가 위")}</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn" onClick={() => void connectLocal()}>
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
          <div class="conn-registry">
            <For each={groups()}>
              {(g) => (
                <>
                  <div class="conn-group-head mono">
                    {g.label} · {g.items.length}
                  </div>
                  <For each={g.items}>
                    {(ws) => (
                      <button
                        class="ws-row"
                        classList={{ selected: selectedId() === ws.id, missing: ws.pathMissing }}
                        onClick={() => setSelectedId(ws.id)}
                      >
                        <span class="ws-row-ic" classList={{ open: ws.open }}>
                          <Icon name={ws.open ? "circle-dot" : "circle"} size={12} />
                        </span>
                        <span class="ws-row-copy">
                          <span class="ws-row-top">
                            <span class="ws-row-name">{ws.name}</span>
                            <span class="mono muted ws-row-note" classList={{ "st-dead": ws.pathMissing }}>
                              {rowNote(ws)}
                            </span>
                          </span>
                          <span class="ws-row-line mono muted">
                            <span class="ws-row-text" title={ws.path}>
                              {ws.path}
                            </span>
                            <span
                              class="ws-row-link"
                              classList={{ off: ws.pathMissing }}
                              title={t(ws.pathMissing ? "경로를 찾을 수 없음" : "탐색기에서 열기")}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!ws.pathMissing) void reveal(ws.path);
                              }}
                            >
                              <Icon name="folder-open" size={11} />
                            </span>
                          </span>
                          <Show when={ws.remote}>
                            <Show
                              when={remoteWebUrl(ws.remote)}
                              fallback={<span class="ws-row-line mono muted">{remoteText(ws.remote)}</span>}
                            >
                              {(web) => (
                                <span
                                  class="ws-row-line mono ws-row-remote"
                                  title={web()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openExternal(web());
                                  }}
                                >
                                  <span class="ws-row-text">{remoteText(ws.remote)}</span>
                                  <Icon name="external-link" size={10} />
                                </span>
                              )}
                            </Show>
                          </Show>
                        </span>
                        <span class="ws-row-act">
                          <Show
                            when={!ws.pathMissing}
                            fallback={
                              <span
                                class="btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void repath(ws.id);
                                }}
                              >
                                {t("경로 재지정")}
                              </span>
                            }
                          >
                            <Show
                              when={!ws.open}
                              fallback={<span class="mono ws-row-open">{t("열림")}</span>}
                            >
                              <span
                                class="btn primary"
                                style={{ opacity: openFull() ? 0.45 : undefined }}
                                title={openFull() ? fullReason() : undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (openFull()) notify(fullReason());
                                  else backend.openWorkspace(ws.id);
                                }}
                              >
                                {t("열기")}
                              </span>
                            </Show>
                          </Show>
                        </span>
                      </button>
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
                <div class="eyebrow conn-detail-eyebrow">SELECTED WORKSPACE</div>
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
                            onClick={(e) => (e.preventDefault(), openExternal(web()))}
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
                    {ws().pathMissing ? t("경로 재지정 필요") : t("열기")}
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

      {/* git init 확인 (FR-E-01) */}
      <Show when={initTarget()}>
        <div class="overlay" onClick={() => setInitTarget(undefined)}>
          <div class="dialog" style={{ width: "440px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ "font-weight": 800, "font-size": "14px" }}>{t("git 저장소가 아닙니다")}</div>
            <div class="mono muted" style={{ "font-size": "11px", margin: "6px 0 10px" }}>
              {initTarget()}
            </div>
            <div class="card inset" style={{ padding: "8px 10px", "font-size": "11px", "line-height": 1.6 }}>
              {t("이 폴더에서 `git init`을 실행해 저장소로 만든 뒤 등록할까요? 기존 파일은 변경되지 않습니다.")}
            </div>
            <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
              <button class="btn" onClick={() => setInitTarget(undefined)}>
                {t("취소")}
              </button>
              <button class="btn primary" onClick={() => void confirmInit()}>
                {t("git init 후 등록")}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 등록 해제 확인 (B43) — 실행 중 세션이 있을 때만 뜬다 */}
      <Show when={unregTarget()}>
        <div class="overlay" onClick={() => setUnregTarget(undefined)}>
          <div class="dialog" style={{ width: "440px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ "font-weight": 800, "font-size": "14px" }}>{t("등록을 해제할까요?")}</div>
            <div class="mono muted" style={{ "font-size": "11px", margin: "6px 0 10px" }}>
              {workspaces().find((w) => w.id === unregTarget())?.path}
            </div>
            <div class="card inset" style={{ padding: "8px 10px", "font-size": "11px", "line-height": 1.6 }}>
              {tf("실행 중인 세션 {n}개가 지금 종료됩니다 — 재등록해도 돌아오지 않습니다.", {
                n: String(liveOf(unregTarget()!).length),
              })}
              <div class="muted" style={{ "margin-top": "4px" }}>
                {t("디스크의 저장소와 .eqmux 파일은 그대로 남습니다.")}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
              <button class="btn" onClick={() => setUnregTarget(undefined)}>
                {t("취소")}
              </button>
              <button class="btn danger" onClick={() => void unregister(unregTarget()!)}>
                {t("세션 종료 후 등록 해제")}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 원격 Clone (FR-E-02) */}
      <Show when={cloneOpen()}>
        <div class="overlay" onClick={() => !cloneBusy() && setCloneOpen(false)}>
          <div class="dialog" style={{ width: "480px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
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
              onKeyDown={(e) => e.key === "Enter" && void runClone()}
            />
            <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
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
