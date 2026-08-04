//! 앱 데이터 폴더 크기 리포트 (`S2-1b`).
//!
//! # 왜 골격 단계에서 재나
//!
//! 지금 우리가 가진 용량 숫자는 **배포물 3.14 MB** 하나뿐이다.
//! 사용자가 체감하는 용량은 *배포물 + 앱 데이터*이고, wmux가 497.6 MB가 된 자리는
//! 전부 후자다 — 그중 **95.6%가 캐시 계열**이었다 (`docs/BASELINE.md` §6).
//!
//! **WebView2는 Chromium이라 이 구조가 그대로 따라온다.** Tauri가 없앤 건 배포물에 실린
//! 런타임 347 MB지 실행 중 쌓이는 캐시가 아니다. 그래서 상한 강제(`S3-6`)보다 **측정이 먼저**다
//! (`docs/issue.md` #7) — 재기 전에 박은 상한은 상한이 아니라 추측이다.
//!
//! # 무엇을 세나
//!
//! | 뿌리 | 경로 | 왜 |
//! |---|---|---|
//! | `webview` | `EQMUX_DATA_DIR` 또는 Tauri 기본값(`%LOCALAPPDATA%\<identifier>`) | 캐시가 쌓이는 곳. `EBWebView/`가 여기 생긴다 |
//! | `state` | 상태 파일의 부모 폴더 | 우리가 직접 쓰는 것 |
//!
//! **워크스페이스는 뺀다.** 기본 경로에서 워크스페이스는 `state` 폴더 *안*에 있고,
//! 빼지 않으면 **사용자 저장소 크기가 우리 앱 데이터로 둔갑한다.**
//! `BASELINE.md` §6이 정정한 실수("~0 MB" vs 46.5 MB)가 정확히 층을 잘못 잡은 경우였다.
//!
//! # 캐시 계열 판정
//!
//! 폴더 이름이 `cache`를 포함하거나 아래 목록에 있으면 그 아래 전부를 캐시로 센다.
//! 기준선(`Cache`·`Code Cache`·`Dictionaries`·`GPUCache`)을 그대로 덮고,
//! WebView2에만 있는 것(`GrShaderCache`·`DawnGraphiteCache` 등)까지 잡는다.
//! **규칙을 문서에 적어 두는 이유는 해원의 3회 측정(`#7` ②)이 같은 규칙으로 나와야 하기 때문이다.**

use std::cmp::Reverse;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::config::Paths;
use crate::error::Result;

/// `KR2` — 런타임 데이터 총량 하드 상한 (`docs/PRD-EQMUX.md` §지표).
/// 프런트가 상태줄 색을 고르는 기준이라 리포트에 같이 실어 보낸다.
pub const KR2_LIMIT_BYTES: u64 = 60 * 1024 * 1024;

/// 한 번 훑을 때의 상한. 걸리면 `truncated`로 남긴다 —
/// **잘린 값을 잘리지 않은 척 내보내면 그 숫자는 나중에 못 쓴다.**
const MAX_ENTRIES: u64 = 400_000;
const MAX_SCAN: Duration = Duration::from_secs(3);
const MAX_DEPTH: u32 = 32;

/// 상태줄·stderr에 남길 1단계 항목 수.
const TOP_N: usize = 6;

/// 한 폴더가 뿌리를 이만큼 차지하면 그 **안쪽**을 대신 보여준다.
/// WebView2가 정확히 이 꼴이다 — `EBWebView 13.75 MB` 한 줄은 크기만 알려주고
/// **어디가 자랐는지는 하나도 안 알려준다.**
const DRILL_RATIO: f64 = 0.8;

/// stderr에 다시 찍을 최소 증가폭. 이보다 작게 움직이면 조용히 둔다.
const LOG_DELTA_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub bytes: u64,
    pub cache: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RootReport {
    /// `webview` · `state`
    pub label: &'static str,
    pub path: PathBuf,
    pub exists: bool,
    pub bytes: u64,
    pub cache_bytes: u64,
    pub files: u64,
    /// 1단계 하위 항목, 큰 것부터. **어디가 자라는지 이름으로 보여야 한다.**
    pub top: Vec<Entry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppDataReport {
    pub roots: Vec<RootReport>,
    pub total_bytes: u64,
    pub cache_bytes: u64,
    pub files: u64,
    pub elapsed_ms: u64,
    /// 상한(`MAX_ENTRIES`·`MAX_SCAN`·`MAX_DEPTH`)에 걸려 도중에 끊겼는가.
    pub truncated: bool,
    pub limit_bytes: u64,
    /// 격리 인스턴스에서 잰 값인가. 라이브 값과 섞으면 안 된다.
    pub isolated: bool,
}

impl AppDataReport {
    /// 캐시 계열 비중. 기준선의 95.6%(wmux)와 같은 층에서 비교할 값이다.
    pub fn cache_ratio(&self) -> f64 {
        if self.total_bytes == 0 {
            0.0
        } else {
            self.cache_bytes as f64 / self.total_bytes as f64
        }
    }
}

/// 직전에 stderr로 알린 총량. 자란 만큼만 다시 찍으려고 들고 있는다.
///
/// 도그푸딩 중 stderr만 봐도 증가 곡선이 남는다 — `#7` ②의 3회 측정을 보조한다.
#[derive(Default)]
pub struct AppDataWatch(Mutex<Option<u64>>);

// ---------------------------------------------------------------- 훑기

/// 앱 데이터 폴더를 훑어 리포트를 만든다.
///
/// 디스크를 도는 작업이라 **메인 스레드에서 부르면 안 된다** —
/// 명령은 `#[tauri::command(async)]`로, 기동 리포트는 별도 스레드로 돌린다.
pub fn scan(paths: &Paths) -> AppDataReport {
    let started = Instant::now();

    // 뿌리가 겹칠 수 있다 — 환경변수 둘을 같은 폴더로 둘 수 있고, 그러면 두 번 세진다.
    let mut roots: Vec<(&'static str, PathBuf)> = Vec::new();
    push_root(&mut roots, "webview", paths.webview_effective.clone());
    if let Some(dir) = paths.state_file.parent() {
        push_root(&mut roots, "state", dir.to_path_buf());
    }

    // 내려가다 만나면 건너뛸 곳: 워크스페이스(사용자 파일) + 다른 뿌리(이중 계수).
    let mut skip: Vec<String> = vec![key(&paths.workspace_root)];
    skip.extend(roots.iter().map(|(_, p)| key(p)));

    let mut walker = Walker {
        deadline: started + MAX_SCAN,
        skip,
        entries: 0,
        truncated: false,
    };

    let reports: Vec<RootReport> = roots
        .into_iter()
        .map(|(label, path)| scan_root(&mut walker, label, path))
        .collect();

    AppDataReport {
        total_bytes: reports.iter().map(|r| r.bytes).sum(),
        cache_bytes: reports.iter().map(|r| r.cache_bytes).sum(),
        files: reports.iter().map(|r| r.files).sum(),
        roots: reports,
        elapsed_ms: started.elapsed().as_millis() as u64,
        truncated: walker.truncated,
        limit_bytes: KR2_LIMIT_BYTES,
        isolated: paths.isolated,
    }
}

fn push_root(roots: &mut Vec<(&'static str, PathBuf)>, label: &'static str, path: PathBuf) {
    let k = key(&path);
    if roots.iter().any(|(_, p)| key(p) == k) {
        return;
    }
    roots.push((label, path));
}

/// 경로 비교용 열쇠. Windows는 대소문자를 안 가리고, 끝의 구분자도 의미가 없다.
fn key(p: &Path) -> String {
    p.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

fn is_cache_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("cache")
        || matches!(
            lower.as_str(),
            "dictionaries" | "shared dictionary" | "service worker" | "blob_storage"
        )
}

struct Walker {
    deadline: Instant,
    skip: Vec<String>,
    entries: u64,
    truncated: bool,
}

#[derive(Default, Clone, Copy)]
struct Sum {
    bytes: u64,
    files: u64,
    cache: u64,
}

impl Sum {
    fn add(&mut self, o: Sum) {
        self.bytes += o.bytes;
        self.files += o.files;
        self.cache += o.cache;
    }
}

impl Walker {
    fn over_budget(&mut self) -> bool {
        // 시계를 파일마다 읽을 이유는 없다. 512개마다 본다.
        if self.entries >= MAX_ENTRIES {
            self.truncated = true;
            return true;
        }
        if self.entries % 512 == 0 && Instant::now() > self.deadline {
            self.truncated = true;
            return true;
        }
        false
    }

    fn skipped(&self, path: &Path) -> bool {
        self.skip.contains(&key(path))
    }

    /// `in_cache`는 **위쪽 어딘가가 캐시 폴더였는가**다.
    /// `Cache/` 밑의 파일 이름은 캐시처럼 생기지 않았으므로 위에서 물려받아야 한다.
    ///
    /// `out`을 주면 **바로 아래 항목**의 이름·크기를 거기에 담는다. 같은 훑기에서 얻으므로
    /// 내역을 보려고 폴더를 두 번 도는 일이 없다.
    fn walk(&mut self, dir: &Path, depth: u32, in_cache: bool, mut out: Option<&mut Vec<Entry>>) -> Sum {
        let mut sum = Sum::default();
        if depth > MAX_DEPTH {
            // 여기까지 깊으면 정상 트리가 아니다. 조용히 0으로 두지 않는다.
            self.truncated = true;
            return sum;
        }
        let rd = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            // 권한이 없거나 그새 지워진 폴더. 훑기 전체를 죽이지는 않는다.
            Err(_) => return sum,
        };

        for entry in rd.flatten() {
            if self.over_budget() {
                break;
            }
            self.entries += 1;

            let Ok(ft) = entry.file_type() else { continue };
            // 재파스 포인트(심볼릭 링크·정션)는 따라가지 않는다 — 고리에 빠지고 남의 것을 센다.
            if ft.is_symlink() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();

            if ft.is_dir() {
                let path = entry.path();
                if self.skipped(&path) {
                    continue;
                }
                let cache = in_cache || is_cache_name(&name);
                let child = self.walk(&path, depth + 1, cache, None);
                sum.add(child);
                if let Some(list) = out.as_deref_mut() {
                    list.push(Entry {
                        name,
                        bytes: child.bytes,
                        cache,
                    });
                }
            } else if let Ok(md) = entry.metadata() {
                sum.bytes += md.len();
                sum.files += 1;
                if in_cache {
                    sum.cache += md.len();
                }
                if let Some(list) = out.as_deref_mut() {
                    list.push(Entry {
                        name,
                        bytes: md.len(),
                        cache: in_cache,
                    });
                }
            }
        }
        sum
    }
}

fn scan_root(w: &mut Walker, label: &'static str, path: PathBuf) -> RootReport {
    let mut report = RootReport {
        label,
        exists: path.is_dir(),
        path,
        bytes: 0,
        cache_bytes: 0,
        files: 0,
        top: Vec::new(),
    };
    if !report.exists {
        return report;
    }

    // 1단계는 여기서 직접 돈다. 그래야 **각 항목의 안쪽 내역까지 같은 훑기에서** 챙긴다.
    // 총합만 있으면 "자랐다"는 알아도 "어디가"는 모른다.
    let rd = match std::fs::read_dir(&report.path) {
        Ok(rd) => rd,
        Err(_) => return report,
    };

    let mut total = Sum::default();
    let mut entries: Vec<(Entry, Vec<Entry>)> = Vec::new();

    for entry in rd.flatten() {
        if w.over_budget() {
            break;
        }
        w.entries += 1;

        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let child_path = entry.path();
        let mut inner: Vec<Entry> = Vec::new();

        let (sum, cache) = if ft.is_dir() {
            if w.skipped(&child_path) {
                continue;
            }
            let cache = is_cache_name(&name);
            (w.walk(&child_path, 1, cache, Some(&mut inner)), cache)
        } else {
            let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            (
                Sum {
                    bytes,
                    files: 1,
                    cache: 0,
                },
                false,
            )
        };

        total.add(sum);
        entries.push((Entry { name, bytes: sum.bytes, cache }, inner));
    }

    entries.sort_by_key(|(e, _)| Reverse(e.bytes));

    let drill = match entries.first() {
        Some((head, inner)) => {
            !inner.is_empty()
                && total.bytes > 0
                && head.bytes as f64 >= total.bytes as f64 * DRILL_RATIO
        }
        None => false,
    };

    let mut top: Vec<Entry> = if drill {
        let (head, inner) = entries.remove(0);
        let mut sub: Vec<Entry> = inner
            .into_iter()
            .map(|e| Entry {
                name: format!("{}/{}", head.name, e.name),
                bytes: e.bytes,
                // 위가 캐시 폴더면 그 아래는 전부 캐시다.
                cache: head.cache || e.cache,
            })
            .collect();
        // 한 겹 내려갔다고 나머지를 가리면 그것도 거짓말이다. 뒤에 그대로 붙인다.
        sub.extend(entries.into_iter().map(|(e, _)| e));
        sub
    } else {
        entries.into_iter().map(|(e, _)| e).collect()
    };

    top.sort_by_key(|e| Reverse(e.bytes));
    top.truncate(TOP_N);

    report.bytes = total.bytes;
    report.cache_bytes = total.cache;
    report.files = total.files;
    report.top = top;
    report
}

// ---------------------------------------------------------------- 내보내기

pub fn mb(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

/// stderr에 한 덩어리로 남긴다.
///
/// 창을 안 열어도, 파일을 안 열어도 크기를 알 수 있어야 한다.
/// GUI 서브시스템에서는 stdout 핸들이 안 붙으므로 stdout을 쓰면 안 된다.
pub fn log_report(rep: &AppDataReport, tag: &str) {
    eprintln!(
        "[eqmux][appdata] {tag} — 총 {:.2} MB (캐시 {:.2} MB · {:.0}%) · KR2 {:.0} MB의 {:.0}% · 파일 {}개 · {}ms{}{}",
        mb(rep.total_bytes),
        mb(rep.cache_bytes),
        rep.cache_ratio() * 100.0,
        mb(rep.limit_bytes),
        rep.total_bytes as f64 / rep.limit_bytes as f64 * 100.0,
        rep.files,
        rep.elapsed_ms,
        if rep.isolated { " · 격리" } else { "" },
        if rep.truncated { " · ⚠️ 상한에 걸려 잘림" } else { "" },
    );
    for r in &rep.roots {
        let top = r
            .top
            .iter()
            .map(|e| format!("{} {:.2}", e.name, mb(e.bytes)))
            .collect::<Vec<_>>()
            .join(" · ");
        eprintln!(
            "[eqmux][appdata]   {:<8} {:>8.2} MB  {}{}",
            r.label,
            mb(r.bytes),
            if r.exists { "" } else { "(없음) " },
            r.path.display()
        );
        if !top.is_empty() {
            eprintln!("[eqmux][appdata]            └ {top}");
        }
    }
}

/// 지난번보다 눈에 띄게 움직였을 때만 다시 찍는다.
///
/// 상태줄은 120초마다 갱신되는데 그때마다 stderr를 채우면 로그가 못 쓰게 된다.
pub fn log_if_grown(rep: &AppDataReport, watch: &AppDataWatch) {
    let mut last = match watch.0.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let changed = match *last {
        None => true,
        Some(prev) => rep.total_bytes.abs_diff(prev) >= LOG_DELTA_BYTES,
    };
    if !changed {
        return;
    }
    let tag = match *last {
        None => "상태줄".to_string(),
        Some(prev) => format!("증가 {:+.2} MB", mb(rep.total_bytes) - mb(prev)),
    };
    *last = Some(rep.total_bytes);
    drop(last);
    log_report(rep, &tag);
}

pub fn write_json(rep: &AppDataReport, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(rep)
        .unwrap_or_else(|e| format!("{{\"error\":\"직렬화 실패: {e}\"}}"));
    let mut f = std::fs::File::create(path)?;
    writeln!(f, "{json}")?;
    Ok(())
}

// ---------------------------------------------------------------- 무인 리포트

/// `--appdata-report` — 창을 열지 않고 크기만 재고 끝낸다.
///
/// # 왜 별도 플래그인가
///
/// `#7` ②는 도그푸딩 **시작·1주차·종료** 3회 측정을 관문 B 절차에 못 박았다(해원).
/// 그때 PowerShell로 따로 세면 **세는 규칙이 우리 것과 갈린다** —
/// `BASELINE.md` §6에서 "~0 MB vs 46.5 MB"로 어긋난 게 정확히 그 실수였다.
/// 같은 코드로 재고 같은 JSON을 남긴다.
#[derive(Debug, Clone)]
pub struct ReportRun {
    pub enabled: bool,
    pub out_path: Option<PathBuf>,
}

impl ReportRun {
    pub fn from_args() -> Self {
        let mut enabled = false;
        let mut out_path = None;

        for a in std::env::args() {
            if a == "--appdata-report" {
                enabled = true;
            } else if let Some(v) = a.strip_prefix("--appdata-report-out=") {
                enabled = true;
                out_path = Some(PathBuf::from(v));
            }
        }

        Self { enabled, out_path }
    }
}
