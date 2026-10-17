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
    /// 다른 프로젝트 메시지 받기 (0.5 결정 10) — 기본 켬. 끄면 다른 프로젝트 발신이 오류로 돌아간다
    #[serde(default = "default_true")]
    pub cross_project: bool,
}

fn default_true() -> bool {
    true
}

/// 다른 프로젝트 메시지 받기 토글 (워크스페이스 탭 메뉴 — W4)
pub fn set_cross_project(root: &Path, id: &str, on: bool) -> Result<(), String> {
    let mut list = load_strict(root)?;
    let w = list.iter_mut().find(|w| w.id == id).ok_or("UNKNOWN_WORKSPACE")?;
    w.cross_project = on;
    save(root, &list)
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
    atomic_write(&registry_path(root), json.as_bytes())?;
    mirror(root, "workspaces.json", json.as_bytes());
    Ok(())
}

/// 앱 데이터 폴더 옆의 사본 폴더(`com.eqment.eqmux.backup`). 0.4.x 이하는 data.ver가 다르면
/// 앱 데이터 폴더 안을 비운다 (docs/data-loss-investigation-2026-10-17.md) — 옆 폴더에는 닿지 않는다.
fn backup_dir(root: &Path) -> PathBuf {
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    root.with_file_name(format!("{name}.backup"))
}

/// 저장한 내용을 사본 폴더에도 쓴다 — 최선 노력, 실패해도 본 저장은 성공이다
pub(crate) fn mirror(root: &Path, name: &str, data: &[u8]) {
    let dir = backup_dir(root);
    if fs::create_dir_all(&dir).is_ok() {
        let _ = atomic_write(&dir.join(name), data);
    }
}

/// 시작 시 1회 — 사본에만 있는 등록을 되살린다. 되살린 것이 있으면 배치도 사본으로 돌린다
/// (지금 배치는 wipe 뒤 빈 상태로 다시 쓰인 것이다). 배치 파일이 없을 때도 사본으로 채운다.
/// 되살린 등록 수를 돌려준다. 등록 해제는 사본에도 같이 반영되므로 되살아나지 않는다.
pub fn restore_backup(root: &Path) -> usize {
    let Ok(mut list) = load_strict(root) else {
        return 0; // 깨진 등록부를 사본으로 덮지 않는다 — 변경 경로가 오류로 알린다
    };
    let bak = backup_dir(root);
    let saved: Vec<WsEntry> = fs::read_to_string(bak.join("workspaces.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let before = list.len();
    for e in saved {
        if !list.iter().any(|w| w.id == e.id) {
            list.push(e);
        }
    }
    let restored = list.len() - before;
    let layout = root.join("layout.json");
    if restored > 0 || !layout.exists() {
        let _ = fs::copy(bak.join("layout.json"), &layout);
    }
    // 저장이 사본도 쓴다 — 0.5.1로 처음 올라온 실행에서 사본이 여기서 생긴다
    if restored > 0 || registry_path(root).exists() {
        let _ = save(root, &list);
    }
    restored
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

/// 세션 워크트리 보장 (FR-E-62) — `.eqmux/worktrees/<세션>` + 브랜치 `eqmux/<세션>`, HEAD에서 분기.
/// 멱등: 이미 연결돼 있으면 그대로 반환. 삭제·정리는 하지 않는다 (FR-E-64 정책 — 커밋 안 된
/// 작업은 사람이 정리한다).
pub fn worktree_ensure(ws_path: &str, session: &str) -> Result<String, String> {
    let path = worktree_dir(ws_path, session);
    let p = path.to_string_lossy().into_owned();
    // 워크트리의 .git은 gitdir 포인터 "파일"이다 — 존재하면 이미 연결된 것
    if path.join(".git").exists() {
        return Ok(p);
    }
    crate::roles::ensure_gitignore(ws_path)?; // worktrees/가 status를 오염시키지 않게 (FR-E-35)
    let _ = git(&["worktree", "prune"], ws_path); // 디렉터리만 지워진 잔재 등록 정리
    let branch: String = format!(
        "eqmux/{}",
        session.chars()
            .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
            .collect::<String>()
    );
    // 새 브랜치로 시도 → 브랜치가 이미 있으면(이전 흔적) 그 브랜치를 다시 연결
    if let Err(first) = git(&["worktree", "add", &p, "-b", &branch], ws_path) {
        git(&["worktree", "add", &p, &branch], ws_path)
            .map_err(|second| format!("워크트리 생성 실패 — {first} / {second}"))?;
    }
    Ok(p)
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
    // -uall — 새 폴더가 한 줄로 접히면 diff 뱃지가 실제 새 파일 수보다 작게 나온다 (B60)
    if let Ok(status) = git(&["status", "--porcelain", "-uall"], path) {
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
            cross_project: false,
        };
        save(&dir, &[entry]).unwrap();
        assert_eq!(load_strict(&dir).unwrap().len(), 1);
        // 받기 토글 — 저장·되읽기, 키가 없던 0.4.2 레코드는 켬
        set_cross_project(&dir, "ws1", true).unwrap();
        assert!(load_strict(&dir).unwrap()[0].cross_project);
        assert!(set_cross_project(&dir, "none", true).is_err());
        let old: WsEntry = serde_json::from_str(r#"{"id":"a","name":"a","path":"p","remote":null,"branch":null,"last_used":0}"#).unwrap();
        assert!(old.cross_project);
        assert!(!dir.join("workspaces.json.tmp").exists()); // rename 완료 — tmp 잔재 없음
        fs::write(dir.join("workspaces.json"), "{broken").unwrap();
        assert!(load_strict(&dir).is_err()); // 손상 = 변경 경로 차단 (빈 목록 덮어쓰기 방지)
        assert!(load(&dir).is_empty()); // 읽기 전용 폴백은 빈 목록
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(backup_dir(&dir));
    }

    /// 데이터 소실 안전망 — 옛 버전의 wipe(등록부·배치 삭제) 뒤 새 등록 하나가 생긴 상태에서
    /// 사본의 등록을 합치고 배치를 되돌린다. 등록 해제는 사본에도 반영돼 되살아나지 않는다.
    #[test]
    fn restore_backup_recovers_wiped_registry() {
        let dir = std::env::temp_dir().join(format!("eqmux-bak-{}", now_ms()));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(backup_dir(&dir));
        let e = |id: &str| WsEntry {
            id: id.into(),
            name: id.into(),
            path: "C:\\w".into(),
            remote: None,
            branch: None,
            last_used: 1,
            cross_project: true,
        };
        save(&dir, &[e("a"), e("b"), e("c")]).unwrap();
        save(&dir, &[e("a"), e("b")]).unwrap(); // c 등록 해제
        mirror(&dir, "layout.json", b"{\"open\":[\"a\"]}");
        // wipe 흉내 — 등록부·배치가 지워지고 새 실행이 등록 하나를 다시 썼다
        fs::remove_dir_all(&dir).unwrap();
        fs::create_dir_all(&dir).unwrap();
        let reg = dir.join("workspaces.json");
        fs::write(&reg, serde_json::to_string(&[e("new")]).unwrap()).unwrap();
        fs::write(dir.join("layout.json"), "{\"open\":[]}").unwrap();

        assert_eq!(restore_backup(&dir), 2);
        let ids: Vec<String> = load_strict(&dir).unwrap().into_iter().map(|w| w.id).collect();
        assert_eq!(ids, ["new", "a", "b"]);
        assert_eq!(fs::read_to_string(dir.join("layout.json")).unwrap(), "{\"open\":[\"a\"]}");
        assert_eq!(restore_backup(&dir), 0); // 사본도 합친 목록으로 갱신됐다
        fs::write(&reg, "{broken").unwrap();
        assert_eq!(restore_backup(&dir), 0); // 깨진 등록부는 손대지 않는다
        assert_eq!(fs::read_to_string(&reg).unwrap(), "{broken");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(backup_dir(&dir));
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
}
