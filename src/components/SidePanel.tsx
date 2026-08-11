// 사이드 패널 (화면 #10) — 도구 서랍. 페인이 아니라 분할 그리드 밖에 있다 (§2.1).
// M0에서 실동작은 대화 탭뿐이고 git·탐색기·포트는 목 데이터 표시다.
import { For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { panelTab, setPanelOpen, setPanelTab, setView, tick } from "../state";
import type { PanelTab } from "../state";
import { Eyebrow, KV } from "./ui";
import { ConversationTab } from "./ConversationTab";

const TABS: { key: PanelTab; label: string }[] = [
  { key: "conversation", label: "대화" },
  { key: "git", label: "git" },
  { key: "files", label: "탐색기" },
  { key: "ports", label: "포트" },
  { key: "missions", label: "임무" },
];

const GIT_CHANGES = [
  { st: "M", file: "src/auth/session.ts" },
  { st: "M", file: "src/auth/token.ts" },
  { st: "A", file: "src/auth/store.ts" },
  { st: "D", file: "src/auth/legacy.ts" },
];

const FILE_TREE = [
  "src/",
  "  auth/",
  "    session.ts",
  "    token.ts",
  "    store.ts",
  "  api/",
  "    routes.ts",
  "  main.ts",
  "tests/",
  "  auth.test.ts",
  "package.json",
];

const PORTS = [
  { port: 3000, proc: "vite", session: "노엘" },
  { port: 8080, proc: "api-server", session: "카이" },
  { port: 5432, proc: "postgres", session: "—" },
];

export function SidePanel() {
  const missions = () => {
    tick();
    return backend.listMissions();
  };
  const wsName = (id: string) => backend.listWorkspaces().find((w) => w.id === id)?.name ?? id;

  return (
    <div class="side-panel">
      <div class="panel-tabs">
        <For each={TABS}>
          {(t) => (
            <button class="panel-tab" classList={{ active: panelTab() === t.key }} onClick={() => setPanelTab(t.key)}>
              {t.label}
            </button>
          )}
        </For>
        <button class="panel-tab close" onClick={() => setPanelOpen(false)}>
          ✕
        </button>
      </div>
      <div class="panel-body">
        <Show when={panelTab() === "conversation"}>
          <ConversationTab />
        </Show>

        <Show when={panelTab() === "git"}>
          <Eyebrow>GIT · feature/auth-refactor</Eyebrow>
          <div class="card inset" style={{ padding: "4px 10px", margin: "8px 0" }}>
            <KV k="브랜치" v="feature/auth-refactor" />
            <KV k="원격" v="ahead 2 · behind 0" />
            <KV k="마지막 커밋" v="refactor: session store" />
          </div>
          <Eyebrow>변경 파일 · {GIT_CHANGES.length}</Eyebrow>
          <div class="card inset mono" style={{ padding: "8px 10px", "margin-top": "8px", "font-size": "11px" }}>
            <For each={GIT_CHANGES}>
              {(c) => (
                <div style={{ padding: "2px 0" }}>
                  <span class={c.st === "D" ? "st-dead" : c.st === "A" ? "badge green" : "st-waiting"}>{c.st}</span>{" "}
                  {c.file}
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={panelTab() === "files"}>
          <Eyebrow>탐색기 · 워크스페이스 루트</Eyebrow>
          <div class="card inset mono" style={{ padding: "8px 10px", "margin-top": "8px", "font-size": "11px", "white-space": "pre" }}>
            <For each={FILE_TREE}>{(f) => <div>{f}</div>}</For>
          </div>
        </Show>

        <Show when={panelTab() === "ports"}>
          <Eyebrow>열린 포트</Eyebrow>
          <div class="card inset" style={{ padding: "4px 10px", "margin-top": "8px" }}>
            <For each={PORTS}>
              {(p) => <KV k={`:${p.port}`} v={`${p.proc} · ${p.session}`} />}
            </For>
          </div>
        </Show>

        <Show when={panelTab() === "missions"}>
          <Eyebrow>임무 트리 · 전역</Eyebrow>
          <For each={missions()}>
            {(m) => (
              <button
                class="card mission-row"
                style={{ width: "100%", "text-align": "left", cursor: "pointer" }}
                onClick={() => setView({ kind: "missions", wsId: m.workspaceId })}
              >
                <span style={{ "font-weight": 600 }}>{m.name}</span>
                <span class="badge" classList={{ blue: m.status === "in-progress", purple: m.status === "in-review", green: m.status === "done" }}>
                  {m.status.toUpperCase()}
                </span>
                <div class="mono muted" style={{ "font-size": "10px", width: "100%" }}>
                  {wsName(m.workspaceId)} · {m.assigned.length} 세션
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
