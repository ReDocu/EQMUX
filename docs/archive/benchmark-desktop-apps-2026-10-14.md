# 벤치마킹 — AI 에이전트용 데스크톱 앱 — 2026-10-14

대상: `docs/multiplexer-tools-2026-10-14.md` 1장 표에 있는 16개.
기준: EQMUX `sub_main` 0.4.2, `docs/update-plan-0.5.0.md`, `docs/archive/unimplemented-features-2026-10-14.md`.
방법: 오픈소스는 GitHub README 원문을 읽고 `gh api`로 별 수·라이선스·최근 커밋을 확인했다(2026-10-14 기준). 비공개 제품은 공식 사이트·문서를 읽었다. 경쟁사가 쓴 비교 글은 이번 조사에 쓰지 않았다.
Orca는 `docs/orca-benchmark-2026-10-14.md`를 따르고 여기서는 다시 조사하지 않았다.

## 1. 한 줄 결론

이 분류의 기본기는 다섯 가지다. 워크트리 병렬 실행, 주의 알림, diff 리뷰, 앱을 꺼도 유지되는 세션, 모바일이다. EQMUX만 가진 축은 "역할이 있는 팀이 타입 메시지로 협업한다"이다. 그런데 wmux(openwong2kim)가 이미 Claude Code↔Codex 대화와 "Needs you" 전역 목록을 갖췄다. 그래서 에이전트 간 대화만으로는 더 이상 차별점이 되지 않는다. EQMUX는 관제 기본기(알림 센터, 주의 목록, 전달 확인, 한도 표시)부터 채우고, 역할과 권한으로 차별화해야 한다.

## 2. 도구별 표

| 도구 | 포지셔닝 | 플랫폼·라이선스 | 핵심 기능 3~5개 | EQMUX 대비 강점 | EQMUX 대비 약점 |
|---|---|---|---|---|---|
| **Orca** | "agent IDE". 태스크 1개 = 워크트리 1개 | Mac·Win·Linux·모바일, MIT, ★92k | 병렬 워크트리, Native Chat, SSH·원격 서버, diff 주석, orchestration CLI | 규모·출시 속도·OS 범위. 상세는 `orca-benchmark` 문서 | 역할·타입 메시지 없음. Yolo 기본 |
| **wmux** (openwong2kim) | "The ADE for AI agents". 데몬 + 플릿 관제 | Win 10/11·mac(Apple Silicon)·Linux 실험판·iOS 앱, MIT, ★426. Electron | ① 데몬이 세션을 소유한다(종료·크래시·재부팅 뒤에도 살아 있다) ② 한 프롬프트를 워크트리 최대 8개로 나눠 실행하고 헝크 단위로 채택한다 ③ Fleet(`Ctrl+Shift+A`): 모든 워크스페이스 에이전트를 Needs you → 리뷰 대기 → 실행 중 순으로 보여 주고, 행에 에이전트 질문을 띄운다 ④ Claude Code↔Codex `send_message`, MCP 브라우저·CDP Chrome ⑤ 한도에 걸린 페인은 멈추고, 예약 프롬프트·메시지를 보류한다 | Windows 네이티브에 기능 폭도 넓다. iOS 승인, winget·choco 설치, SHA-256으로 검증하는 자동 업데이트(30분 주기), 23개 언어. **EQMUX 0.4.2의 대표 기능(혼성 팀 대화)을 이미 갖췄다** | 역할·페르소나·권한 파일이 없다. 메시지에 타입이 없고 채널 게시와 nudge가 섞여 있다. 한도 리셋 후 자동 재개, 할당량 따라 계정 자동 전환처럼 자동 실행 경로가 있다(기본은 꺼짐) |
| wmux (amirlehmam) | "Windows 에이전트 가시성 레이어". 관찰 위주 | Win, MIT, ★416. Electron, v2.15 | ① "누가 나를 기다리나" 배너(오래 기다린 순)와 `Ctrl+Shift+A` 내비게이터 ② 알림 센터: 페인 링·벨·클릭하면 이동 ③ 화면 판독으로 상태 추정. 추정 상태는 빈 점으로 표시하고, 판독에 실패하면 "silent"로 둔다 ④ 휴대폰 웹 콘솔. 에이전트가 낸 선택지를 버튼으로 띄우고, 이미 지난 질문에 대한 응답은 거부한다 ⑤ 명명 파이프 JSON-RPC(cmux 프로토콜 호환) | 정직한 상태 표시 원칙("추정은 추정으로"). 첫 실행 때 앱 폴더 밖 파일을 건드리기 전에 묻는다. 자동 업데이트도 3일 격리 후 사용자가 클릭해야 설치한다 | 팀·메시지 버스가 없다. 자체 오케스트레이터 플러그인은 "Claude Code가 이제 더 잘한다"며 2.12에서 폐기했다. 코드 서명이 없다 |
| wmux (snowyukitty) | openwong2kim/wmux의 **포크**(2026-06 생성) | Win, MIT, ★0 | 원본과 같다 | — | 별도 제품이 아니다. 목록에서 빼도 된다 |
| **Superset** | "100개 이상의 에이전트를 병렬로 부리는 agentic IDE" | mac 주력, Linux AppImage 실험판, **Win 없음**. Elastic License 2.0(소스 공개, OSI 아님), ★15.2k. 무료(1인·로컬) / Pro $15·사용자·월(연납) / Enterprise | ① 워크트리 워크스페이스, 포트를 워크스페이스별로 감지하는 브라우저 미리보기 ② diff 뷰어에서 코멘트·편집·커밋 ③ PR diff 줄을 골라 에이전트에 피드백 ④ 브라우저 Design 모드: 요소를 골라 맥락과 함께 에이전트에 보낸다 ⑤ CLI·SDK·MCP, 내장 `superset:*` 스킬, setup·teardown 스크립트 | 리뷰 루프가 촘촘하다(PR 줄 → 에이전트, Pages 코멘트 → 에이전트가 수정). 터미널 프리셋. 원격 접속·iPhone(Pro) | Windows가 없다. 예약 자동화와 Slack·Linear 연동은 유료다. 역할이나 에이전트 간 메시지 없이 오케스트레이션을 스킬에 맡긴다 |
| **Conductor** | "Mac에서 병렬 코딩 에이전트" | **mac 전용**, 독점(요금 페이지 있음, 내용 미확인) | ① 태스크마다 워크스페이스·브랜치·터미널·diff ② diff 리뷰 → PR → 머지 → 워크스페이스 보관 ③ Checks·Agent modes·API 문서 ④ Claude Code·Codex·Cursor·OpenCode | 태스크 수명 주기(생성 → 리뷰 → PR → 보관)가 한 흐름이다. 버전 0.90으로 성숙했다 | Windows가 없다. 비공개다. 에이전트끼리 대화하지 않는다 |
| **cmux** | "AI 에이전트용 Ghostty 기반 macOS 터미널". 스스로를 "해법이 아니라 부품"이라 한다 | **mac 전용**, GPL-3.0, ★28.2k. Swift/AppKit + libghostty. 유료 Founder's Edition(iOS·클라우드 VM 조기 접근) | ① 알림 링과 알림 패널. `⌘⇧U`로 가장 최근 미확인으로 이동한다 ② 사이드바에 브랜치·PR 번호·cwd·포트·마지막 알림 문구 ③ 스크립트로 조종하는 브라우저(agent-browser 이식) ④ `cmux claude-teams`: Claude Code 팀원 모드를 네이티브 분할로 띄운다 ⑤ `cmux.json` 커스텀 명령, CLI·소켓 API, SSH·클라우드 워크스페이스 | 네이티브 성능. 별 수 2위. **Claude Code Agent Teams를 화면에 올리는 길을 이미 열었다** | Windows가 없다. 관제·역할이 없고 의도적으로 "의견 없는 도구"를 지향한다 |
| **Nimbalyst** (옛 Crystal) | "코딩 에이전트용 시각 작업 공간" | Mac·Win·Linux·iOS, MIT, ★1.9k(Crystal ★3.1k). 개인 무료 / Teams $20·사용자·월(베타 무료) / Enterprise | ① 마크다운·목업·Mermaid·Excalidraw·CSV WYSIWYG 편집기. 에이전트와 같은 파일을 고친다 ② 렌더된 문서 위에서 red/green diff를 하나씩 수락·거절 ③ 세션 칸반, 세션 검색·재개, 세션↔파일 연결 ④ 에이전트가 읽고 고치는 태스크 트래커 ⑤ MCP 클라이언트, 편집기 확장 SDK, iOS 컴패니언 | "평범한 파일이 원본"이라는 원칙이 EQMUX와 같다. 세션과 파일을 서로 연결한다. 팀 실시간 협업(유료) | 터미널은 보조다. 에이전트 간 메시지나 역할이 없다. 지원 에이전트는 Claude Code·Codex 정식, 나머지는 알파다 |
| **Paneflow** | "에이전트 시대의 멀티플렉서" | Mac·Linux·**Win(.msi)**, GPL-3.0-or-later, ★84. Rust + GPUI + libghostty-vt | ① 세션 호스트가 따로 돌아 앱을 꺼도 유지된다(종료할 때 선택) ② MCP 브리지 `read_pane`·`search_pane`: 다른 에이전트 페인을 읽는다. 출력은 **신뢰할 수 없는 데이터로 감싸서** 돌려준다 ③ `paneflow send`는 기본이 입력란 채우기다. 실제 전송은 `--submit`을 붙여야 한다 ④ `wait --pattern`, `watch --type ai.stop`, `flow.toml` 단계 실행 ⑤ Changes 탭에서 블록 단위로 되돌리기, 내장 편집기 | **"프롬프트는 채워 두고 Enter는 사람이"**를 기본으로 둔다. EQMUX 원칙과 가장 가깝다. 텔레메트리는 옵트인 | 규모가 작다(별 84). 역할·관제 보드가 없다 |
| **Termdock** | "에이전트가 모는 터미널" | Mac·Win(사이트 기준, Linux 언급 없음), 독점, 무료·계정 불필요 | ① Workstream 패널: 권한 요청·질문·계획 종료를 한곳에서 승인·거절·답장 ② `termdock notify`로 Discord·Telegram 알림 ③ 휴대폰 웹 페어링, 같은 네트워크 기기끼리 E2E 원격 ④ cron 예약, 에이전트를 잇는 워크플로, 웹훅 ⑤ AST 코드 그래프(9개 언어), 사용량 대시보드, 프롬프트 라이브러리 | 승인 요청을 모으는 Workstream. 원격·알림 채널이 넓다 | 비공개다. 예약·워크플로처럼 자동 실행이 중심이다. 역할이 없다 |
| **Termlux** | "모든 에이전트를 차분한 창 하나에" | **mac(Apple Silicon) 전용**, 독점(EliteTech Innovations). 베타 €0 / Free 워크스페이스 3개 / Pro €99/년 / Team €192/년·인 | ① Claude Code를 읽기 쉬운 채팅으로 보여 준다(`⌘⇧T`로 터미널과 전환) ② 태스크 보드. Claude가 버그를 올리고, 확인한 뒤 완료 처리한다. 최대 5개 동시 실행 ③ To review 대기열(리뷰·머지·되돌려 보내기·폐기) ④ 5시간·주간 한도를 입력란에 표시한다. 리셋 때 시작하거나, 한도에 걸린 보드 실행을 멈췄다가 재개한다 ⑤ 워크스페이스마다 Claude 계정, 세션 전체 검색(`⌘⇧F`), 비밀값을 가린 권한 요청 | 한도·비용 표시가 가장 구체적이다. 리뷰 대기열 | Windows가 없다. 비공개 유료다. 권한 모드에 Bypass를 그대로 노출한다 |
| **Terax** | "7MB 터미널 우선 AI 개발 환경" | Mac·Win·Linux, Apache-2.0, ★9.3k. Tauri | ① 터미널·에디터·탐색기·소스 컨트롤·웹 프리뷰 통합 ② 자체 에이전트(BYOK·로컬 모델) ③ Job Object, spawn 뮤텍스 (`docs/terax-features.md`) | 가볍다. 구조가 EQMUX와 같다(Tauri + portable-pty + xterm.js) | 외부 CLI 팀 관제가 아니다. 앱이 키를 받는다 |
| Sculptor | Imbue의 병렬 에이전트 앱. "리서치 프리뷰" | mac(Apple Silicon)·Linux, MIT, ★238 | 워크스페이스(격리 사본) → 리뷰 → 머지. Claude Code·Pi 하네스 통합, 임의의 터미널 에이전트도 띄운다. 내장 워크플로 스킬(`fix-bug` 등). 컨테이너 백엔드는 실험 기능이다 | 스킬로 작업 절차를 표준화한다 | Windows가 없다. 외부 기여를 받지 않는다 |
| Mux → **Xum** (Coder) | 격리된 병렬 에이전트 개발용 데스크톱 앱. 상표 문제로 Mux에서 Xum으로 이름을 바꿨다 | mac·Linux, AGPL-3.0, ★2.1k | 자체 에이전트 루프(멀티 모델·Ollama·OpenRouter), 로컬·워크트리·SSH 실행, git 갈라짐 보기, 비용·토큰 표시, 서버 모드 모바일 UI | 비용·컨텍스트 관리 UI | 앱이 모델 키를 쥔다. Windows가 없다 |
| Opcode (옛 Claudia) | Claude Code GUI·툴킷 | Tauri 2, AGPL-3.0, ★22.4k. **사실상 중단**: 마지막 코드 커밋 2025-10-13, 마지막 릴리스 v0.2.0(2025-08-31) | `~/.claude/projects` 세션 탐색·재개, 커스텀 에이전트, 사용량·비용 차트, MCP 서버 관리, 체크포인트 타임라인 | 세션 탐색·사용량 차트의 원형 | 유지보수가 끊겼다 |
| **Codex 앱** → ChatGPT 데스크톱 | Codex 앱 문서 URL이 ChatGPT 데스크톱 앱 문서(`learn.chatgpt.com/docs/app`)로 넘어간다. 통합된 것으로 보인다 | Mac·Win·Linux(문서 기준), 독점, ChatGPT 플랜 | Windows 기본은 PowerShell + 네이티브 샌드박스, WSL2는 선택. 병렬 채팅·워크트리·예약 작업·git·브라우저·플러그인·스킬. 승인 프롬프트를 켜 두기를 권장한다 | 플랫폼 소유자다. Windows 샌드박스가 1급이다 | Codex 전용이다. 다른 CLI와 섞이지 않는다 |

**목록 문서와 다른 점** (이번에 확인한 것)

- snowyukitty/wmux는 openwong2kim/wmux의 포크다.
- openwong2kim/wmux는 Windows 전용이 아니다. macOS와 iOS 앱도 있다.
- Superset 라이선스는 Elastic License 2.0이다. Pro는 연납 $15, 월납 $20이다.
- cmux는 GPL-3.0이다.
- Mux는 Xum으로 이름을 바꿨다.
- Paneflow는 Windows `.msi`를 낸다. 라이선스는 GPL-3.0-or-later이다.
- Termdock 사이트는 Mac·Windows만 언급한다.
- Terax는 Apache-2.0이다.
- Sculptor의 Docker 격리는 이제 실험 기능이다. 기본은 워크스페이스 사본이다.
- Codex 앱은 ChatGPT 데스크톱으로 합쳐진 것으로 보인다.

## 3. 분류 공통 패턴 (시장 기본기)

| 패턴 | 가진 도구 | EQMUX |
|---|---|---|
| 태스크마다 워크트리·브랜치 | 거의 전부(wmux, Superset, Conductor, Nimbalyst, Paneflow, Termlux, Sculptor, Xum, Codex, Orca) | △ 세션별 워크트리 옵트인 |
| 주의 알림 + 클릭하면 이동 | cmux, wmux 2종, Superset(독 배지·차임), Termdock, Orca | △ OS 알림만. 클릭 처리가 없다 |
| "나를 기다리는 에이전트" 목록 | wmux Fleet, amirlehmam 내비게이터, Termdock Workstream, Nimbalyst·Termlux 보드 | △ 대시보드 주의 카드에 waiting 1개만(U-2) |
| diff 리뷰 + 코멘트·채택 | Superset, Conductor, wmux, Nimbalyst, Paneflow, Termlux, Orca | △ diff 뷰어만 |
| 앱을 꺼도 세션 유지 | wmux(데몬), Paneflow(호스트), Superset, Orca | × Job Object로 정리하고 재개를 제안한다 |
| 모바일·원격 | wmux iOS, amirlehmam 웹 콘솔, Superset iPhone, Nimbalyst iOS, Termdock, Termlux, cmux 베타, Xum 서버 모드 | × |
| 사용량·한도 표시 | wmux, Termlux, Termdock, Xum, Opcode, Orca | △ statusLine 비용만 |
| 에이전트가 앱을 조종하는 CLI·소켓·MCP | 거의 전부 | ○ `eqmux` CLI + 명명 파이프 |
| 인앱 브라우저 | wmux, cmux, Superset, Termdock, Codex, Orca | ○ |
| 커맨드 팔레트 | Superset, wmux, cmux, Sculptor, Termlux | × |
| 자동 업데이트 | wmux 2종, cmux(Sparkle), Termlux, Orca | × |

**아무도 안 가진 것** — 역할·페르소나, 권한을 정하는 역할 파일, 타입이 강제된 메시지(ask/handoff/report/review/escalate), 메시지 원장을 파일로 남기는 것. EQMUX의 해자는 여기다.
**가까워지는 것** — wmux의 `send_message`와 채널, cmux의 `claude-teams`, Termdock 워크플로, Paneflow `flow.toml`. 에이전트끼리 말하게 하는 기능은 빠르게 기본기가 되고 있다.

## 4. EQMUX가 가져올 것

원칙(자동 실행 없음, 앱은 키 미보유, `.eqmux/` 파일이 원본, frontmatter가 권한)과 맞는 것만 골랐다. 7~10위는 Orca 문서와 겹친다. 여기서는 출처를 보강하는 의미로만 적는다.

| 순위 | 기능 | 출처 도구 | EQMUX에 넣는 방식(기존 코드 재사용 위주) | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **앱 안 알림 센터 + "다음 미확인으로" 단축키** | cmux(`⌘⇧U`), wmux 2종(벨·`Ctrl+I`), Superset | OS 알림을 띄우는 `maybe_notify`(`agent.rs:411`)에서 같은 건을 앱 안 목록에도 쌓는다. 앱 바에 벨과 미확인 수를 두고, 클릭하거나 단축키를 누르면 그 세션 페인으로 이동한다. 알림 플러그인 클릭 콜백 없이 FR-G-33을 푼다(Orca 문서 2번과 같은 결론) | 작음 | 0.5 |
| 2 | **"나를 기다리는 에이전트" 전역 목록** | wmux Fleet, amirlehmam 내비게이터, Termdock Workstream | 대시보드 주의 카드(U-2)가 열린 모든 워크스페이스의 waiting 세션을 기다린 시간 순으로 전부 보이게 한다. 행에는 이미 받고 있는 `waitingFor`(Notification 훅 문구)를 띄우고, 클릭하면 페인으로 간다. 같은 목록을 단축키 오버레이로도 연다 | 작음 | 0.5 |
| 3 | **메시지 전달 확인** | wmux "delegate to agents" 계약(채널 게시는 알림일 뿐, 턴을 시작시키지 않는다) | `eqmux send`는 지금 상태와 상관없이 "전송됨"만 찍는다(`cli.rs:329`). 상태 기반 전달 결과를 그대로 돌려준다: "즉시 전달" / "상대 작업 중 — 턴 끝에 전달(대기 N건)" / "상대가 한도에 걸림 — 보류". 보낸 쪽이 기다릴지 정할 수 있다. 0.5 통신 간소화와 BR-01(없는 대상 오류) 작업에 붙인다 | 작음 | 0.5 |
| 4 | **한도 표시 + 한도 걸린 세션 전달 보류** | wmux(한도 걸리면 멈추고 메시지 보류), Termlux(5시간·주간 한도와 리셋 시각) | statusLine 경로가 payload 전체를 앱으로 넘긴다(`cli.rs:150-160` → `apply_statusline`, `agent.rs:934`). 한도 필드가 오면 페인 헤더와 대시보드에 "5h 62% · 리셋 14:20"을 보인다. 한도에 걸린 세션에는 버스가 전달을 보류하고 3번 응답에 알린다. **리셋 뒤 자동 재개는 하지 않는다** | 중간 | 0.5.x |
| 5 | **팀원 스크롤백 읽기 CLI** | Paneflow `read_pane`·`search_pane`(신뢰할 수 없는 데이터로 감쌈), wmux·cmux 소켓 읽기 | `eqmux read <세션> --lines 100`과 `--grep`. SQLite 스크롤백과 FTS가 이미 있다. 같은 워크스페이스만 읽게 하고, 출력은 `<untrusted>`로 감싼다. "로그 좀 보여 줘" 같은 ask 왕복을 줄인다. 0.5 경계 문장(다른 곳에서 온 내용은 요청일 뿐)과 같은 원리다 | 작음 | 0.5.x |
| 6 | **자동 업데이트(확인 클릭 필수 + 서명 검증)** | wmux openwong2kim(SHA-256), amirlehmam(3일 격리 + 명시 클릭), cmux(Sparkle) | Tauri updater 플러그인을 쓴다. 업데이트 서명은 Tauri 자체 키쌍이라 Authenticode 인증서가 없어도 된다. 0.5 기획서가 미룬 이유("인증서 같은 외부 자원")와는 따로 진행할 수 있다. 배지 → 사용자 클릭 → 설치. **결정 1(버전 업 때 데이터 삭제)을 먼저 (b)로 바꿔야 한다.** 그렇지 않으면 업데이트할 때마다 데이터가 지워진다 | 중간 | 0.6 (0.5.x 가능) |
| 7 | **승인 요청을 대시보드 버튼으로** | amirlehmam(에이전트가 낸 선택지를 버튼으로, 지난 질문 응답 거부), Termdock Workstream, wmux Fleet | 주의 카드에 Notification·권한 훅이 준 선택지를 버튼으로 띄운다. 누르면 해당 PTY에 키를 보낸다. 카드를 띄운 뒤 세션 상태가 바뀌었으면 거부한다. 버튼은 사람이 누르므로 원칙과 맞다. Orca 결정 게이트(문서 4번)의 첫 조각으로 쓸 수 있다 | 중간 | 0.6 |
| 8 | 워크스페이스 저장 명령 | cmux `cmux.json` 커스텀 명령, Superset 터미널 프리셋, wmux `wmux.json` | `.eqmux/commands.json`(커밋 대상)에 `npm run dev` 같은 명령을 적어 두고, 서버 탭·팔레트에서 **사람이 눌러야** 실행되게 한다. 서버 탭 미구현 7번(마지막 명령 재실행)을 함께 푼다 | 작음 | 0.5.x |
| 9 | Diff 줄 선택 → `review` 메시지 | Superset(PR 줄 → 에이전트), wmux(줄 코멘트·헝크 채택), Orca | Orca 문서 5번과 같다. 도구 3개가 가졌으니 기본기다 | 중간 | 0.6 |
| 10 | 커맨드 팔레트 · 과거 세션 검색·재개 | Superset, wmux, cmux, Sculptor, Termlux(`⌘K`·`⌘⇧F`), Opcode, Nimbalyst | Orca 문서 6·7번과 같다 | 작음·중간 | 0.6 |

## 5. 가져오지 않을 것

| 기능 | 출처 | 이유 |
|---|---|---|
| 한도 리셋 뒤 자동 재개, 예약 프롬프트, cron 자동화, 에이전트를 잇는 워크플로 | wmux(Resume at reset·schedules), Termlux, Termdock, Superset Automations, Paneflow `flow run` | "자동 실행 경로는 없다" 원칙과 충돌한다. 한도는 표시와 전달 보류(4위)까지만 한다 |
| 할당량에 따라 계정 자동 전환, 워크스페이스마다 계정 로그인 | wmux, Termlux | 자동 전환은 자동 실행이다. 앱이 계정·자격 증명을 다루기 시작하면 키 미보유 원칙이 흐려진다 |
| 자체 에이전트 루프·BYOK 멀티 모델 | Xum, Terax, Superset providers | 앱은 API 키를 보유하지 않는다 |
| 한 프롬프트를 N개 워크트리에 뿌려 경쟁·채택 | wmux fan-out, Superset, Conductor, Sculptor, Termlux 보드, Orca | EQMUX는 역할이 다른 팀의 협업 모델이다. 세션 슬롯 수도 가독성 기준(기본 4)이다. 워크트리 옵트인으로 충분하다 |
| Claude Code를 채팅 UI로 다시 그리기 | Termlux, Opcode, Sculptor, Codex, Orca | 터미널 페인이 작업 공간이다. 이 영역은 출시 속도로 이길 수 없다 |
| Bypass·full access 권한 노출 | Termlux 권한 모드, Codex full access | 역할 frontmatter가 권한을 정한다 |
| 데몬이 PTY를 소유(앱을 꺼도 프로세스 유지) | wmux, Paneflow, Superset, Orca | Job Object로 프로세스 트리를 정리하는 것이 EQMUX 안정성의 근거다. 구조 변경도 크다(VT 서버 모델, 0.6 이후). **다만 도구 4개가 가져 기본기가 되고 있다. 0.6 기획 때 다시 본다** |
| 모바일 앱·원격 웹 콘솔·LAN 원격 | wmux iOS, amirlehmam, Superset, Nimbalyst, Termdock, Termlux | Windows 로컬 팀 관제라는 범위 밖이다. 나중에 한다면 amirlehmam 방식(기본은 꺼짐, 127.0.0.1만, 기기별 자격, 읽기 전용 기본)이 최소선이다 |
| 시각 편집기·Design 모드·AST 코드 그래프 | Nimbalyst, Superset, Termdock | IDE 영역이다. 사용자가 이미 쓰는 IDE가 있다 |
| GitHub PR 페이지·Slack·Linear 연동, Pages 공유 | wmux Git 페이지, Superset, Conductor | 앱이 토큰을 들거나 클라우드가 필요하다. 에이전트가 `gh`로 직접 한다 |
| 화면 판독으로 상태 추정 | amirlehmam | Claude Code·Codex 모두 훅으로 상태를 받는다. 다만 "추정은 추정으로 표시하고, 모르면 idle이 아니라 모름"이라는 표시 원칙은 degraded 표시 문구에 참고할 만하다 |

## 6. 출처 URL

공식 README·사이트 (원문 확인, 2026-10-14)

- Orca: https://www.onorca.dev/ (상세는 `docs/orca-benchmark-2026-10-14.md`)
- wmux (openwong2kim): https://github.com/openwong2kim/wmux · https://github.com/openwong2kim/wmux/blob/main/docs/how-to/delegate-to-agents.md · https://www.wmux.app
- wmux (amirlehmam): https://github.com/amirlehmam/wmux · https://wmux.org
- wmux (snowyukitty, 포크): https://github.com/snowyukitty/wmux
- Superset: https://github.com/superset-sh/superset · https://superset.sh/pricing
- Conductor: https://www.conductor.build/ · https://www.conductor.build/docs/
- cmux: https://github.com/manaflow-ai/cmux · https://cmux.com
- Nimbalyst: https://github.com/nimbalyst/nimbalyst · https://nimbalyst.com/pricing · (옛 Crystal) https://github.com/stravu/crystal
- Paneflow: https://github.com/arthjean/paneflow · https://paneflow.dev
- Termdock: https://www.termdock.com/ · https://github.com/termdock/termdock-issues
- Termlux: https://termlux-fe-sigma.vercel.app/
- Terax: https://github.com/crynta/terax-ai · https://terax.app (상세는 `docs/terax-features.md`)
- Sculptor: https://github.com/imbue-ai/sculptor
- Xum (옛 Mux): https://github.com/coder/mux (→ coder/xum) · https://mux.coder.com
- Opcode: https://github.com/winfunc/opcode
- Codex 앱 / ChatGPT 데스크톱: https://learn.chatgpt.com/docs/app · https://learn.chatgpt.com/docs/app/windows (openai.com/codex는 403으로 읽지 못함)

검증 안 됨

- 이번 문서는 경쟁사 비교 글을 쓰지 않았다. `docs/multiplexer-tools-2026-10-14.md`가 인용한 amux·cmux·Nimbalyst·Superset 비교 글은 경쟁사가 쓴 것이라 검증되지 않았다.
- Conductor 요금, Codex 앱이 포함된 ChatGPT 플랜, Termdock 라이선스는 공식 페이지에 적혀 있지 않아 확인하지 못했다.
