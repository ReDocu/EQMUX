import { Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { AppBar } from "./components/AppBar";
import { SidePanel } from "./components/SidePanel";
import { backend } from "./backend/mock";
import { refreshWorkspaces } from "./backend/workspaces";
import { exitOpen, layoutPickerOpen, panelOpen, setLayoutPickerOpen, view } from "./state";
import { ControlCenter } from "./screens/ControlCenter";
import { Dashboard } from "./screens/Dashboard";
import { DefaultTerminalSetup } from "./screens/DefaultTerminalSetup";
import { ExitDialog } from "./screens/ExitDialog";
import { GitDiffEditor } from "./screens/GitDiffEditor";
import { LaunchMode } from "./screens/LaunchMode";
import { LayoutPicker } from "./screens/LayoutPicker";
import { Missions } from "./screens/Missions";
import { RoleLibrary } from "./screens/RoleLibrary";
import { Settings } from "./screens/Settings";
import { TeamCasting } from "./screens/TeamCasting";
import { TeamComposition } from "./screens/TeamComposition";
import { WorkspaceConnection } from "./screens/WorkspaceConnection";

export function App() {
  const v = view;

  // Tauri 부트스트랩 — workspaces.json 실물 레지스트리가 목 목록을 대체한다 (PRD E)
  onMount(() => void refreshWorkspaces());

  // 페인 배치 단축키 (srpYm 푸터 명세) — CTRL + SHIFT + L
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setLayoutPickerOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="app">
      <AppBar />
      <div class="app-row">
        <div class="app-main">
          <Switch>
            <Match when={v().kind === "control"}>
              <Dashboard />
            </Match>
            <Match when={v().kind === "workspace"}>
              {(() => {
                const id = (v() as { kind: "workspace"; id: string }).id;
                const ws = backend.listWorkspaces().find((w) => w.id === id);
                return ws ? <ControlCenter workspace={ws} /> : <Dashboard />;
              })()}
            </Match>
            <Match when={v().kind === "connect"}>
              <WorkspaceConnection />
            </Match>
            <Match when={v().kind === "launch"}>
              <LaunchMode wsId={(v() as { kind: "launch"; wsId: string }).wsId} />
            </Match>
            <Match when={v().kind === "terminalSetup"}>
              <DefaultTerminalSetup wsId={(v() as { kind: "terminalSetup"; wsId: string }).wsId} />
            </Match>
            <Match when={v().kind === "casting"}>
              <TeamCasting wsId={(v() as { kind: "casting"; wsId: string }).wsId} />
            </Match>
            <Match when={v().kind === "composition"}>
              <TeamComposition wsId={(v() as { kind: "composition"; wsId: string }).wsId} />
            </Match>
            <Match when={v().kind === "roles"}>
              <RoleLibrary />
            </Match>
            <Match when={v().kind === "missions"}>
              <Missions wsId={(v() as { kind: "missions"; wsId: string }).wsId} />
            </Match>
            <Match when={v().kind === "gitdiff"}>
              <GitDiffEditor />
            </Match>
            <Match when={v().kind === "settings"}>
              <Settings />
            </Match>
          </Switch>
        </div>
        <Show when={panelOpen()}>
          <SidePanel />
        </Show>
      </div>
      <Show when={exitOpen()}>
        <ExitDialog />
      </Show>
      <Show when={layoutPickerOpen()}>
        <LayoutPicker />
      </Show>
    </div>
  );
}
