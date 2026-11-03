// 관제 고정 탭 — 다중 워크스페이스 대시보드 (result_prd §3.2 · sYRf5 배경 시안).
// 관측과 이동이 중심이다. 0.6부터 승인함이 도구 승인 한 건씩 [허용]·[거부]를 받는다(§13-4) — 일괄 액션은 없다.
// UI 리파인 §03: 통계 타일 4개 → 제목 옆 요약 한 줄 · 빈 슬롯 병합 · 닫힌 워크스페이스 한 줄 강등 ·
// 세션 셀 우클릭 메뉴 (§06 — 셀에는 상태만 남고 액션은 메뉴로).
import { createMemo, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { queryGlobalEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { backend, MAX_OPEN_WORKSPACES, onEventLog } from "../backend/mock";
import { isTauri, killPty, revealPath } from "../backend/pty";
import { maxSlots, settings } from "../backend/settings";
import { t, tErr, tf } from "../i18n";
import { focusSession, jumpToSession, openPanel, setLastWorkspaceId, setOverlay, setView, tick, view } from "../state";
import { Chip, ContextMenu, Identity, notify, PaneNoText, StopConfirm } from "../components/ui";
import type { ChipTone } from "../components/ui";
import { approvalExpired, approvalRespond, canRespondInline, canStartFresh, resumeAgent, startFresh } from "../backend/agent";
import { attentionRank, fmtAgo, inboxWaiting, urgentSenders } from "../backend/attention";
import { awayCard, dismissAway } from "../backend/away";
import { overBudget, spendText } from "../backend/budget";
import { LIMIT_WARN, limitText, resetAt, worstLimit } from "../backend/usage";
import { ConflictCards } from "../components/EditConflicts";
import { sessionTermSize } from "../components/TerminalPane";
import type { PendingTool, Session } from "../types";
import { AGENT_CLI_LABEL, ATTENTION_ORDER, cliOf, detectedCli, effectiveTitle, fmtSince, nameBesideNo, paneNo, sessionDisplayName, sessionName, statusText } from "../types";
import { jobName as jobLabel } from "../labels";

/** 빈 슬롯 고스트의 열 span — 셀 그리드는 4열 고정이라 마지막 줄의 남은 칸만 채운다 */
/** 지표 타일 제목 — 영어 사전 값이 문장 중간용 소문자여도("resumable") 타일은 첫 글자를 대문자로 */
const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const ghostSpan = (len: number): number =>
  len % 4 === 0 ? Math.min(4, maxSlots() - len) : 4 - (len % 4);

/** 기다리는 이유 한 마디 — 도구 승인 · 질문 · 계획 승인. 상태 이름('응답 대기') 뒤에 붙는다 (U157). 모르면 빈 문자열 */
const pendingKindText = (p: PendingTool | undefined): string =>
  p?.kind === "question" ? "질문 — 페인에서 고릅니다" : p?.kind === "plan" ? "계획 승인 — 페인에서 고릅니다" : p ? "도구 승인" : "";

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

  // 이벤트 피드 실연결 — 원천은 event 테이블. 이벤트 로그가 바뀐 때만 다시 조회한다 (D5). 폴링 없음.
  const [realFeed, setRealFeed] = createSignal<FeedEvent[]>([]);
  onMount(() => {
    if (!isTauri()) return;
    const load = () => void queryGlobalEvents(60).then(setRealFeed);
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = onEventLog(() => {
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

  // 지표·기다리는 목록·모두 확인은 열린 워크스페이스만 센다 (B86) — 지표만 닫힌 것까지 세면
  // '행동 필요 2'인데 바로 옆 목록은 1건이었다. 닫힌 워크스페이스는 자기 카드 칩이 말한다
  // 메모 (CPU·RAM C5) — 지표·목록·배너가 tick마다 8번쯤 다시 걸렀다
  const openSessions = createMemo(() => {
    const open = new Set(openWs().map((w) => w.id));
    return sessions().filter((s) => open.has(s.workspaceId));
  });
  // 감지된 에이전트 라벨 — 엔진 라벨(Claude Code·Codex)로 통일, 모르는 CLI는 감지 이름 그대로 (U42)
  const agentLabel = (agent: string | undefined) => {
    const c = detectedCli(agent);
    return c ? AGENT_CLI_LABEL[c] : (agent ?? "");
  };
  const count = (st: string) => openSessions().filter((s) => s.status === st).length;
  const subagents = () => openSessions().reduce((n, s) => n + s.subagents, 0);
  // 재개 가능 — 관제의 재개 버튼·충돌 복구 목록과 같은 판정: 죽었거나 복원 대기인데 재개할 대화가 있다
  const canResume = (s: Session) => s.resumable && (s.status === "dead" || !!s.restored);
  const personaOf = (s: Session) => backend.listPersonas().find((p) => p.id === s.personaId);
  const pendingOf = inboxWaiting; // 손으로 띄운 세션의 쌓인 메시지만 (W4 attention.ts와 같은 판정)
  // 셀의 확인 단계 칩 (§주의 신호) — 행동 단계(waiting·dead)는 셀 테두리·상태가 이미 보인다
  const doneChip = (s: Session): { tone: ChipTone; text: string; title?: string } | undefined => {
    // 멈춘 세션 (0.6 A5) — busy 셀은 테두리로 드러나지 않아 칩이 먼저다
    if (s.status === "busy" && s.stalled)
      return { tone: "amber", text: t("멈춤? · 10분째 훅 없음"), title: t("훅이 10분째 없습니다 — 출력이 흐르는 긴 명령이면 그대로 두세요. 멈췄으면 터미널에서 Ctrl+C나 [중지]") };
    const n = pendingOf(s);
    if (n > 0) return { tone: "blue", text: tf("메시지 {n}건", { n }) };
    if (s.reportPending) return { tone: "blue", text: s.reportProgress ? t("✓ 보고함 · 완료 표시 없음") : t("✓ 턴 끝남 · 보고 전") };
    if (s.unseenDone === "report") return { tone: "blue", text: t("✓ 완료 보고"), title: s.doneText };
    if (s.unseenDone === "turn") return { tone: "blue", text: t("✓ 턴 끝남"), title: s.lastRecap };
    return undefined;
  };
  // 대시보드 재개 (P1) — 관제의 인라인 재개와 같은 경로. 실패는 토스트로
  const resume = async (s: Session) => {
    if (isTauri() && s.personaId) {
      const p = s.permOverride ?? backend.listJobs().find((j) => j.id === s.jobId)?.permissions;
      if (!p) return notify(t("직무 권한을 찾을 수 없습니다 — 역할을 다시 지정하세요"));
      const size = sessionTermSize(s.id);
      try {
        await resumeAgent(s.id, s.workspaceId, s.cwd, sessionName(s, personaOf(s)), p, size.cols, size.rows, cliOf(s));
      } catch (err) {
        return notify(`${t("재개 실패")} — ${tErr(err)}`);
      }
    }
    backend.resumeSession(s.id);
    jumpToSession(s.workspaceId, s.id);
  };
  const personaName = (s: Session) =>
    sessionDisplayName(s, backend.listPersonas().find((p) => p.id === s.personaId)?.name ?? (s.personaId || t("기본 터미널")));
  const jobName = (s: Session) => jobLabel(backend.listJobs().find((j) => j.id === s.jobId), t("셸"));
  const missionName = (s: Session) => missions().find((m) => m.id === s.missionId)?.name;
  // 피드 행의 발신자 — 이미 사라진 세션의 이벤트도 남으므로 안전 조회
  const eventName = (sessionId?: string) => {
    if (!sessionId) return t("앱");
    const s = sessions().find((x) => x.id === sessionId);
    return s ? personaName(s) : sessionId.split("@")[0];
  };
  const unseenCount = () => openSessions().filter((s) => s.unseen).length;

  // 워크스페이스 카드 칩 (시안) — 행동(waiting·dead) · 확인(메시지·보고 전·완료·턴) 수
  const wsAct = (wsId: string) => sessions().filter((s) => s.workspaceId === wsId && (s.status === "waiting" || s.status === "dead")).length;
  const wsCheck = (wsId: string) =>
    sessions().filter((s) => s.workspaceId === wsId && attentionRank(s, pendingOf(s)) >= 3).length;
  // 셀 칩 — 행동 단계도 칩으로 (승인 대기 · 종료됨), 없으면 확인 단계 칩
  const cellChip = (s: Session): { tone: ChipTone; text: string; title?: string } | undefined => {
    if (s.status === "waiting")
      return { tone: "amber", text: `${statusText("waiting")}${s.waitingFor ? ` · ${t(s.waitingFor)}` : ""} ${fmtSince(s.sinceMs)}` };
    if (s.status === "dead") return { tone: "red", text: `${t("종료됨")} · exit ${s.exitCode ?? "?"}` };
    return doneChip(s);
  };
  // 기다리는 에이전트 — 열린 모든 워크스페이스의 waiting과 dead, 기다린 순
  // [허용] · [거부] — 사람이 누를 때만. 실패(그사이 페인에서 답함 · 커맨드 없음)는 이유를 보이고 페인으로 데려간다
  const [answering, setAnswering] = createSignal<string | undefined>(undefined);
  const respond = async (s: Session, seen: PendingTool, allow: boolean) => {
    setAnswering(s.id);
    const r = await approvalRespond(s.id, seen, allow).finally(() => setAnswering(undefined));
    if (r.ok) return;
    // 이미 답했으면 목록에서 곧 빠진다(상태 이벤트) — 알리기만. 그 밖에는 페인으로 데려간다
    if (r.reason === "NOT_WAITING") return notify(t("이미 페인에서 답했습니다 — 아무것도 넣지 않았습니다"));
    notify(
      t(
        r.reason === "OTHER_TOOL"
          ? "지금은 다른 것을 기다립니다 — 페인에서 답하세요"
          : r.reason === "ERROR"
            ? "승인을 전하지 못했습니다 — 페인에서 답하세요"
            : "이 세션은 앱에서 답할 수 없습니다 — 페인에서 답하세요",
      ),
    );
    focusSession(s.workspaceId, s.id);
  };
  // 승인함 (0.6 §13-4) — waiting은 모든 워크스페이스에서(닫아 둔 팀도 기다린다), dead는 열린 것만. 기다린 순
  const waitingAll = () => sessions().filter((s) => s.status === "waiting");
  const waitRows = () => {
    return sessions()
      .filter((s) => s.status === "waiting" || (s.status === "dead" && openSessions().includes(s)))
      .sort((a, b) => (a.status === b.status ? b.sinceMs - a.sinceMs : a.status === "waiting" ? -1 : 1));
  };
  // 주의 필요 순 정렬 (FR-G-07 · 0.5 §주의 신호) — waiting > dead > 확인 신호(메시지·보고 전·완료·턴) >
  // 나머지는 상태 순. 같은 순위는 오래 기다린 순
  const urgent = createMemo(() => (tick(), urgentSenders(backend.listMessages()))); // 긴급 에스컬레이션 — 맨 위 (W3 §4)
  const sortKey = (s: Session) => {
    const r = attentionRank(s, pendingOf(s), urgent().has(s.id));
    return r > 0 ? r : 10 + ATTENTION_ORDER[s.status];
  };
  // 워크스페이스별 정렬 목록을 tick당 한 번만 만든다 (C5) — 카드 하나가 wsSessions를 4~5번 부르고,
  // 정렬 비교마다 attentionRank·인박스 판정이 돌았다
  const byWs = createMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of sessions()) {
      const list = m.get(s.workspaceId);
      if (list) list.push(s);
      else m.set(s.workspaceId, [s]);
    }
    const key = new Map(sessions().map((s) => [s, sortKey(s)] as const));
    for (const list of m.values()) list.sort((a, b) => key.get(a)! - key.get(b)! || b.sinceMs - a.sinceMs);
    return m;
  });
  const wsSessions = (wsId: string): Session[] => byWs().get(wsId) ?? [];

  const cellLine2 = (s: Session) => {
    if (s.status === "waiting") return s.waitingFor ? t(s.waitingFor) : statusText("waiting");
    if (s.status === "dead") return t(s.resumable ? "재개 가능" : "재개 불가");
    return missionName(s) ?? t("미배정");
  };

  // 세션 셀 우클릭 메뉴 (§06) — 점프·이동·중지. 승인·거부는 승인함 몫이다
  const [cellMenu, setCellMenu] = createSignal<{ x: number; y: number; s: Session } | undefined>(undefined);
  // 중지는 확인을 거친다 (BR-08)
  const [stopTarget, setStopTarget] = createSignal<Session | undefined>(undefined);
  const stopSession = (s: Session) => {
    if (isTauri()) killPty(s.id);
    backend.stopSession(s.id);
    setStopTarget(undefined);
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
          <h1>{t("관제 대시보드")}</h1>
          <div class="sub mono">
            {tf("열린 워크스페이스 {m} · 주의 정렬: {order}", {
              m: openWs().length,
              order: [statusText("waiting"), statusText("dead"), t("확인 필요"), statusText("busy"), statusText("idle")].join(" › "),
            })}
          </div>
        </div>
        {/* 워크스페이스 관리를 관제에서 바로 연다 — 앱 바 + 와 같은 팝업 */}
        {/* 화면 이름 '워크스페이스 연결 · 관리'와 같은 말을 쓴다 (0.6 QA P83) */}
        <button class="btn" title={t("워크스페이스 연결 · 관리")} onClick={() => setOverlay("connect")}>
          {t("워크스페이스 열기")}
        </button>
      </div>
      {/* 지표 타일 (시안 SgZhp Metric) — 색은 단계 색만: 행동 amber · 확인 blue · 실행 green */}
      <div class="dash-metrics" title={t("폴링 없음 · 상태 스트림 구독")}>
        {/* Index (C5) — 매번 새 객체 배열이라 For면 tick마다 타일 6개를 다시 만든다 */}
        <Index
          each={[
            { k: "열린 워크스페이스", v: openWs().length, c: "blue" },
            { k: "전체 세션", v: openSessions().length, c: "" },
            { k: "실행 중", v: openSessions().length - count("dead"), c: "green", tip: subagents() > 0 ? `${t("서브")} ${subagents()}` : undefined },
            // waiting은 승인함과 같은 집합(모든 워크스페이스)으로 센다 — 닫아 둔 팀도 기다린다 (B237)
            { k: "행동 필요", v: waitingAll().length + count("dead"), c: "amber" },
            { k: "확인 필요", v: openSessions().filter((s) => (attentionRank(s, pendingOf(s)) || 0) >= 3).length, c: "blue" },
            { k: "재개 가능", v: openSessions().filter(canResume).length, c: "purple" },
            // 오늘 비용 (0.6 §13-6) — 예산을 켜면 "$3.20 / $10", 넘으면 amber. 설정 › 알림에서 켠다
            // 한도 (0.6 F1) — 구독 요금제에는 금액보다 한도가 의미 있다. 두 표시를 한 칸에 둔다 (§13-6)
            {
              k: "오늘 비용",
              // 최소 너비(1100)에서 타일 안쪽이 ~120px — 금액은 작은 글자, 한도는 아래 줄로 (출시 전 점검)
              v: spendText(),
              sm: true,
              sub: worstLimit(openSessions()) ? limitText(worstLimit(openSessions())!) : undefined,
              c: overBudget() || (worstLimit(openSessions())?.usedPct ?? 0) >= LIMIT_WARN ? "amber" : "",
              tip: [
                t("모든 워크스페이스의 오늘 비용 합계 · 예산은 설정 › 알림"),
                worstLimit(openSessions())?.resetsAt ? tf("한도 재설정 {at}", { at: resetAt(worstLimit(openSessions())!)! }) : "",
              ]
                .filter(Boolean)
                .join(" · "),
            },
          ]}
        >
          {(m) => (
            <div class="card dash-metric" title={m().tip}>
              <div class="dash-metric-k">{capFirst(t(m().k))}</div>
              <div class={`dash-metric-v mono ${m().c}`} classList={{ sm: !!m().sm }}>
                {m().v}
              </div>
              <Show when={m().sub}>
                <div class="dash-metric-sub mono muted">{m().sub}</div>
              </Show>
            </div>
          )}
        </Index>
      </div>
      {/* 과부하 소프트 경고 (D11 · FR-G-36) — 상단 배너, 알림이 아니며 아무것도 막지 않는다 */}
      <Show when={busyCount() >= BUSY_SOFT_LIMIT}>
        <div class="card inset dash-overload mono">
          {tf("⚠ 동시 작업 중 에이전트 {n}개 — 소프트 경고 (임계값 {limit}, 실측 전 잠정). 시스템이 느려지면 일부 세션을 중지하세요.", { n: busyCount(), limit: BUSY_SOFT_LIMIT })}
        </div>
      </Show>
      {/* 세션 메모리 임계 배너 (FR-G-67, M30) — 설정 임계값 초과 세션 나열. 강제 종료·자동 개입 없음 */}
      <Show when={memOffenders().length > 0}>
        <div class="card inset dash-overload mono">
          ⚠ {t("세션 메모리 임계 초과")} —{" "}
          {memOffenders()
            .map((s) => `${personaName(s)} ${((s.memoryMb ?? 0) / 1024).toFixed(1)}GB`)
            .join(" · ")}{" "}
          ({t("임계")} {(memLimitMb() / 1024).toFixed(0)}GB · {t("소프트 경고")}). {t("세션 상세에서 현재·피크를 확인하세요.")}
        </div>
      </Show>
      {/* 자리 비운 사이 요약 (0.6 §13-5) — 창이 다시 포커스를 받았고 그사이 바뀐 것이 있을 때만. 접을 수 있다 */}
      <Show when={awayCard()}>
        {(c) => (
          <details class="card away-card" open>
            <summary>
              <span class="away-t">{tf("자리 비운 사이 · {ago}부터 · 세션 {n}개가 바뀌었습니다", { ago: fmtAgo(Date.now() - c().snap.since), n: c().rows.length })}</span>
              <button class="btn ghost away-x" aria-label={t("닫기")} onClick={(e) => (e.preventDefault(), dismissAway())}>
                ✕
              </button>
            </summary>
            <For each={c().rows}>
              {(r) => {
                const s = () => sessions().find((x) => x.id === r.session);
                return (
                  <div class="away-line">
                  <button class="away-row" onClick={() => jumpToSession(r.workspace, r.session)}>
                    <span class="mono away-nm">
                      {s() ? personaName(s()!) : r.session} · {workspaces().find((w) => w.id === r.workspace)?.name ?? ""}
                    </span>
                    <span class="mono muted away-facts">
                      {[
                        r.was ? `${statusText(r.was)} → ${statusText(r.status)}` : statusText(r.status),
                        r.msgsIn ? tf("받은 메시지 {n}", { n: r.msgsIn }) : "",
                        r.msgsOut ? tf("보낸 메시지 {n}", { n: r.msgsOut }) : "",
                        r.cost >= 0.01 ? `+$${r.cost.toFixed(2)}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <Show when={r.done}>
                      <span class="away-done">✓ {r.done}</span>
                    </Show>
                  </button>
                  {/* 완료 보고를 낸 세션이 맡은 임무가 있으면 검토 화면으로 (§13-3) */}
                  <Show when={r.done && s()?.missionId}>
                    {(mid) => (
                      <button
                        class="btn btn-sm away-review"
                        onClick={() => setView({ kind: "review", wsId: r.workspace, missionId: mid(), back: view() })}
                      >
                        {t("검토 →")}
                      </button>
                    )}
                  </Show>
                  </div>
                );
              }}
            </For>
          </details>
        )}
      </Show>
      <div class="screen-body dash-body">
        <div class="dash-main">
          {/* 워크스페이스 행 × 세션 셀 (FR-G-04·05) */}
          <For each={openWs()}>
            {(ws) => (
              <div class="dash-ws">
                <div class="ws-row-head">
                  <span class="ws-name" title={ws.name}>
                    {ws.name}
                  </span>
                  <span class="mono muted" title={ws.path}>
                    {ws.path} · {ws.branch ?? "—"} · {tf("{n} 세션", { n: wsSessions(ws.id).length })}
                  </span>
                  <span class="ws-row-chips">
                    <Show when={wsAct(ws.id) > 0}>
                      <Chip tone="amber" text={`${t("행동")} ${wsAct(ws.id)}`} />
                    </Show>
                    <Show when={wsCheck(ws.id) > 0}>
                      <Chip tone="blue" text={`${t("확인")} ${wsCheck(ws.id)}`} />
                    </Show>
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
                        title={t("클릭하면 해당 페인으로 점프 · 우클릭 메뉴")}
                      >
                        <div class="cell-name" title={jobName(s)}>
                          <Identity
                            slot={s.slot}
                            no={paneNo(s)}
                            name={sessionName(s, personaOf(s))}
                            persona={personaOf(s)?.name}
                            cli={s.personaId ? cliOf(s) : undefined}
                            compact
                          />
                          <Show when={s.unseen}>
                            <span class="unread-dot" title={t("미확인 — 열람하면 해제")} />
                          </Show>
                          <span class={`cell-state mono st-${s.status}`}>{statusText(s.status)}</span>
                        </div>
                        {/* 직함 한 줄 (0.5) — 이름 아래. 기본 터미널은 그렇다고 적는다 */}
                        <div class="cell-title muted">
                          {effectiveTitle(s, personaOf(s)) ?? (s.personaId ? jobName(s) : t("기본 터미널"))}
                        </div>
                        <div class="cell-status">
                          <Show
                            when={cellChip(s)}
                            fallback={<span class="cell-summary muted">{s.lastRecap ?? cellLine2(s)}</span>}
                          >
                            {(c) => <Chip tone={c().tone} text={c().text} title={c().title} />}
                          </Show>
                          {/* 감지된 에이전트 (셸 우선 모델) — Job 트리 실측. 없으면 표시하지 않는다.
                              역할 세션은 슬롯 엔진 아이콘이 이미 있으므로 같으면 숨기고, 다르면 어긋남을 경고 톤으로 (U42) */}
                          <Show when={s.agent && !(s.personaId && detectedCli(s.agent) === cliOf(s))}>
                            <span
                              class={`badge ${s.personaId ? "amber" : "blue"}`}
                              style={{ "margin-left": "auto" }}
                              title={
                                s.personaId
                                  ? t("슬롯 엔진과 다른 에이전트가 실행 중입니다 — 손으로 띄워 역할·훅이 붙지 않았을 수 있습니다")
                                  : t("터미널에서 실행 중인 에이전트 CLI")
                              }
                            >
                              {s.personaId
                                ? tf("슬롯 {slot} · 실행 중 {run}", {
                                    slot: AGENT_CLI_LABEL[cliOf(s)],
                                    run: agentLabel(s.agent),
                                  })
                                : agentLabel(s.agent)}
                            </span>
                          </Show>
                        </div>
                      </button>
                    )}
                  </For>
                  {/* 빈 슬롯 병합 (시안 §03) — 슬롯당 카드 대신 고스트 하나. 셀 그리드는 4열이라
                      고스트는 마지막 줄의 남은 칸만 채운다 (슬롯 상한 6·8이면 세션이 다음 줄로 감긴다) */}
                  <Show when={wsSessions(ws.id).length < maxSlots()}>
                    <button
                      class="cell-ghost mono"
                      style={{ "grid-column": `span ${ghostSpan(wsSessions(ws.id).length)}` }}
                      title={t("팀 캐스팅으로 이동")}
                      onClick={() => setView({ kind: "casting", wsId: ws.id })}
                    >
                      {tf("+ 빈 슬롯 {n} · 캐스팅", { n: maxSlots() - wsSessions(ws.id).length })}
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={openWs().length === 0}>
            <div class="card" style={{ padding: "16px" }}>
              <div class="muted">{t("열린 워크스페이스가 없습니다 — 탭 줄의 + 또는 [워크스페이스 열기]에서 git 저장소를 여세요")}</div>
            </div>
          </Show>
          {/* 닫힌 워크스페이스 — 한 줄 강등은 유지하되 항목을 카드로 (U4).
              이름·상태 배지·경로가 구조로 읽히고, 경로 소실은 열기 대신 재지정으로 보낸다 */}
          <Show when={closedWs().length > 0}>
            <div class="ws-closed">
              <span class="eyebrow">{t("닫힘")} · {closedWs().length}</span>
              <For each={closedWs()}>
                {(ws) => (
                  <div class="card ws-closed-card">
                    <span class="ws-closed-name" title={ws.name}>
                      {ws.name}
                    </span>
                    <span class="badge" classList={{ amber: ws.pathMissing }}>
                      {t(ws.pathMissing ? "경로 소실" : "닫힘")}
                    </span>
                    {/* 닫기 = 탭만 접기 — 세션은 백그라운드로 돈다 (U-9). 수와 가장 급한 상태를 카드에서 읽게 한다 */}
                    {(() => {
                      const list = () => sessions().filter((x) => x.workspaceId === ws.id);
                      const live = () => list().filter((x) => x.status !== "dead").length;
                      const waiting = () => list().filter((x) => x.status === "waiting").length;
                      const dead = () => list().filter((x) => x.status === "dead").length;
                      return (
                        <>
                          <Show when={live() > 0}>
                            <span class="badge mono">{tf("세션 {n} 실행 중", { n: live() })}</span>
                          </Show>
                          <Show when={waiting() > 0}>
                            <span class="badge amber mono">{statusText("waiting")} {waiting()}</span>
                          </Show>
                          <Show when={waiting() === 0 && dead() > 0}>
                            <span class="badge red mono">{statusText("dead")} {dead()}</span>
                          </Show>
                        </>
                      );
                    })()}
                    <span class="mono muted ws-closed-path" title={ws.path}>
                      {ws.path}
                    </span>
                    <Show
                      when={!ws.pathMissing}
                      fallback={
                        <button class="btn ghost" title={t("워크스페이스 연결에서 경로 재지정")} onClick={() => setOverlay("connect")}>
                          {t("재지정")} →
                        </button>
                      }
                    >
                      {/* 동시 오픈 상한에 닿으면 openWorkspace는 이벤트만 남기고 조용히 돌아간다 —
                          누르고 아무 일도 안 일어나는 대신, 못 여는 이유를 버튼이 갖고 있게 한다 */}
                      <button
                        class="btn ghost"
                        disabled={openWs().length >= MAX_OPEN_WORKSPACES}
                        title={
                          openWs().length >= MAX_OPEN_WORKSPACES
                            ? tf("동시에 열 수 있는 워크스페이스는 {n}개입니다 — 하나를 닫고 다시 시도하세요", { n: MAX_OPEN_WORKSPACES })
                            : undefined
                        }
                        onClick={() => backend.openWorkspace(ws.id)}
                      >
                        {t("열기")}
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* 주의 & 이벤트 (FR-G-40~42) */}
        <div class="dash-side" classList={{ urgent: waitRows().length > 0 }}>
          <div class="dash-side-head">
            {/* 승인함은 모든 워크스페이스의 waiting을 모은다 — 머리도 그렇게 말한다 (U122). 수는 waiting만, 종료됨은 회색 수 */}
            <div class="dash-side-t">{t("승인함 · 모든 워크스페이스")}</div>
            <span class="mono st-waiting dash-side-n" title={t("응답을 기다리는 세션")}>{waitingAll().length}</span>
            <Show when={waitRows().length > waitingAll().length}>
              <span class="mono muted dash-side-n" title={t("열린 워크스페이스의 종료된 세션")}>
                {statusText("dead")} {waitRows().length - waitingAll().length}
              </span>
            </Show>
            <Show when={unseenCount() > 0}>
              <button
                class="btn ghost"
                title={t("열린 워크스페이스 세션의 미확인 해제")}
                onClick={() => backend.markAllSeen(openWs().map((w) => w.id))}
              >
                {t("모두 확인")} ({unseenCount()})
              </button>
            </Show>
          </div>
          {/* 같은 파일 동시 편집 (0.6 §13-1) — 기다리는 행보다 위. 사람이 알리기·닫기를 고른다 */}
          <ConflictCards />
          {/* 행마다 기다리는 이유와 기다린 시간 · 누르면 페인으로 · 기다린 순 */}
          <For each={waitRows()}>
            {(w) => (
              // 행 = 이름 버튼(누르면 페인) + 승인 버튼들. 버튼 안에 버튼을 넣지 않는다 (U61)
              <div class="wait-row" classList={{ dead: w.status === "dead" }}>
                <button
                  class="wait-row-go"
                  title={t("Focus — 이 페인을 전체 화면으로 잡고 키보드를 넘깁니다")}
                  onClick={() => (w.status === "waiting" ? focusSession(w.workspaceId, w.id) : jumpToSession(w.workspaceId, w.id))}
                >
                  <div class="wait-row-top">
                    <span class="mono wait-row-nm">
                      <PaneNoText slot={w.slot} no={paneNo(w)} /> {nameBesideNo(paneNo(w), personaName(w))} · {workspaces().find((x) => x.id === w.workspaceId)?.name ?? ""}
                    </span>
                    <span class="mono muted wait-row-t">{fmtSince(w.sinceMs)}</span>
                  </div>
                  <div class="muted wait-row-why">
                    {w.status === "waiting"
                      ? [statusText("waiting"), w.pendingTool ? t(pendingKindText(w.pendingTool)) : w.waitingFor ? t(w.waitingFor) : ""].filter(Boolean).join(" · ")
                      : `${t("종료됨")} · exit ${w.exitCode ?? "?"}${w.resumable ? ` · ${t("재개 가능")}` : ""}`}
                  </div>
                  {/* 기다리는 도구와 원문 — 무엇을 허용하는지 보고 누른다 */}
                  <Show when={w.status === "waiting" && w.pendingTool}>
                    {(p) => (
                      <div class="mono wait-row-tool" title={p().input}>
                        {p().tool}: {p().input}
                      </div>
                    )}
                  </Show>
                </button>
                <Show when={w.status === "waiting"}>
                  <div class="wait-row-acts">
                    <Show when={approvalExpired(w)}>
                      <span class="muted wait-row-why">{t("앱이 기다리는 시간이 지났습니다 — 페인에서 답하세요")}</span>
                    </Show>
                    <Show when={canRespondInline(w) && w.pendingTool}>
                      {(p) => (
                        <>
                          <button class="btn" disabled={answering() === w.id} onClick={() => void respond(w, p(), true)}>
                            {t("허용")}
                          </button>
                          <button class="btn danger" disabled={answering() === w.id} onClick={() => void respond(w, p(), false)}>
                            {t("거부")}
                          </button>
                        </>
                      )}
                    </Show>
                    <button class="btn ghost" onClick={() => focusSession(w.workspaceId, w.id)}>
                      {t("페인으로 가기")}
                    </button>
                  </div>
                </Show>
              </div>
            )}
          </For>
          <div class="mono muted dash-feed-t">{t("이벤트")}</div>
          <div class="card dash-feed">
            <For each={events()}>
              {(e) => (
                <div class="event-row">
                  <span class="mono muted ev-time">{e.time}</span>
                  <span class="ev-name">{eventName(e.sessionId)}</span>
                  <span class="muted ev-msg" title={e.message}>{e.message}</span>
                </div>
              )}
            </For>
            <Show when={events().length === 0}>
              <div class="muted" style={{ "font-size": "11px", padding: "6px" }}>
                {t("아직 이벤트가 없습니다")}
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* 세션 셀 우클릭 메뉴 (§06) — 셀 상시 액션 대신. 도구 승인은 승인함, 질문 · 계획은 페인에서 (U158) */}
      <Show when={cellMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={`${personaName(m().s)} · ${jobName(m().s)} — ${statusText(m().s.status)}`}
            onClose={() => setCellMenu(undefined)}
            groups={[
              [
                { label: t("페인으로 점프"), kbd: "Enter", action: () => jumpToSession(m().s.workspaceId, m().s.id) },
                // 재개 (P1) — 죽었고 재개 가능할 때만 보인다
                ...(canResume(m().s) ? [{ label: t("재개"), action: () => void resume(m().s) }] : []),
                // 새로 시작 (요약 이월) — 이전 대화는 잇지 않는다
                ...(canStartFresh(m().s)
                  ? [
                      {
                        label: t("새로 시작 (요약만 넘김 · 이전 대화는 잇지 않음)"),
                        action: () => {
                          const s = m().s;
                          const size = sessionTermSize(s.id);
                          void startFresh(s, size.cols, size.rows).then((err) =>
                            err ? notify(tErr(err)) : jumpToSession(s.workspaceId, s.id),
                          );
                        },
                      },
                    ]
                  : []),
              ],
              [
                // 그 세션의 팀 대화로 연다 (B211) — 관제에는 워크스페이스 문맥이 없어 스코프가 마지막 워크스페이스였다.
                // 관제 화면에서 스코프는 lastWorkspaceId라 화면을 옮기지 않고 그것만 바꾼다
                {
                  label: t("대화 패널 열기"),
                  action: () => {
                    setLastWorkspaceId(m().s.workspaceId);
                    openPanel("conversation");
                  },
                },
                { label: t("임무 배정…"), action: () => setView({ kind: "missions", wsId: m().s.workspaceId }) },
                { label: t("팀 편성…"), action: () => setView({ kind: "composition", wsId: m().s.workspaceId }) },
              ],
              [{ label: t("도구 승인은 승인함에서 · 질문 · 계획은 페인에서"), note: true }],
              [
                {
                  label: t("작업 폴더 열기"),
                  action: () => {
                    const s = m().s;
                    const ws = workspaces().find((w) => w.id === s.workspaceId);
                    void revealPath(s.cwd || ws?.path || "").then((ok) => ok || notify(t("폴더를 열 수 없습니다")));
                  },
                },
              ],
              [{ label: t("중지…"), danger: true, disabled: m().s.status === "dead", action: () => setStopTarget(m().s) }],
            ]}
          />
        )}
      </Show>
      <Show when={stopTarget()}>
        {(st) => (
          <StopConfirm
            session={st()}
            name={personaName(st())}
            openHandoff={backend.openHandoff(st().id)}
            onConfirm={() => stopSession(st())}
            onCancel={() => setStopTarget(undefined)}
          />
        )}
      </Show>
    </div>
  );
}
