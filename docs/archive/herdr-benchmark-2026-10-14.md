# herdr 벤치마킹 — 2026-10-14

대상: https://herdr.dev/ (랜딩 · docs의 agents · agent-automation · session-state · windows-beta · plugins · agent-skill · keyboard · compare · GitHub releases · 시드 투자 블로그)
기준: EQMUX `sub_main` 0.4.2 + `docs/update-plan-0.5.0.md`
같이 볼 문서: `docs/orca-benchmark-2026-10-14.md`, `docs/multiplexer-tools-2026-10-14.md`, `docs/benchmark-oss-list-2026-10-14.md`(1순위로 herdr를 꼽음)

## 1. 지금의 herdr

| 항목 | 내용 |
|---|---|
| 한 줄 | "the agent runtime — Run them anywhere. Leave them running." 앱이 아니라 **런타임**이라고 스스로 정의한다 |
| 버전 | v0.9.4 (2026-10-13) |
| 출시 속도 | stable은 2주에 한 번(09-16 · 09-29 · 10-13), 그 사이에 preview 빌드를 주 1~3회 낸다. `herdr channel set stable/preview`로 채널을 고른다 |
| 규모 | GitHub 별 4.4만, 포크 3.5k, 누적 설치 148만, 커뮤니티 플러그인 1,696개 |
| 회사 | 2026-09-08 시드 600만 달러. Bessemer 주도, Y Combinator · e2vc, 엔젤로 Tobi Lütke(Shopify)·Dane Knecht(Cloudflare) |
| 라이선스·수익 | Apache-2.0, 무료. 유료 후보는 "Herdr Cloud"(SSH 설정 없이 여러 컴퓨터를 잇는 기능, 대기 명단만 있음) |
| 형태 | Rust 단일 바이너리 TUI. 사용자가 쓰던 터미널 **안에서** 돈다. Electron 없음 |
| 플랫폼 | macOS · Linux · Windows(네이티브 ConPTY, GA). 원격은 SSH |
| 지원 에이전트 | 22종 감지. 통합(integration)을 설치하면 재시작 후 세션 재개까지 된다 |

### 랜딩 구성

기능 5개만 보인다: 항상 실행(백그라운드 서버) → 막힌 에이전트 감지(working/blocked/idle) → 에이전트가 쓰는 CLI·소켓 API → 기존 CLI를 감싸지 않음 → 멀티 머신(SSH). 숫자 4개(별·설치·플러그인·에이전트 수)를 크게 걸고, 비교표는 `/compare`로 따로 뺐다. 후기는 없다.

`/compare`는 tmux · Zellij · cmux · Warp · Solo · Conductor · Emdash · Superset과 10개 행으로 비교한다. 핵심 주장은 둘이다. "UI를 닫아도 일이 살아남는다", "Conductor·Emdash 같은 매니저 앱을 대체하지 않고 그 **아래 층**이 된다". Orca는 비교 대상에 없다.

## 2. 핵심 기능 상세

### 상태 감지

- 페인의 프로세스 트리에서 에이전트를 찾고, **화면 맨 아래**를 에이전트별 규칙(manifest)과 대조해 `idle`·`working`·`blocked`를 정한다. 통합이 상태를 보고하면 화면보다 우선한다.
- `blocked`는 엄격하다. 알려진 승인·질문·권한 UI와 맞을 때만 붙고, 아니면 idle로 떨어진다.
- 규칙은 herdr.dev에서 자동으로 갱신된다(끌 수 있음). `~/.config/herdr/agent-detection/<agent>.toml`로 덮어쓸 수 있다.
- `herdr agent explain`이 **왜 그 상태로 판정했는지** 보여 준다.
- 상태는 페인 → 탭 → 워크스페이스로 올라간다. `done`은 사람이 볼 때까지 남는다.

### 에이전트가 쓰는 API

사람이 쓰는 CLI가 곧 에이전트 API다. 모든 명령이 JSON을 출력한다.

| 명령 | 하는 일 |
|---|---|
| `pane split/run/send-text/send-keys/read/wait-output` | 페인 만들기, 명령 실행, 출력 읽기, 정규식이 나올 때까지 대기 |
| `agent start <name> --kind codex --pane <p>` | 빈 페인에서 에이전트를 이름 붙여 띄운다 |
| `agent prompt <name> "..." --wait --until blocked` | 프롬프트를 보내고 결과 상태까지 기다린다. 이미 blocked면 **입력하지 않고** `agent_blocked`로 거절한다 |
| `agent wait <name> --until blocked` | 다른 에이전트가 막힐 때까지 기다린다 |
| `agent read` / `agent send-keys esc` | 막힌 화면을 읽고 의도적으로 답한다 |

오류는 이름이 붙은 JSON이다(`agent_not_ready`, `agent_prompt_stalled`, `timeout` 등). 문서가 "타임아웃이 났다고 입력이 안 갔다는 보장은 없다, 다시 보내기 전에 읽어라" 같은 안전 수칙을 명시한다.

`skills/herdr/SKILL.md`를 `npx skills add herdrdev/herdr --skill herdr -g`로 설치한다. 스킬은 `HERDR_ENV=1`이 없으면 "herdr 페인이 아니다"라고 멈추게 한다. 자기 것이 아닌 세션을 건드리지 않게 하는 가드다.

### 세션 영속성

| 상황 | 결과 |
|---|---|
| 클라이언트 분리(`ctrl+b q`) | 서버가 PTY를 들고 있어 **모든 프로세스가 계속 돈다** |
| 서버 재시작 | 프로세스는 사라진다. 레이아웃(워크스페이스·탭·페인·cwd·포커스)을 복원하고, 통합이 있는 에이전트는 자기 대화로 **자동 재개**한다(기본 켬, 순차로 띄움) |
| 업데이트 | 호환되는 서버는 계속 돈다. Unix는 `--handoff`로 실행 중인 PTY를 새 바이너리에 넘긴다(실험) |
| 저장 | `session.json` + 스냅샷 최대 48개(15분 간격) + **읽을 수 없거나 더 새 버전인 파일은 `session-backups/`에 보존하고 자동 복원하지 않는다** |
| 스크롤백 | 기본 꺼짐. 비밀이 들어 있을 수 있어서 opt-in(`pane_history`)이다 |

### Windows

네이티브 ConPTY를 쓰고, 구형 Windows 10 문제 때문에 앱 로컬 ConPTY 런타임을 번들한다. 서버는 로그아웃 후에도 산다. 관리자 권한 서버는 일반 클라이언트를 기본으로 거부한다. v0.9.4에서 **Windows 알림이 유지되고, 누르면 해당 페인으로 이동**한다.

약점도 문서에 그대로 적었다.
- **한글 IME가 부분 지원이다.** 조합 위치 고정이 불완전하고, 후보 창이 엉뚱한 곳에 뜰 수 있다. 커서를 셀로 그리는 기본값(깜빡임 회피)과 IME 위치가 충돌한다.
- PowerShell에서 `cd`를 따라가지 못한다(OSC7 필요).
- 서명된 바이너리가 없어 SmartScreen과 엔드포인트 보안에 막힌다. `install.cmd` 우회 경로를 따로 둔다.
- 플러그인은 Windows에서 preview다.

### 플러그인

`herdr-plugin.toml` 매니페스트 + 아무 언어의 명령. API는 herdr CLI 전체다. 훅은 `startup`·`actions`·`events`(예: `worktree.created`)·`panes`(overlay/popup/split)·`link_handlers`·키 바인딩. 마켓은 GitHub 토픽 `herdr-plugin`을 30분마다 색인한다. 샌드박스가 없고, 설치 전에 실행될 명령을 미리 보여 준다.

### 키·이동

tmux식 `ctrl+b` 접두. 마우스로 다 된다. **Goto 피커(`prefix+g`)**가 에이전트를 워크스페이스별 한 행씩 보여 주고, `/`로 이름·종류·브랜치·경로를 검색하고, `b`·`w`·`i`·`d`로 blocked·working·idle·done만 거른다.

## 3. 포지셔닝 차이

| | herdr | EQMUX |
|---|---|---|
| 정체성 | 런타임(서버 + 여러 클라이언트). 매니저 앱 **아래 층** | 매니저 앱. 팀 관제가 중심 |
| 단위 | 페인 1개 = 에이전트 1명. 팀 개념 없음 | 저장소 1개 = 팀 1개, 역할·페르소나 |
| 에이전트 간 통신 | 화면에 프롬프트를 **타이핑**하고 화면을 **읽는다**(`agent prompt/read`) | 타입 5종의 메시지를 원장에 남기고 상태 기반으로 전달 |
| 앱을 끄면 | 에이전트가 계속 돈다 | Job Object로 정리, 재시작 때 재개 제안 |
| UI | 사용자 터미널 안의 TUI | Tauri GUI(대시보드 그리드, 패널) |
| 대상 | 3개 OS + 원격, 영어 | Windows 전용, 한국어 우선 |

herdr는 "에이전트가 다른 에이전트를 부리는" 구조를 프리미티브(split · start · prompt · wait · read)로만 준다. 누가 누구에게 무엇을 시키는지는 각 에이전트의 프롬프트와 스킬에 맡긴다. EQMUX는 그 위의 **조직**(역할, 메시지 타입, 원장, 관제 그리드)을 제품으로 가진다. 겹치는 곳은 상태 감지와 세션 영속성이고, 여기서는 herdr가 앞서 있다.

## 4. 영역별 비교

○ 있음 · △ 일부 · × 없음

| 영역 | herdr | EQMUX | 차이 |
|---|---|---|---|
| 앱을 꺼도 PTY 유지 | ○ (백그라운드 서버, Windows 포함) | × | 철학 차이. Orca에 이어 두 번째로 지적됨 |
| 업데이트해도 상태 유지 | ○ (새 버전 파일은 백업, 자동 삭제 없음) | × (BR-09, 버전이 바뀌면 지움) | **가장 큰 격차.** 결정 1 근거 |
| 재시작 후 에이전트 자동 재개 | ○ (통합 버전 확인, 순차 기동) | △ (재개 제안) | 비슷한 방향. EQMUX는 사람이 누른다 |
| 상태 감지 | ○ (화면 규칙 + 통합 보고, blocked 엄격) | ○ (레지스트리 watch + 훅) | 비슷 |
| 상태 판정 근거 보기 | ○ (`agent explain`) | × | 가져올 것 |
| blocked 상태에 입력 거절 | ○ (`agent_blocked`) | △ (관리 세션은 유휴일 때만 주입, `conversation.ts:380`. 손으로 띄운 에이전트는 구멍, `conversation.ts:310-317`) | 남은 구멍만 막을 것 |
| 상태별 필터가 있는 이동 팔레트 | ○ (Goto 피커 b/w/i/d) | × | 가져올 것 (Orca의 Jump 팔레트와 합침) |
| 알림 클릭 → 페인 (Windows) | ○ (v0.9.4) | × (0.6으로 미룸) | **Windows에서 가능하다는 증거** |
| 에이전트 간 메시지 | △ (화면 타이핑·읽기) | ○ (타입·원장·상태 전달) | **EQMUX 우위** |
| 역할·페르소나·팀 | × | ○ | **EQMUX만** |
| 관제 보드 | △ (사이드바, 상태 롤업) | ○ (워크스페이스×세션 그리드) | **EQMUX 우위** |
| 한글 IME | △ (부분, 후보 창 위치 문제) | ○ (GUI 앱) | **EQMUX 우위.** 한국어 사용자에게 큰 차이 |
| 에이전트 대기 프리미티브 (`wait --until`) | ○ | × | 나중 |
| 에이전트용 스킬 파일 + 환경 가드 | ○ (`HERDR_ENV`) | △ (안내문 주입) | 확인할 것 |
| 스크롤백 복원 | △ (opt-in, 비밀 경고) | ○ (500줄 재생) | 보안 표기는 가져올 것 |
| stable/preview 채널 | ○ | × (자동 업데이트 없음) | 0.6 자동 업데이트 때 |
| 플러그인·마켓 | ○ (1,696개) | × | 0.6 이후 |
| SSH·멀티 머신·클라우드 | ○ | × | 가져오지 않음 |
| 감지 규칙 원격 갱신 | ○ | × | 가져오지 않음 |
| 3개 OS | ○ | × | 가져오지 않음 |

## 5. 가져올 것 — 우선순위

Orca 문서의 우선순위와 겹치는 항목은 근거만 보탠다.

| 순위 | 기능 | herdr에서 | EQMUX에 넣는 방식 | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **업데이트해도 상태 유지** | 새 버전·손상 파일을 `session-backups/`로 옮기고 지우지 않는다. 스냅샷 48개 | 결정 1을 (b)로 확정한다. 더해서 버전이 바뀌면 지우는 대신 `.bak`으로 옮겨 두면 롤백할 길도 생긴다 | 작음 | 0.5 P0 (Orca 문서 1번과 같음) |
| 2 | **알림 클릭 → 해당 세션** | v0.9.4에서 Windows 알림이 남고, 누르면 페인으로 간다 | "플러그인에 클릭 콜백이 없다"가 0.6으로 미룬 이유였다. herdr는 Windows 토스트 활성화로 해냈다. 플러그인 대신 토스트 activation 인자(세션 ID)를 직접 받는 경로를 검토한다. 안 되면 Orca 문서 2번 대안(앱 안 벨 + 포커스 시 이동 칩) | 중간 | 0.5 P2 후보 |
| 3 | **상태 필터가 있는 Jump 팔레트** | Goto 피커: 에이전트 한 행씩, 검색, `b/w/i/d` 필터 | Orca 문서 7번(Ctrl+P)에 상태 필터를 붙인다. "막힌 세션만"이 한 키로 나오면 관제 그리드의 주의 정렬을 키보드로도 쓸 수 있다 | 작음 | 0.6 |
| 4 | **상태 판정 근거 보기** | `herdr agent explain` | 세션 상세에 "왜 대기 중인가: 훅 `Notification` 14:02 수신" 한 줄. 상태 오판 버그 리포트를 받을 때 바로 쓰인다 | 작음 | 0.6 |
| 5 | **blocked일 때 메시지 보류** | 이미 blocked면 입력하지 않고 거절한다. 승인 창에 글자가 들어가는 사고를 막는다 | 관리 세션은 이미 막는다(`canInject`, `conversation.ts:380`). 손으로 띄운 에이전트(`unmanagedAgent`)는 턴 경계를 몰라 승인 창에 본문이 들어갈 수 있다. 이 경로는 주입하지 않고 화면 에코 + 인박스 보관으로 바꾸거나, "에이전트 열기"로 띄우라는 안내를 붙인다 | 작음 | 0.5.x |
| 6 | **스크롤백 보안 표기** | 기본 꺼짐, 비밀이 들어갈 수 있다고 경고 | 500줄 재생은 유지하되, 설정 화면에 "스크롤백에 토큰이 남을 수 있다" 한 줄과 끄기 토글 | 작음 | 0.5.x |
| 7 | **stable/preview 채널** | 채널을 사용자가 고른다 | 0.6 자동 업데이트를 만들 때 채널 개념을 처음부터 넣는다. QA 미해결이 많을 때 preview로 먼저 받게 한다 | 작음(업데이트와 함께) | 0.6 |
| 8 | **`/compare` 형식** | 비교 대상별 한 줄 + 10행 매트릭스, "대체가 아니라 같이 쓴다" | Orca 문서 9번 비교표에 herdr 열을 더한다. "herdr는 런타임, EQMUX는 팀"으로 대립이 아닌 층 차이로 설명한다 | 작음 | 0.5 문서 정합화 때 |

## 6. 가져오지 않을 것

| 기능 | 이유 |
|---|---|
| 앱을 꺼도 도는 백그라운드 서버 | 근본 구조를 바꾸는 일이다. EQMUX는 Job Object 정리 + 재개 제안을 택했다. 다만 Orca·herdr 둘 다 갖고 있어 사용자 기대치가 되어 가고 있다. 0.7 이후 재검토 항목으로 남긴다 |
| 화면 타이핑으로 에이전트 간 통신 | EQMUX의 메시지 버스(타입·원장)가 더 안전하고 기록이 남는다. herdr 문서 자체가 이중 전송·오입력 주의를 길게 적어야 했다 |
| 감지 규칙 원격 자동 갱신 | 앱이 몰래 네트워크에서 동작을 바꾸는 경로다. "자동 실행 없음" 원칙의 취지와 맞지 않는다. 규칙은 릴리스로 바꾼다 |
| SSH · 멀티 머신 · Cloud | Windows 로컬 팀 관제라는 범위 밖이다 |
| TUI · 터미널 안에서 돌기 | EQMUX의 관제 그리드와 한글 IME 우위는 GUI라서 나온다 |
| 22종 에이전트 경쟁 | Orca 문서와 같은 이유. Claude Code · Codex의 깊이가 먼저다 |
| 샌드박스 없는 플러그인 마켓 | 0.6 이후에 플러그인을 하더라도 실행 명령 미리보기는 따라 하고, 무검증 마켓은 하지 않는다 |

## 7. 위협과 대응

- **"매니저 앱 아래 층" 전략.** herdr는 Conductor·Emdash와 싸우지 않고 그 밑에 깔리려 한다. 매니저 앱들이 herdr를 백엔드로 쓰기 시작하면 "앱을 꺼도 에이전트가 산다"가 기본값이 된다. EQMUX는 이 기대에 재개 제안만으로 버텨야 한다. 재개 성공률을 수치로 보이는 것(QA)이 대응이다.
- **Windows 지원이 이미 GA다.** Orca에 이어 herdr도 Windows 네이티브다. "Windows 지원"은 차별점이 아니다. 남는 차별점은 **한국어(IME·UI)**, **팀 조직**, **관제 그리드**다. 한글 IME가 herdr의 문서화된 약점이라는 점은 한국 사용자 대상 자료에 그대로 쓸 수 있다.
- **자금과 속도.** 600만 달러 시드, stable 2주 주기 + preview. 기능 수로는 따라갈 수 없다. 0.5~0.6에서 팀 관제 축(직함, 세션 이름, 통신 간소화, 게이트)을 끝까지 다듬는다는 Orca 문서의 결론이 그대로 유효하다.
- **서명.** herdr도 서명이 없어 SmartScreen에 막히고 `install.cmd` 우회를 문서화했다. herdr보다는 앞설 수 있지만, Emdash는 이미 Azure Trusted Signing으로 서명한다(`docs/emdash-benchmark-2026-10-14.md`). 서명은 차별점이 아니라 따라잡아야 할 기본기다.

## 8. 0.5 기획서에 반영할 것

1. 결정 1을 (b)로 확정하고, 지우는 대신 백업으로 옮긴다 — Orca·herdr 둘 다 상태를 지우지 않는다.
2. 알림 클릭 이동을 0.6으로 미룬 근거를 다시 본다 — herdr가 Windows에서 v0.9.4로 해냈다.
3. 손으로 띄운 에이전트에 메시지를 주입하는 경로를 막는다(5장 5번). 관리 세션은 이미 유휴일 때만 주입한다.
4. 0.6 범위에 상태 필터 Jump 팔레트 · 상태 근거 보기 · 채널 있는 자동 업데이트를 올린다.

## 출처

- https://herdr.dev/ · /compare/ · /plugins/ · /blog/herdr-raised-a-seed/
- https://herdr.dev/docs/agents/ · /docs/agent-automation/ · /docs/session-state/ · /docs/windows-beta/ · /docs/plugins/ · /docs/agent-skill/ · /docs/keyboard/
- https://github.com/herdrdev/herdr · /releases (2026-10-14 조회)
