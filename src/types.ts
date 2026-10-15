// EQMUX 도메인 타입 — PRD C §7.1 · PRD D §4.2.1/§7.1 · PRD G §7.1 스키마의 TS 대응.
// 백엔드(Tauri Rust)와 주고받는 계약이므로 여기 외의 곳에서 도메인 형태를 재정의하지 않는다.
import { t, tf } from "./i18n";
import { humanTyping } from "./backend/pty";

/** PRD D §4.2.1 — 에이전트 어휘 6종을 그대로 채택 (G2) */
export type AgentStatus = "starting" | "busy" | "waiting" | "shell" | "idle" | "dead";

/** 관리 기동이 되는 CLI (M37) — Rust agent.rs의 CLI_CLAUDE·CLI_CODEX와 같은 문자열 */
export type AgentCliId = "claude" | "codex";
export const AGENT_CLI_LABEL: Record<AgentCliId, string> = { claude: "Claude Code", codex: "Codex" };
export const cliOf = (s: { cli?: AgentCliId } | undefined): AgentCliId => s?.cli ?? "claude";

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
  title?: string; // 직함 (0.5) — 직무 안에서 맡는 영역 이름. 있을 때만 frontmatter에 쓴다
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
  /** 스폰·재개·재시작 때 실제로 넘긴 실행 플래그 (B39) — 권한 파일이 나중에 바뀌어도
   *  돌고 있는 프로세스의 플래그는 이 값이다. 이 앱이 띄우지 않았으면 undefined */
  spawnFlags?: string;
  restored?: boolean; // team.json에서 복원됨 — 에이전트 자동 실행 없음, 재개 칩만 (S3)
  revived?: boolean; // 웹뷰 재시작 복구 (FR-C-06) — PTY가 살아 있어 재부착만 한다 (restored와 배타)
  worktree?: boolean; // 세션 격리 (FR-E-62 · E1′ 옵트인) — cwd가 .eqmux/worktrees/<세션>이다
  /** 격리 슬롯인데 이 머신에 워크트리 디렉터리가 없다 (다른 머신에서 clone 등) — cwd는 repo
   *  루트 폴백이다. 표시 전용: worktree 플래그(team.json 원본)를 이걸로 지우지 않는다 (B40) */
  worktreeMissing?: boolean;
  unseen?: boolean; // 미확인 (FR-G-44·45) — waiting·dead 진입 2종에만 마킹, 열람 시 해제
  sinceMs: number; // 현재 status 진입 이후 경과 (표시값 — sinceTs에서 파생)
  /** 현재 status로 들어간 시각 epoch ms (B19) — 있으면 경과를 여기서 계산한다.
   *  프런트 누산 타이머는 창이 백그라운드면 스로틀돼 덜 세고, 채택 세션은 앱이 붙기 전부터
   *  그 상태였다. 목 시드는 sinceMs를 직접 정하므로 이 값을 두지 않는다 */
  sinceTs?: number;
  scrollbackLines: number;
  memoryMb?: number; // C11 · FR-C-09
  memoryPeakMb?: number;
  /** 감지된 에이전트 CLI (셸 우선 모델) — Job 프로세스 트리 실측 표시 이름 (Claude/Codex 등).
   *  관측 전용: 사용자가 터미널에 직접 띄운 것을 이름만 식별한다. 미검출이면 undefined */
  agent?: string;
  /** Claude Code가 이 페인의 대화창에 붙인 이름 (`redocu-92`) — 피어 메시지(`@redocu-92`)의 주소.
   *  레지스트리 실측 · 표시 전용. 페인 번호 칸이 끝 조각(`92`)을 보인다 (paneNo) */
  peerName?: string;
  /** 관리 기동 엔진 (M37) — 세션 추가 때 고른 CLI. 없으면 claude. `agent`(실측 표시)와 다르다:
   *  이것은 "무엇으로 띄울 것인가"라는 편성이고 team.json에 영속된다 */
  cli?: AgentCliId;
  lastOutput: string;
  /** 마지막 한 줄 요약 (M35) — Stop 훅이 트랜스크립트에서 뽑아 SQLite에 남긴다.
   *  앱을 껐다 켜도 남는 유일한 "무엇을 하고 있었는가" — 라이브 필드(activity)와 다르다 */
  lastRecap?: string;
  /** 직함 덮어쓰기 (0.5) — 이 워크스페이스에서만. 비우면 페르소나 직함 (effectiveTitle) */
  title?: string;
  /** 턴 완료 신호 (0.5 C1) — turn: Stop으로 30초+ 턴이 끝남, report: report --done 받음.
   *  본 것(markSeen·3초 보임·다시 busy)이 지운다 */
  unseenDone?: "turn" | "report";
  doneText?: string; // report --done 본문 한 줄 — 칩 툴팁
  /** 턴은 끝났는데 맡은 handoff에 보고가 아직 없다 — 할 일 신호라 보기만 해서는 안 지워진다 */
  reportPending?: boolean;
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
  sinceMs?: number; // 이 상태로 들어간 시각 epoch ms (B19) — 없으면 수신 시각을 쓴다
  completed?: boolean; // 턴 완료 (0.5 C1) — 30초 넘은 busy가 Stop으로 idle이 됐다
}

/** team.json 복원 슬롯 + 재개·워크트리 결합 정보 (team_load 반환의 소비 형태) */
export interface TeamSlotHydrate {
  slot: number;
  persona: string;
  job: string;
  name?: string | null; // 세션 표시 이름 (P5) — 페르소나 이름과 분리 가능
  worktree?: boolean;
  permissions?: Permissions | null; // 슬롯 권한 오버라이드 (FR-E-34) — 없으면 직무 기본값
  cli?: string | null; // 관리 기동 엔진 (M37) — team.json 원본, 없으면 claude
  title?: string | null; // 직함 덮어쓰기 (0.5) — 없으면 페르소나 직함
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
 *  즉시 넣을 수 없을 때 무엇을 할지(인박스 적재·화면 에코·생략)는 호출부가 각자 정한다.
 *
 *  idle은 "프롬프트가 비어 있다"는 가정이었는데, 에이전트가 idle인 순간이 곧 사람이 그 페인에
 *  무언가 치고 있는 순간이다 (B20). 그때 주입하면 본문이 사람이 치던 줄 뒤에 이어 붙고 \r이
 *  둘을 합쳐 제출한다 — 쓰던 프롬프트는 사라지고 의도하지 않은 문장이 그 세션의 턴을 시작시킨다.
 *  기본 터미널에는 같은 위험 때문에 화면 에코만 하는 가드가 이미 있다 (P-2). */
export const canInject = (s: Session | undefined): boolean =>
  s?.status === "idle" && !humanTyping(s.id);

/** 세션 표시 이름 (P5 · FR-E-36) — 분리된 이름이 있으면 그것, 없으면 페르소나 이름 */
export const sessionDisplayName = (s: Session, personaName: string): string =>
  s.name?.trim() || personaName;

/** 세션 이름 (C6) — 모든 표시가 이것을 쓴다. 기본 터미널은 만들 때 자동 이름이 s.name에 들어간다 */
export const sessionName = (s: Session, persona: Persona | undefined): string =>
  sessionDisplayName(s, persona?.name ?? (s.personaId || t("기본 터미널")));

/** 유효 직함 (C6) — 슬롯 덮어쓰기, 없으면 페르소나 직함, 둘 다 없으면 undefined */
export const effectiveTitle = (s: Session | undefined, persona: Persona | undefined): string | undefined =>
  s?.title?.trim() || persona?.title?.trim() || undefined;

export const TITLE_MAX = 24;
export const SESSION_NAME_MAX = 24;

/** 직함 입력 정리 — 줄바꿈만 막고 나머지(#·|)는 그대로 둔다. 표 이스케이프는 합성 쪽 일이다 */
export const cleanTitle = (v: string): string => v.replace(/[\r\n]+/g, " ").slice(0, TITLE_MAX);

/** 세션 번호 — 슬롯을 두 자리로 (헤더·레일 공통) */
export const slotNo = (slot: number): string => String(slot).padStart(2, "0");

/** 페인 번호 칸 — Claude Code가 붙인 세션 이름이 있으면 그 끝 조각(`redocu-92` → `92`), 없으면 슬롯 번호.
 *  Claude Code 피어 메시지가 `@redocu-92`로 부르므로 사람이 그 주소를 페인과 맞춰 볼 수 있게 한다 */
export function paneNo(s: { slot: number; peerName?: string }): string {
  const tail = s.peerName?.split("-").pop();
  return tail && tail !== s.peerName ? tail : slotNo(s.slot);
}

/** 번호 칸 옆에 보일 이름 — 이름 끝 두 자리가 슬롯 번호와 같으면(자동 이름 `EQMUX03`, 직접 쓴 `app-03`)
 *  번호 칸이 이미 그 숫자를 보이므로 뗀다: `03 EQMUX03` → `03 EQMUX`. 표시만 바꾼다 — 저장된 이름과
 *  `@EQMUX03` 호출은 그대로이고, 툴팁에는 전체 이름을 둔다. 끝 숫자가 슬롯과 다르면(이름이 겹쳐
 *  다른 번호를 받은 경우) 그대로 둔다 — 번호 칸은 슬롯이고, 둘이 어긋나면 이름이 그 사실을 말해야 한다 */
export function nameBesideNo(slot: number, name: string): string {
  const m = name.match(/^(.*?\D)[-_]?(\d{2})$/u);
  return m && m[2] === slotNo(slot) ? m[1].replace(/[-_]$/, "") : name;
}

/** 자동 이름의 프로젝트명 — 워크스페이스 표시 이름에서 글자·숫자·-·_만, 16자까지. 대소문자는 그대로 */
export const projectStem = (wsName: string): string =>
  wsName.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 16) || "session";

/** 자동 이름 `프로젝트명XX` — XX는 만들 때의 슬롯. 이미 쓰이면 비어 있는 가장 작은 번호.
 *  taken은 소문자로 넣는다 (@이름 호출은 대소문자를 가리지 않는다) */
export function pickAutoName(stem: string, slot: number, taken: ReadonlySet<string>): string {
  const first = `${stem}${slotNo(slot)}`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 1; n < 100; n++) {
    const c = `${stem}${slotNo(n)}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
  return `${stem}${Date.now().toString(36).slice(-3)}`;
}

/** 캐스팅 슬롯 계획 (0.5) — 캐스팅에 남는 세션은 지금 슬롯 그대로, 새 세션은 빈 슬롯을 앞에서부터.
 *  current는 그 워크스페이스의 지금 세션 전부. 역할 세션 중 wanted에 없는 것은 비워질 자리로 본다
 *  (기본 터미널은 편성 대상이 아니라 자리를 지킨다). 빈 슬롯이 모자라면 undefined.
 *  applyCasting과 캐스팅 화면의 SLOT 라벨이 같이 쓴다 — 화면이 보인 번호가 곧 적용될 번호다 */
export function planCastingSlots(
  current: readonly { id: string; slot: number; personaId: string }[],
  wantedIds: readonly string[],
  maxSlots: number,
): (number | undefined)[] {
  const want = new Set(wantedIds);
  const keep = current.filter((x) => !x.personaId || want.has(x.id));
  const used = new Set(keep.map((x) => x.slot));
  return wantedIds.map((id) => {
    const ex = keep.find((x) => x.id === id);
    if (ex) return ex.slot;
    for (let n = 1; n <= maxSlots; n++) {
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    return undefined;
  });
}

/** 세션 이름 검증 — 거부 이유(한국어 원문 = i18n 키) 또는 undefined. 빈 값은 '기본으로 돌아가기'라 통과 */
export function sessionNameError(name: string, taken: ReadonlySet<string>): string | undefined {
  const v = name.trim();
  if (!v) return undefined;
  if (v.length > SESSION_NAME_MAX) return "24자까지 쓸 수 있습니다";
  if (/[\s@]/.test(v)) return "공백과 @는 쓸 수 없습니다";
  if (taken.has(v.toLowerCase())) return "이 워크스페이스에서 이미 쓰는 이름입니다";
  return undefined;
}

export type MissionStatus = "todo" | "in-progress" | "in-review" | "done";

export interface Mission {
  id: string;
  workspaceId: string;
  name: string;
  file: string; // .eqmux/missions/*.md 가 원본
  status: MissionStatus;
  goal: string;
  outputs: string[];
  outputsDone?: boolean[]; // 산출물 체크 (0.5 · C4) — outputs와 같은 순서, 파일의 `- [x]`가 원본
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
  done?: boolean; // report --done (작업 완료 신호) — 대화 탭 ✓ 배지
  file?: { path: string; size: number }; // send --file 첨부 — 저장소 상대 경로
  rowId?: number; // 원장 행 id — 이전 페이지(beforeId) 커서
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

/** Codex 판 (M37) — Rust agent.rs의 codex_permission_args·codex_git_rules와 같은 번역.
 *  write:false(manual) → 읽기 전용 샌드박스, 그 외 → 워크스페이스 쓰기. 승인은 항상 on-request.
 *  git 금지는 Codex에 도구 금지 플래그가 없어 지시로만 실리므로 그렇게 밝힌다 — 플래그처럼
 *  보이게 두면 "막혀 있다"고 믿게 된다. 세션 id는 Codex가 정하므로 재개 앵커로만 보인다. */
export function codexFlagsToString(f: RuntimeFlags, sessionId?: string): string {
  const parts = [
    `--sandbox ${f.permissionMode === "manual" ? "read-only" : "workspace-write"}`,
    "--ask-for-approval on-request",
  ];
  const git = f.disallowedTools.filter((d) => d.startsWith("Bash(git "));
  if (git.length) parts.push(`(지시로만: ${git.join(" ")})`);
  if (sessionId) parts.push(`resume ${sessionId}`);
  return parts.join(" ");
}

/** 엔진별 실행 플래그 문자열 — 세션 상세의 "실제/예상 실행 플래그"와 스폰 기록(B39)이 같이 쓴다 */
export function agentFlagsToString(cli: AgentCliId | undefined, f: RuntimeFlags, sessionId?: string): string {
  return cli === "codex" ? codexFlagsToString(f, sessionId) : flagsToString(f, sessionId);
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
