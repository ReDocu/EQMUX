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
    /// 편집 도구로 고친 파일 (§13-1 · C4) — 훅이 보낸다. 배치에 실려 쓴다
    Touch { ws: String, session: String, path: String, tool: String, ts: i64 },
    /// 비용 증분 (§13-6, W2) — 양수만 온다. mission None = 임무 밖
    Cost { ws: String, session: String, mission: Option<String>, ts: i64, usd: f64 },
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
CREATE INDEX IF NOT EXISTS event_session ON event(session_id, id);
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
  read INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  file_path TEXT,
  file_size INTEGER,
  project TEXT,
  sender_name TEXT,
  recipient_name TEXT
);
CREATE INDEX IF NOT EXISTS message_recipient_kind ON message(recipient, kind);
-- CPU·RAM M7 — open_requesters의 '내 마지막 완료 보고' 하위 쿼리(sender = ? AND kind = 'report')와
-- 모두 읽음(UPDATE … WHERE read = 0)이 원장 전체를 훑지 않게 한다. 미확인은 부분 인덱스라 작다
CREATE INDEX IF NOT EXISTS message_sender_kind ON message(sender, kind);
CREATE INDEX IF NOT EXISTS message_unread ON message(id) WHERE read = 0;
";

/// 스키마 이전 (§1-2) — MIGRATIONS[i]는 버전 i+1 → i+2. 새 DB도 SCHEMA(버전 1) 뒤에 여기를 차례로 탄다.
/// 항목은 뒤에 덧붙이기만 한다 — 이미 나간 항목을 고치면 그 버전을 지난 DB에는 반영되지 않는다.
/// 그 전부터 있던 ALTER 열 추가(open_db)는 버전 1 DB의 들쭉날쭉한 모양을 메우는 것이라 그대로 둔다
const MIGRATIONS: &[&str] = &[
    // 2 — 편집 기록 (§13-1 · C4). DB가 워크스페이스별이라 workspace 열은 두지 않는다
    "CREATE TABLE IF NOT EXISTS file_touch (
       session TEXT NOT NULL,
       path TEXT NOT NULL,
       tool TEXT NOT NULL,
       ts INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS file_touch_ts ON file_touch(ts);
     CREATE INDEX IF NOT EXISTS file_touch_session ON file_touch(session, ts);",
    // 3 — 회신 연결 (§4 `eqmux send --re <id>` · `--wait`, W3). 원 메시지의 원장 id, 회신이 아니면 NULL
    "ALTER TABLE message ADD COLUMN re INTEGER;
     CREATE INDEX IF NOT EXISTS message_re ON message(re);",
    // 4 — 임무별 비용 (§13-6, W2). 증분 한 건 = 한 행(대략 1센트마다), mission NULL = 임무 밖
    "CREATE TABLE IF NOT EXISTS cost (
       session TEXT NOT NULL,
       mission TEXT,
       ts INTEGER NOT NULL,
       usd REAL NOT NULL
     );
     CREATE INDEX IF NOT EXISTS cost_ts ON cost(ts);",
    // 5 — escalate 심각도 (§4 `eqmux send --type escalate --severity high`, W3). "high"만 적고 normal은 NULL
    "ALTER TABLE message ADD COLUMN severity TEXT;",
];

/// 버전을 하나씩 올린다 — 단계마다 트랜잭션이라 중간에 실패해도 그 앞 버전에 멈춘다.
/// 앱보다 새 버전의 DB(내려 깐 경우)는 건드리지 않는다
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn
        .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let to = i as i64 + 2;
        if current >= to {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT OR REPLACE INTO meta VALUES ('schema_version', ?1)",
            params![to.to_string()],
        )?;
        tx.commit()?;
    }
    Ok(())
}

const SCROLLBACK_CAP_PER_SESSION: i64 = 1_000; // FR-C-50 — 0.3.7에서 10만 → 1,000줄
const CAP_CHECK_EVERY: i64 = 200; // 상한의 1/5마다 점검 — 실보관량이 상한을 크게 넘지 않게
const RETENTION_DAYS_MS: i64 = 30 * 86_400_000;
const BATCH_MAX: usize = 200; // FR-C-21 — 100ms 창 또는 누적 N줄 중 먼저
/// 열린 DB의 보존 정리 주기 (CPU·RAM M7) — 첫 열기에서만 돌면 앱을 며칠 켜 두는 동안 30일이 지나도 지워지지 않는다
const MAINTAIN_EVERY: Duration = Duration::from_secs(24 * 3600);
/// 쓰기 실패로 다시 쌓인 대기분의 상한 (CPU·RAM M4) — 채널 상한과 같은 값. DB를 못 여는 동안에도
/// 채널은 계속 비워져 pending으로 들어오므로, 이 상한이 없으면 그 워크스페이스의 출력 전부가 힙에 쌓인다
const PENDING_MAX: usize = 50_000;

/// 상한을 넘은 대기분에서 오래된 출력 줄(Line)부터 버린다 — 이벤트·세션 시작/종료·재개 매핑은
/// 작고 다시 만들 수 없으니 남긴다. 버린 줄 수를 돌려준다. 버린 줄은 세션 로그 파일에 그대로 있다
fn cap_pending(pending: &mut Vec<StoreMsg>, max: usize) -> usize {
    let mut over = pending.len().saturating_sub(max);
    let before = pending.len();
    pending.retain(|m| {
        if over > 0 && matches!(m, StoreMsg::Line { .. }) {
            over -= 1;
            return false;
        }
        true
    });
    before - pending.len()
}

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

/// 이 프로세스에서 스키마를 이미 맞춘 DB 파일 (CPU·RAM C8) — 메시지 송수신·cache_set·report마다
/// 스키마 전체·ALTER 9개·FTS 생성을 다시 돌며 쓰기 스레드와 잠금을 다투던 자리다.
/// ponytail: 실행 중에 session.db가 지워지면(지금은 그런 경로가 없다) 다시 맞추지 않는다
static MIGRATED: std::sync::Mutex<Option<std::collections::HashSet<PathBuf>>> = std::sync::Mutex::new(None);

/// DB를 손상으로 옮겼을 때 사람에게 알리는 자리 (§1-2) — setup이 OS 알림을 단다. (워크스페이스, 옮긴 파일)
type RecoverHook = Box<dyn Fn(&str, &Path) + Send + Sync>;
static ON_RECOVER: std::sync::OnceLock<RecoverHook> = std::sync::OnceLock::new();

pub(crate) fn on_recover(f: impl Fn(&str, &Path) + Send + Sync + 'static) {
    let _ = ON_RECOVER.set(Box::new(f));
}

fn is_corrupt(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt)
    )
}

/// 손상된 DB를 `session.db.corrupt-<ts>`(+ -wal · -shm)로 옮긴다 — 지우지 않는다. 옮긴 본체 경로를 돌려준다.
/// 옛 WAL이 새 DB 옆에 남으면 새 DB에 재생되므로, WAL을 치우지 못하면 본체를 되돌리고 실패로 본다
fn quarantine(path: &Path) -> Option<PathBuf> {
    let base = path.display().to_string();
    let moved = PathBuf::from(format!("{base}.corrupt-{}", now_ms()));
    std::fs::rename(path, &moved).ok()?;
    for suffix in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{base}{suffix}"));
        if side.exists()
            && std::fs::rename(&side, format!("{}{suffix}", moved.display())).is_err()
            && std::fs::remove_file(&side).is_err()
        {
            let _ = std::fs::rename(&moved, path);
            return None;
        }
    }
    Some(moved)
}

/// 쓰기 열림 — 스키마 보장까지만 하는 가벼운 열기. 메시지 버스(messages.rs)도 이 경로로 연다.
/// 손상(§1-2): 스키마를 맞추다 "DB가 아니다/손상"이 나면 파일을 옮기고 새로 만든 뒤 알린다.
/// ponytail: 머리·스키마 쪽 손상만 잡는다 — 깊은 페이지 손상은 그 줄을 읽을 때 오류로 나며, quick_check는 큰 DB에서 느려 열 때 돌리지 않는다
pub(crate) fn open_db(root: &Path, ws: &str) -> rusqlite::Result<Connection> {
    let path = db_path(root, ws);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match open_path(&path) {
        Err(e) if is_corrupt(&e) => {
            let Some(moved) = quarantine(&path) else { return Err(e) };
            crate::diag::write(&format!("store: 손상된 DB를 옮기고 새로 만듦 {} ({e})", moved.display()));
            if let Some(f) = ON_RECOVER.get() {
                f(ws, &moved);
            }
            open_path(&path)
        }
        r => r,
    }
}

fn open_path(path: &Path) -> rusqlite::Result<Connection> {
    let path = path.to_path_buf();
    let conn = Connection::open(&path)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    // 이중 쓰기 연결 경합 (store 배치 커밋 vs msg_send·IPC publish) — 즉시 실패 대신 대기
    let _ = conn.busy_timeout(Duration::from_millis(500));
    let done = MIGRATED.lock().map(|m| m.as_ref().is_some_and(|s| s.contains(&path))).unwrap_or(false);
    if done {
        return Ok(conn);
    }
    conn.execute_batch(SCHEMA)?;
    // SGR 보존 컬럼 (FR-C-15, M32) — 기존 DB 마이그레이션. 이미 있으면 조용히 실패한다
    let _ = conn.execute("ALTER TABLE scrollback ADD COLUMN styled TEXT", []);
    // 마지막 한 줄 요약 (M35) — 앱을 껐다 켜도 그 페인이 무엇을 하고 있었는지 남긴다.
    // 세션당 한 행이라 event 테이블처럼 턴마다 자라지 않는다
    let _ = conn.execute("ALTER TABLE session ADD COLUMN last_recap TEXT", []);
    let _ = conn.execute("ALTER TABLE session ADD COLUMN last_recap_at INTEGER", []);
    // 메시지 0.5 열 (W2) — 완료 보고 · --file 첨부 · 다른 프로젝트 발신. 0.5까지는 버전 업 때
    // session.db를 새로 만들었고(결정 1b, 0.6에서 폐기), 이 열들은 그 전 DB를 메우던 것이라 그대로 둔다
    // sender_name·recipient_name (W1) — 보낸 때의 세션 이름. 세션이 사라져도 대화에 이름이 남는다
    for col in [
        "done INTEGER NOT NULL DEFAULT 0",
        "file_path TEXT",
        "file_size INTEGER",
        "project TEXT",
        "sender_name TEXT",
        "recipient_name TEXT",
    ] {
        let _ = conn.execute(&format!("ALTER TABLE message ADD COLUMN {col}"), []);
    }
    // FTS5 인덱스 (FR-C-16) — 번들 SQLite에 FTS5가 없으면 조용히 넘어가고 검색은 LIKE 폴백
    let _ = conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS scrollback_fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED, ts UNINDEXED)",
    );
    // 이전 실패로 DB 전체를 못 쓰게 하지 않는다 — 단계마다 트랜잭션이라 실패한 단계 앞 버전에 멈추고
    // 그 뒤 기능만 빠진다. 기억(MIGRATED)에 넣지 않으므로 다음 열기에 다시 시도한다
    if let Err(e) = migrate(&conn) {
        crate::diag::write(&format!("store: 스키마 이전 실패 {}: {e}", path.display()));
        return Ok(conn);
    }
    if let Ok(mut m) = MIGRATED.lock() {
        m.get_or_insert_with(Default::default).insert(path);
    }
    Ok(conn)
}

/// 쓰기 스레드의 첫 열기 — 무거운 정리(FTS 시드·30일 보존·세션 상한)는 여기서만 돈다 (최적화 B1·B4).
/// 메시지·캐시 같은 짧은 호출은 open_db만 거친다 — 호출마다 전체 스캔을 돌면 송수신이 느려진다.
pub(crate) fn open_writer(root: &Path, ws: &str) -> rusqlite::Result<Connection> {
    let conn = open_db(root, ws)?;
    maintain(&conn);
    Ok(conn)
}

fn maintain(conn: &Connection) {
    // 기존 DB 1회 시드 — 이 마일스톤 이전에 쌓인 줄도 검색에 잡히게. 실패(FTS 없음)면
    // 표식을 남기지 않아 다음 열림 때 다시 시도한다.
    let seeded: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'fts_seeded'", [], |r| r.get(0))
        .ok();
    if seeded.is_none()
        && conn
            .execute(
                "INSERT INTO scrollback_fts (rowid, text, session_id, seq, ts)
                 SELECT rowid, text, session_id, seq, ts FROM scrollback",
                [],
            )
            .is_ok()
    {
        let _ = conn.execute("INSERT OR REPLACE INTO meta VALUES ('fts_seeded', '1')", []);
    }
    // 열 때 1회 보존 정리 (FR-C-50 30일) — 쓰기 스레드라 UI를 막지 않는다 (FR-C-51)
    let cutoff = now_ms() - RETENTION_DAYS_MS;
    // 색인 먼저 — 본문을 먼저 지우면 지울 rowid를 찾을 수 없다 (drop_lines와 같은 순서)
    let _ = conn.execute(
        "DELETE FROM scrollback_fts WHERE rowid IN (SELECT rowid FROM scrollback WHERE ts < ?1)",
        params![cutoff],
    );
    let _ = conn.execute("DELETE FROM scrollback WHERE ts < ?1", params![cutoff]);
    // 이벤트 피드도 같은 30일 (최적화 B5) — 상태 전이마다 쌓여 지우는 길이 없었다.
    // 세션 상세가 세션별로 최신순 조회하므로 (session_id, id) 인덱스를 둔다 (SCHEMA)
    let _ = conn.execute("DELETE FROM event WHERE ts < ?1", params![cutoff]);
    let _ = conn.execute("DELETE FROM file_touch WHERE ts < ?1", params![cutoff]);
    let _ = conn.execute("DELETE FROM cost WHERE ts < ?1", params![cutoff]);
    // 세션당 상한도 열 때 한 번 적용한다 — 상한을 낮춘 뒤 처음 여는 DB에는 옛 상한으로 쌓인
    // 줄이 남아 있고, 그 세션이 다시 살아나지 않으면 적재 경로의 정리는 영영 돌지 않는다.
    // 검색이 최신 SCROLLBACK_CAP_PER_SESSION줄만 보게 하려면 여는 김에 여기서 끊어 준다.
    trim_to_cap(conn);
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
        drop_lines(conn, &id, floor);
    }
}

/// 전역 보존 상한 (§1-2) — 모든 워크스페이스 session.db를 합쳐 이 크기를 넘지 않게 한다
const GLOBAL_CAP_BYTES: u64 = 2 << 30;
/// 전역 상한 정리 한 번에 쓰기 스레드를 쥐는 최대 시간
const CAP_BUDGET: Duration = Duration::from_secs(2);

/// DB가 실제로 쓰는 바이트 — 지운 페이지는 freelist로 가서 다음 쓰기가 재사용한다.
/// VACUUM으로 파일을 줄이지 않는다: scrollback은 INTEGER PRIMARY KEY가 없어 VACUUM이 rowid를 다시 매기고,
/// 그러면 같은 rowid로 묶인 FTS 색인이 어긋난다 (drop_lines). 그래서 "더 자라지 않게"가 상한의 뜻이다
fn used_bytes(conn: &Connection) -> u64 {
    let q = |p: &str| conn.query_row(&format!("PRAGMA {p}"), [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    ((q("page_count") - q("freelist_count")).max(0) * q("page_size")) as u64
}

/// 합계가 cap을 넘으면 모든 DB를 통틀어 가장 오래된 스크롤백 줄부터 지운다. 지운 줄 수를 돌려준다.
/// 메시지 원장·세션·이벤트·재개 앵커·편집 기록은 건드리지 않는다 — 크기의 대부분은 스크롤백이고,
/// 원장을 지울지는 제품 결정이다(목록 §5 메시지 보존 기간). 스크롤백을 다 비워도 넘으면 진단에 남기고 멈춘다.
/// budget을 넘기면 멈추고 (지운 줄, true)를 돌려준다 — 쓰기 스레드에서 돌므로 오래 쥐면 큐(50k)가 차서
/// PTY 리더가 막힌다. 나머지는 run이 다음 쉬는 틈마다 이어서 한다. 지우기는 문장마다 자동 커밋이라 중간에 앱이 꺼져도 안전하다
pub(crate) fn enforce_global_cap(root: &Path, cap: u64, budget: Duration) -> (u64, bool) {
    let started = std::time::Instant::now();
    let Ok(entries) = std::fs::read_dir(root.join("workspaces")) else { return (0, false) };
    let dirs: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().join("session.db").exists())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    // 싼 사전 판정 — 파일 크기 합(≥ 실사용)이 상한 안이면 DB를 열지 않는다
    let file_total: u64 = dirs
        .iter()
        .flat_map(|d| ["session.db", "session.db-wal"].map(|f| root.join("workspaces").join(d).join(f)))
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();
    if file_total <= cap {
        return (0, false);
    }
    // 디렉터리 이름은 이미 sanitize된 것이라 open_db가 같은 경로로 연다
    let conns: Vec<Connection> = dirs.iter().filter_map(|d| open_db(root, d).ok()).collect();
    let oldest = |c: &Connection| -> Option<i64> {
        c.query_row("SELECT MIN(ts) FROM scrollback", [], |r| r.get::<_, Option<i64>>(0)).ok().flatten()
    };
    let mut dropped = 0u64;
    let mut more = false;
    for _ in 0..10_000 {
        let total: u64 = conns.iter().map(used_bytes).sum();
        if total <= cap {
            break;
        }
        if started.elapsed() > budget {
            more = true;
            break;
        }
        let mut by_age: Vec<(i64, &Connection)> = conns.iter().filter_map(|c| oldest(c).map(|t| (t, c))).collect();
        by_age.sort_by_key(|(t, _)| *t);
        let Some(&(_, conn)) = by_age.first() else { break };
        // 다음으로 오래된 DB의 첫 줄보다 새 줄은 이번 차례에 지우지 않는다 — 전역으로 오래된 순을 지킨다
        let next = by_age.get(1).map(|(t, _)| *t).unwrap_or(i64::MAX);
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM scrollback", [], |r| r.get(0)).unwrap_or(1).max(1);
        let per_row = (used_bytes(conn) / rows as u64).max(1);
        let k = ((total - cap) / per_row + 1).clamp(100, 50_000) as i64;
        let pick = "SELECT rowid FROM scrollback WHERE ts <= ?1 ORDER BY ts, rowid LIMIT ?2";
        let _ = conn.execute(&format!("DELETE FROM scrollback_fts WHERE rowid IN ({pick})"), params![next, k]);
        let n = conn
            .execute(&format!("DELETE FROM scrollback WHERE rowid IN ({pick})"), params![next, k])
            .unwrap_or(0);
        if n == 0 {
            break;
        }
        dropped += n as u64;
    }
    let total: u64 = conns.iter().map(used_bytes).sum();
    if more {
        crate::diag::write(&format!("store: 전역 상한 정리 {dropped}줄 — 시간 예산을 넘어 다음 틈에 잇는다"));
    } else if total > cap {
        crate::diag::write(&format!("store: 전역 상한 {cap}바이트를 스크롤백 정리만으로 맞추지 못함 (지금 {total})"));
    } else if dropped > 0 {
        crate::diag::write(&format!("store: 전역 상한으로 오래된 스크롤백 {dropped}줄 정리"));
    }
    (dropped, more)
}

/// 세션의 seq 이하 줄을 본문·색인에서 함께 지운다. FTS 행의 rowid는 scrollback 행의 rowid와 같게
/// 적재되므로 색인은 rowid로 지운다 (최적화 B2) — session_id·seq는 UNINDEXED라 그 조건으로 지우면
/// 매번 색인 전체를 훑는다. 색인을 먼저 지운다 — 본문이 먼저 사라지면 지울 rowid를 찾을 수 없다.
/// scrollback은 INTEGER PRIMARY KEY가 없어 VACUUM이 rowid를 다시 매길 수 있다 — VACUUM은 둘을 다
/// 비운 뒤에만 한다 (purge_scrollback).
fn drop_lines(conn: &Connection, id: &str, floor: i64) {
    let _ = conn.execute(
        "DELETE FROM scrollback_fts WHERE rowid IN
           (SELECT rowid FROM scrollback WHERE session_id = ?1 AND seq <= ?2)",
        params![id, floor],
    );
    let _ = conn.execute(
        "DELETE FROM scrollback WHERE session_id = ?1 AND seq <= ?2",
        params![id, floor],
    );
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

    /// 편집 기록 한 건 (C4) — 쓰기 스레드의 배치로 넘긴다. 훅 경로를 DB 잠금에 묶지 않는다
    pub fn touch_file(&self, ws: &str, session: &str, path: &str, tool: &str, ts: i64) {
        let _ = self.tx.send(StoreMsg::Touch {
            ws: ws.into(),
            session: session.into(),
            path: path.into(),
            tool: tool.into(),
            ts,
        });
    }

    /// 비용 증분 한 건 (§13-6) — touch_file과 같이 쓰기 스레드 배치로 넘긴다
    pub fn cost_delta(&self, ws: &str, session: &str, mission: Option<&str>, ts: i64, usd: f64) {
        let _ = self.tx.send(StoreMsg::Cost {
            ws: ws.into(),
            session: session.into(),
            mission: mission.map(Into::into),
            ts,
            usd,
        });
    }
}

/// 임무별 비용 합 (§13-6) — mission None = 임무 밖
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MissionCost {
    pub mission: Option<String>,
    pub usd: f64,
}

/// since_ms 이후 비용을 임무별로 합친다. DB·테이블이 없으면 빈 목록
pub fn cost_by_mission(root: &Path, ws: &str, since_ms: i64) -> Vec<MissionCost> {
    let path = db_path(root, ws);
    if !path.exists() {
        return Vec::new();
    }
    let Ok(conn) = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(Duration::from_secs(2));
    let Ok(mut stmt) = conn.prepare("SELECT mission, SUM(usd) FROM cost WHERE ts >= ?1 GROUP BY mission ORDER BY mission") else {
        return Vec::new();
    };
    let rows = stmt.query_map(params![since_ms], |r| Ok(MissionCost { mission: r.get(0)?, usd: r.get(1)? }));
    rows.map(|it| it.flatten().collect()).unwrap_or_default()
}

/// 편집 기록 행 (C4)
#[allow(dead_code)]
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Touch {
    pub session: String,
    pub path: String,
    pub tool: String,
    pub ts: i64,
}

#[allow(dead_code)] // 읽는 쪽은 §13-3·13-5(2라운드) — W2가 쓰기만 먼저 붙였다
fn read_touches(root: &Path, ws: &str, session: Option<&str>, since_ms: i64) -> Vec<Touch> {
    let path = db_path(root, ws);
    if !path.exists() {
        return Vec::new();
    }
    let Ok(conn) = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(Duration::from_secs(2));
    // 이전 전 DB(테이블 없음)면 prepare가 실패한다 — 기록 없음으로 본다
    let Ok(mut stmt) = conn.prepare(
        "SELECT session, path, tool, ts FROM file_touch
         WHERE ts >= ?1 AND (?2 IS NULL OR session = ?2) ORDER BY ts ASC",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map(params![since_ms, session], |r| {
        Ok(Touch { session: r.get(0)?, path: r.get(1)?, tool: r.get(2)?, ts: r.get(3)? })
    });
    rows.map(|it| it.flatten().collect()).unwrap_or_default()
}

/// 워크스페이스의 since_ms 이후 편집 기록, 오래된 순 (C4)
#[allow(dead_code)]
pub fn recent_touches(root: &Path, ws: &str, since_ms: i64) -> Vec<Touch> {
    read_touches(root, ws, None, since_ms)
}

/// 한 세션의 since_ms 이후 편집 기록, 오래된 순 (C4 — 임무 검토 필터 §13-3)
#[allow(dead_code)]
pub fn touches_for(root: &Path, ws: &str, session: &str, since_ms: i64) -> Vec<Touch> {
    read_touches(root, ws, Some(session), since_ms)
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
    // 마지막 flush 뒤 새로 들어온 수 (M4) — pending 길이로 재면 쓰기 실패로 남은 대기분이 BATCH_MAX를
    // 넘는 순간부터 줄 하나마다 flush(= DB 열기 재시도)가 돈다
    let mut fresh = 0usize;
    let mut last_maintain = std::time::Instant::now(); // 첫 열기(open_writer)가 이미 한 번 돈다
    // 기동 때 한 번 — 상한 안이면 파일 크기만 보고 끝난다. 한 번에 CAP_BUDGET까지만, 남으면 쉬는 틈마다 잇는다
    let mut cap_more = enforce_global_cap(&root, GLOBAL_CAP_BYTES, CAP_BUDGET).1;

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
                fresh += 1;
                if fresh < BATCH_MAX {
                    continue;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                // 쉬는 틈에만 — 적재 중에는 배치를 늦추지 않는다
                if last_maintain.elapsed() >= MAINTAIN_EVERY {
                    last_maintain = std::time::Instant::now();
                    for conn in dbs.values() {
                        maintain(conn);
                    }
                    cap_more = true;
                }
                if cap_more {
                    cap_more = enforce_global_cap(&root, GLOBAL_CAP_BYTES, CAP_BUDGET).1;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                flush(&root, &mut dbs, &mut cursors, &mut pending);
                return;
            }
        }
        if !pending.is_empty() {
            flush(&root, &mut dbs, &mut cursors, &mut pending);
        }
        fresh = 0;
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
        | StoreMsg::Recap { ws, .. }
        | StoreMsg::Touch { ws, .. }
        | StoreMsg::Cost { ws, .. } => ws,
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
            match open_writer(root, &ws) {
                Ok(c) => {
                    dbs.insert(ws.clone(), c);
                }
                Err(_) => {
                    // 일시 오류(잠금·디스크)로 배치를 바로 버리지 않는다 — 다음 tick에 재시도.
                    // 영구 장애면 flush 끝의 cap_pending이 오래된 출력 줄부터 버려 상한을 지킨다 (M4).
                    // ponytail: 실패한 열기를 100ms 또는 BATCH_MAX줄마다 다시 시도한다, 비용이 보이면 백오프를 단다
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
                    // 줄마다 도는 핫패스 — 문장은 준비해 둔 것을 쓴다 (최적화 B6)
                    let added = tx
                        .prepare_cached(
                            "INSERT OR IGNORE INTO scrollback (session_id, seq, ts, text, styled) VALUES (?1, ?2, ?3, ?4, ?5)",
                        )
                        .and_then(|mut st| st.execute(params![id, cur.seq, now, text, styled]))
                        .unwrap_or(0);
                    // FTS 인덱스 동반 적재 (FR-C-16) — 본문과 같은 rowid로 (drop_lines가 rowid로 지운다).
                    // FTS5가 없으면 조용히 실패한다
                    if added == 1 {
                        let rowid = tx.last_insert_rowid();
                        let _ = tx
                            .prepare_cached(
                                "INSERT INTO scrollback_fts (rowid, text, session_id, seq, ts) VALUES (?1, ?2, ?3, ?4, ?5)",
                            )
                            .and_then(|mut st| st.execute(params![rowid, text, id, cur.seq, now]));
                    }
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
                StoreMsg::Touch { session, path, tool, ts, .. } => {
                    let _ = tx.execute(
                        "INSERT INTO file_touch (session, path, tool, ts) VALUES (?1, ?2, ?3, ?4)",
                        params![session, path, tool, ts],
                    );
                }
                StoreMsg::Cost { session, mission, ts, usd, .. } => {
                    let _ = tx.execute(
                        "INSERT INTO cost (session, mission, ts, usd) VALUES (?1, ?2, ?3, ?4)",
                        params![session, mission, ts, usd],
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

        // 세션당 1,000줄 상한 (FR-C-50) — CAP_CHECK_EVERY줄마다 점검
        for id in touched.keys() {
            if let Some(cur) = cursors.get_mut(id) {
                if cur.lines_since_cap >= CAP_CHECK_EVERY {
                    cur.lines_since_cap = 0;
                    drop_lines(conn, id, cur.seq - SCROLLBACK_CAP_PER_SESSION);
                }
            }
        }
    }
    let dropped = cap_pending(pending, PENDING_MAX);
    if dropped > 0 {
        crate::diag::write(&format!("store: 쓰기 실패가 이어져 대기 중인 출력 {dropped}줄을 버림 (상한 {PENDING_MAX})"));
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

/// PTY 출력에서 확정된 줄만 뽑아내는 조립기 (FR-C-11).
/// 가상 화면(vt100)을 PTY와 같은 크기로 돌리고, **화면 위로 밀려난 줄만** 확정한다.
/// TUI(Ink 기반 에이전트 CLI)가 커서를 올려 제자리에서 다시 그리는 스피너·입력창은
/// 화면 안에서만 바뀌므로 저장되지 않고, 밀려난 줄은 이미 다 그려진 최종 모습이다.
/// 줄 단위로 VT를 근사하던 옛 조립기는 그 프레임을 줄마다 저장해 재생을 오염시켰다.
/// 감싼 줄(wrap)은 한 논리 줄로 붙인다. 대체 화면(vim 등 전체 화면 앱)은 저장하지 않는다.
/// SGR만 보존한 styled 줄을 함께 낸다 (FR-C-15, M32) — 색이 없던 줄의 styled는 None이다.
/// ponytail: 세션마다 화면 한 장(행×열 셀)을 더 든다. 크래시로 끝나면 화면에 남아 있던 줄은 잃는다.
/// 위쪽 고정 스크롤 영역(ESC[2;Nr) 안에서 밀려난 행, Windows에서 폭을 줄일 때 ConPTY가 다시 감싸며
/// 제 스크롤백으로 넘긴 행도 잃는다 — 정확히 하려면 리플로우하는 화면 모델이 필요하다.
/// 유닉스에서는 대체 화면에 있는 동안 폭을 줄이면 주 화면 행이 잘리고, 읽기 경계에서 쪼개진
/// ESC[2J는 앞선 밀어내기를 놓친다. 2칸 글자 감쌈 판정(wide_wrap)은 폭이 정확히 cols-1인 줄 다음
/// 줄이 2칸 글자로 시작하면 두 줄을 잘못 붙인다
pub struct LineAssembler {
    /// 색(SGR) 보존본을 내는가 — 설정 sgrStore가 꺼져 있으면 styled는 None (CPU·RAM C9)
    sgr: bool,
    /// 호스트가 리사이즈·화면 지우기 뒤에 화면을 다시 그려 주는가 — Windows ConPTY는 그렇다.
    /// 아니면(유닉스 PTY) 폭을 줄이거나 ESC[2J로 지우기 전에 화면을 먼저 밀어내야 줄을 잃지 않는다
    host_repaints: bool,
    parser: vt100::Parser<Spill>,
}

/// 화면 위로 밀려난 행을 논리 줄로 모은다
#[derive(Default)]
struct Spill {
    cols: usize,
    /// 감쌈 판정용으로만 이어 쓰는 상태 — 앞 행이 감싸지 않았으면 다음 쓰기가 '\n'으로 시작한다
    wrap: vt100::capture::BasicFormattedCaptureState,
    line: String,
    line_plain: usize,
    /// 앞 행의 표시 폭 — 2칸 글자가 끝 1칸에 안 들어가 넘어간 행은 vt100이 wrapped로 표시하지 않는다
    prev_width: usize,
    done: Vec<String>,
    /// 최근에 밀려난 행의 평문 (화면 높이만큼) — 높이를 키우면 ConPTY가 이 행들을 화면으로 되살려
    /// 다시 그리므로, 그 행들이 또 밀려날 때 알아보고 건너뛴다
    recent: std::collections::VecDeque<String>,
    replay: std::collections::VecDeque<String>,
}

fn row_plain(formatted: &str) -> String {
    let p: String = vt100::capture::basic_formatted_to_plain(formatted).collect();
    p.trim_end().to_string()
}

impl Spill {
    fn end_line(&mut self) {
        self.done.push(std::mem::take(&mut self.line));
        self.line_plain = 0;
    }
}

impl vt100::Callbacks for Spill {
    fn on_scroll(&mut self, row: vt100::capture::RowContents<'_>, alternate_screen: bool) {
        if alternate_screen {
            return;
        }
        // 행마다 새 상태로 쓴다 — 줄이 앞 줄의 색을 물려받지 않고 제 SGR로 시작하게
        let mut fresh = String::new();
        let _ = row.write_formatted_basic(&mut fresh, &mut Default::default());
        let plain = row_plain(&fresh);
        if let Some(expected) = self.replay.front() {
            if *expected == plain {
                self.replay.pop_front(); // 이미 낸 행이 되살아났다가 다시 밀려났다 — 감쌈 상태도 건드리지 않는다
                return;
            }
            self.replay.clear();
        }
        let mut probe = String::new();
        let _ = row.write_formatted_basic(&mut probe, &mut self.wrap);
        let wide_wrap = self.prev_width + 1 == self.cols
            && plain.chars().next().is_some_and(|c| unicode_width::UnicodeWidthChar::width(c) == Some(2));
        if probe.starts_with('\n') && !wide_wrap {
            self.end_line();
        } else if self.line.contains('\u{1b}') {
            self.line.push_str("\u{1b}[0m"); // 이어 붙이는 행 사이 — 앞 행의 색이 다음 행 기본색 칸으로 번지지 않게
        }
        self.line.push_str(&fresh);
        self.line_plain += plain.len();
        self.prev_width = unicode_width::UnicodeWidthStr::width(plain.as_str());
        self.recent.push_back(plain);
        if self.recent.len() > 512 {
            self.recent.pop_front();
        }
        if self.line_plain > 4000 {
            self.end_line();
        }
    }
}

fn dim(n: u16) -> std::num::NonZeroU16 {
    std::num::NonZeroU16::new(n.max(1)).unwrap_or(std::num::NonZeroU16::MIN)
}

impl LineAssembler {
    pub fn new(rows: u16, cols: u16, sgr: bool) -> Self {
        // 스크롤백 0 — 밀려난 행은 on_scroll로 곧장 나간다. 보관은 스토어 몫이다
        let spill = Spill { cols: cols.max(1) as usize, ..Default::default() };
        LineAssembler {
            sgr,
            host_repaints: cfg!(windows),
            parser: vt100::Parser::new_with_callbacks(dim(rows), dim(cols), 0, spill),
        }
    }

    /// PTY 리사이즈를 따른다 — 크기가 어긋나면 감쌈·스크롤 위치가 실제 화면과 달라진다
    pub fn resize(&mut self, rows: u16, cols: u16) {
        let (old_rows, old_cols) = self.parser.screen().size();
        if !self.host_repaints && cols < old_cols.get() && !self.parser.screen().alternate_screen() {
            // vt100은 폭을 줄이면 행을 잘라 버린다 — 자르기 전에 커서 위 행만 낸다.
            // 커서 행부터는 셸 입력·TUI가 이어 그리는 자리라 남긴다 (프레임·반쪽 입력이 줄로 굳지 않게)
            let (r, c) = self.parser.screen().cursor_position();
            self.scroll_off(r as usize, Some((0, c)));
        }
        let grow = rows.saturating_sub(old_rows.get()) as usize;
        let cb = self.parser.callbacks_mut();
        cb.cols = cols.max(1) as usize;
        // 아직 다 소비되지 않은 되살림이 있으면 그 앞으로 늘린다 — 창을 끌면 키우기가 연달아 온다
        let n = (cb.replay.len() + grow).min(cb.recent.len());
        cb.replay = cb.recent.iter().skip(cb.recent.len() - n).cloned().collect();
        self.parser.set_size(dim(rows), dim(cols));
    }

    /// 맨 위 k행을 위로 밀어낸다. `back`이 있으면 커서를 그 자리(0부터)로 되돌린다 — 이어지는
    /// 출력이 같은 자리에 그려지게. DECSC(ESC7)는 쓰지 않는다: 저장 슬롯이 하나라 앱이 저장한 자리를 덮는다
    fn scroll_off(&mut self, k: usize, back: Option<(u16, u16)>) {
        let rows = self.parser.screen().size().0.get();
        let mut seq = format!("\u{1b}[{rows};1H{}", "\n".repeat(k));
        if let Some((r, c)) = back {
            seq += &format!("\u{1b}[{};{}H", r + 1, c + 1);
        }
        self.parser.process(seq.as_bytes());
    }

    fn screen_rows(&self) -> usize {
        self.parser.screen().size().0.get() as usize
    }

    fn drain(&mut self, emit: &mut impl FnMut(String, Option<String>)) {
        for l in self.parser.callbacks_mut().done.drain(..) {
            let plain = row_plain(&l);
            if plain.is_empty() {
                continue;
            }
            let styled = (self.sgr && l.contains('\u{1b}')).then(|| l + "\u{1b}[0m");
            emit(plain, styled);
        }
    }

    pub fn push(&mut self, data: &str, mut emit: impl FnMut(String, Option<String>)) {
        let mut rest = data;
        if !self.host_repaints {
            // 화면 지우기(clear·cls) — 아무도 다시 그려 주지 않으니 지우기 전에 밀어내 둔다
            while let Some(i) = rest.find("\u{1b}[2J") {
                self.parser.process(&rest.as_bytes()[..i]);
                if !self.parser.screen().alternate_screen() {
                    let at = self.parser.screen().cursor_position();
                    self.scroll_off(self.screen_rows(), Some(at));
                }
                self.parser.process(b"\x1b[2J");
                rest = &rest[i + 4..];
            }
        }
        self.parser.process(rest.as_bytes());
        self.drain(&mut emit);
    }

    /// 세션 끝 — 화면에 남은 줄을 마저 확정한다
    pub fn finish(&mut self, mut emit: impl FnMut(String, Option<String>)) {
        // 주 화면으로 돌아가 여백을 풀고 화면 높이만큼 밀어낸다
        self.parser.process(b"\x1b[?1049l\x1b[r");
        self.scroll_off(self.screen_rows(), None);
        self.parser.callbacks_mut().end_line();
        self.drain(&mut emit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// M4 — 상한을 넘으면 오래된 Line부터 버리고, 이벤트는 남긴다
    #[test]
    fn cap_pending_drops_oldest_lines_only() {
        let line = |t: &str| StoreMsg::Line { ws: "w".into(), id: "s".into(), text: t.into(), styled: None };
        let event = || StoreMsg::Event { ws: "w".into(), id: None, kind: "k".into(), message: "m".into() };
        let mut p = vec![line("1"), event(), line("2"), line("3")];
        assert_eq!(cap_pending(&mut p, 2), 2);
        let kept: Vec<String> = p
            .iter()
            .map(|m| match m {
                StoreMsg::Line { text, .. } => text.clone(),
                _ => "E".into(),
            })
            .collect();
        assert_eq!(kept, ["E", "3"]);
        assert_eq!(cap_pending(&mut p, 2), 0, "상한 안이면 그대로");
    }

    #[test]
    fn fts_query_is_escaped_per_token() {
        assert_eq!(fts_escape(r#"foo "bar" NEAR"#), r#""foo" "bar" "NEAR""#);
    }

    /// M7 — 모두 읽음과 '내 마지막 완료 보고' 하위 쿼리가 원장 전체가 아니라 인덱스를 탄다
    #[test]
    fn message_queries_use_indexes() {
        let dir = std::env::temp_dir().join(format!("eqmux-idx-{}", crate::workspace::now_ms()));
        let conn = open_db(&dir, "ws").unwrap();
        let plan = |sql: &str| -> String {
            let mut st = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
            let rows = st.query_map([], |r| r.get::<_, String>(3)).unwrap();
            rows.map(|r| r.unwrap()).collect::<Vec<_>>().join(" / ")
        };
        let unread = plan("UPDATE message SET read = 1 WHERE read = 0");
        assert!(unread.contains("message_unread"), "{unread}");
        let done = plan("SELECT MAX(id) FROM message WHERE sender = 'a' AND kind = 'report' AND done = 1");
        assert!(done.contains("message_sender_kind"), "{done}");
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// C8 — 같은 DB를 다시 열어도 동작하고, 스키마는 첫 열기에서 맞춘 것으로 기억된다
    #[test]
    fn open_db_migrates_once_per_file() {
        let dir = std::env::temp_dir().join(format!("eqmux-mig-{}", crate::workspace::now_ms()));
        let first = open_db(&dir, "ws").unwrap();
        first.execute("INSERT OR REPLACE INTO meta VALUES ('k', 'v')", []).unwrap();
        drop(first);
        assert!(MIGRATED.lock().unwrap().as_ref().unwrap().contains(&db_path(&dir, "ws")));
        let again = open_db(&dir, "ws").unwrap();
        let v: String = again.query_row("SELECT value FROM meta WHERE key = 'k'", [], |r| r.get(0)).unwrap();
        assert_eq!(v, "v");
        drop(again);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// §1-2 · C4 — 버전 1 DB가 열리며 최신 버전으로 올라가고, 편집 기록이 쓰기 스레드를 거쳐 조회된다
    #[test]
    fn v1_db_migrates_and_touches_roundtrip() {
        let dir = std::env::temp_dir().join(format!("eqmux-touch-{}", crate::workspace::now_ms()));
        {
            let path = db_path(&dir, "ws");
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('schema_version', '1');")
                .unwrap();
        }
        assert!(recent_touches(&dir, "ws", 0).is_empty(), "이전 전 DB는 기록 없음");
        let store = Store::new(dir.clone());
        store.touch_file("ws", "kai@ws", "src/x.ts", "Edit", 100);
        store.touch_file("ws", "rin@ws", "src/x.ts", "Write", 200);
        store.touch_file("ws", "kai@ws", "src/y.ts", "Edit", 300);
        let (ack, done) = std::sync::mpsc::channel();
        store.sender().send(StoreMsg::Flush(ack)).unwrap();
        done.recv_timeout(Duration::from_secs(10)).unwrap();

        let v: String = Connection::open(db_path(&dir, "ws"))
            .unwrap()
            .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, (MIGRATIONS.len() + 1).to_string());
        let all = recent_touches(&dir, "ws", 150);
        assert_eq!(all.iter().map(|t| t.ts).collect::<Vec<_>>(), [200, 300]);
        let kai = touches_for(&dir, "ws", "kai@ws", 0);
        assert_eq!(kai.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), ["src/x.ts", "src/y.ts"]);

        // §13-6 — 비용 증분이 임무별로 합쳐진다 (since 이전은 빠진다)
        assert!(cost_by_mission(&dir, "nows", 0).is_empty());
        store.cost_delta("ws", "kai@ws", Some("m1"), 100, 0.25);
        store.cost_delta("ws", "kai@ws", Some("m1"), 200, 0.5);
        store.cost_delta("ws", "rin@ws", None, 300, 0.125);
        store.cost_delta("ws", "rin@ws", Some("m1"), 50, 9.0);
        let (ack, done) = std::sync::mpsc::channel();
        store.sender().send(StoreMsg::Flush(ack)).unwrap();
        done.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(
            cost_by_mission(&dir, "ws", 100),
            [MissionCost { mission: None, usd: 0.125 }, MissionCost { mission: Some("m1".into()), usd: 0.75 }]
        );
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// §1-2 — DB가 아닌 파일(손상)이면 옆으로 옮기고 새로 만든다. 옛 WAL은 새 DB에 붙지 않는다
    #[test]
    fn corrupt_db_is_moved_aside_and_recreated() {
        let dir = std::env::temp_dir().join(format!("eqmux-corrupt-{}", crate::workspace::now_ms()));
        let path = db_path(&dir, "ws");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, vec![b'x'; 8192]).unwrap();
        std::fs::write(format!("{}-wal", path.display()), b"stale").unwrap();

        let conn = open_db(&dir, "ws").expect("새로 만들어 열린다");
        conn.execute("INSERT INTO meta VALUES ('k', 'v')", []).unwrap();
        let names: Vec<String> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n.starts_with("session.db.corrupt-") && !n.ends_with("-wal")), "{names:?}");
        // 옛 WAL은 옮겨지거나(quarantine) 열기 실패 때 SQLite가 버린다 — 어느 쪽이든 새 DB의 WAL이 아니다
        let wal = std::fs::read(format!("{}-wal", path.display())).unwrap_or_default();
        assert_ne!(wal, b"stale", "옛 WAL이 새 DB 옆에 남으면 안 된다");
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// §1-2 — 합계가 상한을 넘으면 모든 DB를 통틀어 오래된 스크롤백부터 지우고, 원장은 남긴다
    #[test]
    fn global_cap_drops_oldest_scrollback_across_workspaces() {
        let dir = std::env::temp_dir().join(format!("eqmux-gcap-{}", crate::workspace::now_ms()));
        let fill = |ws: &str, ts: i64| {
            let conn = open_db(&dir, ws).unwrap();
            let text = "y".repeat(1000);
            for i in 1..=800i64 {
                conn.execute(
                    "INSERT INTO scrollback (session_id, seq, ts, text) VALUES ('s', ?1, ?2, ?3)",
                    params![i, ts + i, text],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO message (ts, sender, recipient, kind, body) VALUES (1, 'a', 'b', 'ask', 'keep')",
                [],
            )
            .unwrap();
            conn
        };
        let (old, new) = (fill("old", 1_000), fill("new", 1_000_000));
        let total = used_bytes(&old) + used_bytes(&new);
        drop((old, new));
        let cap = total - 300_000;

        assert_eq!(enforce_global_cap(&dir, cap, Duration::ZERO), (0, true), "예산이 없으면 지우지 않고 다음으로 미룬다");
        assert!(enforce_global_cap(&dir, cap, Duration::MAX).0 > 0);
        let count = |ws: &str, sql: &str| -> i64 {
            Connection::open(db_path(&dir, ws)).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
        };
        assert!(count("old", "SELECT COUNT(*) FROM scrollback") < 800, "오래된 쪽이 먼저 줄어든다");
        assert_eq!(count("new", "SELECT COUNT(*) FROM scrollback"), 800, "새 쪽은 그대로");
        assert_eq!(count("old", "SELECT COUNT(*) FROM message"), 1, "원장은 지우지 않는다");
        let after: u64 = ["old", "new"].iter().map(|w| used_bytes(&open_db(&dir, w).unwrap())).sum();
        assert!(after <= cap, "{after} > {cap}");
        assert_eq!(enforce_global_cap(&dir, u64::MAX, Duration::MAX), (0, false), "상한 안이면 아무것도 안 한다");
        let _ = std::fs::remove_dir_all(&dir);
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
        drop(open_writer(&dir, "ws").unwrap()); // 쓰기 스레드가 다시 여는 것만으로 상한이 적용된다

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

    /// 이벤트 피드 30일 보존 (최적화 B5) — 쓰기 스레드가 열 때 옛 이벤트만 걷는다
    #[test]
    fn writer_open_drops_month_old_events() {
        let dir = std::env::temp_dir().join(format!("eqmux-b5-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        {
            let conn = open_db(&dir, "ws").unwrap();
            conn.execute(
                "INSERT INTO event (ts, session_id, kind) VALUES (?1, 's1', 'old'), (?2, 's1', 'new')",
                params![now_ms() - RETENTION_DAYS_MS - 1_000, now_ms()],
            )
            .unwrap();
        }
        drop(open_writer(&dir, "ws").unwrap());
        let conn = Connection::open(db_path(&dir, "ws")).unwrap();
        let kinds: Vec<String> = conn
            .prepare("SELECT kind FROM event")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(kinds, vec!["new".to_string()]);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 적재 경로의 상한 자르기가 색인도 같이 자른다 — FTS 행은 본문과 같은 rowid로 들어가고
    /// rowid로 지워진다 (최적화 B2). 둘이 어긋나면 잘린 옛 줄이 검색에 남는다
    #[test]
    fn writer_trims_index_with_the_lines() {
        let dir = std::env::temp_dir().join(format!("eqmux-b2-{}", crate::workspace::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::new(dir.clone());
        let tx = store.sender();
        let total = SCROLLBACK_CAP_PER_SESSION + CAP_CHECK_EVERY * 2;
        for i in 1..=total {
            let text = if i == 1 { "oldneedle".to_string() } else { format!("line {i} hay") };
            tx.send(StoreMsg::Line { ws: "ws".into(), id: "s1".into(), text, styled: None }).unwrap();
        }
        let (ack, done) = std::sync::mpsc::channel();
        tx.send(StoreMsg::Flush(ack)).unwrap();
        done.recv_timeout(Duration::from_secs(10)).unwrap();

        let conn = Connection::open(db_path(&dir, "ws")).unwrap();
        let lines: i64 = conn.query_row("SELECT COUNT(*) FROM scrollback", [], |r| r.get(0)).unwrap();
        assert!(lines < total, "상한 자르기가 돌아야 한다");
        if let Ok(indexed) = conn.query_row("SELECT COUNT(*) FROM scrollback_fts", [], |r| r.get::<_, i64>(0)) {
            assert_eq!(indexed, lines, "색인과 본문의 줄 수가 같아야 한다");
            assert!(search(&dir, "ws", "oldneedle", None, 10).unwrap().is_empty());
        }
        drop(conn);
        drop((tx, store));
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

#[cfg(test)]
mod accum_tests {
    use super::*;

    fn run(rows: u16, cols: u16, sgr: bool, input: &str) -> Vec<(String, Option<String>)> {
        let mut a = LineAssembler::new(rows, cols, sgr);
        let mut out = Vec::new();
        a.push(input, |t, s| out.push((t, s)));
        a.finish(|t, s| out.push((t, s)));
        out
    }

    fn texts(v: &[(String, Option<String>)]) -> Vec<String> {
        v.iter().map(|x| x.0.clone()).collect()
    }

    /// Ink(Claude Code)가 실제로 하는 방식 — 이전 출력을 줄마다 2K·1A로 지우고 다시 쓴다.
    /// 스피너 프레임이 줄로 남으면 재생에 "Puzzling… 1s · 2s · 3s"가 쌓인다 (QA 4차 스크린샷)
    #[test]
    fn ink_repaint_keeps_history_and_only_last_frame() {
        let mut s = String::from("h1\r\nh2\r\nh3\r\nh4\r\nh5\r\nh6\r\nspin 1s\r\n> ");
        for i in 2..=50 {
            s += &format!("\u{1b}[2K\u{1b}[1A\u{1b}[2K\u{1b}[Gspin {i}s\r\n> ");
        }
        let out = texts(&run(4, 40, true, &s));
        assert_eq!(&out[..6], ["h1", "h2", "h3", "h4", "h5", "h6"]);
        let spins: Vec<_> = out.iter().filter(|l| l.contains("spin")).collect();
        assert_eq!(spins, ["spin 50s"], "중간 프레임이 남았다: {out:?}");
    }

    /// 커서 이동·\r 덮어쓰기는 실제 터미널이 보여주는 모양 그대로 — 조각이 이어 붙지 않는다
    #[test]
    fn cursor_moves_land_where_the_terminal_shows_them() {
        let out = texts(&run(3, 40, true, "abc\u{1b}[5Cxyz\r\nold text\rnew\r\n"));
        assert_eq!(out, ["abc     xyz", "new text"]);
    }

    /// SGR 보존 (FR-C-15, M32) — 색 있는 줄만 styled, 꺼져 있으면(C9) 평문은 같고 styled 없음
    #[test]
    fn sgr_is_kept_only_when_present_and_enabled() {
        let input = "\u{1b}[31mred\u{1b}[0m plain\r\nno color\r\n";
        let on = run(3, 40, true, input);
        assert_eq!(texts(&on), ["red plain", "no color"]);
        let styled = on[0].1.as_deref().unwrap();
        assert!(styled.contains("\u{1b}[31mred") && styled.ends_with("\u{1b}[0m"), "{styled:?}");
        assert!(on[1].1.is_none());
        let off = run(3, 40, false, input);
        assert_eq!(texts(&off), texts(&on));
        assert!(off.iter().all(|x| x.1.is_none()));
    }

    /// 감싼 줄은 한 논리 줄 — 한글(2칸)이 열 끝에서 넘어가도 그대로 붙는다
    #[test]
    fn wrapped_rows_join_into_one_line() {
        assert_eq!(texts(&run(3, 10, true, "0123456789ABCDE\r\n한글한글한글\r\n")), ["0123456789ABCDE", "한글한글한글"]);
    }

    /// 리사이즈로 화면이 줄어도 줄을 잃거나 두 번 내지 않는다
    #[test]
    fn shrinking_keeps_every_line_once() {
        let mut a = LineAssembler::new(3, 20, true);
        let mut out = Vec::new();
        a.push("a\r\nb\r\nc", |t, _| out.push(t));
        a.resize(2, 20);
        a.push("\r\nd", |t, _| out.push(t));
        a.finish(|t, _| out.push(t));
        assert_eq!(out, ["a", "b", "c", "d"]);
    }

    /// 전체 화면 앱(대체 화면)의 내용은 스크롤백이 아니다
    #[test]
    fn alternate_screen_is_not_stored() {
        let s = format!("before\r\n\u{1b}[?1049h{}\u{1b}[?1049lafter\r\n", "vim line\r\n".repeat(10));
        assert_eq!(texts(&run(3, 20, true, &s)), ["before", "after"]);
    }

    /// 높이를 키우면 ConPTY가 이미 밀려난 행을 화면으로 되살려 ESC[H부터 다시 그린다 (실제 로그 모양).
    /// 그 행들이 또 밀려날 때 두 번 저장하면 안 된다 (리뷰 3)
    #[test]
    fn growing_height_does_not_duplicate_conpty_repaint() {
        let mut a = LineAssembler::new(4, 40, true);
        a.host_repaints = true;
        let mut out = Vec::new();
        a.push("l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nPS> ", |t, _| out.push(t));
        a.resize(6, 40);
        a.push("\u{1b}[Hl1\u{1b}[K\r\nl2\u{1b}[K\r\nl3\u{1b}[K\r\nl4\u{1b}[K\r\nl5\u{1b}[K\r\nPS> ", |t, _| out.push(t));
        a.push("ls\r\nout\r\n", |t, _| out.push(t));
        a.finish(|t, _| out.push(t));
        assert_eq!(out, ["l1", "l2", "l3", "l4", "l5", "PS> ls", "out"]);
    }

    /// 2칸 글자가 끝 1칸에 안 들어가 넘어간 행도 한 줄이다 — vt100은 이때 wrapped를 세우지 않는다 (리뷰 6)
    #[test]
    fn wide_char_wrap_at_odd_width_stays_one_line() {
        assert_eq!(texts(&run(3, 9, true, "한글한글한글\r\n다음\r\n")), ["한글한글한글", "다음"]);
    }

    /// 감싼 행을 이어 붙일 때 앞 행의 색이 다음 행으로 번지지 않는다 (리뷰 7)
    #[test]
    fn color_does_not_bleed_across_joined_rows() {
        let out = run(3, 10, true, "\u{1b}[31m0123456789\u{1b}[0mabc\r\n");
        let styled = out[0].1.as_deref().unwrap();
        let abc = styled.rfind("abc").unwrap();
        let last_red = styled.rfind("\u{1b}[31m").unwrap();
        assert!(styled[last_red..abc].contains("\u{1b}[0m") || styled[last_red..abc].contains("\u{1b}[m"), "{styled:?}");
    }

    /// 유닉스 PTY는 지운 화면을 아무도 다시 그려 주지 않는다 — clear 앞의 줄을 잃지 않는다 (리뷰 5)
    #[test]
    fn clear_screen_keeps_lines_without_host_repaint() {
        let mut a = LineAssembler::new(5, 20, true);
        a.host_repaints = false;
        let mut out = Vec::new();
        a.push("a\r\nb\r\nc\r\n\u{1b}[H\u{1b}[2Jafter\r\n", |t, _| out.push(t));
        a.finish(|t, _| out.push(t));
        assert_eq!(out, ["a", "b", "c", "after"]);
    }

    /// 유닉스 PTY에서 폭을 줄여도 화면의 줄이 잘리지 않는다 (리뷰 4)
    #[test]
    fn narrowing_keeps_full_lines_without_host_repaint() {
        let mut a = LineAssembler::new(5, 40, true);
        a.host_repaints = false;
        let mut out = Vec::new();
        a.push("this is a fairly long line of output\r\n", |t, _| out.push(t));
        a.resize(5, 10);
        a.push("x\r\n", |t, _| out.push(t));
        a.finish(|t, _| out.push(t));
        assert_eq!(out, ["this is a fairly long line of output", "x"]);
    }

    /// 평문 끝 공백은 저장하지 않고 (리뷰 12), 4000자 강제 방출은 평문 길이 기준이다 (리뷰 11)
    #[test]
    fn trailing_spaces_trimmed_and_cap_counts_plain_text() {
        assert_eq!(texts(&run(3, 40, true, "pad      \r\n")), ["pad"]);
        let colorful: String = (0..1000).map(|i| format!("\u{1b}[3{}mx", i % 7 + 1)).collect();
        let out = run(3, 80, true, &(colorful + "\r\n"));
        assert_eq!(out.len(), 1, "평문 1000자가 {}줄로 쪼개졌다", out.len());
        assert_eq!(out[0].0.len(), 1000);
    }

    /// 창을 끌면 키우기가 스크롤 없이 연달아 온다 — 두 번째 되살림도 중복되지 않는다 (재검증 A)
    #[test]
    fn stepwise_growing_does_not_duplicate() {
        let mut a = LineAssembler::new(4, 40, true);
        a.host_repaints = true;
        let mut out = Vec::new();
        a.push("l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\r\nl7\r\nl8\r\nl9\r\nPS> ", |t, _| out.push(t));
        let repaint = |from: usize| {
            let mut s = String::from("\u{1b}[H");
            for i in from..=9 {
                s += &format!("l{i}\u{1b}[K\r\n");
            }
            s + "PS> "
        };
        a.resize(6, 40);
        a.push(&repaint(5), |t, _| out.push(t));
        a.resize(8, 40);
        a.push(&repaint(3), |t, _| out.push(t));
        a.push("ls\r\n".repeat(8).as_str(), |t, _| out.push(t));
        a.finish(|t, _| out.push(t));
        let want: Vec<String> = (1..=9).map(|i| format!("l{i}")).chain(["PS> ls".into()]).collect();
        assert_eq!(out[..10], want[..], "{out:?}");
    }

    /// 유닉스에서 폭을 줄일 때 커서 행(입력 중인 프롬프트)은 밀어내지 않는다 — 반쪽으로 갈라지지 않게 (재검증 B)
    #[test]
    fn narrowing_mid_prompt_keeps_the_prompt_whole() {
        let mut a = LineAssembler::new(5, 30, true);
        a.host_repaints = false;
        let mut out = Vec::new();
        a.push("done\r\n$ ", |t, _| out.push(t));
        a.resize(5, 20);
        a.push("ls -la\r\n", |t, _| out.push(t));
        a.finish(|t, _| out.push(t));
        assert_eq!(out, ["done", "$ ls -la"]);
    }

    /// 밀어내기가 앱이 ESC7로 저장해 둔 커서 슬롯을 덮지 않는다 (재검증 C) — 예전엔 ESC8이 우리 자리
    /// (status 뒤)로 가서 "status body1"이 됐다. 밀어낸 만큼 행은 어긋나지만(열 3은 앱 것) 줄은 잃지 않는다
    #[test]
    fn scroll_off_keeps_the_apps_saved_cursor() {
        let mut a = LineAssembler::new(6, 30, true);
        a.host_repaints = false;
        let mut out = Vec::new();
        a.push("top\r\nmid\u{1b}7\r\n\r\nstatus", |t, _| out.push(t));
        a.resize(6, 20);
        a.push("\u{1b}8 body1\r\n", |t, _| out.push(t));
        a.finish(|t, _| out.push(t));
        assert_eq!(out, ["top", "mid", "status", "    body1"]);
    }

    /// 색 없는 감싼 줄은 styled가 None이다 — 이음 리셋은 색이 있을 때만 (재검증 E)
    #[test]
    fn plain_wrapped_line_has_no_styled_copy() {
        let out = run(3, 6, true, "hello world\r\n");
        assert_eq!(out, [("hello world".to_string(), None)]);
    }
}
