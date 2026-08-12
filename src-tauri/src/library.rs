// 역할 라이브러리 (PRD E §4.3) — 직무(job)와 페르소나(persona)를 분리해 파일로 보관한다 (FR-E-20).
// 저장 위치는 전역(앱 데이터 jobs/·personas/) + 워크스페이스 오버라이드(.eqmux/jobs/·personas/)
// 2단이며 같은 id면 워크스페이스가 이긴다 (FR-E-21 · P2). 첫 실행에 시드를 번들한다 (FR-E-27).
// 손상·스키마 불일치는 부분 파싱으로 견딘다 (FR-E-72) — 필드가 없으면 기본값.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::roles::{fm_value, split_frontmatter};

/// 직무 — frontmatter(id·name·default_permissions) + 본문(책임·금지) (FR-E-22)
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: String,
    pub name: String,
    pub permissions: crate::roles::RolePermissions,
    pub responsibility: String,
    pub forbidden: String,
}

/// 페르소나 — frontmatter(id·name·color) + 본문(판단 성향) (FR-E-23)
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonaInfo {
    pub id: String,
    pub name: String,
    pub hint: String,
    pub color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryData {
    pub jobs: Vec<JobInfo>,
    pub personas: Vec<PersonaInfo>,
}

const COLORS: [&str; 4] = ["blue", "purple", "green", "amber"];

fn jobs_dir(root: &Path) -> PathBuf {
    root.join("jobs")
}

fn personas_dir(root: &Path) -> PathBuf {
    root.join("personas")
}

fn safe_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .collect()
}

fn parse_bool_line(fm: &[String], key: &str) -> bool {
    fm.iter()
        .find_map(|l| l.trim().strip_prefix(&format!("{key}:")).map(|v| v.trim() == "true"))
        .unwrap_or(false)
}

/// 본문에서 "## 책임"·"## 금지" 문단을 뽑는다 — missions와 같은 관용 파싱
fn parse_job_body(body: &str) -> (String, String) {
    let mut responsibility = Vec::new();
    let mut forbidden = Vec::new();
    let mut section = "";
    for line in body.lines() {
        if let Some(h) = line.strip_prefix("## ") {
            section = if h.trim().starts_with("책임") {
                "r"
            } else if h.trim().starts_with("금지") {
                "f"
            } else {
                ""
            };
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        match section {
            "r" => responsibility.push(line.trim().to_string()),
            "f" => forbidden.push(line.trim().to_string()),
            _ => {}
        }
    }
    (responsibility.join(" "), forbidden.join(" "))
}

fn parse_job(path: &Path) -> Option<JobInfo> {
    let text = fs::read_to_string(path).ok()?;
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let (fm, body) = split_frontmatter(&text);
    let (responsibility, forbidden) = parse_job_body(&body);
    Some(JobInfo {
        id: fm_value(&fm, "id").unwrap_or(stem.clone()),
        name: fm_value(&fm, "name").unwrap_or(stem),
        permissions: crate::roles::RolePermissions {
            write: parse_bool_line(&fm, "write"),
            commit: parse_bool_line(&fm, "commit"),
            push: parse_bool_line(&fm, "push"),
        },
        responsibility,
        forbidden,
    })
}

fn parse_persona(path: &Path) -> Option<PersonaInfo> {
    let text = fs::read_to_string(path).ok()?;
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let (fm, body) = split_frontmatter(&text);
    let color = fm_value(&fm, "color")
        .filter(|c| COLORS.contains(&c.as_str()))
        .unwrap_or_else(|| "blue".into());
    Some(PersonaInfo {
        id: fm_value(&fm, "id").unwrap_or(stem.clone()),
        name: fm_value(&fm, "name").unwrap_or(stem),
        hint: body.trim().to_string(),
        color,
    })
}

fn read_dir_md(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "md").unwrap_or(false))
        .collect();
    out.sort();
    out
}

/// 전역 + 워크스페이스 오버라이드 병합 (FR-E-21) — 같은 id면 나중(워크스페이스)이 이긴다
pub fn list(app_root: &Path, ws_path: Option<&str>) -> LibraryData {
    let mut jobs: Vec<JobInfo> = Vec::new();
    let mut personas: Vec<PersonaInfo> = Vec::new();
    let mut job_dirs = vec![jobs_dir(app_root)];
    let mut persona_dirs = vec![personas_dir(app_root)];
    if let Some(ws) = ws_path {
        job_dirs.push(Path::new(ws).join(".eqmux").join("jobs"));
        persona_dirs.push(Path::new(ws).join(".eqmux").join("personas"));
    }
    for dir in job_dirs {
        for p in read_dir_md(&dir) {
            if let Some(j) = parse_job(&p) {
                jobs.retain(|x| x.id != j.id);
                jobs.push(j);
            }
        }
    }
    for dir in persona_dirs {
        for p in read_dir_md(&dir) {
            if let Some(x) = parse_persona(&p) {
                personas.retain(|e| e.id != x.id);
                personas.push(x);
            }
        }
    }
    LibraryData { jobs, personas }
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn render_job(j: &JobInfo) -> String {
    format!(
        "---\nid: {}\nname: {}\ndefault_permissions:\n  write: {}\n  commit: {}\n  push: {}\n---\n\n## 책임\n{}\n\n## 금지\n{}\n",
        j.id, j.name, j.permissions.write, j.permissions.commit, j.permissions.push, j.responsibility, j.forbidden
    )
}

fn render_persona(p: &PersonaInfo) -> String {
    format!("---\nid: {}\nname: {}\ncolor: {}\n---\n\n{}\n", p.id, p.name, p.color, p.hint)
}

/// 전역 계층에 저장 (FR-E-28) — 워크스페이스 오버라이드 편집은 파일로 직접 한다
pub fn save_persona(app_root: &Path, p: &PersonaInfo) -> Result<(), String> {
    atomic_write(&personas_dir(app_root).join(format!("{}.md", safe_id(&p.id))), &render_persona(p))
}

pub fn save_job(app_root: &Path, j: &JobInfo) -> Result<(), String> {
    atomic_write(&jobs_dir(app_root).join(format!("{}.md", safe_id(&j.id))), &render_job(j))
}

pub fn delete_persona(app_root: &Path, id: &str) -> Result<(), String> {
    let path = personas_dir(app_root).join(format!("{}.md", safe_id(id)));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 시드 번들 (FR-E-27) — 디렉터리가 없을 때만. 사용자가 지운 항목을 되살리지 않는다.
pub fn seed(app_root: &Path) {
    if !jobs_dir(app_root).exists() {
        let perms = |w, c, p| crate::roles::RolePermissions { write: w, commit: c, push: p };
        let seeds = [
            JobInfo { id: "lead".into(), name: "리드".into(), permissions: perms(true, true, false), responsibility: "전체 구조 · 임무 분해 · 최종 판단".into(), forbidden: "검증 없이 완료 선언 · 원격 push".into() },
            JobInfo { id: "impl".into(), name: "구현".into(), permissions: perms(true, false, false), responsibility: "작은 단위 구현과 자체 검증".into(), forbidden: "검증 없이 커밋 요청".into() },
            JobInfo { id: "verify".into(), name: "검증".into(), permissions: perms(false, false, false), responsibility: "테스트 · 증거 수집".into(), forbidden: "증거 없는 통과 판정".into() },
            JobInfo { id: "review".into(), name: "리뷰".into(), permissions: perms(false, false, false), responsibility: "변경 검토 · 품질 기준".into(), forbidden: "리뷰 없이 승인".into() },
        ];
        for j in &seeds {
            let _ = save_job(app_root, j);
        }
    }
    if !personas_dir(app_root).exists() {
        let seeds = [
            ("kai", "카이", "blue", "전체 구조와 위험을 먼저 본다"),
            ("noel", "노엘", "purple", "작은 단위로 구현하고 검증한다"),
            ("lin", "린", "green", "경계와 정합성"),
            ("sol", "솔", "amber", "증거 없는 완료를 인정하지 않는다"),
            ("mira", "미라", "blue", "운영 비용과 관측"),
            ("jun", "준", "purple", "계약과 인터페이스 우선"),
            ("hana", "하나", "green", "문서와 재현 절차"),
            ("luca", "루카", "blue", "사용자 흐름 중심"),
        ];
        for (id, name, color, hint) in seeds {
            let _ = save_persona(
                app_root,
                &PersonaInfo { id: id.into(), name: name.into(), hint: hint.into(), color: color.into() },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("eqmux-lib-{tag}-{}", crate::workspace::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn seed_then_list_roundtrip() {
        let root = temp_root("seed");
        seed(&root);
        let lib = list(&root, None);
        assert_eq!(lib.jobs.len(), 4);
        assert_eq!(lib.personas.len(), 8);
        let lead = lib.jobs.iter().find(|j| j.id == "lead").unwrap();
        assert!(lead.permissions.write && lead.permissions.commit && !lead.permissions.push);
        assert_eq!(lead.responsibility, "전체 구조 · 임무 분해 · 최종 판단");
        let kai = lib.personas.iter().find(|p| p.id == "kai").unwrap();
        assert_eq!(kai.hint, "전체 구조와 위험을 먼저 본다");
        // 편집 왕복 (FR-E-28)
        let mut edited = kai.clone();
        edited.hint = "위험 우선 · 되돌릴 수 없는 결정을 늦춘다".into();
        edited.color = "amber".into();
        save_persona(&root, &edited).unwrap();
        let again = list(&root, None);
        let kai2 = again.personas.iter().find(|p| p.id == "kai").unwrap();
        assert_eq!(kai2.hint, edited.hint);
        assert_eq!(kai2.color, "amber");
        delete_persona(&root, "kai").unwrap();
        assert!(list(&root, None).personas.iter().all(|p| p.id != "kai"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn workspace_override_wins() {
        let root = temp_root("override");
        seed(&root);
        let ws = temp_root("ws");
        let ws_jobs = ws.join(".eqmux").join("jobs");
        fs::create_dir_all(&ws_jobs).unwrap();
        fs::write(
            ws_jobs.join("lead.md"),
            "---\nid: lead\nname: 수석\ndefault_permissions:\n  write: true\n  commit: true\n  push: true\n---\n\n## 책임\n오버라이드 책임\n",
        )
        .unwrap();
        let lib = list(&root, Some(&ws.to_string_lossy()));
        let lead = lib.jobs.iter().find(|j| j.id == "lead").unwrap();
        assert_eq!(lead.name, "수석"); // 같은 id면 워크스페이스가 이긴다 (FR-E-21)
        assert!(lead.permissions.push);
        assert_eq!(lib.jobs.len(), 4); // 교체이지 추가가 아니다
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&ws).ok();
    }
}
