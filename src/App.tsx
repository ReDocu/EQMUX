import { Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { AppBar } from "./components/AppBar";
import { SidePanel } from "./components/SidePanel";
import { ensureAgentListeners } from "./backend/agent";
import { backend } from "./backend/mock";
import { startMemorySampling } from "./backend/memory";
import { isTauri } from "./backend/pty";
import { performShutdown } from "./backend/shutdown";
import { startTeamSync } from "./backend/team";
import { refreshWorkspaces } from "./backend/workspaces";
import { exitOpen, layoutPickerOpen, panelOpen, setExitOpen, setLayoutPickerOpen, view } from "./state";
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
  // agent-state 이벤트 수신 시작 (PRD D) — 상태 스트림이 목 백엔드를 실측으로 덮는다
  onMount(() => void ensureAgentListeners());
  // 팀 편성 자동 저장 (PRD E) — 역할 슬롯 변경 → .eqmux/team.json + team.md
  onMount(() => startTeamSync());
  // 세션 메모리 계측 (FR-C-09 · C11) — Job Object 10초 샘플링, 표시 전용
  onMount(() => startMemorySampling());

  // 창 닫기 = 앱 완전 종료 (FR-C-60) — 실행 중 세션이 있으면 확인 다이얼로그 (FR-C-61),
  // 없으면 flush 시퀀스만 돌고 조용히 종료된다.
  onMount(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().onCloseRequested((e) => {
        e.preventDefault();
        const running = backend.listSessions().some((s) => s.status !== "dead");
        if (running) setExitOpen(true);
        else void performShutdown();
      }),
    );
  });

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
