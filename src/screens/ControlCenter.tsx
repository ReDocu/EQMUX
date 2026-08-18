// 컨트롤 센터 (bi8Au) — 워크스페이스 탭의 기준 화면. 팀·세션 카드 / 터미널·저장·이벤트 / 인스펙터.
// 터미널 텍스트는 목 출력이다 — M1에서 xterm.js + Rust PTY로 실물이 된다.
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
import type { MenuGroup } from "../components/ui";
import { resumeAgent } from "../backend/agent";
import { queryEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { branchList, worktreeAdd, worktreeAttach, worktreeList } from "../backend/git";
import type { BranchInfo, WorktreeInfo } from "../backend/git";
import { autoAssignDefault, refreshMissions } from "../backend/missions";
import { clipWriteText, echoPty, isTauri, killPty, storeUsageReal } from "../backend/pty";
import type { StoreUsageReal } from "../backend/pty";
import { removeRoleFile } from "../backend/roles";
import { maxSlots } from "../backend/settings";
import { ensureWorktree } from "../backend/team";
import { gridTemplateStyle, PaneDividers } from "../components/PaneDividers";
import { SidePanel } from "../components/SidePanel";
import {
  disposeSessionTerminal,
  isRespawning,
  launchAgentInSession,
  respawnSessionShell,
  sessionTermSize,
  syncSessionTerminal,
  TerminalPane,
} from "../components/TerminalPane";
import { t } from "../i18n";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { TranscriptPane } from "./TranscriptPane";
import type { Session, Workspace } from "../types";
import { effectivePermissions, sessionDisplayName } from "../types";

// 세션 상태별 목 터미널 출력 — 2×2 그리드 시각 검증용 (Tauri 밖 폴백 전용)
function mockLines(s: Session, personaName: string): string[] {
  // 셸 우선 모델 — 역할 세션도 셸 프롬프트로 시작한다. 에이전트 출력은 직접 띄운 뒤의 모습.
  if (!s.personaId || s.status === "shell") return ["PowerShell 7.6.4", `PS ${s.cwd}> _`];
  const base = [`PS ${s.cwd}> claude`, `Claude Code ${s.agentVersion ?? "2.1.226"} · ${personaName}`];
  if (s.status === "waiting") return [...base, "⏸ 승인 대기 — " + (s.waitingFor ?? ""), "y/n 을 입력하세요"];
  if (s.status === "dead") return [...base, `프로세스 종료 · exit ${s.exitCode ?? "?"}`, s.resumable ? "재개 가능 — --resume" : "재개 불가"];
  if (s.status === "busy") return [...base, `⚙ ${s.lastOutput}`, `서브에이전트 ${s.subagents} · ${(s.scrollbackLines / 1000).toFixed(1)}K lines`];
  return [...base, `● ${s.lastOutput || "대기 중"}`];
}

export function ControlCenter(props: { workspace: Workspace }) {
  // 상태바·레일·메뉴 등 수십 곳이 읽는다 — 메모로 브로드캐스트(tick)당 1회만 필터·정렬한다
  const sessions = createMemo(() => {
    tick();
    return backend
      .listSessions()
      .filter((s) => s.workspaceId === props.workspace.id)
      .sort((a, b) => a.slot - b.slot);
  });
  const missions = () => {
    tick();
    return backend.listMissions().filter((m) => m.workspaceId === props.workspace.id);
  };
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
        if (zoomed()) applyZoom(undefined);
        else setTerminalFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // 역할 없는 셸 세션(기본 터미널)은 페르소나·직무 대신 고정 라벨을 쓴다
  const personaName = (id: string) => persona(id)?.name ?? t("기본 터미널");
  const jobName = (id: string) => job(id)?.name ?? t("셸");

  // ── 워크트리 레일 (orca식) — 임무 아래에 작업 트리별 현황을 상주시킨다.
  // 행 = 브랜치 + 귀속 세션(cwd 일치, 상태 점 포함) — orca의 worktree 카드 + agents 목록에 대응.
  // 조작은 git 패널과 같은 안전 범위(M36): 목록·생성·셸 열기. 삭제는 없다 (FR-E-64 — 정리는 사람 몫).
  const [worktrees, setWorktrees] = createSignal<WorktreeInfo[]>([]);
  const [wtBranches, setWtBranches] = createSignal<BranchInfo[]>([]);
  let wtReq = 0; // 폴링·생성 완료의 늦은 응답이 최신 목록을 덮지 않게 (D-12 패턴)
  const loadWorktrees = async () => {
    if (!isTauri() || props.workspace.pathMissing) return;
    const req = ++wtReq;
    const [wt, b] = await Promise.all([worktreeList(props.workspace.path), branchList(props.workspace.path)]);
    if (req !== wtReq) return;
    setWorktrees(wt ?? []);
    setWtBranches(b ?? []);
  };
  onMount(() => {
    if (!isTauri()) return;
    void loadWorktrees();
    const t = setInterval(() => void loadWorktrees(), 10_000); // git 패널과 같은 10초 실측 주기
    onCleanup(() => clearInterval(t));
  });
  // 브라우저 dev 폴백 — 메인 + 워크트리 세션의 cwd로 시각 검증용 목록을 합성한다
  const wtRows = (): WorktreeInfo[] =>
    isTauri()
      ? worktrees()
      : [
          { path: props.workspace.path, branch: props.workspace.branch ?? "main", head: "", isMain: true, isSession: false },
          ...sessions()
            .filter((s) => s.worktree)
            .map((s) => ({ path: s.cwd, branch: `eqmux/${s.id}`, head: "", isMain: false, isSession: true })),
        ];
  const normPath = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  /** 이 워크트리에서 도는 세션들 — cwd 실측 일치. orca의 "N agents" 목록에 해당 */
  const wtMembers = (wt: WorktreeInfo) => sessions().filter((s) => normPath(s.cwd) === normPath(wt.path));
  const wtLabel = (wt: WorktreeInfo) => wt.branch ?? `detached @ ${wt.head}`;
  const wtTail = (p: string) => p.replace(/\\/g, "/").split("/").slice(-2).join("/");
  const openWtShell = (wt: WorktreeInfo) => {
    backend.addTerminal(props.workspace.id, defaultShell().label, wt.path);
  };
  // 생성 팝오버 — git 패널과 같은 계약: .eqmux/worktrees/<이름> + 브랜치 eqmux/<이름>.
  // "기존 브랜치" 모드(레일 §워크트리)는 새 브랜치 없이 그 브랜치를 체크아웃해 연결한다
  const [wtFormOpen, setWtFormOpen] = createSignal(false);
  const [wtMode, setWtMode] = createSignal<"new" | "attach">("new");
  const [wtName, setWtName] = createSignal("");
  const [wtBase, setWtBase] = createSignal("");
  const [wtAttachBranch, setWtAttachBranch] = createSignal("");
  const [wtOpenShell, setWtOpenShell] = createSignal(true); // orca처럼 만든 트리에 바로 세션을 태우는 흐름
  const [wtBusy, setWtBusy] = createSignal(false);
  const [wtErr, setWtErr] = createSignal<string | undefined>(undefined);
  /** 연결 가능한 브랜치 — 로컬이면서 어떤 워크트리에도 체크아웃돼 있지 않은 것 (git: 같은 브랜치는 한 트리에만) */
  const attachable = () => wtBranches().filter((b) => !b.remote && !worktrees().some((wt) => wt.branch === b.name));
  const createWt = async () => {
    const attach = wtMode() === "attach";
    if (wtBusy() || (attach ? !wtAttachBranch() : !wtName().trim())) return;
    if (!isTauri()) {
      setWtErr(t("브라우저 dev — 실제 생성 없음"));
      return;
    }
    setWtErr(undefined);
    setWtBusy(true);
    try {
      const path = attach
        ? await worktreeAttach(props.workspace.path, wtAttachBranch())
        : await worktreeAdd(props.workspace.path, wtName().trim(), wtBase() || undefined);
      setWtFormOpen(false);
      setWtName("");
      setWtBase("");
      setWtAttachBranch("");
      if (wtOpenShell()) backend.addTerminal(props.workspace.id, defaultShell().label, path);
      await loadWorktrees();
    } catch (err) {
      setWtErr(String(err));
    } finally {
      setWtBusy(false);
    }
  };
  // 행 우클릭 메뉴 — 셸 열기·경로 복사. 없는 액션은 정책상 없는 것 (G7·FR-E-64)
  const [wtMenu, setWtMenu] = createSignal<{ x: number; y: number; wt: WorktreeInfo } | undefined>(undefined);

  // 브랜치 부여 (터미널 우클릭 §브랜치) — 셸 터미널을 그 브랜치의 워크트리로 옮긴다.
  // 트리가 없으면 attach로 만들고(레일 §워크트리와 같은 계약), PTY는 같은 세션 id로 새 cwd에서 재스폰한다.
  const assignBranch = async (s: Session, branch: string) => {
    if (!isTauri()) return; // 브라우저 dev — 메뉴에 note로 명시된다
    try {
      const wt = worktrees().find((w) => w.branch === branch);
      const path = wt ? wt.path : await worktreeAttach(props.workspace.path, branch);
      if (normPath(path) === normPath(s.cwd)) return;
      await respawnSessionShell(s.id, path, props.workspace.id, shellCmdFor(s));
      backend.setSessionCwd(s.id, path);
      await loadWorktrees();
    } catch (err) {
      // 실패는 그 페인에 정직하게 표시 (FR-D-08) — PTY 입력을 거치지 않는 표시 전용 에코
      echoPty(s.id, `\r\n\x1b[31m${t("브랜치 부여 실패")} — ${String(err)}\x1b[0m\r\n`);
    }
  };
  // 기본 터미널 전용 메뉴 그룹 — 역할 세션 cwd는 역할 파일·transcript와 묶여 있어 옮기지 않는다 (FR-E-63)
  const branchAssignGroup = (s: Session): MenuGroup[] => {
    if (s.personaId) return [];
    const local = wtBranches().filter((b) => !b.remote);
    const cwd = normPath(s.cwd); // 브랜치 × 워크트리 이중 순회 방지 — 한 번씩만 정규화·색인한다
    const byBranch = new Map(worktrees().map((w) => [w.branch, w]));
    return [
      [
        {
          label: t("브랜치 부여"),
          sub:
            local.length === 0
              ? [{ label: t(isTauri() ? "로컬 브랜치 없음" : "브라우저 dev — 실측 없음"), note: true }]
              : local.map((b) => {
                  const wt = byBranch.get(b.name);
                  const cur = !!wt && normPath(wt.path) === cwd;
                  return {
                    label: wt ? `⎇ ${b.name}` : `⎇ ${b.name} · ${t("새 워크트리")}`,
                    checked: cur,
                    disabled: cur,
                    action: () => void assignBranch(s, b.name),
                  };
                }),
        },
      ],
    ];
  };

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
    { label: t(s.personaId ? "역할 세션 제거…" : "터미널 제거"), danger: true, action: () => removeTerminal(s) },
  ];
  const sessMenuGroups = (s: Session) => [
    [
      {
        label: t("페인으로 점프"),
        action: () => {
          setSelectedSession(s.id);
          backend.markSeen(s.id);
          setCenterTab("terminal");
        },
      },
      detailItem(s),
      transcriptItem(s),
    ],
    [
      {
        label: t("에이전트 기동"),
        disabled: !needsAgent(s),
        action: () => void launchAgent(s),
      },
      {
        label: t("재개"),
        disabled: !s.resumable || (s.status !== "dead" && !s.restored),
        action: () => void resumeInline(s),
      },
      {
        label: t("중지"),
        disabled: s.status === "dead",
        action: () => {
          if (isTauri()) killPty(s.id);
          backend.stopSession(s.id);
        },
      },
    ],
    // 브랜치 부여 (기본 터미널 전용) — 그 브랜치의 워크트리로 이동, 없으면 만들어 연결
    ...branchAssignGroup(s),
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
  };
  // ✕ 분기 — 기본 터미널은 즉시 제거, 역할 팀 세션은 편성·임무 영향이 있어 확인을 거친다
  const removeTerminal = (s: Session) => {
    if (!s.personaId) doRemove(s);
    else setRemoveTarget(s);
  };

  /** 관리되는 에이전트의 기동 인자 — 역할 세션에만 있다 (기본 터미널은 셸로 남는다) */
  const roleAgent = (s: Session) => {
    if (!s.personaId) return undefined;
    const p = effectivePermissions(s, job(s.jobId));
    if (!p) return undefined;
    return { name: persona(s.personaId)?.name ?? s.personaId, permissions: p };
  };
  /** 아직 EQMUX가 관리하는 에이전트가 아니다 — 맨 셸이 떠 있는 역할 세션.
   *  손으로 `claude`를 쳐도 환경변수·훅·역할이 안 붙으므로, 기동은 이 액션으로만 한다. */
  const needsAgent = (s: Session) => !!roleAgent(s) && !s.agentSessionId && s.status !== "dead";
  const launchAgent = async (s: Session) => {
    const a = roleAgent(s);
    if (!a) return;
    try {
      await launchAgentInSession(s.id, s.workspaceId, s.cwd, a.name, a.permissions);
    } catch {
      /* 실패는 페인 출력과 이벤트 피드가 보여준다 (FR-D-08) */
    }
  };

  // 종료된 슬롯의 "+ 세션 추가" — 슬롯을 비운 뒤 추가 다이얼로그로 잇는다.
  // 역할 세션은 기존 확인 모달을 그대로 거친다 (역할 파일 삭제가 딸려 있어 확인이 필요하다).
  const replaceDeadSlot = (s: Session) => {
    removeTerminal(s);
    if (!s.personaId) openAdd();
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
          + {t("세션 추가")}
        </button>
        <Show
          when={s.resumable}
          fallback={<span class="pane-dead-note">{t("재개 불가")} — {t("트랜스크립트 없음")}</span>}
        >
          <button
            class="btn pane-dead-resume"
            title={t("이 자리에서 재개 — --resume · 대화 복원 (FR-D-21)")}
            onClick={(e) => {
              e.stopPropagation();
              void resumeInline(s);
            }}
          >
            ▶ {t("재개 — 대화 복원")}
          </button>
        </Show>
      </div>
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
            onClick={() => setSelectedSession(s.id)}
          >
            <button
              class="terminal-head mono"
              style={{ width: "100%", "text-align": "left", cursor: "zoom-in" }}
              title={t("클릭하면 줌 토글 (B1) · 우클릭 세션 메뉴")}
              onClick={(e) => {
                e.stopPropagation();
                applyZoom(zoomed() === s.id ? undefined : s.id);
              }}
              onContextMenu={(e) => openSessMenu(e, s)}
            >
              {/* 시안 §04·§06 — SLOT 라벨·✕ 제거, 헤더는 이름·상태만. 제거는 페인 우클릭 메뉴 */}
              <span>{sessionDisplayName(s, personaName(s.personaId))}</span>
              <span style={{ display: "inline-flex", "align-items": "center", gap: "8px" }}>
                {/* 승인 대기 문맥 (U5) — 도착 즉시 어떤 도구 요청인지 헤더에서 보인다 */}
                <Show when={s.status === "waiting" && s.waitingFor}>
                  <span class="badge amber pane-wait-badge" title={t("승인 대기 중인 도구 요청 — y/n은 이 페인에 입력")}>
                    {s.waitingFor}
                  </span>
                </Show>
                <StatusLabel session={s} />
              </span>
            </button>
            {/* 종료된 슬롯은 터미널 대신 다음 행동을 보여준다 — 재개 경로는 그 안에 있다 */}
            <Show when={s.status !== "dead" || isRespawning(s.id)} fallback={deadSlot(s)}>
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
                  // 브랜치 부여 (기본 터미널 전용) — 그 브랜치의 워크트리로 이동, 없으면 만들어 연결
                  ...branchAssignGroup(s),
                  // 위험 — 컴포넌트가 마지막 그룹으로 강제한다
                  removeGroup(s),
                ]}
              />
              {/* 에이전트 기동 (FR-D-01 · 명시 액션) — 셸 우선 모델이라 역할 세션도 맨 셸로 뜬다.
                  손으로 claude를 치면 EQMUX 환경변수·훅·역할이 안 붙으므로 이 버튼으로 띄운다 */}
              <Show when={needsAgent(s)}>
                <button
                  class="btn pane-launch mono"
                  title={t("이 셸을 끝내고 역할·권한·훅이 붙은 에이전트로 다시 엽니다")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void launchAgent(s);
                  }}
                >
                  ▶ {t("에이전트 기동")}
                </button>
              </Show>
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
        <span style={{ color: "var(--eq-green)" }}>◉</span> PTY {sessions().filter((x) => x.status !== "dead").length}
      </span>
      <span>▦ {t(PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name ?? "")}</span>
      <span>OUTPUT {(sessions().reduce((a, x) => a + x.scrollbackLines, 0) / 1000).toFixed(1)}K</span>
      <span>
        {realUsage()
          ? `WAL ${(realUsage()!.db_size_bytes / 1024).toFixed(0)} KB · ${realUsage()!.total_lines.toLocaleString()} lines`
          : `WAL ${usage().walLatencyMs}ms · DB ${usage().dbSizeMb} MB`}
      </span>
      {/* 활성 세션 메모리 (FR-C-09 · C11) — Job Object 트리 실측, 10초 주기. dead는 마지막 샘플이 남으므로 숨긴다 */}
      <Show when={memSession()}>
        {(s) => (
          <span title={`${t("활성 세션 프로세스 트리 메모리")} · peak ${s().memoryPeakMb ?? "—"} MB`}>
            MEM {s().memoryMb} MB
          </span>
        )}
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
              ? `workspaces/${props.workspace.id}/session.db · ${t("100ms 배치 · 30일/10만줄 보존")}`
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
            {props.workspace.branch ?? "—"} · {sessions().length}/{maxSlots()}
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
        {/* 셸 선택 — 새로 추가하는 터미널부터 적용된다 */}
        <div class="shell-picker">
          <button class="btn ghost mono" title={t("새 터미널 셸 선택")} onClick={() => setShellMenuOpen(!shellMenuOpen())}>
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
          <button class="btn ghost mono" title={t("페인 배치 (srpYm)")} onClick={() => setLayoutPickerOpen(true)}>
            ▦ {t(PANE_LAYOUTS.find((l) => l.key === paneLayout())?.name ?? "")}
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

      {/* 워크트리 행 우클릭 메뉴 — git 패널과 같은 안전 범위 (M36). 없는 액션은 정책상 없는 것 */}
      <Show when={wtMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={`⎇ ${wtLabel(m().wt)} · ${m().wt.isMain ? "MAIN" : t(m().wt.isSession ? "세션" : "외부")}`}
            onClose={() => setWtMenu(undefined)}
            groups={[
              [
                {
                  label: t("이 워크트리에서 셸 열기"),
                  disabled: m().wt.isMain,
                  action: () => openWtShell(m().wt),
                },
                {
                  // 브랜치 부여 역방향 진입점 — 선택 중인 기본 터미널을 이 트리의 브랜치로 옮긴다.
                  // 역할 세션·detached 트리·이미 이 트리인 경우는 비활성 (터미널 메뉴와 같은 계약)
                  label: `${t("선택 터미널에 브랜치 부여")}${selected() && !selected()!.personaId ? ` — ${sessionDisplayName(selected()!, personaName(selected()!.personaId))}` : ""}`,
                  disabled:
                    !m().wt.branch ||
                    !selected() ||
                    !!selected()!.personaId ||
                    normPath(selected()!.cwd) === normPath(m().wt.path),
                  action: () => void assignBranch(selected()!, m().wt.branch!),
                },
                { label: t("경로 복사"), action: () => clipWriteText(m().wt.path) },
              ],
              [{ label: t("삭제는 두지 않는다 — git worktree remove (FR-E-64)"), note: true }],
            ]}
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
                  title={t("세션 상세")}
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
                  <span class="unread-dot rail-unread" title={t("미확인")} />
                </Show>
              </div>
            )}
          </For>
          <Show when={sessions().length < maxSlots()}>
            <button class="rail-av add mono" title={t("빈 슬롯에 세션 추가 — 기본 터미널 또는 역할 세션")} onClick={openAdd}>
              {t("+ 세션 추가")}
            </button>
          </Show>
          <div class="rail-sep" />
          <button class="rail-ms" title={t("임무 관리")} onClick={() => setView({ kind: "missions", wsId: props.workspace.id })}>
            <span class="eyebrow">{t("임무")}</span>
            <b class="mono">{missions().length}</b>
          </button>
          <div class="rail-sep" />
          {/* 워크트리 (orca식) — 작업 트리별 브랜치·귀속 세션 현황. 생성은 팝오버, 삭제는 없다 (FR-E-64) */}
          <div class="rail-wt-head">
            <span class="eyebrow">{t("워크트리")}</span>
            <b class="mono">{wtRows().length}</b>
            <button
              class="rail-wt-add mono"
              title={t("워크트리 생성 — 새 브랜치(eqmux/<이름>) 또는 기존 브랜치 연결")}
              onClick={() => {
                setWtErr(undefined);
                setWtFormOpen(!wtFormOpen());
              }}
            >
              +
            </button>
            <Show when={wtFormOpen()}>
              <div class="card rail-wt-pop" onClick={(e) => e.stopPropagation()}>
                {/* 모드 — 새 브랜치를 만들거나, 이미 있는 브랜치를 트리에 연결하거나 (레일 §워크트리) */}
                <div class="wt-mode-toggle">
                  <button classList={{ on: wtMode() === "new" }} onClick={() => setWtMode("new")}>
                    {t("새 브랜치")}
                  </button>
                  <button
                    classList={{ on: wtMode() === "attach" }}
                    onClick={() => {
                      setWtMode("attach");
                      if (!wtAttachBranch()) setWtAttachBranch(attachable()[0]?.name ?? "");
                    }}
                  >
                    {t("기존 브랜치")}
                  </button>
                </div>
                <Show
                  when={wtMode() === "new"}
                  fallback={
                    <>
                      <select
                        style={{ "font-size": "11px" }}
                        title={t("이 브랜치를 체크아웃하는 워크트리를 만든다 — 새 브랜치 없음")}
                        value={wtAttachBranch()}
                        onChange={(e) => setWtAttachBranch(e.currentTarget.value)}
                      >
                        <Show when={attachable().length === 0}>
                          <option value="">{t("연결 가능한 로컬 브랜치 없음")}</option>
                        </Show>
                        <For each={attachable()}>{(b) => <option value={b.name}>{b.name}</option>}</For>
                      </select>
                      <div class="mono muted" style={{ "font-size": "10px" }}>
                        {t("체크아웃 중인 브랜치는 목록에서 빠집니다 — 같은 브랜치는 한 트리에만 (git)")}
                      </div>
                    </>
                  }
                >
                  <input
                    class="mono"
                    style={{ "font-size": "11px", padding: "2px 6px" }}
                    placeholder={t("이름 → .eqmux/worktrees/<이름>")}
                    value={wtName()}
                    onInput={(e) => setWtName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createWt();
                      if (e.key === "Escape") setWtFormOpen(false);
                    }}
                  />
                  <select
                    style={{ "font-size": "11px" }}
                    title={t("분기 기준 ref (start-from)")}
                    value={wtBase()}
                    onChange={(e) => setWtBase(e.currentTarget.value)}
                  >
                    <option value="">{t("HEAD (현재)")}</option>
                    <For each={wtBranches()}>{(b) => <option value={b.name}>{b.name}</option>}</For>
                  </select>
                </Show>
                <label class="mono muted" style={{ "font-size": "10px", display: "flex", gap: "5px", "align-items": "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={wtOpenShell()} onChange={(e) => setWtOpenShell(e.currentTarget.checked)} />
                  {t("생성 후 이 트리에서 셸 열기")}
                </label>
                <button
                  class="btn primary"
                  style={{ "font-size": "10px", "justify-content": "center" }}
                  disabled={wtBusy() || (wtMode() === "attach" ? !wtAttachBranch() : !wtName().trim())}
                  onClick={() => void createWt()}
                >
                  {t(wtBusy() ? (wtMode() === "attach" ? "연결 중…" : "생성 중…") : wtMode() === "attach" ? "연결" : "생성")}
                </button>
                <Show when={wtErr()}>
                  <div class="mono st-dead" style={{ "font-size": "10px" }}>
                    {wtErr()}
                  </div>
                </Show>
              </div>
            </Show>
          </div>
          <div class="rail-wt-list">
            <For each={wtRows()}>
              {(wt) => (
                <div
                  class="rail-wt"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setWtMenu({ x: e.clientX, y: e.clientY, wt });
                  }}
                >
                  <div class="rail-wt-top">
                    <span class="rail-wt-name mono" title={wt.path}>
                      ⎇ {wtLabel(wt)}
                    </span>
                    <span
                      class="rail-wt-tag mono"
                      classList={{ main: wt.isMain }}
                      title={t(wt.isMain ? "메인 작업 트리" : wt.isSession ? "앱이 만든 워크트리 (.eqmux/worktrees/)" : "외부에서 만든 워크트리 — 순수 git 호환")}
                    >
                      {wt.isMain ? "MAIN" : t(wt.isSession ? "세션" : "외부")}
                    </span>
                    <Show when={!wt.isMain}>
                      <button
                        class="rail-wt-open mono"
                        title={t("이 워크트리에서 기본 터미널 열기 — 역할 부여는 세션 상세에서")}
                        onClick={() => openWtShell(wt)}
                      >
                        + {t("셸")}
                      </button>
                    </Show>
                  </div>
                  <div class="rail-wt-path mono muted" title={wt.path}>
                    {wtTail(wt.path)}
                  </div>
                  {/* 귀속 세션 — cwd 실측 일치. 클릭 = 그 페인으로 (orca의 agents 목록) */}
                  <Show when={wtMembers(wt).length > 0}>
                    <div class="rail-wt-agents">
                      <For each={wtMembers(wt)}>
                        {(s) => (
                          <button
                            class="rail-wt-agent mono"
                            classList={{ sel: selected()?.id === s.id }}
                            title={`${sessionDisplayName(s, personaName(s.personaId))} · ${jobName(s.jobId)} — ${s.status}`}
                            onClick={() => {
                              setSelectedSession(s.id);
                              backend.markSeen(s.id);
                              setCenterTab("terminal");
                            }}
                          >
                            <span class={`sdot ${s.status}`} />
                            <span class="rail-wt-agent-nm">{sessionDisplayName(s, personaName(s.personaId))}</span>
                            <span class="muted">{s.status}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <Show when={wtRows().length === 0}>
              <div class="rail-wt-empty mono muted">{t(isTauri() ? "실측 대기 — git 저장소가 아니면 비어 있습니다" : "워크트리 없음")}</div>
            </Show>
          </div>
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
              <button class="detail-dialog-x" title={t("닫기 (ESC)")} onClick={() => setDetailOpen(false)}>
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
              ⛶ {props.workspace.name} <span class="muted">· {sessions().length}/{maxSlots()} SESSIONS · TERMINAL FOCUS</span>
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
                ✕ {t("전체 화면 종료")}
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
            <div style={{ "font-weight": 800, "font-size": "14px" }}>{t("빈 슬롯에 세션 추가")}</div>
            <div class="muted" style={{ "font-size": "11px", margin: "4px 0 12px" }}>
              {props.workspace.name} · {sessions().length}/{maxSlots()} {t("슬롯 사용 중")}
            </div>

            <button class="card add-choice" onClick={addTerminal}>
              <div>
                <div style={{ "font-weight": 700, "font-size": "12px" }}>&gt;_ {t("기본 터미널")}</div>
                <div class="muted" style={{ "font-size": "11px" }}>
                  {t("역할 없이 즉시 시작 · 언제든 역할 부여 가능")}
                </div>
              </div>
              <span class="mono muted">→</span>
            </button>

            <div class="card add-choice role" onClick={(e) => e.stopPropagation()}>
              <div style={{ width: "100%" }}>
                <div style={{ "font-weight": 700, "font-size": "12px" }}>⛬ {t("역할 세션")}</div>
                <div class="muted" style={{ "font-size": "11px", "margin-bottom": "8px" }}>
                  {t("페르소나·직무를 정해 시작 · 권한 플래그는 스폰 시점에 적용")}
                </div>
                <Show
                  when={availablePersonas().length > 0}
                  fallback={<div class="muted mono" style={{ "font-size": "11px" }}>{t("남은 페르소나가 없습니다")}</div>}
                >
                  <div class="role-edit-row">
                    <select value={addPersona()} onChange={(e) => setAddPersona(e.currentTarget.value)}>
                      <For each={availablePersonas()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
                    </select>
                    <select value={addJob()} onChange={(e) => setAddJob(e.currentTarget.value)}>
                      <For each={backend.listJobs()}>{(j) => <option value={j.id}>{j.name}</option>}</For>
                    </select>
                    <button class="btn primary" onClick={() => void addRoleSession()}>
                      {t("생성")}
                    </button>
                  </div>
                  {/* 세션 격리 (FR-E-62 · E1′) — 기본은 repo 공유 (FR-E-60) */}
                  <label class="mono muted" style={{ display: "flex", gap: "6px", "align-items": "center", "font-size": "11px", "margin-top": "8px", cursor: "pointer" }}>
                    <input type="checkbox" checked={addWorktree()} onChange={(e) => setAddWorktree(e.currentTarget.checked)} />
                    {t("워크트리 격리 — .eqmux/worktrees/<세션> · 전용 브랜치 eqmux/<세션>")}
                  </label>
                  <Show when={addWorktree()}>
                    <div class="muted" style={{ "font-size": "10px", "margin-top": "4px" }}>
                      {t("의존성(node_modules 등)은 워크트리마다 별도입니다. 제거 시 워크트리는 남습니다 — 머지·정리는 사람이 합니다 (FR-E-64)")}
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
                {t("취소")}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 역할 세션 제거 확인 — 기본 터미널과 달리 편성 슬롯·임무 배정에 영향이 있다 */}
      <Show when={removeTarget()}>
        {(rt) => (
          <div class="overlay" onClick={() => setRemoveTarget(undefined)}>
            <div class="dialog" style={{ width: "440px", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ "font-weight": 800, "font-size": "14px" }}>{t("역할 세션 제거")}</div>
              <div class="muted" style={{ "font-size": "12px", margin: "6px 0 10px" }}>
                {personaName(rt().personaId)} · {jobName(rt().jobId)} — SLOT {rt().slot}
              </div>
              <div class="card inset" style={{ padding: "8px 10px", "font-size": "11px", "line-height": 1.6 }}>
                {t("제거하면 팀 편성의 이 슬롯이 비워지고 임무 배정이 해제되며 PTY 프로세스가 종료됩니다. 변경은 다음 캐스팅 저장 때 .eqmux/team.json에 반영됩니다.")}
              </div>
              <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
                <button class="btn" onClick={() => setRemoveTarget(undefined)}>
                  {t("취소")}
                </button>
                <button class="btn danger" onClick={() => doRemove(rt())}>
                  {t("세션 제거")}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
