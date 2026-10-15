# Gas Town 벤치마킹 — 2026-10-14

대상: https://github.com/gastownhall/gastown (README · releases · commits), https://github.com/gastownhall/beads (README), 2차 자료(아래 출처)
기준: EQMUX `sub_main` 0.4.2 + `docs/update-plan-0.5.0.md`
같이 볼 문서: `docs/herdr-benchmark-2026-10-14.md`, `docs/orca-benchmark-2026-10-14.md`. 이 문서는 EQMUX의 **임무(mission) 모델**과 Gas Town의 작업 추적 모델을 나란히 놓는 데 집중한다.

## 1. 지금의 Gas Town

| 항목 | 내용 |
|---|---|
| 한 줄 | "Multi-agent orchestration system for Claude Code, GitHub Copilot, and other AI agents with persistent work tracking" — 에이전트 20~30명을 한 번에 돌리는 작업장 관리자다 |
| 만든 사람 | Steve Yegge. 설치 안내가 `steveyegge/gastown`·`steveyegge/beads` 경로를 쓰고, 2차 자료가 모두 Yegge의 프로젝트로 소개한다. 저장소는 `gastownhall` 조직으로 옮겨졌다 |
| 공개 | 2026-01-01 오픈소스 공개(2차 자료) |
| 버전 | v1.2.1 (06-06). v1.0.0(04-03) → v1.0.1(04-25) → v1.1.0(05-07) → v1.2.0(05-30) |
| 활동 | main 최근 커밋 07-23. **2026-10-14 조회 시점에 석 달 가까이 릴리즈가 없고, 커밋도 07-23 뒤로 없다** |
| 규모 | GitHub 별 18.4k, 포크 1.7k, 커밋 7,770, 열린 이슈 375 · PR 132 |
| 라이선스·언어 | MIT, Go(Go 1.26.2+). 상용 제품은 없다 |
| 플랫폼 | macOS(Homebrew) · Linux · Windows(v1.0.0부터, v1.2.0에서 amd64 zip) · Docker Compose |
| 의존 | Git 2.20+, **tmux 3.0+**, Beads(`bd`), **Dolt**(버전 관리 SQL DB), 에이전트 CLI |
| 지원 에이전트 | 프리셋 11종: claude(기본) · gemini · codex · kiro · cursor · auggie · amp · opencode · copilot · pi · omp. v0.12.1에서 ACP 지원 |

### 후속 프로젝트와 현재 위치

- **Gas City**: 2026년 4월 말 발표. Gas Town의 고정된 배역(Mayor·Dogs 등)을 풀어 사용자가 조직 구조를 직접 짜는 SDK다. gascity.com은 Chris Sells(CEO) · Julian Knutsen(CTO) · Yegge(자문)를 적었다. 2차 리뷰는 "아직 실전용은 아니다"라고 평했다.
- **Yegge 본인의 평가**: 8월 에세이를 인용한 2차 자료에 따르면 Yegge는 "Gas Town effectively burned down"이라 쓰고, 자기 전용 비공개 하네스(Wheelhouse)로 옮겼다. 원문은 확인하지 못했다. 커밋이 7월에 멈춘 것과는 맞는다.
- **Beads**는 따로 살아 있다. 별 27.9k로 Gas Town보다 크고, Windows(PowerShell 설치)도 지원한다.

## 2. 핵심 기능 상세

### 어휘와 배역

이름이 많고 은유가 강하다. README 기준으로 정리했다.

| 이름 | 하는 일 |
|---|---|
| Town | 작업장 디렉터리(`~/gt/`). 모든 프로젝트·에이전트·설정을 담는다 |
| Rig | 프로젝트 하나(git 저장소 + 그 에이전트들) |
| Mayor | 전체 맥락을 가진 조정자 에이전트(Claude Code). 사람은 Mayor에게 말한다 |
| Polecat | 일꾼 에이전트. "persistent identity but ephemeral sessions" — 이름과 이력은 남고 세션은 일이 끝나면 닫힌다 |
| Crew | 사람이 직접 쓰는 작업 공간 |
| Hook | git 워크트리 기반의 에이전트 작업 저장소. Created → Active → Suspended → Completed → Archived |
| Convoy | bead 묶음. 에이전트에게 넘기는 작업 단위. `mountain` 라벨이 붙으면 정체 감지를 한다 |
| Witness | Rig별 감독. polecat이 멈췄는지 보고 복구를 건다 |
| Deacon · Dogs · Boot | 전체 Rig를 순찰하는 상주 감독과 그가 부리는 정비 일꾼 |
| Refinery | Rig별 머지 큐 |
| Escalation | 심각도(P0·P1·P2)별 보고. Deacon → Mayor → Overseer(사람) 순으로 올라간다 |
| Scheduler | 동시 polecat 수 상한(`scheduler.max_polecats`, 기본 -1 = 제한 없음) |
| Seance | `.events.jsonl`로 이전 세션을 찾아 그 맥락을 묻는다 |
| Molecules · Formulas | TOML로 쓴 작업 흐름 템플릿 |
| Wasteland | DoltHub로 여러 Town을 잇는 연합 작업망. `gt wl claim/done --evidence` |

### GUPP

"If there is work on your Hook, YOU MUST RUN IT"(2차 자료 인용). 훅에 일이 걸리면 에이전트는 사람의 지시를 기다리지 않고 바로 실행한다. README의 문제 화면은 "일이 걸렸는데 오래 진척이 없는" 에이전트를 `GUPP Violation`으로 분류한다. **자동 실행이 설계의 중심**이다.

### 작업 모델 비교 — bead vs 임무

| 항목 | Gas Town (Beads) | EQMUX 임무 |
|---|---|---|
| 작업 단위 | bead = 이슈 1건. 해시 ID(`gt-abc12`), epic 아래 `.1`·`.1.1` 계층. convoy가 여러 bead를 묶는다 | 임무 1건 = `.eqmux/missions/<슬러그>.md`. 이름·목표·산출물·브랜치(`missions.rs`) |
| 상태 | open · in-progress(claim) · hooked · closed + 서버가 계산하는 `is_blocked` | todo · in-progress · in-review · done 4종(`missions.rs:13`) |
| 의존 | blocks · parent-child · related · supersedes 등. `bd ready` = 막힘 없는 일 목록 | 없음. 평면 목록이다(F1~F8 "의존성 그래프" 미구현) |
| 배정 | Mayor가 convoy를 만들고 `gt sling <bead> <rig>`. 에이전트가 `bd update --claim`으로 **스스로 가져간다** | 사람이 임무 화면에서 토글 → 역할 파일의 `EQMUX:MISSION` 블록. 세션당 임무 1개. 기본 임무는 세션 생성 시점에만 자동 배정 |
| 착수 | GUPP — 걸리면 즉시 실행 | 브리프 한 줄을 주입한다(`canInject`일 때만). 실행 여부는 에이전트의 판단과 사람의 관제 |
| 인계 | 메일박스 · `gt nudge` · handoff(세션 교체) · Seance | `handoff` 메시지(원장) · 재개 제안 |
| 저장 | Dolt SQL이 원본. `bd dolt push/pull`로 git 원격에 동기화. `issues.jsonl`은 내보내기용 | 마크다운 파일이 원본(커밋 대상). 배정은 `roles/`(gitignore). DB는 캐시 |
| 머지 | `gt done` → 브랜치 push + 머지 요청 bead → Refinery가 묶어 검증 게이트를 돌리고 통과분만 머지. 실패하면 이분 탐색 | 없음. 임무-브랜치 체크아웃(FR-E-52)까지만. push는 권한으로 막는다 |
| 닫는 주체 | 에이전트(`gt done`, `bd close`)와 Refinery | **사람**(상태 칩 클릭). 에이전트가 임무를 바꾸는 CLI가 없다 |
| 기록 | Dolt 커밋 이력 + `.events.jsonl` | frontmatter `updated` 한 줄. 임무 이벤트는 목에서만 남는다(점검 3장) |
| 오래된 일 | compaction — 닫힌 bead를 요약해 컨텍스트를 아낀다 | 없음 |

### 감독과 재시작

3단 감시: Daemon(3분 하트비트) → Boot → Deacon → Rig별 Witness·Refinery. `gt feed`(TUI)는 에이전트 트리 · convoy · 이벤트 스트림 3칸이고, `p`로 문제 화면을 연다. 분류는 `GUPP Violation · Stalled · Zombie · Working · Idle`이고 `n`(nudge)·`h`(handoff)로 개입한다. `gt dashboard`는 htmx 웹 UI(8080)이고, README가 "trusted local-network surface"로 다루라고 경고한다.

### Windows

README가 직접 "Native Windows shells are best treated as minimal CLI-only environments"라고 쓴다. tmux 기반 전체 흐름(Mayor·Witness·Refinery·polecat)은 **WSL이 필요하다**. 소스 빌드는 MSYS2/MinGW 셸이 필요하고 "Plain PowerShell/MSVC is not enough"라고 적었다.

### 비용

README에는 비용 경고가 없고, 속도 제한 고갈을 막는 Scheduler만 있다. 2차 자료는 12~30명 기준 시간당 약 100달러, Yegge가 공개 첫 주에 Claude Code 계정 3개를 소진했다고 전한다. 1차 자료로 확인하지 못했다.

## 3. 포지셔닝 차이

| | Gas Town | EQMUX |
|---|---|---|
| 정체성 | 에이전트 공장. 20~30명, 사람은 Mayor에게만 말한다 | 팀 관제. 4~8명, 사람이 모든 세션을 본다 |
| 작업 흐름 | 자동 추진(GUPP) + 자동 감독 + 자동 머지 | 사람이 배정하고, 사람이 상태를 바꾸고, 사람이 머지한다 |
| 작업 원본 | Dolt DB(git 같은 이력) | `.eqmux/` 텍스트 파일 |
| 조직 | 고정 배역(Mayor·Polecat·Witness…) | 직무 8종 + 페르소나 + 0.5 직함 |
| 통신 | 메일박스 · nudge · 에스컬레이션 | 타입 5종 메시지(`messages.rs:11`), 원장, 상태 기반 전달 |
| 대상 | macOS·Linux 중심(Windows는 CLI 최소), 영어 | Windows 전용, 한국어 우선 |

둘 다 "역할이 있는 에이전트 조직 + 파일·git에 남는 작업 기록"이라는 같은 문제를 푼다. 갈리는 지점은 **누가 엔진을 돌리느냐**다. Gas Town은 에이전트가 일을 집어 가고 감독 에이전트가 깨우며 머지까지 기계가 한다. EQMUX는 모든 상태 전이를 사람의 버튼에 둔다. Gas Town의 작업 추적(Beads)은 EQMUX 임무보다 훨씬 깊지만, 그 깊이는 자동 실행을 전제로 설계됐다.

## 4. 영역별 비교

○ 있음 · △ 일부 · × 없음

| 영역 | Gas Town | EQMUX | 차이 |
|---|---|---|---|
| 작업 단위 파일·DB | ○ (Beads, Dolt) | ○ (임무 마크다운) | 철학 차이. EQMUX는 사람이 읽고 고친다 |
| 작업 의존·막힘 계산 | ○ (`bd ready`, `is_blocked`) | × | 가져올 것(작게) |
| 작업 계층(epic) | ○ | × | 나중 |
| 에이전트가 일을 스스로 가져감 | ○ (`--claim`) | × | 가져오지 않음 |
| 작업 이벤트 이력 | ○ (Dolt 이력 + events.jsonl) | × (`updated`만, 이벤트는 목) | 가져올 것 |
| 완료 증거 | ○ (`--evidence`, 검증 게이트) | △ (산출물 목록, 체크 없음) | 가져올 것 |
| 머지 큐 | ○ (Refinery, 배치·이분) | × | 가져오지 않음 |
| 정체·좀비 감지 | ○ (Stalled · Zombie · GUPP Violation) | △ (상태 감지, 무진행 경고 없음) | 가져올 것 |
| 자동 nudge·재시작 | ○ (Witness · Deacon) | × (재개 제안) | 원칙과 충돌 |
| 에스컬레이션 심각도 | ○ (P0~P2 경로) | △ (`escalate` 타입, 심각도 없음) | 가져올 것 |
| 이전 세션 맥락 조회 | ○ (Seance) | △ (트랜스크립트 열람) | Orca 문서 6번과 합침 |
| 동시 실행 상한 | ○ (Scheduler) | ○ (슬롯 8개 고정) | 구조적으로 이미 있음 |
| 관제 화면 | △ (TUI 3칸, htmx 웹) | ○ (워크스페이스×세션 그리드) | **EQMUX 우위** |
| 타입이 있는 메시지 | △ (메일·nudge) | ○ (5종, 상태 기반 전달) | **EQMUX 우위** |
| 사람이 정하는 역할·성격 | △ (고정 배역) | ○ (직무·페르소나·직함) | **EQMUX 우위** |
| 권한 기본값 | △ (Copilot `--yolo`, Kiro `--trust-all-tools` 프리셋) | ○ (bypass 경로 없음, `lib.rs:993`) | **EQMUX 우위** |
| Windows 네이티브 | △ (CLI 최소, 전체는 WSL) | ○ | **EQMUX 우위** |
| 한국어 | × | ○ | **EQMUX만** |
| 여러 프로젝트 조정 | ○ (Mayor가 Rig를 가로지름) | △ (0.5 프로젝트 간 통신) | 0.5에서 좁힌다 |
| 연합(Wasteland) · 클라우드 | ○ | × | 가져오지 않음 |
| 에이전트 종류 | ○ (11종 + ACP) | △ (Claude Code · Codex) | 가져오지 않음 |

## 5. 가져올 것 — 우선순위

EQMUX 원칙(자동 실행 없음, 앱이 API 키를 들지 않음, `.eqmux/` 파일이 원본, 상태를 바꾸는 것은 사람의 버튼)을 통과한 것만 골랐다.

| 순위 | 기능 | Gas Town에서 | EQMUX에 넣는 방식 | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **임무 이벤트 기록** | Dolt 이력 + `.events.jsonl`로 누가 언제 무엇을 바꿨는지 남는다 | 0.5 P1 "임무 생성·배정 이벤트는 Rust에서 기록"에 **상태 변경**을 더한다. `mission_create`·`mission_set_status`·`mission_assign`(`lib.rs:1588-1699`)이 이벤트 피드에 행을 남긴다. 원본은 여전히 파일이고 이벤트는 기록일 뿐이다 | 작음 | 0.5 P1 |
| 2 | **완료 제안 → 사람 승인** | 에이전트가 `gt done`·`bd close`로 스스로 닫는다 | 에이전트가 닫게 하지는 않는다. `eqmux report --mission <id> --done "근거"`가 대시보드 주의 카드에 "완료 제안" 칩을 띄우고, 사람이 누르면 `in-review`/`done`으로 간다. Orca 문서 4번(결정 게이트)의 첫 조각과 같은 경로다 | 중간 | 0.6 |
| 3 | **막힘 표시(`blocked_by`)** | `bd ready` — 막힘 없는 일만 보인다 | 임무 frontmatter에 `blocked_by: [id]` 한 키. 막힌 임무는 목록에서 흐리게, 배정 시 "아직 막힘" 경고. 앞선 임무가 done이면 풀린다. 계산은 `missions::list`의 실측 스캔 안에서 한다. 계층·그래프 UI는 하지 않는다 | 작음 | 0.6 (F1~F8 의존성 그래프의 최소판) |
| 4 | **무진행 경고** | 문제 화면의 `Stalled`·`GUPP Violation`·`Zombie` | 임무가 배정된 에이전트 세션이 N분 동안 idle이면 대시보드 주의 정렬에 "임무 무진행"을 올린다. **nudge는 자동으로 보내지 않는다.** 사람이 셀에서 `ask`를 보낸다 | 작음 | 0.6 |
| 5 | **산출물 체크 = 완료 증거** | `--evidence <url>`, Refinery 검증 게이트 | 0.5 P2 "임무 산출물 체크리스트"를 `- [ ]` 체크박스로 저장한다. `in-review`로 갈 때 미체크 항목 수를 보인다(막지는 않는다) | 작음 | 0.5 P2 |
| 6 | **`escalate` 심각도** | P0~P2별로 경로가 다르다 | `eqmux send --type escalate --sev high`. high만 OS 알림·주의 카드 맨 위. 본문 상한·분당 10건 규칙은 그대로 | 작음 | 0.6 |
| 7 | **대화 임무 필터** | bead가 메시지 타입과 스레드까지 품는다 | message 테이블에 `mission` 컬럼(발신 세션의 임무 블록에서 자동). 대화 탭에 임무 필터(이미 0.6 이후 목록에 있음) | 중간 | 0.6 |
| 8 | **임무 ID 충돌** | 해시 ID로 브랜치 간 머지 충돌을 막는다 | 지금은 슬러그라 두 브랜치에서 같은 이름의 임무를 만들면 같은 파일로 충돌한다. 실제로 겪는지 먼저 본다. 겪으면 슬러그 뒤에 짧은 해시를 붙인다 | 확인 후 작음 | 확인 필요 |

## 6. 가져오지 않을 것

| 기능 | 이유 |
|---|---|
| GUPP(걸리면 즉시 실행) · `--claim` 자기 배정 | "자동 실행 경로는 없다" 원칙과 정면으로 충돌한다. 배정과 착수는 사람이 한다 |
| Witness·Deacon의 자동 nudge·재시작 | 같은 이유다. EQMUX는 감지해서 **보여 주고**, 재개는 제안한다(5장 4번) |
| Refinery 자동 머지 | push·머지는 역할 권한(commit·push)과 사람의 판단이다. 검증 게이트 아이디어만 5장 5번으로 가져온다 |
| Dolt DB를 원본으로 | `.eqmux/` 텍스트 파일이 원본이라는 원칙과 맞지 않고, DB 서버(포트 3307)를 하나 더 띄워야 한다 |
| Mayor형 AI 조정자 | 리드 직무가 메시지로 조정할 수는 있지만, 배정을 AI에게 넘기지 않는다 |
| 고정 배역과 은유 어휘(Polecat·Deacon…) | 한국어 우선 제품에서 학습 비용만 늘린다. EQMUX는 직무·직함처럼 평이한 말을 쓴다 |
| Wasteland 연합 · 클라우드 | 외부 네트워크로 작업을 주고받는다. Windows 로컬 팀 관제라는 범위 밖이다 |
| 20~30명 규모 · 11종 에이전트 · yolo 프리셋 | 비용과 권한 원칙 모두에 맞지 않는다. Claude Code · Codex의 깊이가 먼저다 |
| tmux · WSL 전제 | EQMUX는 ConPTY + Job Object 네이티브다 |

## 7. 위협과 대응

- **Gas Town 자체의 위협은 작아지고 있다.** 릴리즈가 6월에, 커밋이 7월에 멈췄고, 만든 사람이 직접 손을 뗐다(2차 자료). 위협은 이름이 바뀌어 남는다. **Gas City**가 "역할과 조직을 직접 짜는 SDK"를 내세운다. EQMUX의 직무·페르소나·직함과 같은 영역이다. 다만 SDK라 코드를 짜야 한다. EQMUX는 화면에서 고르는 쪽으로 차별한다.
- **Beads가 사실상 표준이 될 수 있다.** 별 27.9k, Windows 지원, 에이전트용 스킬까지 있다. 사용자의 저장소에 이미 `.beads/`가 있으면 EQMUX 임무는 두 번째 작업 목록이 된다. 대응은 0.7 이후 검토로 남긴다: `.beads/issues.jsonl`(내보내기 파일)을 읽기 전용으로 임무 목록에 보이는 정도. 쓰기와 동기화는 하지 않는다.
- **"자동 공장"과 비교당한다.** 사람이 다 누르는 EQMUX는 느려 보일 수 있다. 반대로 Gas Town은 시간당 100달러, 계정 소진, 창작자 본인의 포기라는 이야기를 남겼다. "사람이 관제하는 4~8명 팀, 권한을 지키고 비용이 보인다"를 그대로 내세운다. Orca 문서 3번(사용량·한도 창)이 이 메시지를 받쳐 준다.
- **Windows는 여전히 EQMUX 편이다.** Gas Town은 Windows 네이티브를 "CLI 최소"라고 스스로 적었다. Orca·herdr와 달리 이 축에서는 격차가 남아 있다.

## 8. 0.5 기획서에 반영할 것

1. P1 "목 데이터 누수 — 임무 생성·배정 이벤트는 Rust에서 기록"에 **임무 상태 변경**을 포함한다(5장 1번).
2. 임무 상태 칩이 `done`에서 한 번 더 누르면 `todo`로 돌아간다(`missions.ts:59-69`의 순환). 실수로 닫힌 임무가 다시 열린다. P1 "설정 컨트롤 — 순환 버튼을 세그먼트·드롭다운으로" 원칙을 임무 상태 칩에도 적용한다.
3. P2 "임무 산출물 체크리스트"를 체크박스 저장 + `in-review` 진입 시 미체크 수 표시로 정의한다(5장 5번).
4. 0.6 범위에 완료 제안 게이트 · `blocked_by` · 무진행 경고 · `escalate` 심각도 · 대화 임무 필터를 올린다.

## 출처

- https://github.com/gastownhall/gastown (README) · /releases · /commits/main (2026-10-14 조회)
- https://github.com/gastownhall/beads (README, 2026-10-14 조회)
- https://codex.danielvaughan.com/2026/04/08/gas-town-multi-agent-factory/ (2026-01 공개, GUPP 인용, 비용 수치 — 2차 자료)
- https://vanja.io/yegge-agent-city-four-claims/ (Yegge 8월 에세이 인용, "burned down" — 2차 자료, 원문 미확인)
- https://gascity.com/about/ · https://raw.githubusercontent.com/gastownhall/gascity/HEAD/README.md (Gas City)
- https://every.to/context-window/inside-the-100-agent-software-factory (Gas City 리뷰)
- EQMUX 코드: `src-tauri/src/missions.rs` · `roles.rs` · `messages.rs` · `lib.rs` · `src/backend/missions.ts` · `src/screens/Missions.tsx` · `docs/implementation-status.md` · `docs/archive/unimplemented-features-2026-10-14.md`
