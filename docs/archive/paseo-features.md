# Paseo 기능 정리 · EQMUX 벤치마킹

> 출처: https://paseo.sh/ 홈, 문서(`/docs`, `/docs/cli`, `/docs/mcp`, `/docs/worktrees`, `/docs/browser`,
> `/docs/orchestration`, `/docs/plugins`, `/docs/security`, `/docs/workspaces`), `/hub`, `/download`,
> `/alternatives/orca`, `/changelog` (2026-10-14 조사, 최신 버전 0.11.2)
>
> Paseo는 "여러 코딩 에이전트를 어느 머신에서든 동시에 돌리는" 에이전트 개발 환경이다.
> 데몬이 호스트 머신에서 에이전트를 돌리고, 데스크톱·모바일·웹·CLI 클라이언트가 그 데몬에 붙는다.
> Apache-2.0 오픈소스이고, 텔레메트리와 로그인이 없다. 1인 메인테이너가 만들며 투자 없이 후원과 Paseo Hub로 운영한다.
> GitHub 별 약 2.1만 개.

---

## 한눈에 보는 차이

| | Paseo | EQMUX |
|---|---|---|
| 중심 UI | **에이전트 채팅 타임라인** (CLI를 하네스로 감싸 구조화된 이벤트로 보여 준다) | **터미널 페인** (ConPTY + xterm.js, 에이전트 TUI 그대로) |
| 구조 | 데몬(헤드리스 가능) + 클라이언트 여럿 | 단일 데스크톱 앱(Tauri) + 명명 파이프 CLI |
| 단위 | 프로젝트 → 워크스페이스 → 세션(탭) | 워크스페이스(= repo = 팀 = 탭) → 세션 슬롯 4/6/8 |
| 팀 개념 | 없음. 오케스트레이터 에이전트가 서브에이전트를 띄운다 | 있음. 직무·페르소나·임무·타입 메시지 버스 |
| 자동 실행 | 에이전트가 에이전트를 띄우고, 스케줄·하트비트로 주기 실행 | **없음** — 상태를 바꾸는 것은 사람의 버튼 |
| 원격·모바일 | 네이티브 iOS·Android, 웹앱, E2E 암호화 릴레이 | 없음(로컬 Windows 전용) |
| 플랫폼 | macOS·Windows(x64/ARM64)·Linux·iOS·Android·웹·npm·Nix·Docker | Windows |
| 에이전트 | Claude Code·Codex·OpenCode·Pi·OMP·Antigravity·Muse Code 네이티브 + ACP로 30여 종 | Claude Code·Codex |
| 확장 | 플러그인(패널·사이드바·슬래시 명령·테마·프로바이더), MCP 서버, TS SDK | CLI(`eqmux send·report·browser·ping`) |
| 릴리스 | 9/22~10/9 사이 10회, 거의 이틀에 한 번 | — |

---

## 🧱 아키텍처

- **데몬** — 호스트 머신에서 에이전트를 소유한다. 데스크톱 앱은 데몬을 내장하고 자동으로 띄운다.
  `npm i -g @getpaseo/cli` 후 `paseo`로 헤드리스 실행도 되고, Docker 이미지(`ghcr.io/getpaseo/paseo`, 포트 6767)도 있다.
- **클라이언트** — 데스크톱 앱, 네이티브 모바일 앱(WebView가 아니며 데스크톱과 기능 동일하다고 주장), 웹 UI(`app.paseo.sh` 또는 데몬이 직접 서빙), CLI.
- **설정 위치** — `PASEO_HOME`(기본 `~/.paseo`)의 `config.json`.
- **전제 조건** — 프로바이더 CLI(Claude Code 등) 1개 이상, 인증된 `gh` CLI(PR 연동 워크트리용).
- **원칙** — 자체 에이전트가 없다. 각 프로바이더가 공식 지원하는 연동만 쓴다. 토큰을 빼내거나 추론 API를 직접 부르지 않는다.

## 🔌 연결과 보안

- **릴레이(모바일 권장)** — 데몬이 릴레이로 *아웃바운드* 연결을 맺는다. 포트 개방이나 VPN이 필요 없다. 새 설치에서는 꺼져 있다.
  - E2E 암호화: 데몬의 영구 ECDH 키쌍 + Curve25519 페어링 + NaCl `box`(XSalsa20-Poly1305).
  - 핸드셰이크 전에는 모든 명령을 거부한다. 릴레이는 IP·타이밍·크기만 보고, 내용 열람·위조·키 유도는 못 한다("신뢰하지 않는 것을 전제로 설계").
  - 페어링 QR/링크에 데몬 공개키가 들어 있고, 이것이 신뢰의 기준점이다("비밀번호처럼 다뤄라"). 새 호스트로 붙기 전에 확인창을 띄운다(0.10.3).
- **직접 연결** — 기본 바인드는 `127.0.0.1:6767`. Unix 소켓 / Windows 파이프(CLI 전용), Tailscale 같은 VPN, LAN.
- **DNS 리바인딩 방어** — CORS만 믿지 않고 `Host` 헤더를 허용 목록(`daemon.hostnames`)으로 검증한다.
- **비밀번호** — 네트워크 바인드에서는 필수. bcrypt 해시, HTTP는 Bearer, WebSocket은 서브프로토콜로 인증. `/api/health`만 예외.
  접근 제어일 뿐 암호화는 아니므로 릴레이나 VPN과 함께 쓰라고 안내한다.
- **자격 증명** — 프로바이더 인증은 각 CLI가 관리한다. Paseo는 API 키를 저장하거나 전송하지 않는다.

## 🗂️ 워크스페이스 · 워크트리

- **모델** — "채팅이 아니라 워크스페이스 중심". 사이드바에 프로젝트(git repo, GitHub 프로젝트, 아무 디렉터리)가 있고,
  프로젝트 안에 워크스페이스(메인 체크아웃, 기능 브랜치, PR 등)가 있다. 워크스페이스에는 에이전트 세션·터미널·브라우저·diff가 탭으로 열린다.
- **격리 모드** — `local`(기존 디렉터리 공유) / `worktree`(관리형 git 워크트리, 자체 디렉터리·브랜치).
  여러 워크스페이스가 워크트리 하나를 공유할 수 있고, 마지막 워크스페이스가 보관되면 워크트리를 지운다.
- **워크트리 생성 모드** — `branch-off`(`--base origin/main` 권장: 로컬 main은 낡았을 수 있다) / `checkout-branch` / `checkout-pr --pr-number`.
  위치는 `$PASEO_HOME/worktrees/<원본 경로 해시>/<slug>`. slug는 `tidy-fox` 같은 자동 이름이다.
- **`paseo.json`** (repo 루트, *선택한 베이스 브랜치에 커밋된 버전*을 읽는다)
  - `setup` — 워크트리 생성 직후 1회 실행. 의존성 설치, `.env` 복사 등. `$PASEO_SOURCE_CHECKOUT_PATH`로 원본 체크아웃에 접근.
  - `teardown` — 보관 시 디렉터리를 지우기 전에 실행.
  - `scripts` — 이름 붙은 일회성 명령.
  - `services` — 데몬이 감독하는 장기 프로세스. **워크트리마다 포트를 따로 배정**한다(`$PASEO_PORT`).
    배정 순서: 명시 `port` → `servicePorts.portScript` → `servicePorts.range` → OS 임시 포트.
    서비스끼리 `PASEO_SERVICE_<NAME>_PORT/_URL`로 서로를 찾는다.
  - `worktree.terminals` — 워크트리를 만들 때 이름 붙은 터미널을 함께 연다(로그 tail 등).
- **리버스 프록시** — 서비스마다 `http://<script>--<branch>--<project>.localhost:<데몬포트>` 고정 주소. 기본 브랜치에서는 branch 부분이 빠진다. WebSocket도 지원.
- **수명 주기** — 생성(setup) → 에이전트 실행 → 베이스 대비 diff 리뷰 → 머지 또는 보관(teardown).
- **PR 연동** — GitHub·GitLab·Gitea·Forgejo·Codeberg.

## 🤖 에이전트 · 오케스트레이션

- **프로바이더** — 네이티브 하네스 7종 + ACP 30여 종 + 커스텀 CLI. 모델·모드(`bypass`, `plan` 등)·thinking 레벨을 에이전트별로 바꾼다.
- **수명 주기** — 설정·환경변수·MCP 서버 변경, 권한 요청 응답, 턴이 끝나면 후속 지시.
- **에이전트 프로필** — 프로바이더·모델·thinking·모드·기능을 묶어 저장한다. **"언제 쓰는가" 노트**가 있어서 오케스트레이터가 이를 읽고 작업에 맞는 프로필을 고른다.
- **서브에이전트** — Paseo 에이전트가 `paseo run`을 부르면 `PASEO_AGENT_ID`를 보고 같은 워크스페이스의 서브에이전트로 만든다. UI에서는 Subagents 트랙으로 따로 보인다. 부모에게 완료·오류·권한 알림이 기본으로 간다. `agent detach`로 최상위 에이전트로 떼어 낼 수 있다.
- **에이전트 간 메시지** — `paseo send <id> "..."`로 ID를 지정해 프롬프트를 보낸다. 메시지 타입은 없다.
- **구현→검증 루프** — 한 에이전트가 고치고, 다른 에이전트가 `--output-schema`로 구조화된 판정(JSON)을 내면 스크립트가 `jq`로 확인한다.
- **스케줄** — cron 기반으로 매번 새 에이전트를 띄운다(`--every 30m`).
- **하트비트** — 같은 에이전트에 주기적으로 "계속해" 프롬프트를 보낸다.
- **원격 호스트** — CLI `--host`로 다른 Paseo 호스트의 에이전트를 띄우고 관리한다.

## ⌨️ CLI (`paseo`)

- **에이전트** — `run`(기본: 끝날 때까지 대기, `--no-wait`, `--output-schema`, `--new-workspace worktree`), `ls`, `attach`(라이브 스트림), `send`(`--image`),
  `logs`(`-f`, `--tail`, `--filter tools`), `stop`, `wait --timeout`, `agent mode`, `agent detach`
- **사용량** — `usage`(계정 쿼터·잔액, 5분 캐시), `provider diagnostic`(데몬이 보는 바이너리·환경)
- **프로젝트·워크스페이스** — `project create/ls/rename/delete`, `workspace create/ls/rename/archive`
- **터미널** — `terminal create/ls/send-keys/capture/kill`
- **스크립트** — `script ls/start/stop` (`paseo.json` 기준)
- **권한** — `permit ls`, `permit allow <agent>`, `permit deny <agent> --all`
- **스케줄** — `schedule create/ls/pause`
- **데몬** — `daemon start/run/restart/stop/status/reload/pair/config`
- **플러그인 · Hub** — `plugin init/install/add/ls/update/reload/logs/enable/disable/remove`, `hub login/connect/deploy/...`
- **공통 옵션** — `--host`, `--home`, `--json`, `--format yaml`, `-q`(ID만 출력)

## 🧰 MCP 서버 (약 40개 도구)

설정에서 "Enable Paseo tools"를 켜면(기본 꺼짐) 에이전트에 주입된다. 프로바이더별로 `paseoTools`로 도구를 좁힐 수 있지만, 보안 경계는 아니라고 명시한다.

- 에이전트: `create_agent`, `send_agent_prompt`, `get_agent_status`, `get_agent_activity`(타임라인 요약), `list_agents`, `cancel_agent`, `archive_agent`, `kill_agent`, `update_agent`, `set_agent_mode`
- 워크스페이스·스크립트·터미널: `create_workspace`, `list/start/stop_workspace_script`, `create/capture/send_terminal_keys/kill_terminal`
- 스케줄·하트비트: `create/list/inspect/pause/resume/update/delete_schedule`, `schedule_logs`, `run_schedule_once`, `create/delete_heartbeat`
- 기타: `list_profiles`, `list_providers`, `list_models`, `inspect_provider`, `list_pending_permissions`, `respond_to_permission`, `speak`
- 모든 위임은 비동기다. 호출은 바로 반환되고, 진행 상황은 status/activity와 알림으로 확인한다.

## 🌐 브라우저

- 데스크톱 앱 안의 실제 탭을 에이전트가 조종하고, 사람이 그 화면을 본다. 호스트마다 옵트인(기본 꺼짐).
- **읽기** — `browser_snapshot`: 접근성 트리 + `@e3` 같은 ref. ref는 최신 스냅샷 기준이고, 페이지가 바뀌면 만료되어 오류를 낸다(엉뚱한 요소를 누르지 않는다).
- **행동** — `browser_click`, `browser_fill`, hover, 드래그, 파일 업로드(워크스페이스 안 파일만). 실제 입력 이벤트로 보내므로 `:hover`도 동작한다.
  행동 전에 대상이 보이고·활성이고·안정적인지 확인한다.
- **진단** — `browser_screenshot`, `browser_logs`(콘솔 + 네트워크 타이밍), `browser_list_tabs`(모든 호스트의 탭 합산).
- **대화상자는 막지 않는다** — `alert`는 수락, `confirm`·`prompt`·`beforeunload`는 취소하고 결과에 보고한다.
- **범위** — 탭은 워크스페이스 단위다. 에이전트는 자기 워크스페이스 탭만 본다. 새 탭은 포커스를 뺏지 않고 백그라운드로 연다.
- **요소 피커** — 사람이 페이지 요소를 집어 에이전트에 넘긴다.
- **보안** — `http(s)`만 탐색. 브라우저 프로필(쿠키·로그인)을 공유하므로 "신뢰하는 에이전트에만 켜라".

## 🧩 플러그인

- TypeScript 프로젝트. `paseo-plugin.json` + `index.client.tsx`(앱, 모바일 포함) + `index.server.ts`(데몬 서브프로세스).
  `client/`·`server/`·`shared/` 폴더 경계를 넘으면 컴파일 오류.
- 확장 지점: 화면·사이드바 항목, 워크스페이스 패널(에이전트·터미널 옆 탭), 커맨드 센터 항목, 데몬 RPC, 슬래시 명령, 컴포저 첨부, 타임라인 항목, 테마, 프로바이더.
- 배포: 레지스트리(검토된 산출물), npm, git, 로컬 경로. 업데이트는 리비전을 보여 주고 승인받는다.
- **샌드박스 없음** — "신뢰하는, 샌드박스 없는 코드". 데몬 단위 전역 스위치 `pluginsEnabled`.

## 🎙️ 기타

- **음성** — 로컬 우선 받아쓰기, 선택적으로 OpenAI 음성(고품질 전사·TTS), 실시간 음성.
- **사용량** — 구독 쿼터 대화상자(0.11.0).
- **찾기** — 파일 페인·터미널 스크롤백·채팅 검색(0.9.0).
- **diff 리뷰** — 리뷰 코멘트가 에이전트에게 전달된다.
- **에디터 · 터미널** — 내장.
- **Paseo Hub(선택)** — GitHub·Slack·Discord에서 봇을 멘션하면 *사용자 데몬에서, 사용자 키로* 에이전트가 돈다.
  셀프호스트는 무료(`npx @getpaseo/hub`). 호스팅은 Free(월 50회, 1석) / Pro(석당 월 $15, 무제한).

---

## EQMUX에 주는 시사점

EQMUX의 원칙("관제가 핵심", "터미널 페인이 작업 공간", "자동 실행 경로 없음", "파일이 원본")과 맞는지를 기준으로 나눴다.

### 가져올 만한 것 (원칙과 맞고, 비용이 작다)

| # | Paseo 기능 | EQMUX에 적용 | 근거 |
|---|---|---|---|
| 1 | **워크트리별 서비스 포트 배정 + `*.localhost` 고정 주소** | 지금 만드는 서버 탭(미커밋)과 세션별 워크트리 격리를 합친다. 세션마다 `EQMUX_PORT`를 주입하면 4개 세션이 `npm run dev`를 동시에 띄워도 포트가 겹치지 않는다 | 미구현 목록 §1에서 고아 dev 서버·포트 문제가 이미 높음으로 잡혀 있다 |
| 2 | **`setup` / `teardown` 스크립트** (repo에 커밋된 파일) | 워크트리 격리를 켤 때 `.eqmux/` 아래 파일 하나로 의존성 설치·`.env` 복사를 한다. 원본은 파일이라는 원칙에 맞는다 | 새 워크트리에는 `node_modules`·`.env`가 없어서 에이전트가 첫 턴을 낭비한다 |
| 3 | **권한 요청 일괄 처리** (`permit ls/allow/deny`) | 대시보드의 waiting 행에서 바로 승인·거부한다. 사람이 누르는 버튼이므로 원칙과 충돌하지 않는다 | 지금은 waiting을 보고 해당 페인으로 점프해야 한다 |
| 4 | **브라우저 대화상자 자동 처리 + `browser_logs`** | `eqmux browser`에 콘솔·네트워크 로그 읽기를 추가하고, `confirm`·`alert`이 패널을 멈추지 않게 한다 | 0.4.1에서 브라우저 패널이 앱을 멈춘 버그가 있었다. 같은 계열의 사고를 막는다 |
| 5 | **ref 만료 시 오류** | 스냅샷 이후 페이지가 바뀌면 `@eN` 클릭을 거부한다 | 엉뚱한 요소를 누르는 것보다 실패하는 편이 안전하다 |
| 6 | **`wait` + 구조화된 출력** | `eqmux wait <세션>`(턴이 끝날 때까지 대기)과 `eqmux report --json`. 리뷰어 세션의 판정을 스크립트가 읽게 된다 | 메시지 버스는 이미 턴 종료 시점을 안다. 그 신호를 CLI로 내보내기만 하면 된다 |
| 7 | **diff 코멘트 → 에이전트** | diff 뷰어의 줄 코멘트를 `review` 타입 메시지로 해당 세션에 보낸다 | 타입 버스(review)가 이미 있다. 화면에 입력 칸만 더하면 된다 |
| 8 | **프로필의 "언제 쓰는가" 노트** | 0.5 직함 기능과 같은 자리다. 페르소나에 한 줄 "이런 질문은 나에게" 노트를 두면, 팀 관계 표에 들어가 에이전트가 누구에게 물을지 고른다 | 0.5 기획서의 "서버 쪽 질문을 누구에게 보내야 하는지 모른다"와 같은 문제를 푼다 |
| 9 | **사용량·쿼터 화면** | statusLine 비용 수집 위에 구독 쿼터·리셋 시각을 보탠다 | 4~8 세션을 동시에 돌리면 쿼터가 가장 먼저 바닥난다 |

### 원칙과 충돌하므로 그대로 가져오지 않을 것

| Paseo 기능 | 충돌하는 지점 | 대안 |
|---|---|---|
| 에이전트가 에이전트를 띄움 (`paseo run`, `create_agent`) | "자동 실행 경로는 없다" | 에이전트가 *제안*하고 사람이 대시보드에서 수락하면 슬롯을 연다 |
| 스케줄 · 하트비트 | 같은 원칙 | 넣지 않는다. 필요해지면 "다음에 이걸 하자" 알림 정도로 한다 |
| 채팅 중심 UI | "터미널 페인이 작업 공간" | 트랜스크립트 뷰(참조 전용)로 이미 일부 커버한다 |
| 샌드박스 없는 플러그인 | 0.5 범위 밖, 보안 부담 | 넣지 않는다 |

### 장기 과제 (0.6 이후)

- **데몬/클라이언트 분리** — Paseo의 모바일·웹·원격·Hub는 전부 "데몬이 에이전트를 소유하고 클라이언트는 붙기만 한다"는 한 가지 결정에서 나온다.
  EQMUX가 0.6 이후로 미룬 VT 서버 모델이 같은 방향이다. 하게 되면 Paseo의 보안 설계를 그대로 참고한다:
  기본 루프백 바인드, 네트워크 바인드 시 비밀번호 필수, `Host` 헤더 허용 목록, 페어링 QR = 공개키, 신뢰하지 않는 릴레이 위의 E2E.
- **모바일 관제** — EQMUX의 핵심이 관제이므로, 원격으로 가장 먼저 쓸모 있는 것은 "waiting 알림 받고 승인 누르기"다. 전체 기능 동등은 필요 없다.
- **ACP 프로바이더** — Claude Code·Codex 외 에이전트를 붙일 때 개별 하네스보다 ACP 하나가 싸다.
- **MCP 서버** — 0.5 기획서가 이미 0.6 이후로 미뤘다. 만들 때는 Paseo처럼 기본 꺼짐 + 도구 화이트리스트로 한다.

### EQMUX가 이미 앞서는 것

- **팀 모델** — 직무·페르소나·임무·팀 관계 표. Paseo에는 "팀"이 없고 부모-자식 서브에이전트만 있다.
- **타입 메시지 버스** — ask·handoff·report·review·escalate, 상태 기반 전달(유휴면 즉시, 작업 중이면 턴 종료 시). Paseo의 `send`는 타입 없는 프롬프트다.
- **세션 영속성** — SQLite 스크롤백, 재시작 시 SGR 색을 보존한 재생, FTS 검색. Paseo는 0.11.1에서야 "데몬 재시작 후 기록 누락"을 고쳤다.
- **대화 원장의 Markdown 저장**, **역할 파일 frontmatter가 실행 권한을 결정**하는 구조.
