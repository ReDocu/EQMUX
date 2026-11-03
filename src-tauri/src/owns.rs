//! 직함별 담당 경로 (0.6 §4 · §13-1) — 역할 파일 frontmatter `owns: src/git/** docs/**`.
//! 편집 도구가 담당 밖 파일을 고치면 경고만 낸다(막지 않는다). owns가 없으면 아무것도 하지 않는다.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// 같은 (세션, 파일) 경고는 이 안에 한 번만
const WARN_WINDOW_MS: i64 = 10 * 60 * 1000;

/// 편집 기록 경로 → 저장소 기준 상대 경로. 세션 워크트리(`.eqmux/worktrees/<세션>/`) 안이면 그 접두도 뗀다.
/// 저장소 밖 절대 경로는 정규화만 해서 그대로 돌려준다
pub fn repo_rel(ws_path: &str, raw: &str) -> String {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_string();
    let (root, p) = (norm(ws_path), norm(raw));
    let key = |x: &str| if cfg!(windows) { x.to_lowercase() } else { x.to_string() }; // Windows 경로는 대소문자를 가리지 않는다
    let mut rel = if key(&p).starts_with(&(key(&root) + "/")) { p[root.len() + 1..].to_string() } else { p };
    if let Some(rest) = rel.strip_prefix(".eqmux/worktrees/") {
        rel = rest.split_once('/').map(|(_, r)| r.to_string()).unwrap_or_default();
    }
    rel.trim_start_matches("./").to_string()
}

/// `src/git/**`(그 아래 전부) · `docs/`(폴더) · `docs`(파일 또는 폴더) · `*.md` · `?`. Windows는 대소문자 무시
pub fn glob_match(pat: &str, path: &str) -> bool {
    let fold = |x: &str| {
        let x = x.replace('\\', "/");
        if cfg!(windows) { x.to_lowercase() } else { x }
    };
    let (mut pat, path) = (fold(pat).trim_start_matches("./").trim_start_matches('/').to_string(), fold(path));
    if pat.ends_with('/') || !pat.contains(['*', '?']) {
        pat = format!("{}/**", pat.trim_end_matches('/')); // `**`는 0칸도 맞으니 `docs`는 파일 docs도 맞는다
    }
    let split = |s: &str| s.split('/').filter(|x| !x.is_empty()).map(|x| x.chars().collect::<Vec<_>>()).collect::<Vec<_>>();
    segs(&split(&pat), &split(&path))
}

fn segs(p: &[Vec<char>], s: &[Vec<char>]) -> bool {
    match p.first() {
        None => s.is_empty(),
        Some(x) if x[..] == ['*', '*'] => segs(&p[1..], s) || (!s.is_empty() && segs(p, &s[1..])),
        Some(x) => !s.is_empty() && seg(x, &s[0]) && segs(&p[1..], &s[1..]),
    }
}

fn seg(p: &[char], s: &[char]) -> bool {
    match (p.first(), s.first()) {
        (None, None) => true,
        (Some('*'), _) => seg(&p[1..], s) || (!s.is_empty() && seg(p, &s[1..])),
        (Some('?'), Some(_)) => seg(&p[1..], &s[1..]),
        (Some(a), Some(b)) => a == b && seg(&p[1..], &s[1..]),
        _ => false,
    }
}

/// 앱이 세션에게 쓰라고 시킨 파일인가 — 기억(roles.rs memory_rule)과 노트(COMMS_RULES)뿐이다. 담당 밖 · 동시 편집
/// 판정과 검토 화면의 '고친 파일'에서 뺀다 (U113). rel은 repo_rel을 거친 것(워크트리 접두가 떨어진 것)이다.
/// `.eqmux/` 전체를 빼면 commands.json · team.json · 임무 파일 같은 커밋 대상 편집도 세지 않았다 (B268)
pub fn app_file(rel: &str) -> bool {
    let rel = rel.replace('\\', "/").to_lowercase();
    rel.starts_with(".eqmux/memory/") || rel.starts_with(".eqmux/notes/")
}

/// 담당 밖인가 — owns가 비면 언제나 false(경고 없음)
pub fn outside(owns: &[String], rel: &str) -> bool {
    !owns.is_empty() && !owns.iter().any(|g| glob_match(g, rel))
}

/// 세션 역할 파일의 owns (없으면 빈 목록). 역할 파일은 세션 cwd 기준이다(스폰 때와 같은 자리)
pub fn role_owns(cwd: &str, session: &str) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(crate::roles::role_path(cwd, session)) else { return Vec::new() };
    let fm = crate::roles::split_frontmatter(&text).0;
    crate::roles::fm_value(&fm, "owns").unwrap_or_default().split_whitespace().map(String::from).collect()
}

/// 같은 키는 창 안에 한 번만 true. 낡은 칸도 걷는다
fn first_in_window(seen: &mut HashMap<String, i64>, key: String, now: i64) -> bool {
    seen.retain(|_, ts| now - *ts < WARN_WINDOW_MS);
    if seen.contains_key(&key) {
        return false;
    }
    seen.insert(key, now);
    true
}

/// record_edit(agent.rs)가 부른다 — 경고할 것이면 (저장소 기준 경로, owns). 저장소 밖 파일은 보지 않는다
pub fn edit_warning(cwd: &str, session: &str, path: &str, now: i64) -> Option<(String, Vec<String>)> {
    let owns = role_owns(cwd, session);
    let rel = repo_rel(cwd, path);
    if rel.is_empty() || app_file(&rel) || rel.starts_with('/') || rel.starts_with("../") || std::path::Path::new(&rel).is_absolute() || !outside(&owns, &rel) {
        return None;
    }
    static SEEN: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();
    let key = format!("{session}\n{}", if cfg!(windows) { rel.to_lowercase() } else { rel.clone() });
    let fresh = first_in_window(&mut *SEEN.get_or_init(Default::default).lock().ok()?, key, now);
    fresh.then_some((rel, owns))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_forms() {
        assert!(glob_match("src/git/**", "src/git/a.rs"));
        assert!(glob_match("src/git/**", "src/git/x/y/z.rs"));
        assert!(!glob_match("src/git/**", "src/gitx.rs"), "접두어만 같은 형제");
        assert!(glob_match("docs/", "docs/a.md"));
        assert!(glob_match("docs", "docs/a.md") && glob_match("docs", "docs"));
        assert!(glob_match("./src/*.ts", "src/a.ts") && !glob_match("src/*.ts", "src/x/a.ts"), "* 는 한 칸");
        assert!(glob_match("**/*.md", "README.md") && glob_match("**/*.md", "a/b/c.md"));
        assert!(glob_match("src/a?.ts", "src/ab.ts") && !glob_match("src/a?.ts", "src/a.ts"));
        assert!(glob_match("src/**/test/*.rs", "src/test/x.rs") && glob_match("src/**/test/*.rs", "src/a/b/test/x.rs"));
        assert_eq!(glob_match("SRC/Git/**", "src/git/a.rs"), cfg!(windows));
    }

    #[test]
    fn outside_needs_owns() {
        let owns = vec!["src/git/**".to_string(), "docs/**".to_string()];
        assert!(!outside(&[], "anything.rs"), "owns 없음 = 경고 없음");
        assert!(!outside(&owns, "docs/x.md"));
        assert!(outside(&owns, "src/app.tsx"));
    }

    #[test]
    fn repo_rel_strips_root_and_worktree() {
        let ws = "D:/w/app";
        assert_eq!(repo_rel(ws, r"D:\w\app\src\x.ts"), "src/x.ts");
        assert_eq!(repo_rel(ws, "D:/w/app/.eqmux/worktrees/kai@w/src/x.ts"), "src/x.ts");
        assert_eq!(repo_rel(ws, "src/x.ts"), "src/x.ts");
        assert_eq!(repo_rel(ws, "E:/other/x.ts"), "E:/other/x.ts", "저장소 밖은 그대로");
    }

    #[test]
    fn warns_once_per_window_and_only_with_owns() {
        let mut seen = HashMap::new();
        assert!(first_in_window(&mut seen, "k".into(), 0));
        assert!(!first_in_window(&mut seen, "k".into(), WARN_WINDOW_MS - 1));
        assert!(first_in_window(&mut seen, "k".into(), WARN_WINDOW_MS));

        // 실제 역할 파일 — owns 있는 세션은 담당 밖에서만, 없는 세션은 아무것도
        let dir = std::env::temp_dir().join(format!("eqmux-owns-{}", std::process::id()));
        let ws = dir.to_string_lossy().replace('\\', "/");
        let role = crate::roles::role_path(&ws, "kai@w");
        std::fs::create_dir_all(role.parent().unwrap()).unwrap();
        std::fs::write(&role, "\u{feff}---\nsession: kai@w\nowns: src/git/** docs/**\n---\n본문\n").unwrap();
        assert_eq!(role_owns(&ws, "kai@w"), vec!["src/git/**", "docs/**"]);
        assert_eq!(edit_warning(&ws, "kai@w", &format!("{ws}/docs/a.md"), 1), None, "담당 안");
        assert_eq!(edit_warning(&ws, "kai@w", &format!("{ws}/src/app.tsx"), 1), Some(("src/app.tsx".into(), vec!["src/git/**".into(), "docs/**".into()])));
        assert_eq!(edit_warning(&ws, "kai@w", &format!("{ws}/src/app.tsx"), 2), None, "10분에 한 번");
        assert_eq!(edit_warning(&ws, "kai@w", "Z:/elsewhere/x.ts", 3), None, "저장소 밖");
        assert_eq!(edit_warning(&ws, "kai@w", &format!("{ws}/.eqmux/memory/kai.md"), 3), None, "앱이 시킨 기억 파일 (U113)");
        assert_eq!(edit_warning(&ws, "kai@w", &format!("{ws}/.eqmux/worktrees/kai@w/.eqmux/notes/a.md"), 3), None, "워크트리 안 노트");
        // 앱이 시키지 않은 .eqmux/ 파일은 프로젝트 파일이다 (B268)
        assert_eq!(edit_warning(&ws, "kai@w", &format!("{ws}/.eqmux/commands.json"), 3).map(|w| w.0).as_deref(), Some(".eqmux/commands.json"));
        assert!(!app_file(".eqmux/missions/login.md") && app_file(r".EQMUX\Memory\kai.md"));
        assert_eq!(edit_warning(&ws, "rin@w", &format!("{ws}/src/app.tsx"), 4), None, "역할 파일 없음");
        std::fs::remove_dir_all(&dir).ok();
    }
}
