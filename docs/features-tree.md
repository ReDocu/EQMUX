# 전체 기능 트리 — docs/ 5개 문서 통합

> `docs/` 안의 기능 문서 5종에 정리된 **모든 기능을 트리 한 장으로** 펼친 색인이다.
> 상세 설명·근거는 각 원본 문서를 볼 것. 여기는 "무엇이 있는가"의 목록이다.
>
> | # | 제품 | 정체 | 원본 문서 | 기준일 |
> |---|---|---|---|---|
> | 1 | **Ghostty** | 터미널 에뮬레이터 (Zig · MIT) | [ghostty-features.md](ghostty-features.md) | 2026-08-02 |
> | 2 | **Orca** | 멀티 에이전트 데스크톱 IDE (워크트리 기반) | [orca-features.md](orca-features.md) | 2026-08-02 |
> | 3 | **bbarit-agent-oss** | 단독 CLI 코딩 에이전트 (Rust · MIT) | [bbarit-agent-oss-features.md](bbarit-agent-oss-features.md) | 2026-08-02 |
> | 4 | **Terax** | 터미널 우선 AI 개발 워크스페이스 (Tauri 2 + React 19) | [terax-features.md](terax-features.md) | 2026-08-10 |
> | 5 | **AgentCommender** | 팀·임무 기반 에이전트 관제 멀티플렉서 (Electron) | [agentManager-features.md](agentManager-features.md) | 2026-08-01 |
>
> 표기: `⌨` 단축키 · `△` 부분/제한적 · <sub>예정</sub> 미구현 · `—` 해당 없음

---

## 1. Ghostty — 터미널 에뮬레이터

```
Ghostty
├─ 🖥️ 터미널
│  ├─ 에뮬레이션 표준
│  │  ├─ 주류 터미널 호환 제어 시퀀스 · xterm 준수 테스트 기반 레거시 지원
│  │  ├─ 준수 우선순위: 표준 → xterm 동작 → 기타 인기 터미널
│  │  ├─ 모던 시퀀스
│  │  │  ├─ Kitty graphics protocol (터미널 내 이미지)
│  │  │  ├─ Kitty keyboard protocol (확장 키 입력)
│  │  │  ├─ 클립보드 시퀀스
│  │  │  ├─ synchronized rendering (동기화 화면 갱신)
│  │  │  ├─ 라이트/다크 모드 변경 알림
│  │  │  └─ 하이퍼링크
│  │  └─ Ghostty 전용 시퀀스                                    <sub>보류(생태계 파편화 우려)</sub>
│  ├─ 성능
│  │  ├─ GPU 가속 렌더링 — macOS Metal · Linux OpenGL
│  │  ├─ 멀티스레드 (터미널마다 읽기/쓰기/렌더 전용 스레드)
│  │  ├─ 파서 CPU별 SIMD 명령 활용
│  │  └─ Alacritty급 최고 속도 계층 목표 (시작·스크롤·IO·렌더 균형)
│  ├─ 창 · 탭 · 스플릿
│  │  ├─ 멀티 윈도우
│  │  ├─ 탭 (이름 변경 · 색상 지정)
│  │  ├─ 스플릿 페인
│  │  └─ 전부 플랫폼 네이티브 UI 컴포넌트 (커스텀 위젯 아님)
│  ├─ 텍스트 렌더링
│  │  ├─ 리가처 폰트 + 폰트 피처 개별 토글
│  │  ├─ Grapheme clustering (다중 코드포인트 이모지 = 한 글자)
│  │  └─ RTL 스크립트(아랍어·히브리어) 표시
│  ├─ 테마
│  │  ├─ 수백 개 내장 테마 (iterm2-color-schemes 기반 · 주간 갱신)
│  │  ├─ 라이트/다크 자동 전환 — `theme = dark:...,light:...`
│  │  ├─ 커스텀 테마 = 설정 파일 (사용자 설정이 테마를 오버라이드)
│  │  ├─ 탐색 — `ghostty +list-themes` · `$XDG_CONFIG_HOME/ghostty/themes`
│  │  └─ 색 키 — background · foreground · cursor-color · cursor-text
│  │              selection-foreground · selection-background · palette(16색)
│  ├─ 셸 통합
│  │  ├─ 자동 통합 셸 — bash · elvish · fish · nushell · zsh (basename 감지 후 주입)
│  │  ├─ 프롬프트에 커서 있으면 종료 확인 생략
│  │  ├─ 새 터미널이 직전 포커스 터미널의 cwd에서 시작
│  │  ├─ 복잡한 프롬프트는 리플로우 대신 셸 리드로우로 리사이즈
│  │  ├─ `jump_to_prompt` — 프롬프트 단위 스크롤
│  │  ├─ 프롬프트에서 커서가 바(bar) 형태로 변환
│  │  ├─ Ctrl+트리플클릭(macOS Cmd) 명령 출력 선택 · Alt+클릭 프롬프트 커서 이동
│  │  ├─ sudo 자동 래핑(terminfo 보존) · ssh 자동 래핑          (둘 다 기본 꺼짐)
│  │  └─ `shell-integration = <shell|none>` 강제/비활성 · 수동 소싱(GHOSTTY_RESOURCES_DIR)
│  ├─ SSH (`ghostty +ssh`)
│  │  ├─ 환경 전달 — COLORTERM · TERM_PROGRAM · TERM_PROGRAM_VERSION (SendEnv)
│  │  ├─ terminfo 자동 설치 — `tic` 설치 후 TERM=xterm-ghostty, 실패 시 xterm-256color 폴백
│  │  ├─ 설치 캐시 — user@hostname 단위 · `+ssh-cache` CLI · `--cache=false`
│  │  ├─ `--ssh=PATH` 대체 클라이언트 지정
│  │  ├─ `shell-integration-features = ssh-env,ssh-terminfo` 투명 래핑
│  │  └─ 수동 경로 — ~/.ssh/config SetEnv/SendEnv (OpenSSH 8.7+)
│  ├─ 키바인딩
│  │  ├─ 문법 `keybind = trigger=action` (shift/ctrl/alt/super + 키)
│  │  ├─ 유니코드 코드포인트 트리거 (비US 레이아웃, 예 `ctrl+ö`)
│  │  ├─ 트리거 프리픽스 — all: · global:(macOS 전역) · unconsumed: · performable:
│  │  ├─ 액션 — ignore · unbind · text: · csi: · esc: 등 수십 종
│  │  └─ 런타임 설정 리로드  ⌨ Ctrl+Shift+, / Cmd+Shift+,
│  ├─ macOS 전용
│  │  ├─ SwiftUI/AppKit 네이티브 앱 (네이티브 윈도잉·메뉴바·설정 GUI)
│  │  ├─ Quick Terminal (드롭다운 오버레이)
│  │  ├─ AppleScript 자동화
│  │  │  ├─ 객체 모델 application → windows → tabs → terminals
│  │  │  ├─ new window / new tab / split(4방향) / focus / select tab / close
│  │  │  ├─ input text · send key(수정자) · send mouse · perform action
│  │  │  ├─ new surface configuration (폰트·cwd·명령·초기입력·환경변수 재사용)
│  │  │  └─ tmux식 레이아웃 구성 · 다중 터미널 브로드캐스트
│  │  ├─ Apple Shortcuts 통합 (AppIntents)
│  │  ├─ Proxy Icon (타이틀바 파일 참조 드래그)
│  │  ├─ Quick Look (세 손가락 탭)
│  │  ├─ Secure Keyboard Entry + 잠금 인디케이터
│  │  └─ Metal 렌더러 + CoreText 폰트 탐색
│  └─ Linux 전용
│     ├─ GTK4(Zig) 빌드 · 표준 GTK 통합
│     ├─ systemd 딥 통합
│     ├─ 단일 인스턴스 새 창
│     └─ cgroup 격리
├─ 🤖 에이전트
│  ├─ 내장 에이전트 기능 없음 (순수 터미널 에뮬레이터)
│  ├─ 에이전트 CLI 기반 인프라 역할
│  │  └─ Kitty keyboard(수정자 완전 전달) · Kitty graphics · synchronized rendering · 하이퍼링크
│  └─ Orca가 첫 실행 시 Ghostty 테마·폰트·커서 설정 임포트
└─ 📦 기타
   ├─ 설정 시스템
   │  ├─ 위치 — $XDG_CONFIG_HOME/ghostty/config(.ghostty)
   │  │         macOS 추가 ~/Library/Application Support/com.mitchellh.ghostty/
   │  ├─ 문법 `key = value` · `#` 주석 · 빈 값 = 기본값 리셋
   │  ├─ 모든 설정 키가 CLI 플래그로도 동작 (`ghostty --background=282c34`)
   │  ├─ `config-file` 분할 포함 · `?` 프리픽스 선택적 포함
   │  ├─ 런타임 리로드 (일부는 새 터미널부터 적용)
   │  └─ 문서화 — man 페이지 · $prefix/share/ghostty/docs · `+show-config --default --docs`
   ├─ CLI 액션 — +list-themes · +show-config · +ssh · +ssh-cache · +crash-report
   ├─ libghostty (임베더블 라이브러리)
   │  ├─ C-ABI 크로스플랫폼 코어 (macOS/Linux GUI가 공유 Zig 코어 소비)
   │  ├─ libghostty-vt — 시퀀스 파싱·상태 관리 (macOS/Linux/Windows/WebAssembly)
   │  ├─ Doxygen C API 문서 · C/Zig 예제 · 최소 구현 Ghostling · awesome-libghostty
   │  └─ 무의존성(zero-dependency) 설계
   ├─ 크래시 리포터 — .ghosttycrash를 $XDG_STATE_HOME/ghostty/crash에 저장(Sentry envelope)
   │  └─ 자동 전송 없음 · `+crash-report`로 사용자가 직접 확인·공유
   └─ 플랫폼 · 배포 · 상태
      ├─ 앱 — macOS · Linux (Windows 계획 단계)
      ├─ 설치 — macOS 바이너리 · Linux 배포판 패키지/소스 빌드 (제로 설정 철학)
      ├─ GitHub 59k+ 스타 · MIT · "수백만 머신 일상 사용" 안정 단계
      └─ 로드맵 6대 목표 중 5개 완료 (전용 시퀀스만 미착수)
```

---

## 2. Orca — 멀티 에이전트 데스크톱 IDE

```
Orca
├─ 🖥️ 터미널
│  ├─ xterm.js 기반 터미널 (VS Code와 동일 엔진) + 에이전트 워크플로 확장
│  ├─ 탭 · 스플릿  ⌨ Cmd-\ 우측 · Cmd-Shift-\ 하단 · Cmd-T 새 탭
│  │              ⌨ Cmd-Alt-T 새 에이전트 탭 · Cmd-W 닫기
│  ├─ 에이전트 상태 표시 탭 — working / waiting for input / completed / 미확인 완료
│  ├─ 스크롤백 검색  ⌨ Cmd-F (하이라이트 · 대소문자 · 정규식)
│  ├─ Copy Context — 우클릭으로 페인 트랜스크립트 범위 지정 복사
│  ├─ TUI 클립보드 OSC 52 (Zellij/tmux/Neovim/fzf · SSH 원격 포함 · 기본 켜짐)
│  ├─ 네이티브 키 바인딩 — kitty keyboard protocol (Shift+Enter · Ctrl+Enter 실제 전달)
│  ├─ 테마 — 인기 테마 라이브러리 · Ghostty 설정 임포트 · Warp 테마(YAML) 임포트
│  ├─ Windows 셸 옵션 — PowerShell/CMD/WSL 기본 셸 · + 드롭다운 일회성 선택
│  │                    \\wsl.localhost\... 경로는 `wsl.exe -d <distro>` 처리
│  ├─ JIS 키보드 — ¥ → 백슬래시 매핑
│  ├─ 플로팅 터미널 — 전역 셸 서피스  ⌨ Cmd+Option+A / Ctrl+Alt+A
│  ├─ Quick Commands — 자주 쓰는 명령/프롬프트 저장(전역·프로젝트), 모바일 양방향 동기화
│  └─ 스크롤백·세션 유지 — 백그라운드 데몬이 PTY 소유, 앱 종료 중 출력까지 보존
├─ 🤖 에이전트
│  ├─ 지원 에이전트
│  │  ├─ 딥 통합 — Claude Code(사용량·핫스왑·훅) · Claude Agent Teams · Codex · Cursor CLI
│  │  ├─ 자동 설정 30+ — Grok · Copilot CLI · OpenCode · Pi · OMP · Gemini · Antigravity
│  │  │                  Aider · Goose · Amp · Kilocode · Kiro · Crush · Auggie · Cline
│  │  │                  Codebuff · Continue · Devin · Droid · Kimi · Mistral Vibe · MiniMax
│  │  │                  Qwen Code · Rovo Dev · Hermes · OpenClaw · Trae
│  │  ├─ GLM-5.2 연동 (기존 하네스 경유 · settings.json 모델 오버라이드)
│  │  └─ 커스텀 CLI 에이전트 등록 (바이너리·인자·시작 훅 · OSC 타이틀로 상태 점)
│  ├─ 실행 · 권한
│  │  ├─ 자동 승인(Yolo) 기본 — Claude/Codex/Gemini 각 우회 플래그 자동 적용
│  │  ├─ Yolo / Manual 모드 전환 (Settings → Agents → Agent Permissions)
│  │  ├─ 에이전트별 실행 인자·환경변수 오버라이드 + 리셋
│  │  └─ Restart 칩 — cwd(Codex는 계정까지) 유지 원클릭 재시작
│  ├─ 세션 · 상태 관리
│  │  ├─ 세션 모델 — 워크트리 1 × 터미널 1 × CLI 에이전트 1
│  │  ├─ 상태 인디케이터 — 스피너/앰버?/에메랄드✓/빨강/회색
│  │  ├─ Agent Dashboard(실험) — 칸반 Needs You/Working/Done/Idle · 팝아웃 · 검색·필터
│  │  ├─ 상태 감지 — OSC 타이틀 시퀀스 + 에이전트 훅
│  │  ├─ 서브에이전트 트리 표시 (부모 아래 확장 가능한 자식 행)
│  │  └─ 세션 이어가기 — 트랜스크립트 기반 핸드오프 프롬프트로 새 세션
│  ├─ 계정 관리
│  │  ├─ Codex 계정 핫스왑 (라벨 · 시스템 기본 ~/.codex + 격리 홈 관리 계정)
│  │  ├─ Claude 다중 계정 (~/.claude · 라이브 세션 중 전환)
│  │  └─ Windows(WSL) Codex — 배포판 내 격리 홈 · 호스트 경로 매핑
│  ├─ 사용량 · 요금 추적
│  │  ├─ 상태바 사용량 — 5시간/일간/주간/Fable 주간 리셋 · 80% 경고 칩
│  │  ├─ 로컬 상태 파일 기반 (~/.claude · ~/.codex · API 호출 불필요)
│  │  ├─ 사용량 팝오버 — 프로바이더별 플랜·리셋·윈도 바 · 상세/컴팩트
│  │  └─ 추정 비용(Stats) — 로컬 가격표 기반
│  ├─ 세션 히스토리
│  │  ├─ 12개 CLI의 온디스크 트랜스크립트 자동 발견
│  │  ├─ 검색(제목·디렉터리·브랜치·모델·미리보기) · 스코프 · 정렬·그룹핑
│  │  └─ 액션 — Resume(--resume) · 재개 명령 복사 · 세션ID/로그 경로 복사 · cwd 열기
│  ├─ 하이버네이션(실험) — done + 비활성 + 유휴(기본 30분) 시 정지, 재오픈 시 자동 재개
│  ├─ 훅 & 메모리
│  │  ├─ 저장소별 훅 — 기존 .claude/ · .codex/ 설정 그대로 적용
│  │  ├─ 워크트리 셋업 훅 (의존성 설치 등)
│  │  ├─ 메모리 파일 CLAUDE.md · AGENTS.md 인라인 편집
│  │  └─ 훅 엔드포인트 영속화 (앱 재시작 후 세션-서버 연결 유지)
│  ├─ Chat UI(실험) — 터미널 위 구조화 트랜스크립트+컴포저 · 첨부 · 슬래시 · 스킬 탐색
│  ├─ 멀티 에이전트 오케스트레이션 (`orca orchestration`)
│  │  ├─ 모델 — Run → Task(6상태) → Dispatch → Message(6종)
│  │  ├─ 워커 운영 — worker-start(현재/자식/신규 워크트리·원격) · worker-read · worker-stop · 재시도
│  │  ├─ 메시징 — @all @idle @claude @codex @worktree:<id> 브로드캐스트 · ask 블로킹 질문
│  │  ├─ 결정 게이트 — gate-create / gate-resolve (사람 승인 전 차단)
│  │  └─ 워커 계약 — worker_done 1회 + 장기 작업 heartbeat
│  ├─ 예약 자동화 (`orca automations`)
│  │  ├─ 크론/RRULE/프리셋(hourly·daily·weekdays·weekly) 트리거
│  │  ├─ 옵션 — 프로바이더·저장소·워크스페이스·호스트 · --precheck · --reuse-session · 유예
│  │  └─ 관리 — list/show/edit/remove/수동 run/실행 이력
│  ├─ 컴퓨터 사용 (`orca computer`)
│  │  ├─ 접근성 트리 + 스크린샷 기반 로컬 앱 제어
│  │  ├─ 앱 열거 · 윈도우 목록 · get-app-state
│  │  ├─ click / set-value / type-text / press-key / hotkey / paste-text / scroll / drag
│  │  └─ 민감 입력은 --value-stdin · --text-stdin
│  └─ Agents 피드(Activity) — 전 워크트리 이벤트 스레드 · 실행 중 상단 고정 · 클릭 시 점프
└─ 📦 기타
   ├─ 워크트리 모델 (IDE 코어)
   │  ├─ 저장소 base ref + 워크트리별 start-from ref
   │  ├─ 라이프사이클 — 생성(이슈 연결) → 작업 → 리뷰 → 배포 → 아카이브/삭제
   │  ├─ 백그라운드 생성 (즉시 닫힘 · 진행 표시 · 실패 시 Retry)
   │  ├─ 공유 디렉터리 — Shared Paths(APFS clone/심링크) · orca.yaml · .worktreeinclude
   │  ├─ 이름 규칙 — 자동 해양생물 이름 · 이모지 숏코드 · 이슈 기반 브랜치명
   │  ├─ 사이드바 — 그룹핑 · 필터 · 핀 · 멀티 선택 · 드래그 정렬 · 리네임 · 미확인 굵게
   │  ├─ 멀티 레포 프로젝트 그룹 (폴더 워크스페이스)
   │  ├─ 순수 git 호환 (외부 워크트리 감지 인박스 · remove 시 자동 정리)
   │  ├─ 탭·페인·스플릿 — 가장자리 드래그 중첩 분할 · 워크트리별 경계 저장 · 전환 시 전체 스왑
   │  ├─ 세션 복원 (워크트리·탭·페인·포커스)
   │  ├─ Quick Open  ⌨ Cmd-P  (워크트리 스코프 · 최근성+매치 랭킹 · gitignored 2차)
   │  └─ Jump Palette  ⌨ Cmd-J  (워크트리·탭 통합 · #123/!123 매칭 · Shift-Enter 새 스플릿)
   ├─ 코드 리뷰 & 배포
   │  ├─ Diff 뷰어 — 헝크/라인 스테이징 · 이미지 diff(3모드) · 3-way 머지 · 비교 기준 변경
   │  │              ⌨ j/k 파일 · n/p 헝크 · s 스테이지 · c 코멘트
   │  ├─ AI Diff 주석 — 인라인 코멘트 · 라인 추적 · Send to agent · Resolve · 미해결 재포함
   │  ├─ 어트리뷰션 — AI/사람 작성 거터 마커 · 덮어쓰면 사람으로 전환 · 로컬 전용 · 내보내기
   │  ├─ 커밋/푸시 — AI 커밋 메시지 · pre-commit 실패 시 Fix with AI · 업스트림 자동
   │  │              force push with lease · PR 생성(AI 제목·본문) · Amend · Resolve with AI
   │  ├─ Action Recipes — AI 프롬프트 커스터마이즈 ({branch} {stagedPatch} {linkedIssue})
   │  ├─ GitHub 통합 — 호스팅 리뷰(GitHub/GitLab/Bitbucket/Azure/Gitea) · PR 탭 인라인
   │  │                Fix broken checks · 자동 머지(머지 큐) · 이슈 브라우징 · Actions 로그
   │  │                GitHub Projects 보드
   │  ├─ Linear 연동 — 이슈 드로어 편집 · 워크트리 생성 · 미디어 컨텍스트 · 상태 동기화 · CLI
   │  └─ Jira 연동 — Cloud/셀프호스티드 · 태스크 드로어 · 인라인 편집 · 멀티 사이트 · 키체인
   ├─ 편집기 & 뷰어
   │  ├─ Monaco + 자동 저장 · 멀티 커서 · 검색 · 정의 이동 · 워드랩 · 미니맵 · 전용 폰트
   │  ├─ Changes 뷰 모드 (탭 안에서 HEAD 대비 diff 토글)
   │  ├─ 리치 마크다운 에디터 — / 슬래시 메뉴 · [[ 위키링크 · 리뷰 주석 · front matter
   │  │                        표 내비게이션 · 목차 · 리치↔Monaco 전환
   │  └─ 뷰어 — Mermaid · PDF · 이미지(diff 모드) · CSV/TSV · Jupyter(베타)
   ├─ 파일 탐색기 — 실시간 동기화 · git 색상 · 우클릭 · 외부 드래그드롭 · 원격 업로드/다운로드
   ├─ 브라우저 & 디자인 모드
   │  ├─ 워크트리별 브라우저 — 탭·스크롤 복원 · 퍼지 주소창 · find-in-page · 뷰포트 에뮬레이션
   │  ├─ Design Mode — 클릭 → HTML·CSS·스크린샷·소스 위치를 에이전트에 첨부 → 핫리로드 루프
   │  ├─ 브라우저 프로필 — 쿠키/스토리지 격리 · 로그인 세션 · UA · 뷰포트
   │  └─ 에이전트 브라우저 자동화 — goto/snapshot/click/fill/screenshot/wait/console/network/pdf
   ├─ 원격 & SSH
   │  ├─ 실행 방식 4종 — 로컬 / SSH 타깃 / Remote Orca Server / Cloud VM
   │  ├─ SSH 워크트리 — OpenSSH 설정 임포트 · 멀티플렉싱 · 점프 호스트 · Kerberos
   │  │                 연결 상태 칩 · 릴레이 PTY 생존 · 포트 포워딩(Cmd+Shift+I) · VS Code 열기
   │  ├─ Remote Orca Server — 서버 소유 · 멀티 클라이언트 · Tailscale 페어링 · 개별 취소 토큰
   │  └─ Cloud VM(실험) — orca.yaml 레시피(Vercel Sandbox·Fly·Modal·SSH·Docker) · 일시정지/파기
   ├─ 모바일 컴패니언 (iOS/Android)
   │  ├─ 워크트리·에이전트 상태 모니터링 · 파일 트리 · 터미널/Chat 접근 · Live 모드
   │  ├─ 음성 딕테이션 · 사진·파일 첨부 · Quick Commands 동기화
   │  ├─ 계정 전환·사용량 · 워크스페이스 생성 · Source Control · 브라우저 뷰포트 전환
   │  └─ 완료 푸시 알림 · 페어링(일회용 코드/딥링크·디바이스 토큰)
   ├─ 알림 & 인박스 — 시스템 알림·사운드·워크트리 칩 · 헤더 벨 + Dock 배지 · 커스텀 알림음
   ├─ Orca CLI (`orca`)
   │  ├─ 명령 그룹 — repo · worktree · terminal · file · browser · tab profile · emulator
   │  │              linear · automations · orchestration · computer · skills · account
   │  │              environment · agent hooks
   │  ├─ 셀렉터 — id: · active · path: · branch: · issue:
   │  ├─ 워크트리 체크포인트 — --comment · --workspace-status(todo/in-progress/in-review/completed)
   │  ├─ 스킬 레지스트리 — orca-cli · orchestration · computer-use · orca-linear · orca-emulator 등
   │  └─ MCP 서버 등록 (Settings → Integrations)
   └─ 설치 · 설정 · 개인정보
      ├─ 설치 — macOS(서명·공증·Homebrew) · Windows 인스톨러 · Linux(AppImage/.deb)
      │         첫 실행 시 ~/.claude · ~/.codex · Ghostty 설정 임포트 제안
      ├─ 자동 업데이트 — stable 기본 · 수정자 클릭으로 RC/perf
      ├─ 설정 — UI 줌·테마·액센트·밀도·아이콘·언어(6종) · 리소스 매니저 · 커밋 서명
      │         GitHub 쿼터 · 브랜치 자동 리네임 · 단축키 리매핑 · 저장소별 설정
      ├─ 음성 딕테이션 — 오프라인(Parakeet/Zipformer/SenseVoice/Whisper Tiny) 또는 클라우드
      ├─ 플러그인 시스템(실험) — git 마켓플레이스 탐색·설치·업데이트·롤백
      └─ 텔레메트리 — PostHog US · 토글 / DO_NOT_TRACK=1 / ORCA_TELEMETRY_DISABLED=1
```

---

## 3. bbarit-agent-oss — 단독 CLI 코딩 에이전트

```
bbarit-agent-oss
├─ 🖥️ 터미널 (에이전트 자체 TUI)
│  ├─ 풀스크린 인터랙티브 TUI (기본 실행 모드 · 현재 디렉터리에서 구동)
│  ├─ 트랜스크립트 렌더링 — 워드랩 + 구문 강조 · 툴 호출 상세
│  ├─ 라이브 토큰 스트리밍 (실시간 토큰 카운트)
│  ├─ 피커 UI — 모델 / 로그인 / 페르소나 (id·이름·설명 퍼지 검색)
│  ├─ 테마 지원 (`/themes`)
│  ├─ 셸 스타일 히스토리 (↑/↓ 입력 이력)
│  ├─ 키 조작 — Tab 메뉴 · Esc 실행 중단
│  ├─ 타이틀바 페르소나 배지
│  ├─ 슬래시 커맨드 체계 — /login /model /session /memory /wiki /help …
│  └─ HTML 내보내기·가져오기·공유 — /export /import /share (자체 완결 HTML)
├─ 🤖 에이전트
│  ├─ 코어 루프
│  │  ├─ 자율 툴-유즈 루프 (assistant → tool call → result 반복)
│  │  ├─ 자동 컨텍스트 컴팩션
│  │  ├─ 병렬 서브에이전트 오케스트레이션 — `--orchestrate "t1" "t2"` (독립 프로세스 후 집계)
│  │  └─ 백그라운드 코드 인덱싱 — 내장 semble (BM25 + 시맨틱 하이브리드)
│  ├─ 모델 · 프로바이더
│  │  ├─ 15+ 프로바이더 · 1,000+ 모델
│  │  │  └─ Anthropic · OpenAI/Codex · Gemini/Vertex · OpenRouter · Groq · Mistral
│  │  │     Together · Fireworks · DeepSeek · Cerebras · Bedrock · GitHub Copilot
│  │  ├─ Ollama 로컬 모델 (오프라인 · OLLAMA_HOST 자동 탐색)
│  │  └─ 세션 중 모델 전환(`/model`) · 추론 강도(`--thinking low|medium|high`)
│  ├─ 툴셋
│  │  ├─ 파일 — read · write · edit(해시 검증)
│  │  ├─ 셸 — bash
│  │  ├─ 탐색 — grep · find · ls · tree(gitignore 인식) · code_search
│  │  ├─ 웹 — web_search · web_fetch
│  │  ├─ 데스크톱 제어 — computer 툴(스크린샷 + 마우스/키보드, `/computer on|off`)
│  │  ├─ 제한 — --tools 허용목록 · --exclude-tools · --no-tools
│  │  └─ LSP 연동 진단
│  ├─ 페르소나
│  │  ├─ 30개 도메인 · 295개 내장 (엔지니어링·디자인·보안·마케팅·법률·게임개발 등)
│  │  ├─ 적용 — /persona · --persona · BBARIT_PERSONA · defaultPersona
│  │  ├─ 읽기전용 페르소나 (`%%mode=readonly` — 감사자/리뷰어는 파일 변경 거부)
│  │  └─ 성격 브리프 — 전문성·작업 스타일·우선순위·금기
│  ├─ 크로스 세션 메모리
│  │  ├─ 턴 시작 키워드 매칭 회상(LLM 지연 없음) + 턴 종료 백그라운드 추출
│  │  ├─ 타입 — user / feedback / project / reference
│  │  ├─ 마크다운 파일 + MEMORY.md 인덱스 · /memory show|forget|reset · BBARIT_AUTO_MEMORY=0
│  │  └─ 세션별 커서로 중복 방지 · 서브에이전트에서는 추출 안 함
│  ├─ 프로젝트 위키
│  │  ├─ 프로젝트별 격리 마크다운 노트 (지식 유출 없음)
│  │  ├─ 위키링크·태그 · /wiki 검색·조회·삭제
│  │  └─ 변경은 파일 편집처럼 게이트 (플랜 모드·읽기전용 페르소나에서 차단)
│  ├─ 세션 관리 — JSONL 트리 · 최근 30개 자동 정리 · /fork /clone /resume /new
│  ├─ 확장성
│  │  ├─ MCP 서버 등록 (`/mcp add` · 프로젝트별 .mcp.json)
│  │  ├─ 스킬 시스템 (SKILL.md 드롭인 · `/skill new` 스캐폴딩)
│  │  ├─ Claude Code / Codex 상호운용 (~/.claude.json · ~/.codex/config.toml 읽기 전용)
│  │  └─ 로컬 JS/TS 확장 — 커맨드·툴·훅·단축키·커스텀 프로바이더
│  └─ 실행 모드
│     ├─ 인터랙티브 TUI (기본)
│     ├─ 원샷 `--print` (stdout=답변 · stderr=진행 로그)
│     ├─ `--mode json` NDJSON 이벤트 스트림 (session·agent_start·message_update·turn_end·agent_end)
│     └─ `--approve` 프로젝트 신뢰 기반 변경 게이트
└─ 📦 기타
   ├─ 설정 · 저장소
   │  ├─ ~/.bbarit-oss/agent/ 자체 격리 (자격증명·세션·메모리·위키·.env)
   │  ├─ 구 ~/.pi/agent 1회 마이그레이션
   │  ├─ API 키 우선순위 — --api-key → /login 저장 → 프로바이더 설정 → 환경변수
   │  ├─ 인증 — 프로바이더별 OAuth/디바이스 로그인/API 키 · 첫 실행 자동 로그인 피커
   │  └─ 환경변수 스위치 — BBARIT_AGENT_MODE · AUTO_CONTEXT · INTEROP · SUBAGENT
   │                       AUTO_UPGRADE · NO_UPDATE_CHECK · UPDATE_BASE · INSTALL_DIR
   ├─ 설치 · 업데이트
   │  ├─ macOS/Linux curl 원라이너 · Windows PowerShell 원라이너 · cargo 소스 빌드
   │  ├─ 플랫폼 — macOS arm64/x64 · Linux x64/arm64 · Windows x64
   │  └─ 자체 업데이트 — --upgrade / /update 원자적 교체 · 다운그레이드 거부 · 비차단 확인
   └─ 아키텍처 · 라이선스
      ├─ Rust 단일 정적 바이너리 (런타임 의존성 없음) · 멀티프로세스 오케스트레이터
      ├─ "작고 읽기 쉬운 에이전트 루프" 철학 (Pi 계승)
      └─ MIT · 페르소나는 AgentLand 각색 · semble 번들 · PROVENANCE.md/NOTICE
```

---

## 4. Terax — 터미널 우선 AI 개발 워크스페이스

```
Terax
├─ 🖥️ 터미널
│  ├─ 렌더링 · PTY
│  │  ├─ xterm.js + WebGL 애드온
│  │  ├─ 2-프로세스 모델 — Rust(src-tauri, portable-pty) ↔ Tauri Channel<PtyEvent> ↔ React
│  │  ├─ 트루컬러 · 링크 감지 · 부드러운 스크롤 · 테마 엔진 공유 팔레트
│  │  ├─ WebGL 끄면 canvas 폴백
│  │  ├─ 탭당 xterm.Terminal 1개 영속 (전환 시 숨김만 · 진짜 PTY)
│  │  └─ 설정 — 폰트 패밀리 · 크기 8–32 · 자간 · 스크롤백 200–50,000 · WebGL 토글
│  ├─ Windows 프로세스 관리
│  │  ├─ 세션별 Job Object + JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (크래시에도 자식 정리)
│  │  ├─ spawn mutex 직렬화 (ConPTY 출력 파이프 정지 방지)
│  │  └─ 탭 닫으면 자손 트리 전체 kill (정상 종료·패닉·SIGKILL 모두)
│  ├─ 탭 · 스플릿
│  │  ├─ ⌨ Cmd+T 새 탭 · Cmd+R 프라이빗 터미널(cwd·환경 격리) · Cmd+W 닫기
│  │  ├─ ⌨ Cmd+1~9 인덱스 점프 · Ctrl+Tab / Ctrl+Shift+Tab 순환
│  │  ├─ 새 탭 cwd 상속 (OSC 7)
│  │  └─ ⌨ Cmd+D 우측 · Cmd+Shift+D 하단 · Cmd+[ / Cmd+] 포커스 (탭 내 독립 PTY)
│  ├─ 셸 지원
│  │  ├─ Unix $SHELL · Windows pwsh.exe → powershell.exe → cmd.exe
│  │  ├─ 기본 지원 — zsh · bash · pwsh · PowerShell 5.1 · cmd · fish
│  │  └─ PowerShell 7+ 선호 (profile.ps1이 prompt 래핑해 통합 마커 방출)
│  ├─ 셸 통합 (OSC)
│  │  ├─ 주입 — zsh: ZDOTDIR 4파일 · bash: --rcfile · pwsh: -File profile.ps1 · cmd: 없음
│  │  ├─ OSC 7 cwd · OSC 133;A/B/C/D 프롬프트·출력·종료코드 · OSC 777 Terax 확장
│  │  ├─ 모든 PTY에 항상 켜짐 (세션별 토글 없음)
│  │  └─ Starship · oh-my-zsh 호환 (가산적 훅)
│  ├─ 검색 — ⌨ Cmd+F 인라인 오버레이 (하이라이트 · 다음/이전 · 대소문자, 에디터 공용)
│  └─ 워크스페이스 환경 (실행 컨텍스트)
│     ├─ Local (macOS/Linux/Windows) 또는 Windows의 WSL 배포판
│     ├─ WSL 1급 지원 — wsl.exe로 배포판 열거·기본값·홈 경로 해석
│     ├─ 한 창에서 Local PowerShell + WSL-Ubuntu bash 동시 실행
│     ├─ cwd 흐름 — cd → OSC 7 방송 → 탭 cwd → 상태바·탐색기 → 새 탭 상속
│     └─ Windows 경로 슬래시 정규화
├─ 🤖 에이전트
│  ├─ 프로바이더 · 모델 (BYOK · Vercel AI SDK v6)
│  │  ├─ 클라우드 — OpenAI · Anthropic · Google · Groq · xAI · Cerebras · OpenRouter
│  │  │             DeepSeek · Mistral · OpenAI 호환(커스텀 base URL)
│  │  ├─ 로컬 — LM Studio :1234/v1 · MLX :8080/v1 · Ollama :11434 (저장 시 도달성 검증)
│  │  ├─ 키 저장 — OS 키체인 전용(keyring, service `terax-ai`) · 설정파일/localStorage/env 미저장
│  │  └─ 모델 지정 — DEFAULT_MODEL_ID · DEFAULT_AUTOCOMPLETE_MODEL · 핀 즐겨찾기·최근
│  ├─ Composer (⌨ Cmd+I)
│  │  ├─ 첨부 — 이미지(붙여넣기·드래그) · 텍스트 파일 <file path> · 선택 <selection source>
│  │  ├─ @경로 — 워크스페이스 파일 퍼지 매칭 칩 (시크릿 deny-list 게이트)
│  │  ├─ #핸들 — 스니펫 (terax-ai-snippets.json)
│  │  ├─ / — 슬래시 커맨드 팔레트 (개별 목록 미공개)
│  │  ├─ 음성 입력 — 마이크 → 트랜스크립션 파이프라인 (모델 미공개)
│  │  └─ ⌨ Cmd+L 선택 영역 칩 첨부
│  ├─ 에이전트 루프 · 툴
│  │  ├─ Experimental_Agent · stopWhen: stepCountIs(MAX_AGENT_STEPS) · config.ts 시스템 프롬프트
│  │  ├─ 라이브 컨텍스트 브리지 — cwd(OSC 7) + 활성 PTY 버퍼 최근 ~300줄 (실행 시점 스냅샷)
│  │  ├─ 자동 실행 툴 — read_file · list_directory · fs_search · fs_grep
│  │  ├─ 승인 필요 툴 — write_file · create_directory · rename · delete · run_command
│  │  │                 shell_session_run · shell_bg_spawn
│  │  └─ 승인 카드 인라인 · 수락/거부 후 자동 재개
│  ├─ AI 편집 diff — 직접 쓰지 않고 ai-diff 탭 · 헝크 단위 부분 수락 · 모든 에이전트에 적용
│  ├─ 플랜 모드 — 쓰기 전 파일 경로·범위 포함 순서 계획 (툴별 승인은 유지)
│  ├─ 서브에이전트 — run_subagent · agents/registry.ts 정의 · runSubagent.ts 실행 · 툴 부분집합
│  ├─ 커스텀 에이전트 — 시스템 프롬프트 + 툴 부분집합 + 아이콘/색 · terax-ai-agents.json
│  │                    세션별 선택 기억
│  ├─ 세션 · 메모리
│  │  ├─ terax-ai-sessions.json — list · activeId · messages:<id>
│  │  ├─ chatStore.ts Map<sessionId, Chat> · getOrCreateChat · hydrateSessions · AgentRunBridge
│  │  ├─ 제목 자동 생성 · 리네임 · 삭제
│  │  ├─ API 키 전환 시 인메모리만 비움 (디스크 세션은 활성 키에 재바인딩)
│  │  ├─ TERAX.md 프로젝트 메모리 (세션당 1회 로드 · AGENTS.md 리다이렉트 가능)
│  │  ├─ Custom instructions (전 세션 공통 시스템 프롬프트 추가분)
│  │  └─ terax-ai-todos.json (에이전트 접근 TODO)
│  ├─ 터미널 에이전트 감지
│  │  ├─ Claude Code 지원 · Codex 예정
│  │  ├─ Rust PTY 바이트 필터 — OSC 133;C에서 무장 → OSC 777 감시
│  │  ├─ 상태 — started · working · attention · finished · exited
│  │  ├─ 셸 무관(bash·zsh·pwsh·tmux) · 훅 불필요 · TUI 리페인트 오탐 없음 · 미실행 시 비용 0
│  │  ├─ Claude Code 훅 3종 — UserPromptSubmit→working · Notification→attention · Stop→finished
│  │  │                        terminalSequence로 OSC 777 반환 · TERAX_TERMINAL 게이트
│  │  └─ agent_claude_hooks_status 확인 · 제거 시 Terax 소유 훅만 선택 제거
│  ├─ 알림
│  │  ├─ 라우터(lib/route.ts) — 탭 보임=억제 / 탭 숨김=인앱 토스트 / 창 비포커스=OS 알림
│  │  ├─ LocalAgentNotificationsBridge — awaiting-approval·error=주의 / busy·idle·finished
│  │  ├─ 터미널 에이전트는 terax:agent-signal로 동일 흐름 합류
│  │  └─ 헤더 알림 벨 · Settings → Agents 마스터 토글
│  └─ 보안 모델
│     ├─ 툴 티어링 (읽기 자동 / 쓰기·실행 승인)
│     ├─ 시크릿 deny-list(lib/security.ts) — .env · .env.* · .ssh/ · credentials · .netrc
│     │                                       .aws/credentials · 키체인 디렉터리
│     │  └─ 경로 정규화 후 Rust에서 모든 fs 툴 호출마다 강제 (우회 불가)
│     ├─ 워크스페이스 인가 레지스트리(workspace_authorize) — 열지 않은 형제 디렉터리 접근 불가
│     ├─ SSRF 방어 — loopback·link-local·사설 대역 차단 (설정한 로컬 프로바이더만 예외)
│     └─ 키는 OS 키체인에만
└─ 📦 기타
   ├─ 워크스페이스 레이아웃 (앱 셸)
   │  ├─ 워크스페이스당 창 1개 · 단일 React 앱
   │  ├─ 탭 6종 — Terminal · Editor · Preview · Markdown · AI-diff · Git(diff/history/commit-file)
   │  ├─ 탭 전환 시 CSS 숨김 (PTY·개발 서버 백그라운드 스트리밍 지속) · 새 탭 cwd 상속
   │  ├─ 사이드바 3패널 — 파일 탐색기 · 소스 컨트롤 · Git History  ⌨ Cmd+B / Cmd+Shift+E
   │  ├─ 상태바 — cwd 브레드크럼(OSC 7) · AI 툴 인디케이터 · localhost 감지 pill
   │  ├─ 헤더 — 탭바 · 워크스페이스 스위처(Local + WSL) · 알림 벨
   │  └─ 설정 창 ⌨ Cmd+, — General / Models / Themes / Shortcuts / Agents / About
   ├─ 에디터
   │  ├─ CodeMirror 6 · 탭당 영속 인스턴스 (커서·undo·선택 유지)
   │  ├─ 언어 — TS/JS · Rust · Python · Go · C/C++ · Java · HTML/CSS · JSON · Markdown 등
   │  ├─ Vim 모드 — 모션 · 레지스터 · 마크 · 비주얼 · colon 커맨드
   │  ├─ 인라인 AI 자동완성 — Tab 수락 · 채팅과 별개 프로바이더 · autocompleteEnabled
   │  ├─ 에디터 테마 10종 — Atom One · Aura · Copilot · GitHub D/L · Gruvbox Dark
   │  │                     Nord · Tokyo Night · Xcode D/L
   │  └─ ⌨ Cmd+F 찾기 · Cmd+Z / Cmd+Y · Cmd+E 새 에디터 탭
   ├─ 파일 탐색기
   │  ├─ Rust fs_read_dir · list_subdirs + ignore 크레이트 인덱싱(.gitignore/.ignore 존중)
   │  ├─ 키보드 내비게이션 · 인라인 리네임
   │  ├─ 우클릭 — 파일/디렉터리 생성 · 리네임 · 삭제 · OS에서 보기
   │  ├─ 아이콘 테마 Catppuccin·Material · 숨김 파일 토글 · 슬래시 경로 정규화
   │  ├─ ⌨ Cmd+Shift+F 퍼지 파일 검색 (fs_search)
   │  ├─ 전문 검색 — fs_grep(ripgrep) · glob 필터 · 파일별 스트리밍 · 라인 번호·하이라이트
   │  └─ Attach to AI — 파일 첨부 · 선택은 <selection> 블록  ⌨ Cmd+L
   ├─ 소스 컨트롤
   │  ├─ 전용 Rust 모듈 · 모든 git 작업이 workspace_authorize 통과
   │  ├─ ⌨ Cmd+G 패널 · Unstaged / Staged / Untracked 분류
   │  ├─ 헝크 단위 스테이지·언스테이지 · discard 확인 · git-diff 탭(테마 색상)
   │  ├─ ⌨ Cmd+Enter 커밋 · 브랜치·detached HEAD 표시
   │  ├─ 원격 — git_push(업스트림 자동 생성) · ahead/behind · git_pull_ff_only · git_fetch
   │  └─ Git History — 레인 커밋 그래프 · 브랜치·태그 라벨 · 커밋별 diff · 원격 링크 · 검색·필터
   ├─ 웹 프리뷰
   │  ├─ 자동 감지 — PTY 출력에서 localhost:3000 · 127.0.0.1 · Vite/Next → 상태바 pill
   │  ├─ 터미널 버퍼가 아닌 PTY 출력 직접 감시 (1회 출력·반복 리페인트 모두 대응)
   │  ├─ ⌨ Cmd+P 새 프리뷰 탭 · 임의 URL 입력
   │  ├─ 네이티브 Tauri 자식 웹뷰 (iframe 아님 → 교차 출처·쿠키 정상)
   │  ├─ HMR 웹소켓 네이티브 (Vite·Next·Astro 무설정)
   │  └─ 백그라운드 마운트 유지 (페이지 상태 보존)
   ├─ 테마
   │  ├─ 앱 팔레트 10종 — terax-default · nord · tide · catppuccin · tokyo-night
   │  │                   caffeine · claude · gruvbox · sage · rose-pine
   │  ├─ Light / Dark / 시스템 (팔레트와 독립)
   │  ├─ 커스텀 테마 — 토큰 편집 · terax-custom-themes.json · JSON 내보내기·공유
   │  ├─ 배경 이미지 — opacity(블렌드) · blur(이미지에만) · bgImageStore.ts 캐시
   │  └─ ThemeProvider가 CSS 변수 주입 + xterm 팔레트 동일 소스
   ├─ 단축키 (전부 Settings → Shortcuts에서 리매핑 · 충돌 감지 · 에디터는 읽기 전용)
   │  ├─ 일반 — Mod+, 설정 · Mod+K 단축키 목록
   │  ├─ 탭 — Mod+T · Mod+R · Mod+P · Mod+E · Mod+W · Ctrl+Tab · Ctrl+Shift+Tab · Mod+1~9
   │  ├─ 페인 — Mod+D · Mod+Shift+D · Mod+] · Mod+[ · Mod+G
   │  ├─ 뷰 — Mod+B · Mod+Shift+E · Mod+= · Mod+- · Mod+0
   │  ├─ 검색 — Mod+F · Mod+Shift+F
   │  ├─ AI — Mod+I · Mod+L
   │  └─ 에디터 — Mod+Z · Mod+Y
   ├─ 설정 6탭
   │  ├─ General — 터미널(폰트·크기·자간·스크롤백·WebGL) · Vim 모드
   │  │            자동 시작 · 창 상태 복원 · 줌 · 숨김 파일 · Custom instructions
   │  ├─ Models — API 키 · 로컬 base URL · 기본 모델 · 자동완성 프로바이더/모델
   │  ├─ Themes — 앱 팔레트 · 에디터 테마 · 배경 이미지(opacity·blur)
   │  ├─ Shortcuts — 그룹별 리매핑 + 충돌 감지
   │  ├─ Agents — 알림 마스터 토글 · 커스텀 에이전트 · Claude Code 훅 설치
   │  └─ About — 버전 · 업데이트 채널 · 라이선스 · 저장소·체인지로그
   ├─ 데이터 위치 (번들 ID app.crynta.terax)
   │  ├─ macOS ~/Library/Application Support/app.crynta.terax/
   │  ├─ Linux ~/.local/share/app.crynta.terax/
   │  ├─ Windows %APPDATA%\app.crynta.terax\
   │  ├─ 파일 — terax-settings.json · terax-ai-sessions.json · terax-ai-agents.json
   │  │         terax-ai-snippets.json · terax-ai-todos.json · terax-custom-themes.json · themes/
   │  ├─ tauri-plugin-store 원자적 쓰기 · 시작 시 스키마 마이그레이션
   │  ├─ API 키는 OS 키체인(terax-ai)에 별도
   │  └─ 백업/리셋 — 종료 후 디렉터리 복사 · 키체인 terax-ai 항목 삭제
   └─ 설치 · 플랫폼
      ├─ macOS — .dmg (aarch64 / x86_64) → /Applications
      ├─ Linux — AUR `yay -S terax-bin` · .deb(libwebkit2gtk-4.1-0, libgtk-3-0)
      │          .rpm(webkit2gtk4.1, gtk3) · AppImage(FUSE · --appimage-extract-and-run)
      │          Wayland 문제 시 WEBKIT_DISABLE_DMABUF_RENDERER=1
      ├─ Windows — NSIS currentUser(관리자 불필요) · WebView2 오프라인 포함 · "Run anyway"
      ├─ 소스 빌드 — Rust stable · Node 20+ · pnpm → pnpm tauri dev / build
      └─ 첫 실행 — Settings → Models에서 프로바이더 연결 (로컬은 키 불필요)
```

---

## 5. AgentCommender — 팀·임무 기반 에이전트 관제 멀티플렉서

```
AgentCommender (Electron BrowserWindow · 단일 인스턴스 잠금)
├─▸ 탭바
│  ├─ ◉ 관제 — 대시보드 토글                                     ⌨ Ctrl+Shift+H
│  ├─ 팀 탭 ×N — 팀 전환 · × 또는 휠클릭으로 닫기
│  │  └─ 우클릭 — 팀원 세팅(직책·관계) / 팀 폴더 열기 / 팀 닫기
│  ├─ + 새 팀 만들기 모달                                        ⌨ Ctrl+Shift+T
│  └─ 우측 — 임무 · git · 포트 · ⧉ 사이드 패널 토글               ⌨ Ctrl+Shift+B
├─▸ 터미널 뷰 (팀 = 탭 · 세션 = 페인)
│  ├─ 레이아웃
│  │  ├─ 분할 트리 pane / split{dir,ratio}                       ⌨ Ctrl+Shift+D 좌우
│  │  │                                                          ⌨ Ctrl+Shift+E 상하
│  │  │                                                          ⌨ Ctrl+Shift+W 페인 닫기
│  │  ├─ 그리드 자동 배치 — 세로 4개 채우고 새 열 · 최대 4×2
│  │  ├─ 팀당 최대 8세션
│  │  ├─ 분할선 드래그 비율 조절 (0.1~0.9)
│  │  ├─ 페인 확대(줌) 토글                                      ⌨ Ctrl+Shift+Z
│  │  └─ 트리 → 절대좌표(%) 평면 렌더링 (분할해도 리마운트 없음 = 세션 유지)
│  ├─ 페인 = 세션 하나
│  │  ├─ xterm.js 6 + WebGL 렌더러 (실패 시 기본 렌더러 폴백)
│  │  ├─ 스크롤백 10,000줄 · Cascadia Mono · 전용 다크 테마
│  │  ├─ 터미널 내 검색 바 (Enter 다음 · Shift+Enter 이전 · Esc 닫기)  ⌨ Ctrl+F
│  │  ├─ 복사/붙여넣기 (Windows Terminal 방식)
│  │  │  ├─ ⌨ Ctrl+C 선택 있으면 복사 · 없으면 ^C 인터럽트
│  │  │  ├─ ⌨ Ctrl+V 스마트 붙여넣기 — 파일 경로 → 이미지(담당 폴더 PNG 저장) → 텍스트
│  │  │  └─ 우클릭 — 선택 복사 / 붙여넣기
│  │  ├─ 드래그&드롭 → 따옴표 감싼 절대경로 입력
│  │  ├─ URL Ctrl+클릭 → 브라우저 패널에서 열기
│  │  ├─ 폰트 크기 8~24 (설정 저장)                              ⌨ Ctrl+= / Ctrl+- / Ctrl+0
│  │  └─ 자동 fit + pty resize (ResizeObserver)
│  ├─ 팀 전환                                                     ⌨ Ctrl+Tab / Ctrl+Shift+Tab
│  └─ pty 수명 — 생성 직후 pause() → 리스너 부착 후 resume() (초기 출력 유실 방지)
├─▸ 관제 대시보드 (터미널 뷰 위를 덮는 오버레이 · 시작 화면)
│  ├─ 헤더 액션
│  │  ├─ 워크스페이스 — 폴더 선택 (ACMUX_WORKSPACE_ROOT 있으면 거부)
│  │  ├─ 기본 셸 select — PowerShell / pwsh / cmd / Git Bash / WSL
│  │  ├─ + 새 팀 · 팀 불러오기(워크스페이스에서 복원)
│  │  ├─ ⧉ 브라우저 패널 토글
│  │  └─ 전체 종료 (확인 후 모든 세션 kill)
│  ├─ 통계 타일 — 팀 · 전체 세션 · 활성 · 진행 · 대기
│  │  └─ 상태 판정 — 마지막 출력 <3초 활성 · <60초 진행 · 그 외 대기
│  ├─ 팀 슬라이더 (한 번에 한 팀 · ◀ 도트 ▶ · 새 팀 생성 시 자동 이동)
│  │  └─ 팀 행
│  │     ├─ 팀 배지 — 클릭 시 그 팀 터미널로 이동
│  │     │  └─ 우클릭 — 폴더로 가기 / 팀원 세팅 / 팀 전체 명령·일괄 명령 / 팀 종료
│  │     ├─ 임무 ▾ 드롭다운
│  │     ├─ 기본 칩 — 팀 기본 임무 이름 또는 "기본 임무 없음" · 클릭 시 폴더 열기
│  │     ├─ 세션 셀 ×8 — 상태점 · 이름 · 상태라벨 · × 종료 · 임무 마커
│  │     │  ├─ 클릭 → 상세 패널 · 더블클릭 → 터미널 점프
│  │     │  └─ 우클릭 — 이름 변경 / 터미널로 이동 / 세션 종료(확인)
│  │     │     └─ 에이전트 실행 — ▶ Claude Code(claude) · ▶ Codex CLI(codex)
│  │     │                        ▶ Gemini CLI(gemini)
│  │     ├─ + 팀원 추가 모달
│  │     └─ n/8 카운트 · 남는 자리는 빈 슬롯
│  ├─ 세션 상세 패널 (셀 클릭 시 우측)
│  │  ├─ 상태 · 마지막 출력 시각 · 누적 수신 바이트
│  │  ├─ 임무 배정 select ((팀 기본) 표시) + MISSION.md 열기 · 작업 폴더
│  │  ├─ 팀 / 실행 중(셸·에이전트) / 세션 ID / PID / 셸 / 담당 폴더 / 타이틀
│  │  ├─ 최근 출력 미리보기 10줄 (ANSI 제거)
│  │  ├─ 페르소나 탭 — 팀 내 관계("카이에게 보고" 등) + 팀원 세팅 진입
│  │  ├─ 터미널로 이동 · 세션 종료
│  │  └─ 역할(캐릭터) / SKILL / MCP / 기타 관리                  <sub>예정</sub>
│  ├─ 임무 드롭다운
│  │  ├─ 임무 행 ×N
│  │  │  ├─ 클릭 → 팀 기본 임무 지정/해제 (토글)
│  │  │  │  ├─ 지정 시 임무 없는 세션 자동 배정
│  │  │  │  ├─ 다른 임무 세션은 유지 · 해제해도 배정 유지(기본값만 사라짐)
│  │  │  │  └─ 지정 성공 → git 패널 자동 오픈 + 그 저장소로 전환
│  │  │  ├─ [기본] 태그 · 상태 텍스트(project.json status)
│  │  │  └─ ⎇ git 연결 모달 (저장소 아니면 init · 주소 주면 origin 등록/갱신)
│  │  └─ + 새 임무 만들기 (3갈래)
│  │     ├─ git에서 불러오기 — url + 이름(선택) → clone
│  │     ├─ 새 프로젝트 만들기 — 빈 폴더 + project.json
│  │     └─ 기존 프로젝트 가져오기 — 폴더 선택 → junction 연결 (원본 위치 유지)
│  ├─ 세션 임무 배정 (배정 = 착수)
│  │  ├─ 1) 파일에 쓴다 — <세션>/MISSION.md (임무·경로·목표·산출물·메모)
│  │  │     ├─ 같은 임무 재배정=유지(멱등) · 다른 임무=통째 교체 · 해제=삭제
│  │  │     └─ CLAUDE.md `<!-- mission:start -->` 블록(~4줄, 페르소나 블록과 공존)
│  │  ├─ 2) 세션에 알린다 — 셸: `cd "<임무 폴더>"` / 에이전트: 자연어 브리프
│  │  │     └─ 판별 SessionInfo.agent (우클릭 '에이전트 실행'에서 기록 · '셸로 되돌리기' 해제)
│  │  ├─ 3) 캐시 갱신 — state.json assignments ("<팀>/<세션>" → 임무)
│  │  │     └─ 앱 시작 시 MISSION.md 실측 대조 (reconcileMissions)
│  │  └─ 사라진 임무 정리
│  │     ├─ 세션 배정 — Path 폴더 실측 후 시작 시 해제 · 실행 중이면 경고 + [배정 해제]
│  │     └─ 담당(기본) 임무 — 실측 목록에 없으면 지정 해제 (배정은 유지)
│  │        └─ 시점: 시작 시 / 팀 조회 시 / 자동 배정 실패 시 / 칩·우클릭 해제
│  ├─ 모달 5종 — 팀 불러오기 · 팀원 추가 · 세션 이름 변경 · 새 임무 만들기 · git 연결
│  ├─ 팀원 세팅 (직책 · 관계)
│  │  ├─ 관계도 SVG — 보고선 층 배치(위가 상급) · 한 층 5명 이상이면 아래 줄
│  │  │  └─ 보고(파랑 실선) · 지도(보라 파선) · 리뷰(청록 점선) · 협업(초록) + 화살표
│  │  ├─ 팀원·직책 — 자유 입력(프리셋 자동완성) · LEAD 뱃지 · 인격 이름 · 미실행 표기
│  │  ├─ 관계 — [앞][종류][뒤][메모] 행 추가/삭제 (자기 자신·중복 제외)
│  │  ├─ 기본 편성 채우기 — 빈 직책만 팀장/팀원 · 없는 보고선만 팀장에게
│  │  └─ 저장 → team.json(원본) · TEAM.md(편성표) · 팀원 CLAUDE.md team 블록
│  └─ 팀 0개일 때 — 빈 화면 + [새 팀 만들기] [팀 불러오기]
├─▸ 사이드 패널 (4종 · 한 번에 하나 · 좌/우 배치 전환 · 너비 드래그 280px~ · 배치 저장)
│  ├─ 브라우저                                                    ⌨ Ctrl+Shift+B
│  │  ├─ 툴바 — ◀ ▶ ⟳ · URL/검색 입력 · 좌우토글 · ✕
│  │  ├─ 주소 추론 — 도메인꼴이면 https:// · 아니면 Google 검색
│  │  ├─ 구현 — iframe이 아닌 main 프로세스 WebContentsView (X-Frame-Options 무관)
│  │  ├─ 새 창 요청은 같은 패널에서 열기 (deny + loadURL)
│  │  └─ 진입 — 탭바 ⧉ · 터미널 URL Ctrl+클릭 · 포트 [열기] · 팀 우클릭 git 주소
│  ├─ 포트 (LISTENING · 5초 자동 갱신)
│  │  ├─ 검색 — 포트 · 프로세스 · PID · 세션 이름
│  │  ├─ 세션 포트 — netstat pid → 부모 추적(최대 64단계) → 세션 셸 pid 매칭
│  │  │  ├─ [열기] → 브라우저 패널 http://localhost:<포트>
│  │  │  └─ [끄기] → 확인 후 taskkill /T /F (프로세스 트리)
│  │  └─ 시스템 포트 (기본 접힘 · 검색 중 자동 펼침 · 조작 없음)
│  ├─ 임무 트리
│  │  ├─ 검색 — 팀 · 임무 이름 (검색 중 팀 자동 펼침)
│  │  ├─ 팀 → 임무 → 폴더 (지연 로딩 · 한 번에 500개)
│  │  ├─ 클릭 펼치기/접기 · 더블클릭 탐색기로 열기
│  │  └─ 가드 — 워크스페이스 루트 밖 열람 거부
│  └─ git
│     ├─ 저장소 선택 (팀별 optgroup)
│     │  ├─ 탐색 범위 — 팀 폴더 → 세션 폴더 → 세션 하위 1단계 + 임무 폴더
│     │  └─ 마지막 선택 기억 (localStorage acmux-git-repo)
│     ├─ 툴바
│     │  ├─ 브랜치 select — 로컬/원격 optgroup · detached 표기
│     │  │  └─ 원격 선택 → 로컬 추적 브랜치로 checkout
│     │  ├─ ↑ahead ↓behind / "업스트림 없음"
│     │  ├─ [diff] 작업 트리 diff 팝업
│     │  ├─ [↓ pull] (원격 없으면 비활성)
│     │  ├─ [commit N] 커밋 팝업
│     │  └─ [↑ push] (업스트림 없으면 `-u origin HEAD` 자동 재시도)
│     ├─ 커밋 그래프
│     │  ├─ log --all --topo-order 최대 200개 · SVG 레인 배치(최대 12레인)
│     │  ├─ 브랜치·머지 곡선 · 레인별 8색 순환
│     │  ├─ refs 배지 — HEAD / 원격 / 태그
│     │  ├─ 제목 · 작성자 · 상대시간 · 짧은 해시
│     │  └─ 행 클릭 → 그 커밋의 diff 팝업
│     ├─ diff 팝업 (3분할)
│     │  ├─ 왼쪽 — 변경 파일 폴더 트리 (M/A/D/R/C/U 색상 코드)
│     │  ├─ 가운데 — 비교 대상 HEAD(작업 트리) / 부모 커밋(커밋 모드) · 삭제 줄 빨강
│     │  ├─ 오른쪽 — 현재 작업 트리 / 그 커밋 · 추가 줄 초록
│     │  └─ 줄 번호 · 바이너리 안내 · 대용량 클리핑(파일 300KB · 패널 4000줄)
│     ├─ 커밋 팝업 — 변경 파일 체크박스 · 전체 선택 시 add -A / 일부면 경로 지정
│     │              (rename은 양쪽 경로) · 메시지 입력 · Ctrl+Enter 커밋
│     ├─ 자동 갱신 — status 5초 폴링 · 브랜치/ahead/behind/변경 수 변화 시 재조회
│     └─ 안전 가드 — 워크스페이스 밖 저장소 차단 · 저장소 밖 파일 경로 차단
│                    커밋 해시 형식 검사 · `-` 시작 ref 거부
│                    GIT_TERMINAL_PROMPT=0 · GIT_OPTIONAL_LOCKS=0
├─▸ 외부 제어 — acmux CLI (named pipe \\.\pipe\acmux · JSON 한 줄 왕복)
│  ├─ list — 세션 목록 (id · 이름 · 팀 · pid · cwd)
│  ├─ new [--name] — 새 팀
│  ├─ add [팀이름|번호] [--name] — 팀에 세션 추가 (그리드 재배치)
│  ├─ split [row|col] — 활성 페인 분할
│  ├─ send <id|이름> <텍스트> — 세션 입력 (기본 Enter · --no-enter)
│  ├─ kill <id|이름> — 세션 종료
│  ├─ browser <url> — 브라우저 패널 열고 이동
│  ├─ dashboard — 관제 대시보드 열기
│  ├─ screenshot <파일.png> — 창 캡처 (+ 브라우저 패널은 *.browser.png)
│  └─ 세션 타겟은 id·이름 모두 허용 · new/add/split/browser/dashboard는 ui:command로 전달
├─▸ 데이터 · 저장 위치
│  ├─ 상태 파일 %USERPROFILE%\AgentCommender\state.json (ACMUX_STATE_PATH 재지정)
│  │  ├─ teams[] — 팀 이름 + 레이아웃 트리 + 페인별 세션 이름
│  │  ├─ assignments — "<팀>/<세션>" → 배정 임무 (캐시 · 원본은 MISSION.md)
│  │  ├─ teamProjects — 팀 이름 → 기본 임무
│  │  ├─ settings — fontSize · shell · panelSide · workspaceRoot
│  │  └─ 500ms 디바운스 · tmp → rename 원자적 쓰기 · 메인 전용 설정 병합 보존
│  ├─ 워크스페이스 루트 — ACMUX_WORKSPACE_ROOT > 첫 실행 선택 > ~/AgentCommender/workspaces
│  │  └─ <팀>/
│  │     ├─ team.json (편성 원본) · TEAM.md (편성표 파생)
│  │     ├─ <세션>/ — ROLE.md · CLAUDE.md(임무·페르소나·팀 블록) · MISSION.md
│  │     │            session.log(ANSI 제거) · session.log.old(5MB 초과 회전)
│  │     └─ project/<임무>/project.json — name · team · status · createdAt · source
│  ├─ localStorage acmux-git-repo (git 패널 마지막 저장소)
│  ├─ 환경변수 — ACMUX_WORKSPACE_ROOT · ACMUX_STATE_PATH · ACMUX_SHELL
│  ├─ 세션 이름 규칙 — 미지정 시 s<N> · 중복이면 -2, -3 접미사
│  └─ 팀 이름 규칙 — 생성 시 한 번만 지정 · 변경 불가 · 중복 거부
├─▸ 단축키 전체 (shortcuts.ts `shortcutOf` 단일 정의 · xterm에도 동일 함수 적용)
│  ├─ 앱 — Ctrl+Shift+T 새 팀 · Ctrl+Shift+W 페인 닫기
│  │       Ctrl+Shift+D / Ctrl+Shift+E 분할 · Ctrl+Tab / Ctrl+Shift+Tab 팀 전환
│  │       Ctrl+Shift+H 대시보드 · Ctrl+Shift+B 브라우저 · Ctrl+Shift+Z 줌
│  │       Ctrl+= / Ctrl+- / Ctrl+0 폰트 크기
│  ├─ 터미널 — Ctrl+C · Ctrl+V · Ctrl+F · 우클릭
│  └─ 창 — F12 개발자 도구 · Ctrl+Shift+R 새로고침
└─▸ 예정 슬롯 (UI 자리만)
   ├─ 세션 상세 패널 — 역할(캐릭터) · 설치된 SKILL · 설치된 MCP · 기타 관리
   └─ 터미널 뷰 하단 — workspace-footer "추가될 기능들 하나하나 추가할 예정"
```

---

## 6. 기능 축 × 제품 교차표

| 기능 축 | Ghostty | Orca | bbarit | Terax | AgentCommender |
|---|:--:|:--:|:--:|:--:|:--:|
| 터미널 에뮬레이터 내장 | ✅ 자체(Zig) | ✅ xterm.js | △ 자체 TUI | ✅ xterm.js | ✅ xterm.js |
| 탭 · 스플릿 페인 | ✅ | ✅ | — | ✅ | ✅ (최대 4×2 · 8세션) |
| GPU 렌더링 | ✅ Metal/OpenGL | — | — | ✅ WebGL | ✅ WebGL |
| 셸 통합 (OSC) | ✅ | △ OSC 타이틀·52 | — | ✅ OSC 7/133/777 | — |
| 내장 AI 에이전트 (자체 루프) | — | — | ✅ | ✅ | — |
| 외부 CLI 에이전트 통합 | — | ✅ 30+ | △ 설정 상호운용 | △ Claude Code 감지 | ✅ 3종 실행·브리프 |
| 멀티 에이전트 오케스트레이션 | — | ✅ Run/Task/Gate | ✅ --orchestrate | △ 서브에이전트 | △ 팀·임무·일괄 명령 |
| 코드 에디터 | — | ✅ Monaco | — | ✅ CodeMirror 6 | — |
| git UI | — | ✅ 리뷰·PR·이슈 | — | ✅ 헝크·그래프 | ✅ 그래프·diff·커밋 |
| 브라우저 / 웹 프리뷰 | — | ✅ + Design Mode | △ web_fetch 툴 | ✅ 프리뷰 탭 | ✅ WebContentsView |
| 파일 탐색기 | — | ✅ | △ ls/tree 툴 | ✅ + ripgrep 검색 | △ 임무 트리 |
| git 워크트리 모델 | — | ✅ 코어 | — | — | — |
| 원격 · SSH 실행 | ✅ +ssh 래퍼 | ✅ 4종 방식 | — | — | — |
| 모바일 컴패니언 | — | ✅ iOS/Android | — | — | — |
| 외부 CLI로 앱 제어 | △ +액션 | ✅ orca | — | — | ✅ acmux |
| 프로젝트 메모리 파일 | — | ✅ CLAUDE/AGENTS.md | ✅ 자체 메모리+위키 | ✅ TERAX.md | ✅ CLAUDE/MISSION/TEAM.md |
| 테마 커스터마이즈 | ✅ 수백 개 | ✅ 임포트 | ✅ | ✅ 10종+커스텀 | — 고정 다크 |
| 알림 시스템 | — | ✅ | — | ✅ 라우팅 | — |
| 팀 · 역할 편성 | — | — | △ 페르소나 295 | — | ✅ 직책·관계도 |
| 플러그인 · 확장 | △ libghostty | ✅ 플러그인·MCP | ✅ MCP·스킬·JS확장 | △ 커스텀 에이전트 | — |
| 플랫폼 | macOS · Linux | macOS · Win · Linux | macOS · Linux · Win | macOS · Linux · Win | Windows |
