//! 엔진 확장 관리 (0.6 §12) — 사이드 패널 "확장" 그룹 [MCP | 플러그인 | 스킬]의 Rust 쪽.
//!
//! - 플러그인: 엔진 CLI(`claude plugin … --json` · `codex plugin …`)를 그대로 부른다. 플러그인 파일은
//!   직접 읽거나 쓰지 않는다 — 저장 형식은 엔진 것이고 CLI가 그 변화를 흡수한다.
//!   `engine_plugin`은 임의 명령 통로가 되지 않게 허용 목록 · `-y` 거부 · 셸 메타문자 거부 · 60초 상한을 둔다.
//! - MCP: `~/.claude.json` · `<ws>/.mcp.json`을 **읽기만** 한다. env·header의 값은 여기서 버리고 키 이름만 넘긴다.
//!   상태 점검은 `claude mcp list`(서버 프로세스를 띄운다)라 사람이 누를 때만 — engine_plugin의 `mcp list`.
//! - 스킬: 목록 실측과 만들기·복사만 여기 있다. 편집·삭제는 fsx의 fs_read/fs_write/fs_delete를 스킬 루트에
//!   그대로 쓴다 — 경로 탈출 가드 · mtime 충돌 검사 · 휴지통이 이미 거기 있다 (결정 X1).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const TIMEOUT: Duration = Duration::from_secs(60);

// ── 엔진 CLI 호출 ──

/// 허용 목록 판정 — 순수 함수라 시험한다. args는 실행 파일 뒤 전부다(`plugin list --json`).
/// 플러그인 제작(init·eval·validate)·임의 하위 명령·`-y`는 막는다. 동의는 `--accept-command <sha256>`로만 들어온다
pub fn check_args(cli: &str, args: &[String]) -> Result<(), String> {
    let codex = cli == "codex";
    if cli != "claude" && !codex {
        return Err("지원하지 않는 엔진입니다".into());
    }
    if let Some(bad) = args.iter().find(|a| !safe_arg(a)) {
        return Err(format!("허용하지 않는 인자입니다: {bad}"));
    }
    if args.iter().any(|a| a == "-y" || a == "--yes") {
        return Err("자동 동의(-y)는 쓰지 않습니다 — 선언된 명령은 화면에서 보고 동의합니다".into());
    }
    let sub = |i: usize| args.get(i).map(String::as_str).unwrap_or("");
    let ok = match (sub(0), sub(1)) {
        ("plugin", "marketplace") => matches!(sub(2), "add" | "list" | "update" | "remove"),
        ("plugin", s) if codex => matches!(s, "list" | "add" | "remove"),
        ("plugin", s) => {
            matches!(s, "list" | "details" | "install" | "uninstall" | "enable" | "disable" | "update" | "configure")
        }
        ("mcp", s) => matches!(s, "list" | "get"),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(format!("허용하지 않는 하위 명령입니다: {} {}", sub(0), sub(1)))
    }
}

/// cmd.exe 폴백(npm `.cmd` 설치)을 거쳐도 다른 뜻이 되지 않는 인자만 — 플러그인 id · 범위 · URL · owner/repo · sha256
fn safe_arg(a: &str) -> bool {
    !a.is_empty() && a.len() <= 512 && a.chars().all(|c| c.is_ascii_alphanumeric() || "-_.@:/=+~#,".contains(c))
}

fn spawn(cli: &str, args: &[String], cwd: Option<&str>, via_shell: bool) -> std::io::Result<std::process::Child> {
    use std::process::{Command, Stdio};
    let mut c = if via_shell {
        #[cfg(windows)]
        let mut c = Command::new("cmd.exe");
        #[cfg(windows)]
        c.arg("/c").arg(cli);
        #[cfg(not(windows))]
        let mut c = Command::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()));
        #[cfg(not(windows))]
        c.args(["-lc", "exec \"$@\"", "eqmux-ext", cli]);
        c
    } else {
        Command::new(cli)
    };
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // cwd가 없으면 홈 — 전체 범위 질의가 앱이 어디서 떴는지(그 폴더의 프로젝트 설정)에 휘둘리지 않게
    match cwd.filter(|d| Path::new(d).is_dir()) {
        Some(d) => c.current_dir(d),
        None => c.current_dir(crate::home_dir()),
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — agentscan과 같다
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0); // kill_tree가 그룹째 끝낼 수 있게
    }
    c.spawn()
}

/// 시한 초과 — 셸 폴백(cmd /c · sh -lc)이나 `mcp list`가 띄운 서버까지 나무째 끝낸다. 자식만 죽이면 손자가 남는다
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(unix)]
    {
        // spawn이 process_group(0)으로 띄웠으므로 그룹 id = 자식 pid
        let _ = std::process::Command::new("kill").args(["-KILL", &format!("-{}", child.id())]).status();
    }
    let _ = child.kill();
}

/// 실행 → (성공 여부, stdout, stderr). 상한을 넘으면 죽이고 오류
fn run(cli: &str, args: &[String], cwd: Option<&str>) -> Result<(bool, String, String), String> {
    let mut child = match spawn(cli, args, cwd, false) {
        Ok(c) => c,
        // 셸 폴백 전에 PATH부터 본다 (B182) — 없으면 cmd의 "내부 또는 외부 명령이 아닙니다"가 OEM 코드 페이지로
        // 와서 깨져 보이고, 종료 코드(1)로는 다른 실패와 가를 수 없다. 문구를 여기서 만든다.
        // macOS는 이 거름을 건너뛴다 (B269) — on_path도 같은 프로세스 PATH를 봐서, 로그인 PATH 들여오기가
        // 시한을 넘기면 ~/.local/bin/claude를 못 찾는다. 로그인 셸($SHELL -lc)로 한 번은 띄워 본다
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !cfg!(target_os = "macos") && !crate::agentscan::on_path(cli) => {
            return Err(format!("{cli}가 PATH에 없습니다"));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            spawn(cli, args, cwd, true).map_err(|e| format!("{cli}를 실행하지 못했습니다 — {e}"))?
        }
        Err(e) => return Err(format!("{cli}를 실행하지 못했습니다 — {e}")),
    };
    // 파이프는 따로 비운다 — 한쪽이 차면 자식이 멈춰 상한까지 기다리게 된다
    // 바이트로 읽어 손실 변환 — Windows cmd의 "명령을 찾을 수 없습니다"는 코드 페이지(cp949)라 UTF-8 읽기는 통째로 버린다
    let drain = |p: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut b = Vec::new();
            if let Some(mut p) = p {
                let _ = p.read_to_end(&mut b);
            }
            String::from_utf8_lossy(&b).into_owned()
        })
    };
    let out = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let err = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) if start.elapsed() < TIMEOUT => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                kill_tree(&mut child);
                let _ = child.wait();
                return Err(format!("{}초 안에 끝나지 않아 멈췄습니다", TIMEOUT.as_secs()));
            }
        }
    };
    Ok((status.success(), out.join().unwrap_or_default(), err.join().unwrap_or_default()))
}

/// 엔진 플러그인 · MCP 점검 명령 (§12 1단계) — stdout을 그대로 돌려준다. 해석은 TS가 한다.
/// 실패하면 stderr(없으면 stdout)를 오류로 — `--json` 출력의 shownCommand 같은 정보가 stdout에 오기도 한다
#[tauri::command]
pub async fn engine_plugin(cli: String, args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    check_args(&cli, &args)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (ok, out, err) = run(&cli, &args, cwd.as_deref())?;
        if ok {
            Ok(out)
        } else {
            let msg = if err.trim().is_empty() { out } else { err };
            Err(if msg.trim().is_empty() { format!("{cli}가 실패했습니다 (출력 없음)") } else { msg.trim().to_string() })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── MCP 목록 (읽기 전용) ──

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpRow {
    pub name: String,
    /// user · local · project
    pub scope: &'static str,
    /// stdio · http · sse …
    pub transport: String,
    /// 명령과 인자 또는 주소
    pub target: String,
    /// 값은 버린 키 이름만
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
    /// project 범위 승인 상태 — "approved" · "pending" · "disabled". 다른 범위는 "approved"
    pub approval: &'static str,
}

fn keys(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_object).map(|o| o.keys().cloned().collect()).unwrap_or_default()
}

/// `mcpServers` 객체 → 행. env·headers의 값은 읽지 않는다
pub fn mcp_rows(servers: Option<&Value>, scope: &'static str, enabled: &[String], disabled: &[String]) -> Vec<McpRow> {
    let Some(obj) = servers.and_then(Value::as_object) else { return Vec::new() };
    obj.iter()
        .map(|(name, s)| {
            let url = s.get("url").and_then(Value::as_str);
            let transport = s
                .get("type")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| if url.is_some() { "http".into() } else { "stdio".into() });
            let target = match url {
                Some(u) => u.to_string(),
                None => {
                    let cmd = s.get("command").and_then(Value::as_str).unwrap_or("");
                    let args: Vec<&str> =
                        s.get("args").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
                    std::iter::once(cmd).chain(args).collect::<Vec<_>>().join(" ")
                }
            };
            let approval = if scope != "project" || enabled.contains(name) {
                "approved"
            } else if disabled.contains(name) {
                "disabled"
            } else {
                "pending"
            };
            McpRow {
                name: name.clone(),
                scope,
                transport,
                target,
                env_keys: keys(s.get("env")),
                header_keys: keys(s.get("headers")),
                approval,
            }
        })
        .collect()
}

/// `~/.claude.json`의 프로젝트 키 — 경로 표기(구분자 · 대소문자 · 끝 구분자)를 맞춰 비교한다
fn same_path(a: &str, b: &str) -> bool {
    let n = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    n(a) == n(b)
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// Claude MCP 서버 목록 — user(`~/.claude.json` 최상위) · local(그 파일의 이 프로젝트 항목) · project(`.mcp.json`).
/// 파일이 깨졌으면 그 범위만 빠진다. 플러그인 · claude.ai 커넥터는 파일에 없다 — 점검 결과에만 나온다
pub fn scan_mcp(claude_json: Option<&Value>, mcp_json: Option<&Value>, ws_path: Option<&str>) -> Vec<McpRow> {
    let mut rows = mcp_rows(claude_json.and_then(|v| v.get("mcpServers")), "user", &[], &[]);
    let project = ws_path.and_then(|ws| {
        claude_json?.get("projects")?.as_object()?.iter().find(|(k, _)| same_path(k, ws)).map(|(_, v)| v)
    });
    rows.extend(mcp_rows(project.and_then(|p| p.get("mcpServers")), "local", &[], &[]));
    let enabled = strings(project.and_then(|p| p.get("enabledMcpjsonServers")));
    let disabled = strings(project.and_then(|p| p.get("disabledMcpjsonServers")));
    rows.extend(mcp_rows(mcp_json.and_then(|v| v.get("mcpServers")), "project", &enabled, &disabled));
    rows
}

/// 설정 JSON 하나 — 없으면 None. 있는데 못 읽었으면(끝 쉼표 · 쓰는 도중 · 권한) errors에 "경로: 사유"를 남긴다.
/// 메모장이 붙이는 BOM은 벗긴다 (B218) — 예전엔 둘 다 '설정된 MCP 서버가 없습니다'로만 보였다
fn read_json(p: &Path, errors: &mut Vec<String>) -> Option<Value> {
    let text = match fs::read_to_string(p) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            errors.push(format!("{}: {e}", p.display()));
            return None;
        }
    };
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| errors.push(format!("{}: {e}", p.display())))
        .ok()
}

#[derive(Serialize, Default)]
pub struct McpScan {
    pub rows: Vec<McpRow>,
    /// 있는데 못 읽은 설정 파일 — 화면이 경고 행으로 보인다
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn mcp_scan(ws_path: Option<String>) -> McpScan {
    tauri::async_runtime::spawn_blocking(move || {
        let mut errors = Vec::new();
        let claude = read_json(&crate::home_dir().join(".claude.json"), &mut errors);
        let mcp = ws_path.as_deref().and_then(|ws| read_json(&Path::new(ws).join(".mcp.json"), &mut errors));
        McpScan { rows: scan_mcp(claude.as_ref(), mcp.as_ref(), ws_path.as_deref()), errors }
    })
    .await
    .unwrap_or_default()
}

// ── 스킬 ──

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillRow {
    /// user · project · plugin
    pub scope: &'static str,
    /// 플러그인 스킬이면 그 플러그인 id
    pub source: Option<String>,
    pub name: String,
    pub description: String,
    /// 스킬 폴더 이름
    pub dir: String,
    /// 이 행이 속한 스킬 루트 — fs_read/fs_write/fs_delete의 wsPath로 쓴다
    pub root: String,
    /// 루트 기준 `SKILL.md` 상대 경로
    pub rel: String,
    pub mtime_ms: i64,
    pub problems: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillScan {
    pub user_root: String,
    pub project_root: Option<String>,
    pub rows: Vec<SkillRow>,
}

#[derive(Deserialize)]
pub struct PluginDir {
    pub id: String,
    pub path: String,
}

fn unquote(s: String) -> String {
    let t = s.trim();
    let q = t.len() >= 2 && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')));
    if q { t[1..t.len() - 1].to_string() } else { t.to_string() }
}

/// `SKILL.md` 하나 → 행. frontmatter 검사는 경고만 한다 — 저장을 막지 않는다 (엔진 형식이 바뀔 수 있다)
fn skill_row(scope: &'static str, source: Option<&str>, root: &Path, dir: &str) -> Option<SkillRow> {
    let path = root.join(dir).join("SKILL.md");
    let text = fs::read_to_string(&path).ok()?;
    let (fm, _) = crate::roles::split_frontmatter(&text);
    let name = crate::roles::fm_value(&fm, "name").map(unquote);
    let description = crate::roles::fm_value(&fm, "description").map(unquote).unwrap_or_default();
    let mut problems = Vec::new();
    if fm.is_empty() {
        problems.push("frontmatter 없음".to_string());
    }
    match &name {
        None => problems.push("name 없음".into()),
        Some(n) if n != dir => problems.push("name이 폴더 이름과 다름".into()),
        _ => {}
    }
    if description.is_empty() {
        problems.push("description 없음".into());
    } else if description.chars().count() > 1024 {
        problems.push("description 1,024자 초과".into());
    }
    let mtime_ms = fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Some(SkillRow {
        scope,
        source: source.map(str::to_string),
        name: name.unwrap_or_else(|| dir.to_string()),
        description,
        dir: dir.to_string(),
        root: root.to_string_lossy().into_owned(),
        rel: format!("{dir}/SKILL.md"),
        mtime_ms,
        problems,
    })
}

/// `<root>/<폴더>/SKILL.md`만 — 그 밖의 폴더(동기화 캐시, 플러그인 폴더 등)는 스킬이 아니다
fn scan_root(root: &Path, scope: &'static str, source: Option<&str>) -> Vec<SkillRow> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut rows: Vec<SkillRow> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| skill_row(scope, source, root, &e.file_name().to_string_lossy()))
        .collect();
    rows.sort_by(|a, b| a.dir.cmp(&b.dir));
    rows
}

pub fn user_skill_root() -> PathBuf {
    crate::home_dir().join(".claude").join("skills")
}

fn project_skill_root(ws: &str) -> PathBuf {
    Path::new(ws).join(".claude").join("skills")
}

/// 스킬 목록 (§12 2단계) — 플러그인 스킬은 `claude plugin list`의 installPath 아래 `skills/`만 본다
#[tauri::command]
pub async fn skills_list(ws_path: Option<String>, plugin_dirs: Vec<PluginDir>) -> SkillScan {
    tauri::async_runtime::spawn_blocking(move || {
        let user = user_skill_root();
        let mut rows = scan_root(&user, "user", None);
        let project = ws_path.as_deref().map(project_skill_root);
        if let Some(p) = &project {
            rows.extend(scan_root(p, "project", None));
        }
        for d in &plugin_dirs {
            rows.extend(scan_root(&Path::new(&d.path).join("skills"), "plugin", Some(&d.id)));
        }
        SkillScan {
            user_root: user.to_string_lossy().into_owned(),
            project_root: project.map(|p| p.to_string_lossy().into_owned()),
            rows,
        }
    })
    .await
    .unwrap_or(SkillScan { user_root: String::new(), project_root: None, rows: Vec::new() })
}

/// 스킬 이름 — 소문자 · 숫자 · 하이픈, 64자 이하
pub fn valid_skill_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 64
        && !n.starts_with('-')
        && n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 새 스킬 — scope "user"면 `~/.claude/skills`, 아니면 워크스페이스 `.claude/skills`. 같은 이름이 있으면 거부.
/// 전체(user) 범위 쓰기는 화면이 확인창을 거친 뒤에만 부른다 (결정 X1). 반환은 만든 행
#[tauri::command]
pub fn skill_create(scope: String, ws_path: Option<String>, name: String, content: String) -> Result<SkillRow, String> {
    if !valid_skill_name(&name) {
        return Err("이름은 소문자 · 숫자 · 하이픈, 64자 이하만 씁니다".into());
    }
    let root = match (scope.as_str(), ws_path.as_deref()) {
        ("user", _) => user_skill_root(),
        ("project", Some(ws)) => project_skill_root(ws),
        _ => return Err("스킬을 만들 곳이 없습니다".into()),
    };
    let dir = root.join(&name);
    if dir.exists() {
        return Err("같은 이름의 스킬이 이미 있습니다".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::workspace::atomic_write(&dir.join("SKILL.md"), content.as_bytes())?;
    skill_row(if scope == "user" { "user" } else { "project" }, None, &root, &name).ok_or_else(|| "만든 스킬을 읽지 못했습니다".into())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let ty = e.file_type()?;
        if ty.is_symlink() {
            continue; // 링크는 따라가지 않는다 — 스킬 밖으로 새는 길을 만들지 않는다
        }
        let dst = to.join(e.file_name());
        if ty.is_dir() {
            copy_dir(&e.path(), &dst)?;
        } else {
            fs::copy(e.path(), dst)?;
        }
    }
    Ok(())
}

/// 스킬 폴더를 다른 범위로 복사 (사용자 → 프로젝트, 또는 반대). 원본은 그대로. 같은 이름이 있으면 거부
#[tauri::command]
pub fn skill_copy(from_root: String, dir: String, to_scope: String, ws_path: Option<String>) -> Result<SkillRow, String> {
    if dir.contains(['/', '\\']) || dir == ".." || dir == "." {
        return Err("스킬 폴더 이름이 아닙니다".into());
    }
    let to_root = match (to_scope.as_str(), ws_path.as_deref()) {
        ("user", _) => user_skill_root(),
        ("project", Some(ws)) => project_skill_root(ws),
        _ => return Err("복사할 곳이 없습니다".into()),
    };
    let src = Path::new(&from_root).join(&dir);
    if !src.join("SKILL.md").is_file() {
        return Err("스킬이 아닙니다 (SKILL.md 없음)".into());
    }
    let dst = to_root.join(&dir);
    if dst.exists() {
        return Err("같은 이름의 스킬이 이미 있습니다".into());
    }
    copy_dir(&src, &dst).map_err(|e| e.to_string())?;
    skill_row(if to_scope == "user" { "user" } else { "project" }, None, &to_root, &dir)
        .ok_or_else(|| "복사한 스킬을 읽지 못했습니다".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn a(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn allow_list_blocks_everything_but_management() {
        assert!(check_args("claude", &a(&["plugin", "list", "--json"])).is_ok());
        assert!(check_args("claude", &a(&["plugin", "install", "x@m", "--scope", "local"])).is_ok());
        assert!(check_args("claude", &a(&["plugin", "marketplace", "add", "owner/repo"])).is_ok());
        assert!(check_args("claude", &a(&["mcp", "list"])).is_ok());
        assert!(check_args("codex", &a(&["plugin", "add", "x"])).is_ok());
        assert!(check_args("claude", &a(&["plugin", "eval", "x"])).is_err(), "제작 도구는 막는다");
        assert!(check_args("claude", &a(&["mcp", "add", "x", "--", "evil"])).is_err(), "mcp 추가는 사람이 터미널에서");
        assert!(check_args("codex", &a(&["plugin", "enable", "x"])).is_err(), "Codex에 없는 명령");
        assert!(check_args("claude", &a(&["plugin", "install", "x", "-y"])).is_err(), "-y 거부");
        assert!(check_args("claude", &a(&["plugin", "install", "x&calc"])).is_err(), "셸 메타문자");
        assert!(check_args("claude", &a(&["-p", "hi"])).is_err());
        assert!(check_args("bash", &a(&["plugin", "list"])).is_err());
        assert!(check_args("claude", &[]).is_err());
    }

    #[test]
    fn mcp_scan_drops_secret_values_and_reads_approval() {
        let claude = json!({
            "mcpServers": { "github": { "type": "http", "url": "https://x/mcp", "headers": { "Authorization": "Bearer SECRET" } } },
            "projects": { "D:/ws/App": {
                "mcpServers": { "pw": { "command": "npx", "args": ["@playwright/mcp"], "env": { "TOKEN": "SECRET" } } },
                "enabledMcpjsonServers": ["ok"], "disabledMcpjsonServers": ["off"]
            } }
        });
        let mcp = json!({ "mcpServers": { "ok": { "command": "a" }, "off": { "command": "b" }, "new": { "command": "c" } } });
        let rows = scan_mcp(Some(&claude), Some(&mcp), Some("d:\\ws\\app\\"));
        assert!(!format!("{rows:?}").contains("SECRET"), "값은 넘기지 않는다");
        let by = |n: &str| rows.iter().find(|r| r.name == n).unwrap();
        assert_eq!((by("github").scope, by("github").transport.as_str()), ("user", "http"));
        assert_eq!(by("github").header_keys, ["Authorization"]);
        assert_eq!((by("pw").scope, by("pw").target.as_str()), ("local", "npx @playwright/mcp"));
        assert_eq!(by("pw").env_keys, ["TOKEN"]);
        assert_eq!((by("ok").approval, by("off").approval, by("new").approval), ("approved", "disabled", "pending"));
        assert!(scan_mcp(None, None, None).is_empty(), "파일이 없거나 깨지면 빈 목록");
    }

    #[test]
    fn read_json_strips_bom_and_reports_broken_files() {
        let base = std::env::temp_dir().join(format!("eqmux-mcpjson-{}", crate::workspace::now_ms()));
        fs::create_dir_all(&base).unwrap();
        let mut errors = Vec::new();
        fs::write(base.join("bom.json"), "\u{feff}{\"mcpServers\":{}}").unwrap();
        assert!(read_json(&base.join("bom.json"), &mut errors).is_some(), "BOM은 벗긴다");
        assert!(read_json(&base.join("none.json"), &mut errors).is_none());
        assert!(errors.is_empty(), "없는 파일은 오류가 아니다: {errors:?}");
        fs::write(base.join("bad.json"), "{\"mcpServers\":{},}").unwrap();
        assert!(read_json(&base.join("bad.json"), &mut errors).is_none());
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("bad.json"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_engine_is_reported_in_plain_words() {
        let err = run("eqmux-no-such-cli-b182", &a(&["plugin", "list"]), None).unwrap_err();
        assert!(err.contains("PATH에 없습니다"), "{err}");
    }

    #[test]
    fn skills_scan_flags_frontmatter_problems_and_copy_refuses_overwrite() {
        let base = std::env::temp_dir().join(format!("eqmux-skills-{}", crate::workspace::now_ms()));
        let root = base.join("skills");
        let put = |dir: &str, body: &str| {
            fs::create_dir_all(root.join(dir)).unwrap();
            fs::write(root.join(dir).join("SKILL.md"), body).unwrap();
        };
        put("good", "---\nname: good\ndescription: \"PR을 리뷰할 때\"\n---\n# x");
        put("odd", "---\nname: other\n---\n");
        put("bare", "# 머리만");
        fs::create_dir_all(root.join("synced").join("deep")).unwrap(); // SKILL.md 없는 폴더는 스킬이 아니다
        let rows = scan_root(&root, "user", None);
        let p = |d: &str| rows.iter().find(|r| r.dir == d).unwrap().problems.clone();
        assert_eq!(rows.len(), 3);
        assert!(p("good").is_empty(), "{:?}", p("good"));
        assert_eq!(rows.iter().find(|r| r.dir == "good").unwrap().description, "PR을 리뷰할 때");
        assert_eq!(p("odd"), ["name이 폴더 이름과 다름", "description 없음"]);
        assert!(p("bare").contains(&"frontmatter 없음".to_string()));

        let ws = base.join("ws");
        fs::create_dir_all(&ws).unwrap();
        let ws_s = ws.to_string_lossy().into_owned();
        let root_s = root.to_string_lossy().into_owned();
        let copied = skill_copy(root_s.clone(), "good".into(), "project".into(), Some(ws_s.clone())).unwrap();
        assert_eq!(copied.scope, "project");
        assert!(ws.join(".claude/skills/good/SKILL.md").is_file());
        assert!(skill_copy(root_s.clone(), "good".into(), "project".into(), Some(ws_s.clone())).is_err(), "덮어쓰지 않는다");
        assert!(skill_copy(root_s, "../x".into(), "project".into(), Some(ws_s.clone())).is_err());

        assert!(skill_create("project".into(), Some(ws_s.clone()), "Bad Name".into(), String::new()).is_err());
        let made = skill_create("project".into(), Some(ws_s), "new-one".into(), "---\nname: new-one\ndescription: d\n---\n".into()).unwrap();
        assert!(made.problems.is_empty());
        let _ = fs::remove_dir_all(&base);
    }
}
