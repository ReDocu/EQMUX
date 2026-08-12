// 워크스페이스 레지스트리 (PRD E §4.1) — 디스크의 git repo를 등록·나열·재지정·해제한다.
// 레지스트리는 앱 데이터의 workspaces.json, 원자적 쓰기(tmp → rename) (FR-E-07).
// 등록 해제는 레지스트리에서만 지우며 디스크는 건드리지 않는다 (FR-E-09).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

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

pub fn load(root: &Path) -> Vec<WsEntry> {
    fs::read_to_string(registry_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(root: &Path, list: &[WsEntry]) -> Result<(), String> {
    let _ = fs::create_dir_all(root);
    let target = registry_path(root);
    let tmp = root.join("workspaces.json.tmp");
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| e.to_string())
}

/// git CLI 실행 — GUI 앱이므로 콘솔 창을 띄우지 않는다
pub fn git(args: &[&str], cwd: &str) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("git 실행 실패: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn is_repo(path: &str) -> bool {
    Path::new(path).join(".git").exists()
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
}
