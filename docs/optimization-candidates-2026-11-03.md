# 최적화 후보 점검 — 0.6.0 기준 (2026-11-03)

10/17 점검 3건(`cpu-optimization-2026-10-17.md`·`cpu-ram-followup-2026-10-17.md`·`cpu-ram-risks-2026-10-17.md`)의 후속이다.

- **범위:** 그 뒤에 들어온 0.6 코드다. Git 화면, 확장·환경 패널, 임무, 팀, Rust 커맨드가 여기에 들어간다. 이미 고친 항목은 다시 적지 않았다.
- **방법:** 앱을 실행해서 재지는 않고 코드만 읽었다.
- **표시:** ✔는 이 세션에서 코드를 직접 다시 열어 확인한 항목이다. 나머지는 조사 에이전트 3개가 읽고 보고한 것이고, 규모가 추정인 항목은 "추정"이라고 적었다.

## 요약

- **가장 큰 것은 확장 패널의 tick 연동 재조회다(F1·F2).** 플러그인 탭을 열어 두면 에이전트가 무언가 할 때마다 `claude plugin list` 프로세스가 새로 뜬다. 고치는 데는 한 줄씩이면 된다.
- **Git 화면은 폴링과 쓰기 경로가 비싸다(G1~G3).**
  - 10초 폴링이 같은 결과여도 목록 DOM을 전부 다시 만든다.
  - `+`(add)를 한 번 눌러도 git이 약 16번 돈다.
- **Rust에서는 동기 커맨드가 메인 스레드를 막는다(R1~R3).** Tauri 2에서 `async`가 아닌 커맨드는 메인 스레드에서 돈다. `mission_list`는 끝나지 않은 임무마다 `git rev-list`를 띄우므로, 임무가 5개면 화면이 약 0.3초 굳는다.
  - 고치는 법은 `#[tauri::command(async)]` 한 줄씩이다.
  - 다만 `rfd` 대화상자를 여는 커맨드 4개(`ws_pick_folder`·`library_portrait_pick`·`msg_export`·`scrollback_export`)는 일부러 동기로 둔 것이니 그대로 둔다.

## 1. 먼저 할 것 — 작고 효과가 큼

| # | 무엇 | 위치 | 왜 비싼가 | 처방 | 수고 |
|---|---|---|---|---|---|
| F1 ✔ | **플러그인 탭이 tick마다 CLI를 띄운다** | `src/components/ExtensionsPanelTab.tsx:141-142`, `src/state.ts:189` | `cwd()` → `scopeWorkspace()`가 `tick()`을 읽는다. 리소스의 기준값이 매번 새 객체(`{cwd, scope, missing}`)라서 Solid가 매번 다시 불러온다. 그때마다 `claude plugin list --json`(Node CLI)이 뜬다(`extensions.rs:157`). 목록도 "읽는 중…"으로 깜빡인다 | `const cwd = createMemo(() => pluginScope() === "all" ? undefined : scopeWorkspace()?.path)` | 한 줄 |
| F2 ✔ | **스킬 탭이 tick마다 스킬 폴더를 훑는다** | `ExtensionsPanelTab.tsx:345` | F1과 같은 패턴이다. `{ ws: ws()?.path, plugins }`가 tick마다 새로 만들어져서 `skills_list`가 다시 돈다 | `wsPath = createMemo(() => scopeWorkspace()?.path)`를 두고 기준값에서 이것을 읽는다. 재발을 막으려면 `state.ts`에 `scopeWorkspacePath` 메모를 하나 두고 리소스 기준값은 그것만 읽게 한다 | 한 줄 |
| G1 ✔ | **Git 화면 10초 폴링이 같은 결과여도 다시 그린다** | `src/screens/GitScreen.tsx:278-286` | `setRefs`·`setWork`에 `equals`가 없다. 그래서 로컬·원격·태그·stash 목록과 스테이지 목록 행이 모두 다시 만들어진다. `on(work)` 때문에 덩어리 diff도 다시 읽는다. `-uall`이라 추적 안 된 파일이 많으면 행이 수천 개가 된다 | GitPanelTab C5처럼 `equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)` | 두 줄 |
| G2 ✔ | **쓰기 한 번에 전체를 다시 읽는다** | `GitScreen.tsx:358` `run()` → `reloadAll()`, `:375` `guarded()`의 `loadSide()` | 성공할 때마다 refs·status(git 7번), log 300개, `git_commit_sessions`, 그래프 300행 DOM을 다시 만든다. `guarded`는 그 뒤 `loadSide`를 한 번 더 한다. 묶음 실행은 묶음마다 이것을 반복한다 | add·restore·rm은 `loadSide`만 부른다. `guarded`의 중복 `loadSide`를 지운다. 묶음 실행은 끝에 한 번만 다시 읽는다 | 작음 |
| G3 | **git 폴링이 겹친다** | `GitPanelTab.tsx:74-78`, `GitScreen.tsx:307` | "이미 도는 중이면 건너뛰기"가 없다. 큰 저장소에서 `status -uall`이 10초를 넘기면 git이 겹쳐 쌓인다(시한 60초라 최대 약 6개) | `let busy = false; if (busy) return;` | 작음 |
| R1 ✔ | **`mission_list`가 메인 스레드에서 git을 띄운다** | `src-tauri/src/lib.rs:1998`, `missions.rs:371-377` | 끝나지 않은 임무마다 `git rev-list --count`(약 60ms)를 띄우고 역할 파일도 읽는다. `mission_create`·`mission_set_status`도 안에서 `list()`를 부른다. 앱 시작, 화면 열기, 임무 조작, `.eqmux` 변경 때마다 돈다 | `#[tauri::command(async)]`. 느리면 `commits_since`를 (base, HEAD) 키로 캐시한다(ponytail 주석이 이미 있다) | 한 줄 × 4 |
| R2 ✔ | **`fs_*`가 동기다** | `src-tauri/src/fsx.rs:306-324` | `fs_tree`가 메인 스레드에서 `git ls-files -o -i …`(57ms 이상)를 띄우고 최대 400항목을 걷는다. `fs_read`는 최대 1MB를 읽는다 | fsx 커맨드 전부를 `(async)`로 | 한 줄 × 6 |
| R3 ✔ | **`cost_summary`가 동기다** | `src-tauri/src/agent.rs:1773`, 호출부 `budget.ts:59,70`·`missions.ts:351` | 부를 때마다 SQLite를 새로 열고 GROUP BY를 한다. 에이전트가 일하는 동안 약 3초마다 **등록된 워크스페이스 전부**에 대해 부른다 | `(async)`로 바꾸고 열린 워크스페이스만 부른다. `missions.ts:351`의 60초 타이머에 `!document.hidden` 가드를 넣는다 | 작음 |

R1·R2·R3에 더해 R5·R6의 동기 커맨드까지 바꾸면 모두 한 줄짜리라 한 커밋으로 묶을 수 있다.

## 2. 다음 — 불필요한 프로세스·계산 줄이기

| # | 무엇 | 위치 | 왜 | 처방 | 수고 |
|---|---|---|---|---|---|
| G4 ✔ | `status()`가 git을 4번 띄운다 | `src-tauri/src/gitx.rs:331-337` | 그중 `branch -r --contains HEAD`는 원격 브랜치가 많으면 무겁다(추정 수백 ms). 이것이 10초마다 돈다 | `head_pushed`는 amend를 켤 때만 구하거나 HEAD 해시로 캐시한다. `--absolute-git-dir`은 경로마다 한 번만 구한다 | 작음~중간 |
| G5 | 관제 레일과 git 패널이 같은 `gitOverview`를 각각 폴링한다 | `ControlCenter.tsx:305-315`, `GitPanelTab.tsx` | 관제 화면은 10초에 git을 6번 띄운다. 패널까지 열면 11번이다. 레일에는 `log`가 필요 없다 | 경로별 공유 신호 하나로 합친다 | 중간 |
| G6 | `overview`가 git을 4~5번 띄운다 | `src-tauri/src/workspace.rs:509-544` | branch·rev-list·status·log를 따로 띄운다 | `status --porcelain=v2 --branch -uall` 한 번으로 head·ab를 함께 받는다 → git 2번 | 중간 |
| G7 | diff 편집기가 ↑↓ 숫자 때문에 `gitOverview`를 또 부른다 | `GitDiffEditor.tsx:88` | 열 때마다 git이 4~5번 더 돈다 | 가벼운 명령을 쓰거나 `changed_files`가 함께 돌려준다 | 작음 |
| G8 | `commit_file_diff`가 이름 변경을 찾으려고 diff-tree를 다시 돈다 | `src-tauri/src/diff.rs:408` | 프런트에 이미 `renamedFrom`이 있는데도 파일을 누를 때마다 git이 5~6번 돈다 | `diff_file`처럼 `renamedFrom`을 인자로 받는다 | 작음 |
| R4 | `claude --version` 조회가 겹친다 | `agent.rs:167`, `diag.rs:392` | 캐시는 조회가 성공한 뒤에야 채워진다. 그래서 SessionStart가 동시에 N개 오면(팀 시작·복원) 프로세스가 N개 뜬다. 시한을 넘긴 경우는 캐시하지 않는다 | CLI별로 조회 중 표식을 둔다. 또는 Mutex를 쥔 채 조회해 다른 호출이 결과를 기다리게 한다 | 작음 |
| F3 | 벨·관제 주의 목록에 메모가 없다 | `AppBar.tsx:453-479` `bellUnseen()`, `ControlCenter.tsx:1188-1196` `localAttention()` | 한 번 부를 때마다 메시지 전체를 훑고 세션을 정렬한다. 이것이 tick마다 약 8번 돈다(추정 1ms 안팎) | `attention.ts`에 모듈 수준 메모를 하나 두고, `localAttention`을 `createMemo`로 감싼다 | 작음 |
| F4 | 임무 카드마다 보고를 O(임무×메시지)로 찾는다 | `src/screens/Missions.tsx:73,165` | 임무 탐색기가 떠 있는 동안 tick마다 돈다 | tick당 한 번 임무 id → 보고 Map을 만든다 | 작음 |
| G9 | diff 접기·커서 이동 때 양쪽 6000행을 다시 만든다 | `GitDiffEditor.tsx:209,366,382-386` | `display` 메모가 매번 새 행 객체를 만든다. 커서 `classList`도 행마다 `blockIdx()`를 읽는다 | 행 객체를 재사용하거나 `<Index>`를 쓴다. 커서 판정은 `createSelector`로 한다 | 작음 |
| G10 | 편집 기록 귀속이 커밋 × 기록 이중 루프다 | `gitx.rs:571-596,660-664` | G2 때문에 쓰기마다 다시 돈다. 기록이 수만 건이면 수십 ms(추정) | ts가 정렬돼 있으므로 이진 탐색으로 창만 본다 | 작음~중간 |
| R5 | 앱 시작·화면 열기 때 쓰는 동기 커맨드 | `lib.rs:2720` `session_recaps`, `:1872` `team_load`, `:2041` `library_list`, `:2103` `preset_list` | 하나하나는 작지만 워크스페이스마다 메인 스레드에 쌓인다 | `(async)` | 한 줄 × 4 |
| R6 | 종료 경로가 메인 스레드를 막는다 | `lib.rs:2534` `shutdown_flush`, `:2653` `tokio_sleep` | 종료할 때 최대 2초 동안 화면이 그려지지 않는다 | `(async)` + `tokio::time::sleep` | 작음 |

## 3. 필요해지면

| # | 무엇 | 위치 | 메모 |
|---|---|---|---|
| G11 | 추적 안 된 파일마다 2MB까지 읽어 줄 수를 센다 | `diff.rs:80-88` | 파일이 1000개면 수십 MB를 읽는다. `\n`만 세거나 N개를 넘으면 건너뛴다 |
| G12 | `diff -U999999`·`git show`에 출력 상한이 없다 | `diff.rs:330,337,415,442` | 화면에는 3000줄만 보인다. `cat-file -s`로 먼저 크기를 본다 |
| G13 | 커밋 그래프에 가상화가 없고 쪽마다 전체를 다시 계산한다 | `GitScreen.tsx:245,269,1233-1256` | 3000커밋이면 SVG 요소가 수만 개다(추정). 앞서 계산한 행을 재사용하는 것부터 한다 |
| G14 | git 완료를 20ms sleep으로 확인한다 | `workspace.rs:291,348` | CPU 문제는 아니고 호출마다 0~20ms 지연이 생긴다 |
| G15 | blame 1만 행을 가상화 없이 그린다 | `gitx.rs:268`, `GitScreen.tsx:1299` | 사용자가 열 때만 생긴다 |
| G16 | `path_status`가 경로마다 git을 2번 띄운다 | `gitx.rs:634-641` | `ls-files`·`check-ignore`는 경로를 여러 개 받는다 |
| R7 | 기록 검색이 줄마다 `to_lowercase()` 사본을 만든다 | `history.rs:~118-121` | 트랜스크립트가 389MB라 검색 한 번에 수 초가 걸린다(추정). 사람이 실행할 때만 돈다 |
| R8 | `peer_name`이 5초마다 pid별 json을 연다 | `agent.rs:453` | `registry_cache`에서 찾으면 된다. 비용은 작다 |
| R9 | 세션을 지워도 `mission_cache`·`MsgRate` 항목이 남는다 | `agent.rs:327`, `lib.rs:1065` | 세션당 수십 바이트다. `forget_session`에 한 줄을 넣으면 된다 |
| F5 | 브라우저 탭 MutationObserver(10/17 C6)가 아직 있다 | `BrowserPanelTab.tsx:192-195` | 덮개는 Portal이 아니라서 subtree를 끌 수 없다. 덮개 컴포넌트가 올리고 내리는 `coverCount` 신호로 바꾼다 |
| F6 | 관제 1초 타이머가 숨김 중에도 돈다 | `ControlCenter.tsx:440` | 포커스가 없으면 바로 빠지므로 비용은 거의 없다 |

## 문제 없음으로 확인

- **git 커맨드:** 전부 `async` + `spawn_blocking`이다. `--no-optional-locks`, `CREATE_NO_WINDOW`, 파이프 비우는 스레드가 있다.
- **화면을 닫으면 폴링도 멈춘다:** GitScreen·GitDiffEditor·GitPanelTab은 화면을 떠나면 언마운트된다.
- **10/17 반영분은 회귀가 없다:** GitPanelTab 숨김 가드·`equals`·`g()` 메모, Dashboard 메모, TranscriptPane 가드가 그대로다.
- **EnvPanelTab·ServerPanelTab·McpPanelTab:** 리소스 기준값이 문자열이라 tick에 반응하지 않는다.
- **JumpPalette·HistorySearch·MissionReview·RoleLibrary:** 열 때 한 번 읽거나, 메모가 있거나, 파일이 바뀔 때만 다시 읽는다. 리스너는 해제된다.
- **Rust 폴링:** 레지스트리 스캔은 (mtime, len) 캐시를 쓴다. `ports_snapshot`은 수동으로 부를 때만 돈다. `sessions_agents`·`sessions_memory`는 숨김 중에 쉰다. IPC 동시 연결 상한은 32다.
- **훅 프로세스 비용:** 약 50ms로 `git --version`과 비슷하다. 구조를 바꿀 가치는 없다.
- **store:** cost·file_touch는 배치로 넣고, 30일 보존과 ts 인덱스가 있다.

## 권하는 순서

1. **F1·F2** — 각각 한 줄이고, 플러그인 탭을 열어 둔 동안 반복해서 뜨던 프로세스가 사라진다.
2. **R1·R2·R3·R5·R6** — `(async)` 한 줄씩이라 한 커밋으로 묶는다. 대화상자 커맨드 4개는 그대로 둔다.
3. **G1·G2·G3** — 몇 줄씩이고, 10초 폴링 때마다 DOM을 다시 만드는 일과 쓰기마다 git이 약 16번 도는 일이 준다.
4. 측정한 뒤 G4~G8(git 횟수 줄이기)과 R4로 간다.
5. 3절은 그 상황이 실제로 보일 때 한다.

검증 방법은 `cpu-optimization-2026-10-17.md`의 측정 절을 따른다. F1은 플러그인 탭을 연 채 에이전트를 돌리면서 작업 관리자에서 `node.exe`(claude)가 반복해 뜨는지 보면 바로 확인된다.
