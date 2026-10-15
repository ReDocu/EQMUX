# EQMUX 0.5.0 QA 수정 분담

2026-10-15 · 리드 eqmux-77 · 근거 `interview.csv`의 0.5.0 QA 라운드(B67–B111 · U29–U66 · P24–P40 · T1–T29), 요약 `docs/qa-0.5.0-usability.md`

## 작업 방식

- 다섯 세션이 **같은 작업 트리**(`D:\workspace\workspace\EQMUX`, 브랜치 `sub_main`)에서 일한다. 워크트리를 따로 만들지 않는다.
- 파일마다 **주인**이 있다(아래 표). 남의 파일은 고치지 않는다. 꼭 필요하면 작은 국소 수정만 하고, 고치기 직전에 다시 읽고(Edit 정확 일치), 주인에게 SendMessage로 한 줄 알린다.
- git `commit`·`checkout`·`stash`·`reset`·`restore` 금지. 커밋은 리드가 마지막에 한다. 지금 있는 미커밋 변경(QA 원장, 웹 페이지 열기 설정 — `browser.rs`·`lib.rs` `launch_web`·`browser.ts` `openLink` 등)은 살아 있는 작업이다. 지우지 않는다.
- `interview.csv`는 리드만 고친다. 각 세션은 보고에 행 번호별 결과(수정 · 일부 · 안 함+이유)를 적는다. 리드가 `[0.5.x 수정 완료]` 머리말로 원장에 반영한다.
- `[실기 미확인]` 행도 코드 근거가 맞으면 고친다. 실물로만 확인할 수 있는 것은 보고에 적어 두면 리드가 QA 빌드로 확인한다.
- 긍정 평가 행(P28·P29·P32)과 종합 행은 할 일이 아니다. 종합 행이 가리키는 B·U 행을 고치면 된다.
- **P26(eqmux 명령 자동 승인)**: 사용자가 적용을 결정했다(2026-10-15). 리드가 `lib.rs` `write_hook_settings`에 넣었다.
- 검증: `npx tsc --noEmit`, `npm test`, `cd src-tauri && cargo test --lib`. 남의 파일에서 난 오류는 무시하고 주인에게 알린다. `npm run tauri dev`·QA 빌드는 띄우지 않는다(리드가 한다).
- 고친 로직마다 실패하면 깨지는 테스트를 하나 남긴다(분기·파서·상태 전이). 문구만 바꾼 것은 테스트 없이.
- 코드 스타일은 주변 코드를 따른다(한국어 주석 밀도·이름). i18n은 한·영 둘 다 넣는다. i18n 사전은 자기 영역 파일에 키를 덧붙인다(같은 파일이면 다시 읽고 끝에 추가).
- CSS: `screens.css`·`styles.css`는 eqmux-18 소유지만, 모두 **파일 끝에 자기 블록을 덧붙이는 것**은 허용한다(`/* 0.5.x QA <세션>: … */` 머리 주석).
- 끝나면(또는 막히면) eqmux-77에게 SendMessage로 보고한다: 행 번호별 결과 · 남의 파일을 건드린 곳 · 테스트 결과 · 실기 확인이 필요한 것.

## 분담

| 세션 | 영역 | 행 | 소유 파일 |
|---|---|---|---|
| eqmux-18 | 앱 셸 · 레이어 · 벨 · 설정 · 서버 탭 · 단축키 | B71–B81 · U33–U40 · P30 | `App.tsx` `AppBar.tsx` `state.ts` `backend/attention.ts` `ScreenOverlay.tsx` `components/ui.tsx` `LayoutPicker.tsx` `SidePanel.tsx` `ServerPanelTab.tsx` `backend/ports.ts` `Settings.tsx` `backend/settings.ts` `backend/flags.ts` `store.rs` `i18n/shell.ts` `i18n/settings.ts` `i18n.ts` `styles.css` `screens.css` |
| eqmux-08 | 관제 · 페인 헤더 · 대시보드 · 세션 수명주기 · 엔진 | B82–B88 · U41–U49 · U31 | `ControlCenter.tsx` `Dashboard.tsx` `SessionDetailPanel.tsx` `TerminalPane.tsx` `types.ts` `backend/agent.ts` `backend/mock.ts` `lib.rs` `i18n/control.ts` `i18n/session.ts` |
| eqmux-66 | 대화 · 손 에이전트 넣기 · 임무 · 팀 캐스팅·편성 · 역할 라이브러리 | B89–B101 · U50–U57 · B69 · B70 · U32 · P35 | `backend/conversation.ts` `ConversationTab.tsx` `Missions.tsx` `backend/missions.ts` `backend/roles.ts` `RoleLibrary.tsx` `TeamCasting.tsx` `TeamComposition.tsx` `backend/team.ts` `backend/library.ts` `backend/panels.ts` `library.rs` `team.rs` `missions.rs` `i18n/roles.ts` |
| eqmux-8a | eqmux CLI · 워크스페이스 연결 · 실행 방식 · 크래시 복구 · 종료 · git diff | B102–B111 · U58–U66 · P24 · P25 · U30 | `cli.rs` `ipc.rs` `messages.rs` `roles.rs` `main.rs` `browser.rs` `recovery.rs` `diff.rs` `WorkspaceConnection.tsx` `LaunchMode.tsx` `DefaultTerminalSetup.tsx` `CrashRecovery.tsx` `ExitDialog.tsx` `backend/shutdown.ts` `backend/recovery.ts` `backend/workspaces.ts` `GitDiffEditor.tsx` `GitPanelTab.tsx` `i18n/git.ts` |
| eqmux-77 | 에이전트 상태 · PTY 세대 · 통합 · 원장 · 실기 | B67 · B68 · U29 · 실기 재확인 | `agent.rs` `backend/pty.ts` `backend/browser.ts` `interview.csv` `docs/**` |

### 겹치는 자리

- **B68**(기동 직후 빨간 '프로세스 종료'): 원인은 이전 세대가 아니라 기동(killAndWait)이 셸을 일부러 끝낸 exit였다. 리드가 `TerminalPane.tsx` onPtyExit 한 곳만 고쳤다(재스폰 중이면 찍지 않음). `lib.rs`의 emit은 killAndWait가 기다리므로 그대로 둔다. eqmux-08에게 알렸다.
- **B69 · T23**(캐스팅이 확인 없이 세션 종료): 종료 경로가 `mock.ts:751-761`(eqmux-08 소유)에 있다. eqmux-66이 확인창·현재 편성으로 열기를 만들고, `mock.ts`는 국소 수정 후 eqmux-08에게 알린다.
- **B81**(Ctrl+Alt+숫자가 AltGr를 삼킴): 단축키 처리가 `ControlCenter.tsx`(eqmux-08)에 있으면 eqmux-18이 국소 수정하고 알린다.
- **U51 · U52 · B90**(넣기 칩·팝오버): 칩이 `ControlCenter.tsx`에 있다. eqmux-66이 국소 수정하고 eqmux-08에게 알린다.
- **B109**(복구 안내 문구)가 `i18n/control.ts`·`i18n/session.ts`(eqmux-08)를 건드리면 키 추가만 한다.
- **B111**(세션 안내문 ↔ 사용법): 안내문이 `lib.rs`(eqmux-08)에 있다. eqmux-8a가 문구 줄만 고치고 알린다.
- **ui.tsx**의 ConfirmDialog·ScreenOverlay는 eqmux-18 소유다. U45·U46·U49(eqmux-08), U61(eqmux-8a)이 공통 부품을 바꿔야 하면 eqmux-18에게 요청하거나 국소 수정 후 알린다.

## 2차 — 일부만 고친 8건 마무리 (2026-10-15 사용자 요청)

규칙은 위와 같다(자기 소유 파일 · 남의 파일은 국소 수정 + 알림 · git 금지 · 원장은 리드만 · 로직마다 테스트 · i18n 한·영).

| 행 | 남은 것 | 맡은 세션 |
|---|---|---|
| B72 | 종료·배치·복구 모달이 떠 있는 동안 단축키·벨·OS 토스트 이동을 막는다 | eqmux-18 |
| U37 | 다이얼로그 포커스 가두기(Tab 순환), Segmented 화살표 이동 | eqmux-18 |
| U29 | 한국어 화면의 영어 대문자 라벨을 사전으로 — 셸·오버레이 쪽(FULL VIEW 등) | eqmux-18 |
| U29 | 같은 일 — 관제 쪽(SLOTS · N SESSIONS · ENGINE · MAIN · PTY ONLINE · OUTPUT · WAL · MEM · STARTING/WAITING/IDLE/SHELL 상태 라벨) | eqmux-08 |
| B83 | 번호 칸의 피어 끝 조각(사용자 요청)은 유지하되 슬롯 번호도 화면에 남긴다 — 끝 조각을 보일 때 슬롯 번호를 작게 함께 보인다(헤더·레일·대시보드) | eqmux-08 |
| B92 | 앱을 켜기 전 배정의 완료 보고 — 배정 시각을 임무 파일에 남겨 재시작 뒤에도 판정한다 | eqmux-66 |
| B93 | 문구 대신 동작을 원래 약속에 맞춘다 — 작업 중이면 턴이 끝날 때 브리프를 넣고, 죽은 세션은 인박스에 쌓아 재개 때 흘린다 | eqmux-66 |
| U59 | CLI 문구를 표시 언어(English) 설정에 맞춘다 (진행 중) | eqmux-8a |
| U63 | 복구 창에서 세션 상세를 바로 열기, 알림 센터에서 복구 목록 다시 열기 | eqmux-8a (ControlCenter는 08, App.tsx는 18에 국소 수정 알림) |
