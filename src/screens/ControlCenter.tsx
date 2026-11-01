// 컨트롤 센터 (bi8Au) — 워크스페이스 탭의 기준 화면. 팀·세션 카드 / 터미널·저장·이벤트 / 인스펙터.
// 터미널 텍스트는 목 출력이다 — M1에서 xterm.js + Rust PTY로 실물이 된다.
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { backend, onEventLog } from "../backend/mock";
import {
  defaultShell,
  focusRequest,
  detailRequest,
  setDetailRequest,
  focusSession as requestFocus,
  openPanel,
  PANE_LAYOUTS,
  paneLayout,
  panelOpen,
  pushLayer,
  selectedSession,
  setDefaultShell,
  setFocusRequest,
  setLayoutPickerOpen,
  setPaneLayout,
  setSelectedSession,
  setTerminalFull,
  setView,
  SHELLS,
  ptyShells,
  terminalFull,
  tick,
  toggleExplorer,
  railOpen,
  setRailOpen,
} from "../state";
import { Chip, ConfirmDialog, ContextMenu, Eyebrow, FieldHint, Identity, notify, PaneNoText, Segmented, StatusLabel, StopConfirm } from "../components/ui";
import { jobMeta } from "../jobs";
import type { ChipTone, MenuGroup } from "../components/ui";
import { discardPending, injectPending, pendingCount, pendingFor, sendConversation, senderLabel, unmanagedAgent } from "../backend/conversation";
import { attentionOrder, inboxWaiting, pickNext } from "../backend/attention";
import { canStartFresh, resumeAgent, startFresh } from "../backend/agent";
import { queryEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { gitOverview, worktreeList } from "../backend/git";
import type { GitOverview, WorktreeInfo } from "../backend/git";
import { agentClis, agentClisReady, refreshAgentClis } from "../backend/agentprobe";
import { autoAssignDefault, refreshMissions } from "../backend/missions";
import { clipWriteText, isTauri, killPty, onPtyOutput, revealPath, storePurgeScrollback, storeUsageReal, writePty } from "../backend/pty";
import type { StoreUsageReal } from "../backend/pty";
import { removeRoleFile } from "../backend/roles";
import { maxSlots, settings, toggleMuted } from "../backend/settings";
import { ensureWorktree } from "../backend/team";
import { gridTemplateStyle, PaneDividers } from "../components/PaneDividers";
import { SidePanel } from "../components/SidePanel";
import {
  disposeSessionTerminal,
  focusSessionTerminal,
  isRespawning,
  launchAgentInSession,
  sessionTermSize,
  syncSessionTerminal,
  TerminalPane,
  whenSessionReady,
} from "../components/TerminalPane";
import { t, tf } from "../i18n";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { TranscriptPane } from "./TranscriptPane";
import type { AgentCliId, Session, Workspace } from "../types";
import { AGENT_CLI_LABEL, agentAttached, cliOf, statusText, effectivePermissions, effectiveTitle, nameBesideNo, paneNo, SESSION_NAME_MAX, sessionDisplayName, sessionName, slotNo } from "../types";
import { Icon } from "../components/icons";
import { IS_MAC, keyLabel } from "../platform";

/** 셸에 에이전트 명령을 쳐 넣는다 — claude 말고는 EQMUX가 관리하는 스폰 경로가 없다
 *  (역할 주입·훅·재개는 agent.rs의 ClaudeCodeAdapter 전용). 사람이 터미널에 직접 치는 것과
 *  같은 자리이고, 관제 표시는 agentscan이 프로세스 트리에서 잡아 준다.
 *
 *  스폰 직후에 바로 쓰면 PSReadLine이 초기화 전에 받은 입력을 버려 아무 일도 일어나지 않는다.
 *  첫 출력이 곧 "셸이 그리기 시작했다"는 신호라 그때까지 기다린다.
 *  ponytail: 첫 출력 + 짧은 여유. 프로필이 아주 긴 셸에서 어긋나면 프롬프트 문자열을 봐야 한다. */
function runCliIn(id: string, cmd: string): void {
  const off = onPtyOutput(id, () => {
    off();
    setTimeout(() => writePty(id, `${cmd}\r`), 250);
  });
}

/** 레일에 앉힐 폴더 표기 — 마지막 두 마디만. 전체 경로는 title이 갖고 있고, 좁은 레일에서
 *  드라이브부터 늘어놓으면 정작 구분이 되는 끝이 잘린다 (…/EQMux_workspace/EQMUX). */
function shortPath(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("/") || p;
}

// 세션 상태별 목 터미널 출력 — 2×2 그리드 시각 검증용 (Tauri 밖 폴백 전용)
function mockLines(s: Session, personaName: string): string[] {
  // 셸 우선 모델 — 역할 세션도 셸 프롬프트로 시작한다. 에이전트 출력은 직접 띄운 뒤의 모습.
  // 프롬프트는 플랫폼 셸 모양으로 — macOS 화면 검토가 'PS C:\…>'로 Windows처럼 보였다 (U72)
  const prompt = IS_MAC ? `${s.cwd} %` : `PS ${s.cwd}>`;
  if (!s.personaId || s.status === "shell") return IS_MAC ? [`Last login: ttys000`, `${prompt} _`] : ["PowerShell 7.6.4", `${prompt} _`];
  const base = [`${prompt} claude`, `Claude Code ${s.agentVersion ?? "2.1.226"} · ${personaName}`];
  if (s.status === "waiting") return [...base, "⏸ 승인 대기 — " + (s.waitingFor ?? ""), "y/n 을 입력하세요"];
  if (s.status === "dead") return [...base, `프로세스 종료 · exit ${s.exitCode ?? "?"}`, s.resumable ? "재개 가능 — --resume" : "재개 불가"];
  if (s.status === "busy") return [...base, `⚙ ${s.lastOutput}`, `서브에이전트 ${s.subagents} · ${(s.scrollbackLines / 1000).toFixed(1)}K lines`];
  return [...base, `● ${s.lastOutput || "대기 중"}`];
}

/** 엔진 공식 설치 명령 (P1 D6) — 복사만 한다. 실행은 사람이 터미널에서.
 *  macOS zsh에 PowerShell 문법(irm … | iex)을 붙이면 'command not found: irm'으로 끝났다 (B128) */
const INSTALL_CMD: Record<AgentCliId, string> = {
  claude: IS_MAC ? "curl -fsSL https://claude.ai/install.sh | bash" : "irm https://claude.ai/install.ps1 | iex",
  codex: "npm install -g @openai/codex",
};

export function ControlCenter(props: { workspace: Workspace }) {
  // 상태바·레일·메뉴 등 수십 곳이 읽는다 — 메모로 브로드캐스트(tick)당 1회만 필터·정렬한다
  const sessions = createMemo(() => {
    tick();
    return backend
      .listSessions()
      .filter((s) => s.workspaceId === props.workspace.id)
      .sort((a, b) => a.slot - b.slot);
  });
  const usage = () => backend.storeUsage(props.workspace.name);
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);
  const selected = createMemo(() => sessions().find((s) => s.id === selectedSession()) ?? sessions()[0]);

  const [centerTab, setCenterTab] = createSignal<"terminal" | "transcript">("terminal");
  const [zoomed, setZoomed] = createSignal<string | undefined>(undefined); // B1 — 줌 토글
  // 줌 전환 — 이산 크기 변화이므로 RO 디바운스(100ms)를 기다리지 않고 레이아웃 확정 직후
  // 바로 fit→PTY resize 한다. ConPTY 리페인트 스왑이 전환 동작 안에 흡수돼 늦은 깜빡임이 안 된다.
  const applyZoom = (next: string | undefined) => {
    const affected = next ?? zoomed(); // 줌 인이면 대상, 줌 아웃이면 직전 줌 페인이 크기가 변한다
    setZoomed(next);
    if (affected) requestAnimationFrame(() => syncSessionTerminal(affected));
  };
  // ── Focus — 사람이 답해야 진행되는 페인을 통째로 잡는다 (state.focusSession) ──
  // 선택 프롬프트(질문·계획 승인)와 승인 대기는 대화로 답할 수 없다: waiting에는 본문을
  // 주입하지 않고 인박스에 쌓아 두므로(M3 — TUI 다이얼로그의 오답이 되기 때문), 진행하는
  // 길은 그 페인에 직접 치는 것뿐이다. 그래서 선택·줌·전체 화면·키보드를 한 동작으로 묶는다.
  const focusPane = (id: string) => {
    setCenterTab("terminal");
    setSelectedSession(id);
    // 줌은 Focus(전체 화면 요청)일 때만 — 다음 미확인으로·Ctrl+Alt+N은 키보드 포커스만 옮긴다
    if (terminalFull()) applyZoom(id);
    requestAnimationFrame(() => focusSessionTerminal(id));
  };
  // 진입은 하나 — 여기서 눌러도 대화 패널에서 눌러도 같은 요청을 거친다 (state.focusSession).
  // 선택·미확인 해제·전체 화면은 그쪽이, 줌과 키보드는 아래 이펙트가 맡는다.
  const focusSession = (s: Session) => requestFocus(props.workspace.id, s.id);
  createEffect(
    on(focusRequest, (r) => {
      // 남의 워크스페이스 요청이면 그냥 둔다 — 그 탭이 마운트되면서 자기 것으로 받아간다
      if (!r || !sessions().some((s) => s.id === r.session)) return;
      focusPane(r.session);
      setFocusRequest(undefined); // 한 번 쓰고 비운다 — 이 탭에 다시 왔다고 또 잡지 않게
    }),
  );
  // 상단 줄 요약 (시안 Context) — 관리 엔진 종류 수, 확인 단계 신호가 있는 세션 수
  // 상태바 엔진 칸 — 관리 에이전트가 붙어 있는 엔진만 "CLAUDE 2 · CODEX 1". 없으면 칸이 없다
  const attachedByEngine = () =>
    (["claude", "codex"] as AgentCliId[])
      .map((c) => [c, sessions().filter((x) => x.personaId && cliOf(x) === c && agentAttached(x)).length] as const)
      .filter(([, n]) => n > 0)
      .map(([c, n]) => `${c.toUpperCase()} ${n}`)
      .join(" · ");
  const engineCount = () => new Set(sessions().filter((s) => s.personaId).map((s) => cliOf(s))).size;
  // 상단 칩은 이 워크스페이스 안에서만 돈다 (B88) — 숫자는 이 탭 것인데 누르면 다른 탭의 종료 세션으로
  // 가던 것. 세는 집합과 도는 집합이 같다. 모든 워크스페이스를 도는 것은 Ctrl+Shift+U(nextUnseen)다
  const localAttention = () => attentionOrder(sessions(), inboxWaiting);
  let lastLocalJump: string | undefined;
  const nextLocal = () => {
    const next = pickNext(localAttention(), lastLocalJump);
    if (!next) return;
    lastLocalJump = next.id;
    focusPane(next.id);
  };
  const emptySlots = () => {
    const used = new Set(sessions().map((s) => s.slot));
    return Array.from({ length: maxSlots() }, (_, i) => i + 1).filter((n) => !used.has(n));
  };
  /** 레일 세션 행 — 클릭=페인 포커스 · ⓘ=상세 · 우클릭=메뉴 (U2·U8). 상세 버튼을 품어야 해서 button이 아니라 div */
  const railRow = (s: Session) => (
    <div
      class="rail-av"
      role="button"
      tabIndex={0}
      classList={{ sel: selected()?.id === s.id }}
      title={[
        `${paneNo(s)} ${sessionName(s, persona(s.personaId))}${s.peerName ? ` · ${s.peerName}` : ""}`,
        effectiveTitle(s, persona(s.personaId)),
        jobName(s.jobId),
        s.personaId ? AGENT_CLI_LABEL[cliOf(s)] : undefined,
        statusText(s.status),
      ]
        .filter(Boolean)
        .join(" · ")}
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
      {/* 점 하나 — 주의 신호가 있으면 그 단계 색, 없으면 상태 색 (§페인 헤더 문법) */}
      <span class={attnChips(s)[0] ? `rail-attn ${attnChips(s)[0]!.tone}` : `sdot ${s.status}`} />
      {/* 번호는 헤더와 같은 두 자리 슬롯 번호 — 헤더와 레일을 번호로 맞춰 본다 */}
      <span class="rail-no mono">
        <PaneNoText slot={s.slot} no={paneNo(s)} />
      </span>
      <span class="rail-nm mono">{nameBesideNo(paneNo(s), sessionName(s, persona(s.personaId)))}</span>
      <Show when={s.personaId}>
        <span class="rail-jobb mono">{jobMeta(s.jobId, jobName(s.jobId)).badge}</span>
      </Show>
      {/* 대기 중인 세션만 — 사람이 답해야 진행되는 자리라 Focus를 상시 노출한다.
          나머지 행은 호버 때만 뜨는 ⓘ만 갖는다 (U2 — 행 클릭은 페인 선택) */}
      <Show when={s.status === "waiting"}>
        <button
          class="rail-focus mono"
          title={t("Focus — 이 페인을 전체 화면으로 잡고 키보드를 넘깁니다")}
          onClick={(e) => {
            e.stopPropagation();
            focusSession(s);
          }}
        >
          ⛶
        </button>
      </Show>
      <button
        class="rail-info mono"
        title={t("세션 상세")}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedSession(s.id);
          setDetailOpen(true);
        }}
      >
        ⓘ
      </button>
      <Show when={s.unseen}>
        <span class="unread-dot rail-unread" title={t("미확인")} />
      </Show>
    </div>
  );
  // 레일 항목 — 세션과 빈 슬롯 번호를 슬롯 순으로 (QA: 04 카이가 01~03 빈 슬롯보다 먼저 보였다)
  const railItems = (): (Session | number)[] =>
    [...sessions(), ...emptySlots()].sort((x, y) => (typeof x === "number" ? x : x.slot) - (typeof y === "number" ? y : y.slot));
  /** 지금 사람을 기다리는 세션 — 오래 기다린 것이 먼저다 (ATTENTION_ORDER와 같은 취지) */
  const waitingSessions = createMemo(() =>
    sessions()
      .filter((s) => s.status === "waiting")
      .sort((a, b) => b.sinceMs - a.sinceMs),
  );
  // 세션 상세 팝업 — 우측 고정 인스펙터의 후신. 아바타 레일·페인 메뉴 "세션 상세"가 연다
  const [detailOpen, setDetailOpen] = createSignal(false);
  // 밖에서 온 상세 열기 요청 (U63 — 복구 창) — 남의 워크스페이스 것이면 그 탭이 받아간다
  createEffect(
    on(detailRequest, (r) => {
      if (!r || !sessions().some((s) => s.id === r.session)) return;
      setSelectedSession(r.session);
      setDetailOpen(true);
      setDetailRequest(undefined);
    }),
  );
  // 팀 도구 메뉴 (시안 §04) — 임무·캐스팅·팀 편성 버튼 3개의 후신
  const [teamMenu, setTeamMenu] = createSignal<{ x: number; y: number } | undefined>(undefined);
  // 상태바 이벤트 팝오버 (시안 §04) — 저장 상태·SessionService 카드 2장의 후신
  const [evOpen, setEvOpen] = createSignal(false);

  // 저장 사용량 실측 (FR-C-52) — Tauri에서만. 브라우저 목업은 mock 수치 유지.
  const [realUsage, setRealUsage] = createSignal<StoreUsageReal | undefined>(undefined);
  const loadUsage = () => void storeUsageReal(props.workspace.id).then(setRealUsage);
  onMount(() => {
    if (!isTauri()) return;
    void refreshMissions(props.workspace.id); // 임무 파일 실측 — 밖에서 편집됐어도 여기서 따라잡는다
    loadUsage();
    const t = setInterval(() => !document.hidden && loadUsage(), 10_000); // 숨김 중 쉰다 (CPU 점검 2)
    onCleanup(() => clearInterval(t));
  });

  // 브랜치 현황 (레일 §로컬 폴더 아래) — 읽기 전용. 3a33432에서 워크트리 레일과 함께 빠졌던 것을
  // 표시만 되살린다 (생성·체크아웃 없음). git 패널과 같은 10초 실측, 숨김 중 쉰다
  const [gitInfo, setGitInfo] = createSignal<GitOverview | undefined>(undefined);
  const [worktrees, setWorktrees] = createSignal<WorktreeInfo[]>([]);
  onMount(() => {
    if (props.workspace.pathMissing) return;
    // 브라우저 dev — 목 워크트리를 한 번만 (실측·폴링 없음)
    if (!isTauri()) return void worktreeList(props.workspace.path).then((w) => setWorktrees(w ?? []));
    const load = () => {
      void gitOverview(props.workspace.path).then(setGitInfo);
      void worktreeList(props.workspace.path).then((w) => setWorktrees(w ?? []));
    };
    load();
    const t = setInterval(() => !document.hidden && load(), 10_000);
    onCleanup(() => clearInterval(t));
  });
  const gitBranch = () => gitInfo()?.branch ?? props.workspace.branch;
  const normPath = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  /** 이 워크트리에서 도는 세션들 — cwd 실측 일치 */
  const wtMembers = (wt: WorktreeInfo) => sessions().filter((s) => normPath(s.cwd) === normPath(wt.path));
  const wtTail = (p: string) => p.replace(/\\/g, "/").split("/").slice(-2).join("/");

  // 저장 기록 초기화 (FR-C-52 — 사용자 조작) — 상태바의 WAL·lines를 직접 0으로 되돌린다.
  // 되돌릴 수 없으므로 세션 제거와 같은 확인 한 단계를 둔다 (즉시 실행하지 않는다)
  const [purgeOpen, setPurgeOpen] = createSignal(false);
  const [purging, setPurging] = createSignal(false);
  const [purgeErr, setPurgeErr] = createSignal<string | undefined>(undefined);
  const doPurge = async () => {
    setPurging(true);
    setPurgeErr(undefined);
    try {
      await storePurgeScrollback(props.workspace.id);
      loadUsage(); // 비운 결과를 상태바가 바로 반영하게 — 10초 주기를 기다리지 않는다
      setPurgeOpen(false);
    } catch (e) {
      setPurgeErr(String(e));
    } finally {
      setPurging(false);
    }
  };

  // 워크스페이스 스코프 이벤트 (FR-G-41) — 스트립의 SessionService 칸을 실데이터로
  const [wsFeed, setWsFeed] = createSignal<FeedEvent[]>([]);
  onMount(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void queryEvents(props.workspace.id, { limit: 4 }).then(setWsFeed);
    load();
    // 이벤트 로그가 바뀐 때만 (CPU·RAM C4) — 모든 방송에 붙으면 버스트마다 events_query가 돌았다
    const unsub = onEventLog(() => {
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
        // 대기 중인 페인의 터미널에 커서가 있으면 ESC는 그 TUI의 것이다 — 선택 프롬프트가
        // 스스로 "Esc to cancel"이라 안내하는 자리다. 여기서 겹쳐 받으면 답을 취소하는
        // 김에 보고 있던 화면(줌·전체 화면)까지 잃는다. Focus로 잡아 온 직후가 정확히
        // 이 상황이다. 대기 중이 아니면 종전대로 — 나가는 길은 ESC 하나로 남는다.
        const inTerm = (e.target as HTMLElement | null)?.closest?.(".xterm");
        if (inTerm && selected()?.status === "waiting") return;
        e.preventDefault();
        if (zoomed()) applyZoom(undefined);
        else setTerminalFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Ctrl+Alt+1~8(macOS ⌘1~8) — 이 워크스페이스의 N번 슬롯 페인에 키보드 포커스만 (줌·Focus 아님).
  // 캡처 단계에서 받아야 xterm이 먼저 삼키지 않는다. 그 슬롯이 비어 있으면 그대로 흘려보낸다
  onMount(() => {
    const onSlotKey = (e: KeyboardEvent) => {
      // macOS의 Ctrl+Option은 VoiceOver 수정자다 — ⌘숫자로 옮긴다 (U69)
      if (IS_MAC) {
        if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      }
      // AltGr는 Windows에서 Ctrl+Alt로 들어온다 — 독일어 자판 AltGr+7/8({ [) 같은 문자를 삼키지 않게 (B81)
      else if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey || e.getModifierState("AltGraph")) return;
      const m = /^Digit([1-8])$/.exec(e.code);
      const s = m && sessions().find((x) => x.slot === Number(m[1]));
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      setCenterTab("terminal");
      setSelectedSession(s.id);
      backend.markSeen(s.id);
      requestAnimationFrame(() => focusSessionTerminal(s.id));
    };
    window.addEventListener("keydown", onSlotKey, true);
    onCleanup(() => window.removeEventListener("keydown", onSlotKey, true));
  });

  // 턴 완료 칩의 '본 것' (§주의 신호) — 창이 포커스인 채 그 페인이 3초 보이면 내린다.
  // 완료 보고·보고 전은 여기서 지우지 않는다 (앞은 페인을 눌러야, 뒤는 할 일이라)
  onMount(() => {
    const seenSince = new Map<string, number>();
    const timer = setInterval(() => {
      const now = Date.now();
      const visible =
        document.hasFocus() && centerTab() === "terminal"
          ? gridSessions().filter((s) => s.unseenDone === "turn")
          : [];
      const ids = new Set(visible.map((s) => s.id));
      for (const id of seenSince.keys()) if (!ids.has(id)) seenSince.delete(id);
      for (const s of visible) {
        const since = seenSince.get(s.id) ?? now;
        seenSince.set(s.id, since);
        if (now - since >= 3000) {
          seenSince.delete(s.id);
          backend.markDoneSeen(s.id);
        }
      }
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  // 역할 없는 셸 세션(기본 터미널)은 페르소나·직무 대신 고정 라벨을 쓴다
  const personaName = (id: string) => persona(id)?.name ?? t("기본 터미널");
  const jobName = (id: string) => job(id)?.name ?? t("셸");

  // 슬롯 단위 세션 추가 — 기본 터미널 / 역할 세션 2택 (C). 캐스팅은 팀 전체 프리셋 도구로 남는다.
  const [addOpen, setAddOpen] = createSignal(false);
  const [addPersona, setAddPersona] = createSignal("");
  const [addJob, setAddJob] = createSignal("");
  const [addWorktree, setAddWorktree] = createSignal(false); // 격리 옵트인 (FR-E-62 · E1′)
  const [addCli, setAddCli] = createSignal<AgentCliId>("claude"); // 관리 기동 엔진 (M37)
  const [addErr, setAddErr] = createSignal<string | undefined>(undefined);
  const [addName, setAddName] = createSignal(""); // 세션 이름 — 비우면 자동(기본 터미널)·페르소나 이름(역할)
  const [addMode, setAddMode] = createSignal<"shell" | "role">("role"); // 시안 xukml 세그먼트
  const [addShell, setAddShell] = createSignal(""); // 이 세션의 셸 — 열 때 기본 셸로 채운다
  const addNameErr = () => backend.sessionNameError(props.workspace.id, addName());
  const availablePersonas = () => {
    const used = new Set(sessions().map((x) => x.personaId));
    return backend.listPersonas().filter((p) => !used.has(p.id));
  };
  // 페르소나의 저장 직무 — 미지정·삭제된 직무면 개발 → 첫 직무 (세션 상세 personaJob과 같은 규칙)
  const personaJobId = (pid: string) => {
    const jobs = backend.listJobs();
    const saved = persona(pid)?.job;
    return jobs.find((j) => j.id === saved)?.id ?? jobs.find((j) => j.id === "dev")?.id ?? jobs[0]?.id ?? "";
  };
  const openAdd = () => {
    setAddPersona(availablePersonas()[0]?.id ?? "");
    setAddJob(personaJobId(addPersona()));
    setAddWorktree(false);
    setAddErr(undefined);
    setAddName("");
    setAddShell(defaultShell().label);
    setAddMode(availablePersonas().length > 0 ? "role" : "shell");
    setAddOpen(true);
  };
  const addTerminal = () => {
    if (addNameErr()) return;
    backend.addTerminal(props.workspace.id, addShell() || defaultShell().label, undefined, addName());
    setAddOpen(false);
  };
  // 셸 실행 에이전트 열기 (codex 등) — 설치 확인은 카드를 내놓을 때 이미 끝났다.
  // 셸 세션 그대로다: 역할도 훅도 붙지 않으므로 대화 전달은 기본 터미널과 같이
  // 화면 에코까지만 간다 (P-2). 관리 에이전트는 이 경로가 아니라 addRoleSession이다.
  const addCliSession = (cmd: string) => {
    if (addNameErr()) return;
    const created = backend.addTerminal(props.workspace.id, addShell() || defaultShell().label, undefined, addName());
    if (created) whenSessionReady(created.id, (id) => runCliIn(id, cmd));
    setAddOpen(false);
  };
  // 설정 화면의 명부와 같은 소스 — 관리 경로가 있는 claude·codex는 위 역할 카드가 이미 맡는다
  const shellClis = () => agentClis().filter((a) => a.installed && !a.managed);
  // 관리 엔진 선택지 (M37) — 명부의 managed 항목. 실측 전에는 둘 다 내놓아 자리가 흔들리지 않게 한다
  const managedClis = (): AgentCliId[] => {
    const known = agentClis().filter((a) => a.managed).map((a) => a.cmd as AgentCliId);
    return known.length > 0 ? known : ["claude", "codex"];
  };
  const addNoSlot = () => !emptySlots()[0];
  const addCliMissing = () => agentClisReady() && !agentClis().some((a) => a.cmd === addCli() && a.installed);
  const [shellMenuOpen, setShellMenuOpen] = createSignal(false);
  const shellCmdFor = (s: Session) => SHELLS.find((x) => x.label === s.shell)?.cmd;
  const addRoleSession = async () => {
    if (!addPersona() || !addJob() || addNameErr()) return;
    setAddErr(undefined);
    const opts: { cwd?: string; worktree?: boolean; cli: AgentCliId; name?: string } = { cli: addCli(), name: addName() };
    // 워크트리 격리 (FR-E-62) — 기본은 repo 공유 (FR-E-60). 실패는 정직하게 표시하고 만들지 않는다
    if (addWorktree() && isTauri()) {
      try {
        opts.cwd = await ensureWorktree(props.workspace.path, `${addPersona()}@${props.workspace.id}`);
        opts.worktree = true;
      } catch (err) {
        setAddErr(String(err));
        return;
      }
    }
    const created = backend.addRoleSession(props.workspace.id, addPersona(), addJob(), opts);
    // 기본 임무 자동 배정 (FR-E-56) — 임무 없는 새 역할 세션에만
    void autoAssignDefault(props.workspace.id, `${addPersona()}@${props.workspace.id}`);
    // "열기"가 곧 기동이다 — 셸이 뜨는 대로 역할·권한·훅이 붙은 에이전트로 다시 연다.
    // 예전에는 여기서 맨 셸만 뜨고, 사람이 페인의 [▶ 에이전트 기동]을 따로 찾아 눌러야 했다.
    // 그 버튼은 그대로 남는다 — 중지한 세션을 다시 띄우는 자리는 여전히 거기다.
    if (created) whenSessionReady(created.id, () => void launchAgent(created));
    setAddOpen(false);
  };
  const [removeTarget, setRemoveTarget] = createSignal<Session | undefined>(undefined);
  // 종료된 슬롯의 '비우고 새로 만들기' (B84·U44) — 확인을 누른 뒤에만 만들기 창을 잇는다
  const [removeThenAdd, setRemoveThenAdd] = createSignal(false);
  const [stopTarget, setStopTarget] = createSignal<Session | undefined>(undefined);
  // 주의 칩 (§주의 신호) — 순위 순. 헤더는 첫 칩만, 나머지는 +N 메뉴(chipMenu)로
  const [chipMenu, setChipMenu] = createSignal<{ x: number; y: number; s: Session } | undefined>(undefined);
  const [inboxPop, setInboxPop] = createSignal<string | undefined>(undefined); // 넣기 팝오버 세션 id
  // 자체 오버레이 대화상자 (U45) — 레이어 스택(P30)에 올려 ConfirmDialog처럼 Esc가 맨 위 하나를 닫는다
  // 상자 getter를 넘겨 모달 레이어로 (U37·B72) — Tab이 안에서만 돌고 뒤 화면 이동 단축키·토스트가 막힌다
  let addBox: HTMLDivElement | undefined;
  let inboxBox: HTMLDivElement | undefined;
  let purgeBox: HTMLDivElement | undefined;
  createEffect(() => addOpen() && onCleanup(pushLayer(() => setAddOpen(false), () => addBox)));
  createEffect(() => inboxPop() && onCleanup(pushLayer(() => setInboxPop(undefined), () => inboxBox)));
  createEffect(() => purgeOpen() && onCleanup(pushLayer(() => setPurgeOpen(false), () => purgeBox)));
  const [reportAsk, setReportAsk] = createSignal<Session | undefined>(undefined); // 보고 요청 확인
  const nameOfId = (id: string) => {
    const s = sessions().find((x) => x.id === id);
    return s ? sessionName(s, persona(s.personaId)) : id;
  };
  type AttnChip = {
    tone: ChipTone;
    text: string;
    short?: string; // 8슬롯처럼 좁은 페인에서 (시안 T1sVdJ)
    title?: string;
    action?: { label: string; onClick: () => void; title?: string };
    onClick?: () => void;
  };
  const attnChips = (s: Session): AttnChip[] => {
    const out: AttnChip[] = [];
    if (s.status === "waiting" && s.waitingFor)
      out.push({
        tone: "amber",
        text: `${t("승인 대기")} · ${t(s.waitingFor)}`,
        short: t("승인 대기"),
        title: t("클릭하면 이 페인을 Focus로 잡습니다 — 답은 여기에 직접 입력합니다"),
        onClick: () => focusSession(s),
      });
    // exit 코드는 본문 한 곳에만 (U49) — 헤더 칩은 다음 행동을 가르는 재개 가능 여부를 말한다
    if (s.status === "dead")
      out.push({
        tone: "red",
        text: `${t("종료됨")} · ${s.resumable ? t("재개 가능") : t("재개 불가")}`,
        short: t("종료됨"),
        title: `exit ${s.exitCode ?? "?"}`,
      });
    const n = unmanagedAgent(s) ? pendingCount(s.id) : 0;
    if (n > 0)
      out.push({
        tone: "blue",
        text: tf("메시지 {n}건", { n }),
        short: tf("메시지 {n}", { n }),
        // 설정에 맞춘 문구 (U52) — auto여도 승인 대기·상태 모름이면 쌓인다
        title: t(
          settings().manualDelivery === "auto"
            ? "승인 대기이거나 상태를 몰라 쌓아 두었습니다 — idle이 되면 넣습니다"
            : "손으로 띄운 에이전트라 자동으로 넣지 않습니다",
        ),
        action: { label: t("넣기"), onClick: () => setInboxPop(s.id) },
      });
    if (s.reportPending)
      out.push({
        tone: "blue",
        // 진척 report는 보냈으면 '보고 전'이라 하지 않는다 (U31) — 사람은 '보고를 안 했다'로 읽는다
        text: s.reportProgress ? t("✓ 보고함 · 완료 표시 없음") : t("✓ 턴 끝남 · 보고 전"),
        short: s.reportProgress ? t("✓ 완료 표시 없음") : t("✓ 보고 전"),
        title: s.reportProgress
          ? t("진척 보고는 받았지만 맡은 handoff·ask에 아직 report --done이 없습니다")
          : t("맡은 handoff·ask에 아직 report --done이 없습니다"),
        action: {
          label: t("보고 요청"),
          title: t("이 세션에 결과를 report --done으로 알려 달라는 ask를 보냅니다"),
          onClick: () => setReportAsk(s),
        },
      });
    if (s.unseenDone === "report") out.push({ tone: "blue", text: t("✓ 완료 보고"), title: s.doneText });
    else if (s.unseenDone === "turn" && !s.reportPending) out.push({ tone: "blue", text: t("✓ 턴 끝남"), title: s.lastRecap });
    return out;
  };
  // 세션 우클릭 메뉴 (U8) — 레일 행·페인 헤더 공용. 재개·중지·상세·점프를 상세 모달 없이 꺼낸다
  const [sessMenu, setSessMenu] = createSignal<{ x: number; y: number; s: Session } | undefined>(undefined);

  // 인라인 재개 (U8) — 상세 모달의 doResume과 같은 경로 (FR-D-21~23).
  // 실패는 반드시 화면에 남긴다 (B57) — dead 세션은 페인 대신 deadSlot이 렌더되므로
  // "페인의 restore 카드가 보여준다"는 전제가 성립하지 않고, 그대로 두면 눌러도 아무 일도
  // 일어나지 않는 버튼이 된다. Rust는 정확한 이유를 돌려주고 있다.
  const [resumeErr, setResumeErr] = createSignal<{ id: string; msg: string } | undefined>(undefined);
  const resumeInline = async (s: Session) => {
    setResumeErr(undefined);
    if (isTauri() && s.personaId) {
      const p = s.permOverride ?? job(s.jobId)?.permissions;
      if (!p) {
        setResumeErr({ id: s.id, msg: t("직무 권한을 찾을 수 없습니다 — 역할을 다시 지정하세요") });
        return;
      }
      const size = sessionTermSize(s.id);
      try {
        await resumeAgent(s.id, s.workspaceId, s.cwd, sessionName(s, persona(s.personaId)), p, size.cols, size.rows, cliOf(s));
      } catch (err) {
        setResumeErr({ id: s.id, msg: String(err) });
        return;
      }
    }
    backend.resumeSession(s.id);
  };

  const openSessMenu = (e: MouseEvent, s: Session) => {
    e.preventDefault();
    e.stopPropagation();
    setSessMenu({ x: e.clientX, y: e.clientY, s });
  };
  // 레일 우클릭·페인 헤더 메뉴가 공유하는 항목 — 한 곳만 고치면 두 메뉴가 같이 맞는다
  const detailItem = (s: Session) => ({
    label: t("세션 상세"),
    action: () => {
      setSelectedSession(s.id);
      setDetailOpen(true);
    },
  });
  const transcriptItem = (s: Session) => ({
    label: t("트랜스크립트 열기"),
    action: () => {
      setSelectedSession(s.id);
      setCenterTab("transcript");
    },
  });
  const removeGroup = (s: Session): MenuGroup => [
    { label: t("슬롯 비우기…"), danger: true, action: () => removeTerminal(s) },
  ];
  const sessMenuGroups = (s: Session) => [
    [
      {
        label: t("페인으로 점프"),
        kbd: keyLabel(`Ctrl+Alt+${s.slot}`),
        action: () => {
          setSelectedSession(s.id);
          backend.markSeen(s.id);
          setCenterTab("terminal");
        },
      },
      detailItem(s),
      transcriptItem(s),
      {
        label: t("작업 폴더 열기"),
        action: () =>
          void revealPath(s.cwd || props.workspace.path).then((ok) => ok || notify(t("폴더를 열 수 없습니다"))),
      },
      {
        label: t("알림 음소거"),
        checked: settings().muted.includes(s.id),
        action: () => toggleMuted(s.id),
      },
    ],
    [
      // 기동·재개는 역할 세션에만 뜻이 있다 (U48) — 기본 터미널에는 늘 비활성으로 떠서 '왜 안 되나'를 낳았다
      ...(s.personaId
        ? [
            {
              label: tf("{engine} 기동", { engine: AGENT_CLI_LABEL[cliOf(s)] }),
              disabled: !needsAgent(s),
              action: () => void launchAgent(s),
            },
            {
              label: t("재개"),
              disabled: !s.resumable || (s.status !== "dead" && !s.restored),
              action: () => void resumeInline(s),
            },
          ]
        : [{ label: t("역할 지정은 세션 상세에서"), note: true }]),
      // 새로 시작 (요약 이월 · 토큰 #6) — 죽었고 요약이 있을 때만. 이전 대화는 잇지 않는다
      ...(canStartFresh(s)
        ? [
            {
              label: t("새로 시작 (요약만 넘김 · 이전 대화는 잇지 않음)"),
              action: () => {
                const size = sessionTermSize(s.id);
                void startFresh(s, size.cols, size.rows).then((err) => err && notify(t(err)));
              },
            },
          ]
        : []),
      {
        label: t("중지…"),
        danger: true,
        disabled: s.status === "dead",
        action: () => setStopTarget(s), // BR-08 — 확인을 거친다
      },
    ],
    removeGroup(s),
  ];
  const doRemove = (s: Session) => {
    killPty(s.id);
    disposeSessionTerminal(s.id);
    if (zoomed() === s.id) applyZoom(undefined);
    // 역할 파일은 세션 cwd 규약 (FR-E-63) — 워크트리 세션은 자기 사본에서 지운다.
    // 워크트리 자체는 남긴다 (FR-E-64 — 커밋 안 된 작업이 있을 수 있다)
    if (s.personaId && !props.workspace.pathMissing) removeRoleFile(s.cwd || props.workspace.path, s.id);
    backend.removeTerminal(s.id);
    setRemoveTarget(undefined);
    if (removeThenAdd()) openAdd();
    setRemoveThenAdd(false);
  };
  // ✕ — 기본 터미널도 셸 프로세스가 죽으므로 확인을 거친다 (U-3). 문구만 다르다
  const removeTerminal = (s: Session) => {
    setRemoveThenAdd(false);
    setRemoveTarget(s);
  };

  /** 관리되는 에이전트의 기동 인자 — 역할 세션에만 있다 (기본 터미널은 셸로 남는다) */
  const roleAgent = (s: Session) => {
    if (!s.personaId) return undefined;
    const p = effectivePermissions(s, job(s.jobId));
    if (!p) return undefined;
    // claude --name은 세션 이름 (0.5) — Claude 재개 목록에서 세션을 가를 수 있게
    return { name: sessionName(s, persona(s.personaId)), permissions: p };
  };
  /** 아직 EQMUX가 관리하는 에이전트가 아니다 — 맨 셸이 떠 있는 역할 세션.
   *  손으로 `claude`를 쳐도 환경변수·훅·역할이 안 붙으므로, 기동은 이 액션으로만 한다.
   *
   *  판정은 "지금 이 페인에 에이전트가 붙어 있는가"만 본다 — status가 유일한 실시간 소스다
   *  (conversation.ts의 주입 판정과 같은 기준). agentSessionId로 재면 안 된다: 그것은 과거
   *  기록(agent_session 매핑)이라 한 번 붙은 뒤로는 지워지지 않고, 복원(team_load가 DB에서
   *  끌어옴)이나 채택 세션 종료(claude만 죽고 셸이 남아 Rust가 shell로 되돌림) 뒤에도 남아
   *  있어서, 맨 셸인 페인에서 기동 경로가 영영 사라진다.
   *
   *  단, status는 훅·레지스트리 경로라 비면 shell로 남는다 (훅 미설치·채택 실패·관측 저하).
   *  기동은 killAndWait로 페인을 통째로 끝내므로, 그 상태에서 버튼을 누르면 지금 돌고 있는
   *  에이전트가 죽는다. 그래서 Job 트리 실측(s.agent)이 에이전트를 보고 있으면 감춘다 —
   *  프로세스 생존은 status와 독립된 실시간 소스다 (agentprobe 5초 폴링). */
  const needsAgent = (s: Session) => !!roleAgent(s) && s.status === "shell" && !s.agent;
  /** 페인 상주 상태 줄 (U-1) — 맨 셸인 역할 세션만. 못 띄우면 버튼을 숨기지 않고 이유를 남긴다 */
  const paneNote = (s: Session): { text: string; launch: boolean } | undefined => {
    if (!s.personaId || s.status !== "shell") return undefined;
    if (s.agent) return { text: tf("{agent} 실행 중 — 손으로 띄워 역할·훅이 붙지 않았습니다", { agent: s.agent }), launch: false };
    if (!roleAgent(s)) return { text: t("에이전트 없음 — 직무 권한을 찾을 수 없어 기동할 수 없습니다. 역할을 다시 지정하세요"), launch: false };
    if (agentClisReady() && !agentClis().some((a) => a.cmd === cliOf(s) && a.installed))
      return { text: tf("에이전트 없음 — PATH에 {cmd}가 없어 기동할 수 없습니다", { cmd: cliOf(s) }), launch: false };
    return { text: t("에이전트 없음"), launch: true };
  };
  const launchAgent = async (s: Session) => {
    const a = roleAgent(s);
    if (!a) return;
    try {
      await launchAgentInSession(s.id, s.workspaceId, s.cwd, a.name, a.permissions, cliOf(s));
    } catch {
      /* 실패는 페인 출력과 이벤트 피드가 보여준다 (FR-D-08) */
    }
  };

  // 종료된 슬롯의 "슬롯 비우고 새로 만들기…" — 제거 확인을 거친 뒤에만 만들기 창으로 잇는다 (B84·U44).
  // 두 창을 같이 열면 겹쳐 보이고, 확인을 취소해도 빈 슬롯 없는 만들기 창이 남았다.
  const replaceDeadSlot = (s: Session) => {
    setRemoveTarget(s);
    setRemoveThenAdd(true);
  };

  /** 종료된 슬롯 화면 — 죽은 터미널 대신 다음 행동을 내놓는다.
   *  세션 기록은 지우지 않는다 — 재개(FR-D-21~23)와 트랜스크립트가 살아 있어야 하기 때문이다.
   *  터미널 버퍼도 REGISTRY에 남아 있어, 재개하면 끊긴 자리에서 이어서 그려진다. */
  const deadSlot = (s: Session) => (
    <div class="pane-dead-slot mono">
      <div class="pane-dead-why">
        {t("프로세스 종료")} · exit {s.exitCode ?? "?"}
      </div>
      <div class="pane-dead-acts">
        <button
          class="btn"
          title={t("이 슬롯을 비우고 새 세션을 추가합니다")}
          onClick={(e) => {
            e.stopPropagation();
            replaceDeadSlot(s);
          }}
        >
          {t("슬롯 비우고 새로 만들기…")}
        </button>
        {/* 새로 시작 (요약 이월) — 우클릭 메뉴에만 있던 다음 행동을 종료 화면에도 (U44) */}
        <Show when={canStartFresh(s)}>
          <button
            class="btn"
            title={t("새로 시작 (요약만 넘김 · 이전 대화는 잇지 않음)")}
            onClick={(e) => {
              e.stopPropagation();
              const size = sessionTermSize(s.id);
              void startFresh(s, size.cols, size.rows).then((err) => err && notify(t(err)));
            }}
          >
            {t("새로 시작")}
          </button>
        </Show>
        <Show
          when={s.resumable}
          fallback={<span class="pane-dead-note">{t("재개 불가")} — {t("트랜스크립트 없음")}</span>}
        >
          <button
            class="btn pane-dead-resume"
            title={t("이 자리에서 재개 — --resume · 대화 복원")}
            onClick={(e) => {
              e.stopPropagation();
              void resumeInline(s);
            }}
          >
            ▶ {t("재개 — 대화 복원")}
          </button>
        </Show>
      </div>
      <Show when={resumeErr()?.id === s.id}>
        <div class="pane-dead-note st-dead">{resumeErr()!.msg}</div>
      </Show>
      {/* 터미널을 감췄으므로 남긴 출력으로 가는 길을 연다 — 종료된 세션의 마지막 출력 확인용 */}
      <button
        class="pane-dead-log"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedSession(s.id);
          setCenterTab("transcript");
        }}
      >
        {t("남긴 출력 보기")}
      </button>
    </div>
  );

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
      class={`terminal-grid layout-${paneLayout()} slots-${maxSlots()}`}
      classList={{ zoomed: !!zoomed() }}
      style={zoomed() ? undefined : gridTemplateStyle(paneLayout())}
    >
      <For each={gridSessions()}>
        {(s) => (
          <div
            class="terminal-pane"
            classList={{ "pane-waiting": s.status === "waiting", "pane-dead": s.status === "dead", "pane-selected": selected()?.id === s.id }}
            onClick={() => {
              // 페인을 직접 누르는 것이 가장 자연스러운 '봤다'다 (B64) — 레일 행 클릭에만 걸어
              // 두면 페인에서 답까지 마쳐도 미확인 점이 앱 바·관제 탭에 계속 켜져 있고 재시작해도
              // 남는다. markSeen은 변경이 없으면 방송하지 않는다
              setSelectedSession(s.id);
              backend.markSeen(s.id);
            }}
          >
            {/* 페인 헤더 문법 (0.5 §UX 기반) — 헤더는 div, 이름 영역이 줌 버튼, 칩 동작은 형제 버튼.
                [정체성 │ 요약(칩 없을 때만) │ 주의 칩 1개 + N │ 상태]. 접는 순서: 요약 → 직함 → 엔진 */}
            <div
              class="terminal-head pane-head mono"
              title={t("더블클릭하면 줌 토글 · 우클릭 세션 메뉴")}
              onContextMenu={(e) => openSessMenu(e, s)}
              // 0.4.2까지는 헤더 전체가 줌 버튼이었다 — 0.5 헤더 문법으로 이름 영역만 남으면서
              // 빈 자리를 눌러 줌하던 습관이 끊겼다. 빈 자리 더블클릭으로 되살린다(칩·버튼은 제 동작)
              onDblClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                applyZoom(zoomed() === s.id ? undefined : s.id);
              }}
            >
              <button
                class="pane-head-id"
                title={t("클릭하면 줌 토글 · 우클릭 세션 메뉴")}
                onClick={(e) => {
                  e.stopPropagation();
                  applyZoom(zoomed() === s.id ? undefined : s.id);
                }}
              >
                <Identity
                  slot={s.slot}
                  no={paneNo(s)}
                  name={sessionName(s, persona(s.personaId))}
                  persona={persona(s.personaId)?.name}
                  title={effectiveTitle(s, persona(s.personaId))}
                  cli={s.personaId ? cliOf(s) : undefined}
                  job={s.personaId ? jobMeta(s.jobId, jobName(s.jobId)).badge : undefined}
                />
              </button>
              {/* 마지막 한 줄 요약 (M35) — 주의 칩이 없을 때만, 남는 폭만 쓴다 */}
              <span class="pane-head-mid">
                <Show when={attnChips(s).length === 0 && s.lastRecap}>
                  <span class="mono muted pane-recap" title={s.lastRecap}>
                    {s.lastRecap}
                  </span>
                </Show>
              </span>
              <Show when={attnChips(s)[0]}>
                {(c) => (
                  <Chip tone={c().tone} text={c().text} short={c().short} title={c().title} action={c().action} onClick={c().onClick} />
                )}
              </Show>
              <Show when={attnChips(s).length > 1}>
                <Chip
                  text={`+${attnChips(s).length - 1}`}
                  title={t("나머지 신호 보기")}
                  onClick={() => {
                    const r = document.activeElement?.getBoundingClientRect();
                    setChipMenu({ x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4, s });
                  }}
                />
              </Show>
              <StatusLabel session={s} hideExit />
              {/* macOS — 맨 셸이면 실제로 뜬 셸 이름을 붙인다. 고른 셸과 뜬 셸이 다르면 여기서 보인다 (B114) */}
              <Show when={IS_MAC && s.status === "shell" && ptyShells()[s.id]}>
                {(sh) => <span class="mono muted"> · {sh()}</span>}
              </Show>
            </div>
            {/* 종료된 슬롯은 터미널 대신 다음 행동을 보여준다 — 재개 경로는 그 안에 있다 */}
            <Show when={s.status !== "dead" || isRespawning(s.id)} fallback={deadSlot(s)}>
              {/* 상주 상태 줄 (P2 U-1·U-7) — 역할 세션에 관리 에이전트가 없을 때 그 사실과 기동 버튼,
                  기동할 수 없으면 그 이유를 남긴다. 헤더와 터미널 사이 한 줄이라 출력을 가리지 않는다.
                  손으로 claude를 치면 EQMUX 환경변수·훅·역할이 안 붙으므로 기동은 이 버튼으로 한다 */}
              <Show when={paneNote(s)}>
                {(n) => (
                  <div class="pane-status mono" classList={{ warn: !n().launch }}>
                    <span class="pane-status-tx" title={n().text}>
                      {n().text}
                    </span>
                    <Show when={n().launch}>
                      <button
                        class="btn pane-status-btn"
                        title={t("이 셸을 끝내고 역할·권한·훅이 붙은 에이전트로 다시 엽니다")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void launchAgent(s);
                        }}
                      >
                        ▶ {tf("{engine} 기동", { engine: AGENT_CLI_LABEL[cliOf(s)] })}
                      </button>
                    </Show>
                  </div>
                )}
              </Show>
              <TerminalPane
                sessionId={s.id}
                cwd={s.cwd}
                wsId={props.workspace.id}
                shell={shellCmdFor(s)}
                // 셸 우선 모델 — 역할 세션도 agent 프로퍼티 없이 셸로 시작한다. 에이전트는
                // 사용자가 터미널에서 직접 띄우고, 관제가 Job 트리 감지로 표시한다.
                // 재개(FR-C-33)는 제안 게이트 대신 세션 상세·페인 메뉴의 명시 액션으로 남는다.
                revive={s.revived}
                mockLines={mockLines(s, persona(s.personaId)?.name ?? "?")}
                extraMenu={() => [
                  // 보기 — 배치·줌·전체 화면 (페인 헤더에서 버튼을 내려놓는 자리, 시안 §06)
                  [
                    {
                      label: t("배치"),
                      sub: PANE_LAYOUTS.map((l) => ({
                        label: t(l.name),
                        checked: paneLayout() === l.key,
                        action: () => setPaneLayout(l.key),
                      })),
                    },
                    { label: t(zoomed() === s.id ? "줌 해제" : "줌"), action: () => applyZoom(zoomed() === s.id ? undefined : s.id) },
                    { label: t("전체 화면"), kbd: t("ESC 종료"), action: () => setTerminalFull(true) },
                  ],
                  // 이동 — 상세 팝업·트랜스크립트 (레일 메뉴와 공유)
                  [detailItem(s), transcriptItem(s)],
                  // 위험 — 컴포넌트가 마지막 그룹으로 강제한다
                  removeGroup(s),
                ]}
              />
            </Show>
          </div>
        )}
      </For>
      <For each={Array.from({ length: zoomed() ? 0 : Math.max(0, maxSlots() - sessions().length) })}>
        {() => (
          <button class="terminal-pane pane-empty pane-add mono" title={t("빈 슬롯에 세션 추가")} onClick={openAdd}>
            {t("+ 세션 추가")}
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
  const memSession = () => {
    const s = selected();
    return s && s.status !== "dead" && s.memoryMb !== undefined ? s : undefined;
  };
  const statusBar = () => (
    <div class="terminal-statusbar mono">
      <span>
        <span style={{ color: "var(--eq-green)" }}>◉</span> {tf("PTY {n} 실행 중", { n: sessions().filter((x) => x.status !== "dead").length })}
      </span>
      <span>▦ {t(PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name ?? "")}</span>
      <Show when={attachedByEngine()}>{(txt) => <span>{txt()}</span>}</Show>
      {/* Session.scrollbackLines는 목 시드에만 값이 있다 — 실행 모드에서는 아무도 갱신하지
          않아 영원히 0.0K였다. 같은 줄의 WAL 칸이 이미 읽고 있는 실측을 쓴다 (B62) */}
      <span>
        {tf("출력 {k}K", {
          k: ((realUsage()?.total_lines ?? sessions().reduce((a, x) => a + x.scrollbackLines, 0)) / 1000).toFixed(1),
        })}
      </span>
      <span>
        {/* BR-13 — 실측이 없으면 비워 둔다. 예전 목 값(WAL 42ms)이 실제 앱에 보였다 */}
        {realUsage()
          ? tf("저장 {kb} KB · {n}줄", {
              kb: (realUsage()!.db_size_bytes / 1024).toFixed(0),
              n: realUsage()!.total_lines.toLocaleString(),
            })
          : t("저장 —")}
      </span>
      {/* 활성 세션 메모리 (FR-C-09 · C11) — Job Object 트리 실측, 10초 주기. dead는 마지막 샘플이 남으므로 숨긴다 */}
      <Show when={memSession()}>
        {(s) => (
          <span title={`${t("활성 세션 프로세스 트리 메모리")} · peak ${s().memoryPeakMb ?? "—"} MB`}>
            {tf("메모리 {mb} MB", { mb: s().memoryMb! })}
          </span>
        )}
      </Show>
      {/* 저장 기록 초기화 (FR-C-52) — 왼쪽 WAL·lines 수치의 짝. 실측이 있는 Tauri에서만 뜬다.
          지우는 것은 디스크 기록뿐이고 화면 스크롤백은 그대로 남는다 */}
      <Show when={realUsage()}>
        <button
          class="sb-ev"
          title={t("이 워크스페이스에 저장된 줄과 검색 색인을 비웁니다 — 화면 스크롤백은 그대로")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            setPurgeErr(undefined);
            setPurgeOpen(true);
          }}
        >
          ⌫ {t("기록 비우기")}
        </button>
      </Show>
      <button
        class="sb-ev"
        title={t("SessionService 이벤트 · 저장 상태")}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setEvOpen(!evOpen())}
      >
        {t("이벤트")} {evOpen() ? "▾" : "▸"}
      </button>
      <span class="muted" style={{ "margin-left": "auto" }}>
        {selected()?.cwd ?? props.workspace.path}
      </span>
      <Show when={evOpen()}>
        <div class="card sb-pop" onMouseDown={(e) => e.stopPropagation()}>
          <Eyebrow>SessionService {t("이벤트")} {t(isTauri() ? "(실측)" : "(목)")}</Eyebrow>
          <For each={stripEvents()}>
            {(e) => (
              <div class="mono muted" style={{ "font-size": "11px", "line-height": 1.7 }}>
                {e.time} {e.message}
              </div>
            )}
          </For>
          <div class="sb-pop-store mono muted">
            {t(realUsage() ? "저장 (실측)" : "저장 (목)")} ·{" "}
            {realUsage()
              ? `workspaces/${props.workspace.id}/session.db · ${t("100ms 배치 · 30일/1,000줄 보존")}`
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
          <span class="mono muted cc-count" title={`${props.workspace.branch ?? "—"} · ${sessions().length}/${maxSlots()}`}>
            {/* 1은 영어 단수라 키를 따로 둔다 — 한국어는 같은 글자 (U29) */}
            {sessions().length === 1 ? t("세션 1개") : tf("세션 {n}개", { n: sessions().length })}
            <Show when={engineCount() > 0}>
              {" "}· {engineCount() === 1 ? t("엔진 1종") : tf("엔진 {n}종", { n: engineCount() })}
            </Show>
          </span>
        </div>
        <div class="cc-seg">
          <button classList={{ on: centerTab() === "terminal" }} onClick={() => setCenterTab("terminal")}>
            {t("터미널")}
          </button>
          <button
            classList={{ on: centerTab() === "transcript" }}
            disabled={!selected()}
            onClick={() => setCenterTab("transcript")}
          >
            {t("트랜스크립트")}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {/* 응답 대기 (Focus) — 사람이 답해야 진행되는 페인이 있으면 상단 바가 먼저 알린다.
            누르면 가장 오래 기다린 페인을 그대로 잡는다. 대화로는 답할 수 없는 상태다 */}
        {/* 응답 대기가 있으면 amber, 없고 확인 신호만 있으면 blue (시안 HLeeM · d7GvE) — 이 워크스페이스 안에서만 돈다 (B88) */}
        <Show when={localAttention().length > 0}>
          <Chip
            tone={waitingSessions().length > 0 ? "amber" : (attnChips(localAttention()[0])[0]?.tone ?? "blue")}
            text={
              waitingSessions().length > 0
                ? `⛶ ${t("응답 대기")} ${waitingSessions().length}${
                    localAttention().length > waitingSessions().length ? ` · +${localAttention().length - waitingSessions().length}` : ""
                  }`
                : `⛶ ${t("확인")} ${localAttention().length}`
            }
            title={t("이 워크스페이스에서 볼 페인 — 누를 때마다 차례로 잡습니다. 답은 터미널에 직접 입력합니다. 모든 워크스페이스는 Ctrl+Shift+U")}
            onClick={nextLocal}
          />
        </Show>
        {/* 셸 선택 — 새로 추가하는 터미널부터 적용된다 */}
        <div class="shell-picker">
          <button class="btn ghost mono" title={t("새 터미널 셸 선택")} onClick={() => setShellMenuOpen(!shellMenuOpen())}>
            &gt;_ <span class="cc-btn-label">{t(defaultShell().name)}</span> ▾
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
                    <span style={{ "font-weight": 600 }}>{t(sh.name)}</span>
                    <span class="mono muted" style={{ "font-size": "10px" }}>
                      {sh.note ?? sh.cmd}
                    </span>
                  </button>
                )}
              </For>
              <div class="muted shell-menu-note">{t("새로 추가하는 터미널부터 적용됩니다")}</div>
            </div>
          </Show>
        </div>
        <Show when={zoomed()}>
          <button class="btn ghost" onClick={() => applyZoom(undefined)}>
            ▦ {t("그리드로 복귀")}
          </button>
        </Show>
        <Show when={!zoomed()}>
          <button class="btn ghost mono" title={t("페인 배치")} onClick={() => setLayoutPickerOpen(true)}>
            ▦ <span class="cc-btn-label">{t(PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name ?? "")}</span>
          </button>
        </Show>
        <button class="btn ghost" title={t("터미널 전체 화면 — ESC로 종료")} onClick={() => setTerminalFull(true)}>
          ⛶
        </button>
        <button
          class="btn"
          title={t("임무 · 캐스팅 · 팀 편성")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTeamMenu(teamMenu() ? undefined : { x: r.right - 232, y: r.bottom + 4 });
          }}
        >
          {t("팀")} ▾
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
                { label: t("임무 배정…"), action: () => setView({ kind: "missions", wsId: props.workspace.id }) },
                { label: t("팀 캐스팅…"), action: () => setView({ kind: "casting", wsId: props.workspace.id }) },
                { label: t("팀 편성…"), action: () => setView({ kind: "composition", wsId: props.workspace.id }) },
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

      <div class="screen-body cc-body" classList={{ "rail-closed": !railOpen() }}>
        {/* 좌: 세션 리스트 레일 — 아바타 전용 56px 레일의 후신. 가로형 리스트 버튼으로
            이름·직무를 직접 보여준다. 선택은 테두리, 상태는 점, LEAD는 slot 1 관례 */}
        <Show
          when={railOpen()}
          fallback={
            /* 접힌 레일 — 펼치기 버튼과 세션 번호 띠. 접어도 '누가 나를 불렀나'는 남긴다 (U43):
               미확인 점 · 우클릭 세션 메뉴 · 더블클릭 상세 · waiting은 클릭이 Focus · 빈 슬롯은 '+' 하나 */
            <div class="cc-rail cc-rail-mini">
              <button class="rail-toggle" title={t("레일 펼치기")} aria-label={t("레일 펼치기")} onClick={() => setRailOpen(true)}>
                ›
              </button>
              <For each={railItems().filter((it): it is Session => typeof it !== "number")}>
                {(s) => (
                  <button
                    class="rail-mini mono"
                    classList={{ sel: selected()?.id === s.id }}
                    title={[
                      `${paneNo(s)} ${sessionName(s, persona(s.personaId))}${s.peerName ? ` · ${s.peerName}` : ""}`,
                      attnChips(s)[0]?.text ?? statusText(s.status),
                      s.status === "waiting" ? t("Focus — 이 페인을 전체 화면으로 잡고 키보드를 넘깁니다") : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    onClick={() => {
                      if (s.status === "waiting") return focusSession(s);
                      setSelectedSession(s.id);
                      backend.markSeen(s.id);
                      setCenterTab("terminal");
                    }}
                    onDblClick={() => (setSelectedSession(s.id), setDetailOpen(true))}
                    onContextMenu={(e) => openSessMenu(e, s)}
                  >
                    <span class={attnChips(s)[0] ? `rail-attn ${attnChips(s)[0]!.tone}` : `sdot ${s.status}`} />
                    <PaneNoText slot={s.slot} no={paneNo(s)} />
                    <Show when={s.unseen}>
                      <span class="unread-dot rail-unread" title={t("미확인")} />
                    </Show>
                  </button>
                )}
              </For>
              <Show when={emptySlots().length > 0}>
                <button class="rail-mini mono" title={t("세션 추가")} aria-label={t("세션 추가")} onClick={openAdd}>
                  +
                </button>
              </Show>
            </div>
          }
        >
        <div class="cc-rail">
          <div class="rail-head mono">
            {t("슬롯 목록")}
            <button class="rail-toggle" title={t("레일 접기")} aria-label={t("레일 접기")} onClick={() => setRailOpen(false)}>
              ‹
            </button>
          </div>
          <For each={railItems()}>
            {(it) =>
              typeof it === "number" ? (
                /* 빈 슬롯 — 번호를 그대로 보여 슬롯이 곧 번호임을 드러낸다. 누르면 세션 추가 */
                <button class="rail-av rail-empty" title={t("빈 슬롯에 세션 추가 — 클로드코드 · 코덱스 · 기본 터미널")} onClick={openAdd}>
                  <span class="rail-dot-empty" />
                  <span class="rail-no mono">{slotNo(it)}</span>
                  <span class="rail-nm">{t("빈 슬롯")}</span>
                </button>
              ) : (
                railRow(it)
              )
            }
          </For>
          <div class="rail-sep" />
          {/* 로컬 폴더 — 이 워크스페이스의 작업 폴더. 클릭은 앱 안의 파일 탐색기로 간다
              (M25 전체 화면 팝업, 스코프는 현재 워크스페이스). 임무는 "팀 ▾"에 있다.
              탐색기가 곧 파일 원본이므로 Windows 탐색기로 나가지 않는다 — 편집·미리보기가
              앱 안에서 끝나야 세션 문맥(선택·대화)을 잃지 않는다. */}
          <button
            class="rail-ms rail-folder"
            title={`${props.workspace.path} — ${t("앱 내 파일 탐색기에서 열기")}`}
            onClick={() => toggleExplorer("explorer")}
          >
            <span class="rail-folder-txt">
              <span class="eyebrow">{t("로컬 폴더")}</span>
              <span class="rail-folder-path mono">{shortPath(props.workspace.path)}</span>
            </span>
            <span class="rail-folder-go mono" aria-hidden="true">
              ▸
            </span>
          </button>
          {/* 브랜치 현황 — 클릭은 git 패널. 비저장소면 행을 숨긴다 */}
          <Show when={gitBranch()}>
            <button class="rail-ms rail-folder" title={t("git 패널에서 보기")} onClick={() => openPanel("git")}>
              <span class="rail-folder-txt">
                <span class="eyebrow">{t("브랜치")}</span>
                <span class="rail-folder-path mono">⎇ {gitBranch()}</span>
                <Show when={gitInfo()}>
                  {(g) => (
                    <span class="rail-git-stat mono muted">
                      ↑{g().ahead} ↓{g().behind} · {tf("변경 {n}", { n: g().changed })}
                    </span>
                  )}
                </Show>
              </span>
              <span class="rail-folder-go mono" aria-hidden="true">
                ▸
              </span>
            </button>
          </Show>
          {/* 워크트리 목록 — 표시 전용. 행 = 브랜치 + 귀속 세션(cwd 일치). 본체 하나뿐이면 숨긴다 */}
          <Show when={worktrees().length > 1}>
            <div class="rail-sep" />
            <div class="rail-wt-head">
              <span class="eyebrow">{t("워크트리")}</span>
              <b class="mono">{worktrees().length}</b>
            </div>
            <div class="rail-wt-list">
              <For each={worktrees()}>
                {(wt) => (
                  <div class="rail-wt">
                    <div class="rail-wt-top">
                      <span class="rail-wt-name mono" title={wt.path}>
                        ⎇ {wt.branch ?? `detached @ ${wt.head}`}
                      </span>
                      <span class="rail-wt-tag mono" classList={{ main: wt.isMain }}>
                        {t(wt.isMain ? "메인" : wt.isSession ? "세션" : "외부")}
                      </span>
                    </div>
                    <div class="rail-wt-path mono muted" title={wt.path}>
                      {wtTail(wt.path)}
                    </div>
                    <For each={wtMembers(wt)}>
                      {(s) => (
                        <button
                          class="rail-wt-agent mono"
                          classList={{ sel: selected()?.id === s.id }}
                          title={statusText(s.status)}
                          onClick={() => {
                            setSelectedSession(s.id);
                            backend.markSeen(s.id);
                            setCenterTab("terminal");
                          }}
                        >
                          <span class={`sdot ${s.status}`} />
                          <span class="rail-wt-agent-nm">{sessionDisplayName(s, personaName(s.personaId))}</span>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
        </Show>

        {/* 중: 터미널 2×2 그리드 / 트랜스크립트 — 탭·도구는 상단 바에 병합됐다 (시안 §04) */}
        <div class="cc-center">
          {/* 전체 화면 중에는 일반 그리드를 언마운트한다 — 같은 PTY에 두 인스턴스가
              서로 다른 크기로 resize 경합하면 ConPTY 리페인트가 폭증한다 */}
          <Show when={centerTab() === "terminal" && !terminalFull()}>
            {paneGrid()}
            {statusBar()}
          </Show>

          <Show when={centerTab() === "transcript" && selected()}>
            {(s) => <TranscriptPane session={s()} onJump={() => setCenterTab("terminal")} />}
          </Show>
        </div>
      </div>

      {/* 세션 상세 — 우측 드로어 (U1). 관제 대상(터미널)을 가리지 않고 옆에 선다.
          레일 ⓘ·페인 메뉴 "세션 상세"가 연다 */}
      <Show when={detailOpen() && selected()}>
        {(s) => (
          <div class="overlay detail-overlay" onClick={() => setDetailOpen(false)}>
            <div class="dialog detail-dialog" onClick={(e) => e.stopPropagation()}>
              <button class="detail-dialog-x" title={t("닫기 (ESC)")} onClick={() => setDetailOpen(false)}>
                <Icon name="x" size={11} />
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
              ⛶ {props.workspace.name} <span class="muted">· {tf("세션 {n}/{max} · 터미널 집중", { n: sessions().length, max: maxSlots() })}</span>
            </span>
            <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
              <Show when={zoomed()}>
                <button class="btn ghost" onClick={() => applyZoom(undefined)}>
                  ▦ {t("그리드로 복귀")}
                </button>
              </Show>
              <Show when={!zoomed()}>
                <button class="btn ghost mono" title={t("페인 배치")} onClick={() => setLayoutPickerOpen(true)}>
                  ▦ {t(PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name ?? "")}
                </button>
              </Show>
              <span class="mono muted" style={{ "font-size": "10px" }}>
                {t("ESC 종료")}
              </span>
              <button class="btn" onClick={() => setTerminalFull(false)}>
                <Icon name="x" size={11} /> {t("전체 화면 종료")}
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

      {/* 세션 추가 — 여는 것을 그대로 고른다 (클로드코드 · 코덱스 · 기본 터미널).
          설치되지 않은 CLI는 카드를 내놓지 않는다 — 눌러 봐야 command not found가 전부다. */}
      {/* 세션 만들기 (시안 xukml) — 제목에 슬롯 번호, 세그먼트로 기본 터미널 · 역할 세션을 가른다 */}
      <Show when={addOpen()}>
        <div class="overlay" onClick={() => setAddOpen(false)}>
          <div ref={addBox} class="dialog create-dlg" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="create-t">
              {tf("슬롯 {no}에 세션 만들기", { no: emptySlots()[0] ? slotNo(emptySlots()[0]) : "—" })}
            </div>
            <Segmented
              items={[
                { value: "shell", label: t("기본 터미널") },
                { value: "role", label: t("역할 세션") },
              ]}
              value={addMode()}
              onChange={setAddMode}
              label={t("세션 종류")}
            />

            <Show when={addMode() === "role"}>
              <Show
                when={availablePersonas().length > 0}
                fallback={<div class="muted mono create-note">{t("남은 페르소나가 없습니다")}</div>}
              >
                <label class="create-f">
                  <span class="create-l">{t("페르소나")}</span>
                  <select
                    value={addPersona()}
                    onChange={(e) => {
                      setAddPersona(e.currentTarget.value);
                      setAddJob(personaJobId(e.currentTarget.value));
                    }}
                  >
                    <For each={availablePersonas()}>
                      {(p) => (
                        <option value={p.id} selected={p.id === addPersona()}>
                          {p.name}
                          {p.title ? ` · ${p.title}` : ""} ({jobName(personaJobId(p.id))})
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                {/* 엔진 (M37) — 둘 다 같은 역할·훅·메시지 버스가 붙는다. 미설치면 바로 아래에 설치 명령 */}
                <label class="create-f">
                  <span class="create-l">{t("엔진")}</span>
                  <select value={addCli()} onChange={(e) => setAddCli(e.currentTarget.value as AgentCliId)}>
                    <For each={managedClis()}>
                      {(c) => (
                        <option value={c} selected={c === addCli()}>
                          {AGENT_CLI_LABEL[c]}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <Show when={addCliMissing()}>
                  <div class="engine-missing mono">
                    <div class="st-dead">{tf("PATH에 {cmd}가 없습니다 — 아래 명령으로 설치한 뒤 다시 감지하세요", { cmd: addCli() })}</div>
                    <div class="engine-install">
                      <code>{INSTALL_CMD[addCli()]}</code>
                      <button class="btn ghost" onClick={() => clipWriteText(INSTALL_CMD[addCli()])}>
                        {t("복사")}
                      </button>
                      <button class="btn ghost" onClick={() => void refreshAgentClis()}>
                        {t("다시 감지")}
                      </button>
                    </div>
                  </div>
                </Show>
                <label class="create-f">
                  <span class="create-l">{t("직무")}</span>
                  <select value={addJob()} onChange={(e) => setAddJob(e.currentTarget.value)}>
                    <For each={backend.listJobs()}>
                      {(j) => (
                        <option value={j.id} selected={j.id === addJob()}>
                          {j.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>
            </Show>

            {/* 이름 — 두 종류 공통. 자리표시자가 비워 두면 붙을 이름을 보인다 */}
            <label class="create-f">
              <span class="create-l">{t("이름")}</span>
              <input
                ref={(el) => setTimeout(() => el.focus())} // 첫 포커스 (U45)
                value={addName()}
                maxLength={SESSION_NAME_MAX}
                placeholder={
                  addMode() === "role"
                    ? tf("비워 두면 {name}", { name: availablePersonas().find((p) => p.id === addPersona())?.name ?? "" })
                    : tf("비워 두면 {name}", { name: backend.autoSessionName(props.workspace.id) })
                }
                onInput={(e) => setAddName(e.currentTarget.value.replace(/[\r\n]/g, ""))}
              />
            </label>
            <FieldHint
              error={addNameErr() && t(addNameErr()!)}
              hint={t("24자 이내 · 공백·@·줄바꿈 불가 · 만들 때 한 번 정해져 폴더 이름이 바뀌어도 그대로")}
              count={addName().length}
              max={SESSION_NAME_MAX}
            />
            <Show when={addNameErr() === "이 워크스페이스에서 이미 쓰는 이름입니다"}>
              <button class="btn ghost create-suggest" onClick={() => setAddName(backend.autoSessionName(props.workspace.id))}>
                {tf("{name} 쓰기", { name: backend.autoSessionName(props.workspace.id) })}
              </button>
            </Show>

            <Show when={addMode() === "shell"}>
              <label class="create-f">
                <span class="create-l">{t("셸")}</span>
                <select value={addShell()} onChange={(e) => setAddShell(e.currentTarget.value)}>
                  <For each={SHELLS}>
                    {(sh) => (
                      <option value={sh.label} selected={sh.label === addShell()}>
                        {t(sh.name)}
                        {sh.label === defaultShell().label ? ` (${t("기본 셸")})` : ""}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <div class="create-kv">
                <span class="create-l">{t("브랜치")}</span>
                <span class="mono">{props.workspace.branch ?? "—"}</span>
              </div>
              {/* 셸 실행 에이전트 — PATH에 있는 것만. 명령을 치는 것과 같아서 EQMUX가 붙이는 것은 없다 */}
              <For each={shellClis()}>
                {(a) => (
                  <button
                    class="card add-choice"
                    title={tf("셸에서 {cmd} 실행 · 역할·훅·재개는 붙지 않고 관제에는 실행 중으로만 보입니다", { cmd: a.cmd })}
                    disabled={addNoSlot()}
                    onClick={() => addCliSession(a.cmd)}
                  >
                    <span style={{ "font-weight": 700, "font-size": "12px" }}>◆ {tf("{name} 열기", { name: a.name })}</span>
                    <span class="mono muted">→</span>
                  </button>
                )}
              </For>
            </Show>

            <Show when={addMode() === "role" && availablePersonas().length > 0}>
              {/* 세션 격리 (FR-E-62 · E1′) — 기본은 repo 공유 (FR-E-60) */}
              <label class="mono muted create-check">
                <input type="checkbox" checked={addWorktree()} onChange={(e) => setAddWorktree(e.currentTarget.checked)} />
                {t("워크트리 격리 — .eqmux/worktrees/<세션> · 전용 브랜치 eqmux/<세션>")}
              </label>
              <Show when={addWorktree()}>
                <div class="muted create-note">
                  {t("의존성(node_modules 등)은 워크트리마다 별도입니다. 제거 시 워크트리는 남습니다 — 머지·정리는 사람이 합니다")}
                </div>
              </Show>
              <Show when={addErr()}>
                <div class="mono st-dead create-note">{addErr()}</div>
              </Show>
            </Show>

            {/* 빈 슬롯이 없으면 만들 수 없다 (B84) — 눌러도 조용히 닫히던 것을 막고 이유를 보인다 */}
            <Show when={addNoSlot()}>
              <div class="mono st-dead create-note">{t("빈 슬롯이 없습니다 — 슬롯을 비운 뒤 만드세요")}</div>
            </Show>
            <div class="eq-confirm-f">
              <button class="btn" onClick={() => setAddOpen(false)}>
                {t("취소")}
              </button>
              <Show
                when={addMode() === "role"}
                fallback={
                  <button class="btn primary" disabled={!!addNameErr() || addNoSlot()} onClick={addTerminal}>
                    {t("열기")}
                  </button>
                }
              >
                <button
                  class="btn primary"
                  disabled={!!addNameErr() || availablePersonas().length === 0 || addCliMissing() || addNoSlot()}
                  title={addCliMissing() ? t("엔진이 설치되지 않아 기동할 수 없습니다 — 설치 후 다시 감지하세요") : undefined}
                  onClick={() => void addRoleSession()}
                >
                  ▶ {tf("{engine} 기동", { engine: AGENT_CLI_LABEL[addCli()] })}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* 세션 제거 확인 — 역할 세션은 편성 슬롯·임무 배정에도 영향이 있어 문구가 다르다 */}
      <Show when={removeTarget()}>
        {(rt) => (
          <ConfirmDialog
            title={tf(
              removeThenAdd()
                ? "{no} {name} 슬롯을 비우고 새로 만들까요?"
                : rt().personaId
                  ? "{no} {name} 역할 세션을 제거할까요?"
                  : "{no} {name} 기본 터미널을 제거할까요?",
              {
              no: slotNo(rt().slot),
              name: sessionName(rt(), persona(rt().personaId)),
            })}
            body={
              rt().personaId
                ? t("제거하면 팀 편성의 이 슬롯이 비워지고 임무 배정이 해제되며 PTY 프로세스가 종료됩니다. 변경은 다음 캐스팅 저장 때 .eqmux/team.json에 반영됩니다.")
                : tf("셸 프로세스를 끝내고 이 슬롯({no})을 비웁니다. 되돌릴 수 없습니다. 스크롤백은 30일 보존 규칙대로 남습니다.", { no: slotNo(rt().slot) })
            }
            info={
              rt().personaId
                ? [`${t("세션")}  ${rt().id} · ${t("슬롯")} ${slotNo(rt().slot)}`, `${t("작업 폴더")}  ${rt().cwd || props.workspace.path}`]
                : [
                    `${t("셸")}  ${rt().shell}${rt().pid ? ` · PID ${rt().pid}` : ""}`,
                    `${t("작업 폴더")}  ${rt().cwd || props.workspace.path}`,
                    `${t("이름")}  ${sessionName(rt(), undefined)}`,
                  ]
            }
            danger
            confirmLabel={removeThenAdd() ? t("비우고 새로 만들기") : t("제거")}
            onConfirm={() => doRemove(rt())}
            onCancel={() => (setRemoveTarget(undefined), setRemoveThenAdd(false))}
          />
        )}
      </Show>
      {/* +N — 헤더에 못 올라간 나머지 신호. 동작이 있는 칩은 그 동작을 메뉴 항목으로 */}
      <Show when={chipMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            onClose={() => setChipMenu(undefined)}
            groups={[
              attnChips(m().s)
                .slice(1)
                .map((c) => ({
                  label: c.action ? `${c.text} — ${c.action.label}` : c.text,
                  action: c.action?.onClick ?? c.onClick,
                  note: !c.action && !c.onClick,
                })),
            ]}
          />
        )}
      </Show>
      {/* 손으로 띄운 에이전트 인박스 (BR-02 · C5) — 앱은 그 세션의 승인 창을 모른다. 사람이 보고 넣는다 */}
      <Show when={inboxPop()}>
        {(id) => {
          // 행 체크 (U51) — 기본 전부 선택. 꺼 둔 id만 들고 있다
          const [off, setOff] = createSignal(new Set<string>());
          const picked = () => new Set(pendingFor(id()).filter((m) => !off().has(m.id)).map((m) => m.id));
          return (
          <div class="overlay" onClick={() => setInboxPop(undefined)}>
            <div ref={inboxBox} class="dialog eq-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div class="eq-confirm-t">
                {tf("{name}에 쌓인 메시지 {n}건", { name: nameOfId(id()), n: pendingFor(id()).length })}
              </div>
              <div class="inbox-pop-list">
                <For each={pendingFor(id())}>
                  {(m) => (
                    <label class="inbox-pop-row">
                      <input
                        type="checkbox"
                        checked={!off().has(m.id)}
                        onChange={(e) => {
                          const n = new Set(off());
                          if (e.currentTarget.checked) n.delete(m.id);
                          else n.add(m.id);
                          setOff(n);
                        }}
                      />{" "}
                      <span class="mono muted">
                        {m.time} · {m.type} · {senderLabel(m.from, backend.listSessions().find((x) => x.id === id())?.workspaceId)}
                      </span>{" "}
                      {m.body}
                    </label>
                  )}
                </For>
              </div>
              <div class="inbox-pop-warn">{t("승인 창이 떠 있으면 먼저 답하세요. 넣기는 본문과 Enter를 그대로 보냅니다.")}</div>
              <div class="eq-confirm-f">
                <button class="btn" onClick={() => setInboxPop(undefined)}>
                  {t("닫기")}
                </button>
                <button
                  class="btn danger"
                  disabled={picked().size === 0}
                  title={t("넣지 않고 치웁니다 — 원문은 대화 기록에 남습니다")}
                  onClick={() => {
                    discardPending(id(), picked());
                    if (pendingFor(id()).length === 0) setInboxPop(undefined);
                  }}
                >
                  {tf("{n}건 버리기", { n: picked().size })}
                </button>
                <button
                  class="btn primary"
                  disabled={picked().size === 0}
                  onClick={() => {
                    if (!injectPending(id(), picked())) notify(t("페인에 치던 줄이 있어 넣지 않았습니다 — 줄을 비우고 다시 누르세요"));
                    else if (pendingFor(id()).length === 0) setInboxPop(undefined);
                  }}
                >
                  {tf("{n}건 넣기", { n: picked().size })}
                </button>
              </div>
            </div>
          </div>
          );
        }}
      </Show>
      <Show when={reportAsk()}>
        {(ra) => (
          <ConfirmDialog
            title={tf("{name}에게 보고 요청", { name: sessionName(ra(), persona(ra().personaId)) })}
            body={t("이 메시지가 그 세션에 들어갑니다. 앱이 스스로 보내지 않습니다.")}
            info={[`[EQ·ask] ${t("나")}: ${t("맡은 일의 결과를 eqmux report --done 으로 알려 주세요")}`]}
            confirmLabel={t("보내기")}
            onConfirm={() => {
              const s = ra();
              setReportAsk(undefined);
              void sendConversation(s.workspaceId, s.id, "ask", t("맡은 일의 결과를 eqmux report --done 으로 알려 주세요")).then(
                (err) => err && notify(err),
              );
            }}
            onCancel={() => setReportAsk(undefined)}
          />
        )}
      </Show>
      <Show when={stopTarget()}>
        {(st) => (
          <StopConfirm
            session={st()}
            name={sessionName(st(), persona(st().personaId))}
            openHandoff={backend.openHandoff(st().id)}
            onConfirm={() => {
              if (isTauri()) killPty(st().id);
              backend.stopSession(st().id);
              setStopTarget(undefined);
            }}
            onCancel={() => setStopTarget(undefined)}
          />
        )}
      </Show>
      {/* 저장 기록 초기화 확인 — 역할 세션 제거와 같은 형태. 무엇이 남는지까지 적는다 */}
      <Show when={purgeOpen()}>
        <div class="overlay" onClick={() => setPurgeOpen(false)}>
          <div
            ref={purgeBox}
            class="dialog"
            role="dialog"
            aria-modal="true"
            style={{ width: "440px", padding: "16px 18px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ "font-weight": 800, "font-size": "14px" }}>{t("저장 기록 초기화")}</div>
            <div class="mono muted" style={{ "font-size": "12px", margin: "6px 0 10px" }}>
              workspaces/{props.workspace.id}/session.db · WAL{" "}
              {((realUsage()?.db_size_bytes ?? 0) / 1024).toFixed(0)} KB ·{" "}
              {(realUsage()?.total_lines ?? 0).toLocaleString()} lines
            </div>
            <div class="card inset" style={{ padding: "8px 10px", "font-size": "11px", "line-height": 1.6 }}>
              {t("저장된 스크롤백과 검색 색인을 모두 비우고 WAL을 접습니다. 세션 목록·이벤트·대화·재개 정보와 화면에 떠 있는 스크롤백은 그대로 남습니다. 되돌릴 수 없습니다.")}
            </div>
            <Show when={purgeErr()}>
              <div class="mono" style={{ color: "var(--eq-red)", "font-size": "11px", "margin-top": "8px" }}>
                {t("초기화 실패")} — {purgeErr()}
              </div>
            </Show>
            <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
              <button class="btn" onClick={() => setPurgeOpen(false)}>
                {t("취소")}
              </button>
              <button class="btn danger" disabled={purging()} onClick={() => void doPurge()}>
                {purging() ? t("비우는 중…") : t("기록 비우기")}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
