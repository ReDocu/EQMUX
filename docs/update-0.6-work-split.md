# EQMUX 0.6 작업 분담

2026-11-02 · 리드 eqmux-68

근거: `docs/update-0.6-scope.md`(이하 "목록"). 절 번호(§)는 목록의 것이다.

## 결정 — 목록의 권장안으로 확정한다

| # | 확정 |
|---|---|
| §1-6 · §5 | VT 서버는 0.7. 0.6은 트레이까지 |
| §5 | 조용한 메시지 타입은 0.6에서 바꾸지 않는다. Codex bypass는 그대로 둔다. 메시지 보존 기간은 그대로 둔다. 기본 세션 수는 4를 유지하고 빠른 시작이 2세션으로 뜬다 |
| P1 · P2 · P3 | mac은 ad-hoc + 안내 · 업데이트 확인 기본 켬(끌 수 있음) · GitHub 기본 README는 영문 |
| X1~X6 | 권장안 그대로. X4 실측 전에는 §12 4단계를 하지 않는다 |
| Q1 · Q2 · Q3 | 승인함은 (b) 훅 경로를 먼저 실측, 안 되면 (a) + 프롬프트 화면 확인 · 되돌리기 없음 · 10분 |
| C1~C3 | 결정된 그대로 |
| V1~V5 | 권장안 그대로 |
| G1~G7′-a | 권장안 그대로. §17은 1·2단계 |

계정이 필요한 것(SignPath, Apple Developer, 업데이터 서명 키)은 이번 라운드에서 하지 않는다. CI 워크플로 파일까지만 만든다.

## 작업 방식 (0.5 방식 그대로)

- 여덟 세션이 **같은 작업 트리**(`D:\workspace\workspace\EQMUX`, 브랜치 `sub_main`)에서 일한다. 워크트리를 만들지 않는다.
- 파일마다 **주인**이 있다(아래 표). 남의 파일은 고치지 않는다. 꼭 필요하면 작은 국소 수정만 한다. 고치기 직전에 다시 읽고, 주인에게 SendMessage로 한 줄 알린다.
- git `commit` · `checkout` · `stash` · `reset` · `restore` · `pull`은 하지 않는다. **커밋은 리드(eqmux-68)가 스트림 보고가 올 때마다 그 스트림 파일만 골라서 한다.**
- 새 파일은 만든 세션이 주인이다. 표에 없는 기존 파일을 고쳐야 하면 리드에게 먼저 묻는다.
- CSS: `screens.css` · `styles.css`는 W7 소유다. 다른 스트림은 **파일 끝에 자기 블록을 덧붙이는 것**만 한다(`/* 0.6 W5: … */` 머리 주석).
- i18n은 한·영을 둘 다 넣는다. 코드 스타일은 주변 코드를 따른다.
- 검증: `npx tsc --noEmit`, `npm test`, `cd src-tauri && cargo test --lib`. 남의 파일에서 난 오류는 고치지 말고 주인에게 알린다. `npm run tauri dev`는 띄우지 않는다(실앱 확인은 리드가 모아서 한다).
- 한 항목이 끝날 때마다 eqmux-68에게 보고한다: 한 일 · 바꾼 파일 목록 · 못 한 일 · 남의 파일을 건드린 곳 · 테스트 결과. 리드가 그 단위로 커밋한다.
- 막히거나, 사람이 결정해야 하거나, 실기가 필요한 것은 하지 말고 보고에 적는다.

## 분담

| 세션 | 스트림 | 소유 파일 |
|---|---|---|
| eqmux-88 | **W1 Rust 런타임 · 저장 · 종료** | `lib.rs` `quit.rs` `store.rs` `recovery.rs` `winstate.rs` `macproc.rs` `main.rs` `Cargo.toml` `Cargo.lock` `tauri.conf.json` `src-tauri/capabilities/**` `src-tauri/icons/**` |
| eqmux-d7 | **W2 Rust 에이전트 · 훅 · 진단** | `agent.rs` `transcript.rs` `diag.rs` `agentscan.rs` `appenv.rs` `job.rs` |
| eqmux-dd | **W3 Rust 메시지 버스 · CLI** | `cli.rs` `ipc.rs` `messages.rs` `clip.rs` |
| eqmux-79 | **W4 역할 · 캐릭터 · 임무 (Rust + 프런트)** | `roles.rs` `library.rs` `team.rs` `missions.rs` `RoleLibrary.tsx` `TeamCasting.tsx` `TeamComposition.tsx` `Missions.tsx` `MissionExplorerTab.tsx` `backend/roles.ts` `backend/library.ts`(+test) `backend/team.ts`(+test) `backend/missions.ts`(+test) `jobs.ts` `i18n/roles.ts` `i18n/missions.ts` |
| eqmux-17 | **W5 git (Rust + 프런트)** | `workspace.rs` `diff.rs` `GitPanelTab.tsx` `GitDiffEditor.tsx` `diffKeys.ts`(+test) `backend/git.ts`(+test) `i18n/git.ts`, 새 git 화면 파일 |
| eqmux-ae | **W6 실행 · 환경 · 브라우저 패널** | `fsx.rs` `ports.rs` `browser.rs` `EnvPanelTab.tsx` `ServerPanelTab.tsx` `PortsPanelTab.tsx` `LogsPanelTab.tsx` `BrowserPanelTab.tsx` `SidePanel.tsx` `MdViewTab.tsx` `CodeEditor.tsx` `backend/env.ts`(+test) `backend/ports.ts`(+tests) `backend/browser.ts`(+test) `backend/panels.ts` `backend/watch.ts` `i18n/panels.ts` |
| eqmux-52 | **W7 프런트 관제 · 셸 · 첫 실행** | `ControlCenter.tsx` `Dashboard.tsx` `SessionDetailPanel.tsx` `TerminalPane.tsx` `AppBar.tsx` `App.tsx` `state.ts`(+test) `types.ts`(+test) `ui.tsx` `WorkspaceConnection.tsx` `LaunchMode.tsx` `launchRules.ts` `LayoutPicker.tsx` `DefaultTerminalSetup.tsx` `Settings.tsx` `ExitDialog.tsx` `CrashRecovery.tsx` `ConversationTab.tsx` `TranscriptPane.tsx` `backend/mock.ts`(+test) `backend/agent.ts`(+test) `backend/attention.ts`(+test) `backend/conversation.ts`(+test) `backend/settings.ts`(+test) `backend/diag.ts`(+test) `backend/layout.ts` `backend/workspaces.ts` `backend/events.ts` `backend/pty.ts` 나머지 `backend/*.ts` `i18n/control.ts` `i18n/session.ts` `i18n/shell.ts` `i18n/settings.ts` `i18n/common.ts` `screens.css` `styles.css` |
| eqmux-68 | **W0 리드 · 공개 준비 · 통합** | `README*` `docs/**` `.github/**` `CONTRIBUTING.md` `SECURITY.md` `CHANGELOG.md` `package.json` `명령어 정리.md`, 커밋 |

## 스트림별 할 일 — 1라운드

순서대로 한다. 앞 항목은 다른 스트림이 기다리는 것이다.

### W1 — eqmux-88 (Rust 런타임 · 저장 · 종료)
1. **§11-0 기준선**: 리드가 돌린 기준선 결과를 받는다. 그 뒤 시작한다.
2. **C4 `file_touch` 테이블**(§13-1 저장): `store.rs`에 `file_touch(session, workspace, path, tool, ts)`와 넣기·조회 함수(`touch_file`, `recent_touches(ws, since_ms)`, `touches_for(session, since_ms)`). 스키마 버전을 하나 올리고 이전(migration)을 넣는다. **먼저 끝내고 W2에게 알린다.**
3. **§1-1 트레이 + §10 창 닫기 동작**: 트레이 아이콘, 메뉴(창 열기 · 전부 종료), 닫기 → 숨김(설정으로 "닫으면 종료"도 고를 수 있게, 설정 키는 W7과 맞춘다), "백그라운드 N개 실행 중" 툴팁·메뉴 줄. macOS는 창을 닫으면 Dock에 남는다(U70). "전부 종료"는 기존 종료 경로(고아 프로세스 정리)를 탄다.
4. **§2 OS 종료 · 로그오프**(`WM_QUERYENDSESSION`): `quit.rs`의 mac 설계(즉시 정리 + flag 안전망)와 같은 방식으로 Windows 경로를 넣는다.
5. **§14 세션 안내문 우선 규칙 한 줄**(`lib.rs` 세션 시작 안내문, Claude · Codex 공통): 360자 상한 테스트를 지킨다.
6. **§1-2 저장 계층**: 스키마 버전 이전 틀(2에서 쓴 것을 일반화), DB 손상 복구(열기 실패 → `.corrupt-<ts>`로 옮기고 새로 만든 뒤 알림), 전역 2GB 보존 상한. 업데이트 때 `session.db`를 `.bak`으로 넘기는 결정 1b를 이전으로 바꾼다.
7. §6 `[profile.dev.package."*"] opt-level = 2`.

### W2 — eqmux-d7 (Rust 에이전트 · 훅 · 진단)
1. **§13-1 동시 편집 감지**: `hook_effect`에서 편집 도구(`Edit` `Write` `MultiEdit` `NotebookEdit`)의 `tool_input.file_path`를 꺼낸다(순수 함수 + 테스트). 메모리에 세션별 최근 편집, 10분 창에서 다른 세션과 겹치면 **C1 `edit-conflict` 이벤트**를 낸다. W1의 `touch_file`이 생기면 저장도 한다.
2. **§13-4 승인함 백엔드**: waiting 직전 `PreToolUse`의 도구와 원문을 세션에 붙여 **C2**로 낸다. 응답 경로 Q1(b) — Claude Code에 앱의 답을 기다리는 권한 훅(PermissionRequest 등)이 있는지 `claude --help`·문서·실측으로 확인한다. 되면 (b), 안 되면 (a) PTY 키 + 직전 출력에 승인 문구가 있을 때만. 커맨드 `approval_respond(session, allow)`. 누르는 순간 같은 도구로 아직 waiting인지 다시 본다.
3. **§3 A5 멈춘 세션**: busy인데 N분 동안 훅·출력이 없으면 `stalled`. AgentStateEvt에 필드를 더한다(C2).
4. **§3 B10 주입 결과 로그 + §11-3 B168 · B140 · B158**: 주입을 시도할 때와 실제로 들어갔을 때를 진단 로그에 남긴다. '전달됨'을 실제 주입 뒤에 붙일 수 있게 이벤트를 낸다(W7 `conversation.ts`와 맞춘다). 주입 코드가 `lib.rs`에 있으면 W1에게 알리고 국소 수정한다.
5. **§3 직무별 모델**: 역할 파일 frontmatter `model:`(W4가 쓴다, **C5**)을 스폰 인자 `--model`로. Codex는 `-m`.
6. **§14 다른 도구 전역 지시 점검**(`diag.rs`): `~/.claude/CLAUDE.md` · `settings.json`, `~/.codex/AGENTS.md` · `config.toml`을 **읽기만** 한다. 자동 관리 구역 표식, 다른 도구 경로의 훅, "You are running inside …" 문장을 찾는다. 커맨드 `diag_foreign_tools()`(**C3**) + 테스트(표본 있음·없음).
7. **§9-3 진단 정보 복사 백엔드**: `diag_bundle()` — 앱 버전, OS, 엔진 CLI 버전, `diagnostics.log` 꼬리. 경로의 사용자 이름과 토큰을 가린다(**C3**). 테스트.
8. 여유가 있으면 §3 F1 한도 · 토큰 #5 컨텍스트 사용량: statusLine에서 받는 값을 AgentStateEvt(또는 기존 이벤트)에 싣는다. §13-6 비용 증분을 임무에 붙이는 집계.

### W3 — eqmux-dd (Rust 메시지 버스 · CLI)
1. **§2 PowerShell 파이프 인코딩 — 먼저 한다**: `eqmux … | Select-Object`에서 한글 · —가 깨지지 않게 CLI 출력 인코딩을 고친다(콘솔이 아닐 때의 출력 경로). 테스트할 수 있는 부분은 테스트.
2. **§15-1 매 턴 상기 훅 출력**: UserPromptSubmit 훅이 `EQMUX_ROLE_FILE` frontmatter `remind:`(**C6**)를 읽어 `hookSpecificOutput.additionalContext`로 낸다. IPC보다 먼저. Codex(`EQMUX_AGENT`)면 내지 않는다. 테스트.
3. **§15-2 기억 싣기**: SessionStart 훅이 역할 · 시트 다음에 frontmatter `memory:`(**C6**)가 가리키는 파일의 뒤 4000자를 싣는다(`MAX_SHEET_CHARS`와 같은 방식). 테스트.
4. **§4 메시지 버스**: 직함으로 수신자 지정(`--to @클라이언트개발자`), 회신 연결 `--re <id>`, `eqmux send --wait`. `depends_on`은 W4(`missions.rs`)와 맞춘다.
5. **§3 B7 `eqmux read` · `eqmux list`**: 팀원 스크롤백 읽기. 스크롤백 원천이 프런트에 있으면 리드에게 보고하고 설계부터 한다.
6. ~~**§2 M3**~~ → W7로 넘김(상한 · 전달 상태가 모두 `conversation.ts`에 있다). 명세: 버려진 '나' 메시지는 Delivery `dropped`, 라벨 `버려짐`/`Dropped`.
7. **§11-3 버스 · CLI 견고성**: B124 · B125 · B116 · B122 · B156 · B157(연결 고갈, 줄 길이 상한). 원문은 `origin/sub_main`의 `docs/qa-0.5.1-macos-usability.md`.
8. §2 P26 — 엔진 쪽 규칙이라 고칠 수 있는지만 확인해 보고한다.

### W4 — eqmux-79 (역할 · 캐릭터 · 임무)
1. **§13-2 임무 시작점 기록**: 배정 · [브리프 전달] 때 HEAD를 임무 frontmatter `base_commit`에(`assigned_at`과 같은 방식). 임무 카드에 "시작 `a1b2c3d` · 그 뒤 커밋 N개". 테스트.
2. **§15-1 매 턴 상기**: 페르소나 `remind: on`(편집 화면 체크박스, 턴당 수십 토큰 안내, "Claude Code만"), 역할 합성 때 frontmatter `remind: <한 줄>`(**C6**, 단계별 문장은 목록 §15-3). `set_mission` 뒤에도 남는다. 테스트 ①②.
3. **§15-3 팀원 표 정체성 열**, **§15-5 중급 대사 예시 칸**.
4. **§15-2 캐릭터 기억**: `.eqmux/memory/<id>.md`, `.gitignore`에 `memory/`, 역할 파일에 `memory:` frontmatter(**C6**)와 쓰기 지시 한 줄, 편집 화면 [기억 열기] · [비우기](휴지통).
5. **§3 직무별 모델 필드**: 페르소나·직무에 `model`, 역할 frontmatter `model:`(**C5**). 화면에서 고르기.
6. **§3 D3 "이 팀으로 시작"**: 저장소의 `team.json`이 있으면 연결 흐름에서 그 편성으로 바로 시작하는 버튼. 연결 화면은 W7 파일이니 버튼 자리는 W7과 맞춘다.
7. **§15-4 초상 이미지**: `personas/<id>.png`가 있으면 이니셜 대신. 이니셜 부품이 W7 파일(`ui.tsx`)이면 W7에게 부탁한다.
8. §4 `depends_on`(W3와).

### W5 — eqmux-17 (git)
1. **§17 1단계 — 읽기 확장(G7 그대로)**: git 화면 뼈대(새 전체 화면 View — `state.ts`의 View 추가는 W7에게 한 줄 부탁하거나 국소 수정 후 알림), 전체 브랜치 그래프 + 300개 페이징(레인 계산은 프런트 순수 함수 + 테스트), 브랜치 · 태그 · stash 사이드바(ahead/behind), 로그 검색 · 필터, 커밋 상세(기존 커밋 diff 화면 재사용), 파일 히스토리 · blame.
2. **§17 2단계 — 안전한 쓰기(G7′)**: 허용 목록 실행 경로(`workspace::git()`, `GIT_TERMINAL_PROMPT=0`, `--force`·`--no-verify` 거부 테스트), 실행 로그, 인증 실패 안내, **작업 중 경고(§4-1 확인창 규칙)**, fetch · pull(`--ff-only`) · push, 파일 · 덩어리 스테이징, 커밋 · amend(푸시한 커밋 경고), 브랜치 만들기 · 전환(§4-1) · 이름 변경 · 삭제, 태그. 바뀐 뒤 에이전트 알림(켜고 끔).
3. 사이드 패널 git 탭: 복사 → 실행, [git 화면 열기]. `GitPanelTab.tsx`의 G7 안내 줄을 고친다.
4. 3단계(이력 조작)는 2라운드다.

### W6 — eqmux-ae (실행 · 환경 · 브라우저 패널)
1. **§16 환경변수 CRUD 1~4단계** 전부: `env.ts` 순수 함수(줄 번호 · 한 줄 바꾸기/빼기/붙이기 · 직렬화 · 키 검증) + 테스트, 변수 · 파일 CRUD UI(mtime 충돌), 빈 상태 탭 늘 보이기(`SidePanel.tsx` `hasEnv`), git 추적 · 무시 칩과 [.gitignore에 추가](git 호출은 기존 커맨드로, 없으면 W5에게 부탁).
2. **§3 D2 저장 명령 `.eqmux/commands.json`**: 서버 탭에 붙인다. 형식은 **C7**로 정해 리드에게 보고한다(§13-3 [테스트 실행]이 쓴다).
3. **§4 세션별 포트 범위**(서버 탭).
4. **§2 로그 마스킹 + E4 스크롤백 보안 표기**: 로그 패널에서 시크릿 패턴을 가린다(순수 함수 + 테스트). 스크롤백 "토큰이 남을 수 있다" 한 줄과 끄기 토글 — 토글 설정은 W7(`settings.ts`)과 맞춘다. §11-3 B146–B150 · B154 · B155.
5. **§3 G5 브라우저 안전장치**: `confirm` · `alert` 처리, 콘솔 · 네트워크 로그, 낡은 `@eN` 거부.
6. §6 R2 숨긴 브라우저 패널 정리는 하지 않는다(측정 전).

### W7 — eqmux-52 (프런트 관제 · 셸 · 첫 실행)
1. **§10 빠른 시작 + 첫 흐름 길 안내**: 폴더만 고르면 2세션(리드 + 개발)으로 뜬다. 마법사 모든 단계에 단계 표시 · [뒤로] · 실제 도착지를 말하는 마지막 버튼(mac 백로그 P49 · P50 · U107 · U108).
2. **§10 첫 실행 고지**: 앱이 쓰는 곳 · 쓰지 않는 곳(목록 §9-2 문구) + §14 점검 결과(W2 **C3** `diag_foreign_tools`). 알림 센터에도 한 건.
3. **§9-3 [진단 정보 복사]** 버튼(W2 **C3** `diag_bundle`).
4. **§13-1 동시 편집 경고 화면**(**C1**): 페인 머리 · 대시보드 주의 카드 · 알림 센터, [Kai에게 알리기] → `ask` 초안. "편집 도구로 고친 것만" 문구.
5. **§13-4 승인함**(**C2**): 대시보드, 기다린 순, 도구와 원문, [허용] · [거부] · [페인으로 가기]. 질문 · 계획 승인은 [페인으로 가기]만.
6. **§3 A5 멈춤 배지**, **§13-5 자리 비운 사이 요약**, **§13-6 비용 예산 알림**(설정 하루 예산, 기본 꺼짐), F1 · 컨텍스트 배지(W2가 값을 실으면).
7. **§11-3 B168** '전달됨' 시점(`conversation.ts`, W2 이벤트), **§4 대화 탭 임무 필터**.
8. 트레이 관련 설정 키(W1), 스크롤백 보안 토글(W6), 저장 명령 위치(W6) 등 다른 스트림의 설정 · 화면 연결을 받는다.
9. §11-3 용어 · 문체(P51 · P52 · P53 · U112 · P46 · P47 · U74–U76)는 2라운드에 리드와 같이 한다.

### W0 — eqmux-68 (리드)
1. 기준선(`tsc` · `npm test` · `cargo test --lib`) 결과를 모두에게 알린다.
2. **§9-1 GitHub Actions 빌드** 워크플로(Windows 포터블 zip · NSIS, macOS universal dmg, 한 태그에 두 플랫폼 + 체크섬). 서명 단계는 자리만 둔다.
3. **§9-2 저장소 입구**: README 맨 위(베타 · 설치 경고 넘기는 법), 앱이 쓰는 곳 · 쓰지 않는 곳, code signing policy · 개인정보 문구, `.github/ISSUE_TEMPLATE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, README 낡은 설명 정리, 영문 README 기본(P3).
4. **§14 문서 "다른 도구와 같이 쓰기"**(`docs/site/docs.md`).
5. 스트림 보고마다 통합 테스트 · 커밋, 이 문서와 목록의 상태 칸 갱신.
6. 2라운드 배정: §12 스킬 · 플러그인 1~3단계(+ MCP), §17 3단계, §13-3 임무 검토 화면, 새 화면 4개(Jump 팔레트 · 과거 세션 검색 · 서브에이전트 목록), 파일 탐색기 개편, §11-3 용어 정리.

## 2라운드 배정 (진행 중)

1라운드 항목이 끝난 세션부터 차례로 받는다.

| 세션 | 받은 일 |
|---|---|
| eqmux-88 (W1) | B116 macOS 단일 인스턴스(lib.rs 잠금, eqmux-dd와 나눔) → **§12 스킬 · 플러그인 1~3단계 + MCP**(새 파일 `extensions.rs` · `ExtensionsPanelTab.tsx` · `backend/extensions.ts` · `i18n/extensions.ts`) |
| eqmux-17 (W5) | §17 남은 것(탐색기 파일 히스토리 메뉴 · 세션 배지 · 첫 커밋 전 스테이지 내리기) → **§17 3단계** |
| eqmux-dd (W3) | B116 ipc.rs 쪽(소켓 정리) → §4 depends_on 완료 알림(끝) → **과거 세션 검색 · 재개**(`history.rs` · `HistorySearch.tsx`) → **서브에이전트 목록** |
| eqmux-d7 (W2) | B122 macOS 유예 없는 SIGKILL 추가(1라운드 ⑥⑦④ 뒤) |
| eqmux-ae (W6) | B156(끝) → **사이드 패널 개편**: 파일 탐색기를 코드 그룹 `[git \| 파일 \| 문서]`로, §12 확장 그룹 붙이기(eqmux-88과 맞춤) |
| eqmux-52 (W7) | B157(끝) → B168 '전달됨' 시점(W2 `message-injected`) · §13-3 검토 화면 라우팅 |
| eqmux-79 (W4) | §4 depends_on(끝) → §13-3 임무 검토 화면(끝) → §11-3 W4 문구 |
| — 3라운드 | eqmux-dd **Jump 팔레트 + 단축키 표 + U92 · U93 · U97** · eqmux-17 **직함별 담당 경로 + 담당 밖 편집 경고** · eqmux-d7 **상태 판정 근거** · eqmux-ae §11-3 W6 문구 + mac 잔여(B132 · B151 · B121 · B163 · U100–U102) · eqmux-52 **§11-3 용어 · 문체**(규칙: 사용자 문장 합니다체, 라벨 명사형, 작업 대상 '워크스페이스') |

## 계약 (스트림 사이 인터페이스)

이름과 모양은 만드는 쪽이 정하고 받는 쪽에 SendMessage로 알린다. 아래는 출발점이다.

- **C1 `edit-conflict` 이벤트**(W2 → W7), `emit_to("main")`: `{ workspace: string, path: string, sessions: string[], ts: number }`.
- **C2 AgentStateEvt 확장**(W2 → W7): `pendingTool?: { tool: string, input: string, kind: "tool" | "question" | "plan" }`, `stalled?: boolean`. 커맨드 `approval_respond({ session, allow })` → `{ ok: boolean, reason?: string }`.
- **C3 진단 커맨드**(W2 → W7): `diag_foreign_tools()` → `{ tool: string, file: string, kind: "block" | "hook" | "sentence", count: number }[]`, `diag_bundle()` → `string`(가린 뒤).
- **C4 `file_touch`**(W1 → W2, 완료 `2669083`): 쓰기 `Store::touch_file(ws, session, path, tool, ts)`(writer 스레드 배치), 읽기 `store::recent_touches(root, ws, since_ms)` · `store::touches_for(root, ws, session, since_ms)`. DB가 워크스페이스마다 따로라 workspace 열은 없다.
- **C5 역할 frontmatter `model:`**(W4 쓴다 → W2 읽는다). 값이 없으면 키를 쓰지 않는다.
- **C6 역할 frontmatter `remind:` · `memory:`**(W4 쓴다 → W3 읽는다). `remind:`는 한 줄 문장, 꺼짐이면 키 없음. `memory:`는 워크스페이스 기준 상대 경로 `.eqmux/memory/<persona id>.md`.
- **C7 `.eqmux/commands.json`**(W6, 완료 `3448556`): `{ "version": 1, "commands": [{ "name": "test", "run": "npm test", "kind": "server" | "test" | "other" }] }`. 순수 함수 `backend/ports.ts` `parseCommands`. 서버 셸에 치므로 종료 코드는 따로 오지 않는다 — §13-3 [테스트 실행]은 run 뒤 표식으로 출력에서 읽게 설계한다.
- **공통 부품**: `ConfirmDialog` · `notify()` · `Segmented` · `Chip`은 `src/components/ui.tsx`(W7)에 이미 있다. 그것을 쓴다.

## 진행 기록

| 날짜 | 스트림 | 항목 | 커밋 |
|---|---|---|---|
| 11-02 | W0 | 분담 문서 | `c17e686` |
| 11-02 | W1 | 스키마 이전 틀 + `file_touch`(C4) | `2669083` |
| 11-02 | W0 | CI · 서명 정책 · SECURITY · CONTRIBUTING · 이슈 템플릿 · README · 다른 도구 문서 | `46b8d01` |
| 11-02 | W2 | 동시 편집 감지 `edit-conflict`(C1, PostToolUse 기준) | `b16b035` |
| 11-02 | W6 | 기준선 포트 테스트 실패 = 이 PC TCP 표에 LISTENING이 안 나오는 환경 문제. 실기는 다른 PC에서 | — |
| 11-02 | W3 | PowerShell 파이프 인코딩(콘솔 CP 변환). 실기: 한국어 Windows 기본 pwsh에서 `eqmux who \| Select-Object` | `be185da` |
| 11-02 | W4 | 임무 시작점 `base_commit` + 카드 "그 뒤 커밋 N개" | `deafa88` |
| 11-02 | W3 | 매 턴 상기 `remind:` 훅 출력 · 기억 `memory:` 싣기(C6). 실기: 30턴 말투, 끈 뒤 빠짐, Codex 무해, 기억 언급 | `babd05a` |
| 11-02 | W1 | 트레이 · 창 닫기 동작(Rust) · WM_QUERYENDSESSION. 프런트 연결은 W7 대기. 실기: 트레이 표시 · 수 갱신 · 알림, 실제 로그오프 뒤 복구 창 · 고아 프로세스, mac Dock | `530c4d1` |
| 11-02 | W7 | 빠른 시작 · 마법사 길 안내(P49 · P50 · U107 · U108 일부). 실기: 빠른 시작 두 세션 차례 기동 · 리드 포커스 · 창 위치 | `db182b5` |
| 11-02 | W1 | 세션 안내문 §14 우선 규칙 · message.re 이전 v3 · 이전 실패 처리. 실기: "이 페이지 열어 줘" 첫 시도 eqmux browser | `ba499fb` |
| 11-02 | W7 | 창 닫기 설정 closeAction · onCloseRequested 연결 | `412b303` |
| 11-02 | W7 | 주입 머리에 원장 id · 회신 표시 | `02cd23b` |
| 11-02 | W4 | 매 턴 상기 remind(페르소나 체크박스 · 역할 frontmatter) | `94272d4` |
| 11-02 | W0 | `ba499fb`에 섞인 gitx · AgentStateEvt 줄 되돌림(경로 붙인 commit 실수) | `6a1f38d` |
| 11-02 | W6 | §16 환경변수 CRUD 1~4단계. 목록과 다른 점: 값은 이스케이프 대신 dotenv가 같은 값으로 읽는 따옴표를 고른다 · [원문 편집]은 탭 안 CodeEditor. git 칩은 W5 `git_path_status` 커밋 뒤 동작. 실기: §16-7 전부, dotenv 대조 | `f1adaa6` |
| 11-02 | W3 | 직함 수신자 · `--re` · `send --wait`. 한계: 다른 프로젝트 --re 회신은 --wait가 못 잡음, 직함별 담당 경로 미구현, team.json 대체 해석은 직함 안 봄 | `bdec5fd` |
| 11-02 | W3 | re 열 없는 DB에서도 버스 동작 | `a67ca91` |
| 11-02 | W6 | 저장 명령 C7 + 서버 탭 버튼 줄 | `3448556` |
| 11-02 | W4 | 팀원 표 정체성 열 · 중급 대사 예시 | `5d05739` |
| 11-02 | W7 | 첫 실행 고지 · 다른 도구 점검 알림 · 설정 › 정보 진단 복사. W2 C3 커맨드 뒤 실기 | `ed493e2` |
| 11-02 | W7 | --wait 회신 중복 주입 방지(message-taken) | `50a911a` |
| 11-02 | W3 | `eqmux read` · `eqmux list`. 한계: 마지막 1~2줄 지연, TUI 화면 일부만, 지난 실행 포함, **로그 마스킹(W6) 전에는 가리지 않은 원문** | `6e5c995` |
| 11-02 | W7 | 동시 편집 경고 화면(주의 카드 · 페인 칩 · 알림) | `72fd3bc` `4fb80fd` |
| 11-02 | W4 | 캐릭터 기억 + 역할 파일 포트 범위 줄 | `43fe5cd` |
| 11-02 | W6 | 세션별 포트 범위 EQMUX_PORT_BASE/END. 한계: 재스폰이 옛 PTY 종료보다 먼저면 범위가 겹칠 수 있음 | `6ee0c5a` |
| 11-02 | W7 | M3 버려짐 표시 | `77d7d5c` |
| 11-02 | W0 | 포트 범위 블록 제자리로(줄 번호 기준 hunk 적용 실수) | `56a03f1` |
| 11-02 | W3 | B124 BUSY · B125 BAD_LINE. B116 · B122 · B156 · B157은 다른 주인 파일 | `5446528` |
| 11-02 | W4 | 직무별 모델 frontmatter `model:`(C5). 스폰 인자는 W2 | `519472f` |
| 11-02 | W5 | §17 git 화면 1 · 2단계, G7 → G7′. 상세 `docs/update-0.6-w5-git-status.md` | `bd8c9dc` |
| 11-02 | W1 | §1-2 손상 복구 · 2GB 상한 · 결정 1b 폐기. 남은 결정: 메시지 보존(§5) · 0.5의 .bak 정리 여부. 실기: 손상 DB로 기동 | `48bc7d2` |
| 11-02 | W7 | 승인함 화면(C2). approval_respond(W2) 대기 | `3916f25` |
| 11-02 | W1 | opt-level(1라운드 W1 끝) | `68d75fd` |
| 11-02 | W7 | 설정 › 저장 행 '이전' · '2GB' | `2a93150` |
| 11-02 | W4 | D3 이 팀으로 시작 — 백엔드(카드는 W7) | `6fab382` |
| 11-02 | W3 | P26 확인 — Claude Code는 && · ; · | 로 나눈 모든 하위 명령이 허용돼야 통과(설계대로). eqmux 쪽 수정 불가. 대응: read · list 허용 추가(48bc7d2) + 역할 파일에 "eqmux는 따로 실행" 한 줄(W4) | — |
| 11-02 | W1 · W3 | B116 instance.lock · 소켓 정리. **mac에서 cargo check 필요**(unix 경로 미컴파일) | `c8d6215` |
| 11-02 | W2 | 승인함 백엔드 — Q1(b) PermissionRequest 훅 실측 성공 · approval_respond · pendingTool · stalled | `3b33342` |
| 11-02 | W7 | 멈춤 배지 · 자리 비운 사이 요약 · 하루 예산 | `6d7f26b` |
| 11-02 | W6 | 비밀값 패턴 TS · Rust 공유 · 로그 마스킹 · E4 문구 · B146 · B147 · B149 · B155 | `24e4138` |
| 11-02 | W4 | 초상 이미지 · P26 역할 파일 줄 | `54bc416` |
| 11-02 | W7 | 이 팀으로 시작 카드 · 승인 사유 코드. 실기: 클론 저장소에서 restoreTeams가 이 화면을 건너뛰는지 | `3dd3905` |
| 11-02 | W2 | 직무별 모델 스폰 인자(Claude `--model` · Codex `-m`) | `8d977da` |
| 11-02 | W3 | `eqmux read` 가리기 · 클립보드 기록 · 클라우드 제외(concealed). 실기: mac 빌드에서 clip 분기 | `f3beda3` |
| 11-02 | W7 | 스크롤백 · 세션 로그 저장 끄기 설정 · `clipWriteText` concealed | `26ccf2d` |
| 11-02 | W0 | HEAD 검증(`26ccf2d`): tsc OK · npm test 219 · cargo 204 통과 + ports 1(기준선) | — |
| 11-02 | W4 | 임무 `depends_on` · 선행 임무 칩 | `7856f3d` |
| 11-02 | W6 | B156 닫힌 패널 open · B148 환경변수 복사 기록 제외. 실기: 패널 닫힘 → `eqmux browser open` 첫 줄, mac 빌드 | `9810f4b` |
| 11-02 | W3 | 선행 임무 완료 알림(mission_set_status done 경로만) | `59f971f` |
| 11-02 | W2 | `diag_foreign_tools` · `diag_bundle`(C3). Codex `hooks.json`도 본다 | `1d77eea` |
| 11-02 | W1 | `scrollbackPersist` Rust. 실기: 끈 뒤 세션 로그 · session.db 증가 멈춤, 켠 뒤 다시 증가 | `14f1b93` |
| 11-02 | W2 | B10 · B168 주입 도착 로그 · `message-injected`. 한계: id 없는 메시지, 긴 붙여넣기 자리표시(미측정) | `8bf942b` |
| 11-02 | W6 | G5 브라우저 안전장치(대화상자 · console · network · 낡은 `@eN`). 실기: confirm 버튼 click · `--accept`, console, SPA 전환 뒤 옛 참조 | `bbb0cd5` |
| 11-02 | W7 | B157 맨 셸 메시지 알림 · D3 첫 화면 판정(깨어 있는 세션) · 완료 보고 [검토 →] | `dba51a6` |
| 11-02 | W3 | browser 사용법(console · network · --accept) | `28164e7` |
| 11-02 | W0 | 사용 설명서 갱신: 설계 경계(git 쓰기 · 승인함 · 트레이), git 패널, 창 닫기, browser 동작, Codex 설정 파일 | 이 커밋 |
| 11-02 | W2 | B122 macOS 종료 유예 · 낡은 레지스트리 기록 무시. **mac cargo check · 페인 닫기 실기 필요**. 앱 종료는 세션마다 최대 1.5초 차례로 쌓일 수 있음 | `9d6d358` |
| 11-02 | W0 | HEAD 검증(`9d6d358`): tsc OK · npm test 219 · cargo 211 통과 + ports 1(기준선) | — |
| 11-02 | W0 | `CHANGELOG.md` 0.6.0(미출시) | 이 커밋 |
| 11-02 | W7 | B168 '보내는 중' → `message-injected` 때 '전달됨'(훅 없는 엔진은 30초 뒤) · B10 INJECT-TRY · 대화 탭 임무 필터(담당 세션 기준) | `820ad76` |
| 11-02 | W5 | §17 3단계(merge · rebase · cherry-pick · revert · stash · reset, 충돌 고르기, 진행 중 배너) · 커밋 세션 배지(file_touch 추정) · 첫 커밋 전 내리기 · B154 .env diff 가리기 · 앱 git 호출 --no-optional-locks. 실기: 전부 | `f0514a0` |
| 11-02 | W4 | §13-3 임무 검토 화면(1차: diff는 HEAD↔작업 트리, base · 담당 파일 필터는 W5 다음). [테스트 실행]은 C7 kind test + 종료 코드 표식 | `0b500ca` |
| 11-02 | W0 | 사용 설명서 · CHANGELOG git 3단계 반영 | `90e17e8` |
| 11-02 | W2 | F1 사용 한도 · 컨텍스트 사용률(`contextPct` · `rateLimit`). 실측 2.1.316: seven_day만 보임 | `ada05f7` |
| 11-02 | W3 | 과거 세션 검색 · 재개(Claude만, 워크트리 cwd 제외). 진입 버튼은 W7 | `0030e8e` |
| 11-02 | W0 | 결정 §13-6: 임무별 비용은 store에(임무 파일 아님). 증분 순간 담당 임무 = assigned에 있고 done 아닌 임무 중 assigned_at 최신, 없으면 임무 밖. 재시작으로 줄면 새 기준 | — |
| 11-02 | W0 | HEAD 검증(`0030e8e`): tsc OK · npm test 231 · cargo 219 통과 + ports 1 | — |
| 11-02 | W1 | §12 확장 1~3단계 + MCP(엔진 CLI 다리 · MCP 읽기 · 스킬 · 세션별 표) · 자동 승인 browser console · network. X4 실측: --settings enabledPlugins는 키 단위로 합쳐짐. 실기: 켜기/끄기 · details 토큰 · MCP 점검 · 스킬 CRUD | `4b064e5` |
| 11-02 | W4 | 탐색기 푸터 [임무 관리] · 모델 입력 문자 필터 | `09ccc14` |
| 11-02 | W6 · W7 | 사이드 패널 개편(코드 그룹 · 확장 그룹 · 닫기 가드 · 임무 팝업 임무만) · 앱 바 [기록]. 실기: 로컬 폴더 → 파일 탭, 편집 유지 · 닫기 확인, 확장 세 탭, 좁은 패널 | `b444948` |
| 11-02 | W3 | 서브에이전트 호출 목록(읽기 전용, 종류 없음) | `d2dba10` |
| 11-02 | W5 | diff 시작점 기준(diff_changed_files_since · file_diff_since · base · only) | `4bb8860` |
| 11-02 | W1 | 비용 store(v4 cost 표, 30일) | `53d0ecc` |
| 11-02 | W4 | 임무 검토 diff를 시작점 · 담당 파일 기준으로, [전체 변경 보기] | `a758473` |
| 11-02 | W2 | §13-6 임무별 비용 cost_summary(첫 값은 기준선, 담당 임무 60초 캐시) | `9cd0a54` |
| 11-02 | W0 | HEAD 검증(`9cd0a54`): tsc OK · npm test 237 · cargo 225 통과 + ports 1 | — |
| 11-02 | W5 | GitDiffEditor 닫기를 화면 자체일 때만 | `b792d0d` |
| 11-02 | W4 | 임무 카드 · 검토 화면 비용 | `f0172bd` |
| 11-02 | W2 | 상태 판정 근거 `reason` · 서브에이전트 종류. **Codex 실측 2건(apply_patch 경로, PermissionRequest 결정 형식)은 실기 필요** — 측정에 `--dangerously-bypass-hook-trust`가 필요해 세션 권한에서 거부됨, 사용자 허락 필요 | `358fb3d` |
| 11-02 | W7 | labels.ts(revealLabel · fileManagerName · jobName) · F1 한도 칩 · 한도 소진 전달 보류 · 컨텍스트 칩 | `cb74d75` |
| 11-02 | W4 | 직무 owns → 역할 파일 owns(담당 경로 배관) | `2bff0ba` |
| 11-02 | W6 | §11-3 패널 문구 · U76 · U101 · U102 · U112-④. mac 잔여 주인 배정: B132 · B151 → W5 Rust canonicalize + W7 비교, B121 → W2, B163 · U100 · U101 · U102 → W7 · W4 · W5 | `e1fc804` |
| 11-02 | W3 | 건너뛰기 팔레트 Ctrl+Shift+K(⌘⇧K, ⌘K는 터미널 비우기라 피함) · 단축키 표 보강 | `9d172aa` |
| 11-02 | W7 | 판정 근거 표시 · 하루 예산 cost_summary 합계. 실기: 재시작 뒤 합계 | `62fe468` |
| 11-02 | W0 | 실기 확인 목록 틀 `docs/update-0.6-qa-checklist.md`(스트림별 절) | 이 커밋 |
| 11-02 | W0 | HEAD 검증(`62fe468`): tsc OK · npm test 244 · cargo 227 + ports 1 | — |
| 11-02 | W2 | CLI 최소 버전 알림(claude 2.1.316 · codex 0.146.0) · Windows 레지스트리 stale 판정 | `51cfdd6` |
| 11-02 | W4 | §11-3 역할 · 캐스팅 · 임무 문구 · U102 | `bec5a3a` |
| 11-02 | W7 | §11-3 ①: 워크스페이스 통일(P51) · 내부 용어(P53) · P46 · P47 · U75 · LaunchMode 말투 · 알림 cli-version | `89940a1` |
| 11-02 | W0 | 실기 목록 W1 · W2 · W4 절. W6 절 열 모양(4열/5열) 작업본 차이는 사용자 결정 대기 | `d3565ee` |
| 11-02 | W2 | B121 트랜스크립트 경로 실경로 기준(NFD는 mac 실기) | `4b8f50f` |
| 11-02 | W1 | §6 R1 최소화 · 트레이 숨김 때 WebView2 메모리 LOW. 실기: 전후 메모리 | `bad6f37` |
| 11-02 | W3 | escalate `--severity high`(원장 v5) · 알림 센터 · OS 알림. 화면은 W7 | `e22fe46` |
| 11-02 | W5 | 직함별 담당 경로 경고 `edit-outside-owns` · who 담당 줄 · path_keys(B132 · B151) · U102 | `5632dc5` |
| 11-02 | W0 | HEAD 검증(`5632dc5`): tsc OK · npm test 244 · cargo 237 + ports 1 | — |
| 11-02 | W3 · W5 | 실기 확인 목록 W3 · W5 절 | `af15c7e` · `4be6ee5` |
| 11-02 | W7 | 합니다체 통일(P52) · 긴급 칩 · 순위 · 담당 밖 알림 · 워크트리 소속 비교 키 | `59ada90` |
| 11-02 | W4 | §15-4 초상 — 레일 · 페인 머리 · 대화 탭 · 알림 | `4e0849d` |
| 11-02 | W0 | 사용 설명서에 W2 · W3 · W6 초안 합침 | `e6af3d2` |
| 11-02 | W7 | select 화살표 · 체크 대비 · 고대비 모드 · 아이콘(U100 · U101 · U102 · B163) · 자리 비운 카드 · 레일 긴급 먼저 | `5e69b1b` · `060ac3e` |
| 11-02 | W0 | HEAD 검증(`060ac3e`): tsc OK · npm test 245 | — |
| 11-02 | W1 | 출시 전 점검 — clippy 2건 · 확장 탭 편집기 lazy(메인 청크 1,750 → 1,180 kB) | `7b3f69e` |
| 11-02 | W0 | 사용 설명서에 W5 · W1 초안 합침. 걷어낸 워크트리 만들기 · 연결 설명 뺌(격리 체크박스 · 레일 목록은 남음) | `fd63a4e` · `9ca6505` |
| 11-02 | W2 · W5 | clippy W2 0건 · git 패널 커밋 메뉴 안내 | `49451dc` · `404cf40` |
| 11-02 | W6 · W3 · W4 | clippy 나머지(fsx · cli · ipc · messages · history · team) | `6b8e6cf` · `a1da8e0` · `203dfdf` |
| 11-02 | W0 | HEAD 검증(`203dfdf`): tsc OK · npm test 245 · **clippy 0** · cargo 237 + ports 1. 공유 target의 깨진 tauri-build(LNK1223) clean | — |
| 11-02 | W0 | 사용 설명서에 W4 · W7 초안 합침 → 초안 7개 모두 합쳐 `docs/site/drafts/` 지움 | `a24c69e` · `ad489a7` |
| 11-02 | W2 | 실패 경로 점검 — 엔진 버전을 못 읽은 결과를 기억하지 않음 | `b91db79` |
| 11-02 | W7 | vite 경고 0(효과 없는 동적 import · 셸 토스트 훅 · 마법사 · 임무 lazy), 메인 1,155 kB | `6cc6787` |
| 11-02 | W0 · W7 | 실기 확인 목록 W7 절, 표를 모두 4열로 통일 | `3130b0c` |
| 11-02 | W6 | 실패 경로 점검 — 못 읽은 `.env`를 이유와 함께 읽기 전용 카드로, BOM 테스트 | `0d97547` |
