import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { AppBar } from "./components/AppBar";
import { SidePanel } from "./components/SidePanel";
import { ensureAgentListeners } from "./backend/agent";
import { startMessageBus } from "./backend/conversation";
import { backend } from "./backend/mock";
import { startAgentProbe } from "./backend/agentprobe";
import { startMemorySampling } from "./backend/memory";
import { ensurePtyListeners, isTauri, setPtyExitHook } from "./backend/pty";
import { crashRecovery } from "./backend/recovery";
import type { CrashReport } from "./backend/recovery";
import { performShutdown } from "./backend/shutdown";
import { startTeamSync } from "./backend/team";
import { startFileWatch } from "./backend/watch";
import { refreshWorkspaces } from "./backend/workspaces";
import { exitOpen, layoutPickerOpen, overlay, panelOpen, setExitOpen, setLayoutPickerOpen, setView, terminalFull, view } from "./state";
import type { View } from "./state";
import { ScreenOverlay } from "./components/ScreenOverlay";
import { editorGuard, MissionExplorerTab } from "./components/MissionExplorerTab";
import { ControlCenter } from "./screens/ControlCenter";
import { CrashRecovery } from "./screens/CrashRecovery";
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

  // 전역 pty-output/exit 수신 — spawnPty 경로에만 맡기면 에이전트 전용 실행·재부착 세션이
  // 출력을 못 받는다. 셸 exit은 여기서 상태에 반영한다 (에이전트는 agent-state가 관장)
  onMount(() => {
    void ensurePtyListeners();
    setPtyExitHook((id, code) => backend.sessionExited(id, code));
  });
  // Tauri 부트스트랩 — workspaces.json 실물 레지스트리가 목 목록을 대체한다 (PRD E)
  onMount(() => void refreshWorkspaces());
  // agent-state 이벤트 수신 시작 (PRD D) — 상태 스트림이 목 백엔드를 실측으로 덮는다
  onMount(() => void ensureAgentListeners());
  // 팀 편성 자동 저장 (PRD E) — 역할 슬롯 변경 → .eqmux/team.json + team.md
  onMount(() => startTeamSync());
  // 메시지 버스 수신 (PRD F) — message-new → 스트림 반영 + 상태 기반 PTY 전달 (M3)
  onMount(() => void startMessageBus());
  // 세션 메모리 계측 (FR-C-09 · C11) — Job Object 10초 샘플링, 표시 전용
  onMount(() => startMemorySampling());
  // 세션 에이전트 감지 (셸 우선 모델) — 터미널에 직접 띄운 claude/codex 등을 관제에 표시
  onMount(() => startAgentProbe());
  // 외부 편집 감지 (FR-E-73) — .eqmux 변화 → 임무·라이브러리 재실측 (파일이 이긴다, FR-E-74)
  onMount(() => startFileWatch());

  // 비정상 종료 복구 (FR-C-35) — 직전 실행이 크래시였으면 직전 세션 목록을 1회 보여준다
  const [crash, setCrash] = createSignal<CrashReport | undefined>(undefined);
  onMount(() =>
    void crashRecovery().then((r) => {
      if (r?.dirty && r.sessions.length > 0) setCrash(r);
    }),
  );

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

  // 관제 탭 토글 (FR-G-03) — CTRL + SHIFT + D: 관제로, 다시 누르면 직전 워크스페이스 탭으로
  onMount(() => {
    let lastWsTab: string | undefined;
    createEffect(() => {
      const cur = view();
      if (cur.kind === "workspace") lastWsTab = (cur as { id: string }).id;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (view().kind === "control") {
          const all = backend.listWorkspaces();
          const ws = all.find((w) => w.id === lastWsTab && w.open) ?? all.find((w) => w.open);
          if (ws) setView({ kind: "workspace", id: ws.id });
        } else {
          setView({ kind: "control" });
        }
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
            <Match when={v().kind === "missions"}>
              <Missions wsId={(v() as { kind: "missions"; wsId: string }).wsId} />
            </Match>
            <Match when={v().kind === "gitdiff"}>
              <GitDiffEditor
                wsId={(v() as Extract<View, { kind: "gitdiff" }>).wsId}
                commit={(v() as Extract<View, { kind: "gitdiff" }>).commit}
              />
            </Match>
          </Switch>
        </div>
        {/* 전체 화면 오버레이가 떠 있는 동안은 그 안의 패널 인스턴스가 대신한다 (이중 마운트 방지) */}
        <Show when={panelOpen() && !(terminalFull() && view().kind === "workspace")}>
          <SidePanel />
        </Show>
      </div>
      {/* 전체 화면 팝업 4종 — overlay 신호 하나라서 동시에 하나만 열린다 (M25 확장) */}
      <Show when={overlay() === "explorer"}>
        <ScreenOverlay title="임무 · 파일 탐색기" icon="≡" guard={editorGuard}>
          <MissionExplorerTab />
        </ScreenOverlay>
      </Show>
      <Show when={overlay() === "connect"}>
        <ScreenOverlay title="워크스페이스 연결" icon="⌂">
          <WorkspaceConnection />
        </ScreenOverlay>
      </Show>
      <Show when={overlay() === "roles"}>
        <ScreenOverlay title="역할 라이브러리" icon="◇">
          <RoleLibrary />
        </ScreenOverlay>
      </Show>
      <Show when={overlay() === "settings"}>
        <ScreenOverlay title="설정" icon="⚙">
          <Settings />
        </ScreenOverlay>
      </Show>
      <Show when={exitOpen()}>
        <ExitDialog />
      </Show>
      <Show when={crash()}>
        {(r) => <CrashRecovery report={r()} onClose={() => setCrash(undefined)} />}
      </Show>
      <Show when={layoutPickerOpen()}>
        <LayoutPicker />
      </Show>
    </div>
  );
}
