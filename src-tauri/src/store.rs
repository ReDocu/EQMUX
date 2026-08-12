// 세션 스토어 (PRD C) — SQLite WAL · 워크스페이스별 DB (FR-C-20a) · 배치 커밋 (FR-C-21).
// 디스크에 적재하는 것은 VT를 통과해 확정된 줄이다 (FR-C-11) — raw 바이트는 로그 파일(1차) 몫.
// 스키마 7테이블(FR-C-20) + message(PRD F 원장) — 쓰기 열림 때마다 IF NOT EXISTS로 보장한다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

pub enum StoreMsg {
    SessionStart { ws: String, id: String, cwd: String, shell: String },
    SessionExit { ws: String, id: String, code: Option<u32> },
    Line { ws: String, id: String, text: String },
    Event { ws: String, id: Option<String>, kind: String, message: String },
    /// 에이전트 재개 매핑 (FR-C-27 · FR-D-24)
    AgentSession { ws: String, id: String, agent_session_id: String, log_path: String, resumable: bool },
    /// 종료 flush (FR-C-62②) — 대기 배치를 즉시 커밋하고 ack를 보낸다
    Flush(Sender<()>),
}

pub struct Store {
    tx: Sender<StoreMsg>,
    root: PathBuf,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO meta VALUES ('schema_version', '1');
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  name TEXT,
  cwd TEXT,
  shell TEXT,
  created_at INTEGER,
  last_output_at INTEGER,
  bytes_received INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER
);
CREATE TABLE IF NOT EXISTS scrollback (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS command (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  text TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  exit_code INTEGER,
  seq_from INTEGER,
  seq_to INTEGER
);
CREATE TABLE IF NOT EXISTS event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS agent_session (
  session_id TEXT PRIMARY KEY,
  agent_session_id TEXT,
  log_path TEXT,
  resumable INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS assignment_cache (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
";

const SCROLLBACK_CAP_PER_SESSION: i64 = 100_000; // FR-C-50
const RETENTION_DAYS_MS: i64 = 30 * 86_400_000;
const BATCH_MAX: usize = 200; // FR-C-21 — 100ms 창 또는 누적 N줄 중 먼저

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn sanitize(ws: &str) -> String {
    ws.chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .collect()
}

pub fn db_path(root: &Path, ws: &str) -> PathBuf {
    root.join("workspaces").join(sanitize(ws)).join("session.db")
}

/// 쓰기 열림 — 스키마 보장 포함. 메시지 버스(messages.rs)도 이 경로로 연다.
pub(crate) fn open_db(root: &Path, ws: &str) -> rusqlite::Result<Connection> {
    let path = db_path(root, ws);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(path)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    conn.execute_batch(SCHEMA)?;
    // FTS5 인덱스 (FR-C-16) — 번들 SQLite에 FTS5가 없으면 조용히 넘어가고 검색은 LIKE 폴백
    let _ = conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS scrollback_fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED, ts UNINDEXED)",
    );
    // 기존 DB 1회 시드 — 이 마일스톤 이전에 쌓인 줄도 검색에 잡히게. 실패(FTS 없음)면
    // 표식을 남기지 않아 다음 열림 때 다시 시도한다.
    let seeded: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'fts_seeded'", [], |r| r.get(0))
        .ok();
    if seeded.is_none()
        && conn
            .execute(
                "INSERT INTO scrollback_fts (text, session_id, seq, ts)
                 SELECT text, session_id, seq, ts FROM scrollback",
                [],
            )
            .is_ok()
    {
        let _ = conn.execute("INSERT OR REPLACE INTO meta VALUES ('fts_seeded', '1')", []);
    }
    // 열 때 1회 보존 정리 (FR-C-50 30일) — 백그라운드 스레드라 UI를 막지 않는다 (FR-C-51)
    let cutoff = now_ms() - RETENTION_DAYS_MS;
    let _ = conn.execute("DELETE FROM scrollback WHERE ts < ?1", params![cutoff]);
    let _ = conn.execute("DELETE FROM scrollback_fts WHERE ts < ?1", params![cutoff]);
    Ok(conn)
}

impl Store {
    pub fn new(root: PathBuf) -> Store {
        let (tx, rx) = channel();
        let thread_root = root.clone();
        std::thread::spawn(move || run(thread_root, rx));
        Store { tx, root }
    }

    pub fn sender(&self) -> Sender<StoreMsg> {
        self.tx.clone()
    }

    pub fn root(&self) -> PathBuf {
        self.root.clone()
    }
}

struct SessionCursor {
    seq: i64,
    lines_since_cap: i64,
    bytes: i64,
}

fn run(root: PathBuf, rx: Receiver<StoreMsg>) {
    let mut dbs: HashMap<String, Connection> = HashMap::new();
    let mut cursors: HashMap<String, SessionCursor> = HashMap::new();
    let mut pending: Vec<StoreMsg> = Vec::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(StoreMsg::Flush(ack)) => {
                // 종료 flush (FR-C-62·63) — 배치 창을 기다리지 않고 즉시 커밋 후 ack
                flush(&root, &mut dbs, &mut cursors, &mut pending);
                let _ = ack.send(());
                continue;
            }
            Ok(msg) => {
                pending.push(msg);
                if pending.len() < BATCH_MAX {
                    continue;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                flush(&root, &mut dbs, &mut cursors, &mut pending);
                return;
            }
        }
        if !pending.is_empty() {
            flush(&root, &mut dbs, &mut cursors, &mut pending);
        }
    }
}

fn ws_of(msg: &StoreMsg) -> &str {
    match msg {
        StoreMsg::SessionStart { ws, .. }
        | StoreMsg::SessionExit { ws, .. }
        | StoreMsg::Line { ws, .. }
        | StoreMsg::Event { ws, .. }
        | StoreMsg::AgentSession { ws, .. } => ws,
        StoreMsg::Flush(_) => "default", // 도달 불가 — run 루프가 pending에 넣지 않는다
    }
}

fn flush(
    root: &Path,
    dbs: &mut HashMap<String, Connection>,
    cursors: &mut HashMap<String, SessionCursor>,
    pending: &mut Vec<StoreMsg>,
) {
    let mut by_ws: HashMap<String, Vec<StoreMsg>> = HashMap::new();
    for msg in pending.drain(..) {
        by_ws.entry(ws_of(&msg).to_string()).or_default().push(msg);
    }

    for (ws, msgs) in by_ws {
        if !dbs.contains_key(&ws) {
            match open_db(root, &ws) {
                Ok(c) => {
                    dbs.insert(ws.clone(), c);
                }
                Err(_) => continue,
            }
        }
        let conn = dbs.get_mut(&ws).unwrap();
        let now = now_ms();
        let mut touched: HashMap<String, i64> = HashMap::new(); // session -> appended bytes

        let tx = match conn.transaction() {
            Ok(t) => t,
            Err(_) => continue,
        };
        for msg in &msgs {
            match msg {
                StoreMsg::SessionStart { id, cwd, shell, ws } => {
                    let _ = tx.execute(
                        "INSERT INTO session (id, workspace, name, cwd, shell, created_at) VALUES (?1, ?2, ?1, ?3, ?4, ?5)
                         ON CONFLICT(id) DO UPDATE SET cwd = excluded.cwd, shell = excluded.shell, exit_code = NULL",
                        params![id, ws, cwd, shell, now],
                    );
                    let _ = tx.execute(
                        "INSERT INTO event (ts, session_id, kind, payload) VALUES (?1, ?2, 'session-start', ?3)",
                        params![now, id, cwd],
                    );
                }
                StoreMsg::SessionExit { id, code, .. } => {
                    let _ = tx.execute(
                        "UPDATE session SET exit_code = ?2 WHERE id = ?1",
                        params![id, code.map(|c| c as i64)],
                    );
                    let _ = tx.execute(
                        "INSERT INTO event (ts, session_id, kind, payload) VALUES (?1, ?2, 'session-exit', ?3)",
                        params![now, id, format!("{:?}", code)],
                    );
                }
                StoreMsg::Line { id, text, .. } => {
                    let cur = cursors.entry(id.clone()).or_insert_with(|| {
                        let max: i64 = tx
                            .query_row(
                                "SELECT COALESCE(MAX(seq), 0) FROM scrollback WHERE session_id = ?1",
                                params![id],
                                |r| r.get(0),
                            )
                            .unwrap_or(0);
                        SessionCursor { seq: max, lines_since_cap: 0, bytes: 0 }
                    });
                    cur.seq += 1;
                    cur.lines_since_cap += 1;
                    cur.bytes += text.len() as i64;
                    let _ = tx.execute(
                        "INSERT OR IGNORE INTO scrollback (session_id, seq, ts, text) VALUES (?1, ?2, ?3, ?4)",
                        params![id, cur.seq, now, text],
                    );
                    // FTS 인덱스 동반 적재 (FR-C-16) — FTS5가 없으면 조용히 실패한다
                    let _ = tx.execute(
                        "INSERT INTO scrollback_fts (text, session_id, seq, ts) VALUES (?1, ?2, ?3, ?4)",
                        params![text, id, cur.seq, now],
                    );
                    *touched.entry(id.clone()).or_insert(0) += text.len() as i64;
                }
                StoreMsg::Event { id, kind, message, .. } => {
                    let _ = tx.execute(
                        "INSERT INTO event (ts, session_id, kind, payload) VALUES (?1, ?2, ?3, ?4)",
                        params![now, id, kind, message],
                    );
                }
                StoreMsg::AgentSession { id, agent_session_id, log_path, resumable, .. } => {
                    let _ = tx.execute(
                        "INSERT INTO agent_session (session_id, agent_session_id, log_path, resumable) VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT(session_id) DO UPDATE SET agent_session_id = excluded.agent_session_id, log_path = excluded.log_path, resumable = excluded.resumable",
                        params![id, agent_session_id, log_path, i64::from(*resumable)],
                    );
                }
                StoreMsg::Flush(_) => {} // pending에 들어오지 않는다 (run 루프에서 즉시 처리)
            }
        }
        for (id, bytes) in &touched {
            let _ = tx.execute(
                "UPDATE session SET last_output_at = ?2, bytes_received = bytes_received + ?3 WHERE id = ?1",
                params![id, now, bytes],
            );
        }
        let _ = tx.commit();

        // 세션당 100,000줄 상한 (FR-C-50) — 5,000줄마다 점검
        for id in touched.keys() {
            if let Some(cur) = cursors.get_mut(id) {
                if cur.lines_since_cap >= 5_000 {
                    cur.lines_since_cap = 0;
                    let _ = conn.execute(
                        "DELETE FROM scrollback WHERE session_id = ?1 AND seq <= ?2",
                        params![id, cur.seq - SCROLLBACK_CAP_PER_SESSION],
                    );
                    let _ = conn.execute(
                        "DELETE FROM scrollback_fts WHERE session_id = ?1 AND seq <= ?2",
                        params![id, cur.seq - SCROLLBACK_CAP_PER_SESSION],
                    );
                }
            }
        }
    }
}

// ── 스크롤백 검색·디스크 페이징 (FR-C-13·14·16) ──

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_id: String,
    pub seq: i64,
    pub ts: i64,
    pub text: String,
}

/// FTS5 질의 정제 — 토큰마다 큰따옴표로 감싸 연산자·따옴표로 인한 구문 오류를 막는다 (AND 의미)
pub fn fts_escape(q: &str) -> String {
    q.split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn hit_row(r: &rusqlite::Row) -> rusqlite::Result<SearchHit> {
    Ok(SearchHit { session_id: r.get(0)?, seq: r.get(1)?, ts: r.get(2)?, text: r.get(3)? })
}

/// 전문 검색 (FR-C-16) — FTS5 우선, 가상 테이블이 없으면 LIKE 폴백. 최신 히트 우선.
pub fn search(
    root: &Path,
    ws: &str,
    query: &str,
    session: Option<&str>,
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let path = db_path(root, ws);
    if !path.exists() || query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let limit = limit.min(200) as i64;
    let run = |sql: &str, binds: &[&dyn rusqlite::ToSql]| -> rusqlite::Result<Vec<SearchHit>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(binds, hit_row)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    };
    let fts = fts_escape(query);
    let via_fts = match session {
        Some(s) => run(
            "SELECT session_id, seq, ts, text FROM scrollback_fts
             WHERE scrollback_fts MATCH ?1 AND session_id = ?2 ORDER BY ts DESC, seq DESC LIMIT ?3",
            &[&fts, &s, &limit],
        ),
        None => run(
            "SELECT session_id, seq, ts, text FROM scrollback_fts
             WHERE scrollback_fts MATCH ?1 ORDER BY ts DESC, seq DESC LIMIT ?2",
            &[&fts, &limit],
        ),
    };
    match via_fts {
        Ok(hits) => Ok(hits),
        Err(_) => {
            let pat = format!("%{}%", query.trim());
            match session {
                Some(s) => run(
                    "SELECT session_id, seq, ts, text FROM scrollback
                     WHERE text LIKE ?1 AND session_id = ?2 ORDER BY ts DESC, seq DESC LIMIT ?3",
                    &[&pat, &s, &limit],
                ),
                None => run(
                    "SELECT session_id, seq, ts, text FROM scrollback
                     WHERE text LIKE ?1 ORDER BY ts DESC, seq DESC LIMIT ?2",
                    &[&pat, &limit],
                ),
            }
            .map_err(|e| e.to_string())
        }
    }
}

/// 디스크 페이징 (FR-C-13·14) — before_seq 이전 limit줄을 시간 오름차순으로.
/// 인메모리 링버퍼(xterm 5,000줄) 위쪽의 기록을 필요할 때만 조각 로드한다.
pub fn page(
    root: &Path,
    ws: &str,
    session: &str,
    before_seq: Option<i64>,
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let path = db_path(root, ws);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT session_id, seq, ts, text FROM
               (SELECT * FROM scrollback WHERE session_id = ?1 AND seq < ?2 ORDER BY seq DESC LIMIT ?3)
             ORDER BY seq ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![session, before_seq.unwrap_or(i64::MAX), limit.min(500) as i64],
            hit_row,
        )
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// TUI 리페인트 잔해 판정 — 상자 그리기 문자가 절반 이상인 줄은 스필하지 않는다.
/// Claude Code처럼 인라인 박스를 다시 그리는 TUI의 프레임 조각이 스크롤백을 오염시키는 것을 막는다.
pub fn is_tui_noise(line: &str) -> bool {
    let mut total = 0usize;
    let mut boxy = 0usize;
    for c in line.chars() {
        if c.is_whitespace() {
            continue;
        }
        total += 1;
        if matches!(
            c,
            '─' | '│' | '╭' | '╮' | '╯' | '╰' | '┌' | '┐' | '└' | '┘' | '═' | '║' | '╔'
                | '╗' | '╚' | '╝' | '┃' | '━' | '╌' | '╍' | '┤' | '├' | '┬' | '┴' | '┼'
        ) {
            boxy += 1;
        }
    }
    total > 0 && boxy * 2 >= total
}

/// VT 시퀀스를 걸러 확정된 줄만 뽑아내는 조립기 (FR-C-11).
/// CSI·OSC·단축 ESC를 제거하고, \r 덮어쓰기(진행 표시줄)는 마지막 내용만 남긴다.
/// 완전한 VT 파서(PRD A)가 오면 그 확정 줄로 교체한다.
pub struct LineAssembler {
    partial: String,
    esc: EscState,
    cr: bool,
}

enum EscState {
    None,
    Esc,
    Csi,
    Osc,
    OscEsc,
}

impl LineAssembler {
    pub fn new() -> Self {
        LineAssembler { partial: String::new(), esc: EscState::None, cr: false }
    }

    pub fn push(&mut self, data: &str, mut emit: impl FnMut(String)) {
        for c in data.chars() {
            match self.esc {
                EscState::None => {
                    if self.cr && c != '\n' {
                        self.partial.clear(); // \r 단독 = 줄 덮어쓰기
                    }
                    self.cr = false;
                    match c {
                        '\u{1b}' => self.esc = EscState::Esc,
                        '\n' => {
                            let line = std::mem::take(&mut self.partial);
                            if !line.trim().is_empty() {
                                emit(line);
                            }
                        }
                        '\r' => self.cr = true,
                        '\u{8}' => {
                            self.partial.pop();
                        }
                        '\t' => self.partial.push('\t'),
                        c if c.is_control() => {}
                        c => self.partial.push(c),
                    }
                }
                EscState::Esc => match c {
                    '[' => self.esc = EscState::Csi,
                    ']' => self.esc = EscState::Osc,
                    _ => self.esc = EscState::None,
                },
                EscState::Csi => {
                    if ('\u{40}'..='\u{7e}').contains(&c) {
                        self.esc = EscState::None;
                    }
                }
                EscState::Osc => match c {
                    '\u{7}' => self.esc = EscState::None,
                    '\u{1b}' => self.esc = EscState::OscEsc,
                    _ => {}
                },
                EscState::OscEsc => self.esc = EscState::None,
            }
        }
        if self.partial.len() > 4000 {
            let line = std::mem::take(&mut self.partial);
            emit(line);
        }
    }

    pub fn finish(&mut self, mut emit: impl FnMut(String)) {
        let line = std::mem::take(&mut self.partial);
        if !line.trim().is_empty() {
            emit(line);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_is_escaped_per_token() {
        assert_eq!(fts_escape(r#"foo "bar" NEAR"#), r#""foo" "bar" "NEAR""#);
    }

    #[test]
    fn search_and_page_roundtrip() {
        let dir = std::env::temp_dir().join(format!("eqmux-fts-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        {
            let conn = open_db(&dir, "ws").unwrap();
            for i in 1..=50i64 {
                let text = format!("line {i} {}", if i % 10 == 0 { "needle" } else { "hay" });
                conn.execute(
                    "INSERT INTO scrollback (session_id, seq, ts, text) VALUES ('s1', ?1, ?2, ?3)",
                    params![i, 1_000 + i, text],
                )
                .unwrap();
                // FTS5가 없는 빌드에서도 테스트가 성립하게 실패는 무시 (search가 LIKE로 폴백)
                let _ = conn.execute(
                    "INSERT INTO scrollback_fts (text, session_id, seq, ts) VALUES (?3, 's1', ?1, ?2)",
                    params![i, 1_000 + i, text],
                );
            }
        }
        let hits = search(&dir, "ws", "needle", None, 50).unwrap();
        assert_eq!(hits.len(), 5);
        assert!(hits[0].seq > hits[4].seq); // 최신 우선
        assert_eq!(search(&dir, "ws", "needle", Some("s2"), 50).unwrap().len(), 0);

        let page1 = page(&dir, "ws", "s1", Some(21), 10).unwrap();
        assert_eq!(page1.first().unwrap().seq, 11); // 커서 이전 10줄, 오름차순
        assert_eq!(page1.last().unwrap().seq, 20);
        let latest = page(&dir, "ws", "s1", None, 5).unwrap();
        assert_eq!(latest.last().unwrap().seq, 50);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
