// 탐색기 패널 실측 (PRD H) — 워크스페이스 파일 트리 + 텍스트 미리보기.
// 읽기 전용이며, 미리보기는 경로 탈출을 막고 크기를 상한한다 (FR-E-71과 같은 보수성).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const SKIP_DIRS: [&str; 5] = [".git", "node_modules", "target", "dist", ".vite"];
const MAX_ENTRIES: usize = 400;
const MAX_DEPTH: u32 = 3;
const PREVIEW_BYTES: usize = 64 * 1024;

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

#[cfg(test)]
mod tests {
    use super::*;

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
