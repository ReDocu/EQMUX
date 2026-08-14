// 컨트롤 센터 (bi8Au) — 워크스페이스 탭의 기준 화면. 팀·세션 카드 / 터미널·저장·이벤트 / 인스펙터.
// 터미널 텍스트는 목 출력이다 — M1에서 xterm.js + Rust PTY로 실물이 된다.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import {
  defaultShell,
  PANE_LAYOUTS,
  paneLayout,
  panelOpen,
  selectedSession,
  setDefaultShell,
  setLayoutPickerOpen,
  setPaneLayout,
  setSelectedSession,
  setTerminalFull,
  setView,
  SHELLS,
  terminalFull,
  tick,
} from "../state";
import { ContextMenu, Eyebrow, PersonaDot, StatusLabel } from "../components/ui";
import { resumeAgent } from "../backend/agent";
import { queryEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { autoAssignDefault, refreshMissions } from "../backend/missions";
import { isTauri, killPty, storeUsageReal } from "../backend/pty";
import type { StoreUsageReal } from "../backend/pty";
import { removeRoleFile } from "../backend/roles";
import { ensureWorktree } from "../backend/team";
import { gridTemplateStyle, PaneDividers } from "../components/PaneDividers";
import { SidePanel } from "../components/SidePanel";
import { disposeSessionTerminal, sessionTermSize, TerminalPane } from "../components/TerminalPane";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { TranscriptPane } from "./TranscriptPane";
import type { Session, Workspace } from "../types";
import { sessionDisplayName } from "../types";

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
  const missions = () => {
    tick();
    return backend.listMissions().filter((m) => m.workspaceId === props.workspace.id);
  };
  const usage = () => backend.storeUsage(props.workspace.name);
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);
  const selected = () => sessions().find((s) => s.id === selectedSession()) ?? sessions()[0];

  const [centerTab, setCenterTab] = createSignal<"terminal" | "transcript">("terminal");
  const [zoomed, setZoomed] = createSignal<string | undefined>(undefined); // B1 — 줌 토글
  // 세션 상세 팝업 — 우측 고정 인스펙터의 후신. 아바타 레일·페인 메뉴 "세션 상세"가 연다
  const [detailOpen, setDetailOpen] = createSignal(false);
  // 팀 도구 메뉴 (시안 §04) — 임무·캐스팅·팀 편성 버튼 3개의 후신
  const [teamMenu, setTeamMenu] = createSignal<{ x: number; y: number } | undefined>(undefined);
  // 상태바 이벤트 팝오버 (시안 §04) — 저장 상태·SessionService 카드 2장의 후신
  const [evOpen, setEvOpen] = createSignal(false);

  // 저장 사용량 실측 (FR-C-52) — Tauri에서만. 브라우저 목업은 mock 수치 유지.
  const [realUsage, setRealUsage] = createSignal<StoreUsageReal | undefined>(undefined);
  onMount(() => {
    if (!isTauri()) return;
    void refreshMissions(props.workspace.id); // 임무 파일 실측 — 밖에서 편집됐어도 여기서 따라잡는다
    const load = () => void storeUsageReal(props.workspace.id).then(setRealUsage);
    load();
    const t = setInterval(load, 10_000);
    onCleanup(() => clearInterval(t));
  });

  // 워크스페이스 스코프 이벤트 (FR-G-41) — 스트립의 SessionService 칸을 실데이터로
  const [wsFeed, setWsFeed] = createSignal<FeedEvent[]>([]);
  onMount(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void queryEvents(props.workspace.id, { limit: 4 }).then(setWsFeed);
    load();
    const unsub = backend.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    });
    onCleanup(() => {
      clearTimeout(timer);
      unsub();
    });
  });
  const stripEvents = () =>
    isTauri()
      ? wsFeed().map((e) => ({ time: e.time, message: e.message }))
      : backend.listEvents().slice(0, 4).map((e) => ({ time: e.time, message: e.message }));

  // ESC = 상세 드로어 → 줌 → 전체 화면 순으로 한 겹씩 닫는다
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailOpen()) {
        e.preventDefault();
        setDetailOpen(false);
        return;
      }
      if (terminalFull()) {
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
  const [addWorktree, setAddWorktree] = createSignal(false); // 격리 옵트인 (FR-E-62 · E1′)
  const [addErr, setAddErr] = createSignal<string | undefined>(undefined);
  const availablePersonas = () => {
    const used = new Set(sessions().map((x) => x.personaId));
    return backend.listPersonas().filter((p) => !used.has(p.id));
  };
  const openAdd = () => {
    setAddPersona(availablePersonas()[0]?.id ?? "");
    setAddJob(backend.listJobs()[0]?.id ?? "");
    setAddWorktree(false);
    setAddErr(undefined);
    setAddOpen(true);
  };
  const addTerminal = () => {
    backend.addTerminal(props.workspace.id, defaultShell().label);
    setAddOpen(false);
  };
  const [shellMenuOpen, setShellMenuOpen] = createSignal(false);
  const shellCmdFor = (s: Session) => SHELLS.find((x) => x.label === s.shell)?.cmd;
  const addRoleSession = async () => {
    if (!addPersona() || !addJob()) return;
    setAddErr(undefined);
    let opts: { cwd: string; worktree: boolean } | undefined;
    // 워크트리 격리 (FR-E-62) — 기본은 repo 공유 (FR-E-60). 실패는 정직하게 표시하고 만들지 않는다
    if (addWorktree() && isTauri()) {
      try {
        const cwd = await ensureWorktree(props.workspace.path, `${addPersona()}@${props.workspace.id}`);
        opts = { cwd, worktree: true };
      } catch (err) {
        setAddErr(String(err));
        return;
      }
    }
    backend.addRoleSession(props.workspace.id, addPersona(), addJob(), opts);
    // 기본 임무 자동 배정 (FR-E-56) — 임무 없는 새 역할 세션에만
    void autoAssignDefault(props.workspace.id, `${addPersona()}@${props.workspace.id}`);
    setAddOpen(false);
  };
  const [removeTarget, setRemoveTarget] = createSignal<Session | undefined>(undefined);
  // 세션 우클릭 메뉴 (U8) — 레일 행·페인 헤더 공용. 재개·중지·상세·점프를 상세 모달 없이 꺼낸다
  const [sessMenu, setSessMenu] = createSignal<{ x: number; y: number; s: Session } | undefined>(undefined);

  // 인라인 재개 (U8) — 상세 모달의 doResume과 같은 경로 (FR-D-21~23)
  const resumeInline = async (s: Session) => {
    if (isTauri() && s.personaId) {
      const p = s.permOverride ?? job(s.jobId)?.permissions;
      if (!p) return;
      const size = sessionTermSize(s.id);
      try {
        await resumeAgent(s.id, s.workspaceId, s.cwd, persona(s.personaId)?.name ?? s.personaId, p, size.cols, size.rows);
      } catch {
        return; // 실패는 페인의 restore 카드·이벤트 피드가 보여준다
      }
    }
    backend.resumeSession(s.id);
  };

  const openSessMenu = (e: MouseEvent, s: Session) => {
    e.preventDefault();
    e.stopPropagation();
    setSessMenu({ x: e.clientX, y: e.clientY, s });
  };
  const sessMenuGroups = (s: Session) => [
    [
      {
        label: "페인으로 점프",
        action: () => {
          setSelectedSession(s.id);
          backend.markSeen(s.id);
          setCenterTab("terminal");
        },
      },
      {
        label: "세션 상세",
        action: () => {
          setSelectedSession(s.id);
          setDetailOpen(true);
        },
      },
      {
        label: "트랜스크립트 열기",
        action: () => {
          setSelectedSession(s.id);
          setCenterTab("transcript");
        },
      },
    ],
    [
      {
        label: "재개",
        disabled: !s.resumable || (s.status !== "dead" && !s.restored),
        action: () => void resumeInline(s),
      },
      {
        label: "중지",
        disabled: s.status === "dead",
        action: () => {
          if (isTauri()) killPty(s.id);
          backend.stopSession(s.id);
        },
      },
    ],
    [{ label: s.personaId ? "역할 세션 제거…" : "터미널 제거", danger: true, action: () => removeTerminal(s) }],
  ];
  const doRemove = (s: Session) => {
    killPty(s.id);
    disposeSessionTerminal(s.id);
    if (zoomed() === s.id) setZoomed(undefined);
    // 역할 파일은 세션 cwd 규약 (FR-E-63) — 워크트리 세션은 자기 사본에서 지운다.
    // 워크트리 자체는 남긴다 (FR-E-64 — 커밋 안 된 작업이 있을 수 있다)
    if (s.personaId && !props.workspace.pathMissing) removeRoleFile(s.cwd || props.workspace.path, s.id);
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

  // 터미널 그리드 + 상태 바 — 일반 배치와 전체 화면 오버레이 양쪽에서 사용.
  // 트랙 비율은 인라인 fr 템플릿(M30 분할선 드래그) — 줌은 .zoomed !important가 이긴다.
  const paneGrid = () => (
    <div
      class={`terminal-grid layout-${paneLayout()}`}
      classList={{ zoomed: !!zoomed() }}
      style={zoomed() ? undefined : gridTemplateStyle(paneLayout())}
    >
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
              title="클릭하면 줌 토글 (B1) · 우클릭 세션 메뉴"
              onClick={(e) => {
                e.stopPropagation();
                setZoomed(zoomed() === s.id ? undefined : s.id);
              }}
              onContextMenu={(e) => openSessMenu(e, s)}
            >
              {/* 시안 §04·§06 — SLOT 라벨·✕ 제거, 헤더는 이름·상태만. 제거는 페인 우클릭 메뉴 */}
              <span>{sessionDisplayName(s, personaName(s.personaId))}</span>
              <span style={{ display: "inline-flex", "align-items": "center", gap: "8px" }}>
                {/* 승인 대기 문맥 (U5) — 도착 즉시 어떤 도구 요청인지 헤더에서 보인다 */}
                <Show when={s.status === "waiting" && s.waitingFor}>
                  <span class="badge amber pane-wait-badge" title="승인 대기 중인 도구 요청 — y/n은 이 페인에 입력">
                    {s.waitingFor}
                  </span>
                </Show>
                <StatusLabel session={s} />
              </span>
            </button>
            <TerminalPane
              sessionId={s.id}
              cwd={s.cwd}
              wsId={props.workspace.id}
              shell={shellCmdFor(s)}
              agent={
                s.personaId && job(s.jobId)
                  ? {
                      name: persona(s.personaId)?.name ?? s.personaId,
                      // 유효 권한 (FR-E-34) — 슬롯 오버라이드가 있으면 그것으로 스폰한다
                      permissions: s.permOverride ?? job(s.jobId)!.permissions,
                    }
                  : undefined
              }
              restore={s.restored ? { resumable: s.resumable, reason: s.resumeReason } : undefined}
              revive={s.revived}
              mockLines={mockLines(s, persona(s.personaId)?.name ?? "?")}
              extraMenu={() => [
                // 보기 — 배치·줌·전체 화면 (페인 헤더에서 버튼을 내려놓는 자리, 시안 §06)
                [
                  {
                    label: "배치",
                    sub: PANE_LAYOUTS.map((l) => ({
                      label: l.name,
                      checked: paneLayout() === l.key,
                      action: () => setPaneLayout(l.key),
                    })),
                  },
                  { label: zoomed() === s.id ? "줌 해제" : "줌", action: () => setZoomed(zoomed() === s.id ? undefined : s.id) },
                  { label: "전체 화면", kbd: "ESC 종료", action: () => setTerminalFull(true) },
                ],
                // 이동 — 상세 팝업·트랜스크립트
                [
                  {
                    label: "세션 상세",
                    action: () => {
                      setSelectedSession(s.id);
                      setDetailOpen(true);
                    },
                  },
                  {
                    label: "트랜스크립트 열기",
                    action: () => {
                      setSelectedSession(s.id);
                      setCenterTab("transcript");
                    },
                  },
                ],
                // 위험 — 컴포넌트가 마지막 그룹으로 강제한다
                [{ label: s.personaId ? "역할 세션 제거…" : "터미널 제거", danger: true, action: () => removeTerminal(s) }],
              ]}
            />
            {/* dead 페인 인라인 재개 (U8) — 상세 모달 2단계를 거치지 않는다 */}
            <Show when={s.status === "dead" && s.resumable}>
              <button
                class="btn pane-resume mono"
                title="이 자리에서 재개 — --resume · 대화 복원 (FR-D-21)"
                onClick={(e) => {
                  e.stopPropagation();
                  void resumeInline(s);
                }}
              >
                ▶ 재개 — 대화 복원
              </button>
            </Show>
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
      {/* 분할선 드래그 (M30) — gap 위 핸들. 줌 중에는 트랙이 하나라 의미가 없다 */}
      <Show when={!zoomed()}>
        <PaneDividers />
      </Show>
    </div>
  );

  // 상태바 한 줄 (시안 §04) — 저장 상태·SessionService 카드 2장을 흡수. 상세는 이벤트 팝오버로
  const statusBar = () => (
    <div class="terminal-statusbar mono">
      <span>
        <span style={{ color: "var(--eq-green)" }}>◉</span> PTY {sessions().filter((x) => x.status !== "dead").length}
      </span>
      <span>▦ {PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name}</span>
      <span>OUTPUT {(sessions().reduce((a, x) => a + x.scrollbackLines, 0) / 1000).toFixed(1)}K</span>
      <span>
        {realUsage()
          ? `WAL ${(realUsage()!.db_size_bytes / 1024).toFixed(0)} KB · ${realUsage()!.total_lines.toLocaleString()} lines`
          : `WAL ${usage().walLatencyMs}ms · DB ${usage().dbSizeMb} MB`}
      </span>
      <button
        class="sb-ev"
        title="SessionService 이벤트 · 저장 상태"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setEvOpen(!evOpen())}
      >
        이벤트 {evOpen() ? "▾" : "▸"}
      </button>
      <span class="muted" style={{ "margin-left": "auto" }}>
        {selected()?.cwd ?? props.workspace.path}
      </span>
      <Show when={evOpen()}>
        <div class="card sb-pop" onMouseDown={(e) => e.stopPropagation()}>
          <Eyebrow>SessionService 이벤트 {isTauri() ? "(실측)" : "(목)"}</Eyebrow>
          <For each={stripEvents()}>
            {(e) => (
              <div class="mono muted" style={{ "font-size": "11px", "line-height": 1.7 }}>
                {e.time} {e.message}
              </div>
            )}
          </For>
          <div class="sb-pop-store mono muted">
            저장 {realUsage() ? "(실측)" : "(목)"} ·{" "}
            {realUsage()
              ? `workspaces/${props.workspace.id}/session.db · 100ms 배치 · 30일/10만줄 보존`
              : `${usage().dbFile} · ${usage().dbSizeMb} MB · ${usage().dbPercent}%`}
          </div>
        </div>
      </Show>
    </div>
  );

  return (
    <div class="screen">
      {/* 헤더 한 줄 병합 (시안 §04) — 타이틀 + 중앙 탭 + 도구. 임무·캐스팅·편성은 "팀 ▾" 메뉴로.
          대화 버튼은 앱 바 전역 도구 (M1) — 전체 화면에서도 접근된다 */}
      <div class="cc-top">
        <div class="cc-title" title={props.workspace.path}>
          <h1>{props.workspace.name}</h1>
          <span class="mono muted">
            {props.workspace.branch ?? "—"} · {sessions().length}/4
          </span>
        </div>
        <div class="cc-seg">
          <button classList={{ on: centerTab() === "terminal" }} onClick={() => setCenterTab("terminal")}>
            터미널
          </button>
          <button
            classList={{ on: centerTab() === "transcript" }}
            disabled={!selected()}
            onClick={() => setCenterTab("transcript")}
          >
            트랜스크립트
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {/* 셸 선택 — 새로 추가하는 터미널부터 적용된다 */}
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
          ⛶
        </button>
        <button
          class="btn"
          title="임무 · 캐스팅 · 팀 편성"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTeamMenu(teamMenu() ? undefined : { x: r.right - 232, y: r.bottom + 4 });
          }}
        >
          팀 ▾
        </button>
      </div>
      <Show when={teamMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            onClose={() => setTeamMenu(undefined)}
            groups={[
              [
                { label: "임무 배정…", action: () => setView({ kind: "missions", wsId: props.workspace.id }) },
                { label: "팀 캐스팅…", action: () => setView({ kind: "casting", wsId: props.workspace.id }) },
                { label: "팀 편성…", action: () => setView({ kind: "composition", wsId: props.workspace.id }) },
              ],
            ]}
          />
        )}
      </Show>

      {/* 세션 우클릭 메뉴 (U8) — 레일 행·페인 헤더 공용 */}
      <Show when={sessMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={`${sessionDisplayName(m().s, personaName(m().s.personaId))} · ${jobName(m().s.jobId)} — ${m().s.status}`}
            onClose={() => setSessMenu(undefined)}
            groups={sessMenuGroups(m().s)}
          />
        )}
      </Show>

      <div class="screen-body cc-body">
        {/* 좌: 세션 리스트 레일 — 아바타 전용 56px 레일의 후신. 가로형 리스트 버튼으로
            이름·직무를 직접 보여준다. 선택은 테두리, 상태는 점, LEAD는 slot 1 관례 */}
        <div class="cc-rail">
          <For each={sessions()}>
            {(s) => (
              /* 클릭=페인 포커스 · ⓘ=상세 · 우클릭=메뉴 (U2·U8) — 상세 버튼을 품어야 해서 button이 아니라 div */
              <div
                class="rail-av"
                role="button"
                tabIndex={0}
                classList={{ sel: selected()?.id === s.id }}
                title={`${sessionDisplayName(s, personaName(s.personaId))} · ${jobName(s.jobId)} — ${s.status}${s.slot === 1 && persona(s.personaId) ? " · LEAD" : ""}`}
                onClick={() => {
                  setSelectedSession(s.id);
                  backend.markSeen(s.id); // 페인을 보는 동작이다 (FR-G-44)
                  setCenterTab("terminal");
                }}
                onDblClick={() => setDetailOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedSession(s.id);
                    backend.markSeen(s.id);
                    setCenterTab("terminal");
                  }
                }}
                onContextMenu={(e) => openSessMenu(e, s)}
              >
                <PersonaDot name={sessionDisplayName(s, personaName(s.personaId))} color={persona(s.personaId)?.color ?? "blue"} />
                <span class="rail-txt">
                  <span class="rail-nm">{sessionDisplayName(s, personaName(s.personaId))}</span>
                  <span class="rail-job mono muted">
                    {jobName(s.jobId)}
                    {s.slot === 1 && persona(s.personaId) ? " · LEAD" : ""}
                  </span>
                </span>
                <button
                  class="rail-info mono"
                  title="세션 상세"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSession(s.id);
                    setDetailOpen(true);
                  }}
                >
                  ⓘ
                </button>
                <span class={`sdot ${s.status}`} />
                <Show when={s.unseen}>
                  <span class="unread-dot rail-unread" title="미확인" />
                </Show>
              </div>
            )}
          </For>
          <Show when={sessions().length < 4}>
            <button class="rail-av add mono" title="빈 슬롯에 세션 추가 — 기본 터미널 또는 역할 세션" onClick={openAdd}>
              + 세션 추가
            </button>
          </Show>
          <div class="rail-sep" />
          <button class="rail-ms" title="임무 관리" onClick={() => setView({ kind: "missions", wsId: props.workspace.id })}>
            <span class="eyebrow">임무</span>
            <b class="mono">{missions().length}</b>
          </button>
        </div>

        {/* 중: 터미널 2×2 그리드 / 트랜스크립트 — 탭·도구는 상단 바에 병합됐다 (시안 §04) */}
        <div class="cc-center">
          {/* 전체 화면 중에는 일반 그리드를 언마운트한다 — 같은 PTY에 두 인스턴스가
              서로 다른 크기로 resize 경합하면 ConPTY 리페인트가 폭증한다 */}
          <Show when={centerTab() === "terminal" && !terminalFull()}>
            {paneGrid()}
            {statusBar()}
          </Show>

          <Show when={centerTab() === "transcript" && selected()}>
            {(s) => <TranscriptPane session={s()} />}
          </Show>
        </div>
      </div>

      {/* 세션 상세 — 우측 드로어 (U1). 관제 대상(터미널)을 가리지 않고 옆에 선다.
          레일 ⓘ·페인 메뉴 "세션 상세"가 연다 */}
      <Show when={detailOpen() && selected()}>
        {(s) => (
          <div class="overlay detail-overlay" onClick={() => setDetailOpen(false)}>
            <div class="dialog detail-dialog" onClick={(e) => e.stopPropagation()}>
              <button class="detail-dialog-x" title="닫기 (ESC)" onClick={() => setDetailOpen(false)}>
                ✕
              </button>
              <SessionDetailPanel session={s()} onClose={() => setDetailOpen(false)} />
            </div>
          </div>
        )}
      </Show>

      {/* 터미널 전체 화면 (포커스 모드) — 앱 바(Nav)는 유지, 그 아래만 덮는다.
          사이드 패널(대화 등)은 여기서도 열린다 — 앱 바 대화 버튼이 진입점이다 (M1) */}
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
          <div class="tf-body">
            <div class="tf-main">
              {paneGrid()}
              {statusBar()}
            </div>
            <Show when={panelOpen()}>
              <SidePanel />
            </Show>
          </div>
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
                    <button class="btn primary" onClick={() => void addRoleSession()}>
                      생성
                    </button>
                  </div>
                  {/* 세션 격리 (FR-E-62 · E1′) — 기본은 repo 공유 (FR-E-60) */}
                  <label class="mono muted" style={{ display: "flex", gap: "6px", "align-items": "center", "font-size": "11px", "margin-top": "8px", cursor: "pointer" }}>
                    <input type="checkbox" checked={addWorktree()} onChange={(e) => setAddWorktree(e.currentTarget.checked)} />
                    워크트리 격리 — .eqmux/worktrees/&lt;세션&gt; · 전용 브랜치 eqmux/&lt;세션&gt;
                  </label>
                  <Show when={addWorktree()}>
                    <div class="muted" style={{ "font-size": "10px", "margin-top": "4px" }}>
                      의존성(node_modules 등)은 워크트리마다 별도입니다. 제거 시 워크트리는 남습니다 — 머지·정리는 사람이 합니다 (FR-E-64)
                    </div>
                  </Show>
                  <Show when={addErr()}>
                    <div class="mono st-dead" style={{ "font-size": "10px", "margin-top": "4px" }}>
                      {addErr()}
                    </div>
                  </Show>
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
