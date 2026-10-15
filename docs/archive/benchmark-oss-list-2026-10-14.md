# 벤치마킹 후보 오픈소스 목록 — 2026-10-14

기준: EQMUX(Windows 데스크톱 · 터미널 페인 중심 · 에이전트 팀 관제 · 타입 메시지 버스)와 겹치는 오픈소스.
방법: 웹 검색으로 후보를 모으고, 별·라이선스·마지막 커밋은 `gh api`로 같은 날 직접 확인했다. 플랫폼은 각 README에서 확인했다.

이미 조사한 것: Orca(`orca-features.md`) · Ghostty · Terax · bbarit-agent-oss · Paseo(`paseo-features.md`).

## 추천 — 다음에 조사할 순서

| 순위 | 프로젝트 | 왜 먼저인가 |
|---|---|---|
| 1 | **herdr** | 터미널 중심 에이전트 멀티플렉서 중 가장 크다(4.4만). working/waiting/done 상태 감지와 세션 영속성이 EQMUX 관제의 핵심과 같다. Windows를 지원한다 |
| 2 | **oh-my-claudecode** | "팀 우선" Claude Code 오케스트레이션(4만). JSON 스키마로 에이전트끼리 데이터를 주고받는다. EQMUX의 직무·팀·메시지 버스와 직접 비교할 수 있다 |
| 3 | **Emdash** | Windows 설치본(MSI)이 있는 데스크톱 ADE다. 사용자 입장에서 EQMUX와 가장 직접 겹치는 경쟁 제품이다 |
| 4 | **Agent Relay** | 규모는 작지만(883) "에이전트 팀이 서로 대화"하는 인프라 자체가 주제다. 메시지 버스 설계를 비교하기에 좋다 |
| 5 | **Gas Town** | 멀티 에이전트 워크스페이스 관리자. 작업 추적을 영속화한다. EQMUX 임무(mission) 모델과 비교한다 |

## 1군 — EQMUX와 직접 겹침

| 프로젝트 | 별 | 라이선스 | 언어 | 플랫폼 | 마지막 커밋 | 볼 것 |
|---|---|---|---|---|---|---|
| [herdr](https://github.com/herdrdev/herdr) | 43,966 | Apache-2.0 | Rust | macOS · Linux · **Windows** | 10-14 | 에이전트 상태 감지, 페인 분할, 세션 영속성, 15종 이상 에이전트 |
| [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | 39,900 | MIT | TS | Claude Code 플러그인 | 10-14 | 팀 편성, JSON 스키마 메시지, 역할 분담 |
| [cmux](https://github.com/manaflow-ai/cmux) | 28,166 | GPL-3.0+ (서버는 BUSL-1.1) | Swift | macOS 전용 | 10-14 | Ghostty 기반, 세로 탭, 에이전트 알림 UI |
| [Gas Town](https://github.com/gastownhall/gastown) | 18,368 | MIT | Go | macOS · Linux · **Windows** | 10-08 | 멀티 에이전트 워크스페이스, 작업 추적 DB |
| [Emdash](https://github.com/generalaction/emdash) | 5,982 | Apache-2.0 | TS | macOS · **Windows** · Linux | 10-13 | 데스크톱 ADE, 병렬 에이전트, 워크트리 (YC W26) |
| [Agent Relay](https://github.com/AgentWorkforce/relay) | 883 | Apache-2.0 | TS | — | 10-14 | Claude Code·Codex·OpenCode 사이 메시징, Observer(감사 기록) |

## 2군 — 일부 기능이 겹침

| 프로젝트 | 별 | 라이선스 | 언어 | 플랫폼 | 마지막 커밋 | 볼 것 |
|---|---|---|---|---|---|---|
| [ruflo (구 claude-flow)](https://github.com/ruvnet/ruflo) | 74,638 | MIT | TS | CLI | 10-14 | 스웜 오케스트레이션. 자율 실행 중심이라 EQMUX 원칙과는 반대다. 무엇을 *하지 않을지* 정하는 참고로 쓴다 |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | 28,360 | Apache-2.0 | Rust | 웹 (Windows 실행 안내 있음) | 09-19 | 칸반으로 에이전트 작업 관리. 임무 보드 UI 참고 |
| [Happy](https://github.com/slopus/happy) | 24,138 | MIT | TS | 모바일 + 데스크톱(Win 포함) | 10-14 | Claude·Codex 원격·모바일 제어 |
| [Superset](https://github.com/superset-sh/superset) | 15,180 | **ELv2 (소스 공개, OSI 오픈소스 아님)** | TS | macOS (Linux 실험) | 10-14 | 병렬 에이전트 ADE. 코드 차용은 불가하고 기능만 참고한다 |
| [CloudCLI (claudecodeui)](https://github.com/siteboon/claudecodeui) | 14,083 | AGPL-3.0 | TS | 웹 · 모바일 | 10-12 | 웹·모바일에서 Claude Code·Codex 세션 제어 |
| [OpenChamber](https://github.com/openchamber/openchamber) | 11,567 | MIT | TS | macOS · **Windows** · Linux | 10-14 | OpenCode 기반 ADE, 원격 머신·SSH, 네이티브 알림 |
| [claude-squad](https://github.com/smtg-ai/claude-squad) | 8,600 | AGPL-3.0 | Go | tmux TUI | 08-20 | tmux 기반 다중 에이전트 관리. 가장 오래된 계열 |
| [container-use](https://github.com/dagger/container-use) | 4,069 | Apache-2.0 | Go | — | 09-21 | 워크트리 대신 컨테이너로 격리 |
| [xum (coder)](https://github.com/coder/xum) | 2,053 | AGPL-3.0 | TS | macOS · Linux | 10-14 | 격리된 병렬 에이전트 데스크톱 앱 |

## 3군 — 작거나 범위가 좁음 (필요할 때만)

| 프로젝트 | 별 | 라이선스 | 메모 |
|---|---|---|---|
| [Jean](https://github.com/coollabsio/jean) | 1,324 | Apache-2.0 | AI 에이전트용 개발 환경. README에 Windows 언급 있음 |
| [ccmanager](https://github.com/kbwo/ccmanager) | 1,262 | MIT | 세션 관리 TUI. 에이전트 상태 감지 |
| [agent-deck](https://github.com/asheshgoplani/agent-deck) | 1,081 | MIT | 세션 관리 TUI (Go) |
| [Parallel Code](https://github.com/johannesjo/parallel-code) | 1,048 | MIT | Electron, 워크트리 병렬. macOS·Linux만 |
| [Zellij](https://github.com/zellij-org/zellij) | 35,726 | MIT | 에이전트 전용은 아니다. 레이아웃 파일과 플러그인(WASM) 모델 참고 |
| [flowmux](https://github.com/grouzen/flowmux) | 25 | MIT | tmux 기반 대시보드. 아주 작다 |

## 제외

| 프로젝트 | 이유 |
|---|---|
| Conductor · Codex 앱 · Claude Desktop | 오픈소스가 아니다 |
| [Crystal](https://github.com/stravu/crystal) | Nimbalyst로 바뀌었다고 공지하고 02월 이후 커밋이 없다 |
| [FleetCode](https://github.com/built-by-as/FleetCode) | 라이선스가 없고 03월 이후 멈췄다 |
| [uzi](https://github.com/devflowinc/uzi) | 2025-06 이후 멈췄다 |
| [myclaude](https://github.com/stellarlinkco/myclaude) | AGPL, 05월 이후 멈췄다 |
| [OpenCode](https://github.com/anomalyco/opencode) | 관제 도구가 아니라 에이전트 자체다. 붙일 프로바이더 후보로만 본다 |
| Herder · amux · Caw · Chloe · muxel | 검색 기사에만 나오고, GitHub 저장소를 확인하지 못했다 |

## 주의

- **라이선스**: cmux(GPL-3.0 + 서버 BUSL)·Superset(ELv2)·AGPL 계열은 EQMUX(MIT)에 코드를 가져오면 안 된다. 기능과 UX만 참고한다.
- **Paseo** 라이선스는 GitHub에서 "Other"로 잡힌다. 사이트는 Apache-2.0이라고 하지만 저장소에는 부분별 라이선스가 섞여 있다. 코드를 차용하기 전에 LICENSE 파일을 확인한다.
- 별 수는 2026-10-14 기준이다. 스타 수가 기능의 질을 말해 주지는 않는다.

## 출처

- 검색: [parallel-code](https://github.com/johannesjo/parallel-code) · [FleetCode](https://github.com/built-by-as/FleetCode) · [parallel-worktrees](https://github.com/spillwavesolutions/parallel-worktrees) ·
  [flowmux](https://github.com/grouzen/flowmux) · [herdr 소개](https://www.opentechhub.io/herdr/) · [GitHub topic: coding-agents](https://github.com/topics/coding-agents) ·
  [Agent Relay 스킬](https://vibeindex.ai/skills/agentworkforce/relay/creating-claude-agents) · [oh-my-claudecode](https://www.sourcepulse.org/projects/22300495) · [gastown AUR](https://linux-meta.duckdns.org/en/p/gastown)
- Paseo 비교 페이지: https://paseo.sh/alternatives/ (conductor · superset · openchamber · happy-coder · orca)
- 수치: `gh api repos/<owner>/<repo>` (2026-10-14)
