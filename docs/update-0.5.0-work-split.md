# EQMUX 0.5 작업 분담

2026-10-15 · 리드 eqmux-77

근거: `docs/update-plan-0.5.0.md`(기획서, 이하 "기획서") · `docs/design.pen`(0.5 시안, pencil MCP로만 읽는다).
결정 22건은 모두 기획서의 **권장안**으로 확정한다.

## 작업 방식

- 다섯 세션이 **같은 작업 트리**(`D:\workspace\workspace\EQMUX`, 브랜치 `sub_main`)에서 일한다. 워크트리를 따로 만들지 않는다.
- 파일마다 **주인**이 있다(아래 표). 남의 파일은 고치지 않는다. 꼭 필요하면 작은 국소 수정만 하고, 고치기 직전에 다시 읽고, 주인에게 SendMessage로 한 줄 알린다.
- git `commit`·`checkout`·`stash`·`reset`·`restore` 금지. 커밋은 리드가 마지막에 한다. 기존 미커밋 변경(서버 탭 등)은 살아 있는 작업이다. 지우지 않는다.
- 검증: `npx tsc --noEmit`, `npm test`, `cd src-tauri && cargo test`. 남의 파일에서 난 오류는 무시하고 주인에게 알린다. `npm run tauri dev`는 띄우지 않는다.
- 끝나면(또는 막히면) eqmux-77에게 SendMessage로 보고한다: 한 일 · 못 한 일 · 남의 파일을 건드린 곳 · 테스트 결과.
- 코드 스타일은 주변 코드를 따른다(한국어 주석 밀도·이름). i18n은 한·영 둘 다 넣는다.

## 분담

| 세션 | 스트림 | 소유 파일 |
|---|---|---|
| eqmux-18 | **W1 Rust 런타임·성능** | `lib.rs` `agent.rs` `store.rs` `transcript.rs` `recovery.rs` `diag.rs` `browser.rs` `fsx.rs` `Cargo.toml` |
| eqmux-08 | **W2 Rust 메시지·CLI·역할 합성** | `messages.rs` `ipc.rs` `cli.rs` `roles.rs` `library.rs` `team.rs` `missions.rs` `workspace.rs` |
| eqmux-66 | **W3 프런트 UX 기반·정체성·관제** | `ui.tsx` `types.ts` `jobs.ts` `ControlCenter.tsx` `Dashboard.tsx` `SessionDetailPanel.tsx` `RoleLibrary.tsx` `TeamCasting.tsx` `backend/mock.ts` `backend/agent.ts` `backend/roles.ts` `backend/team.ts` `backend/library.ts` `backend/layout.ts` `i18n/control.ts` `i18n/session.ts` `i18n/roles.ts` |
| eqmux-8a | **W4 프런트 셸·메뉴·패널·설정** | `AppBar.tsx` `App.tsx` `state.ts` `SidePanel.tsx` `WorkspaceConnection.tsx` `GitPanelTab.tsx` `backend/git.ts`(+test) `MissionExplorerTab.tsx` `ServerPanelTab.tsx` `PortsPanelTab.tsx` `LogsPanelTab.tsx` `MdViewTab.tsx` `Settings.tsx` `TeamComposition.tsx` `DefaultTerminalSetup.tsx` `backend/settings.ts` `backend/ports.ts` `backend/workspaces.ts` `backend/attention.ts`(새로) `i18n/shell.ts` `i18n/settings.ts` `i18n/git.ts` `screens.css` `styles.css` |
| eqmux-77 | **W5 통신 프런트·문서·통합** | `backend/conversation.ts`(+test) `ConversationTab.tsx` `backend/missions.ts` `Missions.tsx` `README*` `docs/**` 버전 파일 |

CSS: `screens.css`·`styles.css`는 W4 소유지만 모두가 **파일 끝에 자기 블록을 덧붙이는 것**은 허용한다(`/* 0.5 W3: … */` 머리 주석).

## 스트림별 할 일 (기획서 항목 기준)

### W1 — eqmux-18 (Rust 런타임·성능)
1. **P0 메인 스레드 멈춤**: `pty_write`·`agent_clis`·`pty_spawn`·에이전트 기동·재시작을 async + `spawn_blocking`(최적화 A1·A2·A9). `msg_*` 커맨드 async, `open_db`의 보존 정리·trim·FTS 시드 확인을 첫 열기로(B1·B4). **W2의 통신 작업보다 먼저** 끝내고 알린다.
2. **P0 데이터 보존(BR-09, 결정 1b)**: 버전 업 때 `workspaces.json`·`layout.json`은 남기고 `session.db`는 `.bak`으로 옮긴다.
3. **P0 서버 탭 정리 Rust 측(BR-04)**: 워크스페이스 해제 때 `#server@ws` PTY 종료 경로가 Rust에 필요하면 여기서.
4. **작업 완료 신호 Rust 측**: busy 시작 시각 기억 → Stop으로 idle이 될 때 30초 이상이면 `AgentStateEvt.completed = true`. `maybe_notify`에 완료 분기, 게이트 키 `세션#done`, `notify_text` 완료 문구(한·영). 완료 알림 설정(`report`·`all`·`off`, 기본 `report`)을 읽는다.
5. **알림 센터 이벤트**: `maybe_notify`가 OS 알림을 낼 때와 게이트에 막혔을 때 모두 `notify-item` 이벤트를 main 창에 낸다(계약 C2).
6. **`pub fn notify_report(app, session, text)`**: W2의 `report --done`이 부른다(OS 알림 "이름 · 완료" + `notify-item`).
7. **세션 시작 안내문**(lib.rs, Claude·Codex 공통): 기획서 §통신 간소화 "새 안내문 초안" 그대로. 360자 이하 테스트.
8. **BR-07**: Codex 세션 버전·기동 판정이 Claude 레지스트리에만 기대지 않게(`agent.rs:1275`).
9. **P1 성능**: B2(FTS rowid 삭제), B3·D1(트랜스크립트 캐시·async), A7·B6·A8(PTY 설정 잠금·`prepare_cached`·남은 읽기 async), A11(`emit_to("main")`), D4(`team.json`·`team.md` 감시 제외).
10. **P1 토큰 #7**: `browser.rs` `MAX_RESULT` 10,000. `eqmux browser` 인자 없음 → 사용법은 W2(cli.rs).
11. **BR-17 Rust 측**: `recovery.rs`의 `#server@ws` id 노출.
12. P2 여유 시: `[profile.release]`, `BufWriter`, `tokio::time::sleep`, 웹뷰 하트비트(BR-18).

### W2 — eqmux-08 (Rust 메시지·CLI·역할 합성)
1. **직함 Rust**: `library.rs` `PersonaInfo.title`(있을 때만 씀), `team.rs` `TeamSlot.title`·`team.md` 직함 열, `roles.rs` `RolePayload`·`Teammate.title`, 제목 `# 카이 — 클라이언트 개발자 (개발)`, `## 직함` 섹션, 팀 관계 표(팀원 칸 = 세션 이름, 다르면 `이름 (페르소나)`), `|` 이스케이프. **직함 없으면 0.4.2와 한 글자도 다르지 않게**(테스트).
2. **역할 파일 줄 추가**: handoff 5칸·report 근거·`.eqmux/notes/` 형식 세 줄, `eqmux who` 안내, 경계 문장, `report --done` 안내(기획서 §통신 간소화·§프로젝트 간 통신·§작업 완료 신호).
3. **본문 상한 800자**(`messages.rs:12`), 오류가 `--file` 안내. 사람(대화 탭) 메시지는 상한 제외(결정 18).
4. **`eqmux send --file <경로> "요약"`**: 저장소 안 경로만, 원장에 경로·크기.
5. **주소 확장·BR-01**: 수신자를 열린 모든 워크스페이스에서 찾는다(계약 C4의 디렉터리 사용). 모호하면 후보 주소 오류, 없거나 닫혔거나 받기 끔이면 오류. `@all`은 자기 프로젝트만. 같은 표시 이름 워크스페이스는 `app`, `app-2`.
6. **전달 결과 응답**: `전달함` / `대기 — 상대 작업 중(대기 N건)` / `실패 — <이유>`. 판정은 W1 `agent.rs` 세션 상태.
7. **양쪽 원장**: 프로젝트 간 메시지는 두 워크스페이스 원장에 쓰고 각각 `message-new`.
8. **`eqmux who`**: 번호·이름·프로젝트·직무(직함)·상태. 복사 가능한 주소.
9. **`eqmux report --done`**: 원장 `done` 열(스키마는 `store.rs` — W1 파일이지만 message 테이블 정의 부분만 W2가 고친다), 열린 handoff·ask 조회(받는 세션·타입 인덱스), 맡긴 팀원에게도 publish, `notify_report` 호출(W1).
10. **받기 설정**: 워크스페이스 레코드에 `crossProject`(기본 true) + 커맨드(`workspace.rs`). 프런트 토글은 W4.
11. **cli.rs**: `eqmux browser` 인자 없음 → `BROWSER_USAGE`. `MAX_SHEET_CHARS` 4,000(토큰 #1).
12. **목 데이터 누수 C1**: 임무 생성·배정·상태 변경 이벤트를 Rust(`missions.rs`)에서 기록.
13. 테스트: roles(직함 유무), library(저장 후 읽기), team(필드 생략), messages(열린 handoff, `@all` 제외), cli(`--done`·`--file`·`who` 파싱), ipc(주소 해석).

### W3 — eqmux-66 (프런트 UX 기반·정체성·관제)
1. **먼저 `ui.tsx` 부품**: `ConfirmDialog`(기본 포커스 취소, Enter·Esc 취소), `notify()`(4초 토스트, 실패·거부만), `Segmented`, `Chip`, `Identity`, `FieldHint`. **ConfirmDialog·notify·Segmented가 생기면 바로 모두에게 알린다**(W4·W5가 쓴다). 시안: `Component / Chip`(tmeW4) · `Identity`(Gs8FE) · `Pane Header`(q78thq) · `Segmented`(cPdj9) · `Field`(T9pK8s) · `Toast`(zYhXH) · `ConfirmDialog`(xHaqq) · `UX 기반`(J1QVO).
2. **P0**: 세션 중지 확인 3곳(대시보드·페인 메뉴·세션 상세), 기본 터미널 제거 확인, Codex 세션 헤더(BR-07 화면 측).
3. **페인 헤더 문법**: 헤더는 div, 이름 영역이 줌 버튼, 칩 동작은 형제 버튼. 주의 칩 1개 + `+N`. 접는 순서. 시안: 관제 2×2(AYlKJ), 8슬롯(T1sVdJ).
4. **직함 프런트**: `Persona.title`, `Session.title`(슬롯 덮어쓰기), 유효 직함, 추천 칩(`jobs.ts`), 역할 라이브러리(dwiBK)·세션 상세(N4E0qQ)·팀 캐스팅(cjWtF)·대시보드(SgZhp) 표시, `backend/roles.ts` payload, 저장 시 역할 파일 재생성 + "다시 읽기" 한 줄(문구 `[EQ] 역할 갱신 — .eqmux/roles/<세션>.md 다시 읽기`).
5. **세션 이름·번호**: 만들기 다이얼로그 `이름` 칸(xukml), 자동 이름 `프로젝트명XX`, 검증(24자, 공백·`@`·줄바꿈 금지, 중복 거부 + 제안), 기본 터미널 이름을 기기별 앱 데이터에 저장, 헤더·레일 두 자리 번호, `claude --name`에 세션 이름, **팀 캐스팅 재적용 때 남은 세션 슬롯 유지**(`mock.ts:675,693`).
6. **P1 같은 화면**: Codex 엔진 배지, 기동 버튼 문구, 슬롯 엔진 변경, 엔진 경고 순서·설치 명령, 팀 캐스팅 슬롯별 직무 변경, 대시보드 `재개`, BR-13 상태바 WAL 지우기(`ControlCenter.tsx:763`).
7. **완료 칩**: `unseenDone`, `reportPending`, `✓ 턴 끝남` → `✓ 턴 끝남 · 보고 전`(+`보고 요청`) → `✓ 완료 보고`, `markSeen` 정리, 3초 보임 해제, 대시보드 주의 정렬, 주의 카드가 모든 워크스페이스 waiting 전부(시안 HLeeM·SgZhp).
8. **손으로 띄운 에이전트 칩**: `메시지 N건 · 넣기` 칩 + 팝오버(d7GvE). 쌓는 쪽은 W5(`conversation.ts`), 칩·팝오버는 W3. 계약 C5.
9. 세션 메뉴 `작업 폴더 열기`(워크트리면 워크트리 폴더), `Ctrl+Alt+1~8` 포커스, `⛶ 응답 대기` 칩은 W4의 `nextUnseen()`을 부른다.
10. 셸에 직접 영향 없는 P1 성능 C1(`setView` 같은 화면이면 건너뜀)은 W4.

### W4 — eqmux-8a (프런트 셸·메뉴·패널·설정)
1. **P0 서버 탭**: BR-03(종료 상태 모듈 스코프 기억, `종료됨 (exit N) · ↻ 다시 실행`), BR-04(해제 시 서버 PTY 종료 — `mock.ts` 해제 경로는 국소 수정 허용), BR-05(앱 종료 확인 목록에 서버 PTY), BR-06(`revive`). 시안 N4bJu.
2. **P0 가짜 화면**: 팀 편성(C9ljT) 저장 버튼 → "자동 저장됨", `{n}개 세션 시작` 문구, 근거 없는 관계 문구, `기본 편성 채우기` 실데이터. 기본 터미널 구성(V4F7KU) 실제 셸·브랜치, 가짜 미리보기 제거, "열기".
3. **주의 고리**: `backend/attention.ts` — `attentionRank(s)`, `nextUnseen()`(열린 모든 워크스페이스, 기획서 §주의 신호 순위, 같은 순위는 오래 기다린 순, 누를 때마다 다음). `Ctrl+Shift+U`. 앱 바 벨 + 알림 센터(QjESu): `notify-item` 이벤트(계약 C2) 쌓기, 50건, 같은 세션 연속 `×3`, `모두 읽음`, 미확인 수는 세션 `unseen`·`unseenDone`·할 일 신호에서 계산.
4. **메뉴 정리**: 앱 바 "워크스페이스" 버튼 삭제, 벨 추가, 탭 `+` 툴팁 "워크스페이스 열기·관리". 사이드 패널 4그룹 `대화[대화|로그]` · `코드[git|문서]` · `실행[서버|포트]` · `브라우저`, 마지막 하위 탭 기억, 포트 배지 그룹 단위, "탭이 묶였습니다" 1회 안내. `PanelTab` 키는 그대로. 시안 `Panel Tabs`(jLWpf), AYgJv, e2s6HE, qFwsr.
5. **워크스페이스 탭 메뉴**(iGjf9): 우클릭 + `⋯`. 열기(탐색기·원격·관리…) · 알림(음소거·다른 프로젝트 메시지 받기 — W2 커맨드) · 닫기.
6. **바로 가기**: `git.ts` 원격→웹 주소·커밋 주소 순수 함수 + 테스트(SSH·ssh://·포트·토큰·Azure·로컬), 연결 화면(EYy9T) 탐색기 버튼·원격 링크·토큰 제거·닫힌 워크스페이스 위로, git 패널 머리 `원격 저장소`·커밋 `원격에서 보기`(d4VBJT), 파일 트리 행 `탐색기에서 열기`(uOK9M).
7. **P1**: BR-11(상한 무반응 3곳), 설정(mT3kL·fvlW8) 세그먼트/드롭다운·낡은 문구 2건·완료 알림 설정·단축키 표, 워크스페이스 음소거 토글, BR-13 포트 빈 상태, 서버 탭 나머지(BR-17 화면·`다시 열기` 실패 notify·"서버 로그" 제목), C1(`setView` 같은 화면 건너뜀).

### W5 — eqmux-77 (통신 프런트·문서·통합)
1. `conversation.ts`: 발신자 = 세션 이름(다른 프로젝트면 `이름@프로젝트`), 기본 터미널 에코 형식 통일, **BR-02** 자동 주입 중단·쌓기(계약 C5), 받는 워크스페이스 기준 전달, BR-15 이전 페이지, 디렉터리 푸시(계약 C4).
2. `ConversationTab.tsx`: 4줄 접기, `--file` 첨부 열기, `모든 프로젝트` 필터 칩, 프로젝트 배지, 다른 프로젝트로 전달, 내가 보낸 메시지 전달 상태, ✓ 배지, 발신자 툴팁 직함.
3. `missions.ts` 실패 notify(BR-12), 임무 배정 안내 머리 `[EQ]`, `Missions.tsx` `검토 중으로`.
4. wmux 언급 0건(`docs/archive/bug-report-0.4.0.md:158`), 문서 정합화, `implementation-status.md`, README, 버전 0.5.0.
5. 통합: 전체 tsc·test·cargo test, 수용 기준 점검, 커밋.

## 계약 (스트림 사이 인터페이스)

- **C1 AgentStateEvt**: `completed?: boolean` 추가(W1 내보냄 → W3 `backend/agent.ts`가 `unseenDone = "turn"`).
- **C2 `notify-item` 이벤트**(W1 → W4), `emit_to("main")`:
  `{ id: string, session: string, workspace: string, kind: "waiting"|"dead"|"report"|"turn", title: string, body: string, ts: number, os: boolean }` — `os`는 실제로 OS 알림을 냈는지.
- **C3 메시지 레코드**(W2 → W5): `done: boolean`, `file?: { path: string, size: number }`, `project?: string`(다른 프로젝트에서 온 경우 그 주소의 프로젝트 이름). TS `Message` 타입은 `conversation.ts`에 W5가 맞춘다.
- **C4 세션 디렉터리**: 프런트(W5)가 세션 목록이 바뀔 때 `invoke("directory_set", { entries })`. `entries: { session, workspace, project, name, persona, job, title, slot, status }[]` — `project`는 중복 접미사(`-2`)까지 붙은 주소용 이름. Rust(W2)는 이것으로 주소 해석·`who`를 한다. 상태 판정(전달 결과)은 W1 agent.rs의 실측 상태를 우선한다.
- **C5 손으로 띄운 에이전트 인박스**(W5 → W3): `conversation.ts`가 `pendingFor(sessionId): Message[]`, `injectPending(sessionId)`를 내보내고 `Session.pendingInbox?: number`를 갱신(`backend.patch…`). W3는 칩·팝오버만.
- **C6 Session 필드**(W3 `types.ts`): `title?: string`, `unseenDone?: "turn" | "report"`, `doneText?: string`, `reportPending?: boolean`, `pendingInbox?: number`, `busySinceTs?`는 필요 없음(Rust가 판정). `Persona.title?: string`. 유효 직함 `effectiveTitle(session, persona)`, 세션 이름 `sessionName(session, persona)`를 `types.ts`에 둔다 — 모두 이 함수를 쓴다.
- **C7 `nextUnseen()`·`attentionRank()`**: `src/backend/attention.ts`(W4). W3 칩·대시보드 정렬이 쓴다.
- **C8 공통 부품**: `src/components/ui.tsx`(W3). `notify(msg: string)`, `<ConfirmDialog title body danger confirmLabel onConfirm onCancel/>`, `<Segmented items value onChange/>`.

## 2단계 — 시안 적용 (2026-10-15)

기능 구현 뒤 화면을 `docs/design.pen` 0.5 시안에 맞춘다. 동작은 바꾸지 않고 배치·간격·글꼴·색·문구만 맞춘다. 이 단계에서는 소유가 아래처럼 바뀐다. 리드(eqmux-77)는 실기 체크리스트를 진행한다.

| 세션 | 시안 프레임 (id) | 파일 |
|---|---|---|
| eqmux-66 | 공통 부품(Chip tmeW4 · Identity Gs8FE · Pane Header q78thq · Segmented cPdj9 · Button WFpkc · Field T9pK8s · Toast zYhXH · ConfirmDialog xHaqq · Menu Item rwIqz · Terminal Workspace l1uSGV) · UX 기반 J1QVO · 관제 2×2 AYlKJ · 8슬롯 T1sVdJ · 세션 상세 N4E0qQ · 세션 만들기 xukml · 작업 완료 HLeeM · 대시보드 SgZhp · 확인창 TzzVT · 손으로 띄운 에이전트 d7GvE · 우클릭 메뉴 모음 HPPf2 | ui.tsx · ControlCenter · Dashboard · SessionDetailPanel |
| eqmux-8a | App Bar mdRK8 · Panel Tabs jLWpf · 알림 센터 QjESu · 워크스페이스 연결 EYy9T · 실행 N4bJu·qFwsr · 코드 AYgJv·E7Ixk6 · 대화[로그] e2s6HE · 설정 mT3kL·fvlW8 · 팀 편성 C9ljT · 기본 터미널 구성 V4F7KU · 브라우저 탭 w4W5l · 임무 팝업 탐색기 uOK9M · 배치 선택 QeU7f | AppBar · SidePanel · 패널 탭들 · WorkspaceConnection · Settings · TeamComposition · DefaultTerminalSetup · MissionExplorerTab · LayoutPicker |
| eqmux-08 | 역할 라이브러리 dwiBK · 팀 캐스팅 cjWtF · 기동 모드 선택 xfVq4 · CLI 출력 T36ZZ | RoleLibrary · TeamCasting · LaunchMode · cli.rs 문구 |
| eqmux-18 | 대화 탭 os0TX · 트랜스크립트 Yd4E5 · git diff·에디터 tYTka · 임무 배정 jc2Fm · 종료 확인 mMpfq | ConversationTab · TranscriptPane · GitDiffEditor · Missions · ExitDialog |

0.5.x 프레임(한도·컨텍스트 P3yQ3P, 확장 w5YnN·i52Vt0·f8JU7M, 저장 명령 u6MRI, 직무·모델 Y69UP)은 적용하지 않는다.
