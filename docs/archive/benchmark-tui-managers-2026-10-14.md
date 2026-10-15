# TUI 에이전트 관리자 · 오케스트레이션 벤치마킹 — 2026-10-14

대상: `docs/multiplexer-tools-2026-10-14.md` 3장(TUI 에이전트 관리자 13개)과 4장(오케스트레이션·에이전트 내장형 4개)
기준: EQMUX `sub_main` 0.4.2 + `docs/update-plan-0.5.0.md` + `docs/archive/unimplemented-features-2026-10-14.md`
같이 볼 문서: `docs/herdr-benchmark-2026-10-14.md`(herdr 상세), `docs/orca-benchmark-2026-10-14.md`
조사 방법: GitHub README·저장소 문서·공식 문서 원문(`gh api`, WebFetch). 별·버전은 2026-10-14 조회값이다. 제3자 비교 글은 쓰지 않았다. README가 스스로 주장하는 수치는 "README 주장"으로 적었다.

## 1. 한 줄 결론

TUI 관리자들은 "태스크마다 워크트리 + tmux + 상태 3종"이 기본기이고, 에이전트 간 **타입 있는 메시지**는 아무도 없다. 오케스트레이션 도구는 모두 "요청한 쪽에 결과가 돌아오는 고리"(대기·회신·완료 알림)를 갖췄는데, EQMUX는 이 고리가 비어 있다. 0.5.x에서는 메시지 버스에 **회신 연결과 완료 신호**를 넣는다. 자동 승인과 에이전트의 세션 생성은 가져오지 않는다.

## 2. 도구별 표

### 2-1. 주력 TUI 관리자

| 도구 | 포지셔닝 | 플랫폼·라이선스 | 핵심 기능 | EQMUX 대비 강점 | EQMUX 대비 약점 |
|---|---|---|---|---|---|
| **claude-squad** (smtg-ai) | 여러 에이전트를 격리된 워크스페이스에서 돌리는 TUI `cs` | Go · tmux·gh 필요 · Win 네이티브 없음 · AGPL-3.0 · 별 8.6k · v1.0.20(08-20) | ① 에이전트마다 tmux 세션 + 워크트리·브랜치 ② 미리보기·diff 탭 ③ `s` 커밋·푸시, `c` 체크아웃(커밋 후 일시정지), `r` 재개 ④ 프로그램별 프로필 ⑤ `-y` 자동 승인(실험) | 브랜치 단위 일시정지·재개 흐름이 단순하다. UI를 꺼도 tmux에서 계속 돈다 | 상태 감지가 화면 해시 + 고정 문자열이다. 알림 없음. 에이전트 간 통신 없음. 팀·역할 없음 |
| **herdr** (herdrdev, 옛 ogulcancelik) | "에이전트가 사는 런타임". 서버 + 클라이언트 단일 바이너리 | Rust · **Win 네이티브 GA**(ConPTY) · Apache-2.0 · 별 4.4만 · v0.9.4(10-13) | ① 백그라운드 서버(분리해도 계속 돔) ② manifest 기반 idle/working/blocked, `done`(미확인) ③ 에이전트용 CLI·소켓 API(`pane split`·`agent start/prompt --wait/read`) ④ 스킬 파일 + `HERDR_ENV` 가드 ⑤ 플러그인 | 위임 프리미티브가 가장 완성됐다. blocked면 입력을 거절한다(`agent_blocked`). Windows 알림 클릭 → 페인 | 결과를 **화면을 읽어서** 받는다. 메시지 타입·원장·역할 없음. 한글 IME 부분 지원. 상세는 `herdr-benchmark` 문서 |
| **Agent Deck** (asheshgoplani) | AI 코딩 에이전트 "관제실". TUI + 웹 UI | Go(Bubble Tea) · tmux · Win은 WSL만 · MIT · 별 1.08k · v1.16.28(10-10) | ① 대화 포크(`f`) ② 프로젝트별 MCP 켜기·끄기, MCP 소켓 풀(README 주장: 메모리 85~90% 절감) ③ **Conductor**: 상주 감독 에이전트가 하위 세션을 감시, 일상 질문은 직접 답하고 나머지는 사람에게 올림 ④ 자식 상태 변화 → 부모에게 알림(`notify-daemon`), `NEED:` 줄 전달 ⑤ `session annotate --hint needs-input|ready-for-review` → 칸반 보드 | 감독 → 사람 에스컬레이션 경로가 있다. 텔레그램·슬랙 브리지, 웹 푸시. 훅 승인을 스크립트 sha256에 묶는다 | Windows 네이티브 아님. 감독이 일상 질문에 **자동으로 답한다**. `dangerous_mode` 있음. 메시지에 타입 없음(`이름: 메시지` 접두) |
| **CCManager** (kbwo, npm `ccmanager`) | tmux 없이 도는 워크트리·프로젝트 세션 관리자 | TypeScript(Node PTY) · tmux 불필요 · Win 경로를 문서화(`%APPDATA%`) · MIT · 별 1.26k · v4.4.6(10-10) | ① 멀티 프로젝트 ② 명령 프리셋 + 대체 인자 ③ 새 워크트리에 Claude 세션 데이터 복사 ④ 상태 전이마다 사용자 명령 실행(상태 훅) ⑤ 자동 승인(실험): Haiku가 안전한지 판정, 오류·타임아웃이면 사람에게 넘김 | Windows에서 돌 가능성이 높은 몇 안 되는 도구다. 세션 기록을 계속 써서 크래시 후 다시 띄우기를 제안한다 | 앱을 끄면 에이전트도 죽는다(EQMUX와 같음). 에이전트 간 통신 없음. 대신 `--teammate-mode in-process`를 붙여 Agent Teams에 맡긴다 |
| **Agent of Empires** | Linux·macOS용 세션 관리자. TUI + 모바일 웹 대시보드 | Rust · tmux · Win은 WSL2 · MIT · 별 3.3k · v1.19.0(10-08) · Mozilla.ai 후원 | ① TUI·웹·CLI·HTTP API ② 워크트리·멀티 저장소, Docker/Podman 샌드박스 ③ 상태: 훅 + 화면 규칙(우선순위 표), Waiting과 Idle 구분 ④ 웹 푸시: Waiting 5초 유지 후, 세션당 60초 쿨다운, **사용자가 보고 있으면 억제** ⑤ API로 다른 에이전트가 세션을 몬다(`send`·`output`·`callback_url`) | 알림 규칙이 가장 세심하다. 훅과 화면 규칙을 우선순위로 합친다(승인 창이 훅의 "running"을 이긴다) | Windows 네이티브 아님. `yolo_mode_default` 있음. 에이전트 간 메시지 버스 없음(API 폴링 레시피뿐) |
| **workmux** (raine) | git 워크트리 + tmux 창으로 병렬 개발 | Rust · tmux/kitty/WezTerm/Zellij · Win 미문서화 · MIT · 별 2.8k · v0.1.276(10-14, 거의 매일 출시) | ① `add`: 워크트리·창 생성, `.env`·`node_modules` 복사, 프롬프트 주입 ② `merge`: 머지 후 워크트리·창·브랜치 정리 ③ 상태 아이콘(working/waiting/done), done은 포커스하면 지움, 10초 무출력 working은 "중단됨" ④ `/coordinator` 스킬로 주 에이전트가 워크트리 에이전트를 띄움, `add --wait` ⑤ `resurrect`로 크래시 후 재개 | done 미확인 표시와 "조용한 working = 중단" 판정이 간단하고 실용적이다 | 자동 승인은 문서가 `--dangerously-skip-permissions` 별칭을 권한다(샌드박스 전제). 역할·메시지 없음 |

### 2-2. 소규모 TUI 관리자

| 도구 | 포지셔닝 | 플랫폼·라이선스 | 핵심 기능 | EQMUX 대비 강점 | EQMUX 대비 약점 |
|---|---|---|---|---|---|
| **dmux** (standardagents) | 워크트리용 에이전트 멀티플렉서 | Node · tmux 3.0+ · Win 미문서화 · MIT · 별 1.8k · v5.11.1(08-16) | 한 프롬프트를 여러 에이전트에 동시 실행, 메뉴에서 머지·PR, 휴리스틱 + LLM으로 화면 상태 분류, 창 포커스까지 보고 알림 억제 | "사용자가 실제로 보는 중인가" 판정이 정밀하다 | **Autopilot**: LLM이 위험 없다고 보면 선택지를 자동으로 고른다. 인증 없는 localhost API. 알림은 macOS만 |
| **agentmx** (d1maash) | "터미널 하나, 모든 에이전트" | TS · MIT · 별 0 · 출시 없음 · 마지막 푸시 05-14 | `amx pipe` 순차 전달, `vote --judge` 심판, coder→reviewer→tester, `--max-cost` 비용 상한 | 비용 상한으로 즉시 종료하는 장치 | 초기 단계, 사실상 정지 |
| **ittybitty** (adamwulf) | bash 스크립트 하나짜리 에이전트 계층 | bash · tmux · MIT · 별 40 · v0.1.2(01-18) | 매니저만 하위 에이전트를 만든다(워커는 못 함), `ib send --from`으로 에이전트끼리 메시지, `ib ask`로 사용자에게 질문, 의존 작업 완료 알림, **기본 거부 + 역할별 허용 목록** | 역할별 권한 목록이 EQMUX 역할 frontmatter와 같은 발상이다 | 규모가 작다. 에이전트가 세션을 만든다 |
| **ccmux** (TheHumbleTransistor) | 주의 필요 세션을 빨갛게 표시하는 사이드바 | Python · tmux · MIT · 별 16 · 0.9.0(09-22) | 사이드바, `ccmux.toml` 워크트리 생성 후 훅 | 단순하다 | 기능이 적다 |
| **claude-tmux** (nielsgroen) | tmux 팝업 전환기 | Rust · tmux · 라이선스 미표기 · 별 208 | 화면 문자열로 working/idle/`[y/n]` 감지, 워크트리·PR | 팝업 한 번으로 전환 | 라이선스 불명, 04월 이후 정지 |
| **crmux** (maedana) | 기존 tmux 세션 감시 사이드바 | Rust · tmux · MIT · 별 27 · v0.20.3(06-09) · **유지보수 모드**(저자가 herdr로 이동) | Claude `statusLine` 훅으로 상태 수신, 저장소 이름으로 idle 세션에 프롬프트 전송 | statusLine을 상태 소스로 쓴다(EQMUX도 비용 수집에 씀) | 개발 종료 |
| **TmuxCC** (nyanko3141592) | Claude·OpenCode·Codex·Gemini 대시보드 | Rust · tmux · MIT · 별 67 · v0.1.5(01-18) | **일괄 승인**(여러 에이전트 선택 후 Y/N), Task 서브에이전트 추적, 남은 컨텍스트 % | 승인 대기를 한곳에서 처리한다 | 목록 문서의 "Win ✓"는 README로 확인되지 않았다 |

### 2-3. 오케스트레이션 · 에이전트 내장형

| 도구 | 포지셔닝 | 플랫폼·라이선스 | 핵심 기능 | EQMUX 대비 강점 | EQMUX 대비 약점 |
|---|---|---|---|---|---|
| **Claude Code Agent Teams** | Claude Code 내장. 리드 1명 + 팀원 여럿이 작업 목록과 메일박스를 공유 | Claude Code 독점 · **실험 기능, 기본 꺼짐**(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) · 대화형 세션만 | ① 팀원 누구나 누구에게나 `SendMessage`(이름 지정, 방송 없음) ② 메일박스 `~/.claude/teams/{team}/inboxes/*.json`, 푸시 전달 ③ 작업 목록: 의존성, 파일 잠금으로 가져가기, 완료 시 후속 자동 해제 ④ 팀원이 idle이 되면 **최종 답과 함께** 리드에게 알림 ⑤ 훅 `TeammateIdle`·`TaskCreated`·`TaskCompleted`(exit 2로 막기) | 플랫폼 기본 기능이다. 작업 의존성과 완료 신호가 있다. **에이전트 간 메시지는 승인 효력이 없다**고 명시한다 | 팀원 생성에 확인이 없다. 플랜 승인을 리드가 **검토 없이 자동 승인**한다. `--dangerously-skip-permissions`가 팀원에게 전파된다. 분할 페인이 **Windows Terminal·VS Code·Ghostty에서 안 된다**. 팀원 재개 불가, 세션당 팀 1개, 메시지 타입 없음, 화면(관제) 없음 |
| **claude-team MCP → maniple** (Martian-Engineering) | Claude Code 한 세션이 tmux·iTerm2 위의 Claude·Codex 워커를 부리는 MCP 서버 | Python 3.11 · tmux(mac·Linux)/iTerm2(mac) · **Win 없음** · README는 MIT(라이선스 파일 없음) · 별 49 · 마지막 푸시 06-08 | ① `spawn_workers`(1~4명, 기본 워크트리) ② `message_workers`(`tmux send-keys`로 입력), `wait_mode none/any/all` ③ Stop 훅 마커로 idle 판정, `read_worker_logs`로 결과 회수 ④ `poll_worker_changes`(20분 무응답 = stuck) ⑤ 재시작 후 고아 워커 입양 | fan-out/fan-in을 `wait_idle_workers`로 바로 쓴다. 이슈 트래커(Beads) 연동 | 허브-스포크라 워커끼리 말 못 한다. 메시지 타입 없음. 이름 변경(claude-team → maniple)으로 목록 문서 링크가 낡았다 |
| **claude-session-driver** (obra) | 컨트롤러 세션이 tmux 워커(Claude·Codex·Pi)를 모는 플러그인 + `csd` CLI | TS/Node · tmux · `/tmp` 사용(사실상 Unix) · MIT · 별 112 · 마지막 푸시 10-10 | ① `converse`(보내고 `stop`까지 대기 후 답 반환) ② `send` → `wait-for-turn` → `read-turn` ③ 훅이 JSONL 이벤트 기록 ④ `handoff`로 사람에게 tmux 연결 명령 출력 ⑤ `adopt`로 기존 세션 입양 | 동기 호출(`converse`)이 단순하다. 훅 이벤트 로그로 턴 경계를 정확히 안다 | 워커는 **항상 권한 우회**로 돈다. 워커끼리 통신 없음. 결과를 검증하지 않는다고 스스로 적었다 |
| **claude-esp** (phiat) | Claude Code의 숨은 출력(사고·도구 호출·서브에이전트)을 다른 터미널로 스트리밍 | Go(Bubbletea) · **Win amd64 바이너리** · MIT · 별 155 · 마지막 푸시 09-22 | 트랜스크립트 JSONL tail(fsnotify + 폴링), 서브에이전트 트리, 에이전트별 토큰·컨텍스트 %, 압축·훅·권한 변경 이벤트 | 서브에이전트를 트리로 보여 준다. 읽기 전용이라 안전하다 | 관찰만 한다. Claude 내부 포맷에 의존한다 |

목록 문서(`multiplexer-tools-2026-10-14.md`)와 달라진 점: herdr 저장소는 `herdrdev/herdr`로 옮겼고 Apache-2.0이다. Agent Deck은 MIT다. CCManager는 MIT이고 Windows 경로를 문서화했다. claude-team은 maniple로 이름을 바꿨다. crmux는 유지보수 모드다. TmuxCC의 Windows 지원은 확인되지 않았다.

### 2-4. 에이전트 간 위임 방식 비교

| | EQMUX 메시지 버스 | Agent Teams | maniple(claude-team) | herdr | claude-session-driver | Agent Deck Conductor | ittybitty |
|---|---|---|---|---|---|---|---|
| 구조 | 팀원 전원 대등 + 사람 | 리드 + 팀원, 팀원끼리도 직접 | 허브-스포크(매니저만 보냄) | 아무 에이전트나 프리미티브로 | 허브-스포크(컨트롤러만) | 감독 + 자식 | 매니저 계층 |
| 주소 | `@이름` · `@all` · 사람 | 이름(방송 없음) | 워커 id·이름 | 에이전트 이름 | 워커 id | 세션 이름 | 에이전트 id |
| 메시지 타입 | **5종 강제**(ask·handoff·report·review·escalate) | 평문 + 프로토콜(플랜 승인·종료) | 평문 | 평문(화면 타이핑) | 평문 | 평문, `NEED:` 관례 | 평문, `ask`만 구분 |
| 전달 | 원장 기록 → idle이면 주입, busy·waiting이면 인박스 후 idle 전이 때 | 메일박스 파일 → 푸시 | `tmux send-keys` 즉시 | bracketed paste, blocked면 거절 | tmux 입력 | `session send` | tmux 입력 |
| 결과 회수 | 받는 쪽이 **스스로** `report`를 보내야 한다. 요청과 답을 잇는 고리 없음 | idle 알림에 **최종 답 포함** | Stop 훅 마커 + 로그 읽기, `wait_idle` | 화면 읽기(`agent read`), `--wait` | `converse`가 답 반환 | 자식 상태 변화 → 부모에 알림 | 의존 작업 완료 알림 |
| 작업 모델 | 임무 파일(`.eqmux/missions/`), 의존성 없음 | 작업 목록 + 의존성 + 잠금 | 외부 이슈 트래커 | 없음 | 없음 | 칸반 힌트 | 의존성 알림 |
| 기록 | SQLite 원장 + Markdown 내보내기, 대화 탭 | 메일박스 JSON | 트랜스크립트 | 없음 | 이벤트 JSONL | `task-log.md` | – |
| 사람 개입 | 대화 탭에서 같은 스트림에 참여 | 아무 팀원에게나 직접 메시지 | 페인에 직접 입력 | 페인에 직접 입력 | `handoff` | 텔레그램·슬랙·사람에게 에스컬레이션 | `ib ask` |
| 승인 | 역할 frontmatter가 권한을 정함. 자동 승인 없음 | 팀원 권한 = 리드 모드, 플랜 자동 승인, 메시지는 승인 효력 없음 | 기본 비활성 skip, 승인은 워커 페인에서 사람이 | 자동 승인 없음, blocked면 사람에게 물으라고 스킬이 지시 | **항상 우회** | `dangerous_mode` 옵션, 일상 질문 자동 답 | 기본 거부 + 역할별 허용 목록 |

정리하면 EQMUX가 앞선 곳은 **타입·원장·사람 참여·역할 기반 권한**이다. 뒤처진 곳은 **회신 고리**다. 다른 도구는 모두 "보낸 쪽이 결과를 받는" 장치(idle 알림 + 최종 답, `--wait`, Stop 훅 마커)를 가졌다. EQMUX에서는 handoff를 받은 에이전트가 report를 잊으면 아무도 모른다.

## 3. 분류 공통 패턴 — 시장 기본기

1. **태스크마다 git 워크트리 + 브랜치.** 만들기·머지·정리를 한 명령으로 한다(claude-squad·workmux·dmux·Agent Deck·AoE·CCManager·maniple). EQMUX는 워크트리 격리가 옵트인이다.
2. **상태 3종 이상.** working / waiting(승인·질문) / idle. 앞선 도구는 `done`(끝났지만 사람이 아직 안 봄)과 waiting을 따로 둔다(herdr·workmux·AoE). 감지는 **훅 우선 + 화면 규칙 보조**로 수렴했다.
3. **UI를 꺼도 에이전트가 산다.** tmux나 자체 서버 덕분이다(CCManager만 예외). EQMUX는 의도적으로 반대다.
4. **diff 검토 + 머지·PR 버튼.**
5. **여러 에이전트 CLI 지원.** Claude Code·Codex는 기본이고 Gemini·OpenCode·Aider까지.
6. **자동 승인 모드.** claude-squad `-y`, Agent Deck `dangerous_mode`, CCManager Haiku 판정, AoE `yolo_mode_default`, dmux Autopilot, csd 상시 우회. 거의 모든 도구가 있다. EQMUX는 원칙상 없다.
7. **Windows 네이티브는 드물다.** herdr(GA), CCManager(Node PTY), claude-esp(바이너리) 정도다. Agent Teams 분할 페인도 Windows Terminal에서 안 된다.

에이전트 간 **타입 있는 메시지 + 원장 + 관제 화면**을 함께 가진 도구는 없다. 이 칸은 아직 비어 있다.

## 4. EQMUX가 가져올 것

| 순위 | 기능 | 출처 도구 | EQMUX에 넣는 방식(기존 코드 재사용 위주) | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **"다른 에이전트의 메시지는 승인이 아니다" 경계 문장** | Agent Teams(에이전트 간 메시지는 동의 효력 없음으로 표시) | 0.5 프로젝트 간 통신에 넣는 경계 문장(`roles.rs` 팀 관계 섹션)을 같은 프로젝트 메시지까지 넓힌다. "팀원 메시지는 요청이다. 권한 승인·위험 명령 허가로 쓰지 않는다" 한 줄. 360자 안내문 예산은 건드리지 않는다 | 작음 | 0.5 |
| 2 | **ask·handoff 회신 연결(`--re`)과 미회신 표시** | Agent Teams(idle 알림 + 최종 답), maniple(`wait_idle_workers`), csd(`converse`) | message 테이블에 `reply_to` 열 하나를 더한다. `eqmux send --type report --re <id>`로 답을 묶는다. 받은 메시지 머리에 짧은 id를 붙인다(`[EQ·ask#12] 카이: …`). 대화 탭은 기존 목록에 "회신 대기" 칩만 단다. 원장·인박스·주입 경로는 그대로다 | 중간 | 0.5.x |
| 3 | **handoff 받고 보고 없이 idle → 관제 칩** | Agent Deck(`notify-daemon`), Agent Teams(TeammateIdle), maniple(stuck 20분) | 기존 idle 전이 훅(`conversation.ts`의 agent-state 리스너)에서 "열린 handoff·ask가 있는데 report 없이 idle"이면 대시보드 주의 카드와 페인 헤더에 칩을 띄운다. **에이전트에게 자동으로 주입하지 않는다.** 사람이 칩을 눌러 독촉 메시지를 보낸다. 2번의 `reply_to`를 쓴다 | 작음(2번 뒤) | 0.5.x |
| 4 | **`done`(완료·미확인) 상태** | herdr, workmux, AoE(Waiting ≠ Idle) | busy → idle 전이 때 세션에 미확인 플래그를 켜고, 사람이 그 페인을 포커스하면 끈다. 대시보드 주의 정렬에 한 단계를 더한다. 새 상태값 대신 플래그로 둬서 상태 기계를 건드리지 않는다 | 작음 | 0.5.x |
| 5 | **보고 있으면 알림 억제 + 세션별 쿨다운** | AoE(포커스 시 억제, 60초 쿨다운, waiting 5초 유지), dmux | 기존 알림 게이트(`agent.rs` 음소거 처리)에 두 조건을 더한다: 앱 창이 포커스이고 해당 페인이 보이면 OS 알림 대신 앱 안 표시, 같은 세션은 60초 안에 다시 울리지 않음 | 작음 | 0.5.x |
| 6 | **`eqmux report --state needs-input / ready-for-review`** | Agent Deck(`session annotate --hint` → 칸반) | 기존 `eqmux report`에 선택 인자 하나. 상태 값은 대시보드 셀과 임무 카드에 칩으로만 보인다. 상태 기계는 바꾸지 않는다 | 작음 | 0.5.x |
| 7 | **`eqmux send --wait`(회신까지 대기)** | herdr(`agent prompt --wait`, 오류 코드 `agent_blocked`·`timeout`), csd(`converse`) | 2번의 `reply_to`가 생기면 CLI가 명명 파이프로 그 id의 회신을 기다렸다가 본문을 출력한다. 타임아웃·대상 없음은 이름 있는 오류 코드로 낸다. 에이전트가 직접 부르는 것이고 앱이 시작하는 동작은 아니다 | 중간 | 0.6 |
| 8 | **임무 의존성(`depends_on`)** | Agent Teams(작업 목록 의존성·자동 해제), ittybitty(의존 완료 알림) | `missions/*.md` frontmatter에 `depends_on` 필드. 앞 임무가 끝나지 않았으면 임무 카드에 "막힘"만 표시한다. 자동 배정·자동 해제는 하지 않는다. 이미 0.6으로 미룬 메시지 버스 F1~F8(의존성 그래프)과 같이 설계한다 | 중간 | 0.6 |

이미 0.5 기획서에 있어서 이번 조사로 근거만 보태는 것:
- **긴 내용은 파일에 쓰고 경로만 보낸다**(본문 800자 상한) — herdr 문서도 같은 권고를 한다.
- **`eqmux who`** — Agent Teams는 팀원이 `config.json`의 `members`로 서로를 찾는다. 같은 필요다.
- **blocked일 때 입력 거절** — EQMUX 관리 세션은 이미 waiting이면 인박스에 쌓는다(`conversation.ts:3-4`). 남은 구멍은 손으로 띄운 에이전트(BR-02, P0)다.

## 5. 가져오지 않을 것

| 기능 | 출처 | 이유 |
|---|---|---|
| 자동 승인(`-y`, yolo, `dangerous_mode`, 상시 권한 우회) | claude-squad·Agent Deck·AoE·workmux 별칭·csd | **역할 frontmatter가 권한을 정한다**는 원칙과 충돌한다. Agent Teams처럼 우회 플래그가 팀원에게 번지는 구조도 피한다 |
| LLM이 승인 여부를 판정(Haiku 판정, Autopilot) | CCManager·dmux | **앱은 API 키를 보유하지 않는다.** 앱이 모델을 불러 승인하면 사람 버튼이 아닌 경로로 상태가 바뀐다(자동 실행 경로 없음) |
| 감독 에이전트가 일상 질문에 자동으로 답함 | Agent Deck Conductor | 결정권이 사람 모르게 다른 에이전트로 넘어간다. EQMUX는 escalate를 사람이 보는 대화 탭으로 보낸다. 감독 역할이 필요하면 리드 직무 + 역할 파일로 하고, 답은 메시지 버스에 남긴다 |
| 에이전트가 세션·워커를 생성 | herdr `agent start`, maniple `spawn_workers`, Agent Teams, ittybitty | 세션 생성은 슬롯·역할·권한이 걸린 상태 변경이다. 언제나 사람의 버튼으로 한다. 팀은 `.eqmux/team.json`이 원본이다 |
| 플랜 자동 승인 | Agent Teams | 검토 없는 승인은 승인이 아니다. EQMUX의 review 타입은 사람이나 지정 리뷰어가 본다 |
| 화면 타이핑·화면 읽기로 위임 | herdr·maniple·csd | 원장이 없고 이중 전송·오입력 위험이 있다. EQMUX의 타입 메시지 + 상태 기반 전달이 더 안전하다 |
| 여러 에이전트 일괄 승인 | TmuxCC | 승인 창은 각각 읽고 눌러야 한다. 여러 페인에 키를 한꺼번에 넣는 것은 BR-02와 같은 종류의 위험이다. 대신 4번·5번으로 "승인 대기 세션으로 빨리 가기"를 개선한다 |
| 작업 자동 가져가기(파일 잠금 claim) | Agent Teams | 임무 배정은 사람이 한다. 의존성 표시(4장 8번)까지만 가져온다 |
| 외부 상태 저장(`~/.claude/teams`, `/tmp/csd-workers`) | Agent Teams·csd | **`.eqmux/` 파일이 원본**이다. 팀 상태를 저장소 밖에 두지 않는다 |
| UI를 꺼도 도는 백그라운드 서버 | herdr·tmux 계열 전부 | Job Object 정리 + 재개 제안을 택했다. herdr 문서와 같은 판단(0.7 이후 재검토) |
| 인증 없는 localhost HTTP API | dmux | EQMUX는 명명 파이프 + 세션 토큰을 쓴다. 외부 인터페이스는 0.6 재설계 때 본다 |
| 비용 상한으로 에이전트 강제 종료 | agentmx | 앱이 스스로 프로세스를 죽이는 경로다. statusLine 비용은 이미 모으므로, 상한 초과는 **알림만** 하는 쪽이 원칙에 맞다(필요해지면 0.6에서 검토) |

### 위협 메모

- **Agent Teams가 기본 기능으로 들어오면** "팀원끼리 말하는 Claude"는 차별점이 아니다. 다만 지금은 실험 기능이고, 분할 페인이 Windows Terminal에서 안 되며, 메시지 타입·원장·관제 화면이 없다. CCManager는 이미 `--teammate-mode in-process`를 붙여 Agent Teams와 공존한다. EQMUX도 경쟁보다 **Windows에서 Agent Teams를 보이게 하는 화면**이 될 수 있는지 0.6에서 확인할 만하다(EQMUX 페인 안에서 in-process 팀원이 정상 동작하는지부터).
- **crmux 저자가 herdr로 옮겼다.** 작은 TUI 도구는 herdr로 모이고 있다. TUI 분류에서 EQMUX의 실질 경쟁자는 herdr 하나다.

## 6. 출처 URL

GitHub 저장소(README·문서, `gh api`로 2026-10-14 조회)
- https://github.com/smtg-ai/claude-squad (README, `session/tmux/tmux.go`)
- https://github.com/herdrdev/herdr (옛 ogulcancelik/herdr) — `skills/herdr/SKILL.md`, docs `agent-automation` · `agent-skill` · `agents` · `windows-beta`
- https://github.com/asheshgoplani/agent-deck
- https://github.com/kbwo/ccmanager
- https://github.com/agent-of-empires/agent-of-empires (옛 njbrake/agent-of-empires) — `docs/api.md` · `docs/push-notifications.md` · `docs/guides/configuration.md`
- https://github.com/raine/workmux
- https://github.com/standardagents/dmux — `context/API.md`, `StatusDetector.ts`, `toggleAutopilotAction.ts`
- https://github.com/d1maash/agentmx
- https://github.com/adamwulf/ittybitty
- https://pypi.org/project/ccmux → https://github.com/TheHumbleTransistor/ccmux
- https://github.com/nielsgroen/claude-tmux
- https://github.com/maedana/crmux
- https://github.com/nyanko3141592/tmuxcc
- https://github.com/Martian-Engineering/maniple (glama.ai/mcp/servers/@Martian-Engineering/claude-team가 301로 이동) — `idle_detection.py` · `worker_prompt.py` · `terminal_backends/tmux.py`
- https://github.com/obra/claude-session-driver — `skills/driving-claude-code-sessions/SKILL.md`
- https://github.com/phiat/claude-esp

공식 문서
- https://code.claude.com/docs/en/agent-teams (docs.claude.com/en/docs/claude-code/agent-teams에서 이동)

EQMUX 내부
- `README.md`, `docs/update-plan-0.5.0.md`, `docs/archive/unimplemented-features-2026-10-14.md`, `docs/herdr-benchmark-2026-10-14.md`, `src/backend/conversation.ts`, `src-tauri/src/messages.rs`
