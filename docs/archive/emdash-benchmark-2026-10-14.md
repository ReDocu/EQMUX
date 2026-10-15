# Emdash 벤치마킹 — 2026-10-14

대상: https://github.com/generalaction/emdash · https://emdash.com/ (emdash.sh는 여기로 넘어간다). 랜딩 · docs의 installation · tasks · providers · project-config · diff-view · automations · tmux-sessions · cloud · changelog · GitHub releases · issues · `electron-builder.config.ts` · YC 회사 페이지
기준: EQMUX `sub_main` 0.4.2 + `docs/update-plan-0.5.0.md`
같이 볼 문서: `docs/orca-benchmark-2026-10-14.md`, `docs/herdr-benchmark-2026-10-14.md`, `docs/benchmark-oss-list-2026-10-14.md`(3순위, "사용자 입장에서 가장 직접 겹치는 경쟁 제품")

## 1. 지금의 Emdash

| 항목 | 내용 |
|---|---|
| 한 줄 | "Open-source agentic development environment". 병렬 에이전트, 예약 실행, 앱 내 브라우저, 프롬프트·스킬·MCP 관리를 한곳에서 한다고 말한다 |
| 버전 | v1.2.8 (2026-10-10). v1.0은 2026-04-24 |
| 출시 속도 | 09-01 ~ 10-14 사이 stable 6회(v1.2.3 ~ 1.2.8). 그 사이 canary 빌드를 따로 낸다(v1.2.8-canary.101). 업데이트 채널이 stable · canary 둘이다 |
| 규모 | GitHub 별 5,982, 포크 628, 커밋 10,445, 열린 이슈 63. 랜딩 기준 다운로드 100만 이상 |
| 회사 | General Action, Inc. Y Combinator W26, 샌프란시스코, YC 페이지 기준 2인(Raban von Spiegel CEO, Arne Strickmann). 디렉터리 사이트에 시드 50만 달러가 있으나 1차 출처는 찾지 못했다 |
| 라이선스·수익 | Apache-2.0, 무료. Cloud(작업별 격리 클라우드 환경)와 Enterprise는 "문의"만 있고 가격표가 없다 |
| 형태 | Electron 데스크톱 앱. TypeScript · pnpm/Nx 모노레포, 상태는 로컬 SQLite(drizzle 마이그레이션). 원격용 `workspace-server`가 따로 있다 |
| 플랫폼 | macOS(dmg · Homebrew) · **Windows x64(NSIS exe · MSI)** · Linux x64/arm64(AppImage · deb · rpm). Windows ARM 빌드는 없다 |
| 지원 에이전트 | providers 문서 35종(랜딩은 "25+", 개요는 34). 훅 · 재개 · 자동 승인 지원 여부가 에이전트마다 다르다 |
| 텔레메트리 | 있다. 설정이나 `TELEMETRY_ENABLED=false`로 끈다. 코드·대화는 Emdash 서버로 보내지 않는다고 적었다 |

### 랜딩 구성

기능 11개를 이 순서로 보인다: 이슈 넘기기(Linear · Jira · GitHub · Notion · Asana 등) → 병렬 에이전트(워크트리) → 앱 내 브라우저 → 리뷰·출시(diff · 커밋 · PR · CI) → 자동화(예약 실행) → 원격 SSH → 프로비저닝(setup/teardown 스크립트, "Bring Your Own Infra") → 25+ 에이전트 → Library(프롬프트 · 스킬 · MCP) → 프로바이더 설정 → 파일 에디터. 숫자는 둘(다운로드 · 별), 후기는 LinkedIn · X · Product Hunt 11건이다. 비교표는 없다. 팀·협업 기능은 설명이 없다.

## 2. 핵심 기능 상세

### 태스크 = 워크트리 1개 = 에이전트 1명

- `Add Task`(Ctrl+N) → 시작점(브랜치 · 이슈 · PR) → 이름(자동 생성 가능) → 프로바이더와 모델 → `Create`. 에이전트가 터미널에서 바로 뜬다.
- 태스크마다 브랜치와 워크트리가 생긴다. 로컬 기본 위치는 저장소 **밖** `~/emdash/worktrees`다. 워크트리를 끄고 현재 브랜치에서 일할 수도 있다(경고가 뜬다).
- 한 번에 워크트리를 여러 개 만들어 각자 에이전트를 돌릴 수 있다. Orca처럼 경쟁·비교형이다.
- 태스크는 보관(archive)과 복원이 된다. 보관할 때 teardown 스크립트를 돈다.

### 프로젝트 설정 — `.emdash.json`

- 팀과 나눌 설정만 저장소의 `.emdash.json`에 쓰고 커밋한다. 나머지는 기기 로컬이고, 로컬 값이 우선한다.
- `preservePatterns`: `.env` 같은 git 무시 파일을 새 워크트리로 **복사**한다.
- `scripts.setup` · `run` · `teardown`과 `shellSetup`. 스크립트는 `EMDASH_TASK_ID` · `EMDASH_TASK_PATH` · `EMDASH_PORT` 등을 받는다. `EMDASH_PORT`는 태스크마다 10개짜리 포트 범위의 시작값이다. 워크트리 여러 개가 같은 dev 서버 포트로 부딪히지 않게 하는 장치다.

### 프로바이더와 훅

- PATH에서 CLI를 자동 감지한다. 새로 설치하면 설정에서 `Refresh`.
- 훅을 지원하는 에이전트는 **사용자 전역 설정 파일에 표식이 붙은 항목을 써 넣는다**(README). 이 훅으로 working · 입력 대기 · 완료 알림과 재개를 한다.
- PTY 에이전트의 자동 승인 기본값은 꺼짐이다(`agents/architecture/settings.md`의 `autoApprove: false`). Orca의 Yolo 기본과 다르다.
- 채팅 UI(ACP)와 TUI를 에이전트 선택기에서 바꾼다(v1.2.7). 채팅 UI는 v1.1.39에 정식이 됐다.

### 리뷰·출시

diff 뷰에서 파일 단위 stage/unstage, 되돌리기(확인창), 커밋 · 커밋&푸시 · 커밋&PR, fetch/pull/push, PR 생성, CI 체크와 머지 상태 표시까지 앱이 한다. unstaged diff는 그 자리에서 고쳐 저장한다. v1.2.8부터 diff **초안 코멘트를 채팅에 첨부**한다.

### 이슈 연동

Linear · GitHub · Jira · GitLab · Asana · Featurebase · Monday.com · Forgejo · Plain · YouTrack(README 10종, 랜딩은 Notion 포함). 티켓 내용으로 태스크를 만든다. 통합마다 계정을 여러 개 두고 프로젝트별로 고른다(v1.2.5). 토큰은 앱이 들고 있다.

### Windows — 설치에서 첫 태스크까지

| 단계 | Emdash | EQMUX 0.4.2 |
|---|---|---|
| 받기 | `emdash-x64.exe`(NSIS, 설치 위치 변경, 차등 업데이트) 또는 `emdash-x64.msi`. 둘 다 사용자 단위 설치 | NSIS 하나, 사용자 단위, 한국어·영어 설치 화면(`tauri.conf.json`) |
| 서명 | **Azure Trusted Signing, 게시자 "General Action, Inc."**(`electron-builder.config.ts`). SmartScreen 평판 경고가 실제로 뜨는지는 확인하지 못했다 | 서명 없음(0.6 이후로 미룸) |
| 에이전트 설치 | 설치 문서가 Claude Code를 `curl … \| bash`로 안내한다(Windows에 맞지 않는다). 앱 안 설치는 v1.2.8부터 Claude Code에 WinGet을 제안한다 | 엔진 미설치 경고만 보인다. 설치 명령 안내는 확인 필요 |
| 첫 태스크 | 프로젝트 열기 → `Add Task` → 에이전트가 워크트리에서 뜬다. 역할 설정 단계가 없다 | 워크스페이스 등록 → 팀 편성·캐스팅 → 기동. 역할 파일을 쓰는 단계가 더 있다 |
| 업데이트 | 자동 업데이트, stable/canary 채널, 실패 시 재시도와 진단 복사(v1.2.7) | 자동 업데이트 없음. 버전이 바뀌면 등록·대화 기록이 지워진다(BR-09) |
| 앱 종료 | 로컬 Windows는 tmux를 쓰지 않는다. 앱을 끄면 에이전트 프로세스가 끝날 수 있고, 다시 켜면 재개를 지원하는 에이전트만 이어 간다 | Job Object로 정리, 재시작 때 500줄 재생과 재개 제안 |

Windows 버그는 3개 OS 중 하나로 다뤄진다. 이슈 검색 "windows" 76건이고, 최근 것은 `SystemDrive`가 에이전트 환경에서 빠져 엉뚱한 폴더가 생기는 문제(#3315, 10-12 열림), Git Bash에서 훅이 `NUL` 파일을 만드는 문제(#3011), WSL에 설치한 에이전트를 못 찾는 문제(#2140)다. 한글 IME · 한국어 UI 관련 언급은 찾지 못했다.

### 그 밖

- 자동화: cron으로 태스크를 만들어 에이전트를 사람 입력 없이 시작한다. 앱 재시작으로 끊긴 실행을 복구한다.
- 원격: SSH/SFTP 프로젝트, OS 키체인에 자격 증명, 원격 LSP(v1.2.8). 원격 호스트에서는 tmux로 프로세스를 살린다.
- 알림: v1.2.7에서 알림을 누르면 해당 대화 탭으로 간다(다른 페인 포함). OS별 동작 차이는 적혀 있지 않다.

## 3. 포지셔닝 차이

| | Emdash | Orca | EQMUX |
|---|---|---|---|
| 단위 | 태스크 = 워크트리 = 에이전트 | 같음 | 저장소 = 팀, 세션 4~8개 |
| 협업 모델 | 병렬·비교. 에이전트끼리 말하지 않는다(찾지 못함) | 병렬·경쟁 + orchestration CLI | 역할·페르소나 + 타입 5종 메시지 버스 |
| 앱이 git에 쓰는가 | 커밋 · 푸시 · PR · 머지까지 앱이 한다 | 같음 | 읽기만 한다(`src/backend/git.ts` 머리 주석, G7) |
| 권한 기본값 | 자동 승인 꺼짐, 켤 수 있음 | Yolo 기본 | 역할 파일이 정하고 bypass 경로가 없다(`agent.rs:147,333`) |
| 에이전트 설정 | 사용자 전역 설정에 훅을 써 넣는다 | 훅·OSC | 실행 인자로만 넣고 `~/.codex` 등은 건드리지 않는다(`agent.rs:123`) |
| 외부 토큰 | 이슈 트래커 · GitHub 계정 토큰을 앱이 보관 | 같음 | 보유하지 않는다 |
| 원본 | SQLite + `.emdash.json` | 앱 상태 + git | `.eqmux/` 파일(DB는 캐시) |
| 대상 | 3개 OS, 영어 | 3개 OS + 모바일 | Windows 전용, 한국어 우선 |

Emdash는 Orca와 같은 "워크트리 매니저" 계열이다. 규모는 Orca보다 작고(별 6천 대 9만), 대신 이슈 연동 폭과 Windows 설치본의 완성도(서명 · MSI · 자동 업데이트)가 눈에 띈다. EQMUX와 겹치는 것은 **Windows에서 설치해 첫 에이전트를 돌리기까지의 경험**이다. 팀 조직, 에이전트 간 메시지, 관제 그리드는 Emdash에 없다.

## 4. 영역별 비교

○ 있음 · △ 일부 · × 없음

| 영역 | Emdash | EQMUX | 차이 |
|---|---|---|---|
| Windows 코드 서명 | ○ (Azure Trusted Signing) | × | **가장 직접적인 격차** |
| 자동 업데이트 · 채널 | ○ (stable/canary) | × | 0.6 항목 |
| 업데이트해도 상태 유지 | ○ (SQLite 마이그레이션, 설정 스키마 v0→v1 이전 코드) | × (BR-09) | 결정 1 근거 |
| MSI 설치본 | ○ | × (NSIS만) | 기업 배포가 필요할 때 |
| 워크트리 | ○ (태스크마다 기본) | △ (세션 워크트리 옵트인, `workspace.rs` `.eqmux/worktrees/<세션>`) | 방향 차이 |
| 워크트리에 `.env` 복사 | ○ (`preservePatterns`) | × | 가져올 것 |
| 태스크별 포트 범위 | ○ (`EMDASH_PORT`) | × | 가져올 것 |
| setup/teardown 스크립트 | ○ | × | 나중 |
| 에이전트 설치 안내 | △ (WinGet은 Claude Code만) | △ (미설치 경고) | 가져올 것 |
| 앱을 꺼도 PTY 유지 (Windows 로컬) | × (tmux는 macOS·Linux만) | × | **같다.** Windows에서는 Emdash도 못 한다 |
| 재시작 후 재개 | ○ (지원 에이전트) | △ (재개 제안) | 비슷 |
| 알림 클릭 → 대화 | ○ (v1.2.7) | × (0.6으로 미룸) | Orca · herdr · Emdash 셋 다 있다 |
| diff 코멘트 → 에이전트 | ○ (v1.2.8 초안 첨부) | × | Orca 5번과 같음 |
| 커밋 · 푸시 · PR · 머지 | ○ | × (원칙) | 가져오지 않음 |
| 이슈 트래커 10종 | ○ | × | 가져오지 않음 |
| 예약 자동화 | ○ | × | 원칙과 충돌 |
| 채팅 UI(ACP) | ○ | × | 가져오지 않음 |
| SSH · 원격 · Cloud | ○ | × | 가져오지 않음 |
| 파일 에디터 · LSP | ○ | × | 가져오지 않음 |
| 프롬프트 · 스킬 · MCP 라이브러리 | ○ | △ (역할 라이브러리) | MCP는 0.6 이후 |
| 역할 · 페르소나 · 팀 | × | ○ | **EQMUX만** |
| 에이전트 간 메시지 | × (찾지 못함) | ○ | **EQMUX만** |
| 관제 그리드 | × | ○ | **EQMUX 우위** |
| 사용자 전역 설정 불가침 | × (전역 설정에 훅을 쓴다) | ○ | **EQMUX 우위** |
| 한국어 UI · 한글 IME | 확인 필요(언급 없음) | ○ | 한국 사용자 대상 차별점 |

## 5. 가져올 것 — 우선순위

Orca·herdr 문서의 항목과 겹치면 근거만 보탠다.

| 순위 | 기능 | Emdash에서 | EQMUX에 넣는 방식 | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **코드 서명 + 자동 업데이트(채널)** | Azure Trusted Signing으로 exe·msi에 서명하고, electron-updater로 stable/canary를 나눈다 | "인증서 같은 외부 자원"이 미룬 이유였다. 클라우드 서명 서비스를 쓰면 하드웨어 토큰 없이 CI에서 서명할 수 있다. Tauri updater를 붙일 때 herdr 문서 7번의 채널을 처음부터 넣는다 | 중간(계정·CI 설정) | 0.6 첫 항목 |
| 2 | **업데이트해도 상태 유지** | 설정 JSON에 `version`을 두고 v0→v1 이전 함수를 둔다. 지우지 않는다 | 결정 1을 (b)로 확정한다. team.json 스키마 버전 검사(P2)를 같이 하면 0.6의 (c)로 가는 길이 생긴다 | 작음 | 0.5 P0 |
| 3 | **미설치 엔진에 설치 명령 보이기** | 앱 안 에이전트 설치, Windows는 WinGet | P1 "엔진 경고 순서·폭"(U-4·5)을 고칠 때, 경고 아래에 공식 Windows 설치 명령을 복사 버튼과 함께 보인다. 실행은 사람이 터미널에서 한다(자동 실행 없음). 설치 후 다시 감지 버튼 | 작음 | 0.5 P1에 붙임 |
| 4 | **워크트리에 `.env` 복사** | `preservePatterns`로 무시 파일을 새 워크트리에 복사 | `worktree_create`(`workspace.rs:213`)가 만든 직후 패턴에 맞는 파일을 복사한다. 패턴은 `.eqmux/`의 커밋 대상 파일에 둔다(파일이 원본). 기본값은 빈 목록 — 비밀 파일 복사는 사람이 켠다 | 작음 | 0.6 |
| 5 | **세션별 포트 범위** | `EMDASH_PORT` = 태스크마다 10칸 범위 | 에이전트 환경 변수 주입 자리(`agent.rs:348` 근처)에 `EQMUX_PORT`를 슬롯 번호로 계산해 넣는다. 서버 탭·포트 패널이 그 범위를 세션 이름으로 표시한다 | 작음 | 0.6 |
| 6 | **알림 클릭 → 해당 세션** | v1.2.7, 다른 페인의 탭까지 찾아간다 | Orca 2번 · herdr 2번과 같다. 경쟁 셋이 모두 가진 기능이 됐다 | 중간 | 0.5 P2 후보 |
| 7 | **diff 코멘트 → `review` 메시지** | 초안 코멘트를 채팅에 첨부 | Orca 5번과 같다 | 중간 | 0.6 |
| 8 | **엔진별 지원 표** | providers 문서: 자동 승인 · 재개 · 훅 · 첫 프롬프트 방식 | `docs/site`에 Claude Code · Codex 두 줄짜리 표(훅 주입 방식, 재개, 권한 번역)를 둔다. 혼성 팀 문의를 줄인다 | 작음 | 0.5 문서 정합화 |
| 9 | **비교표에 Emdash 열** | — | Orca 9번 비교표에 넣는다. 한 줄 설명: "Emdash는 태스크를 병렬로, EQMUX는 팀으로 돌린다" | 작음 | 0.5 문서 정합화 |

## 6. 가져오지 않을 것

| 기능 | 이유 |
|---|---|
| 앱이 커밋 · 푸시 · PR · 머지 | `git.ts`가 밝힌 원칙(G7)이다. 쓰기는 터미널에서 사람이나 에이전트가 한다. diff는 보여 주고 결정은 사람이 한다 |
| 이슈 트래커 10종 연동 · 계정 여러 개 | 앱이 토큰을 들게 된다. 에이전트가 `gh` 등으로 직접 한다(Orca 문서와 같은 이유) |
| 사용자 전역 에이전트 설정에 훅 쓰기 | 앱을 지워도 사용자 설정에 흔적이 남는다. EQMUX는 실행 인자로만 넣는다. 이 차이는 비교표에 차별점으로 쓴다 |
| 예약 자동화 | "자동 실행 경로는 없다" 원칙과 충돌한다. Emdash는 자동화에서 자동 승인을 따로 켤 수 있다 |
| 채팅 UI(ACP) | Orca 문서와 같은 이유. 터미널이 작업 공간이다 |
| 태스크마다 워크트리 기본 | 팀이 한 저장소를 함께 다루는 모델과 다르다. 옵트인 세션 워크트리로 충분하다. 삭제는 계속 사람 몫이다(FR-E-64) |
| SSH · workspace-server · Cloud | Windows 로컬 팀 관제 범위 밖이다 |
| 파일 에디터 · LSP | 외부 에디터로 연다 |
| 35종 에이전트 | Claude Code · Codex 혼성 팀의 깊이가 먼저다 |

## 7. 위협과 대응

- **설치해 보고 비교하면 진다.** 같은 Windows PC에서 둘을 깔면 Emdash는 서명된 설치본, 자동 업데이트, 역할 설정 없이 바로 뜨는 첫 태스크를 준다. EQMUX는 서명이 없고, 업데이트를 손으로 받고, 업데이트하면 등록이 지워진다. 기능 차이가 아니라 **첫 10분**에서 이탈한다. 5장 1·2·3번이 대응이다.
- **herdr 문서의 "EQMUX가 먼저 서명하면 앞선다"는 Emdash에는 해당하지 않는다.** 가장 직접적인 경쟁자는 이미 서명했다. 서명은 차별점이 아니라 최소 조건이다.
- **권한 차별점이 약해진다.** Orca 대비 "Yolo 기본이 아니다"는 Emdash에는 통하지 않는다(자동 승인 기본 꺼짐). 남는 차별점은 bypass 경로 자체가 없다는 것, 사용자 전역 설정을 건드리지 않는다는 것, 외부 토큰을 들지 않는다는 것이다.
- **Windows에서는 Emdash도 프로세스를 살리지 못한다.** tmux 경로가 Windows 로컬에 없다. "앱을 꺼도 에이전트가 산다"는 Windows에서 아직 경쟁 기준이 아니다. ConPTY + Job Object 정리와 재개 성공률을 QA 수치로 보이면 오히려 앞설 수 있다.
- **속도와 폭.** 2인 팀이 6주에 stable 6회를 내고 이슈 연동을 계속 늘린다. 폭으로는 따라가지 않는다. 팀 조직 · 메시지 버스 · 관제 그리드 · 한국어를 깊게 판다는 Orca·herdr 문서의 결론이 그대로다.

## 8. 0.5 기획서에 반영할 것

1. 결정 1을 (b)로 확정한다 — Orca · herdr · Emdash 셋 다 업데이트에 상태를 지우지 않는다.
2. "0.6 이후로 미루는 것"의 코드 서명 · 자동 업데이트를 0.6 첫 항목으로 못 박는다. 미룬 이유(외부 자원)에 클라우드 서명이라는 대안을 적는다.
3. P1 "엔진 경고 순서·폭"에 미설치 엔진의 설치 명령 표시를 붙인다(5장 3번).
4. 0.6 범위에 워크트리 `.env` 복사 · 세션 포트 범위 · 알림 클릭 이동 · diff 코멘트 → `review`를 올린다.
5. 문서 정합화(P1)의 비교표에 Emdash 열과 엔진별 지원 표를 넣는다.

## 출처

- https://github.com/generalaction/emdash · /releases · /issues?q=windows (2026-10-14 조회, 별·포크는 GitHub API)
- https://github.com/generalaction/emdash/blob/main/apps/emdash-desktop/electron-builder.config.ts · `agents/architecture/settings.md` · `apps/emdash-desktop/src/core/primitives/conversations/api/conversation-config.ts`
- https://emdash.com/ · /changelog · /cloud
- https://emdash.com/docs · /docs/installation · /docs/tasks · /docs/providers · /docs/project-config · /docs/diff-view · /docs/automations · /docs/tmux-sessions
- https://www.ycombinator.com/companies/emdash
