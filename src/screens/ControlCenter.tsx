// 컨트롤 센터 (bi8Au) — 워크스페이스 탭의 기준 화면. 팀·세션 카드 / 터미널·저장·이벤트 / 인스펙터.
// 터미널 텍스트는 목 출력이다 — M1에서 xterm.js + Rust PTY로 실물이 된다.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import {
  defaultShell,
  openPanel,
  PANE_LAYOUTS,
  paneLayout,
  selectedSession,
  setDefaultShell,
  setLayoutPickerOpen,
  setSelectedSession,
  setTerminalFull,
  setView,
  SHELLS,
  terminalFull,
  tick,
} from "../state";
import { Eyebrow, PersonaDot, StatusLabel } from "../components/ui";
import { isTauri, killPty, storeUsageReal } from "../backend/pty";
import type { StoreUsageReal } from "../backend/pty";
import { disposeSessionTerminal, TerminalPane } from "../components/TerminalPane";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { TranscriptPane } from "./TranscriptPane";
import type { Session, Workspace } from "../types";

// 세션 상태별 목 터미널 출력 — 2×2 그리드 시각 검증용 (Tauri 밖 폴백 전용)
function mockLines(s: Session, personaName: string): string[] {
  if (!s.personaId) return ["PowerShell 7.6.4", `PS ${s.cwd}> _`]; // 기본 터미널 (역할 없음)
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

  // 저장 사용량 실측 (FR-C-52) — Tauri에서만. 브라우저 목업은 mock 수치 유지.
  const [realUsage, setRealUsage] = createSignal<StoreUsageReal | undefined>(undefined);
  onMount(() => {
    if (!isTauri()) return;
    const load = () => void storeUsageReal(props.workspace.id).then(setRealUsage);
    load();
    const t = setInterval(load, 10_000);
    onCleanup(() => clearInterval(t));
  });

  // ESC = 전체 화면 종료 (줌 상태가 있으면 줌부터 해제)
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && terminalFull()) {
        e.preventDefault();
        if (zoomed()) setZoomed(undefined);
        else setTerminalFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // 역할 없는 셸 세션(기본 터미널)은 페르소나·직무 대신 고정 라벨을 쓴다
  const personaName = (id: string) => persona(id)?.name ?? "기본 터미널";
  const jobName = (id: string) => job(id)?.name ?? "셸";

  // 슬롯 단위 세션 추가 — 기본 터미널 / 역할 세션 2택 (C). 캐스팅은 팀 전체 프리셋 도구로 남는다.
  const [addOpen, setAddOpen] = createSignal(false);
  const [addPersona, setAddPersona] = createSignal("");
  const [addJob, setAddJob] = createSignal("");
  const availablePersonas = () => {
    const used = new Set(sessions().map((x) => x.personaId));
    return backend.listPersonas().filter((p) => !used.has(p.id));
  };
  const openAdd = () => {
    setAddPersona(availablePersonas()[0]?.id ?? "");
    setAddJob(backend.listJobs()[0]?.id ?? "");
    setAddOpen(true);
  };
  const addTerminal = () => {
    backend.addTerminal(props.workspace.id, defaultShell().label);
    setAddOpen(false);
  };
  const [shellMenuOpen, setShellMenuOpen] = createSignal(false);
  const shellCmdFor = (s: Session) => SHELLS.find((x) => x.label === s.shell)?.cmd;
  const addRoleSession = () => {
    if (!addPersona() || !addJob()) return;
    backend.addRoleSession(props.workspace.id, addPersona(), addJob());
    setAddOpen(false);
  };
  const [removeTarget, setRemoveTarget] = createSignal<Session | undefined>(undefined);
  const doRemove = (s: Session) => {
    killPty(s.id);
    disposeSessionTerminal(s.id);
    if (zoomed() === s.id) setZoomed(undefined);
    backend.removeTerminal(s.id);
    setRemoveTarget(undefined);
  };
  // ✕ 분기 — 기본 터미널은 즉시 제거, 역할 팀 세션은 편성·임무 영향이 있어 확인을 거친다
  const removeTerminal = (s: Session) => {
    if (!s.personaId) doRemove(s);
    else setRemoveTarget(s);
  };

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
                SLOT {s.slot} · {personaName(s.personaId)}
              </span>
              <span style={{ display: "inline-flex", "align-items": "center", gap: "8px" }}>
                <StatusLabel session={s} />
                <span
                  class="pane-close"
                  classList={{ role: !!s.personaId }}
                  title={s.personaId ? "역할 세션 제거 — 확인 필요" : "터미널 제거"}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTerminal(s);
                  }}
                >
                  ✕
                </span>
              </span>
            </button>
            <TerminalPane
              sessionId={s.id}
              cwd={s.cwd}
              wsId={props.workspace.id}
              shell={shellCmdFor(s)}
              agent={
                s.personaId && job(s.jobId) && !s.restored
                  ? { name: persona(s.personaId)?.name ?? s.personaId, permissions: job(s.jobId)!.permissions }
                  : undefined
              }
              mockLines={mockLines(s, persona(s.personaId)?.name ?? "?")}
            />
          </div>
        )}
      </For>
      <For each={Array.from({ length: zoomed() ? 0 : Math.max(0, 4 - sessions().length) })}>
        {() => (
          <button class="terminal-pane pane-empty pane-add mono" title="빈 슬롯에 세션 추가" onClick={openAdd}>
            + 세션 추가
          </button>
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
                  <PersonaDot name={personaName(s.personaId)} color={persona(s.personaId)?.color ?? "blue"} />
                  <span style={{ "font-weight": 700 }}>{personaName(s.personaId)}</span>
                  <span class="badge">{jobName(s.jobId)}</span>
                  <Show when={s.slot === 1 && !!persona(s.personaId)}>
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
            <button class="card session-card empty" onClick={openAdd}>
              <span class="muted">+ 세션 추가 — 기본 터미널 또는 역할 세션</span>
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
            {/* 셸 선택 — 그리드(배치) 버튼 왼쪽. 새로 추가하는 터미널부터 적용된다. */}
            <div class="shell-picker">
              <button class="btn ghost mono" title="새 터미널 셸 선택" onClick={() => setShellMenuOpen(!shellMenuOpen())}>
                &gt;_ {defaultShell().name} ▾
              </button>
              <Show when={shellMenuOpen()}>
                <div class="card shell-menu">
                  <For each={SHELLS}>
                    {(sh) => (
                      <button
                        class="shell-menu-item"
                        classList={{ active: defaultShell().label === sh.label }}
                        onClick={() => {
                          setDefaultShell(sh);
                          setShellMenuOpen(false);
                        }}
                      >
                        <span style={{ "font-weight": 600 }}>{sh.name}</span>
                        <span class="mono muted" style={{ "font-size": "10px" }}>
                          {sh.cmd}
                        </span>
                      </button>
                    )}
                  </For>
                  <div class="muted shell-menu-note">새로 추가하는 터미널부터 적용됩니다</div>
                </div>
              </Show>
            </div>
            <Show when={zoomed()}>
              <button class="btn ghost" onClick={() => setZoomed(undefined)}>
                ▦ 그리드로 복귀
              </button>
            </Show>
            <Show when={!zoomed()}>
              <button class="btn ghost mono" title="페인 배치 (srpYm)" onClick={() => setLayoutPickerOpen(true)}>
                ▦ {PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name}
              </button>
            </Show>
            <button class="btn ghost" title="터미널 전체 화면 — ESC로 종료" onClick={() => setTerminalFull(true)}>
              ⛶ 전체 화면
            </button>
          </div>

          {/* 전체 화면 중에는 일반 그리드를 언마운트한다 — 같은 PTY에 두 인스턴스가
              서로 다른 크기로 resize 경합하면 ConPTY 리페인트가 폭증한다 */}
          <Show when={centerTab() === "terminal" && !terminalFull()}>
            {paneGrid()}
            {statusBar()}
          </Show>

          <Show when={centerTab() === "transcript" && selected()}>
            {(s) => <TranscriptPane session={s()} />}
          </Show>

          <div class="cc-strip">
            <div class="card strip-card">
              <Eyebrow>저장 상태 {realUsage() ? "(실측)" : "(목)"}</Eyebrow>
              <Show
                when={realUsage()}
                fallback={
                  <>
                    <div class="mono" style={{ "margin-top": "6px" }}>
                      WAL · {usage().walLatencyMs}ms
                    </div>
                    <div class="mono muted">
                      {usage().dbFile} · {usage().dbSizeMb} MB · {usage().dbPercent}%
                    </div>
                  </>
                }
              >
                {(u) => (
                  <>
                    <div class="mono" style={{ "margin-top": "6px" }}>
                      WAL · {(u().db_size_bytes / 1024).toFixed(0)} KB · {u().total_lines.toLocaleString()} lines
                    </div>
                    <div class="mono muted" style={{ "font-size": "10px" }}>
                      workspaces/{props.workspace.id}/session.db · 100ms 배치 · 30일/10만줄 보존
                    </div>
                  </>
                )}
              </Show>
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

      {/* 터미널 전체 화면 (포커스 모드) — 앱 바(Nav)는 유지, 그 아래만 덮는다 */}
      <Show when={terminalFull()}>
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
              <button class="btn" onClick={() => setTerminalFull(false)}>
                ✕ 전체 화면 종료
              </button>
            </div>
          </div>
          {paneGrid()}
          {statusBar()}
        </div>
      </Show>

      {/* 세션 추가 — 기본 터미널 / 역할 세션 2택. 역할 세션은 스폰 시점에 권한이 결정된다. */}
      <Show when={addOpen()}>
        <div class="overlay" onClick={() => setAddOpen(false)}>
          <div class="dialog" style={{ width: "460px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ "font-weight": 800, "font-size": "14px" }}>빈 슬롯에 세션 추가</div>
            <div class="muted" style={{ "font-size": "11px", margin: "4px 0 12px" }}>
              {props.workspace.name} · {sessions().length}/4 슬롯 사용 중
            </div>

            <button class="card add-choice" onClick={addTerminal}>
              <div>
                <div style={{ "font-weight": 700, "font-size": "12px" }}>&gt;_ 기본 터미널</div>
                <div class="muted" style={{ "font-size": "11px" }}>
                  역할 없이 즉시 시작 · 언제든 역할 부여 가능
                </div>
              </div>
              <span class="mono muted">→</span>
            </button>

            <div class="card add-choice role" onClick={(e) => e.stopPropagation()}>
              <div style={{ width: "100%" }}>
                <div style={{ "font-weight": 700, "font-size": "12px" }}>⛬ 역할 세션</div>
                <div class="muted" style={{ "font-size": "11px", "margin-bottom": "8px" }}>
                  페르소나·직무를 정해 시작 · 권한 플래그는 스폰 시점에 적용
                </div>
                <Show
                  when={availablePersonas().length > 0}
                  fallback={<div class="muted mono" style={{ "font-size": "11px" }}>남은 페르소나가 없습니다</div>}
                >
                  <div class="role-edit-row">
                    <select value={addPersona()} onChange={(e) => setAddPersona(e.currentTarget.value)}>
                      <For each={availablePersonas()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
                    </select>
                    <select value={addJob()} onChange={(e) => setAddJob(e.currentTarget.value)}>
                      <For each={backend.listJobs()}>{(j) => <option value={j.id}>{j.name}</option>}</For>
                    </select>
                    <button class="btn primary" onClick={addRoleSession}>
                      생성
                    </button>
                  </div>
                </Show>
              </div>
            </div>

            <div style={{ display: "flex", "justify-content": "flex-end", "margin-top": "12px" }}>
              <button class="btn" onClick={() => setAddOpen(false)}>
                취소
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 역할 세션 제거 확인 — 기본 터미널과 달리 편성 슬롯·임무 배정에 영향이 있다 */}
      <Show when={removeTarget()}>
        {(t) => (
          <div class="overlay" onClick={() => setRemoveTarget(undefined)}>
            <div class="dialog" style={{ width: "440px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ "font-weight": 800, "font-size": "14px" }}>역할 세션 제거</div>
              <div class="muted" style={{ "font-size": "12px", margin: "6px 0 10px" }}>
                {personaName(t().personaId)} · {jobName(t().jobId)} — SLOT {t().slot}
              </div>
              <div class="card inset" style={{ padding: "8px 10px", "font-size": "11px", "line-height": 1.6 }}>
                제거하면 팀 편성의 이 슬롯이 비워지고 임무 배정이 해제되며 PTY 프로세스가 종료됩니다.
                변경은 다음 캐스팅 저장 때 .eqmux/team.json에 반영됩니다.
              </div>
              <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
                <button class="btn" onClick={() => setRemoveTarget(undefined)}>
                  취소
                </button>
                <button class="btn danger" onClick={() => doRemove(t())}>
                  세션 제거
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
