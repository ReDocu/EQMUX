import { Match, Show, Switch } from "solid-js";
import { AppBar } from "./components/AppBar";
import { SidePanel } from "./components/SidePanel";
import { backend } from "./backend/mock";
import { exitOpen, panelOpen, view } from "./state";
import { ControlCenter } from "./screens/ControlCenter";
import { Dashboard } from "./screens/Dashboard";
import { ExitDialog } from "./screens/ExitDialog";
import { Missions } from "./screens/Missions";
import { RoleLibrary } from "./screens/RoleLibrary";
import { Settings } from "./screens/Settings";
import { TeamCasting } from "./screens/TeamCasting";
import { TeamComposition } from "./screens/TeamComposition";
import { WorkspaceConnection } from "./screens/WorkspaceConnection";

export function App() {
  const v = view;
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
    </div>
  );
}
