# EQMUX 0.6.2 QA 수정 분담

2026-11-04 · 리드 eqmux-eb · 근거 `interview.csv`의 0.6.2 코드 리뷰 라운드(B274–B310 · U182–U192 · S23–S29)

## 범위

할 일은 54행입니다. B274–B310(37) · U182–U192(11) · S23–S28(6).

**뺀 것**: S29(앱 잠금 · Windows Hello / Touch ID)는 이번 라운드에서 하지 않습니다. 사용자가 제안만 남기기로 골랐고, 실앱으로 본인 확인 창을 확인할 수 없기 때문입니다.

먼저 고칠 것은 높음 2행(B274 · B275)과 보안 행(B279 경로 탈출 · B307 · B308 · B310 비밀값)입니다. 그다음 중간, 마지막으로 낮음을 고칩니다.

## 작업 방식

- 여덟 세션(일곱 + 리드)이 **같은 작업 트리**(`D:\workspace\workspace\EQMUX`, 브랜치 `sub_main`)에서 일합니다. 워크트리를 따로 만들지 않습니다.
- 파일마다 **주인**이 있습니다(아래 표). 남의 파일은 작은 국소 수정만 합니다. 고치기 직전에 다시 읽고(Edit 정확 일치), 주인에게 SendMessage로 한 줄 알립니다. 파일 전체를 다시 쓰지 않고, 포매터를 파일 전체에 돌리지 않습니다.
- git `commit` · `checkout` · `stash` · `reset` · `restore` 금지. git 읽기는 `git --no-optional-locks`로 합니다. 커밋은 리드가 합니다.
- `interview.csv`와 `docs/**`는 리드만 고칩니다. 각 세션은 보고에 행 번호별 결과(수정 · 일부 + 남은 것 · 안 함 + 이유)를 적습니다.
- 행의 `제안·기대 동작` 칸은 방향입니다. 더 나은 방법이 있으면 그렇게 하고, 보고에 이유를 적습니다. 코드를 다시 읽어 보니 버그가 아니면 '안 함 + 근거'로 보고합니다.
- 줄 끝(CRLF/LF)은 파일마다 다릅니다. Edit 도구를 쓰거나, 스크립트로 고칠 때는 바이트 단위로 원래 줄 끝을 지킵니다. 한글이 든 스크립트는 Write 도구로 만들고 `python -X utf8`로 돌립니다(bash heredoc은 한글을 깨뜨립니다).
- UI 평서문은 합니다체. i18n은 한·영 둘 다 넣습니다(`src/i18n/*.ts`, 자기 영역 사전에 키를 덧붙입니다).
- CSS: `screens.css` · `styles.css`는 리드 소유입니다. 자기 규칙을 고치는 국소 Edit와 **파일 끝 블록 추가**(`/* 0.6.2 QA <세션>: … */`)는 허용합니다.
- 고친 로직마다, 그 로직이 깨지면 실패하는 테스트를 하나 남깁니다(분기 · 파서 · 상태 전이). 문구만 바꾼 것은 테스트 없이 둡니다.
- 검증: `npx tsc --noEmit`, `npm test`(= `vitest run --environment node` — 그냥 `npx vitest`는 jsdom이 없어 실패합니다). Rust를 고쳤으면 `cd src-tauri && cargo test --lib <모듈>`. 여러 세션이 cargo를 함께 돌리면 target 잠금을 기다립니다. 정상이니 `cargo clean`은 하지 않습니다. 남의 파일에서 난 오류는 무시하고 주인에게 알립니다.
- `npm run tauri dev` · 빌드 실행 · vite는 띄우지 않습니다. **eqmux.exe는 절대 끄지 않습니다**(모든 세션이 그 안에서 돕니다).
- 실물로만 확인할 수 있는 것은 보고에 적습니다. 리드가 모아 실기 확인 목록으로 만듭니다.
- 끝나면(또는 막히면) eqmux-eb에게 SendMessage로 보고합니다: 행 번호별 결과 · 남의 파일을 건드린 곳 · 테스트 결과 · 실기 확인이 필요한 것.

## 분담

| 세션 | 영역 | 행 | 소유 파일 |
|---|---|---|---|
| eqmux-90 | git 화면 · 사이드 패널 git 탭 · diff | B297 B298 B299 B300 B304 U190 U191 U192 (8) | `GitScreen.tsx` `GitDiffEditor.tsx` `GitPanelTab.tsx` `diffKeys.ts` `gitGraph.ts` `gitWrite.ts` `backend/git.ts` `gitx.rs` `diff.rs` `i18n/git.ts` |
| eqmux-b1 | 편집기 · 파일 탭 · 문서 탭 · 환경변수 · 확장 · 사이드 패널 틀 | B296 B301 B302 B303 U189 S28 (6) | `CodeEditor.tsx` `MissionExplorerTab.tsx` `MdViewTab.tsx` `markdownHtml.ts` `SidePanel.tsx` `EnvPanelTab.tsx` `ExtensionsPanelTab.tsx` `backend/env.ts` `backend/extensions.ts` `backend/panels.ts` `backend/watch.ts` `fsx.rs` `extensions.rs` `appenv.rs` `i18n/panels.ts` `i18n/extensions.ts` |
| eqmux-11 | 브라우저 · 서버 · 포트 · 로그 · 비밀값 · 진단 · 과거 세션 검색 | B305 B306 B307 B308 B310 U182 S24 (7) | `BrowserPanelTab.tsx` `ServerPanelTab.tsx` `PortsPanelTab.tsx` `LogsPanelTab.tsx` `HistorySearch.tsx` `backend/browser.ts` `backend/ports.ts` `backend/secrets.ts` `backend/secretPatterns.json` `backend/diag.ts` `backend/history.ts` `browser.rs` `ports.rs` `secrets.rs` `diag.rs` `store.rs` `history.rs` `i18n/history.ts` |
| eqmux-75 | 터미널 페인 · PTY 수명 · 재개/재시작 · 붙여넣기 · 크래시 복구 | B287 B288 B291 B293 B294 B295 U188 S27 (8) | `TerminalPane.tsx` `SessionDetailPanel.tsx` `termPaths.ts` `webglBudget.ts` `backend/pty.ts` `backend/agent.ts` `backend/recovery.ts` `lib.rs` `agent.rs` `clip.rs` `recovery.rs` `quit.rs` `job.rs` `macproc.rs` `agentscan.rs` `i18n/session.ts` |
| eqmux-ce | 워크스페이스 연결 · 앱 바 · 관제 · 종료 · 창 · 설정 화면 | S23 B289 B290 B292 U187 S25 S26 B286 (8) | `WorkspaceConnection.tsx` `AppBar.tsx` `Dashboard.tsx` `ControlCenter.tsx` `ExitDialog.tsx` `DefaultTerminalSetup.tsx` `LaunchMode.tsx` `launchRules.ts` `LayoutPicker.tsx` `gridSlots.ts` `CrashRecovery.tsx` `Settings.tsx` `backend/workspaces.ts` `backend/settings.ts` `backend/layout.ts` `workspace.rs` `winstate.rs` `tray.rs` `i18n/control.ts` `i18n/shell.ts` `i18n/settings.ts` |
| eqmux-32 | 대화 · 메시지 버스 · CLI · 트랜스크립트 · 이벤트 · Jump | B274 B281 B283 B285 B309 U184 U185 U186 (8) | `ConversationTab.tsx` `TranscriptPane.tsx` `JumpPalette.tsx` `backend/conversation.ts` `backend/events.ts` `backend/jump.ts` `backend/transcript.ts` `messages.rs` `ipc.rs` `cli.rs` `transcript.rs` `main.rs` `bin/*` `i18n/jump.ts` |
| eqmux-b7 | 임무 · 검토 · 팀 편성 · 역할 라이브러리 | B275 B276 B277 B278 B279 B280 B282 U183 (8) | `Missions.tsx` `MissionReview.tsx` `reviewRules.ts` `EditConflicts.tsx` `RoleLibrary.tsx` `TeamCasting.tsx` `TeamComposition.tsx` `backend/missions.ts` `backend/team.ts` `backend/roles.ts` `backend/library.ts` `missions.rs` `owns.rs` `roles.rs` `team.rs` `library.rs` `i18n/missions.ts` `i18n/roles.ts` |
| eqmux-eb (리드) | 공용 상태 · 통합 · 원장 | B284 (1) | `App.tsx` `state.ts` `types.ts` `backend/mock.ts` `components/ui.tsx` `keynav.ts` `screens.css` `styles.css` `i18n/common.ts` `interview.csv` `docs/**` |

### 겹치는 자리

- **`lib.rs`**(주인 eqmux-75): B275 `team_load`(b7) · B277 임무 경로(b7) · B289 · B290 · S23 `ws_repath` · `ws_register` · 새 이름 바꾸기 커맨드(ce) · B301 `fs_tree` 비동기 전환(b1) · B305 새 창 링크(11) · U182 로그 검색(11) · S26 창 위치(ce). 각자 국소 수정 후 eqmux-75에게 알립니다. 커맨드를 새로 등록하면 `invoke_handler` 목록 한 줄만 더합니다.
- **`ControlCenter.tsx`**(주인 eqmux-ce): B287 · B291(75)은 국소 수정 후 알립니다.
- **`backend/mock.ts` · `state.ts` · `App.tsx` · `types.ts`**(리드): B287 `sessionExited`(75) · S25 셸 다시 열기(ce) · B292 복원 슬롯 수(ce) · B302 편집 보호(b1) · B306 덮개 판정(11) · U185 레이어 스택(32) · U192(90) · B280(b7) · B286 · U187(ce). 국소 수정 후 eqmux-eb에게 알립니다.
- **`workspace.rs`**(주인 eqmux-ce): B277(b7) · B299 git 출력 판정(90)은 국소 수정 후 알립니다.
- **`store.rs`**(주인 eqmux-11): B288 종료 기록(75)은 국소 수정 후 알립니다.
- **`agent.rs`**(주인 eqmux-75): B283 UNC 경로(32) · B309 상태 기록(32)은 국소 수정 후 알립니다.
- **`LogsPanelTab.tsx`**(주인 eqmux-11): B309(32)는 국소 수정 후 알립니다. `events.ts`는 B309와 U186이 함께 고치므로 eqmux-32가 둘 다 맡습니다.
- **`ServerPanelTab.tsx`**(주인 eqmux-11): B276 종료 코드 표식(b7)은 국소 수정 후 알립니다.
- **`backend/team.ts`**(주인 eqmux-b7): B292 복원 슬롯 수(ce)는 국소 수정 후 알립니다.
- **S23 · B289 · B290**은 모두 `ws_repath` · `ws_register`를 고칩니다. eqmux-ce 한 세션이 맡아 순서대로 고칩니다. 이름은 화면 말고도 자동 세션 이름 접두(`types.ts` `projectStem`)와 다른 프로젝트 주소(`conversation.ts` `projectLabels`)에 쓰입니다. 이 두 곳은 eqmux-32 · 리드와 맞춥니다.
- **`i18n/panels.ts`**(주인 eqmux-b1): eqmux-11도 키를 덧붙입니다. 덧붙이기 전에 다시 읽습니다. 대화 · 이벤트 문구(U186)는 `i18n/common.ts`(리드)에 덧붙이고 알립니다.

## 기준선

수정 전 작업 트리(S23 · 원장 행만 추가된 상태)에서 리드가 돌린 결과는 `docs/fix-0.6.2-qa-status.md`에 적습니다.
