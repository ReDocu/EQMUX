// 컨트롤 센터 (bi8Au) — 워크스페이스 탭의 기준 화면. 팀·세션 카드 / 터미널·저장·이벤트 / 인스펙터.
// 터미널 텍스트는 목 출력이다 — M1에서 xterm.js + Rust PTY로 실물이 된다.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import {
  openPanel,
  PANE_LAYOUTS,
  paneLayout,
  selectedSession,
  setLayoutPickerOpen,
  setSelectedSession,
  setView,
  tick,
} from "../state";
import { Eyebrow, PersonaDot, StatusLabel } from "../components/ui";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { TranscriptPane } from "./TranscriptPane";
import type { Session, Workspace } from "../types";

// 세션 상태별 목 터미널 출력 — 2×2 그리드 시각 검증용
function mockLines(s: Session, personaName: string): string[] {
  const base = [`PS ${s.cwd}> claude --resume`, `Claude Code ${s.agentVersion ?? "2.1.226"} · ${personaName}`];
  if (s.status === "waiting") return [...base, "⏸ 승인 대기 — " + (s.waitingFor ?? ""), "y/n 을 입력하세요"];
  if (s.status === "dead") return [...base, `프로세스 종료 · exit ${s.exitCode ?? "?"}`, s.resumable ? "재개 가능 — --resume" : "재개 불가"];
  if (s.status === "busy") return [...base, `⚙ ${s.lastOutput}`, `서브에이전트 ${s.subagents} · ${(s.scrollbackLines / 1000).toFixed(1)}K lines`];
  if (s.status === "shell") return [...base, `PS ${s.cwd}> _`];
  return [...base, `● ${s.lastOutput || "대기 중"}`];
}

export function ControlCenter(props: { workspace: Workspace }) {
  const sessions = () => {
    tick();
    return backend
      .listSessions()
      .filter((s) => s.workspaceId === props.workspace.id)
      .sort((a, b) => a.slot - b.slot);
  };
  const missions = () =>
    backend.listMissions().filter((m) => m.workspaceId === props.workspace.id);
  const usage = () => backend.storeUsage();
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);
  const selected = () => sessions().find((s) => s.id === selectedSession()) ?? sessions()[0];
  const unreadCount = () => {
    tick();
    return backend.listMessages().filter((m) => m.unread).length;
  };

  const [centerTab, setCenterTab] = createSignal<"terminal" | "transcript">("terminal");
  const [zoomed, setZoomed] = createSignal<string | undefined>(undefined); // B1 — 줌 토글
  const [full, setFull] = createSignal(false); // 터미널 전체 화면 (포커스 모드)

  // ESC = 전체 화면 종료 (줌 상태가 있으면 줌부터 해제)
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && full()) {
        e.preventDefault();
        if (zoomed()) setZoomed(undefined);
        else setFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const gridSessions = () => {
    const z = zoomed();
    if (z) {
      const s = sessions().find((x) => x.id === z);
      if (s) return [s];
    }
    return sessions();
  };

  // 터미널 그리드 + 상태 바 — 일반 배치와 전체 화면 오버레이 양쪽에서 사용
  const paneGrid = () => (
    <div class={`terminal-grid layout-${paneLayout()}`} classList={{ zoomed: !!zoomed() }}>
      <For each={gridSessions()}>
        {(s) => (
          <div
            class="terminal-pane"
            classList={{ "pane-waiting": s.status === "waiting", "pane-dead": s.status === "dead", "pane-selected": selected()?.id === s.id }}
            onClick={() => setSelectedSession(s.id)}
          >
            <button
              class="terminal-head mono"
              style={{ width: "100%", "text-align": "left", cursor: "zoom-in" }}
              title="클릭하면 줌 토글 (B1)"
              onClick={(e) => {
                e.stopPropagation();
                setZoomed(zoomed() === s.id ? undefined : s.id);
              }}
            >
              <span>
                SLOT {s.slot} · {persona(s.personaId)?.name}
              </span>
              <StatusLabel session={s} />
            </button>
            <div class="terminal-body mono pane-body">
              <For each={mockLines(s, persona(s.personaId)?.name ?? "?")}>{(l) => <div>{l}</div>}</For>
            </div>
          </div>
        )}
      </For>
      <For each={Array.from({ length: zoomed() ? 0 : Math.max(0, 4 - sessions().length) })}>
        {() => (
          <div class="terminal-pane pane-empty">
            <div class="terminal-body mono muted" style={{ display: "flex", "align-items": "center", "justify-content": "center" }}>
              빈 슬롯
            </div>
          </div>
        )}
      </For>
    </div>
  );

  const statusBar = () => (
    <div class="terminal-statusbar mono">
      <span>
        <span style={{ color: "var(--eq-green)" }}>◉</span> PTY{" "}
        {sessions().filter((x) => x.status !== "dead").length} ONLINE{"   "}▦{" "}
        {PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name.toUpperCase()}
        {"   "}OUTPUT {(sessions().reduce((a, x) => a + x.scrollbackLines, 0) / 1000).toFixed(1)}K LINES
      </span>
      <span class="muted">{selected()?.cwd ?? props.workspace.path}</span>
    </div>
  );

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{props.workspace.name}</h1>
          <div class="sub mono">
            {props.workspace.path} · {props.workspace.branch ?? "—"} · {sessions().length}/4 sessions
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn" onClick={() => setView({ kind: "missions", wsId: props.workspace.id })}>
            임무
          </button>
          <button class="btn" onClick={() => setView({ kind: "casting", wsId: props.workspace.id })}>
            캐스팅
          </button>
          <button class="btn" onClick={() => setView({ kind: "composition", wsId: props.workspace.id })}>
            팀 편성
          </button>
          <button class="btn" onClick={() => openPanel("conversation")}>
            대화
            <Show when={unreadCount() > 0}>
              <span class="unread-dot" />
            </Show>
          </button>
        </div>
      </div>

      <div class="screen-body cc-body">
        {/* 좌: 세션 카드 + 임무 */}
        <div class="cc-left">
          <Eyebrow>세션 · {sessions().length}/4</Eyebrow>
          <For each={sessions()}>
            {(s) => (
              <button
                class="card session-card"
                classList={{ selected: selected()?.id === s.id }}
                onClick={() => setSelectedSession(s.id)}
              >
                <div class="session-card-head">
                  <PersonaDot name={persona(s.personaId)?.name ?? "?"} color={persona(s.personaId)?.color ?? "blue"} />
                  <span style={{ "font-weight": 700 }}>{persona(s.personaId)?.name}</span>
                  <span class="badge">{job(s.jobId)?.name}</span>
                  <Show when={s.slot === 1}>
                    <span class="badge blue">LEAD</span>
                  </Show>
                </div>
                <StatusLabel session={s} />
                <div class="muted" style={{ "font-size": "11px" }}>
                  {s.lastOutput} · {(s.scrollbackLines / 1000).toFixed(1)}K lines
                </div>
              </button>
            )}
          </For>
          <Show when={sessions().length < 4}>
            <button class="card session-card empty" onClick={() => setView({ kind: "casting", wsId: props.workspace.id })}>
              <span class="muted">+ 캐스팅 — 빈 슬롯에 직무·페르소나 배정</span>
            </button>
          </Show>

          <div style={{ "margin-top": "14px" }}>
            <div class="conn-list-head">
              <Eyebrow>임무 / 프로젝트</Eyebrow>
              <button class="btn ghost" onClick={() => setView({ kind: "missions", wsId: props.workspace.id })}>
                관리 →
              </button>
            </div>
            <For each={missions()}>
              {(m) => (
                <div class="card mission-row">
                  <span style={{ "font-weight": 600 }}>{m.name}</span>
                  <span class="badge" classList={{ blue: m.status === "in-progress", purple: m.status === "in-review", green: m.status === "done" }}>
                    {m.status.toUpperCase()}
                  </span>
                  <div class="mono muted" style={{ "font-size": "10px", width: "100%" }}>
                    {m.file}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* 중: 터미널 2×2 그리드 / 트랜스크립트 + 저장 상태 + SessionService 이벤트 */}
        <div class="cc-center">
          <div style={{ display: "flex", gap: "6px", "margin-bottom": "8px" }}>
            <button class="btn" classList={{ primary: centerTab() === "terminal" }} onClick={() => setCenterTab("terminal")}>
              터미널
            </button>
            <button
              class="btn"
              classList={{ primary: centerTab() === "transcript" }}
              onClick={() => setCenterTab("transcript")}
              disabled={!selected()}
            >
              트랜스크립트
            </button>
            <Show when={zoomed()}>
              <button class="btn ghost" style={{ "margin-left": "auto" }} onClick={() => setZoomed(undefined)}>
                ▦ 그리드로 복귀
              </button>
            </Show>
            <Show when={!zoomed()}>
              <button
                class="btn ghost mono"
                style={{ "margin-left": "auto" }}
                title="페인 배치 (srpYm)"
                onClick={() => setLayoutPickerOpen(true)}
              >
                ▦ {PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name}
              </button>
            </Show>
            <button class="btn ghost" title="터미널 전체 화면 — ESC로 종료" onClick={() => setFull(true)}>
              ⛶ 전체 화면
            </button>
          </div>

          <Show when={centerTab() === "terminal"}>
            {paneGrid()}
            {statusBar()}
          </Show>

          <Show when={centerTab() === "transcript" && selected()}>
            {(s) => <TranscriptPane session={s()} />}
          </Show>

          <div class="cc-strip">
            <div class="card strip-card">
              <Eyebrow>저장 상태</Eyebrow>
              <div class="mono" style={{ "margin-top": "6px" }}>
                WAL · {usage().walLatencyMs}ms
              </div>
              <div class="mono muted">
                {usage().dbFile} · {usage().dbSizeMb} MB · {usage().dbPercent}%
              </div>
            </div>
            <div class="card strip-card">
              <Eyebrow>SessionService 이벤트</Eyebrow>
              <For each={backend.listEvents().slice(0, 4)}>
                {(e) => (
                  <div class="mono muted" style={{ "font-size": "11px" }}>
                    {e.time} {e.message}
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        {/* 우: 인스펙터 */}
        <div class="cc-right">
          <Show when={selected()} fallback={<div class="muted">세션을 선택하세요</div>}>
            {(s) => <SessionDetailPanel session={s()} />}
          </Show>
        </div>
      </div>

      {/* 터미널 전체 화면 (포커스 모드) — 카드·인스펙터·앱 바를 모두 덮는다 */}
      <Show when={full()}>
        <div class="terminal-fullscreen">
          <div class="tf-head">
            <span class="mono tf-title">
              ⛶ {props.workspace.name} <span class="muted">· {sessions().length}/4 SESSIONS · TERMINAL FOCUS</span>
            </span>
            <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
              <Show when={zoomed()}>
                <button class="btn ghost" onClick={() => setZoomed(undefined)}>
                  ▦ 그리드로 복귀
                </button>
              </Show>
              <Show when={!zoomed()}>
                <button class="btn ghost mono" title="페인 배치" onClick={() => setLayoutPickerOpen(true)}>
                  ▦ {PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name}
                </button>
              </Show>
              <span class="mono muted" style={{ "font-size": "10px" }}>
                ESC 종료
              </span>
              <button class="btn" onClick={() => setFull(false)}>
                ✕ 전체 화면 종료
              </button>
            </div>
          </div>
          {paneGrid()}
          {statusBar()}
        </div>
      </Show>
    </div>
  );
}
