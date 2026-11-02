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
6. **§2 M3**: 상한으로 버려진 메시지 상태를 바꾼다.
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

## 계약 (스트림 사이 인터페이스)

이름과 모양은 만드는 쪽이 정하고 받는 쪽에 SendMessage로 알린다. 아래는 출발점이다.

- **C1 `edit-conflict` 이벤트**(W2 → W7), `emit_to("main")`: `{ workspace: string, path: string, sessions: string[], ts: number }`.
- **C2 AgentStateEvt 확장**(W2 → W7): `pendingTool?: { tool: string, input: string, kind: "tool" | "question" | "plan" }`, `stalled?: boolean`. 커맨드 `approval_respond({ session, allow })` → `{ ok: boolean, reason?: string }`.
- **C3 진단 커맨드**(W2 → W7): `diag_foreign_tools()` → `{ tool: string, file: string, kind: "block" | "hook" | "sentence", count: number }[]`, `diag_bundle()` → `string`(가린 뒤).
- **C4 `file_touch`**(W1 → W2, 완료 `2669083`): 쓰기 `Store::touch_file(ws, session, path, tool, ts)`(writer 스레드 배치), 읽기 `store::recent_touches(root, ws, since_ms)` · `store::touches_for(root, ws, session, since_ms)`. DB가 워크스페이스마다 따로라 workspace 열은 없다.
- **C5 역할 frontmatter `model:`**(W4 쓴다 → W2 읽는다). 값이 없으면 키를 쓰지 않는다.
- **C6 역할 frontmatter `remind:` · `memory:`**(W4 쓴다 → W3 읽는다). `remind:`는 한 줄 문장, 꺼짐이면 키 없음. `memory:`는 워크스페이스 기준 상대 경로 `.eqmux/memory/<persona id>.md`.
- **C7 `.eqmux/commands.json`**(W6 정한다 → 2라운드 §13-3).
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
