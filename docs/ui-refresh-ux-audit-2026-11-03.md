# 화면 갱신 · UX 점검 (2026-11-03)

기준 브랜치 `sub_main`(`a57cd97`). 앱을 띄우지 않고 코드만 읽었습니다. 전역 갱신 구조, 터미널·사이드 패널, 전체 화면·대화상자로 나눠 봤습니다. 이미 알려진 B271–B273 · U177–U181과 CPU 문서(`cpu-optimization-2026-10-17.md`, `cpu-ram-followup-2026-10-17.md`)에 있는 항목은 다시 적지 않았습니다.

확신도 표기는 이렇습니다.
- **확인**: 원인 코드를 직접 다시 읽어 맞는지 봤습니다.
- **코드**: 점검 중에 코드로 확인했지만 이 문서를 쓰며 다시 읽지는 않았습니다.
- **추정**: 증상이 실제로 나는지는 실앱에서 봐야 합니다.

## 요약

- **갱신 문제의 대부분은 원인이 한 가지입니다.** `tick()`에 기대는 계산 안에서 `.map(x => ({...x}))`로 새 객체를 만들거나, hydrate가 객체를 통째로 갈아 끼웁니다. 그러면 `<For>`가 행을 새로 만듭니다. 사용자에게는 hover 깜빡임, 포커스·글자 선택 풀림, 가끔 클릭이 씹히는 현상으로 보입니다. `<select>`는 첫 항목으로 돌아가 **화면과 실제 값이 달라집니다.**
- **긴 목록이 최신을 따라가지 않습니다.** 대화 탭과 트랜스크립트는 오래된 것이 맨 위에 있고 새 항목은 아래에 붙습니다. 그런데 스크롤을 맞추는 코드가 없습니다.
- **'읽는 중'과 '없음'을 구분하지 않습니다.** 탭을 열 때마다 잠깐 "커밋이 없습니다", "서버 없음", "미리보기를 불러올 수 없습니다"가 보입니다.
- **UX에서 가장 급한 것:** 되돌려 보내기 창에서 Enter를 누르면 창이 '취소'로 닫힙니다. 그리고 B272와 같은 종류인 '처리 중 잠금 없음'이 10곳 넘게 남아 있습니다.

## 1. 화면 갱신

| # | 증상 | 위치 | 원인 → 개선안 | 심각도 · 확신도 |
|---|---|---|---|---|
| R1 | 에이전트가 바쁠 때 git 패널 커밋 행 · 포트 행 · 워크스페이스 연결 팝업 행 · 팀 캐스팅 페르소나 메뉴에서 hover가 깜빡이고, 포커스·선택이 풀리고, 클릭이 가끔 씹힘 | `GitPanelTab.tsx:83-95`, `PortsPanelTab.tsx:78-104`, `WorkspaceConnection.tsx:48-63`, `TeamCasting.tsx:122-150` | `scopeWorkspace()`(`state.ts:189`)나 `activeWs()`가 `tick()`을 읽습니다. 그래서 방송마다 `commits.map(c => ({...c, badges}))`, `toRow`, `{label, items}`가 새 객체를 만듭니다. → 커밋은 `real()`에만 기대는 메모로 떼어 냅니다. 포트·팝업은 `createMemo(() => scopeWorkspace()?.id)`처럼 id만 받습니다. 그룹 목록은 `<Index>`로 그립니다 | 높음 · 확인(git 패널), 코드(나머지) |
| R2 | 충돌을 '세션에게 맡기기' 창에서 둘째 세션을 골라도 다음 방송 뒤 첫 세션으로 보임. 실제로는 고른 세션에게 보냄 | `GitScreen.tsx:178-179·1580` | R1과 같은 이유로 `<option>`이 다시 만들어지면 브라우저가 첫 항목을 고릅니다. → option에 `selected={s.id === props.to}`를 답니다. `ControlCenter.tsx:1544`가 이미 이렇게 합니다 | 중간 · 코드 |
| R3 | 역할 라이브러리에서 페르소나를 저장하거나 파일이 바뀐 뒤 '기본 직무'가 '미지정'으로 보임. 저장되는 값은 그대로 | `RoleLibrary.tsx:672-674`, `mock.ts:1408` | `hydrateLibrary`가 `JOBS.splice(...)`로 객체를 바꿔서 option이 다시 만들어집니다. → R2와 같은 `selected` | 중간 · 코드 |
| R4 | 연결·관리 팝업에서 워크스페이스를 등록·해제·재지정하고 닫으면 컨트롤 센터가 초기화됨. 줌 · 트랜스크립트 탭 · 상세 드로어 · 전체 화면이 풀리고 터미널이 다시 붙으며 깜빡임 | `App.tsx:259-264`, `mock.ts:1413-1417` | Match 안 IIFE의 `listWorkspaces().find()`가 추적됩니다. 게다가 `hydrateWorkspaces`가 `length = 0` 뒤에 새 객체를 push합니다. → 조회를 `untrack`으로 감싸고, hydrate는 id 기준으로 기존 객체를 갱신합니다(`reconcile(list, { key: "id" })`) | 중간 · 확인 |
| R5 | 임무를 하나 바꿀 때마다 임무 목록 행이 즉시 한 번, 500ms 뒤 한 번 더 다시 만들어짐. 그때 페르소나·직무 목록도 같이 다시 그려짐 | `mock.ts:1314-1317`, `watch.ts:47-50`, `src-tauri/src/lib.rs:2169-2176` | hydrate가 객체를 갈아 끼웁니다. 앱이 직접 쓴 `missions/*.md`도 파일 감시로 돌아와 `refreshMissions`·`refreshLibrary`가 다시 돕니다. → hydrate를 reconcile로 바꾸고, 바뀐 경로에 해당하는 쪽만 다시 읽습니다 | 중간 · 코드 |
| R6 | 대화 탭을 열면 가장 오래된 메시지가 보이고, 새 메시지가 와도 화면이 그대로임 | `ConversationTab.tsx:453-469`, `screens.css:948` | 오래된 순서로 쌓는데 스크롤 코드가 없습니다. → 열 때 맨 아래로 내립니다. 길이가 늘었을 때 바닥 근처(40px)였다면 따라 내려갑니다. [이전 불러오기]는 `TerminalPane.tsx:885-888`의 높이 보정을 그대로 씁니다 | 높음 · 확인 |
| R7 | 트랜스크립트도 맨 위에서 시작하고 새 턴을 따라가지 않음. 갱신될 때마다 모든 턴을 새로 만들어 드래그한 선택이 풀림 | `TranscriptPane.tsx:35-45·246·316` | R6과 같습니다. 게다가 `setData`가 새 턴 객체를 넣습니다. → 로그가 덧붙이기만 하므로 `<Index>`로 그리고, R6의 따라 내려가기를 넣습니다 | 중간 · 코드 |
| R8 | 레일에서 다른 세션을 고르면 새 세션 머리 아래에 앞 세션의 트랜스크립트가 남음. 첫 로드 중에는 "트랜스크립트 없음"이 깜빡임 | `TranscriptPane.tsx:25-26·53·281-284` | 세션이 바뀌면 `openTurn`만 비웁니다. → `data`·`fallback`을 비우고, 로딩 상태와 `scrollTop = 0`을 둡니다 | 중간 · 코드 |
| R9 | 탭을 열 때마다 '없음'이 먼저 보임. git 패널 "커밋이 없습니다 · ↑0 ↓0", 로그 "조건에 맞는 로그가 없습니다", MCP "서버 없음", 파일 탭 "미리보기를 불러올 수 없습니다", 서버 탭 빈 자리 | `GitPanelTab.tsx:99-113·448-452`, `LogsPanelTab.tsx:266-275`, `ExtensionsPanelTab.tsx:624·704`, `MissionExplorerTab.tsx:152-159·549-560`, `ServerPanelTab.tsx:279` | `undefined`가 '읽는 중'과 '실패·없음'을 함께 뜻합니다. → 탭마다 `loading` 신호를 두고 "읽는 중…"을 보입니다. MCP와 파일 트리는 워크스페이스가 바뀌면 이전 결과를 비웁니다. 스킬 탭(B216)의 경로 대조를 그대로 씁니다 | 중간 · 코드 |
| R10 | 로그 탭에서 아래쪽 옛 로그를 읽는 중에 이벤트가 오면 내용이 밀리고 선택이 풀림. 대시보드 이벤트 피드도 같음 | `LogsPanelTab.tsx:100-114·253`, `Dashboard.tsx:58·602`, `ControlCenter.tsx:362·374-377` | 이벤트마다 `es.map(toLog)`로 200행을 새로 만들고, 새 행은 위에 끼워 넣습니다. → id로 이전 객체를 재사용하거나 `equals`를 씁니다. 스크롤이 맨 위가 아니면 갱신을 보류하고 "새 로그 N건 ▲" 칩을 띄웁니다 | 중간 · 코드 |
| R11 | 10초마다 git 화면 브랜치 사이드바 · 변경 파일 목록 · 워크트리 레일이 다시 만들어짐(같은 값이어도) | `GitScreen.tsx:281-287·307`, `ControlCenter.tsx:309-315` | 폴링 신호에 `equals`가 없습니다. → `GitPanelTab.tsx:47`처럼 JSON `equals`를 겁니다 | 낮음 · 코드 |
| R12 | 임무 [⎇ 체크아웃] 뒤 레일과 git 패널 브랜치가 최대 10초 늦게 바뀜 | `Missions.tsx:52-54`, `ControlCenter.tsx:309-317`, `GitPanelTab.tsx:74-78` | 10초 폴링만 믿습니다. → `gitChanged` 틱 하나를 두고, 체크아웃과 git 명령 뒤에 올립니다 | 낮음 · 코드 |
| R13 | 승인함 [허용]·[거부]가 훅이 손을 뗀 뒤에도 최대 30초 더 보임. 누르면 실패 토스트가 뜸 | `agent.ts:246·257-262`, `Dashboard.tsx:577-580` | 만료 판정이 30초 타이머로 갱신되는 `sinceMs`에 기댑니다. → `Date.now() - sinceTs`로 판정합니다 | 낮음 · 코드 |
| R14 | 창·분할선·패널 크기가 바뀐 뒤 바닥에서 보던 터미널이 바닥에서 떨어질 수 있음 | `TerminalPane.tsx:927-936` | `resize()` 뒤에 `atBottom()`을 잽니다. attach 경로(991)는 앞에서 잽니다. → 판정을 resize 앞으로 옮깁니다(한 줄) | 중간 · 확인(순서), 추정(증상) |
| R15 | 스폰이나 [에이전트 기동] 직후 패널을 열거나 분할선을 끌면, TUI가 옛 폭으로 그려 다음 리사이즈까지 줄이 깨짐 | `TerminalPane.tsx:776-778·929-933·994` | 스폰을 기다리는 동안 보낸 `resizePty`는 실패를 삼킵니다. 스폰 뒤에는 `lastCols = term.cols`로 덮어써서 어긋난 것을 놓칩니다. → 스폰에 넘긴 cols·rows를 `lastCols`·`lastRows`에 넣고 바로 `sync()`를 부릅니다 | 중간 · 추정 |
| R16 | 패널 열기·닫기, 레일 접기 직후 약 100ms 동안 터미널이 잘리고, 맞춰질 때 한 번 더 깜빡임 | `App.tsx:204`, `AppBar.tsx:384`, `ControlCenter.tsx:1294·1337` | 줌(`ControlCenter.tsx:132-136`)만 바로 맞추고, 나머지는 100ms 디바운스를 기다립니다. → `panelOpen`·`railOpen`·`panelSide`가 바뀔 때 rAF에서 `syncSessionTerminal`을 부릅니다 | 낮음 · 코드 |

## 2. UX

| # | 증상 | 위치 | 개선안 | 심각도 · 확신도 |
|---|---|---|---|---|
| U1 | 임무 [되돌려 보내기] 창의 의견 칸에서 Enter(줄바꿈, 한글 조합 확정, Shift+Enter 모두)를 누르면 창이 취소로 닫힘. 쓴 의견이 사라지고 아무 알림도 없음 | `ui.tsx:218-224`, `MissionReview.tsx:256-277` | ConfirmDialog의 Enter 처리 첫 줄에 `if (e.target instanceof HTMLTextAreaElement \|\| e.isComposing) return;`을 넣습니다. 처음 포커스는 textarea에 둡니다 | 높음 · 확인 |
| U2 | git 명령이 도는 동안 우클릭 메뉴(브랜치 만들기 · cherry-pick · reset · stash)와 충돌 [저장·스테이지]가 아무 말 없이 버려짐. `saveConflict`는 저장만 하고 add는 버린 채 칸을 닫아 끝난 것처럼 보임 | `GitScreen.tsx:351`, `582-584` | `run()` 한 곳에서 `running()`이면 "다른 git 명령이 실행 중입니다"를 notify합니다. `saveConflict`는 `r?.ok`일 때만 닫습니다 | 중간 · 확인 |
| U3 | 비동기 버튼에 처리 중 잠금이 없어 연타하면 두 번 실행됨(B272와 같은 종류) | 대화 [보내기] `ConversationTab.tsx:281-315` · 맡기기 [보내기] `GitScreen.tsx:598-606` · 기록 [재개] `HistorySearch.tsx:180` · 임무 배정·상태 `Missions.tsx:231-236·375` · [git init 후 등록] `WorkspaceConnection.tsx:109-124` · 임무 [승인] `MissionReview.tsx:165` · 역할 [저장] `RoleLibrary.tsx:595·880·947`(자기 저장끼리 CONFLICT가 날 수 있음, 추정) · 파일 고르기 창 `WorkspaceConnection.tsx:135·171`, `RoleLibrary.tsx:656` · [다시 확인]·[다시 감지] `Settings.tsx:632`, `LaunchMode.tsx:304` · [다시 실측] `PortsPanelTab.tsx:188` | 버튼마다 `busy` 신호를 두고 `disabled`로 막습니다. 확인창은 이미 있는 `busy` prop(지금은 `EnvPanelTab.tsx:400` 한 곳만 씀)을 넘기고, 끝난 뒤 닫습니다. 대화 초안은 await 전에 잡아 두고 비웁니다 | 중간 · 코드 |
| U4 | 쓰던 것이 경고 없이 사라짐 | git 커밋 메시지·선택: diff를 보고 오거나 Esc를 누르면 사라짐(`GitScreen.tsx:784·816-819·871-879`). 대화 초안: 다른 탭에 다녀오면 사라짐(`ConversationTab.tsx:130`). 환경변수 원문 편집: 탭 전환·패널 닫기·전체 화면 전환으로 사라짐(`EnvPanelTab.tsx:46·316-333`, `SidePanel.tsx:106`). 팀 캐스팅 수정 편성: 프리셋 버튼이나 [←]로 사라짐(`TeamCasting.tsx:237·263-276`) | 커밋 메시지와 대화 초안은 모듈 신호(wsId별)로 옮깁니다. 대화 탭은 `clearedIds`가 이미 이렇게 되어 있습니다. 환경변수 편집은 `setPanelGuard(() => editorGuard() \|\| envDirty())`로 묶습니다. 팀 캐스팅은 RoleLibrary의 `guard`를 따릅니다 | 중간 · 코드 |
| U5 | 실패해도 성공처럼 닫힘 | 임무 [승인]은 저장에 실패해도 화면이 닫힘(`MissionReview.tsx:100-105`). 임무 만들기는 결과를 보기 전에 폼을 비우고, 만든 임무를 고르지도 않음(`Missions.tsx:97-106·111`) | 함수가 ok나 새 id를 돌려주게 하고, 성공했을 때만 닫거나 비웁니다. 그다음 `setSelId(newId)`를 합니다 | 낮음~중간 · 코드 |
| U6 | 실행 방식 화면에서 사람이 고른 것을, 늦게 온 저장 팀 응답이 '이 팀으로 시작'으로 덮음 | `LaunchMode.tsx:57-62` | 사람이 고른 적이 있으면(`touched`) 덮지 않습니다 | 낮음 · 코드 |
| U7 | 모달이 포커스를 가져가지 않거나 닫힌 뒤 돌려주지 않음. 터미널에서 Ctrl+Shift+L로 배치 고르기를 열고 글자를 치면 뒤의 셸에 들어감 | `LayoutPicker.tsx:26-42`, `GitScreen.tsx:110-114·170`, `CrashRecovery.tsx:64-67`, `ui.tsx:215-227` | `pushLayer` 한 곳에서 열 때 `document.activeElement`를 저장하고 닫을 때 `focus()`합니다. 그러면 모든 모달이 고쳐집니다. LayoutPicker는 onMount에서 포커스를 줍니다 | 중간 · 코드 |
| U8 | 눌러도 반응이 없음 | 복사 버튼 10곳(`GitScreen.tsx:814·827·828·856·1031·1140·1163·1322·1537`, `LaunchMode.tsx:301`). 터미널 Ctrl+F에서 일치하는 것이 없을 때(`TerminalPane.tsx:850-857`). 포트 첫 실측이 실패하면 "읽는 중…"이 영원히 남음(`panels.ts:17`, `ports.ts:325-339`) | `HistorySearch.tsx:82-84`의 복사 토스트를 helper 하나로 묶어 씁니다. 검색 결과의 boolean으로 입력칸을 빨갛게 표시합니다. 포트는 실패 문구와 실측 시각을 보입니다 | 낮음 · 코드 |
| U9 | git 화면 행(커밋 · 브랜치 · stash · 작업 트리)에 Tab으로 닿지 않음. cherry-pick·reset·merge는 우클릭으로만 됨. 커밋 Ctrl+Enter, 역할 편집기 Ctrl+S가 없음 | `GitScreen.tsx:887-892·1106-1244·1505-1510`, `RoleLibrary.tsx` | 행에 `tabIndex=0`을 주고, Enter로 고르고, Shift+F10·메뉴 키로 메뉴를 엽니다. textarea에 Ctrl+Enter, 역할 화면에 Ctrl+S를 붙입니다 | 낮음~중간 · 코드 |
| U10 | 자잘한 것 | 덩어리 칸 ✕ 버튼에 이름이 없음(`GitScreen.tsx:1404`). 스테이지 +/− 버튼이 약 16px(`screens.css:6662-6666`). diff 안내에 "커밋·편집은 터미널에서"가 남아 있음(`GitDiffEditor.tsx:514`). 임무 기준 모드인데 "HEAD 커밋 시점"이라고 적음(`:573`). 팀 편성 프리셋 이름에 `t()`가 빠짐(`TeamComposition.tsx:141·242`). 한국어 화면에 SLOT·FIXED·MISSION 영문 라벨이 섞임 | `aria-label`을 답니다. `.gx-mini`에 `min-width:22px; min-height:20px`를 줍니다. 문구를 고치고 `t()`로 감쌉니다 | 낮음 · 코드 |

## 3. 정정 · 뺀 것

- **[모두 읽음] 뒤 카드 테두리가 남는다**는 결과가 하나 있었는데, 틀렸습니다. `MESSAGES`는 `createMutable` 프록시라서(`mock.ts:473`) `m.unread = false`도 반응합니다. 그래서 뺐습니다.
- ScreenOverlay에 `role=dialog`와 Tab 가두기가 없는 문제는 원장 U93과 같아서 넣지 않았습니다.
- 문제없음으로 확인한 것: WebGL 회수·컨텍스트 손실 대비, 터미널 다시 붙이기(REGISTRY), 0-크기 가드, 분할선 드래그, 숨김 중 폴링 중지(git · 트랜스크립트 · usage · agentprobe · diag), `broadcastSoon` 16ms 묶음, 대시보드·컨트롤 센터 그리드·앱 바 탭의 `<For>`(store 프록시를 거르기만 해서 행이 유지됨), ConfirmDialog·ExitDialog 처음 포커스, reset --hard 두 번 확인.

## 4. 고치는 순서 제안

1. **한두 줄로 끝나는 것:** U1(Enter 무시), U2(`run()`에서 notify), R14(판정 순서), R2·R3(`selected`), R11(`equals`), R13(만료 판정).
2. **공통 한 곳만 고치면 되는 것:** U7(`pushLayer` 포커스 복원), U3(`busy` 패턴. ConfirmDialog의 `busy` prop 활용), U8(복사 토스트 helper).
3. **갱신 구조:** R1(tick 경로에서 새 객체 만들지 않기), R4·R5(hydrate → reconcile). 고치면 깜빡임·포커스 풀림 계열이 한꺼번에 줄어듭니다.
4. **목록 스크롤과 로딩 상태:** R6–R10. "바닥이었으면 따라가기" helper와 `loading` 신호를 탭마다 둡니다.
5. 나머지: U4–U6, U9–U10, R12, R15–R16.

실앱으로 꼭 확인할 것: R14·R15(xterm 리플로에 따라 다름), U3의 역할 저장 CONFLICT, R1에서 클릭이 씹히는 빈도.
