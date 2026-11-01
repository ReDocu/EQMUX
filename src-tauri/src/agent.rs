// 에이전트 런타임 (PRD D) — ClaudeCodeAdapter. Claude 고유 지식은 이 모듈에만 둔다 (FR-D-60).
// 상태의 1차 소스는 세션 레지스트리 파일(§10.1)이며 출력 파싱을 하지 않는다 (FR-D-10).
// 2차 소스는 훅 — `eqmux _hook`(PRD I)이 파이프로 넣어주는 이벤트를 apply_hook이 받는다.
// 두 소스 모두 Tracked diff → emit_state 한 경로로 나가므로 화면은 출처를 구분하지 않는다.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::Duration;

use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

/// 추적 중인 에이전트 — 앱 세션(페인) ↔ Claude sessionId(FR-D-01 발급 UUID) 매핑
#[derive(Clone, Default)]
pub struct Tracked {
    pub app_session: String,
    pub ws: String,
    pub cwd: String,
    pub name: String,
    pub permission_mode: String,
    pub disallowed: Vec<String>,
    pub last_status: String,
    pub last_waiting: Option<String>,
    pub pty_gen: u64,
    /// 훅 2차 소스가 채우는 것 (FR-D-15·18) — 현재 도구명·동시 서브에이전트 수
    pub activity: Option<String>,
    pub subagents: i64,
    /// statusLine 채널 (FR-D-19 · §10.4) — 세션 누적 비용 USD
    pub cost_usd: Option<f64>,
    /// 관측 저하 (FR-D-62·63, M34) — 레지스트리를 못 쓰는 중. 훅+프로세스 생존으로 유지된다
    pub degraded: bool,
    /// 훅(2차 소스)이 마지막으로 상태를 바꾼 시각 ms (P-3) — 레지스트리 재스캔이 이보다
    /// 오래된 파일 상태로 신선한 훅 상태를 되돌리지 않게 하는 가드
    pub hook_ms: i64,
    /// 지금 상태로 들어간 시각 epoch ms (B19) — 화면의 '· N분째'가 이걸로 계산된다.
    /// 프런트 누산 타이머는 창이 백그라운드면 스로틀돼 덜 세고, 채택 세션은 앱이 붙기 전부터
    /// 기다리고 있었다. 오래 기다린 순서로 처리하려는 사람에게 그 차이가 곧 잘못된 우선순위다.
    pub status_ms: i64,
    /// 상태 이벤트 순번 (P-4) — 전역 단조 증가. 스냅숏과 실시간 이벤트가 겹치는 창에서
    /// 프런트가 더 오래된 페이로드를 버릴 수 있게 한다
    pub seq: u64,
    /// pid로 채택된 세션 (A) — 앱이 띄우지 않았으므로 훅도 재개 앵커도 없다.
    /// 상태는 레지스트리 재스캔에만 의존하고, 프로세스가 사라지면 shell로 되돌린다.
    pub adopted: bool,
    /// 채택 시점의 claude 프로세스 pid — 생존 확인의 근거 (adopted일 때만 의미가 있다)
    pub pid: Option<u32>,
    /// 사람의 선택을 기다리는 프롬프트가 떠 있다 (HookEffect::Ask) — 레지스트리는 이 사이에도
    /// 질의가 진행 중이라고 보아 busy를 쓰므로, 2초 재스캔이 waiting을 도로 내려버린다.
    /// 그 동안만 재스캔의 상태 갱신을 막는 표식. 답이 들어오면(PostToolUse) 바로 풀린다.
    pub asking: bool,
    /// 실행 엔진 (M37) — "codex"면 CodexAdapter 경로(훅만이 상태 소스, 레지스트리 없음).
    /// 빈 값·"claude"는 Claude Code. Default가 빈 문자열이라 옛 코드 경로는 그대로 Claude다.
    pub cli: String,
    /// Codex 롤아웃(트랜스크립트) 경로 — SessionStart 훅 payload의 transcript_path.
    /// Claude는 cwd+uuid로 경로를 계산하지만, Codex는 세션 id도 파일 위치도 스스로 정하므로
    /// 훅이 알려준 값을 들고 있어야 재개 가능 판정(resumable_of)이 성립한다.
    pub transcript: Option<String>,
    /// 이번 턴이 시작된 시각 ms — busy로 들어갈 때 찍고 Stop(idle)에서 거둔다. 턴 완료 신호의 길이 판정
    pub busy_since: Option<i64>,
    /// Stop이 30초 넘는 턴을 닫았다 — apply_hook이 방송에 실으며 지운다 (AgentStateEvt.completed)
    pub turn_done: bool,
}

// ── 실행 엔진 (M37) — 관리 기동이 되는 CLI는 둘: Claude Code(기본)와 Codex ──
//
// 메시지 버스(eqmux send → 파이프 → 원장 → PTY 주입)는 처음부터 CLI를 가리지 않았다. 갈렸던
// 것은 관리 기동 경로 — 역할 주입·훅·상태·재개 앵커 — 뿐이라, Codex 지식도 Claude 지식과
// 같은 원칙으로 이 모듈에만 둔다 (FR-D-60). 실측 기준 Codex CLI 0.146.0 (Windows):
//   · 훅은 hooks.json과 같은 스키마를 `-c hooks.<Event>=[...]` 인라인 오버라이드로 받는다.
//     stdin JSON에 session_id·transcript_path·cwd·hook_event_name이 오고, Stop에는
//     last_assistant_message가 실린다. SessionStart 출력의 hookSpecificOutput.additionalContext는
//     Claude와 똑같이 컨텍스트로 들어간다 — `eqmux _hook`이 그대로 통한다.
//   · --session-id가 없다. 스레드 id는 Codex가 정하고 SessionStart 훅이 알려준다 (adopt_codex_session).
//   · --append-system-prompt의 자리는 `-c developer_instructions='…'`다.
//   · 도구 서브프로세스 환경은 shell_environment_policy가 거른다 (KEY·SECRET·TOKEN 포함 변수 제외가
//     기본) — EQMUX_TOKEN을 `shell_environment_policy.set`으로 명시 재주입해야 `eqmux send`가 선다.

pub const CLI_CLAUDE: &str = "claude";
pub const CLI_CODEX: &str = "codex";

pub fn is_codex(cli: &str) -> bool {
    cli == CLI_CODEX
}

/// 프런트가 보낸 엔진 이름 → 정본. 모르는 값·없음은 Claude — 옛 team.json(cli 필드 없음)이 그대로 산다
pub fn normalize_cli(cli: Option<&str>) -> String {
    match cli {
        Some(c) if c == CLI_CODEX => CLI_CODEX.into(),
        _ => CLI_CLAUDE.into(),
    }
}

/// 경로가 있고 비어 있지 않은 파일인가 — 재개 가능 판정의 공통 실측 (추정하지 않는다, FR-D-20)
pub fn path_nonempty(p: Option<&str>) -> bool {
    p.filter(|p| !p.is_empty())
        .and_then(|p| fs::metadata(p).ok())
        .map(|m| m.len() > 0)
        .unwrap_or(false)
}

/// 재개 가능 — 엔진별 트랜스크립트 실측. Claude는 cwd+uuid 규칙, Codex는 훅이 알려준 롤아웃 경로.
pub fn resumable_of(t: &Tracked, uuid: &str) -> bool {
    if is_codex(&t.cli) {
        return path_nonempty(t.transcript.as_deref());
    }
    resumable(&t.cwd, uuid)
}

/// Codex에 거는 훅 이벤트 — Claude의 hook-settings.json과 같은 집합에 PermissionRequest가 더 있다
/// (승인 요청은 Claude의 Notification에 해당하고, Codex에는 그 이름의 이벤트가 없다).
pub const CODEX_HOOK_EVENTS: [&str; 8] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SubagentStart",
    "SubagentStop",
    "PermissionRequest",
];

/// Codex 훅 주입 — hooks.json을 쓰지 않는다. ~/.codex는 사용자의 것이고(S6 · FR-E-70과 같은 원칙)
/// repo의 .codex/도 마찬가지라, 프로세스 한 번에만 사는 `-c` 인라인 오버라이드로 얹는다.
/// 값은 TOML 인라인 배열이고 문자열은 작은따옴표(리터럴)만 쓴다 — cmd.exe 폴백 경로에서 큰따옴표가
/// 깨지지 않게. `--dangerously-bypass-hook-trust`: Codex는 새 훅마다 사람의 /hooks 승인을 요구하는데,
/// 이 훅은 저장소가 아니라 앱이 스스로 쓴 명령(eqmux _hook)이라 심사 대상이 아니다. 없으면 첫 세션의
/// 훅이 조용히 안 돌아 상태가 영영 starting에 머문다 — "도착은 했는데 턴이 안 도는" 그 자리다.
pub fn codex_hook_args() -> Vec<String> {
    let mut v: Vec<String> = vec![
        "--enable".into(),
        "hooks".into(),
        "--dangerously-bypass-hook-trust".into(),
    ];
    for e in CODEX_HOOK_EVENTS {
        v.push("-c".into());
        v.push(format!(
            "hooks.{e}=[{{hooks=[{{type='command',command='eqmux _hook {e}',timeout=5}}]}}]"
        ));
    }
    v
}

/// 권한 → Codex 플래그 (§4.5.1의 Codex 판). 프런트는 Claude 모양(permission_mode·disallowedTools)으로
/// 보내고 여기서 번역한다 — 권한의 원천(역할 파일 frontmatter, D5)과 번역표(translatePermissions)는
/// 하나여야 하기 때문. write:false(manual) → 읽기 전용 샌드박스, 그 외 → 워크스페이스 쓰기.
/// 승인은 항상 on-request — bypass(--dangerously-bypass-approvals-and-sandbox)는 어떤 경로로도 만들지
/// 않는다 (Claude의 bypassPermissions와 같은 금지).
pub fn codex_permission_args(permission_mode: &str) -> Vec<String> {
    let sandbox = if permission_mode == "manual" { "read-only" } else { "workspace-write" };
    vec![
        "--sandbox".into(),
        sandbox.into(),
        "--ask-for-approval".into(),
        "on-request".into(),
    ]
}

/// disallowedTools의 git 금지 → 지시문. Codex에는 도구 금지 플래그가 없어 개발자 지시로만 전한다 —
/// 플래그가 아니라 규범이므로 세션 상세의 실행 플래그 표시도 이것을 "지시로만"이라고 밝힌다.
pub fn codex_git_rules(disallowed: &[String]) -> Option<&'static str> {
    let commit = disallowed.iter().any(|d| d.contains("git commit"));
    let push = disallowed.iter().any(|d| d.contains("git push"));
    match (commit, push) {
        (true, _) => Some("git commit과 git push는 금지다 — 변경은 작업 트리에 남기고 보고한다."),
        (false, true) => Some("git push는 금지다 — 커밋까지만 하고 보고한다."),
        _ => None,
    }
}

/// `-c key='…'`에 실을 한 줄 — TOML 리터럴 문자열은 작은따옴표도 줄바꿈도 담을 수 없다.
/// 파싱에 실패하면 Codex가 원문을 통째로 문자열로 쓰므로 깨져도 세션은 뜨지만, 따옴표째 들어간
/// 지시는 읽기 어렵다 — 여기서 미리 걷는다.
pub fn toml_literal_line(s: &str) -> String {
    s.replace("\r\n", " ").replace(['\r', '\n'], " ").replace('\'', "’")
}

static NEXT_EVT_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// 상태 이벤트 순번 발급 (P-4) — 세션 재스폰에도 되돌아가지 않도록 전역 카운터 하나를 쓴다
pub fn next_seq() -> u64 {
    NEXT_EVT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// 세션당 알림 합침 상태 (FR-G-32) — 마지막 발신 시각 + 그 사이 억제된 건수
struct NotifyGate {
    last_ms: i64,
    suppressed: u32,
}

#[derive(Default)]
pub struct AgentRt {
    pub by_uuid: Mutex<HashMap<String, Tracked>>,
    /// 사용자가 의도한 종료 (중지·제거) — dead 알림 대상이 아니다 (G3: dead = 의도치 않은 종료)
    pub expected_exit: Mutex<HashSet<String>>,
    notify_gate: Mutex<HashMap<String, NotifyGate>>,
    /// 세션별 IPC 토큰 (P-1) — 스폰 시 발급되어 EQMUX_TOKEN으로 주입되고, 파이프 요청의
    /// session 주장을 검증한다. 세션 id는 추측 가능한 평문이라 id만으로는 신원이 아니다.
    pub session_tokens: Mutex<HashMap<String, String>>,
    /// 세션 원점 (워크스페이스 id, cwd) — 셸·에이전트 공통 스폰 관문이 채운다.
    /// IPC 발신(send·report)이 워크스페이스를 푸는 자리다. by_uuid는 관리되는 에이전트만
    /// 담으므로, 그것만 보면 셸 우선 모델의 보통 세션은 자기 워크스페이스를 못 밝힌다.
    pub session_origin: Mutex<HashMap<String, (String, String)>>,
    /// 레지스트리 파일 파싱 캐시 (최적화 A5) — 2초마다 전부 다시 읽지 않는다. 스캔 스레드만 쓴다
    registry_cache: Mutex<RegistryCache>,
}

/// 레지스트리 파일별 (수정 시각, 크기) → 파싱 결과. 둘이 같으면 다시 읽지 않는다.
/// 파싱 실패도 기억한다 — 손상 파일을 2초마다 다시 읽지 않게. 사라진 파일은 스캔마다 걷힌다
type RegistryCache = HashMap<PathBuf, (std::time::SystemTime, u64, Option<RegistryRecord>)>;

/// 세션 영구 제거 시 잔류 상태 정리 (P-9) — 추적 맵·알림 게이트·IPC 토큰·세션 원점.
/// expected_exit는 남긴다 — 진행 중인 kill의 EOF 처리(on_pty_exit)가 스스로 소비한다.
pub fn forget_session(app: &AppHandle, id: &str) {
    let rt: tauri::State<AgentRt> = app.state();
    if let Ok(mut map) = rt.by_uuid.lock() {
        map.retain(|_, t| t.app_session != id);
    }
    if let Ok(mut gates) = rt.notify_gate.lock() {
        gates.remove(id);
        gates.remove(&done_key(id)); // 완료 알림 게이트도 같은 세션 것이다 (CPU·RAM L4)
    }
    if let Ok(mut tokens) = rt.session_tokens.lock() {
        tokens.remove(id);
    }
    if let Ok(mut origin) = rt.session_origin.lock() {
        origin.remove(id);
    };
}

/// §7.1 상태 신호 스키마
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateEvt {
    pub session: String,
    pub agent_session: String,
    pub status: String,
    pub waiting_for: Option<String>,
    /// 훅 2차 소스 (FR-D-15) — 현재 사용 중인 도구명. 상태가 아니라 부연이다
    pub activity: Option<String>,
    /// 동시 실행 서브에이전트 수 (FR-D-18) — SubagentStart/Stop 카운트
    pub subagents: i64,
    /// statusLine 누적 비용 USD (FR-D-19) — 없으면 아직 보고 전
    pub cost_usd: Option<f64>,
    pub resumable: bool,
    pub version: Option<String>,
    pub exit_code: Option<i64>,
    /// 낮은 신뢰 표시 (FR-G-27) — 레지스트리 접근 불가로 상태의 정밀도가 떨어진 세션
    pub degraded: bool,
    /// 순번 (P-4) — 프런트의 순서 역전 가드. 스냅숏은 마지막 발급 순번을 그대로 싣는다
    pub seq: u64,
    /// 이 상태로 들어간 시각 epoch ms (B19) — 없으면 프런트가 수신 시각을 쓴다
    pub since_ms: Option<i64>,
    /// 30초 넘게 일한 턴이 방금 끝났다 (계약 C1) — 그 한 번의 방송에만 실린다
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub completed: bool,
}

/// 세션 레지스트리 레코드 (§10.1) — 부분 파싱 (FR-D-64): 모르는 필드는 무시,
/// 필드 부재는 None. 공개 계약이 아니므로 전부 Option이다.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RegistryRecord {
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    waiting_for: Option<String>,
    #[serde(default)]
    version: Option<String>,
    /// claude 프로세스 pid — 앱 발급 UUID가 없는 세션을 페인에 잇는 유일한 끈 (A)
    #[serde(default)]
    pid: Option<u32>,
    #[serde(default)]
    cwd: Option<String>,
    /// "interactive" = 사람이 쓰는 대화창, "bg" = 부모가 띄운 배경/서브에이전트 (B38)
    #[serde(default)]
    kind: Option<String>,
}

fn home() -> PathBuf {
    crate::home_dir()
}

/// Claude Code가 세션에 붙인 이름 (`redocu-92`) — 피어 메시지(`@redocu-92`)의 주소다. 레지스트리 파일은
/// pid로 이름이 붙어 있어(`<pid>.json`) 페인 트리의 pid로 바로 찾는다. 사람이 쓰는 대화창만 —
/// 서브에이전트·배경 claude도 같은 트리에 있다(B38). 이름이 없거나 못 읽으면 None
pub(crate) fn peer_name(pids: &[u32]) -> Option<String> {
    let dir = sessions_dir();
    pids.iter().find_map(|pid| {
        let text = fs::read_to_string(dir.join(format!("{pid}.json"))).ok()?;
        let v: serde_json::Value = serde_json::from_str(&text).ok()?;
        if v.get("kind").and_then(|k| k.as_str()).is_some_and(|k| k != "interactive") {
            return None;
        }
        v.get("name")?.as_str().filter(|n| !n.is_empty()).map(str::to_string)
    })
}

fn sessions_dir() -> PathBuf {
    home().join(".claude").join("sessions")
}

/// 트랜스크립트 경로 (§10.3) — Claude Code의 projects 디렉터리 명명 규칙과 일치해야 한다.
/// 실측 결과 CC는 ASCII 영숫자만 남기고 나머지(`:` `\` `/` `.` `_` 공백 한글 등)를 전부 '-'로 치환한다
/// (예: `C:\Users` → `C--Users`, `D:\ClaudeProject.EQMent` → `D---ClaudeProject-EQMent`).
/// cwd가 경로에 들어가므로 재개는 같은 cwd에서만 성립한다 (FR-D-03 · R4).
pub fn transcript_path(cwd: &str, uuid: &str) -> PathBuf {
    let escaped: String = cwd
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    home()
        .join(".claude")
        .join("projects")
        .join(escaped)
        .join(format!("{uuid}.jsonl"))
}

/// cwd의 Claude projects 디렉터리에서 가장 최근에 수정된 트랜스크립트 (셸 우선 모델) —
/// 사용자가 터미널에 직접 띄운 에이전트는 uuid 매핑이 없으므로 cwd로 추정한다.
/// 같은 cwd를 쓰는 세션들은 같은 파일을 보게 된다 — 표시(참조만, V2)라서 감수한다.
pub fn latest_transcript(cwd: &str) -> Option<PathBuf> {
    let with_dummy = transcript_path(cwd, "x");
    latest_jsonl_in(with_dummy.parent()?)
}

fn latest_jsonl_in(dir: &std::path::Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for e in fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        if meta.len() == 0 {
            continue;
        }
        let Ok(t) = meta.modified() else { continue };
        if best.as_ref().is_none_or(|(bt, _)| t > *bt) {
            best = Some((t, p));
        }
    }
    best.map(|(_, p)| p)
}

/// 재개 가능 판정 = 트랜스크립트 존재 + 비어 있지 않음 (FR-D-20). 추정하지 않고 실측한다.
pub fn resumable(cwd: &str, uuid: &str) -> bool {
    fs::metadata(transcript_path(cwd, uuid))
        .map(|m| m.len() > 0)
        .unwrap_or(false)
}

/// 기동 커맨드 빌더 후보 (§4.1.1) — exe 직접 실행, 실패 시 cmd 경유(npm .cmd 설치 대비).
/// exe는 엔진 이름(claude · codex)이고 인자는 호출부가 엔진별로 짠다. 환경변수는 두 엔진이
/// 같다 — `eqmux` CLI·훅이 보는 것은 세션 신원(EQMUX_SESSION·TOKEN)과 역할 파일뿐이라서.
/// bypassPermissions는 어떤 경로로도 만들지 않는다.
pub fn agent_builders(
    exe: &str,
    args: &[String],
    cwd: &str,
    app_session: &str,
    role_file: Option<&str>,
    settings_file: Option<&str>,
    token: &str,
) -> Vec<CommandBuilder> {
    let team_md = std::path::Path::new(cwd).join(".eqmux").join("team.md");
    let team_md = team_md.exists().then(|| team_md.to_string_lossy().into_owned());
    let apply = |b: &mut CommandBuilder| {
        b.cwd(cwd);
        // FR-D-04 환경변수 — 역할·팀 파일은 존재할 때만 (파일이 원본, FR-E-41)
        b.env("EQMUX_SESSION", app_session);
        // 세션 토큰 (P-1) — 파이프 IPC의 신원 증명. 세션 id는 공개 관례(`이름@ws`)라
        // 추측 가능하므로, 스폰마다 새로 발급한 논스가 실제 신원이다
        b.env("EQMUX_TOKEN", token);
        b.env("EQMUX_TERMINAL", "eqmux");
        // 어느 엔진 안에서 도는지 (M37) — 훅·CLI가 엔진별 분기를 해야 할 때의 근거
        b.env("EQMUX_AGENT", exe);
        // `eqmux` CLI(PRD I)가 PATH에서 잡히도록 앱 실행 파일 폴더를 앞에 붙인다 —
        // 훅 커맨드·에이전트의 send/report가 절대 경로 없이 성립한다
        if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
            let path = std::env::var("PATH").unwrap_or_default();
            b.env("PATH", format!("{}{}{}", dir.display(), crate::PATH_SEP, path));
        }
        if let Some(rf) = role_file {
            b.env("EQMUX_ROLE_FILE", rf);
        }
        // 상태 줄 표시 모드의 원본 (FR-D-19) — 값이 아니라 파일 경로를 심는다. `eqmux
        // _statusline`이 매 호출마다 다시 읽으므로 설정 변경이 재기동 없이 반영된다
        // (역할 파일과 같은 원칙 — 파일이 원본, FR-E-41).
        if let Some(sf) = settings_file {
            b.env("EQMUX_SETTINGS_FILE", sf);
        }
        if let Some(tf) = &team_md {
            b.env("EQMUX_TEAM_FILE", tf);
        }
    };
    let mut direct = CommandBuilder::new(exe);
    for a in args {
        direct.arg(a);
    }
    apply(&mut direct);
    #[cfg(windows)]
    let mut via_cmd = {
        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/c");
        c
    };
    // macOS — 로그인 셸 경유. 셸 함수·별칭이 아니라 PATH만 다시 읽히면 되므로 exec로 넘긴다
    #[cfg(not(windows))]
    let mut via_cmd = {
        let mut c = CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()));
        c.args(["-lc", "exec \"$@\"", "eqmux-agent"]);
        c
    };
    via_cmd.arg(exe);
    for a in args {
        via_cmd.arg(a);
    }
    apply(&mut via_cmd);
    vec![direct, via_cmd]
}

/// 상태 방송 + 상태 전이 이벤트 기록 (FR-D-17) + OS 알림 (FR-G-30)
pub fn emit_state(app: &AppHandle, evt: &AgentStateEvt) {
    let _ = app.emit_to("main", "agent-state", evt.clone());
    let store: tauri::State<crate::StoreState> = app.state();
    let waiting = evt
        .waiting_for
        .as_deref()
        .map(|w| format!(" · {w}"))
        .unwrap_or_default();
    let _ = store.0.sender().send(crate::store::StoreMsg::Event {
        ws: evt.session.split('@').nth(1).unwrap_or("default").to_string(),
        id: Some(evt.session.clone()),
        kind: "agent-state".into(),
        message: format!("{}{}", evt.status, waiting),
    });
    maybe_notify(app, evt);
}

const NOTIFY_MIN_INTERVAL_MS: i64 = 60_000; // 세션당 최소 간격 — 반복 전이는 이 창 안에서 합쳐진다
/// 턴 완료 신호의 하한 — 이보다 짧은 턴은 대화 한 번이라 알리면 소음이다. 설정이 아니라 고정값이다
pub const TURN_DONE_MIN_MS: i64 = 30_000;

/// OS 알림 — `waiting`·`dead` 진입 2종에만 (G3 · FR-G-30). 상태 diff는 호출부(scan·EOF)가
/// 이미 보장하므로 여기 도달한 waiting/dead는 전부 "진입"이다.
/// OS 알림을 내든 게이트에 막히든 알림 센터 항목(notify-item, 계약 C2)은 남긴다.
fn maybe_notify(app: &AppHandle, evt: &AgentStateEvt) {
    if evt.status != "waiting" && evt.status != "dead" {
        return;
    }
    // 의도된 종료(중지·제거) 표식은 알림 설정보다 먼저 소비한다 — off/음소거로 여기서 일찍
    // return하면 표식이 남아, 나중에 설정을 켰을 때 같은 id의 정당한 dead 알림 1건을 삼킨다
    let rt: tauri::State<AgentRt> = app.state();
    if evt.status == "dead" {
        if let Ok(mut expected) = rt.expected_exit.lock() {
            if expected.remove(&evt.session) {
                return;
            }
        }
    }
    // 설정 라우팅 (PRD J · FR-G-30) — 꺼도 인앱 미확인 표시는 계속 동작한다 (FR-G-37)
    let routed = match crate::setting_str(app, "notifications").as_deref() {
        Some("off") => false,
        Some("waiting") => evt.status != "dead",
        _ => true, // 기본값 waiting-dead
    };
    let suppressed = (routed && !os_quiet(app, &evt.session))
        .then(|| pass_gate(app, &evt.session))
        .flatten();
    let name = &display_name(&evt.session);
    // 표시 언어를 따른다 (B66) — 알림은 창을 안 볼 때 쓰라고 있는 기능이라 읽히지 않으면
    // 기능 자체가 무의미하다. 사전은 프런트에 있으므로 여기서는 이 문구들만 분기한다.
    let en = crate::setting_str(app, "language").as_deref() == Some("en");
    let (title, body) = notify_text(evt, name, suppressed.unwrap_or(0), en);
    emit_item(app, &evt.session, &evt.status, &title, &body, suppressed.is_some());
    if suppressed.is_some() {
        show_os(app, &evt.session, &title, &body);
    }
}

/// 작업 완료 신호 — `turn`(앱이 감지한 30초 넘는 턴의 끝)과 `report`(에이전트의 `report --done`).
/// 게이트 키는 `세션#done` — waiting과 같은 키를 쓰면 완료 알림 직후 60초 안의 waiting 알림이
/// 합쳐져 사라진다. OS 알림은 완료 알림 설정(doneNotifications: report·all·off, 기본 report)을 따른다.
fn notify_done(app: &AppHandle, session: &str, kind: &str, detail: Option<&str>) {
    let routed = match crate::setting_str(app, "doneNotifications").as_deref() {
        Some("off") => false,
        Some("all") => true,
        _ => kind == "report", // 기본값 report (결정 11)
    };
    let suppressed = (routed && !os_quiet(app, session))
        .then(|| pass_gate(app, &done_key(session)))
        .flatten();
    let name = &display_name(session);
    let en = crate::setting_str(app, "language").as_deref() == Some("en");
    let (title, body) = done_text(kind, name, detail, suppressed.unwrap_or(0), en);
    emit_item(app, session, kind, &title, &body, suppressed.is_some());
    if suppressed.is_some() {
        show_os(app, session, &title, &body);
    }
}

/// OS 알림 한 건. Windows는 토스트를 직접 띄워 누르면 그 페인으로 간다 (P2 · 필요 기능 A2) —
/// 창을 앞으로 올리고 main 창에 `notify-activate {session}`을 보낸다. 페인 이동은 프런트 몫이다.
/// 다른 OS는 알림 플러그인 그대로(누르기 동작 없음).
fn show_os(app: &AppHandle, session: &str, title: &str, body: &str) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        // 알림 플러그인과 같은 규칙 — 설치본만 앱 AUMID를 쓰고, 빌드 폴더에서 돈 exe는 등록된
        // AUMID가 없어 PowerShell의 것을 빌린다 (안 그러면 토스트가 아예 안 뜬다)
        let dev = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|d| d.to_string_lossy().to_lowercase()))
            .is_some_and(|d| d.ends_with(r"\target\debug") || d.ends_with(r"\target\release"));
        let app_id = if dev { Toast::POWERSHELL_APP_ID.to_string() } else { app.config().identifier.clone() };
        let (app2, session) = (app.clone(), session.to_string());
        let _ = Toast::new(&app_id)
            .title(title)
            .text1(body)
            .on_activated(move |_| {
                activate_pane(&app2, &session);
                Ok(())
            })
            .show();
    }
    #[cfg(not(windows))]
    {
        let _ = session;
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// 알림을 눌렀다 — 창을 앞으로 올리고 어느 페인인지 프런트에 알린다
#[cfg(windows)]
fn activate_pane(app: &AppHandle, session: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit_to("main", "notify-activate", serde_json::json!({ "session": session }));
}

/// 알림 제목의 이름 — 화면과 같은 세션 이름(디렉터리 C4). 프런트가 아직 안 보냈으면 id 앞부분
fn display_name(session: &str) -> String {
    crate::ipc::session_name(session).unwrap_or_else(|| session.split('@').next().unwrap_or(session).to_string())
}

fn done_key(session: &str) -> String {
    format!("{session}#done")
}

/// `eqmux report --done` (W2 ipc.rs)이 부른다 — OS 알림 "이름 · 완료" + 알림 센터 항목
pub fn notify_report(app: &AppHandle, session: &str, text: &str) {
    notify_done(app, session, "report", Some(text));
}

/// OS 알림을 삼켜야 하는 자리인가 — 음소거(FR-G-35, 세션·워크스페이스)·창 포커스(FR-G-31).
/// 어느 쪽이든 인앱 표시(미확인·알림 센터)는 그대로 동작한다
fn os_quiet(app: &AppHandle, session: &str) -> bool {
    let settings_state: tauri::State<crate::SettingsState> = app.state();
    let muted = settings_state
        .0
        .lock()
        .map(|v| {
            let ws = session.split('@').nth(1).unwrap_or("");
            v.get("muted")
                .and_then(|m| m.as_array())
                .map(|list| list.iter().filter_map(|x| x.as_str()).any(|m| m == session || m == ws))
                .unwrap_or(false)
        })
        .unwrap_or(false);
    muted
        || app
            .webview_windows()
            .values()
            .any(|w| w.is_focused().unwrap_or(false))
}

/// 같은 키의 반복 합침 (FR-G-32) — 최소 간격 안에서는 개수만 센다.
/// Some(그 사이 합친 건수) = 내도 된다 · None = 이번 것은 합쳐졌다
fn pass_gate(app: &AppHandle, key: &str) -> Option<u32> {
    let rt: tauri::State<AgentRt> = app.state();
    let mut gates = rt.notify_gate.lock().ok()?;
    let gate = gates
        .entry(key.to_string())
        .or_insert(NotifyGate { last_ms: 0, suppressed: 0 });
    gate_step(gate, crate::workspace::now_ms())
}

fn gate_step(gate: &mut NotifyGate, now: i64) -> Option<u32> {
    if now - gate.last_ms < NOTIFY_MIN_INTERVAL_MS {
        gate.suppressed += 1;
        return None;
    }
    let n = gate.suppressed;
    gate.last_ms = now;
    gate.suppressed = 0;
    Some(n)
}

/// 알림 센터 항목 (계약 C2) — main 창에만 보낸다. os = 실제로 OS 알림을 냈는가
fn emit_item(app: &AppHandle, session: &str, kind: &str, title: &str, body: &str, os: bool) {
    let workspace = crate::session_origin(app, session)
        .map(|(ws, _)| ws)
        .unwrap_or_else(|| session.split('@').nth(1).unwrap_or("default").to_string());
    let ts = crate::workspace::now_ms();
    let _ = app.emit_to(
        "main",
        "notify-item",
        serde_json::json!({
            "id": format!("{session}-{ts}-{}", next_seq()),
            "session": session,
            "workspace": workspace,
            "kind": kind,
            "title": title,
            "body": body,
            "ts": ts,
            "os": os,
        }),
    );
}

/// 완료 알림 제목·본문 — "완료"는 에이전트가 직접 밝힌 report에만 쓴다. 앱이 감지한 것은 "턴 끝남"
fn done_text(kind: &str, name: &str, detail: Option<&str>, suppressed: u32, en: bool) -> (String, String) {
    let report = kind == "report";
    let title = match (report, en) {
        (true, true) => format!("{name} · done"),
        (true, false) => format!("{name} · 완료"),
        (false, true) => format!("{name} · turn ended"),
        (false, false) => format!("{name} · 턴 끝남"),
    };
    let mut body = match detail.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => d.to_string(),
        None if en => "The turn has ended".into(),
        None => "턴이 끝났습니다".into(),
    };
    if suppressed > 0 {
        body.push_str(&if en {
            format!(" ({suppressed} more coalesced)")
        } else {
            format!(" (그 사이 {suppressed}건 합침)")
        });
    }
    (title, body)
}

/// 토스트 제목·본문 조립 (B66) — 순수 함수라 언어 분기를 테스트로 고정할 수 있다
fn notify_text(evt: &AgentStateEvt, name: &str, suppressed: u32, en: bool) -> (String, String) {
    let title = if evt.status == "waiting" {
        format!("{name} · {}", waiting_title(evt.waiting_for.as_deref(), en))
    } else if en {
        format!("{name} · exited")
    } else {
        format!("{name} · 종료됨")
    };
    let mut body = if evt.status == "waiting" {
        match evt.waiting_for.as_deref() {
            Some(w) if en => translate_waiting(w).to_string(),
            Some(w) => w.to_string(),
            None if en => "Needs a human response".into(),
            None => "사람의 응답이 필요합니다".into(),
        }
    } else {
        match (evt.exit_code, en) {
            (Some(c), true) => format!("exit {c} · resume {}", if evt.resumable { "available" } else { "unavailable" }),
            (Some(c), false) => format!("exit {c} · 재개 {}", if evt.resumable { "가능" } else { "불가" }),
            (None, true) => "The process exited".into(),
            (None, false) => "프로세스가 종료되었습니다".into(),
        }
    };
    if suppressed > 0 {
        body.push_str(&if en {
            format!(" ({suppressed} transition(s) coalesced)")
        } else {
            format!(" (그 사이 전이 {suppressed}건 합침)")
        });
    }
    (title, body)
}

/// waiting_for 원문 → 영어. 모르는 값은 원문 유지 (FR-D-64 · 프런트 t()와 같은 폴백 규칙)
fn translate_waiting(w: &str) -> &str {
    match w {
        WAIT_QUESTION => "Waiting on a question — answer in this pane to continue",
        WAIT_PLAN => "Waiting on plan approval — answer in this pane to continue",
        "권한 승인 대기" => "Waiting for permission approval",
        "입력 필요 — 이 페인에서 답해야 진행됩니다" => "Input needed — answer in this pane to continue",
        "다이얼로그 응답 대기" => "Waiting on a dialog response",
        other => other,
    }
}

/// 훅 이벤트 → 상태 (D3 · FR-D-30 계열). 모르는 이벤트는 None — 조용히 무시한다.
/// SubagentStop은 매핑하지 않는다 — 서브에이전트 종료 시점에 본체는 아직 busy다.
pub fn hook_status(event: &str) -> Option<&'static str> {
    match event {
        "Stop" => Some("idle"),               // 턴 종료 — 인박스 flush(M3)의 즉시 신호
        "UserPromptSubmit" => Some("busy"),   // 프롬프트 제출 = 작업 시작
        "Notification" => Some("waiting"),    // 승인·응답 필요
        _ => None,
    }
}

/// 대기 문맥의 정본 — 화면 배지·OS 알림 제목·i18n 사전이 전부 이 문자열을 키로 쓴다.
/// 바꾸면 세 곳이 같이 움직여야 한다 (common.ts 사전 · waiting_title).
pub const WAIT_QUESTION: &str = "질문 선택 대기 — 이 페인에서 답해야 진행됩니다";
pub const WAIT_PLAN: &str = "계획 승인 대기 — 이 페인에서 답해야 진행됩니다";
/// Codex의 PermissionRequest (M37) — Claude의 Notification(permission prompt)과 같은 자리.
/// registry_waiting_for가 쓰는 문자열과 같아 사전·알림 제목이 그대로 통한다.
pub const WAIT_PERMISSION: &str = "권한 승인 대기";

/// 사람이 골라야 끝나는 도구 — 도구가 "실행 중"인 내내 화면에는 선택 프롬프트가 떠 있고,
/// 진행은 그 페인에 들어온 키 입력에서만 재개된다. 승인 프롬프트와 달리 Notification 훅이
/// 따라오지 않으므로 이것을 도구명 부연(Activity)으로만 받으면 페인은 그냥 "작업 중"으로 보이고,
/// 대화는 인박스에 쌓이기만 한다 (M3 — busy에는 주입하지 않는다). 사람이 붙어야 진행되는
/// 자리를 관제가 놓치는 구멍이 여기라, 이 두 도구만 상태 전이로 승격한다.
pub fn ask_waiting_for(tool: &str) -> Option<&'static str> {
    match tool {
        "AskUserQuestion" => Some(WAIT_QUESTION),
        "ExitPlanMode" => Some(WAIT_PLAN),
        _ => None,
    }
}

/// 세션 레지스트리의 waitingFor 원문 → 우리 어휘 (B16). 채택 세션(손기동)은 훅이 없어
/// 이 값이 유일한 문맥인데, 그대로 두면 한국어 화면에 영문이 섞여 나온다. Claude가 쓰는
/// 문자열 집합은 이 모듈이 아는 지식이므로(FR-D-60) 번역도 여기서 한다.
/// 모르는 값은 원문 유지 — 부분 파싱 원칙(FR-D-64)과 같은 태도다.
/// 화면은 이 결과를 t()에 통과시키므로 영어 모드에서는 사전이 다시 영어로 돌려준다.
pub fn registry_waiting_for(raw: &str) -> String {
    match raw {
        "permission prompt" => "권한 승인 대기".into(),
        "input needed" => "입력 필요 — 이 페인에서 답해야 진행됩니다".into(),
        "dialog open" => "다이얼로그 응답 대기".into(),
        "goal proposal" => "목표 제안 검토 대기".into(),
        "sandbox request" => "샌드박스 승인 대기".into(),
        "worker request" => "워커 승인 대기".into(),
        other => other.into(),
    }
}

/// OS 알림 제목의 꼬리 (B17) — 잠금 화면·알림 센터는 제목만 보여주는 일이 잦다.
/// 우리가 만든 어휘만 갈라 보고, 모르는 문맥은 종전대로 "승인 대기".
fn waiting_title(waiting_for: Option<&str>, en: bool) -> &'static str {
    match waiting_for {
        Some(w) if w == WAIT_QUESTION => if en { "question" } else { "질문 대기" },
        Some(w) if w == WAIT_PLAN => if en { "plan approval" } else { "계획 승인 대기" },
        Some(w) if w.starts_with("입력 필요") || w.starts_with("다이얼로그") => {
            if en { "response needed" } else { "응답 대기" }
        }
        _ => if en { "approval needed" } else { "승인 대기" },
    }
}

/// 훅 이벤트의 효과 — 상태 전이 3종 외에 2차 소스가 채우는 것 (FR-D-15·18):
/// activity(도구명)와 subagents(동시 실행 수). 상태를 바꾸지 않는 이벤트가 상태를
/// 건드리지 않도록 효과를 분리해 둔다 (순수 함수 — 테스트 대상).
pub enum HookEffect {
    Status(&'static str),
    /// 사람의 선택을 기다리는 프롬프트 (ask_waiting_for) — waiting + 문맥 한 줄.
    /// 레지스트리 재스캔이 되돌리지 못하게 고정된다 (Tracked::asking)
    Ask(&'static str),
    Activity(Option<String>),
    SubagentDelta(i64),
    Ignore,
}

pub fn hook_effect(event: &str, payload: &serde_json::Value) -> HookEffect {
    match event {
        "PreToolUse" => {
            let tool = payload.get("tool_name").and_then(|v| v.as_str());
            match tool.and_then(ask_waiting_for) {
                Some(reason) => HookEffect::Ask(reason),
                None => HookEffect::Activity(tool.map(str::to_string)),
            }
        }
        "PostToolUse" => HookEffect::Activity(None),
        "SubagentStart" => HookEffect::SubagentDelta(1),
        "SubagentStop" => HookEffect::SubagentDelta(-1),
        // Codex 승인 프롬프트 (M37) — 사람이 이 페인에서 답해야 풀린다. 답이 들어오면 그 도구의
        // PreToolUse(허용) 또는 다음 이벤트가 Activity로 와서 busy로 되돌린다 (unstick).
        "PermissionRequest" => HookEffect::Ask(WAIT_PERMISSION),
        "Notification" if is_idle_notice(payload) => HookEffect::Ignore,
        e => match hook_status(e) {
            Some(s) => HookEffect::Status(s),
            None => HookEffect::Ignore,
        },
    }
}

/// Claude의 Notification은 두 갈래다 — 사람이 답해야 풀리는 프롬프트(권한·다이얼로그)와,
/// 턴이 끝나고 ~60초 입력이 없을 때 오는 유휴 안내("Claude is waiting for your input").
/// 유휴 안내를 waiting으로 올리면 쉬는 에이전트가 승인 대기로 뜨고, 인박스는 "턴이 끝나면
/// 전달"로 묶이는데 다음 전이가 영영 오지 않는다 (B67). notification_type이 없는 옛 버전은 문구로 본다
fn is_idle_notice(payload: &serde_json::Value) -> bool {
    match payload.get("notification_type").and_then(|v| v.as_str()) {
        Some(kind) => matches!(kind, "idle_prompt" | "auth_success"),
        None => payload
            .get("message")
            .and_then(|m| m.as_str())
            .is_some_and(|m| m.contains("waiting for your input")),
    }
}

/// Notification 원문 → 대기 문맥. 권한 프롬프트는 우리 어휘로 바꾼다 — 원문 그대로면 한국어
/// 화면 배지에 "Claude needs your permission to use Bash"가 섞인다 (U29). 나머지는 원문 유지
fn notification_waiting(msg: &str) -> String {
    if msg.starts_with("Claude needs your permission") {
        WAIT_PERMISSION.into()
    } else {
        msg.into()
    }
}

/// 이 페인이 지금 돌리고 있는 추적 (uuid). 한 페인의 추적은 하나여야 하지만, 정리 전
/// 창(스폰 직후의 starting · 채택 직후)에는 둘일 수 있다. HashMap 순서에 맡기면 훅과 비용이
/// 죽은 추적에 붙어, 방송되는 agent_session이 두 uuid 사이를 오간다 — 화면의 재개 앵커가
/// 이미 끝난 대화로 튀고(B38) 상태도 두 추적 사이에서 깜빡인다.
/// 가장 최근에 순번을 받은 것이 지금 도는 프로세스다.
fn current_uuid(map: &HashMap<String, Tracked>, session: &str) -> Option<String> {
    map.iter()
        .filter(|(_, t)| t.app_session == session && t.last_status != "dead")
        .max_by_key(|(_, t)| t.seq)
        .map(|(u, _)| u.clone())
}

/// 훅 효과를 추적 상태에 적용한다 — 전이 판정의 정본 (AppHandle 없이 도는 순수 함수).
/// 반환 `Some(quiet)`: 방송해야 한다. quiet면 이벤트 기록·알림 없이 방송만 (FR-D-17 —
/// activity·subagents는 도구 호출마다 일어나므로 피드에 남기지 않는다. 피드는 전이의 기록이다).
/// `None`: 변화 없음 — 방송하지 않는다. 이때도 asking·activity 정리는 이미 반영돼 있다.
fn apply_effect(
    t: &mut Tracked,
    effect: &HookEffect,
    payload: &serde_json::Value,
    now: i64,
) -> Option<bool> {
    match effect {
        HookEffect::Status(status) => {
            let waiting = (*status == "waiting")
                .then(|| payload.get("message").and_then(|m| m.as_str()).map(notification_waiting))
                .flatten();
            t.asking = false; // 턴 경계(Stop·UserPromptSubmit)를 넘었다 — 프롬프트는 닫혔다
            // 턴 길이 — 시작은 처음 busy가 된 때(레지스트리가 먼저 busy로 올렸어도 여기서 찍는다),
            // 끝은 Stop. 중간의 승인 대기도 턴의 일부다
            match *status {
                "busy" => {
                    t.busy_since.get_or_insert(now);
                }
                "idle" => {
                    t.turn_done = t.busy_since.take().is_some_and(|s| now - s >= TURN_DONE_MIN_MS);
                }
                _ => {}
            }
            if t.last_status == *status && t.last_waiting == waiting && !t.turn_done {
                return None; // 변화 없음 — 방송하지 않는다 (레지스트리가 먼저 idle로 내렸어도 완료는 알린다)
            }
            t.last_status = (*status).into();
            t.status_ms = now;
            t.last_waiting = waiting;
            t.hook_ms = now; // P-3 — 훅이 더 신선하다는 표식
            if *status == "idle" {
                // 턴 종료 — 도구·서브에이전트 부연도 함께 접는다 (FR-D-15)
                t.activity = None;
                t.subagents = 0;
            }
            Some(false)
        }
        // 사람의 선택을 기다리는 프롬프트 — 도구 시작(PreToolUse)에서 곧바로 waiting으로
        // 올린다. 답이 들어오면 같은 도구의 PostToolUse가 Activity(None)로 와서 풀린다.
        HookEffect::Ask(reason) => {
            let waiting = Some((*reason).to_string());
            t.asking = true;
            t.activity = None; // 도구명 부연은 여기서 의미가 없다 — 문맥은 waiting_for가 준다
            if t.last_status == "waiting" && t.last_waiting == waiting {
                return None;
            }
            t.last_status = "waiting".into();
            t.status_ms = now;
            t.last_waiting = waiting;
            t.hook_ms = now; // P-3 — 훅이 더 신선하다는 표식
            Some(false)
        }
        HookEffect::Activity(tool) => {
            // 도구 실행 시작 = 승인 완료 — waiting에 고착돼 있으면 busy로 되돌린다.
            // degraded(레지스트리 없음) 모드에선 이 전이가 없으면 다음 Stop까지 "승인 대기"로 남는다
            let unstick = t.last_status == "waiting";
            t.asking = false; // 답이 들어왔거나(PostToolUse) 다른 도구가 시작됐다
            if tool.is_some() {
                t.busy_since.get_or_insert(now); // UserPromptSubmit을 놓쳤어도 도구가 돌면 턴 중이다
            }
            if t.activity == *tool && !unstick {
                return None;
            }
            t.activity = tool.clone();
            if !unstick {
                return Some(true); // 부연만 바뀌었다 — 기록 없이 방송만
            }
            t.last_status = "busy".into();
            t.status_ms = now;
            t.last_waiting = None;
            t.hook_ms = now; // P-3 — 이 전이도 훅 소스다
            Some(false) // 상태 전이이므로 피드·알림 경로로 보낸다
        }
        HookEffect::SubagentDelta(d) => {
            let next = (t.subagents + d).max(0);
            if t.subagents == next {
                return None;
            }
            t.subagents = next;
            Some(true)
        }
        HookEffect::Ignore => None,
    }
}

/// 훅 2차 소스 — 레지스트리 스캔(1차)과 같은 diff 경로로 emit_state 한 곳에 합류한다.
/// 레지스트리보다 빠르게 도착하므로 waiting 알림·인박스 전달의 지연이 줄어든다.
// ── 마지막 한 줄 요약 (M35) ────────────────────────────────────────────────
// "이 페인이 마지막에 무엇을 했는가"를 한 문장으로 남긴다. 앱을 껐다 켜도 남아야 하므로
// 화면 상태가 아니라 SQLite(session.last_recap)가 원본이다.
//
// 출처를 트랜스크립트로 고른 이유: 목적에 더 맞아 보이는 두 채널이 실제로는 비어 있다.
// `eqmux report`는 모델이 부르지 않으면 안 오고(실측 0건), command 테이블은 선언만 돼 있다.
// 트랜스크립트는 Claude Code가 스스로 쓰므로 관례도 모델의 협조도 필요 없다.

/// 한 줄 요약의 표시 상한 — 페인 헤더 한 칸에 들어가야 한다. 넘으면 프런트가 말줄임한다
const RECAP_MAX: usize = 160;

/// 에이전트 턴 본문 → 한 문장. `recap:` 줄을 쓰는 세션이 있어 그것을 먼저 본다
/// (사용자 관례이지 EQMUX 계약이 아니다 — 없으면 첫 문단 첫 줄로 내려간다).
fn recap_line(text: &str) -> Option<String> {
    let pick = text
        .lines()
        .map(str::trim)
        .find(|l| {
            let low = l.to_lowercase();
            low.contains("recap:") && l.chars().count() > "recap:".len() + 4
        })
        .or_else(|| {
            // 첫 산문 줄 — 목록·인용·제목·표는 문장이 아니고, 코드 블록은 여는 줄만이 아니라
            // 안쪽 전부를 건너뛴다 (울타리 시작만 걸러내면 `cargo test` 같은 명령이 뽑힌다)
            let mut fenced = false;
            text.lines().map(str::trim).find(|l| {
                if l.starts_with("```") {
                    fenced = !fenced;
                    return false;
                }
                // 짧은데 콜론으로 끝나면 라벨이지 문장이 아니다 ("recap:", "요약:" 같은 머리줄)
                let label = l.ends_with(':') && l.chars().count() < 20;
                !fenced && !l.is_empty() && !label && !l.starts_with(['-', '*', '>', '#', '|'])
            })
        })?;
    // 앞의 장식(※ · 등)을 걷고, 헤더 한 줄에서 의미가 없는 마크다운 강조만 지운다.
    // 링크·목록 같은 구조는 건드리지 않는다 — 문장을 고쳐 쓰는 것이 아니라 표시만 다듬는다
    let cleaned = pick
        .trim_start_matches(['※', '·', '-', '*', ' '])
        .replace("**", "")
        .replace('`', "");
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return None;
    }
    Some(match cleaned.char_indices().nth(RECAP_MAX) {
        Some((i, _)) => format!("{}…", &cleaned[..i]),
        None => cleaned.to_string(),
    })
}

/// 트랜스크립트 꼬리에서 마지막 에이전트 턴의 한 줄. 읽기는 transcript::read가 이미
/// 하는 일이다 (2MB 꼬리 창 + 깨진 줄 건너뛰기) — 두 번째 파서를 두지 않는다.
fn recap_from_transcript(path: &std::path::Path) -> Option<String> {
    // limit은 "마지막 N턴만 남김"이다 — 0을 넘기면 턴이 통째로 drain되어 요약이 영영 안 나온다
    let data = crate::transcript::read(path, usize::MAX).ok()?;
    data.turns
        .iter()
        .rev()
        .find(|t| t.role == "agent" && !t.text.trim().is_empty())
        .and_then(|t| recap_line(&t.text))
}

/// Stop 훅에서 부른다 — 턴이 끝난 그 순간이 "마지막에 한 작업"이 확정되는 자리다.
/// 실패는 조용하다: 요약이 없다고 상태 기계가 멈출 이유가 없다.
/// Codex는 Stop payload에 마지막 응답(last_assistant_message)이 실려 온다 — 트랜스크립트를 열지
/// 않고 그것을 쓴다. Claude는 payload에 그 필드가 없으므로 종전대로 트랜스크립트 꼬리에서 뽑는다.
pub fn record_recap(app: &AppHandle, session: &str, payload: &serde_json::Value) -> Option<String> {
    let from_payload = payload
        .get("last_assistant_message")
        .and_then(|v| v.as_str())
        .and_then(recap_line);
    let text = match from_payload {
        Some(t) => t,
        None => {
            let rt: tauri::State<AgentRt> = app.state();
            let Some((cwd, uuid)) = ({
                let map = rt.by_uuid.lock().ok()?;
                current_uuid(&map, session)
                    .and_then(|u| map.get(&u).map(|t| (t.cwd.clone(), u)))
            }) else {
                return None;
            };
            recap_from_transcript(&transcript_path(&cwd, &uuid))?
        }
    };
    let (ws, _) = crate::session_origin(app, session)?;
    let store: tauri::State<crate::StoreState> = app.state();
    let _ = store.0.sender().send(crate::store::StoreMsg::Recap {
        ws: ws.clone(),
        id: session.to_string(),
        text: text.clone(),
    });
    // 화면은 재시작을 기다리지 않는다 — 지금 보고 있는 페인도 바로 바뀐다
    let _ = app.emit_to("main", 
        "session-recap",
        serde_json::json!({ "workspace": ws, "session": session, "text": text }),
    );
    Some(text)
}

/// Codex 세션 id 채택 (M37) — Codex에는 --session-id가 없어 스폰 때 앱이 발급한 uuid는 자리표시일
/// 뿐이다. SessionStart 훅 payload의 session_id(스레드 id)와 transcript_path(롤아웃)가 진짜 앵커라,
/// 여기서 추적을 그 id로 옮기고 agent_session 매핑(FR-D-24)을 갱신한다. 재개(`codex resume <id>`)는
/// 같은 id로 다시 오므로 키는 그대로고 경로만 새로 받는다. Claude는 payload의 id가 발급 uuid와
/// 같고 cli도 다르므로 여기서 아무것도 하지 않는다.
fn adopt_codex_session(app: &AppHandle, session: &str, payload: &serde_json::Value) {
    let Some(sid) = payload
        .get("session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    let transcript = payload
        .get("transcript_path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let rt: tauri::State<AgentRt> = app.state();
    let mut out = None;
    if let Ok(mut map) = rt.by_uuid.lock() {
        let Some(cur) = current_uuid(&map, session) else { return };
        if !map.get(&cur).is_some_and(|t| is_codex(&t.cli)) {
            return;
        }
        let Some(mut t) = map.remove(&cur) else { return };
        if transcript.is_some() {
            t.transcript = transcript.clone();
        }
        t.seq = next_seq();
        let evt = AgentStateEvt {
            session: session.to_string(),
            agent_session: sid.to_string(),
            status: t.last_status.clone(),
            waiting_for: t.last_waiting.clone(),
            activity: t.activity.clone(),
            subagents: t.subagents,
            cost_usd: t.cost_usd,
            resumable: resumable_of(&t, sid),
            version: None,
            exit_code: None,
            degraded: t.degraded,
            seq: t.seq,
            since_ms: Some(t.status_ms),
            completed: false,
        };
        out = Some((t.ws.clone(), t.transcript.clone(), evt));
        map.insert(sid.to_string(), t);
    }
    let Some((ws, log_path, evt)) = out else { return };
    let store: tauri::State<crate::StoreState> = app.state();
    let _ = store.0.sender().send(crate::store::StoreMsg::AgentSession {
        ws,
        id: session.to_string(),
        agent_session_id: sid.to_string(),
        log_path: log_path.unwrap_or_default(),
        resumable: evt.resumable,
    });
    // 앵커가 바뀌었을 뿐 상태 전이가 아니다 — 피드·알림 없이 방송만 (activity와 같은 규칙)
    let _ = app.emit_to("main", "agent-state", evt);
}

pub fn apply_hook(app: &AppHandle, session: &str, event: &str, payload: &serde_json::Value) {
    // Codex의 진짜 세션 id는 여기서 처음 알게 된다 (M37) — 상태 반영보다 먼저 앵커를 옮긴다
    if event == "SessionStart" {
        adopt_codex_session(app, session, payload);
    }
    // 턴이 끝나는 자리 — 여기서만 "마지막에 한 작업"이 확정된다 (M35).
    // 상태 반영보다 먼저 한다: effect가 Ignore여도 요약은 남아야 한다
    let recap = if event == "Stop" { record_recap(app, session, payload) } else { None };
    let effect = hook_effect(event, payload);
    if matches!(effect, HookEffect::Ignore) {
        return;
    }
    let rt: tauri::State<AgentRt> = app.state();
    let mut out = None;
    if let Ok(mut map) = rt.by_uuid.lock() {
        if let Some(uuid) = current_uuid(&map, session) {
            let Some(t) = map.get_mut(&uuid) else { return };
            if let Some(quiet) = apply_effect(t, &effect, payload, crate::workspace::now_ms()) {
                t.seq = next_seq();
                let completed = std::mem::take(&mut t.turn_done);
                out = Some((
                    quiet,
                    AgentStateEvt {
                        session: session.to_string(),
                        agent_session: uuid.clone(),
                        status: t.last_status.clone(),
                        waiting_for: t.last_waiting.clone(),
                        activity: t.activity.clone(),
                        subagents: t.subagents,
                        cost_usd: t.cost_usd,
                        resumable: resumable_of(t, &uuid),
                        version: None,
                        exit_code: None,
                        degraded: t.degraded,
                        seq: t.seq,
                        since_ms: Some(t.status_ms),
                        completed,
                    },
                ));
            }
        }
    }
    if let Some((quiet, e)) = out {
        if quiet {
            let _ = app.emit_to("main", "agent-state", e);
        } else {
            emit_state(app, &e);
            if e.completed {
                notify_done(app, session, "turn", recap.as_deref()); // 본문은 마지막 한 줄 요약 (M35)
            }
        }
    }
}

/// statusLine 채널 (FR-D-19 · §10.4) — 세션 누적 비용. 상태를 바꾸지 않는 부연이라
/// activity와 같은 규칙으로 이벤트 기록 없이 방송만 한다. 1센트 단위 변화만 방송해
/// 주기 호출(수 초 간격)이 방송 폭주가 되지 않게 한다.
pub fn apply_statusline(app: &AppHandle, session: &str, payload: &serde_json::Value) {
    let Some(cost) = payload
        .get("cost")
        .and_then(|c| c.get("total_cost_usd"))
        .and_then(|v| v.as_f64())
    else {
        return;
    };
    let rt: tauri::State<AgentRt> = app.state();
    let mut evt = None;
    if let Ok(mut map) = rt.by_uuid.lock() {
        if let Some(uuid) = current_uuid(&map, session) {
            let Some(t) = map.get_mut(&uuid) else { return };
            let changed = match t.cost_usd {
                Some(prev) => (cost - prev).abs() >= 0.01,
                None => true,
            };
            if !changed {
                return;
            }
            t.cost_usd = Some(cost);
            t.seq = next_seq();
            evt = Some(AgentStateEvt {
                session: session.to_string(),
                agent_session: uuid.clone(),
                status: t.last_status.clone(),
                waiting_for: t.last_waiting.clone(),
                activity: t.activity.clone(),
                subagents: t.subagents,
                cost_usd: t.cost_usd,
                resumable: resumable_of(t, &uuid),
                version: None,
                exit_code: None,
                degraded: t.degraded,
                seq: t.seq,
                since_ms: Some(t.status_ms),
                completed: false,
            });
        }
    }
    if let Some(e) = evt {
        let _ = app.emit_to("main", "agent-state", e);
    }
}

/// PTY EOF → dead 전이 (FR-D-50). 세대(gen)가 다르면 이미 재기동된 세션이므로 무시한다.
pub fn on_pty_exit(app: &AppHandle, id: &str, code: Option<u32>, gen: u64) {
    let rt: tauri::State<AgentRt> = app.state();
    let mut evt = None;
    if let Ok(mut map) = rt.by_uuid.lock() {
        for (uuid, t) in map.iter_mut() {
            if t.app_session == id && t.pty_gen == gen && t.last_status != "dead" {
                t.last_status = "dead".into();
                t.status_ms = crate::workspace::now_ms();
                t.activity = None;
                t.subagents = 0;
                t.seq = next_seq();
                evt = Some(AgentStateEvt {
                    session: id.to_string(),
                    agent_session: uuid.clone(),
                    status: "dead".into(),
                    waiting_for: None,
                    activity: None,
                    subagents: 0,
                    cost_usd: t.cost_usd, // 종료 후에도 마지막 비용은 남긴다
                    resumable: resumable_of(t, uuid),
                    version: None,
                    exit_code: code.map(i64::from),
                    degraded: t.degraded,
                    seq: t.seq,
                    since_ms: Some(t.status_ms),
                    completed: false,
                });
                break;
            }
        }
    }
    if let Some(e) = evt {
        emit_state(app, &e);
    } else {
        // dead 이벤트가 안 나간 exit(일반 셸·세대 불일치 재시작) — 이 exit을 위해 남긴
        // expected_exit 표식을 여기서 소비한다. 방치하면 같은 id의 미래 에이전트가
        // 뜻하지 않게 죽었을 때 정당한 dead 알림 1건을 삼킨다.
        if let Ok(mut expected) = rt.expected_exit.lock() {
            expected.remove(id);
        }
    }
}

/// 레지스트리 watch (FR-D-11) — notify 실패 여부와 무관하게 2초 안전 재스캔을 겸한다.
pub fn start_registry_watch(app: AppHandle) {
    std::thread::spawn(move || {
        let dir = sessions_dir();
        let (tx, rx) = channel::<()>();
        let _watcher = {
            use notify::{recommended_watcher, RecursiveMode, Watcher};
            let tx = tx.clone();
            let mut w = recommended_watcher(move |_res| {
                let _ = tx.send(());
            })
            .ok();
            if let Some(watcher) = w.as_mut() {
                let _ = watcher.watch(&dir, RecursiveMode::NonRecursive);
            }
            w
        };
        loop {
            let _ = rx.recv_timeout(Duration::from_millis(2000));
            while rx.try_recv().is_ok() {} // 버스트 병합
            scan(&app);
        }
    });
}

/// pid → 페인 (A) — 잡 프로세스 목록에서 그 pid를 담은 세션과 PTY 세대를 찾는다.
/// 잡은 페인의 자식 트리 전체(pwsh → claude → …)를 담으므로 손자 프로세스도 잡힌다.
pub fn pane_for_pid(
    job_pids: &HashMap<String, (Vec<u32>, u64)>,
    pid: u32,
) -> Option<(String, u64)> {
    job_pids
        .iter()
        .find(|(_, (pids, _))| pids.contains(&pid))
        .map(|(id, (_, gen))| (id.clone(), *gen))
}

/// 레지스트리 디렉터리 → sessionId별 레코드 (§10.1). 파일은 claude 프로세스 pid마다 하나이고,
/// 프로세스가 죽어도 지워지지 않는다. `--resume`은 같은 sessionId로 새 pid 파일을 쓰므로 한
/// sessionId에 파일이 여럿 남고, read_dir 순서에 맡기면 죽은 프로세스의 낡은 레코드가 이긴다.
/// 그러면 그 레코드의 pid는 어느 잡에도 없어 채택(A)이 실패하고, mtime이 낡아 스테일 가드(P-3)가
/// 상태 갱신까지 막는다 — 재개한 에이전트가 영영 페인에 붙지 않는 자리가 여기다.
/// 가장 최근에 쓰인 파일이 살아 있는 프로세스다.
fn read_registry(entries: fs::ReadDir, cache: &mut RegistryCache) -> HashMap<String, (RegistryRecord, i64)> {
    let mut found: HashMap<String, (RegistryRecord, i64)> = HashMap::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // 디렉터리 열거가 이미 준 메타데이터 — 파일마다 따로 stat하지 않는다 (Windows에서 공짜)
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        seen.insert(p.clone());
        let rec = match cache.get(&p) {
            Some((m, len, rec)) if *m == modified && *len == meta.len() => rec.clone(),
            _ => {
                let rec = fs::read_to_string(&p)
                    .ok()
                    .and_then(|text| serde_json::from_str::<RegistryRecord>(&text).ok());
                cache.insert(p.clone(), (modified, meta.len(), rec.clone()));
                rec
            }
        };
        let Some(rec) = rec else { continue };
        let Some(sid) = rec.session_id.clone() else { continue };
        // 파일 mtime = 이 레지스트리 상태의 신선도 (P-3) — 훅 도착 시각과 비교한다
        let mtime_ms = modified
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if found.get(&sid).is_some_and(|(_, prev)| *prev >= mtime_ms) {
            continue; // 같은 sessionId의 더 낡은 파일 — 죽은 프로세스의 것이다
        }
        found.insert(sid, (rec, mtime_ms));
    }
    cache.retain(|p, _| seen.contains(p));
    found
}

/// 채택 직전 정리 — 한 페인의 추적은 하나다 (관리 기동 agent_spawn의 retain과 같은 규칙).
/// "레지스트리에 아직 있으면 남긴다"로는 걷히지 않는다: 파일은 프로세스가 죽어도 남으므로
/// 직전 프로세스의 추적이 그대로 살아, 한 페인의 상태가 둘로 갈린다.
/// 아직 레지스트리에 안 나타난 갓 기동(starting)만 남긴다.
fn keep_on_adopt(t: &Tracked, adopting: &str) -> bool {
    t.app_session != adopting || t.last_status == "starting"
}

/// 레지스트리 레코드 → 추적 상태 갱신 판정 — 2초 재스캔의 정본 (AppHandle 없이 도는 순수 함수).
/// 반환 true면 상태가 바뀌었다 = 방송 대상.
fn apply_registry(
    t: &mut Tracked,
    rec_status: Option<&str>,
    rec_waiting: Option<&str>,
    mtime_ms: i64,
) -> bool {
    if t.last_status == "dead" {
        return false;
    }
    // 스테일 가드 (P-3) — 훅이 이 파일보다 나중에 상태를 바꿨다면 재스캔이 되돌리지
    // 않는다. 방치하면 2초 주기 재스캔이 가짜 idle을 만들어 M3 인박스를 오주입한다.
    if mtime_ms <= t.hook_ms {
        return false;
    }
    // 선택 프롬프트가 떠 있는 동안은 재스캔이 상태를 만지지 않는다 (Tracked::asking).
    // 레지스트리는 이 시간을 "질의 진행 중"으로 보아 busy를 쓰므로, 그대로 받으면
    // 사람이 답하기도 전에 waiting이 2초 만에 풀려 페인이 다시 작업 중으로 보인다.
    // 다만 idle은 턴이 끝났다는 뜻이고, 그러면 프롬프트도 이미 닫혔다 — 여기서 고정을 푼다.
    // 이 출구가 없으면 답을 받은 PostToolUse 훅을 놓친 세션이 영영 waiting에 굳고,
    // 재스캔이 통째로 막혀 idle 전이가 안 나가니 인박스(M3)도 영영 배출되지 않는다.
    if t.asking {
        if rec_status != Some("idle") {
            return false;
        }
        t.asking = false;
    }
    // status 부재 시 기존 값 유지 (FR-D-64 — 훅 폴백은 다음 단계)
    let status = rec_status.map(str::to_string).unwrap_or_else(|| t.last_status.clone());
    let waiting = rec_waiting.map(registry_waiting_for);
    if status == t.last_status && waiting == t.last_waiting {
        return false;
    }
    t.last_status = status;
    t.last_waiting = waiting;
    t.status_ms = mtime_ms; // 레지스트리가 그 상태를 쓴 시각 (B19)
    if t.last_status == "idle" {
        t.activity = None; // 턴 종료 부연 정리 — 훅 경로(apply_effect)와 같은 규칙
        t.subagents = 0;
    }
    true
}

/// 채택 세션이 아직 살아 있는가 (A) — 잡 프로세스 트리에 그 pid가 남아 있는지로 본다.
/// 관리 기동(!adopted)은 PTY EOF가 dead를 닫으므로 여기서 판정하지 않는다.
/// 이미 dead인 추적도 살아 있다고 답한다 — 페인이 죽어 잡이 통째로 사라진 세션을 shell로
/// 되돌리면, 종료된 에이전트가 셸로 돌아온 것처럼 보이고 그 페인에 메시지가 주입된다 (P-2).
fn adopted_alive(t: &Tracked, job_pids: &HashMap<String, (Vec<u32>, u64)>) -> bool {
    if !t.adopted || t.last_status == "dead" {
        return true;
    }
    t.pid.is_some_and(|pid| {
        job_pids
            .get(&t.app_session)
            .is_some_and(|(pids, _)| pids.contains(&pid))
    })
}

/// 레지스트리 스캔 — sessionId 일치(FR-D-12)가 1순위, 없으면 pid로 채택한다 (A)
fn scan(app: &AppHandle) {
    let rt: tauri::State<AgentRt> = app.state();
    // 페인별 자식 프로세스 목록 — 채택(A)의 근거. by_uuid 잠금 밖에서 먼저 걷는다.
    let job_pids = crate::session_job_pids(app);
    let tracked_uuids: Vec<String> = match rt.by_uuid.lock() {
        Ok(m) => m.keys().cloned().collect(),
        Err(_) => return,
    };
    if tracked_uuids.is_empty() && job_pids.is_empty() {
        return;
    }
    let entries = fs::read_dir(sessions_dir());
    // degraded 전환 (FR-D-62·63, M34) — 레지스트리 디렉터리 접근 불가면 살아 있는 세션 전부에
    // 낮은 신뢰 표시를 달고(FR-G-27), 상태는 훅 + 프로세스 생존(EOF→dead)으로만 유지한다.
    // 접근이 돌아오면 해제한다. 앱은 계속 동작한다 — 조용히 열화되지 않는다 (FR-D-65).
    let registry_ok = entries.is_ok();
    let mut flips: Vec<AgentStateEvt> = Vec::new();
    if let Ok(mut map) = rt.by_uuid.lock() {
        for uuid in &tracked_uuids {
            let Some(t) = map.get_mut(uuid) else { continue };
            if t.last_status == "dead" || t.degraded != registry_ok {
                continue; // 죽었거나 이미 원하는 값 — 전환 없음
            }
            if is_codex(&t.cli) {
                continue; // Codex는 레지스트리가 애초에 없다 (M37) — 훅만이 상태 소스이고 저하가 아니다
            }
            t.degraded = !registry_ok;
            t.seq = next_seq();
            flips.push(AgentStateEvt {
                session: t.app_session.clone(),
                agent_session: uuid.clone(),
                status: t.last_status.clone(),
                waiting_for: t.last_waiting.clone(),
                activity: t.activity.clone(),
                subagents: t.subagents,
                cost_usd: t.cost_usd,
                resumable: resumable_of(t, uuid),
                version: None,
                exit_code: None,
                degraded: t.degraded,
                seq: t.seq,
                since_ms: Some(t.status_ms),
                completed: false,
            });
        }
    }
    for evt in &flips {
        // 상태 전이가 아니므로 알림 없이 방송만 — 대신 전환 자체는 피드에 기록한다 (FR-D-65)
        let _ = app.emit_to("main", "agent-state", evt.clone());
        let store: tauri::State<crate::StoreState> = app.state();
        let _ = store.0.sender().send(crate::store::StoreMsg::Event {
            ws: evt.session.split('@').nth(1).unwrap_or("default").to_string(),
            id: Some(evt.session.clone()),
            kind: "agent".into(),
            message: if evt.degraded {
                "관측 저하 — 세션 레지스트리 접근 불가 · 훅 + 프로세스 생존으로 유지 (FR-D-63)".into()
            } else {
                "관측 정상화 — 세션 레지스트리 접근 회복".into()
            },
        });
    }
    let Ok(entries) = entries else { return };
    let found = match rt.registry_cache.lock() {
        Ok(mut cache) => read_registry(entries, &mut cache),
        Err(_) => return,
    };
    // ── 채택 (A · FR-D-12 확장) — 앱이 띄우지 않은 claude를 pid로 페인에 잇는다 ──
    //
    // 셸 우선 모델에서는 사용자가 페인 안에서 손으로 `claude`를 띄우거나 재기동하는 일이 흔하고,
    // 그때 sessionId는 앱 발급 UUID와 다르다. 이름 매칭만 하면 그 세션은 상태 소스가 통째로
    // 없어져 페인이 영영 `shell`로 남고, 그러면 대화 전달(M3)이 화면 에코 + 인박스 적재에서
    // 멈춘다 — 도착은 하는데 상대의 턴이 돌지 않는 그 증상이 정확히 이 자리에서 생긴다.
    let mut adopted: Vec<AgentStateEvt> = Vec::new();
    if !job_pids.is_empty() {
        // 원점 폴백은 잠금을 잡기 전에 스냅숏으로 뜬다 — by_uuid를 쥔 채 crate::session_origin을
        // 부르면 그 안의 find_tracked가 같은 뮤텍스를 다시 잠근다. std Mutex는 재진입이 안 되므로
        // 그 스레드는 잠금을 쥔 채 영구 정지하고, by_uuid를 만지는 모든 경로(훅·비용·dead 전이·
        // 기동/재개·스냅숏)가 함께 멎는다 (B37).
        let origins: HashMap<String, (String, String)> =
            rt.session_origin.lock().map(|m| m.clone()).unwrap_or_default();
        if let Ok(mut map) = rt.by_uuid.lock() {
            for (uuid, (rec, mtime_ms)) in found.iter() {
                if map.contains_key(uuid) {
                    continue; // 이미 추적 중 (관리 기동이거나 앞선 스캔이 채택했다)
                }
                // 사람이 쓰는 대화창만 채택한다 — 에이전트가 띄운 서브에이전트·배경 claude도
                // 페인 잡의 자식이라 pid로는 걸리지만, 그것을 채택하면 페인의 재개 앵커가
                // 배경 세션 uuid로 덮여 '대화 열람·재개'가 남의 대화로 간다 (B38).
                // kind가 없는 옛 버전 레코드는 종전대로 후보로 둔다.
                if rec.kind.as_deref().is_some_and(|k| k != "interactive") {
                    continue;
                }
                let Some(pid) = rec.pid else { continue };
                let Some((app_session, gen)) = pane_for_pid(&job_pids, pid) else {
                    continue; // 우리 페인의 자식이 아니다 — 남의 터미널에서 도는 claude
                };
                // 같은 페인의 직전 추적은 걷어낸다 — 한 페인의 상태가 둘로 갈리지 않게
                map.retain(|_, t| keep_on_adopt(t, &app_session));
                // session_origin과 같은 우선순위(추적 맵 → 원점 → 폴백)를 잠금 재진입 없이 편다.
                let (ws, cwd) = map
                    .values()
                    .find(|t| t.app_session == app_session)
                    .map(|t| (t.ws.clone(), t.cwd.clone()))
                    .or_else(|| origins.get(&app_session).cloned())
                    .unwrap_or_else(|| {
                        (
                            app_session.split('@').nth(1).unwrap_or("default").to_string(),
                            rec.cwd.clone().unwrap_or_default(),
                        )
                    });
                let status = rec.status.clone().unwrap_or_else(|| "idle".into());
                let seq = next_seq();
                let waiting = rec.waiting_for.as_deref().map(registry_waiting_for);
                adopted.push(AgentStateEvt {
                    session: app_session.clone(),
                    agent_session: uuid.clone(),
                    status: status.clone(),
                    waiting_for: waiting.clone(),
                    activity: None,
                    subagents: 0,
                    cost_usd: None,
                    resumable: resumable(&cwd, uuid),
                    version: rec.version.clone(),
                    exit_code: None,
                    degraded: false,
                    seq,
                    // 앱이 붙기 전부터 그 상태였다 — 레코드가 쓰인 시각이 전이 시각이다 (B19)
                    since_ms: Some(*mtime_ms),
                    completed: false,
                });
                let name = app_session.split('@').next().unwrap_or(&app_session).to_string();
                map.insert(
                    uuid.clone(),
                    Tracked {
                        app_session,
                        ws,
                        cwd,
                        name,
                        last_status: status,
                        last_waiting: waiting,
                        status_ms: *mtime_ms, // 채택 시점이 아니라 그 상태가 된 시각 (B19)
                        pty_gen: gen, // 페인이 죽으면 on_pty_exit이 dead로 닫을 수 있게
                        seq,
                        adopted: true,
                        pid: Some(pid),
                        ..Default::default()
                    },
                );
            }
        }
    }
    for evt in &adopted {
        // agent_session 매핑 (FR-D-24) — 관리 기동과 같은 자리에 남긴다. 채택 세션도
        // 트랜스크립트 조회와 재개 앵커를 갖게 되어, 앱을 다시 켜도 그 대화로 돌아갈 수 있다.
        if let Some((ws, cwd)) = crate::session_origin(app, &evt.session) {
            let store: tauri::State<crate::StoreState> = app.state();
            let _ = store.0.sender().send(crate::store::StoreMsg::AgentSession {
                ws,
                id: evt.session.clone(),
                agent_session_id: evt.agent_session.clone(),
                log_path: transcript_path(&cwd, &evt.agent_session)
                    .to_string_lossy()
                    .into_owned(),
                resumable: evt.resumable,
            });
        }
        emit_state(app, evt);
    }
    // 채택 세션의 생존 확인 — claude만 죽고 셸이 남으면 PTY EOF가 없어 dead 전이도 없다.
    // 그대로 두면 마지막 idle이 굳어 셸 프롬프트에 메시지를 주입하게 된다 (P-2 위반).
    // 잡 목록을 못 걷은 스캔(잠금 실패·잡 없음)에서는 생존 판정을 하지 않는다 —
    // 근거가 없는데 전부 shell로 되돌리면 멀쩡한 세션의 상태를 날린다.
    let mut lost: Vec<AgentStateEvt> = Vec::new();
    if let (false, Ok(mut map)) = (job_pids.is_empty(), rt.by_uuid.lock()) {
        map.retain(|uuid, t| {
            let alive = adopted_alive(t, &job_pids);
            if !alive {
                lost.push(AgentStateEvt {
                    session: t.app_session.clone(),
                    agent_session: uuid.clone(),
                    status: "shell".into(), // 페인은 살아 있다 — dead가 아니라 셸로 되돌린다
                    waiting_for: None,
                    activity: None,
                    subagents: 0,
                    cost_usd: t.cost_usd,
                    resumable: resumable_of(t, uuid),
                    version: None,
                    exit_code: None,
                    degraded: false,
                    seq: next_seq(),
                    since_ms: Some(crate::workspace::now_ms()),
                    completed: false,
                });
            }
            alive // 추적에서 뺀다 — 사용자가 다시 띄우면 그때 새 uuid로 다시 채택된다
        });
    }
    for evt in &lost {
        emit_state(app, evt);
    }
    let mut updates: Vec<AgentStateEvt> = Vec::new();
    if let Ok(mut map) = rt.by_uuid.lock() {
        for uuid in tracked_uuids {
            let Some(t) = map.get_mut(&uuid) else { continue };
            if t.last_status == "dead" {
                continue;
            }
            if let Some((rec, mtime_ms)) = found.get(&uuid) {
                if !apply_registry(t, rec.status.as_deref(), rec.waiting_for.as_deref(), *mtime_ms) {
                    continue;
                }
                t.seq = next_seq();
                updates.push(AgentStateEvt {
                    session: t.app_session.clone(),
                    agent_session: uuid.clone(),
                    status: t.last_status.clone(),
                    waiting_for: t.last_waiting.clone(),
                    activity: t.activity.clone(),
                    subagents: t.subagents,
                    cost_usd: t.cost_usd,
                    resumable: resumable_of(t, &uuid),
                    version: rec.version.clone(),
                    exit_code: None,
                    degraded: t.degraded,
                    seq: t.seq,
                    since_ms: Some(t.status_ms),
                    completed: false,
                });
            }
        }
    }
    for evt in updates {
        emit_state(app, &evt);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        adopted_alive, apply_effect, apply_registry, current_uuid, hook_effect, keep_on_adopt,
        done_key, done_text, gate_step, read_registry, recap_from_transcript, recap_line, HookEffect, NotifyGate,
        Tracked, RECAP_MAX, TURN_DONE_MIN_MS,
    };
    use std::collections::HashMap;

    /// 추적 하나 — 상태 이름만 갈아 끼운다. 나머지는 기본값(훅 없음·채택 아님)
    fn tracked(status: &str) -> Tracked {
        Tracked {
            app_session: "노엘@ws".into(),
            last_status: status.into(),
            ..Default::default()
        }
    }

    fn stop() -> HookEffect {
        hook_effect("Stop", &nil())
    }

    fn submit() -> HookEffect {
        hook_effect("UserPromptSubmit", &nil())
    }

    /// 턴 완료는 30초 경계에서 갈린다 — 짧은 턴은 신호하지 않는다
    #[test]
    fn turn_done_needs_thirty_seconds_of_work() {
        let mut t = tracked("idle");
        apply_effect(&mut t, &submit(), &nil(), 0);
        apply_effect(&mut t, &stop(), &nil(), TURN_DONE_MIN_MS - 1);
        assert!(!t.turn_done, "30초 미만은 소음이다");
        apply_effect(&mut t, &submit(), &nil(), 100_000);
        apply_effect(&mut t, &pre("Bash"), &nil(), 110_000);
        apply_effect(&mut t, &stop(), &nil(), 100_000 + TURN_DONE_MIN_MS);
        assert!(t.turn_done);
        assert!(t.busy_since.is_none(), "Stop이 턴 시작 시각을 거둔다");
    }

    /// 레지스트리가 먼저 idle로 내렸어도 Stop은 완료를 방송한다 — 같은 상태라고 삼키지 않는다
    #[test]
    fn turn_done_survives_a_registry_that_went_idle_first() {
        let mut t = tracked("busy");
        apply_effect(&mut t, &pre("Edit"), &nil(), 0); // 도구가 돌면 턴 중이다
        t.last_status = "idle".into(); // 2초 재스캔이 먼저 내린 자리
        assert_eq!(apply_effect(&mut t, &stop(), &nil(), 60_000), Some(false));
        assert!(t.turn_done);
        // 다음 Stop은 시작 시각이 없으니 그냥 조용하다
        t.turn_done = false;
        assert_eq!(apply_effect(&mut t, &stop(), &nil(), 61_000), None);
    }

    /// 완료 알림과 waiting 알림은 게이트를 따로 센다 — 완료 직후의 waiting이 합쳐져 사라지면 안 된다
    #[test]
    fn done_gate_never_swallows_a_waiting_alert() {
        let mut gates: HashMap<String, NotifyGate> = HashMap::new();
        let mut step = |key: String, now: i64| {
            let g = gates.entry(key).or_insert(NotifyGate { last_ms: 0, suppressed: 0 });
            gate_step(g, now)
        };
        assert_eq!(step(done_key("카이@ws"), 100_000), Some(0));
        assert_eq!(step("카이@ws".into(), 105_000), Some(0), "waiting은 제 게이트로 나간다");
        assert_eq!(step(done_key("카이@ws"), 110_000), None, "완료끼리는 60초 안에서 합친다");
        assert_eq!(step(done_key("카이@ws"), 170_000), Some(1));
    }

    #[test]
    fn done_text_says_done_only_for_reports() {
        assert_eq!(
            done_text("report", "카이", Some("로그인 API 완료"), 0, false),
            ("카이 · 완료".into(), "로그인 API 완료".into())
        );
        assert_eq!(done_text("report", "kai", Some("done"), 0, true).0, "kai · done");
        assert_eq!(
            done_text("turn", "카이", None, 2, false),
            ("카이 · 턴 끝남".into(), "턴이 끝났습니다 (그 사이 2건 합침)".into())
        );
        assert_eq!(done_text("turn", "kai", Some("  "), 0, true).1, "The turn has ended");
    }

    fn pre(tool: &str) -> HookEffect {
        hook_effect("PreToolUse", &serde_json::json!({ "tool_name": tool }))
    }

    fn nil() -> serde_json::Value {
        serde_json::Value::Null
    }

    // apply_effect의 반환 규약: Some(false)=상태 전이(피드·알림까지) · Some(true)=부연만
    // (방송만) · None=변화 없음(방송 안 함). 세 값이 갈리는 자리가 곧 회귀가 나던 자리다.
    const TRANSITION: Option<bool> = Some(false);
    const QUIET: Option<bool> = Some(true);
    const SILENT: Option<bool> = None;

    /// 사람이 골라야 끝나는 프롬프트는 2초 재스캔이 내려서는 안 된다 — 레지스트리는 그
    /// 시간을 "질의 진행 중"으로 보아 busy를 쓰므로, 그대로 받으면 답하기도 전에 페인이
    /// 다시 작업 중으로 보이고 대화(M3)가 busy 세션에 주입되지 않는다.
    #[test]
    fn ask_prompt_survives_a_busy_rescan() {
        let mut t = tracked("busy");
        assert_eq!(apply_effect(&mut t, &pre("AskUserQuestion"), &nil(), 1_000), TRANSITION);
        assert_eq!(t.last_status, "waiting");
        assert!(t.asking);
        // 더 신선한 레지스트리 파일이라도 busy로 되돌리지 못한다
        assert!(!apply_registry(&mut t, Some("busy"), None, 2_000));
        assert_eq!(t.last_status, "waiting");
    }

    /// 그 고정에는 출구가 있어야 한다 — 답을 받은 PostToolUse 훅을 놓치면(파이프 유실·
    /// degraded) asking이 영영 참으로 남아 재스캔이 통째로 막히고, 페인은 waiting에 굳은 채
    /// idle 전이가 안 나가 인박스(M3)도 영영 배출되지 않는다. 레지스트리의 idle = 턴 종료 =
    /// 프롬프트도 닫혔다는 뜻이므로 그때 푼다.
    #[test]
    fn ask_prompt_unsticks_when_the_registry_ends_the_turn() {
        let mut t = tracked("busy");
        apply_effect(&mut t, &pre("ExitPlanMode"), &nil(), 1_000);
        assert!(t.asking);
        assert!(apply_registry(&mut t, Some("idle"), None, 2_000));
        assert_eq!(t.last_status, "idle");
        assert!(!t.asking); // 고정 해제 — 다음 재스캔부터 정상 추종
    }

    /// P-3 — 훅이 더 나중이면 오래된 레지스트리 파일이 신선한 상태를 되돌리지 않는다.
    /// 방치하면 2초 주기 재스캔이 가짜 idle을 만들어 인박스를 오주입한다.
    #[test]
    fn a_stale_registry_file_never_overrides_a_fresher_hook() {
        let mut t = tracked("idle");
        assert_eq!(apply_effect(&mut t, &hook_effect("UserPromptSubmit", &nil()), &nil(), 1_000), TRANSITION);
        assert_eq!(t.hook_ms, 1_000);
        assert!(!apply_registry(&mut t, Some("idle"), None, 900)); // 더 오래된 파일
        assert!(!apply_registry(&mut t, Some("idle"), None, 1_000)); // 동시각도 훅이 이긴다
        assert_eq!(t.last_status, "busy");
        assert!(apply_registry(&mut t, Some("idle"), None, 1_001)); // 더 새 파일은 따른다
        assert_eq!(t.last_status, "idle");
    }

    /// 도구 실행 시작 = 승인 완료 — waiting 고착을 busy로 푼다. 이 전이는 부연이 아니라
    /// 상태 변화이므로 피드·알림 경로로 나가야 한다 (degraded 모드의 유일한 해제 경로)
    #[test]
    fn a_tool_start_unsticks_a_waiting_pane_as_a_transition() {
        let mut t = tracked("waiting");
        t.last_waiting = Some("권한 승인 대기".into());
        assert_eq!(apply_effect(&mut t, &pre("Bash"), &nil(), 500), TRANSITION);
        assert_eq!(t.last_status, "busy");
        assert_eq!(t.last_waiting, None);
        assert_eq!(t.activity.as_deref(), Some("Bash"));
        assert_eq!(t.hook_ms, 500); // 해제도 훅 소스다 — 재스캔이 되돌리지 못하게
    }

    /// 같은 도구가 다시 와도 변화가 없으면 방송하지 않는다. 부연만 바뀌는 갱신은 조용히 —
    /// 도구 호출마다 피드에 줄이 쌓이면 전이의 기록이라는 의미가 사라진다 (FR-D-17)
    #[test]
    fn activity_updates_are_quiet_and_repeats_are_silent() {
        let mut t = tracked("busy");
        assert_eq!(apply_effect(&mut t, &pre("Read"), &nil(), 100), QUIET);
        assert_eq!(apply_effect(&mut t, &pre("Read"), &nil(), 200), SILENT);
        assert_eq!(apply_effect(&mut t, &pre("Edit"), &nil(), 300), QUIET);
        assert_eq!(t.status_ms, 0); // 부연은 상태 시각을 건드리지 않는다 (B19)
    }

    /// 턴이 끝나면 도구·서브에이전트 부연도 함께 접는다 — 훅과 레지스트리 두 경로 모두
    #[test]
    fn idle_folds_activity_and_subagents_on_both_sources() {
        let mut t = tracked("busy");
        t.activity = Some("Bash".into());
        t.subagents = 2;
        apply_effect(&mut t, &hook_effect("Stop", &nil()), &nil(), 1_000);
        assert_eq!((t.activity.clone(), t.subagents), (None, 0));

        let mut t = tracked("busy");
        t.activity = Some("Bash".into());
        t.subagents = 2;
        assert!(apply_registry(&mut t, Some("idle"), None, 1_000));
        assert_eq!((t.activity, t.subagents), (None, 0));
    }

    /// SubagentStop이 Start보다 많이 와도(훅 유실·재기동) 음수로 내려가지 않는다
    #[test]
    fn subagent_count_never_goes_negative() {
        let mut t = tracked("busy");
        assert_eq!(apply_effect(&mut t, &hook_effect("SubagentStop", &nil()), &nil(), 0), SILENT);
        assert_eq!(t.subagents, 0);
        apply_effect(&mut t, &hook_effect("SubagentStart", &nil()), &nil(), 0);
        apply_effect(&mut t, &hook_effect("SubagentStop", &nil()), &nil(), 0);
        apply_effect(&mut t, &hook_effect("SubagentStop", &nil()), &nil(), 0);
        assert_eq!(t.subagents, 0);
    }

    /// Notification 훅의 message가 대기 문맥이 된다 — 같은 문맥이 다시 오면 조용히
    #[test]
    fn notification_carries_its_message_as_the_waiting_context() {
        let mut t = tracked("busy");
        let payload = serde_json::json!({ "message": "권한 승인 대기" });
        let effect = hook_effect("Notification", &payload);
        assert_eq!(apply_effect(&mut t, &effect, &payload, 1_000), TRANSITION);
        assert_eq!(t.last_waiting.as_deref(), Some("권한 승인 대기"));
        assert_eq!(apply_effect(&mut t, &effect, &payload, 2_000), SILENT);
        assert_eq!(t.status_ms, 1_000); // 변화 없는 훅은 대기 시작 시각을 갱신하지 않는다 (B19)
    }

    /// status 부재 레코드는 기존 상태를 유지한다 (FR-D-64 부분 파싱) — 지어내지 않는다
    #[test]
    fn a_record_without_a_status_keeps_the_last_one() {
        let mut t = tracked("busy");
        assert!(!apply_registry(&mut t, None, None, 1_000));
        assert_eq!(t.last_status, "busy");
        // 문맥만 바뀌어도 방송 대상이다 — 화면 배지가 그 한 줄로 갈린다
        assert!(apply_registry(&mut t, None, Some("permission prompt"), 2_000));
        assert_eq!(t.last_waiting.as_deref(), Some("권한 승인 대기"));
        assert_eq!(t.last_status, "busy");
    }

    /// 죽은 추적은 재스캔이 되살리지 않는다
    #[test]
    fn a_dead_tracking_is_left_alone_by_the_rescan() {
        let mut t = tracked("dead");
        assert!(!apply_registry(&mut t, Some("idle"), None, 9_999));
        assert_eq!(t.last_status, "dead");
    }

    /// 채택 세션(A)의 생존 — 잡에서 pid가 사라지면 페인은 살아 있으므로 shell로 되돌린다.
    /// 관리 기동은 PTY EOF가 dead를 닫으므로 여기서 판정하지 않는다.
    /// 이미 dead인 추적을 shell로 되살리면 종료된 에이전트가 셸로 돌아온 것처럼 보이고,
    /// 그 페인에 메시지가 주입된다 (P-2) — 페인이 죽어 잡이 통째로 사라진 자리가 그 경로다.
    #[test]
    fn liveness_loses_a_vanished_agent_but_never_resurrects_a_dead_one() {
        let mut jobs: HashMap<String, (Vec<u32>, u64)> = HashMap::new();
        jobs.insert("노엘@ws".into(), (vec![100, 202], 7));
        jobs.insert("카이@ws".into(), (vec![300], 1));

        let mut adopted = tracked("idle");
        adopted.adopted = true;
        adopted.pid = Some(202);
        assert!(adopted_alive(&adopted, &jobs)); // 잡 트리에 그대로 있다

        adopted.pid = Some(999); // claude만 죽고 셸이 남았다 — EOF가 없으니 dead도 없다
        assert!(!adopted_alive(&adopted, &jobs));

        adopted.last_status = "dead".into(); // 페인이 죽어 잡이 사라진 세션
        assert!(adopted_alive(&adopted, &jobs));

        let managed = tracked("idle"); // adopted=false — EOF가 닫는다
        assert!(adopted_alive(&managed, &jobs));

        let mut orphan = tracked("idle"); // 페인 자체가 잡 목록에 없다
        orphan.adopted = true;
        orphan.pid = Some(100);
        orphan.app_session = "사라진@ws".into();
        assert!(!adopted_alive(&orphan, &jobs));
    }

    /// 트랜스크립트 경로 이스케이프 (QA) — Claude Code는 ASCII 영숫자만 남기고 나머지를 '-'로.
    /// `_`·`.`·공백·한글이 든 cwd에서 resumable이 오판되던 회귀를 막는다.
    #[test]
    fn transcript_path_escapes_like_claude_code() {
        let esc = |cwd: &str| {
            super::transcript_path(cwd, "u")
                .parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        };
        assert_eq!(esc("C:\\Users\\USER"), "C--Users-USER");
        assert_eq!(esc("D:\\ClaudeProject.EQMent"), "D--ClaudeProject-EQMent");
        assert_eq!(esc("D:\\my_proj v2"), "D--my-proj-v2"); // 밑줄·공백도 '-'
        assert_eq!(esc("D:\\팀"), "D---"); // 한글은 ASCII 영숫자가 아니라 '-'
    }

    /// cwd 최신 트랜스크립트 추정 (셸 우선 모델) — 빈 파일·jsonl 아닌 파일은 제외, 최신 수정본
    #[test]
    fn latest_jsonl_picks_newest_nonempty() {
        let dir = std::env::temp_dir().join(format!("eqmux-lt-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("old.jsonl"), "x").unwrap();
        std::fs::write(dir.join("empty.jsonl"), "").unwrap();
        std::fs::write(dir.join("note.txt"), "x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30)); // mtime 해상도 확보
        std::fs::write(dir.join("new.jsonl"), "y").unwrap();
        let p = super::latest_jsonl_in(&dir).unwrap();
        assert_eq!(p.file_name().unwrap(), "new.jsonl");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// pid 채택 (A) — 앱이 띄우지 않은 claude는 sessionId가 앱 발급 UUID와 다르므로
    /// 잡 프로세스 트리의 pid만이 페인을 잇는 끈이다. 여기가 비면 그 세션은 상태가 영영
    /// `shell`로 남고, 대화 전달이 화면 에코 + 인박스 적재에서 멈춘다 (답신 0건의 원인).
    #[test]
    fn pid_finds_the_owning_pane() {
        let mut jobs = std::collections::HashMap::new();
        jobs.insert("노엘@ws".to_string(), (vec![100, 101, 102], 7));
        jobs.insert("카이@ws".to_string(), (vec![200, 201], 3));
        // 손자 프로세스(pwsh → claude)도 같은 잡에 들어 있으므로 그대로 잡힌다
        assert_eq!(super::pane_for_pid(&jobs, 102), Some(("노엘@ws".into(), 7)));
        assert_eq!(super::pane_for_pid(&jobs, 200), Some(("카이@ws".into(), 3)));
        // 남의 터미널에서 도는 claude는 어느 잡에도 없다 — 채택하지 않는다
        assert_eq!(super::pane_for_pid(&jobs, 999), None);
        assert_eq!(super::pane_for_pid(&std::collections::HashMap::new(), 100), None);
    }

    /// 레지스트리 파일은 claude pid마다 하나이고 프로세스가 죽어도 남는다. `--resume`은 같은
    /// sessionId로 새 pid 파일을 쓰므로 한 sessionId에 파일이 둘 남고, read_dir 순서에 맡기면
    /// 죽은 프로세스의 낡은 레코드가 이긴다 — 그 pid는 어느 잡에도 없어 채택이 실패하고,
    /// 낡은 mtime이 스테일 가드(P-3)에 걸려 상태 갱신까지 막힌다. 최신 파일이 이겨야 한다.
    #[test]
    fn read_registry_prefers_the_live_record_over_the_dead_one() {
        let dir = std::env::temp_dir().join(format!("eqmux-reg-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let rec = |pid: u32, status: &str| {
            format!(
                r#"{{"pid":{pid},"sessionId":"same-uuid","status":"{status}","kind":"interactive","cwd":"D:\\ws"}}"#
            )
        };
        std::fs::write(dir.join("1000.json"), rec(1000, "busy")).unwrap(); // 죽은 프로세스가 남긴 것
        std::fs::write(dir.join("2.json"), "not json at all").unwrap(); // 손상 파일은 건너뛴다
        std::fs::write(dir.join("note.txt"), rec(3, "idle")).unwrap(); // json이 아니다
        std::thread::sleep(std::time::Duration::from_millis(30)); // mtime 해상도 확보
        std::fs::write(dir.join("0007.json"), rec(7, "idle")).unwrap(); // --resume 후 살아 있는 쪽

        let mut cache = HashMap::new();
        let found = read_registry(std::fs::read_dir(&dir).unwrap(), &mut cache);
        assert_eq!(found.len(), 1); // 같은 sessionId는 하나로 접힌다
        let (live, _) = found.get("same-uuid").unwrap();
        assert_eq!(live.pid, Some(7)); // 파일 이름 순서("0007" < "1000")가 아니라 최신 mtime
        assert_eq!(live.status.as_deref(), Some("idle"));

        // 캐시 (A5) — 바뀐 파일만 다시 읽고, 사라진 파일은 걷힌다
        assert_eq!(cache.len(), 3, "json 파일 셋 — 손상 파일도 실패로 기억한다");
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(dir.join("0007.json"), rec(7, "busy")).unwrap();
        std::fs::remove_file(dir.join("1000.json")).unwrap();
        let found = read_registry(std::fs::read_dir(&dir).unwrap(), &mut cache);
        assert_eq!(found["same-uuid"].0.status.as_deref(), Some("busy"), "바뀐 파일은 다시 읽는다");
        assert_eq!(cache.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 한 페인의 추적은 하나다 (관리 기동 agent_spawn의 retain과 같은 규칙). 레지스트리에
    /// 남아 있는지로 거르면 직전 프로세스의 추적이 안 걷힌다 — 파일은 죽어도 남기 때문이다.
    #[test]
    fn adoption_leaves_one_tracking_per_pane() {
        let stale = tracked("idle"); // 직전 프로세스 — 레지스트리 파일이 아직 남아 있어도 걷는다
        assert!(!keep_on_adopt(&stale, "노엘@ws"));

        let starting = tracked("starting"); // 갓 기동 — 아직 레지스트리에 안 나타났다
        assert!(keep_on_adopt(&starting, "노엘@ws"));

        let other = tracked("busy"); // 남의 페인은 건드리지 않는다
        assert!(keep_on_adopt(&other, "카이@ws"));
    }

    /// 정리 전 창에서 한 페인에 추적이 둘이면, 훅·비용이 어디에 붙을지가 HashMap 순서로
    /// 갈린다 — 방송되는 agent_session이 두 uuid를 오가고 화면의 재개 앵커가 끝난 대화로
    /// 튄다 (B38). 가장 최근에 순번을 받은 것이 지금 도는 프로세스다.
    #[test]
    fn hooks_land_on_the_panes_current_tracking() {
        let mut map: HashMap<String, Tracked> = HashMap::new();
        let mut old = tracked("busy");
        old.seq = 3;
        map.insert("uuid-old".into(), old);
        let mut new = tracked("idle");
        new.seq = 9;
        map.insert("uuid-new".into(), new);
        let mut dead = tracked("dead"); // 죽은 추적은 순번이 가장 커도 고르지 않는다
        dead.seq = 99;
        map.insert("uuid-dead".into(), dead);
        let mut elsewhere = tracked("busy");
        elsewhere.app_session = "카이@ws".into();
        elsewhere.seq = 50;
        map.insert("uuid-kai".into(), elsewhere);

        assert_eq!(current_uuid(&map, "노엘@ws").as_deref(), Some("uuid-new"));
        assert_eq!(current_uuid(&map, "카이@ws").as_deref(), Some("uuid-kai"));
        assert_eq!(current_uuid(&map, "없는@ws"), None);
    }

    #[test]
    fn hook_events_map_to_states() {
        assert_eq!(super::hook_status("Stop"), Some("idle"));
        assert_eq!(super::hook_status("UserPromptSubmit"), Some("busy"));
        assert_eq!(super::hook_status("Notification"), Some("waiting"));
        assert_eq!(super::hook_status("SubagentStop"), None); // 본체는 아직 busy
        assert_eq!(super::hook_status("PreToolUse"), None);
    }

    /// 훅 2차 소스의 효과 분리 (FR-D-15·18) — 상태를 바꾸지 않는 이벤트는 부연만 채운다
    /// 한 줄 요약 추출 (M35) — 여기가 틀리면 페인 헤더에 목록 기호나 코드 울타리가 뜬다.
    /// recap: 줄은 사용자 관례라 우선하되, 없는 세션도 반드시 한 문장이 나와야 한다.
    #[test]
    fn recap_line_prefers_recap_then_falls_back_to_prose() {
        // 관례를 쓰는 세션 — 장식(※)을 걷고 그 줄을 쓴다
        let t = "작업을 마쳤다.\n\n※ recap: PRD 7절을 갱신하고 커밋 5개로 정리했습니다.\n- 다음: 리뷰";
        assert_eq!(
            recap_line(t).as_deref(),
            Some("recap: PRD 7절을 갱신하고 커밋 5개로 정리했습니다.")
        );

        // 관례가 없으면 첫 산문 줄 — 목록·인용·제목·코드 울타리는 문장이 아니다
        let t = "```\ncargo test\n```\n- 항목\n> 인용\n# 제목\n브라우저 패널에 CLI 조종을 붙였습니다.";
        assert_eq!(recap_line(t).as_deref(), Some("브라우저 패널에 CLI 조종을 붙였습니다."));

        // 길면 자른다 — 페인 헤더 한 칸에 들어가야 한다
        let long = "가".repeat(RECAP_MAX + 40);
        let cut = recap_line(&long).unwrap();
        assert_eq!(cut.chars().count(), RECAP_MAX + 1, "상한 + 말줄임 한 글자");
        assert!(cut.ends_with('…'));

        // 마크다운 강조는 헤더에서 노이즈다 — 실제 트랜스크립트에 흔하다
        assert_eq!(
            recap_line("Q30 **권장안이 제 HQ11과 반대**라 `11.1`을 먼저 맞춥니다.").as_deref(),
            Some("Q30 권장안이 제 HQ11과 반대라 11.1을 먼저 맞춥니다.")
        );

        // 건질 게 없으면 None — 빈 문장을 헤더에 올리지 않는다
        assert!(recap_line("").is_none());
        assert!(recap_line("   \n\n  ").is_none());
        assert!(recap_line("- 목록만\n* 있다\n").is_none());
        // 빈 recap: 줄은 관례로 치지 않는다 — 폴백이 받아야 한다
        assert_eq!(recap_line("recap:\n실제 문장은 여기다.").as_deref(), Some("실제 문장은 여기다."));
    }

    /// 읽기 경로 (M35) — recap_line 검사만으로는 여기가 비는 것을 못 잡는다.
    /// transcript::read의 limit은 "마지막 N턴만 남김"이라 0을 넘기면 턴이 통째로 사라졌다.
    #[test]
    fn recap_from_transcript_picks_the_last_agent_turn() {
        let dir = std::env::temp_dir().join(format!("eqmux-recapio-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("u1.jsonl");
        std::fs::write(
            &path,
            concat!(
                r#"{"type":"user","message":{"role":"user","content":"고쳐줘"}}"#,
                "
",
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"먼저 구조를 봅니다."}]}}"#,
                "
",
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"브라우저 패널에 CLI 조종을 붙였습니다."}]}}"#,
                "
",
            ),
        )
        .unwrap();
        assert_eq!(
            recap_from_transcript(&path).as_deref(),
            Some("브라우저 패널에 CLI 조종을 붙였습니다."),
            "마지막 에이전트 턴에서 한 문장이 나와야 한다"
        );
        assert!(recap_from_transcript(&dir.join("없다.jsonl")).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// B67 — 쉬는 Claude의 유휴 안내는 상태를 바꾸지 않는다. 권한 프롬프트만 waiting
    #[test]
    fn idle_notice_does_not_become_waiting() {
        let idle = serde_json::json!({ "notification_type": "idle_prompt", "message": "Claude is waiting for your input" });
        assert!(matches!(hook_effect("Notification", &idle), HookEffect::Ignore));
        let old_idle = serde_json::json!({ "message": "Claude is waiting for your input" }); // notification_type 이전 버전
        assert!(matches!(hook_effect("Notification", &old_idle), HookEffect::Ignore));

        let perm = serde_json::json!({ "notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash" });
        let effect = hook_effect("Notification", &perm);
        assert!(matches!(effect, HookEffect::Status("waiting")));
        let mut t = tracked("idle");
        assert_eq!(apply_effect(&mut t, &effect, &perm, 1_000), TRANSITION);
        assert_eq!(t.last_waiting.as_deref(), Some(super::WAIT_PERMISSION)); // 원문 영어가 배지에 섞이지 않는다 (U29)
    }

    #[test]
    fn hook_effects_fill_activity_and_subagents() {
        let pre = serde_json::json!({ "tool_name": "Bash" });
        assert!(matches!(
            super::hook_effect("PreToolUse", &pre),
            HookEffect::Activity(Some(ref t)) if t == "Bash"
        ));
        assert!(matches!(
            super::hook_effect("PostToolUse", &serde_json::Value::Null),
            HookEffect::Activity(None)
        ));
        assert!(matches!(
            super::hook_effect("SubagentStart", &serde_json::Value::Null),
            HookEffect::SubagentDelta(1)
        ));
        assert!(matches!(
            super::hook_effect("SubagentStop", &serde_json::Value::Null),
            HookEffect::SubagentDelta(-1)
        ));
        assert!(matches!(
            super::hook_effect("Stop", &serde_json::Value::Null),
            HookEffect::Status("idle")
        ));
        assert!(matches!(
            super::hook_effect("PreCompact", &serde_json::Value::Null),
            HookEffect::Ignore
        ));
    }

    /// 사람이 골라야 끝나는 도구는 부연이 아니라 상태다 — 여기가 Activity로 새면 선택
    /// 프롬프트가 떠 있는 내내 페인이 "작업 중"으로 보이고, 대화도 인박스에서 멈춘다
    #[test]
    fn ask_tools_become_waiting_not_activity() {
        let ask = serde_json::json!({ "tool_name": "AskUserQuestion" });
        assert!(matches!(
            super::hook_effect("PreToolUse", &ask),
            HookEffect::Ask(r) if r.contains("질문")
        ));
        let plan = serde_json::json!({ "tool_name": "ExitPlanMode" });
        assert!(matches!(
            super::hook_effect("PreToolUse", &plan),
            HookEffect::Ask(r) if r.contains("계획")
        ));
        // 나머지 도구는 그대로 부연 — 상태를 건드리지 않는다
        assert!(matches!(
            super::hook_effect("PreToolUse", &serde_json::json!({ "tool_name": "Read" })),
            HookEffect::Activity(Some(ref t)) if t == "Read"
        ));
        assert_eq!(super::ask_waiting_for("Bash"), None);
    }

    /// 레지스트리 영문 문맥은 우리 어휘로 옮기고, 모르는 값은 그대로 둔다 (B16).
    /// 알림 제목은 무엇을 기다리는지에 따라 갈린다 (B17).
    #[test]
    fn registry_context_is_translated_and_titles_split() {
        assert_eq!(super::registry_waiting_for("permission prompt"), "권한 승인 대기");
        assert_eq!(super::registry_waiting_for("input needed"), "입력 필요 — 이 페인에서 답해야 진행됩니다");
        // 모르는 값은 원문 유지 (FR-D-64) — 조용히 지어내지 않는다
        assert_eq!(super::registry_waiting_for("brand new state"), "brand new state");

        assert_eq!(super::waiting_title(Some(super::WAIT_QUESTION), false), "질문 대기");
        assert_eq!(super::waiting_title(Some(super::WAIT_PLAN), false), "계획 승인 대기");
        assert_eq!(super::waiting_title(Some("권한 승인 대기"), false), "승인 대기");
        assert_eq!(super::waiting_title(None, false), "승인 대기"); // 모르면 종전대로
        // 표시 언어가 영어면 토스트도 영어다 (B66) — 앱 밖으로 나가는 유일한 신호다
        assert_eq!(super::waiting_title(Some(super::WAIT_QUESTION), true), "question");
    }

    /// Codex 훅 인자 (M37) — 이벤트마다 `-c hooks.<E>=[…]` 한 쌍, 명령은 eqmux _hook <E>.
    /// 값에 큰따옴표가 있으면 cmd.exe 폴백 경로에서 깨진다 — 리터럴(작은따옴표)만 써야 한다.
    #[test]
    fn codex_hook_args_cover_every_event_without_double_quotes() {
        let args = super::codex_hook_args();
        assert!(args.iter().any(|a| a == "--dangerously-bypass-hook-trust")); // 앱이 쓴 훅은 심사 대상이 아니다
        assert_eq!(args.iter().filter(|a| *a == "-c").count(), super::CODEX_HOOK_EVENTS.len());
        for e in super::CODEX_HOOK_EVENTS {
            let want = format!("hooks.{e}=[{{hooks=[{{type='command',command='eqmux _hook {e}',timeout=5}}]}}]");
            assert!(args.contains(&want), "{e} 훅 인자가 빠졌다");
        }
        assert!(args.iter().all(|a| !a.contains('"')));
        // Stop이 없으면 idle 전이가 없어 인박스(M3)가 영영 배출되지 않는다 — 집합에서 빠지면 안 된다
        assert!(super::CODEX_HOOK_EVENTS.contains(&"Stop") && super::CODEX_HOOK_EVENTS.contains(&"PermissionRequest"));
    }

    /// 권한 → Codex 플래그 (M37). bypass는 어떤 입력에도 나오지 않는다.
    #[test]
    fn codex_permission_translation_never_bypasses() {
        assert_eq!(
            super::codex_permission_args("manual"),
            ["--sandbox", "read-only", "--ask-for-approval", "on-request"]
        );
        assert_eq!(
            super::codex_permission_args("acceptEdits"),
            ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"]
        );
        for mode in ["manual", "acceptEdits", "bypassPermissions", ""] {
            assert!(super::codex_permission_args(mode).iter().all(|a| !a.contains("dangerously")));
        }
        // git 금지는 지시로만 — commit 금지가 push 금지를 포함한다
        let both = vec!["Bash(git commit *)".to_string(), "Bash(git push *)".to_string()];
        assert!(super::codex_git_rules(&both).unwrap().contains("git commit"));
        let push = vec!["Bash(git push *)".to_string()];
        let r = super::codex_git_rules(&push).unwrap();
        assert!(r.contains("git push") && !r.contains("git commit"));
        assert_eq!(super::codex_git_rules(&[]), None);
        // TOML 리터럴 한 줄 — 줄바꿈과 작은따옴표는 살아남을 수 없다
        let line = super::toml_literal_line("a\r\nb 'c'");
        assert!(!line.contains('\n') && !line.contains('\''));
        assert!(line.starts_with("a b"));
    }

    /// Codex의 승인 요청은 Claude의 Notification 자리 — waiting으로 올리고 답이 오면 풀린다
    #[test]
    fn permission_request_is_a_waiting_prompt() {
        assert!(matches!(
            super::hook_effect("PermissionRequest", &serde_json::json!({ "tool_name": "Bash" })),
            HookEffect::Ask(r) if r == super::WAIT_PERMISSION
        ));
        // 모르는 엔진 이름은 Claude — 옛 team.json(cli 없음)이 그대로 산다
        assert_eq!(super::normalize_cli(None), "claude");
        assert_eq!(super::normalize_cli(Some("codex")), "codex");
        assert_eq!(super::normalize_cli(Some("gemini")), "claude");
    }

    /// 재개 가능 판정은 엔진별 실측이다 (M37) — Codex는 훅이 알려준 롤아웃 경로가 있어야 한다
    #[test]
    fn resumable_of_reads_codex_rollout_path() {
        let dir = std::env::temp_dir().join(format!("eqmux-codex-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let rollout = dir.join("rollout.jsonl");
        let mut t = super::Tracked { cli: "codex".into(), cwd: dir.to_string_lossy().into_owned(), ..Default::default() };
        assert!(!super::resumable_of(&t, "any")); // 경로를 아직 모른다
        t.transcript = Some(rollout.to_string_lossy().into_owned());
        assert!(!super::resumable_of(&t, "any")); // 파일이 없다
        std::fs::write(&rollout, "{}\n").unwrap();
        assert!(super::resumable_of(&t, "any"));
        // Claude 추적은 종전 규칙(cwd+uuid) — 롤아웃 경로가 있어도 보지 않는다
        t.cli = String::new();
        assert!(!super::resumable_of(&t, "no-such-uuid"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
