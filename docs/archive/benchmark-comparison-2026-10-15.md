# 벤치마킹 도구 통합 비교표 — 2026-10-15

원본: [Artifact](https://claude.ai/artifact/RfumBruRBhngvoM6HoV7im) · HTML: `docs/benchmark-comparison-2026-10-15.html`

2026-10-14에 나눠 조사한 벤치마킹 문서들의 비교표를 표 하나로 모았다. **새로 조사하지 않았다.** 값은 아래 원본 문서에 적힌 것만 옮겼다. 원본이 말하지 않은 칸은 비워 두었다(–).
기준: EQMUX `sub_main` 0.4.2. 별 수·버전·상태는 2026-10-14 조회값이다.

**원본 문서 (표의 "문서" 열 약어)**

| 약어 | 문서 |
|---|---|
| D | `benchmark-desktop-apps-2026-10-14.md` (데스크톱 앱 16개) |
| T | `benchmark-tui-managers-2026-10-14.md` (TUI 관리자 13개 + 오케스트레이션 4개) |
| M | `benchmark-multiplexers-web-2026-10-14.md` (범용 멀티플렉서 + 웹 대시보드) |
| L | `multiplexer-tools-2026-10-14.md` (도구 목록) |
| O | `benchmark-oss-list-2026-10-14.md` (오픈소스 후보 목록) |
| orca · herdr · emdash · gastown · omc · relay | 각 `*-benchmark-2026-10-14.md` 개별 심층 문서 |
| paseo · terax | `paseo-features.md` · `terax-features.md` |

**기호**: ✓ 있음 · △ 일부·옵션·조건부 · × 없음(원본이 없다고 적음) · – 원본에 언급 없음 · ? 미확인이거나 문서끼리 다름

**열 뜻**
- **Win**: Windows 네이티브. WSL = WSL에서만 된다.
- **상태 감지**: working/waiting(승인·질문)/idle 등을 자동으로 판정한다. `done`은 "끝났는데 사람이 아직 안 봄"을 따로 표시한다는 뜻이다.
- **알림**: 사람에게 주의를 알린다. 누르면 그 세션 페인으로 가는 것까지 원본이 확인한 칸에는 **→이동**을 적었다.
- **타입·원장**: 메시지에 정해진 타입이 있고, 보낸 기록이 남는다.
- **자동 승인·실행**: 자동 승인(Yolo·권한 우회), 예약·자율 루프, 에이전트가 세션을 만드는 기능. **✓면 EQMUX 원칙과 충돌한다.**
- **앱 꺼도 유지**: UI를 닫아도 에이전트 프로세스가 계속 돈다.

## 통합 비교표

| 도구 | 분류 | Win | 라이선스 | 별 | 상태 | 워크트리 | 상태 감지 | 알림 | 에이전트 간 메시지 | 타입·원장 | 역할·권한 | 자동 승인·실행 | 앱 꺼도 유지 | 모바일·원격 | 문서 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **EQMUX 0.4.2** | 데스크톱 | ✓ | MIT | – | 활발 | △ 옵트인 | ✓ 훅 (done 없음) | △ OS 알림만, 클릭 처리 없음 | ✓ `eqmux send` | ✓ 5종 강제 + SQLite 원장 | ✓ 역할 파일 frontmatter | × 원칙상 없음 | × Job Object 정리 + 재개 제안 | × | 기준 |
| **Orca** | 데스크톱 | ✓ | MIT | 92.1k | 활발 (2~3일마다 출시) | ✓ 태스크마다 | ✓ 훅 + OSC, 미확인 완료 | ✓ →이동 | ✓ orchestration CLI, `@all`·`@idle` 그룹 주소 | × | × | ✓ Yolo 기본, 예약 자동화 | ✓ | ✓ iOS·Android, SSH | D · orca |
| **wmux** (openwong2kim) | 데스크톱 | ✓ | MIT | 426 | 활발 | ✓ 한 프롬프트를 최대 8개로 | ✓ 출력량으로 | ✓ →이동, 벨·Fleet "Needs you" | ✓ `send_message`·`a2a` | × 타입 없음 | × | △ 한도 리셋 재개·예약·계정 전환 (기본 꺼짐) | ✓ 데몬 | ✓ iOS | D · L |
| wmux (amirlehmam) | 데스크톱 | ✓ | MIT | 416 | 활발 (v2.15) | – | △ 화면 판독, 추정은 추정으로 표시 | ✓ →이동, 알림 센터·대기 내비게이터 | × | × | × | × 업데이트도 클릭해야 설치 | – | ✓ 휴대폰 웹 콘솔 | D |
| **Superset** | 데스크톱 | × | ELv2 (OSI 아님) | 15.2k | 활발 | ✓ | – | ✓ →이동, 독 배지·차임 | × 스킬에 맡김 | × | × | ✓ 예약 자동화 (유료) | ✓ | ✓ 원격, iPhone (Pro) | D |
| Conductor | 데스크톱 | × mac 전용 | 독점 | – | 활발 (v0.90) | ✓ | – | – | × | × | × | – | – | – | D |
| **cmux** | 데스크톱 | × mac 전용 | GPL-3.0 | 28.2k | 활발 | – | – | ✓ →이동, 알림 링·`⌘⇧U` | △ Agent Teams를 분할로 띄움 | × | × | – | – | △ iOS 조기 접근 (유료) | D |
| Nimbalyst (옛 Crystal) | 데스크톱 | ✓ | MIT | 1.9k | 활발 | ✓ | – | – | × | × | × | – | – | ✓ iOS | D |
| Paneflow | 데스크톱 | ✓ .msi | GPL-3.0+ | 84 | 활발 | ✓ | △ `watch --type ai.stop` | – | △ `read_pane`, `send`는 입력란만 채움 | × | × | △ `flow.toml` 단계 실행 | ✓ 세션 호스트 | – | D |
| Termdock | 데스크톱 | ✓ | 독점 | – | – | – | ✓ Workstream (승인 요청 모음) | ✓ →이동 | △ 에이전트를 잇는 워크플로 | × | × | ✓ cron·워크플로·웹훅 | – | ✓ 휴대폰 웹 페어링 | D |
| Termlux | 데스크톱 | × mac 전용 | 독점 | – | 베타 | ✓ | – | – | × | × | × | ✓ 한도 리셋 때 시작, Bypass 노출 | – | ✓ | D |
| Terax | 데스크톱 | ✓ | Apache-2.0 | 9.3k | – | – | – | – | × 자체 에이전트 | × | × | – | – | – | D · terax |
| Sculptor | 데스크톱 | × | MIT | 238 | 리서치 프리뷰 | ✓ 격리 사본 | – | – | × | × | × | – | – | – | D |
| Xum (옛 Mux) | 데스크톱 | × | AGPL-3.0 | 2.1k | 활발 | ✓ | – | – | × 자체 에이전트 | × | × | – | – | ✓ 서버 모드 모바일 UI | D |
| Opcode (옛 Claudia) | 데스크톱 | × | AGPL-3.0 | 22.4k | **정지** (2025-10) | – | – | – | × | × | × | – | – | – | D |
| Codex 앱 (→ ChatGPT 데스크톱) | 데스크톱 | ✓ | 독점 | – | 활발 | ✓ | – | – | × Codex 전용 | × | × | ✓ 예약 작업 | – | – | D |
| **Emdash** | 데스크톱 | ✓ 서명 MSI | Apache-2.0 | 6.0k | 활발 (6주에 6회) | ✓ 태스크마다 | ✓ 훅 | ✓ →이동 (v1.2.7) | × | × | × | △ 예약 실행 있음, 자동 승인 기본 꺼짐 | △ 원격 호스트 tmux만, Windows × | △ SSH, Cloud | emdash |
| **Paseo** | 데스크톱 + 데몬 | ✓ | Apache-2.0 (일부 Other) | 2.1만 | 활발 (이틀에 한 번) | ✓ | – | – | △ 오케스트레이터 → 서브에이전트 | × | × 팀 없음 | ✓ 스케줄·하트비트, 에이전트가 에이전트 생성 | ✓ 데몬 | ✓ iOS·Android·웹 | paseo |
| Vibe Kanban | 웹 | ✓ | Apache-2.0 | 28.4k | **종료 공지** | ✓ | – | – | × | × | × | – | – | – | M · L |
| **amux** | 웹 | × | MIT (+Commons Clause?) | 534 | – | – | ✓ 멈춘 세션 감지 | ✓ 모바일 푸시 | ✓ `@` 메시지, 세션 간 API | △ SQLite 이벤트 저널 | – | ✓ 크론·자율 루프·크래시 자동 재시작 | ✓ tmux·herdr 백엔드 | ✓ iOS, Tailscale | M |
| OpenHands | 웹 | △ PowerShell·WSL2 | MIT | 90.9k | – | – | – | – | △ 마이크로 에이전트 위임 | × | × | ✓ 스케줄·웹훅 | – | △ 클라우드 | M |
| Devin | 클라우드 | – | 독점 ($500+/월) | – | – | ✓ 클라우드 샌드박스 | – | – | × | × | × | ✓ 완전 위임 | – | ✓ 클라우드 | M |
| Cursor Background Agents | IDE | ✓ | 유료 | – | – | ✓ 브랜치 | – | – | × | × | × | – | – | – | M |
| **herdr** | TUI 런타임 | ✓ GA | Apache-2.0 | 4.4만 | 활발 (2주마다 stable) | – | ✓ idle·working·blocked + done | ✓ →이동, Windows 알림 (v0.9.4) | ✓ `agent prompt --wait` (화면에 입력) | × | × | △ 자동 승인 없음, 에이전트가 세션 생성 | ✓ 백그라운드 서버 | △ SSH 멀티 머신 | herdr · T |
| claude-squad | TUI | × tmux | AGPL-3.0 | 8.6k | 마지막 출시 08-20 | ✓ | △ 화면 해시 | × | × | × | × | ✓ `-y` (실험) | ✓ tmux | – | T |
| Agent Deck | TUI + 웹 | WSL | MIT | 1.08k | 활발 | ✓ | ✓ | ✓ 텔레그램·슬랙·웹 푸시 | △ 자식 → 부모 알림, 감독 | × `이름: 메시지` 접두 | × | ✓ `dangerous_mode`, 감독이 자동 답변 | ✓ tmux | △ 웹 UI, 텔레그램 | T |
| CCManager | TUI | ✓ 경로 문서화 | MIT | 1.26k | 활발 | ✓ | ✓ 상태 훅 | – | × Agent Teams에 맡김 | × | × | ✓ Haiku가 승인 판정 (실험) | × | – | T |
| Agent of Empires | TUI + 웹 | WSL2 | MIT | 3.3k | 활발 | ✓ | ✓ Waiting ≠ Idle | ✓ 웹 푸시, 보고 있으면 억제 | △ HTTP API `send`·`output` | × | × | ✓ `yolo_mode_default` | ✓ tmux | ✓ 모바일 웹 | T |
| workmux | TUI | – 미문서화 | MIT | 2.8k | 활발 (거의 매일) | ✓ | ✓ done, 10초 무출력 = 중단 | – | △ `/coordinator`, `add --wait` | × | × | △ 권한 우회 별칭 권장 | ✓ tmux, `resurrect` | – | T |
| dmux | TUI | × tmux | MIT | 1.8k | 마지막 출시 08-16 | ✓ | ✓ 휴리스틱 + LLM | ✓ macOS만, 포커스면 억제 | × | × | × | ✓ Autopilot | ✓ tmux | – | T |
| agentmx | CLI | ? | MIT | 0 | **정지** | – | – | – | △ `amx pipe` 순차 전달 | × | △ coder → reviewer → tester | – | – | – | T |
| ittybitty | TUI | × tmux | MIT | 40 | – | ✓ | – | – | ✓ `ib send --from` | △ `ask`만 구분 | ✓ 기본 거부 + 역할별 허용 목록 | △ 매니저가 하위 에이전트 생성 | ✓ tmux | – | T |
| ccmux | TUI | × tmux | MIT | 16 | – | △ 옵션 | ✓ 주의 필요 세션 표시 | – | × | × | × | – | ✓ tmux | – | T |
| claude-tmux | TUI | × tmux | 미표기 | 208 | **정지** (04월) | ✓ | ✓ 화면 문자열 | – | × | × | × | – | ✓ tmux | – | T |
| crmux | TUI | × tmux | MIT | 27 | 유지보수 모드 | – | ✓ statusLine | – | △ idle 세션에 프롬프트 | × | × | – | ✓ tmux | – | T |
| TmuxCC | TUI | ? 미확인 | MIT | 67 | – | – | ✓ | – | × | × | × | – 일괄 승인은 사람이 누름 | ✓ tmux | – | T |
| **Claude Code Agent Teams** | 플랫폼 내장 | △ 분할 페인이 Windows Terminal에서 안 됨 | 독점 | – | 실험 기능 (기본 꺼짐) | – | ✓ `TeammateIdle` | – | ✓ `SendMessage`, 메일박스 | △ 평문 + 프로토콜, 메일박스 JSON | × | ✓ 플랜 자동 승인, 팀원 생성에 확인 없음 | × 팀원 재개 불가 | – | T |
| maniple (옛 claude-team) | MCP 서버 | × | MIT (README) | 49 | 마지막 푸시 06-08 | ✓ 기본 | ✓ Stop 훅 마커, 20분 = stuck | – | △ 허브-스포크 | × | × | △ 워커 생성 | ✓ tmux | – | T |
| claude-session-driver | 플러그인 + CLI | × | MIT | 112 | 활발 | – | ✓ 훅 이벤트 JSONL | – | △ 허브-스포크, `converse` | × | × | ✓ 워커는 항상 권한 우회 | ✓ tmux | – | T |
| claude-esp | 관찰 도구 | ✓ 바이너리 | MIT | 155 | – | – | ✓ 서브에이전트 트리 | – | × | × | × | × 읽기 전용 | – | – | T |
| **oh-my-claudecode** | Claude Code 플러그인 | △ 실험 (psmux) | MIT | 3.99만 | 활발 (10월 5회) | ✓ 팀 워크트리 모드 | ✓ 하트비트 | ✓ Telegram·Discord·Slack | ✓ 리더 ↔ 워커 | ✓ 아웃박스 타입 9종, jsonl | △ 역할 19종 자동 배정, 권한은 우회 고정 | ✓ 우회 플래그 고정, autopilot·ralph 루프 | △ tmux 워커 | – | omc |
| **Gas Town** | 오케스트레이션 | △ CLI 최소, 전체는 WSL | MIT | 18.4k | **정지** (07-23 이후 커밋 없음) | ✓ Hook = 워크트리 | ✓ Stalled·Zombie·GUPP 위반 | △ escalation P0~P2 | ✓ 메일박스·nudge·handoff | ✓ Dolt SQL 원장 (타입은 escalation 심각도만) | ✓ 고정 배역 (Mayor·Polecat…) | ✓ GUPP 즉시 실행, 에이전트가 스스로 가져감 | ✓ tmux | △ htmx 웹 대시보드 (로컬) | gastown |
| **Agent Relay** | 메시징 계층 | ? 브로커 exe만 | Apache-2.0 | 883 | 활발 (6일에 5회) | – | – | – | ✓ 채널·DM·스레드 | △ 타입 없음 (머리말은 권고), ✓ 엔진 원장 + ack | × | – | – | △ 클라우드 엔진이 기본 | relay |
| Warp | 에이전트형 터미널 | ✓ Agent CLI | 터미널만 오픈소스 | – | – | – | ✓ 에이전트 명단·상태 | – | – | × | × | ✓ Factories | – | ✓ 웹·모바일 관전 | M |
| tmux | 멀티플렉서 | WSL | ISC | – | – | – | – | – | – | – | – | – | ✓ 서버가 PTY 소유 | – | M |
| Zellij | 멀티플렉서 | ? (M: 네이티브 / L: WSL) | MIT | 35.7k | – | – | – | – | – | – | – | – | ✓ 세션 부활 | △ 읽기 전용 웹 클라이언트 | M · O |
| WezTerm | 터미널 + mux | ✓ | MIT | – | – | – | – | – | – | – | – | – | ✓ 도메인 재접속 | △ SSH·TLS 도메인 | M |
| Windows Terminal | 터미널 | ✓ | MIT | – | – | – | – | – | – | – | – | – | × | – | M |
| Ghostty | 터미널 | × | MIT | – | – | – | – | – | – | – | – | – | – | – | M |
| tmuxinator · tmuxp | tmux 세션 템플릿 | × | MIT | – | – | – | – | – | – | – | – | – | – | – | M |
| sesh | tmux 세션 전환기 | × (PowerShell 완성만) | MIT | 2.9k | – | – | – | – | – | – | – | – | – | – | M |

## 표에서 보이는 것

원본 문서들의 결론과 같다. 표로 다시 확인하면 이렇다.

- **EQMUX만 ✓인 조합**: 타입·원장 ✓ + 역할·권한 ✓ + 자동 승인·실행 ×. 타입·원장이 ✓인 도구는 oh-my-claudecode와 Gas Town뿐이다. 둘 다 권한 우회나 즉시 실행이 설계의 중심이고, Windows는 실험·최소 지원이다.
- **EQMUX가 × 또는 △인데 다수가 ✓인 칸**: 알림 →이동(Orca·wmux 2종·Superset·cmux·Termdock·Emdash·herdr. 이동 없는 알림은 Agent Deck·AoE·dmux·amux·oh-my-claudecode도 있다), 앱 꺼도 유지(데몬·tmux 계열 거의 전부), 모바일·원격.
- **Windows 네이티브(✓)이면서 에이전트 간 메시지가 ✓인 도구**: EQMUX, Orca, wmux(openwong2kim), herdr. 이 중 메시지 타입이 있는 것은 EQMUX뿐이다.
- **멈추거나 끝난 도구**: Opcode, Vibe Kanban, Gas Town, agentmx, claude-tmux, crmux(유지보수 모드). 1년 생존율이 낮다는 요약 문서 5장의 관찰과 같다.

## 문서끼리 다른 값

| 도구 | 차이 | 표에 쓴 값 |
|---|---|---|
| Zellij | M은 "Windows 네이티브", L은 "WSL" | ? |
| Termdock | L은 Mac·Win·Linux, D는 사이트 기준 Mac·Win만 | ✓ (Win은 양쪽 같음) |
| Gas Town | O는 Windows 지원, 심층 문서는 "CLI 최소, 전체 흐름은 WSL" | △ (심층 문서를 따름) |
| amux | 라이선스: README는 MIT + Commons Clause, About은 MIT | MIT (+Commons Clause?) |

## 표에 넣지 않은 것

- **wmux (snowyukitty)**: openwong2kim/wmux의 포크다(D).
- **목록에만 있고 기능 조사는 안 한 도구** (O): ruflo(구 claude-flow), Happy, CloudCLI, OpenChamber, container-use, Jean, Parallel Code, flowmux, Beads.
- **bbarit-agent-oss**: 멀티플렉서가 아니라 에이전트 CLI다(`bbarit-agent-oss-features.md`).
- **iTerm2 · Kitty · Alacritty**: 원본이 "에이전트 기능 없음" 한 줄만 적었다(L).
