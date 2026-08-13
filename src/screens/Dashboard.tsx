// 관제 고정 탭 — 다중 워크스페이스 대시보드 (result_prd §3.2 · sYRf5 배경 시안).
// 관측과 이동만 제공한다. 승인·거부·일괄 액션은 없다 (G7).
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { queryGlobalEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { jumpToSession, tick } from "../state";
import { StatusLabel } from "../components/ui";
import type { Session } from "../types";
import { ATTENTION_ORDER, fmtSince, sessionDisplayName } from "../types";

export function Dashboard() {
  const sessions = () => {
    tick();
    return backend.listSessions();
  };
  // 등록된 워크스페이스는 전부 행으로 나열한다 (FR-G-04) — 열린 것 먼저, 닫힌 것은 접힌 행 (FR-G-08)
  const workspaces = () => {
    tick();
    return backend
      .listWorkspaces()
      .slice()
      .sort((a, b) => Number(b.open) - Number(a.open));
  };
  const openCount = () => workspaces().filter((w) => w.open).length;
  const missions = () => {
    tick();
    return backend.listMissions();
  };

  // 이벤트 피드 실연결 (FR-G-40) — 원천은 event 테이블. 상태 방송에 붙어 갱신하며 폴링하지 않는다.
  const [realFeed, setRealFeed] = createSignal<FeedEvent[]>([]);
  onMount(() => {
    if (!isTauri()) return;
    const load = () => void queryGlobalEvents(60).then(setRealFeed);
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = backend.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    });
    onCleanup(() => {
      clearTimeout(timer);
      unsub();
    });
  });
  const events = () =>
    isTauri() ? realFeed() : backend.listEvents().map((e) => ({ ...e, sessionId: e.sessionId }));

  const count = (st: string) => sessions().filter((s) => s.status === st).length;
  const subagents = () => sessions().reduce((n, s) => n + s.subagents, 0);
  const waitingSession = () => sessions().find((s) => s.status === "waiting");
  const personaName = (s: Session) =>
    sessionDisplayName(s, backend.listPersonas().find((p) => p.id === s.personaId)?.name ?? (s.personaId || "기본 터미널"));
  const missionName = (s: Session) => missions().find((m) => m.id === s.missionId)?.name;
  // 피드 행의 발신자 — 이미 사라진 세션의 이벤트도 남으므로 안전 조회
  const eventName = (sessionId?: string) => {
    if (!sessionId) return "앱";
    const s = sessions().find((x) => x.id === sessionId);
    return s ? personaName(s) : sessionId.split("@")[0];
  };
  const unseenCount = () => sessions().filter((s) => s.unseen).length;

  // FR-G-07 — 주의 필요 순 정렬 (워크스페이스 행 안에서 셀 정렬)
  const wsSessions = (wsId: string) =>
    sessions()
      .filter((s) => s.workspaceId === wsId)
      .sort((a, b) => ATTENTION_ORDER[a.status] - ATTENTION_ORDER[b.status]);

  const cellLine2 = (s: Session) => {
    if (s.status === "waiting") return s.waitingFor ?? "승인 대기";
    if (s.status === "dead") return s.resumable ? "재개 가능" : "재개 불가";
    return missionName(s) ?? "미배정";
  };

  // D11 소프트 총량 경고 — 동시 busy 기준. 임계값은 실측 전 잠정 6. 막지 않는다 (FR-G-36)
  const BUSY_SOFT_LIMIT = 6;
  const busyCount = () => count("busy");

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>관제 대시보드</h1>
          <div class="sub">
            등록 {workspaces().length} · 열림 {openCount()} · {sessions().length} 세션 · 정렬: 주의 필요 순
          </div>
        </div>
        <span class="badge">폴링 없음 · 상태 스트림 구독 (FR-G-09)</span>
      </div>
      {/* 과부하 소프트 경고 (D11 · FR-G-36) — 상단 배너, 알림이 아니며 아무것도 막지 않는다 */}
      <Show when={busyCount() >= BUSY_SOFT_LIMIT}>
        <div class="card inset dash-overload mono">
          ⚠ 동시 작업 중 에이전트 {busyCount()}개 — 소프트 경고 (D11 · 임계값 {BUSY_SOFT_LIMIT}, 실측 전 잠정).
          시스템이 느려지면 일부 세션을 중지하세요.
        </div>
      </Show>
      <div class="screen-body dash-body">
        <div class="dash-main">
          {/* 요약 타일 4종 (FR-G-06) — waiting이 0이면 시각적으로 눌러 둔다 */}
          <div class="dash-tiles">
            <div class="card tile">
              <div class="eyebrow">총 세션</div>
              <div class="tile-v mono">{sessions().length}</div>
              <div class="muted">워크스페이스 {openCount()}개 열림</div>
            </div>
            <div class="card tile">
              <div class="eyebrow">BUSY</div>
              <div class="tile-v mono">{count("busy")}</div>
              <div class="muted">서브에이전트 {subagents()}</div>
            </div>
            <div class="card tile" classList={{ "tile-waiting": count("waiting") > 0 }}>
              <div class="eyebrow">WAITING</div>
              <div class="tile-v mono">{count("waiting")}</div>
              <div class="muted">사람의 응답 필요</div>
            </div>
            <div class="card tile" classList={{ "tile-dead": count("dead") > 0 }}>
              <div class="eyebrow">DEAD</div>
              <div class="tile-v mono">{count("dead")}</div>
              <div class="muted">재개 가능</div>
            </div>
          </div>

          {/* 워크스페이스 행 × 세션 셀 (FR-G-04·05) */}
          <For each={workspaces()}>
            {(ws) => (
              <div class="card ws-row">
                <div class="ws-row-head">
                  <span style={{ "font-weight": 700 }}>{ws.name}</span>
                  <span class="mono muted">
                    {ws.branch ?? "—"} · {ws.path}
                  </span>
                  <Show when={!ws.open}>
                    <span class="badge" style={{ "margin-left": "auto" }}>
                      닫힘
                    </span>
                  </Show>
                </div>
                {/* 닫힌 워크스페이스는 접힌 행 — 세션이 없으므로 상태 셀도 없다 (FR-G-08) */}
                <Show when={ws.open}>
                <div class="ws-cells">
                  <For each={wsSessions(ws.id)}>
                    {(s) => (
                      <button
                        class="cell"
                        classList={{
                          "cell-waiting": s.status === "waiting",
                          "cell-dead": s.status === "dead",
                        }}
                        onClick={() => jumpToSession(ws.id, s.id)}
                        title="클릭하면 해당 페인으로 점프 (FR-G-50)"
                      >
                        <div class="cell-name">
                          {personaName(s)}
                          <Show when={s.unseen}>
                            <span class="unread-dot" title="미확인 — 열람하면 해제 (FR-G-44)" />
                          </Show>
                        </div>
                        <StatusLabel session={s} />
                        <div class="cell-mission muted">{cellLine2(s)}</div>
                      </button>
                    )}
                  </For>
                  <For each={Array.from({ length: Math.max(0, 4 - wsSessions(ws.id).length) })}>
                    {() => (
                      <div class="cell cell-empty">
                        <div class="cell-name muted">—</div>
                        <span class="mono muted">빈 슬롯</span>
                        <div class="cell-mission muted">미배정</div>
                      </div>
                    )}
                  </For>
                </div>
                </Show>
              </div>
            )}
          </For>
          <Show when={workspaces().length === 0}>
            <div class="card" style={{ padding: "16px" }}>
              <div class="muted">등록된 워크스페이스가 없습니다 — 상단 + 또는 워크스페이스 연결에서 git 저장소를 등록하세요</div>
            </div>
          </Show>
        </div>

        {/* 주의 & 이벤트 (FR-G-40~42) */}
        <div class="dash-side">
          <div style={{ display: "flex", "align-items": "center", "margin-bottom": "8px", gap: "8px" }}>
            <div class="eyebrow" style={{ flex: 1 }}>
              주의 & 이벤트 · 전역
            </div>
            <Show when={unseenCount() > 0}>
              <button class="btn ghost" title="모든 세션의 미확인 해제 (FR-G-47)" onClick={() => backend.markAllSeen()}>
                모두 확인 ({unseenCount()})
              </button>
            </Show>
          </div>
          <Show when={waitingSession()}>
            {(w) => (
              <button
                class="card waiting-alert"
                onClick={() => jumpToSession(w().workspaceId, w().id)}
              >
                <div class="mono st-waiting" style={{ "font-weight": 700 }}>
                  ● WAITING · {fmtSince(w().sinceMs)}
                </div>
                <div style={{ "font-weight": 700, "margin-top": "4px" }}>
                  {personaName(w())} · 승인 대기
                </div>
                <div class="mono muted">{w().waitingFor}</div>
              </button>
            )}
          </Show>
          <div class="card" style={{ "margin-top": "10px", "max-height": "60vh", "overflow-y": "auto" }}>
            <For each={events()}>
              {(e) => (
                <div class="event-row">
                  <span class="mono muted">{e.time}</span>
                  <span style={{ "font-weight": 600 }}>{eventName(e.sessionId)}</span>
                  <span class="muted">{e.message}</span>
                </div>
              )}
            </For>
            <Show when={events().length === 0}>
              <div class="muted" style={{ "font-size": "11px", padding: "6px" }}>
                아직 이벤트가 없습니다
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
