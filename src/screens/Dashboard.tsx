// 관제 고정 탭 — 다중 워크스페이스 대시보드 (result_prd §3.2 · sYRf5 배경 시안).
// 관측과 이동만 제공한다. 승인·거부·일괄 액션은 없다 (G7).
// UI 리파인 §03: 통계 타일 4개 → 제목 옆 요약 한 줄 · 빈 슬롯 병합 · 닫힌 워크스페이스 한 줄 강등 ·
// 세션 셀 우클릭 메뉴 (§06 — 셀에는 상태만 남고 액션은 메뉴로).
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { queryGlobalEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { backend } from "../backend/mock";
import { isTauri, killPty } from "../backend/pty";
import { settings } from "../backend/settings";
import { jumpToSession, openPanel, setView, tick } from "../state";
import { ContextMenu, StatusLabel } from "../components/ui";
import type { Session } from "../types";
import { ATTENTION_ORDER, fmtSince, sessionDisplayName } from "../types";

export function Dashboard() {
  const sessions = () => {
    tick();
    return backend.listSessions();
  };
  // 등록된 워크스페이스는 전부 나열한다 (FR-G-04) — 열린 것은 행으로, 닫힌 것은 하단 한 줄 (FR-G-08)
  const workspaces = () => {
    tick();
    return backend.listWorkspaces();
  };
  const openWs = () => workspaces().filter((w) => w.open);
  const closedWs = () => workspaces().filter((w) => !w.open);
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
  const jobName = (s: Session) => backend.listJobs().find((j) => j.id === s.jobId)?.name ?? "셸";
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

  // 세션 셀 우클릭 메뉴 (§06) — G7 준수: 승인·거부 없음, 점프·이동·중지만
  const [cellMenu, setCellMenu] = createSignal<{ x: number; y: number; s: Session } | undefined>(undefined);
  const stopSession = (s: Session) => {
    if (isTauri()) killPty(s.id);
    backend.stopSession(s.id);
  };

  // D11 소프트 총량 경고 — 동시 busy 기준. 임계값은 실측 전 잠정 6. 막지 않는다 (FR-G-36)
  const BUSY_SOFT_LIMIT = 6;
  const busyCount = () => count("busy");

  // FR-G-67 (M30) — 세션 메모리 임계 배너. 설정 임계값(기본 꺼짐), FR-G-36과 같은 채널.
  // 계측은 C11(Job Object 10초 샘플링)이 이미 한다 — 여기는 표시만, 강제 개입 없음.
  const memLimitMb = () => settings().memBannerMb;
  // dead는 제외 — 프로세스가 없는데 마지막 샘플 값이 남아 있을 수 있다 (applyMemory는 최신값 유지)
  const memOffenders = () =>
    memLimitMb() > 0
      ? sessions().filter((s) => s.status !== "dead" && (s.memoryMb ?? 0) >= memLimitMb())
      : [];

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>관제 대시보드</h1>
          <div class="sub">
            등록 {workspaces().length} · 열림 {openWs().length} · 정렬: 주의 필요 순
          </div>
        </div>
        {/* 요약 한 줄 (시안 §03 — 타일 4개의 후신). 색은 waiting·dead에만 (FR-G-06) */}
        <div class="dash-sum mono" title="폴링 없음 · 상태 스트림 구독 (FR-G-09)">
          <span>
            세션 <b>{sessions().length}</b>
          </span>
          <span>
            <span class="sdot busy" /> busy <b>{count("busy")}</b>
            <Show when={subagents() > 0}> · 서브 {subagents()}</Show>
          </span>
          <span classList={{ "st-waiting": count("waiting") > 0 }}>
            <span class="sdot waiting" /> waiting <b>{count("waiting")}</b>
          </span>
          <span classList={{ "st-dead": count("dead") > 0 }}>
            <span class="sdot dead" /> dead <b>{count("dead")}</b>
          </span>
        </div>
      </div>
      {/* 과부하 소프트 경고 (D11 · FR-G-36) — 상단 배너, 알림이 아니며 아무것도 막지 않는다 */}
      <Show when={busyCount() >= BUSY_SOFT_LIMIT}>
        <div class="card inset dash-overload mono">
          ⚠ 동시 작업 중 에이전트 {busyCount()}개 — 소프트 경고 (D11 · 임계값 {BUSY_SOFT_LIMIT}, 실측 전 잠정).
          시스템이 느려지면 일부 세션을 중지하세요.
        </div>
      </Show>
      {/* 세션 메모리 임계 배너 (FR-G-67, M30) — 설정 임계값 초과 세션 나열. 강제 종료·자동 개입 없음 */}
      <Show when={memOffenders().length > 0}>
        <div class="card inset dash-overload mono">
          ⚠ 세션 메모리 임계 초과 —{" "}
          {memOffenders()
            .map((s) => `${personaName(s)} ${((s.memoryMb ?? 0) / 1024).toFixed(1)}GB`)
            .join(" · ")}{" "}
          (임계 {(memLimitMb() / 1024).toFixed(0)}GB · 소프트 경고). 세션 상세에서 현재·피크를 확인하세요.
        </div>
      </Show>
      <div class="screen-body dash-body">
        <div class="dash-main">
          {/* 워크스페이스 행 × 세션 셀 (FR-G-04·05) */}
          <For each={openWs()}>
            {(ws) => (
              <div class="ws-row">
                <div class="ws-row-head">
                  <span class="ws-name">{ws.name}</span>
                  <span class="mono muted">
                    {ws.branch ?? "—"} · {ws.path}
                  </span>
                  <span class="mono muted" style={{ "margin-left": "auto" }}>
                    {wsSessions(ws.id).length}/4
                  </span>
                </div>
                <div class="ws-cells">
                  <For each={wsSessions(ws.id)}>
                    {(s) => (
                      <button
                        class="card cell"
                        classList={{
                          "cell-waiting": s.status === "waiting",
                          "cell-dead": s.status === "dead",
                        }}
                        onClick={() => jumpToSession(ws.id, s.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setCellMenu({ x: e.clientX, y: e.clientY, s });
                        }}
                        title="클릭하면 해당 페인으로 점프 (FR-G-50) · 우클릭 메뉴"
                      >
                        <div class="cell-name">
                          {personaName(s)}
                          <span class="cell-role muted">{jobName(s)}</span>
                          <Show when={s.unseen}>
                            <span class="unread-dot" title="미확인 — 열람하면 해제 (FR-G-44)" />
                          </Show>
                        </div>
                        <div class="cell-status">
                          <span class={`sdot ${s.status}`} />
                          <StatusLabel session={s} />
                        </div>
                        <div class="cell-mission muted">{cellLine2(s)}</div>
                      </button>
                    )}
                  </For>
                  {/* 빈 슬롯 병합 (시안 §03) — 슬롯당 카드 대신 고스트 하나 */}
                  <Show when={wsSessions(ws.id).length < 4}>
                    <button
                      class="cell-ghost mono"
                      style={{ "grid-column": `span ${4 - wsSessions(ws.id).length}` }}
                      title="팀 캐스팅으로 이동"
                      onClick={() => setView({ kind: "casting", wsId: ws.id })}
                    >
                      + 빈 슬롯 {4 - wsSessions(ws.id).length} · 캐스팅
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={openWs().length === 0}>
            <div class="card" style={{ padding: "16px" }}>
              <div class="muted">열린 워크스페이스가 없습니다 — 상단 + 또는 워크스페이스 연결에서 git 저장소를 열어주세요</div>
            </div>
          </Show>
          {/* 닫힌 워크스페이스 — 한 줄 강등은 유지하되 항목을 카드로 (U4).
              이름·상태 배지·경로가 구조로 읽히고, 경로 소실은 열기 대신 재지정으로 보낸다 */}
          <Show when={closedWs().length > 0}>
            <div class="ws-closed">
              <span class="eyebrow">닫힘 · {closedWs().length}</span>
              <For each={closedWs()}>
                {(ws) => (
                  <div class="card ws-closed-card">
                    <span class="ws-closed-name">{ws.name}</span>
                    <span class="badge" classList={{ amber: ws.pathMissing }}>
                      {ws.pathMissing ? "경로 소실" : "닫힘"}
                    </span>
                    <span class="mono muted ws-closed-path" title={ws.path}>
                      {ws.path}
                    </span>
                    <Show
                      when={!ws.pathMissing}
                      fallback={
                        <button class="btn ghost" title="워크스페이스 연결에서 경로 재지정" onClick={() => setView({ kind: "connect" })}>
                          재지정 →
                        </button>
                      }
                    >
                      <button class="btn ghost" onClick={() => backend.openWorkspace(ws.id)}>
                        열기
                      </button>
                    </Show>
                  </div>
                )}
              </For>
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
                  <span class="mono muted ev-time">{e.time}</span>
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

      {/* 세션 셀 우클릭 메뉴 (§06) — 셀 상시 액션 대신. 승인·거부는 터미널 페인에서 (G7) */}
      <Show when={cellMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={`${personaName(m().s)} · ${jobName(m().s)} — ${m().s.status}`}
            onClose={() => setCellMenu(undefined)}
            groups={[
              [{ label: "페인으로 이동", action: () => jumpToSession(m().s.workspaceId, m().s.id) }],
              [
                { label: "대화 패널 열기", action: () => openPanel("conversation") },
                { label: "임무 배정…", action: () => setView({ kind: "missions", wsId: m().s.workspaceId }) },
                { label: "팀 편성…", action: () => setView({ kind: "composition", wsId: m().s.workspaceId }) },
              ],
              [{ label: "승인·거부는 터미널 페인에서 (G7)", note: true }],
              [{ label: "중지", danger: true, disabled: m().s.status === "dead", action: () => stopSession(m().s) }],
            ]}
          />
        )}
      </Show>
    </div>
  );
}
