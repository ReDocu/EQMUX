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
    pub resumable: bool,
    pub version: Option<String>,
    pub exit_code: Option<i64>,
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

/// 트랜스크립트 경로 (§10.3) — cwd의 ':' '\' '/'를 '-'로 치환. cwd가 경로에 들어가므로
/// 재개는 같은 cwd에서만 성립한다 (FR-D-03 · R4).
pub fn transcript_path(cwd: &str, uuid: &str) -> PathBuf {
    let escaped: String = cwd
        .chars()
        .map(|c| if matches!(c, ':' | '\\' | '/') { '-' } else { c })
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
) -> Vec<CommandBuilder> {
    let team_md = std::path::Path::new(cwd).join(".eqmux").join("team.md");
    let team_md = team_md.exists().then(|| team_md.to_string_lossy().into_owned());
    let apply = |b: &mut CommandBuilder| {
        b.cwd(cwd);
        // FR-D-04 환경변수 — 역할·팀 파일은 존재할 때만 (파일이 원본, FR-E-41)
        b.env("EQMUX_SESSION", app_session);
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
    // 설정 라우팅 (PRD J · FR-G-30) — 꺼도 인앱 미확인 표시는 계속 동작한다 (FR-G-37)
    match crate::setting_str(app, "notifications").as_deref() {
        Some("off") => return,
        Some("waiting") if evt.status == "dead" => return,
        _ => {} // 기본값 waiting-dead
    }
    let rt: tauri::State<AgentRt> = app.state();
    // 사용자가 의도한 종료(중지·제거)는 dead 알림 대상이 아니다
    if evt.status == "dead" {
        if let Ok(mut expected) = rt.expected_exit.lock() {
            if expected.remove(&evt.session) {
                return;
            }
        }
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
    let quiet = !matches!(effect, HookEffect::Status(_));
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
                    if *status == "idle" {
                        // 턴 종료 — 도구·서브에이전트 부연도 함께 접는다 (FR-D-15)
                        t.activity = None;
                        t.subagents = 0;
                    }
                }
                HookEffect::Activity(tool) => {
                    if t.activity == *tool {
                        break;
                    }
                    t.activity = tool.clone();
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
            evt = Some(AgentStateEvt {
                session: session.to_string(),
                agent_session: uuid.clone(),
                status: t.last_status.clone(),
                waiting_for: t.last_waiting.clone(),
                activity: t.activity.clone(),
                subagents: t.subagents,
                resumable: resumable(&t.cwd, uuid),
                version: None,
                exit_code: None,
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
                evt = Some(AgentStateEvt {
                    session: id.to_string(),
                    agent_session: uuid.clone(),
                    status: "dead".into(),
                    waiting_for: None,
                    activity: None,
                    subagents: 0,
                    resumable: resumable(&t.cwd, uuid),
                    version: None,
                    exit_code: code.map(i64::from),
                });
                break;
            }
        }
    }
    if let Some(e) = evt {
        emit_state(app, &e);
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
    let entries = match fs::read_dir(sessions_dir()) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut found: HashMap<String, RegistryRecord> = HashMap::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().map(|e| e == "json").unwrap_or(false) {
            if let Ok(text) = fs::read_to_string(&p) {
                if let Ok(rec) = serde_json::from_str::<RegistryRecord>(&text) {
                    if let Some(sid) = rec.session_id.clone() {
                        found.insert(sid, rec);
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
            if let Some(rec) = found.get(&uuid) {
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
                    updates.push(AgentStateEvt {
                        session: t.app_session.clone(),
                        agent_session: uuid.clone(),
                        status,
                        waiting_for: waiting,
                        activity: t.activity.clone(),
                        subagents: t.subagents,
                        resumable: resumable(&t.cwd, &uuid),
                        version: rec.version.clone(),
                        exit_code: None,
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
