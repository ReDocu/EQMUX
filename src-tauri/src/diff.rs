// diff 에디터 실파싱 (PRD H) — HEAD ↔ 워크트리 비교를 읽기 전용으로 제공한다.
// 원리: `git diff -U999999`로 파일 전체가 한 헝크에 들어오게 만들고,
// ' '(양측) · '-'(BASE) · '+'(WORKTREE) 접두로 양측 라인 배열을 재구성한다.
// 스테이지·커밋·편집은 제공하지 않는다 — 실행은 터미널에서 사람이 한다 (다른 패널과 같은 원칙).

use std::path::Path;

use serde::Serialize;

use crate::workspace::git;

const MAX_LINES_PER_SIDE: usize = 3000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub status: String, // "A" | "M" | "D"
    pub path: String,
    pub stat: String, // "+18 −6"
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub no: u32,
    pub text: String,
    pub kind: Option<String>, // "add" | "del" | None(ctx)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub base_label: String, // HEAD 짧은 해시
    pub base: Vec<DiffLine>,
    pub current: Vec<DiffLine>,
    pub truncated: bool,
}

/// 변경 파일 목록 — status --porcelain(상태) + diff --numstat(±집계). 이름변경은 새 경로 기준.
pub fn changed_files(ws_path: &str) -> Result<Vec<ChangedFile>, String> {
    let porcelain = git(&["status", "--porcelain"], ws_path)?;
    // 경로 → (+, −) — untracked는 numstat에 없으므로 파일 줄 수로 대체한다
    let mut stats: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
    if let Ok(numstat) = git(&["diff", "--numstat", "HEAD"], ws_path) {
        for line in numstat.lines() {
            let mut p = line.splitn(3, '\t');
            let (Some(a), Some(d), Some(path)) = (p.next(), p.next(), p.next()) else { continue };
            stats.insert(path.to_string(), (a.to_string(), d.to_string()));
        }
    }
    let mut out = Vec::new();
    for line in porcelain.lines() {
        // git() 헬퍼가 출력 전체를 trim해 첫 줄의 선행 공백(" M …")이 소실될 수 있다 —
        // 열 오프셋 대신 상태 코드(첫 공백 전)와 경로(나머지)로 관대하게 가른다
        let l = line.trim_start();
        let Some(sp) = l.find(' ') else { continue };
        let code = &l[..sp];
        let raw_path = l[sp..].trim_start();
        // 이름변경 "old -> new" — 새 경로를 쓴다
        let path = raw_path.rsplit(" -> ").next().unwrap_or(raw_path).trim_matches('"').to_string();
        if path.is_empty() || code.is_empty() {
            continue;
        }
        let status = if code.contains('?') || code.contains('A') {
            "A"
        } else if code.contains('D') {
            "D"
        } else {
            "M"
        };
        let stat = if code.contains('?') {
            let lines = std::fs::read_to_string(Path::new(ws_path).join(&path))
                .map(|s| s.lines().count())
                .unwrap_or(0);
            format!("+{lines}")
        } else {
            match stats.get(&path) {
                Some((a, d)) if a == "-" => "바이너리".into(),
                Some((a, d)) => format!("+{a} −{d}"),
                None => String::new(),
            }
        };
        out.push(ChangedFile { status: status.into(), path, stat });
    }
    Ok(out)
}

fn all_lines(text: &str, kind: &str) -> Vec<DiffLine> {
    text.lines()
        .take(MAX_LINES_PER_SIDE)
        .enumerate()
        .map(|(i, l)| DiffLine { no: (i + 1) as u32, text: l.to_string(), kind: Some(kind.into()) })
        .collect()
}

/// HEAD ↔ 워크트리 양측 라인 재구성. untracked = 전부 add, 삭제 = 전부 del, 바이너리 = Err.
pub fn file_diff(ws_path: &str, path: &str) -> Result<FileDiff, String> {
    let base_label = git(&["rev-parse", "--short", "HEAD"], ws_path).unwrap_or_else(|_| "HEAD".into());
    let in_head = git(&["cat-file", "-e", &format!("HEAD:{path}")], ws_path).is_ok();

    if !in_head {
        // untracked/새 파일 — BASE 없음, 현재 전체가 add
        let text = std::fs::read_to_string(Path::new(ws_path).join(path))
            .map_err(|_| "파일을 읽을 수 없습니다 (바이너리 또는 없음)".to_string())?;
        let current = all_lines(&text, "add");
        let truncated = text.lines().count() > MAX_LINES_PER_SIDE;
        return Ok(FileDiff { base_label, base: Vec::new(), current, truncated });
    }

    let out = git(&["diff", "--no-color", "-U999999", "HEAD", "--", path], ws_path)?;
    if out.contains("Binary files") {
        return Err("바이너리 파일 — 텍스트 비교 불가".into());
    }
    if out.trim().is_empty() {
        // 변경 없음 — 양측 동일 내용 (ctx)
        let text = git(&["show", &format!("HEAD:{path}")], ws_path)?;
        let mk = |t: &str| {
            t.lines()
                .take(MAX_LINES_PER_SIDE)
                .enumerate()
                .map(|(i, l)| DiffLine { no: (i + 1) as u32, text: l.to_string(), kind: None })
                .collect::<Vec<_>>()
        };
        let truncated = text.lines().count() > MAX_LINES_PER_SIDE;
        return Ok(FileDiff { base_label, base: mk(&text), current: mk(&text), truncated });
    }

    let mut base = Vec::new();
    let mut current = Vec::new();
    let mut in_hunk = false;
    let mut truncated = false;
    for line in out.lines() {
        if line.starts_with("@@") {
            in_hunk = true;
            continue;
        }
        if !in_hunk || line.starts_with('\\') {
            continue; // 헤더 · "\ No newline" 마커
        }
        if base.len() >= MAX_LINES_PER_SIDE || current.len() >= MAX_LINES_PER_SIDE {
            truncated = true;
            break;
        }
        let (prefix, text) = line.split_at(1.min(line.len()));
        let text = text.to_string();
        match prefix {
            "-" => base.push(DiffLine { no: base.len() as u32 + 1, text, kind: Some("del".into()) }),
            "+" => current.push(DiffLine { no: current.len() as u32 + 1, text, kind: Some("add".into()) }),
            _ => {
                base.push(DiffLine { no: base.len() as u32 + 1, text: text.clone(), kind: None });
                current.push(DiffLine { no: current.len() as u32 + 1, text, kind: None });
            }
        }
    }
    Ok(FileDiff { base_label, base, current, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_repo() -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("eqmux-diff-{}", crate::workspace::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        git(&["init"], &path).unwrap();
        git(&["config", "user.email", "t@t"], &path).unwrap();
        git(&["config", "user.name", "t"], &path).unwrap();
        (dir, path)
    }

    #[test]
    fn changed_files_and_side_by_side() {
        let (dir, ws) = temp_repo();
        fs::write(dir.join("a.txt"), "하나\n둘\n셋\n").unwrap();
        fs::write(dir.join("gone.txt"), "지워질 파일\n").unwrap();
        git(&["add", "."], &ws).unwrap();
        git(&["commit", "-m", "first"], &ws).unwrap();
        // 수정 + 삭제 + 신규
        fs::write(dir.join("a.txt"), "하나\n둘-고침\n셋\n넷\n").unwrap();
        fs::remove_file(dir.join("gone.txt")).unwrap();
        fs::write(dir.join("new.txt"), "새 줄\n").unwrap();

        let files = changed_files(&ws).unwrap();
        let st = |p: &str| files.iter().find(|f| f.path == p).map(|f| f.status.clone());
        assert_eq!(st("a.txt").as_deref(), Some("M"));
        assert_eq!(st("gone.txt").as_deref(), Some("D"));
        assert_eq!(st("new.txt").as_deref(), Some("A"));
        assert_eq!(files.iter().find(|f| f.path == "a.txt").unwrap().stat, "+2 −1");

        // 수정 파일 — 양측 재구성: ctx는 양쪽, del은 BASE만, add는 WORKTREE만
        let d = file_diff(&ws, "a.txt").unwrap();
        assert_eq!(d.base.iter().filter(|l| l.kind.as_deref() == Some("del")).count(), 1);
        assert_eq!(d.current.iter().filter(|l| l.kind.as_deref() == Some("add")).count(), 2);
        assert_eq!(d.base.len(), 3); // 하나·둘·셋
        assert_eq!(d.current.len(), 4); // 하나·둘-고침·셋·넷
        assert_eq!(d.current[1].text, "둘-고침");

        // 신규 — BASE 없음, 전부 add / 삭제 — 전부 del
        let n = file_diff(&ws, "new.txt").unwrap();
        assert!(n.base.is_empty() && n.current.len() == 1);
        let g = file_diff(&ws, "gone.txt").unwrap();
        assert!(g.current.is_empty() && g.base.len() == 1);
        assert_eq!(g.base[0].kind.as_deref(), Some("del"));

        fs::remove_dir_all(&dir).ok();
    }
}
