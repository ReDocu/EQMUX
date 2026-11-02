# EQMUX 0.6 QA 수정 분담

2026-11-02 · 리드 eqmux-68 · 근거 `interview.csv`의 0.6 QA 1·2차 라운드(B169–B247 · U113–U171 · P60–P90 · T52–T71), 요약 `docs/qa-0.6-usability.md`

## 이미 끝난 것 (리드 · 미커밋)

"먼저 고칠 것" 21건: B169 B170 B171 B172 B175 B184 B198 B199 B200 B201 B203 B204 B209 B214 B222 B223 B225 U144 P76 P77 U133(B169와 같이 고침).
이 변경은 살아 있는 작업이다. 지우거나 되돌리지 않는다.

할 일 아님: 긍정 행(U141 · P69 · P70 · P90)과 과업 행(T52–T71). 과업 행이 가리키는 B·U·P 행을 고치면 된다.

## 작업 방식

- 여덟 세션이 **같은 작업 트리**(`D:\workspace\workspace\EQMUX`, 브랜치 `sub_main`)에서 일한다. 워크트리를 따로 만들지 않는다.
- 파일마다 **주인**이 있다(아래 표). 남의 파일은 작은 국소 수정만 하고, 고치기 직전에 다시 읽고(Edit 정확 일치), 주인에게 SendMessage로 한 줄 알린다. 파일 전체를 다시 쓰지 않는다. 포매터를 파일 전체에 돌리지 않는다.
- git `commit` · `checkout` · `stash` · `reset` · `restore` 금지. 커밋은 리드가 마지막에 한다.
- `interview.csv`와 `docs/qa-0.6-usability.md`는 리드만 고친다. 각 세션은 보고에 행 번호별 결과(수정 · 일부 · 안 함+이유)를 적는다.
- 줄 끝(CRLF/LF)은 파일마다 다르다. Edit 도구를 쓰거나, 스크립트로 고칠 땐 바이트 단위로 원래 줄 끝을 지킨다.
- UI 평서문은 합니다체. i18n은 한·영 둘 다 넣는다(`src/i18n/*.ts`, 자기 영역 사전에 키를 덧붙인다).
- CSS: `screens.css`는 리드 소유지만, 자기 규칙을 고치는 국소 Edit와 **파일 끝 블록 추가**(`/* 0.6 QA <세션>: … */`)는 허용한다.
- 고친 로직마다 실패하면 깨지는 테스트를 하나 남긴다(분기 · 파서 · 상태 전이). 문구만 바꾼 것은 테스트 없이.
- 검증: `npx tsc --noEmit`, `npm test`(= `vitest run --environment node` — 그냥 `npx vitest`는 jsdom이 없어 실패한다), Rust를 고쳤으면 `cd src-tauri && cargo test --lib <모듈>`. `ports::…session_job` 실패 1건은 원래 있던 것이다. 남의 파일에서 난 오류는 무시하고 주인에게 알린다.
- `npm run tauri dev` · QA 빌드 · vite는 띄우지 않는다. **eqmux.exe는 절대 끄지 않는다**(모든 세션이 그 안에서 돈다).
- 실물로만 확인할 수 있는 것은 보고에 적는다. 리드가 모아 실기 확인 목록으로 만든다.
- 끝나면(또는 막히면) eqmux-68에게 SendMessage로 보고한다: 행 번호별 결과 · 남의 파일을 건드린 곳 · 테스트 결과 · 실기 확인이 필요한 것.

## 분담

| 세션 | 영역 | 행 | 소유 파일 |
|---|---|---|---|
| eqmux-d7 | git 화면 · 사이드 패널 git 탭 | B176 B177 B178 B179 B180 B189 U114 U124 U125 U126 U134 P61 P62 U140 B240 B241 U162 U165 U166 (19) | `GitScreen.tsx` `GitDiffEditor.tsx` `GitPanelTab.tsx` `backend/git.ts` `gitx.rs` `diff.rs` `i18n/git.ts` |
| eqmux-79 | 확장 · 환경변수 · 서버 탭 | B181 B182 B190 B191 B192 B193 B216 B217 B218 B239 U115 U117 U131 U145 P63 P67 P68 (17) | `ExtensionsPanelTab.tsx` `backend/extensions.ts` `extensions.rs` `EnvPanelTab.tsx` `ServerPanelTab.tsx` `backend/ports.ts` `i18n/panels.ts` |
| eqmux-52 | 사이드 패널 파일 · 문서 · 로그 · 포트 · 브라우저 · 편집기 · Jump · 과거 세션 | B186 B215 B219 B220 B221 B224 B242 B243 B244 B245 U163 U164 P84 P85 P86 P87 P88 (17) | `MissionExplorerTab.tsx` `MdViewTab.tsx` `markdownHtml.ts` `LogsPanelTab.tsx` `PortsPanelTab.tsx` `BrowserPanelTab.tsx` `browser.rs` `CodeEditor.tsx` `JumpPalette.tsx` `HistorySearch.tsx` `backend/history.ts` `SidePanel.tsx` |
| eqmux-17 | 대시보드 · 자리 비운 사이 · 승인함 · 메시지 버스 · 트레이 · 설정 일부 · 비밀값 | B173 B187 B210 B211 B212 B213 B235 B237 B238 U121 U122 U157 U158 B183 B194 B195 B196 B197 U118 U132 P65 (21) | `Dashboard.tsx` `backend/away.ts` `backend/budget.ts` `backend/conversation.ts` `ConversationTab.tsx` `cli.rs` `ipc.rs` `messages.rs` `backend/secretPatterns.json` `tray.rs` `styles.css`(U118) |
| eqmux-ae | 임무 · 담당 경로 · 트랜스크립트 · 첫 실행 고지 문구 · README · 사용 문서 | B185 B188 U113 U119 U120 U123 U135 U136 U137 P60 B236 U159 U160 U116 U127 U128 U138 P74 P75 P83 U161 (21) | `Missions.tsx` `MissionReview.tsx` `backend/missions.ts` `missions.rs` `owns.rs` `EditConflicts.tsx` `backend/attention.ts` `TranscriptPane.tsx` `SubagentList.tsx` `FirstRunNotice.tsx` `README.md` `docs/site/docs.md` · `i18n/missions.ts` |
| eqmux-dd | 워크스페이스 열기 · 실행 방식 · 기본 터미널 · 크래시 복구 · 종료 · 설정 화면 | B202 B226 B227 B228 B229 B230 B231 U142 U146 U147 U148 U149 U150 U151 P71 P72 P80 P81 (18) | `WorkspaceConnection.tsx` `backend/workspaces.ts` `workspace.rs` `LaunchMode.tsx` `launchRules.ts` `DefaultTerminalSetup.tsx` `CrashRecovery.tsx` `ExitDialog.tsx` `Settings.tsx` `backend/settings.ts` `backend/agentprobe.ts` `i18n/shell.ts` `i18n/settings.ts` |
| eqmux-88 | 팀 캐스팅 · 팀 편성 · 역할 라이브러리 · 실행 방식 카드 | B246 B247 U167 U168 U169 U170 U171 P66 P78 P79 P89 U129 U130 U139 P64 (15) | `TeamCasting.tsx` `TeamComposition.tsx` `backend/team.ts` `RoleLibrary.tsx` `backend/library.ts` `library.rs` `team.rs` `PersonaAvatar.tsx` `i18n/roles.ts` |
| eqmux-68 (리드) | 관제 페인 · 세션 수명주기 · 상태 바 · 통합 · 원장 | B174 B205 B206 B207 B208 B232 B233 B234 U143 U152 U153 U154 U155 U156 P73 P82 (16) | `ControlCenter.tsx` `SessionDetailPanel.tsx` `TerminalPane.tsx` `types.ts` `backend/mock.ts` `backend/agent.ts` `lib.rs` `agent.rs` `state.ts` `App.tsx` `AppBar.tsx` `LayoutPicker.tsx` `components/ui.tsx` `screens.css` `i18n/control.ts` `i18n/session.ts` `i18n/common.ts` `interview.csv` `docs/**` |

### 겹치는 자리

- **LaunchMode.tsx**: 주인은 eqmux-dd. eqmux-88의 U129 · U130 · U139 · P64(실행 방식 카드)는 국소 수정 후 eqmux-dd에게 알린다.
- **U162**(키보드 접근): git 부분은 eqmux-d7, 환경변수 값 복사는 `EnvPanelTab.tsx`(eqmux-79)에 국소 수정 후 알린다.
- **U125**(백엔드 오류가 한국어): eqmux-d7은 git 오류, 환경변수 오류는 eqmux-79. **B195 · U123**(Rust가 만든 한국어 문구)은 eqmux-17 · eqmux-ae가 맡되 `lib.rs`를 고치면 리드에게 알린다.
- **U157**(상태 토큰 · '응답 대기'/'승인 대기')은 `types.ts` `statusText` · `ui.tsx`(리드)를 건드린다. eqmux-17이 국소 수정 후 알린다. U152 · U156(리드)과 같은 이름을 쓴다 — 먼저 정한 쪽이 상대에게 알린다.
- **B219**(포트 패널 범위)가 `lib.rs`를 고치면 리드에게 알린다. **B220**(브리프 전달 발신 실패)은 `sendConversation`의 반환값(오류 문자열 | null)을 쓴다 — `backend/conversation.ts`는 eqmux-17 소유.
- **B236 · U160**: `TranscriptPane.tsx`는 리드가 B214(대기 중 입력 막기)를 넣었다. 다시 읽고 고친다.
- **B226 · U148 · U149**(설정)와 **B183 · U132**(설정 문구): `Settings.tsx` 주인은 eqmux-dd. eqmux-17은 국소 수정 후 알린다.
- **U116 · U127 · U128 · U138 · U142 · U146 · U147 · P81**: 모두 `FirstRunNotice.tsx`. 주인은 eqmux-ae. eqmux-dd의 U142 · U146 · U147 · P81은 국소 수정 후 eqmux-ae에게 알린다.
