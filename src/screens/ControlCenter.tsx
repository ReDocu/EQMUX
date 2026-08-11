// 컨트롤 센터 (bi8Au) — 워크스페이스 탭의 기준 화면. 팀·세션 카드 / 터미널·저장·이벤트 / 인스펙터.
// 터미널 페인은 M1(xterm.js + PTY)에서 실물이 되고, M0에서는 자리와 계약만 잡는다.
import { For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { selectedSession, setSelectedSession, setView, tick } from "../state";
import { Eyebrow, PersonaDot, StatusLabel } from "../components/ui";
import { SessionDetailPanel } from "./SessionDetailPanel";
import type { Workspace } from "../types";

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
          <button class="btn" onClick={() => setView({ kind: "casting", wsId: props.workspace.id })}>
            캐스팅
          </button>
          <button class="btn" onClick={() => setView({ kind: "composition", wsId: props.workspace.id })}>
            팀 편성
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
            <Eyebrow>임무 / 프로젝트</Eyebrow>
            <For each={missions()}>
              {(m) => (
                <div class="card mission-row">
                  <span style={{ "font-weight": 600 }}>{m.name}</span>
                  <span class="badge" classList={{ blue: m.status === "in-progress", purple: m.status === "in-review" }}>
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

        {/* 중: 터미널 자리 + 저장 상태 + SessionService 이벤트 */}
        <div class="cc-center">
          <div class="card terminal-slot">
            <div class="terminal-head mono">
              <span>◉ PTY {sessions().filter((s) => s.status !== "dead").length} ONLINE</span>
              <span class="muted">▦ GRID · ROW FIRST</span>
            </div>
            <div class="terminal-body mono">
              <div class="muted">— M1: xterm.js(WebGL) 가시 페인 렌더 + Rust PTY 브리지 —</div>
              <For each={sessions()}>
                {(s) => (
                  <div>
                    <span class="st-busy">{persona(s.personaId)?.name}</span>{" "}
                    <span class="muted">PS {s.cwd}&gt;</span> <span>{s.lastOutput}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
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
    </div>
  );
}
