// 앱 바 (DdrkL) — 관제 고정 탭(맨 왼쪽, G1) + 워크스페이스 탭(B3, 닫기/추가) + 전역 도구 4종.
// 패널 도구(git·포트·로그·브라우저·임무)는 사이드 패널 탭과 화면 버튼으로만 접근한다.
import { For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { setExitOpen, setView, tick, view } from "../state";
import { ATTENTION_ORDER } from "../types";

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

  return (
    <div class="appbar">
      <div class="brand">EQMUX</div>
      <div class="tabs">
        <button
          class="tab"
          classList={{ active: view().kind === "control" }}
          onClick={() => setView({ kind: "control" })}
        >
          관제
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
            >
              <Show when={wsSignal(ws.id)}>
                {(color) => <span class="dot" style={{ background: color() }} />}
              </Show>
              {ws.name}
              <Show when={wsUnseen(ws.id)}>
                <span class="unread-dot" />
              </Show>
              <span
                class="tab-close"
                title="워크스페이스 닫기 (세션은 백그라운드 유지)"
                onClick={(e) => {
                  e.stopPropagation();
                  backend.closeWorkspace(ws.id);
                  if (view().kind === "workspace" && (view() as { id?: string }).id === ws.id) {
                    setView({ kind: "control" });
                  }
                }}
              >
                ✕
              </span>
            </button>
          )}
        </For>
        <button class="tab tab-add" title="워크스페이스 연결" onClick={() => setView({ kind: "connect" })}>
          +
        </button>
      </div>
      <div class="tools">
        <button
          class="tool"
          classList={{ active: view().kind === "connect" }}
          onClick={() => setView({ kind: "connect" })}
        >
          워크스페이스
        </button>
        <button class="tool" classList={{ active: view().kind === "roles" }} onClick={() => setView({ kind: "roles" })}>
          역할
        </button>
        <button
          class="tool"
          classList={{ active: view().kind === "settings" }}
          onClick={() => setView({ kind: "settings" })}
        >
          설정
        </button>
        <button class="tool" onClick={() => setExitOpen(true)}>
          종료
        </button>
      </div>
    </div>
  );
}
