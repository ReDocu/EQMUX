// 화면 손상 진단 계측 — "오래 켜놓으면 화면이 깨지고 창 크기를 바꾸면 돌아온다"를 잡기 위한 것.
//
// 두 후보를 가른다:
//   1) 자식 웹뷰(브라우저 패널)가 낡은 좌표에 앉아 메인 UI를 덮는다. 프런트는 논리 픽셀로
//      좌표를 보내고 ResizeObserver가 울릴 때만 다시 보내므로, 배율이 다른 모니터로 창을
//      옮기면 CSS 크기는 그대로라 아무도 그 순간을 모른다. 리사이즈가 고치는 이유도 이것이다.
//   2) 컴포지터 타일이 낡은 채로 남는다 — 위와 증상이 같지만 좌표는 안 어긋난다.
//
// 그래서 여기서는 판정하지 않고 "그 순간의 숫자"만 남긴다. 자동 보정도 하지 않는다 —
// 원인을 모르는 채로 보정을 넣으면 증상만 가려 원인을 영영 못 찾는다.
//
// 로그: %USERPROFILE%\.eqmux\logs\diagnostics.log (로그 패널의 "로그 폴더 열기"로 접근)
use std::io::Write as _;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 진단 로그 상한 — 넘으면 새로 시작한다. 진단이 디스크를 먹는 일이 없어야 한다
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// 브라우저 패널 자식 웹뷰 라벨 (browser.rs와 같은 값 — 여기서는 읽기만 한다)
const BROWSER_LABEL: &str = "panel-browser";

fn stamp() -> String {
    // 로컬 시각을 쓸 수 있으면 좋겠지만 크레이트를 늘리지 않는다 — epoch ms면 정렬·상관에 충분하다
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let secs = (ms / 1000) as u64;
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{ms} {:02}:{:02}:{:02}Z", h, m, s)
}

/// 한 줄 append. 실패는 삼킨다 — 진단이 앱을 방해하면 안 된다
pub fn write(line: &str) {
    let dir = crate::log_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("diagnostics.log");
    if std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {line}", stamp());
    }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// 그 순간의 창·모니터·자식 웹뷰 기하. 좌표는 전부 물리 픽셀이다 —
/// 프런트가 보낸 논리 좌표와 비교하려면 scale_factor로 나눠야 한다.
/// 어느 쪽이 기준인지(창 상대 / 화면 절대)를 추측하지 않고 원본 숫자를 그대로 남긴다.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub scale_factor: f64,
    pub window_outer: Rect,
    pub window_inner: Rect,
    pub monitor_name: Option<String>,
    pub monitor_scale: Option<f64>,
    pub monitor: Rect,
    /// 브라우저 패널 자식 웹뷰 — 없으면 None (패널을 안 열었거나 닫았다)
    pub browser: Option<Rect>,
}

/// 지금의 기하를 잰다. 창이 없으면 오류 — 호출부가 조용히 넘긴다
#[tauri::command]
pub fn diag_geometry(app: AppHandle) -> Result<Geometry, String> {
    let win = app.get_window("main").ok_or("메인 창 없음")?;
    let sf = win.scale_factor().unwrap_or(1.0);
    let mut g = Geometry { scale_factor: sf, ..Default::default() };

    if let (Ok(p), Ok(s)) = (win.outer_position(), win.outer_size()) {
        g.window_outer = Rect { x: p.x, y: p.y, w: s.width, h: s.height };
    }
    if let (Ok(p), Ok(s)) = (win.inner_position(), win.inner_size()) {
        g.window_inner = Rect { x: p.x, y: p.y, w: s.width, h: s.height };
    }
    if let Ok(Some(m)) = win.current_monitor() {
        g.monitor_name = m.name().cloned();
        g.monitor_scale = Some(m.scale_factor());
        let (p, s) = (m.position(), m.size());
        g.monitor = Rect { x: p.x, y: p.y, w: s.width, h: s.height };
    }
    if let Some(wv) = app.get_webview(BROWSER_LABEL) {
        if let (Ok(p), Ok(s)) = (wv.position(), wv.size()) {
            g.browser = Some(Rect { x: p.x, y: p.y, w: s.width, h: s.height });
        }
    }
    Ok(g)
}

/// 프런트가 남기는 한 줄 (드리프트 판정·사용자 표식·WebGL 컨텍스트 유실 등)
#[tauri::command]
pub fn diag_note(text: String) {
    write(&text);
}

// ── 창 이벤트 ────────────────────────────────────────────────────────────
// Moved는 드래그 중 계속 온다 — 그대로 적으면 로그가 그것만으로 찬다.
// 배율·모니터가 실제로 바뀐 순간만 남기고, 나머지는 500ms에 한 줄로 죈다.

struct Last {
    at_ms: u128,
    scale: f64,
    monitor: String,
}

static LAST: Mutex<Option<Last>> = Mutex::new(None);

/// 창 이벤트 한 건 기록. 의미 있는 변화(배율·모니터)면 항상, 아니면 죄어서 남긴다.
/// 반환값 = 프런트에도 알릴 만한 변화인가 (프런트가 같은 순간 자기 좌표를 남기도록)
pub fn note_window_event(app: &AppHandle, kind: &str) -> bool {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    // 죄는 구간(500ms) 안이면 배율·모니터만 싸게 확인하고 끝낸다 (CPU·RAM C10) — 드래그 중 초당
    // 60~120회 메인 스레드에서 위치·크기·모니터·웹뷰를 다 읽던 자리다. 시각은 지금처럼 매번 갱신한다
    if let Some(win) = app.get_window("main") {
        let mut guard = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(l) = guard.as_mut() {
            if now.saturating_sub(l.at_ms) < 500 {
                let sf = win.scale_factor().unwrap_or(1.0);
                let mon = win.current_monitor().ok().flatten().and_then(|m| m.name().cloned()).unwrap_or_default();
                if (l.scale - sf).abs() <= f64::EPSILON && l.monitor == mon {
                    l.at_ms = now;
                    return false;
                }
            }
        }
    }
    let Ok(g) = diag_geometry(app.clone()) else { return false };
    let monitor = g.monitor_name.clone().unwrap_or_default();

    let mut guard = LAST.lock().unwrap_or_else(|e| e.into_inner());
    let changed = match guard.as_ref() {
        // 배율이나 모니터가 바뀌었다 — 후보 1이 성립하는 바로 그 순간이다
        Some(l) => (l.scale - g.scale_factor).abs() > f64::EPSILON || l.monitor != monitor,
        None => true,
    };
    let throttled = guard.as_ref().map(|l| now.saturating_sub(l.at_ms) < 500).unwrap_or(false);
    *guard = Some(Last { at_ms: now, scale: g.scale_factor, monitor: monitor.clone() });
    drop(guard);

    if !changed && throttled {
        return false;
    }
    let tag = if changed { "GEOMETRY-CHANGED" } else { "window" };
    write(&format!(
        "{tag} {kind} sf={} monitor={:?} monScale={:?} inner={},{} {}x{} browser={:?}",
        g.scale_factor,
        monitor,
        g.monitor_scale,
        g.window_inner.x,
        g.window_inner.y,
        g.window_inner.w,
        g.window_inner.h,
        g.browser.as_ref().map(|b| (b.x, b.y, b.w, b.h)),
    ));
    changed
}

// ── 웹뷰 생사 (BR-18) ────────────────────────────────────────────────────
// 프런트가 10초마다 살아 있다고 알린다. 끊기면 그 사실을 진단 로그에 남긴다 — 웹뷰가 죽거나
// 굳어도 Rust 쪽에는 흔적이 없던 자리다. 숨은 창은 WebView2가 타이머를 분당 1회까지 죄므로
// 따로 넉넉한 한도를 둔다 (오탐 방지). 판정만 하고 복구는 하지 않는다 (위 원칙과 같다).

const ALIVE_LIMIT_MS: u128 = 30_000;
const ALIVE_LIMIT_HIDDEN_MS: u128 = 180_000;

struct Beat {
    at_ms: u128,
    hidden: bool,
    silent: bool,
}

static BEAT: Mutex<Option<Beat>> = Mutex::new(None);

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// 이 박동 뒤로 now까지 소식이 없으면 끊긴 것인가
fn overdue(b: &Beat, now: u128) -> bool {
    let limit = if b.hidden { ALIVE_LIMIT_HIDDEN_MS } else { ALIVE_LIMIT_MS };
    now.saturating_sub(b.at_ms) > limit
}

/// 프런트 하트비트 — 끊겼다 돌아온 것이면 그 길이를 남긴다
#[tauri::command]
pub fn diag_alive(hidden: bool) {
    let now = now_ms();
    let mut guard = BEAT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(b) = guard.as_ref().filter(|b| b.silent) {
        write(&format!("WEBVIEW-BACK silent {}ms hidden={hidden}", now.saturating_sub(b.at_ms)));
    }
    *guard = Some(Beat { at_ms: now, hidden, silent: false });
}

/// 웹뷰가 지금 끊긴 상태인가 — 종료 요청을 프런트에 물어도 답할 수 없을 때 (quit.rs, B112).
/// 첫 박동 전(로딩 중)은 끊김이 아니다
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn webview_silent() -> bool {
    BEAT.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|b| b.silent)
}

/// 감시 스레드 — 첫 박동 전에는 판정하지 않는다 (앱 시작·로딩 중은 끊김이 아니다)
pub fn start_alive_watch() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let mut guard = BEAT.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(b) = guard.as_mut().filter(|b| !b.silent) {
            let now = now_ms();
            if overdue(b, now) {
                b.silent = true;
                write(&format!(
                    "WEBVIEW-SILENT no heartbeat for {}ms hidden={}",
                    now.saturating_sub(b.at_ms),
                    b.hidden
                ));
            }
        }
    });
}

// ── 다른 도구의 전역 지시 점검 (§14 · 계약 C3) ─────────────────────────────
// 다른 멀티플렉서·에이전트 도구가 엔진 전역 설정에 써 넣은 흔적을 찾는다. **읽기만** 한다 —
// 고치거나 구역을 지우지 않는다(자동 관리 구역은 그 도구가 다시 써 넣는다, §9-2 원칙).
// 실제 사례: ~/.claude/CLAUDE.md의 wmux 구역, ~/.codex/hooks.json의 orca 훅 9개.

/// 찾은 흔적 한 종류 — (도구, 파일, 종류)별로 센다. file은 절대 경로(화면의 [파일 열기]가 그대로 쓴다)
#[derive(Serialize, Debug, PartialEq)]
pub struct Foreign {
    pub tool: String,
    pub file: String,
    /// "block" 자동 관리 구역 · "hook" 도구 호출마다 도는 훅 · "sentence" "You are running inside …"
    pub kind: &'static str,
    pub count: u32,
}

fn push_foreign(out: &mut Vec<Foreign>, tool: &str, file: &str, kind: &'static str) {
    if tool.is_empty() || tool == "eqmux" {
        return;
    }
    match out.iter_mut().find(|f| f.tool == tool && f.file == file && f.kind == kind) {
        Some(f) => f.count += 1,
        None => out.push(Foreign { tool: tool.into(), file: file.into(), kind, count: 1 }),
    }
}

/// 이름 한 낱말 — 영숫자·`-`·`_`만, 소문자로
fn word(s: &str) -> String {
    s.trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>()
        .to_ascii_lowercase()
}

/// 지시 문서(CLAUDE.md · AGENTS.md · config.toml) — `<!-- 도구:start` 구역 표식과 "You are running inside 도구"
fn scan_text(file: &str, text: &str, out: &mut Vec<Foreign>) {
    for line in text.lines() {
        if let Some((name, _)) = line.split_once("<!--").and_then(|(_, r)| r.split_once(":start")) {
            if !name.trim().contains(' ') {
                push_foreign(out, &word(name), file, "block");
            }
        }
        let low = line.to_ascii_lowercase();
        if let Some((_, rest)) = low.split_once("you are running inside") {
            push_foreign(out, &word(rest.trim_start_matches([' ', '`', '"', '\''])), file, "sentence");
        }
    }
}

/// 훅 명령 → 도구 이름 (휴리스틱). 홈 아래 점 폴더(`~/.orca/…`)가 있으면 그 이름,
/// 없으면 경로가 든 첫 낱말의 파일 이름 앞부분(`…/wmux-hook.js` → wmux).
/// ponytail: 이름 추측이다 — 틀리면 화면에 이상한 이름이 뜰 뿐 개수는 맞다
fn tool_of(cmd: &str) -> String {
    let c = cmd.replace('\\', "/");
    let tokens = c.split(|ch: char| ch.is_whitespace() || ch == '"' || ch == '\'');
    for seg in c.split(|ch: char| ch == '/' || ch.is_whitespace() || ch == '"') {
        if let Some(n) = seg.strip_prefix('.') {
            let n = word(n);
            if n.len() > 1 && !["claude", "codex", "local", "config", "cache", "npm", "bin", "cargo"].contains(&n.as_str()) {
                return n;
            }
        }
    }
    tokens
        .filter(|t| t.contains('/'))
        .find_map(|t| t.rsplit('/').next().and_then(|f| f.split(['-', '.', '_']).next()).map(word))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| word(&c))
}

/// 훅 설정(Claude settings.json · Codex hooks.json) — 우리 것(eqmux)을 뺀 명령 훅을 도구별로 센다
fn scan_hooks(file: &str, v: &serde_json::Value, out: &mut Vec<Foreign>) {
    let Some(events) = v.get("hooks").and_then(|h| h.as_object()) else { return };
    let cmds = events
        .values()
        .filter_map(|g| g.as_array())
        .flatten()
        .filter_map(|g| g.get("hooks")?.as_array())
        .flatten()
        .filter_map(|h| h.get("command")?.as_str());
    for cmd in cmds.filter(|c| !c.contains("eqmux")) {
        push_foreign(out, &tool_of(cmd), file, "hook");
    }
}

/// 홈 아래 다섯 파일을 읽어 흔적을 모은다 — 없는 파일·깨진 JSON은 조용히 건너뛴다
pub fn foreign_in(home: &std::path::Path) -> Vec<Foreign> {
    let mut out = Vec::new();
    for (rel, json) in [
        (".claude/CLAUDE.md", false),
        (".claude/settings.json", true),
        (".codex/AGENTS.md", false),
        (".codex/config.toml", false),
        (".codex/hooks.json", true),
    ] {
        let path = home.join(rel);
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let file = path.to_string_lossy();
        if json {
            if let Ok(v) = serde_json::from_str(text.trim_start_matches('\u{feff}')) {
                scan_hooks(&file, &v, &mut out);
            }
        } else {
            scan_text(&file, &text, &mut out);
        }
    }
    out
}

/// 기동 때와 [진단]에서 프런트가 부른다 (C3)
#[tauri::command]
pub fn diag_foreign_tools() -> Vec<Foreign> {
    foreign_in(&crate::home_dir())
}

// ── 진단 정보 복사 (§9-3 · 계약 C3) ─────────────────────────────────────────
// 사용자가 이슈에 붙이는 한 덩어리. 앱은 네트워크로 보내지 않는다 — 문자열을 돌려줄 뿐이다.
// 경로의 사용자 이름과 토큰처럼 보이는 것은 가린 뒤에 내보낸다.

/// 로그 꼬리 줄 수
const BUNDLE_LOG_LINES: usize = 200;

/// 짧은 명령 한 번의 첫 줄. 5초 안에 안 끝나면 포기한다(그 프로세스는 스스로 끝날 때까지 둔다)
fn first_line_of(program: &str, args: &[&str]) -> Option<String> {
    first_line(program, args).ok()
}

/// first_line_of + 못 읽은 이유 — "timeout"(5초 시한) | "not found"(없거나 실패). 진단 정보가 둘을 가른다 (B197)
fn first_line(program: &str, args: &[&str]) -> Result<String, &'static str> {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        // npm 래퍼(codex.cmd)도 잡히게 cmd를 거친다
        let mut c = std::process::Command::new("cmd.exe");
        c.arg("/c").arg(program).args(args).creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new(program);
        c.args(args);
        c
    };
    cmd.stdin(std::process::Stdio::null());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(cmd.output());
    });
    let out = rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "timeout")?.map_err(|_| "not found")?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string).filter(|_| out.status.success()).ok_or("not found")
}

/// 엔진 CLI 버전 줄 (`claude --version` 첫 줄) — 읽으면 앱이 떠 있는 동안 기억한다.
/// 진단 묶음과 스폰 때 버전 검사(agent::check_cli_version)가 같이 쓴다. 못 읽으면 다음에 다시 잰다
pub fn cli_version(cli: &str) -> Option<String> {
    cli_version_or(cli).ok()
}

/// cli_version + 못 읽은 이유("timeout" | "not found")
fn cli_version_or(cli: &str) -> Result<String, &'static str> {
    static CACHE: Mutex<Option<std::collections::HashMap<String, Option<String>>>> = Mutex::new(None);
    if let Some(v) = CACHE.lock().map_err(|_| "not found")?.get_or_insert_with(Default::default).get(cli) {
        return v.clone().ok_or("not found");
    }
    let v = first_line(cli, &["--version"])?; // 잠금 밖에서 — 최대 5초
    // 읽은 것만 기억한다 — 한 번의 시한 초과(npm 래퍼 첫 기동)가 앱 수명 내내 버전 검사를 끄지 않게
    if let Ok(mut c) = CACHE.lock() {
        c.get_or_insert_with(Default::default).insert(cli.to_string(), Some(v.clone()));
    }
    Ok(v)
}

/// ASCII 대소문자를 무시하고 바꾼다 — Windows 경로는 철자가 섞여 온다
fn replace_ci(hay: &str, needle: &str, with: &str) -> String {
    if needle.is_empty() {
        return hay.to_string();
    }
    let (low, nl) = (hay.to_ascii_lowercase(), needle.to_ascii_lowercase());
    let mut out = String::with_capacity(hay.len());
    let mut last = 0;
    for (i, _) in low.match_indices(&nl) {
        out.push_str(&hay[last..i]);
        out.push_str(with);
        last = i + nl.len();
    }
    out.push_str(&hay[last..]);
    out
}

/// 토큰처럼 보이는 낱말인가 — 알려진 접두어, 또는 32자 넘는 영숫자 덩어리(글자·숫자 섞임).
/// UUID(세션 id)는 비밀이 아니고 디버깅에 필요해서 남긴다
fn secret_like(w: &str) -> bool {
    const PREFIXES: [&str; 9] = ["sk-", "ghp_", "gho_", "ghs_", "github_pat_", "xoxb-", "xoxp-", "AKIA", "eyJ"];
    if PREFIXES.iter().any(|p| w.starts_with(p) && w.len() >= p.len() + 8) {
        return true;
    }
    let uuid = w.len() == 36 && w.split('-').map(str::len).eq([8, 4, 4, 4, 12]);
    w.len() >= 32
        && !uuid
        && w.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && w.chars().any(|c| c.is_ascii_digit())
        && w.chars().any(|c| c.is_ascii_alphabetic())
}

/// 가리기 — 홈 경로 → `~`, 경로 속 사용자 이름 → `<user>`, 토큰 → `<secret>`.
/// 키 이름(token·secret·password·authorization·bearer…) 바로 뒤의 값도 가린다
pub fn mask(text: &str, home: &str, user: &str) -> String {
    let mut s = text.to_string();
    if !home.is_empty() {
        s = replace_ci(&s, home, "~");
        s = replace_ci(&s, &home.replace('\\', "/"), "~");
    }
    if user.len() >= 2 {
        for sep in ['\\', '/'] {
            s = replace_ci(&s, &format!("{sep}{user}{sep}"), &format!("{sep}<user>{sep}"));
        }
    }
    const KEYS: [&str; 7] = ["token", "secret", "password", "passwd", "api_key", "apikey", "authorization"];
    let mut out = String::with_capacity(s.len());
    let mut after_key = false;
    let is_word = |c: char| c.is_ascii_alphanumeric() || "_-.+/".contains(c);
    let mut rest = s.as_str();
    while !rest.is_empty() {
        let n = rest.find(|c: char| !is_word(c)).unwrap_or(rest.len());
        let (w, tail) = rest.split_at(n);
        if !w.is_empty() {
            let low = w.to_ascii_lowercase();
            if low == "bearer" {
                out.push_str(w); // `Authorization: Bearer <값>` — 가릴 것은 그다음 낱말이다
                after_key = true;
            } else if after_key || secret_like(w) {
                out.push_str("<secret>");
                after_key = false;
            } else {
                out.push_str(w);
                // 키 뒤에 `=`·`:`가 올 때만 값으로 본다 — "BAD_TOKEN 오류" 같은 문장은 그대로 둔다
                let assigns = tail.trim_start_matches([' ', '"', '\'']).starts_with([':', '=']);
                after_key = assigns && KEYS.iter().any(|k| low.ends_with(k));
            }
        }
        // 구분자 한 글자 — 줄이 바뀌면 키 대기를 끊는다
        let mut chars = tail.chars();
        match chars.next() {
            Some(c) => {
                if c == '\n' {
                    after_key = false;
                }
                out.push(c);
                rest = chars.as_str();
            }
            None => rest = "",
        }
    }
    out
}

fn bundle_text() -> String {
    // 세 확인을 함께 돌린다 — 차례로 돌면 하나마다 5초 시한이라 최악 15초였다 (B197)
    let (os_ver, claude, codex) = std::thread::scope(|sc| {
        let os = sc.spawn(|| if cfg!(windows) { first_line_of("ver", &[]) } else { first_line_of("sw_vers", &["-productVersion"]) });
        let cl = sc.spawn(|| cli_version_or("claude"));
        let cx = sc.spawn(|| cli_version_or("codex"));
        (os.join().ok().flatten(), cl.join().unwrap_or(Err("not found")), cx.join().unwrap_or(Err("not found")))
    });
    let mut s = format!(
        "EQMUX {}\nOS: {} {} {}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        os_ver.unwrap_or_default()
    );
    for (cli, v) in [("claude", claude), ("codex", codex)] {
        s.push_str(&format!("{cli}: {}\n", v.unwrap_or_else(|e| e.to_string())));
    }
    let foreign = foreign_in(&crate::home_dir());
    if !foreign.is_empty() {
        let list: Vec<String> = foreign.iter().map(|f| format!("{} {} ×{}", f.tool, f.kind, f.count)).collect();
        s.push_str(&format!("Other tools in global config: {}\n", list.join(" · ")));
    }
    let log = std::fs::read_to_string(crate::log_dir().join("diagnostics.log")).unwrap_or_default();
    let lines: Vec<&str> = log.lines().collect();
    s.push_str(&format!("\n--- diagnostics.log (last {BUNDLE_LOG_LINES} lines) ---\n"));
    s.push_str(&lines[lines.len().saturating_sub(BUNDLE_LOG_LINES)..].join("\n"));
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    mask(&s, &crate::home_dir().to_string_lossy(), &user)
}

/// [진단 정보 복사] (C3) — 가린 뒤의 문자열. 엔진 CLI를 띄우므로 메인 스레드를 막지 않게 async
#[tauri::command]
pub async fn diag_bundle() -> String {
    bundle_text()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// §14 — 이 PC에서 실제로 본 두 모양(wmux 구역·문장, orca·wmux 훅)을 찾고, 우리 것과 빈 파일은 조용하다
    #[test]
    fn foreign_tools_found_in_samples() {
        let home = std::env::temp_dir().join(format!("eqmux-foreign-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        assert!(foreign_in(&home).is_empty(), "파일이 없으면 없다");
        std::fs::write(
            home.join(".claude/CLAUDE.md"),
            "# mine\n<!-- wmux:start — AUTO-MANAGED BY wmux -->\nYou are running inside wmux. Use `wmux browser`.\n<!-- wmux:end -->\n",
        )
        .unwrap();
        std::fs::write(
            home.join(".claude/settings.json"),
            r#"{"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node \"C:/Users/u/AppData/wmux/wmux-hook.js\" || true"}]},
               {"matcher":"Edit","hooks":[{"type":"command","command":"node \"C:/Users/u/AppData/wmux/wmux-hook.js\""}]}],
               "Stop":[{"hooks":[{"type":"command","command":"eqmux _hook Stop"}]}]}}"#,
        )
        .unwrap();
        std::fs::write(
            home.join(".codex/hooks.json"),
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"C:/Users/u/.orca/agent-hooks/codex-hook.cmd"}]}]}}"#,
        )
        .unwrap();
        std::fs::write(home.join(".codex/AGENTS.md"), "plain rules, nothing foreign\n").unwrap();
        let got: Vec<(String, &str, u32)> = foreign_in(&home).into_iter().map(|f| (f.tool, f.kind, f.count)).collect();
        assert_eq!(
            got,
            vec![
                ("wmux".into(), "block", 1),
                ("wmux".into(), "sentence", 1),
                ("wmux".into(), "hook", 2),
                ("orca".into(), "hook", 1),
            ]
        );
        assert!(foreign_in(&home).iter().all(|f| std::path::Path::new(&f.file).is_absolute()), "[파일 열기]용 절대 경로");
        std::fs::remove_dir_all(&home).ok();
    }

    /// §9-3 — 홈·사용자 이름·토큰은 가리고, 세션 UUID와 평범한 문장은 남긴다
    #[test]
    fn bundle_mask_hides_user_and_secrets() {
        let text = "log C:\\Users\\Kim\\.eqmux\\logs\\x · D:/work/Kim/app\n\
                    token=abcd1234 · \"api_key\": \"zz9\" · Authorization: Bearer qqq\n\
                    sk-ant-REALLYSECRET123 · ghp_abcdefghij1234 · 7f3a9c1e2b4d6f8091a2b3c4d5e6f7081a2b3c4d\n\
                    session 590d81a0-4e66-4c49-be0f-44abda8b5301 BAD_TOKEN mismatch";
        let m = mask(text, "C:\\Users\\Kim", "kim");
        assert!(m.contains("log ~\\.eqmux\\logs\\x"), "{m}");
        assert!(m.contains("D:/work/<user>/app"), "{m}");
        for leak in ["abcd1234", "zz9", "qqq", "REALLYSECRET", "ghp_abc", "7f3a9c1e"] {
            assert!(!m.contains(leak), "{leak} 새어 나감: {m}");
        }
        assert!(m.contains("590d81a0-4e66-4c49-be0f-44abda8b5301"), "UUID는 남긴다");
        assert!(m.contains("BAD_TOKEN mismatch"), "키 뒤에 =·:가 없으면 문장이다");
    }

    #[test]
    fn hidden_window_gets_a_longer_leash() {
        let shown = Beat { at_ms: 1_000, hidden: false, silent: false };
        let hidden = Beat { at_ms: 1_000, hidden: true, silent: false };
        assert!(!overdue(&shown, 1_000 + ALIVE_LIMIT_MS));
        assert!(overdue(&shown, 1_001 + ALIVE_LIMIT_MS));
        assert!(!overdue(&hidden, 1_001 + ALIVE_LIMIT_MS), "숨은 창의 타이머 스로틀은 끊김이 아니다");
        assert!(overdue(&hidden, 1_001 + ALIVE_LIMIT_HIDDEN_MS));
    }
}
