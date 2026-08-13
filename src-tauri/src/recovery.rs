// 비정상 종료 복구 (FR-C-35) — running.flag 표식과 직전 세션 스캔.
// 표식은 setup이 쓰고 app_exit 끝에서 지운다 — 시작 시 표식이 남아 있으면 크래시였다.
// 첫 crash_recovery 호출이 값을 소비한다 (웹뷰만 재시작한 경우 안내 재출현 방지, FR-C-06).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::State;

use crate::agent;
use crate::StoreState;

/// 시작 시 1회 판정되는 비정상 종료 플래그 — 첫 조회가 소비한다
pub struct DirtyStart(pub Mutex<bool>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashSession {
    workspace: String,
    id: String,
    cwd: String,
    shell: Option<String>,
    last_output_at: Option<i64>,
    resumable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    dirty: bool,
    sessions: Vec<CrashSession>,
}

/// 크래시 시점에 살아 있었을 세션 스캔 — 각 워크스페이스 DB에서 exit 기록 없이 끝난
/// 세션을 최근 활동순으로 모은다. 재개 가능 여부는 agent_session 매핑 +
/// 트랜스크립트 실측 (FR-D-20)으로 다시 판정한다.
pub fn crash_scan(root: &Path) -> Vec<CrashSession> {
    let mut out = Vec::new();
    let ws_root = root.join("workspaces");
    if let Ok(entries) = std::fs::read_dir(&ws_root) {
        for entry in entries.flatten() {
            let ws = entry.file_name().to_string_lossy().into_owned();
            let db = entry.path().join("session.db");
            let Ok(conn) = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
                continue;
            };
            let Ok(mut stmt) = conn.prepare(
                "SELECT s.id, s.cwd, s.shell, s.last_output_at, a.agent_session_id
                 FROM session s LEFT JOIN agent_session a ON a.session_id = s.id
                 WHERE s.exit_code IS NULL AND s.last_output_at IS NOT NULL
                 ORDER BY s.last_output_at DESC LIMIT 8",
            ) else {
                continue;
            };
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            });
            let Ok(rows) = rows else { continue };
            for (id, cwd, shell, last_output_at, uuid) in rows.flatten() {
                let cwd = cwd.unwrap_or_default();
                let resumable = uuid.as_deref().map(|u| agent::resumable(&cwd, u)).unwrap_or(false);
                out.push(CrashSession { workspace: ws.clone(), id, cwd, shell, last_output_at, resumable });
            }
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.last_output_at));
    out.truncate(16);
    out
}

/// 직전 실행이 비정상 종료였을 때만 dirty=true + 직전 세션 목록 (FR-C-35).
/// 값은 1회 소비 — 웹뷰 재시작 후 재호출에는 dirty=false를 준다 (FR-C-06).
#[tauri::command]
pub fn crash_recovery(store_state: State<StoreState>, dirty: State<DirtyStart>) -> CrashReport {
    let was_dirty = dirty.0.lock().map(|mut d| std::mem::take(&mut *d)).unwrap_or(false);
    if !was_dirty {
        return CrashReport { dirty: false, sessions: Vec::new() };
    }
    CrashReport { dirty: true, sessions: crash_scan(&store_state.0.root()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// exit 기록이 없는 세션만, 최근 활동순으로 잡힌다 (FR-C-35)
    #[test]
    fn crash_scan_finds_unexited_sessions_only() {
        let root = std::env::temp_dir().join(format!("eqmux-crash-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let conn = crate::store::open_db(&root, "ws1").expect("db open");
        conn.execute(
            "INSERT INTO session (id, workspace, cwd, shell, created_at, last_output_at, exit_code)
             VALUES ('alive@ws1', 'ws1', 'C:\\w', 'claude', 1, 2000, NULL),
                    ('older@ws1', 'ws1', 'C:\\w', 'pwsh', 1, 1000, NULL),
                    ('exited@ws1', 'ws1', 'C:\\w', 'pwsh', 1, 3000, 0),
                    ('silent@ws1', 'ws1', 'C:\\w', 'pwsh', 1, NULL, NULL)",
            [],
        )
        .expect("seed");
        drop(conn);

        let found = crash_scan(&root);
        let ids: Vec<&str> = found.iter().map(|s| s.id.as_str()).collect();
        // exit 0 기록·활동 전무 세션은 제외, 최근 활동이 위
        assert_eq!(ids, vec!["alive@ws1", "older@ws1"]);
        assert_eq!(found[0].last_output_at, Some(2000));
        assert!(!found[0].resumable); // agent_session 매핑 없음 = 재개 불가
        let _ = std::fs::remove_dir_all(&root);
    }
}
