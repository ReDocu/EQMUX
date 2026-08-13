// EQMUX 도메인 타입 — PRD C §7.1 · PRD D §4.2.1/§7.1 · PRD G §7.1 스키마의 TS 대응.
// 백엔드(Tauri Rust)와 주고받는 계약이므로 여기 외의 곳에서 도메인 형태를 재정의하지 않는다.

/** PRD D §4.2.1 — 에이전트 어휘 6종을 그대로 채택 (G2) */
export type AgentStatus = "starting" | "busy" | "waiting" | "shell" | "idle" | "dead";

/** 역할 파일 frontmatter의 permissions (D5) */
export interface Permissions {
  write: boolean;
  commit: boolean;
  push: boolean;
}

/** PRD D §4.5.1 — permissions → 실행 플래그 번역 결과 */
export interface RuntimeFlags {
  permissionMode: "manual" | "acceptEdits";
  disallowedTools: string[];
}

export interface Job {
  id: string;
  name: string; // 리드 · 구현 · 검증 · 리뷰
  permissions: Permissions;
  responsibility: string;
  forbidden: string;
}

export interface Persona {
  id: string;
  name: string;
  hint: string; // 판단 성향 1줄 (P3 예산)
  color: "blue" | "purple" | "green" | "amber";
}

/** 세션 = 에이전트 1명 = 페인 1개 (도메인 모델 불변 규칙) */
export interface Session {
  id: string;
  workspaceId: string;
  slot: 1 | 2 | 3 | 4;
  personaId: string;
  jobId: string;
  name?: string; // 세션 표시 이름 (P5 · FR-E-36) — 비우면 페르소나 이름을 쓴다
  agentSessionId?: string; // Claude sessionId (= 앱 발급 UUID, FR-D-01)
  agentVersion?: string;
  pid?: number;
  shell: string;
  cwd: string;
  status: AgentStatus;
  waitingFor?: string; // status=waiting 일 때만 (FR-D-14)
  activity?: string; // 훅 2차 소스 (FR-D-15)
  costUsd?: number; // statusLine 누적 비용 USD (FR-D-19) — 미보고면 undefined
  subagents: number;
  resumable: boolean;
  resumeReason?: string; // "transcript + cwd 일치" | "transcript 없음" 등
  degraded: boolean;
  exitCode?: number;
  missionId?: string;
  restartNeeded: boolean; // 권한 변경 감지 (E11′)
  restored?: boolean; // team.json에서 복원됨 — 에이전트 자동 실행 없음, 재개 칩만 (S3)
  revived?: boolean; // 웹뷰 재시작 복구 (FR-C-06) — PTY가 살아 있어 재부착만 한다 (restored와 배타)
  worktree?: boolean; // 세션 격리 (FR-E-62 · E1′ 옵트인) — cwd가 .eqmux/worktrees/<세션>이다
  unseen?: boolean; // 미확인 (FR-G-44·45) — waiting·dead 진입 2종에만 마킹, 열람 시 해제
  sinceMs: number; // 현재 status 진입 이후 경과
  scrollbackLines: number;
  memoryMb?: number; // C11 · FR-C-09
  memoryPeakMb?: number;
  lastOutput: string;
}

/** agent-state 이벤트·스냅숏의 반영 페이로드 (PRD D §7.1) — 인터페이스·구현·수신부가 공유한다 */
export interface AgentStateApply {
  session: string;
  agentSession: string;
  status?: AgentStatus;
  waitingFor?: string;
  activity?: string; // 훅 2차 소스 (FR-D-15)
  subagents?: number; // FR-D-18
  costUsd?: number; // statusLine 누적 비용 (FR-D-19)
  resumable: boolean;
  version?: string;
  exitCode?: number;
}

/** team.json 복원 슬롯 + 재개·워크트리 결합 정보 (team_load 반환의 소비 형태) */
export interface TeamSlotHydrate {
  slot: number;
  persona: string;
  job: string;
  name?: string | null; // 세션 표시 이름 (P5) — 페르소나 이름과 분리 가능
  worktree?: boolean;
  agentSessionId: string | null;
  resumable: boolean;
  worktreePath?: string | null;
}

/** 세션 표시 이름 (P5 · FR-E-36) — 분리된 이름이 있으면 그것, 없으면 페르소나 이름 */
export const sessionDisplayName = (s: Session, personaName: string): string =>
  s.name?.trim() || personaName;

export type MissionStatus = "todo" | "in-progress" | "in-review" | "done";

export interface Mission {
  id: string;
  workspaceId: string;
  name: string;
  file: string; // .eqmux/missions/*.md 가 원본
  status: MissionStatus;
  goal: string;
  outputs: string[];
  branch?: string; // 선택 연결 (E12)
  assigned: string[]; // session ids
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  remote?: string;
  branch?: string;
  branchNote: string; // "main · 2분 전" | "경로를 찾을 수 없음"
  open: boolean;
  pathMissing: boolean; // 흐름 07 · 재지정 대상
  teamFile: string; // .eqmux/team.json (원본) — result_prd Δ1
  lastUsed?: string;
}

export interface StoreUsage {
  dbFile: string;
  dbSizeMb: number;
  dbPercent: number;
  walLatencyMs: number;
  globalUsage: string; // "1.28G"
}

export interface EventRecord {
  id: string;
  time: string;
  sessionId?: string;
  workspaceId?: string;
  kind: "state" | "store" | "agent" | "git" | "mission" | "app";
  message: string;
}

export interface ConversationMessage {
  id: string;
  time: string;
  from: string; // "나" | 발신 표시명
  to: string; // "@all" | 세션 id (표시할 때 페르소나 이름으로 푼다)
  type: "ask" | "handoff" | "report" | "review" | "escalate"; // M2 — 강제 5종
  body: string;
  unread: boolean;
  workspaceId?: string; // 실물 스트림의 스코프 — 목 시드는 미지정
  ts?: number; // epoch ms — 실물 정렬 키
}

/** PRD D §4.5.1 번역표 */
export function translatePermissions(p: Permissions): RuntimeFlags {
  if (!p.write) {
    return { permissionMode: "manual", disallowedTools: ["Edit", "Write", "NotebookEdit"] };
  }
  if (!p.commit) {
    return {
      permissionMode: "acceptEdits",
      disallowedTools: ["Bash(git commit *)", "Bash(git push *)"],
    };
  }
  if (!p.push) {
    return { permissionMode: "acceptEdits", disallowedTools: ["Bash(git push *)"] };
  }
  return { permissionMode: "acceptEdits", disallowedTools: [] };
}

export function flagsToString(f: RuntimeFlags, sessionId?: string): string {
  const parts = [`--permission-mode ${f.permissionMode}`];
  if (f.disallowedTools.length) parts.push(`--disallowedTools ${f.disallowedTools.join(" ")}`);
  if (sessionId) parts.push(`--session-id ${sessionId}`);
  return parts.join(" ");
}

/** FR-G-07 — 주의 필요 순 정렬 가중치 */
export const ATTENTION_ORDER: Record<AgentStatus, number> = {
  waiting: 0,
  dead: 1,
  busy: 2,
  shell: 3,
  idle: 4,
  starting: 5,
};

export function fmtSince(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분째`;
  return `${Math.floor(m / 60)}시간째`;
}
