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
}

fn missions_dir(ws_path: &str) -> PathBuf {
    Path::new(ws_path).join(".eqmux").join("missions")
}

fn mission_path(ws_path: &str, id: &str) -> PathBuf {
    missions_dir(ws_path).join(format!("{id}.md"))
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
pub fn create(ws_path: &str, name: &str, goal: &str, branch: Option<String>) -> Result<MissionInfo, String> {
    let base = slug(name);
    let mut id = base.clone();
    let mut n = 1;
    while mission_path(ws_path, &id).exists() {
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
    };
    atomic_write(&mission_path(ws_path, &id), &render(&m))?;
    Ok(m)
}

/// 상태 변경 (FR-E-57) — frontmatter만 갱신하고 본문은 그대로 둔다 (외부 편집 보존, FR-E-74)
pub fn set_status(ws_path: &str, id: &str, status: &str) -> Result<(), String> {
    if !STATUSES.contains(&status) {
        return Err(format!("허용되지 않은 상태 — {status}"));
    }
    let path = mission_path(ws_path, id);
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
    parse_file(&mission_path(ws_path, id)).map(|(_, m)| m)
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
            job: "lead".into(),
            job_name: "리드".into(),
            permissions: roles::RolePermissions { write: true, commit: true, push: false },
            responsibility: "전체 구조 · 최종 판단".into(),
            forbidden: "원격 push".into(),
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
