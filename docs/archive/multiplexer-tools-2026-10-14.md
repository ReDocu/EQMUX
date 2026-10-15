# 에이전트·터미널 멀티플렉서 관리 도구 목록 — 2026-10-14

여러 터미널 세션이나 AI 코딩 에이전트를 한곳에서 띄우고 관리하는 도구를 모았다.
출처는 각 프로젝트 페이지와 비교 글(아래 출처 목록)이다. 비교 글 상당수는 경쟁 업체(amux·cmux·Nimbalyst·Superset)가 썼다. 표의 기능·라이선스·플랫폼은 직접 검증하지 않았다. 도입하거나 인용하기 전에 저장소를 다시 확인한다.

표기: **Win** = Windows 네이티브 지원 · ✓ 있음 · – 없음/언급 없음 · ? 출처마다 다름

2026-10-14 보정: herdr·CCManager·Agent Deck·crmux·TmuxCC·Agent Teams·maniple 항목은 eqmux-42 세션이 저장소 원문으로 다시 확인한 값으로 고쳤다(`docs/benchmark-tui-managers-2026-10-14.md`).
2026-10-14 보정: wmux·Superset·cmux·Paneflow·Terax·Xum·Opcode·Codex 앱 항목은 eqmux-8b 세션이 저장소 원문으로 다시 확인한 값으로 고쳤다(`docs/benchmark-desktop-apps-2026-10-14.md`).
"EQMUX와 겹침"은 EQMUX의 핵심(관제 대시보드 · 에이전트 간 메시지 · 역할)과 얼마나 가까운지를 나타낸다.

## 요약 — EQMUX가 주시할 도구

| 도구 | 이유 |
|---|---|
| **wmux** (openwong2kim) | Windows 네이티브(ConPTY + xterm.js), mac·iOS도 있다. Fleet "Needs you" 전역 목록이 있다. 브라우저 패널을 MCP로 조종하고 에이전트 간 `a2a_send`를 지원한다. 데몬이 있어 앱을 꺼도 세션이 유지된다. 기능 구성이 EQMUX와 가장 비슷하다 |
| **herdr** | Rust 단일 바이너리이고 Windows를 지원한다. 에이전트 상태 사이드바가 있고, 에이전트가 직접 페인을 만들어 다른 에이전트에게 일을 넘긴다 |
| **Orca** | 규모 1위(별 92k). 상세 비교는 `docs/orca-benchmark-2026-10-14.md` |
| **amux** | 공유 보드와 세션 간 API, 모바일 푸시를 갖춘 "관제" 지향 도구다 |
| **Claude Code Agent Teams** | Claude Code에 들어 있는 실험 기능이다(기본 꺼짐). 리드 에이전트가 하위 에이전트를 조정한다. 플랫폼 자체가 팀 기능을 흡수하는 위협이다 |
| **Codex 앱 (Windows)** | 2026-03 Windows 네이티브로 출시됐다. 여러 에이전트를 병렬로 돌린다 |

## 1. AI 에이전트용 데스크톱 앱 (GUI)

| 도구 | 링크 | 플랫폼 | 라이선스·가격 | 지원 에이전트 | 특징 | EQMUX와 겹침 |
|---|---|---|---|---|---|---|
| **Orca** | onorca.dev | Mac·**Win**·Linux, 모바일 | MIT, 무료 | 27종 이상 | 태스크마다 워크트리, Design Mode, SSH, diff 주석, orchestration CLI | 중 |
| **wmux** | github.com/openwong2kim/wmux | **Win**·mac·Linux 실험판·iOS | MIT | Claude Code·Codex·Gemini·Cursor·Aider·OpenCode·Copilot | 출력 처리량으로 상태 감지, CDP 브라우저와 MCP, `a2a_send/broadcast`, 위험 명령 알림, 데몬으로 세션 유지, winget·choco 설치 | **높음** |
| wmux (동명 1) | github.com/amirlehmam/wmux | **Win** | ? | Claude Code 등 | "원조 Windows 에이전트 멀티플렉서"라고 소개한다 | 중 |
| wmux (동명 2) | github.com/snowyukitty/wmux — openwong2kim/wmux의 **포크**(별 0) | **Win** | MIT | Claude Code·Codex·Gemini | 분할 터미널과 MCP 브라우저 자동화, WSL 불필요 | 중 |
| **Superset** | superset.sh | Mac 주력, Linux AppImage 실험판, **Win 없음** | Elastic License 2.0(OSI 아님), 1인 무료, Pro $15(연납)·$20(월납) | Claude Code·Codex·Cursor·OpenCode·Gemini·Amp·Copilot | 10개 이상 병렬, 워크트리, diff 리뷰, 자동화, MCP 서버, Electron | 중 |
| **Conductor** | conductor.build | Mac 전용 | 독점, 현재 무료 | Claude Code·Codex(·Cursor·OpenCode) | 워크스페이스마다 워크트리, 사이드바 + diff, PR 흐름 | 낮음 |
| **cmux** | cmux.com · github.com/manaflow-ai/cmux | Mac 전용 | GPL-3.0, 유료 Founder's Edition | Claude Code 중심 | Swift + libghostty, 알림 링, 미확인 페인 이동, 브라우저 자동화, 소켓 API | 중 |
| **Nimbalyst** (옛 Crystal) | nimbalyst.com | Mac·**Win**·Linux·iOS | MIT, 개인 무료 | Claude Code·Codex(·OpenCode·Copilot 알파) | 칸반, 워크스트림, 시각 편집기(마크다운·목업·다이어그램), diff 리뷰 | 중 |
| **Paneflow** | github.com/arthjean/paneflow | Mac·Linux·**Win(.msi)** | GPL-3.0-or-later, 무료 | 셸에서 띄우는 에이전트 전부 | GPU 렌더 페인, 브랜치·세션 인식 | 낮음 |
| **Termdock** | termdock.com | Mac·**Win**·Linux | 독점, 무료 등급 있음 | ? | Electron, 웹 세션 뷰어, 세션별 CPU·메모리, 상태 점검 알림 | 중 |
| **Termlux** | termlux-fe-sigma.vercel.app | Mac(Apple Silicon) | 독점, 무료 / Pro €99/년 / Team €192/년 | Claude Code 중심, Codex·Cursor·Aider | Claude Code를 채팅으로 보여 줌, 태스크 보드, 리뷰 대기열, 계정별 워크스페이스, 사용량·비용 | 중 |
| **Terax** | terax.app | Mac·**Win**·Linux | Apache-2.0 | BYOK 자체 에이전트 | Tauri 7~8MB, 터미널·에디터·웹 프리뷰 통합 (`docs/terax-features.md`) | 낮음 |
| **Sculptor** | imbue.com | Mac(Apple Silicon)·Linux | 리서치 프리뷰, 무료 | 자체 에이전트(Anthropic·OpenAI 모델) | 에이전트마다 Docker 컨테이너, 승인 후 머지 | 낮음 |
| **Xum** (옛 Mux, Coder) | github.com/coder/mux | Mac·Linux·브라우저 | AGPL-3.0 | 자체 멀티 모델 에이전트 | 로컬·워크트리·SSH 실행 | 낮음 |
| **Opcode** (옛 Claudia) | – | Mac·Linux | AGPL-3.0 | Claude Code | Claude Code GUI, 백그라운드 에이전트. **개발 중단**(마지막 코드 커밋 2025-10) | 낮음 |
| **Codex 앱** (ChatGPT 데스크톱으로 합쳐진 것으로 보임) | learn.chatgpt.com/docs/app | Mac·**Win** | 독점(ChatGPT 플랜) | Codex | 병렬 에이전트, Windows 네이티브 샌드박스 | 중 |

## 2. 웹 대시보드형

| 도구 | 링크 | 플랫폼 | 라이선스 | 특징 | EQMUX와 겹침 |
|---|---|---|---|---|---|
| **Vibe Kanban** | github.com/BloopAI/vibe-kanban | 크로스 플랫폼(브라우저) | Apache-2.0 | 칸반 보드로 에이전트에 이슈 배정, diff 리뷰. 별 약 22.5k(2026-03). 2026-04-10 유료 클라우드를 닫았고, 지금 README에 종료(sunsetting) 공지가 걸려 있다. 별 약 28.4k(10-14) | 중 |
| **amux** | github.com/mixpeek/amux | Mac·Linux·클라우드 VM, PWA·iOS | MIT | 웹 대시보드 + CLI 서버, 멈춘 세션 감지, 공유 보드, 세션 간 API, 모바일 푸시 | **높음** |
| **OpenHands** | github.com/All-Hands-AI/OpenHands | Docker, 자체 호스팅 | MIT | 에이전트마다 Docker 샌드박스, 마이크로 에이전트 위임 | 낮음 |
| Devin | devin.ai | 클라우드 | 독점, $500+/월 | 태스크마다 클라우드 샌드박스, GitHub·Linear·Slack 연동 | 낮음 |
| Cursor Background Agents | cursor.com | 3개 OS | 유료 플랜 | 에이전트마다 브랜치, PR 생성 | 낮음 |

## 3. 터미널 TUI 에이전트 관리자

대부분 tmux 위에서 돌아서 Windows 네이티브는 드물다(WSL 필요).

| 도구 | 링크 | 언어 | tmux | Win | 라이선스 | 특징 |
|---|---|---|---|---|---|---|
| **claude-squad** | github.com/smtg-ai/claude-squad | Go | 필요 | – | AGPL-3.0 | 워크트리 생성·격리·머지·정리를 통합. Claude Code·Codex·Gemini·OpenCode·Amp·Aider. 별 약 6.2k(2026-03) |
| **herdr** | github.com/herdrdev/herdr | Rust | 불필요 | **✓** | Apache-2.0 | 10MB 단일 바이너리, 15종 이상 자동 감지, 상태 사이드바, 백그라운드 서버, 에이전트가 페인 생성·위임, 플러그인 마켓 |
| **CCManager** | npm `ccmanager` | Node.js | 불필요 | ✓ (Windows 경로 문서화) | MIT | 8종(Claude Code·Codex·Gemini·Cursor·Copilot·Cline·OpenCode·Kimi), 워크트리 |
| **Agent Deck** | github.com/asheshgoplani/agent-deck | Go(Bubble Tea) | 필요 | – | MIT | 프로젝트별 MCP 연결·해제, 대화 포크, MCP 소켓 풀. 출시가 활발하다(v1.15) |
| **Agent of Empires** | github.com/agent-of-empires/agent-of-empires | Rust | 필요 | – | MIT | TUI + 웹 대시보드, v1.12.0(2026-07) |
| **workmux** | github.com/raine/workmux | Rust | 기본(kitty·WezTerm·Zellij도 지원) | – | MIT | 태스크마다 워크트리, TUI 대시보드 |
| **dmux** | github.com/standardagents/dmux | Node.js | 필요 | – | MIT | 워크트리 자동 생성 |
| **agentmx** | github.com/d1maash/agentmx | TypeScript | ? | ? | MIT | `amx pipe` 파이프라인, 병렬 비교·심판 투표, 비용 상한, CI 모드. 별 0개(초기) |
| **ittybitty** | github.com/adamwulf/ittybitty | bash | 필요 | – | MIT | 스크립트 하나, 워크트리 자동 생성·정리 |
| **ccmux** | pypi.org/project/ccmux | Python | 필요 | – | ? | 주의가 필요한 세션을 표시하는 사이드바, 워크트리 옵션 |
| **claude-tmux** | – | – | 필요 | – | ? | 팝업으로 인스턴스 전환, 워크트리·PR |
| **crmux** | github.com/maedana/crmux | Rust | 필요 | – | MIT | 기존 tmux 세션을 그대로 감시. 유지보수 모드(저자가 herdr로 이동) |
| **TmuxCC** | github.com/nyanko3141592/tmuxcc | Rust | 필요 | ? (미확인) | MIT | 기존 세션 감시 |

## 4. 오케스트레이션 · 에이전트 내장형

화면 없이 에이전트가 다른 에이전트를 부리는 방식이다. EQMUX 메시지 버스와 개념이 가장 가깝다.

| 도구 | 링크 | 방식 |
|---|---|---|
| **Claude Code Agent Teams** | Claude Code 내장 | **실험 기능(기본 꺼짐)**. 리드 에이전트가 하위 에이전트를 띄워 조정하고 머지한다. 하위 에이전트는 부모와 함께 종료된다. 분할 페인이 Windows Terminal에서 안 되고, 플랜 자동 승인·skip-permissions가 하위로 전파된다 |
| **maniple** (옛 claude-team, MCP) | glama.ai/mcp/servers/@Martian-Engineering/claude-team | MCP 서버. Claude Code가 tmux·iTerm2 위의 다른 Claude Code 세션을 팀으로 부린다. 사람이 끼어들어 조종할 수 있다. Windows 미지원 |
| **claude-session-driver** | obra/claude-session-driver | 다른 Claude Code 세션을 tmux 워커로 띄우고 감시한다 |
| **claude-esp** | – | Claude Code의 숨은 출력(사고·도구 호출·서브에이전트)을 다른 터미널로 스트리밍한다 |
| Orca orchestration | `orca orchestration` | Run → Task → Dispatch → Message, 결정 게이트 |

## 5. 범용 터미널 멀티플렉서 · 세션 관리자

에이전트를 따로 인식하지 않는 기반 도구다. 2·3장 도구들이 이 위에 올라간다.

| 도구 | 종류 | Win | 비고 |
|---|---|---|---|
| **tmux** | 멀티플렉서 | – (WSL) | 사실상 표준. 3장 도구 대부분이 의존한다 |
| **Zellij** | 멀티플렉서 | – (WSL) | Rust, 레이아웃·플러그인(WASM) |
| **WezTerm** | 터미널 + 멀티플렉서 | ✓ | Lua 설정, 내장 mux 서버 |
| **Windows Terminal** | 터미널(탭·분할) | ✓ | 세션 유지나 에이전트 인식이 없다 |
| **Ghostty** | 터미널 | – | cmux의 기반(libghostty). `docs/ghostty-features.md` |
| **Warp** | 에이전트형 터미널 | ✓ | Warp Agent·Oz 클라우드 오케스트레이션, 외부 CLI 에이전트도 실행 |
| iTerm2 · Kitty · Alacritty | 터미널 | 일부 | 에이전트 기능이 없다 |
| **tmuxinator** | tmux 세션 템플릿(YAML) | – | Ruby |
| **tmuxp** | tmux 세션 템플릿(YAML·JSON) | – | Python, libtmux 기반 |
| **sesh** | tmux 세션 전환기 | – | Go, zoxide 연동 |

## 6. 관찰

1. **Windows 네이티브는 여전히 드물다.** 3장 TUI 도구는 대부분 tmux에 의존한다. Windows에서 직접 도는 에이전트 전용 도구는 wmux 계열 3개, herdr, Orca, Nimbalyst, Termdock, Codex 앱 정도다. 이 중 에이전트 간 메시지가 있는 것은 wmux(`a2a`)와 herdr(스킬로 위임)뿐이다.
2. **대세는 "태스크마다 워크트리 + 경쟁"이다.** claude-squad·Conductor·Superset·Orca·workmux·dmux 모두 같은 흐름이다. "한 저장소를 역할이 다른 팀이 협업"하는 모델은 EQMUX 말고는 Agent Teams와 maniple(옛 claude-team, MCP)만 있다. 둘 다 화면이 없다.
3. **관제 화면은 차별점이 되기 어려워지고 있다.** amux(공유 보드·모바일), Vibe Kanban·Nimbalyst·Termlux(칸반), cmux(알림 링·미확인 이동)가 모두 "어느 에이전트가 나를 기다리나"를 푼다.
4. **정리되는 도구도 많다.** Opcode는 개발이 멈췄고, Vibe Kanban은 유료 클라우드를 접고 종료를 공지했으며, Crystal은 Nimbalyst로 이름을 바꿨다. 이 분야의 1년 생존율은 낮다.

## 출처

- [Best Tools for Managing Parallel AI Coding Agents in 2026 — DEV Community](https://dev.to/stravukarl/best-tools-for-managing-parallel-ai-coding-agents-in-2026-14l8)
- [Best Tools for Parallel AI Coding Agents (2026) — Nimbalyst](https://nimbalyst.com/blog/best-tools-for-running-parallel-ai-coding-agents/)
- [Best AI Agent Multiplexers Compared (2026) — amux](https://amux.io/guides/best-ai-agent-multiplexers-2026/)
- [Best terminals and agent workspaces for AI coding agents — cmux](https://cmux.com/compare/best-terminal-for-ai-coding-agents)
- [Superset vs cmux — superset.sh](https://superset.sh/compare/superset-vs-cmux) · [conductor alternative](https://superset.sh/compare/conductor-alternative)
- [Claude Code 멀티 세션 도구 비교 — zenn.dev](https://zenn.dev/maedana/articles/claude-code-multi-session-tools-comparison?locale=en)
- [Agent Session Managers for Codex CLI: CCManager, Agent Deck](https://codex.danielvaughan.com/2026/05/05/codex-cli-session-managers-ccmanager-agent-deck-parallel-agent-orchestration/)
- [Agent of Empires — dev.co](https://dev.co/ai/coding-agents/agent-of-empires)
- [wmux — DEV Community](https://dev.to/wong2kim/wmux-run-claude-code-codex-and-gemini-cli-side-by-side-on-windows-pkg) · [amirlehmam/wmux](https://github.com/amirlehmam/wmux) · [snowyukitty/wmux](https://github.com/snowyukitty/wmux)
- [Herdr — Chase AI](https://www.chaseai.io/blog/herdr-terminal-multiplexer-ai-coding-agents) · [Herder — MindStudio](https://www.mindstudio.ai/blog/herder-terminal-agent-multiplexer)
- [agentmx — GitHub](https://github.com/d1maash/agentmx) · [claude-squad — GitHub](https://github.com/smtg-ai/claude-squad) · [ccmux — PyPI](https://pypi.org/project/ccmux/)
- [claude-team MCP — Glama](https://glama.ai/mcp/servers/@Martian-Engineering/claude-team) · [claude-session-driver](https://gittrend.io/repo/obra/claude-session-driver)
- [Termlux](https://termlux-fe-sigma.vercel.app/)
- [OpenAI's Codex is now on Windows — The New Stack](https://thenewstack.io/openais-codex-is-now-on-windows/)
- [tmuxp — PyPI](https://pypi.org/project/tmuxp/1.2.2)
