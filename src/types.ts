// EQMUX 도메인 타입 — PRD C §7.1 · PRD D §4.2.1/§7.1 · PRD G §7.1 스키마의 TS 대응.
// 백엔드(Tauri Rust)와 주고받는 계약이므로 여기 외의 곳에서 도메인 형태를 재정의하지 않는다.
import { t, tf } from "./i18n";

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
  mtimeMs?: number; // 읽은 시점의 파일 mtime (P-7) — 저장 시 외부 변경 충돌 감지
}

/** 단계별 독립 프로필 — 기본/중급/고급이 판단 성향·말투·성격을 각자 한 벌씩 갖는다 */
export interface PersonaProfile {
  hint: string;
  tone?: string;
  personality?: string;
}

export interface Persona {
  id: string;
  name: string;
  level?: PersonaLevel | string; // 명시적 단계 — 어느 프로필이 활성인지. 없으면 내용 유추 (구 데이터)
  basic?: PersonaProfile; // 단계별 프로필 3벌 — 저장의 원본 (Tauri 실측이 채움)
  mid?: PersonaProfile;
  adv?: PersonaProfile;
  hint: string; // 활성 프로필 편의 사본 — 목록·캐스팅 표시·역할 합성이 그대로 쓴다
  tone?: string;
  personality?: string;
  // 직무 8색 팔레트와 정렬 (jobs.ts JOB_META) — amber는 구 데이터 호환용으로만 남는다
  color: "blue" | "cyan" | "purple" | "pink" | "green" | "red" | "slate" | "orange" | "amber";
  job?: string; // 기본 직무 — 역할 부여가 직무 선택 없이 따라간다. 빈/없음 = 미지정(부여 시 기본값)
  characterPath?: string; // 고급 캐릭터 시트 절대 경로 — personas/<id>.character.md, 존재가 곧 고급
  characterName?: string; // 시트 frontmatter name — 역할 파일 정체성 줄에 쓴다
  characterSource?: string; // 시트 frontmatter source (원전 — 게임·역사·창작)
  mtimeMs?: number; // 읽은 시점의 파일 mtime (P-7) — 저장 시 외부 변경 충돌 감지
}

export type PersonaLevel = "basic" | "mid" | "adv";

/** 페르소나 단계 — 명시적 상태(level)가 원본. 없는 구 데이터만 내용으로 유추한다.
 *  단계 전환 = 프로필 통째 교체 — 다른 단계의 내용은 파일에 보존된다. */
export const personaLevel = (p: Persona): PersonaLevel => {
  if (p.level === "basic" || p.level === "mid" || p.level === "adv") return p.level;
  return p.characterPath ? "adv" : p.tone?.trim() || p.personality?.trim() ? "mid" : "basic";
};

/** 단계의 프로필 — 프로필이 없는 구 데이터(목 등)는 최상위 편의 필드로 받친다 */
export const personaProfile = (p: Persona, lvl: PersonaLevel): PersonaProfile =>
  (lvl === "basic" ? p.basic : lvl === "mid" ? p.mid : p.adv) ?? {
    hint: p.hint,
    tone: p.tone,
    personality: p.personality,
  };

/** 목록·카드 한 줄 소개 — 고급은 캐릭터 시트가 전부이므로 캐릭터 이름(출처)을 보여준다 */
export const personaTagline = (p: Persona): string => {
  if (personaLevel(p) !== "adv") return p.hint;
  const name = p.characterName?.trim();
  if (!name) return "캐릭터 시트";
  return p.characterSource?.trim() ? `${name} (${p.characterSource})` : name;
};

/** 세션 = 에이전트 1명 = 페인 1개 (도메인 모델 불변 규칙) */
export interface Session {
  id: string;
  workspaceId: string;
  slot: number; // 1..8 — 상한은 설정 maxSlots (기본 4 · 옵션 6·8), 절대 상한 HARD_MAX_SLOTS=8
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
  /** 슬롯 단위 권한 오버라이드 (FR-E-34, M31) — 직무 기본값을 이 세션에서만 덮어쓴다.
   *  없으면 직무 기본값. team.json에 영속되고 역할 파일 frontmatter에 반영된다 */
  permOverride?: Permissions;
  restartNeeded: boolean; // 권한 변경 감지 (E11′)
  restored?: boolean; // team.json에서 복원됨 — 에이전트 자동 실행 없음, 재개 칩만 (S3)
  revived?: boolean; // 웹뷰 재시작 복구 (FR-C-06) — PTY가 살아 있어 재부착만 한다 (restored와 배타)
  worktree?: boolean; // 세션 격리 (FR-E-62 · E1′ 옵트인) — cwd가 .eqmux/worktrees/<세션>이다
  unseen?: boolean; // 미확인 (FR-G-44·45) — waiting·dead 진입 2종에만 마킹, 열람 시 해제
  sinceMs: number; // 현재 status 진입 이후 경과
  scrollbackLines: number;
  memoryMb?: number; // C11 · FR-C-09
  memoryPeakMb?: number;
  /** 감지된 에이전트 CLI (셸 우선 모델) — Job 프로세스 트리 실측 표시 이름 (Claude/Codex 등).
   *  관측 전용: 사용자가 터미널에 직접 띄운 것을 이름만 식별한다. 미검출이면 undefined */
  agent?: string;
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
  degraded?: boolean; // 관측 저하 (FR-D-62·63) — 낮은 신뢰 표시 (FR-G-27)
}

/** team.json 복원 슬롯 + 재개·워크트리 결합 정보 (team_load 반환의 소비 형태) */
export interface TeamSlotHydrate {
  slot: number;
  persona: string;
  job: string;
  name?: string | null; // 세션 표시 이름 (P5) — 페르소나 이름과 분리 가능
  worktree?: boolean;
  permissions?: Permissions | null; // 슬롯 권한 오버라이드 (FR-E-34) — 없으면 직무 기본값
  agentSessionId: string | null;
  resumable: boolean;
  worktreePath?: string | null;
}

/** 유효 권한 (FR-E-34) — 슬롯 오버라이드가 있으면 그것, 없으면 직무 기본값 */
export function effectivePermissions(s: Session, job: Job | undefined): Permissions | undefined {
  return s.permOverride ?? job?.permissions;
}

/** 지금 이 페인에 관리 에이전트가 붙어 있는가.
 *
 *  판정은 status만 본다. `agentSessionId`로 재면 안 된다 — 그것은 "언젠가 붙은 적이 있다"는
 *  과거 기록이라 지워지지 않고(agent_session 매핑은 재시작 때 DB에서 되살아난다), 셸로 돌아온
 *  페인·복원된 슬롯까지 "붙어 있음"으로 오판한다. shell = 맨 셸, dead = 프로세스 없음. */
export const agentAttached = (s: Session): boolean => s.status !== "shell" && s.status !== "dead";

/** 지금 이 세션의 PTY에 텍스트를 입력해도 되는가 (P-2 · G7) — idle일 때만 참.
 *
 *  이 판정을 대화 전달(M3)·임무 브리프(FR-E-55)·역할 갱신 안내(FR-E-44)가 함께 쓴다.
 *  경로마다 따로 재면 한 곳이 빠지고, 빠진 곳은 그대로 사고가 된다:
 *   - shell  → 사람이 치던 미제출 명령 뒤에 붙어 그 명령이 실행된다
 *   - waiting → 승인 다이얼로그가 떠 있다. 본문이 오답이 되고 \r이 기본 항목을 실행한다 (G7)
 *   - busy·starting → 턴 중간에 끼어든다. 대기시켰다가 idle 전이에 흘려보내는 것이 맞다
 *  즉시 넣을 수 없을 때 무엇을 할지(인박스 적재·화면 에코·생략)는 호출부가 각자 정한다. */
export const canInject = (s: Session | undefined): boolean => s?.status === "idle";

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
  isDefault?: boolean; // 워크스페이스 기본 임무 (FR-E-56, M33) — frontmatter default: true
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
  if (m < 1) return t("방금");
  if (m < 60) return tf("{m}분째", { m });
  return tf("{h}시간째", { h: Math.floor(m / 60) });
}
