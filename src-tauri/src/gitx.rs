// git 화면 (§17) — 1단계 읽기(그래프 · 참조 · 상세 · 파일 히스토리 · blame)와
// 2단계 안전한 쓰기(G7′). 쓰기는 사람이 git 화면에서 누를 때만 온다 — 에이전트·메시지·자동 규칙이
// 이 커맨드를 부르는 길은 없다. 모든 쓰기는 `check_args` 허용 목록을 지난다:
// 하위 명령 · 옵션 모두 목록에 있어야 하고, `--force` · `--no-verify` · `clean` 같은 것은 목록에 없다.
// 레인 계산은 프런트(`src/screens/gitGraph.ts`)가 한다 (G3) — 여기는 git 출력을 구조로만 바꾼다.

use std::time::Duration;

use serde::Serialize;

use crate::workspace::{git, is_repo, run_git};

const US: char = '\u{1f}'; // 필드 구분 — 커밋 메시지에 나올 일이 없다
const RS: char = '\u{1e}'; // 레코드 구분

fn need_repo(path: &str) -> Result<(), String> {
    if is_repo(path) {
        Ok(())
    } else {
        Err("git 저장소가 아닙니다".into())
    }
}

fn valid_rev(h: &str) -> bool {
    (4..=40).contains(&h.len()) && h.chars().all(|c| c.is_ascii_hexdigit())
}

// ── 1단계: 읽기 ──

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub time: i64, // 작성 시각 (유닉스 초)
    pub subject: String,
    pub refs: Vec<String>, // `HEAD -> main` · `origin/main` · `tag: v1`
}

fn parse_log(out: &str) -> Vec<LogCommit> {
    out.split(RS)
        .map(|r| r.trim_start_matches(['\n', '\r']))
        .filter(|r| !r.trim().is_empty())
        .filter_map(|r| {
            let mut f = r.split(US);
            let hash = f.next()?.trim().to_string();
            let parents = f.next()?.split_whitespace().map(String::from).collect();
            let author = f.next()?.to_string();
            let time = f.next()?.trim().parse().unwrap_or(0);
            let subject = f.next()?.to_string();
            let refs = f
                .next()
                .unwrap_or_default()
                .trim()
                .split(", ")
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();
            Some(LogCommit { hash, parents, author, time, subject, refs })
        })
        .collect()
}

/// 그래프 한 쪽 (§17-5) — `--topo-order`, 처음 300개 · 스크롤하면 skip으로 더.
/// `file`이 있으면 파일 히스토리다(`--follow`, 현재 브랜치). 검색어는 `-F -i`로 글자 그대로 찾는다.
pub fn log(
    ws_path: &str,
    skip: u32,
    limit: u32,
    all: bool,
    grep: Option<&str>,
    author: Option<&str>,
    file: Option<&str>,
) -> Result<Vec<LogCommit>, String> {
    need_repo(ws_path)?;
    let fmt = format!("--format=%H{US}%P{US}%an{US}%at{US}%s{US}%D{RS}");
    let skip = format!("--skip={skip}");
    let limit = format!("-n{}", limit.clamp(1, 1000));
    let mut args: Vec<String> = vec!["log".into(), "--topo-order".into(), fmt, skip, limit];
    let file = file.filter(|f| !f.is_empty());
    if all && file.is_none() {
        args.push("--all".into());
    }
    if grep.is_some_and(|g| !g.is_empty()) || author.is_some_and(|a| !a.is_empty()) {
        args.extend(["-F".into(), "-i".into()]);
    }
    if let Some(g) = grep.filter(|g| !g.is_empty()) {
        args.push(format!("--grep={g}"));
    }
    if let Some(a) = author.filter(|a| !a.is_empty()) {
        args.push(format!("--author={a}"));
    }
    if let Some(f) = file {
        args.extend(["--follow".into(), "--".into(), f.into()]);
    }
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    match git(&a, ws_path) {
        Ok(out) => Ok(parse_log(&out)),
        // 커밋이 하나도 없는 저장소 — 오류가 아니라 빈 그래프
        Err(e) if e.contains("does not have any commits") || e.contains("bad default revision") => Ok(vec![]),
        Err(e) => Err(e),
    }
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchRef {
    pub name: String,
    pub hash: String,
    pub upstream: String,
    pub ahead: u32,
    pub behind: u32,
    pub gone: bool, // 업스트림이 원격에서 지워졌다
    pub head: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NamedRef {
    pub name: String,
    pub hash: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitRefs {
    pub local: Vec<BranchRef>,
    pub remote: Vec<NamedRef>,
    pub tags: Vec<NamedRef>,
    pub stashes: Vec<NamedRef>, // name = `stash@{0}: 메시지`
}

/// `ahead 2, behind 4` · `ahead 1` · `gone` → (ahead, behind, gone)
fn parse_track(s: &str) -> (u32, u32, bool) {
    let mut r = (0, 0, s.trim() == "gone");
    for part in s.split(',') {
        let mut it = part.split_whitespace();
        match (it.next(), it.next().and_then(|n| n.parse().ok())) {
            (Some("ahead"), Some(n)) => r.0 = n,
            (Some("behind"), Some(n)) => r.1 = n,
            _ => {}
        }
    }
    r
}

fn parse_refs(out: &str) -> (Vec<BranchRef>, Vec<NamedRef>, Vec<NamedRef>) {
    let (mut local, mut remote, mut tags) = (vec![], vec![], vec![]);
    for line in out.lines() {
        let f: Vec<&str> = line.split(US).collect();
        let [name, hash, deref, upstream, track, head, symref] = f[..] else { continue };
        let hash = if deref.is_empty() { hash } else { deref }.to_string(); // 주석 태그는 가리키는 커밋
        if let Some(n) = name.strip_prefix("refs/heads/") {
            let (ahead, behind, gone) = parse_track(track);
            local.push(BranchRef {
                name: n.into(),
                hash,
                upstream: upstream.into(),
                ahead,
                behind,
                gone,
                head: head == "*",
            });
        } else if let Some(n) = name.strip_prefix("refs/remotes/") {
            if symref.is_empty() {
                remote.push(NamedRef { name: n.into(), hash }); // origin/HEAD 같은 가리킴은 뺀다
            }
        } else if let Some(n) = name.strip_prefix("refs/tags/") {
            tags.push(NamedRef { name: n.into(), hash });
        }
    }
    (local, remote, tags)
}

/// 사이드바 (§17-5) — 로컬(브랜치별 ahead/behind) · 원격 · 태그 · stash
pub fn refs(ws_path: &str) -> Result<GitRefs, String> {
    need_repo(ws_path)?;
    let fmt = format!(
        "--format=%(refname){US}%(objectname){US}%(*objectname){US}%(upstream:short){US}%(upstream:track,nobracket){US}%(HEAD){US}%(symref)"
    );
    let out = git(&["for-each-ref", &fmt, "refs/heads", "refs/remotes", "refs/tags"], ws_path)?;
    let (local, remote, tags) = parse_refs(&out);
    let stashes = git(&["stash", "list", &format!("--format=%gd: %s{US}%H")], ws_path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let (name, hash) = l.split_once(US)?;
            Some(NamedRef { name: name.into(), hash: hash.into() })
        })
        .collect();
    Ok(GitRefs { local, remote, tags, stashes })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub author_time: i64,
    pub committer: String,
    pub commit_time: i64,
    pub body: String,
}

/// 커밋 상세 머리 (§17-5) — 변경 파일은 기존 `commit_changed_files`가 준다
pub fn detail(ws_path: &str, hash: &str) -> Result<CommitDetail, String> {
    if !valid_rev(hash) {
        return Err("잘못된 커밋 해시".into());
    }
    let fmt = format!("--format=%H{US}%P{US}%an{US}%ae{US}%at{US}%cn{US}%ct{US}%B");
    let out = git(&["show", "-s", &fmt, hash], ws_path)?;
    let f: Vec<&str> = out.splitn(8, US).collect();
    let [h, p, an, ae, at, cn, ct, body] = f[..] else { return Err("커밋을 읽을 수 없습니다".into()) };
    Ok(CommitDetail {
        hash: h.into(),
        parents: p.split_whitespace().map(String::from).collect(),
        author: an.into(),
        email: ae.into(),
        author_time: at.parse().unwrap_or(0),
        committer: cn.into(),
        commit_time: ct.parse().unwrap_or(0),
        body: body.trim().into(),
    })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub hash: String,
    pub author: String,
    pub time: i64,
    pub text: String,
}

const MAX_BLAME_LINES: usize = 10_000;

/// `blame --porcelain` — 커밋 정보는 그 커밋이 처음 나온 줄에만 붙으므로 해시별로 기억한다
fn parse_blame(out: &str) -> Vec<BlameLine> {
    let mut info: std::collections::HashMap<String, (String, i64)> = Default::default();
    let mut rows = Vec::new();
    let mut cur = String::new();
    for line in out.lines() {
        if let Some(text) = line.strip_prefix('\t') {
            let (author, time) = info.get(&cur).cloned().unwrap_or_default();
            rows.push(BlameLine { hash: cur.chars().take(8).collect(), author, time, text: text.into() });
            if rows.len() >= MAX_BLAME_LINES {
                break;
            }
        } else if let Some(a) = line.strip_prefix("author ") {
            info.entry(cur.clone()).or_default().0 = a.into();
        } else if let Some(t) = line.strip_prefix("author-time ") {
            info.entry(cur.clone()).or_default().1 = t.parse().unwrap_or(0);
        } else if line.len() >= 40 && line[..40].chars().all(|c| c.is_ascii_hexdigit()) {
            cur = line[..40].to_string();
        }
    }
    rows
}

pub fn blame(ws_path: &str, file: &str) -> Result<Vec<BlameLine>, String> {
    need_repo(ws_path)?;
    let out = git(&["blame", "--porcelain", "--", file], ws_path)?;
    Ok(parse_blame(&out))
}

// ── 2단계: 작업 트리 상태 (스테이징 목록) ──

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    pub path: String,
    pub from: Option<String>, // 이름 변경의 원래 경로
    pub x: String,            // 인덱스 쪽 — ' '면 스테이지된 것 없음
    pub y: String,            // 작업 트리 쪽 — '?'는 추적 안 됨
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkStatus {
    pub files: Vec<StatusFile>,
    /// HEAD가 원격 브랜치 어딘가에 이미 있다 — amend가 푸시한 커밋을 바꾼다 (경고)
    pub head_pushed: bool,
    pub has_head: bool,
}

/// `status --porcelain=v1 -z` — 이름 변경은 다음 NUL 항목이 원래 경로다
fn parse_status_z(out: &str) -> Vec<StatusFile> {
    let mut it = out.split('\0');
    let mut files = Vec::new();
    while let Some(e) = it.next() {
        if e.len() < 4 {
            continue;
        }
        let (x, y) = (&e[0..1], &e[1..2]);
        let from = if x == "R" || x == "C" { it.next().map(String::from) } else { None };
        files.push(StatusFile { path: e[3..].into(), from, x: x.into(), y: y.into() });
    }
    files
}

pub fn status(ws_path: &str) -> Result<WorkStatus, String> {
    need_repo(ws_path)?;
    // git() 래퍼는 앞 공백을 지운다 — ` M a`의 첫 칸이 날아가므로 원래 출력을 받는다
    let o = run_git(&["status", "--porcelain=v1", "-z", "-uall"], ws_path, Duration::from_secs(60), &[])?;
    if !o.ok {
        return Err(o.stderr.trim().into());
    }
    let has_head = git(&["rev-parse", "--verify", "-q", "HEAD"], ws_path).is_ok();
    let head_pushed = has_head
        && git(&["branch", "-r", "--contains", "HEAD"], ws_path).is_ok_and(|s| !s.trim().is_empty());
    Ok(WorkStatus { files: parse_status_z(&o.stdout), head_pushed, has_head })
}

/// 한 파일의 unified diff 원문 — 프런트가 덩어리로 나눠 [스테이지]용 패치를 만든다
pub fn file_patch(ws_path: &str, file: &str, staged: bool) -> Result<String, String> {
    need_repo(ws_path)?;
    let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", file]);
    let o = run_git(&args, ws_path, Duration::from_secs(60), &[])?;
    if o.ok {
        Ok(o.stdout) // 끝 줄바꿈까지 있어야 apply가 받는다
    } else {
        Err(o.stderr.trim().into())
    }
}

// ── 2단계: 허용 목록 실행 (G7′) ──

/// 하위 명령 하나의 허용 범위. 목록에 없는 옵션은 전부 거부한다 —
/// `--force` · `-f` · `--no-verify` · `-n`이 목록에 없는 것이 곧 거부 규칙이다.
struct Spec {
    sub: &'static str,
    flags: &'static [&'static str],
    /// 값을 다음 인자로 받는 옵션 — 값은 `-`로 시작해도 된다 (커밋 메시지 `-m "- 고침"`)
    valued: &'static [&'static str],
    /// `--` 뒤 경로를 받는다
    paths: bool,
    /// 반드시 있어야 하는 옵션 (pull은 `--ff-only`, restore는 `--staged`만)
    required: Option<&'static str>,
}

const ALLOWED: &[Spec] = &[
    Spec { sub: "fetch", flags: &["--all", "--prune", "--tags"], valued: &[], paths: false, required: None },
    Spec { sub: "pull", flags: &["--ff-only"], valued: &[], paths: false, required: Some("--ff-only") },
    // force는 `--force-with-lease`만 (G5). 메뉴 안쪽 + 확인창은 화면이 맡는다
    Spec {
        sub: "push",
        flags: &["-u", "--set-upstream", "--force-with-lease", "--tags"],
        valued: &[],
        paths: false,
        required: None,
    },
    Spec { sub: "add", flags: &[], valued: &[], paths: true, required: None },
    // 스테이지 내리기만 — `--staged` 없는 restore는 작업 트리 변경을 지운다
    Spec { sub: "restore", flags: &["--staged"], valued: &[], paths: true, required: Some("--staged") },
    Spec { sub: "commit", flags: &["--amend", "--no-edit"], valued: &["-m"], paths: false, required: None },
    Spec { sub: "switch", flags: &[], valued: &[], paths: false, required: None },
    // -D(병합 안 된 브랜치 삭제)는 화면이 -d 실패 뒤 확인창을 거쳐서만 보낸다
    Spec { sub: "branch", flags: &["-m", "-d", "-D"], valued: &[], paths: false, required: None },
    Spec { sub: "tag", flags: &["-a", "-d"], valued: &["-m"], paths: false, required: None },
];

pub fn check_args(args: &[String]) -> Result<(), String> {
    let sub = args.first().ok_or("빈 명령")?;
    let spec = ALLOWED
        .iter()
        .find(|s| s.sub == sub)
        .ok_or_else(|| format!("허용하지 않는 git 명령: {sub}"))?;
    let mut i = 1;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--" {
            if !spec.paths {
                return Err(format!("git {sub}은 경로를 받지 않습니다"));
            }
            break; // 뒤는 전부 경로 — `-`로 시작하는 파일명도 옵션이 아니다
        }
        if spec.valued.contains(&a) {
            if i + 1 >= args.len() {
                return Err(format!("{a} 뒤에 값이 없습니다"));
            }
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            if !spec.flags.contains(&a) {
                return Err(format!("허용하지 않는 옵션: {a}"));
            }
        } else if spec.paths {
            return Err("경로는 -- 뒤에만 둡니다".into());
        } else if sub == "push" && (a.starts_with('+') || a.contains(':')) {
            // `+main`은 강제 push, `:main`은 원격 브랜치 삭제다
            return Err(format!("허용하지 않는 refspec: {a}"));
        }
        i += 1;
    }
    if let Some(r) = spec.required {
        if !args.iter().any(|a| a == r) {
            return Err(format!("git {sub}에는 {r}가 필요합니다"));
        }
    }
    Ok(())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub ok: bool,
    /// 실행한 그대로의 명령 — 로그와 [명령 복사]가 같은 문자열을 쓴다
    pub command: String,
    pub output: String,
    /// 자격 증명 프롬프트가 필요해 실패했다 — 화면이 "터미널에서 한 번 로그인" 안내를 띄운다
    pub auth: bool,
}

const AUTH_MARKS: &[&str] = &[
    "terminal prompts disabled",
    "could not read username",
    "could not read password",
    "authentication failed",
    "permission denied (publickey",
    "user interactivity has been disabled",
    "host key verification failed",
];

fn is_auth_failure(s: &str) -> bool {
    let s = s.to_lowercase();
    AUTH_MARKS.iter().any(|m| s.contains(m))
}

/// 사람이 보는 명령 문자열 — 빈칸이 든 인자는 따옴표로 감싼다 (터미널에 그대로 붙여 칠 수 있게)
pub fn command_line(args: &[String]) -> String {
    let mut s = String::from("git");
    for a in args {
        s.push(' ');
        if a.is_empty() || a.contains([' ', '"', '\'', '&', '|', '<', '>', ';']) {
            s.push('"');
            s.push_str(&a.replace('"', "\\\""));
            s.push('"');
        } else {
            s.push_str(a);
        }
    }
    s
}

/// 쓰기 상한 — 원격 · pre-commit 훅은 분 단위가 정상이다. 프롬프트로 멈추는 길은 env가 막는다
const WRITE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// 인증 프롬프트를 앱에서 받지 않는다 (G6) — 자격 증명 관리자 · ssh-agent에 이미 있으면 통한다
const NO_PROMPT: &[(&str, &str)] = &[("GIT_TERMINAL_PROMPT", "0"), ("GCM_INTERACTIVE", "never")];

pub fn run(ws_path: &str, args: &[String]) -> Result<RunResult, String> {
    need_repo(ws_path)?;
    check_args(args)?;
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    let o = run_git(&a, ws_path, WRITE_TIMEOUT, NO_PROMPT)?;
    // 훅 출력 · 진행 메시지는 성공해도 stderr에 온다 — 둘 다 보인다
    let output = [o.stdout.trim(), o.stderr.trim()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n");
    Ok(RunResult { ok: o.ok, command: command_line(args), auth: !o.ok && is_auth_failure(&output), output })
}

/// 덩어리 스테이징 — 프런트가 만든 패치(파일 머리 + 덩어리 하나)를 인덱스에만 적용한다.
/// reverse = 스테이지 내리기. 작업 트리는 건드리지 않는다 (`--cached`)
pub fn apply_patch(ws_path: &str, patch: &str, reverse: bool) -> Result<RunResult, String> {
    need_repo(ws_path)?;
    if !patch.starts_with("diff --git ") {
        return Err("패치 형식이 아닙니다".into());
    }
    let tmp = std::env::temp_dir().join(format!("eqmux-hunk-{}.patch", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, patch).map_err(|e| e.to_string())?;
    let p = tmp.to_string_lossy().into_owned();
    let mut args = vec!["apply", "--cached", "--whitespace=nowarn"];
    if reverse {
        args.push("--reverse");
    }
    args.push(&p);
    let r = run_git(&args, ws_path, Duration::from_secs(60), &[]);
    let _ = std::fs::remove_file(&tmp);
    let o = r?;
    Ok(RunResult {
        ok: o.ok,
        command: format!("git apply --cached{} <덩어리>", if reverse { " --reverse" } else { "" }),
        output: o.stderr.trim().into(),
        auth: false,
    })
}

// ── 경로 추적 · 무시 상태 (W6 §16 .env 칩) — 읽기만 ──

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PathStatus {
    pub path: String,
    pub tracked: bool,
    pub ignored: bool,
}

/// 저장소가 아니면 빈 목록 — 칩을 숨기면 된다
pub fn path_status(ws_path: &str, paths: &[String]) -> Vec<PathStatus> {
    if !is_repo(ws_path) {
        return vec![];
    }
    let t = Duration::from_secs(60);
    paths
        .iter()
        .map(|p| PathStatus {
            path: p.clone(),
            tracked: run_git(&["ls-files", "--error-unmatch", "--", p], ws_path, t, &[]).is_ok_and(|o| o.ok),
            ignored: run_git(&["check-ignore", "-q", "--", p], ws_path, t, &[]).is_ok_and(|o| o.ok),
        })
        .collect()
}

// ── Tauri 커맨드 — git CLI라 blocking 스레드에서 돈다 (git_overview와 같은 이유) ──

#[tauri::command]
pub async fn git_path_status(ws_path: String, paths: Vec<String>) -> Result<Vec<PathStatus>, String> {
    blocking(move || Ok(path_status(&ws_path, &paths))).await
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_log(
    ws_path: String,
    skip: u32,
    limit: u32,
    all: bool,
    grep: Option<String>,
    author: Option<String>,
    file: Option<String>,
) -> Result<Vec<LogCommit>, String> {
    blocking(move || log(&ws_path, skip, limit, all, grep.as_deref(), author.as_deref(), file.as_deref())).await
}

#[tauri::command]
pub async fn git_refs(ws_path: String) -> Result<GitRefs, String> {
    blocking(move || refs(&ws_path)).await
}

#[tauri::command]
pub async fn git_commit_detail(ws_path: String, hash: String) -> Result<CommitDetail, String> {
    blocking(move || detail(&ws_path, &hash)).await
}

#[tauri::command]
pub async fn git_blame(ws_path: String, file: String) -> Result<Vec<BlameLine>, String> {
    blocking(move || blame(&ws_path, &file)).await
}

#[tauri::command]
pub async fn git_status(ws_path: String) -> Result<WorkStatus, String> {
    blocking(move || status(&ws_path)).await
}

#[tauri::command]
pub async fn git_file_patch(ws_path: String, file: String, staged: bool) -> Result<String, String> {
    blocking(move || file_patch(&ws_path, &file, staged)).await
}

/// G7′ 쓰기 — 허용 목록 밖이면 실행하지 않고 Err
#[tauri::command]
pub async fn git_run(ws_path: String, args: Vec<String>) -> Result<RunResult, String> {
    blocking(move || run(&ws_path, &args)).await
}

#[tauri::command]
pub async fn git_apply_patch(ws_path: String, patch: String, reverse: bool) -> Result<RunResult, String> {
    blocking(move || apply_patch(&ws_path, &patch, reverse)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// 단위 테스트 ② (§17-8) — 허용 목록 밖 하위 명령과 `--force` · `--no-verify` 거부
    #[test]
    fn check_args_rejects_force_no_verify_and_unknown() {
        for bad in [
            &["push", "--force"][..],
            &["push", "-f"],
            &["push", "origin", "+main"],
            &["push", "origin", ":main"],
            &["push", "--force-with-lease=main:abc"],
            &["commit", "--no-verify", "-m", "x"],
            &["commit", "-n", "-m", "x"],
            &["commit", "-anm", "x"],
            &["pull"],
            &["pull", "--rebase"],
            &["pull", "--ff-only", "--no-verify"],
            &["clean", "-fd"],
            &["reset", "--hard"],
            &["checkout", "main"],
            &["switch", "-f", "main"],
            &["switch", "--discard-changes", "main"],
            &["switch", "-c", "x"],
            &["branch", "-M", "a", "b"],
            &["tag", "-f", "v1"],
            &["restore", "--", "a.txt"],
            &["add", "a.txt"],
            &["add", "-f", "--", "a.txt"],
            &["fetch", "--upload-pack=evil"],
            &["push", "--receive-pack=evil"],
            &["commit", "-m"],
            &["-c", "core.hooksPath=/x", "commit"],
            &[],
        ] {
            assert!(check_args(&s(bad)).is_err(), "거부해야 한다: {bad:?}");
        }
        for good in [
            &["fetch", "--all", "--prune"][..],
            &["pull", "--ff-only"],
            &["push"],
            &["push", "-u", "origin", "feature/x"],
            &["push", "--force-with-lease"],
            &["add", "--", "a.txt", "-weird.txt"],
            &["restore", "--staged", "--", "a.txt"],
            &["commit", "-m", "- 목록 고침"],
            &["commit", "--amend", "--no-edit"],
            &["switch", "main"],
            &["branch", "feat", "abc1234"],
            &["branch", "-m", "a", "b"],
            &["branch", "-d", "a"],
            &["tag", "-a", "v1", "-m", "릴리스", "abc1234"],
            &["tag", "-d", "v1"],
        ] {
            assert!(check_args(&s(good)).is_ok(), "받아야 한다: {good:?} — {:?}", check_args(&s(good)));
        }
    }

    #[test]
    fn command_line_quotes_spaces() {
        assert_eq!(command_line(&s(&["commit", "-m", "고침 a"])), r#"git commit -m "고침 a""#);
        assert_eq!(command_line(&s(&["pull", "--ff-only"])), "git pull --ff-only");
    }

    #[test]
    fn auth_failure_is_detected() {
        assert!(is_auth_failure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
        assert!(is_auth_failure("git@github.com: Permission denied (publickey)."));
        assert!(!is_auth_failure("error: failed to push some refs (non-fast-forward)"));
    }

    #[test]
    fn parse_track_and_refs() {
        assert_eq!(parse_track("ahead 2, behind 4"), (2, 4, false));
        assert_eq!(parse_track("behind 1"), (0, 1, false));
        assert_eq!(parse_track("gone"), (0, 0, true));
        assert_eq!(parse_track(""), (0, 0, false));
        let u = US;
        let out = format!(
            "refs/heads/main{u}aaa{u}{u}origin/main{u}ahead 1{u}*{u}\n\
             refs/remotes/origin/HEAD{u}aaa{u}{u}{u}{u} {u}refs/remotes/origin/main\n\
             refs/remotes/origin/main{u}bbb{u}{u}{u}{u} {u}\n\
             refs/tags/v1{u}ttt{u}ccc{u}{u}{u} {u}"
        );
        let (l, r, t) = parse_refs(&out);
        assert_eq!(l.len(), 1);
        assert!(l[0].head && l[0].ahead == 1 && l[0].upstream == "origin/main");
        assert_eq!(r.len(), 1, "origin/HEAD 가리킴은 빠진다");
        assert_eq!(t[0].hash, "ccc", "주석 태그는 가리키는 커밋");
    }

    #[test]
    fn parse_status_z_handles_renames_and_leading_space() {
        let f = parse_status_z(" M a.txt\0R  new.txt\0old.txt\0?? 한글.txt\0");
        assert_eq!(f.len(), 3);
        assert_eq!((f[0].x.as_str(), f[0].y.as_str(), f[0].path.as_str()), (" ", "M", "a.txt"));
        assert_eq!(f[1].from.as_deref(), Some("old.txt"));
        assert_eq!(f[2].path, "한글.txt");
    }

    fn temp_repo(tag: &str) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("eqmux-gitx-{tag}-{}", crate::workspace::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        git(&["init", "-b", "main"], &path).unwrap();
        git(&["config", "user.email", "t@t"], &path).unwrap();
        git(&["config", "user.name", "t"], &path).unwrap();
        (dir, path)
    }

    /// 임시 저장소 — 그래프 · 참조 · 상세 · blame · 상태 · 쓰기 · 덩어리 스테이징 왕복
    #[test]
    fn reads_and_writes_a_real_repo() {
        let (dir, path) = temp_repo("rw");
        assert!(log(&path, 0, 300, true, None, None, None).unwrap().is_empty(), "빈 저장소 = 빈 그래프");
        fs::write(dir.join("a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n").unwrap();
        let run_ok = |a: &[&str]| {
            let r = run(&path, &s(a)).unwrap();
            assert!(r.ok, "{a:?}: {}", r.output);
            r
        };
        run_ok(&["add", "--", "a.txt"]);
        run_ok(&["commit", "-m", "first commit"]);
        run_ok(&["branch", "feat"]);
        run_ok(&["switch", "feat"]);
        fs::write(dir.join("b.txt"), "b\n").unwrap();
        run_ok(&["add", "--", "b.txt"]);
        run_ok(&["commit", "-m", "on feat"]);
        run_ok(&["switch", "main"]);
        run_ok(&["tag", "-a", "v1", "-m", "release"]);

        let g = log(&path, 0, 300, true, None, None, None).unwrap();
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].subject, "on feat");
        assert_eq!(g[0].parents, vec![g[1].hash.clone()]);
        assert!(g[1].refs.iter().any(|r| r == "HEAD -> main"));
        assert!(g[1].refs.iter().any(|r| r == "tag: v1"));
        assert_eq!(log(&path, 0, 300, false, None, None, None).unwrap().len(), 1, "현재 브랜치만");
        assert_eq!(log(&path, 1, 300, true, None, None, None).unwrap().len(), 1, "skip 페이징");
        assert_eq!(log(&path, 0, 300, true, Some("FEAT"), None, None).unwrap().len(), 1, "대소문자 무시 검색");
        assert_eq!(log(&path, 0, 300, true, Some("["), None, None).unwrap().len(), 0, "정규식 아님");
        assert_eq!(log(&path, 0, 300, false, None, None, Some("a.txt")).unwrap().len(), 1, "파일 히스토리");

        let r = refs(&path).unwrap();
        assert_eq!(r.local.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(), ["feat", "main"]);
        assert!(r.local[1].head);
        assert_eq!(r.tags[0].hash, g[1].hash, "주석 태그 → 커밋");

        let d = detail(&path, &g[0].hash).unwrap();
        assert_eq!((d.body.as_str(), d.author.as_str()), ("on feat", "t"));
        assert!(detail(&path, "--all").is_err());

        let b = blame(&path, "a.txt").unwrap();
        assert_eq!(b.len(), 10);
        assert_eq!(b[0].author, "t");
        assert_eq!(b[9].text, "10");

        // 덩어리 스테이징 — 떨어진 두 곳을 고치고 첫 덩어리만 인덱스로
        fs::write(dir.join("a.txt"), "1x\n2\n3\n4\n5\n6\n7\n8\n9\n10x\n").unwrap();
        let st = status(&path).unwrap();
        assert_eq!(st.files, vec![StatusFile { path: "a.txt".into(), from: None, x: " ".into(), y: "M".into() }]);
        assert!(!st.head_pushed);
        let p = file_patch(&path, "a.txt", false).unwrap();
        let first_hunk_end = p.match_indices("\n@@").nth(1).map(|(i, _)| i + 1).unwrap();
        let patch = &p[..first_hunk_end];
        assert!(apply_patch(&path, patch, false).unwrap().ok);
        let cached = file_patch(&path, "a.txt", true).unwrap();
        assert!(cached.contains("+1x") && !cached.contains("+10x"), "첫 덩어리만: {cached}");
        assert!(apply_patch(&path, patch, true).unwrap().ok, "되돌리기");
        assert!(file_patch(&path, "a.txt", true).unwrap().is_empty());
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "1x\n2\n3\n4\n5\n6\n7\n8\n9\n10x\n", "작업 트리 그대로");

        // 추적 · 무시 (W6 .env 칩)
        fs::write(dir.join(".gitignore"), ".env\n").unwrap();
        let ps = path_status(&path, &s(&["a.txt", ".env", "none.txt"]));
        assert!(ps[0].tracked && !ps[0].ignored);
        assert!(!ps[1].tracked && ps[1].ignored);
        assert!(!ps[2].tracked && !ps[2].ignored);
        fs::remove_file(dir.join(".gitignore")).unwrap();

        // 거부는 실행 전에 — 저장소는 그대로다
        assert!(run(&path, &s(&["clean", "-fd"])).is_err());
        // 원격 없는 push는 실패하지만 멈추지 않는다
        assert!(!run(&path, &s(&["push"])).unwrap().ok);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn blame_porcelain_reuses_commit_info() {
        let h = "a".repeat(40);
        let out = format!("{h} 1 1 2\nauthor kim\nauthor-time 100\nsummary x\nfilename f\n\tone\n{h} 2 2\n\ttwo\n");
        let b = parse_blame(&out);
        assert_eq!(b.len(), 2);
        assert_eq!((b[1].author.as_str(), b[1].time, b[1].text.as_str()), ("kim", 100, "two"));
    }
}
