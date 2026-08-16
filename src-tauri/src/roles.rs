// 역할 파일 (PRD E §4.4) — 캐스팅 결과를 .eqmux/roles/<세션>.md로 합성 저장한다 (FR-E-31).
// 합성 소스는 셋 — 직무(책임·권한·금지) · 페르소나(판단 성향) · team.json(관계) (FR-E-32).
// roles/는 gitignore 대상이며 앱이 .eqmux/.gitignore를 자동 생성한다 (FR-E-35).
// 임무 배정은 이 파일의 임무 블록이 원본이다 (FR-E-53·58) — 같은 임무 재배정은 멱등,
// 다른 임무는 통째 교체, 해제는 블록 삭제 (FR-E-54).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MISSION_START: &str = "<!-- EQMUX:MISSION ";
const MISSION_END: &str = "<!-- /EQMUX:MISSION -->";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RolePermissions {
    pub write: bool,
    pub commit: bool,
    pub push: bool,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Teammate {
    pub slot: u8,
    pub name: String,
    pub job_name: String,
    pub me: bool,
}

/// 합성 입력 — 라이브러리(직무·페르소나)는 프런트가 소유하므로 값으로 받는다
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RolePayload {
    pub session: String,
    pub persona: String,
    pub persona_name: String,
    pub hint: String,
    /// 말투·성격 (중간 단계 · 선택) — 비면 섹션이 출력되지 않는다
    #[serde(default)]
    pub tone: String,
    #[serde(default)]
    pub personality: String,
    pub job: String,
    pub job_name: String,
    pub permissions: RolePermissions,
    pub responsibility: String,
    pub forbidden: String,
    /// 고급 캐릭터 시트 (선택) — 전재하지 않고 경로 포인터만 실린다 (FR-E-40과 같은 태도)
    #[serde(default)]
    pub character_path: Option<String>,
    #[serde(default)]
    pub character_name: Option<String>,
    #[serde(default)]
    pub character_source: Option<String>,
    #[serde(default)]
    pub teammates: Vec<Teammate>,
}

/// 임무 블록 내용 (FR-E-53) — 원본 정의 파일(.eqmux/missions/*.md)의 포인터를 포함한다
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MissionBlock {
    pub id: String,
    pub name: String,
    pub status: String,
    pub goal: String,
    #[serde(default)]
    pub outputs: Vec<String>,
    #[serde(default)]
    pub branch: Option<String>,
}

fn safe_name(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '@' | '-' | '_' | '.') { c } else { '_' })
        .collect()
}

pub fn roles_dir(ws_path: &str) -> PathBuf {
    Path::new(ws_path).join(".eqmux").join("roles")
}

pub fn role_path(ws_path: &str, session: &str) -> PathBuf {
    roles_dir(ws_path).join(format!("{}.md", safe_name(session)))
}

fn now_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// .eqmux/.gitignore 자동 생성 (FR-E-35) — roles/와 worktrees/(FR-E-62)가
/// git status에 나타나지 않게 한다
pub fn ensure_gitignore(ws_path: &str) -> Result<(), String> {
    let dir = Path::new(ws_path).join(".eqmux");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(".gitignore");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut next = existing.clone();
    for entry in ["roles/", "worktrees/"] {
        if next.lines().any(|l| l.trim() == entry) {
            continue;
        }
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(entry);
        next.push('\n');
    }
    if next == existing {
        return Ok(());
    }
    fs::write(&path, next).map_err(|e| e.to_string())
}

/// 파일 → (frontmatter 줄들, 본문). frontmatter가 없으면 전부 본문 (FR-E-72 부분 파싱).
pub(crate) fn split_frontmatter(text: &str) -> (Vec<String>, String) {
    let normalized = text.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let fm = rest[..end].lines().map(str::to_string).collect();
            let body = rest[end + 5..].to_string();
            return (fm, body);
        }
    }
    (Vec::new(), normalized)
}

pub fn fm_value(fm: &[String], key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    fm.iter().find_map(|l| {
        l.strip_prefix(&prefix)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    })
}

/// 본문에서 임무 블록을 떼어낸다 → (블록 없는 본문, 블록의 임무 id, 블록 원문)
fn strip_mission_block(body: &str) -> (String, Option<String>, Option<String>) {
    let Some(start) = body.find(MISSION_START) else {
        return (body.to_string(), None, None);
    };
    let Some(end_rel) = body[start..].find(MISSION_END) else {
        return (body.to_string(), None, None); // 닫는 마커 없음 — 손대지 않는다 (부분 파싱)
    };
    let end = start + end_rel + MISSION_END.len();
    let id = body[start + MISSION_START.len()..]
        .split_whitespace()
        .next()
        .map(|s| s.trim_end_matches("-->").to_string());
    let block = body[start..end].to_string();
    let mut rest = String::new();
    rest.push_str(body[..start].trim_end_matches(['\n', ' ']));
    let tail = body[end..].trim_start_matches('\n');
    if !tail.is_empty() {
        rest.push_str("\n\n");
        rest.push_str(tail);
    }
    (rest, id, Some(block))
}

fn mission_block_text(m: &MissionBlock) -> String {
    let mut s = format!("{}{} -->\n## 임무 — {}\n", MISSION_START, m.id, m.name);
    s.push_str(&format!(
        "상태: {} · 브랜치: {}\n",
        m.status,
        m.branch.as_deref().unwrap_or("(미연결)")
    ));
    if !m.goal.is_empty() {
        s.push_str(&format!("목표: {}\n", m.goal));
    }
    if !m.outputs.is_empty() {
        s.push_str("산출물:\n");
        for o in &m.outputs {
            s.push_str(&format!("- {o}\n"));
        }
    }
    s.push_str(&format!("정의: .eqmux/missions/{}.md\n", m.id));
    s.push_str(MISSION_END);
    s
}

fn frontmatter_text(p: &RolePayload, mission_id: Option<&str>) -> String {
    let mut s = String::from("---\n");
    s.push_str(&format!("session: {}\n", p.session));
    s.push_str(&format!("persona: {}\n", p.persona));
    s.push_str(&format!("job: {}\n", p.job));
    s.push_str("permissions:\n");
    s.push_str(&format!("  write: {}\n", p.permissions.write));
    s.push_str(&format!("  commit: {}\n", p.permissions.commit));
    s.push_str(&format!("  push: {}\n", p.permissions.push));
    if let Some(m) = mission_id {
        s.push_str(&format!("mission: {m}\n"));
    }
    s.push_str(&format!("updated: {}\n", now_stamp()));
    s.push_str("---\n");
    s
}

/// 역할 파일 합성 저장 (FR-E-31~33) — 기존 임무 블록은 보존한다.
/// 반환값은 절대 경로 (에이전트 주입에 쓰인다).
pub fn save(ws_path: &str, p: &RolePayload) -> Result<String, String> {
    ensure_gitignore(ws_path)?;
    let path = role_path(ws_path, &p.session);
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let (_, body) = split_frontmatter(&existing);
    let (_, mission_id, mission_block) = strip_mission_block(&body);

    let mut out = frontmatter_text(p, mission_id.as_deref());
    out.push_str(&format!("\n# {} — {}\n", p.persona_name, p.job_name));
    if !p.hint.is_empty() {
        out.push_str(&format!("\n## 판단 성향\n{}\n", p.hint));
    }
    // 중간 단계 (3단계 페르소나) — 채워진 것만 출력, 비면 토큰 0
    if !p.tone.is_empty() {
        out.push_str(&format!("\n## 말투\n{}\n", p.tone));
    }
    if !p.personality.is_empty() {
        out.push_str(&format!("\n## 성격\n{}\n", p.personality));
    }
    // 고급 단계 — 시트는 전재하지 않는다. 정체성 1줄 + 경로 + 우선순위 문장이 전부다.
    if let Some(sheet) = p.character_path.as_deref().filter(|s| !s.is_empty()) {
        let name = p.character_name.as_deref().filter(|s| !s.is_empty()).unwrap_or(&p.persona_name);
        let who = match p.character_source.as_deref().filter(|s| !s.is_empty()) {
            Some(src) => format!("{name} ({src})"),
            None => name.to_string(),
        };
        out.push_str(&format!(
            "\n## 캐릭터\n\"{who}\" 캐릭터로 응답한다 — 시작 전에 시트를 읽을 것:\n{sheet}\n시트와 말투·성격 섹션이 겹치면 시트가 우선. 책임·금지·권한은 캐릭터보다 항상 우선.\n"
        ));
    }
    if !p.responsibility.is_empty() {
        out.push_str(&format!("\n## 책임\n{}\n", p.responsibility));
    }
    if !p.forbidden.is_empty() {
        out.push_str(&format!("\n## 금지\n{}\n", p.forbidden));
    }
    if !p.teammates.is_empty() {
        out.push_str("\n## 팀 관계 (team.md 참조)\n| 슬롯 | 팀원 | 직무 |\n|---|---|---|\n");
        for t in &p.teammates {
            let me = if t.me { " (나)" } else { "" };
            out.push_str(&format!("| {} | {}{} | {} |\n", t.slot, t.name, me, t.job_name));
        }
    }
    if let Some(block) = mission_block {
        out.push('\n');
        out.push_str(&block);
        out.push('\n');
    }
    atomic_write(&path, &out)?;
    Ok(path.to_string_lossy().into_owned())
}

/// 임무 블록 삽입·교체·해제 (FR-E-53·54) — frontmatter의 mission 키도 함께 갱신한다.
/// 역할 파일이 없는 세션(기본 터미널)에 배정하면 최소 스텁을 만든다 — 파일이 원본(불변 규칙 4).
pub fn set_mission(ws_path: &str, session: &str, mission: Option<&MissionBlock>) -> Result<(), String> {
    let path = role_path(ws_path, session);
    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.is_empty() && mission.is_none() {
        return Ok(()); // 파일도 배정도 없음 — 할 일 없음 (멱등)
    }
    ensure_gitignore(ws_path)?;
    let (mut fm, body) = split_frontmatter(&existing);
    let (clean_body, _, _) = strip_mission_block(&body);

    fm.retain(|l| !l.starts_with("mission:") && !l.starts_with("updated:"));
    if fm.is_empty() {
        fm.push(format!("session: {session}"));
    }
    if let Some(m) = mission {
        fm.push(format!("mission: {}", m.id));
    }
    fm.push(format!("updated: {}", now_stamp()));

    let mut out = String::from("---\n");
    for l in &fm {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str("---\n");
    let trimmed = clean_body.trim_end();
    if !trimmed.is_empty() {
        out.push_str(trimmed);
        out.push('\n');
    }
    if let Some(m) = mission {
        out.push('\n');
        out.push_str(&mission_block_text(m));
        out.push('\n');
    }
    atomic_write(&path, &out)
}

/// 역할 해제·세션 제거 시 파일 삭제 — 없는 파일은 성공으로 친다
pub fn remove(ws_path: &str, session: &str) -> Result<(), String> {
    let path = role_path(ws_path, session);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 3단계 페르소나 합성 — 기본 단계는 출력 변화 0, 중간·고급은 채워진 섹션만 추가된다
    #[test]
    fn save_renders_optional_persona_sections() {
        let dir = std::env::temp_dir().join(format!("eqmux-roles-3tier-{}", crate::workspace::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let ws = dir.to_string_lossy().into_owned();
        let mut p = RolePayload {
            session: "s1".into(),
            persona: "kai".into(),
            persona_name: "카이".into(),
            hint: "전체 구조와 위험을 먼저 본다".into(),
            tone: String::new(),
            personality: String::new(),
            job: "lead".into(),
            job_name: "리드".into(),
            permissions: RolePermissions { write: true, commit: false, push: false },
            responsibility: "전체 구조".into(),
            forbidden: "원격 push".into(),
            character_path: None,
            character_name: None,
            character_source: None,
            teammates: Vec::new(),
        };
        let path = save(&ws, &p).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("## 말투") && !text.contains("## 성격") && !text.contains("## 캐릭터"));
        p.tone = "간결한 존댓말 · 결론부터".into();
        p.personality = "신중함".into();
        p.character_path = Some("X:/personas/kai.character.md".into());
        p.character_name = Some("별지기 루카".into());
        p.character_source = Some("창작 캐릭터".into());
        save(&ws, &p).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("## 말투\n간결한 존댓말 · 결론부터"));
        assert!(text.contains("## 성격\n신중함"));
        assert!(text.contains("\"별지기 루카 (창작 캐릭터)\" 캐릭터로 응답한다"));
        assert!(text.contains("X:/personas/kai.character.md"));
        // 캐릭터 블록은 성향 뒤 · 책임 앞 — 화법은 판단·책임 규칙보다 앞설 수 없다는 배치
        let (c, r) = (text.find("## 캐릭터").unwrap(), text.find("## 책임").unwrap());
        assert!(text.find("## 판단 성향").unwrap() < c && c < r);
        // 시트 이름이 비면 페르소나 이름으로 정체성 줄을 만든다
        p.character_name = None;
        p.character_source = None;
        save(&ws, &p).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("\"카이\" 캐릭터로 응답한다"));
        fs::remove_dir_all(&dir).ok();
    }
}

/// roles/*.md frontmatter 실측 스캔 (FR-E-59) — (세션, 임무 id) 목록. 배정의 원본이다.
pub fn scan_assignments(ws_path: &str) -> Vec<(String, String)> {
    let Ok(entries) = fs::read_dir(roles_dir(ws_path)) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().map(|e| e == "md").unwrap_or(false) {
            if let Ok(text) = fs::read_to_string(&p) {
                let (fm, _) = split_frontmatter(&text);
                if let (Some(session), Some(mission)) = (fm_value(&fm, "session"), fm_value(&fm, "mission")) {
                    out.push((session, mission));
                }
            }
        }
    }
    out
}
