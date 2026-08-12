// 세션 스토어 (PRD C) — SQLite WAL · 워크스페이스별 DB (FR-C-20a) · 배치 커밋 (FR-C-21).
// 디스크에 적재하는 것은 VT를 통과해 확정된 줄이다 (FR-C-11) — raw 바이트는 로그 파일(1차) 몫.
// 스키마 7테이블(FR-C-20)을 모두 만들되 M1은 session·scrollback·event만 채운다.

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

fn open_db(root: &Path, ws: &str) -> rusqlite::Result<Connection> {
    let path = db_path(root, ws);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(path)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    conn.execute_batch(SCHEMA)?;
    // 열 때 1회 보존 정리 (FR-C-50 30일) — 백그라운드 스레드라 UI를 막지 않는다 (FR-C-51)
    let _ = conn.execute(
        "DELETE FROM scrollback WHERE ts < ?1",
        params![now_ms() - RETENTION_DAYS_MS],
    );
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
                }
            }
        }
    }
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
