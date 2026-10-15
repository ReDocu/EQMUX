# 벤치마킹 — 범용 멀티플렉서·세션 관리자 · 웹 대시보드형 (2026-10-14)

종합본: `docs/benchmark-summary-2026-10-14.md` · 도구 목록: `docs/multiplexer-tools-2026-10-14.md`
기준: EQMUX `sub_main` 0.4.2 + `docs/update-plan-0.5.0.md`

## 1. 한 줄 결론

범용 멀티플렉서에서는 **선언형 레이아웃 파일과 "앱을 꺼도 살아 있는 세션"**을 배운다. 웹 대시보드형에서는 **"완료에는 증거, 검증은 동료가"라는 보드 규칙과 멈춘 세션 감시**를 배운다. 둘 다 EQMUX의 파일 원본·수동 실행 원칙과 충돌하지 않는다.

## 2. 도구별 표

### 2-1. 범용 멀티플렉서·세션 관리자

| 도구 | 포지셔닝 | 플랫폼·라이선스 | 핵심 기능 | EQMUX 대비 강점 | EQMUX 대비 약점 |
|---|---|---|---|---|---|
| **tmux** | 사실상 표준 멀티플렉서 | Unix (Windows는 WSL), ISC | 세션·윈도·페인, detach/attach, `send-keys`·`capture-pane` 스크립팅, 플러그인(tpm·resurrect·continuum) | 서버가 PTY를 소유해 클라이언트가 죽어도 세션이 산다. 에이전트 도구 대부분이 의존하는 공통 API다 | 에이전트 인식 없음, GUI 없음, Windows 네이티브 아님 |
| **Zellij** | "배터리 포함" 터미널 워크스페이스 | Linux·macOS·**Windows 네이티브**, 오픈소스 | KDL 레이아웃 파일(페인·탭·명령·플러그인), 명령 페인(종료 코드 표시·한 키 재실행·일시정지 시작), 세션 부활(재부팅 후에도), 웹 클라이언트 + 읽기 전용 토큰, WASM 플러그인, `zellij subscribe` 출력 스트리밍·JSON 상태 조회 | 레이아웃을 버전 관리하고 팀과 공유한다. 명령 페인이 서버 탭 문제(종료 감지·재실행)를 이미 풀었다. 브라우저 관전 | 에이전트 상태·역할·메시지 없음 |
| **WezTerm** | 터미널 + 내장 mux | Mac·**Win**·Linux, MIT | Unix·SSH·TLS 도메인, 재접속 자동 복구, `wezterm cli spawn/send-text/get-text/list`, Lua 설정 | 외부 프로그램이 페인을 만들고 텍스트를 읽고 쓰는 CLI가 표준적이다. Windows에서 WSL과 GUI를 잇는다 | 에이전트 기능 없음. mux는 문서 스스로 "아직 젊은 기능"이라 한다 |
| **Windows Terminal** | Windows 기본 터미널 | **Win**, MIT | 탭·분할, 프로필(PowerShell·CMD·WSL), JSON 설정, 창 레이아웃 복원 | 모든 Windows 사용자의 기준선이다. 셸 프로필 선택 UX | 세션 영속·에이전트 인식·API 없음 |
| **Ghostty** | 빠르고 네이티브한 터미널 | Mac·Linux, MIT | Zig 코어, libghostty(cmux가 사용), 네이티브 UI (`docs/ghostty-features.md`) | 렌더링 성능, 임베드 가능한 터미널 코어 | Windows 미지원, 에이전트 기능 없음 |
| **Warp** | "오픈 에이전틱 개발 플랫폼" — Terminal · Agent CLI · Factories | Agent CLI는 Mac·Linux·**Win**, 터미널은 오픈소스, 에이전트 실행당 과금 | Claude Code·Codex 등 외부 하네스 실행, 실행 중 에이전트 명단·상태 추적, 웹·모바일·IDE에서 관전·조종·핸드오프, Factories(트리아지 → 리뷰 → PR, 단계별 라우팅, 스크린샷·영상 검증) | "에이전트 명단 + 어디서든 조종 + 핸드오프"를 제품 문구로 내세운다. EQMUX 관제와 가장 가까운 범용 터미널이다 | 클라우드·과금 중심, 로컬 팀 모델이나 역할 개념 없음 |
| **tmuxinator** | tmux 세션 템플릿(YAML) | Unix, MIT, Ruby | 프로젝트별 YAML로 윈도·페인·명령 정의, 한 명령으로 띄우기 | 팀 편성 프리셋과 같은 발상을 텍스트 파일로 한다 | tmux 전용, 상태 관리 없음 |
| **tmuxp** | tmux 세션 템플릿(YAML·JSON) | Unix, MIT, Python | libtmux 기반, 프로젝트 폴더의 `.tmuxp.yaml` 자동 로드, tmuxinator 형식 호환 | 저장소 안 파일 하나로 작업 환경을 재현한다 | 위와 같음 |
| **sesh** | "똑똑한 tmux 세션 관리자" | Unix(+PowerShell 완성), MIT, 별 약 2.9k | zoxide로 자주 가는 프로젝트 점프, 저장소·디렉터리 이름으로 세션 자동 명명, 세션 생성 시 시작 명령(에디터·dev 서버), 와일드카드 설정, fzf 피커, 최근 두 세션 토글, 워크트리 루트 점프 | 이름으로 연결하고 없으면 만든다. 빠른 전환 UX | tmux 의존, 에이전트 인식 없음 |

### 2-2. 웹 대시보드형

| 도구 | 포지셔닝 | 플랫폼·라이선스 | 핵심 기능 | EQMUX 대비 강점 | EQMUX 대비 약점 |
|---|---|---|---|---|---|
| **Vibe Kanban** | 칸반으로 계획하고 에이전트를 돌린다 | `npx`, Mac·Win·Docker·자체 호스팅, Apache-2.0, 별 약 28.4k | 칸반 이슈 생성·우선순위·배정, 워크스페이스마다 브랜치·터미널·dev 서버, diff 인라인 코멘트 → 에이전트, 미리보기 브라우저(inspect·기기 에뮬레이션), AI PR 설명, 고아 워크트리 정리, MCP 서버. 10종 에이전트 | 이슈 → 워크스페이스 → 리뷰 → PR이 한 화면에서 이어진다 | **종료(sunsetting) 공지**. 유료 클라우드는 2026-04에 닫았다. 역할·메시지 버스 없음 |
| **amux** | "AI 코딩 에이전트의 컨트롤 플레인" | Mac(launchd)·Linux(systemd), Windows 언급 없음, MIT + Commons Clause(README) / MIT(About), 별 534 | 웹 대시보드 + CLI, 공유 칸반의 **원자적 태스크 선점, `done`에는 증거, `verified`에는 동료 확인**, 출처가 찍히는 `@` 메시지, 다른 워커 터미널 엿보기, 실행 중 조향·모델 전환, 크론 프롬프트·자율 루프, 워치독(자동 compact·크래시 재시작·마지막 메시지 재생), Tailscale로 폰 접속·iOS 앱, Rust + SQLite 이벤트 저널, tmux 또는 herdr 백엔드 | EQMUX와 문제 정의가 거의 같다(팀 + 보드 + 메시지 + 관제). 보드 규칙으로 품질을 강제한다. 원격·모바일 | 자율 루프·자동 재시작은 EQMUX 원칙과 반대다. Windows 없음, 소규모 |
| **OpenHands** (Agent Canvas) | "자체 호스팅 코딩 에이전트 관제 센터" | Linux·Mac·Win(PowerShell·WSL2 가이드), MIT, 별 약 90.9k, 상용 Cloud | 자체 에이전트 + Claude Code·Codex·Gemini·OpenCode 구동, 대화마다 Docker 샌드박스, 백엔드 전환(로컬·Docker·VM·클라우드), 스케줄·웹훅 자동화(Slack·GitHub·Linear·Notion·Datadog) | 규모·생태계. 샌드박스 격리 | 터미널 중심이 아니다. 자동화가 핵심이라 원칙이 다르다 |
| Devin | 클라우드 자율 엔지니어 | 클라우드, 독점, $500+/월 | 태스크마다 클라우드 샌드박스, GitHub·Linear·Jira·Slack | 완전 위임 | 로컬·사람 관제 모델과 정반대 |
| Cursor Background Agents | IDE 안 백그라운드 에이전트 | 3개 OS, 유료 | 에이전트마다 브랜치, PR 생성, IDE 안 통합 뷰 | IDE 사용자 흡수력 | Cursor 에이전트 전용 |

## 3. 분류 공통 패턴 (시장 기본기)

범용 멀티플렉서
1. **세션이 UI보다 오래 산다.** tmux 서버, Zellij 부활, WezTerm 도메인 모두 그렇다. 창을 닫거나 재부팅해도 세션을 다시 붙이거나 다시 세운다.
2. **레이아웃은 텍스트 파일이다.** tmuxinator·tmuxp YAML, Zellij KDL, WezTerm Lua 모두 저장소에 넣고 공유한다.
3. **외부에서 조종하는 CLI가 있다.** `send-keys`/`capture-pane`, `wezterm cli send-text/get-text`, `zellij subscribe`. 에이전트 도구들이 이 API 위에 올라간다.
4. **이름으로 붙고, 없으면 만든다.** sesh, `tmux new -A`, Zellij 세션 관리자 모두 같은 UX다.

웹 대시보드형
1. **보드(칸반)가 기본 화면이다.** Vibe Kanban, amux, Warp의 에이전트 명단.
2. **어디서든 본다.** 브라우저·폰(amux, Warp, Zellij 웹 클라이언트).
3. **diff 코멘트 → 에이전트.** Vibe Kanban, Orca 모두 가진다.
4. **멈춘 세션을 감시한다.** amux 워치독, Termdock 상태 점검.

## 4. EQMUX가 가져올 것

| 순위 | 기능 | 출처 도구 | EQMUX에 넣는 방식 | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **명령 페인 동작** — 종료 코드 표시, 한 키 재실행, 마지막 명령 기억 | Zellij | 서버 탭 P0(종료된 셸 복구)과 P2(마지막 서버 명령 재실행)를 이 모델로 한 번에 푼다. 종료 상태와 마지막 명령을 모듈 스코프에 두고, 탭에 "종료됨 (exit 1) · ↻ 다시 실행"을 띄운다 | 작음 | 0.5 |
| 2 | **완료 증거·동료 검증 규칙** | amux | 임무 상태 전이에 규칙을 건다. `완료`로 바꿀 때 산출물 체크리스트(P2 항목)나 `report` 메시지 링크를 요구한다. `검증` 상태는 다른 슬롯의 `review` 메시지가 있어야 열린다. 자동 실행이 아니라 사람 버튼을 막는 조건이라 원칙과 맞다 | 중간 | 0.6 (임무 산출물 체크리스트와 같이) |
| 3 | **팀 편성을 저장소 파일로 공유** | tmuxp(`.tmuxp.yaml`), Zellij KDL | 이미 `.eqmux/team.json`이 원본이다. 빠진 것은 "저장소를 클론한 다른 사람이 그대로 띄우기"다. 워크스페이스 연결 때 `.eqmux/team.json`이 있으면 "이 저장소의 팀 편성으로 시작" 버튼을 띄운다. 레이아웃(`layout.json`)도 저장소 쪽에 선택적으로 둔다 | 작음 | 0.5.x |
| 4 | **멈춘 세션 표시** | amux 워치독 | 자동 재시작은 하지 않는다. busy 상태로 N분 동안 출력이 없으면 대시보드에 "응답 없음" 배지와 `재시작`·`재개` 버튼만 띄운다. 상태 감지가 이미 있으니 타이머만 더한다 | 작음 | 0.5.x |
| 5 | **외부 조종 CLI 보강** — 세션 목록, 출력 읽기 | WezTerm `cli list/get-text`, tmux `capture-pane` | `eqmux` CLI에 `list`(세션·상태)와 `read <세션> --lines N`(스크롤백 DB에서 읽기)을 더한다. 0.6으로 미룬 "CLI 세션 원격 제어(FR-C-40~44)"의 읽기 전용 절반이다. 입력 주입은 넣지 않는다 | 작음 | 0.6 |
| 6 | **이름으로 열고 없으면 만들기 + 최근 두 워크스페이스 토글** | sesh | 워크스페이스 전환 단축키(예: `Ctrl+Tab`=직전 워크스페이스). Orca 벤치마킹의 Jump 팔레트와 묶는다 | 작음 | 0.6 |
| 7 | **읽기 전용 관전 링크** | Zellij 웹 클라이언트 읽기 전용 토큰, Warp 웹 관전 | 로컬 HTTP로 대시보드를 읽기 전용으로 띄우고 폰에서 본다. 조작은 하지 않는다. 인가 설계가 먼저 필요하다 | 큼 | 0.6 이후 |

## 5. 가져오지 않을 것

| 기능 | 출처 | 이유 |
|---|---|---|
| 자율 루프 · 크론 프롬프트 · 웹훅 자동화 | amux, OpenHands, Warp Factories | "자동 실행 경로는 없다" 원칙과 충돌한다 |
| 크래시 자동 재시작 + 마지막 메시지 재생 | amux 워치독 | 같은 이유. EQMUX는 재개 *제안*으로 대신한다. 감지만 가져온다(4장 4번) |
| tmux 백엔드 · tmux 호환 | tmux, sesh | Windows 네이티브가 정체성이다. ConPTY + Job Object를 유지한다 |
| 칸반을 기본 화면으로 | Vibe Kanban, amux | EQMUX 기본 화면은 세션 그리드 관제다. 임무 보드는 기존 임무 화면을 다듬는 선에서 그친다 |
| 클라우드 에이전트·과금 | Warp, Devin, OpenHands Cloud | 앱이 키를 갖지 않고 로컬에서 돈다 |
| Docker 샌드박스 | OpenHands | 격리는 git 워크트리 옵트인으로 충분하다. Windows Docker 의존은 설치 장벽이다 |
| WASM 플러그인 시스템 | Zellij | MCP·플러그인은 이미 0.6 이후로 미뤘다 |

## 6. 경고 신호

- **Vibe Kanban(별 28k)이 종료한다.** 칸반 + 워크트리 + 리뷰만으로는 지속하기 어렵다는 신호다. 기능 경쟁보다 지속 가능한 차별점(EQMUX: 역할 팀 + Windows)에 집중해야 한다.
- **amux가 백엔드로 herdr를 지원한다.** 에이전트 멀티플렉서들이 서로의 위에 올라가는 층이 생기고 있다. `eqmux` CLI와 파이프가 다른 도구의 백엔드가 될 수 있는지는 0.6 외부 인터페이스 재설계 때 검토한다.

## 7. 출처

- [Zellij](https://zellij.dev/) · [Zellij features](https://zellij.dev/features/)
- [WezTerm multiplexing](https://wezterm.org/multiplexing.html)
- [Warp](https://www.warp.dev/)
- [sesh — GitHub](https://github.com/joshmedeski/sesh)
- [tmuxp — PyPI](https://pypi.org/project/tmuxp/1.2.2)
- [Vibe Kanban — GitHub](https://github.com/BloopAI/vibe-kanban)
- [amux — GitHub](https://github.com/mixpeek/amux)
- [OpenHands — GitHub](https://github.com/All-Hands-AI/OpenHands)
- [amux 비교 글 (Devin·Cursor 항목, 경쟁사 작성·미검증)](https://amux.io/guides/best-ai-agent-multiplexers-2026/)
- Ghostty: `docs/ghostty-features.md`(2026-08-02 조사). tmux·tmuxinator·Windows Terminal은 공식 문서의 일반 기능 기준이라 이번에 따로 조사하지 않았다
