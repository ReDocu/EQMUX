# Ghostty 기능 정리

> 출처: https://github.com/ghostty-org/ghostty · https://ghostty.org/docs (2026-08-02 조사)
>
> Ghostty는 Mitchell Hashimoto가 만든 터미널 에뮬레이터로,
> "빠름(fast) · 기능 풍부(feature-rich) · 네이티브(native) 셋 중 둘만 고르게 만드는
> 기존 터미널과 달리 셋 다 제공"하는 것이 핵심 철학이다. MIT 라이선스, Zig 코어.
> 순수 터미널 에뮬레이터라 AI 에이전트 기능은 없다 — 아래 분류에서 에이전트 항목이 비는 이유.

---

## 🖥️ 터미널

### 터미널 에뮬레이션 표준

- 주류 터미널 프로그램과 호환되는 제어 시퀀스 구현, xterm 준수 테스트 기반의 레거시 시퀀스 지원
- 준수 우선순위: 표준 → xterm 동작 → 기타 인기 터미널
- **모던 시퀀스**: Kitty graphics protocol(터미널 내 이미지 렌더링), Kitty keyboard protocol(확장 키 입력),
  클립보드 시퀀스, synchronized rendering(동기화 화면 갱신), 라이트/다크 모드 변경 알림, 하이퍼링크
- Ghostty 전용 시퀀스는 로드맵상 미구현(생태계 파편화 우려로 보류 중)

### 성능

- GPU 가속 렌더링 — macOS **Metal**, Linux **OpenGL**
- 터미널마다 읽기/쓰기/렌더 전용 스레드를 두는 멀티스레드 아키텍처
- 터미널 파서에 CPU별 SIMD 명령 활용
- Alacritty급 최고 속도 계층을 목표 — 시작 시간·스크롤·IO 처리량·렌더링의 균형

### 창/탭/스플릿

- 멀티 윈도우, 탭(이름 변경·색상 지정 가능), 스플릿 페인
- 전부 플랫폼 **네이티브 UI 컴포넌트**로 구현 (텍스트 기반 커스텀 위젯 아님)

### 텍스트 렌더링

- 리가처 폰트 렌더링 + 폰트 피처 개별 켜기/끄기
- Grapheme clustering — 다중 코드포인트 이모지(국기·피부톤)를 한 글자로 렌더링
- 아랍어·히브리어 등 RTL 스크립트 표시 지원

### 테마

- **수백 개 내장 테마** (iterm2-color-schemes 기반, 주간 갱신), 한 줄 설정으로 적용
  (`theme = Catppuccin Frappe`)
- **라이트/다크 모드 자동 전환** — `theme = dark:...,light:...` 문법으로 모드별 테마 지정
- 커스텀 테마 — 테마 파일은 곧 설정 파일(색상 외 모든 설정 가능), 사용자 설정이 테마를 오버라이드
- 탐색: `ghostty +list-themes`, 검색 경로 `$XDG_CONFIG_HOME/ghostty/themes` 등
- 색 설정 키: `background` `foreground` `cursor-color` `cursor-text`
  `selection-foreground` `selection-background` `palette`(16색)

### 셸 통합

- 자동 통합 지원 셸: **bash, elvish, fish, nushell, zsh** (셸 basename 감지로 통합 코드 자동 주입)
- 프롬프트에 커서가 있으면 종료 확인 생략
- 새 터미널이 직전 포커스 터미널의 작업 디렉터리에서 시작
- 복잡한 프롬프트는 리플로우 대신 셸 리드로우로 올바르게 리사이즈
- `jump_to_prompt` 키바인딩 — 프롬프트 단위 스크롤
- 프롬프트에서 커서가 바(bar) 형태로 변환
- Ctrl+트리플클릭(macOS Cmd) — 명령 출력 선택 / Alt+클릭(Option) — 프롬프트 커서 이동
- 옵션: `sudo` 자동 래핑(terminfo 보존), `ssh` 자동 래핑 (둘 다 기본 꺼짐)
- `shell-integration = <shell|none>` 으로 강제/비활성, 수동 소싱 경로 제공(`GHOSTTY_RESOURCES_DIR`)

### SSH (`ghostty +ssh`)

- **환경 전달** — `COLORTERM`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`을 SendEnv로 원격 전달
- **terminfo 자동 설치** — 첫 접속 시 `tic`으로 설치 후 `TERM=xterm-ghostty`,
  실패 시 `xterm-256color` 폴백
- **설치 캐시** — `user@hostname` 단위 캐시, `+ssh-cache` CLI로 관리, `--cache=false`로 우회
- `--ssh=PATH` — 대체 SSH 클라이언트 지정
- 셸 통합 연동 — `shell-integration-features = ssh-env,ssh-terminfo`로 ssh 명령 투명 래핑
- 수동 설정 경로 — `~/.ssh/config`의 SetEnv/SendEnv (OpenSSH 8.7+)

### 키바인딩

- 문법: `keybind = trigger=action` — 수정자(shift/ctrl/alt/super) + 키
- **유니코드 코드포인트 트리거** — 비US 키보드 레이아웃 지원 (예: `ctrl+ö`)
- 트리거 프리픽스:
  - `all:` — 포커스 무관 모든 터미널 서피스에 적용
  - `global:` — 앱 포커스 없이도 동작하는 시스템 전역 바인딩 (macOS 전용, 접근성 권한 필요)
  - `unconsumed:` — 입력을 소비하지 않고 터미널 프로그램에도 전달
  - `performable:` — 액션 실행 가능할 때만 입력 소비 (예: 선택 있을 때만 copy)
- 액션: `ignore`, `unbind`, `text:`(Zig 리터럴 문법), `csi:`, `esc:` 등 수십 종
- 런타임 설정 리로드 — `ctrl+shift+,` (Linux) / `cmd+shift+,` (macOS)

### macOS 전용

- **SwiftUI/AppKit 진짜 네이티브 앱** — 네이티브 윈도잉·메뉴바·설정 GUI
- **Quick Terminal** — 드롭다운(오버레이) 빠른 터미널
- **AppleScript 자동화** — application → windows → tabs → terminals 객체 모델;
  `new window`/`new tab`/`split`(4방향)/`focus`/`select tab`/`close`,
  `input text`/`send key`(수정자 포함)/`send mouse ...`/`perform action`("toggle_fullscreen" 등),
  `new surface configuration`(폰트 크기·작업 디렉터리·명령·초기 입력·환경변수 재사용);
  tmux식 레이아웃 구성, 다중 터미널 브로드캐스트 등 가능
- **Apple Shortcuts 통합** (AppIntents)
- **Proxy Icon** — 타이틀바에서 파일 참조 드래그
- **Quick Look** — 세 손가락 탭으로 정의/검색
- **Secure Keyboard Entry** — 비밀번호 입력 보호 + 잠금 인디케이터
- Metal 렌더러 + CoreText 폰트 탐색

### Linux 전용

- **GTK4(Zig)** 빌드, 표준 GTK 통합
- **systemd 딥 통합** (가능한 환경에서)
- 단일 인스턴스 새 창(single-instance new windows)
- cgroup 격리

## 🤖 에이전트

- **해당 없음** — Ghostty는 순수 터미널 에뮬레이터로, AI 에이전트 기능(에이전트 실행·오케스트레이션·
  세션 추적 등)을 내장하지 않는다.
- 다만 에이전트 CLI 구동의 **기반 인프라** 역할은 한다: Kitty keyboard protocol(수정자 키 완전 전달),
  Kitty graphics(이미지 표시), synchronized rendering, 하이퍼링크 등은 Claude Code·Codex 같은
  TUI 에이전트의 표시 품질을 높이는 요소다.
- 참고: Orca는 첫 실행 시 Ghostty의 테마·폰트·커서 설정 임포트를 지원한다
  ([[orca-features]] 문서 참조).

## 📦 기타

### 설정 시스템

- 위치: `$XDG_CONFIG_HOME/ghostty/config.ghostty`(또는 `config`),
  macOS는 추가로 `~/Library/Application Support/com.mitchellh.ghostty/` (XDG → 플랫폼 순 로드, 나중이 우선)
- 문법: `key = value`, `#` 주석, 빈 값은 기본값 리셋
- **모든 설정 키가 CLI 플래그로도 동작** — `ghostty --background=282c34`
- `config-file` 키로 설정 분할 포함(현재 파일 끝에서 처리), `?` 프리픽스로 선택적 포함(플랫폼별 설정)
- 런타임 리로드 지원(일부 옵션은 새 터미널에만 적용)
- 문서화: man 페이지 + `$prefix/share/ghostty/docs`,
  `ghostty +show-config --default --docs`로 전체 기본값+문서 출력

### CLI 액션

- `ghostty +list-themes` — 테마 목록
- `ghostty +show-config` — 설정 출력
- `ghostty +ssh` / `+ssh-cache` — SSH 래퍼·캐시 관리
- `ghostty +crash-report` — 크래시 리포트 관리

### libghostty (임베더블 라이브러리)

- 코어 터미널 에뮬레이션·폰트 처리·렌더링을 제공하는 **C-ABI 크로스플랫폼 라이브러리** —
  macOS/Linux GUI 둘 다 이 공유 코어(Zig)를 소비
- **libghostty-vt** — 시퀀스 파싱·터미널 상태 관리 라이브러리;
  macOS·Linux·**Windows**·**WebAssembly** 지원, C/Zig 사용 가능 (기능 안정, API 시그니처는 개발 중)
- Doxygen C API 문서, C/Zig 예제 프로젝트, 최소 구현 예제 **Ghostling**,
  커뮤니티 목록 **awesome-libghostty**
- 라이브러리는 무의존성(zero-dependency) 설계

### 크래시 리포터

- 내장 크래시 리포터 — `.ghosttycrash` 파일을 `$XDG_STATE_HOME/ghostty/crash`에 저장(Sentry envelope 포맷)
- **자동 전송 없음** — 사용자가 `ghostty +crash-report` CLI로 직접 확인·공유

### 플랫폼 · 배포 · 프로젝트 상태

- 앱 지원: macOS, Linux (Windows는 계획 단계; libghostty-vt는 Windows/Wasm 지원)
- 설치: macOS 바이너리 제공, Linux는 배포판 패키지 또는 소스 빌드(제로 설정으로 즉시 사용 철학)
- "수백만 명·수백만 머신이 매일 사용하는 안정 단계" — GitHub 59k+ 스타, MIT 라이선스
- 로드맵 6대 목표 중 5개 완료(표준 준수·성능·윈도잉·네이티브 경험·libghostty),
  Ghostty 전용 시퀀스만 미착수
