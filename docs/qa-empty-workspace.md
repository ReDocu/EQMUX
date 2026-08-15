# QA 버그리포트 — EQMUX

**1부**: 워크스페이스가 비었을 때의 충돌 상태 (4건, 수정 완료) · **2부**: 치명 버그 전수 점검 (2026-08-15 병렬 감사)

---

# 1부 — 워크스페이스가 비었을 때의 충돌 상태

- **작성일**: 2026-08-15
- **대상 버전**: v0.2.0 (main, de2e657) + 설치 후 데이터 초기화 패치
- **환경**: Windows 11 Pro, Tauri 빌드
- **요약**: 워크스페이스 레지스트리가 비어 있는 상태(설치 직후 / 마지막 워크스페이스 등록 해제 직후)에서 화면 상태·데이터 소스가 서로 어긋나는 충돌 4건. 크래시는 없고 전부 상태 정합성 문제.

---

## BUG-1 · 부팅 순간 목(mock) 시드 워크스페이스가 실물처럼 표시됨

**심각도**: 중 (첫인상 구간에서 가짜 데이터 노출) · **재현율**: 항상 (표시 시간은 수십 ms~수백 ms)

### 재현 절차
1. 앱데이터가 빈 상태(설치 직후 또는 `data.ver` wipe 직후)로 앱을 시작한다.
2. 첫 프레임을 관찰한다.

### 기대 결과
등록된 워크스페이스가 없으므로 처음부터 빈 관제 화면(또는 연결 화면)이 보인다.

### 실제 결과
`mock.ts`의 시드 데이터(Academy·EQMux·Atlas, 가짜 세션 12개 포함)가 앱 바 탭과 관제 대시보드에 그대로 렌더링됐다가, `refreshWorkspaces()`의 `ws_registry` 응답이 도착하면 일괄 사라진다. 깜빡임이자, 이 사이에 가짜 셀을 클릭하면 존재하지 않는 워크스페이스 뷰로 진입한다(→ BUG-2 상태로 연결됨).

### 원인
- `src/backend/mock.ts:148` — `WORKSPACES` 시드가 Tauri 여부와 무관하게 모듈 로드 시점에 채워진다.
- `src/App.tsx:36` — `onMount(() => void refreshWorkspaces())`가 비동기라서 hydrate 전 프레임은 목 데이터로 그려진다.
- `src/backend/workspaces.ts:56-59` — hydrate가 도착해야 목 목록이 실물(빈 배열)로 교체된다.

### 제안
Tauri 환경에서는 목 시드를 렌더링 전에 비우거나(`isTauri()`면 빈 배열로 시작), hydrate 완료 전까지 로딩 상태를 표시.

---

## BUG-2 · 마지막 워크스페이스 등록 해제 시 뷰가 유령 워크스페이스에 고착

**심각도**: 중 · **재현율**: 항상

### 재현 절차
1. 워크스페이스 1개(X)를 등록하고 탭을 연다 (`view = {kind:"workspace", id:X}`).
2. 워크스페이스 연결 화면으로 이동하지 않고… (X 탭이 활성인 상태 그대로) 다른 경로로 X를 등록 해제한다. 또는: 연결 화면에서 X를 해제한 뒤 뒤로 돌아온다.
3. 워크스페이스 목록이 비었다.

### 기대 결과
활성 탭이 사라지면 뷰가 관제 탭으로 전환되고 앱 바의 "관제" 탭이 활성 표시된다.

### 실제 결과
`view()`는 여전히 `{kind:"workspace", id:X}`. 본문은 Dashboard로 폴백 렌더링되지만 앱 바에서는 **어떤 탭도 활성으로 표시되지 않는다** — 화면은 관제인데 탭 상태는 존재하지 않는 워크스페이스를 가리키는 충돌 상태. 이 상태에서 레이아웃 동기화가 `lastWorkspace = X`(유령 id)를 layout.json에 계속 저장한다.

### 원인
- `src/App.tsx:114-119` — `ws`를 못 찾으면 `<Dashboard />`만 렌더링하고 `setView({kind:"control"})`를 하지 않는다.
- `src/backend/layout.ts:118` — `lastWorkspace`가 현재 view의 id를 그대로 저장 (유령 id 영속).

### 제안
`refreshWorkspaces()`(hydrate 직후) 또는 App의 폴백 분기에서, 현재 view의 워크스페이스가 목록에 없으면 `setView({kind:"control"})`로 정규화. 한 줄 수정으로 layout.json 오염도 함께 사라진다.

---

## BUG-3 · 등록 해제된 워크스페이스의 세션이 크래시 복구 목록에 계속 등장

**심각도**: 하~중 (혼란 유발, 데이터 잔존) · **재현율**: 조건부 (비정상 종료 후)

### 재현 절차
1. 워크스페이스 X에서 세션을 돌리다가 X를 등록 해제한다 → 목록이 빈다.
2. 앱을 강제 종료(작업 관리자)한다.
3. 재시작한다.

### 기대 결과
등록된 워크스페이스가 없으므로 복구할 것도 없다 — 대화상자가 뜨지 않거나, 등록된 워크스페이스의 세션만 보여준다.

### 실제 결과
"직전 실행이 정상 종료되지 않았습니다" 대화상자에 이미 해제된 워크스페이스 X의 세션들이 나열된다. UI 어디에도 X가 없는데 복구 목록에만 존재하는 충돌. exit 기록이 없는 세션 행은 DB에 남아 있는 한 이후의 모든 dirty 시작마다 재등장한다.

### 원인
- `src-tauri/src/lib.rs:1274-1279` — `ws_unregister`는 workspaces.json에서만 지우고 `workspaces/<id>/session.db`는 남긴다 (FR-E-09 의도).
- `src-tauri/src/recovery.rs:41-46` — `crash_scan`은 레지스트리를 보지 않고 `workspaces/` 디렉터리 전체를 스캔한다.

### 제안
`crash_scan`에서 `workspace::load()`의 등록 id 집합과 교집합만 반환 (DB 보존 정책은 유지).

---

## BUG-4 · 연결 화면에서 등록/해제할 때마다 restoreLayout이 재실행됨

**심각도**: 하 (경합 조건, 기본 설정에서는 드묾) · **재현율**: 조건부

### 재현 절차
1. 워크스페이스 A·B 탭을 열어둔다. B 탭을 닫는다.
2. 800ms(레이아웃 저장 디바운스) 안에 연결 화면에서 A를 등록 해제한다.

### 기대 결과
B는 닫힌 상태를 유지하고, 현재 화면(연결)은 그대로다.

### 실제 결과
`unregister → refreshWorkspaces() → restoreLayout()`이 부트스트랩용 복원을 통째로 다시 돌린다. 아직 디스크에 저장되지 않은 layout.json(스테일)을 읽어 닫았던 B 탭이 다시 열린다. `startView: "last"` 설정이면 `setView({kind:"workspace", ...})`까지 실행되어 연결 화면에서 다른 화면으로 강제 이동한다.

### 원인
- `src/backend/workspaces.ts:75-77` — `restoreLayout()`이 `refreshWorkspaces()` 본문에 있어 부트스트랩 전용이 아니라 매 호출마다 실행된다.
- `src/screens/WorkspaceConnection.tsx:102,111` — repath·unregister가 매번 `refreshWorkspaces()`를 부른다.

### 제안
`restoreLayout()`(+ `loadSettings`, `startLayoutSync`)을 1회 가드로 감싸거나 부트스트랩 경로로 분리. `syncStarted`와 같은 패턴이면 충분하다.

---

## 종합

| # | 제목 | 심각도 | 상태 |
|---|------|--------|------|
| BUG-1 | 부팅 시 목 시드 노출 | 중 | ✅ 수정 (mock.ts — Tauri면 시드 비움) |
| BUG-2 | 유령 워크스페이스 뷰 고착 | 중 | ✅ 수정 (workspaces.ts — hydrate 후 뷰 정규화) |
| BUG-3 | 해제된 워크스페이스가 크래시 복구에 등장 | 하~중 | ✅ 수정 (recovery.rs — 레지스트리 교집합 필터) |
| BUG-4 | restoreLayout 재실행 경합 | 하 | ✅ 수정 (layout.ts — 1회 가드) |

수정 검증: `npm run build`(tsc + vite) 통과, `cargo test` 27/27 통과 (크래시 스캔 테스트에 등록 해제 제외 케이스 추가).

네 건 모두 "워크스페이스 목록이 비거나 줄어든 순간, 다른 상태 소스(목 시드·view·크래시 스캔·layout.json)가 따라오지 않는" 같은 뿌리의 정합성 문제다. BUG-2 → BUG-1 → BUG-3 → BUG-4 순 수정을 권장.

---

# 2부 — 치명 버그 전수 점검 (2026-08-15)

러스트 백엔드 / 프런트 상태·수명주기 / 데이터 영속 3개 축으로 병렬 코드 감사를 돌리고, 상위 발견을 코드로 재검증했다. **C-# = 수정 완료**, **O-# = 미수정(관찰·후속)**.

## 수정 완료

### C-1 · pty_write가 전역 잠금을 쥔 채 블로킹 파이프 쓰기 — 전 세션 동결 + kill 불능
`lib.rs pty_write` — 동기 커맨드(메인 스레드)가 전역 PtyState Mutex를 쥔 채 `write_all`(ConPTY 입력 파이프). 한 세션의 stdin이 막히면(먹통 TUI·일시정지 프로세스 + 대량 붙여넣기) 모든 세션의 write/resize가 멈추고, **pty_kill도 같은 잠금을 기다려 복구 불능**.
**수정**: writer를 `Arc<Mutex<…>>`로 — 전역 잠금은 Arc 복제까지만, 블로킹 쓰기는 세션별 잠금 아래로.

### C-2 · app_exit이 잠금 안에서 ConPTY drop — 자체 B14 불변식 위반 데드락
`lib.rs app_exit` — pty_kill은 관측된 데드락(B14) 때문에 "잠금 안에서는 꺼내기만"으로 고쳐졌는데, 종료 시퀀스는 여전히 잠금 아래서 terminate·kill·drop을 전부 수행. ConPTY 닫기가 리더 드레인을 기다리는 동안 리더는 같은 잠금 대기 → 종료가 영영 멈추고 running.flag가 남아 다음 실행이 거짓 크래시 보고.
**수정**: drain을 Vec으로 꺼낸 뒤 잠금 밖에서 teardown. Ctrl+C 신호도 writer Arc 복제로 잠금 밖에서.

### C-3 · 종료 시 exit 기록 유실 → 정상 종료 세션이 크래시 세션으로 오인
`lib.rs app_exit` + `store.rs` — 리더의 마지막 SessionExit이 최종 flush ack 뒤에 도착하면 미기록. 또 kill·종료 시퀀스로 끝난 세션은 `exit_code NULL`로 남아 `crash_scan`(IS NULL 판정)이 다음 dirty 시작마다 크래시로 오인.
**수정**: 코드 미상 종료는 `-1` 센티널 기록(NULL = "기록 자체 없음 = 진짜 크래시"로 의미 분리) + teardown 후 200ms 유예 뒤 flush.

### C-4 · 전역 pty-output/exit listen이 spawnPty 경로에서만 등록 — 에이전트 전용·재부착 세션 빈 화면
`pty.ts ensureListeners` — `agent_spawn/resume/restart`와 웹뷰 재시작 재부착(revive)은 이 함수를 안 거쳐, 캐스팅만으로 시작한 실행·전 세션 revive에서 출력 이벤트를 아무도 수신하지 않았다 (입력은 나가는데 화면이 빈다).
**수정**: `ensurePtyListeners()` export + App 부트스트랩에서 항상 등록.

### C-5 · workspaces.json 손상 → 빈 목록 폴백 → 다음 save가 레지스트리 전체 영구 삭제
`workspace.rs load` + `ws_touch/register/unregister/repath` — 읽기·파싱 실패를 전부 빈 목록으로 삼키고, 변경 커맨드가 그 빈 목록을 원자적 쓰기로 원본에 덮었다.
**수정**: `load_strict`(파일이 있는데 못 읽으면 Err) 도입, 변경 4경로 전부 전환. `ws_touch`는 없는 id면 저장 자체를 생략.

### C-6 · 버전 wipe 실패 무시 후 data.ver 무조건 기록 — 반쯤 지워진 상태 영구화
`lib.rs setup` — remove_dir_all 실패(AV·열린 핸들, Windows에서 흔함)를 무시하고 새 버전을 찍어 재시도가 영영 없었다.
**수정**: 삭제 성공(또는 NotFound)일 때만 표식 갱신 — 실패 시 다음 실행에서 재시도.

### C-7 · store flush가 DB 열기/트랜잭션 실패 시 배치(≤200건) 무음 폐기
`store.rs flush` — drain 후 실패 시 `continue`로 스크롤백·세션 기록·재개 매핑이 흔적 없이 증발.
**수정**: 실패한 워크스페이스의 배치를 pending에 재큐잉해 다음 tick 재시도. (ponytail: 영구 장애 시 메모리 증가 — 재시도 상한이 필요해지면 그때)

### C-8 · 종료 시퀀스가 프런트 디바운스를 버림 — 마지막 0.5~0.8초의 team.json·레이아웃·미확인 유실
`shutdown.ts` — SQLite만 flush하고 team(500ms)·layout(800ms)·unseen(800ms) 타이머는 그대로 종료.
**수정**: 각 모듈에 `flush*Now()`(sync 시작 전 no-op 가드 포함) 추출, performShutdown 서두에서 호출.

### C-9 · 셸 exit 미반영 + 죽은 기본 터미널 "재개" 좀비
셸 종료(`exit` 입력)가 앱 상태에 반영되지 않아 종료 확인 다이얼로그가 죽은 세션 때문에 뜨고, 죽은 기본 터미널의 "재개"는 PTY 없이 상태만 busy로 만들었다.
**수정**: 전역 pty-exit 훅 → `backend.sessionExited()` — 셸만 dead 전이(에이전트는 agent-state가 권위, 재시작 중 거짓 dead 방지 가드) + `resumable=false`(셸에는 재개할 transcript가 없다).

### C-10 · 이중 쓰기 연결 SQLITE_BUSY — 출력 폭주 중 팀 메시지 발신 산발 실패
`store.rs open_db` — busy_timeout 없이 store 배치 커밋과 msg_send/IPC publish가 경합.
**수정**: open_db에 busy_timeout 500ms.

### C-11 · 구독·버퍼·커서 누수
TerminalPane이 pty 구독 해제 함수를 버려 disposed 터미널(스크롤백 5,000줄)이 클로저로 영구 잔류, killPty 후 늦은 출력이 buffers 항목 재생성, store 스레드 cursors가 세션 종료 후에도 잔류.
**수정**: TermEntry.unsubs 보관 → dispose 시 해제, 모르는 세션 출력은 버퍼링 생략, SessionExit에서 커서 제거.

## 후속분 — 전량 수정 완료 (2차 패스)

| # | 내용 | 수정 |
|---|------|------|
| O-1 | store 채널 unbounded — 쓰기 스레드 정체 시 힙 증가 | ✅ `sync_channel(50,000)` — 가득 차면 리더가 잠시 블록(백프레셔), 데이터는 안 버림 |
| O-2 | 비에이전트 세션 kill 시 `expected_exit` 영구 잔류 → 정당한 dead 알림 삼킴 | ✅ dead 이벤트가 안 나간 exit에서 표식 소비 (`on_pty_exit` else 분기) |
| O-3 | agent_restart 경합 — 구 PTY EOF가 새 Tracked보다 빠르면 거짓 "종료됨" 알림 | ✅ `kill_pty_for_restart`가 expected_exit 표시 — 어느 경로든 1회 소비 |
| O-4 | IPC 파이프: 개행 없는 연결마다 스레드+핸들 무한 누적 | ✅ 동시 연결 상한 32 — 초과 즉시 거부 (read 타임아웃은 필요 시) |
| O-5 | tmp→rename에 fsync 없음 — 전원 단절 시 0바이트 파일 | ✅ 공용 `atomic_write`(write→sync_all→rename)로 5개 지점(레지스트리·설정·레이아웃·team.json/md·파일 편집) 통일 |
| O-6 | 버전 wipe가 사용자 저작물까지 삭제 | ✅ settings.json·jobs/·personas/·presets/ 보존 — 세션 기록·레지스트리·레이아웃만 wipe |
| O-7 | 워크스페이스 등록 해제 시 PTY 고아 잔존 | ✅ `removeWorkspace`/`hydrateWorkspaces`가 제거 세션의 killPty 호출 |
| O-8 | restoreTeams 재실행 × team.json 디바운스 경합 — 지운 역할 세션 부활 | ✅ `refreshWorkspaces`가 restoreTeams 전에 `flushTeamNow()` — 스테일 파일 창 제거 |

## 검증
`npm run build`(tsc + vite) 통과 · `cargo test` 28/28 통과 (레지스트리 손상 차단·atomic_write 왕복 테스트 추가). C-1·C-2는 데드락 재현이 타이밍 의존적이라 코드 경로 검증(불변식 B14 준수 확인) 기준.

---

# 3부 — 심화 감사 (2026-08-15, 2차 병렬)

보안 경계 / 에이전트 런타임·메시지 버스 / 화면 로직·파일 파싱 3개 축을 추가로 감사하고 상위 발견을 코드로 검증했다. **D-# = 수정 완료**, **P-# = 미수정(설계·흐름 추적 필요)**.

## 수정 완료 (한글 사용자 상시 영향 우선)

### D-1 · 트랜스크립트 경로 이스케이프가 Claude Code 규칙과 불일치 → resumable 전면 오판
`agent.rs transcript_path` — `:\/` 3종만 `-`로 치환했으나, 실측 결과 CC는 **ASCII 영숫자만 남기고 나머지 전부**(`.`·`_`·공백·한글)를 `-`로 치환한다 (`C--Users-USER`, `D--ClaudeProject-EQMent`). cwd에 밑줄·점·공백·한글이 하나라도 있으면 `resumable()`이 항상 false → 실제로 `claude --resume` 되는 세션이 앱에서만 "재개 불가"로 거부됐다.
**수정**: `is_ascii_alphanumeric()` 외 전부 `-`. 회귀 테스트 추가.

### D-2 · git 한글 경로가 8진 이스케이프로 나와 diff/status 파싱 붕괴
`workspace.rs git()` — `core.quotepath` 기본값(on)에서 비ASCII 경로가 `"\355\225\234.md"`로 출력돼 status·numstat·diff_file 매칭이 전부 실패(한글 파일이 diff 화면에서 안 열림).
**수정**: 공용 `git()` 헬퍼에 `-c core.quotepath=off` — 모든 호출부 일괄 해결.

### D-3 · 트랜스크립트 2MB 창 경계가 한글 문자를 자르면 전체 파싱 실패
`transcript.rs read` — `read_to_string`이 창 경계의 잘린 멀티바이트에서 파일 전체를 Err로 버려 스크롤백 폴백. "깨진 줄만 건너뛴다"(FR-G-85) 계약 위반.
**수정**: `read_to_end` + `from_utf8_lossy` — 손상 바이트만 대체.

### D-4 · git 인자 주입 — `--end-of-options` 부재
`ws_checkout`·`worktree_create` — 크래프트된 ref 이름(`.git/refs/heads/--foo`)이 UI를 거쳐 돌아오면 git이 옵션으로 오인. **수정**: ref/base 앞에 `--end-of-options` (checkout에 `--`를 쓰면 pathspec이 되어 오작동하므로 구분).

### D-5 · fsx 심볼릭 링크로 .git 불가침 가드 우회
`fsx.rs resolve_existing` — `guard_git`이 canonicalize 이전 문자열만 검사해, `foo -> .git` 심링크로 `.git` 편집·삭제 가능. **수정**: 해석된 실제 경로로 `guard_git` 재검사.

### D-6 · diff 바이너리 오탐 — 본문의 "Binary files" 문자열에 반응
`diff.rs` — `out.contains("Binary files")`가 변경된 코드 줄(이 diff.rs 자신 등)에도 매칭. **수정**: `Binary files … differ` 헤더 줄만 판정.

### D-7 · diff untracked 읽기에 워크스페이스 탈출 가드 없음
`diff.rs file_diff` — fsx가 가진 canonicalize+starts_with 검사가 여기만 빠짐. **수정**: 동일 가드 추가.

### D-8 · PreToolUse가 waiting을 busy로 되돌리지 않음 (degraded 모드 고착)
`agent.rs apply_hook` — 승인 완료 후 도구 실행(PreToolUse)이 Activity만 바꿔, 레지스트리 없는 degraded 모드에선 "승인 대기"가 다음 Stop까지 고착. **수정**: Activity 수신 시 waiting이면 busy로 전이(피드·알림 경로).

### D-9 · 알림 off/음소거가 expected_exit 표식을 소비 안 함
`agent.rs maybe_notify` — off/음소거 early-return이 dead 표식 소비보다 앞서, 나중에 알림을 켜면 정당한 dead 알림 1건을 삼킴. **수정**: 표식 소비를 설정 라우팅보다 앞으로.

### D-10 · 임무 배정 브리프가 다른 워크스페이스 임무로 동작 + waiting 세션 다이얼로그 오염 + 유령 메시지
`missions.ts`·`MissionExplorerTab.tsx` — (a) `cycleMissionStatus`/`toggleAssign`이 워크스페이스 필터 없이 임무 id 매칭 → 동일 슬러그 충돌, (b) `sendBrief`가 waiting 세션에도 주입, (c) 탐색기 브리프가 `backend.sendMessage` 직접 호출로 Tauri에서 유령 메시지. **수정**: ws 필터 추가, waiting 가드, `sendConversation` 원장 경로로 전환.

### D-11 · 빈 결과를 버려 삭제분이 화면에 잔존
`library.ts`(마지막 직무 삭제)·`conversation.ts`(원장 읽기 실패) — 성공한 빈 목록을 버려 삭제된 항목·정상 상태가 화면에 남거나 대화가 사라짐. **수정**: undefined(호출 실패)만 건너뛰고 빈 목록은 반영(파일이 이긴다).

### D-12 · 워크스페이스/스코프 전환 stale-response
`GitDiffEditor`·`GitPanelTab`(10초 폴링)·`RoleLibrary` — 느린 저장소 A→B 전환 시 A의 늦은 응답이 B 화면을 덮음. **수정**: 요청 토큰(req 세대)으로 낡은 응답 폐기, GitDiffEditor는 파일 동일 시에도 diff 재로드.

## 미수정 — 설계·흐름 추적 필요 (P-#)

| # | 내용 | 왜 보류 |
|---|------|---------|
| P-1 | **IPC 세션 사칭** — EQMUX_SESSION이 추측 가능한 평문 id뿐이라, 같은 OS 사용자의 다른 에이전트가 임의 세션을 사칭해 메시지·상태·OS 알림 본문을 위조 | 세션별 논스 발급+대조로 근본 수정 필요(CLI 계약 변경). "같은 OS 사용자"는 수용 위협이나 에이전트 간 사칭은 실버그 — 별도 작업 |
| P-2 | **PTY `\r` 주입이 미제출 입력을 실행** — 기본 터미널에 `rm -rf build` 치던 중 메시지 주입되면 그대로 실행 | 셸은 입력 줄 상태를 알 수 없음. 셸 주입 자체를 막을지(기능 변경) 제품 결정 필요 |
| P-3 | 레지스트리 2초 재스캔이 더 신선한 훅 상태를 스테일 값으로 되돌림 → 가짜 idle이 M3 인박스 오주입 유발 | 소스 간 타임스탬프/우선순위 도입 필요. 성급한 수정은 상태 머신 회귀 위험 |
| P-4 | 스냅숏 vs 실시간 이벤트 순서 역전 가드 없음 (웹뷰 재시작마다 짧은 창) | P-3과 같은 버전/순서 표식으로 함께 처리 |
| P-5 | 재캐스팅 시 세션 id·status가 옛 값 유지 → 자동 배정 누락·shell 상태 고착 | id 변경이 살아있는 PTY를 고아로 만들 수 있어 casting→spawn 흐름 전체 추적 필요 |
| P-6 | 임무 파일명 ↔ frontmatter id 불일치(탐색기 rename 후) 시 상태·배정 무반응 | missions.rs를 id 일관 동작으로 재작업 또는 rename 차단 — 범위 큼 |
| P-7 | 역할 라이브러리 편집이 외부 변경을 mtime 검사 없이 덮어씀 | fsx처럼 expected_mtime 배선 필요 |
| P-8 | agent_spawn이 살아있는 PTY 위에 새 uuid로 Tracked 교체(이중 호출) → 재개 정보 파괴 | spawn 재부착 신호 전달 필요, 엣지 |
| P-9 | by_uuid·notify_gate 세션 제거 후 잔류(누수, 기능 영향 없음) · diff rename 표시 품질 | 경미 |

## 검증
`cargo test` 29/29 통과(transcript_path 이스케이프 회귀 테스트 추가) · `npm run build` 통과.
