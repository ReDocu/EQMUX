// 앱 바 (DdrkL) — 관제 고정 탭(맨 왼쪽, G1) + 워크스페이스 탭(B3, 닫기/추가) + 전역 도구.
// 대화는 전역 도구다 — 앱 바는 터미널 전체 화면에서도 보이므로 어느 모드에서든 접근된다 (M1).
// 나머지 패널 도구(git·포트·로그·브라우저·임무)는 사이드 패널 탭과 화면 버튼으로만 접근한다.
import { For, Show } from "solid-js";
import { backend } from "../backend/mock";
import {
  openPanel,
  overlay,
  panelOpen,
  panelTab,
  setExitOpen,
  setPanelOpen,
  setView,
  tick,
  toggleOverlay,
  view,
} from "../state";
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
        <button class="tab tab-add" title="워크스페이스 연결" onClick={() => toggleOverlay("connect")}>
          +
        </button>
      </div>
      <div class="tools">
        <button
          class="tool"
          classList={{ active: panelOpen() && panelTab() === "conversation" }}
          title="대화 패널 토글 — 전체 화면에서도 열립니다"
          onClick={toggleConversation}
        >
          대화
          <Show when={unreadMsgs()}>
            <span class="unread-dot" />
          </Show>
        </button>
        {/* 도구 4종은 전부 전체 화면 팝업이다 — overlay 신호 하나라서 동시에 하나만 열린다 */}
        <button
          class="tool"
          classList={{ active: overlay() === "explorer" }}
          title="임무 · 파일 탐색기 — 전체 화면 팝업 (M25)"
          onClick={() => toggleOverlay("explorer")}
        >
          임무
        </button>
        <button
          class="tool"
          classList={{ active: overlay() === "connect" }}
          title="워크스페이스 연결 — 전체 화면 팝업"
          onClick={() => toggleOverlay("connect")}
        >
          워크스페이스
        </button>
        <button
          class="tool"
          classList={{ active: overlay() === "roles" }}
          title="역할 라이브러리 — 전체 화면 팝업"
          onClick={() => toggleOverlay("roles")}
        >
          역할
        </button>
        <button
          class="tool"
          classList={{ active: overlay() === "settings" }}
          title="설정 — 전체 화면 팝업"
          onClick={() => toggleOverlay("settings")}
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
