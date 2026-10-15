# 최적화 후보 목록 (2026-10-14)

최종 반영: [update-plan-0.5.0.md](../update-plan-0.5.0.md) §개선 트랙 · §0.6 이후로 미루는 것 — 다르게 정한 것은 맨 아래 §최종본 반영 결과에 있다.

4개 세션이 영역을 나눠 코드를 읽고 찾은 최적화 후보. **조사만 했고 코드는 고치지 않았다.**
모든 항목은 코드로 확인한 것만 적었다 (추측 제외). 영향: 높 / 중 / 낮.

| 영역 | 담당 |
|---|---|
| A. Rust 코어 (lib.rs · agent.rs · agentscan.rs · job.rs · ipc.rs · cli.rs) | eqmux-7b |
| B. Rust 저장/파일/기타 모듈 + Cargo.toml | eqmux-d3 |
| C. 프런트 렌더링 · 컴포넌트 · CSS · state.ts | eqmux-42 |
| D. TS backend/* 계층 · 나머지 screens · 번들/빌드 | eqmux-8b |

총 48건 (A 12 · B 15 · C 11 · D 10). 영역별 원문은 아래, 먼저 손댈 것은 바로 다음 표.

## 우선순위 (영역 교차 · 효과 ÷ 수고 순)

| # | 무엇 | 왜 | 수고 | 근거 |
|---|---|---|---|---|
| 1 | **동기 커맨드를 async로** — `pty_write`, `agent_clis`, SQLite/파일 읽기 7종, `pty_spawn`·agent spawn·restart, `msg_*` | 메인 스레드 블록 = 앱 전체 정지. 대부분 `#[tauri::command(async)]` 한 단어 | 작음 | A1·A2·A8·A9, B1 |
| 2 | **TranscriptPane 재읽기** — 아무 세션 방송마다 2MB 읽기·파싱·전송·전체 재렌더 | 트랜스크립트 창이 열려 있으면 바쁜 팀에서 초당 1회 | 중간 | D1, B3, A8 |
| 3 | **`open_db`를 메시지 호출마다** — 보존 DELETE·trim·FTS 시드를 매번 | 메시지 송수신마다 풀스캔, 메인 스레드 | 작음 | B1, B4 |
| 4 | **FTS DELETE 전체 스캔** — `UNINDEXED` 컬럼 조건 삭제 | 적재 경로에서 세션×200줄마다 | 중간 | B2 |
| 5 | **같은 화면 `setView` → ControlCenter 통째 리마운트** | 탭 재클릭·같은 워크스페이스 점프마다 전 터미널 재부착·폴링 재시작·줌 소실 | 한 줄 | C1 |
| 6 | **PTY 리더 루프의 `setting_bool`** — 8KB마다 전역 뮤텍스 | 가장 뜨거운 루프 | 작음 | A7 |
| 7 | **`prepare_cached`** — 줄마다 SQL prepare 2회 | 초당 수천 회 | 한 줄 | B6 |
| 8 | **전역 `broadcast`/`tick` 팬아웃** — 메모리 샘플 하나에도 팀 저장 판정·이벤트 재조회·로그 200행 재생성 | 모든 비용의 증폭기 | 큼 | D2·D3·D5, C4·C9·C10 |
| 9 | **폴링 정리** — 숨김 중 정지, git 중복 호출 공유, agentprobe+memory 통합, 잠금 밖 Job 조회 | 상시 백그라운드 비용, 잠금 경합 | 중간 | D7, C5·C6, B7·B8, A3·A4·A6 |
| 10 | **메모리 상한** — 언마운트 터미널 scrollback 5000, 놓지 않는 WebGL 12개, event 테이블·`EVENTS` 배열 무한 증가 | 오래 켜 둘수록 커짐 | 중간 | C2·C3, B5, D8 |
| 11 | **릴리스 프로필** — `lto`·`codegen-units=1`·`strip` | 14.7MB exe, 런타임 성능 | 한 줄 | B11 |
| 12 | **번들 1.0MB 메인 청크** — 화면 `lazy()` | 콜드 스타트 파싱 | 작음 | D6 |

보안 겸 확인 필요: A11 — `emit`이 외부 URL 자식 웹뷰까지 닿는다면 터미널 출력이 외부 페이지로 샌다. `emit_to("main", …)`로 바꾸면 확인 없이도 닫힌다.

CSS는 최적화 대상 아님 (C 확인: backdrop-filter·blur 0건, 애니메이션 2개, 미사용 클래스 2개).

---

## D. TS backend 계층 · screens · 번들 (eqmux-8b)

- **D1 [높]** `src/screens/TranscriptPane.tsx:36` — `backend.subscribe`에 매달려 **아무 세션의** 상태 방송마다(1초 디바운스) `transcript_read`를 다시 부른다. Rust는 JSONL 끝 2MB(`transcript.rs:12`)를 읽고 파싱해 IPC로 통째로 보내고, `setData`가 새 객체로 갈아 끼워 턴 목록이 전부 다시 그려진다. 에이전트 4명이 바쁘면 거의 초당 1회 — 제안: 이 세션의 `agent-state`/턴 종료 때만 다시 읽고, 바이트 오프셋 이후 증분만 받기.
- **D2 [높]** `src/backend/mock.ts:514` `broadcast()` — 전역 단일 방송. 훅 이벤트 1건(도구명 `activity` 변경 포함, `mock.ts:953`)마다 `state.ts:198` tick → tick을 읽는 모든 화면 재계산 + `team.ts` · `flags.ts` · `layout.ts` 디바운스 flush + `watch.ts` `syncWatchers` + Dashboard/SessionDetail/Transcript 재조회가 한꺼번에 돈다. `SESSIONS`는 이미 `createMutable`(세밀한 반응성)인데 tick이 그걸 무력화한다 — 제안: 방송에 종류(세션 상태 / 워크스페이스 / 라이브러리)를 실어 구독자가 필요한 것만 받기, 화면은 tick 대신 스토어 필드를 직접 읽기.
- **D3 [중]** `src/backend/team.ts:76` `flushTeamNow` — 방송마다(500ms 디바운스) 모든 워크스페이스 × 모든 세션의 `buildRolePayload` + `JSON.stringify` 두 번으로 "바뀌었나"를 판정한다. 바쁜 세션의 activity 갱신만으로도 계속 돈다 — 제안: 편성 관련 필드(personaId/jobId/관계)가 바뀔 때만 dirty 표시.
- **D4 [중]** `src-tauri/src/lib.rs:1741` + `src/backend/watch.ts:42` — **자기 쓰기 되먹임.** 앱이 `.eqmux/team.json`·`team.md`를 저장하면 자기 watcher가 `eqmux-file-change`를 쏘고, 프런트는 `refreshMissions` + `refreshLibrary`(전역 라이브러리 전체 재로드) + `ws_watch` 재등록(watcher drop 후 재생성)을 한다. `.tmp`·`roles/`·`worktrees/`만 거르고 `team.json`/`team.md`는 안 거른다 — 제안: 앱 자신이 쓰는 파일도 무시 목록에 넣고, watcher 재등록은 디렉터리 생성 이벤트일 때만.
- **D5 [중]** `src/screens/Dashboard.tsx:45`, `src/screens/SessionDetailPanel.tsx:36` — 방송마다(500ms) `queryGlobalEvents(60)` / `queryEvents(…,8)` SQLite 재조회. 메모리 샘플·에이전트 프로브 방송에도 반응한다 — 제안: `events_log`를 쓴 시점(로그 이벤트)에만 재조회.
- **D6 [중]** 번들 — 메인 청크 `index-*.js` **1.0MB**(minified)에 xterm + WebGL addon + unicode-graphemes + `@lezer/markdown`(markdownHtml) + 모든 화면이 정적으로 들어 있다 (`src/App.tsx:38-51` 전부 정적 import). 콜드 스타트 파싱 비용 — 제안: Settings·RoleLibrary·GitDiffEditor·TeamCasting·Missions 등 첫 화면이 아닌 화면을 `lazy()`로, markdownHtml도 MdView 열 때 로드. (빌드 경고도 있음: "Some chunks are larger than 500 kB")
- **D7 [중]** 폴러 5종이 창이 최소화·숨김이어도 그대로 돈다: `agentprobe.ts:24`(5초, Job 트리 스캔), `memory.ts:29`(10초), `ports.ts`(20초, **netstat 프로세스 spawn**), `diag.ts:191`(30초), `mock.ts:1244`(30초 전역 방송 → 위 연쇄 전부 유발). `document.hidden` 체크는 diag 재개 경로 하나뿐 — 제안: 숨김 동안 정지/감속, 또한 agentprobe와 memory는 같은 Job 목록을 도니 IPC 1회로 합치기.
- **D8 [낮]** `src/backend/mock.ts:523` `logEvent` — `EVENTS.unshift`로 앱 수명 내내 무한 증가 (Tauri 모드에서 읽는 곳은 ControlCenter `slice(0,4)` 하나, 실피드는 DB에서 읽음). `createMutable` 배열의 unshift라 매번 O(n) + 프록시 알림 — 제안: Tauri 모드에선 상한(예: 50) 두거나 쌓지 않기.
- **D9 [낮]** `src/backend/pty.ts:29` — PTY 출력이 전역 `listen("pty-output")` 이벤트(JSON 직렬화)로 온다. Tauri 2는 고빈도 스트림용으로 `Channel`을 권장 — 제안: 세션별 Channel 전환 검토 (Rust 쪽 배칭 여부는 A 영역 결과 참조).
- **D10 [낮]** `src/backend/mock.ts` 1,517줄 — 목 시드(세션·미션·diff·로그·포트 데모 데이터)가 프로덕션 번들에 그대로 들어가고 Tauri에서는 시작 시 비운다(`mock.ts:503`) — 제안: 목 데이터를 `import.meta.env.DEV` 분기나 별도 모듈로 빼서 트리 셰이킹.

---

## A. Rust 코어 (eqmux-7b)

전제: Tauri 2는 async가 아닌 `#[tauri::command]`를 **메인 스레드**에서 실행한다 (코드도 같은 전제 — `lib.rs:489-491`). 동기 커맨드 안의 블로킹 I/O = 앱 전체 정지.

- **A1 [높]** `lib.rs:466` `pty_write` — 동기 커맨드라 메인 스레드에서 `write_all`+`flush`. ConPTY 입력 파이프가 차면 블록 → UI가 굳고 안 풀린다. `pty_resize`를 async로 뺀 것과 같은 위험인데 write만 남았다 — async + `spawn_blocking`, 또는 세션별 writer 스레드 + 채널.
- **A2 [높]** `lib.rs:1949` `agent_clis` → `agentscan.rs:150-170` `on_path` — 메인 스레드에서 `where.exe`를 KNOWN 10개만큼 차례로 spawn (호출마다 프로세스 10개, 수백 ms 정지) — 최소 `#[tauri::command(async)]`, 더 나은 안은 PATH×PATHEXT를 프로세스 안에서 한 번 훑기(spawn 0회).
- **A3 [중]** `lib.rs:1905` `sessions_memory` — 메인 스레드에서 10초마다(`memory.ts:29`). 전역 PtyState 잠금을 쥔 채 세션마다 `QueryInformationJobObject` 2회 + pid마다 `OpenProcess`·`K32GetProcessMemoryInfo`. B14 규칙(잠금 안 시스템 호출 금지) 위반, 그동안 모든 세션의 write·resize·kill 대기 — 잠금 안에서는 Job 핸들(Arc)만 복사, 나머지는 async로 잠금 밖.
- **A4 [중]** `lib.rs:1928` `sessions_agents` — 메인 스레드에서 5초마다(`agentprobe.ts:24`). pid마다 `OpenProcess`+`QueryFullProcessImageName`, node·python이면 `ReadProcessMemory`로 PEB 명령줄까지. `j.pids()`도 잠금 안 — async + pid→판정 캐시(pid 집합이 같으면 재검사 안 함).
- **A5 [중]** `agent.rs:1038-1041`, `1064-1084` 레지스트리 scan — 2초 타임아웃·notify 이벤트마다 `~/.claude/sessions/*.json` 전부 `read_to_string`+serde 파싱, 파일마다 `fs::metadata` 추가 호출. 이 파일들은 프로세스가 죽어도 안 지워져(1060 주석) 계속 늘어난다(이 PC에 지금 34개). 셸 세션만 있어도 돈다(1165) — (path, mtime) 캐시로 바뀐 파일만 재읽기, `entry.metadata()` 재사용, notify가 살아 있으면 폴링 주기 늘리기.
- **A6 [중]** `lib.rs:1213-1220` `session_job_pids` — scan이 2초마다 호출. 전역 잠금 안에서 세션마다 `QueryInformationJobObject` + `Vec`(128칸) 할당. `1931`·`1958`(sessions_agents·ports_snapshot)도 같은 패턴 — 잠금 안에서는 `Arc<Job>`만 복사, `pids()`는 밖에서, 세 곳 공통 헬퍼.
- **A7 [중]** `lib.rs:345` `setting_bool(&app, "sgrStore")` — **PTY 리더 루프 안에서 8KB 읽기마다** 호출, 모든 세션이 전역 SettingsState 뮤텍스를 잡는다 (확인함) — 스폰 때 한 번 읽거나 `settings_save`가 갱신하는 `AtomicBool`.
- **A8 [중]** 메인 스레드의 동기 SQLite·파일 커맨드 — `scrollback_tail` 589, `events_query` 644, `msg_list` 706, `scrollback_search` 792, `scrollback_page` 804, `store_usage_real` 880, `transcript_read` 1280. 매 호출 `Connection::open` 새로. `store_usage_real`은 scrollback 전체 `COUNT(*)` 풀스캔, `transcript_read`는 최대 2MB 읽기·파싱 (→ D의 TranscriptPane 1초 재로드와 겹쳐 최악) — 각 커맨드에 `#[tauri::command(async)]` 한 단어만 붙여도 메인 스레드에서 빠짐, 읽기 전용 연결 재사용은 그다음.
- **A9 [중]** `lib.rs:407` `pty_spawn`, `1162` agent spawn, `1382` `agent_restart` — 동기 커맨드. ConPTY 생성·프로세스 spawn·Job 할당을 메인 스레드에서. 복원 시 세션 여러 개면 직렬로 UI 정지 — async + `spawn_blocking`.
- **A10 [낮]** `lib.rs:336-338` 세션 로그 — 버퍼 없는 `File`에 8KB 읽기마다 `write_all`(읽기 1회당 syscall 1회). 리더가 느려지면 ConPTY 드레인이 늦어져 resize 블록 창이 넓어진다(489 주석의 원인 목록) — `BufWriter` + EOF·주기 flush.
- **A11 [낮/확인 필요]** `lib.rs:315` `emit("pty-output")`, `737`·`ipc.rs:237` `message-new`, `agent.rs:391` `agent-state` — 전 웹뷰 방송. `browser.rs:39-49`가 외부 URL 자식 웹뷰를 붙이므로, Tauri가 그 웹뷰에도 eval로 보낸다면 낭비 + **터미널 출력이 외부 페이지로 샐 수 있음(보안)**. Tauri 내부 동작은 미확인 — 확인과 무관하게 `emit_to("main", …)`로 바꾸면 비용 0 (`browser.rs:45`·`2329`는 이미 emit_to). D의 Channel 전환 항목과 함께 검토.
- **A12 [낮]** `lib.rs:2109` `tokio_sleep` — `spawn_blocking` 안 `thread::sleep`으로 blocking 풀 스레드 점유(종료 경로 500ms+200ms) — `tokio::time::sleep`.

제외(문제 아님): `ipc.rs` 연결당 스레드·`read_line` 무기한 대기는 `MAX_CONNS` 상한으로 막혀 있음. msg rate 맵은 키가 세션 수로 묶여 있음.

## B. Rust 저장/파일/기타 모듈 (eqmux-d3)

- **B1 [높]** `messages.rs:63,93,150,189` — `msg_send`·`msg_list`·`msg_mark_read`·export가 호출마다 `store::open_db`를 부른다. `open_db`는 스키마 배치, ALTER 3회, FTS 시드 확인, 30일 보존 DELETE 2회(`store.rs:159-160`, ts 인덱스 없음), `trim_to_cap`(GROUP BY + 세션별 DELETE 2회)을 **매번** 돈다. `open_db` 주석은 "백그라운드 스레드라 UI를 막지 않는다"인데 이 커맨드들은 sync라 메인 스레드다(`lib.rs:706,718,745`). store 쓰기 스레드와 겹치면 `busy_timeout` 500ms까지 UI 정지 — 보존·trim·시드는 쓰기 스레드의 첫 open에서만, messages는 가벼운 open(WAL·busy_timeout만) + async/`spawn_blocking`.
- **B2 [높]** `store.rs:188-191`, `397-400` — `scrollback_fts`를 `session_id`·`seq` 조건으로 DELETE. FTS5에서 둘 다 `UNINDEXED`(`store.rs:139`)라 매번 **FTS 전체 스캔**. 적재 경로에서 세션마다 200줄마다 실행(세션 8개 = 1,600줄마다 전체 스캔 8번) — FTS를 external content(`content=scrollback`)로 바꾸거나 fts rowid를 scrollback rowid와 맞춰 `WHERE rowid IN (SELECT rowid FROM scrollback …)`로 삭제.
- **B3 [높]** `transcript.rs:302-334` (+`lib.rs:1278` sync) — D의 TranscriptPane 항목의 Rust 쪽. 매번 2MB 꼬리를 통째로 읽고 모든 줄 JSON 파싱 + `to_string_pretty`, 메인 스레드에서 — `(path, len, mtime)`이 같으면 캐시 반환, 늘었으면 추가분만 파싱, `spawn_blocking`.
- **B4 [중]** `store.rs:159-160` — 보존 DELETE `WHERE ts < ?`. `scrollback.ts` 인덱스 없음 → 전체 스캔(FTS도). 위 첫 항목 때문에 메시지 호출마다 실행 — 세션당 1,000줄 상한이 이미 있으니 보존 정리는 하루 1회 또는 쓰기 스레드 시작 때만.
- **B5 [중]** `store.rs:361`, 스키마 `66-94` — `event`·`message`·`notification` 테이블은 삭제 경로 0건, `CREATE INDEX` 0건. 상태 전이마다 event가 쌓여 무한 증가 — event 30일 보존 + `(session_id, id)` 인덱스. (D의 Dashboard/SessionDetail 방송마다 재조회와 겹친다)
- **B6 [중]** `store.rs:349-357` — PTY 줄마다 `tx.execute(SQL 문자열)` 2회 → 매번 prepare. 출력 많으면 초당 수천 회 — `tx.prepare_cached` (줄 교체 수준).
- **B7 [중]** `workspace.rs:120-156` `git_within` — git 호출 1회 = 프로세스 1 + drain 스레드 2 + 20ms 폴링. git 패널이 10초마다 overview(4~5회) + branch_list(3회) + worktree_list(1회) ≈ 9회 spawn(`GitPanelTab.tsx:70`), `ControlCenter.tsx:243`도 10초마다 worktree_list — branch_list는 브랜치 메뉴 열 때만, 패널이 안 보이면 폴링 정지, stdout은 현재 스레드에서 읽고 stderr만 스레드로.
- **B8 [중]** `workspace.rs:419`, `diff.rs:65`, `diff.rs:223` — 가장 비싼 `git status --porcelain -uall`이 overview·changed_files·file_diff에서 각각 따로 돈다. file_diff는 rename 원래 경로 하나 찾으려고 status 전체를 다시 — 프런트가 이미 가진 `renamedFrom`을 인자로.
- **B9 [중]** `diff.rs:104-107` — untracked 파일마다 `read_to_string` 전체 읽어 줄 수 세기. `-uall`이라 새 폴더 안 모든 파일 대상, 큰 생성물이 목록 열 때마다 메모리에 통째로 — 크기 상한(예 1MB) 넘으면 "+?", 또는 `BufReader`로 `\n`만 세기.
- **B10 [중]** `fsx.rs:105` preview — `fs::read`로 전체를 읽고 64KB만 사용. 수백 MB 로그 미리보기 = 전체 읽기 — `File::open(..).take(PREVIEW_BYTES+1).read_to_end`.
- **B11 [중]** `Cargo.toml` — `[profile.release]` 없음 (lto 꺼짐, codegen-units 16, strip 없음). `eqmux.exe` 14.7MB(09-21 빌드), Cargo.lock 크레이트 549개 — `lto = true, codegen-units = 1, strip = true`. `panic = "abort"`는 크래시 생존 경로 확인 뒤 결정.
- **B12 [낮]** `fsx.rs:45-47,57-61` walk — 엔트리마다 `p.is_dir()`로 stat 추가(Windows에선 `DirEntry::file_type()`이 공짜), 정렬 비교마다 `to_lowercase` 할당 — `e.file_type()` + `sort_by_cached_key`.
- **B13 [낮]** `workspace.rs:354-363` inspect — 등록 워크스페이스마다 git 2회(branch·remote) 직렬. `.eqmux` 워처 감지 때마다 `ws_registry`가 재호출(`lib.rs:1770` 주석) — `.git/HEAD` 직접 읽기 또는 mtime 캐시. (D의 자기 쓰기 되먹임 항목과 같은 경로)
- **B14 [낮]** `store.rs:617-631,714-720` LineAssembler — 문자마다 `StyledChunk::Ch(char)`를 Vec에(문자당 ~32B), SGR 없는 줄도 채움, 백스페이스는 `rposition`+`remove`로 O(n) — styled를 `String`으로 쌓고 첫 SGR부터만 채우기.
- **B15 [낮]** atomic_write 중복 4곳: `workspace.rs:66`, `missions.rs:177`, `roles.rs:99`, `library.rs:438`. workspace만 fsync, `roles.rs:124`는 tmp 없이 바로 `fs::write` — `workspace::atomic_write` 하나로. (성능보다 일관성)

## C. 프런트 렌더링 · 컴포넌트 · CSS (eqmux-42)

- **C1 [높]** `src/state.ts:56-64` · `App.tsx:188-193` — `setView`가 매번 새 객체를 넣어 같은 워크스페이스로 다시 가도 `Match` 안 IIFE가 다시 돈다 (확인함). 앱 바 활성 탭 재클릭(`AppBar.tsx:76`), 같은 워크스페이스 안 `jumpToSession`/`focusSession`(`state.ts:209`) — ControlCenter 통째 리마운트 → 전 TerminalPane 재부착 + 전체 refresh, 폴링·git 호출 재시작, 줌 등 지역 상태 소실 — `setView`에서 kind·id가 같으면 건너뛰기 (한 줄).
- **C2 [높]** `TerminalPane.tsx:552` — `scrollback: 5000` 고정. REGISTRY 터미널은 세션 수명 동안 살아 있어 닫힌 워크스페이스·숨은 페인도 전부 5000줄을 쥔다 (FR-C-10 미구현). 메모리 ≈ 세션 수 × 5000 × cols — 언마운트 때 scrollback 축소(예: 1000), 마운트 때 복원. 넘친 기록은 디스크 칩(FR-C-13)이 이미 담당.
- **C3 [중]** `TerminalPane.tsx:877-880,938` · `webglBudget.ts:19` — 언마운트해도 WebGL 컨텍스트를 놓지 않는다(의도: 리마운트 히치 회피). 다른 attach가 요구할 때까지 최대 12개 컨텍스트 + 글리프 아틀라스가 GPU 메모리 점유 — 언마운트 후 30초 넘게 안 돌아오면 `dropWebgl` 타이머.
- **C4 [중]** `LogsPanelTab.tsx:79-84,226` — 방송마다(500ms) 이벤트 200건 재조회 → 새 객체 매핑 → `For`가 200행 DOM을 전부 버리고 재생성 — id 기준 reconcile(`createStore`+`reconcile`) 또는 최신 id가 같으면 set 생략.
- **C5 [중]** `GitPanelTab.tsx:68-70` · `ControlCenter.tsx:240-244` — git 패널이 열려 있으면 같은 저장소의 branchList+worktreeList를 두 곳이 각각 10초마다 호출(git 프로세스 중복). `GitPanelTab.tsx:61`은 두 호출을 순차 await — 로더·주기 하나로 공유 + `Promise.all`. (B7과 같은 문제의 프런트 쪽)
- **C6 [중]** `ControlCenter.tsx:153,243` · `GitPanelTab.tsx:70` — `setInterval` 3개가 창 최소화·숨김 중에도 돈다 — 틱 시작에 `document.hidden`이면 건너뛰기. (D7과 같은 처방)
- **C7 [중]** `BrowserPanelTab.tsx:175-178` — 브라우저 탭이 떠 있는 동안 `document.body` 전체 subtree childList를 MutationObserver로 감시. DOM 렌더러 터미널·리스트 갱신이 계속 레코드를 만들고 프레임마다 `querySelector` — 덮개 판정을 `overlay()` 신호(`state.ts:24`)와 전체 화면 탐색기 상태로 바꾸거나 오버레이 루트만 관찰.
- **C8 [낮]** `BrowserPanelTab.tsx:116` — ResizeObserver가 `syncBounds`를 바로 불러 분할선·패널 드래그 중 프레임마다 IPC(`browserBounds`) + 진단 기록. window resize는 이미 `syncSoon`(rAF) — RO도 `syncSoon`으로.
- **C9 [낮]** `ConversationTab.tsx:61-102` — messages/visible/shown이 메모가 아닌 함수. tick마다 전체 원장(모든 워크스페이스)을 여러 번 다시 거르고, 행마다 `listSessions().find`/`listPersonas().find` — `messages`·`visible`을 `createMemo`로, 이름은 Map 메모로.
- **C10 [낮]** `state.ts:197-198` — 전역 tick 하나. 어떤 방송이든 모든 tick 구독자가 재계산 — 측정 후 필요하면 도메인별 tick(세션/메시지/이벤트)으로. (D2와 같은 뿌리)
- **C11 [낮]** `TerminalPane.tsx:799-802,1054` — 디스크 스크롤백 오버레이가 "더 이전 200줄"마다 배열을 키우고 `For`로 전부 그린다(가상화·상한 없음) — 상한(예: 2000줄) 또는 가상 스크롤.

문제 없음으로 확인: 숨은 사이드 패널 탭은 `Show`로 언마운트(`SidePanel.tsx:60-80`). ControlCenter는 활성 워크스페이스 하나만 마운트. TerminalPane 리스너·RO·타이머 정리는 `onCleanup`에 다 있고 pty 구독도 dispose 때 해제. 세션 객체를 제자리에서 바꿔 `For`가 페인을 재생성하지 않음. CSS: backdrop-filter·blur 0건, 애니메이션 2개(0.16s 슬라이드, DefaultTerminalSetup 깜빡임), 그림자는 팝업에만 정적. 미사용 클래스는 맨 앞 셀렉터 341개 중 `gde-range`·`pane-close` 2개뿐(`st-*`는 동적).

## 최종본 반영 결과 (2026-10-15)

48건 가운데 41건이 0.5에 들어갔다. 우선순위 1·3(A1·A2·A9·B1·B4)은 P0, 2·4~7과 A11·D4는 P1, 9~12와 나머지 중·낮 항목은 P2다. 이 문서와 다른 것만 적는다.

| 항목 | 이 문서 | 최종본 |
|---|---|---|
| 우선순위 8 전역 방송 팬아웃 (D2·D3·D5·C4·C9·C10) | 한 묶음, 8순위 | 쪼갰다. 구조 변경인 D2·C10은 0.6 "전역 방송 구독 분리", D3·D5·C4·C9는 P2 "방송마다 재조회 줄이기" |
| B12~B15, C11, D9, D10 | 낮 | 넣지 않는다. 효과가 작다 |
