# 기능별 디자인 스크린샷

실행 중인 앱을 기능별 화면 상태로 만들어 캡처한 27장. 목업이 아니라 실제 렌더 결과다.

한눈에 보려면 [`index.html`](index.html)을 브라우저로 열면 된다 (앱의 브라우저 패널에서도 열린다).

| 캡처 조건 | 값 |
|---|---|
| 창 | 1607 × 883 CSS px · devicePixelRatio 2 |
| 이미지 | PNG 2411 × 1325 (1.5×) |
| 상태 | 팀 2개(EQMux · Academy) / 세션 4개 · 임무 AcademyCurriculum |

## 관제 대시보드

| 파일 | 내용 |
|---|---|
| `01-dashboard-overview.png` | 스탯 타일 6종 · 팀 카드 · 하단 요약 |
| `02-dashboard-team-slider.png` | 팀 슬라이더 — 세션 3개 팀 · 세션 추가 셀 |
| `03-session-detail-info.png` | 세션 상세 — 세션 정보 탭 |
| `04-session-detail-persona.png` | 세션 상세 — 페르소나 탭 |
| `05-session-context-menu.png` | 세션 우클릭 — 에이전트 실행 · 페르소나 · 종료 |
| `06-team-menu.png` | 팀 메뉴 — 폴더 · 팀원 세팅 · 명령 · 종료 |

## 팀 편성 · 지휘

| 파일 | 내용 |
|---|---|
| `15-team-dialog.png` | 팀 추가 — 새로 만들기 (터미널 / 페르소나 모드) |
| `16-team-dialog-import.png` | 팀 추가 — 폴더에서 불러오기 |
| `17-team-roster.png` | 팀원 세팅 — 관계 그래프 · 직책 |
| `07-team-broadcast.png` | 팀 전체에 명령 보내기 |
| `08-team-batch.png` | 일괄 명령 (세션별로 다르게) |

## 임무 (프로젝트)

| 파일 | 내용 |
|---|---|
| `09-team-mission-menu.png` | 팀 임무 드롭다운 |
| `10-mission-register.png` | 새 임무 만들기 — 방식 선택 |
| `11-mission-register-git.png` | 새 임무 만들기 — git clone |
| `22-panel-missions.png` | 임무 트리 패널 |

## 페르소나

| 파일 | 내용 |
|---|---|
| `13-persona-new.png` | 페르소나 생성 — 라이브러리 |
| `12-persona-assign.png` | 페르소나 부여 (라이브러리 → 세션) |
| `14-user-title.png` | 내 호칭 |
| `04-session-detail-persona.png` | 세션의 페르소나 상태 |

## 터미널

| 파일 | 내용 |
|---|---|
| `18-terminal-view.png` | 터미널 뷰 — 세션 3분할 |
| `19-layout-picker.png` | 배치 팔레트 (Ctrl+Shift+L) |
| `25-pane-zoom.png` | 페인 줌 (Ctrl+Shift+Z) |
| `26-terminal-search.png` | 터미널 내 검색 (Ctrl+F) |

## 사이드 패널

| 파일 | 내용 |
|---|---|
| `20-panel-git.png` | git 패널 — 커밋 그래프 · pull/commit/push |
| `24-git-diff.png` | diff 3분할 뷰어 |
| `21-panel-ports.png` | 포트 패널 |
| `23-panel-logs.png` | 로그 패널 |
| `27-panel-browser.png` | 브라우저 패널 (WebContentsView) |

---

브라우저 패널(27)은 네이티브 `WebContentsView`라 렌더러 캡처에 잡히지 않는다.
렌더러 캡처와 패널 캡처를 각각 찍어 합성했다.
