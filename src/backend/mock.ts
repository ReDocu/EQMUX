// MockBackend — SessionService(PRD C §7.1)의 프런트 소비 표면을 흉내 낸다.
// M1에서 TauriBackend(invoke/Channel)로 교체하며, 화면은 Backend 인터페이스만 안다 (C9 모듈 경계).
import type {
  AgentStateApply,
  ConversationMessage,
  EventRecord,
  Job,
  Mission,
  Persona,
  Session,
  StoreUsage,
  TeamSlotHydrate,
  Workspace,
} from "../types";

export interface Backend {
  listWorkspaces(): Workspace[];
  listSessions(): Session[];
  listMissions(): Mission[];
  listJobs(): Job[];
  listPersonas(): Persona[];
  listEvents(): EventRecord[];
  listMessages(): ConversationMessage[];
  storeUsage(): StoreUsage;
  /** 상태 변경 방송 (FR-C-43) — MockBackend는 타이머로 경과 시간만 진행시킨다 */
  subscribe(cb: () => void): () => void;

  // ── M0 목 mutation — M1에서 SessionService invoke로 교체 ──
  sendMessage(from: string, to: string, type: ConversationMessage["type"], body: string): void;
  markAllRead(): void;
  /** 메시지 원장 실측으로 그 워크스페이스 스트림을 교체 (PRD F) — Tauri에서만 호출된다 */
  hydrateMessages(wsId: string, list: ConversationMessage[]): void;
  /** message-new 이벤트 1건 반영 — 이미 있는 id는 무시한다 */
  appendMessage(m: ConversationMessage): void;
  /** 미확인 해제 (FR-G-44) — 그 세션의 페인을 보거나 상세를 열면 해제된다 */
  markSeen(sessionId: string): void;
  /** 모두 확인 (FR-G-47) */
  markAllSeen(): void;
  resumeSession(id: string): void;
  stopSession(id: string): void;
  restartSession(id: string): void;
  applyCasting(wsId: string, slots: { personaId: string; jobId: string }[]): void;
  /** 기본 터미널 (S9u2S) — 역할 없는 셸 세션을 빈 슬롯에 시작한다. 이미 있으면 재사용. */
  startDefaultTerminal(wsId: string): void;
  /** 슬롯에 터미널 추가 — 페르소나·직무 없이 빈 슬롯 하나를 셸 세션으로 채운다 */
  addTerminal(wsId: string, shell?: string): void;
  /** 슬롯에 역할 세션 추가 — 스폰 시점에 권한 플래그가 결정되므로 재시작이 필요 없다 */
  addRoleSession(wsId: string, personaId: string, jobId: string, opts?: { cwd?: string; worktree?: boolean }): void;
  /** 슬롯에서 터미널 제거 — 세션을 삭제하고 임무 배정도 해제한다 */
  removeTerminal(id: string): void;
  /** 역할 세션의 페르소나·직무 변경 — 직무가 바뀌면 권한 변경이므로 재시작 필요(E11′) */
  updateSessionRole(id: string, personaId: string, jobId: string): void;
  /** team.json에서 복원된 슬롯을 세션으로 채운다 — 에이전트는 자동 실행하지 않는다 (S3).
   *  aliveIds에 든 세션은 PTY가 살아 있는 것(웹뷰 재시작, FR-C-06)이라 재개 대기가 아니라 재부착 대상이다 */
  hydrateTeam(wsId: string, slots: TeamSlotHydrate[], aliveIds?: Set<string>): void;
  /** 웹뷰 재시작 복구 (FR-C-06) — 팀 파일에 없는 살아 있는 PTY(기본 터미널)를 화면에 되살린다 */
  reviveOrphan(id: string, wsId: string): void;
  /** 미확인 영속 복원 (G 잔여) — 캐시에 남은 세션 id들에 미확인 점을 되붙인다 */
  hydrateUnseen(wsId: string, ids: string[]): void;
  /** 세션 메모리 실측 반영 (FR-C-09) — 최신값·피크만 유지, 이벤트 적재 없음 */
  applyMemory(samples: { id: string; mb: number; peakMb: number }[]): void;
  /** 실물 에이전트 상태 반영 (PRD D agent-state 이벤트) — Tauri에서만 호출된다 */
  applyAgentState(evt: AgentStateApply): void;
  createMission(wsId: string, name: string, goal: string, branch?: string): void;
  cycleMissionStatus(id: string): void;
  toggleAssign(missionId: string, sessionId: string): void;
  /** 임무 파일 실측으로 목록을 교체 — 파일이 이긴다 (FR-E-74). Tauri에서만 호출된다 */
  hydrateMissions(wsId: string, list: Mission[]): void;
  addWorkspace(remote?: string): void;
  openWorkspace(id: string): void;
  closeWorkspace(id: string): void;
  repairWorkspace(id: string): void;
  /** 실물 레지스트리(workspaces.json)로 목록을 교체 — Tauri 부트스트랩 (PRD E) */
  hydrateWorkspaces(list: Workspace[]): void;
  /** 라이브러리 실파일(jobs/·personas/)로 목 배열을 교체 (FR-E-20~23) — Tauri에서만 */
  hydrateLibrary(jobs: Job[], personas: Persona[]): void;
  /** 등록 해제 (FR-E-09) — 목록에서만 지운다 */
  removeWorkspace(id: string): void;
  savePersona(p: Persona): void;
  addPersona(): void;
  saveJob(j: Job): void;
  deleteJob(id: string): void;
  listTurns(sessionId: string): TranscriptTurn[];
  sendInput(sessionId: string, text: string): void;
}

export interface TranscriptTurn {
  role: "user" | "agent";
  time: string;
  text: string;
}

// ── 목 데이터: docs/design.pen의 카피를 그대로 사용 (Academy 팀 시나리오) ──

export const JOBS: Job[] = [
  {
    id: "lead",
    name: "리드",
    permissions: { write: true, commit: true, push: false },
    responsibility: "전체 구조 · 임무 분해 · 최종 판단",
    forbidden: "검증 없이 완료 선언 · 원격 push",
  },
  {
    id: "impl",
    name: "구현",
    permissions: { write: true, commit: false, push: false },
    responsibility: "작은 단위 구현과 자체 검증",
    forbidden: "검증 없이 커밋 요청",
  },
  {
    id: "verify",
    name: "검증",
    permissions: { write: false, commit: false, push: false },
    responsibility: "테스트 · 증거 수집",
    forbidden: "증거 없는 통과 판정",
  },
  {
    id: "review",
    name: "리뷰",
    permissions: { write: false, commit: false, push: false },
    responsibility: "변경 검토 · 품질 기준",
    forbidden: "리뷰 없이 승인",
  },
];

export const PERSONAS: Persona[] = [
  { id: "kai", name: "카이", hint: "전체 구조와 위험을 먼저 본다", color: "blue" },
  { id: "noel", name: "노엘", hint: "작은 단위로 구현하고 검증한다", color: "purple" },
  { id: "lin", name: "린", hint: "경계와 정합성", color: "green" },
  { id: "sol", name: "솔", hint: "증거 없는 완료를 인정하지 않는다", color: "amber" },
  { id: "mira", name: "미라", hint: "운영 비용과 관측", color: "blue" },
  { id: "jun", name: "준", hint: "계약과 인터페이스 우선", color: "purple" },
  { id: "hana", name: "하나", hint: "문서와 재현 절차", color: "green" },
  { id: "luca", name: "루카", hint: "사용자 흐름 중심", color: "blue" },
];

const WORKSPACES: Workspace[] = [
  {
    id: "academy",
    name: "Academy",
    path: "C:\\workspace\\Academy",
    remote: "github.com/acme/academy",
    branch: "main",
    branchNote: "main · 2분 전",
    open: true,
    pathMissing: false,
    teamFile: ".eqmux/team.json",
    lastUsed: "2026-08-11 10:42",
  },
  {
    id: "eqmux",
    name: "EQMux",
    path: "C:\\workspace\\EQMUX",
    remote: "github.com/acme/eqmux",
    branch: "dev",
    branchNote: "dev · 18분 전",
    open: true,
    pathMissing: false,
    teamFile: ".eqmux/team.json",
    lastUsed: "2026-08-11 09:12",
  },
  {
    id: "atlas",
    name: "Atlas",
    path: "D:\\repos\\Atlas",
    remote: "github.com/acme/atlas",
    branch: "feature/ui",
    branchNote: "feature/ui · 1시간 전",
    open: true,
    pathMissing: false,
    teamFile: ".eqmux/team.json",
  },
  {
    id: "legacy",
    name: "Legacy API",
    path: "D:\\archive\\legacy-api",
    remote: "github.com/acme/legacy",
    branchNote: "경로를 찾을 수 없음",
    open: false,
    pathMissing: true,
    teamFile: ".eqmux/team.json",
  },
  {
    id: "docs",
    name: "Docs",
    path: "C:\\workspace\\docs",
    branchNote: "main · 3일 전",
    open: false,
    pathMissing: false,
    teamFile: ".eqmux/team.json",
  },
];

const s = (
  id: string,
  ws: string,
  slot: 1 | 2 | 3 | 4,
  personaId: string,
  jobId: string,
  patch: Partial<Session>,
): Session => ({
  id,
  workspaceId: ws,
  slot,
  personaId,
  jobId,
  shell: "pwsh",
  cwd: `C:\\workspace\\${ws}`,
  status: "idle",
  subagents: 0,
  resumable: true,
  resumeReason: "transcript + cwd 일치",
  degraded: false,
  restartNeeded: false,
  sinceMs: 3 * 60000,
  scrollbackLines: 0,
  lastOutput: "",
  ...patch,
});

const SESSIONS: Session[] = [
  s("kai@academy", "academy", 1, "kai", "lead", {
    status: "busy",
    subagents: 3,
    missionId: "auth-refactor",
    agentSessionId: "1cdd7ea4",
    agentVersion: "2.1.226",
    pid: 14764,
    scrollbackLines: 18400,
    memoryMb: 512,
    memoryPeakMb: 640,
    lastOutput: "작업 중 · 인증 리팩터",
    sinceMs: 8 * 60000,
  }),
  s("noel@academy", "academy", 2, "noel", "impl", {
    status: "waiting",
    waitingFor: "Bash(npm publish)",
    unseen: true,
    missionId: "auth-refactor",
    agentSessionId: "8d19c2aa",
    agentVersion: "2.1.226",
    pid: 13044,
    scrollbackLines: 12900,
    memoryMb: 428,
    memoryPeakMb: 611,
    lastOutput: "승인 대기 · Bash(npm publish)",
    sinceMs: 12 * 60000,
  }),
  s("lin@academy", "academy", 3, "lin", "review", {
    status: "busy",
    missionId: "auth-refactor",
    agentSessionId: "77ab01ce",
    agentVersion: "2.1.226",
    pid: 20112,
    scrollbackLines: 9100,
    memoryMb: 302,
    memoryPeakMb: 355,
    restartNeeded: true,
    lastOutput: "리뷰 중 · 승인 게이트",
    sinceMs: 4 * 60000,
  }),
  s("sol@academy", "academy", 4, "sol", "verify", {
    status: "idle",
    missionId: "regression",
    scrollbackLines: 2100,
    memoryMb: 180,
    memoryPeakMb: 240,
    lastOutput: "회귀 검증 대기",
    sinceMs: 2 * 60000,
  }),
  s("mira@eqmux", "eqmux", 1, "mira", "lead", {
    status: "shell",
    missionId: "storage-metrics",
    scrollbackLines: 4400,
    memoryMb: 210,
    memoryPeakMb: 300,
    lastOutput: "스토리지 계측",
  }),
  s("jun@eqmux", "eqmux", 2, "jun", "impl", {
    status: "busy",
    missionId: "prd-d-impl",
    scrollbackLines: 7300,
    memoryMb: 350,
    memoryPeakMb: 420,
    lastOutput: "PRD D 구현",
  }),
  s("hana@eqmux", "eqmux", 3, "hana", "impl", {
    status: "dead",
    exitCode: 1,
    resumable: true,
    unseen: true,
    scrollbackLines: 5100,
    lastOutput: "종료됨 · exit 1",
    sinceMs: 31 * 60000,
  }),
  s("luca@atlas", "atlas", 1, "luca", "lead", {
    status: "idle",
    scrollbackLines: 900,
    memoryMb: 120,
    lastOutput: "대기 중",
  }),
];

const MISSIONS: Mission[] = [
  {
    id: "auth-refactor",
    workspaceId: "academy",
    name: "인증 리팩터",
    file: ".eqmux/missions/auth-refactor.md",
    status: "in-progress",
    goal: "인증 모듈의 결합을 낮추고 세션 재개 경계를 명확히 한다.",
    outputs: ["src/auth/* 리팩터", "회귀 테스트 통과", "린 리뷰 승인"],
    branch: "feature/auth-refactor",
    assigned: ["noel@academy", "lin@academy"],
  },
  {
    id: "regression",
    workspaceId: "academy",
    name: "회귀 검증",
    file: ".eqmux/missions/regression.md",
    status: "todo",
    goal: "인증 리팩터 산출물의 회귀 검증 증거를 수집한다.",
    outputs: ["테스트 결과", "증거 로그"],
    assigned: ["sol@academy"],
  },
  {
    id: "storage-metrics",
    workspaceId: "eqmux",
    name: "세션 레지스트리",
    file: ".eqmux/missions/mission.md",
    status: "in-review",
    goal: "레지스트리 watch와 폴백 경로 검증",
    outputs: ["watch 구현", "degraded 테스트"],
    assigned: ["mira@eqmux"],
  },
  {
    id: "prd-d-impl",
    workspaceId: "eqmux",
    name: "트랜스크립트 파서",
    file: ".eqmux/missions/mission.md",
    status: "todo",
    goal: "JSONL 턴 파서 + 폴백",
    outputs: ["파서", "폴백 전환"],
    assigned: ["jun@eqmux"],
  },
];

const EVENTS: EventRecord[] = [
  { id: "e1", time: "10:42", sessionId: "noel@academy", kind: "state", message: "busy → waiting" },
  { id: "e2", time: "10:38", sessionId: "kai@academy", kind: "agent", message: "서브에이전트 3 시작" },
  { id: "e3", time: "10:31", sessionId: "hana@eqmux", kind: "state", message: "종료됨 · exit 1" },
  { id: "e4", time: "10:20", sessionId: "lin@academy", kind: "mission", message: "임무 배정 · 인증 리팩터" },
  { id: "e5", time: "09:58", sessionId: "jun@eqmux", kind: "agent", message: "역할 파일 다시 읽음" },
  { id: "e6", time: "09:48", kind: "store", message: "scrollback batch committed · 42ms" },
  { id: "e7", time: "09:47", kind: "app", message: "EQMUX 시작 → 워크스페이스 Academy" },
];

const MESSAGES: ConversationMessage[] = [
  {
    id: "m1",
    time: "10:34",
    from: "노엘",
    to: "린",
    type: "handoff",
    body: "auth/session.ts의 인터페이스 변경을 넘깁니다. migration test를 부탁해요.",
    unread: false,
  },
  {
    id: "m2",
    time: "10:37",
    from: "린",
    to: "카이",
    type: "escalate",
    body: "기존 refresh token 경계가 PRD와 충돌합니다. 전체 교체 여부 판단이 필요합니다.",
    unread: true,
  },
  {
    id: "m3",
    time: "10:39",
    from: "카이",
    to: "@all",
    type: "report",
    body: "교체 승인. 공개 API는 유지하고 내부 저장 계층만 바꿉니다.",
    unread: true,
  },
  {
    id: "m4",
    time: "10:42",
    from: "솔",
    to: "노엘",
    type: "review",
    body: "npm publish 승인은 보류했습니다. dry-run 산출물을 먼저 첨부하세요.",
    unread: true,
  },
];

const nowTime = () => new Date().toTimeString().slice(0, 5);
let seq = 100;

// 세션별 목 트랜스크립트 (V1 — 실제로는 에이전트 로그 파일 참조)
const TURNS = new Map<string, TranscriptTurn[]>([
  [
    "kai@academy",
    [
      { role: "user", time: "10:20", text: "인증 리팩터 임무를 시작해줘. 공개 API는 유지." },
      { role: "agent", time: "10:21", text: "auth/ 구조를 파악했습니다. session.ts · token.ts · store.ts 3분할로 진행하고, 노엘에게 구현을 배분합니다." },
      { role: "agent", time: "10:38", text: "서브에이전트 3개로 병렬 분석 중 — 저장 계층 교체 범위를 확정하는 중입니다." },
    ],
  ],
  [
    "noel@academy",
    [
      { role: "agent", time: "10:30", text: "session.ts 인터페이스 변경 완료. migration test가 필요해 린에게 핸드오프했습니다." },
      { role: "agent", time: "10:42", text: "npm publish 실행 승인이 필요합니다 — Bash(npm publish)" },
    ],
  ],
]);

export class MockBackend implements Backend {
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  private broadcast() {
    this.listeners.forEach((l) => l());
  }

  private logEvent(kind: EventRecord["kind"], message: string, sessionId?: string) {
    EVENTS.unshift({ id: `e${seq++}`, time: nowTime(), kind, message, sessionId });
  }

  listWorkspaces() {
    return WORKSPACES;
  }
  listSessions() {
    return SESSIONS;
  }
  listMissions() {
    return MISSIONS;
  }
  listJobs() {
    return JOBS;
  }
  listPersonas() {
    return PERSONAS;
  }
  listEvents() {
    return EVENTS;
  }
  listMessages() {
    return MESSAGES;
  }
  storeUsage(): StoreUsage {
    return {
      dbFile: "Academy/session.db",
      dbSizeMb: 324,
      dbPercent: 64,
      walLatencyMs: 42,
      globalUsage: "1.28G",
    };
  }

  sendMessage(from: string, to: string, type: ConversationMessage["type"], body: string) {
    MESSAGES.push({ id: `m${seq++}`, time: nowTime(), from, to, type, body, unread: false });
    this.broadcast();
  }

  markAllRead() {
    for (const m of MESSAGES) m.unread = false;
    this.broadcast();
  }

  hydrateMessages(wsId: string, list: ConversationMessage[]) {
    // 그 워크스페이스의 기존 스트림과 워크스페이스 없는 목 시드를 걷어내고 실측으로 교체
    for (let i = MESSAGES.length - 1; i >= 0; i--) {
      const w = MESSAGES[i].workspaceId;
      if (w === wsId || w === undefined) MESSAGES.splice(i, 1);
    }
    MESSAGES.push(...list);
    MESSAGES.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    this.broadcast();
  }

  appendMessage(m: ConversationMessage) {
    if (MESSAGES.some((x) => x.id === m.id)) return;
    MESSAGES.push(m);
    this.broadcast();
  }

  markSeen(sessionId: string) {
    const sess = SESSIONS.find((x) => x.id === sessionId);
    if (!sess?.unseen) return; // 변경 없으면 방송하지 않는다 — 열람 효과의 재귀 방지
    sess.unseen = false;
    this.broadcast();
  }

  markAllSeen() {
    let changed = false;
    for (const sess of SESSIONS) {
      if (sess.unseen) {
        sess.unseen = false;
        changed = true;
      }
    }
    if (changed) this.broadcast();
  }

  resumeSession(id: string) {
    const sess = SESSIONS.find((x) => x.id === id);
    if (!sess || !sess.resumable) return;
    sess.restored = false; // 재개 제안(FR-C-33)을 접는다 — 어느 표면에서 재개했든 동일
    sess.status = "busy";
    sess.sinceMs = 0;
    sess.exitCode = undefined;
    sess.lastOutput = "재개됨 · transcript 복원";
    this.logEvent("state", "dead → busy · 재개", id);
    this.broadcast();
  }

  stopSession(id: string) {
    const sess = SESSIONS.find((x) => x.id === id);
    if (!sess || sess.status === "dead") return;
    sess.status = "dead";
    sess.exitCode = 0;
    sess.sinceMs = 0;
    sess.subagents = 0;
    sess.waitingFor = undefined;
    sess.lastOutput = "종료됨 · exit 0";
    this.logEvent("state", "중지 · exit 0", id);
    this.broadcast();
  }

  restartSession(id: string) {
    const sess = SESSIONS.find((x) => x.id === id);
    if (!sess) return;
    sess.restartNeeded = false;
    sess.status = "busy";
    sess.sinceMs = 0;
    sess.lastOutput = "재시작됨 · 대화 유지";
    this.logEvent("state", "재개 기반 재시작 · 권한 반영", id);
    this.broadcast();
  }

  applyCasting(wsId: string, slots: { personaId: string; jobId: string }[]) {
    slots.slice(0, 4).forEach((slot, i) => {
      const n = (i + 1) as 1 | 2 | 3 | 4;
      const existing = SESSIONS.find((x) => x.workspaceId === wsId && x.slot === n);
      if (existing) {
        existing.personaId = slot.personaId;
        existing.jobId = slot.jobId;
      } else {
        SESSIONS.push(
          s(`${slot.personaId}@${wsId}`, wsId, n, slot.personaId, slot.jobId, {
            status: "starting",
            sinceMs: 0,
            lastOutput: "세션 시작 중",
          }),
        );
      }
    });
    this.logEvent("app", "캐스팅 적용 · team.json 저장");
    this.broadcast();
  }

  startDefaultTerminal(wsId: string) {
    const existing = SESSIONS.find((x) => x.workspaceId === wsId && x.personaId === "");
    if (existing) {
      if (existing.status === "dead") {
        existing.status = "shell";
        existing.exitCode = undefined;
        existing.sinceMs = 0;
        existing.lastOutput = "기본 터미널 · 재시작";
        this.logEvent("state", "기본 터미널 재시작", existing.id);
        this.broadcast();
      }
      return;
    }
    this.addTerminal(wsId);
  }

  addTerminal(wsId: string, shell?: string) {
    const ws = WORKSPACES.find((x) => x.id === wsId);
    if (!ws) return;
    const used = new Set(SESSIONS.filter((x) => x.workspaceId === wsId).map((x) => x.slot));
    const slot = ([1, 2, 3, 4] as const).find((n) => !used.has(n));
    if (!slot) {
      this.logEvent("app", `세션 슬롯 가득 참 (4/4) · ${ws.name}`);
      this.broadcast();
      return;
    }
    SESSIONS.push(
      s(`shell${slot}@${wsId}`, wsId, slot, "", "", {
        status: "shell",
        shell: shell ?? "pwsh",
        cwd: ws.path,
        sinceMs: 0,
        resumeReason: "일반 셸 · cwd 유지",
        lastOutput: "기본 터미널",
      }),
    );
    this.logEvent("app", `터미널 추가 · ${ws.name} SLOT ${slot} · ${shell ?? "pwsh"}`);
    this.broadcast();
  }

  removeTerminal(id: string) {
    const i = SESSIONS.findIndex((x) => x.id === id);
    if (i < 0) return;
    const sess = SESSIONS[i];
    SESSIONS.splice(i, 1);
    for (const m of MISSIONS) {
      const j = m.assigned.indexOf(id);
      if (j >= 0) m.assigned.splice(j, 1);
    }
    this.logEvent("state", `터미널 제거 · SLOT ${sess.slot}`, id);
    this.broadcast();
  }

  addRoleSession(wsId: string, personaId: string, jobId: string, opts?: { cwd?: string; worktree?: boolean }) {
    const ws = WORKSPACES.find((x) => x.id === wsId);
    if (!ws) return;
    const used = new Set(SESSIONS.filter((x) => x.workspaceId === wsId).map((x) => x.slot));
    const slot = ([1, 2, 3, 4] as const).find((n) => !used.has(n));
    if (!slot) {
      this.logEvent("app", `세션 슬롯 가득 참 (4/4) · ${ws.name}`);
      this.broadcast();
      return;
    }
    SESSIONS.push(
      s(`${personaId}@${wsId}`, wsId, slot, personaId, jobId, {
        status: "starting",
        cwd: opts?.cwd ?? ws.path,
        worktree: opts?.worktree ?? false,
        sinceMs: 0,
        lastOutput: "세션 시작 중",
      }),
    );
    const pName = PERSONAS.find((x) => x.id === personaId)?.name ?? personaId;
    const jName = JOBS.find((x) => x.id === jobId)?.name ?? jobId;
    const iso = opts?.worktree ? " · 워크트리" : "";
    this.logEvent("app", `역할 세션 추가 · ${pName} · ${jName} · SLOT ${slot}${iso}`);
    this.broadcast();
  }

  hydrateTeam(wsId: string, slots: TeamSlotHydrate[], aliveIds?: Set<string>) {
    const ws = WORKSPACES.find((x) => x.id === wsId);
    if (!ws) return;
    let added = 0;
    let revivedCount = 0;
    for (const sl of slots) {
      const slot = sl.slot as 1 | 2 | 3 | 4;
      const used = SESSIONS.some((x) => x.workspaceId === wsId && x.slot === slot);
      if (used || slot < 1 || slot > 4) continue;
      const id = `${sl.persona}@${wsId}`;
      // PTY 생존 = 웹뷰만 재시작한 것 (FR-C-06) — 재개 대기가 아니라 재부착 대상.
      // 상태는 agent_snapshot이 곧바로 덮는다 (restoreTeams에서 이어 호출).
      const alive = aliveIds?.has(id) ?? false;
      if (alive) revivedCount++;
      // 워크트리 슬롯 (FR-E-62) — 이 머신에 실재할 때만 그 cwd로. 없으면(다른 머신 clone 등)
      // repo 루트 폴백 — 재개는 어차피 cwd 종속이라 불가하고, 새 시작만 남는다
      const worktreeMissing = !!sl.worktree && !sl.worktreePath;
      SESSIONS.push(
        s(id, wsId, slot, sl.persona, sl.job, {
          status: "shell",
          cwd: sl.worktreePath ?? ws.path,
          worktree: !!sl.worktreePath,
          sinceMs: 0,
          restored: !alive,
          revived: alive,
          resumable: sl.resumable,
          resumeReason: sl.resumable ? "transcript + cwd 일치" : "transcript 없음",
          agentSessionId: sl.agentSessionId?.slice(0, 8),
          lastOutput: alive
            ? "웹뷰 재시작 · 세션 이어짐"
            : worktreeMissing
              ? "복원됨 · 워크트리 없음 — repo 루트 폴백"
              : sl.resumable
                ? "복원됨 · 재개 대기"
                : "복원됨 · 새 시작 필요",
        }),
      );
      added++;
    }
    if (added > 0) {
      this.logEvent(
        "app",
        revivedCount > 0
          ? `팀 복원 · ${ws.name} · ${added}개 슬롯 (실행 중 ${revivedCount}개 재부착)`
          : `팀 복원 · ${ws.name} · ${added}개 슬롯 (team.json)`,
      );
      this.broadcast();
    }
  }

  reviveOrphan(id: string, wsId: string) {
    const ws = WORKSPACES.find((x) => x.id === wsId);
    if (!ws || SESSIONS.some((x) => x.id === id)) return;
    const used = new Set(SESSIONS.filter((x) => x.workspaceId === wsId).map((x) => x.slot));
    // `shell<N>@ws` 이름 관례를 따르는 세션은 원래 슬롯을 되찾고, 아니면 빈 슬롯
    const m = /^shell([1-4])@/.exec(id);
    const preferred = m ? (Number(m[1]) as 1 | 2 | 3 | 4) : undefined;
    const slot = preferred && !used.has(preferred) ? preferred : ([1, 2, 3, 4] as const).find((n) => !used.has(n));
    if (!slot) {
      this.logEvent("app", `재부착 불가 · 슬롯 가득 참 (4/4) · ${id}`);
      this.broadcast();
      return;
    }
    SESSIONS.push(
      s(id, wsId, slot, "", "", {
        status: "shell",
        cwd: ws.path,
        sinceMs: 0,
        revived: true,
        resumeReason: "일반 셸 · cwd 유지",
        lastOutput: "웹뷰 재시작 · 세션 이어짐",
      }),
    );
    this.logEvent("state", `웹뷰 재시작 · 기본 터미널 재부착 · SLOT ${slot}`, id);
    this.broadcast();
  }

  hydrateUnseen(wsId: string, ids: string[]) {
    const want = new Set(ids);
    let changed = false;
    for (const sess of SESSIONS) {
      if (sess.workspaceId !== wsId || !want.has(sess.id) || sess.unseen) continue;
      sess.unseen = true;
      changed = true;
    }
    if (changed) this.broadcast();
  }

  applyMemory(samples: { id: string; mb: number; peakMb: number }[]) {
    let changed = false;
    for (const m of samples) {
      const sess = SESSIONS.find((x) => x.id === m.id);
      if (!sess || (sess.memoryMb === m.mb && sess.memoryPeakMb === m.peakMb)) continue;
      sess.memoryMb = m.mb;
      sess.memoryPeakMb = m.peakMb;
      changed = true;
    }
    if (changed) this.broadcast();
  }

  applyAgentState(evt: AgentStateApply) {
    const sess = SESSIONS.find((x) => x.id === evt.session);
    if (!sess) return;
    sess.restored = false; // 실물 에이전트가 붙었다 — 복원 대기 상태 해제
    const prev = sess.status;
    sess.agentSessionId = evt.agentSession.slice(0, 8);
    if (evt.status) sess.status = evt.status;
    sess.waitingFor = evt.waitingFor;
    sess.activity = evt.activity; // 훅 2차 소스 (FR-D-15) — 도구명, 없으면 지운다
    if (evt.subagents !== undefined) sess.subagents = evt.subagents; // FR-D-18
    sess.resumable = evt.resumable;
    sess.resumeReason = evt.resumable ? "transcript + cwd 일치" : "transcript 없음";
    if (evt.version) sess.agentVersion = evt.version;
    sess.exitCode = evt.exitCode;
    if (evt.status && prev !== evt.status) {
      sess.sinceMs = 0;
      // 미확인 마킹은 알림 대상과 같은 2종뿐이다 (FR-G-45)
      if (evt.status === "waiting" || evt.status === "dead") sess.unseen = true;
      if (evt.status !== "dead") sess.restartNeeded = sess.restartNeeded && evt.status === "starting";
      sess.lastOutput =
        evt.status === "waiting"
          ? `승인 대기 · ${evt.waitingFor ?? ""}`
          : evt.status === "dead"
            ? `종료됨 · exit ${evt.exitCode ?? "?"}`
            : evt.status === "busy"
              ? "작업 중"
              : sess.lastOutput;
      this.logEvent("state", `${prev} → ${evt.status}`, sess.id);
    }
    // busy 중에는 카드 한 줄에 현재 도구를 부연한다 (FR-D-15) — 전이 없는 activity 갱신도 반영
    if (sess.status === "busy") {
      sess.lastOutput = sess.activity ? `작업 중 · ${sess.activity}` : "작업 중";
    }
    this.broadcast();
  }

  updateSessionRole(id: string, personaId: string, jobId: string) {
    const sess = SESSIONS.find((x) => x.id === id);
    if (!sess) return;
    const wasRoleless = !sess.personaId;
    const permChanged = sess.jobId !== jobId;
    sess.personaId = personaId;
    sess.jobId = jobId;
    if (permChanged) sess.restartNeeded = true;
    const pName = PERSONAS.find((x) => x.id === personaId)?.name ?? personaId;
    const jName = JOBS.find((x) => x.id === jobId)?.name ?? jobId;
    const suffix = permChanged ? " · 권한 변경 → 재시작 필요" : "";
    if (!personaId) this.logEvent("agent", `역할 해제 · 기본 터미널로 전환${suffix}`, id);
    else if (wasRoleless) this.logEvent("agent", `역할 부여 · ${pName} · ${jName}${suffix}`, id);
    else this.logEvent("agent", `역할 변경 · ${pName} · ${jName}${suffix}`, id);
    this.broadcast();
  }

  createMission(wsId: string, name: string, goal: string, branch?: string) {
    const id = `mission-${seq++}`;
    MISSIONS.push({
      id,
      workspaceId: wsId,
      name,
      file: `.eqmux/missions/${id}.md`,
      status: "todo",
      goal,
      outputs: [],
      branch,
      assigned: [],
    });
    this.logEvent("mission", `임무 생성 · ${name}`);
    this.broadcast();
  }

  cycleMissionStatus(id: string) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m) return;
    const order: Mission["status"][] = ["todo", "in-progress", "in-review", "done"];
    m.status = order[(order.indexOf(m.status) + 1) % order.length];
    this.logEvent("mission", `${m.name} → ${m.status}`);
    this.broadcast();
  }

  hydrateMissions(wsId: string, list: Mission[]) {
    for (let i = MISSIONS.length - 1; i >= 0; i--) {
      if (MISSIONS[i].workspaceId === wsId) MISSIONS.splice(i, 1);
    }
    MISSIONS.push(...list);
    // 배정의 원본은 역할 파일 (FR-E-58) — 세션의 missionId를 파일 실측에 맞춘다
    for (const sess of SESSIONS) {
      if (sess.workspaceId !== wsId) continue;
      sess.missionId = list.find((m) => m.assigned.includes(sess.id))?.id;
    }
    this.broadcast();
  }

  toggleAssign(missionId: string, sessionId: string) {
    const m = MISSIONS.find((x) => x.id === missionId);
    if (!m) return;
    const i = m.assigned.indexOf(sessionId);
    if (i >= 0) m.assigned.splice(i, 1);
    else m.assigned.push(sessionId);
    const sess = SESSIONS.find((x) => x.id === sessionId);
    if (sess) sess.missionId = i >= 0 ? undefined : missionId;
    this.logEvent("mission", `임무 배정 변경 · ${m.name}`, sessionId);
    this.broadcast();
  }

  addWorkspace(remote?: string) {
    const n = seq++;
    const name = remote ? remote.split("/").pop()! : `Repo-${n}`;
    WORKSPACES.push({
      id: `ws${n}`,
      name,
      path: `C:\\workspace\\${name}`,
      remote,
      branch: "main",
      branchNote: remote ? "clone 완료 · 방금" : "main · 방금",
      open: false,
      pathMissing: false,
      teamFile: ".eqmux/team.json",
    });
    this.logEvent("app", `저장소 등록 · ${name}`);
    this.broadcast();
  }

  openWorkspace(id: string) {
    const ws = WORKSPACES.find((x) => x.id === id);
    if (!ws || ws.pathMissing) return;
    if (!ws.open && WORKSPACES.filter((x) => x.open).length >= 10) {
      this.logEvent("app", "동시 오픈 상한 10 도달 (B9)");
    } else if (!ws.open) {
      ws.open = true;
      this.logEvent("app", `워크스페이스 열림 · ${ws.name}`);
    }
    this.broadcast();
  }

  closeWorkspace(id: string) {
    const ws = WORKSPACES.find((x) => x.id === id);
    if (!ws || !ws.open) return;
    ws.open = false;
    this.logEvent("app", `워크스페이스 닫힘 · ${ws.name} (세션은 백그라운드 유지)`);
    this.broadcast();
  }

  repairWorkspace(id: string) {
    const ws = WORKSPACES.find((x) => x.id === id);
    if (!ws) return;
    ws.pathMissing = false;
    ws.branch = "main";
    ws.branchNote = "main · 경로 재지정됨";
    this.logEvent("app", `경로 재지정 · ${ws.name}`);
    this.broadcast();
  }

  hydrateLibrary(jobs: Job[], personas: Persona[]) {
    // 배열 참조를 바꾸지 않고 내용만 교체 — 화면·합성이 같은 배열을 계속 본다
    JOBS.splice(0, JOBS.length, ...jobs);
    PERSONAS.splice(0, PERSONAS.length, ...personas);
    this.broadcast();
  }

  hydrateWorkspaces(list: Workspace[]) {
    const openIds = new Set(WORKSPACES.filter((w) => w.open).map((w) => w.id));
    WORKSPACES.length = 0;
    for (const w of list) WORKSPACES.push({ ...w, open: openIds.has(w.id) });
    // 레지스트리에 없는 워크스페이스의 목 세션·임무는 함께 걷어낸다
    const valid = new Set(WORKSPACES.map((w) => w.id));
    for (let i = SESSIONS.length - 1; i >= 0; i--) {
      if (!valid.has(SESSIONS[i].workspaceId)) SESSIONS.splice(i, 1);
    }
    for (let i = MISSIONS.length - 1; i >= 0; i--) {
      if (!valid.has(MISSIONS[i].workspaceId)) MISSIONS.splice(i, 1);
    }
    this.broadcast();
  }

  removeWorkspace(id: string) {
    const i = WORKSPACES.findIndex((x) => x.id === id);
    if (i < 0) return;
    const ws = WORKSPACES[i];
    WORKSPACES.splice(i, 1);
    for (let j = SESSIONS.length - 1; j >= 0; j--) {
      if (SESSIONS[j].workspaceId === id) SESSIONS.splice(j, 1);
    }
    for (let j = MISSIONS.length - 1; j >= 0; j--) {
      if (MISSIONS[j].workspaceId === id) MISSIONS.splice(j, 1);
    }
    this.logEvent("app", `등록 해제 · ${ws.name} (디스크는 그대로)`);
    this.broadcast();
  }

  savePersona(p: Persona) {
    const i = PERSONAS.findIndex((x) => x.id === p.id);
    if (i >= 0) PERSONAS[i] = p;
    this.logEvent("app", `페르소나 저장 · ${p.name}`);
    this.broadcast();
  }

  addPersona() {
    const n = seq++;
    PERSONAS.push({ id: `p${n}`, name: `새 페르소나`, hint: "판단 성향 1줄 (P3 예산 5~10줄)", color: "blue" });
    this.broadcast();
  }

  saveJob(j: Job) {
    const i = JOBS.findIndex((x) => x.id === j.id);
    if (i >= 0) JOBS[i] = j;
    else JOBS.push(j);
    this.logEvent("app", `직무 저장 · ${j.name}`);
    this.broadcast();
  }

  deleteJob(id: string) {
    const i = JOBS.findIndex((x) => x.id === id);
    if (i < 0) return;
    JOBS.splice(i, 1);
    this.broadcast();
  }

  listTurns(sessionId: string): TranscriptTurn[] {
    return TURNS.get(sessionId) ?? [];
  }

  sendInput(sessionId: string, text: string) {
    const turns = TURNS.get(sessionId) ?? [];
    turns.push({ role: "user", time: nowTime(), text });
    turns.push({ role: "agent", time: nowTime(), text: "입력을 PTY로 전달했습니다 (V3) — 목 응답입니다." });
    TURNS.set(sessionId, turns);
    this.broadcast();
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    if (!this.timer) {
      this.timer = setInterval(() => {
        for (const sess of SESSIONS) sess.sinceMs += 30000;
        this.listeners.forEach((l) => l());
      }, 30000);
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }
}

export const backend: Backend = new MockBackend();

// ── 패널 목 데이터 — docs/design.pen PAlmZ(git) · KcL3j(로그) · rBkF0(포트) · AXXhV(diff)의 카피 ──

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  when: string;
  tag?: string;
}

export interface GitChangedFile {
  status: "M" | "A" | "D";
  path: string;
  stat: string; // "+18 −6"
}

export interface DiffLine {
  no: number;
  text: string;
  kind?: "add" | "del" | "ctx";
}

export const GIT_STATE = {
  repo: "project/AcademyCurriculum",
  branch: "main",
  ahead: 4,
  behind: 0,
  changed: 25,
  added: 18,
  modified: 6,
  deleted: 1,
  lastCommit: "Sesac: 교재 기반 일차별 학습문서",
  commits: [
    { hash: "07c0aa9", message: "Sesac: 교재 기반 일차별 학습문서", author: "ReDocu", when: "1일 전", tag: "main" },
    { hash: "d447777", message: "MBC: AI 커리큘럼 및 일차별 학습문서", author: "ReDocu", when: "1일 전" },
    { hash: "da53823", message: "KY: 게임개발 24주 커리큘럼", author: "ReDocu", when: "1일 전" },
    { hash: "e67e1e9", message: "프로젝트 메타 정보 추가", author: "ReDocu", when: "1일 전" },
    { hash: "a5bafbe", message: "Initial commit", author: "ReDocu", when: "1일 전", tag: "origin/main" },
  ] as GitCommit[],
};

/** Git Diff & Editor (AXXhV) — feature/auth-refactor의 변경 파일 목 */
export const DIFF_BRANCH = { name: "feature/auth-refactor", ahead: 2, behind: 0 };

export const DIFF_FILES: GitChangedFile[] = [
  { status: "M", path: "src/auth/session.ts", stat: "+18 −6" },
  { status: "M", path: "src/auth/token.ts", stat: "+9 −3" },
  { status: "A", path: "src/auth/guard.ts", stat: "+42" },
  { status: "M", path: "tests/auth/session.test.ts", stat: "+27 −4" },
  { status: "M", path: "package.json", stat: "+2 −1" },
  { status: "D", path: "src/auth/legacy.ts", stat: "−81" },
];

export const DIFF_BASE: { header: string; range: string; lines: DiffLine[] } = {
  header: "feat(auth): add base session token · 2026-08-09 18:42",
  range: "@@ createSession · restoreSession @@",
  lines: [
    { no: 1, text: 'import { sign, verify } from "./token";', kind: "del" },
    { no: 2, text: 'import type { User } from "../types";' },
    { no: 3, text: " " },
    { no: 4, text: "export async function createSession(user: User) {" },
    { no: 5, text: "  const token = sign(user.id);", kind: "del" },
    { no: 6, text: "  return { token, user };", kind: "del" },
    { no: 7, text: " " },
    { no: 8, text: "}" },
    { no: 9, text: " " },
    { no: 10, text: "export async function restoreSession(raw: string) {" },
    { no: 11, text: "  return verify(raw);", kind: "del" },
    { no: 12, text: " " },
    { no: 13, text: " " },
    { no: 14, text: "}" },
    { no: 15, text: "export const SESSION_TTL = 1000 * 60 * 60;" },
  ],
};

export const DIFF_CURRENT: { header: string; range: string; lines: DiffLine[] } = {
  header: "현재 내용 · 저장되지 않은 변경 1개",
  range: "@@ createSession · restoreSession @@",
  lines: [
    { no: 1, text: 'import { signToken, verifyToken } from "./token";', kind: "add" },
    { no: 2, text: 'import type { User } from "../types";' },
    { no: 3, text: " " },
    { no: 4, text: "export async function createSession(user: User) {" },
    { no: 5, text: "  const claims = await buildClaims(user);", kind: "add" },
    { no: 6, text: "  const token = await signToken(claims);", kind: "add" },
    { no: 7, text: "  const expiresAt = Date.now() + SESSION_TTL;", kind: "add" },
    { no: 8, text: "  return { token, user, expiresAt };", kind: "add" },
    { no: 9, text: "}" },
    { no: 10, text: "export async function restoreSession(raw: string) {" },
    { no: 11, text: "  const result = await verifyToken(raw);", kind: "add" },
    { no: 12, text: "  if (!result.valid) return null;", kind: "add" },
    { no: 13, text: "  return hydrateSession(result.claims);", kind: "add" },
    { no: 14, text: "}" },
    { no: 15, text: "export const SESSION_TTL = 1000 * 60 * 60;" },
  ],
};

/** 서버 로그 (KcL3j) — 실시간 스트림 목 */
export interface ServerLog {
  time: string;
  type: "앱" | "세션" | "store" | "agent" | "git";
  message: string;
  level: "info" | "warn" | "error";
  expandable?: boolean;
}

export const SERVER_LOGS: ServerLog[] = [
  { time: "09:47:46", type: "앱", message: "EQMUX 시작 → 워크스페이스 Academy", level: "info" },
  { time: "09:47:46", type: "세션", message: "세션 생성: EQMux/미라 (페르소나 모드)", level: "info" },
  { time: "09:47:46", type: "세션", message: "세션 생성: Academy/카이 (Claude Code)", level: "info" },
  { time: "09:47:46", type: "세션", message: "세션 생성: Academy/노엘 (Claude Code)", level: "info" },
  { time: "09:47:48", type: "세션", message: "세션 생성: Academy/린 (Claude Code)", level: "info" },
  { time: "09:48:02", type: "store", message: "scrollback batch committed · 42ms", level: "info" },
  { time: "09:48:19", type: "agent", message: "노엘 resume mapping restored", level: "warn" },
  { time: "09:49:04", type: "git", message: "git diff --check → exit 1", level: "error", expandable: true },
  { time: "09:49:10", type: "store", message: "cleanup complete · 43MB reclaimed", level: "info" },
];

export const LOG_METRICS = { info: 112, warn: 11, error: 5, total: 128, rate: "4.2 events/s" };

/** 포트 (rBkF0) — 세션 포트 + 시스템 포트 요약 */
export interface SessionPort {
  port: number;
  badge: "LISTENING" | "DEBUG";
  proc: string;
  session: string;
  host: string;
}

export const SESSION_PORTS: SessionPort[] = [
  { port: 5173, badge: "LISTENING", proc: "vite", session: "노엘", host: "127.0.0.1" },
  { port: 3000, badge: "LISTENING", proc: "next dev", session: "카이", host: "127.0.0.1" },
  { port: 9229, badge: "DEBUG", proc: "node inspector", session: "린", host: "127.0.0.1" },
];

export const PORT_SUMMARY = { session: 3, system: 28, conflicts: 0, exposed: 0 };

