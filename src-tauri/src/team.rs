// 팀 편성 파일 (PRD E §4.2) — 원본 .eqmux/team.json, 파생 .eqmux/team.md (FR-E-11).
// 둘 다 커밋 대상이다 (FR-E-12) — clone한 다른 사람이 같은 편성을 얻는다.
// 파일이 원본, DB는 캐시라는 계약(FR-C-23)에 따라 앱은 여기서 읽은 것을 믿는다.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamSlot {
    pub slot: u8,
    pub persona: String,
    pub persona_name: String,
    pub job: String,
    pub job_name: String,
    /// 세션 표시 이름 (P5 · FR-E-36) — 페르소나 이름과 분리 가능. 없으면 페르소나 이름
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 세션 격리 (FR-E-62 · E1′) — true면 `.eqmux/worktrees/<세션>`이 cwd다.
    /// 경로가 아니라 플래그를 저장한다 — team.json은 커밋 대상(W3)이라 절대 경로 금지
    #[serde(default)]
    pub worktree: bool,
    /// 슬롯 권한 오버라이드 (FR-E-34, M31) — 직무 기본값을 이 슬롯에서만 덮어쓴다. 없으면 생략
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<crate::roles::RolePermissions>,
    /// 실행 엔진 (M37) — "claude"(기본) 또는 "codex". 없으면 claude. 슬롯이 고른 CLI가 관리
    /// 기동 경로(역할 주입·훅·재개 앵커)를 통째로 가르므로, 편성과 함께 파일에 남아 커밋된다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli: Option<String>,
    /// 직함 덮어쓰기 (0.5) — 이 워크스페이스에서만. 없으면 페르소나 직함을 물려받는다. 없으면 생략
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// team.json 스키마 버전 (FR-E-75). 0.5의 title은 선택 필드라 1 그대로 둔다 — 0.4.2도 모르는 키는
/// 무시하고 읽으므로(deny_unknown_fields 없음) 0.5 파일을 그대로 연다. 필드의 뜻이 바뀔 때만 올린다
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TeamFile {
    /// 없으면 0 — 손으로 쓴 파일도 읽는다 (예전에는 version이 없으면 파싱 실패로 팀이 통째로 비었다)
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub slots: Vec<TeamSlot>,
}

fn eqmux_dir(ws_path: &str) -> PathBuf {
    Path::new(ws_path).join(".eqmux")
}

pub fn load(ws_path: &str) -> TeamFile {
    fs::read_to_string(eqmux_dir(ws_path).join("team.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// team.json 원자적 쓰기 + team.md 파생 (FR-E-17 — 사람이 읽는 표).
/// `persona_title`은 페르소나 id → 페르소나 직함 — 슬롯 덮어쓰기가 없을 때 유효 직함이 된다
pub fn save(ws_path: &str, slots: &[TeamSlot], persona_title: &dyn Fn(&str) -> Option<String>) -> Result<(), String> {
    let dir = eqmux_dir(ws_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 더 새 EQMUX가 쓴 편성은 덮어쓰지 않는다 — 모르는 필드를 지우고 버전을 낮추게 된다 (FR-E-75)
    let on_disk = load(ws_path).version;
    if on_disk > SCHEMA_VERSION {
        return Err(format!(
            "team.json이 더 새 EQMUX(스키마 v{on_disk})로 저장되어 있어 덮어쓰지 않습니다 — EQMUX를 업데이트하세요"
        ));
    }

    let file = TeamFile { version: SCHEMA_VERSION, slots: slots.to_vec() };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    crate::workspace::atomic_write(&dir.join("team.json"), json.as_bytes())?;
    crate::workspace::atomic_write(&dir.join("team.md"), render_md(slots, persona_title).as_bytes())
}

/// team.md — 직함이 하나도 없으면 0.4.2와 같은 3열, 있으면 끝에 직함 열
fn render_md(slots: &[TeamSlot], persona_title: &dyn Fn(&str) -> Option<String>) -> String {
    let title_of = |s: &TeamSlot| {
        s.title.clone().filter(|t| !t.trim().is_empty()).or_else(|| persona_title(&s.persona)).filter(|t| !t.trim().is_empty())
    };
    let titled = slots.iter().any(|s| title_of(s).is_some());
    let mut md = String::from(if titled {
        "# 팀 편성\n\n| 슬롯 | 페르소나 | 직무 | 직함 |\n|---|---|---|---|\n"
    } else {
        "# 팀 편성\n\n| 슬롯 | 페르소나 | 직무 |\n|---|---|---|\n"
    });
    // 표 행 수 — 기본 4행, 슬롯 상한 옵션(6·8)으로 그 위 슬롯이 있으면 거기까지 (절대 상한 8)
    let max_slot = slots.iter().map(|s| s.slot).max().unwrap_or(0).min(8).max(4);
    for n in 1u8..=max_slot {
        match slots.iter().find(|s| s.slot == n) {
            Some(s) => {
                let iso = if s.worktree { " · 워크트리" } else { "" };
                let ovr = if s.permissions.is_some() { " · 권한 오버라이드" } else { "" };
                let eng = if s.cli.as_deref() == Some("codex") { " · Codex" } else { "" };
                md.push_str(&format!("| {} | {} | {}{}{}{} |", n, s.persona_name, s.job_name, iso, ovr, eng));
                if titled {
                    md.push_str(&format!(" {} |", title_of(s).unwrap_or_default().replace('|', "\\|")));
                }
                md.push('\n');
            }
            None => md.push_str(&format!("| {} | — | (비어 있음) |{}\n", n, if titled { "  |" } else { "" })),
        }
    }
    md.push_str("\n> EQMUX가 생성한 파생 파일입니다 — 원본은 team.json (FR-E-11)\n");
    md
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(n: u8, title: Option<&str>) -> TeamSlot {
        TeamSlot {
            slot: n,
            persona: format!("p{n}"),
            persona_name: format!("이름{n}"),
            job: "dev".into(),
            job_name: "개발".into(),
            name: None,
            worktree: false,
            permissions: None,
            cli: None,
            title: title.map(Into::into),
        }
    }

    /// 직함 없음 — team.json에 키가 없고 team.md는 0.4.2와 같은 3열
    #[test]
    fn title_omitted_when_absent() {
        let json = serde_json::to_string(&slot(1, None)).unwrap();
        assert!(!json.contains("title"));
        let md = render_md(&[slot(1, None)], &|_| None);
        assert!(md.starts_with("# 팀 편성\n\n| 슬롯 | 페르소나 | 직무 |\n|---|---|---|\n| 1 | 이름1 | 개발 |\n| 2 | — | (비어 있음) |\n"));
    }

    /// 스키마 버전 (FR-E-75) — version 없는 파일·모르는 키는 읽고, 더 새 버전 파일은 덮어쓰지 않는다
    #[test]
    fn schema_version_guard() {
        let ws = std::env::temp_dir().join(format!("eqmux-team-ver-{}", crate::workspace::now_ms()));
        let dir = ws.join(".eqmux");
        fs::create_dir_all(&dir).unwrap();
        let w = ws.to_string_lossy().into_owned();
        let slot_json = r#"{"slot":1,"persona":"kai","personaName":"카이","job":"dev","jobName":"개발","title":"서버","future":1}"#;
        fs::write(dir.join("team.json"), format!(r#"{{"slots":[{slot_json}]}}"#)).unwrap();
        let t = load(&w);
        assert_eq!((t.version, t.slots.len()), (0, 1)); // version 없음 — 팀이 비지 않는다
        assert_eq!(t.slots[0].title.as_deref(), Some("서버"));
        save(&w, &t.slots, &|_| None).unwrap();
        assert_eq!(load(&w).version, SCHEMA_VERSION);
        fs::write(dir.join("team.json"), format!(r#"{{"version":2,"slots":[{slot_json}]}}"#)).unwrap();
        assert!(save(&w, &t.slots, &|_| None).is_err());
        assert!(fs::read_to_string(dir.join("team.json")).unwrap().contains("\"version\":2")); // 그대로
        fs::remove_dir_all(&ws).ok();
    }

    /// 유효 직함 — 슬롯 덮어쓰기 > 페르소나 직함, `|` 이스케이프
    #[test]
    fn title_column_uses_effective_title() {
        let md = render_md(&[slot(1, Some("UI | UX")), slot(2, None)], &|p| (p == "p2").then(|| "서버 개발자".into()));
        assert!(md.contains("| 슬롯 | 페르소나 | 직무 | 직함 |\n"));
        assert!(md.contains("| 1 | 이름1 | 개발 | UI \\| UX |\n"));
        assert!(md.contains("| 2 | 이름2 | 개발 | 서버 개발자 |\n"));
        assert!(md.contains("| 3 | — | (비어 있음) |  |\n"));
        assert!(serde_json::to_string(&slot(1, Some("x"))).unwrap().contains("\"title\":\"x\""));
    }
}
