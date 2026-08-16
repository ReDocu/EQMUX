# EQMUX 스크린샷 인덱스

> 촬영 2026-08-16 · 버전 0.2.0 · 해상도 1920×1080 @2x (3840×2160 PNG)
>
> 모든 화면은 **데모 데이터**(Academy 팀 시나리오)로 렌더링한 것입니다. 문서·웹사이트에 실을 때는
> "화면은 데모 데이터입니다" 부기를 유지하세요.

## `features/` — 기능별 화면 (29장)

기능 명세서([eqmux-feature-spec.md](../eqmux-feature-spec.md))의 절 순서와 맞춰 정렬했습니다.

### 연결 · 온보딩

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `01-workspace-connection.png` | 워크스페이스 연결 | 등록된 repo 목록 · clone · 경로 재지정 · 등록 해제 (전체 화면 팝업) |
| `02-launch-mode.png` | 실행 방식 선택 | 워크스페이스를 연 뒤 기본 터미널 / 팀 캐스팅 갈림길 |
| `03-terminal-setup.png` | 기본 터미널 구성 | 셸 선택 후 역할 없는 셸 세션으로 시작 |

### 관제

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `04-dashboard.png` | 관제 대시보드 | 워크스페이스×세션 그리드 · 상태 6종 · 에이전트 감지 배지(Claude·Codex) · 주의 카드 · 이벤트 피드 · 닫힌 워크스페이스 강등 행 |
| `05-session-detail.png` | 세션 상세 패널 | 승인 대기 배너 · 상태/임무/역할/서브에이전트/비용/메모리 · 실제 실행 플래그 원문 · 슬롯 권한 오버라이드 · 역할 변경 · 점프·재개·중지 |

### 터미널 워크스페이스

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `06-terminal-grid.png` | 터미널 2×2 그리드 | 세션 레일 · 상태 테두리 · waiting 배지 · 워크트리 섹션 · 상태 바(PTY·WAL·DB·MEM) |
| `07-layout-picker.png` | 페인 배치 선택 | 배치 6종 (Ctrl+Shift+L) |
| `08-layout-main-right.png` | 메인 + 우측 스택 배치 | 배치 적용 결과 · 분할 비율 |
| `09-terminal-fullscreen.png` | 터미널 전체 화면 | 포커스 모드 (앱 바 유지) |
| `25-terminal-search.png` | 터미널 내 검색 | Ctrl+F 검색 바 · 히트 하이라이트 · 이전/다음 |
| `26-pane-menu.png` | 페인 우클릭 메뉴 | 복사·붙여넣기·검색·화면 지우기 / 배치·줌·전체 화면 / 세션 상세·트랜스크립트 / 역할 세션 제거 |

### 팀 · 역할

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `10-team-casting.png` | 팀 캐스팅 | 편성 프리셋 4종 · 슬롯별 직무+페르소나 · 실행 권한 미리보기 · `.eqmux/team.json` 저장 고지 |
| `11-team-composition.png` | 팀 편성 | 관계도(SVG) · LEAD 뱃지 · 보고/지도/리뷰/협업 관계 · 선택 슬롯 권한 · 재시작 필요 고지 |
| `12-role-library.png` | 역할 라이브러리 | 고정 직무 8종(권한·책임·금지) · 페르소나 8종 · 생성/편집 |

### 임무

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `13-missions.png` | 임무 배정 | 임무 카드 · 상태 뱃지 · ★ 기본 임무 · 브랜치 체크아웃 · 세션 배정 토글 · 새 임무 생성 |
| `14-mission-explorer.png` | 임무 · 파일 탐색기 | 파일 트리 + 임무 파일 구조화 뷰(frontmatter·목표·산출물) · 파일 CRUD · `.eqmux` watch |

### 사이드 패널

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `15-panel-conversation.png` | 개요(대화) | 메시지 타입 5종 뱃지 · @멘션 · 미확인 · 타입 선택 발신 |
| `16-panel-git.png` | git 패널 | 한 줄 툴바 · 브랜치 · ahead/behind · diff/pull/commit/push(명령 복사) · 커밋 행 · 워크트리 목록 |
| `17-panel-ports.png` | 포트 패널 | 세션 포트 / 시스템 포트 분리 · 프로세스·세션 귀속 · 충돌·외부 노출 집계 |
| `18-panel-logs.png` | 로그 패널 | 이벤트 원장 스트림 · 전문 검색 |
| `19-panel-browser.png` | 브라우저 패널 | localhost 전용 미리보기 (브라우저 dev에서는 빈 상태 — 실측 포트는 Tauri에서 연결) |

### 검토

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `20-git-diff.png` | Git Diff (워크트리) | 변경 파일 트리(A/M/D) · HEAD ↔ 워크트리 나란히 비교 · 읽기 전용 |
| `28-git-commit-diff.png` | Git Diff (커밋) | 부모 커밋 ↔ 선택 커밋 비교 |
| `21-transcript.png` | 트랜스크립트 | 턴 단위 열람 · 참조만 저장(V2) · 검색 · 세션 저장 · 입력은 PTY 직행 |
| `27-worktree-create.png` | 워크트리 생성 | 새 브랜치 / 기존 브랜치 연결 · base 선택 · 생성 후 셸 열기 |

### 설정 · 기타

| 파일 | 화면 | 담긴 기능 |
|---|---|---|
| `22-settings.png` | 설정 | 언어·테마·슬롯 수·시작 화면·알림·저장 정책 + 고정 정책 선언(권한·불가침) |
| `23-exit-dialog.png` | 종료 확인 | 실행 중 세션 목록 · 재개 가능 여부 · 완전 종료 |
| `24-theme-light.png` | 라이트 테마 | 테마 토큰 교체 (터미널 페인은 항상 다크) |
| `29-english-ui.png` | 영어 UI | i18n 사전 치환 — 데이터(이벤트·페르소나·경로)는 원문 유지 |

## `readme/` — README 본문용 (5장)

README가 참조하는 고정 파일명입니다. 파일명을 바꾸면 README 링크가 깨집니다.

| 파일 | 용도 |
|---|---|
| `dashboard.png` | 관제 대시보드 |
| `workspace.png` | 터미널 워크스페이스 |
| `conversation.png` | 대화 패널 |
| `gitdiff.png` | Git Diff & 에디터 |
| `casting.png` | 팀 캐스팅 |

## `promo/` — 홍보 조판 이미지 (3장)

스크린샷에 태그라인·프레임을 얹은 마케팅 컷입니다. 조판 소스는 재생성 가능합니다.

| 파일 | 크기 | 용도 |
|---|---|---|
| `hero.png` | 2400×1350 | 히어로 |
| `terminal.png` | 2400×1350 | 터미널 피처 · SNS |
| `og-card.png` | 1200×630 | OG / 링크 공유 카드 |

## 재촬영 방법

Tauri 창이 아니라 **Vite dev 서버 + headless Chrome(CDP)** 으로 촬영했습니다.

1. `npm run dev` (포트 1420)
2. headless Chrome을 `--disable-webgl`로 실행 — xterm의 WebGL 렌더러는 headless 캡처에 담기지 않으므로 DOM 렌더러 폴백을 태워야 터미널 텍스트가 찍힙니다
3. 페이지에서 `await import("/src/state.ts")` 로 앱과 같은 상태 모듈 인스턴스를 잡고 `setView` · `setOverlay` · `openPanel` 로 화면을 직접 전환
4. `Page.captureScreenshot` (deviceScaleFactor 2)
