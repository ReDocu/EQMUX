import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { AppBar } from "./components/AppBar";
import { SidePanel } from "./components/SidePanel";
import { ensureAgentListeners } from "./backend/agent";
import { startMessageBus } from "./backend/conversation";
import { backend } from "./backend/mock";
import { startAgentProbe } from "./backend/agentprobe";
import { startMemorySampling } from "./backend/memory";
import { diagSnapshot, startDiagnostics } from "./backend/diag";
import { startBrowserRequests } from "./backend/browser";
import { startPortWatch } from "./backend/ports";
import { ensurePtyListeners, isTauri, setPtyExitHook } from "./backend/pty";
import { crashRecovery } from "./backend/recovery";
import type { CrashReport } from "./backend/recovery";
import { performShutdown } from "./backend/shutdown";
import { startTeamSync } from "./backend/team";
import { startFileWatch } from "./backend/watch";
import { refreshWorkspaces } from "./backend/workspaces";
import {
  exitOpen,
  explorerTab,
  layoutPickerOpen,
  overlay,
  panelOpen,
  scopeWorkspace,
  setExitOpen,
  setExplorerTab,
  setLayoutPickerOpen,
  setView,
  terminalFull,
  view,
} from "./state";
import type { View } from "./state";
import { t } from "./i18n";
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

  // 임무 탐색기 팝업의 안쪽 전환 (0.3.7) — 임무는 화면 View, 탐색기는 팝업이라 서로 오갈
  // 길이 단방향이었다. 팝업이 둘을 다 품고 이 세그먼트가 고른다. 임무는 워크스페이스
  // 문맥이 있어야 성립하므로, 없으면 눌리지 않는다 (첫 실행 관제 화면)
  const explorerNav = () => (
    <div class="cc-seg">
      <button classList={{ on: explorerTab() === "explorer" }} onClick={() => setExplorerTab("explorer")}>
        {t("탐색기")}
      </button>
      <button
        classList={{ on: explorerTab() === "missions" }}
        disabled={!scopeWorkspace()}
        title={scopeWorkspace() ? undefined : t("워크스페이스를 먼저 여세요")}
        onClick={() => setExplorerTab("missions")}
      >
        {t("임무")}
      </button>
    </div>
  );
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
  // eqmux browser open (PRD I) — 에이전트가 보낸 열기 요청을 패널로 넘긴다
  onMount(() => startBrowserRequests());
  // 세션 포트 감시 (M31) — 패널을 닫아 둔 동안 열린 포트도 잡아 둔다. 패널이 켜질 때 주기가 빨라진다
  onMount(() => startPortWatch());

  // 화면 손상 진단 (임시 계측, backend/diag) — 배율·모니터 변화와 자식 웹뷰 좌표 어긋남을 남긴다.
  // 자동 보정은 하지 않는다: 원인을 확정하기 전에 가리면 원인을 못 찾는다
  onMount(() => startDiagnostics());

  // Ctrl+Alt+D — "지금 화면이 깨졌다" 표식. 계측은 항상 돌지만 사람이 이상을 본 순간이
  // 로그에 찍혀 있어야 그 앞뒤를 볼 수 있다. 눌린 것이 보이도록 잠깐 확인 문구를 띄운다
  const [diagMark, setDiagMark] = createSignal<string | undefined>(undefined);
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.altKey || e.key.toLowerCase() !== "d") return;
      e.preventDefault();
      setDiagMark("진단 기록 중…");
      void diagSnapshot("USER-MARK 화면 손상 신고").then(() => {
        setDiagMark("진단에 기록했습니다 — .eqmux/logs/diagnostics.log");
        setTimeout(() => setDiagMark(undefined), 2600);
      });
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

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
      {/* 진단 표식 확인 (Ctrl+Alt+D) — 임시 계측이 사는 동안만 있는 문구다 */}
      <Show when={diagMark()}>
        {(msg) => (
          <div
            class="mono"
            style={{
              position: "fixed",
              bottom: "12px",
              left: "12px",
              "z-index": 9999,
              padding: "6px 10px",
              "font-size": "11px",
              background: "var(--eq-surface)",
              border: "1px solid var(--eq-blue)",
              "border-radius": "var(--eq-r-sm)",
            }}
          >
            {msg()}
          </div>
        )}
      </Show>
      {/* 전체 화면 팝업 4종 — overlay 신호 하나라서 동시에 하나만 열린다 (M25 확장) */}
      <Show when={overlay() === "explorer"}>
        <ScreenOverlay title={t("임무 · 파일 탐색기")} icon="≡" guard={editorGuard} nav={explorerNav()}>
          {/* 임무는 워크스페이스 문맥이 있어야 성립한다 — 없으면(첫 실행 관제) 탐색기로 남는다 */}
          <Show when={explorerTab() === "missions" && scopeWorkspace()} fallback={<MissionExplorerTab />}>
            {(w) => <Missions wsId={w().id} />}
          </Show>
        </ScreenOverlay>
      </Show>
      <Show when={overlay() === "connect"}>
        <ScreenOverlay title={t("워크스페이스 연결")} icon="⌂">
          <WorkspaceConnection />
        </ScreenOverlay>
      </Show>
      <Show when={overlay() === "roles"}>
        <ScreenOverlay title={t("역할 라이브러리")} icon="◇">
          <RoleLibrary />
        </ScreenOverlay>
      </Show>
      <Show when={overlay() === "settings"}>
        <ScreenOverlay title={t("설정")} icon="⚙">
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
