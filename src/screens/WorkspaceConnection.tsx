// 워크스페이스 연결 (mmBPm) — 레인 01의 시작. git repo 1개 = 팀 1개 = 탭 1개 (W0).
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
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

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>워크스페이스 연결</h1>
          <div class="sub">git repo 1개 = 팀 1개 = 탭 1개 · 등록 무제한 · 동시 오픈 10개</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn" onClick={() => backend.addWorkspace("github.com/acme/cloned-repo")}>
            원격에서 Clone
          </button>
          <button class="btn primary" onClick={() => backend.addWorkspace()}>
            + 로컬 저장소 연결
          </button>
        </div>
      </div>
      <div class="screen-body conn-body">
        <div class="conn-list">
          <div class="conn-list-head">
            <Eyebrow>등록된 저장소</Eyebrow>
            <span class="mono muted">
              {workspaces().length} 등록 · {openCount()} 열림
            </span>
          </div>
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
                      if (ws.pathMissing) backend.repairWorkspace(ws.id);
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
        </div>

        <div class="conn-detail">
          <Show when={selected()}>
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
                  onClick={() => {
                    backend.openWorkspace(ws().id);
                    setView({ kind: "casting", wsId: ws().id });
                  }}
                >
                  {ws().pathMissing ? "경로 재지정 필요" : `${ws().name} 열기`}
                </button>
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
