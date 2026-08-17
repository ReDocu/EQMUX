// 워크스페이스 레지스트리 (PRD E §4.1) — 디스크의 git repo를 등록·나열·재지정·해제한다.
// 레지스트리는 앱 데이터의 workspaces.json, 원자적 쓰기(tmp → rename) (FR-E-07).
// 등록 해제는 레지스트리에서만 지우며 디스크는 건드리지 않는다 (FR-E-09).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Deserialize, Clone)]
pub struct WsEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub last_used: i64,
}

#[derive(Serialize)]
pub struct WsInfo {
    pub entry: WsEntry,
    pub exists: bool,
    pub is_repo: bool,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn registry_path(root: &Path) -> PathBuf {
    root.join("workspaces.json")
}

/// 읽기 전용 폴백 로드 — 파일이 없거나 깨졌으면 빈 목록 (목록 표시·크래시 스캔용)
pub fn load(root: &Path) -> Vec<WsEntry> {
    load_strict(root).unwrap_or_default()
}

/// 변경 경로용 엄격 로드 — 파일이 "있는데" 못 읽거나 못 파싱하면 Err.
/// 여기서 빈 목록으로 폴백한 채 진행하면 바로 다음 save가 레지스트리 전체를
/// 빈 파일로 덮어써 등록이 복구 불가로 사라진다. 없는 파일만 빈 목록이다.
pub fn load_strict(root: &Path) -> Result<Vec<WsEntry>, String> {
    let path = registry_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let s = fs::read_to_string(&path).map_err(|e| format!("workspaces.json 읽기 실패: {e}"))?;
    serde_json::from_str(&s).map_err(|e| format!("workspaces.json 파싱 실패: {e}"))
}

/// 원자적 쓰기 — tmp에 쓰고 fsync 후 rename. sync 없이 rename만 하면 전원 단절 시
/// rename 메타데이터만 먼저 커밋돼 0바이트/부분 파일이 target 자리에 남을 수 있다.
pub(crate) fn atomic_write(target: &Path, data: &[u8]) -> Result<(), String> {
    // 전체 파일명 + ".tmp" — with_extension은 team.json/team.md가 같은 team.tmp로 충돌한다
    let tmp = target.with_file_name(format!(
        "{}.tmp",
        target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    ));
    {
        use std::io::Write as _;
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, target).map_err(|e| e.to_string())
}

pub fn save(root: &Path, list: &[WsEntry]) -> Result<(), String> {
    let _ = fs::create_dir_all(root);
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    atomic_write(&registry_path(root), json.as_bytes())
}

/// git CLI 실행 — GUI 앱이므로 콘솔 창을 띄우지 않는다.
/// core.quotepath=off — 비ASCII(한글) 경로를 8진 이스케이프(`\355…`) 대신 그대로 출력한다.
/// 이게 없으면 status·diff·numstat 파싱이 한글 파일명에서 전부 어긋난다 (대상 사용자 상시).
/// git 호출 상한. index.lock 대기·자격증명 프롬프트·죽은 원격에 걸린 git은 스스로 끝나지
/// 않으므로 호출부가 영영 붙잡힌다 — 폴링 경로에서는 그게 매 주기 쌓인다.
/// 읽기 명령이 정상적으로 60초를 넘는 일은 없고, 큰 저장소의 checkout에는 넉넉하다.
const GIT_TIMEOUT: Duration = Duration::from_secs(60);
/// clone처럼 분 단위가 정상인 호출용 — 상한은 폭주 방지용 최후의 선일 뿐이다
const GIT_TIMEOUT_LONG: Duration = Duration::from_secs(60 * 60);

pub fn git(args: &[&str], cwd: &str) -> Result<String, String> {
    git_within(args, cwd, GIT_TIMEOUT)
}

/// 오래 걸리는 것이 정상인 git (clone 등) — 짧은 상한을 씌우면 정상 작업이 잘린다
pub fn git_long(args: &[&str], cwd: &str) -> Result<String, String> {
    git_within(args, cwd, GIT_TIMEOUT_LONG)
}

/// 자식 파이프 하나를 끝까지 읽는 스레드 — 반환은 join으로 회수한다
fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut p) = pipe {
            let _ = p.read_to_end(&mut buf);
        }
        buf
    })
}

/// 종료 확인 주기 — git 한 번이 보통 100ms 단위라 이 정도 지연은 묻힌다
const POLL: Duration = Duration::from_millis(20);

fn git_within(args: &[&str], cwd: &str, timeout: Duration) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.quotepath=off"])
        .args(args)
        .current_dir(cwd)
        // output()의 기본값과 같게 stdin을 막는다 — 상속하면 자격증명 프롬프트가 즉시
        // 실패하지 않고 입력을 기다리며 멈춘다 (상한이 있어도 그 시간을 통째로 쓴다)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("git 실행 실패: {e}"))?;
    // 두 파이프를 각각 전담 스레드가 끝까지 비운다. 이걸 안 하고 여기서 기다리면 출력이 큰
    // 명령(for-each-ref·log 등)에서 파이프가 차고 git이 write에서 멈춰 서로 교착한다.
    // 비우는 쪽이 따로 있으므로 아래 try_wait 폴링은 안전하다.
    let out_t = drain(child.stdout.take());
    let err_t = drain(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Err(e) => return Err(format!("git 실행 실패: {e}")),
            Ok(None) if Instant::now() >= deadline => {
                // 끊어야 파이프가 EOF를 내고 위 스레드들도 풀린다 — 안 그러면 스레드가 남는다
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "git 응답 없음 ({}초 초과): git {}",
                    timeout.as_secs(),
                    args.join(" ")
                ));
            }
            Ok(None) => std::thread::sleep(POLL),
        }
    };
    let stdout = out_t.join().unwrap_or_default();
    let stderr = err_t.join().unwrap_or_default();
    if status.success() {
        Ok(String::from_utf8_lossy(&stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&stderr).trim().to_string())
    }
}

pub fn is_repo(path: &str) -> bool {
    Path::new(path).join(".git").exists()
}

// ── 세션 워크트리 (FR-E-62 · E1′ 옵트인) — `<repo>/.eqmux/worktrees/<세션>` + 브랜치 `eqmux/<세션>` ──

fn path_component(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '@') { c } else { '_' })
        .collect()
}

pub fn worktree_dir(ws_path: &str, session: &str) -> PathBuf {
    Path::new(ws_path)
        .join(".eqmux")
        .join("worktrees")
        .join(path_component(session))
}

/// 워크트리 생성 공통 — `.eqmux/worktrees/<이름>` + 브랜치 `eqmux/<이름>`. 멱등: 이미 연결돼
/// 있으면 그대로 반환. base가 있으면 그 ref(브랜치·커밋·원격)에서 분기한다 (M36 — orca식
/// start-from). 삭제·정리는 하지 않는다 (FR-E-64 정책 — 커밋 안 된 작업은 사람이 정리한다).
pub fn worktree_create(ws_path: &str, name: &str, base: Option<&str>) -> Result<String, String> {
    let path = worktree_dir(ws_path, name);
    let p = path.to_string_lossy().into_owned();
    // 워크트리의 .git은 gitdir 포인터 "파일"이다 — 존재하면 이미 연결된 것
    if path.join(".git").exists() {
        return Ok(p);
    }
    crate::roles::ensure_gitignore(ws_path)?; // worktrees/가 status를 오염시키지 않게 (FR-E-35)
    let _ = git(&["worktree", "prune"], ws_path); // 디렉터리만 지워진 잔재 등록 정리
    let branch: String = format!(
        "eqmux/{}",
        name.chars()
            .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
            .collect::<String>()
    );
    // 새 브랜치로 시도(+base ref) → 브랜치가 이미 있으면(이전 흔적) 그 브랜치를 다시 연결.
    // base는 UI가 for-each-ref로 읽은 ref라 '--foo' 같은 크래프트된 ref 이름이 흘러들 수 있어
    // --end-of-options로 옵션 오인을 막는다 (p·branch는 앱 생성값이라 안전)
    let mut add_new: Vec<&str> = vec!["worktree", "add", &p, "-b", &branch];
    if let Some(b) = base.filter(|b| !b.trim().is_empty()) {
        add_new.push("--end-of-options");
        add_new.push(b);
    }
    if let Err(first) = git(&add_new, ws_path) {
        git(&["worktree", "add", &p, &branch], ws_path)
            .map_err(|second| format!("워크트리 생성 실패 — {first} / {second}"))?;
    }
    Ok(p)
}

/// 세션 워크트리 보장 (FR-E-62) — HEAD에서 분기하는 기존 계약 유지
pub fn worktree_ensure(ws_path: &str, session: &str) -> Result<String, String> {
    worktree_create(ws_path, session, None)
}

/// 기존 브랜치를 워크트리로 연결 (레일 §워크트리) — 새 브랜치를 만들지 않는다:
/// `.eqmux/worktrees/<브랜치명 정규화>`에 그 브랜치를 그대로 체크아웃한다. 멱등.
/// 로컬 브랜치만 받는다 — 원격 전용 이름은 detached로 붙는 모호함이 있어 거절한다
/// (git 패널 체크아웃으로 추적 브랜치를 먼저 만들면 된다). 이미 다른 워크트리(메인 포함)에
/// 체크아웃된 브랜치는 git이 거부한다 — 그 오류를 그대로 올려 화면이 정직하게 말하게 한다.
pub fn worktree_attach(ws_path: &str, branch: &str) -> Result<String, String> {
    git(
        &["rev-parse", "--verify", "--end-of-options", &format!("refs/heads/{branch}")],
        ws_path,
    )
    .map_err(|_| format!("로컬 브랜치가 아닙니다 — {branch}"))?;
    let path = worktree_dir(ws_path, branch); // path_component가 '/'를 '_'로 정규화한다
    let p = path.to_string_lossy().into_owned();
    // 워크트리의 .git은 gitdir 포인터 "파일"이다 — 존재하면 이미 연결된 것
    if path.join(".git").exists() {
        return Ok(p);
    }
    crate::roles::ensure_gitignore(ws_path)?; // worktrees/가 status를 오염시키지 않게 (FR-E-35)
    let _ = git(&["worktree", "prune"], ws_path); // 디렉터리만 지워진 잔재 등록 정리
    // branch는 UI가 for-each-ref로 읽은 이름이지만 크래프트 방지로 --end-of-options 뒤에 둔다
    git(&["worktree", "add", &p, "--end-of-options", branch], ws_path)
        .map_err(|e| format!("워크트리 연결 실패 — {e}"))?;
    Ok(p)
}

/// 워크트리 목록 항목 (M36) — 외부에서 만든 워크트리도 잡힌다 (순수 git 호환)
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>, // detached HEAD면 None
    pub head: String,           // 짧은 해시
    pub is_main: bool,          // 저장소 본체 (porcelain 첫 항목)
    pub is_session: bool,       // .eqmux/worktrees/ 아래 — 앱이 만든 것
}

/// `git worktree list --porcelain` 파싱 (M36) — 항목은 빈 줄로 구분되고
/// worktree/HEAD/branch(또는 detached) 줄이 이어진다
pub fn worktree_list(ws_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let out = git(&["worktree", "list", "--porcelain"], ws_path)?;
    let mut items: Vec<WorktreeInfo> = Vec::new();
    let mut cur: Option<WorktreeInfo> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(w) = cur.take() {
                items.push(w);
            }
            cur = Some(WorktreeInfo {
                path: p.to_string(),
                branch: None,
                head: String::new(),
                is_main: items.is_empty(),
                is_session: p.replace('\\', "/").contains("/.eqmux/worktrees/"),
            });
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            if let Some(w) = cur.as_mut() {
                w.head = h.chars().take(8).collect();
            }
        } else if let Some(b) = line.strip_prefix("branch ") {
            if let Some(w) = cur.as_mut() {
                w.branch = Some(b.trim_start_matches("refs/heads/").to_string());
            }
        }
    }
    if let Some(w) = cur.take() {
        items.push(w);
    }
    Ok(items)
}

/// 체크아웃 후보 브랜치 (M36) — 로컬 + 원격 전용 이름. 원격 전용은 checkout 시
/// git의 DWIM이 추적 브랜치를 만들므로 ws_checkout 경로가 그대로 성립한다.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    pub remote: bool, // 로컬에 없고 원격에만 있는 이름
}

pub fn branch_list(ws_path: &str) -> Result<Vec<BranchInfo>, String> {
    let current = git(&["rev-parse", "--abbrev-ref", "HEAD"], ws_path).unwrap_or_default();
    let locals = git(&["for-each-ref", "--format=%(refname:short)", "refs/heads"], ws_path)?;
    let remotes =
        git(&["for-each-ref", "--format=%(refname:short)", "refs/remotes"], ws_path).unwrap_or_default();
    let mut out: Vec<BranchInfo> = Vec::new();
    for l in locals.lines().map(str::trim).filter(|l| !l.is_empty()) {
        out.push(BranchInfo { name: l.to_string(), current: l == current, remote: false });
    }
    for r in remotes.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let Some((_, name)) = r.split_once('/') else { continue };
        if name == "HEAD" || name.is_empty() || out.iter().any(|b| b.name == name) {
            continue;
        }
        out.push(BranchInfo { name: name.to_string(), current: false, remote: true });
    }
    Ok(out)
}

/// 등록 항목의 현재 상태 실측 — 존재 여부·브랜치·원격 (FR-E-03·08)
pub fn inspect(entry: &WsEntry) -> WsInfo {
    let exists = Path::new(&entry.path).is_dir();
    let repo = exists && is_repo(&entry.path);
    let mut e = entry.clone();
    if repo {
        e.branch = git(&["branch", "--show-current"], &e.path)
            .ok()
            .filter(|s| !s.is_empty());
        e.remote = git(&["remote", "get-url", "origin"], &e.path).ok();
    }
    WsInfo { entry: e, exists, is_repo: repo }
}

// ── git 패널 실데이터 (PRD H) — 읽기 전용 관측. 쓰기 작업(pull·push·commit)은 제공하지 않는다 ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub when: String,
    pub refs: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOverview {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub changed: u32,
    pub added: u32,
    pub modified: u32,
    pub deleted: u32,
    pub commits: Vec<GitCommitInfo>,
}

/// 저장소 개요 실측 — 브랜치·업스트림 격차·작업트리 요약·최근 커밋.
/// 업스트림이 없으면 ahead/behind는 0으로 둔다 (오류가 아니다).
pub fn overview(path: &str) -> Result<GitOverview, String> {
    if !is_repo(path) {
        return Err("git 저장소가 아닙니다".into());
    }
    let branch = git(&["branch", "--show-current"], path)
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            git(&["rev-parse", "--short", "HEAD"], path)
                .ok()
                .map(|h| format!("(분리됨 {h})"))
        })
        .unwrap_or_else(|| "(빈 저장소)".into());
    let (behind, ahead) = git(&["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], path)
        .ok()
        .and_then(|s| {
            let mut it = s.split_whitespace();
            Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
        })
        .unwrap_or((0, 0));
    let mut added = 0u32;
    let mut modified = 0u32;
    let mut deleted = 0u32;
    let mut changed = 0u32;
    if let Ok(status) = git(&["status", "--porcelain"], path) {
        for line in status.lines() {
            let mut chars = line.chars();
            let (Some(x), Some(y)) = (chars.next(), chars.next()) else { continue };
            changed += 1;
            if x == '?' || x == 'A' {
                added += 1;
            } else if x == 'D' || y == 'D' {
                deleted += 1;
            } else {
                modified += 1;
            }
        }
    }
    let commits = git(&["log", "-n", "8", "--pretty=format:%h\t%s\t%an\t%cr\t%D"], path)
        .map(|out| {
            out.lines()
                .map(|l| {
                    let mut p = l.splitn(5, '\t');
                    GitCommitInfo {
                        hash: p.next().unwrap_or_default().into(),
                        message: p.next().unwrap_or_default().into(),
                        author: p.next().unwrap_or_default().into(),
                        when: p.next().unwrap_or_default().into(),
                        refs: p.next().unwrap_or_default().into(),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(GitOverview { branch, ahead, behind, changed, added, modified, deleted, commits })
}

/// 경로에서 안정적 id 파생 — 폴더명 + 경로 해시. 재시작해도 같은 id (스토어 DB 경로의 키).
pub fn make_id(path: &str) -> String {
    let name = Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "repo".into());
    let mut hash: u32 = 2_166_136_261;
    for b in path.to_lowercase().bytes() {
        hash ^= u32::from(b);
        hash = hash.wrapping_mul(16_777_619);
    }
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    format!("{}-{:06x}", safe, hash & 0xFF_FFFF)
}

pub fn entry_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repo".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// git() 재작성의 유일한 위험 지점 — 파이프를 계속 비우지 않으면 출력이 64KB를 넘는
    /// 순간 git이 write에서 멈춰 이 테스트가 타임아웃까지 걸린다 (교착 회귀 감지).
    #[test]
    fn git_drains_large_output() {
        let out = git(&["log", "-p", "-n", "30"], ".").unwrap();
        assert!(out.len() > 64 * 1024, "출력이 파이프 버퍼보다 작아 회귀를 못 잡는다: {}B", out.len());
    }

    /// 레지스트리 보호 (QA C-5) — 손상 파일은 변경 경로에서 Err, 없는 파일만 빈 목록.
    /// atomic_write 왕복과 team.json/team.md식 이름 충돌 없는 tmp도 함께 확인한다.
    #[test]
    fn load_strict_rejects_corrupt_registry() {
        let dir = std::env::temp_dir().join(format!("eqmux-reg-{}", now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(load_strict(&dir).unwrap().len(), 0); // 없는 파일 = 빈 목록
        let entry = WsEntry {
            id: "ws1".into(),
            name: "ws1".into(),
            path: "C:\\w".into(),
            remote: None,
            branch: None,
            last_used: 1,
        };
        save(&dir, &[entry]).unwrap();
        assert_eq!(load_strict(&dir).unwrap().len(), 1);
        assert!(!dir.join("workspaces.json.tmp").exists()); // rename 완료 — tmp 잔재 없음
        fs::write(dir.join("workspaces.json"), "{broken").unwrap();
        assert!(load_strict(&dir).is_err()); // 손상 = 변경 경로 차단 (빈 목록 덮어쓰기 방지)
        assert!(load(&dir).is_empty()); // 읽기 전용 폴백은 빈 목록
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overview_reads_a_real_repo() {
        let dir = std::env::temp_dir().join(format!("eqmux-git-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        git(&["init"], &path).unwrap();
        git(&["config", "user.email", "t@t"], &path).unwrap();
        git(&["config", "user.name", "t"], &path).unwrap();
        assert!(overview(&path).is_ok(), "빈 저장소도 오류가 아니어야 한다");
        fs::write(dir.join("a.txt"), "hi").unwrap();
        git(&["add", "."], &path).unwrap();
        git(&["commit", "-m", "first"], &path).unwrap();
        fs::write(dir.join("b.txt"), "new").unwrap(); // untracked → 추가로 집계
        let o = overview(&path).unwrap();
        assert!(!o.branch.is_empty());
        assert_eq!((o.changed, o.added), (1, 1));
        assert_eq!(o.commits.len(), 1);
        assert_eq!(o.commits[0].message, "first");
        assert_eq!((o.ahead, o.behind), (0, 0)); // 업스트림 없음 = 0/0
        fs::remove_dir_all(&dir).ok();
    }

    /// 세션 워크트리 (FR-E-62) — 생성·멱등·전용 브랜치·gitignore. 삭제는 하지 않는다 (FR-E-64)
    #[test]
    fn worktree_ensure_is_idempotent_with_own_branch() {
        let dir = std::env::temp_dir().join(format!("eqmux-wt-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        git(&["init"], &path).unwrap();
        git(&["config", "user.email", "t@t"], &path).unwrap();
        git(&["config", "user.name", "t"], &path).unwrap();
        fs::write(dir.join("a.txt"), "hi").unwrap();
        git(&["add", "."], &path).unwrap();
        git(&["commit", "-m", "first"], &path).unwrap();

        let wt = worktree_ensure(&path, "kai@ws1").unwrap();
        assert!(Path::new(&wt).join(".git").exists(), "워크트리 gitdir 포인터가 있어야 한다");
        assert!(Path::new(&wt).join("a.txt").exists(), "체크아웃이 있어야 한다");
        let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &wt).unwrap();
        assert_eq!(branch, "eqmux/kai-ws1"); // '@'는 브랜치명에서 '-'로
        assert_eq!(worktree_ensure(&path, "kai@ws1").unwrap(), wt); // 멱등
        // .eqmux/.gitignore가 worktrees/를 가린다 (FR-E-35 확장)
        let ignore = fs::read_to_string(dir.join(".eqmux").join(".gitignore")).unwrap();
        assert!(ignore.lines().any(|l| l.trim() == "worktrees/"));
        // 디렉터리만 지운 잔재 → prune 후 재생성 (기존 브랜치 재연결)
        fs::remove_dir_all(&wt).unwrap();
        let again = worktree_ensure(&path, "kai@ws1").unwrap();
        assert!(Path::new(&again).join("a.txt").exists());
        fs::remove_dir_all(&dir).ok();
    }

    /// 레일 §워크트리 — 기존 브랜치 연결: 새 브랜치 없이 그 브랜치를 체크아웃, 멱등.
    /// 체크아웃 중인 브랜치·로컬에 없는 이름은 거절한다 (git 제약을 정직하게 올린다)
    #[test]
    fn worktree_attach_checks_out_existing_branch() {
        let dir = std::env::temp_dir().join(format!("eqmux-wta-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        git(&["init"], &path).unwrap();
        git(&["config", "user.email", "t@t"], &path).unwrap();
        git(&["config", "user.name", "t"], &path).unwrap();
        fs::write(dir.join("a.txt"), "1").unwrap();
        git(&["add", "."], &path).unwrap();
        git(&["commit", "-m", "first"], &path).unwrap();
        let current = git(&["rev-parse", "--abbrev-ref", "HEAD"], &path).unwrap();
        git(&["branch", "feature/x"], &path).unwrap(); // 브랜치만 있고 트리는 없다

        let wt = worktree_attach(&path, "feature/x").unwrap();
        assert!(wt.replace('\\', "/").contains("/.eqmux/worktrees/feature_x")); // '/'는 경로에서 '_'
        assert_eq!(git(&["rev-parse", "--abbrev-ref", "HEAD"], &wt).unwrap(), "feature/x"); // 새 브랜치 없음
        assert_eq!(worktree_attach(&path, "feature/x").unwrap(), wt); // 멱등

        // 이미 메인 트리에 체크아웃된 브랜치 — git이 거부, 오류로 올라온다
        assert!(worktree_attach(&path, &current).is_err());
        // 로컬에 없는 이름 — rev-parse 검증에서 거절
        assert!(worktree_attach(&path, "no-such-branch").is_err());
        fs::remove_dir_all(&dir).ok();
    }

    /// M36 — base ref 분기 생성 + 목록·브랜치 실측 (git 패널 안전 범위의 원천)
    #[test]
    fn worktree_create_with_base_and_lists() {
        let dir = std::env::temp_dir().join(format!("eqmux-wtl-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        git(&["init"], &path).unwrap();
        git(&["config", "user.email", "t@t"], &path).unwrap();
        git(&["config", "user.name", "t"], &path).unwrap();
        fs::write(dir.join("a.txt"), "1").unwrap();
        git(&["add", "."], &path).unwrap();
        git(&["commit", "-m", "first"], &path).unwrap();
        // base 브랜치를 만들고 한 커밋 더 — 워크트리가 여기서 분기해야 한다
        git(&["checkout", "-b", "base-b"], &path).unwrap();
        fs::write(dir.join("b.txt"), "2").unwrap();
        git(&["add", "."], &path).unwrap();
        git(&["commit", "-m", "second"], &path).unwrap();
        let base_tip = git(&["rev-parse", "HEAD"], &path).unwrap();
        let default_branch = "base-b"; // 현재 브랜치

        let wt = worktree_create(&path, "feat-x", Some("base-b")).unwrap();
        assert_eq!(git(&["rev-parse", "HEAD"], &wt).unwrap(), base_tip); // base에서 분기
        assert!(Path::new(&wt).join("b.txt").exists());

        // 목록 — 본체 + 세션 워크트리, porcelain 파싱
        let listed = worktree_list(&path).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed[0].is_main && !listed[0].is_session);
        assert!(!listed[1].is_main && listed[1].is_session);
        assert_eq!(listed[1].branch.as_deref(), Some("eqmux/feat-x"));
        assert!(!listed[1].head.is_empty());

        // 브랜치 후보 — 현재 표시 + 워크트리 브랜치 포함, 원격 없음이므로 remote 항목 없음
        let branches = branch_list(&path).unwrap();
        assert!(branches.iter().any(|b| b.name == default_branch && b.current));
        assert!(branches.iter().any(|b| b.name == "eqmux/feat-x" && !b.current));
        assert!(branches.iter().all(|b| !b.remote));
        fs::remove_dir_all(&dir).ok();
    }
}
