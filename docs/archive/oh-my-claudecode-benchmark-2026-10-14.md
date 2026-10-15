# oh-my-claudecode 벤치마킹 — 2026-10-14

대상: https://github.com/Yeachan-Heo/oh-my-claudecode (README · releases · docs의 ARCHITECTURE · REFERENCE · TEAM-WORKTREE-MODE · CJK-IME-KNOWN-ISSUES · `skills/team/SKILL.md` · `src/team/*.ts` 일부)
기준: EQMUX `sub_main` 0.4.2 + `docs/update-plan-0.5.0.md`
같이 볼 문서: `docs/orca-benchmark-2026-10-14.md`, `docs/herdr-benchmark-2026-10-14.md`

## 1. 지금의 oh-my-claudecode (이하 omc)

| 항목 | 내용 |
|---|---|
| 한 줄 | "Teams-first Multi-agent orchestration for Claude Code". 앱이 아니라 **Claude Code 플러그인**이다 |
| 버전 | v5.7.3 (10-14). 릴리스 페이지에 연도 표기가 없어 목록 순서로 판단했다 |
| 출시 속도 | 09-06 ~ 10-14 사이 10회, 10월에만 5회. 마이너 하나에 PR 59~78건이 들어간다(v5.6.0 · v5.7.0). 커밋 5,530 |
| 규모 | GitHub 별 3.99만, 포크 3.6k, 열린 이슈 3 · PR 6 |
| 라이선스·수익 | MIT, 무료. 수익원은 GitHub Sponsors(우선 지원, 로드맵 영향)뿐이다. 유료 등급·회사·투자 정보는 찾지 못했다 |
| 설치 | `/plugin install oh-my-claudecode` 또는 `npm i -g oh-my-claude-sisyphus` → `/omc-setup`. 별도 앱이 없다 |
| 형태 | Claude Code 훅 21~22개 + 스킬 + 에이전트 정의 19개 + `omc` CLI. 다른 엔진 워커는 tmux 페인으로 띄운다 |
| 플랫폼 | macOS · Linux 중심. **네이티브 Windows는 "experimental"**이고 psmux(tmux 호환 바이너리)가 필요하다. WSL2를 권장한다 |
| 지원 엔진 | 리더는 Claude Code. 워커는 claude · codex · gemini · antigravity · grok · cursor |

### README 구성

모드를 앞세운다: Team(권장) → `omc team`(tmux CLI 워커) → `/ask codex`·`/ask antigravity` 자문 → Autopilot · Execute · Verify · `/ralph` 루프. 그 뒤에 매직 키워드(`ralph`, `autopilot`, `ultrathink`, `cancelomc` 등), 스킬 관리(`/skillify`), HUD 상태줄, 외부 알림(Telegram · Discord · Slack · webhook)을 둔다. 비교표와 후기는 없다.

## 2. 핵심 기능 상세

### 팀 = 단계 파이프라인

- `/team 3:executor "..."`로 시작한다. 단계는 `team-plan → team-prd → team-exec → team-verify → team-fix(루프)`다. fix 루프는 `max_fix_loops` 기본 3회, 넘으면 `failed`로 끝난다.
- Claude Code의 실험 기능 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`에 기댄다. Claude Code 2.1.178+에서 `TeamCreate`가 빠져 암묵적 팀을 쓴다. 즉 팀의 바탕은 **Claude Code 자체 기능**이다.
- 팀 크기는 1~20명(`MAX_WORKER_COUNT` 20).
- 리더는 작업을 쪼개 담당을 미리 정하고, 막힌 것을 풀고, 재배정하고, 종료시킨다. 워커는 자기 작업을 `in_progress`로 잡고 끝나면 `completed`로 바꾼다. 워커는 서브에이전트·팀·루프 스킬을 쓸 수 없다.

### 에이전트끼리 주고받는 데이터

| 층 | 형식 |
|---|---|
| 팀원 → 리더 메시지 | `{"type":"message","recipient":"team-lead","content":"...","summary":"..."}`. `broadcast`는 긴급할 때만 |
| 작업 파일 | `.omc/state/team/<team>/tasks/<id>.json` — `subject`·`description`·`owner`·`status`(`pending`/`in_progress`/`completed`/`failed`)·`blocks`·`blockedBy`, 잡을 때 `claimedBy`·`claimedAt`·`claimPid` |
| CLI 워커 인박스·아웃박스 | `teams/<team>/inbox/<worker>.jsonl`(리더 → 워커, `message`·`context`), `outbox/<worker>.jsonl`(워커 → 리더). 바이트 오프셋 커서, 크기를 넘으면 절반만 남기고 회전 |
| 아웃박스 타입 9종 | `ready` · `task_complete` · `task_failed` · `idle` · `heartbeat` · `error` · `shutdown_ack` · `drain_ack` · `all_tasks_complete`. `taskId`·`summary`·`error` 필드 |
| 하트비트 | `pid`·`lastPollAt`·`currentTaskId`·`consecutiveErrors`·`status`(`ready`/`polling`/`executing`/`shutdown`/`quarantined`) |
| 큰 본문 | 작으면 인라인, 크면 `.omc/state/interop/artifacts/**`에 두고 기술자(`kind`·`path`·`contentHash`·`producer`·`sizeBytes`·`retention`)와 요약만 보낸다 |
| 단계 인계 | `.omc/handoffs/<단계>.md` — `Decided`·`Rejected`·`Risks`·`Files`·`Remaining` 다섯 칸, 10~20줄. 취소해도 남는다 |
| 종료 | `shutdown_request` → `shutdown_response`(`request_id`·`approve`). 팀원당 15초 대기. 지어낸 `request_id`는 실패한다 |

감시 규칙이 문서에 숫자로 있다: 메시지 없이 5분이면 상태 확인, 10분이면 재배정, 2번 실패한 워커에는 새 작업을 주지 않는다.

### 역할 분담

- 에이전트 19종을 4개 줄로 나눈다. 빌드·분석(explore · analyst · planner · architect · debugger · executor · verifier · tracer), 리뷰(security-reviewer · code-reviewer), 도메인(test-engineer · designer · writer · qa-tester · scientist · git-master · document-specialist · code-simplifier), 조정(critic).
- 모델 티어를 역할에 붙인다: haiku(explore · writer), sonnet(대부분), opus(planner · critic · analyst). v5.6.2에서 역할별 `reasoningEffort`를 더했다.
- `role-router.ts`가 **작업 문장을 정규식으로 읽어** 역할을 고른다(빌드 수정 → build-fixer, 문서 → writer 등). 사람이 정하는 것이 아니다.
- 페르소나·이름·말투 개념은 없다. 역할은 기능 이름이다.

### 권한

`model-contract.ts`가 모든 CLI 워커에 우회 플래그를 **고정으로** 붙인다. 설정으로 끌 수 없다.

| 엔진 | 붙는 플래그 |
|---|---|
| claude | `--dangerously-skip-permissions` |
| codex | `--dangerously-bypass-approvals-and-sandbox` |
| gemini | `--approval-mode yolo` |
| grok · cursor | `--always-approve` · `--force --trust` |

대신 PreToolUse 훅이 파괴적 git 명령을 막고(무인 모드에서만 기본 켬), `disableExternalLLM`으로 비 Claude 엔진을 막을 수 있다.

### 자동 지속과 훅

- `persistent-mode` Stop 훅이 ralph · autopilot · team이 켜져 있으면 **Claude가 멈추지 못하게** 한다. 검증될 때까지 계속 돈다.
- `keyword-detector`가 프롬프트의 매직 키워드로 스킬을 켠다. `pre-compact`가 압축 전에 모드·TODO·계획을 체크포인트하고 SessionStart에서 되살린다.
- 검증 규칙: "증거는 5분 이내의 실제 명령 출력이어야 한다". BUILD · TEST · LINT · FUNCTIONALITY · ARCHITECT 항목.

### 상태와 Windows

- 상태는 `.omc/`에 둔다. **커밋 대상은 `.omc/skills/`뿐**이고 나머지는 런타임 데이터다. `OMC_STATE_DIR`로 밖으로 옮길 수 있다.
- Windows 훅은 Node(`.mjs`), macOS·Linux는 Bash다. v5.7.1이 Windows `.cmd` 심 문제를 고치는 등 Windows 수정이 계속 나온다.
- `docs/CJK-IME-KNOWN-ISSUES.md`가 **한국어 IME 문제를 공식으로 인정**한다. 조합 중 글자가 안 보이고, Windows에서 조합 위치가 틀린다. 원인은 터미널 raw mode와 React Ink이고, 권장 우회책은 "외부 에디터에서 쓰고 붙여 넣기"다.

## 3. 포지셔닝 차이

| | omc | EQMUX |
|---|---|---|
| 정체성 | Claude Code 안에 얹는 플러그인. 새 앱이 없다 | Claude Code·Codex를 띄우는 매니저 앱 |
| 팀 단위 | 작업 1건 = 팀 1개(최대 20명), 끝나면 해산 | 저장소 1개 = 상주 팀 1개(슬롯 4~8), 역할·페르소나 |
| 누가 나누나 | 리더 에이전트 + 정규식 역할 라우터 | 사람이 직무·직함·임무를 정한다 |
| 통신 | 작업 파일 + JSONL 인박스·아웃박스 + 하트비트. 기계가 읽는 상태 신호 중심 | 타입 5종(`ask`·`handoff`·`report`·`review`·`escalate`) 메시지를 원장에 남기고 턴 경계에 전달. 사람이 읽는 글 중심 |
| 권한 | 워커는 우회 플래그 고정 | 역할 파일이 정하고, 우회는 어떤 경로로도 만들지 않는다(`agent.rs` 테스트가 막음) |
| 실행 | 멈추지 않게 붙잡는 루프(ralph · autopilot) | 자동 실행 없음. 상태를 바꾸는 것은 사람의 버튼 |
| 원본 | `.omc/` 대부분이 휘발성 | `.eqmux/` 파일이 원본, DB는 캐시 |
| 화면 | 터미널 + HUD 상태줄 | GUI 관제 그리드 |

omc는 "에이전트가 에이전트를 부려 **사람 없이 끝내는**" 쪽이고, EQMUX는 "사람이 팀을 **보며 지휘하는**" 쪽이다. 겹치는 곳은 역할 분담과 메시지 버스이고, 여기서 omc는 **기계가 읽는 프로토콜**(작업 상태·결과 신호·인계 형식·감시 숫자)이 EQMUX보다 촘촘하다. EQMUX는 **사람이 읽는 조직**(페르소나·직함·원장·그리드)과 권한에서 앞선다.

## 4. 영역별 비교

○ 있음 · △ 일부 · × 없음

| 영역 | omc | EQMUX | 차이 |
|---|---|---|---|
| 설치 마찰 | ○ (플러그인 한 줄) | △ (앱 설치, 서명 없음) | omc 우위 |
| 역할 카탈로그 | ○ (19종 + 모델 티어) | ○ (직무 8종 + 페르소나, 0.5 직함) | 방향이 다르다 |
| 페르소나·말투·이름 호출 | × | ○ (`@이름`, 말투 리마인더) | **EQMUX만** |
| 메시지 타입 | △ (`message` 하나 + 기계 신호 9종) | ○ (타입 5종, 원장) | 사람용은 EQMUX, 기계용은 omc |
| 결과 신호(`task_complete`·`taskId`) | ○ | × (`report`는 자유 글) | 가져올 것 |
| 작업 의존성(`blockedBy`)·잡기(claim) | ○ | × (임무에 `assigned`·상태 4종만) | 일부 가져올 것 |
| 인계 문서 형식 | ○ (5칸, 10~20줄) | × (형식 없음) | 가져올 것 |
| 큰 본문 → 파일 기술자 | ○ | △ (0.5 결정 8: 800자 넘으면 파일로 보내라고 안내) | 보강할 것 |
| 무응답 감시 | ○ (5분·10분·2회 실패) | × | 표시만 가져올 것 |
| 종료 인사(`shutdown_request`) | ○ | × (Job Object 정리, BR-08 확인창) | 가져올 것(작게) |
| 검증 증거 규칙 | ○ (5분 이내 명령 출력) | 확인 필요 (QA 직무 문구) | 가져올 것 |
| 원장·대화 기록 | △ (아웃박스 회전으로 지워짐) | ○ (`session.db` 원장, 대화 탭) | **EQMUX 우위** |
| 권한 유지 | × (우회 고정) | ○ | **EQMUX 우위.** 가장 큰 차이 |
| 사람 승인 지점 | △ (graph 승인 게이트, 원격 승인 v5.3.0) | △ (`escalate`, 게이트는 0.6) | 비슷 |
| 관제 화면 | △ (HUD 한 줄, `omc team status`) | ○ (워크스페이스×세션 그리드) | **EQMUX 우위** |
| 혼성 엔진 팀 | ○ (6종, 일회성 워커) | ○ (Claude·Codex, 상주 팀원끼리 대화) | 폭은 omc, 깊이는 EQMUX |
| 한글 IME | × (공식 알려진 문제) | ○ (GUI 터미널이 조합을 맡음, 실기 비교는 확인 필요) | **EQMUX 우위** |
| Windows | △ (experimental, psmux) | ○ (ConPTY 네이티브 전용) | **EQMUX 우위** |
| 압축 전 체크포인트 | ○ (`pre-compact`) | × | 나중 |
| 외부 알림(Telegram·Slack) | ○ | × (OS 알림만) | 가져오지 않음 |
| 자동 지속 루프 | ○ | × | 가져오지 않음 |

## 5. 가져올 것 — 우선순위

EQMUX 원칙(자동 실행 없음, API 키 없음, `.eqmux/` 파일이 원본)과 맞는 것만 골랐다. omc의 기계용 프로토콜을 **사람이 보는 표시**로 바꿔 넣는 것이 공통 방침이다.

| 순위 | 기능 | omc에서 | EQMUX에 넣는 방식 | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **인계 문서 형식** | `.omc/handoffs/<단계>.md`, 결정·기각·위험·파일·남은 일 5칸, 10~20줄 | `handoff` 타입을 보낼 때 이 5칸을 쓰라는 규칙을 역할 파일(`roles.rs` 합성)에 넣는다. 안내문 360자 예산은 건드리지 않는다. 결정 8의 "긴 내용은 파일에"가 무엇을 쓸지까지 정해진다 | 작음 | 0.5 통신 간소화 |
| 2 | **파일 첨부 메시지** | 큰 본문은 기술자(경로·생산자·크기·해시) + 요약 | `eqmux send --file <경로> "요약"`. 원장에 경로와 크기를 남기고 대화 탭에서 열 수 있게 한다. 800자 오류 문구가 이 옵션을 안내한다. 경로는 저장소 안으로 제한한다 | 작음 | 0.5 (결정 8 보강) |
| 3 | **구조화된 `report`** | `task_complete`/`task_failed` + `taskId` + `summary` | `eqmux report --mission <id> --result done\|failed "한 줄"`. 임무 카드에 "완료 보고됨 · 검토로 옮기기" 칩만 띄우고, 상태는 사람이 누른다(`missions.ts`의 `mission_set_status` 재사용) | 중간 | 0.6 (메시지 버스 F1~F8 첫 조각) |
| 4 | **무응답 표시** | 5분 무메시지 → 확인, 10분 → 재배정 | 재배정은 하지 않는다. 임무가 `in-progress`인 세션이 N분 동안 메시지·턴 종료가 없으면 대시보드 주의 카드에 "12분째 소식 없음"을 올린다. 기준값은 설정에 둔다 | 작음 | 0.6 |
| 5 | **검증 증거 규칙** | "5분 이내의 실제 명령 출력" | QA·릴리즈 직무 템플릿의 책임에 "완료 보고에는 실행한 명령과 출력 끝 몇 줄을 붙인다"를 넣는다. 코드 변경이 없다 | 작음 | 0.5.x |
| 6 | **중지 전 인계 요청** | `shutdown_request` → `shutdown_response` | BR-08 확인창에 "인계 요청 후 중지" 선택을 둔다. `[EQ] 곧 중지 — 하던 일을 handoff로 남겨라` 한 줄을 보내고, `handoff`가 오거나 사람이 다시 누르면 중지한다. 자동 강제 종료 타이머는 두지 않는다 | 작음 | 0.6 |
| 7 | **임무 의존성** | 작업 파일 `blocks`·`blockedBy` | 임무 frontmatter에 선택 필드 `blockedBy`를 둔다. 값이 있을 때만 쓴다(직함과 같은 규칙). 앞 임무가 `done`이 아니면 카드에 "대기: <임무>"를 보인다 | 중간 | 0.6 |
| 8 | **한국어 IME 비교 자료** | 공식 문서가 한국어 IME 문제를 인정하고 "외부 에디터에서 붙여 넣기"를 권한다 | EQMUX 세션에서 같은 증상(조합 중 글자 숨김, 위치 틀림)이 재현되지 않는지 실기로 확인한 뒤, `docs/site` 비교표에 omc 열과 함께 쓴다 | 작음 | 0.5 문서 정합화 때 |

## 6. 가져오지 않을 것

| 기능 | 이유 |
|---|---|
| 워커 권한 우회 고정 | 역할 파일이 권한을 정한다는 원칙과 정면으로 충돌한다. `agent.rs`가 우회 플래그를 만들지 않는다는 테스트까지 갖고 있다. "권한을 지키는 혼성 팀"은 omc 대비 가장 분명한 차별점이다 |
| `persistent-mode`·ralph·autopilot 루프 | Stop을 막아 계속 돌리는 것은 자동 실행이다. "자동 실행 경로는 없다" 원칙과 맞지 않는다 |
| 매직 키워드로 스킬 자동 발동 | 프롬프트의 단어가 숨은 동작을 켠다. 사람이 무슨 일이 일어났는지 알기 어렵다. EQMUX는 명시적 명령(`eqmux send`·`report`)만 둔다 |
| 정규식 역할 라우터 | 결정 6(직무 8종 고정, 세분화는 직함)과 맞지 않는다. 담당은 사람이 직무·직함으로 정한다. 직함 수신자 지정도 이미 0.6 이후로 미뤘다 |
| 역할별 모델 티어·19종 카탈로그 | 앱이 모델을 고르면 비용 책임이 앱으로 온다. 모델은 사용자의 엔진 설정에 맡긴다 |
| 20명 일회성 팀 | 관제 그리드는 슬롯 8개를 사람이 보는 것을 전제로 한다. 사람이 못 보는 팀은 EQMUX가 풀려는 문제가 아니다 |
| Telegram·Discord·Slack 알림 | 앱이 토큰을 들게 된다. "키를 보유하지 않는다" 원칙이 깨진다 |
| tmux·psmux 의존 | EQMUX는 ConPTY로 직접 페인을 만든다. 중간층을 둘 이유가 없다 |
| 상태 대부분을 휘발성으로 | EQMUX는 `.eqmux/`를 원본으로 커밋하고 원장을 남긴다. omc처럼 아웃박스를 회전해 지우지 않는다 |

## 7. 위협과 대응

- **Claude Code 자체가 팀을 갖기 시작했다.** omc의 팀은 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 위에 있다. 리더·팀원·작업 목록·메시지가 Claude Code 기능으로 들어오면, Claude만 쓰는 사용자에게 EQMUX 메시지 버스의 가치는 줄어든다. 남는 축은 **Claude·Codex 혼성 팀을 같은 권한 규칙으로**, **사람이 보는 그리드**, **원장**이다. 혼성 팀 QA 미해결 건을 먼저 닫는 것이 대응이다.
- **설치 마찰 0.** omc는 플러그인 한 줄이고 별이 4만이다. EQMUX는 서명 없는 앱 설치다. 0.6 코드 서명·자동 업데이트를 늦추면 비교 자체에서 밀린다.
- **EQMUX 세션 안의 omc.** 사용자가 EQMUX 역할 세션에 omc를 설치하고 `/team`이나 `omc team`을 쓰면, EQMUX가 모르는 워커가 우회 플래그로 뜬다. psmux가 있으면 EQMUX 밖에 페인이 생긴다. 실제로 어떻게 동작하는지는 확인 필요다. 확인 뒤 `docs/site`에 "omc와 같이 쓸 때" 주의를 쓰고, 역할 세션에서는 권장하지 않는다고 밝힌다.
- **속도.** 5주에 10회, 마이너당 PR 60~80건이다. 기능 수로는 따라갈 수 없다. Orca·herdr 문서의 결론과 같다. 팀 관제 축(직함, 세션 이름, 통신 간소화, 게이트)을 깊게 판다.
- **한국어는 그대로 기회다.** omc도 herdr도 한국어 IME를 문서화된 약점으로 갖고 있다. 실기 확인 후 한국 사용자 대상 자료의 첫 줄로 쓸 수 있다.

## 8. 0.5 기획서에 반영할 것

1. 통신 간소화에 인계 문서 5칸 규칙을 넣는다 — 역할 파일에 두고 안내문 360자 예산은 그대로 둔다(5장 1번).
2. 결정 8에 `eqmux send --file`을 더해, 800자 오류가 갈 곳을 준다(5장 2번).
3. 문서 정합화(P1) 비교표에 omc 열을 넣는다. 권한 우회 고정과 한국어 IME를 근거로 든다. EQMUX 세션 안에서 omc를 쓸 때의 동작은 먼저 실기로 확인한다.
4. 0.6 범위에 구조화된 `report` · 무응답 표시 · 중지 전 인계 요청 · 임무 `blockedBy`를 올린다. 모두 "표시만 하고 사람이 누른다"로 설계한다.

## 출처

- https://github.com/Yeachan-Heo/oh-my-claudecode (README, 별·포크·커밋 수) · /releases (2026-10-14 조회)
- docs: `ARCHITECTURE.md` · `REFERENCE.md` · `TEAM-WORKTREE-MODE.md` · `CJK-IME-KNOWN-ISSUES.md` · `business/README.md`
- `skills/team/SKILL.md` · `src/team/inbox-outbox.ts` · `src/team/types.ts` · `src/team/model-contract.ts` · `src/team/role-router.ts`
- EQMUX 확인: `src-tauri/src/messages.rs`(타입 5종, 본문 2,000자, 분당 10건) · `src-tauri/src/agent.rs`(우회 금지 테스트, 훅 매핑) · `src/backend/missions.ts`·`src/types.ts`(임무 상태 4종)
