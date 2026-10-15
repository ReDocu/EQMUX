# Agent Relay 벤치마킹 — 2026-10-14

대상: https://github.com/AgentWorkforce/relay (README · releases · `crates/broker` 소스 · `plugins/codex-relay-skill` · `.claude/skills/using-agent-relay`) + https://agentrelay.com (랜딩 · docs의 architecture · delivery · sending-messages · agent-relay-mcp · cli-agent-management · harnesses · relaycast-api · self-hosting)
기준: EQMUX `sub_main` 0.4.2 + `docs/update-plan-0.5.0.md`(§통신 간소화 · §프로젝트 간 통신 · 결정 8 · 결정 10)
같이 볼 문서: `docs/herdr-benchmark-2026-10-14.md`, `docs/orca-benchmark-2026-10-14.md`

## 1. 지금의 Agent Relay

| 항목 | 내용 |
|---|---|
| 한 줄 | "Turn coding agents into a working team." 스스로를 "the messaging layer for AI agents", "not a harness, and it's not a framework"라고 정의한다 |
| 버전 | v14.0.0 (2026-10-13) |
| 출시 속도 | 10-08 · 10-10 · 10-11 · 10-12 · 10-13, 6일에 5번 냈다. 저장소는 2025-12-17에 생겼고 커밋이 5,187개다 |
| 규모 | GitHub 별 883, 포크 73, 열린 이슈 244 |
| 회사 | Agent Workforce Inc. 랜딩에 Y Combinator · Hustle Fund · Active Capital 등 투자사 로고가 있다. 고객 후기는 없다 |
| 라이선스·수익 | Apache-2.0. "Agent Relay Cloud"를 기본 시작점으로 권한다. 가격표는 없고 "generous free tier"라고만 한다. 호스팅 대시보드 · 클라우드 샌드박스 · 공유 세션은 클라우드 계정이 있어야 한다 |
| 형태 | Rust 브로커(`crates/broker`, `crates/relay-pty`) + npm CLI·SDK(`agent-relay`) + 메시징 엔진 Relaycast(Node + SQLite 단일 프로세스, 자체 호스팅 가능) + Swift 앱 프로바이더 |
| 플랫폼 | 독립 CLI 바이너리는 Linux·macOS만 있다. Windows는 릴리스마다 브로커 바이너리(`agent-relay-broker-win32-x64.exe`)만 올라온다. 설치 안내는 `curl … | bash`와 `npm install -g`다. Windows 지원 수준은 문서에 없다(확인 필요) |
| 지원 에이전트 | 하네스 9종: claude · codex · gemini · opencode · cursor · droid · aider · goose · grok |
| 텔레메트리 | 기본으로 켜져 있고 끌 수 있다. 해시한 머신 ID를 모든 이벤트에 붙인다. 메시지 내용은 모으지 않는다고 적었다 |

### 랜딩 구성

기능 7개를 보인다: 메시징(채널 · 스레드 · 리액션 · DM · @멘션) → 검색 가능한 이력 → 영속 워크플로(Flows) → 공유 파일(Relayfile, GitHub·Slack·Linear를 가상 파일시스템으로) → 실시간 이벤트(WebSocket) → 타입 있는 액션(Zod 스키마, MCP·CLI로 노출) → A2A 지원. 경쟁 제품과의 비교표는 없다.

## 2. 핵심 기능 상세

### 구조

- **엔진이 유일한 허브다.** 문서가 "The engine is the only hub; there is no local one"이라고 적는다. 기본 엔진은 `cast.agentrelay.com`이고, 자체 호스팅하면 Relaycast를 직접 띄운다.
- **노드**는 워크스페이스에 등록된 실행 맥락(대개 프로젝트 폴더 하나)이다. 노드에 붙은 **에이전트 런타임**(Rust)이 에이전트 PTY를 띄우고 소유하며, 메시지를 PTY에 주입한다. 에이전트는 자기를 띄운 노드에 묶인다.
- 실시간 전달은 노드 채널 `/v1/node/ws` 하나뿐이다. 워크스페이스 스트림 `/v1/ws`는 관찰 전용이고 "never a delivery path"다.
- 신원은 토큰 다섯 종류다: 워크스페이스 키(`rk_live_*`) · 에이전트 토큰(`at_live_*`) · 노드 토큰 · 관찰자 토큰 · 웹훅 토큰. 11.3.0 이하는 `node up`·`node status`가 워크스페이스 키를 화면에 찍는 문제가 있었다고 문서가 경고한다.
- 띄우기: `agent-relay node agent spawn codex --name reviewer --channels reviews --task "…"`. 이름을 안 주면 하네스 이름이 된다. 채널은 기본 `general`이다.

### 메시지 버스 설계 비교

| 결정 | Agent Relay | EQMUX |
|---|---|---|
| 전송 | 노드 ↔ 엔진 WebSocket. 엔진은 기본이 클라우드 | CLI → 앱은 Named Pipe `\\.\pipe\eqmux-bus-<사용자>`(`ipc.rs:14-20`), 앱 안에서는 Tauri 이벤트 `message-new`. 로컬 전용 |
| 주소 | `#채널`, `@핸들`(DM), `@핸들` 배열(그룹 DM), `messageId`로 스레드 답장 | `@이름`(team.json 로스터 · 세션 이름 · 페르소나), `@all`(워크스페이스 안 전원). 채널·스레드 없음(`ipc.rs:249-264`) |
| 보내는 길 | MCP 도구 30개 이상(`send_dm`, `post_message`, `reply_to_thread` …) · CLI · SDK · REST | `eqmux send --type … [--to @이름] "내용"` CLI 하나와 대화 탭(`cli.rs:3`) |
| 받는 길 | 브로커가 PTY에 주입. MCP 호스트가 스트리밍을 지원하면 알림으로도 밀어 준다. `check_inbox`는 "fallback"이다 | 프런트가 PTY에 주입. 기본 터미널은 화면 에코만 한다(`conversation.ts:355-386`) |
| 전달 시점 | 5가지 모드: `immediate`(끼어듦) · `next-message` · `next-tool-call` · `on-idle` · `manual`. 보낼 때 `mode: wait|steer`를 고른다 | 1가지: idle이고 사람이 치고 있지 않으면 즉시, 아니면 인박스에 두었다가 Stop 훅의 idle 전이 때 묶어서 보낸다(`types.ts:199-200`, `conversation.ts:389-398`) |
| 형식 | 자유 텍스트 + 첨부(이미지 · 링크 · 파일 · JSON · diff · 아티팩트) + metadata. 타입이 없다. `ACK:` · `STATUS:` · `BLOCKED:` · `DONE:` 머리는 스킬 문서의 **권고**다 | 타입 5종을 **강제**한다(`messages.rs:11`, `:28-40`). 본문은 평문이고 주입할 때 한 줄로 편다(`conversation.ts:229-234`) |
| 주입 모양 | `Relay message from <이름> in #채널 [<id>]: 본문` + 답장 방법을 적은 `<system-reminder>` 블록 | `[EQ·ask] <발신자>: 본문`, 여러 건은 `[EQ n건] 1) … 2) …` |
| 본문 상한 | OpenAPI의 `text`에 `maxLength`가 없다(앞부분 10만 자 기준, 끝까지 확인 필요) | 2,000자(`messages.rs:12`). 0.5에서 800자(결정 8) |
| 속도 상한 | `rate_limit_exceeded`(분당) · `mailbox_full` · `workspace_delivery_depth_exceeded`가 있다. 수치는 공개하지 않는다 | 발신자당 분당 10건(`messages.rs:13`, `ipc.rs:228-233`) |
| 영속 | 엔진의 메시지·전달 기록이 원본이다("remain the source of truth"). 보존은 `message_ttl_days` 또는 `never_prune`, 이벤트 로그 기본 30일. 전문 검색 API가 있다 | 워크스페이스 `session.db`의 `message` 테이블이 원장이다(`messages.rs:1`). 인박스 대기분은 KV 캐시에 따로 둔다(`conversation.ts:132`) |
| 확인(ack) | 에이전트별 `seq` + 누적 `delivery.ack { agent, up_to_seq }`. 재연결하면 ack 안 된 것부터 다시 보낸다. 영수증 4종: `accepted` · `delivered` · `deferred` · `failed` | 없다. PTY에 쓰고 80ms 뒤 `\r`을 보낸 뒤 확인하지 않는다(`conversation.ts:274-276`). `read`는 사람의 미확인 표시일 뿐이다(`messages.rs:52-53`) |
| 순서·중복 | 에이전트별 순서 보장. `idempotencyKey`, 하네스는 같은 전달 id를 한 번만 처리하라고 한다 | 세션별 주입 큐로 직렬화한다(`conversation.ts:244`). 중복 방지 키는 없다 |
| 발신자 신원 | 에이전트 토큰 | `EQMUX_SESSION` + `EQMUX_TOKEN` 논스(`ipc.rs:140-149`) |
| 답장 지정 | `messageId`로 스레드에 단다 | 메시지 id를 에이전트에 주지 않는다. 발신자 이름으로만 답한다 |

### 주입 확인 — 가장 많이 투자한 곳

`crates/broker/src/broker/delivery_verification.rs`가 본문을 PTY에 쓴 뒤 **화면에 그 본문이 다시 찍히는지(에코)** 5초 동안 본다. 확인되지 않으면 제출 키만 최대 3번 다시 누른다. 본문은 다시 쓰지 않는다. 주석이 이것을 "at-most-once turn creation"이라고 부른다. 같은 본문의 이전 전달과 헷갈리지 않게 출력 시퀀스 경계를 잡는다. 확인 없이 시간 초과로 넘어간 전달은 주입 간격을 줄이는 데 쓰지 않는다. v13.4.0(10-11)의 "PTY turn submission verification"이 이것이다.

EQMUX는 같은 문제를 겪었다. `conversation.ts:241-243` 주석이 "도착은 했는데 턴이 안 도는 자리"를 적고, 고정 지연 80ms와 400ms로 대신했다(`:236-237`).

### 답장 안내 — 리마인더 스로틀

주입할 때 "답은 `send_dm` / `post_message`로 하라"는 `<system-reminder>` 블록을 붙인다(`injection_format.rs`). 첫 전달에는 전체 블록을 붙인다. 그 뒤에는 **5분이 지나고, 그 사이 에이전트가 PTY에 64KB 이상 출력했을 때만** 전체 블록을 다시 붙이고, 아니면 한 줄 힌트만 붙인다. 프롬프트 앞에 가만히 있던 에이전트는 이전 블록이 컨텍스트에 그대로 남아 있으니 반복은 토큰 낭비라는 판단이다.

EQMUX의 말투 리마인더는 5건마다 붙는다(`conversation.ts:212-222`). 같은 목적이지만 Agent Relay는 "에이전트가 얼마나 일했는가"를 기준으로 삼는다.

### Codex: Stop 훅으로 받기

`plugins/codex-relay-skill/hooks/stop-inbox.sh`는 Codex가 턴을 끝내려 할 때 엔진의 `/v1/inbox/check`를 부른다. 안 읽은 메시지가 있으면 `{decision: "block", reason: "You have N unread relay message(s)…"}`를 돌려준다. 최대 20건을 한 줄씩 붙인다. PTY에 타이핑하지 않고 훅 응답으로 메시지를 넘기는 경로다. `stop_hook_active`이면 다시 막지 않아 무한 루프를 피한다.

다만 이 스킬은 처음 켜질 때 `setup.sh`를 자동으로 돌려 `.codex/config.toml`에 MCP 서버를 넣고 훅을 설치한다.

### 그 밖

- **Flows**: TypeScript로 쓰는 다단계 워크플로. 결정적 검사 · 필수 단계 · 사람 게이트 · 단계별 재시도. 예약·이벤트 트리거도 있다.
- **Observer**: 만료되는 읽기 전용 링크로 사람이 워크스페이스를 실시간으로 본다.
- **Relay Connect / arelay.to**: 계정 없는 다른 에이전트를 임시 링크로 들이거나, 공개 핸들로 내 에이전트를 노출한다.
- **Shared Sessions**: 코딩 세션을 모아 검색한다(클라우드 필요).

## 3. 포지셔닝 차이

| | Agent Relay | EQMUX |
|---|---|---|
| 정체성 | 메시징 **인프라**(에이전트용 Slack). 하네스도 앱도 아니다 | 팀 **관제 앱**. 메시지 버스는 그 일부 |
| 허브 | 클라우드 엔진(또는 자체 호스팅 서버) | 내 PC의 앱 하나 |
| 범위 | 여러 머신 · 여러 사람 · 외부 에이전트(A2A) | 한 PC, 열린 프로젝트들 |
| 메시지 | 자유 텍스트 + 첨부, 채널·스레드·리액션 | 타입 5종 강제, 짧은 평문, 사람이 보는 대화 탭 |
| 조직 | 이름과 채널뿐. 역할은 각 에이전트의 프롬프트에 맡긴다 | 역할 파일 · 페르소나 · 직함 · 관제 그리드 |
| 키 | 워크스페이스 키·에이전트 토큰을 사용자가 다룬다 | 앱이 키를 갖지 않는다. 세션 논스만 앱 안에서 돈다 |

Agent Relay는 "에이전트가 서로 말하는 통로"를 가장 넓고 튼튼하게 만든다. 전달 보장(ack · 재전송 · 영수증 · 에코 검증)은 EQMUX보다 한참 앞서 있다. 대신 누가 무엇을 말해야 하는지(역할, 메시지 종류, 길이)는 정하지 않는다. EQMUX는 통로가 단순한 대신 말의 **형식과 조직**을 제품이 쥔다. 겹치는 곳은 PTY 주입과 상태 기반 전달이고, 여기서 배울 것이 많다.

## 4. 영역별 비교

○ 있음 · △ 일부 · × 없음

| 영역 | Agent Relay | EQMUX | 차이 |
|---|---|---|---|
| 상태 기반 전달(바쁠 때 보류) | ○ (`on-idle` 등 5모드) | ○ (idle 즉시, 아니면 인박스) | 비슷. EQMUX는 모드가 하나다 |
| 승인 창 대기 중 주입 금지 | ○ (`on-idle`이 waiting·blocked를 기다림) | ○ 관리 세션(`conversation.ts:380-384`) / △ 손으로 띄운 에이전트(`:314-317`) | herdr 문서 5장 5번은 **관리 세션에서는 확인됨** |
| 주입 후 제출 확인 | ○ (에코 검증, 제출 키 3회) | × (고정 지연) | **가장 큰 격차** |
| 전달 영수증 · ack · 재전송 | ○ | × | 가져올 것(가볍게) |
| 보낸 쪽에 "받는 사람 없음" 알림 | ○ (`failed` + 이유) | △ (`UNKNOWN_RECIPIENT`는 있으나 `@` 든 주소는 통과, BR-01) | 0.5에서 고친다 |
| 메시지 타입 강제 | × (권고 머리만) | ○ (5종) | **EQMUX 우위** |
| 본문 길이 상한 | × (확인한 범위에서 없음) | ○ (2,000 → 800자) | **EQMUX 우위.** 결정 8 근거 |
| 발신 속도 상한 | ○ (수치 비공개) | ○ (분당 10건) | 비슷 |
| 대기분 묶어 한 턴으로 | 확인 필요 | ○ (`[EQ n건]`, 4,000자 덩어리) | EQMUX가 토큰을 아낀다 |
| 답장 안내 리마인더 | ○ (첫 회 전체, 이후 활동량 기준) | △ (말투 리마인더 5건마다) | 기준을 가져올 것 |
| 메시지 id · 스레드 답장 | ○ | × | 나중 |
| 채널 · 그룹 DM · 리액션 | ○ | × (`@all`만) | 가져오지 않음 |
| 첨부(파일 · 스크린샷 · diff) | ○ (v13.3.0) | × (0.5에서 "파일 경로를 보내라") | 경로 첨부만 가져올 것 |
| 이력 검색 | ○ (전문 검색 API) | △ (Markdown 내보내기, 화면 200건) | 나중 |
| 훅으로 메시지 받기 | ○ (Codex Stop 훅) | × (훅은 상태 신호만, `_hook`은 항상 조용히 0 — `cli.rs:297-302`) | 검토할 것 |
| 프로젝트 간 · 머신 간 | ○ (머신 간까지) | × (0.5 결정 10에서 프로젝트 간) | 머신 간은 가져오지 않음 |
| 역할 · 페르소나 · 관제 그리드 | × | ○ | **EQMUX만** |
| 사람이 보는 대화 화면 | △ (Observer 링크, 클라우드 대시보드) | ○ (대화 탭, 로컬) | **EQMUX 우위** |
| 키 없이 동작 | × (워크스페이스 키 · 에이전트 토큰) | ○ | **EQMUX 우위** |
| Windows | △ (브로커 exe만, CLI·설치 스크립트는 Unix) | ○ | **EQMUX 우위** |
| 지원 에이전트 | ○ (9종) | △ (Claude Code · Codex) | 가져오지 않음 |

## 5. 가져올 것 — 우선순위

| 순위 | 기능 | Agent Relay에서 | EQMUX에 넣는 방식 | 비용 | 시기 |
|---|---|---|---|---|---|
| 1 | **보낸 쪽에 전달 상태 돌려주기** | 모든 전달 시도에 영수증(`accepted`/`delivered`/`deferred`/`failed`). "조용히 버퍼에 두지 말고 `deferred`를 써라" | `eqmux send`의 응답을 "전송됨" 하나에서 `전달함` / `대기 — 카이 작업 중` / `실패 — 받는 사람 없음` 셋으로 나눈다. 판단 근거는 이미 `deliver()`(`conversation.ts:355-386`)에 있다. BR-01(`ipc.rs:254-256`)을 고칠 때 같이 한다 | 작음 | 0.5 (프로젝트 간 통신 1과 함께) |
| 2 | **주입 후 에코 확인** | 본문을 쓰고 화면에 찍히는지 5초 확인, 안 되면 제출 키만 최대 3번. 본문은 두 번 쓰지 않는다 | `injectMessages`(`conversation.ts:267-286`)의 80ms 고정 지연 뒤에, 출력 버퍼에서 본문 앞부분이 보이는지 확인하고 `\r`만 재시도한다. 실패면 인박스로 되돌리고 대화 탭에 "전달 실패" 표시. 혼성 팀 QA의 "도착했는데 턴이 안 돈다"를 수치로 잡을 수 있다 | 중간 | 0.6 (0.5.x에서 로그만 먼저) |
| 3 | **리마인더를 활동량 기준으로** | 첫 전달에 전체 안내, 이후 5분 + 출력 64KB가 지났을 때만 다시 | 0.5 안내문 360자 예산에 맞춰, 사용법 한 줄을 매번 싣지 않고 첫 메시지와 "오래 일한 뒤"에만 붙인다. 말투 리마인더(`conversation.ts:212`)도 5건마다 대신 같은 기준으로 바꾼다 | 작음 | 0.5 (§통신 간소화) |
| 4 | **경로 첨부** | 첨부 7종, v13.3.0에서 스크린샷 | 결정 8의 오류 문구를 "파일에 쓰고 `--file <경로>`로 보내라"로 하고, `eqmux send --file`이 저장소 안 경로인지만 확인해 본문 끝에 `(첨부: 경로)`를 붙인다. 내용은 싣지 않는다 | 작음 | 0.5 (결정 8과 함께) |
| 5 | **보고에 증거 붙이기 관례** | `DONE: … Evidence: <files, commands, tests>` | 타입은 이미 강제된다. 역할 파일 템플릿에 "`report`는 근거(파일 · 명령 · 테스트) 한 줄을 붙인다"를 넣는다. 안내문 예산은 쓰지 않는다 | 작음 | 0.5 |
| 6 | **Stop 훅으로 인박스 넘기기** | Codex Stop 훅이 안 읽은 메시지를 `decision: block`으로 넘긴다 | PTY 타이핑 대신 훅 응답으로 넘기면 붙여넣기 · IME · 제출 타이밍 문제가 사라진다. 지금 `_hook`은 출력 없이 끝나므로 파이프에서 인박스를 받아 돌려주도록 바꿔야 한다. Claude Code · Codex 모두에서 `block` 동작과 루프 방지(`stop_hook_active`)를 확인해야 한다(확인 필요) | 중간~큼 | 0.6 검토 |
| 7 | **메시지 id로 답장** | `messageId` + `reply_to_thread` | 주입 머리에 짧은 번호(`[EQ·review #42]`)를 넣고 `eqmux send --re 42`를 받는다. `review` → 수정 → `report`의 연결이 대화 탭에서 보인다. 건당 글자 비용이 늘어 3번과 같이 판단한다 | 중간 | 0.6 |

## 6. 가져오지 않을 것

| 기능 | 이유 |
|---|---|
| 클라우드 허브 · 워크스페이스 키 · 에이전트 토큰 | "앱이 키를 갖지 않는다" 원칙과 충돌한다. EQMUX의 논스는 앱 밖으로 나가지 않는다. Agent Relay도 키가 화면에 찍히는 사고(11.3.0 이하)를 겪었다 |
| 채널 · 그룹 DM · 리액션 | 4~8명 팀에는 `@이름`과 `@all`로 충분하다. 결정 10의 ② 공용 채널을 0.6 이후로 미룬 판단이 그대로 맞다. 채널은 모든 에이전트 컨텍스트에 남의 이야기를 섞는다 |
| `immediate` · `steer` 끼어들기 | waiting 상태에 주입하지 않는다는 규칙(G7, `conversation.ts:4-5`)과 충돌한다. 사람이 Esc로 끊는 것으로 충분하다 |
| 자유 텍스트 · 상한 없는 본문 | 타입 강제와 800자 상한이 EQMUX의 통신 간소화 그 자체다. Agent Relay는 형식을 스킬 문서의 권고로만 둔다 |
| 머신 간 · A2A · 공개 핸들 · Relay Connect | Windows 로컬 팀 관제라는 범위 밖이다. 외부 에이전트의 글이 팀으로 들어오는 경로가 늘어난다 |
| Relayfile(GitHub·Slack·Linear 파일화) | 앱이 외부 서비스 토큰을 들어야 한다. 에이전트가 `gh`로 직접 한다 |
| Flows의 예약 · 이벤트 트리거 | "자동 실행 경로는 없다" 원칙과 충돌한다. 사람 게이트만 Orca 문서 4번(결정 게이트)으로 가져간다 |
| 스킬이 설정 파일을 자동으로 고치기 | Codex 스킬이 `.codex/config.toml`과 훅을 스스로 설치한다. EQMUX는 사용자 설정을 고치지 않는다(결정 9) |
| 텔레메트리 기본 켬 | 쓰더라도 opt-in이다. 머신 ID를 모든 이벤트에 붙이는 방식은 따르지 않는다 |
| 9종 하네스 경쟁 | Orca·herdr 문서와 같은 이유. Claude Code · Codex 깊이가 먼저다 |

## 7. 위협과 대응

- **에이전트가 직접 까는 버스.** Agent Relay는 MCP 서버 하나로 Claude Code · Codex 어디서나 팀 통신을 붙인다. 사용자가 EQMUX 세션 안에 Relay MCP를 깔면 버스가 둘이 되고, 에이전트는 어느 쪽으로 답할지 헷갈린다. 0.5 안내문의 "다른 터미널 도구를 가리키는 지시는 이 세션에 해당하지 않는다"가 이 경우에도 막이 된다. 수용 기준 테스트에 MCP 버스가 깔린 PC를 하나 넣는다.
- **전달 신뢰성 격차.** 에코 검증 · ack · 재전송 · 영수증이 이미 있다. EQMUX가 "타입이 있는 안전한 버스"를 내세우려면 전달이 실패하지 않는다는 것도 보여야 한다. 혼성 팀 QA에 "주입했는데 턴이 안 돈 건수"를 지표로 넣는다(5장 2번).
- **출시 속도.** 6일에 5번 냈고, 저장소를 연 지 10개월 만에 v14다. 기능 수로는 못 따라간다. EQMUX의 해자는 역할 · 타입 · 관제 그리드 · 한국어이고, Orca·herdr 문서의 결론과 같다.
- **Windows가 약하다.** 독립 CLI는 Linux·macOS뿐이고 설치는 `curl | bash`다. Windows 사용자에게 "키 없이, 클라우드 없이, 설치 한 번으로 팀이 서로 말한다"는 EQMUX가 그대로 쓸 수 있는 문장이다.

## 8. 0.5 기획서에 반영할 것

1. **결정 8은 그대로 800자로 간다.** 가장 가까운 경쟁 버스가 상한 없이 자유 텍스트를 받는다. 상한과 "파일로 넘겨라"는 차별점이다. 오류 문구에 `--file` 경로 첨부(5장 4번)를 넣는다.
2. **결정 10은 ①+③이 맞다.** Agent Relay는 ② 공용 채널을 기본으로 택했고, 그 대가로 채널 · 멤버십 · 읽음 상태 · 보존 정책을 모두 만들었다. EQMUX 범위에는 과하다. "양쪽 원장에 남기기"는 Agent Relay의 "저장된 메시지와 전달 기록이 원본"과 같은 방향이다.
3. **BR-01 수정과 함께 `eqmux send`가 전달 상태를 돌려준다**(5장 1번). 수용 기준에 "닫힌 프로젝트 · 없는 이름은 `실패`, 작업 중인 세션은 `대기`로 찍힌다"를 더한다.
4. **§통신 간소화의 리마인더 기준을 바꾼다**(5장 3번) — 첫 메시지와 오래 일한 뒤에만 사용법 한 줄.
5. **herdr 문서 5장 5번은 닫는다.** 관리 세션은 waiting에 주입하지 않는다(`canInject`). 손으로 띄운 에이전트의 구멍(`conversation.ts:314-317`)만 남는다.
6. 0.6 범위에 에코 확인 · Stop 훅 전달 검토 · 메시지 id 답장을 올린다.

## 출처

- https://github.com/AgentWorkforce/relay · /releases · `crates/broker/src/broker/injection_format.rs` · `delivery_verification.rs` · `plugins/codex-relay-skill/{SKILL.md, hooks/stop-inbox.sh}` · `.claude/skills/using-agent-relay/SKILL.md` · `TELEMETRY.md` · `docs/self-hosting/README.md` (2026-10-14 조회)
- https://agentrelay.com/ · /docs/markdown/{architecture, delivery, sending-messages, agent-relay-mcp, cli-agent-management, harnesses, relaycast-api}.md (2026-10-14 조회)
- https://github.com/AgentWorkforce/relaycast/blob/main/openapi.yaml (앞부분 10만 자만 확인)
