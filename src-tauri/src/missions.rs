// 임무 파일 (PRD E §4.6) — 임무는 repo 안의 작업 단위이고 정의는 .eqmux/missions/<임무>.md다
// (FR-E-50·51, 커밋 대상). 배정의 원본은 역할 파일의 임무 블록이며 (FR-E-58),
// 목록을 만들 때마다 roles/를 실측 스캔해 배정을 도출한다 (FR-E-59 — 캐시 대조 대신 파일 직독).
// 손상·스키마 불일치는 부분 파싱으로 견딘다 (FR-E-72) — name이 없으면 파일명, status가 없으면 todo.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::roles;

pub const STATUSES: [&str; 4] = ["todo", "in-progress", "in-review", "done"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MissionInfo {
    pub id: String,
    pub name: String,
    pub status: String,
    pub branch: Option<String>,
    pub goal: String,
    pub outputs: Vec<String>,
    pub file: String,
    pub assigned: Vec<String>,
    /// 워크스페이스 기본 임무 (FR-E-56, M33) — frontmatter `default: true`. 워크스페이스당 1개
    pub is_default: bool,
}

fn missions_dir(ws_path: &str) -> PathBuf {
    Path::new(ws_path).join(".eqmux").join("missions")
}

fn mission_path(ws_path: &str, id: &str) -> PathBuf {
    missions_dir(ws_path).join(format!("{id}.md"))
}

/// id → 파일 경로 해석 (P-6) — 파일명 일치를 우선하고, 탐색기에서 이름이 바뀐 파일은
/// frontmatter id로 찾는다. list()가 id를 frontmatter에서 뽑으므로(파일명은 폴백),
/// 조회·변경 경로도 같은 규칙이어야 rename 후 상태·배정이 무반응이 되지 않는다.
fn find_path(ws_path: &str, id: &str) -> Option<PathBuf> {
    let direct = mission_path(ws_path, id);
    if direct.exists() {
        return Some(direct);
    }
    for e in fs::read_dir(missions_dir(ws_path)).ok()?.flatten() {
        let p = e.path();
        if p.extension().map(|x| x == "md").unwrap_or(false) {
            if let Some((_, m)) = parse_file(&p) {
                if m.id == id {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn now_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

/// 이름 → 파일명이 되는 id. 한글은 유지하고 경로에 못 쓰는 문자만 걷어낸다.
fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_whitespace() {
                '-'
            } else if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c.to_ascii_lowercase()
            } else {
                '\0'
            }
        })
        .filter(|c| *c != '\0')
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        format!("mission-{}", crate::workspace::now_ms())
    } else {
        s
    }
}

fn split_frontmatter(text: &str) -> (Vec<String>, String) {
    let normalized = text.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let fm = rest[..end].lines().map(str::to_string).collect();
            return (fm, rest[end + 5..].to_string());
        }
    }
    (Vec::new(), normalized)
}

/// 본문에서 "## 목표" 문단과 "## 산출물" 목록을 뽑는다 — 다른 섹션은 무시 (부분 파싱)
fn parse_body(body: &str) -> (String, Vec<String>) {
    let mut goal = Vec::new();
    let mut outputs = Vec::new();
    let mut section = "";
    for line in body.lines() {
        if let Some(h) = line.strip_prefix("## ") {
            section = if h.trim().starts_with("목표") {
                "goal"
            } else if h.trim().starts_with("산출물") {
                "outputs"
            } else {
                ""
            };
            continue;
        }
        match section {
            "goal" if !line.trim().is_empty() => goal.push(line.trim().to_string()),
            "outputs" => {
                if let Some(item) = line.trim().strip_prefix("- ") {
                    outputs.push(item.trim().to_string());
                }
            }
            _ => {}
        }
    }
    (goal.join(" "), outputs)
}

fn parse_file(path: &Path) -> Option<(String, MissionInfo)> {
    let text = fs::read_to_string(path).ok()?;
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let (fm, body) = split_frontmatter(&text);
    let id = roles::fm_value(&fm, "id").unwrap_or_else(|| stem.clone());
    let status = roles::fm_value(&fm, "status")
        .filter(|s| STATUSES.contains(&s.as_str()))
        .unwrap_or_else(|| "todo".into());
    let (goal, outputs) = parse_body(&body);
    Some((
        stem.clone(),
        MissionInfo {
            id,
            name: roles::fm_value(&fm, "name").unwrap_or(stem.clone()),
            status,
            branch: roles::fm_value(&fm, "branch"),
            goal,
            outputs,
            file: format!(".eqmux/missions/{stem}.md"),
            assigned: Vec::new(),
            is_default: roles::fm_value(&fm, "default").map(|v| v == "true").unwrap_or(false),
        },
    ))
}

fn render(m: &MissionInfo) -> String {
    let mut s = String::from("---\n");
    s.push_str(&format!("id: {}\n", m.id));
    s.push_str(&format!("name: {}\n", m.name));
    s.push_str(&format!("status: {}\n", m.status));
    if let Some(b) = &m.branch {
        s.push_str(&format!("branch: {b}\n"));
    }
    if m.is_default {
        s.push_str("default: true\n");
    }
    s.push_str(&format!("updated: {}\n", now_stamp()));
    s.push_str("---\n");
    if !m.goal.is_empty() {
        s.push_str(&format!("\n## 목표\n{}\n", m.goal));
    }
    if !m.outputs.is_empty() {
        s.push_str("\n## 산출물\n");
        for o in &m.outputs {
            s.push_str(&format!("- {o}\n"));
        }
    }
    s
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 임무 목록 — 파일 실측 + 역할 파일 스캔으로 배정 결합 (FR-E-59)
pub fn list(ws_path: &str) -> Vec<MissionInfo> {
    let Ok(entries) = fs::read_dir(missions_dir(ws_path)) else {
        return Vec::new();
    };
    let mut out: Vec<MissionInfo> = entries
        .flatten()
        .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
        .filter_map(|e| parse_file(&e.path()).map(|(_, m)| m))
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    for (session, mission_id) in roles::scan_assignments(ws_path) {
        if let Some(m) = out.iter_mut().find(|m| m.id == mission_id) {
            m.assigned.push(session);
        }
    }
    out
}

/// 임무 생성 (FR-E-50·51) — id는 이름의 슬러그, 충돌 시 -2 -3 …
/// 충돌 검사는 파일명과 frontmatter id 양쪽 (P-6) — rename된 파일의 id와도 겹치면 안 된다
pub fn create(ws_path: &str, name: &str, goal: &str, branch: Option<String>) -> Result<MissionInfo, String> {
    let existing: std::collections::HashSet<String> = list(ws_path).into_iter().map(|m| m.id).collect();
    let base = slug(name);
    let mut id = base.clone();
    let mut n = 1;
    while mission_path(ws_path, &id).exists() || existing.contains(&id) {
        n += 1;
        id = format!("{base}-{n}");
    }
    let m = MissionInfo {
        id: id.clone(),
        name: name.trim().to_string(),
        status: "todo".into(),
        branch: branch.filter(|b| !b.trim().is_empty()),
        goal: goal.trim().to_string(),
        outputs: Vec::new(),
        file: format!(".eqmux/missions/{id}.md"),
        assigned: Vec::new(),
        is_default: false,
    };
    atomic_write(&mission_path(ws_path, &id), &render(&m))?;
    Ok(m)
}

/// 상태 변경 (FR-E-57) — frontmatter만 갱신하고 본문은 그대로 둔다 (외부 편집 보존, FR-E-74)
pub fn set_status(ws_path: &str, id: &str, status: &str) -> Result<(), String> {
    if !STATUSES.contains(&status) {
        return Err(format!("허용되지 않은 상태 — {status}"));
    }
    let path = find_path(ws_path, id).ok_or("임무 파일을 찾을 수 없습니다")?;
    let text = fs::read_to_string(&path).map_err(|_| "임무 파일을 찾을 수 없습니다".to_string())?;
    let (mut fm, body) = split_frontmatter(&text);
    fm.retain(|l| !l.starts_with("status:") && !l.starts_with("updated:"));
    fm.push(format!("status: {status}"));
    fm.push(format!("updated: {}", now_stamp()));
    let mut out = String::from("---\n");
    for l in &fm {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str("---\n");
    out.push_str(&body);
    atomic_write(&path, &out)
}

/// 단건 조회 — 배정 토글이 임무 블록을 만들 때 쓴다
pub fn get(ws_path: &str, id: &str) -> Option<MissionInfo> {
    parse_file(&find_path(ws_path, id)?).map(|(_, m)| m)
}

/// frontmatter의 default 키만 고쳐 쓴다 — 본문·다른 키는 보존 (FR-E-74와 같은 원칙)
fn write_default_flag(path: &Path, on: bool) -> Result<(), String> {
    let text = fs::read_to_string(path).map_err(|_| "임무 파일을 찾을 수 없습니다".to_string())?;
    let (mut fm, body) = split_frontmatter(&text);
    let has = fm.iter().any(|l| l.trim() == "default: true");
    if has == on {
        return Ok(()); // 변화 없음 — 파일을 다시 쓰지 않는다 (외부 편집 보존)
    }
    fm.retain(|l| !l.starts_with("default:") && !l.starts_with("updated:"));
    if on {
        fm.push("default: true".into());
    }
    fm.push(format!("updated: {}", now_stamp()));
    let mut out = String::from("---\n");
    for l in &fm {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str("---\n");
    out.push_str(&body);
    atomic_write(path, &out)
}

/// 워크스페이스 기본 임무 지정 (FR-E-56, M33) — 켜면 다른 임무의 default는 걷어낸다 (1개 규칙).
/// 임무 없는 세션의 자동 배정은 프런트가 세션 생성 시점에 이 플래그를 보고 수행한다.
pub fn set_default(ws_path: &str, id: &str, on: bool) -> Result<(), String> {
    // 대상은 frontmatter id로 푼다 (P-6) — 탐색기 rename 후에도 같은 임무를 가리켜야 한다
    let target = find_path(ws_path, id).ok_or("임무 파일을 찾을 수 없습니다")?;
    if on {
        let Ok(entries) = fs::read_dir(missions_dir(ws_path)) else {
            return Err("임무 디렉터리가 없습니다".into());
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "md").unwrap_or(false) && p != target {
                let _ = write_default_flag(&p, false); // 깨진 파일은 건너뛴다 (부분 파싱 원칙)
            }
        }
    }
    write_default_flag(&target, on)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::roles;

    fn temp_ws(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("eqmux-test-{tag}-{}", crate::workspace::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn payload(session: &str) -> roles::RolePayload {
        roles::RolePayload {
            session: session.into(),
            persona: "kai".into(),
            persona_name: "카이".into(),
            hint: "전체 구조와 위험을 먼저 본다".into(),
            tone: String::new(),
            personality: String::new(),
            job: "lead".into(),
            job_name: "리드".into(),
            permissions: roles::RolePermissions { write: true, commit: true, push: false },
            responsibility: "전체 구조 · 최종 판단".into(),
            forbidden: "원격 push".into(),
            character_path: None,
            character_name: None,
            character_source: None,
            teammates: vec![roles::Teammate { slot: 1, name: "카이".into(), job_name: "리드".into(), me: true }],
        }
    }

    #[test]
    fn mission_file_roundtrip_and_status() {
        let ws = temp_ws("mission");
        let m = create(&ws, "인증 리팩터", "결합을 낮춘다", Some("feature/auth".into())).unwrap();
        assert_eq!(m.id, "인증-리팩터");
        let listed = list(&ws);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "인증 리팩터");
        assert_eq!(listed[0].goal, "결합을 낮춘다");
        assert_eq!(listed[0].branch.as_deref(), Some("feature/auth"));
        set_status(&ws, &m.id, "in-review").unwrap();
        assert_eq!(get(&ws, &m.id).unwrap().status, "in-review");
        assert!(set_status(&ws, &m.id, "잘못된값").is_err());
        fs::remove_dir_all(&ws).ok();
    }

    /// 파일명 ↔ frontmatter id 불일치 (P-6) — 탐색기 rename 후에도 id로 상태·기본 임무·조회가
    /// 전부 동작해야 한다. 이전에는 파일명으로만 찾아 조용히 무반응이었다.
    #[test]
    fn renamed_mission_file_still_resolves_by_id() {
        let ws = temp_ws("rename");
        let m = create(&ws, "리네임 대상", "목표", None).unwrap();
        fs::rename(mission_path(&ws, &m.id), missions_dir(&ws).join("다른이름.md")).unwrap();
        set_status(&ws, &m.id, "in-progress").unwrap();
        let got = get(&ws, &m.id).unwrap();
        assert_eq!(got.status, "in-progress");
        set_default(&ws, &m.id, true).unwrap();
        assert!(get(&ws, &m.id).unwrap().is_default);
        // 새 임무 생성이 rename된 파일의 frontmatter id와 충돌하지 않는다
        let m2 = create(&ws, "리네임 대상", "다른 목표", None).unwrap();
        assert_ne!(m2.id, m.id);
        fs::remove_dir_all(&ws).ok();
    }

    /// 기본 임무 (FR-E-56, M33) — 워크스페이스당 1개. 켜면 다른 임무의 default가 걷힌다.
    /// frontmatter만 갱신되고 본문·상태는 보존된다.
    #[test]
    fn default_mission_is_exclusive_and_preserves_body() {
        let ws = temp_ws("default");
        let a = create(&ws, "임무 A", "목표 A", None).unwrap();
        let b = create(&ws, "임무 B", "목표 B", Some("feat/b".into())).unwrap();
        set_default(&ws, &a.id, true).unwrap();
        assert!(get(&ws, &a.id).unwrap().is_default);
        assert!(!get(&ws, &b.id).unwrap().is_default);
        // 다른 임무를 기본으로 — A의 플래그가 걷힌다 (1개 규칙)
        set_default(&ws, &b.id, true).unwrap();
        assert!(!get(&ws, &a.id).unwrap().is_default);
        let b2 = get(&ws, &b.id).unwrap();
        assert!(b2.is_default);
        assert_eq!(b2.goal, "목표 B"); // 본문 보존
        assert_eq!(b2.branch.as_deref(), Some("feat/b")); // 다른 frontmatter 키 보존
        // 해제 — 아무도 기본이 아니다
        set_default(&ws, &b.id, false).unwrap();
        assert!(list(&ws).iter().all(|m| !m.is_default));
        fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn role_synthesis_preserves_mission_block() {
        let ws = temp_ws("role");
        let m = create(&ws, "회귀 검증", "증거 수집", None).unwrap();
        // 합성 → 배정 → 재합성해도 블록 보존 → 재배정 멱등 → 해제
        roles::save(&ws, &payload("kai@test")).unwrap();
        let block = roles::MissionBlock {
            id: m.id.clone(),
            name: m.name.clone(),
            status: m.status.clone(),
            goal: m.goal.clone(),
            outputs: vec![],
            branch: None,
        };
        roles::set_mission(&ws, "kai@test", Some(&block)).unwrap();
        assert_eq!(roles::scan_assignments(&ws), vec![("kai@test".into(), m.id.clone())]);
        assert_eq!(list(&ws)[0].assigned, vec!["kai@test".to_string()]);

        roles::save(&ws, &payload("kai@test")).unwrap(); // 재합성 — 블록이 살아남아야 한다
        assert_eq!(roles::scan_assignments(&ws).len(), 1);

        roles::set_mission(&ws, "kai@test", Some(&block)).unwrap(); // 멱등 (FR-E-54)
        let text = fs::read_to_string(roles::role_path(&ws, "kai@test")).unwrap();
        assert_eq!(text.matches("EQMUX:MISSION").count(), 2); // 여는·닫는 마커 1쌍뿐

        roles::set_mission(&ws, "kai@test", None).unwrap(); // 해제 = 블록 삭제
        assert!(roles::scan_assignments(&ws).is_empty());
        let text = fs::read_to_string(roles::role_path(&ws, "kai@test")).unwrap();
        assert!(!text.contains("EQMUX:MISSION"));
        assert!(text.contains("## 책임")); // 본문은 보존

        // gitignore 자동 생성 (FR-E-35)
        let gi = fs::read_to_string(std::path::Path::new(&ws).join(".eqmux").join(".gitignore")).unwrap();
        assert!(gi.lines().any(|l| l.trim() == "roles/"));
        fs::remove_dir_all(&ws).ok();
    }
}
