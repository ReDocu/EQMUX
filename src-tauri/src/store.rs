// 세션 스토어 (PRD C) — SQLite WAL · 워크스페이스별 DB (FR-C-20a) · 배치 커밋 (FR-C-21).
// 디스크에 적재하는 것은 VT를 통과해 확정된 줄이다 (FR-C-11) — raw 바이트는 로그 파일(1차) 몫.
// 스키마 7테이블(FR-C-20) + message(PRD F 원장) — 쓰기 열림 때마다 IF NOT EXISTS로 보장한다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

pub enum StoreMsg {
    SessionStart { ws: String, id: String, cwd: String, shell: String },
    SessionExit { ws: String, id: String, code: Option<u32> },
    /// 확정 줄 — text는 평문(검색·FTS·노이즈 판정용), styled는 SGR 보존본 (FR-C-15, 켰을 때만)
    Line { ws: String, id: String, text: String, styled: Option<String> },
    Event { ws: String, id: Option<String>, kind: String, message: String },
    /// 에이전트 재개 매핑 (FR-C-27 · FR-D-24)
    AgentSession { ws: String, id: String, agent_session_id: String, log_path: String, resumable: bool },
    /// 재개 매핑 제거 (P-9) — 세션 제거는 정체성의 끝이므로 앵커도 함께 지운다.
    /// 세션 id는 슬롯·페르소나에서 결정적으로 만들어져 재사용되기 때문에(shell2@ws · persona@ws),
    /// 남겨 두면 다음에 같은 자리에 생긴 다른 세션이 이 대화를 자기 것으로 물려받는다.
    ForgetAgentSession { ws: String, id: String },
    /// 마지막 한 줄 요약 (M35) — Stop 훅이 트랜스크립트에서 뽑아 보낸다. 세션당 덮어쓴다
    Recap { ws: String, id: String, text: String },
    /// 종료 flush (FR-C-62②) — 대기 배치를 즉시 커밋하고 ack를 보낸다
    Flush(Sender<()>),
}

pub struct Store {
    tx: SyncSender<StoreMsg>,
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

const SCROLLBACK_CAP_PER_SESSION: i64 = 1_000; // FR-C-50 — 0.3.7에서 10만 → 1,000줄
const CAP_CHECK_EVERY: i64 = 200; // 상한의 1/5마다 점검 — 실보관량이 상한을 크게 넘지 않게
const RETENTION_DAYS_MS: i64 = 30 * 86_400_000;
const BATCH_MAX: usize = 200; // FR-C-21 — 100ms 창 또는 누적 N줄 중 먼저

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn sanitize(ws: &str) -> String {
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
    // 이중 쓰기 연결 경합 (store 배치 커밋 vs msg_send·IPC publish) — 즉시 실패 대신 대기
    let _ = conn.busy_timeout(Duration::from_millis(500));
    conn.execute_batch(SCHEMA)?;
    // SGR 보존 컬럼 (FR-C-15, M32) — 기존 DB 마이그레이션. 이미 있으면 조용히 실패한다
    let _ = conn.execute("ALTER TABLE scrollback ADD COLUMN styled TEXT", []);
    // 마지막 한 줄 요약 (M35) — 앱을 껐다 켜도 그 페인이 무엇을 하고 있었는지 남긴다.
    // 세션당 한 행이라 event 테이블처럼 턴마다 자라지 않는다
    let _ = conn.execute("ALTER TABLE session ADD COLUMN last_recap TEXT", []);
    let _ = conn.execute("ALTER TABLE session ADD COLUMN last_recap_at INTEGER", []);
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
    // 세션당 상한도 열 때 한 번 적용한다 — 상한을 낮춘 뒤 처음 여는 DB에는 옛 상한으로 쌓인
    // 줄이 남아 있고, 그 세션이 다시 살아나지 않으면 적재 경로의 정리는 영영 돌지 않는다.
    // 검색이 최신 SCROLLBACK_CAP_PER_SESSION줄만 보게 하려면 여는 김에 여기서 끊어 준다.
    trim_to_cap(&conn);
    Ok(conn)
}

/// 세션마다 최신 SCROLLBACK_CAP_PER_SESSION줄만 남긴다 (FR-C-50) — 본문과 FTS를 함께 자른다.
/// 적재 경로가 CAP_CHECK_EVERY줄마다 하는 것과 같은 자르기를, 더는 살아 있지 않은 세션에도 한 번 준다.
fn trim_to_cap(conn: &Connection) {
    let sessions: Vec<(String, i64)> =
        match conn.prepare("SELECT session_id, MAX(seq) FROM scrollback GROUP BY session_id") {
            Ok(mut stmt) => match stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))) {
                Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
                Err(_) => return,
            },
            Err(_) => return,
        };
    for (id, max_seq) in sessions {
        let floor = max_seq - SCROLLBACK_CAP_PER_SESSION;
        if floor <= 0 {
            continue;
        }
        let _ = conn.execute(
            "DELETE FROM scrollback WHERE session_id = ?1 AND seq <= ?2",
            params![id, floor],
        );
        let _ = conn.execute(
            "DELETE FROM scrollback_fts WHERE session_id = ?1 AND seq <= ?2",
            params![id, floor],
        );
    }
}

impl Store {
    pub fn new(root: PathBuf) -> Store {
        // bounded — 쓰기 스레드가 수 초 정체해도(FTS 첫 시드·보존 DELETE) 힙이 무한 증가하지 않는다.
        // 가득 차면 생산자(PTY 리더)가 잠시 블록된다 = 출력 표시가 느려질 뿐 데이터는 안 버린다
        let (tx, rx) = sync_channel(50_000);
        let thread_root = root.clone();
        std::thread::spawn(move || run(thread_root, rx));
        Store { tx, root }
    }

    pub fn sender(&self) -> SyncSender<StoreMsg> {
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
        | StoreMsg::AgentSession { ws, .. }
        | StoreMsg::ForgetAgentSession { ws, .. }
        | StoreMsg::Recap { ws, .. } => ws,
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
                Err(_) => {
                    // 일시 오류(잠금·디스크)로 배치를 무음 폐기하지 않는다 — 다음 tick에 재시도.
                    // ponytail: 영구 장애면 pending이 계속 자란다, 재시도 상한이 필요해지면 그때 단다
                    pending.extend(msgs);
                    continue;
                }
            }
        }
        let conn = dbs.get_mut(&ws).unwrap();
        let now = now_ms();
        let mut touched: HashMap<String, i64> = HashMap::new(); // session -> appended bytes

        let tx = match conn.transaction() {
            Ok(t) => t,
            Err(_) => {
                pending.extend(msgs);
                continue;
            }
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
                StoreMsg::Recap { id, text, .. } => {
                    // 세션 행이 아직 없으면(스폰 직후 훅이 먼저 온 경우) 조용히 넘어간다 —
                    // 다음 턴의 Stop이 다시 보내므로 한 번 놓치는 것으로 끝난다
                    let _ = tx.execute(
                        "UPDATE session SET last_recap = ?2, last_recap_at = ?3 WHERE id = ?1",
                        params![id, text, now],
                    );
                }
                StoreMsg::SessionExit { id, code, .. } => {
                    // 종료 코드를 모르면 -1 — NULL은 "exit 기록 자체가 없음 = 크래시"의 뜻으로
                    // crash_scan이 판정에 쓰므로, kill·종료 시퀀스로 끝난 세션에 NULL을 남기면
                    // 다음 dirty 시작마다 크래시 세션으로 오인된다
                    let _ = tx.execute(
                        "UPDATE session SET exit_code = ?2 WHERE id = ?1",
                        params![id, code.map(|c| c as i64).unwrap_or(-1)],
                    );
                    let _ = tx.execute(
                        "INSERT INTO event (ts, session_id, kind, payload) VALUES (?1, ?2, 'session-exit', ?3)",
                        params![now, id, format!("{:?}", code)],
                    );
                    cursors.remove(id); // 끝난 세션의 커서 잔류 방지 — 재시작 시 MAX(seq)로 다시 만든다
                }
                StoreMsg::Line { id, text, styled, .. } => {
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
                        "INSERT OR IGNORE INTO scrollback (session_id, seq, ts, text, styled) VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![id, cur.seq, now, text, styled],
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
                StoreMsg::ForgetAgentSession { id, .. } => {
                    // 앵커만 지운다 — 스크롤백·이벤트는 보존 정책(30일)이 따로 관장한다
                    let _ = tx.execute("DELETE FROM agent_session WHERE session_id = ?1", params![id]);
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

        // 세션당 1,000줄 상한 (FR-C-50) — CAP_CHECK_EVERY줄마다 점검
        for id in touched.keys() {
            if let Some(cur) = cursors.get_mut(id) {
                if cur.lines_since_cap >= CAP_CHECK_EVERY {
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

/// 세션 스크롤백 전 줄 순회 (내보내기용) — 스키마 지식은 search/page처럼 이 모듈이 소유한다.
/// DB가 없으면 "기록 없음" 에러 — 호출부(FR-D-08)가 그대로 표시한다.
pub fn export_lines(
    root: &Path,
    ws: &str,
    session: &str,
    mut on_line: impl FnMut(&str) -> Result<(), String>,
) -> Result<u64, String> {
    let path = db_path(root, ws);
    if !path.exists() {
        return Err("저장된 기록이 아직 없습니다".into());
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT text FROM scrollback WHERE session_id = ?1 ORDER BY seq ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut count: u64 = 0;
    for line in rows.filter_map(|r| r.ok()) {
        on_line(&line)?;
        count += 1;
    }
    Ok(count)
}

/// 스크롤백 본문 초기화 (사용자 조작) — 세션 메타·이벤트·명령·메시지·재개 앵커는 남기고
/// scrollback과 FTS만 비운다 (FR-C-53 — 정리 대상은 스크롤백 본문만).
/// 지운 뒤 WAL을 본체로 접고(TRUNCATE) VACUUM으로 파일 크기까지 되돌린다 — 지우기만 하면
/// SQLite는 빈 페이지를 재사용할 뿐 파일이 줄지 않아, 상태바의 WAL 수치가 그대로 남는다.
pub fn purge_scrollback(root: &Path, ws: &str) -> Result<i64, String> {
    let path = db_path(root, ws);
    if !path.exists() {
        return Ok(0);
    }
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    // 쓰기 스레드의 배치 커밋과 겹칠 수 있다 — 즉시 실패 대신 잠깐 기다린다
    let _ = conn.busy_timeout(Duration::from_secs(2));
    let removed: i64 = conn
        .query_row("SELECT COUNT(*) FROM scrollback", [], |r| r.get(0))
        .unwrap_or(0);
    conn.execute("DELETE FROM scrollback", []).map_err(|e| e.to_string())?;
    let _ = conn.execute("DELETE FROM scrollback_fts", []); // FTS5 없는 빌드는 조용히 넘어간다
    // 파일 줄이기는 실패해도 에러로 만들지 않는다 — 줄은 이미 지워졌고, 크기는 다음 기회에 준다
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    let _ = conn.execute_batch("VACUUM");
    Ok(removed)
}

/// 세션별 마지막 한 줄 요약 (M35) — 앱을 껐다 켠 뒤 페인이 무엇을 하고 있었는지 되살린다.
/// 라이브 경로(agent-state)는 에이전트가 돌고 있을 때만 있으므로, 찬 시작에서는 여기가 유일한 출처다.
pub fn recaps(root: &Path, ws: &str) -> Vec<(String, String, i64)> {
    let path = db_path(root, ws);
    if !path.exists() {
        return Vec::new();
    }
    let Ok(conn) = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(Duration::from_secs(2));
    // 구 DB에는 컬럼이 없다 — 마이그레이션 전이면 조용히 빈 목록 (기능만 안 보이고 앱은 돈다)
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, last_recap, last_recap_at FROM session
         WHERE last_recap IS NOT NULL AND last_recap <> ''",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2).unwrap_or(0)))
    });
    rows.map(|it| it.flatten().collect()).unwrap_or_default()
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
/// SGR(CSI …m)만은 병렬 빌더에 보존해 색 복원용 styled 줄을 함께 낸다 (FR-C-15, M32) —
/// emit은 (평문, styled)를 받고 SGR이 없던 줄의 styled는 None이다.
/// 완전한 VT 파서(PRD A)가 오면 그 확정 줄로 교체한다.
pub struct LineAssembler {
    partial: String,
    /// SGR 보존 빌더 — 문자와 SGR 시퀀스를 순서대로 쌓는다. 백스페이스는 마지막 문자만 지운다
    styled: Vec<StyledChunk>,
    has_sgr: bool,
    esc: EscState,
    csi_buf: String,
    cr: bool,
}

enum StyledChunk {
    Sgr(String),
    Ch(char),
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
        LineAssembler {
            partial: String::new(),
            styled: Vec::new(),
            has_sgr: false,
            esc: EscState::None,
            csi_buf: String::new(),
            cr: false,
        }
    }

    /// 현재 줄 확정 — force가 아니면 공백뿐인 줄은 버린다
    fn emit_line(&mut self, force: bool, emit: &mut impl FnMut(String, Option<String>)) {
        let line = std::mem::take(&mut self.partial);
        let styled = if self.has_sgr {
            let mut s = String::new();
            for c in self.styled.drain(..) {
                match c {
                    StyledChunk::Sgr(x) => s.push_str(&x),
                    StyledChunk::Ch(ch) => s.push(ch),
                }
            }
            s.push_str("\u{1b}[0m"); // 줄 경계에서 속성 리셋 — 다음 줄로 색이 새지 않게
            Some(s)
        } else {
            self.styled.clear();
            None
        };
        self.has_sgr = false;
        if force || !line.trim().is_empty() {
            emit(line, styled);
        }
    }

    pub fn push(&mut self, data: &str, mut emit: impl FnMut(String, Option<String>)) {
        for c in data.chars() {
            match self.esc {
                EscState::None => {
                    if self.cr && c != '\n' {
                        // \r 단독 = 줄 덮어쓰기 — styled도 함께 버린다
                        self.partial.clear();
                        self.styled.clear();
                        self.has_sgr = false;
                    }
                    self.cr = false;
                    match c {
                        '\u{1b}' => self.esc = EscState::Esc,
                        '\n' => self.emit_line(false, &mut emit),
                        '\r' => self.cr = true,
                        '\u{8}' => {
                            if self.partial.pop().is_some() {
                                if let Some(pos) =
                                    self.styled.iter().rposition(|x| matches!(x, StyledChunk::Ch(_)))
                                {
                                    self.styled.remove(pos);
                                }
                            }
                        }
                        '\t' => {
                            self.partial.push('\t');
                            self.styled.push(StyledChunk::Ch('\t'));
                        }
                        c if c.is_control() => {}
                        c => {
                            self.partial.push(c);
                            self.styled.push(StyledChunk::Ch(c));
                        }
                    }
                }
                EscState::Esc => match c {
                    '[' => {
                        self.esc = EscState::Csi;
                        self.csi_buf.clear();
                    }
                    ']' => self.esc = EscState::Osc,
                    _ => self.esc = EscState::None,
                },
                EscState::Csi => {
                    if ('\u{40}'..='\u{7e}').contains(&c) {
                        // SGR(final 'm')만 보존한다 — 커서 이동·지우기는 색 복원과 무관하다
                        if c == 'm' {
                            self.styled
                                .push(StyledChunk::Sgr(format!("\u{1b}[{}m", self.csi_buf)));
                            self.has_sgr = true;
                        }
                        self.csi_buf.clear();
                        self.esc = EscState::None;
                    } else {
                        self.csi_buf.push(c);
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
            self.emit_line(true, &mut emit);
        }
    }

    pub fn finish(&mut self, mut emit: impl FnMut(String, Option<String>)) {
        if !self.partial.trim().is_empty() {
            self.emit_line(true, &mut emit);
        } else {
            self.partial.clear();
            self.styled.clear();
            self.has_sgr = false;
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

    /// SGR 보존 (FR-C-15, M32) — 색 시퀀스만 styled에 남고 평문은 그대로,
    /// 색 없는 줄은 styled가 None, 커서 이동류(CSI K 등)는 보존하지 않는다
    #[test]
    fn assembler_preserves_sgr_only() {
        let mut a = LineAssembler::new();
        let mut out: Vec<(String, Option<String>)> = Vec::new();
        a.push(
            "\u{1b}[31mred\u{1b}[0m plain\n\u{1b}[2Kmoved\nno color\n",
            |t, s| out.push((t, s)),
        );
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].0, "red plain");
        assert_eq!(out[0].1.as_deref(), Some("\u{1b}[31mred\u{1b}[0m plain\u{1b}[0m"));
        assert_eq!(out[1].0, "moved"); // CSI 2K는 버려진다
        assert!(out[1].1.is_none());
        assert!(out[2].1.is_none());

        // \r 덮어쓰기 — styled도 함께 버려 마지막 내용만 남는다
        let mut b = LineAssembler::new();
        let mut out2: Vec<(String, Option<String>)> = Vec::new();
        b.push("\u{1b}[32mold\rnew\u{1b}[33m!\n", |t, s| out2.push((t, s)));
        assert_eq!(out2[0].0, "new!");
        assert_eq!(out2[0].1.as_deref(), Some("new\u{1b}[33m!\u{1b}[0m"));

        // 백스페이스 — 평문·styled 양쪽에서 마지막 문자만 지운다 (SGR은 남는다)
        let mut c = LineAssembler::new();
        let mut out3: Vec<(String, Option<String>)> = Vec::new();
        c.push("\u{1b}[31mabc\u{8}\n", |t, s| out3.push((t, s)));
        assert_eq!(out3[0].0, "ab");
        assert_eq!(out3[0].1.as_deref(), Some("\u{1b}[31mab\u{1b}[0m"));
    }

    /// 한 줄 요약 저장 왕복 (M35) — 이 기능의 목적이 "앱을 껐다 켜도 남는 것"이므로
    /// 여기가 깨지면 기능 전체가 무의미하다. 구 DB 마이그레이션(ALTER TABLE)도 함께 본다.
    #[test]
    fn recap_survives_reopen_and_migrates_old_db() {
        let dir = std::env::temp_dir().join(format!("eqmux-recap-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();

        // 0.3.8까지의 DB 모양 — last_recap 컬럼이 없는 session 테이블
        {
            let path = db_path(&dir, "ws");
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE session (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT,
                 cwd TEXT, shell TEXT, created_at INTEGER, last_output_at INTEGER,
                 bytes_received INTEGER NOT NULL DEFAULT 0, exit_code INTEGER)",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO session (id, workspace) VALUES ('kai@ws', 'ws')",
                [],
            )
            .unwrap();
        }
        // 컬럼이 없는 DB에서도 읽기는 터지지 않고 빈 목록이어야 한다 (기능만 안 보이고 앱은 돈다)
        assert!(recaps(&dir, "ws").is_empty());

        // open_db가 마이그레이션한다 — 기존 행은 살아 있어야 한다
        {
            let conn = open_db(&dir, "ws").unwrap();
            let kept: i64 = conn
                .query_row("SELECT COUNT(*) FROM session WHERE id = 'kai@ws'", [], |r| r.get(0))
                .unwrap();
            assert_eq!(kept, 1, "마이그레이션이 기존 세션 행을 지우면 안 된다");
            conn.execute(
                "UPDATE session SET last_recap = ?2, last_recap_at = ?3 WHERE id = ?1",
                params!["kai@ws", "PRD 7절을 갱신하고 커밋 5개로 정리했다.", 1_700i64],
            )
            .unwrap();
            // 요약이 없는 세션은 목록에 끼지 않는다 — 빈 칸을 헤더에 올리지 않기 위해서다
            conn.execute("INSERT INTO session (id, workspace) VALUES ('shell1@ws', 'ws')", [])
                .unwrap();
        }

        // 앱을 껐다 켠 자리 — 새 연결로 읽는다
        let rows = recaps(&dir, "ws");
        assert_eq!(rows.len(), 1, "요약이 있는 세션만: {rows:?}");
        assert_eq!(rows[0].0, "kai@ws");
        assert_eq!(rows[0].1, "PRD 7절을 갱신하고 커밋 5개로 정리했다.");
        assert_eq!(rows[0].2, 1_700);

        // 없는 워크스페이스는 빈 목록 (오류가 아니다 — 첫 실행에 DB가 없는 것이 정상이다)
        assert!(recaps(&dir, "없는워크스페이스").is_empty());
        std::fs::remove_dir_all(&dir).ok();
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

    /// 상한 축소 (0.3.7) — 옛 상한으로 쌓인 DB도 여는 순간 세션마다 최신 1,000줄만 남고,
    /// 잘려 나간 옛 줄은 검색에도 잡히지 않는다 (FR-C-50)
    #[test]
    fn open_trims_each_session_to_cap() {
        let dir = std::env::temp_dir().join(format!("eqmux-cap-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let total = SCROLLBACK_CAP_PER_SESSION + 500;
        {
            let conn = open_db(&dir, "ws").unwrap();
            let now = now_ms(); // 30일 보존 정리에 걸리지 않게 현재 시각으로 넣는다
            for i in 1..=total {
                let text = format!("line {i} {}", if i == 1 { "oldneedle" } else { "hay" });
                conn.execute(
                    "INSERT INTO scrollback (session_id, seq, ts, text) VALUES (?1, ?2, ?3, ?4)",
                    params!["s1", i, now, text],
                )
                .unwrap();
                let _ = conn.execute(
                    "INSERT INTO scrollback_fts (text, session_id, seq, ts) VALUES (?1, ?2, ?3, ?4)",
                    params![text, "s1", i, now],
                );
            }
        }
        drop(open_db(&dir, "ws").unwrap()); // 다시 여는 것만으로 상한이 적용된다

        let conn = Connection::open(db_path(&dir, "ws")).unwrap();
        let kept: i64 = conn
            .query_row("SELECT COUNT(*) FROM scrollback WHERE session_id = ?1", params!["s1"], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, SCROLLBACK_CAP_PER_SESSION);
        let oldest: i64 = conn
            .query_row("SELECT MIN(seq) FROM scrollback WHERE session_id = ?1", params!["s1"], |r| r.get(0))
            .unwrap();
        assert_eq!(oldest, total - SCROLLBACK_CAP_PER_SESSION + 1);
        drop(conn);

        assert!(search(&dir, "ws", "oldneedle", None, 10).unwrap().is_empty());
        let recent = search(&dir, "ws", "hay", None, 5).unwrap();
        assert_eq!(recent.len(), 5);
        assert_eq!(recent[0].seq, total); // 최신부터
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 사용자 초기화 — 저장된 줄과 FTS는 비고, 세션 메타·이벤트는 남는다 (FR-C-53)
    #[test]
    fn purge_clears_lines_but_keeps_session_rows() {
        let dir = std::env::temp_dir().join(format!("eqmux-purge-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        {
            let conn = open_db(&dir, "ws").unwrap();
            let now = now_ms();
            conn.execute(
                "INSERT INTO session (id, workspace, created_at) VALUES ('s1', 'ws', ?1)",
                params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO event (ts, session_id, kind, payload) VALUES (?1, 's1', 'session-start', '/tmp')",
                params![now],
            )
            .unwrap();
            for i in 1..=20i64 {
                let text = format!("line {i} needle");
                conn.execute(
                    "INSERT INTO scrollback (session_id, seq, ts, text) VALUES ('s1', ?1, ?2, ?3)",
                    params![i, now, text],
                )
                .unwrap();
                let _ = conn.execute(
                    "INSERT INTO scrollback_fts (text, session_id, seq, ts) VALUES (?3, 's1', ?1, ?2)",
                    params![i, now, text],
                );
            }
        }
        assert_eq!(purge_scrollback(&dir, "ws").unwrap(), 20);
        assert!(search(&dir, "ws", "needle", None, 10).unwrap().is_empty());
        assert!(page(&dir, "ws", "s1", None, 10).unwrap().is_empty());

        let conn = Connection::open(db_path(&dir, "ws")).unwrap();
        let sessions: i64 = conn.query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0)).unwrap();
        let events: i64 = conn.query_row("SELECT COUNT(*) FROM event", [], |r| r.get(0)).unwrap();
        assert_eq!((sessions, events), (1, 1)); // 세션 목록·이벤트는 살아남는다
        drop(conn);

        assert_eq!(purge_scrollback(&dir, "ws").unwrap(), 0); // 두 번 눌러도 안전하다
        let _ = std::fs::remove_dir_all(&dir);
    }
}
