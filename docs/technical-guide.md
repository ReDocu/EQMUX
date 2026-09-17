# EQMUX 기술 가이드 — 내부 시스템 · UML · 유지보수

> 기준 버전 **0.3.8** (커밋 `e422965`, 2026-09-06) · 대상 독자: 이 저장소를 AI 도움 없이 고치고 확장해야 하는 개발자
>
> 이 문서는 **코드에서 실측한 사실**만 적는다. 설계 의도와 결정 근거는 `docs/prd/00-index.md`(결정 대장)와 각 PRD에 있고,
> 이 문서는 "지금 코드가 실제로 어떻게 움직이는가"를 다이어그램과 표로 고정한다. 둘이 어긋나면 **코드가 사실**이고,
> 이 문서의 §11.6에 알려진 괴리를 모아 두었다.

---

## 목차

- [0. 문서 사용법](#0-문서-사용법)
- [1. 시스템 개요](#1-시스템-개요)
- [2. 도메인 모델 (클래스 다이어그램)](#2-도메인-모델-클래스-다이어그램)
- [3. 백엔드(Rust) 모듈 가이드](#3-백엔드rust-모듈-가이드)
- [4. 프런트엔드(SolidJS) 모듈 가이드](#4-프런트엔드solidjs-모듈-가이드)
- [5. 핵심 흐름 (시퀀스 다이어그램)](#5-핵심-흐름-시퀀스-다이어그램)
- [6. 상태 머신](#6-상태-머신)
- [7. 인터페이스 계약](#7-인터페이스-계약)
- [8. 데이터 계약](#8-데이터-계약)
- [9. 빌드 · 실행 · 테스트 · 릴리스](#9-빌드--실행--테스트--릴리스)
- [10. 유지보수 레시피](#10-유지보수-레시피)
- [11. 불변식과 함정](#11-불변식과-함정)
- [12. 용어집](#12-용어집)

---

## 0. 문서 사용법

### 0.1 다이어그램 렌더링

모든 다이어그램은 **Mermaid** 텍스트다. 별도 도구 없이 다음 어디서든 그려진다.

| 환경 | 방법 |
|---|---|
| GitHub | `.md`를 열면 자동 렌더링 |
| VS Code | 확장 "Markdown Preview Mermaid Support" 설치 후 미리보기 |
| 브라우저 | https://mermaid.live 에 코드 블록을 붙여넣기 |
| 이미지로 저장 | `npx -y @mermaid-js/mermaid-cli -i docs/technical-guide.md -o out.md` (각 블록을 SVG로 뽑아 준다) |

다이어그램을 고칠 때는 코드 블록만 편집하면 된다. 그림 파일은 없다.

**HTML 판 재생성** — `docs/technical-guide.html`은 이 Markdown에서 만든 사본이다. Markdown을 고친 뒤 저장소 루트에서:

```powershell
npm i --no-save marked mermaid jsdom      # package.json은 건드리지 않는다
node docs/tools/check-mermaid.mjs        # 다이어그램 22개 문법 검증 (실패하면 줄 번호를 알려준다)
node docs/tools/build-guide.mjs          # docs/technical-guide.html 생성
```

HTML 판은 글꼴(Google Fonts)과 Mermaid(jsdelivr)를 인터넷에서 받는다. 오프라인이면 다이어그램이 코드 텍스트로 보인다.

### 0.2 표기 규약

- `src-tauri/src/agent.rs` 처럼 **저장소 루트 기준 경로**로 파일을 가리킨다. 함수는 `모듈::함수` 또는 `파일::함수`.
- `FR-D-22`, `C5`, `G7` 같은 ID는 `docs/prd/00-index.md`의 **결정 ID**다. 코드 주석에도 같은 ID가 박혀 있으니 `grep`으로 추적할 수 있다.
- `B14`, `P-2`, `M3` 같은 ID는 감사(audit)·마일스톤 번호다. 코드 주석에서 만나면 "왜 이렇게 했는가"의 실마리다.
- 상수 값(밀리초, 바이트, 줄 수)은 0.3.8 기준 실측값이다. 바꾸려면 §3·§4에서 상수 위치를 찾는다.

### 0.3 읽는 순서

1. 처음이면 **§1 → §2 → §5.3(PTY) → §5.5(상태 감지) → §11** 순으로 읽는다. 이 다섯이 이 앱의 뼈대다.
2. 특정 기능을 고칠 때는 **§10 레시피**에서 시작해 링크를 따라간다.
3. 버그를 잡을 때는 **§6 상태 머신**과 **§11 불변식**을 먼저 본다. 대부분의 과거 버그는 "화면이 말하는 것과 프로세스·파일의 사실이 갈라진" 종류였고, 그 교훈이 불변식으로 정리돼 있다.

### 0.4 함께 보는 문서

| 문서 | 내용 |
|---|---|
| `README.md` / `README.en.md` | 제품 소개, 시작하기 |
| `docs/prd/00-index.md` | **결정 대장** — 모든 설계 결정의 ID와 근거 |
| `docs/prd/12-session-store.md`, `20-agent-runtime.md`, `21-team-mission.md`, `23-command-center.md` | 영역별 PRD |
| `docs/implementation-status.md` | PRD 대조 구현 현황 |
| `docs/site/docs.md` | 사용자 매뉴얼 (화면·단축키·CLI) |
| `명령어 정리.md` | 커밋·릴리스를 손으로 하는 절차 |
| `interview.csv` | 감사(audit) 항목 원장 (B-번호의 출처) |

---

## 1. 시스템 개요

### 1.1 한 줄 정의와 다섯 원칙

**하나의 git 저장소를 AI 에이전트 팀이 함께 작업하고, 사람이 그것을 관제하는 Windows 데스크톱 앱.**

| 원칙 | 코드에서의 모습 |
|---|---|
| 관제가 핵심이다 | 대시보드는 `waiting → dead → busy → shell → idle → starting` 순으로 정렬한다 (`ATTENTION_ORDER`, `src/types.ts`) |
| 터미널 페인이 작업 공간이다 | 실제 일은 페인 안의 Claude Code가 한다. 앱은 PTY를 열고 관측할 뿐이다 |
| 앱은 API 키를 보유하지 않는다 | 자체 AI 호출 코드가 없다. `claude` 실행 파일을 PTY에서 띄우기만 한다 |
| 파일이 원본이다 | 팀·역할·임무는 `.eqmux/` 아래 텍스트 파일. SQLite는 캐시. 충돌 시 파일이 이긴다 (FR-C-23, FR-E-74) |
| 자동 실행 경로는 없다 | 자동 재개·자동 재시작·자동 승인이 없다. 상태를 바꾸는 것은 항상 사람의 버튼이다 (C5, D7, G7) |

### 1.2 기술 스택

| 영역 | 기술 | 버전 (0.3.8) |
|---|---|---|
| 셸 | Tauri 2 (`features = ["unstable"]` — 브라우저 패널의 자식 웹뷰 때문) | `tauri 2` |
| 백엔드 | Rust, 단일 크레이트 `eqmux_lib` (`src-tauri/`) | edition 2021 |
| 프런트엔드 | SolidJS + TypeScript + Vite | solid-js 1.9, vite 6, TS 5.7 |
| 터미널 | ConPTY (`portable-pty 0.9`) + xterm.js 6 (+ fit · search · webgl · web-links · unicode-graphemes 애드온) | |
| 에디터 | CodeMirror 6 | |
| 저장소 | SQLite (`rusqlite 0.32`, bundled, WAL) · JSON 파일 · Markdown 파일 | |
| OS API | `windows-sys 0.59` (Job Object, 명명 파이프, 콘솔, 프로세스 메모리 읽기), `webview2-com 0.38` (렌더러 크래시 생존) | |
| 기타 | `notify 6`(파일 감시), `rfd 0.15`(다이얼로그), `arboard 3.4`(클립보드), `trash 5`(휴지통), `uuid`, `chrono`, `tauri-plugin-notification` | |
| 테스트 | Rust `#[test]` (cargo test), vitest 3 (프런트 순수 함수) | |
| 배포 | `npm run tauri build -- --no-bundle` → 포터블 zip (NSIS 타깃은 설정만 있고 배포하지 않음) | |

### 1.3 컴포넌트 다이어그램

```mermaid
flowchart LR
  subgraph APP["eqmux.exe (단일 프로세스, Tauri 2)"]
    direction TB
    subgraph FE["WebView2 — SolidJS 프런트엔드 (src/)"]
      SCREENS["screens/ · components/<br/>화면·패널"]
      STATE["state.ts · types.ts<br/>전역 시그널·도메인 타입"]
      BRIDGE["backend/*.ts<br/>invoke 래퍼 + 이벤트 구독"]
      MOCK["backend/mock.ts<br/>인메모리 도메인 모델(MockBackend)"]
      XTERM["TerminalPane.tsx<br/>xterm.js 인스턴스 레지스트리"]
      SCREENS --> STATE --> MOCK
      SCREENS --> BRIDGE
      XTERM --> BRIDGE
    end
    subgraph BE["Rust 백엔드 (src-tauri/src/)"]
      LIB["lib.rs<br/>부팅 · 커맨드 등록 · PTY 세션 · 워크스페이스 커맨드"]
      AGENT["agent.rs / agentscan.rs<br/>에이전트 상태 머신 · 레지스트리 감시 · 프로세스 탐지"]
      IPC["ipc.rs / cli.rs<br/>명명 파이프 서버 · eqmux CLI"]
      STORE["store.rs<br/>SQLite 쓰기 스레드 · 스크롤백 · 이벤트"]
      FILES["team.rs · roles.rs · missions.rs · library.rs<br/>.eqmux 파일 계약"]
      WS["workspace.rs · diff.rs · fsx.rs<br/>git · 탐색기"]
      MISC["job.rs · ports.rs · browser.rs · clip.rs · diag.rs · recovery.rs · messages.rs · transcript.rs"]
    end
    FE <-->|"invoke(커맨드) / listen(이벤트)"| BE
  end

  CLAUDE["claude (Claude Code CLI)<br/>페인마다 1개, ConPTY 자식"]
  SHELL["pwsh / powershell / cmd<br/>기본 터미널 페인"]
  CLI["eqmux.exe (CLI 모드)<br/>send · report · _hook · _statusline · ping"]
  REG["~/.claude/sessions/*.json<br/>세션 레지스트리 (Claude Code가 씀)"]
  JSONL["~/.claude/projects/&lt;cwd&gt;/&lt;uuid&gt;.jsonl<br/>트랜스크립트"]
  DB[("%APPDATA%/com.eqment.eqmux/<br/>workspaces/&lt;ws&gt;/session.db")]
  APPDATA["%APPDATA%/com.eqment.eqmux/<br/>settings.json · layout.json · workspaces.json<br/>hook-settings.json · jobs/ personas/ presets/"]
  EQMUX["&lt;repo&gt;/.eqmux/<br/>team.json · team.md · roles/ · missions/ · worktrees/"]

  LIB -->|"ConPTY spawn + Job Object"| CLAUDE
  LIB -->|"ConPTY spawn + Job Object"| SHELL
  CLAUDE -->|"훅 · statusLine 실행"| CLI
  SHELL -->|"사람이 eqmux send"| CLI
  CLI -->|"명명 파이프 \\.\pipe\eqmux-bus-&lt;user&gt;<br/>JSON 한 줄 요청/응답"| IPC
  CLAUDE -->|"상태 파일 갱신"| REG
  CLAUDE -->|"대화 기록"| JSONL
  REG -->|"notify 감시 + 2초 재스캔"| AGENT
  JSONL -->|"읽기 전용"| BE
  STORE --> DB
  LIB --> APPDATA
  FILES --> EQMUX
  EQMUX -->|"notify 감시 → eqmux-file-change"| LIB
```

핵심 배선 세 가지만 기억하면 된다.

1. **프런트 ↔ Rust**는 Tauri `invoke`(요청/응답)와 `listen`(이벤트) 뿐이다. 전체 목록은 §7.1·§7.2.
2. **에이전트 → 앱**은 두 경로다. Claude Code가 쓰는 **레지스트리 파일**(1차)과, Claude Code가 실행하는 훅 명령 `eqmux _hook`이 **명명 파이프**로 넣어 주는 이벤트(2차). 둘 다 `agent.rs`의 같은 상태 머신으로 합류한다.
3. **앱 → 에이전트**는 PTY에 글자를 쓰는 것뿐이다. 메시지 주입도, 임무 브리핑도, 역할 갱신 알림도 결국 `pty_write`다.

### 1.4 프로세스 · 스레드 배치

```mermaid
flowchart TB
  subgraph P0["프로세스: eqmux.exe (GUI)"]
    MAIN["메인 스레드 (Tauri 이벤트 루프)<br/>동기 커맨드는 여기서 실행된다"]
    TOKIO["tauri async runtime<br/>spawn_blocking: pty_resize · git 계열 · fs_delete · ports"]
    STOREW["store writer 스레드 (1개)<br/>sync_channel(50_000) 소비, 100ms/200건 배치 커밋"]
    REGW["registry watch 스레드 (1개)<br/>notify + recv_timeout(2000ms) → scan()"]
    PIPE["pipe accept 스레드 (1개)<br/>ConnectNamedPipe 루프"]
    CONN["연결 처리 스레드 (연결당 1개, 최대 32 동시)"]
    subgraph PER["세션당 2개 스레드"]
      READER["PTY reader<br/>8KB read → 로그 파일 · LineAssembler → store · 코얼레서 채널"]
      COAL["output coalescer<br/>3ms 정적/25ms 마감/256KB 상한 → pty-output emit"]
    end
    TEAR["teardown 스레드 (kill/restart마다 1회)<br/>Job terminate → child kill → ConPTY drop"]
    WV["WebView2 렌더러 (별도 OS 프로세스)<br/>크래시 시 ProcessFailed → Reload"]
  end
  subgraph JOB["Windows Job Object (세션당 1개, KILL_ON_JOB_CLOSE)"]
    SH["pwsh.exe"] --> CL["claude (node)"] --> SUB["서브 프로세스들"]
  end
  subgraph P1["프로세스: eqmux.exe (CLI 모드, 호출마다 새로 뜸)"]
    CLIP["argv 분기 → 파이프에 JSON 한 줄 → 응답 출력 → 종료"]
  end
  READER -. "ConPTY 파이프" .- SH
  CL -. "훅/statusLine 실행" .-> P1
  P1 -. "명명 파이프" .-> PIPE
  PIPE --> CONN
  MAIN --> TOKIO
```

- **잠금 규율(B14)**: `PtyState`의 전역 뮤텍스는 `Arc`를 복제하거나 항목을 `remove`할 때만 잠근다. 블로킹 작업(`write_all`, `ResizePseudoConsole`, `child.wait`, `child.kill`, ConPTY drop)은 잠금을 푼 뒤 백그라운드 스레드에서 한다. 이 규칙을 어기면 앱 전체가 멈춘다 (0.3.8의 `2a52394`가 그 사고를 고친 커밋이다).
- **동기 커맨드는 메인 스레드에서 실행**된다. git처럼 오래 걸릴 수 있는 것은 반드시 `async fn` + `spawn_blocking`으로 감싼다 (`6a9b45a`의 교훈, Application Hang 발생).

### 1.5 저장소 3분할과 경로

"읽는 주체가 다르면 매체도 다르다"(C3)는 원칙으로 세 갈래다.

| 매체 | 무엇 | 위치 | 원본/캐시 |
|---|---|---|---|
| **텍스트 파일** | 팀 편성, 역할, 임무, 직무·페르소나 라이브러리 | `<repo>/.eqmux/`, `%APPDATA%/com.eqment.eqmux/{jobs,personas,presets}` | **원본** |
| **JSON** | 설정, 레이아웃, 워크스페이스 등록부, 훅 설정 | `%APPDATA%/com.eqment.eqmux/*.json` | 원본 (앱 전용) |
| **SQLite** | 세션 메타, 스크롤백(+FTS), 이벤트 피드, 메시지 원장, 에이전트 세션 매핑, KV 캐시 | `%APPDATA%/com.eqment.eqmux/workspaces/<ws-id>/session.db` | 세션·메시지는 원본, 팀·임무 관련은 **캐시** |

전체 경로 지도는 §8에 있다. 여기서는 "저장소 안에는 텍스트만, 바이너리는 앱데이터에"(FR-E-71)와 "team.json에 절대경로 금지"(W3) 두 규칙만 기억한다.

---

## 2. 도메인 모델 (클래스 다이어그램)

### 2.1 개념 계층

```
앱 ── 워크스페이스 ×최대 10 (동시 오픈, 프런트 MAX_OPEN_WORKSPACES)
      └─ = git repo 1개 = 팀 1개 = 탭 1개 = SQLite 파일 1개
         ├─ 세션 ×N (설정 maxSlots 4·6·8, team.json은 최대 8)
         │   = 에이전트 1명 = 터미널 페인 1개 = PTY 1개 = Job Object 1개
         │   └─ 역할 = 직무(job) + 페르소나(persona) → roles/<세션>.md
         ├─ 임무 ×M → missions/<id>.md
         └─ 메시지 원장 (message 테이블)
```

### 2.2 프런트엔드 도메인 타입 (`src/types.ts`)

프런트의 모든 화면은 이 타입들을 `MockBackend`(§4.5)가 들고 있는 배열에서 읽는다.

```mermaid
classDiagram
  direction LR
  class Workspace {
    +string id
    +string name
    +string path
    +string remote?
    +string branch?
    +string branchNote
    +bool open
    +bool pathMissing
    +string teamFile
    +string lastUsed?
  }
  class Session {
    +string id  «persona@ws»
    +string workspaceId
    +number slot  1..8
    +string personaId
    +string jobId
    +string name?
    +string agentSessionId?  «Claude UUID»
    +string shell
    +string cwd
    +AgentStatus status
    +string waitingFor?
    +string activity?
    +number costUsd?
    +number subagents
    +bool resumable
    +bool degraded
    +number exitCode?
    +string missionId?
    +Permissions permOverride?
    +bool restartNeeded
    +string spawnFlags?
    +bool restored?
    +bool worktree?
    +bool worktreeMissing?
    +bool unseen?
    +number sinceMs
    +number sinceTs?
    +number memoryMb?
    +string agent?  «탐지된 CLI»
  }
  class AgentStatus {
    <<enumeration>>
    starting
    busy
    waiting
    shell
    idle
    dead
  }
  class Permissions {
    +bool write
    +bool commit
    +bool push
  }
  class RuntimeFlags {
    +permissionMode  manual|acceptEdits
    +string[] disallowedTools
  }
  class Job {
    +string id
    +string name
    +Permissions permissions
    +string responsibility
    +string forbidden
    +number mtimeMs?
  }
  class Persona {
    +string id
    +string name
    +PersonaLevel level?
    +PersonaProfile basic?
    +PersonaProfile mid?
    +PersonaProfile adv?
    +string hint
    +string tone?
    +string personality?
    +color 9색 중 하나
    +string job?
    +string characterPath?
    +string characterName?
    +number mtimeMs?
  }
  class PersonaProfile {
    +string hint
    +string tone?
    +string personality?
  }
  class Mission {
    +string id
    +string workspaceId
    +string name
    +string file
    +MissionStatus status
    +string goal
    +string[] outputs
    +string branch?
    +string[] assigned
    +bool isDefault?
  }
  class MissionStatus {
    <<enumeration>>
    todo
    in-progress
    in-review
    done
  }
  class ConversationMessage {
    +string id  «ws:rowid»
    +string time
    +string from
    +string to  «@all | sessionId»
    +type ask|handoff|report|review|escalate
    +string body
    +bool unread
    +string workspaceId?
    +number ts?
  }
  class EventRecord {
    +string id
    +string time
    +string sessionId?
    +string workspaceId?
    +kind state|store|agent|git|mission|app
    +string message
  }

  Workspace "1" *-- "0..8" Session
  Workspace "1" *-- "*" Mission
  Workspace "1" *-- "*" ConversationMessage
  Session --> AgentStatus
  Session --> "0..1" Job : jobId
  Session --> "0..1" Persona : personaId
  Session --> "0..1" Mission : missionId
  Session ..> Permissions : permOverride
  Job *-- Permissions
  Persona *-- "0..3" PersonaProfile
  Permissions ..> RuntimeFlags : translatePermissions()
  Mission --> MissionStatus
```

`types.ts`의 순수 함수 네 개가 화면 전체의 판단 기준이다.

| 함수 | 역할 | 쓰는 곳 |
|---|---|---|
| `translatePermissions(p)` | 권한 3비트 → Claude Code 실행 플래그 (§7.6 표) | `agent.ts`의 spawn/resume/restart |
| `effectivePermissions(s, job)` | `s.permOverride ?? job.permissions` | 역할 파일 저장, 플래그 미리보기 |
| `agentAttached(s)` | `status !== "shell" && status !== "dead"` — **상태만 본다**, `agentSessionId`는 보지 않는다 | 종료 대화상자, 대시보드 |
| `canInject(s)` | `status === "idle" && !humanTyping(s.id)` — **PTY에 글자를 넣어도 되는가의 단일 게이트** | 메시지 전달, 임무 브리핑, 역할 갱신 알림 |

### 2.3 백엔드 관리 상태 (`src-tauri/src/lib.rs`, `agent.rs`, `store.rs`)

Tauri `manage()`로 등록된 상태는 7개다. 하나의 `AppState` 구조체는 없고, 각각 독립된 뉴타입이다.

```mermaid
classDiagram
  direction TB
  class PtyState {
    Mutex~HashMap~String, PtySession~~
  }
  class PtySession {
    +Arc~Mutex~MasterPty~~ master  «리사이즈용 중첩 잠금»
    +Arc~AtomicU64~ resize_seq
    +Arc~Mutex~Write~~ writer  «쓰기용 중첩 잠금»
    +Box~Child~ child
    +u64 gen  «재스폰 세대»
    +Option~Job~ job
    +Arc~AtomicU64~ resize_hint  «최근 리사이즈 epoch ms»
  }
  class Job {
    HANDLE
    +new_kill_on_close() Option~Job~
    +assign_pid(pid)
    +terminate()
    +pids() Vec~u32~
    +memory_bytes() (cur, peak)
  }
  class AgentRt {
    +Mutex~HashMap~uuid, Tracked~~ by_uuid
    +Mutex~HashSet~String~~ expected_exit
    -Mutex~HashMap~String, NotifyGate~~ notify_gate
    +Mutex~HashMap~String, String~~ session_tokens  «EQMUX_TOKEN»
    +Mutex~HashMap~String, (ws, cwd)~~ session_origin
  }
  class Tracked {
    +String app_session  «persona@ws»
    +String ws
    +String cwd
    +String name
    +String permission_mode
    +Vec~String~ disallowed
    +String last_status
    +Option~String~ last_waiting
    +u64 pty_gen
    +Option~String~ activity
    +i64 subagents
    +Option~f64~ cost_usd
    +bool degraded
    +i64 hook_ms
    +i64 status_ms
    +u64 seq
    +bool adopted
    +Option~u32~ pid
    +bool asking
  }
  class StoreState {
    Store
  }
  class Store {
    -SyncSender~StoreMsg~ tx
    -PathBuf root
    +sender()
    +root()
  }
  class StoreMsg {
    <<enumeration>>
    SessionStart
    SessionExit
    Line
    Event
    AgentSession
    ForgetAgentSession
    Flush(ack)
  }
  class SettingsState {
    Mutex~serde_json Value~
  }
  class WatchState {
    Mutex~HashMap~wsId, RecommendedWatcher~~
  }
  class MsgRate {
    Mutex~HashMap~"ws/sender", Vec~i64~~~
  }
  class DirtyStart {
    Mutex~bool~
  }
  PtyState "1" *-- "*" PtySession
  PtySession o-- "0..1" Job
  AgentRt "1" *-- "*" Tracked
  StoreState *-- Store
  Store ..> StoreMsg
```

| 상태 | 범위 | 잠금 | 누가 쓰는가 |
|---|---|---|---|
| `PtyState` | 전역, 세션 id 키 | 전역 Mutex + 세션별 중첩 Mutex | `spawn_pty_session`, `pty_*`, `app_exit` |
| `AgentRt` | 전역, Claude UUID 키 | 5개 독립 Mutex (동시에 두 개 잡지 말 것 — `47bde8b` 교착 사고) | `agent.rs` 전부, `ipc.rs` 검증 |
| `StoreState` | 전역 핸들, DB는 워크스페이스별 | 없음 (`SyncSender`는 Sync) | 모든 저장 경로 |
| `SettingsState` | 전역 | Mutex | `settings_load/save`, `setting_str/bool` |
| `WatchState` | 워크스페이스별 | Mutex | `ws_watch/unwatch` |
| `MsgRate` | 워크스페이스×발신자별 | Mutex | `msg_send`, 파이프 `send/report` |
| `DirtyStart` | 전역, 1회성 | Mutex | `setup`, `crash_recovery` |

### 2.4 파일 계약 타입 (`team.rs`, `roles.rs`, `missions.rs`, `library.rs`)

```mermaid
classDiagram
  direction LR
  class TeamFile {
    +u32 version  «항상 1»
    +Vec~TeamSlot~ slots
  }
  class TeamSlot {
    +u8 slot
    +String persona
    +String persona_name
    +String job
    +String job_name
    +Option~String~ name
    +bool worktree  «플래그, 경로 아님»
    +Option~RolePermissions~ permissions
  }
  class RolePermissions {
    +bool write
    +bool commit
    +bool push
  }
  class RolePayload {
    +String session
    +String persona
    +String persona_name
    +String hint
    +String tone
    +String personality
    +String job
    +String job_name
    +RolePermissions permissions
    +String responsibility
    +String forbidden
    +Option~String~ character_path
    +Option~String~ character_name
    +Option~String~ character_source
    +Vec~Teammate~ teammates
  }
  class Teammate {
    +u8 slot
    +String name
    +String job_name
    +bool me
  }
  class MissionBlock {
    +String id
    +String name
    +String status
    +String goal
    +Vec~String~ outputs
    +Option~String~ branch
  }
  class MissionInfo {
    +String id
    +String name
    +String status
    +Option~String~ branch
    +String goal
    +Vec~String~ outputs
    +String file
    +Vec~String~ assigned
    +bool is_default
  }
  class JobInfo {
    +String id
    +String name
    +RolePermissions permissions
    +String responsibility
    +String forbidden
    +Option~i64~ mtime_ms
  }
  class PersonaInfo {
    +String id
    +String name
    +String color
    +String level
    +Profile basic
    +Profile mid
    +Profile adv
    +Option~String~ character_path
    +Option~i64~ mtime_ms
  }
  class PresetInfo {
    +String id
    +String name
    +Vec~String~ jobs  «최대 8»
  }
  class CharacterSheet {
    +String content
    +i64 mtime_ms
  }
  TeamFile *-- TeamSlot
  TeamSlot o-- RolePermissions
  RolePayload *-- RolePermissions
  RolePayload *-- Teammate
  RolePayload ..> MissionBlock : 역할 파일 안에 보존
  JobInfo *-- RolePermissions
  PersonaInfo ..> CharacterSheet : id.character.md
  PresetInfo ..> JobInfo : jobs[]
```

### 2.5 식별자 규약

| 식별자 | 형식 | 만드는 곳 | 비고 |
|---|---|---|---|
| 워크스페이스 id | `<폴더명 소문자, 비영숫자→'-'>-<경로 FNV-1a 해시 6hex>` | `workspace::make_id` | 재시작 후에도 동일. SQLite 디렉터리 이름 |
| 세션 id | `<personaId>@<workspaceId>` (역할 세션), `shellN@<ws>` (기본 터미널) | `lib.rs::team_load`, `mock.ts` | **결정적**이라 재사용된다 → 제거 시 잔재 정리 필수 (B44, `forgetAgent`) |
| Claude 세션 UUID | v4 | `agent_spawn` (`Uuid::new_v4`) | `--session-id`로 전달, `agent_session` 테이블에 저장, 재개 앵커 |
| `EQMUX_TOKEN` | v4, 스폰마다 새로 | `spawn_pty_session` | 파이프 요청의 신원 증명. 세션 id는 추측 가능하므로 자격증명이 아니다 (P-1) |
| PTY 세대 `gen` | `NEXT_GEN` 단조 증가 | `spawn_pty_session` | 이전 reader 스레드의 뒤늦은 정리를 무시 |
| 이벤트 순번 `seq` | `NEXT_EVT_SEQ` 단조 증가 | `agent::next_seq` | 프런트 `staleSeq`가 역순 도착 이벤트를 버림 (P-4) |
| 메시지 id | SQLite AUTOINCREMENT | `messages::send` | 프런트에서는 `<ws>:<rowid>` |
| 임무 id | slug (한글·영숫자·`-_.` 유지, 공백→`-`), 충돌 시 `-2`, `-3` | `missions::create` | 파일명과 frontmatter `id` 둘 다 검사 |

---

## 3. 백엔드(Rust) 모듈 가이드

### 3.1 모듈 맵과 의존 방향

```mermaid
flowchart TB
  MAIN["main.rs<br/>argv 게이트: CLI인가 GUI인가"] --> LIB
  MAIN --> CLI
  LIB["lib.rs (2467줄)<br/>run() · setup · 커맨드 99개 등록<br/>PTY 스폰/리더/코얼레서 · 세션 관리 커맨드"]
  LIB --> AGENT["agent.rs<br/>Tracked · 상태 머신 · 레지스트리 감시 · 알림"]
  LIB --> IPC["ipc.rs<br/>파이프 서버 · 요청 dispatch"]
  LIB --> STORE["store.rs<br/>Store · writer 스레드 · 스키마 · LineAssembler"]
  LIB --> JOB["job.rs<br/>Job Object"]
  LIB --> WS["workspace.rs<br/>등록부 · git 실행 · 워크트리"]
  LIB --> TEAM["team.rs"] & ROLES["roles.rs"] & MISS["missions.rs"] & LIBR["library.rs"]
  LIB --> MSG["messages.rs"]
  LIB --> TR["transcript.rs"]
  LIB --> DIFF["diff.rs"] & FSX["fsx.rs"] & PORTS["ports.rs"] & BROWSER["browser.rs"] & CLIP["clip.rs"] & DIAG["diag.rs"] & REC["recovery.rs"]
  CLI["cli.rs<br/>eqmux 서브커맨드 파싱 · 파이프 클라이언트"] --> IPC
  IPC --> AGENT
  IPC --> MSG
  IPC --> TEAM
  AGENT --> STORE
  AGENT --> SCAN["agentscan.rs<br/>프로세스 트리에서 CLI 탐지"]
  SCAN --> PORTS
  ROLES --> WS
  MISS --> ROLES
  DIFF --> WS
  FSX --> WS
  REC --> STORE
  REC --> WS
```

의존은 위에서 아래로만 흐른다. `lib.rs`가 허브고, 도메인 모듈끼리는 `roles → workspace`(atomic_write), `missions → roles`(임무 블록), `diff/fsx → workspace`(git 실행, atomic_write) 정도만 참조한다. 새 모듈을 만들면 **`lib.rs`에 `mod` 선언 + 커맨드를 `generate_handler!`에 등록**하는 두 줄이 연결의 전부다.

### 3.2 `main.rs` — CLI/GUI 게이트

```rust
match std::env::args().nth(1).as_deref() {
    Some(first) if eqmux_lib::is_cli_command(first) => exit(cli_main()),   // ping send report _hook _statusline
    Some(_)                                          => exit(cli_usage()), // 모르는 인자 → 사용법, 절대 GUI 아님 (exit 2)
    None if env EQMUX_SESSION 존재                    => exit(cli_usage()), // 세션 안에서 맨 eqmux = 에이전트의 탐색
    None                                             => run(),             // 사람이 아이콘으로 연 경우만 GUI
}
```

방향이 **"인자가 있으면 절대 GUI가 아니다"**(P-10)인 이유: 반대로 두면 에이전트의 오타·`--help`·`send` 누락이 전부 새 앱 창이 됐다 (`3fa63b1`). 릴리스 빌드는 `windows_subsystem = "windows"`라 콘솔이 없으므로 사용법 출력 전에 `AttachConsole(ATTACH_PARENT_PROCESS)`를 부른다.

### 3.3 `lib.rs` — 부팅, PTY, 세션 커맨드

#### 3.3.1 `run()` / `setup` 순서

1. `another_instance_running()` — `CreateMutexW("Local\\eqmux-single-instance")`. 이미 있으면 `FindWindowW(null,"EQMUX")` → `ShowWindow(SW_RESTORE)` + `SetForegroundWindow` 후 조용히 종료 (FR-C-45).
2. `tauri::Builder` + `tauri_plugin_notification` + `.manage(PtyState)`.
3. `on_window_event` — `ScaleFactorChanged/Moved/Resized/Focused`를 `diag::note_window_event`로 보내고, 실제 변화가 있을 때만 `diag-geometry` 이벤트를 `main` 창에 보낸다. **`CloseRequested` 처리는 없다** — 창 닫기는 프런트 `App.tsx`가 가로챈다.
4. `setup`:
   1. `root = app_data_dir()` (= `%APPDATA%\com.eqment.eqmux`)
   2. **버전 와이프**: `root/data.ver` ≠ 현재 버전이면 `PRESERVED = ["settings.json","jobs","personas","presets"]`를 제외하고 `root` 아래를 전부 지운다. 하나라도 실패하면 `data.ver`를 갱신하지 않아 다음 기동에 재시도한다.
   3. `library::seed(root)` — 8개 고정 직무·8 페르소나·4 프리셋 시드 (§3.9)
   4. `write_hook_settings(root)` — `hook-settings.json`을 **매 기동마다** 다시 쓴다 (§7.5)
   5. 크래시 표식: `running.flag` 존재 여부를 `DirtyStart`로 보관 후 다시 씀
   6. `settings.json` → `SettingsState`
   7. `StoreState(Store::new(root))` — **여기서 store writer 스레드가 시작**된다
   8. `AgentRt`, `WatchState`, `MsgRate` 등록
   9. `agent::start_registry_watch` 스레드
   10. `ipc::start_server` 스레드
   11. WebView2 `add_ProcessFailed` → `Reload` 등록 (FR-C-06)
5. `invoke_handler(generate_handler![...])` → `run(generate_context!())`.

창은 `tauri.conf.json`에 선언돼 있다 (1440×900, 최소 1100×700, 최대화, `csp: null`).

#### 3.3.2 PTY 스폰 — `spawn_pty_session`

시그니처: `(app, id, ws, dir, shell_label, builders: Vec<CommandBuilder>, cols, rows) -> Result<u64 /*gen*/, String>`

1. 전역 잠금. `id`가 이미 있으면 **새로 띄우지 않고 기존 `gen`을 돌려준다** (재부착).
2. `native_pty_system().openpty(PtySize{rows, cols})`.
3. 후보 `CommandBuilder`를 순서대로 시도. 셸은 `명시 shell → pwsh.exe → powershell.exe → cmd.exe`, 에이전트는 `claude <args> → cmd.exe /c claude <args>`(npm `.cmd` 심 대비). 각 후보에 `sanitize_pty_env` 적용:
   - `TERM=xterm-256color`, `COLORTERM=truecolor`, `NO_COLOR` 제거
   - `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID` 등 상속된 Claude 변수 제거 (앱을 Claude Code 안에서 띄웠을 때 자식 세션으로 오인되는 것 방지)
   - `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`, `GIT_TERMINAL_PROMPT` 제거
   - 앱 신원: `PATH`에 exe 폴더 앞세움, `EQMUX_SESSION`, `EQMUX_TOKEN`(새 UUID), `EQMUX_TERMINAL=eqmux`, 있으면 `EQMUX_ROLE_FILE`, `EQMUX_TEAM_FILE`
4. `job::Job::new_kill_on_close()` + `assign_pid(child pid)`.
5. `gen = NEXT_GEN.fetch_add(1)`, `PtySession` 삽입, **잠금 해제**.
6. `AgentRt.session_origin[id] = (ws, dir)` — 셸이든 에이전트든 파이프 요청의 워크스페이스를 여기서 찾는다.
7. `StoreMsg::SessionStart`.
8. reader/coalescer 스레드 시작 (§5.3).

#### 3.3.3 출력 파이프라인 상수

| 상수 | 값 | 위치 | 의미 |
|---|---|---|---|
| 읽기 버퍼 | 8192 B | reader | 한 번의 `read` |
| `QUIET` | 3 ms | coalescer | 이만큼 조용하면 배치 방출 |
| `DEADLINE` | 25 ms | coalescer | 아무리 바빠도 이 안에 방출 |
| `CAP` | 256 KB | coalescer | 배치 최대 크기 |
| 리사이즈 직후 400 ms | quiet 25 / deadline 250 ms | coalescer | ConPTY 전체 재그리기를 한 프레임으로 합침 |
| 로그 파일 | `%USERPROFILE%\.eqmux\logs\<id>.log` | reader | 원시 바이트 append |

reader는 UTF-8 경계에서 잘린 꼬리(≤3 B)를 다음 read로 넘긴다(`take_complete_utf8`). 이게 없으면 한글·박스문자·이모지가 `U+FFFD`로 깨져 셀 폭이 어긋난다.

#### 3.3.4 `pty_resize`가 async인 이유

`ResizePseudoConsole`은 **출력 파이프가 가득 차면 돌아오지 않는 블로킹 호출**이다. 0.3.8 이전에는 전역 잠금을 쥔 채 메인 스레드에서 불렀고, 페인 하나를 지우면 나머지 페인 전부가 동시에 리사이즈되면서 앱이 멈췄다. 지금은:

1. 전역 잠금 안에서 `resize_hint` 갱신, `resize_seq` 증가, `master`와 `resize_seq` `Arc` 복제 → 잠금 해제
2. `spawn_blocking`에서 `master` 잠금 → `resize_is_current(seq)` 확인 (더 새 요청이 있으면 그냥 `Ok`) → `m.resize(...)`

#### 3.3.5 세션 종료 경로

| 경로 | 함수 | `expected_exit` 표식 | 결과 |
|---|---|---|---|
| 사용자 중지 | `pty_kill` | 삽입 (토스트 억제) | 백그라운드 teardown + `session-kill` 이벤트 |
| 재개/권한 재시작 | `kill_pty_for_restart` | 삽입 | teardown 후 `agent_spawn_inner(resume=…)` |
| 앱 종료 | `app_exit` | — | 전 세션 `\x03` → 500 ms → drain+kill → 200 ms → flush 1 s → `running.flag` 삭제 → `exit(0)` |
| 프로세스 자연 종료 | reader EOF | — | `gen` 일치 시 map에서 제거, `child.wait()`, `pty-exit`, `agent::on_pty_exit` |

`teardown_session_in_background`는 `job.terminate() → child.kill() → drop(PtySession)` 순이며 ConPTY drop은 reader가 비울 때까지 기다리므로 반드시 스레드에서 한다.

#### 3.3.6 에이전트 스폰 — `agent_spawn_inner`

`agent_spawn`(새 UUID) / `agent_resume`(`--resume`) / `agent_restart`(같은 UUID, 새 권한)가 공유한다.

- P-8 이중 호출 가드: PTY가 살아 있고 tracking이 `dead`가 아니면 **기존 UUID를 그대로 돌려준다**.
- argv (§7.5): `--session-id|--resume <uuid>`, `--name`, `--permission-mode`, `--disallowedTools`(비어 있지 않을 때), `--settings <hook-settings.json>`(파일이 있을 때), `--append-system-prompt <sys>`.
- `bypassPermissions`·`--dangerously-skip-permissions`는 **어떤 경로로도 만들지 않는다**.
- 성공 시 `Tracked{status:"starting"}` 삽입, `StoreMsg::AgentSession`(재개 앵커 저장), `emit_state`.

### 3.4 `ipc.rs` / `cli.rs` — 명명 파이프와 CLI

- 파이프 이름: `\\.\pipe\eqmux-bus-<USERNAME, 비영숫자→'_'>`.
- 서버: `CreateNamedPipeW(DUPLEX, BYTE, PIPE_UNLIMITED_INSTANCES, 64 KB)` accept 루프 1개 → 연결마다 스레드 1개, `MAX_CONNS = 32` 초과분은 즉시 닫는다 (`ponytail:` 표기된 상한). 읽기 타임아웃은 없다.
- 프레이밍: **JSON 한 줄 요청 → JSON 한 줄 응답**. 스키마·오류 코드는 §7.3.
- 클라이언트(`ipc::request`): 파일처럼 열어(`OpenOptions::read+write`) 3회 시도, 100 ms 간격.
- `verify_session`: 요청의 `token`이 `AgentRt.session_tokens[session]`과 같아야 한다 (`BAD_TOKEN`). 워크스페이스·cwd는 `crate::session_origin`(tracking → `session_origin` 순).
- `resolve_recipient`: `@all`/빈값 → `@all`; `@` 포함 → 세션 id 그대로; 아니면 `team.json` roster에서 `persona`/`persona_name`/표시 이름으로 찾아 `<persona>@<ws>`; 실패 → `UNKNOWN_RECIPIENT`.
- `cli.rs`: 서브커맨드 파싱(플래그 순서 무관), stdin은 64 KB까지, `_hook`/`_statusline`은 **어떤 실패에도 exit 0**(에이전트 흐름 불가침). PowerShell의 `@` 스플래팅 함정을 사용법 문자열이 직접 안내한다.
- `SessionStart` 훅은 파이프에 닿기 **전에** `EQMUX_ROLE_FILE`을 읽어 `hookSpecificOutput.additionalContext`로 역할 본문(+ 캐릭터 시트 ≤ 20,000자)을 stdout에 낸다. 앱이 죽어 있어도 역할은 실린다.

### 3.5 `job.rs` — Job Object

| 함수 | OS API | 비고 |
|---|---|---|
| `new_kill_on_close()` | `CreateJobObjectW` + `SetInformationJobObject(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)` | 실패하면 `None` — 세션은 degraded로 계속 |
| `assign_pid(pid)` | `OpenProcess(SET_QUOTA\|TERMINATE)` → `AssignProcessToJobObject` | 자손은 자동 상속 (`pwsh → claude → node …`) |
| `terminate()` | `TerminateJobObject(h, 1)` | |
| `pids()` | `QueryInformationJobObject(JobObjectBasicProcessIdList)` | 128부터 시작해 최대 4회 버퍼 확장. 고정 버퍼였을 때 `ERROR_MORE_DATA`로 전부 빈 목록이 되는 사고가 있었다 (`0d8f125`) |
| `memory_bytes()` | `PeakJobMemoryUsed` + pid별 `WorkingSetSize` 합 (최대 128 pid) | 10초 샘플링(프런트 `memory.ts`) |
| `Drop` | `CloseHandle` | 마지막 핸들이 닫히면 OS가 트리를 죽인다 → 앱이 크래시해도 자식이 남지 않는다 |

### 3.6 `agent.rs` / `agentscan.rs` — 상태 머신과 탐지

상태 머신 자체는 §6.1에 표와 다이어그램으로 있다. 여기서는 구조만.

- 상태는 `String`이다. 닫힌 어휘는 프런트 `AgentStatus`(§2.2)에 있고 Rust에는 enum이 없다.
- 이벤트 소스 5개: 레지스트리 파일(1차, `scan`) · 훅(2차, `apply_hook`) · statusLine(`apply_statusline`) · PTY EOF(`on_pty_exit`) · 스폰(`starting`). 전부 `emit_state`로 합류한다.
- `hook_effect`(`agent.rs`)는 **`AppHandle` 없이 도는 순수 함수**라 테스트가 전이 규칙을 직접 고정한다. 새 훅 이벤트를 다룰 땐 여기서 시작한다 (§10.7).
- 감시 스레드: `notify` 워처 + `recv_timeout(2000 ms)` 안전 재스캔. 버스트는 채널을 비워 한 번의 `scan`으로 합친다.
- 입양(adopt): 앱이 띄우지 않은 `claude`(사람이 페인에 직접 친 경우)는 레지스트리의 `pid`가 어느 페인의 Job 트리에 있는지로 페인을 찾는다. `kind == "interactive"`인 레코드만 후보다 (`bg`를 입양하면 서브에이전트가 페인의 에이전트로 둔갑해 재개 앵커를 덮어쓴다, `47bde8b`).
- **교착 주의**: `by_uuid` 잠금 안에서 `crate::session_origin`(같은 뮤텍스를 다시 잠금)을 부르면 `std::Mutex`는 재진입이 안 되므로 감시 스레드가 영구히 멈춘다. 잠금 밖에서 스냅샷을 먼저 뜬다.
- `agentscan.rs`: Job 트리의 프로세스 이름(`process_name`)을 알려진 CLI 10종(`claude codex gemini copilot aider opencode goose cursor-agent qwen amp`)과 대조. 인터프리터(`node`, `bun`, `python*` …)면 `ReadProcessMemory`로 PEB의 명령줄을 읽어 다시 대조. `managed`는 `claude`만 `true`.

### 3.7 `store.rs` — SQLite

- 위치: `<root>/workspaces/<sanitize(ws)>/session.db`. `sanitize`는 `[A-Za-z0-9-_.]` 외 → `_`.
- `open_db`(쓰기): `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=500`, `SCHEMA` 실행, `ALTER TABLE scrollback ADD COLUMN styled`(무시 가능), FTS5 가상 테이블, 30일 보존 삭제, `trim_to_cap`. 읽기 경로는 전부 `SQLITE_OPEN_READ_ONLY`.
- writer 스레드: `sync_channel(50_000)`(가득 차면 PTY reader가 뒤로 밀린다 = 배압), `recv_timeout(100 ms)` 또는 `BATCH_MAX = 200`건 중 먼저. `Flush(ack)`는 즉시 커밋 후 응답. 워크스페이스별 `Connection`을 `HashMap`에 캐시.
- 상한: `SCROLLBACK_CAP_PER_SESSION = 1_000`줄(0.3.7에서 10만→1천), `CAP_CHECK_EVERY = 200`줄마다 초과분 삭제, `RETENTION_DAYS_MS = 30일`. 지우는 것은 **스크롤백 본문과 FTS 미러뿐**이며 세션·이벤트·메시지·재개 앵커는 남긴다.
- `LineAssembler`: VT 시퀀스를 벗겨 확정된 줄만 `text`로, 동시에 `ESC[…m`(SGR)만 남긴 `styled`를 만든다. `\r`은 두 버퍼를 비우고(진행바 덮어쓰기), 백스페이스는 한 글자 제거, 4000자 넘는 미완 줄은 강제 방출. `is_tui_noise`(박스문자 ≥ 50 %)와 연속 중복 줄은 저장하지 않는다 (FR-C-11: 원시 바이트는 절대 저장하지 않는다).
- `search`: FTS5 `MATCH` → 실패 시 `LIKE` 폴백. 토큰마다 큰따옴표로 감싸 연산자 주입을 막는다. limit ≤ 200.
- `page`: `seq < cursor ORDER BY seq DESC LIMIT n` → 바깥에서 ASC. limit ≤ 500.
- `purge_scrollback`: `DELETE` 두 테이블 → `wal_checkpoint(TRUNCATE)` → `VACUUM` (행만 지우면 파일 크기가 그대로다).
- `exit_code`: `SessionExit`는 `code.unwrap_or(-1)`을 쓴다. **NULL은 "크래시로 끝났다"의 예약값**이다 (`crash_scan`이 `exit_code IS NULL`을 찾는다).

### 3.8 `workspace.rs` — 등록부, git 실행, 워크트리

- 등록부 `<root>/workspaces.json`: `[{id,name,path,remote?,branch?,last_used}]`. 변경 경로는 `load_strict`(깨진 파일이면 `Err`)를 써서 `[]`로 덮어쓰는 사고를 막는다. 저장은 `atomic_write`(`<파일명>.tmp` → `sync_all` → `rename`).
- 최대 10개 동시 오픈은 **Rust가 강제하지 않는다**. 프런트 `mock.ts`의 `MAX_OPEN_WORKSPACES`가 막는다.
- `git_within`: `git -c core.quotepath=off <args>`, `stdin=null`(자격증명 프롬프트로 멈추지 않게), stdout/stderr를 별도 스레드가 drain, 20 ms 폴링으로 `GIT_TIMEOUT = 60 s`(clone은 `GIT_TIMEOUT_LONG = 1 h`), `CREATE_NO_WINDOW`. `core.quotepath=off`가 없으면 한글 파일명이 8진수로 나와 파싱이 깨진다.
- 워크트리: `<ws>/.eqmux/worktrees/<session>` + 브랜치 `eqmux/<name>`. `worktree_create`는 idempotent(`.git` 파일 존재 시 반환), `git worktree prune` 후 base를 **구체 커밋 해시로 먼저 해석**한다 — 이름을 그대로 넘기면 git의 DWIM이 `-b`를 이기고 공유 저장소에 원격 추적 브랜치를 몰래 만든다 (B42). 삭제 기능은 의도적으로 없다 (FR-E-64).
- `ws_checkout`: `git checkout --end-of-options <branch>` → 실패 시 `-b`. `--`는 쓰지 않는다 (브랜치가 pathspec이 되어 파일을 복원해 버린다).

### 3.9 `team.rs` · `roles.rs` · `missions.rs` · `library.rs` — 파일 계약

파일 형식은 §8.3에, 합성 알고리즘은 아래에.

**역할 파일 합성 (`roles::save`)** — 출력 순서가 고정돼 있고 테스트가 `판단 성향 < 캐릭터 < 책임` 순서를 단언한다("화법은 판단·책임 규칙보다 앞설 수 없다").

1. `ensure_gitignore` (`.eqmux/.gitignore`에 `roles/`, `worktrees/` 보장)
2. 기존 파일에서 **임무 블록을 보존**(`strip_mission_block`)
3. frontmatter: `session · persona · job · permissions{write,commit,push} · mission?(보존 시) · updated`
4. 본문(비어 있지 않은 것만): `# 페르소나 — 직무` → `## 판단 성향` → `## 말투`(mid) → `## 성격`(mid) → `## 캐릭터`(adv, **경로 포인터만**) → `## 책임` → `## 금지` → `## 팀 관계 (team.md 참조)` 표 → 보존한 임무 블록
5. `atomic_write`, 절대 경로 반환

**임무 배정 (`roles::set_mission`)** — `<!-- EQMUX:MISSION <id> -->` … `<!-- /EQMUX:MISSION -->` 블록을 역할 파일에 넣는다. 같은 임무 재배정은 idempotent, 다른 임무는 블록 교체, 해제는 블록 삭제. 닫는 마커가 없으면 손대지 않는다. 역할 파일이 없는 기본 터미널에는 `session:`만 있는 최소 스텁을 만든다. **워크트리 세션은 워크트리 안의 `.eqmux/roles/`에 쓴다**(`sess.cwd || ws.path`) — 루트에 쓰면 에이전트가 읽는 파일엔 임무가 없는데 화면엔 ✓가 뜬다 (B59).

**라이브러리 (`library.rs`)** — 2단 병합: 전역 `<root>/{jobs,personas}` → 워크스페이스 `<ws>/.eqmux/{jobs,personas}` 순으로 읽되 같은 id는 **교체**(워크스페이스 승). 프리셋은 전역만. 시드 정책은 비대칭이다.

| 종류 | 시드 조건 | 비고 |
|---|---|---|
| 직무 8종 (`lead plan dev design qa debug docs release`) | 없는 id는 **매 기동마다** 복원 | 고정 로스터 보장 > 부활 금지. `impl/verify/review` 레거시 id는 삭제. push 가능은 `lead`·`release` 둘뿐(테스트가 단언) |
| 페르소나 8종 (`kai noel lin sol mira jun hana luca`) + `luca.character.md` | `personas/` 디렉터리가 없을 때만 | 지운 페르소나는 돌아오지 않는다 |
| 프리셋 4종 (`standard dev-heavy product quality`) | `presets/`가 없거나 레거시 `02-impl-heavy.json`이 있을 때 | 직무만 담는다, 페르소나는 캐스팅 화면이 정한다 |

외부 편집 충돌(P-7): 읽을 때의 `mtime_ms`를 저장 시 `expected_mtime_ms`로 넘긴다. 다르면 `CONFLICT — 파일이 밖에서 바뀌었습니다`. `fsx::write_file`도 같은 규칙이다.

### 3.10 `messages.rs` — 메시지 원장

- `TYPES = [ask, handoff, report, review, escalate]`, `MAX_BODY_CHARS = 2000`(문자 수), `RATE_PER_MIN = 10`(워크스페이스×발신자, 60초 슬라이딩 창).
- Rust는 **검증·속도 제한·원장**만 맡는다. 전달(주입) 결정은 프런트 `conversation.ts`가 한다 (§6.3).
- `send`는 `read = (from == "나")`로 저장한다. 사람이 보낸 행은 태어날 때부터 읽음 상태고, 미읽음은 사람의 배지일 뿐 전달 플래그가 아니다.
- 두 발신 경로(`msg_send` 커맨드, 파이프 `send/report`)가 모두 `messages::send` + `app.emit("message-new")`로 끝나므로 **수신 경로는 하나**다.
- `export_markdown`: 행 단위 스트리밍, 날짜 바뀔 때 `## YYYY-MM-DD`, 행은 `**HH:MM · from → to** \`KIND\``. 표시 이름 매핑은 프런트가 넘긴다.

### 3.11 `transcript.rs` — Claude Code JSONL 읽기

- 경로: `~/.claude/projects/<cwd의 비영숫자→'-'>/<uuid>.jsonl`. cwd가 경로에 박혀 있으므로 **재개는 같은 cwd에서만** 된다 (FR-D-21).
- `TAIL_WINDOW = 2 MB` 꼬리만 읽고 첫 부분 줄을 버린다(`windowed = true`).
- `type ∈ {user, assistant}`만 턴으로. `tool_use` → `⚙ 이름` 턴(+ `file_path/command/pattern/…` 중 첫 키로 요약), `tool_result`는 `tool_use_id`로 짝을 맞춘다 (병렬 도구 호출에서 결과가 뒤바뀌던 B65 수정). 인식 못 한 줄은 `skipped`로 센다.
- 턴이 0개면 `Err` → `transcript_read`가 같은 cwd의 최신 `*.jsonl`을 추측(`guessed = true`) → 그것도 실패하면 프런트가 스크롤백으로 폴백한다.

### 3.12 나머지 모듈 한 줄 요약

| 모듈 | 역할 | 핵심 |
|---|---|---|
| `diff.rs` | 읽기 전용 side-by-side diff | `git diff -U999999`로 hunk를 없애고 양쪽 배열 길이를 항상 같게(`pad` 행). 워크트리 모드(HEAD↔트리)와 커밋 모드(부모↔커밋). 해시는 `valid_hash`로 검증 후에만 git 인자로. `MAX_LINES_PER_SIDE = 3000` |
| `fsx.rs` | 탐색기 백엔드 | `SKIP_DIRS`(.git node_modules target dist .vite), `MAX_ENTRIES 400`, `MAX_DEPTH 3`, 미리보기 64 KB, 편집 1 MB. 모든 경로는 `canonicalize` 후 `starts_with(base)` + `.git` 재검사(심링크 우회 방지). 삭제는 휴지통만(폴백 없음). 이름 바꾸기는 같은 부모 안에서만(이동 = 탈출 수단). `reveal_path`만 워크스페이스 밖 허용(임시 붙여넣기 이미지) |
| `ports.rs` | 포트 관측 | `netstat -ano -p TCP` 파싱, `LISTENING`만, `(host,port,pid)` 중복 제거, Job pid 목록과 조인해 세션 귀속 |
| `browser.rs` | 브라우저 패널 + CLI 조종 | 라벨 `panel-browser`인 **자식 WebView2 1개**(`Window::add_child`). http/https만, 그 외 내비게이션은 차단. 메인 웹뷰 위에 그려지므로 다이얼로그·탭 전환 시 숨겨야 한다. `eqmux browser`(§7.4)의 동작도 여기 산다 — 원시 연산은 `eval_text()` 하나(WebView2 `ExecuteScript` + UI 스레드 콜백을 채널로 수신)이고 snapshot·click·type은 그 위의 JS 문자열이다. **방향은 앱 → 페이지 한쪽** — 패널 웹뷰는 capabilities에 없어 원격 페이지가 Tauri 커맨드를 부르지 못한다 |
| `clip.rs` | 네이티브 클립보드 | WebView2의 웹 Clipboard API가 조용히 실패해서 `arboard`로. 이미지는 `%TEMP%\eqmux-pastes\paste-<ms>.png`로 저장 후 경로를 터미널에 입력 |
| `diag.rs` | 화면 손상 진단 | `%USERPROFILE%\.eqmux\logs\diagnostics.log`(4 MiB 자름). 배율·모니터·자식 웹뷰 rect 기록. **자동 보정 없음** — 증상을 감추면 원인도 사라진다 |
| `recovery.rs` | 비정상 종료 감지 | `running.flag`가 남아 있으면 dirty. 등록된 워크스페이스의 DB에서 `exit_code IS NULL` 세션을 최대 8/16개 모아 `CrashReport`. 첫 호출에서 플래그를 소비(`mem::take`) |

---

## 4. 프런트엔드(SolidJS) 모듈 가이드

### 4.1 디렉터리와 레이어

```
src/
├─ main.tsx            render(<App/>)  — 7줄
├─ App.tsx             앱 셸: 화면 스위치, 오버레이, 부트스트랩 onMount, 전역 단축키, 창 닫기 가로채기
├─ state.ts            전역 시그널 (view, overlay, panel*, paneLayout*, selectedSession, focusRequest …)
├─ types.ts            도메인 타입 + 순수 판단 함수 (translatePermissions, canInject …)
├─ jobs.ts             JOB_META 고정 8직무 배지
├─ i18n.ts, i18n/*.ts  t()/tf() — 한국어 원문이 키
├─ screens/            화면 (Dashboard, ControlCenter, TeamCasting, RoleLibrary, Settings …)
├─ components/         재사용 요소 (TerminalPane, SidePanel, *PanelTab, ContextMenu …)
└─ backend/
   ├─ mock.ts          MockBackend — 인메모리 도메인 모델 + hydrate 진입점 (이름과 달리 실모드의 중심)
   ├─ pty.ts           PTY 클라이언트: spawn/write/resize/kill, 출력 버퍼, 사람 타이핑 추적
   ├─ agent.ts         agent-state 구독, spawn/resume/restart 래퍼, staleSeq
   ├─ conversation.ts  메시지 버스 클라이언트: 전달 결정 · 인박스 · 주입 포맷
   ├─ team.ts, roles.ts, missions.ts, library.ts, workspaces.ts, git.ts, panels.ts, settings.ts, layout.ts …
   └─ *.test.ts        vitest (순수 함수만)
```

레이어 규칙: **screens/components → state/types + backend/**. `backend/*.ts`만 `invoke`/`listen`을 부른다. 화면이 직접 `invoke`를 부르는 곳은 없다.

### 4.2 화면 라우팅 — `View` 유니언과 오버레이

라우터 라이브러리는 없다. `state.ts`의 `view` 시그널(판별 유니언)과 `overlay` 시그널(하나만) 두 개다.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> control
  state "control<br/>Dashboard" as control
  state "workspace(id)<br/>ControlCenter" as workspace
  state "launch(wsId)<br/>LaunchMode" as launch
  state "terminalSetup(wsId)<br/>DefaultTerminalSetup" as tsetup
  state "casting(wsId)<br/>TeamCasting" as casting
  state "composition(wsId)<br/>TeamComposition" as composition
  state "missions(wsId)<br/>Missions" as missions
  state "gitdiff(wsId, commit?)<br/>GitDiffEditor" as gitdiff

  control --> workspace : 셀 클릭 / 탭 / Ctrl+Shift+D
  workspace --> control : 관제 탭 / Ctrl+Shift+D
  control --> casting : 빈 슬롯 · 캐스팅
  launch --> tsetup : 터미널 모드
  launch --> casting : 팀 모드
  tsetup --> workspace : 터미널 열기
  casting --> composition : applyCasting
  composition --> workspace : 확정
  workspace --> missions : 팀 ▾ 메뉴
  workspace --> casting : 팀 ▾ 메뉴
  workspace --> composition : 팀 ▾ 메뉴
  workspace --> gitdiff : git 패널 커밋 클릭
  gitdiff --> workspace : back
  missions --> workspace

  note right of launch
    오버레이 connect(WorkspaceConnection)에서
    open(id) → setView(launch)
  end note
```

| 오버레이 (`OverlayKind`) | 컴포넌트 | 여는 곳 |
|---|---|---|
| `connect` | `WorkspaceConnection` | 앱바 `+` / `워크스페이스`, 대시보드 "재지정" |
| `roles` | `RoleLibrary` | 앱바 `역할` |
| `settings` | `Settings` | 앱바 `설정` |
| `explorer` | `ScreenOverlay` 안에서 `MissionExplorerTab` ↔ `Missions` 세그먼트 | 앱바 `임무`, 레일 `로컬 폴더` |

`setView()`는 항상 `setOverlay(undefined)`를 함께 하고, `id`/`wsId`가 있으면 `lastWorkspaceId`를 갱신한다. 모달 3종(`ExitDialog`, `CrashRecovery`, `LayoutPicker`)은 오버레이와 별개 `<Show>`다.

### 4.3 전역 상태 (`state.ts`) 핵심 시그널

| 시그널 | 타입 | 의미 |
|---|---|---|
| `view` / `setView` | `View` | 현재 화면 |
| `overlay`, `toggleOverlay` | `OverlayKind?` | 전체 화면 오버레이 (하나만) |
| `panelOpen`, `panelTab`, `panelSide`, `openPanel(tab)` | bool, `conversation\|git\|ports\|logs\|browser`, `left\|right` | 사이드 패널 |
| `selectedSession` | `string?` | 선택된 세션 id (레일·페인 강조, 포커스, 상태바 cwd) |
| `terminalFull` | bool | 터미널 전체 화면 |
| `paneLayouts`, `paneLayout()`, `setPaneLayout` | `Record<ws\|"_default", PaneLayout>` | **워크스페이스별** 배치 |
| `paneRatios`, `ratioFor`, `setRatioAxis` | `Record<ws, Record<PaneLayout, {cols?,rows?}>>` | **워크스페이스×배치별** 분할비 |
| `defaultShell` | `ShellChoice` (`pwsh` 기본) | 새 터미널 셸 |
| `tick` | number | `backend.subscribe`가 올림. `scopeWorkspace()` 등이 의존 |
| `focusRequest`, `focusSession()` | `{session}` | 대시보드 → 페인 전체 화면 + 포커스 |
| `browserRequest`, `openInBrowserPanel(url)` | `{url}` | 포트 패널·`eqmux browser open` → 브라우저 패널 |
| `activeWorkspaceId()`, `scopeWorkspace()` | | 패널들의 스코프. **"첫 번째 열린 워크스페이스" 폴백은 없다** (조용히 다른 팀을 가리키던 사고 방지) |

### 4.4 `backend/` 브리지 — 모듈별 invoke · listen 매핑

| 모듈 | 주요 export | `invoke` 커맨드 | `listen` 이벤트 |
|---|---|---|---|
| `pty.ts` | `spawnPty writePty resizePty killPty scrollbackTail listAlivePty noteUserInput humanTyping echoPty forgetAgent clip* openExternal revealPath` | `pty_spawn pty_write pty_resize pty_kill pty_list scrollback_tail store_usage_real store_purge_scrollback agent_forget clip_read_text clip_write_text clip_save_image session_log_dir open_log_dir open_external reveal_path` | `pty-output`, `pty-exit` |
| `agent.ts` | `ensureAgentListeners applyAgentSnapshot spawnAgent resumeAgent restartAgent staleSeq` | `agent_snapshot agent_spawn agent_resume agent_restart` | `agent-state` |
| `conversation.ts` | `startMessageBus refreshConversation sendConversation exportConversation flushInboxOnState pendingInbox fmt batches` | `msg_list msg_send msg_export msg_mark_read cache_get cache_set` | `message-new` |
| `team.ts` | `loadTeam ensureWorktree startTeamSync flushTeamNow restoreTeams` | `team_load worktree_ensure team_save role_save` | — |
| `roles.ts` | `buildRolePayload saveRoleFile removeRoleFile nudgeRoleReload` | `role_save role_remove` | — |
| `missions.ts` | `refreshMissions createMission cycleMissionStatus toggleAssign setDefaultMission autoAssignDefault` | `mission_list mission_create mission_set_status mission_assign mission_set_default` | — |
| `library.ts` | `refreshLibrary savePersonaFile … listMergedLibrary listPresets` | `library_list library_save_persona library_delete_persona library_character_* library_save_job library_delete_job preset_list` | — |
| `workspaces.ts` | `refreshWorkspaces pickFolder registerWorkspace gitInit cloneRepo unregisterWorkspace repathWorkspace touchWorkspace checkoutBranch` | `ws_registry ws_pick_folder ws_register ws_git_init ws_clone ws_unregister ws_repath ws_touch ws_checkout` | — |
| `git.ts` | `gitOverview worktreeList branchList worktreeAdd worktreeAttach diffChangedFiles diffFile commitChangedFiles commitFileDiff` | `git_overview git_worktrees git_branches worktree_add worktree_attach diff_* commit_*` | — |
| `panels.ts` | `portsSnapshot fsTree fsPreview fsRead fsWrite fsCreate fsRename fsDelete searchScrollback pageScrollback exportScrollback cleanScrollback` | `ports_snapshot fs_* scrollback_search scrollback_page scrollback_export` | — |
| `events.ts` | `queryEvents queryGlobalEvents` | `events_query` | — |
| `settings.ts` | `settings updateSettings maxSlots loadSettings toggleMuted` | `settings_load settings_save` | (DOM `eq-tokens-changed` 발행) |
| `layout.ts` | `restoreLayout startLayoutSync flushLayoutNow` | `layout_load layout_save` | — |
| `flags.ts` | `restoreUnseen startUnseenSync flushUnseenNow` (**미확인 표식**, 실행 플래그 아님) | `cache_get cache_set` (`unseen`) | — |
| `watch.ts` | `startFileWatch fileChangeTick` | `ws_watch ws_unwatch` | `eqmux-file-change` |
| `browser.ts` | `browserOpen browserBounds browserVisible browserNav browserClose onBrowserNav startBrowserRequests` | `browser_*` | `browser-nav` `browser-request` |
| `diag.ts` | `startDiagnostics diagSnapshot computeDrift` | `diag_note diag_geometry diag_log_path` | `diag-geometry` |
| `memory.ts` | `startMemorySampling` (10 s) | `sessions_memory` | — |
| `agentprobe.ts` | `startAgentProbe` (5 s), `agentClis` | `sessions_agents agent_clis` | — |
| `ports.ts` | `startPortWatch holdFastPoll sessionPorts systemPorts foldPortRows` | (panels 경유) | — |
| `recovery.ts` | `crashRecovery` | `crash_recovery` | — |
| `shutdown.ts` | `performShutdown` | `shutdown_flush app_exit` | — |
| `transcript.ts` | `readTranscript` | `transcript_read` | — |

### 4.5 `MockBackend`(`mock.ts`) — 이름과 다른 실제 역할

- `export const backend: Backend = new MockBackend()` 하나뿐이다. **런타임 목 스위치는 없다.** `isTauri()`(`"__TAURI_INTERNALS__" in window`)가 false인 순수 브라우저(`vite dev`)에서만 시드 데이터가 남고, Tauri 안에서는 모듈 로드 시 `WORKSPACES/SESSIONS/MISSIONS/EVENTS/MESSAGES`를 비운다.
- 실모드에서는 `createMutable` 스토어를 **브리지가 hydrate**한다: `hydrateWorkspaces`, `hydrateLibrary`, `hydrateTeam`, `hydrateMissions`, `hydrateMessages`, `hydrateUnseen`, `applyAgentState`, `applyMemory`, `applyAgents`, `sessionExited`.
- `subscribe(cb)`는 30초 간격으로 `sinceMs`를 재계산하며 브로드캐스트한다. 이 타이머는 **재그리기 트리거일 뿐**이고 경과 시간의 원천은 Rust가 보낸 `sinceMs`다 (백그라운드에서 덜 세던 버그, `2e96781`).
- `logEvent()`는 `events_log`로 워크스페이스 DB의 `event` 테이블에도 남긴다 (프런트 발 사건이 피드에서 빠지던 문제).
- 세션 팩토리의 `resumable` 기본값은 **false**다. 실측(`team.json`의 `agentSessionId`, `agent-state`)만 true로 올린다.

### 4.6 부트스트랩 순서 (`App.tsx onMount` → `workspaces.refreshWorkspaces`)

```mermaid
sequenceDiagram
  autonumber
  participant App as App.tsx
  participant PTY as pty.ts
  participant WS as workspaces.ts
  participant SET as settings.ts
  participant LIB as library.ts
  participant TEAM as team.ts
  participant AG as agent.ts
  participant LAY as layout.ts
  participant Rust as Rust

  App->>PTY: ensurePtyListeners(), setPtyExitHook
  App->>WS: refreshWorkspaces()
  WS->>SET: loadSettings()  (settings_load — maxSlots·startView 필요)
  WS->>Rust: ws_registry
  WS->>WS: hydrateWorkspaces, 유령 view 정규화
  WS->>LIB: refreshLibrary() (library_list)
  WS->>TEAM: flushTeamNow() 후 restoreTeams()
  TEAM->>Rust: team_load (ws마다) · pty_list
  TEAM->>TEAM: hydrateTeam → 살아 있는 PTY는 reviveOrphan
  TEAM->>AG: applyAgentSnapshot() (agent_snapshot)
  WS->>Rust: cache_get "unseen" → restoreUnseen, startUnseenSync
  WS->>Rust: refreshMissions + refreshConversation (열린 ws 병렬)
  WS->>LAY: restoreLayout() (layout_load) → startLayoutSync()
  App->>AG: ensureAgentListeners()
  App->>App: startTeamSync, startMessageBus, startMemorySampling, startAgentProbe, startFileWatch, startPortWatch, startDiagnostics
  App->>Rust: crash_recovery → dirty && sessions>0 이면 CrashRecovery 표시
  App->>App: onCloseRequested 가로채기, 단축키 등록
```

순서에 의미가 있는 지점 두 곳: `loadSettings`가 맨 앞인 이유는 `maxSlots`가 팀 하이드레이션에 필요해서고, `flushTeamNow`가 `restoreTeams` 앞인 이유는 저장 대기 중인 `team.json`을 오래된 파일로 다시 읽지 않기 위해서다.

### 4.7 `TerminalPane.tsx` — xterm 인스턴스 수명주기

```mermaid
stateDiagram-v2
  [*] --> Created : createEntry(sessionId)
  Created : Terminal 생성 (scrollback 5000, allowProposedApi)
  Created : 애드온 unicode-graphemes → fit → search → web-links
  Created --> Opened : attach(host) — term.open, WebglAddon(try)
  Opened --> Initialized : initSession (1회, entry.initialized)
  Initialized : onPtyOutput → term.write, onPtyExit → 빨간 종료 줄
  Initialized : onData → noteUserInput + writePty
  Initialized : scrollbackTail 재생 → 경계선
  Initialized : revive 아니면 spawnPty(셸만) → fireSessionReady
  Initialized --> Detached : onCleanup (DOM만 떼어냄, term 유지)
  Detached --> Opened : 재마운트 — host.appendChild(term.element)
  Initialized --> [*] : disposeSessionTerminal (pty.forgetAgent 경유)
  Detached --> [*] : disposeSessionTerminal
```

- **세션당 `Terminal` 1개**가 모듈 레벨 `REGISTRY: Map<string, TermEntry>`에 산다. 줌·전체 화면·탭 전환은 DOM 노드만 다시 붙이고 버퍼는 다시 쓰지 않는다.
- **자동 스폰은 셸뿐**이다(shell-first). 에이전트는 `launchAgentInSession`이 `killAndWait` 후 `spawnAgent`로만 띄운다. `needsAgent(s) = roleAgent(s) && status === "shell" && !s.agent` — 프로세스 탐지(`agentprobe`)가 무언가를 보면 기동 버튼이 숨는다. 페인 하나에 에이전트 하나.
- 폐기는 `disposeSessionTerminal` 하나로 모이고 `pty.forgetAgent`가 그것을 부른다 (B44). 세션 id가 결정적이라 잔재가 남으면 다음 점유자가 `initialized` 가드에 걸려 셸이 안 뜬다.
- 리사이즈: `ResizeObserver` → 100 ms 디바운스 `syncSize` → `proposeDimensions` → 바뀌었을 때만 `term.resize` + `resizePty`. 드래그 종료 350 ms 후 한 번 더. 0 크기 가드(40×24 px 미만 무시).
- 키: `Ctrl+Shift+C` 복사, 선택 있는 `Ctrl+C` 복사(없으면 SIGINT), `Ctrl+V`/`Ctrl+Shift+V` 붙여넣기, `Ctrl+F` 검색바, `Esc` 검색 닫기. 처리한 키는 반드시 `preventDefault()` — `false` 반환만으로는 브라우저 paste가 한 번 더 들어간다 (붙여넣기 중복 사고).
- 붙여넣기: 이미지 우선(`clip_save_image` → 경로 입력), 텍스트는 bracketed paste면 그대로, 아니면 끝 개행 제거 후 개행이 남으면 확인 카드 (줄마다 실행되던 사고).
- 링크: URL은 `openExternal`, 절대 경로는 `pathLinkProvider` → `revealPath`. 더블클릭은 `revealFromTerminal`.
- 드래그 앤 드롭: `getCurrentWebview().onDragDropEvent` 앱당 1회 등록, 경로를 따옴표로 감싸 입력.
- 테마: `--eq-term-*` CSS 토큰. `eq-tokens-changed` DOM 이벤트에 전 인스턴스가 `options.theme`를 갱신.

### 4.8 페인 배치 6종과 분할비

| 키 | 이름 | 기본 트랙 |
|---|---|---|
| `grid-col` | 그리드 · 열 우선 | cols `max/2` 균등, rows 2 |
| `grid-row` | 그리드 · 행 우선 (기본) | 동일 |
| `stack-v` | 세로 스택 | rows `max` |
| `row-h` | 가로 나열 | cols `max` |
| `main-right` | 메인 + 우측 스택 | cols `[2/3, 1/3]` |
| `main-bottom` | 메인 + 하단 나열 | rows `[2/3, 1/3]` |

`PaneDividers.tsx`가 CSS grid 템플릿(`minmax(0, Xfr)`)을 만들고 분할선 드래그를 처리한다 (`GAP = 8 px`은 `.terminal-grid` gap과 같아야 함, 트랙 최소 `MIN = 0.08`). 더블클릭은 그 축을 기본값으로. 줌 상태에서는 분할선을 그리지 않는다. 분할비는 `layout.json`의 `paneRatiosByWs`에 워크스페이스별로 저장된다.

### 4.9 `layout.ts` / `settings.ts` — "실패한 로드가 기본값으로 덮어쓰지 않게"

두 모듈 모두 같은 방어를 한다: `load`가 실패하면 `loadOk`를 세우지 않고 **저장 동기화를 시작하지 않는다**. 이게 없으면 첫 변경이 기본값으로 파일을 덮어쓴다 (`e8f9d10`). 설정은 모듈 로드 시점에 읽기 시작한다(첫 프레임에 설정 오버레이가 열릴 수 있어서).

`AppSettings` 기본값: `startView "control"`, `notifications "waiting-dead"`, `waitingSound false`, `scrollbackReplay 500`, `muted []`, `theme "dark"`, `palette "soft"`, `memBannerMb 0`, `sgrStore true`, `maxSlots 4`, `language "ko"`, `statusLine "full"`. Rust가 읽는 키는 `sgrStore`, `notifications`, `muted`, `language`, `statusLine`(CLI가 파일에서 직접) 다섯이다.

### 4.10 i18n

- 키는 **한국어 원문 그대로**. `t(ko)`는 `settings().language === "en"`이면 `EN[ko] ?? ko`. `tf(ko, vars)`는 `{name}` 치환.
- 사전은 `src/i18n/{common,settings,control,git,roles,missions,session,shell,panels}.ts`의 `dict`를 `Object.assign`으로 합친다(뒤가 이김).
- 렌더 시점에 `t()`를 부른다. 모듈 상수에 넣으면 언어 전환이 반영되지 않는다. 데이터(원장·파일 내용·터미널 출력·git 결과)는 번역하지 않는다.

### 4.11 화면·컴포넌트 책임 요약

| 파일 | 책임 | 부르는 backend |
|---|---|---|
| `screens/Dashboard.tsx` | 워크스페이스 행 × 세션 셀, 주의 순 정렬, 요약 줄, 과부하·메모리 배너, 이벤트 피드, 대기 카드 | `queryGlobalEvents`, `backend.*` |
| `screens/ControlCenter.tsx` (1438줄) | 워크스페이스 화면: 헤더(전체 화면·줌·셸 선택·팀 메뉴), 좌측 레일(세션·워크트리), 페인 그리드+상태바, 세션 상세 드로어, 세션 추가/제거 대화상자, 컨텍스트 메뉴 | `launchAgentInSession resumeAgent killPty worktree* storeUsageReal queryEvents …` |
| `screens/SessionDetailPanel.tsx` | 세션 인스펙터: 상태·실행 플래그·메모리·재개 사유·음소거·이름·역할·권한 오버라이드·세션 이벤트·스크롤백 내보내기. 행동은 점프/재개/재시작/중지뿐 (G7) | |
| `screens/TeamCasting.tsx` → `TeamComposition.tsx` | 프리셋으로 슬롯에 직무+페르소나, 권한 미리보기 → 최종 확인 후 `applyCasting` | `listPresets autoAssignDefault` |
| `screens/RoleLibrary.tsx` | 직무·페르소나 CRUD, 3단계 페르소나, 캐릭터 시트 편집, mtime 충돌 | `library.ts` |
| `screens/Missions.tsx`, `components/MissionExplorerTab.tsx` | 임무 CRUD·배정·기본 임무·브랜치 체크아웃 / 파일 트리·미리보기·편집 | `missions.ts`, `panels.ts` |
| `screens/GitDiffEditor.tsx` | 읽기 전용 side-by-side diff, 변경 이동(`n`/`p`), ±3줄 접기 | `git.ts` |
| `screens/TranscriptPane.tsx` | JSONL 턴 뷰(도구 턴 접기), 스크롤백 폴백, 입력 → PTY | `readTranscript scrollbackTail writePty` |
| `screens/Settings.tsx` | 선언형 섹션. `fixed` 행은 바꿀 수 없는 정책 선언 | `updateSettings agentClis` |
| `screens/WorkspaceConnection.tsx`, `LaunchMode.tsx`, `DefaultTerminalSetup.tsx` | 온보딩 3단계 | `workspaces.ts` |
| `screens/ExitDialog.tsx`, `CrashRecovery.tsx`, `LayoutPicker.tsx` | 모달 | `performShutdown`, `crashRecovery` |
| `components/SidePanel.tsx` + `ConversationTab / GitPanelTab / PortsPanelTab / LogsPanelTab / BrowserPanelTab` | 사이드 패널 5탭 | 각 backend 모듈 |
| `components/ui.tsx` | `StatusLabel`, `PersonaDot`, `ContextMenu`(위험 항목은 마지막 그룹, `note`=정책상 없음) | — |
| `components/CodeEditor.tsx` | CodeMirror 6 래퍼 | — |

---

## 5. 핵심 흐름 (시퀀스 다이어그램)

### 5.1 앱 기동과 종료

```mermaid
sequenceDiagram
  autonumber
  participant OS
  participant main as main.rs
  participant lib as lib.rs run()/setup
  participant St as store writer
  participant Reg as registry watch
  participant Pipe as pipe server
  participant FE as 프런트엔드

  OS->>main: eqmux.exe (인자 없음, EQMUX_SESSION 없음)
  main->>lib: run()
  lib->>lib: 단일 인스턴스 뮤텍스 (있으면 기존 창 포그라운드 후 종료)
  lib->>lib: 버전 와이프 (data.ver ≠ 버전 → settings/jobs/personas/presets 외 삭제)
  lib->>lib: library::seed, write_hook_settings
  lib->>lib: running.flag 있었나? → DirtyStart, 다시 씀
  lib->>St: Store::new → 스레드 시작
  lib->>Reg: start_registry_watch
  lib->>Pipe: start_server
  lib->>lib: WebView2 ProcessFailed → Reload 등록
  lib->>FE: 창 표시 (tauri.conf.json)
  FE->>FE: 부트스트랩 (§4.6)
  Note over FE: … 사용 …
  FE->>FE: onCloseRequested → preventDefault
  alt 살아 있는 세션 있음
    FE->>FE: ExitDialog (세션·재개 가능 여부 표시)
  end
  FE->>FE: performShutdown: flushTeamNow · flushLayoutNow · flushUnseenNow
  FE->>lib: shutdown_flush (Flush(ack), 2초 한도) → false면 "flush-late"
  FE->>lib: app_exit
  lib->>lib: 모든 writer에 \x03 → 500ms → drain → job.terminate/child.kill → 200ms
  lib->>St: flush 1초
  lib->>lib: running.flag 삭제 → app.exit(0)
```

`running.flag` 삭제 줄에 도달하는 것이 "정상 종료"의 정의다. 그 전에 죽으면 다음 기동에서 `crash_recovery`가 dirty를 보고한다.

### 5.2 워크스페이스 열기와 팀 복원

```mermaid
sequenceDiagram
  autonumber
  participant U as 사용자
  participant WC as WorkspaceConnection
  participant WSm as workspaces.ts
  participant Rust
  participant Team as team.ts
  participant Mock as MockBackend
  participant TP as TerminalPane

  U->>WC: 폴더 선택 / 등록된 항목 열기
  WC->>Rust: ws_pick_folder → ws_register(path)
  Rust-->>WC: WsInfo (NOT_A_REPO면 git init 제안)
  WC->>Mock: openWorkspace(id)  (MAX_OPEN_WORKSPACES=10 검사)
  WC->>Rust: ws_touch, ws_watch(ws, path)
  WC->>WC: setView(launch) → 터미널/팀 모드 선택
  Note over Team: 이후 재시작 시 restoreTeams()
  Team->>Rust: team_load(wsId, path)
  Rust->>Rust: team.json 읽기 + agent_session 테이블 + 트랜스크립트 존재 확인 + worktrees/<sid>/.git 확인
  Rust-->>Team: TeamSlotInfo[] (agentSessionId, resumable, worktreePath)
  Team->>Rust: pty_list (웹뷰 리로드 후 살아 있는 PTY)
  Team->>Mock: hydrateTeam(wsId, slots, aliveIds)
  Mock->>Mock: 세션 id = persona@ws, cwd = worktreePath ?? path, restored=true
  Team->>Mock: 살아 있는 id는 reviveOrphan
  Team->>Rust: agent_snapshot → applyAgentSnapshot
  Mock-->>TP: 세션 렌더 → initSession (revive면 스폰 없이 재부착)
```

`team.json`의 `worktree` 플래그는 그대로 보존한다. 경로 존재 여부로 재계산하면 워크트리가 없는 기계(gitignore)에서 열기만 해도 자동 저장이 커밋된 격리 설정을 지운다. 없을 때의 상태는 `worktreeMissing`으로 따로 표시한다.

### 5.3 PTY 스폰과 출력 파이프라인

```mermaid
sequenceDiagram
  autonumber
  participant TP as TerminalPane
  participant pty as pty.ts
  participant cmd as lib.rs pty_spawn
  participant R as reader 스레드
  participant C as coalescer 스레드
  participant St as store writer
  participant X as xterm

  TP->>pty: spawnPty(id, cwd, cols, rows, ws, shell)
  pty->>cmd: invoke pty_spawn
  cmd->>cmd: spawn_pty_session (openpty → 후보 셸 순서대로 → Job Object → 세대 gen)
  cmd->>cmd: session_origin[id]=(ws,cwd), session_tokens[id]=TOKEN
  cmd->>St: SessionStart
  cmd->>R: spawn
  cmd->>C: spawn (mpsc 채널)
  loop 출력이 있는 동안
    R->>R: read 8KB → 로그 파일 append
    R->>R: take_complete_utf8 (잘린 꼬리 이월)
    R->>St: LineAssembler가 확정한 줄 → Line{text, styled}  (TUI 노이즈·중복 제외)
    R->>C: data
    C->>C: 3ms 정적 또는 25ms 마감 또는 256KB
    C-->>TP: emit pty-output {id, data}
    TP->>X: term.write(data)
  end
  R->>R: EOF → 남은 바이트 flush, drop(tx), C.join()
  R->>cmd: gen 일치 시 map.remove(id), child.wait() (잠금 밖)
  R->>St: SessionExit{code}
  R-->>TP: emit pty-exit {id, code}
  R->>R: agent::on_pty_exit → dead
```

입력 방향은 `term.onData → noteUserInput(id, data) → pty_write`. `noteUserInput`은 `\r \n \x03 \x1b`이면 "타이핑 중" 표식을 지우고 그 외 키는 세운다 (60초 TTL). 이 표식이 `canInject`의 두 번째 조건이다.

### 5.4 에이전트 기동 (역할 → 플래그 → claude → 훅)

```mermaid
sequenceDiagram
  autonumber
  participant U as 사용자
  participant CC as ControlCenter
  participant roles as roles.ts
  participant ag as agent.ts
  participant Rust as lib.rs / agent.rs
  participant CL as claude
  participant CLI as eqmux _hook (CLI 모드)
  participant Pipe as ipc.rs

  U->>CC: 세션 추가 · 에이전트 (persona + job + 워크트리 옵션)
  CC->>Rust: worktree_ensure (옵션) → .eqmux/worktrees/<sid>, 브랜치 eqmux/<sid>
  CC->>CC: backend.addRoleSession → autoAssignDefault → whenSessionReady(launchAgent)
  CC->>roles: saveRoleFile(sid) — buildRolePayload (level에 따라 hint/tone/personality/character)
  roles->>Rust: role_save(wsPath, payload) → .eqmux/roles/<sid>.md
  CC->>CC: launchAgentInSession: killAndWait(id) (셸 종료)
  CC->>ag: spawnAgent(id, ws, cwd, name, permissions, cols, rows)
  ag->>ag: translatePermissions → {permissionMode, disallowedTools}
  ag->>Rust: agent_spawn
  Rust->>Rust: uuid v4, argv 조립 (§7.5), 환경 EQMUX_* + hook-settings.json
  Rust->>CL: ConPTY spawn "claude --session-id … --settings … --append-system-prompt …"
  Rust->>Rust: Tracked{starting}, AgentSession 저장, emit agent-state
  CL->>CLI: SessionStart 훅 실행 (stdin JSON)
  CLI->>CLI: EQMUX_ROLE_FILE 읽어 additionalContext (역할 본문 + 캐릭터 시트) → stdout
  CLI->>Pipe: {"cmd":"hook","event":"SessionStart","token":…}
  Pipe->>Rust: verify_session(token) → apply_hook (SessionStart는 Ignore)
  CL->>CL: ~/.claude/sessions/<pid>.json 작성 (status idle)
  Rust->>Rust: scan() → apply_registry → idle → emit agent-state
  Rust-->>CC: agent-state {status idle, seq}
  CC->>CC: 인박스에 대기 메시지 있으면 flushInboxOnState → 주입
```

### 5.5 상태 감지 — 두 소스의 합류

```mermaid
sequenceDiagram
  autonumber
  participant CL as claude
  participant FS as ~/.claude/sessions
  participant W as registry watch 스레드
  participant H as eqmux _hook → 파이프
  participant A as agent.rs
  participant St as store
  participant FE as 프런트 (agent.ts)

  par 1차: 레지스트리
    CL->>FS: <pid>.json 갱신 (status, waitingFor, mtime)
    FS-->>W: notify 이벤트 (또는 2000ms 타임아웃)
    W->>W: 채널 비워 버스트 병합
    W->>A: scan(): read_registry (sessionId별 최신 mtime 승)
    A->>A: apply_registry: mtime > hook_ms (P-3) && (!asking || idle) && 변화 있음
  and 2차: 훅
    CL->>H: UserPromptSubmit / Stop / Notification / PreToolUse / PostToolUse / Subagent*
    H->>A: apply_hook → hook_effect (순수 함수) → apply_effect
  end
  A->>A: 전이면 emit_state, 조용한 변화(activity·subagents·cost)면 raw emit
  A->>St: Event{kind agent-state} (전이만)
  A->>A: maybe_notify (waiting/dead만, §6.4 게이트)
  A-->>FE: agent-state {…, seq, sinceMs}
  FE->>FE: staleSeq(session, seq)면 버림 → backend.applyAgentState
  FE->>FE: status idle이면 flushInboxOnState
```

두 소스가 충돌할 때의 규칙 세 가지: (1) 레지스트리 파일의 mtime이 마지막 훅 시각보다 오래됐으면 무시(P-3 stale guard). (2) `asking`(질문·계획 승인 대기) 중에는 레지스트리가 `waiting`을 풀지 못한다. 레지스트리가 `idle`을 말할 때만 푼다. (3) `dead`는 되살리지 않는다.

### 5.6 메시지 버스 — `eqmux send`에서 주입까지

```mermaid
sequenceDiagram
  autonumber
  participant A1 as claude (발신, 페인 A)
  participant CLI as eqmux send (CLI)
  participant Pipe as ipc.rs
  participant M as messages.rs
  participant DB as session.db message
  participant FE as conversation.ts
  participant PTY as pty.ts
  participant A2 as claude (수신, 페인 B)

  A1->>CLI: eqmux send --type handoff --to "@노엘" "본문"
  CLI->>Pipe: {"cmd":"send","session":"kai@ws","to":"@노엘","type":"handoff","body":…,"token":…}
  Pipe->>Pipe: verify_session → session_origin → resolve_recipient (team.json) → "noel@ws"
  Pipe->>M: validate (BAD_TYPE/EMPTY/TOO_LONG) → allow_rate (10/분)
  M->>DB: INSERT message (read=0)
  Pipe-->>CLI: {"ok":true,"id":N}
  Pipe-->>FE: emit message-new {workspace, message}
  FE->>FE: appendMessage → deliver(): 수신자마다 §6.3 결정
  alt canInject (idle && 사람이 타이핑 중 아님)
    FE->>PTY: writePty("[EQ·handoff] 카이: 본문 (답신은 노엘의 말투로)")
    FE->>FE: sleep 80ms
    FE->>PTY: writePty("\r")
    FE->>FE: sleep 400ms (세션별 promise 큐로 직렬화)
    PTY->>A2: 턴 시작
  else busy / waiting / starting / dead / 타이핑 중
    FE->>FE: 인박스에 보관 (500ms 디바운스로 cache_set "inbox")
    Note over FE: idle 전이 시 flushInboxOnState → 4000자 배치로 주입
  else personaId 없음 (기본 터미널)
    FE->>PTY: echoPty (화면에만, PTY에는 절대 쓰지 않음 — P-2)
  end
```

사람이 보내는 경로(`sendConversation` → `msg_send`)도 8번 이후는 완전히 같다. 주입 본문은 항상 **한 줄**로 평탄화한다 (TUI에서 개행 = 제출).

### 5.7 재시작 후 복원과 웹뷰 크래시

| 상황 | 무엇이 살아남나 | 복원 경로 |
|---|---|---|
| 정상 종료 후 재시작 | `layout.json`, `team.json`, DB(스크롤백·재개 앵커) | `restoreLayout` + `restoreTeams` → 세션은 `restored`, 페인은 스크롤백 `scrollbackReplay`줄 재생 + `─── 새 세션 시작 ───` 경계 + **새 셸 스폰**. 에이전트는 `[재개]` 버튼(사람이 눌러야 함) |
| 비정상 종료(작업 관리자 강제 종료 등) | 위와 같음 + `running.flag` 잔존 | 위 + `crash_recovery`가 `exit_code IS NULL` 세션 목록(재개 가능 여부 포함)을 `CrashRecovery` 대화상자로 |
| **웹뷰 렌더러만 크래시** | **PTY·Job·스레드·`PtyState`·`AgentRt`·store 전부** (Rust 소유) | WebView2 `ProcessFailed` → `Reload` → 프런트 부트스트랩이 `pty_list`로 살아 있는 id를 받아 `reviveOrphan` → `TerminalPane`이 `revive` 모드로 스폰 없이 재부착, `resizePty(rows-1)` → 150 ms 후 원복으로 전체 재그리기 유도 → `agent_snapshot`으로 상태 복원 |

재개(`agent_resume`)는 `agent_session` 테이블의 UUID로 `claude --resume <uuid>`를 같은 cwd에서 띄운다. 트랜스크립트 파일이 없거나 비어 있으면 `재개 불가 — 트랜스크립트가 없습니다`로 거절한다.

### 5.8 임무 배정

```mermaid
sequenceDiagram
  autonumber
  participant U as 사용자
  participant Mi as Missions.tsx / missions.ts
  participant Rust as lib.rs mission_assign
  participant R as roles.rs set_mission
  participant FE as conversation.ts
  participant PTY as pty.ts

  U->>Mi: 임무 ↔ 세션 토글
  Mi->>Rust: mission_assign(wsPath = sess.cwd || ws.path, session, missionId?)
  Rust->>Rust: missions::get → MissionBlock
  Rust->>R: set_mission(ws, session, block?)
  R->>R: 역할 파일의 EQMUX:MISSION 블록 교체/삽입/삭제 (frontmatter mission:, updated: 갱신)
  Rust-->>Mi: ok
  Mi->>Mi: refreshMissions (mission_list + scan_assignments: 루트 + 워크트리, 워크트리 승)
  Mi->>FE: sendBrief — canInject(session)일 때만
  FE->>PTY: "[EQMUX] 임무 배정: 이름 — 목표 · 정의 .eqmux/missions/<id>.md\r"
```

### 5.9 크기 변경 (resize) — 앱을 멈추지 않는 경로

```mermaid
sequenceDiagram
  autonumber
  participant RO as ResizeObserver
  participant TP as TerminalPane.syncSize
  participant pty as pty.ts
  participant cmd as lib.rs pty_resize (async)
  participant B as spawn_blocking
  participant Con as ConPTY

  RO->>TP: 100ms 디바운스 (드래그 종료 +350ms 재확인)
  TP->>TP: proposeDimensions → 바뀌었으면 term.resize
  TP->>pty: resizePty(id, cols, rows) (lastCols/Rows와 다를 때만)
  pty->>cmd: invoke pty_resize
  cmd->>cmd: 전역 잠금: resize_hint=now, seq=resize_seq+1, Arc 복제 → 잠금 해제
  cmd->>B: spawn_blocking
  B->>B: master 잠금 → resize_is_current(seq)? 아니면 Ok 반환
  B->>Con: ResizePseudoConsole (파이프가 가득 차면 여기서 기다림 — 세션별 잠금이라 다른 세션엔 영향 없음)
  Con-->>TP: 전체 재그리기 출력 (coalescer가 400ms 동안 25/250ms 창으로 합침)
```

---

## 6. 상태 머신

### 6.1 에이전트 세션 상태

상태 값은 Claude Code의 어휘를 그대로 쓴다(G2). 색은 `waiting`·`dead`에만 쓴다(주의 예산).

```mermaid
stateDiagram-v2
  [*] --> starting : agent_spawn / resume / restart
  [*] --> shell : 기본 터미널 (에이전트 없음)
  starting --> idle : 레지스트리 status idle
  starting --> busy : 레지스트리 busy / 훅 UserPromptSubmit
  idle --> busy : 훅 UserPromptSubmit / 레지스트리 busy
  busy --> idle : 훅 Stop / 레지스트리 idle
  busy --> waiting : 훅 Notification / 레지스트리 waiting / PreToolUse(AskUserQuestion·ExitPlanMode)
  idle --> waiting : 훅 Notification / PreToolUse(Ask·Plan)
  waiting --> busy : PreToolUse(다른 도구) 또는 PostToolUse (unstick) / 레지스트리 busy (asking 아닐 때)
  waiting --> idle : 레지스트리 idle (asking도 해제)
  shell --> idle : 레지스트리에 새 interactive pid가 이 페인의 Job 트리에 있음 → 입양(adopt)
  shell --> busy : 입양 (레지스트리 상태 그대로)
  idle --> shell : 입양된 pid가 Job 트리에서 사라짐 (claude만 종료, 셸 생존)
  busy --> shell : 위와 동일
  waiting --> shell : 위와 동일
  starting --> dead : PTY EOF
  idle --> dead : PTY EOF
  busy --> dead : PTY EOF
  waiting --> dead : PTY EOF
  shell --> dead : PTY EOF
  dead --> starting : 사용자 [재개] / [재시작]  (새 Tracked, 같은 UUID)
  dead --> [*] : agent_forget / 세션 제거
```

**보조 플래그**(상태가 아니라 `Tracked`의 필드): `degraded`(레지스트리 디렉터리를 못 읽음 → 훅+프로세스 생존으로만 유지, 저신뢰 배지), `asking`(질문/계획 승인 대기 중, 레지스트리 재스캔이 `waiting`을 풀지 못하게 고정), `adopted`(앱이 띄우지 않은 세션), `activity`(현재 도구), `subagents`, `cost_usd`.

**전이 표** (`agent.rs`의 `apply_effect` / `apply_registry` / `on_pty_exit` / `scan`)

| # | From | 트리거 | 가드 | To | 부수효과 |
|---|---|---|---|---|---|
| 1 | — | `agent_spawn_inner` | cwd 존재, 살아 있는 non-dead tracking 없음(P-8) | `starting` | `Tracked` 삽입, `AgentSession` 저장, `emit_state` |
| 2 | ≠dead | 훅 `UserPromptSubmit` | 상태 또는 waiting 변화 | `busy` | `asking=false`, `hook_ms=now` |
| 3 | ≠dead | 훅 `Stop` | ≠idle | `idle` | `activity=None`, `subagents=0`, `asking=false` → 프런트 인박스 flush |
| 4 | ≠dead | 훅 `Notification` | 변화 | `waiting` | `waiting_for=message` → **OS 알림 후보** |
| 5 | any | 훅 `PreToolUse` (`AskUserQuestion`/`ExitPlanMode`) | 같은 사유로 이미 waiting 아님 | `waiting` | `asking=true`, `waiting_for=WAIT_QUESTION\|WAIT_PLAN` |
| 6 | `waiting` | 훅 `PreToolUse`(그 외)/`PostToolUse` | — | `busy` | unstick. degraded 모드의 유일한 해제 경로 |
| 7 | ≠waiting | 훅 `PreToolUse`/`PostToolUse` | `activity` 변화 | 유지 | **조용한 emit**(피드에 안 남김) |
| 8 | any | `SubagentStart`/`Stop` | 카운트 변화 | 유지 | `subagents ± 1` (0 미만 금지), 조용한 emit |
| 9 | any | `_statusline` | 비용 변화 ≥ $0.01 | 유지 | `cost_usd`, 조용한 emit |
| 10 | ≠dead | 레지스트리 레코드 | `mtime > hook_ms` ∧ (`!asking` ∨ 레코드 idle) ∧ 변화 | 레코드 상태 | `status_ms=mtime`, idle이면 activity/subagents 초기화 |
| 11 | — | 레지스트리에 미지의 `sessionId`, `pid`가 어느 페인의 Job 트리에, `kind=interactive` | 페인 찾음 | 레코드 상태 (없으면 idle) | 입양: 같은 페인의 이전 tracking 제거(starting 제외), `adopted=true`, `AgentSession` 저장 |
| 12 | adopted, ≠dead | 생존 스윕 | Job pid 목록이 비어 있지 않은데 `pid`가 없음 | `shell` | tracking 제거 |
| 13 | ≠dead | PTY EOF | `pty_gen` 일치 | `dead` | `exit_code`, `expected_exit`에 없으면 **OS 알림 후보** |
| 14 | any | `read_dir(sessions)` 실패 | `degraded` 변화 | 유지 | `degraded=true`, 피드에 "관측 저하" |
| 15 | degraded | 디렉터리 복구 | | 유지 | `degraded=false`, "관측 정상화" |
| 16 | `dead` | 레지스트리 무엇이든 | | `dead` | 없음 (부활 금지) |
| 17 | any | `pty_kill`/`kill_pty_for_restart` | | (→13) | `expected_exit` 삽입 → 토스트 없음 |
| 18 | any | `agent_forget` | | 제거 | tracking·gate·token·origin 삭제, `ForgetAgentSession` |

훅 이름 → 상태 매핑은 `hook_status`에 딱 세 줄이다: `Stop→idle`, `UserPromptSubmit→busy`, `Notification→waiting`. `SubagentStop`은 의도적으로 상태에 매핑하지 않는다(부모는 아직 busy).

### 6.2 임무 상태

```mermaid
stateDiagram-v2
  state "in-progress" as inprogress
  state "in-review" as inreview
  [*] --> todo : mission_create
  todo --> inprogress : 상태 순환 (UI는 앞으로만, 끝에서 처음으로)
  inprogress --> inreview
  inreview --> done
  done --> todo : 순환
  note right of done
    Rust는 4값 소속만 검사 (임의 전이 허용).
    완료 판정 로직 없음 — PRD E 미해결 2.
    autoAssignDefault는 done 임무를 건너뛴다.
  end note
```

`mission_set_status`는 frontmatter의 `status:`와 `updated:`만 다시 쓰고 본문은 그대로 둔다(외부 편집 보존). 기본 임무(`default: true`)는 워크스페이스에 하나뿐이라 켤 때 다른 파일의 플래그를 지운다.

### 6.3 메시지 전달 결정 (`conversation.ts deliver`)

```mermaid
flowchart TD
  IN["message-new 수신"] --> R{"수신자 = @all이면 워크스페이스 전 세션<br/>아니면 해당 세션"}
  R --> SELF{"s.id == from ?"}
  SELF -->|예| SKIP["건너뜀 (자기 자신)"]
  SELF -->|아니오| DEAD{"status == dead ?"}
  DEAD -->|예| PARK["인박스 보관 (재개 후 flush)"]
  DEAD -->|아니오| NOP{"personaId 없음<br/>(기본 터미널)?"}
  NOP -->|예| ECHO["echoPty — 화면에만, PTY에 안 씀 (P-2)"]
  NOP -->|아니오| SH{"status == shell ?"}
  SH -->|예| BOTH["echoPty + 인박스 보관"]
  SH -->|아니오| CI{"canInject(s)<br/>= idle && !humanTyping"}
  CI -->|예| INJ["injectMessages — 즉시 주입 (M3)"]
  CI -->|아니오| PARK2["인박스 보관 → idle 전이 시 flushInboxOnState"]
```

### 6.4 OS 알림 게이트 (`agent.rs maybe_notify`)

```mermaid
flowchart TD
  S["emit_state (전이)"] --> W{"status ∈ {waiting, dead} ?"}
  W -->|아니오| X0["알림 없음"]
  W -->|예| E{"dead이고 expected_exit에 있음?"}
  E -->|예| X1["표식 소비, 알림 없음 (사용자가 끈 것)"]
  E -->|아니오| N{"settings.notifications"}
  N -->|off| X2["없음"]
  N -->|waiting이고 dead| X2
  N -->|그 외| M{"muted에 세션 또는 워크스페이스?"}
  M -->|예| X2
  M -->|아니오| F{"앱 창에 포커스?"}
  F -->|예| X3["없음 — 화면이 이미 보여줌 (FR-G-31)"]
  F -->|아니오| G{"세션별 60초 게이트 안?"}
  G -->|예| C["suppressed += 1, 알림 없음"]
  G -->|아니오| T["notify_text (language en/ko) + 합쳐진 횟수 → OS 토스트"]
```

프런트의 대기음(`waitingSound`)도 같은 60초 게이트를 따로 갖고 있고, 스냅샷에서 온 상태(`fromSnapshot`)에는 울리지 않는다.

---

## 7. 인터페이스 계약

### 7.1 Tauri 커맨드 전체 (99개, `lib.rs generate_handler!` 순서 기준 도메인별 정리)

Rust 파라미터는 snake_case, JS에서는 camelCase로 넘긴다 (`ws_path` → `wsPath`, `before_id` → `beforeId`, `msg_type` → `msgType`, `expected_mtime_ms` → `expectedMtimeMs`).

**앱 · PTY**

| 커맨드 | 파라미터 | 반환 | 비고 |
|---|---|---|---|
| `app_version` | — | `&str` | |
| `pty_spawn` | `id, cwd?, shell?, cols, rows, workspace?` | `Result<()>` | 셸 후보 순서대로. 이미 있으면 재부착 |
| `pty_write` | `id, data` | `Result<()>` | 세션별 writer 잠금 |
| `pty_resize` (async) | `id, cols, rows` | `Result<()>` | seq 가드, `spawn_blocking` |
| `pty_kill` | `id` | `Result<()>` | `expected_exit` 표식, 백그라운드 teardown |
| `pty_list` | — | `Vec<String>` | 살아 있는 세션 id |
| `sessions_memory` | — | `[{id, bytes, peakBytes}]` | Job 회계 |
| `sessions_agents` | — | `[{id, agent}]` | Job 트리에서 CLI 탐지 |
| `agent_clis` | — | `[{cmd, name, installed, managed}]` | `where.exe` 설치 확인 |

**에이전트**

| 커맨드 | 파라미터 | 반환 |
|---|---|---|
| `agent_spawn` | `id, workspace, cwd, name, permissionMode, disallowedTools[], cols, rows` | `Result<String uuid>` |
| `agent_resume` | 위와 동일 | `Result<String uuid>` |
| `agent_restart` | `id, permissionMode, disallowedTools[], cols, rows` | `Result<String uuid>` |
| `agent_forget` | `id` | `()` |
| `agent_snapshot` | — | `Vec<AgentStateEvt>` (살아 있는 PTY만) |
| `transcript_read` | `workspace, id, cwd` | `Result<TranscriptData>` |

**스토어 · 이벤트 · 메시지**

| 커맨드 | 파라미터 | 반환 |
|---|---|---|
| `scrollback_tail` | `workspace, session, count` | `Vec<{text, styled?}>` |
| `scrollback_search` | `workspace, query, session?, limit` | `Vec<SearchHit>` |
| `scrollback_page` | `workspace, session, beforeSeq?, limit` | `Vec<SearchHit>` |
| `scrollback_export` | `workspace, session, suggested` | `Option<{path, lines}>` |
| `store_usage_real` | `workspace` | `{db_file, db_size_bytes, total_lines, sessions[]}` |
| `store_purge_scrollback` | `workspace` | `{lines, freedBytes}` |
| `events_query` | `workspace, session?, beforeId?, limit` | `Vec<{id, ts, sessionId, kind, payload}>` |
| `events_log` | `workspace, session?, kind, message` | `()` (200자 절단) |
| `cache_get` / `cache_set` | `workspace, key[, value]` | `Option<String>` / `Result<()>` |
| `msg_list` | `workspace, beforeId?, limit` | `Vec<MsgRow>` |
| `msg_send` | `workspace, from, to, msgType, body` | `Result<MsgRow>` |
| `msg_mark_read` | `workspace` | `Result<()>` |
| `msg_export` | `workspace, wsName, suggested, names{}` | `Option<{path, count}>` |
| `shutdown_flush` | — | `bool` (2초 안에 끝났나) |
| `app_exit` (async) | — | — |
| `crash_recovery` | — | `{dirty, sessions[]}` |
| `layout_load` / `layout_save` | `[data]` | `Option<Value>` / `Result<()>` |
| `settings_load` / `settings_save` | `[data]` | `Value` / `Result<()>` |
| `session_log_dir` / `open_log_dir` / `open_external` | `[url]` | |

**워크스페이스 · git**

| 커맨드 | 파라미터 | 반환 |
|---|---|---|
| `ws_pick_folder` | — | `Option<String>` |
| `ws_registry` (async) | — | `Vec<WsInfo>` |
| `ws_register` (async) | `path` | `Result<WsInfo>` (`NOT_A_REPO`) |
| `ws_unregister` / `ws_repath` / `ws_touch` | `id[, path]` | |
| `ws_git_init` / `ws_clone` (async) | `path` / `url, parent` | |
| `ws_checkout` (async) | `wsPath, branch` | `Result<String>` |
| `git_overview` (async) | `wsPath` | `GitOverview` |
| `git_worktrees` / `git_branches` (async) | `wsPath` | `Vec<WorktreeInfo>` / `Vec<BranchInfo>` |
| `worktree_ensure` / `worktree_add` / `worktree_attach` (async) | `wsPath, session` / `wsPath, name, base?` / `wsPath, branch` | `Result<String path>` |
| `ws_watch` / `ws_unwatch` | `workspaceId, wsPath` / `workspaceId` | |
| `diff_changed_files` / `diff_file` (async) | `wsPath[, path]` | `Vec<ChangedFile>` / `FileDiff` |
| `commit_changed_files` / `commit_file_diff` (async) | `wsPath, hash[, path]` | |

**팀 · 역할 · 임무 · 라이브러리 · 탐색기**

| 커맨드 | 파라미터 | 반환 |
|---|---|---|
| `team_load` | `workspaceId, wsPath` | `Vec<TeamSlotInfo>` |
| `team_save` | `wsPath, slots[]` | `Result<()>` |
| `role_save` / `role_remove` | `wsPath, payload` / `wsPath, session` | `Result<String path>` / `Result<()>` |
| `mission_list` / `mission_create` / `mission_set_status` / `mission_set_default` / `mission_assign` | `wsPath[, …]` | |
| `library_list` | `wsPath?` | `{jobs, personas}` |
| `library_save_persona` / `library_delete_persona` / `library_save_job` / `library_delete_job` | `persona\|job, expectedMtimeMs?` / `id` | |
| `library_character_create` / `_read` / `_save` / `_delete` | `id[, name\|content, expectedMtimeMs]` | |
| `preset_list` | — | `Vec<PresetInfo>` |
| `fs_tree` / `fs_preview` / `fs_read` / `fs_write` / `fs_create` / `fs_rename` / `fs_delete` (async) / `reveal_path` | `wsPath, …` | |
| `ports_snapshot` (async) | — | `Vec<PortRow>` |
| `browser_open` / `browser_bounds` / `browser_visible` / `browser_nav` / `browser_close` | `url, x, y, w, h` … | |
| `clip_read_text` / `clip_write_text` / `clip_save_image` | | |
| `diag_geometry` / `diag_note` / `diag_log_path` | | |

### 7.2 Rust → 프런트 이벤트 (7개)

| 이벤트 | 페이로드 | 발신 | 프런트 구독 |
|---|---|---|---|
| `pty-output` | `{id, data}` | coalescer 스레드 | `pty.ts` → 세션별 구독자·링 버퍼(200,000자) |
| `pty-exit` | `{id, code?}` | reader 스레드 (모든 출력 뒤에 보장) | `pty.ts` → `exitHook`(`backend.sessionExited`) + 구독자 |
| `agent-state` | `AgentStateEvt {session, agentSession, status, waitingFor, activity, subagents, costUsd, resumable, version, exitCode, degraded, seq, sinceMs}` | `agent.rs` | `agent.ts` → `staleSeq` → `applyAgentState` → `flushInboxOnState` |
| `message-new` | `{workspace, message: MsgRow}` | `msg_send`, `ipc::publish` | `conversation.ts` → `deliver` |
| `eqmux-file-change` | `{workspaceId}` | `ws_watch` 콜백 (`*.tmp`, `roles/`, `worktrees/` 제외) | `watch.ts` → `fileChangeTick` → 임무·라이브러리 재측정 |
| `browser-nav` | `{url}` | `browser.rs on_navigation` | `browser.ts` → 주소창 |
| `browser-request` | `{url}` | `browser.rs cli("open")` | `browser.ts` → `openInBrowserPanel` (바운드는 패널의 DOM 자리에서만 읽히므로 Rust가 직접 못 연다) |
| `diag-geometry` | `()` | `on_window_event` (배율·모니터 변화 시) | `diag.ts` 스윕 |

프런트 내부 DOM 이벤트: `eq-tokens-changed`(테마·팔레트 변경 → xterm 테마 갱신).

### 7.3 명명 파이프 프로토콜

- 이름 `\\.\pipe\eqmux-bus-<USERNAME>` (비영숫자 → `_`). 바이트 모드, 요청 1줄 JSON, 응답 1줄 JSON.

| 요청 `cmd` | 필드 | 응답 |
|---|---|---|
| `ping` | — | `{"ok":true,"app":"eqmux","version":"0.3.8"}` |
| `send` | `session, to, type, body, token` | `{"ok":true,"id":N}` |
| `report` | `session, body, token` | `{"ok":true,"id":N}` (원장 `report` 타입 + `event` 테이블) |
| `hook` | `session, event, payload(stdin JSON), token` | `{"ok":true}` |
| `statusline` | `session, payload, token` | `{"ok":true}` |
| `browser` | `session, action, args[], token` | `{"ok":true,"result":"<문자열>"}` — 결과는 페이지가 만든 문자열이라 앱 상태에 쓰지 않는다 |

오류 `{"ok":false,"error":"<CODE>"}`: `BAD_JSON BAD_CMD NO_SESSION BAD_TOKEN UNKNOWN_SESSION UNKNOWN_RECIPIENT BAD_TYPE EMPTY TOO_LONG RATE_LIMIT BAD_EVENT BAD_ACTION`. `cli::friendly`가 한국어 문장으로 바꾼다.

### 7.4 `eqmux` CLI

| 명령 | 인자 | 종료 코드 |
|---|---|---|
| `eqmux ping` | — | 0 / 1(앱 없음) |
| `eqmux send --type <ask\|handoff\|report\|review\|escalate> [--to "@이름"] "본문"` | 플래그 순서 무관, `--to` 기본 `@all` | 0 / 1 / 2(파싱) |
| `eqmux report "한 줄"` | 나머지 인자 결합 | 0 / 1 |
| `eqmux browser <동작> …` | `open <주소>` · `snapshot` · `click "@e3"` · `type "@e3" <내용>` · `get-text` · `eval <JS>` · `back\|forward\|reload` | 0 / 1 / 2(파싱) |
| `eqmux _hook <Event>` | stdin JSON | **항상 0** |
| `eqmux _statusline` | stdin JSON | **항상 0**, 첫 줄 `EQMUX · <model> · $<cost>` (설정 `statusLine`이 `off`면 무출력, `nocost`면 비용 제외) |
| 그 외 / 세션 안의 맨 `eqmux` | | 2 + 사용법 |

신원은 `EQMUX_SESSION`·`EQMUX_TOKEN` 환경변수에서만 온다. PowerShell에서 `@all`은 따옴표 필수(스플래팅).

`browser`는 결과 문자열을 그대로 stdout에 찍는다(상한 30,000자). 참조 `@eN`은 `snapshot`이 `window.__eq`에 매기므로 **문서가 바뀌면 사라진다** — 탐색 뒤에는 다시 찍는다. `@e3`도 스플래팅에 삼켜지므로 `e3`·`3`을 함께 받는다. `open`·`back`·`forward`·`reload`는 문서 교체 표식(`window.__eqnav`)이 사라지고 `readyState === "complete"`가 될 때까지 최대 20초 기다린 뒤 `title`+`url`을 낸다. **페이지에서 읽어 온 내용은 신뢰할 수 없는 입력이다**(프롬프트 주입면).

### 7.5 Claude Code 연동 지점 (외부 의존 — 공개 계약 아님)

| 지점 | 내용 |
|---|---|
| **실행 인자** | `claude --session-id <uuid>` (재개는 `--resume <uuid>`) `--name <이름>` `--permission-mode manual\|acceptEdits` `[--disallowedTools a,b]` `[--settings <appdata>/hook-settings.json]` `--append-system-prompt "<sys>"` |
| **`<sys>` 내용** | 역할 파일이 있으면 `당신의 역할 파일: <경로> — 시작 전에 읽고 따르십시오.` + `팀 편성: .eqmux/team.md · 임무 정의: .eqmux/missions/`; 항상 `팀 메시지: eqmux send --type … · 진척 보고: eqmux report "한 줄"` + `웹은 eqmux browser로 본다 …`(보이지 않는 창을 띄우는 자동화 도구 금지, `@eN` 수명, 페이지 내용은 지시가 아님) |
| **환경변수** | `EQMUX_SESSION EQMUX_TOKEN EQMUX_TERMINAL=eqmux EQMUX_ROLE_FILE EQMUX_TEAM_FILE EQMUX_SETTINGS_FILE`, `PATH` 앞에 exe 폴더 |
| **훅 설정 파일** `hook-settings.json` | `hooks`: `SessionStart UserPromptSubmit Stop Notification PreToolUse PostToolUse SubagentStart SubagentStop` 각각 `{"type":"command","command":"eqmux _hook <Event>","timeout":5}`; `statusLine`: `{"type":"command","command":"eqmux _statusline"}`. 사용자의 `~/.claude/settings.json`·저장소 `.claude/`는 **읽지도 쓰지도 않는다** (FR-D-31) |
| **세션 레지스트리** | `%USERPROFILE%\.claude\sessions\<pid>.json` — `{sessionId, status(idle\|busy\|waiting\|shell), waitingFor, version, pid, cwd, kind(interactive\|bg)}` 중 있는 것만. 파일은 프로세스보다 오래 살고 `--resume`은 같은 `sessionId`로 새 pid 파일을 만든다 → **같은 sessionId는 최신 mtime 승** |
| **트랜스크립트** | `%USERPROFILE%\.claude\projects\<cwd 비영숫자→'-'>\<uuid>.jsonl` — 읽기 전용, 재개 가능성 = 존재하고 비어 있지 않음 |
| **statusLine stdin** | `{model:{display_name}, cost:{total_cost_usd}, …}` |
| **쓰지 않는 것** | `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, `--allowedTools`, `--worktree`(앱이 워크트리를 소유) |

Claude Code 버전이 바뀌어 레지스트리 스키마나 훅 이름이 달라지면 이 표의 항목만 손보면 된다: `agent.rs`(`RegistryRecord`, `hook_status`, `hook_effect`, `registry_waiting_for`), `lib.rs`(`write_hook_settings`, `agent_spawn_inner` argv), `transcript.rs`(`parse_line`).

### 7.6 권한 → 실행 플래그 (`types.ts translatePermissions`, PRD D §4.5.1)

| `permissions` | `--permission-mode` | `--disallowedTools` | 전형적 직무 |
|---|---|---|---|
| `write:false` | `manual` | `Edit, Write, NotebookEdit` | qa, release |
| `write:true, commit:false` | `acceptEdits` | `Bash(git commit *), Bash(git push *)` | dev, plan, design, debug, docs |
| `write:true, commit:true, push:false` | `acceptEdits` | `Bash(git push *)` | — |
| 모두 `true` | `acceptEdits` | (없음) | lead |

`disallowedTools`는 **거부 목록이지 샌드박스가 아니다**(R2). 실질 강제는 승인 게이트뿐이다. 권한을 바꾸면 플래그는 프로세스 수명 동안 고정이므로 `restartNeeded` 배지가 뜨고, 재시작은 `--resume`으로 대화를 보존한다 (E11′, FR-D-26). 스폰 시 실제로 넘긴 플래그는 `Session.spawnFlags`에 기억한다 — 현재 권한에서 재계산하면 옛 플래그로 도는 프로세스를 "실제"라고 거짓말하게 된다.

---

## 8. 데이터 계약

### 8.1 SQLite (워크스페이스마다 `session.db`)

```mermaid
erDiagram
  session {
    TEXT id PK "persona@ws | shellN@ws"
    TEXT workspace
    TEXT name
    TEXT cwd
    TEXT shell
    INTEGER created_at
    INTEGER last_output_at
    INTEGER bytes_received
    INTEGER exit_code "NULL = 크래시로 끝남"
  }
  scrollback {
    TEXT session_id PK
    INTEGER seq PK "세션별 단조 증가"
    INTEGER ts
    TEXT text "VT 제거된 확정 줄"
    TEXT styled "SGR만 남긴 줄 (M32 ALTER)"
  }
  scrollback_fts {
    TEXT text "FTS5, session_id/seq/ts UNINDEXED"
  }
  command {
    INTEGER id PK
    TEXT session_id
    TEXT text
    INTEGER started_at
    INTEGER ended_at
    INTEGER exit_code
    INTEGER seq_from
    INTEGER seq_to
  }
  event {
    INTEGER id PK
    INTEGER ts
    TEXT session_id
    TEXT kind "session-start|session-exit|session-kill|agent-state|agent|report|프런트 kind"
    TEXT payload
  }
  agent_session {
    TEXT session_id PK
    TEXT agent_session_id "Claude UUID (재개 앵커)"
    TEXT log_path "트랜스크립트 경로"
    INTEGER resumable
  }
  assignment_cache {
    TEXT key PK "inbox | unseen 등 프런트 KV"
    TEXT value
  }
  notification {
    INTEGER id PK
    INTEGER ts
    TEXT kind
    TEXT payload
  }
  message {
    INTEGER id PK
    INTEGER ts
    TEXT sender "세션 id 또는 나"
    TEXT recipient "@all 또는 세션 id"
    TEXT kind "ask|handoff|report|review|escalate"
    TEXT body "≤2000자"
    INTEGER read
  }
  meta {
    TEXT key PK "schema_version=1, fts_seeded"
    TEXT value
  }
  session ||--o{ scrollback : "session_id"
  session ||--o| agent_session : "session_id"
  session ||--o{ event : "session_id (nullable)"
  session ||--o{ command : "session_id (미사용)"
  scrollback ||--|| scrollback_fts : "미러"
```

- 명시적 `CREATE INDEX`는 없다. PK만 있다.
- `command` 테이블은 스키마만 있고 쓰는 코드가 없다(OSC 133 셸 통합 미구현, FR-C-26).
- 마이그레이션은 두 가지뿐이다: `ALTER TABLE scrollback ADD COLUMN styled`(실패 무시)와 `meta.fts_seeded`가 없을 때 FTS 백필. 스키마를 바꾸는 절차는 §10.8.

### 8.2 앱 데이터 (`%APPDATA%\com.eqment.eqmux\`)

| 파일 | 쓰는 곳 | 읽는 곳 | 형태 |
|---|---|---|---|
| `workspaces.json` | `workspace::save` (atomic) | `load`/`load_strict` | `[{id, name, path, remote?, branch?, last_used}]` |
| `settings.json` | `settings_save` (atomic) | `setup`, CLI `_statusline`(`EQMUX_SETTINGS_FILE`) | §4.9의 `AppSettings` |
| `layout.json` | `layout_save` (800 ms 디바운스, atomic) | `layout_load` | `{openWorkspaces, paneLayoutsByWs, paneRatiosByWs, shell, selectedSession, lastWorkspace, panelSide}` (+ 레거시 `paneLayout`, `paneRatios`) |
| `hook-settings.json` | `write_hook_settings` (매 기동) | `claude --settings` | §7.5 |
| `data.ver` | setup (와이프 성공 시) | setup | 버전 문자열 |
| `running.flag` | setup | setup / `app_exit`가 삭제 | 존재 여부만 |
| `jobs/<id>.md`, `personas/<id>.md`, `personas/<id>.character.md` | `library_*` | `library::list` | §8.3 |
| `presets/NN-<id>.json` | `library::seed` | `preset_list` | `{id, name, jobs[]}` |
| `workspaces/<ws>/session.db` (+`-wal`, `-shm`) | store writer | 읽기 전용 커넥션들 | §8.1 |

버전 와이프에서 살아남는 것은 `settings.json`, `jobs/`, `personas/`, `presets/` 네 가지뿐이다. **DB·레이아웃·등록부는 버전이 바뀌면 지워진다.**

### 8.3 워크스페이스 파일 (`<repo>/.eqmux/`)

| 파일 | 커밋 | 쓰는 곳 | 형식 |
|---|---|---|---|
| `team.json` | ✅ | `team_save` | `{"version":1,"slots":[{slot, persona, personaName, job, jobName, name?, worktree, permissions?}]}` — **절대경로 금지** |
| `team.md` | ✅ (파생) | `team_save` | `# 팀 편성` + `\| 슬롯 \| 페르소나 \| 직무 \|` 표(4~8행), 접미 ` · 워크트리`, ` · 권한 오버라이드`, 꼬리에 "파생 파일" 안내 |
| `roles/<세션>.md` | gitignore | `role_save`, `mission_assign` | 아래 예시 |
| `missions/<id>.md` | ✅ | `mission_*` | 아래 예시 |
| `jobs/`, `personas/` | ✅ (선택) | 사용자 | 전역과 같은 형식, 같은 id는 워크스페이스 승 |
| `worktrees/<세션>/` | gitignore | `worktree_*` | git 워크트리 (안에 자체 `.eqmux/roles/`) |
| `.gitignore` | — | `roles::ensure_gitignore` | `roles/`, `worktrees/` |

**역할 파일 예시** (`roles/noel@eqmux-1a2b3c.md`)

```markdown
---
session: noel@eqmux-1a2b3c
persona: noel
job: dev
permissions:
  write: true
  commit: false
  push: false
mission: 인증-리팩터
updated: 2026-09-07 14:03
---
# 노엘 — 개발

## 판단 성향
작은 단위로 구현하고 검증한다

## 말투
…

## 책임
기획 내용에 대한 구현과 자체 검증

## 금지
기획에 없는 임의 구현 · 검증 없이 커밋 요청

## 팀 관계 (team.md 참조)
| 슬롯 | 팀원 | 직무 |
|---|---|---|
| 1 | 카이 | 리드 |
| 2 | 노엘 (나) | 개발 |

<!-- EQMUX:MISSION 인증-리팩터 -->
## 임무 — 인증 리팩터
상태: in-progress · 브랜치: feature/auth
목표: 결합을 낮춘다
산출물:
- 산출물 1
정의: .eqmux/missions/인증-리팩터.md
<!-- /EQMUX:MISSION -->
```

**임무 파일 예시** (`missions/인증-리팩터.md`)

```markdown
---
id: 인증-리팩터
name: 인증 리팩터
status: in-progress
branch: feature/auth
default: true
updated: 2026-09-07 14:03
---

## 목표
결합을 낮춘다

## 산출물
- 산출물 1
```

**직무 파일** (`jobs/dev.md`): frontmatter `id, name, default_permissions:{write,commit,push}` + `## 책임`, `## 금지`. 파서는 frontmatter 전체 줄에서 `write:`/`commit:`/`push:` 접두를 찾는다(부모 키 무관).

**페르소나 파일** (`personas/noel.md`): frontmatter `id, name, color(9색), level(basic|mid|adv), job?` + `## 기본 / ## 중급` 아래 `### 판단 성향 / ### 말투 / ### 성격`. 정규화 규칙: basic은 hint만, mid는 hint+tone+personality, adv는 `<id>.character.md` 시트가 곧 등급이며 역할 파일엔 경로 포인터만 실린다.

### 8.4 로그

| 파일 | 내용 |
|---|---|
| `%USERPROFILE%\.eqmux\logs\<세션>.log` | PTY 원시 바이트 append. `=== EQMUX session start · id · epoch ===` / `=== session exit · id · code ===` 마커 |
| `%USERPROFILE%\.eqmux\logs\diagnostics.log` | 화면 손상 진단 (4 MiB 넘으면 새로) |
| `%TEMP%\eqmux-pastes\paste-<ms>.png` | 붙여넣은 이미지 |

설정 화면의 "로그 폴더 열기"가 `open_log_dir`로 첫 폴더를 연다.

---

## 9. 빌드 · 실행 · 테스트 · 릴리스

### 9.1 요구 사항과 명령

| 항목 | 내용 |
|---|---|
| OS | Windows 10/11 + WebView2 런타임 |
| 도구 | Node.js 18+, Rust stable, git, Claude Code CLI(에이전트 기능) |
| 개발 | `npm install` → `npm run tauri dev` (Vite 1420 포트 + cargo) |
| 프런트 타입·번들 검사만 | `npm run build` (`tsc --noEmit && vite build`) |
| 프런트 테스트 | `npm test` (vitest, node 환경, `src/backend/*.test.ts` 4개) |
| Rust 테스트 | `cd src-tauri && cargo test` (git 실물 클론·Job Object·PTY UTF-8 등 통합 테스트 포함) |
| 릴리스 빌드 | `npm run tauri build -- --no-bundle` → `src-tauri/target/release/eqmux.exe` (실행 중인 EQMUX가 그 exe면 링크 실패 — 먼저 종료) |

`vite.config.ts`: `__APP_VERSION__`을 `package.json` 버전으로 정의(설정 화면 정보 카드), `src-tauri/**`는 watch 제외, `strictPort 1420`. `tsconfig.json`: ES2022, `jsx preserve` + `jsxImportSource solid-js`, `strict`, `noUnusedLocals/Parameters`.

### 9.2 브라우저 목 모드

`npm run dev`로 브라우저에서 열면 `isTauri()`가 false라 `MockBackend`의 시드 데이터(워크스페이스·세션·임무·메시지·패널 목)로 화면이 돈다. 터미널은 가짜 프롬프트 + 로컬 에코. 화면 레이아웃·i18n·CSS 작업은 여기서 빠르게 확인하고, PTY·상태·파일 계약은 반드시 `tauri dev`에서 본다.

### 9.3 진단

- `Ctrl+Alt+D`: 화면 손상 순간을 `diagnostics.log`에 표식(`USER-MARK`).
- 설정 → 로그 폴더 열기.
- Rust 쪽 `println!`은 릴리스 빌드에서 콘솔이 없다. 파일 로그(`diag::write`)나 `events_log`(피드)에 남기는 편이 낫다.
- 파이프가 사는지: 세션 안에서 `eqmux ping`.

### 9.4 테스트가 고정하는 것

| 파일 | 대상 |
|---|---|
| `src/backend/agent.test.ts` | `staleSeq` 순서 가드 |
| `src/backend/conversation.test.ts` | 주입 포맷 `fmt`, 배치 `batches` |
| `src/backend/diag.test.ts` | `computeDrift` |
| `src/backend/ports.test.ts` | 포트 접기·NEW 창·노출 판정·ack 조정 |
| `src-tauri/src/*.rs` `#[cfg(test)]` | `hook_effect`/`apply` 전이, `LineAssembler`·UTF-8 이월, `take_complete_utf8`, 역할 합성 순서, 임무 블록 idempotent, `diff` 양쪽 길이·해시 검증, `fsx` 탈출 가드, `worktree_create` 원격 전용 base(실물 클론), `Job::pids`+포트 귀속(실물 node), 라이브러리 시드(푸시 직무 2개) 등 |

### 9.5 릴리스 절차 (요약, 전체는 `명령어 정리.md`)

1. 버전 4파일: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, 그리고 `Cargo.lock`은 손으로 고치지 말고 `cd src-tauri && cargo metadata --format-version 1 --offline > /dev/null`.
2. 기능 커밋과 `Bump the version to X.Y.Z` 커밋은 분리. 이 저장소는 `main`에 직접 push.
3. `npm run tauri build -- --no-bundle`.
4. 포터블 zip: `EQMUX/eqmux.exe` + `EQMUX/README.txt`(이전 릴리스 자산에서 받아 버전 줄·변경 블록 추가).
5. `gh release create vX.Y.Z --target <전체 sha> --title "EQMUX X.Y.Z" --notes-file notes.md <zip>` (짧은 sha는 422).

버전을 올리면 `data.ver` 불일치로 **사용자 앱데이터의 DB·레이아웃·등록부가 지워진다**(§8.2). 릴리스 노트에 알려야 한다.

---

## 10. 유지보수 레시피

각 레시피는 "어느 파일의 어느 지점을 순서대로 건드리면 되는가"만 적는다.

### 10.1 Tauri 커맨드 추가

1. Rust: 해당 모듈에 `#[tauri::command] fn my_cmd(store_state: State<StoreState>, ws_path: String) -> Result<T, String>`. 오래 걸리면(git, 파일 트리, 네트워크) `async fn` + `tauri::async_runtime::spawn_blocking` (§3.1의 동기=메인 스레드 규칙).
2. `lib.rs`의 `generate_handler![…]` 목록 끝에 `my_cmd` (다른 모듈이면 `모듈::my_cmd`).
3. 반환 타입에 `#[derive(Serialize)] #[serde(rename_all = "camelCase")]`.
4. 프런트: `src/backend/<도메인>.ts`에 `export async function myCmd(wsPath: string) { if (!isTauri()) return fallback; return invoke<T>("my_cmd", { wsPath }); }`.
5. 화면은 브리지 함수만 부른다. 화면에서 `invoke` 직접 호출 금지.

### 10.2 Rust → 프런트 이벤트 추가

1. Rust: `app.emit("my-event", Payload{…})` (특정 창이면 `emit_to("main", …)`). 페이로드 구조체는 camelCase.
2. 프런트: 브리지 모듈에서 `listen<Payload>("my-event", e => …)`를 **1회만** 등록 (`ensure*Listeners` 패턴, 모듈 레벨 latch).
3. 순서가 중요한 상태 이벤트면 `seq`를 싣고 프런트에서 `staleSeq` 같은 가드를 둔다.
4. §7.2 표에 한 줄 추가.

### 10.3 화면(View) 또는 오버레이 추가

- 화면: `state.ts`의 `View` 유니언에 `{kind:"myscreen"; wsId: string}` 추가 → `App.tsx`의 `<Switch>`에 `<Match when={view().kind === "myscreen"}>` → 진입 버튼에서 `setView({kind:"myscreen", wsId})`.
- 오버레이: `OverlayKind`에 이름 추가 → `App.tsx` 오버레이 블록에 `<Show when={overlay()==="mine"}>` (`ScreenOverlay`로 감싸면 ESC·제목이 공짜) → 앱바에 `toggleOverlay("mine")`.
- 오버레이가 떠 있는 동안 브라우저 패널 자식 웹뷰는 `.overlay` 존재로 자동 숨김된다. 다른 최상위 요소를 만들면 `BrowserPanelTab`의 숨김 조건에 추가.

### 10.4 사이드 패널 탭 추가

1. `state.ts`의 `PanelTab` 유니언에 추가.
2. `components/SidePanel.tsx`의 탭 목록과 렌더 스위치에 컴포넌트 연결.
3. 새 `components/MyPanelTab.tsx`. 스코프는 반드시 `scopeWorkspace()`에서 받고, 없으면 빈 상태를 그린다(첫 워크스페이스 폴백 금지).
4. 폴링이 필요하면 `ports.ts`처럼 **앱 전역 워처 하나** + 패널이 열려 있을 때만 빠른 주기(`holdFastPoll` 패턴).

### 10.5 설정 항목 추가

1. `src/backend/settings.ts`: `AppSettings`에 필드, `DEFAULT_SETTINGS`에 기본값, `sanitize`에 허용값 검사.
2. `screens/Settings.tsx`의 섹션 배열에 행 추가(`updateSettings({key})`).
3. Rust가 읽어야 하면 `setting_str(app, "key")`/`setting_bool(app, "key", default)`. CLI가 읽어야 하면 `EQMUX_SETTINGS_FILE`을 직접 파싱하는 `cli.rs` 패턴.
4. i18n 키(§10.10).

### 10.6 메시지 타입 추가

1. `messages.rs`의 `TYPES` 배열.
2. `types.ts`의 `ConversationMessage.type` 유니언, `conversation.ts`의 타입 관련 매핑.
3. `components/ConversationTab.tsx` 타입 선택기, `cli.rs`의 `USAGE` 문자열, `lib.rs`의 `--append-system-prompt` 안내 문자열(`ask|handoff|report|review|escalate` 나열 부분).
4. 전달 규칙(§6.3)은 타입과 무관하므로 손댈 필요 없다.

### 10.7 훅 이벤트 또는 상태 전이 변경

1. `lib.rs write_hook_settings`의 이벤트 목록에 추가.
2. `agent.rs hook_effect`에 분기 추가 → `HookEffect` variant(필요 시) → `apply_effect`에서 `Tracked` 갱신과 `Some(false)`(전이)/`Some(true)`(조용)/`None`(무시) 결정.
3. 같은 파일의 `#[cfg(test)]`에 전이 테스트 추가 (순수 함수라 `AppHandle` 없이 된다).
4. 프런트 어휘를 바꾸는 경우(새 status): `types.ts AgentStatus`, `agent.ts STATUSES`, `ATTENTION_ORDER`, `ui.tsx statusClass/StatusLabel`, CSS `.sdot.<status>`, i18n. 색은 `waiting`·`dead`에만.
5. §6.1 표 갱신.

### 10.8 SQLite 스키마 변경

1. `store.rs SCHEMA`에 `CREATE TABLE IF NOT EXISTS` 추가는 안전. 기존 테이블 열 추가는 `open_db`의 `ALTER TABLE … ADD COLUMN` 패턴(오류 무시)으로.
2. 읽는 쪽은 새 열이 없는 옛 DB도 열어야 한다 — `scrollback_tail`처럼 `prepare` 실패 시 구 쿼리로 폴백.
3. 파괴적 변경이면 `meta.schema_version`을 올리고 마이그레이션을 `open_db`에 넣는다. 현재는 버전 와이프(`data.ver`)가 사실상의 마이그레이션이므로, 릴리스 노트에 "데이터 초기화됨"을 적는 것도 방법이다.
4. 새 `StoreMsg` variant는 `flush`의 `match`에도 SQL을 추가한다.

### 10.9 직무 · 페르소나 · 프리셋 추가

- 사용자 관점: 역할 라이브러리 화면에서 만들면 `%APPDATA%\com.eqment.eqmux\{jobs,personas}`에 파일이 생긴다. 워크스페이스 전용은 `<repo>/.eqmux/{jobs,personas}`에 같은 형식으로 두면 병합된다.
- 번들 시드를 바꾸려면 `library.rs fixed_jobs()` / `seed()`의 페르소나·프리셋 배열, 프런트 `jobs.ts JOB_META`(배지 라벨·색). push 가능 직무 개수 테스트(`lead`·`release` 둘뿐)가 있으니 함께 고친다.
- 프리셋 파일명 접두 숫자가 정렬 순서다. 레거시 마이그레이션 트리거(`02-impl-heavy.json` 존재)는 필요 없어지면 지운다.

### 10.10 i18n 키 추가

1. 코드에 한국어 원문 그대로 `t("새 문자열")` (모듈 상수 아님, 렌더 시점).
2. `src/i18n/<영역>.ts`의 `dict`에 `"새 문자열": "New string"`.
3. 변수는 `tf("{n}건 대기", {n})`.

### 10.11 새 에이전트 CLI 지원

- 탐지만: `agentscan.rs KNOWN`에 `("토큰","표시명")` 추가. 프로세스 이름에 토큰이 있으면 대시보드 배지에 뜨고, 세션 추가 대화상자의 "셸 CLI" 카드에 설치 여부와 함께 나온다.
- 관리(역할 주입·훅·재개)까지: 현재 구조는 `claude` 한 종을 전제로 `agent.rs`가 레지스트리 경로·훅 이름·트랜스크립트 포맷을 알고 있다. PRD D가 말하는 `ClaudeCodeAdapter` 경계(`spawn · observe · resumeInfo · capabilities`)를 실제 trait로 뽑아내는 것이 첫 작업이다. 손댈 파일: `agent.rs`(레지스트리·훅), `lib.rs agent_spawn_inner`(argv), `transcript.rs`, `cli.rs`(훅 어댑터).

### 10.12 "화면이 실제와 다르다" 류의 버그를 잡을 때

1. 그 값의 **원천이 무엇인지** 먼저 정한다: 프로세스(Job pid, PTY 생존), 파일(`.eqmux`, 레지스트리), DB(재개 앵커), 프런트 파생값(`sinceMs`, `resumable` 기본값).
2. 원천이 하나가 아니면 하나로 줄인다. 이 저장소의 최근 버그 대부분이 "같은 질문에 세 곳이 다르게 답하던" 종류였고, 고친 방식은 항상 `canInject`·`forgetAgent`·`session_origin`처럼 **한 곳에서 한 번 답하게** 만드는 것이었다.
3. 화면은 원천을 **재측정**해서 그린다. 캐시를 믿고 그리면 다시 갈라진다.

---

## 11. 불변식과 함정

### 11.1 절대 규칙 (깨면 제품 정의가 무너진다)

| 규칙 | 근거 ID | 코드 위치 |
|---|---|---|
| 팀·역할·임무의 원본은 파일. DB는 캐시. 충돌 시 파일이 이긴다 | FR-C-23, FR-E-74 | `team.rs`, `roles.rs` 주석, `lib.rs` `assignment_cache` 주석 |
| 사용자의 `CLAUDE.md`·`~/.claude/settings.json`·저장소 `.claude/`를 읽거나 쓰지 않는다 | FR-E-70, FR-D-31 | `write_hook_settings`, `agent_spawn_inner` |
| `bypassPermissions`·`--dangerously-skip-permissions`를 어떤 경로로도 만들지 않는다 | D5 | `agent.rs claude_builders`, `lib.rs` 주석 |
| 자동 실행 없음: 자동 재개·자동 재시작·자동 승인·일괄 조작 없음 | C5, D7, FR-D-22/51, G7 | 재개는 버튼, 크래시는 표시만, 대시보드 행동은 점프·재개·중지뿐 |
| 저장소 안에 쓰는 것은 `.eqmux/` 아래 텍스트뿐. 바이너리는 앱데이터 | FR-E-71, FR-C-20a | |
| `team.json`에 절대경로 금지 (워크트리는 플래그) | W3, E1′ | `team.rs` 주석 |
| 앱은 API 키를 갖지 않는다 | J2 | 코드에 HTTP 클라이언트가 없다 |
| 훅·statusLine CLI는 어떤 실패에도 exit 0 — 에이전트 흐름 불가침 | FR-D-35/36 | `cli.rs silent` |

### 11.2 동시성 규율

- 전역 `PtyState` 잠금은 `Arc` 복제·`remove`에만. 블로킹 호출은 잠금 밖 + 스레드 (B14).
- `AgentRt`의 뮤텍스 5개를 동시에 두 개 잡지 않는다. 특히 `by_uuid` 안에서 `session_origin`/`find_tracked`를 부르면 재진입 교착.
- 동기 Tauri 커맨드는 메인 스레드에서 돈다. git·파일 트리·netstat·`trash`는 `async + spawn_blocking`.
- `gen`(PTY 세대)과 `seq`(상태 이벤트 순번)를 무시하면 늦게 도착한 옛 정리·옛 상태가 새 것을 덮어쓴다.
- store 채널은 50,000건 상한의 `sync_channel`이다. writer가 막히면 PTY reader가 뒤로 밀리는 것이 의도(배압)다.

### 11.3 PTY에 글자를 넣을 때

- `canInject(s)`가 유일한 게이트다. `idle`이 아니거나 사람이 타이핑 중이면 넣지 않는다. 승인 프롬프트(select 목록)에 `\r`이 들어가면 **앱이 대신 승인한 것**이 된다 (G7 위반 사고, `b45b477`).
- 기본 터미널(`personaId` 없음)에는 절대 PTY에 쓰지 않고 `echoPty`로 화면에만 (P-2).
- 주입 본문은 한 줄. 본문 → 80 ms → `\r` → 400 ms. 세션별 promise 큐.
- `writePty`(주입)는 `noteUserInput`을 거치지 않으므로 "타이핑 중"으로 오인되지 않는다.

### 11.4 파일 · 프로세스 · 화면의 정합

- 세션 id는 결정적(`persona@ws`)이라 재사용된다. 제거 시 `forgetAgent`(터미널 폐기 + `agent_forget` + 재개 앵커 삭제)를 반드시 거친다.
- `resumable`은 측정값이다. 기본 false, `team_load`/`agent-state`만 true로 올린다.
- 임무 배정·역할 파일은 `sess.cwd || ws.path`에 쓴다(워크트리 세션은 워크트리 안). 조회는 루트+워크트리를 모두 스캔하고 워크트리가 이긴다.
- `team.json`의 `worktree`는 보존, 존재 여부는 `worktreeMissing`으로 따로.
- `exit_code NULL` = 크래시. 정상 종료는 `unwrap_or(-1)`로라도 값을 쓴다.
- 레지스트리는 `kind == "interactive"`만 입양, 같은 `sessionId`는 최신 mtime 승, `dead`는 부활 금지.
- `agentAttached`는 상태만 본다. `agentSessionId`는 "한때 붙었었다"의 기록이지 현재가 아니다.

### 11.5 외부 편집과 손실 방지

- 라이브러리·탐색기 저장은 mtime 충돌 검사(P-7). 충돌 시 새로고침 후 다시 저장하라고 안내하되, 편집 시작 시점의 mtime을 시그널에 잡아 두어야 "다시 누르면 남의 편집을 덮는" 사고가 나지 않는다.
- `layout.ts`·`settings.ts`는 로드 실패 시 저장을 시작하지 않는다.
- `workspace::load_strict`는 깨진 등록부를 `[]`로 덮어쓰지 않는다.
- 탐색기 삭제는 휴지통만. 이름 바꾸기는 같은 부모 안에서만. `.git`은 불가침.
- 워크트리 삭제 기능은 없다 — 커밋 안 된 작업은 사람이 정리한다.

### 11.6 알려진 스펙-코드 괴리 (PRD ≠ 코드)

| 항목 | PRD | 코드 |
|---|---|---|
| 팀 관계 4종(보고·지도·리뷰·협업), LEAD 1명 | FR-E-14/15 | `TeamSlot`에 관계 필드 없음. 역할 파일의 `## 팀 관계` 표(슬롯·이름·직무)만. LEAD = 슬롯 1 표시 |
| 슬롯 1~4 | FR-E-13 | 1~8 (`HARD_MAX_SLOTS`) |
| 페르소나 `avatar` frontmatter | FR-E-23 | 파싱 안 함 (`color`, `level`, `job`만) |
| 시드 직무 4종·프리셋 4종(표준/집중구현/리뷰중심/탐색) | FR-E-26/27 | 직무 8종 고정, 프리셋 표준/집중개발/제품기획/품질 |
| `.eqmux` 스키마 버전·마이그레이션 | FR-E-75 | `TeamFile.version=1`만 쓰고 읽어서 분기하지 않음 |
| `command` 테이블(OSC 133) | FR-C-26 | 스키마만, 미사용 |
| 500 MB/워크스페이스·2 GB 전역 상한 | FR-C-50 | 줄 수(1,000/세션)와 30일만 구현 |
| 파이프 ACL(같은 OS 사용자 제한) | FR-C-41 | 이름에 사용자명을 넣을 뿐 ACL은 걸지 않음 |
| `--debug-file`, `--add-dir`, `--model/--effort` | PRD D §4.1.1 | 넘기지 않음 |
| 워크스페이스 동시 오픈 10개 | FR-E-05 (하드) | 프런트만 검사, Rust 미검사 |
| 훅 왕복 50 ms 경고 | FR-D-38 | 없음 (훅 `timeout: 5`초만) |

### 11.7 자주 밟는 함정 모음

- `git` 인자에 `--`를 쓰면 브랜치가 pathspec이 된다. `--end-of-options`를 쓴다.
- `core.quotepath=off` 없이는 한글 파일명이 8진수로 온다.
- xterm `attachCustomKeyEventHandler`에서 `false`만 돌려주면 브라우저 기본 동작이 남는다. `preventDefault()`도 부른다.
- `UnicodeGraphemesAddon`은 첫 `write` 전에, `allowProposedApi: true`로. 없으면 `loadAddon`이 throw하고 페인 생성 전체가 죽는다 (0.3.2 사고).
- `Window::add_child` 자식 웹뷰는 메인 웹뷰 위에 항상 그려진다. 다이얼로그·탭 전환·전체 화면 탐색기에서 `browser_visible(false)`.
- Solid의 `on()`은 추적 시그널이 재방출될 때마다 다시 돈다. 저장 다이얼로그에서 포커스가 돌아올 때 `scopeWorkspace`가 재방출돼 결과 줄을 지우던 사고가 있었다 — 결과에 워크스페이스 태그를 붙여 보관한다.
- `Job::pids()` 버퍼는 고정 크기면 안 된다 (`ERROR_MORE_DATA` → 빈 목록 → 포트·메모리·탐지 전부 사라짐).
- 레지스트리 파일은 프로세스보다 오래 산다. `read_dir` 순서를 믿으면 죽은 레코드가 이긴다.
- `main.rs` 게이트를 "아는 커맨드만 CLI"로 바꾸면 에이전트의 오타마다 앱 창이 하나씩 늘어난다.
- 버전을 올리면 `data.ver` 와이프로 DB가 지워진다.

---

## 12. 용어집

| 용어 | 뜻 |
|---|---|
| 워크스페이스 | git 저장소 1개 = 팀 1개 = 탭 1개 = `session.db` 1개. id는 `폴더명-해시` |
| 세션 | 에이전트 1명 = 터미널 페인 1개 = PTY 1개 = Job Object 1개. id는 `persona@ws` 또는 `shellN@ws` |
| 세션 페인 / 보조 페인 | 세션을 소유한 터미널 페인 / 에디터·diff·브라우저·트랜스크립트 (슬롯을 소비하지 않음, "보조 세션"이라는 말은 금지) |
| 패널 | 사이드 서랍 (대화·git·포트·로그·브라우저). 페인이 아니다 |
| 슬롯 | 워크스페이스 안의 세션 자리 1~8 (설정 `maxSlots` 4·6·8) |
| 직무(job) | 무엇을 하는가 — 책임·금지·기본 권한. 고정 8종 |
| 페르소나(persona) | 어떻게 판단하고 말하는가 — 판단 성향·말투·성격·캐릭터 시트. 3단계(basic/mid/adv) |
| 역할(role) | 직무 + 페르소나 + 팀 관계 + 임무 블록을 합성한 `roles/<세션>.md` |
| 임무(mission) | 저장소 안의 작업 단위 — 이름·목표·산출물·선택적 브랜치. `missions/<id>.md` |
| 캐스팅 | 슬롯마다 직무+페르소나를 배정하는 행위. 프리셋은 직무만 정한다 |
| 워크트리 격리 | 세션 전용 `git worktree` (`.eqmux/worktrees/<세션>`, 브랜치 `eqmux/<세션>`) 옵트인 |
| shell-first | 모든 세션은 셸로 시작하고, 에이전트는 사람이 기동 버튼을 눌러야 뜬다 |
| 입양(adopt) | 앱이 띄우지 않은 `claude`를 레지스트리 pid ↔ Job 트리 대조로 페인에 붙이는 것 |
| degraded | 세션 레지스트리를 읽지 못해 훅+프로세스 생존만으로 상태를 유지하는 저신뢰 모드 |
| 재개(resume) | `claude --resume <uuid>`로 같은 cwd에서 대화를 잇는 것. 앵커는 `agent_session` 테이블 |
| 권한 재시작 | 권한이 바뀌면 플래그가 고정이라 재개 방식으로 프로세스를 다시 띄우는 것 (`restartNeeded`) |
| 인박스 | 지금 주입할 수 없는 메시지를 세션별로 보관하는 곳. `assignment_cache` `inbox` 키에 영속 |
| 주입(inject) | 메시지·브리핑·알림 문장을 PTY에 써서 에이전트의 턴을 시작시키는 것 |
| 에코(echo) | 화면에만 보여 주고 PTY에는 쓰지 않는 것 (기본 터미널) |
| 미확인(unseen) | `waiting`/`dead` 진입으로만 찍히는 세션별 표식. 페인 클릭·모두 확인으로 지움 |
| 레지스트리 | `~/.claude/sessions/<pid>.json`. Claude Code가 상태를 쓰는 파일. 1차 상태 소스 |
| 훅 | Claude Code가 이벤트마다 실행하는 명령 `eqmux _hook <Event>`. 2차 상태 소스 |
| statusLine | Claude Code가 상태줄을 그릴 때마다 실행하는 `eqmux _statusline`. 비용 수집 |
| 트랜스크립트 | `~/.claude/projects/<cwd>/<uuid>.jsonl`. 참조만 하고 복사하지 않는다 |
| 스크롤백 | 확정된 터미널 줄. 메모리 5,000줄(xterm) + 디스크 1,000줄/세션(SQLite) |
| 재생(replay) | 재시작 시 디스크 스크롤백 마지막 N줄을 페인에 흐리게 다시 쓰는 것 |
| 원장(ledger) | `message` 테이블. 편집·삭제되지 않는다 |
| 이벤트 피드 | `event` 테이블. 상태 전이·세션 시작/종료·보고·프런트 조작 |
| 결정 ID | `docs/prd/00-index.md`의 C1·D5·G7·FR-E-40 같은 번호. 코드 주석과 이 문서가 참조 |
| B-번호 / P-번호 / M-번호 | 감사 항목(`interview.csv`) / 원칙 / 마일스톤 번호. 코드 주석의 출처 표기 |
