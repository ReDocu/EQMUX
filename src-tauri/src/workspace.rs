// 워크스페이스 레지스트리 (PRD E §4.1) — 디스크의 git repo를 등록·나열·재지정·해제한다.
// 레지스트리는 앱 데이터의 workspaces.json, 원자적 쓰기(tmp → rename) (FR-E-07).
// 등록 해제는 레지스트리에서만 지우며 디스크는 건드리지 않는다 (FR-E-09).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
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

/// 진행 중 clone 취소 깃발 (P72) — 프런트가 한 번에 하나만 돌리므로 전역 하나로 족하다
pub static CLONE_CANCEL: AtomicBool = AtomicBool::new(false);

/// clone 대상 폴더 이름 — git이 고르는 이름과 같게 주소 끝 조각에서 `.git`을 뗀다.
/// `host:repo.git`(scp 꼴) · 로컬 경로(`\`)도 끝 조각만 (P72 — 이름을 git에 직접 넘기므로 맞아야 한다)
pub fn clone_name(url: &str) -> String {
    let tail = url.trim_end_matches(['/', '\\']).rsplit(['/', '\\', ':']).next().unwrap_or("");
    let name = tail.strip_suffix(".git").unwrap_or(tail);
    if name.is_empty() { "repo".into() } else { name.to_string() }
}

/// stderr 조각을 `\r` · `\n`에서 자른다 — git 진행률은 `\r`로 같은 줄을 덮어쓴다 (P72)
fn cut_lines(pending: &mut Vec<u8>, chunk: &[u8], out: &mut Vec<String>) {
    for &b in chunk {
        if b != b'\r' && b != b'\n' {
            pending.push(b);
        } else if !pending.is_empty() {
            out.push(String::from_utf8_lossy(pending).into_owned());
            pending.clear();
        }
    }
}

/// 진행 줄(`Receiving objects:  42% …` · `…, done.`) — 실패 문구에서 뺀다. 원래 오류에는 없던 줄이다
fn is_progress(line: &str) -> bool {
    line.contains('%') || line.ends_with(", done.")
}

/// 원격 clone (FR-E-02 · P72) — `--progress`의 stderr를 줄마다 on_progress로 넘기고, CLONE_CANCEL이
/// 서면 자식 트리째 끝낸다. 취소 · 상한 초과면 이 clone이 만든 폴더를 지우고
/// `CLONE_CANCELLED|<남은 경로>` · `CLONE_TIMEOUT|<남은 경로>`로 끝난다(지웠으면 경로가 빈다). 원래 있던 폴더는 두 경우 모두 남긴다
pub fn clone_repo(url: &str, parent: &str, mut on_progress: impl FnMut(&str)) -> Result<String, String> {
    let name = clone_name(url);
    let dest = Path::new(parent).join(&name);
    let existed = dest.exists();
    let mut cmd = Command::new("git");
    // `--` — '-'로 시작하는 주소가 옵션으로 읽히지 않게. stdin은 run_git과 같은 이유로 막는다
    cmd.args(["-c", "core.quotepath=off", "clone", "--progress", "--", url, &name])
        .current_dir(parent)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // kill_tree가 그룹째 끝낼 수 있게
    }
    CLONE_CANCEL.store(false, Ordering::SeqCst);
    let mut child = cmd.spawn().map_err(|e| format!("git 실행 실패: {e}"))?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let pipe = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let (mut pending, mut buf, mut out) = (Vec::new(), [0u8; 4096], Vec::new());
        if let Some(mut p) = pipe {
            while let Ok(n @ 1..) = p.read(&mut buf) {
                cut_lines(&mut pending, &buf[..n], &mut out);
                for l in out.drain(..) {
                    let _ = tx.send(l);
                }
            }
        }
        cut_lines(&mut pending, b"\n", &mut out);
        for l in out {
            let _ = tx.send(l);
        }
    });
    let mut kept = Vec::new();
    let mut take = |rx: &std::sync::mpsc::Receiver<String>, kept: &mut Vec<String>| {
        let lines: Vec<String> = rx.try_iter().collect();
        if let Some(last) = lines.last() {
            on_progress(last); // 한 주기에 마지막 줄만 — 이벤트가 초당 수백 번 날지 않게
        }
        kept.extend(lines.into_iter().filter(|l| !is_progress(l)));
    };
    let deadline = Instant::now() + GIT_TIMEOUT_LONG;
    let status = loop {
        take(&rx, &mut kept);
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if !CLONE_CANCEL.load(Ordering::SeqCst) && Instant::now() < deadline => std::thread::sleep(POLL),
            // 취소 · 상한 · 대기 실패 — 끊어야 파이프가 EOF를 내고 읽기 스레드가 풀린다. git clone은
            // git-remote-https · index-pack을 띄우므로 자식만 죽이면 손자가 폴더를 쥔 채 남는다
            _ => {
                crate::extensions::kill_tree(&mut child);
                let _ = child.wait();
                break None;
            }
        }
    };
    let _ = reader.join();
    take(&rx, &mut kept);
    match status {
        Some(st) if st.success() => Ok(dest.to_string_lossy().into_owned()),
        Some(_) => Err(kept.join("\n").trim().to_string()),
        None => {
            let code = if CLONE_CANCEL.load(Ordering::SeqCst) { "CLONE_CANCELLED" } else { "CLONE_TIMEOUT" };
            let left = if existed || !remove_retry(&dest) { dest.to_string_lossy().into_owned() } else { String::new() };
            Err(format!("{code}|{left}"))
        }
    }
}

/// 받다 만 폴더 지우기 — 죽은 git의 손자가 파일 핸들을 늦게 놓으면(Windows) 첫 시도가 실패한다. 2초까지 다시 해 본다
fn remove_retry(dir: &Path) -> bool {
    for _ in 0..10 {
        if !dir.exists() || fs::remove_dir_all(dir).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    !dir.exists()
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
    let o = run_git(args, cwd, timeout, &[])?;
    if o.ok {
        Ok(o.stdout.trim().to_string())
    } else {
        Err(o.stderr.trim().to_string())
    }
}

/// git 한 번의 원래 결과 — 앞 공백을 지우면 안 되는 출력(`status --porcelain`의 ` M`)과
/// 성공해도 stderr에 남는 훅 출력을 그대로 받는다 (§17 git 화면)
pub struct GitOut {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// 실행 실패(띄우기 실패 · 상한 초과)만 Err — git이 0이 아닌 코드로 끝난 것은 `ok: false`
pub fn run_git(args: &[&str], cwd: &str, timeout: Duration, env: &[(&str, &str)]) -> Result<GitOut, String> {
    let mut cmd = Command::new("git");
    // --no-optional-locks — status · diff의 색인 새로 고침이 index.lock을 잡지 않게 한다. 10초 폴링이
    // 터미널의 git commit과 부딪혀 "index.lock exists"로 실패시키던 길이다. 쓰기는 필요한 잠금을 그대로 잡는다
    cmd.args(["--no-optional-locks", "-c", "core.quotepath=off"])
        .args(args)
        .current_dir(cwd)
        // B299 — 판정(인증 실패 · 빈 저장소 · 실패 원인 · 안내)은 git 영어 원문을 본다. 메시지 언어만 고정한다.
        // LC_MESSAGES=C가 기본, 사용자가 LC_ALL을 걸어 두었으면 LANGUAGE가 이긴다. LC_ALL은 훅 출력 인코딩까지 바꿔 쓰지 않는다
        .envs([("LC_MESSAGES", "C"), ("LANGUAGE", "en")])
        .envs(env.iter().copied())
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
    Ok(GitOut {
        ok: status.success(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
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

/// 워크트리 목록 항목 — 외부에서 만든 워크트리도 잡힌다 (순수 git 호환). 레일 표시 전용
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>, // detached HEAD면 None
    pub head: String,           // 짧은 해시
    pub is_main: bool,          // 저장소 본체 (porcelain 첫 항목)
    pub is_session: bool,       // .eqmux/worktrees/ 아래 — 앱이 만든 것
    pub key: String,            // 비교 키 (canon_key) — 세션 cwd는 path_keys로 같은 키를 받아 비교한다 (B132 · B151)
}

/// 경로 비교 키 (B132 · B151) — 실경로(심링크 · mac `/tmp` → `/private/tmp`), Windows `\\?\` 접두를 벗기고,
/// 구분자는 `/`, 끝 `/` 없음, Windows만 소문자. 없는 경로는 정규화만 한다.
/// ponytail: mac 대소문자 무시 볼륨은 철자가 다르면 갈린다 — 실기에서 보이면 그때 접는다
pub fn canon_key(p: &str) -> String {
    let real = fs::canonicalize(p).map(|r| r.to_string_lossy().into_owned()).unwrap_or_else(|_| p.to_string());
    let real = match real.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}"),
        None => real.strip_prefix(r"\\?\").unwrap_or(&real).to_string(),
    };
    let k = real.replace('\\', "/");
    let k = if k.len() > 1 { k.trim_end_matches('/').to_string() } else { k };
    if cfg!(windows) { k.to_lowercase() } else { k }
}

/// 세션 cwd 등 여러 경로의 비교 키 — 순서대로 (관제 레일 워크트리 소속 판정)
#[tauri::command]
pub async fn path_keys(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| canon_key(p)).collect())
        .await
        .map_err(|e| e.to_string())
}

/// `git worktree list --porcelain` 파싱 — 항목은 빈 줄로 구분되고
/// worktree/HEAD/branch(또는 detached) 줄이 이어진다
pub fn worktree_list(ws_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let out = git(&["worktree", "list", "--porcelain"], ws_path)?;
    let mut items: Vec<WorktreeInfo> = Vec::new();
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            items.push(WorktreeInfo {
                path: p.to_string(),
                branch: None,
                head: String::new(),
                is_main: items.is_empty(),
                is_session: p.replace('\\', "/").contains("/.eqmux/worktrees/"),
                key: canon_key(p),
            });
        } else if let (Some(h), Some(w)) = (line.strip_prefix("HEAD "), items.last_mut()) {
            w.head = h.chars().take(8).collect();
        } else if let (Some(b), Some(w)) = (line.strip_prefix("branch "), items.last_mut()) {
            w.branch = Some(b.trim_start_matches("refs/heads/").to_string());
        }
    }
    Ok(items)
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

// ── git 패널 실데이터 (PRD H) — 읽기 전용 관측. 쓰기는 gitx.rs (§17 G7′ — git 화면에서 사람이 누를 때만) ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub message: String,
    pub author: String,
    /// 커밋 시각 epoch ms — 상대 시각은 프런트가 화면 언어로 만든다 (U173 · git %cr은 늘 영어였다)
    pub when: i64,
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
    let commits = git(&["log", "-n", "8", "--pretty=format:%h\t%s\t%an\t%ct\t%D"], path)
        .map(|out| {
            out.lines()
                .map(|l| {
                    let mut p = l.splitn(5, '\t');
                    GitCommitInfo {
                        hash: p.next().unwrap_or_default().into(),
                        message: p.next().unwrap_or_default().into(),
                        author: p.next().unwrap_or_default().into(),
                        when: p.next().and_then(|t| t.parse::<i64>().ok()).unwrap_or(0) * 1000,
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

// ── 등록 · 해제 · 되돌리기 · 재지정 · 이름 (B289 · B290 · S23) ──
// id는 대화 원장 · 스크롤백 · 재개 앵커 · 배치의 키다. 경로를 재지정한 항목은 경로에서 같은 id가 다시
// 나오지 않으므로, 해제한 항목을 레지스트리 옆에 남겨 [되돌리기]와 같은 폴더 재등록이 옛 id를 되찾게 한다.
// 경로 비교는 canon_key — 끝 '\' · 구분자 · 대소문자가 달라도 같은 폴더다.

/// 해제 목록에 남길 수 — 되돌리기 · 다시 등록에 쓸 만큼만
const GONE_KEEP: usize = 20;

fn gone_path(root: &Path) -> PathBuf {
    root.join("workspaces.gone.json")
}

fn load_gone(root: &Path) -> Vec<WsEntry> {
    fs::read_to_string(gone_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 최선 노력 — 못 남기면 되돌리기가 '되돌릴 등록 정보가 없습니다'로 끝날 뿐 레지스트리는 멀쩡하다
fn save_gone(root: &Path, gone: &[WsEntry]) {
    if let Ok(json) = serde_json::to_string_pretty(gone) {
        let _ = atomic_write(&gone_path(root), json.as_bytes());
    }
}

fn taken_by<'a>(list: &'a [WsEntry], path: &str, except: &str) -> Option<&'a WsEntry> {
    let key = canon_key(path);
    list.iter().find(|e| e.id != except && canon_key(&e.path) == key)
}

fn already(e: &WsEntry) -> String {
    format!("이미 등록된 폴더입니다 — {}", e.name)
}

/// 등록 (FR-E-01) — 같은 폴더가 있으면 그 항목. 해제해 둔 항목이 있으면 그 id · 이름으로 되살린다
pub fn register(root: &Path, path: &str) -> Result<WsEntry, String> {
    let mut list = load_strict(root)?;
    if let Some(i) = taken_by(&list, path, "").map(|e| e.id.clone()) {
        let e = list.iter_mut().find(|e| e.id == i).expect("방금 찾았다");
        e.last_used = now_ms();
        let e = e.clone();
        save(root, &list)?;
        return Ok(e);
    }
    let mut gone = load_gone(root);
    let key = canon_key(path);
    let revive = gone.iter().rposition(|g| canon_key(&g.path) == key && !list.iter().any(|w| w.id == g.id));
    let entry = match revive {
        Some(i) => WsEntry { path: path.to_string(), last_used: now_ms(), ..gone.remove(i) },
        None => {
            // 이 경로의 id를 다른 항목이 이미 쓴다 — 그 항목을 재지정해 옮긴 경우다. 둘의 기록이 섞이지 않게 뒤를 붙인다
            let base = make_id(path);
            let (mut id, mut n) = (base.clone(), 2);
            while list.iter().chain(&gone).any(|w| w.id == id) {
                id = format!("{base}-{n}");
                n += 1;
            }
            WsEntry {
                id,
                name: entry_name(path),
                path: path.to_string(),
                remote: None,
                branch: None,
                last_used: now_ms(),
                cross_project: true,
            }
        }
    };
    list.push(entry.clone());
    save(root, &list)?;
    if revive.is_some() {
        save_gone(root, &gone);
    }
    Ok(entry)
}

/// 등록 해제 (FR-E-09) — 레지스트리에서만 지우고, 지운 항목은 해제 목록에 남긴다
pub fn unregister(root: &Path, id: &str) -> Result<(), String> {
    let mut list = load_strict(root)?;
    let Some(i) = list.iter().position(|e| e.id == id) else { return Ok(()) };
    let e = list.remove(i);
    save(root, &list)?;
    let mut gone = load_gone(root);
    gone.retain(|g| g.id != e.id);
    gone.push(e);
    let over = gone.len().saturating_sub(GONE_KEEP);
    gone.drain(..over);
    save_gone(root, &gone);
    Ok(())
}

/// [되돌리기] — 해제해 둔 항목을 그대로(id · 이름 · 받기 설정) 다시 넣는다. 폴더가 없어졌어도 되돌린다
pub fn restore(root: &Path, id: &str) -> Result<WsEntry, String> {
    let mut list = load_strict(root)?;
    if let Some(e) = list.iter().find(|e| e.id == id) {
        return Ok(e.clone()); // 그 사이 같은 폴더를 다시 등록해 이미 돌아왔다
    }
    let mut gone = load_gone(root);
    let i = gone.iter().rposition(|g| g.id == id).ok_or("되돌릴 등록 정보가 없습니다")?;
    if let Some(o) = taken_by(&list, &gone[i].path, "") {
        return Err(already(o));
    }
    let e = gone.remove(i);
    list.push(e.clone());
    save(root, &list)?;
    save_gone(root, &gone);
    Ok(e)
}

/// 경로 재지정 (FR-E-08) — id는 그대로다. 다른 항목이 쓰는 폴더는 막는다 — 같은 team.json을 두 탭이 읽는다.
/// 이름이 폴더 이름 그대로였을 때만 새 폴더 이름으로 바꾼다 — 사람이 정한 이름은 지킨다
pub fn repath(root: &Path, id: &str, path: &str) -> Result<WsEntry, String> {
    let mut list = load_strict(root)?;
    if let Some(o) = taken_by(&list, path, id) {
        return Err(already(o));
    }
    let e = list.iter_mut().find(|e| e.id == id).ok_or("등록 항목 없음")?;
    if e.name == entry_name(&e.path) {
        e.name = entry_name(path);
    }
    e.path = path.to_string();
    e.last_used = now_ms();
    let e = e.clone();
    save(root, &list)?;
    Ok(e)
}

/// 이름 바꾸기 — 등록 정보의 이름만. 폴더는 건드리지 않는다. 비우면 폴더 이름으로 돌아간다
pub fn rename(root: &Path, id: &str, name: &str) -> Result<WsEntry, String> {
    let mut list = load_strict(root)?;
    let e = list.iter_mut().find(|e| e.id == id).ok_or("등록 항목 없음")?;
    let name = name.trim();
    e.name = if name.is_empty() { entry_name(&e.path) } else { name.to_string() };
    let e = e.clone();
    save(root, &list)?;
    Ok(e)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// B132 · B151 — 워크트리 경로와 세션 cwd가 철자 · 구분자 · 끝 `/` · 심링크가 달라도 같은 키
    #[test]
    fn canon_key_matches_spellings() {
        let dir = std::env::temp_dir().join(format!("eqmux-canon-{}", std::process::id()));
        fs::create_dir_all(dir.join("wt")).unwrap();
        let a = dir.join("wt").to_string_lossy().into_owned();
        let k = canon_key(&a);
        assert!(!k.contains('\\') && !k.starts_with("//?/") && !k.ends_with('/'), "{k}");
        assert_eq!(canon_key(&format!("{a}/")), k, "끝 /");
        assert_eq!(canon_key(&a.replace('\\', "/")), k, "구분자");
        assert_eq!(canon_key(&dir.join("wt").join("..").join("wt").to_string_lossy()), k, "..");
        if cfg!(windows) {
            assert_eq!(canon_key(&a.to_uppercase()), k, "Windows 대소문자");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("wt"), dir.join("ln")).unwrap();
            assert_eq!(canon_key(&dir.join("ln").to_string_lossy()), k, "심링크 (mac /tmp → /private/tmp)");
        }
        assert_eq!(canon_key(r"Z:\없는\곳\"), if cfg!(windows) { "z:/없는/곳" } else { "Z:/없는/곳" });
        fs::remove_dir_all(&dir).ok();
    }

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

    /// B289 · B290 · S23 — 재지정 · 해제 · 되돌리기 · 다시 등록 내내 id가 그대로다. 같은 폴더는 한 항목이다
    #[test]
    fn registry_keeps_id_through_repath_unregister_restore() {
        let root = std::env::temp_dir().join(format!("eqmux-wsid-{}", now_ms()));
        let (a, b) = (root.join("dirs").join("app"), root.join("dirs").join("moved"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let (a, b) = (a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned());

        let w = register(&root, &a).unwrap();
        assert_eq!(register(&root, &format!("{a}/")).unwrap().id, w.id, "끝 구분자가 달라도 같은 폴더 (B290)");
        assert_eq!(load_strict(&root).unwrap().len(), 1);

        // 폴더 이름 그대로면 재지정이 이름도 옮긴다
        assert_eq!(repath(&root, &w.id, &b).unwrap().name, "moved");
        // 재지정한 항목을 해제 → [되돌리기] — 새 경로의 해시가 아니라 옛 id (B289)
        unregister(&root, &w.id).unwrap();
        assert!(load_strict(&root).unwrap().is_empty());
        assert_eq!(restore(&root, &w.id).unwrap().id, w.id);
        // 해제 → [폴더 찾기…]로 같은 폴더를 다시 등록해도 옛 id
        unregister(&root, &w.id).unwrap();
        assert_eq!(register(&root, &b).unwrap().id, w.id);
        assert!(restore(&root, &w.id).is_ok(), "이미 돌아온 항목의 되돌리기는 그 항목");

        // 옛 경로를 새로 등록하면 경로에서 나온 id가 겹친다 — 뒤를 붙여 갈라 둔다
        let other = register(&root, &a).unwrap();
        assert_ne!(other.id, w.id);
        // 다른 항목이 쓰는 폴더로는 재지정하지 않는다 (B290)
        let taken = Some("이미 등록된 폴더입니다 — moved".to_string());
        assert_eq!(repath(&root, &other.id, &b).err(), taken);

        // 사람이 정한 이름은 재지정이 지키고, 비우면 폴더 이름으로 (S23)
        assert_eq!(rename(&root, &other.id, "  웹 앱 ").unwrap().name, "웹 앱");
        unregister(&root, &w.id).unwrap();
        assert_eq!(repath(&root, &other.id, &b).unwrap().name, "웹 앱");
        assert_eq!(rename(&root, &other.id, " ").unwrap().name, "moved");
        assert_eq!(restore(&root, &w.id).err(), taken);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(backup_dir(&root));
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
        assert!((now_ms() - o.commits[0].when).abs() < 120_000, "커밋 시각은 epoch ms (U173)");
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
        // 목록 — 본체 + 세션 워크트리, porcelain 파싱
        let listed = worktree_list(&path).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed[0].is_main && !listed[0].is_session);
        assert!(!listed[1].is_main && listed[1].is_session);
        assert_eq!(listed[1].branch.as_deref(), Some("eqmux/kai-ws1"));
        assert!(!listed[1].head.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    /// clone 이름 · 진행 줄 자르기 (P72)
    #[test]
    fn clone_name_and_cut_lines() {
        assert_eq!(clone_name("https://github.com/u/repo.git"), "repo");
        assert_eq!(clone_name("https://github.com/u/repo/"), "repo");
        assert_eq!(clone_name("git@github.com:repo.git"), "repo");
        assert_eq!(clone_name(r"C:\src\proj"), "proj");
        assert_eq!(clone_name(".git"), "repo");
        let (mut pending, mut out) = (Vec::new(), Vec::new());
        cut_lines(&mut pending, b"Cloning into 'x'...\nReceiving objects:  42% (4", &mut out);
        cut_lines(&mut pending, b"2/100)\rReceiving objects: 100% (100/100), done.\r\nfatal: x\n", &mut out);
        assert_eq!(out, ["Cloning into 'x'...", "Receiving objects:  42% (42/100)", "Receiving objects: 100% (100/100), done.", "fatal: x"]);
        assert!(pending.is_empty());
        assert_eq!(out.iter().filter(|l| !is_progress(l)).count(), 2);
    }

    /// clone 성공 · 실패 · 취소 (P72) — 깃발이 전역이라 한 테스트에서 차례로 돈다.
    /// 취소는 응답하지 않는 git:// 서버에 걸어 둔 clone을 끊고, 이 clone이 만든 폴더가 지워졌는지 본다
    #[test]
    fn clone_repo_succeeds_fails_and_cancels() {
        let dir = std::env::temp_dir().join(format!("eqmux-clone-{}", now_ms()));
        let src = dir.join("src");
        fs::create_dir_all(&src).unwrap();
        let sp = src.to_string_lossy().into_owned();
        git(&["init"], &sp).unwrap();
        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "first"], &sp).unwrap();
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();
        let op = out.to_string_lossy().into_owned();

        let got = clone_repo(&sp, &op, |_| {}).unwrap();
        assert!(Path::new(&got).join(".git").exists(), "{got}");
        let err = clone_repo(&dir.join("nope").to_string_lossy(), &op, |_| {}).unwrap_err();
        assert!(!err.starts_with("CLONE_") && !err.contains('%'), "{err}");

        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("git://127.0.0.1:{}/r.git", l.local_addr().unwrap().port());
        std::thread::spawn(move || {
            let _held: Vec<_> = l.incoming().take(1).collect(); // 받기만 하고 답하지 않는다
            std::thread::sleep(Duration::from_secs(30));
        });
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(800));
            CLONE_CANCEL.store(true, Ordering::SeqCst);
        });
        let t0 = Instant::now();
        let err = clone_repo(&url, &op, |_| {}).unwrap_err();
        assert!(t0.elapsed() < Duration::from_secs(20), "취소가 먹어야 한다");
        assert_eq!(err, "CLONE_CANCELLED|", "이 clone이 만든 폴더는 지운다");
        assert!(!out.join("r").exists());
        fs::remove_dir_all(&dir).ok();
    }
}
