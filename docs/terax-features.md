# Terax 기능 정리

> 출처: https://terax.app/docs (전체 문서 22페이지, 2026-08-10 조사) · https://github.com/crynta/terax-ai
>
> Terax는 "Tauri 2 + React 19로 만든 가벼운 터미널 우선(terminal-first) AI 네이티브 개발 워크스페이스"다.
> 터미널·에디터·파일 탐색기·소스 컨트롤·웹 프리뷰·에이전트 AI를 **창 하나**에 통합하면서
> 번들 크기 **약 7~8MB**를 유지하는 것이 핵심 포지셔닝.
> 텔레메트리 없음, 계정 불필요, 클라우드 모델은 **BYOK**(자기 키 지참)이며 LM Studio·MLX·Ollama로
> 완전 로컬 실행도 가능하다. 오픈소스(`crynta/terax-ai`).

---

## 🖥️ 터미널

### 렌더링 · PTY 아키텍처

- **xterm.js + WebGL 애드온** 렌더링. 2-프로세스 모델 — Rust 백엔드(`src-tauri`)가 `portable-pty` 크레이트로
  PTY를 소유하고, React 프런트엔드가 Tauri `Channel<PtyEvent>`로 출력 스트림을 받아 WebGL 캔버스에 그린다
- 트루컬러, 링크 감지, 부드러운 스크롤, **테마 엔진과 공유되는 색 팔레트**
- 드라이버 문제 시 Settings → General에서 WebGL을 끄고 canvas 폴백 사용
- **진짜 PTY 구현** — 서브프로세스 래퍼가 아님. 탭마다 `xterm.Terminal` 인스턴스를 한 번 만들어
  세션 수명 동안 마운트 유지, 탭 전환은 캔버스를 숨길 뿐 세션을 파괴하지 않음
- 렌더링 설정: 폰트 패밀리, 폰트 크기 **8–32**(프리셋 10/12/13/14/15/16/18/20/22/24),
  자간(letter spacing), 스크롤백 **200–50,000줄**(프리셋 500/1k/2k/5k/10k/25k), WebGL 토글

### Windows 프로세스 관리

- PTY 세션마다 **Job Object** 부여 + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` —
  Terax가 크래시해도 자식 프로세스가 확실히 종료됨
- 동시 spawn은 **spawn mutex**로 직렬화 (ConPTY 출력 파이프가 멈추는 문제 방지)
- 탭을 닫으면 즉시 셸 자식 종료. Windows에서는 Job HANDLE이 드롭될 때
  정상 종료·패닉·SIGKILL 어느 경로든 자손 트리 전체가 정리됨

### 탭 · 스플릿

- `Cmd+T` 새 터미널 탭 / `Cmd+R` **프라이빗 터미널**(cwd·환경 격리) / `Cmd+W` 닫기
- `Cmd+1`~`Cmd+9` 인덱스 점프, `Ctrl+Tab`·`Ctrl+Shift+Tab` 순환
- 새 탭은 활성 탭의 작업 디렉터리를 **OSC 7 기반으로 상속**
- 스플릿 페인은 탭 하나 안의 독립 PTY 세션 — 리사이즈·개별 닫기 가능
  (`Cmd+D` 우측, `Cmd+Shift+D` 하단, `Cmd+[`/`Cmd+]` 포커스 이동)

### 셸 지원

- Unix는 `$SHELL`, Windows는 `pwsh.exe` → `powershell.exe` → `cmd.exe` 순으로 탐색
- 기본 지원: **zsh, bash, pwsh, PowerShell 5.1, cmd, fish**
- PowerShell 7+ 를 선호하는 이유는 번들 초기화 스크립트(`profile.ps1`)가
  prompt 함수를 래핑해 셸 통합 마커를 내보내기 때문

### 셸 통합 (OSC)

- **주입 방식**
  - zsh — `ZDOTDIR`로 `zshenv.zsh` / `zprofile.zsh` / `zlogin.zsh` / `zshrc.zsh` 주입,
    내부에서 사용자의 실제 `~/.zshrc`를 소싱
  - bash — `--rcfile`로 `bashrc.bash` 주입, 사용자 `~/.bashrc`를 함께 소싱
  - PowerShell — `pwsh -NoLogo -NoExit -ExecutionPolicy Bypass -File <path>`로 `profile.ps1` 전달,
    실제 `$PROFILE`이 먼저 실행된 뒤 Terax가 prompt 함수를 래핑
  - cmd.exe — 통합 없음(PowerShell 계열이 없을 때의 폴백 전용)
- **사용 시퀀스**
  | 시퀀스 | 역할 |
  |---|---|
  | `OSC 7` | cwd 변경 시마다 방출 — 상태바 브레드크럼·탐색기 루트 구동 |
  | `OSC 133;A` | 프롬프트 시작 |
  | `OSC 133;B` | 프롬프트 끝 / 사용자 입력 시작 |
  | `OSC 133;C` | 명령 출력 시작 — **터미널 에이전트 감지기 무장** |
  | `OSC 133;D` | 명령 종료 + 반환 코드 |
  | `OSC 777` | Terax 확장 — 에이전트 상태 알림 |
- 현재 **모든 PTY에서 항상 켜짐**(세션별 토글 없음). 훅은 파괴적이지 않고 가산적이라
  Starship·oh-my-zsh 등 프롬프트 프레임워크와 호환

### 검색

- `Cmd+F` — 활성 터미널 버퍼 대상 인라인 검색 오버레이(하이라이트, 다음/이전, 대소문자 토글).
  동일 오버레이가 에디터 탭에도 적용됨

### 워크스페이스 환경 (실행 컨텍스트)

- 새 탭이 실행될 컨텍스트 = **Local**(macOS/Linux/Windows) 또는 Windows의 **설치된 WSL 배포판**
- WSL은 서브프로세스 래퍼가 아닌 1급 환경 — 백엔드가 `wsl.exe`로 배포판 열거·기본값 식별·홈 경로 해석
- 헤더의 워크스페이스 스위처로 선택하며, **한 창에서 Local PowerShell 탭과 WSL-Ubuntu bash 탭 동시 실행** 가능
- cwd 흐름: `cd` → 셸 통합이 OSC 7로 방송 → 활성 탭 cwd 갱신 → 상태바·탐색기 갱신 → 새 탭이 상속
- Windows 경로는 경계에서 슬래시(`/`) 형태로 정규화

## 🤖 에이전트

### 프로바이더 · 모델 (BYOK)

- **Vercel AI SDK v6** 기반. 클라우드 프로바이더 — OpenAI, Anthropic, Google(Gemini), Groq, xAI(Grok),
  Cerebras, OpenRouter, DeepSeek, Mistral, **OpenAI 호환**(커스텀 base URL, Chat Completions 포맷)
- **로컬/오프라인** (키 선택 사항)
  | 프로바이더 | 기본 base URL |
  |---|---|
  | LM Studio | `http://127.0.0.1:1234/v1` |
  | MLX | `http://127.0.0.1:8080/v1` |
  | Ollama | `http://127.0.0.1:11434` |
  base URL은 설정에서 변경 가능하며 저장 시 도달 가능 여부를 검증
- **키 저장 — OS 키체인 전용**(`keyring` 크레이트, 서비스 `terax-ai`):
  macOS Keychain / Windows 자격 증명 관리자 / Linux Secret Service(libsecret, 헤드리스는 파일 폴백).
  "키는 설정 파일·`localStorage`·환경변수에 절대 닿지 않는다"
- 기본 모델(`DEFAULT_MODEL_ID`)과 **자동완성 전용 기본 모델**(`DEFAULT_AUTOCOMPLETE_MODEL`)을 분리 지정.
  모델 피커는 활성 프로바이더 레지스트리 + 핀 고정 즐겨찾기 + 최근 선택을 함께 표시

### Composer (입력 표면, `Cmd+I`)

- **첨부** — 이미지(붙여넣기·드래그·첨부), 텍스트 파일(`<file path="...">` 블록),
  터미널/에디터 선택 영역(`<selection source="terminal | editor">...</selection>`).
  `Cmd+L`로 선택 텍스트를 칩으로 첨부
- **`@경로`** — 워크스페이스 파일 퍼지 매칭 후 파일 칩 삽입 (내용은 시크릿 deny-list로 게이트)
- **`#핸들`** — 저장된 프롬프트 조각(스니펫) 삽입, `terax-ai-snippets.json`에 보관
- **`/`** — 슬래시 커맨드 팔레트로 컴포저를 떠나지 않고 인앱 액션 실행
  (개별 커맨드 목록은 문서에 미공개)
- **음성 입력** — 마이크 아이콘으로 오디오를 트랜스크립션 파이프라인에 스트리밍, 결과가 텍스트로 입력됨
  (사용 모델은 문서에 미공개)

### 에이전트 루프 · 툴

- Vercel AI SDK v6의 `Experimental_Agent` 위에서 동작, `stopWhen: stepCountIs(MAX_AGENT_STEPS)`로 스텝 상한,
  시스템 프롬프트는 `config.ts`에서 관리
- **라이브 컨텍스트 브리지** — 현재 cwd(OSC 7)와 활성 PTY 버퍼 **최근 약 300줄**을 읽어 전달.
  사전 캐싱이 아니라 **툴 실행 시점 스냅샷**
- **툴 카탈로그**
  - 자동 실행(읽기 전용): `read_file`, `list_directory`, `fs_search`, `fs_grep`
  - 승인 필요: `write_file`, `create_directory`, `rename`, `delete`, `run_command`,
    `shell_session_run`, `shell_bg_spawn`
- 승인 대상 툴은 **인자를 그대로 보여주는 승인 카드**를 컴포저에 렌더하고 그 스텝에서 실행을 일시정지,
  수락/거부 시 `lastAssistantMessageIsCompleteWithApprovalResponses`로 자동 재개

### AI 편집 diff (직접 쓰기 금지)

- 에이전트가 파일 수정을 제안해도 **바로 쓰지 않는다** — `ai-diff` 탭을 열어 현재 내용과 나란히 표시
- **헝크 단위 수락/거부** — 좋은 수정 4개는 통과시키고 문제 있는 1개만 거부하는 부분 수락이 가능
- 메인 에이전트·서브에이전트·커스텀 에이전트에 동일하게 적용

### 플랜 모드 · 서브에이전트 · 커스텀 에이전트

- **플랜 모드** — 툴 실행 전 확인 체크포인트. 쓰기 전에 파일 경로와 범위를 담은 순서 있는 계획을 먼저 제시
  (툴별 승인 카드는 그대로 유지). 권장 상황: 3개 이상 파일에 영향, 추론 과정 사전 검토, 파괴적 작업 직전
- **서브에이전트** — 메인 에이전트가 `run_subagent`로 위임. 좁은 프롬프트 + 제한된 툴 부분집합,
  정의는 `agents/registry.ts`, 실행은 `runSubagent.ts`.
  예: `read_file`/`fs_grep`만 가진 "코드 리뷰어", 단일 디렉터리로 제한된 "리팩터" 에이전트
- 둘의 차이 — "플랜 모드는 **당신**이 계획을 승인하는 것, 서브에이전트는 **메인 에이전트**가 작업을
  쪼개는 것". 조합하면 플랜에 서브에이전트 호출이 개별 단계로 나열되어 거부할 수 있다
- **커스텀 에이전트** — Settings → Agents에서 시스템 프롬프트 + 툴 부분집합 + 아이콘/색 지정,
  `terax-ai-agents.json`에 저장. 컴포저의 에이전트 피커로 전환하며 **세션마다 선택한 에이전트를 기억**

### 세션 · 메모리

- 세션은 `terax-ai-sessions.json`에 저장 — 세션 ID·제목 `list`, 활성 포인터 `activeId`,
  세션별 `messages:<id>` 전체 히스토리
- `chatStore.ts`가 `Map<sessionId, Chat<UIMessage>>`를 유지, `getOrCreateChat(apiKey, sessionId)`로 지연 생성,
  `hydrateSessions()`가 시드, `AgentRunBridge`가 변경 때마다 디스크에 동기화
- 제목은 첫 사용자 메시지에서 자동 생성, 세션 피커에서 리네임·삭제
- **API 키를 바꾸면 인메모리 채팅 맵이 비워지지만 디스크 세션은 남아** 다음에 열 때 활성 키에 재바인딩
- **프로젝트 메모리 `TERAX.md`** — 워크스페이스 루트에서 로드(Claude Code의 `CLAUDE.md`와 같은 역할).
  세션당 한 번 로드되어 작업 컨텍스트 앞에 붙음. `AGENTS.md`를 리다이렉트 파일로 쓸 수도 있음
  (참고: 유사 개념은 [[orca-features]]의 메모리 파일 항목)
- **Custom instructions**(Settings → General) — 프로젝트와 무관하게 모든 세션에 적용되는 시스템 프롬프트 추가분
- 함께 쓰이는 저장소: `terax-ai-snippets.json`(`#핸들` 스니펫), `terax-ai-todos.json`(에이전트가 접근하는 TODO)

### 터미널 에이전트 감지 (외부 CLI)

- 현재 **Claude Code** 지원, **Codex**는 예정
- Rust 쪽 PTY 리더가 바이트를 필터링 — `OSC 133;C;<cmd>`(셸 통합의 명령 시작 마커)에서 감지기를 무장하고
  이후 명시적 `OSC 777` 신호를 감시
- 상태 전이: `started` / `working` / `attention` / `finished` / `exited`
- 셸 훅 없이 **bash·zsh·pwsh·tmux 전반에서 동작**. 명시적 OSC 시퀀스에서만 상태가 바뀌므로
  TUI가 빠르게 리페인트해도 오탐이 없고, 에이전트가 없으면 비용 0
- **Claude Code 훅 통합** — v2.1.139부터 `/dev/tty` 직접 접근이 사라져 훅 3종을 설치:
  `UserPromptSubmit` → working, `Notification` → attention, `Stop` → finished.
  각 훅은 `terminalSequence` 필드로 OSC 777 마커를 반환하며,
  `TERAX_TERMINAL` 환경변수로 게이트해 Terax 밖에서는 동작하지 않음
- `agent_claude_hooks_status` 커맨드로 설치 상태 확인, 제거 시 **Terax가 소유한 훅만 선택 제거**(사용자 훅 보존)

### 알림

- 라우터(`lib/route.ts`)가 창 상태로 전달 방식을 결정
  - 포커스 + 해당 에이전트 탭이 화면에 보임 → **억제**
  - 포커스지만 탭이 숨겨짐 → **인앱 Sonner 토스트**
  - 창 비포커스 → **OS 네이티브 알림**
- 내장 에이전트는 `LocalAgentNotificationsBridge`가 상태를 매핑 —
  `awaiting-approval`·`error` → 주의 신호, `busy`/`idle`/`finished` → 작업중/완료 신호.
  사이드 패널이든 CLI든 동일한 토스트·OS 알림 경로를 탄다
- 터미널 에이전트(Claude Code)는 `terax:agent-signal` 이벤트로 동일 흐름에 합류
- 헤더의 **알림 벨**이 모든 에이전트 활동을 모으는 단일 표면,
  Settings → Agents의 "Agent notifications" 토글로 전체 비활성화

### 보안 모델

- **툴 티어링** — 읽기 전용은 자동 실행, 파일 쓰기·삭제·디렉터리 생성·명령 실행(원샷/지속 셸)·
  백그라운드 프로세스는 승인 카드 통과 필수
- **시크릿 deny-list**(`lib/security.ts`) — `.env`·`.env.*`, `.ssh/`, `credentials`, `.netrc`,
  `.aws/credentials`, 키체인 디렉터리 등 하드코딩 차단 목록.
  "**경로 정규화 이후 Rust에서 모든 fs 툴 호출마다 강제** — 프런트엔드 편의 기능이 아니라 우회 불가"
- **워크스페이스 인가 레지스트리**(`workspace::workspace_authorize`) — AI 툴·git 명령·터미널 스폰이 모두 통과.
  새 워크스페이스는 최초 1회만 묻고 이후 유지되며, **열지 않은 형제 디렉터리에는 에이전트가 접근 불가**
- **SSRF 방어** — Rust HTTP 프록시가 loopback·link-local·사설 대역을 차단
  (명시적으로 설정한 로컬 프로바이더 LM Studio·MLX·Ollama만 예외). 프롬프트 인젝션 대응
- 키는 OS 키체인에만 존재

## 📦 기타

### 워크스페이스 레이아웃 (앱 셸)

- **워크스페이스당 창 1개**의 단일 React 앱. 탭 + 사이드 패널 구조
- **탭 6종** — Terminal(PTY 셸), Editor(CodeMirror 버퍼), Preview(개발 서버·URL),
  Markdown(렌더된 마크다운), **AI-diff**(AI 제안 편집 나란히 리뷰),
  Git 뷰(`git-diff`, `git-history`, `git-commit-file`)
- 탭 전환 시 언마운트하지 않고 CSS로 숨김 → **PTY와 개발 서버가 백그라운드에서 계속 스트리밍**.
  새 탭은 활성 탭의 작업 디렉터리를 상속
- **사이드바 3패널**(접이식) — 파일 탐색기(Catppuccin 아이콘 + 퍼지 검색),
  소스 컨트롤(git 상태·헝크 스테이징·커밋), Git History(커밋 그래프 + 커밋별 diff).
  `Cmd+B` 토글, `Cmd+Shift+E` 탐색기 포커스
- **상태바** — 활성 터미널 OSC 7 스트림 기반 작업 디렉터리 브레드크럼, 에이전트 동작 중 AI 툴 인디케이터,
  localhost URL 감지 pill(프리뷰 열기 제안)
- **헤더** — 탭바, 워크스페이스 스위처(Local + Windows의 WSL 배포판), 전체 에이전트를 나열하는 알림 벨
- 설정 창(`Cmd+,`)은 별도 창으로 열리며 General / Models / Themes / Shortcuts / Agents / About 6탭

### 에디터

- **CodeMirror 6**, 탭당 영속 인스턴스 1개 — 언마운트 없이 커서 위치·undo 히스토리·선택 유지
- 구문 강조: TypeScript/JavaScript, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, Markdown 등,
  확장자로 언어 모드 자동 감지
- **Vim 모드** — CodeMirror Vim 확장 기반 1급 지원(모션, 레지스터, 마크, 비주얼 모드, colon 커맨드 라인),
  Settings → General에서 토글
- **인라인 AI 자동완성** — 타이핑이 잠깐 멈추면 제안을 인라인 표시, `Tab` 수락·계속 입력하면 거부.
  메인 채팅 모델과 **별개 프로바이더**로 동작하며 클라우드·로컬 엔드포인트 모두 가능,
  Settings → Models의 `autocompleteEnabled`로 제어
- **에디터 테마 10종**(앱 테마와 독립) — Atom One, Aura, Copilot, GitHub Dark/Light, Gruvbox Dark,
  Nord, Tokyo Night, Xcode Dark/Light
- 키: `Cmd+F` 파일 내 찾기, `Cmd+Z` 실행 취소, `Cmd+Y` 다시 실행, `Cmd+E` 새 에디터 탭
  (나머지는 CodeMirror 네이티브 바인딩, 단축키 다이얼로그에는 발견성 목적으로 노출)

### 파일 탐색기

- Rust 백엔드 커맨드(`fs_read_dir`, `list_subdirs`) + `ignore` 크레이트 백그라운드 인덱싱
  (`.gitignore`·`.ignore` 존중)
- 키보드 내비게이션 — 방향키 이동, Enter 열기, 오른쪽/왼쪽으로 디렉터리 펼침/접기, 인라인 리네임
- 우클릭 메뉴 — 파일 생성 / 디렉터리 생성 / 리네임 / 삭제 / OS에서 보기
- 아이콘 테마 Catppuccin·Material(`iconResolver.ts`), 숨김 파일 표시 토글(Settings → General "Show hidden")
- 경로는 슬래시로 정규화 — Windows 백엔드가 UI 안정성을 위해 변환
- **퍼지 파일 검색** `Cmd+Shift+F` — Rust `fs_search`, `ignore` 크레이트가 순회하는 전체 파일을 매치 품질로 랭킹
- **전문 검색 모드** — `fs_grep`(ripgrep 엔진), glob 패턴 필터, 파일 단위 스트리밍 결과 + 라인 번호·매치 하이라이트
- **Attach to AI** — 파일은 컴포저 첨부로, 텍스트 선택은 `<selection source="...">` 블록으로 들어가
  입력창을 어지럽히지 않음 (`Cmd+L`)

### 소스 컨트롤

- 전용 Rust 모듈 구현, **모든 git 작업이 워크스페이스 인가 레지스트리를 통과**
- `Cmd+G` 또는 사이드바 아이콘으로 패널 열기. 파일은 Unstaged / Staged / Untracked로 분류
- **헝크 단위 스테이지/언스테이지**(파일 단위도 가능), discard는 확인 프롬프트,
  변경은 활성 테마 색을 쓰는 `git-diff` 탭으로 열람
- 커밋 메시지 입력 후 `Cmd+Enter` 커밋, 현재 브랜치·detached HEAD 상태 표시
- 원격 — `git_push`가 최초 푸시 시 업스트림 자동 생성, 추적 브랜치의 ahead/behind 카운트 표시,
  `git_pull_ff_only`(기본 fast-forward 강제), `git_fetch`로 원격 추적 갱신
- **Git History — 진짜 커밋 그래프**: 머지·브랜치용 레인 할당, 로컬/원격 브랜치·태그 라벨,
  커밋별 전체 diff 목록과 `git-commit-file` 탭, 원격 저장소 커밋 페이지 직링크, 커밋 검색·필터

### 웹 프리뷰

- **자동 감지** — PTY 출력에서 `http://localhost:3000`, `127.0.0.1`, Vite·Next 등 개발 서버 URL을 감시해
  상태바 pill로 "Open in preview" 제안
- 터미널 버퍼가 아니라 **PTY 출력을 직접** 감시하므로, 서버가 URL을 한 번만 출력하든
  계속 리페인트하든 감지가 동작
- `Cmd+P`로 새 프리뷰 탭을 만들고 임의 URL 직접 입력·붙여넣기
- iframe이 아닌 **네이티브 Tauri 자식 웹뷰**로 렌더 — 교차 출처 헤더 처리와 쿠키 스코프가
  일반 브라우저 내비게이션과 동일하게 동작
- Tauri 웹뷰 안에서 동작해 **HMR 웹소켓이 네이티브로 연결** — Vite·Next·Astro가 추가 설정 없이 동작
- 프리뷰 탭도 백그라운드에 마운트 유지되어 탭 간 이동에도 페이지 상태 보존

### 테마

- **앱 팔레트 10종** — `terax-default`, `nord`, `tide`, `catppuccin`, `tokyo-night`, `caffeine`,
  `claude`, `gruvbox`, `sage`, `rose-pine`. 팔레트와 무관하게 Light / Dark / 시스템 따라가기 선택
- **커스텀 테마** — 아무 프리셋의 색 토큰을 앱 안에서 편집해 생성, 앱 데이터 디렉터리의
  `terax-custom-themes.json`에 저장되어 머신 간 이식 가능, JSON으로 내보내 공유
- **배경 이미지** — Opacity(앱 배경과의 블렌드 강도), Blur(전경이 아닌 **이미지에만** 가우시안 블러),
  `bgImageStore.ts`에 캐시되어 창 전체 뒤에 적용
- 자체 테마 엔진 — `ThemeProvider`가 문서 루트에 CSS 변수를 쓰고 **xterm 색 팔레트도 같은 소스에서 구동**

### 키보드 단축키

> `Mod` = macOS `Cmd`, Linux/Windows `Ctrl`. **전부 Settings → Shortcuts에서 리매핑 가능**(충돌 감지 포함),
> 에디터 바인딩만 CodeMirror가 관리해 읽기 전용.

| 그룹 | 액션 | 기본값 |
|---|---|---|
| 일반 | 설정 열기 | `Mod+,` |
| 일반 | 단축키 목록 | `Mod+K` |
| 탭 | 새 터미널 탭 | `Mod+T` |
| 탭 | 새 프라이빗 터미널 | `Mod+R` |
| 탭 | 새 프리뷰 탭 | `Mod+P` |
| 탭 | 새 에디터 탭 | `Mod+E` |
| 탭 | 탭/페인 닫기 | `Mod+W` |
| 탭 | 다음/이전 탭 | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| 탭 | 1~9번 탭으로 점프 | `Mod+1` ~ `Mod+9` |
| 페인 | 우측/하단 분할 | `Mod+D` / `Mod+Shift+D` |
| 페인 | 다음/이전 페인 포커스 | `Mod+]` / `Mod+[` |
| 페인 | 소스 컨트롤 패널 토글 | `Mod+G` |
| 뷰 | 파일 탐색기 토글 / 포커스 | `Mod+B` / `Mod+Shift+E` |
| 뷰 | 확대 / 축소 / 초기화 | `Mod+=`(`Mod+Shift++`) / `Mod+-`(`Mod+Shift+_`) / `Mod+0` |
| 검색 | 터미널 내 찾기 | `Mod+F` |
| 검색 | 파일 검색 | `Mod+Shift+F` |
| AI | AI 에이전트 토글 | `Mod+I` |
| AI | 선택 영역으로 AI에 질문 | `Mod+L` |
| 에디터 | 실행 취소 / 다시 실행 | `Mod+Z` / `Mod+Y` |

### 설정 (6탭)

- **General** — 터미널(폰트 패밀리, 크기 8–32, 자간, 스크롤백 200–50,000, WebGL 렌더러),
  에디터(Vim 모드), 앱(로그인 시 자동 시작, 창 상태 복원, 줌 레벨, 숨김 파일 표시,
  Custom instructions = AI 세션 공통 시스템 프롬프트 추가분)
- **Models** — 프로바이더 API 키, 로컬 엔드포인트 base URL, 기본 모델 선택,
  자동완성 전용 프로바이더/모델 피커
- **Themes** — 앱 팔레트, 독립 에디터 테마, 배경 이미지(opacity·blur 슬라이더)
- **Shortcuts** — 그룹별 리매핑 + 충돌 감지 (에디터 바인딩은 읽기 전용)
- **Agents** — 에이전트 알림 마스터 토글, 커스텀 에이전트(시스템 프롬프트·툴 부분집합),
  Claude Code 훅 설치 관리
- **About** — 버전, 업데이트 채널, 라이선스, 저장소·체인지로그 링크

### 데이터 위치

- 앱 데이터 디렉터리 (번들 ID `app.crynta.terax`, Rust `dirs` 크레이트로 해석)
  | OS | 경로 |
  |---|---|
  | macOS | `~/Library/Application Support/app.crynta.terax/` |
  | Linux | `~/.local/share/app.crynta.terax/` |
  | Windows | `%APPDATA%\app.crynta.terax\` |
- 저장 파일 — `terax-settings.json`(테마·폰트·단축키·자동완성·에이전트 토글 등 사용자 설정),
  `terax-ai-sessions.json`(세션 메타·활성 ID·메시지 히스토리), `terax-ai-agents.json`(커스텀 에이전트),
  `terax-ai-snippets.json`(스니펫 핸들), `terax-ai-todos.json`(에이전트 접근 TODO),
  `terax-custom-themes.json`(커스텀 테마), `themes/`(배경 이미지·테마 에셋)
- 모든 파일은 `tauri-plugin-store`로 **원자적 쓰기**, 시작 시 스키마 자동 마이그레이션
- API 키는 이 디렉터리가 아니라 OS 키체인(`terax-ai`)에 별도 저장
- 백업/이전 — Terax 종료 후 앱 데이터 디렉터리를 복사. 키를 모두 지우려면 OS 키체인에서
  `terax-ai` 서비스 항목 삭제. 종료 상태에서 파일 직접 편집도 가능하지만 상시 사용은 권장하지 않음

### 설치 · 플랫폼

- **macOS** — 아키텍처(Apple Silicon `aarch64` / Intel `x86_64`)에 맞는 `.dmg`를 Releases에서 받아
  `/Applications`로 드래그
- **Linux**
  - Arch/AUR — `yay -S terax-bin`
  - Debian/Ubuntu — `.deb` (`libwebkit2gtk-4.1-0`, `libgtk-3-0` 필요)
  - Fedora/RHEL — `.rpm` (`webkit2gtk4.1`, `gtk3` 필요)
  - AppImage — FUSE 필요, 없으면 `--appimage-extract-and-run`으로 실행
  - Wayland 렌더링 문제 시 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 설정
- **Windows** — NSIS 인스톨러 **currentUser 모드**(관리자 권한 불필요), WebView2 오프라인 포함.
  첫 실행 시 보안 경고는 "Run anyway"로 진행. 기본 셸 탐색 순서 PowerShell 7+ → Windows PowerShell 5.1 → cmd.exe
- **소스 빌드** — Rust stable, Node 20+, pnpm, Tauri 사전 요구사항.
  `pnpm install` → `pnpm tauri dev`(개발) / `pnpm tauri build`(배포 번들)
- 첫 실행 후 Settings → Models(`Cmd+,`)에서 프로바이더 연결 — 클라우드는 API 키 입력,
  로컬은 LM Studio·MLX·Ollama 엔드포인트 지정(키 불필요)
