// 탐색기 패널 실측 (PRD H) — 워크스페이스 파일 트리 + 텍스트 미리보기 + 파일 CRUD (M24).
// 모든 쓰기는 읽기와 같은 경로 탈출 가드를 지나고, .git은 불가침이며, 삭제는 휴지통으로 보낸다.
// (PRD H의 읽기 전용 선언은 M24에서 사용자 확정으로 개정 — git 쓰기·프로세스 kill은 여전히 없다)

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const SKIP_DIRS: [&str; 5] = [".git", "node_modules", "target", "dist", ".vite"];
const MAX_ENTRIES: usize = 400;
const MAX_DEPTH: u32 = 3;
const PREVIEW_BYTES: usize = 64 * 1024;
const EDIT_MAX_BYTES: usize = 1024 * 1024; // 앱 내 편집 상한 — 초과분은 잘리는 대신 거부한다

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    pub name: String,
    pub rel: String, // 워크스페이스 상대 경로 (슬래시 구분)
    pub depth: u32,
    pub dir: bool,
}

fn walk(base: &Path, dir: &Path, depth: u32, out: &mut Vec<FsNode>) {
    if depth > MAX_DEPTH || out.len() >= MAX_ENTRIES {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut items: Vec<(bool, String, PathBuf)> = entries
        .flatten()
        .map(|e| {
            let p = e.path();
            (p.is_dir(), e.file_name().to_string_lossy().into_owned(), p)
        })
        .collect();
    // 폴더 먼저, 이름순 — 트리 표시 관례
    items.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    for (is_dir, name, path) in items {
        if out.len() >= MAX_ENTRIES {
            return;
        }
        if is_dir && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let rel = path
            .strip_prefix(base)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| name.clone());
        out.push(FsNode { name, rel, depth, dir: is_dir });
        if is_dir {
            walk(base, &path, depth + 1, out);
        }
    }
}

/// 깊이·개수 상한이 있는 파일 트리 — 무거운 디렉터리(.git 등)는 걷지 않는다
pub fn tree(ws_path: &str) -> Vec<FsNode> {
    let base = Path::new(ws_path);
    let mut out = Vec::new();
    walk(base, base, 0, &mut out);
    out
}

/// 텍스트 미리보기 — 워크스페이스 밖 경로는 거부, 64KB 상한 (초과분은 잘림 표시)
pub fn preview(ws_path: &str, rel: &str) -> Result<String, String> {
    let base = fs::canonicalize(ws_path).map_err(|_| "워크스페이스 경로 없음".to_string())?;
    let target = fs::canonicalize(base.join(rel)).map_err(|_| "파일 없음".to_string())?;
    if !target.starts_with(&base) {
        return Err("워크스페이스 밖 경로".into());
    }
    let data = fs::read(&target).map_err(|e| e.to_string())?;
    let truncated = data.len() > PREVIEW_BYTES;
    let slice = &data[..data.len().min(PREVIEW_BYTES)];
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if truncated {
        text.push_str("\n… (64KB에서 잘림)");
    }
    Ok(text)
}

// ── 파일 CRUD (M24) — 공통 가드: 워크스페이스 밖 거부 · .git 불가침 · 루트 자체 조작 금지 ──

/// 존재하는 대상의 절대 경로 해석 — canonicalize로 탈출을 막는다 (preview와 같은 규칙)
fn resolve_existing(ws_path: &str, rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("워크스페이스 루트는 조작할 수 없습니다".into());
    }
    guard_git(rel)?;
    let base = fs::canonicalize(ws_path).map_err(|_| "워크스페이스 경로 없음".to_string())?;
    let target = fs::canonicalize(base.join(rel)).map_err(|_| "대상 없음".to_string())?;
    if !target.starts_with(&base) {
        return Err("워크스페이스 밖 경로".into());
    }
    // 심링크 우회 차단 — guard_git은 canonicalize 이전 문자열만 봐서, foo -> .git 심링크로
    // rel="foo/config"를 넣으면 통과한다. 해석된 실제 경로가 .git을 지나는지 다시 검사한다
    let rest = target.strip_prefix(&base).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
    guard_git(&rest)?;
    Ok(target)
}

/// .git 불가침 — 탐색기 CRUD가 저장소 자체를 부술 수 없게 한다
fn guard_git(rel: &str) -> Result<(), String> {
    let norm = rel.replace('\\', "/");
    if norm == ".git" || norm.starts_with(".git/") || norm.contains("/.git/") || norm.ends_with("/.git") {
        return Err(".git은 탐색기에서 조작할 수 없습니다".into());
    }
    Ok(())
}

/// 파일·폴더 이름 검증 — 구분자·예약 문자가 들어간 이름은 이동·탈출 수단이 된다
fn valid_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() || n == "." || n == ".." || n == ".git" {
        return Err("사용할 수 없는 이름입니다".into());
    }
    if n.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err("이름에 경로 구분자·예약 문자를 쓸 수 없습니다".into());
    }
    Ok(())
}

fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub text: String,
    /// 편집 시작 시점의 파일 mtime — 저장 때 충돌 감지(외부 변경)에 쓴다
    pub mtime_ms: i64,
}

/// 편집용 원문 읽기 — 1MB 초과는 거부한다 (64KB 미리보기를 저장하면 뒷부분이 날아가므로,
/// 편집 경로는 전문을 읽거나 아예 거부하거나 둘 중 하나여야 한다)
pub fn read_full(ws_path: &str, rel: &str) -> Result<FileContent, String> {
    let target = resolve_existing(ws_path, rel)?;
    let meta = fs::metadata(&target).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아닙니다".into());
    }
    if meta.len() as usize > EDIT_MAX_BYTES {
        return Err("1MB 초과 — 앱에서 편집할 수 없습니다".into());
    }
    let data = fs::read(&target).map_err(|e| e.to_string())?;
    let text = String::from_utf8(data).map_err(|_| "텍스트 파일이 아닙니다 (UTF-8 아님)")?;
    Ok(FileContent { text, mtime_ms: mtime_ms(&target) })
}

/// 텍스트 저장 — 원자적 쓰기 (tmp → rename). expected_mtime_ms를 주면 그 사이 파일이
/// 밖에서(에이전트 등) 바뀌었는지 검사한다 — 마지막 저장이 조용히 이기는 사고 방지.
/// 반환은 저장 후 mtime — 이어서 편집을 계속할 수 있게.
pub fn write_file(
    ws_path: &str,
    rel: &str,
    content: &str,
    expected_mtime_ms: Option<i64>,
) -> Result<i64, String> {
    if content.len() > EDIT_MAX_BYTES {
        return Err("1MB 초과 — 저장할 수 없습니다".into());
    }
    let target = resolve_existing(ws_path, rel)?;
    if !target.is_file() {
        return Err("파일이 아닙니다".into());
    }
    if let Some(exp) = expected_mtime_ms {
        let cur = mtime_ms(&target);
        if cur != exp {
            return Err("파일이 밖에서 바뀌었습니다 — 편집을 취소하고 다시 열어 확인하세요".into());
        }
    }
    crate::workspace::atomic_write(&target, content.as_bytes())?;
    Ok(mtime_ms(&target))
}

/// 생성 — rel_dir(빈 문자열 = 루트) 아래 name으로 파일 또는 폴더. 이미 있으면 거부.
pub fn create_entry(ws_path: &str, rel_dir: &str, name: &str, dir: bool) -> Result<String, String> {
    valid_name(name)?;
    let base = fs::canonicalize(ws_path).map_err(|_| "워크스페이스 경로 없음".to_string())?;
    let parent = if rel_dir.trim().is_empty() { base.clone() } else { resolve_existing(ws_path, rel_dir)? };
    if !parent.is_dir() {
        return Err("폴더가 아닙니다".into());
    }
    let target = parent.join(name.trim());
    guard_git(&target.strip_prefix(&base).unwrap_or(&target).to_string_lossy().replace('\\', "/"))?;
    if target.exists() {
        return Err("같은 이름이 이미 있습니다".into());
    }
    if dir {
        fs::create_dir(&target).map_err(|e| e.to_string())?;
    } else {
        fs::write(&target, "").map_err(|e| e.to_string())?;
    }
    Ok(target
        .strip_prefix(&base)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default())
}

/// 이름 변경 — 같은 부모 안에서만 (이동은 제공하지 않는다 — 탈출 수단 차단)
pub fn rename_entry(ws_path: &str, rel: &str, new_name: &str) -> Result<String, String> {
    valid_name(new_name)?;
    let target = resolve_existing(ws_path, rel)?;
    let parent = target.parent().ok_or("부모 폴더 없음")?;
    let next = parent.join(new_name.trim());
    if next.exists() {
        return Err("같은 이름이 이미 있습니다".into());
    }
    fs::rename(&target, &next).map_err(|e| e.to_string())?;
    let base = fs::canonicalize(ws_path).map_err(|_| "워크스페이스 경로 없음".to_string())?;
    Ok(next
        .strip_prefix(&base)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default())
}

/// 삭제 — 영구 삭제가 아니라 휴지통으로 보낸다. 실패 시 영구 삭제로 폴백하지 않는다.
pub fn delete_entry(ws_path: &str, rel: &str) -> Result<(), String> {
    let target = resolve_existing(ws_path, rel)?;
    trash::delete(&target).map_err(|e| format!("휴지통 이동 실패 — {e}"))
}

// ── Tauri 커맨드 표면 — 로직은 위의 순수 함수들, 여기는 이름과 시그니처만 소유한다 ──

/// 탐색기 파일 트리 (PRD H) — 깊이·개수 상한, 무거운 디렉터리 제외
#[tauri::command]
pub fn fs_tree(ws_path: String) -> Vec<FsNode> {
    tree(&ws_path)
}

/// 텍스트 미리보기 — 경로 탈출 방지 + 64KB 상한
#[tauri::command]
pub fn fs_preview(ws_path: String, rel: String) -> Result<String, String> {
    preview(&ws_path, &rel)
}

/// 편집용 원문 (1MB 상한 — 미리보기 잘림을 저장해 뒷부분을 날리는 사고 방지)
#[tauri::command]
pub fn fs_read(ws_path: String, rel: String) -> Result<FileContent, String> {
    read_full(&ws_path, &rel)
}

/// 저장 — expectedMtimeMs가 있으면 외부 변경 충돌을 검사한다. 반환은 저장 후 mtime
#[tauri::command]
pub fn fs_write(
    ws_path: String,
    rel: String,
    content: String,
    expected_mtime_ms: Option<i64>,
) -> Result<i64, String> {
    write_file(&ws_path, &rel, &content, expected_mtime_ms)
}

/// relDir(빈 문자열 = 루트) 아래에 생성 — 반환은 새 항목의 상대 경로
#[tauri::command]
pub fn fs_create(ws_path: String, rel_dir: String, name: String, dir: bool) -> Result<String, String> {
    create_entry(&ws_path, &rel_dir, &name, dir)
}

#[tauri::command]
pub fn fs_rename(ws_path: String, rel: String, new_name: String) -> Result<String, String> {
    rename_entry(&ws_path, &rel, &new_name)
}

/// 휴지통으로 이동 — 영구 삭제 폴백 없음
#[tauri::command]
pub async fn fs_delete(ws_path: String, rel: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_entry(&ws_path, &rel))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 탐색기 CRUD (M24) — 생성·저장·이름변경 왕복과 가드 (.git 불가침 · 탈출 거부 · 이름 검증)
    #[test]
    fn crud_roundtrip_and_guards() {
        let dir = std::env::temp_dir().join(format!("eqmux-fscrud-{}", crate::workspace::now_ms()));
        fs::create_dir_all(dir.join(".git")).unwrap();
        let ws = dir.to_string_lossy().into_owned();

        // 생성 → 저장 → 원문 읽기 왕복
        assert_eq!(create_entry(&ws, "", "docs", true).unwrap(), "docs");
        let rel = create_entry(&ws, "docs", "note.md", false).unwrap();
        assert_eq!(rel, "docs/note.md");
        let saved_mtime = write_file(&ws, &rel, "# 메모", None).unwrap();
        let fc = read_full(&ws, &rel).unwrap();
        assert_eq!(fc.text, "# 메모");
        assert_eq!(fc.mtime_ms, saved_mtime);
        // 외부 변경 충돌 감지 — 기대 mtime이 어긋나면 거부한다 (마지막 저장 승리 방지)
        assert!(write_file(&ws, &rel, "덮어쓰기", Some(saved_mtime - 1)).is_err());
        assert!(write_file(&ws, &rel, "정상 저장", Some(saved_mtime)).is_ok());
        // 이름 변경은 같은 부모 안에서만
        let renamed = rename_entry(&ws, &rel, "note2.md").unwrap();
        assert_eq!(renamed, "docs/note2.md");
        assert!(read_full(&ws, "docs/note.md").is_err());
        // 가드 — .git 불가침 · 경로 탈출 · 구분자 이름 · 루트 조작 · 중복 생성
        assert!(write_file(&ws, ".git/config", "x", None).is_err());
        assert!(delete_entry(&ws, ".git").is_err());
        assert!(read_full(&ws, "../outside.txt").is_err());
        assert!(create_entry(&ws, "", "a/b", false).is_err());
        assert!(rename_entry(&ws, "docs", "..").is_err());
        assert!(delete_entry(&ws, "").is_err());
        assert!(create_entry(&ws, "docs", "note2.md", false).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn tree_skips_heavy_dirs_and_preview_guards_escape() {
        let dir = std::env::temp_dir().join(format!("eqmux-fsx-{}", crate::workspace::now_ms()));
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src").join("a.ts"), "hello").unwrap();
        fs::write(dir.join("README.md"), "# 제목").unwrap();
        let ws = dir.to_string_lossy().into_owned();

        let nodes = tree(&ws);
        assert!(nodes.iter().any(|n| n.rel == "src/a.ts"));
        assert!(nodes.iter().all(|n| n.name != ".git")); // 무거운 디렉터리 제외
        let src = nodes.iter().find(|n| n.rel == "src").unwrap();
        assert!(src.dir && src.depth == 0);

        assert_eq!(preview(&ws, "README.md").unwrap(), "# 제목");
        assert!(preview(&ws, "../outside.txt").is_err()); // 경로 탈출 거부
        fs::remove_dir_all(&dir).ok();
    }
}
