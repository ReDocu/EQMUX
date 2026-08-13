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
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TeamFile {
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

/// team.json 원자적 쓰기 + team.md 파생 (FR-E-17 — 사람이 읽는 표)
pub fn save(ws_path: &str, slots: &[TeamSlot]) -> Result<(), String> {
    let dir = eqmux_dir(ws_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file = TeamFile { version: 1, slots: slots.to_vec() };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    let tmp = dir.join("team.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("team.json")).map_err(|e| e.to_string())?;

    let mut md = String::from("# 팀 편성\n\n| 슬롯 | 페르소나 | 직무 |\n|---|---|---|\n");
    for n in 1u8..=4 {
        match slots.iter().find(|s| s.slot == n) {
            Some(s) => {
                let iso = if s.worktree { " · 워크트리" } else { "" };
                let ovr = if s.permissions.is_some() { " · 권한 오버라이드" } else { "" };
                md.push_str(&format!("| {} | {} | {}{}{} |\n", n, s.persona_name, s.job_name, iso, ovr));
            }
            None => md.push_str(&format!("| {} | — | (비어 있음) |\n", n)),
        }
    }
    md.push_str("\n> EQMUX가 생성한 파생 파일입니다 — 원본은 team.json (FR-E-11)\n");
    let tmp_md = dir.join("team.md.tmp");
    fs::write(&tmp_md, md).map_err(|e| e.to_string())?;
    fs::rename(&tmp_md, dir.join("team.md")).map_err(|e| e.to_string())
}
