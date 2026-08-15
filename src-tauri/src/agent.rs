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
    /// 상태 이벤트 순번 (P-4) — 전역 단조 증가. 스냅숏과 실시간 이벤트가 겹치는 창에서
    /// 프런트가 더 오래된 페이로드를 버릴 수 있게 한다
    pub seq: u64,
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
}

/// 세션 영구 제거 시 잔류 상태 정리 (P-9) — 추적 맵·알림 게이트·IPC 토큰.
/// expected_exit는 남긴다 — 진행 중인 kill의 EOF 처리(on_pty_exit)가 스스로 소비한다.
pub fn forget_session(app: &AppHandle, id: &str) {
    let rt: tauri::State<AgentRt> = app.state();
    if let Ok(mut map) = rt.by_uuid.lock() {
        map.retain(|_, t| t.app_session != id);
    }
    if let Ok(mut gates) = rt.notify_gate.lock() {
        gates.remove(id);
    }
    if let Ok(mut tokens) = rt.session_tokens.lock() {
        tokens.remove(id);
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
}

/// 세션 레지스트리 레코드 (§10.1) — 부분 파싱 (FR-D-64): 모르는 필드는 무시,
/// 필드 부재는 None. 공개 계약이 아니므로 전부 Option이다.
#[derive(Deserialize)]
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
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into()))
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

/// 재개 가능 판정 = 트랜스크립트 존재 + 비어 있지 않음 (FR-D-20). 추정하지 않고 실측한다.
pub fn resumable(cwd: &str, uuid: &str) -> bool {
    fs::metadata(transcript_path(cwd, uuid))
        .map(|m| m.len() > 0)
        .unwrap_or(false)
}

/// 기동 커맨드 빌더 후보 (§4.1.1) — exe 직접 실행, 실패 시 cmd 경유(npm .cmd 설치 대비).
/// bypassPermissions는 어떤 경로로도 만들지 않는다.
pub fn claude_builders(
    args: &[String],
    cwd: &str,
    app_session: &str,
    role_file: Option<&str>,
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
        // `eqmux` CLI(PRD I)가 PATH에서 잡히도록 앱 실행 파일 폴더를 앞에 붙인다 —
        // 훅 커맨드·에이전트의 send/report가 절대 경로 없이 성립한다
        if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
            let path = std::env::var("PATH").unwrap_or_default();
            b.env("PATH", format!("{};{}", dir.display(), path));
        }
        if let Some(rf) = role_file {
            b.env("EQMUX_ROLE_FILE", rf);
        }
        if let Some(tf) = &team_md {
            b.env("EQMUX_TEAM_FILE", tf);
        }
    };
    let mut direct = CommandBuilder::new("claude");
    for a in args {
        direct.arg(a);
    }
    apply(&mut direct);
    let mut via_cmd = CommandBuilder::new("cmd.exe");
    via_cmd.arg("/c");
    via_cmd.arg("claude");
    for a in args {
        via_cmd.arg(a);
    }
    apply(&mut via_cmd);
    vec![direct, via_cmd]
}

/// 상태 방송 + 상태 전이 이벤트 기록 (FR-D-17) + OS 알림 (FR-G-30)
pub fn emit_state(app: &AppHandle, evt: &AgentStateEvt) {
    let _ = app.emit("agent-state", evt.clone());
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

/// OS 알림 — `waiting`·`dead` 진입 2종에만 (G3 · FR-G-30). 상태 diff는 호출부(scan·EOF)가
/// 이미 보장하므로 여기 도달한 waiting/dead는 전부 "진입"이다.
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
    match crate::setting_str(app, "notifications").as_deref() {
        Some("off") => return,
        Some("waiting") if evt.status == "dead" => return,
        _ => {} // 기본값 waiting-dead
    }
    // 음소거 (FR-G-35) — 세션·워크스페이스 단위. 역시 인앱 미확인은 유지된다
    let settings_state: tauri::State<crate::SettingsState> = app.state();
    let muted = settings_state
        .0
        .lock()
        .map(|v| {
            let ws = evt.session.split('@').nth(1).unwrap_or("");
            v.get("muted")
                .and_then(|m| m.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|x| x.as_str())
                        .any(|m| m == evt.session || m == ws)
                })
                .unwrap_or(false)
        })
        .unwrap_or(false);
    if muted {
        return;
    }
    // 창이 포커스를 갖고 있으면 내지 않는다 (FR-G-31) — 인앱 표현으로 충분하다
    let focused = app
        .webview_windows()
        .values()
        .any(|w| w.is_focused().unwrap_or(false));
    if focused {
        return;
    }
    // 같은 세션의 반복 전이 합침 (FR-G-32) — 최소 간격 안에서는 개수만 센다
    let suppressed = {
        let Ok(mut gates) = rt.notify_gate.lock() else { return };
        let now = crate::workspace::now_ms();
        let gate = gates
            .entry(evt.session.clone())
            .or_insert(NotifyGate { last_ms: 0, suppressed: 0 });
        if now - gate.last_ms < NOTIFY_MIN_INTERVAL_MS {
            gate.suppressed += 1;
            return;
        }
        let n = gate.suppressed;
        gate.last_ms = now;
        gate.suppressed = 0;
        n
    };
    let name = evt.session.split('@').next().unwrap_or(&evt.session);
    let title = if evt.status == "waiting" {
        format!("{name} · 승인 대기")
    } else {
        format!("{name} · 종료됨")
    };
    let mut body = if evt.status == "waiting" {
        evt.waiting_for.clone().unwrap_or_else(|| "사람의 응답이 필요합니다".into())
    } else {
        match evt.exit_code {
            Some(c) => format!("exit {c} · 재개 {}", if evt.resumable { "가능" } else { "불가" }),
            None => "프로세스가 종료되었습니다".into(),
        }
    };
    if suppressed > 0 {
        body.push_str(&format!(" (그 사이 전이 {suppressed}건 합침)"));
    }
    let _ = app.notification().builder().title(title).body(body).show();
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

/// 훅 이벤트의 효과 — 상태 전이 3종 외에 2차 소스가 채우는 것 (FR-D-15·18):
/// activity(도구명)와 subagents(동시 실행 수). 상태를 바꾸지 않는 이벤트가 상태를
/// 건드리지 않도록 효과를 분리해 둔다 (순수 함수 — 테스트 대상).
pub enum HookEffect {
    Status(&'static str),
    Activity(Option<String>),
    SubagentDelta(i64),
    Ignore,
}

pub fn hook_effect(event: &str, payload: &serde_json::Value) -> HookEffect {
    match event {
        "PreToolUse" => HookEffect::Activity(
            payload.get("tool_name").and_then(|v| v.as_str()).map(str::to_string),
        ),
        "PostToolUse" => HookEffect::Activity(None),
        "SubagentStart" => HookEffect::SubagentDelta(1),
        "SubagentStop" => HookEffect::SubagentDelta(-1),
        e => match hook_status(e) {
            Some(s) => HookEffect::Status(s),
            None => HookEffect::Ignore,
        },
    }
}

/// 훅 2차 소스 — 레지스트리 스캔(1차)과 같은 diff 경로로 emit_state 한 곳에 합류한다.
/// 레지스트리보다 빠르게 도착하므로 waiting 알림·인박스 전달의 지연이 줄어든다.
pub fn apply_hook(app: &AppHandle, session: &str, event: &str, payload: &serde_json::Value) {
    let effect = hook_effect(event, payload);
    if matches!(effect, HookEffect::Ignore) {
        return;
    }
    // 상태 전이만 이벤트 테이블·알림까지 간다 (FR-D-17) — activity·subagents 변경은
    // 도구 호출마다 일어나므로 방송만 하고 기록하지 않는다 (피드는 전이의 기록이다)
    let mut quiet = !matches!(effect, HookEffect::Status(_));
    let rt: tauri::State<AgentRt> = app.state();
    let mut evt = None;
    if let Ok(mut map) = rt.by_uuid.lock() {
        for (uuid, t) in map.iter_mut() {
            if t.app_session != session || t.last_status == "dead" {
                continue;
            }
            match &effect {
                HookEffect::Status(status) => {
                    let waiting = (*status == "waiting")
                        .then(|| payload.get("message").and_then(|m| m.as_str()).map(str::to_string))
                        .flatten();
                    if t.last_status == *status && t.last_waiting == waiting {
                        break; // 변화 없음 — 방송하지 않는다
                    }
                    t.last_status = (*status).into();
                    t.last_waiting = waiting;
                    t.hook_ms = crate::workspace::now_ms() as i64; // P-3 — 훅이 더 신선하다는 표식
                    if *status == "idle" {
                        // 턴 종료 — 도구·서브에이전트 부연도 함께 접는다 (FR-D-15)
                        t.activity = None;
                        t.subagents = 0;
                    }
                }
                HookEffect::Activity(tool) => {
                    // 도구 실행 시작 = 승인 완료 — waiting에 고착돼 있으면 busy로 되돌린다.
                    // degraded(레지스트리 없음) 모드에선 이 전이가 없으면 다음 Stop까지 "승인 대기"로 남는다
                    let unstick = t.last_status == "waiting";
                    if t.activity == *tool && !unstick {
                        break;
                    }
                    t.activity = tool.clone();
                    if unstick {
                        t.last_status = "busy".into();
                        t.last_waiting = None;
                        t.hook_ms = crate::workspace::now_ms() as i64; // P-3 — 이 전이도 훅 소스다
                        quiet = false; // 상태 전이이므로 피드·알림 경로로 보낸다
                    }
                }
                HookEffect::SubagentDelta(d) => {
                    let next = (t.subagents + d).max(0);
                    if t.subagents == next {
                        break;
                    }
                    t.subagents = next;
                }
                HookEffect::Ignore => break,
            }
            t.seq = next_seq();
            evt = Some(AgentStateEvt {
                session: session.to_string(),
                agent_session: uuid.clone(),
                status: t.last_status.clone(),
                waiting_for: t.last_waiting.clone(),
                activity: t.activity.clone(),
                subagents: t.subagents,
                cost_usd: t.cost_usd,
                resumable: resumable(&t.cwd, uuid),
                version: None,
                exit_code: None,
                degraded: t.degraded,
                seq: t.seq,
            });
            break;
        }
    }
    if let Some(e) = evt {
        if quiet {
            let _ = app.emit("agent-state", e);
        } else {
            emit_state(app, &e);
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
        for (uuid, t) in map.iter_mut() {
            if t.app_session != session || t.last_status == "dead" {
                continue;
            }
            let changed = match t.cost_usd {
                Some(prev) => (cost - prev).abs() >= 0.01,
                None => true,
            };
            if !changed {
                break;
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
                resumable: resumable(&t.cwd, uuid),
                version: None,
                exit_code: None,
                degraded: t.degraded,
                seq: t.seq,
            });
            break;
        }
    }
    if let Some(e) = evt {
        let _ = app.emit("agent-state", e);
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
                    resumable: resumable(&t.cwd, uuid),
                    version: None,
                    exit_code: code.map(i64::from),
                    degraded: t.degraded,
                    seq: t.seq,
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

/// 레지스트리 스캔 — sessionId 일치(FR-D-12)로만 우리 세션을 판별한다
fn scan(app: &AppHandle) {
    let rt: tauri::State<AgentRt> = app.state();
    let tracked_uuids: Vec<String> = match rt.by_uuid.lock() {
        Ok(m) => m.keys().cloned().collect(),
        Err(_) => return,
    };
    if tracked_uuids.is_empty() {
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
                resumable: resumable(&t.cwd, uuid),
                version: None,
                exit_code: None,
                degraded: t.degraded,
                seq: t.seq,
            });
        }
    }
    for evt in &flips {
        // 상태 전이가 아니므로 알림 없이 방송만 — 대신 전환 자체는 피드에 기록한다 (FR-D-65)
        let _ = app.emit("agent-state", evt.clone());
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
    let mut found: HashMap<String, (RegistryRecord, i64)> = HashMap::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().map(|e| e == "json").unwrap_or(false) {
            if let Ok(text) = fs::read_to_string(&p) {
                if let Ok(rec) = serde_json::from_str::<RegistryRecord>(&text) {
                    if let Some(sid) = rec.session_id.clone() {
                        // 파일 mtime = 이 레지스트리 상태의 신선도 (P-3) — 훅 도착 시각과 비교한다
                        let mtime_ms = fs::metadata(&p)
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0);
                        found.insert(sid, (rec, mtime_ms));
                    }
                }
            }
        }
    }
    let mut updates: Vec<AgentStateEvt> = Vec::new();
    if let Ok(mut map) = rt.by_uuid.lock() {
        for uuid in tracked_uuids {
            let Some(t) = map.get_mut(&uuid) else { continue };
            if t.last_status == "dead" {
                continue;
            }
            if let Some((rec, mtime_ms)) = found.get(&uuid) {
                // 스테일 가드 (P-3) — 훅이 이 파일보다 나중에 상태를 바꿨다면 재스캔이 되돌리지
                // 않는다. 방치하면 2초 주기 재스캔이 가짜 idle을 만들어 M3 인박스를 오주입한다.
                if *mtime_ms <= t.hook_ms {
                    continue;
                }
                // status 부재 시 기존 값 유지 (FR-D-64 — 훅 폴백은 다음 단계)
                let status = rec.status.clone().unwrap_or_else(|| t.last_status.clone());
                let waiting = rec.waiting_for.clone();
                if status != t.last_status || waiting != t.last_waiting {
                    t.last_status = status.clone();
                    t.last_waiting = waiting.clone();
                    if status == "idle" {
                        t.activity = None; // 턴 종료 부연 정리 — 훅 경로(apply_hook)와 같은 규칙
                        t.subagents = 0;
                    }
                    t.seq = next_seq();
                    updates.push(AgentStateEvt {
                        session: t.app_session.clone(),
                        agent_session: uuid.clone(),
                        status,
                        waiting_for: waiting,
                        activity: t.activity.clone(),
                        subagents: t.subagents,
                        cost_usd: t.cost_usd,
                        resumable: resumable(&t.cwd, &uuid),
                        version: rec.version.clone(),
                        exit_code: None,
                        degraded: t.degraded,
                        seq: t.seq,
                    });
                }
            }
        }
    }
    for evt in updates {
        emit_state(app, &evt);
    }
}

#[cfg(test)]
mod tests {
    use super::HookEffect;

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

    #[test]
    fn hook_events_map_to_states() {
        assert_eq!(super::hook_status("Stop"), Some("idle"));
        assert_eq!(super::hook_status("UserPromptSubmit"), Some("busy"));
        assert_eq!(super::hook_status("Notification"), Some("waiting"));
        assert_eq!(super::hook_status("SubagentStop"), None); // 본체는 아직 busy
        assert_eq!(super::hook_status("PreToolUse"), None);
    }

    /// 훅 2차 소스의 효과 분리 (FR-D-15·18) — 상태를 바꾸지 않는 이벤트는 부연만 채운다
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
}
