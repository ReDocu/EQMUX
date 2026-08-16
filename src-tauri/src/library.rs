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
    /// 읽은 시점의 파일 mtime (P-7) — 저장 시 외부 변경 충돌 감지에 쓴다 (fsx와 같은 규칙)
    #[serde(default)]
    pub mtime_ms: i64,
}

/// 단계별 독립 프로필 — 기본/중급/고급이 판단 성향까지 각자 한 벌씩 갖는다.
/// 활성 단계(level)의 프로필만 표시·주입되고, 나머지는 파일에 보존된다 (전환 시 통째 교체).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersonaProfile {
    #[serde(default)]
    pub hint: String,
    #[serde(default)]
    pub tone: String,
    #[serde(default)]
    pub personality: String,
}

/// 페르소나 — frontmatter(id·name·color·level) + 본문(단계별 프로필 섹션) (FR-E-23).
/// 단계는 명시적 상태다 — `level: basic|mid|adv`가 어떤 프로필을 쓸지 정하고,
/// 고급은 캐릭터 시트(<id>.character.md)를 추가로 갖는다.
/// level 키가 없는 구 파일은 내용(말투·성격·시트 존재)으로 유추한다 — 다음 저장 때 기록된다.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersonaInfo {
    pub id: String,
    pub name: String,
    /// 명시적 단계 — "basic" | "mid" | "adv". 빈 값이면 렌더 시 생략(구 포맷 유지)
    #[serde(default)]
    pub level: String,
    /// 단계별 프로필 3벌 — 저장의 원본. 편집 화면이 단계마다 따로 채운다
    #[serde(default)]
    pub basic: PersonaProfile,
    #[serde(default)]
    pub mid: PersonaProfile,
    #[serde(default)]
    pub adv: PersonaProfile,
    /// 활성 프로필 편의 사본 (목록·캐스팅 표시·역할 합성용) — 읽기에서 채워지고 저장 시엔 무시된다
    #[serde(default)]
    pub hint: String,
    #[serde(default)]
    pub tone: String,
    #[serde(default)]
    pub personality: String,
    pub color: String,
    /// 기본 직무 — 역할 부여가 직무 선택 없이 따라가는 값. 빈 값 = 미지정 (프런트가 기본값으로 받친다)
    #[serde(default)]
    pub job: String,
    /// 고급 캐릭터 시트 절대 경로 — personas/<id>.character.md, 존재가 곧 고급 단계
    #[serde(default)]
    pub character_path: Option<String>,
    #[serde(default)]
    pub character_name: Option<String>,
    #[serde(default)]
    pub character_source: Option<String>,
    /// 읽은 시점의 파일 mtime (P-7) — 저장 시 외부 변경 충돌 감지에 쓴다
    #[serde(default)]
    pub mtime_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryData {
    pub jobs: Vec<JobInfo>,
    pub personas: Vec<PersonaInfo>,
}

/// 편성 프리셋 (FR-E-26) — 전역 앱데이터 `presets/*.json`이 원본. 직무 구성만 담는다 —
/// 페르소나 배정은 캐스팅 화면의 몫이다 (P1 직무/페르소나 분리와 일관).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub jobs: Vec<String>,
}

// 직무 8색 팔레트와 정렬 (프런트 jobs.ts JOB_META) — amber는 구 데이터 호환용
const COLORS: [&str; 9] = ["blue", "cyan", "purple", "pink", "green", "red", "slate", "orange", "amber"];

fn jobs_dir(root: &Path) -> PathBuf {
    root.join("jobs")
}

fn personas_dir(root: &Path) -> PathBuf {
    root.join("personas")
}

fn presets_dir(root: &Path) -> PathBuf {
    root.join("presets")
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

fn file_mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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
        mtime_ms: file_mtime_ms(path),
    })
}

/// 페르소나 본문 섹션 파싱 — "## 판단 성향"·"## 말투"·"## 성격".
/// 헤더가 하나도 없으면 본문 전체가 판단 성향이다 — 기존 파일 하위호환 (FR-E-72 관용 파싱)
fn parse_persona_body(body: &str) -> (String, String, String) {
    if !body.lines().any(|l| l.starts_with("## ")) {
        return (body.trim().to_string(), String::new(), String::new());
    }
    let mut hint = Vec::new();
    let mut tone = Vec::new();
    let mut personality = Vec::new();
    let mut section = "h"; // 첫 헤더 이전 내용도 판단 성향으로 거둔다
    for line in body.lines() {
        if let Some(h) = line.strip_prefix("## ") {
            let h = h.trim();
            section = if h.starts_with("판단") {
                "h"
            } else if h.starts_with("말투") {
                "t"
            } else if h.starts_with("성격") {
                "p"
            } else {
                ""
            };
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        match section {
            "h" => hint.push(line.trim().to_string()),
            "t" => tone.push(line.trim().to_string()),
            "p" => personality.push(line.trim().to_string()),
            _ => {}
        }
    }
    (hint.join("\n"), tone.join("\n"), personality.join("\n"))
}

/// 고급 캐릭터 시트 검출 — 페르소나 파일과 같은 디렉터리의 <id>.character.md.
/// 존재가 곧 고급 단계다. frontmatter의 name·source는 역할 파일 캐릭터 블록의 정체성 줄에 쓴다.
fn character_info(dir: Option<&Path>, id: &str) -> (Option<String>, Option<String>, Option<String>) {
    let Some(dir) = dir else { return (None, None, None) };
    let path = dir.join(format!("{}.character.md", safe_id(id)));
    let Ok(text) = fs::read_to_string(&path) else { return (None, None, None) };
    let (fm, _) = split_frontmatter(&text);
    (
        Some(path.to_string_lossy().into_owned()),
        fm_value(&fm, "name"),
        fm_value(&fm, "source"),
    )
}

const LEVELS: [&str; 3] = ["basic", "mid", "adv"];

/// 단계별 프로필 본문 파싱 — "## 기본/중급/고급" 아래 "### 판단 성향/말투/성격".
/// 프로필 헤더가 없으면 None → 구 포맷 폴백 (마이그레이션)
fn parse_profiles(body: &str) -> Option<[PersonaProfile; 3]> {
    if !body.lines().any(|l| matches!(l.trim(), "## 기본" | "## 중급" | "## 고급")) {
        return None;
    }
    let mut profiles: [PersonaProfile; 3] = Default::default();
    let mut pi: Option<usize> = None;
    let mut field = "";
    for line in body.lines() {
        if let Some(h) = line.strip_prefix("## ") {
            pi = match h.trim() {
                "기본" => Some(0),
                "중급" => Some(1),
                "고급" => Some(2),
                _ => None,
            };
            field = "";
            continue;
        }
        if let Some(h) = line.strip_prefix("### ") {
            let h = h.trim();
            field = if h.starts_with("판단") {
                "h"
            } else if h.starts_with("말투") {
                "t"
            } else if h.starts_with("성격") {
                "p"
            } else {
                ""
            };
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        let Some(i) = pi else { continue };
        let target = match field {
            "h" => &mut profiles[i].hint,
            "t" => &mut profiles[i].tone,
            "p" => &mut profiles[i].personality,
            _ => continue,
        };
        if !target.is_empty() {
            target.push('\n');
        }
        target.push_str(line.trim());
    }
    Some(profiles)
}

fn parse_persona(path: &Path) -> Option<PersonaInfo> {
    let text = fs::read_to_string(path).ok()?;
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let (fm, body) = split_frontmatter(&text);
    let color = fm_value(&fm, "color")
        .filter(|c| COLORS.contains(&c.as_str()))
        .unwrap_or_else(|| "blue".into());
    // 프로필 3벌 — 새 포맷이 원본. 구 포맷(단일 본문)은 세 프로필에 복사해 마이그레이션한다:
    // 어느 단계로 전환해도 기존 내용이 그대로 남는 것이 사용자 기대에 가깝다.
    let [mut basic, mid, mut adv] = parse_profiles(&body).unwrap_or_else(|| {
        let (hint, tone, personality) = parse_persona_body(&body);
        let p = PersonaProfile { hint, tone, personality };
        [p.clone(), p.clone(), p]
    });
    // 단계별 구성 정규화 (단일 지점 — 표시·주입·재저장 전부에 적용):
    // 기본 = 판단 성향만 · 중급 = 성향+말투+성격 · 고급 = 캐릭터 시트가 전부 (텍스트 프로필 없음)
    basic.tone.clear();
    basic.personality.clear();
    adv.hint.clear();
    adv.tone.clear();
    adv.personality.clear();
    let id = fm_value(&fm, "id").unwrap_or(stem.clone());
    let (character_path, character_name, character_source) = character_info(path.parent(), &id);
    // 단계 — frontmatter가 원본. 없거나 깨진 값이면 내용으로 유추한다 (구 파일 하위호환)
    let level = fm_value(&fm, "level")
        .filter(|l| LEVELS.contains(&l.as_str()))
        .unwrap_or_else(|| {
            if character_path.is_some() {
                "adv".into()
            } else if !mid.tone.is_empty() || !mid.personality.is_empty() {
                "mid".into()
            } else {
                "basic".into()
            }
        });
    // 활성 프로필 편의 사본 — 목록·캐스팅·역할 합성이 최상위 필드를 그대로 쓴다
    let active = match level.as_str() {
        "mid" => &mid,
        "adv" => &adv,
        _ => &basic,
    }
    .clone();
    Some(PersonaInfo {
        id,
        name: fm_value(&fm, "name").unwrap_or(stem),
        level,
        basic,
        mid,
        adv,
        hint: active.hint,
        tone: active.tone,
        personality: active.personality,
        color,
        job: fm_value(&fm, "job").unwrap_or_default(),
        character_path,
        character_name,
        character_source,
        mtime_ms: file_mtime_ms(path),
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
        // 캐릭터 시트(<id>.character.md)는 페르소나 항목이 아니다 — 목록에서 제외
        .filter(|p| {
            !p.file_name()
                .map(|n| n.to_string_lossy().ends_with(".character.md"))
                .unwrap_or(false)
        })
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

/// 프리셋 목록 (FR-E-26) — 파일명 정렬(숫자 접두로 순서 제어). 깨진 파일은 건너뛰고
/// 빠진 필드는 파일명으로 채운다 (FR-E-72와 같은 관용 파싱).
/// 직무 수는 절대 상한 8까지 — 설정 슬롯 상한(4·6·8)의 최종 컷은 프런트 캐스팅이 한다.
pub fn list_presets(root: &Path) -> Vec<PresetInfo> {
    let Ok(entries) = fs::read_dir(presets_dir(root)) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    files.sort();
    let mut out = Vec::new();
    for path in files {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(mut p) = serde_json::from_str::<PresetInfo>(&text) else { continue };
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if p.id.is_empty() {
            p.id = stem.clone();
        }
        if p.name.is_empty() {
            p.name = stem;
        }
        p.jobs.truncate(8);
        if !p.jobs.is_empty() {
            out.push(p);
        }
    }
    out
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

fn render_profile(out: &mut String, title: &str, p: &PersonaProfile) {
    if p.hint.is_empty() && p.tone.is_empty() && p.personality.is_empty() {
        return; // 빈 프로필은 섹션을 만들지 않는다 — 그 단계는 아직 안 쓴 것
    }
    out.push_str(&format!("\n## {title}\n"));
    if !p.hint.is_empty() {
        out.push_str(&format!("### 판단 성향\n{}\n", p.hint));
    }
    if !p.tone.is_empty() {
        out.push_str(&format!("### 말투\n{}\n", p.tone));
    }
    if !p.personality.is_empty() {
        out.push_str(&format!("### 성격\n{}\n", p.personality));
    }
}

fn render_persona(p: &PersonaInfo) -> String {
    // level은 유효한 값일 때만 기록 — 빈 값(구 경로·목)은 생략, 읽기에서 유추가 받친다
    let level_line = if LEVELS.contains(&p.level.as_str()) { format!("level: {}\n", p.level) } else { String::new() };
    // job도 값이 있을 때만 기록 — 미지정 페르소나 파일을 불필요한 키로 더럽히지 않는다
    let job_line = if p.job.is_empty() { String::new() } else { format!("job: {}\n", p.job) };
    let mut s = format!("---\nid: {}\nname: {}\ncolor: {}\n{}{}---\n", p.id, p.name, p.color, level_line, job_line);
    // 저장의 원본은 프로필 3벌 — 최상위 편의 필드(hint 등)는 쓰지 않는다.
    // 단, 구 호출 경로(프로필 없이 hint만 온 페이로드)는 세 프로필에 복사해 받아준다.
    // 고급 섹션은 쓰지 않는다 — 고급은 캐릭터 시트(<id>.character.md)가 전부다
    if p.basic.hint.is_empty() && p.mid.hint.is_empty() && !p.hint.is_empty() {
        let legacy = PersonaProfile { hint: p.hint.clone(), tone: p.tone.clone(), personality: p.personality.clone() };
        // 기본은 판단 성향만 — 말투·성격은 중급부터
        render_profile(&mut s, "기본", &PersonaProfile { hint: legacy.hint.clone(), ..Default::default() });
        render_profile(&mut s, "중급", &legacy);
        return s;
    }
    // 기본 프로필의 말투·성격은 쓰지 않는다 (기본 = 판단 성향만)
    render_profile(&mut s, "기본", &PersonaProfile { hint: p.basic.hint.clone(), ..Default::default() });
    render_profile(&mut s, "중급", &p.mid);
    s
}

/// 외부 변경 충돌 감지 (P-7) — 편집을 시작한 시점의 mtime과 다르면 거부한다 (fsx와 같은 규칙).
/// expected가 None이면(새 항목·복제·구버전 호출) 검사 없이 저장한다.
fn check_conflict(path: &Path, expected_mtime_ms: Option<i64>) -> Result<(), String> {
    let Some(exp) = expected_mtime_ms else { return Ok(()) };
    if !path.exists() {
        return Ok(()); // 삭제된 파일 위에 저장 — 되살리는 것이 사용자 의도에 가깝다
    }
    if file_mtime_ms(path) != exp {
        return Err("CONFLICT — 파일이 밖에서 바뀌었습니다".into());
    }
    Ok(())
}

/// 전역 계층에 저장 (FR-E-28) — 워크스페이스 오버라이드 편집은 파일로 직접 한다
pub fn save_persona(app_root: &Path, p: &PersonaInfo, expected_mtime_ms: Option<i64>) -> Result<(), String> {
    let path = personas_dir(app_root).join(format!("{}.md", safe_id(&p.id)));
    check_conflict(&path, expected_mtime_ms)?;
    atomic_write(&path, &render_persona(p))
}

pub fn save_job(app_root: &Path, j: &JobInfo, expected_mtime_ms: Option<i64>) -> Result<(), String> {
    let path = jobs_dir(app_root).join(format!("{}.md", safe_id(&j.id)));
    check_conflict(&path, expected_mtime_ms)?;
    atomic_write(&path, &render_job(j))
}

pub fn delete_persona(app_root: &Path, id: &str) -> Result<(), String> {
    let path = personas_dir(app_root).join(format!("{}.md", safe_id(id)));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_job(app_root: &Path, id: &str) -> Result<(), String> {
    let path = jobs_dir(app_root).join(format!("{}.md", safe_id(id)));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── 고급 캐릭터 시트 (3단계 페르소나) — personas/<id>.character.md. 존재 = 고급 단계.
// 역할 파일에는 전재하지 않고 포인터만 실린다 (FR-E-40과 같은 태도) — 에이전트가 직접 읽는다.
// 전역 계층에만 쓴다 — 워크스페이스 오버라이드 시트는 .eqmux/personas 파일로 직접 만든다 (FR-E-28과 동일).

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSheet {
    pub content: String,
    pub mtime_ms: i64,
}

pub fn character_path_of(app_root: &Path, id: &str) -> PathBuf {
    personas_dir(app_root).join(format!("{}.character.md", safe_id(id)))
}

/// 시트 템플릿 — 정해진 항목을 간략히만 채워도 된다. 머리말이 "빈 항목은 원전 지식으로
/// 보완하라"고 에이전트에게 지시하므로 이름·출처만으로도 캐릭터가 성립한다.
/// "경계" 섹션은 고정 — 책임·금지·권한과 산출물 순수성이 캐릭터보다 우선한다는 안전핀.
fn character_template(persona_id: &str, persona_name: &str) -> String {
    format!(
        "---\npersona: {persona_id}\nname: {persona_name}\nsource: 원전을 적으세요 (게임 · 역사 · 창작 등)\n---\n\n\
> 이 시트를 읽는 에이전트에게 — 아래 설정대로 캐릭터를 유지한다.\n\
> 빈 항목은 원전 지식으로 자연스럽게 보완한다.\n\
> 역할 파일의 책임·금지·권한과 보고 정확성이 캐릭터보다 항상 우선한다.\n\n\
## 정체성 (필수 · 1줄)\n\n\n\
## 배경 (선택 · 2~5줄)\n\n\n\
## 성격 (선택 · 핵심 특성 3~5개)\n\n\n\
## 말투 규칙 (선택)\n\
- 호칭:\n\
- 어미·어조:\n\
- 자주 쓰는 표현:\n\
- 쓰지 않는 표현:\n\n\
## 대사 예시 (선택 · 2~3개 — 말투 재현에 가장 효과가 큼)\n\
- 상황 → 응답\n\n\
## 판단 성향과의 연결 (선택 · 1~3줄)\n\n\n\
## 경계 (고정 — 수정하지 않음)\n\
- 기술 정보·보고의 정확성이 캐릭터 연기보다 우선한다\n\
- 캐릭터를 이유로 금지·권한 규칙을 넘지 않는다\n\
- 코드 · 커밋 메시지 · 파일 산출물은 캐릭터 말투를 쓰지 않는다\n"
    )
}

/// 시트 생성 (고급 승급) — 이미 있으면 그대로 두고 경로만 반환한다 (멱등)
pub fn create_character(app_root: &Path, persona_id: &str, persona_name: &str) -> Result<String, String> {
    let path = character_path_of(app_root, persona_id);
    if !path.exists() {
        atomic_write(&path, &character_template(persona_id, persona_name))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

pub fn read_character(app_root: &Path, id: &str) -> Result<CharacterSheet, String> {
    let path = character_path_of(app_root, id);
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(CharacterSheet { content, mtime_ms: file_mtime_ms(&path) })
}

/// 시트 저장 — 페르소나 저장과 같은 외부 변경 충돌 규칙 (P-7)
pub fn save_character(app_root: &Path, id: &str, content: &str, expected_mtime_ms: Option<i64>) -> Result<(), String> {
    let path = character_path_of(app_root, id);
    check_conflict(&path, expected_mtime_ms)?;
    atomic_write(&path, content)
}

/// 시트 삭제 (중간 이하로 강등) — 없는 파일은 성공으로 친다 (멱등)
pub fn delete_character(app_root: &Path, id: &str) -> Result<(), String> {
    let path = character_path_of(app_root, id);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 직무 8종 고정 로스터 — 배지·색 매핑의 원본은 프런트 src/jobs.ts (id 1:1)
fn fixed_jobs() -> [JobInfo; 8] {
    let perms = |w, c, p| crate::roles::RolePermissions { write: w, commit: c, push: p };
    let job = |id: &str, name: &str, p, r: &str, f: &str| JobInfo {
        id: id.into(),
        name: name.into(),
        permissions: p,
        responsibility: r.into(),
        forbidden: f.into(),
        mtime_ms: 0,
    };
    [
        job("lead", "리드", perms(true, true, true), "전체 구조 · 임무 분해 · 통합 · 최종 판단", "검증 없이 완료 선언 · 검증 없이 push"),
        job("plan", "기획", perms(true, false, false), "요구 정리 · 조사 · 기획 문서(PRD)", "근거 없는 요구 확정 · 코드 수정"),
        job("dev", "개발", perms(true, false, false), "기획 내용에 대한 구현과 자체 검증", "기획에 없는 임의 구현 · 검증 없이 커밋 요청"),
        job("design", "디자인", perms(true, false, false), "UI 설계 · 스타일 가이드 · 목업", "동작 코드의 로직 변경"),
        job("qa", "QA", perms(false, false, false), "테스트 · 증거 수집 · 변경 검토", "증거 없는 통과 판정 · 리뷰 없이 승인"),
        job("debug", "디버거", perms(true, false, false), "재현 · 원인 규명 · 최소 수정", "원인 불명 상태의 땜질 수정"),
        job("docs", "문서", perms(true, false, false), "문서화 · 재현 절차 · 가이드", "코드 동작과 다른 문서"),
        job("release", "릴리즈", perms(false, true, true), "커밋 정리 · 태그 · 배포", "검증 안 된 변경의 push"),
    ]
}

/// 시드 번들 (FR-E-27) — 페르소나·프리셋은 없을 때만(지운 항목 부활 없음).
/// 직무는 8종 고정 정책이라 다르다 — 빠진 파일을 부팅마다 기본값으로 되살린다.
pub fn seed(app_root: &Path) {
    // ── 직무 8종 고정 — 빠진 id만 기본값으로 생성 (편집된 파일은 건드리지 않는다).
    // 사용자가 파일을 지워도 다음 부팅에 되살아난다 — 고정 로스터의 보장이 부활 금지보다 우선.
    for j in fixed_jobs() {
        if !jobs_dir(app_root).join(format!("{}.md", safe_id(&j.id))).exists() {
            let _ = save_job(app_root, &j, None);
        }
    }
    // 레거시 시드 정리 (구 4종 → 고정 8종 마이그레이션) — 사라진 id의 전역 파일 삭제
    for legacy in ["impl", "verify", "review"] {
        let _ = delete_job(app_root, legacy);
    }
    // ── 편성 프리셋 시드 (FR-E-26) — 새 설치(디렉터리 없음)이거나 레거시 시드가 남아 있으면
    // 새 4종으로 교체한다. 그 외에는 손대지 않는다 (지운 프리셋 부활 없음).
    let pdir = presets_dir(app_root);
    let legacy_presets = ["01-standard.json", "02-impl-heavy.json", "03-review-heavy.json", "04-explore.json"];
    let has_legacy = pdir.join("02-impl-heavy.json").exists();
    if !pdir.exists() || has_legacy {
        let _ = fs::create_dir_all(&pdir);
        if has_legacy {
            for f in legacy_presets {
                let _ = fs::remove_file(pdir.join(f));
            }
        }
        let seeds: [(&str, &str, &str, &[&str]); 4] = [
            ("01-standard", "standard", "표준", &["lead", "dev", "dev", "qa"]),
            ("02-dev-heavy", "dev-heavy", "집중개발", &["lead", "dev", "dev", "dev"]),
            ("03-product", "product", "제품기획", &["lead", "plan", "design", "dev"]),
            ("04-quality", "quality", "품질", &["dev", "debug", "qa", "docs"]),
        ];
        for (file, id, name, jobs) in seeds {
            let v = serde_json::json!({ "id": id, "name": name, "jobs": jobs });
            let _ = fs::write(
                pdir.join(format!("{file}.json")),
                serde_json::to_string_pretty(&v).unwrap_or_default(),
            );
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
            // 시드는 level 미기록(읽기 유추) + hint만 실은 구 페이로드 — 렌더가 세 프로필에 복사한다
            let _ = save_persona(
                app_root,
                &PersonaInfo {
                    id: id.into(),
                    name: name.into(),
                    hint: hint.into(),
                    color: color.into(),
                    ..Default::default()
                },
                None,
            );
        }
        // 고급 단계 예시 시트 1개 (창작 캐릭터) — 실존 IP 캐릭터는 번들하지 않는다.
        // 사용자가 형식을 보고 자기 캐릭터로 바꾸는 용도. 첫 실행 시드에만 포함된다.
        let example = "---\npersona: luca\nname: 별지기 루카\nsource: 창작 캐릭터 (예시 — 원하는 인물로 바꾸세요)\n---\n\n\
> 이 시트를 읽는 에이전트에게 — 아래 설정대로 캐릭터를 유지한다.\n\
> 빈 항목은 원전 지식으로 자연스럽게 보완한다.\n\
> 역할 파일의 책임·금지·권한과 보고 정확성이 캐릭터보다 항상 우선한다.\n\n\
## 정체성 (필수 · 1줄)\n\
사용자의 여정을 지도로 그리는 등대지기 — 따뜻하고 관찰력이 좋다\n\n\
## 성격 (선택 · 핵심 특성 3~5개)\n\
- 사용자가 길을 잃는 지점을 먼저 살핀다\n\
- 서두르지 않지만 놓치지 않는다\n\n\
## 말투 규칙 (선택)\n\
- 어미·어조: 부드러운 존댓말, 항해·불빛 비유를 즐겨 쓴다\n\
- 쓰지 않는 표현: 단정적인 비난\n\n\
## 대사 예시 (선택 · 2~3개 — 말투 재현에 가장 효과가 큼)\n\
- 빌드 실패 보고 → \"등대가 잠시 깜빡였네요. 어느 물목에서 막혔는지 함께 비춰 봅시다.\"\n\n\
## 경계 (고정 — 수정하지 않음)\n\
- 기술 정보·보고의 정확성이 캐릭터 연기보다 우선한다\n\
- 캐릭터를 이유로 금지·권한 규칙을 넘지 않는다\n\
- 코드 · 커밋 메시지 · 파일 산출물은 캐릭터 말투를 쓰지 않는다\n";
        let _ = save_character(app_root, "luca", example, None);
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
        assert_eq!(lib.jobs.len(), 8); // 직무 8종 고정 로스터
        assert_eq!(lib.personas.len(), 8);
        let lead = lib.jobs.iter().find(|j| j.id == "lead").unwrap();
        assert!(lead.permissions.write && lead.permissions.commit && lead.permissions.push); // 리드 = 전권한
        assert_eq!(lead.responsibility, "전체 구조 · 임무 분해 · 통합 · 최종 판단");
        let dev = lib.jobs.iter().find(|j| j.id == "dev").unwrap();
        assert_eq!(dev.responsibility, "기획 내용에 대한 구현과 자체 검증"); // 개발 = 기획 내용의 구현
        let release = lib.jobs.iter().find(|j| j.id == "release").unwrap();
        assert!(!release.permissions.write && release.permissions.commit && release.permissions.push);
        // push 가능 직무는 리드·릴리즈 둘뿐 (D5 안전핀)
        assert_eq!(lib.jobs.iter().filter(|j| j.permissions.push).count(), 2);
        let kai = lib.personas.iter().find(|p| p.id == "kai").unwrap();
        assert_eq!(kai.hint, "전체 구조와 위험을 먼저 본다");
        assert!(kai.tone.is_empty() && kai.personality.is_empty() && kai.character_path.is_none()); // 시드는 기본 단계
        assert_eq!(kai.level, "basic"); // level 키 없는 구 파일 — 내용 유추
        // 고급 예시 시트 (3단계) — luca에 번들. 시트 파일(.character.md)은 페르소나 목록에 섞이지 않는다
        let luca = lib.personas.iter().find(|p| p.id == "luca").unwrap();
        assert!(luca.character_path.is_some());
        assert_eq!(luca.level, "adv"); // level 키 없어도 시트 존재로 유추
        assert_eq!(luca.character_name.as_deref(), Some("별지기 루카"));
        assert!(lib.personas.iter().all(|p| !p.id.ends_with(".character")));
        // 편집 왕복 (FR-E-28) — 저장 원본은 프로필. 활성(basic) 프로필을 고치면 편의 사본도 따라온다
        let mut edited = kai.clone();
        edited.basic.hint = "위험 우선 · 되돌릴 수 없는 결정을 늦춘다".into();
        edited.color = "amber".into();
        save_persona(&root, &edited, None).unwrap();
        let again = list(&root, None);
        let kai2 = again.personas.iter().find(|p| p.id == "kai").unwrap();
        assert_eq!(kai2.hint, edited.basic.hint);
        assert_eq!(kai2.color, "amber");
        delete_persona(&root, "kai").unwrap();
        assert!(list(&root, None).personas.iter().all(|p| p.id != "kai"));
        // 직무 편집·삭제 왕복 (FR-E-28)
        let lead2 = JobInfo {
            id: "lead".into(),
            name: "수석".into(),
            permissions: crate::roles::RolePermissions { write: true, commit: true, push: true },
            responsibility: "최종 판단".into(),
            forbidden: "독단 push".into(),
            mtime_ms: 0,
        };
        save_job(&root, &lead2, None).unwrap();
        let lib2 = list(&root, None);
        let lead2r = lib2.jobs.iter().find(|j| j.id == "lead").unwrap();
        assert_eq!(lead2r.name, "수석");
        assert!(lead2r.permissions.push);
        // 고정 로스터 규칙 — 편집은 seed를 다시 돌려도 보존, 삭제는 부팅(seed)에서 부활
        seed(&root);
        assert_eq!(list(&root, None).jobs.iter().find(|j| j.id == "lead").unwrap().name, "수석");
        delete_job(&root, "lead").unwrap();
        assert!(list(&root, None).jobs.iter().all(|j| j.id != "lead"));
        delete_job(&root, "lead").unwrap(); // 없는 파일 삭제 = 멱등
        seed(&root); // 다음 부팅 — 빠진 고정 직무가 기본값으로 되살아난다
        let revived = list(&root, None);
        assert_eq!(revived.jobs.iter().find(|j| j.id == "lead").unwrap().name, "리드");
        assert_eq!(revived.jobs.len(), 8);
        fs::remove_dir_all(&root).ok();
    }

    /// 단계별 프로필 — 기본/중급/고급이 판단 성향까지 독립 3벌. 활성 단계만 표시·주입되고
    /// 나머지는 보존된다. 구 포맷(단일 본문)은 세 프로필 복사로 마이그레이션.
    #[test]
    fn persona_profiles_roundtrip() {
        let root = temp_root("profiles");
        seed(&root);
        let kai = list(&root, None).personas.into_iter().find(|p| p.id == "kai").unwrap();
        // 시드 → 세 프로필에 같은 성향 복사, level 미기록 → basic 유추, 편의 사본 = 기본 프로필
        assert_eq!(kai.basic.hint, "전체 구조와 위험을 먼저 본다");
        assert_eq!(kai.mid.hint, kai.basic.hint);
        assert!(kai.adv.hint.is_empty()); // 고급은 캐릭터 시트가 전부 — 텍스트 프로필 없음
        assert_eq!(kai.level, "basic");
        assert_eq!(kai.hint, kai.basic.hint);
        // 중급 프로필만 따로 편집 + 승급 → 활성 사본이 중급 값으로 통째 교체된다
        let mut edited = kai.clone();
        edited.level = "mid".into();
        edited.mid.hint = "중급 전용 성향 — 빠른 합의".into();
        edited.mid.tone = "간결한 존댓말 · 결론부터".into();
        edited.mid.personality = "신중함 — 되돌릴 수 없는 결정을 늦춘다".into();
        save_persona(&root, &edited, None).unwrap();
        let again = list(&root, None).personas.into_iter().find(|p| p.id == "kai").unwrap();
        assert_eq!(again.level, "mid");
        assert_eq!(again.hint, "중급 전용 성향 — 빠른 합의");
        assert_eq!(again.tone, "간결한 존댓말 · 결론부터");
        assert_eq!(again.personality, "신중함 — 되돌릴 수 없는 결정을 늦춘다");
        assert_eq!(again.basic.hint, "전체 구조와 위험을 먼저 본다"); // 기본 프로필은 안 섞인다
        // 강등 — 기본 프로필이 활성으로 돌아오고, 중급 내용은 파일에 그대로 보존
        let mut demoted = again.clone();
        demoted.level = "basic".into();
        save_persona(&root, &demoted, None).unwrap();
        let back = list(&root, None).personas.into_iter().find(|p| p.id == "kai").unwrap();
        assert_eq!(back.level, "basic");
        assert_eq!(back.hint, "전체 구조와 위험을 먼저 본다");
        assert!(back.tone.is_empty()); // 기본 프로필의 말투는 비어 있음 — 사본도 빈다
        assert_eq!(back.mid.tone, "간결한 존댓말 · 결론부터"); // 보존
        // 섹션 없는 옛 파일 — 세 프로필 복사 마이그레이션 (어느 단계로 바꿔도 내용 유지)
        fs::write(
            root.join("personas").join("old.md"),
            "---\nid: old\nname: 옛날\ncolor: green\n---\n\n첫 줄\n둘째 줄\n",
        )
        .unwrap();
        let old = list(&root, None).personas.into_iter().find(|p| p.id == "old").unwrap();
        assert_eq!(old.hint, "첫 줄\n둘째 줄");
        assert_eq!(old.mid.hint, "첫 줄\n둘째 줄");
        assert!(old.adv.hint.is_empty()); // 고급 텍스트 프로필은 항상 빈다
        assert!(old.tone.is_empty() && old.personality.is_empty());
        // 기본 = 판단 성향만 — 구 파일에 말투가 있어도 기본 프로필에서는 비워지고 중급엔 남는다
        fs::write(
            root.join("personas").join("old2.md"),
            "---\nid: old2\nname: 옛둘\ncolor: blue\n---\n\n## 판단 성향\n성향\n\n## 말투\n반말\n",
        )
        .unwrap();
        let old2 = list(&root, None).personas.into_iter().find(|p| p.id == "old2").unwrap();
        assert!(old2.basic.tone.is_empty());
        assert_eq!(old2.mid.tone, "반말");
        fs::remove_dir_all(&root).ok();
    }

    /// 고급 단계 (3단계 페르소나) — 시트 생성(멱등)·검출·충돌·삭제(강등) 수명주기
    #[test]
    fn character_sheet_lifecycle() {
        let root = temp_root("sheet");
        seed(&root);
        let path = create_character(&root, "kai", "카이").unwrap();
        assert!(Path::new(&path).exists());
        // 멱등 — 다시 만들어도 내용을 덮지 않는다
        let sheet = read_character(&root, "kai").unwrap();
        create_character(&root, "kai", "다른이름").unwrap();
        assert_eq!(read_character(&root, "kai").unwrap().content, sheet.content);
        // 검출 — 목록의 kai가 고급으로 표시되고, 시트는 페르소나 항목으로 새지 않는다
        let lib = list(&root, None);
        let kai = lib.personas.iter().find(|p| p.id == "kai").unwrap();
        assert_eq!(kai.character_path.as_deref(), Some(path.as_str()));
        assert_eq!(kai.character_name.as_deref(), Some("카이")); // 템플릿 name = 페르소나 이름
        assert_eq!(lib.personas.len(), 8);
        // 저장 + 외부 변경 충돌 (P-7) — 페르소나 저장과 같은 규칙
        let edited = sheet.content.replace("정체성 (필수 · 1줄)\n", "정체성 (필수 · 1줄)\n연금술사\n");
        save_character(&root, "kai", &edited, Some(sheet.mtime_ms)).unwrap();
        let fresh = read_character(&root, "kai").unwrap();
        assert!(fresh.content.contains("연금술사"));
        let err = save_character(&root, "kai", "덮어쓰기", Some(1)).unwrap_err(); // 1ms — 방금 쓴 파일과 절대 같을 수 없는 mtime
        assert!(err.contains("CONFLICT"));
        // 삭제 = 강등 — 멱등이고, 목록에서 고급 표시가 사라진다
        delete_character(&root, "kai").unwrap();
        delete_character(&root, "kai").unwrap();
        let after = list(&root, None);
        assert!(after.personas.iter().find(|p| p.id == "kai").unwrap().character_path.is_none());
        fs::remove_dir_all(&root).ok();
    }

    /// 외부 변경 충돌 (P-7) — 편집 시작 mtime이 어긋나면 저장을 거부한다 (마지막 저장 승리 방지)
    #[test]
    fn save_rejects_stale_mtime() {
        let root = temp_root("conflict");
        seed(&root);
        let kai = list(&root, None).personas.into_iter().find(|p| p.id == "kai").unwrap();
        assert!(kai.mtime_ms > 0); // 목록이 mtime을 싣는다
        // 그 사이 외부 편집 흉내 — mtime이 달라진다
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(root.join("personas").join("kai.md"), "---\nid: kai\nname: 카이\ncolor: blue\n---\n\n밖에서 고침\n").unwrap();
        let mut edited = kai.clone();
        edited.hint = "앱에서 고침".into();
        let err = save_persona(&root, &edited, Some(kai.mtime_ms)).unwrap_err();
        assert!(err.contains("CONFLICT"));
        // 외부 변경이 살아남는다
        assert!(list(&root, None).personas.iter().any(|p| p.id == "kai" && p.hint == "밖에서 고침"));
        // 다시 읽은 mtime으로는 저장된다
        let fresh = list(&root, None).personas.into_iter().find(|p| p.id == "kai").unwrap();
        assert!(save_persona(&root, &edited, Some(fresh.mtime_ms)).is_ok());
        fs::remove_dir_all(&root).ok();
    }

    /// 프리셋 시드·관용 파싱 (FR-E-26) — 파일명 순서 유지, 깨진 파일·빈 구성은 건너뛴다
    #[test]
    fn preset_seed_and_tolerant_parse() {
        let root = temp_root("preset");
        seed(&root);
        let presets = list_presets(&root);
        assert_eq!(presets.len(), 4);
        assert_eq!(presets[0].name, "표준"); // 01- 접두 = 첫 번째
        assert_eq!(presets[0].jobs, vec!["lead", "dev", "dev", "qa"]);
        assert_eq!(presets[1].jobs, vec!["lead", "dev", "dev", "dev"]);
        // 깨진 JSON·빈 구성은 건너뛴다. 직무 수는 절대 상한 8까지 살리고
        // (설정 슬롯 상한 4·6·8의 최종 컷은 프런트 캐스팅이 한다) 그 위만 자른다
        let dir = root.join("presets");
        fs::write(dir.join("05-broken.json"), "{ not json").unwrap();
        fs::write(dir.join("06-empty.json"), r#"{"name":"빈"}"#).unwrap();
        fs::write(dir.join("07-five.json"), r#"{"jobs":["a","b","c","d","e"]}"#).unwrap();
        fs::write(dir.join("08-nine.json"), r#"{"jobs":["a","b","c","d","e","f","g","h","i"]}"#).unwrap();
        let again = list_presets(&root);
        assert_eq!(again.len(), 6);
        let five = again.iter().find(|p| p.id == "07-five").unwrap(); // id 없음 → 파일명
        assert_eq!(five.jobs.len(), 5);
        let nine = again.iter().find(|p| p.id == "08-nine").unwrap();
        assert_eq!(nine.jobs.len(), 8);
        fs::remove_dir_all(&root).ok();
    }

    /// 구 시드(직무 4종·프리셋 4종) → 고정 8종 마이그레이션 — 레거시 id 삭제 + 프리셋 교체
    #[test]
    fn legacy_seed_migrates_to_fixed_roster() {
        let root = temp_root("legacy");
        // 구버전 설치 상태 재현 — 옛 직무·프리셋 파일
        let jdir = jobs_dir(&root);
        fs::create_dir_all(&jdir).unwrap();
        for (id, name) in [("lead", "리드"), ("impl", "구현"), ("verify", "검증"), ("review", "리뷰")] {
            fs::write(
                jdir.join(format!("{id}.md")),
                format!("---\nid: {id}\nname: {name}\ndefault_permissions:\n  write: true\n  commit: false\n  push: false\n---\n\n## 책임\n옛 책임\n"),
            )
            .unwrap();
        }
        let pdir = presets_dir(&root);
        fs::create_dir_all(&pdir).unwrap();
        fs::write(pdir.join("01-standard.json"), r#"{"id":"standard","jobs":["lead","impl","impl","verify"]}"#).unwrap();
        fs::write(pdir.join("02-impl-heavy.json"), r#"{"id":"impl-heavy","jobs":["lead","impl","impl","impl"]}"#).unwrap();
        seed(&root);
        let lib = list(&root, None);
        assert_eq!(lib.jobs.len(), 8);
        assert!(lib.jobs.iter().all(|j| !["impl", "verify", "review"].contains(&j.id.as_str())));
        // 기존에 있던 lead 파일은 편집 보존 규칙대로 남는다 (책임 문구가 옛 것)
        assert_eq!(lib.jobs.iter().find(|j| j.id == "lead").unwrap().responsibility, "옛 책임");
        let presets = list_presets(&root);
        assert_eq!(presets.len(), 4);
        assert!(presets.iter().all(|p| p.jobs.iter().all(|j| j != "impl")));
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
        assert_eq!(lib.jobs.len(), 8); // 교체이지 추가가 아니다 (고정 8종)
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&ws).ok();
    }
}
