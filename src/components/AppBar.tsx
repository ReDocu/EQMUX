// 앱 바 (DdrkL) — 관제 고정 탭(맨 왼쪽, G1) + 워크스페이스 탭(B3) + 도구 토글.
import { For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { panelOpen, setExitOpen, setPanelOpen, setView, tick, view } from "../state";
import { ATTENTION_ORDER } from "../types";

const TOOLS: { key: string; label: string }[] = [
  { key: "connect", label: "워크스페이스" },
  { key: "roles", label: "역할" },
  { key: "settings", label: "설정" },
];

export function AppBar() {
  const workspaces = () => {
    tick();
    return backend.listWorkspaces().filter((w) => w.open);
  };
  const unreadCount = () => {
    tick();
    return backend.listMessages().filter((m) => m.unread).length;
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
            </button>
          )}
        </For>
      </div>
      <div class="tools">
        <button class="tool" classList={{ active: panelOpen() }} onClick={() => setPanelOpen((o) => !o)}>
          패널
          <Show when={unreadCount() > 0}>
            <span
              style={{
                width: "6px",
                height: "6px",
                "border-radius": "50%",
                background: "var(--eq-blue)",
                "margin-left": "5px",
              }}
            />
          </Show>
        </button>
        <For each={TOOLS}>
          {(t) => (
            <button
              class="tool"
              classList={{ active: view().kind === t.key }}
              onClick={() => setView({ kind: t.key } as never)}
            >
              {t.label}
            </button>
          )}
        </For>
        <button class="tool" onClick={() => setExitOpen(true)}>
          종료
        </button>
      </div>
    </div>
  );
}
