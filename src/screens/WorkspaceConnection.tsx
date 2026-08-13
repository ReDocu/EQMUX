// 워크스페이스 연결 (mmBPm · PRD E §4.1) — 레인 01의 시작. git repo 1개 = 팀 1개 = 탭 1개 (W0).
// Tauri: 실제 폴더 선택 → git 검증 → workspaces.json 등록. 브라우저: 목 폴백.
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
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
import { Eyebrow, KV } from "../components/ui";

export function WorkspaceConnection() {
  const workspaces = () => {
    tick();
    return backend.listWorkspaces();
  };
  const [selectedId, setSelectedId] = createSignal(workspaces()[0]?.id);
  const selected = () => workspaces().find((w) => w.id === selectedId());
  const openCount = () => workspaces().filter((w) => w.open).length;

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
      setError(`clone 실패 · ${String(e)}`);
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

  const unregister = async (id: string) => {
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
          <h1>워크스페이스 연결</h1>
          <div class="sub">git repo 1개 = 팀 1개 = 탭 1개 · 등록 무제한 · 동시 오픈 10개</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn" onClick={() => setCloneOpen(true)}>
            원격에서 Clone
          </button>
          <button class="btn primary" onClick={() => void connectLocal()}>
            + 로컬 저장소 연결
          </button>
        </div>
      </div>
      <div class="screen-body conn-body">
        <div class="conn-list">
          <div class="conn-list-head">
            <Eyebrow>등록된 저장소 {isTauri() ? "· workspaces.json" : "· 목"}</Eyebrow>
            <span class="mono muted">
              {workspaces().length} 등록 · {openCount()} 열림
            </span>
          </div>
          <Show when={error()}>
            <div class="card conn-error mono">{error()}</div>
          </Show>
          <For each={workspaces()}>
            {(ws) => (
              <button
                class="card ws-item"
                classList={{ selected: selectedId() === ws.id, missing: ws.pathMissing }}
                onClick={() => setSelectedId(ws.id)}
              >
                <div class="ws-item-head">
                  <span style={{ "font-weight": 700 }}>{ws.name}</span>
                  <Show when={ws.open}>
                    <span class="badge green">OPEN</span>
                  </Show>
                  <span
                    class="ws-item-action badge"
                    classList={{ red: ws.pathMissing }}
                    style={{ cursor: ws.open ? "default" : "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (ws.pathMissing) void repath(ws.id);
                      else if (!ws.open) backend.openWorkspace(ws.id);
                    }}
                  >
                    {ws.pathMissing ? "재지정" : ws.open ? "열림" : "열기"}
                  </span>
                </div>
                <div class="mono muted" style={{ "font-size": "11px" }}>
                  {ws.path}
                </div>
                <div class="mono muted" style={{ "font-size": "11px" }}>
                  {ws.remote ?? "—"} · <span classList={{ "st-dead": ws.pathMissing }}>{ws.branchNote}</span>
                </div>
              </button>
            )}
          </For>
          <Show when={workspaces().length === 0}>
            <div class="card inset" style={{ padding: "16px", "text-align": "center" }}>
              <div class="muted" style={{ "font-size": "12px" }}>
                등록된 저장소가 없습니다. "+ 로컬 저장소 연결"로 시작하세요.
              </div>
            </div>
          </Show>
        </div>

        <div class="conn-detail">
          <Show when={selected()} fallback={<div class="muted">저장소를 선택하세요</div>}>
            {(ws) => (
              <>
                <Eyebrow>SELECTED REPOSITORY</Eyebrow>
                <div style={{ "font-size": "16px", "font-weight": 800, margin: "6px 0 2px" }}>{ws().name}</div>
                <div class="mono muted" style={{ "font-size": "11px" }}>
                  {ws().path}
                </div>
                <div class="card inset" style={{ padding: "4px 10px", margin: "12px 0" }}>
                  <KV k="브랜치" v={ws().branch ?? "—"} />
                  <KV k="원격" v={ws().remote ?? "—"} />
                  <KV k="팀 편성" v={ws().teamFile} />
                  <KV k="마지막 사용" v={ws().lastUsed ?? "—"} />
                </div>
                <div class="card inset" style={{ padding: "10px" }}>
                  <div style={{ "font-weight": 700, "font-size": "12px" }}>파일이 원본입니다</div>
                  <div class="muted" style={{ "font-size": "11px", "margin-top": "4px" }}>
                    .eqmux/team.json · team.md를 로드하고 역할 파일을 실측합니다. DB는 캐시이며 불일치 시
                    파일이 이깁니다.
                  </div>
                </div>
                <button
                  class="btn primary"
                  style={{ "margin-top": "14px", width: "100%", "justify-content": "center" }}
                  disabled={ws().pathMissing}
                  onClick={() => open(ws().id)}
                >
                  {ws().pathMissing ? "경로 재지정 필요" : `${ws().name} 열기`}
                </button>
                <button
                  class="btn ghost"
                  style={{ "margin-top": "8px", width: "100%", "justify-content": "center" }}
                  title="레지스트리에서만 제거 — 디스크의 저장소는 그대로 (FR-E-09)"
                  onClick={() => void unregister(ws().id)}
                >
                  등록 해제 (디스크는 그대로)
                </button>
              </>
            )}
          </Show>
        </div>
      </div>

      {/* git init 확인 (FR-E-01) */}
      <Show when={initTarget()}>
        <div class="overlay" onClick={() => setInitTarget(undefined)}>
          <div class="dialog" style={{ width: "440px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ "font-weight": 800, "font-size": "14px" }}>git 저장소가 아닙니다</div>
            <div class="mono muted" style={{ "font-size": "11px", margin: "6px 0 10px" }}>
              {initTarget()}
            </div>
            <div class="card inset" style={{ padding: "8px 10px", "font-size": "11px", "line-height": 1.6 }}>
              이 폴더에서 `git init`을 실행해 저장소로 만든 뒤 등록할까요? 기존 파일은 변경되지 않습니다.
            </div>
            <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
              <button class="btn" onClick={() => setInitTarget(undefined)}>
                취소
              </button>
              <button class="btn primary" onClick={() => void confirmInit()}>
                git init 후 등록
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 원격 Clone (FR-E-02) */}
      <Show when={cloneOpen()}>
        <div class="overlay" onClick={() => !cloneBusy() && setCloneOpen(false)}>
          <div class="dialog" style={{ width: "480px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ "font-weight": 800, "font-size": "14px" }}>원격에서 Clone</div>
            <div class="muted" style={{ "font-size": "11px", margin: "4px 0 10px" }}>
              URL 입력 → 부모 폴더 선택 → clone 후 자동 등록
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
                취소
              </button>
              <button class="btn primary" disabled={cloneBusy() || !cloneUrl().trim()} onClick={() => void runClone()}>
                {cloneBusy() ? "clone 중…" : "폴더 선택 후 Clone"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
