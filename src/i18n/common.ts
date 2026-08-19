// 공용 사전 — 여러 화면이 공유하는 용어의 정본. 화면별 사전과 키가 겹치면 나중 것이 이기지만,
// 공유 용어는 여기 번역을 그대로 복사해 쓰는 것이 원칙이다 (용어 통일).
export const dict: Record<string, string> = {
  // ── 핵심 도메인 용어 ──
  워크스페이스: "Workspace",
  세션: "Session",
  슬롯: "Slot",
  임무: "Missions",
  직무: "Job",
  페르소나: "Persona",
  역할: "Role",
  편성: "Composition",
  캐스팅: "Casting",
  관제: "Control",
  대화: "Conversation",
  브랜치: "Branch",
  워크트리: "Worktree",
  배치: "Layout",
  페인: "Pane",
  터미널: "Terminal",
  "기본 터미널": "Default terminal",
  "역할 세션": "Role session",
  설정: "Settings",
  알림: "Notifications",
  테마: "Theme",
  언어: "Language",

  // ── 공용 동작 ──
  취소: "Cancel",
  저장: "Save",
  닫기: "Close",
  확인: "Confirm",
  삭제: "Delete",
  추가: "Add",
  제거: "Remove",
  적용: "Apply",
  열기: "Open",
  재개: "Resume",
  재시작: "Restart",
  중지: "Stop",
  이동: "Go to",
  복사: "Copy",
  편집: "Edit",
  이름: "Name",
  경로: "Path",
  상태: "Status",
  줌: "Zoom",
  "줌 해제": "Unzoom",
  "전체 화면": "Fullscreen",

  // ── 대기 문맥 (agent.rs가 만드는 어휘 — 페인 배지·대시보드·상세·알림이 공유한다, B16) ──
  "질문 선택 대기 — 이 페인에서 답해야 진행됩니다":
    "Awaiting your choice — answer in this pane to continue",
  "계획 승인 대기 — 이 페인에서 답해야 진행됩니다":
    "Awaiting plan approval — answer in this pane to continue",
  "입력 필요 — 이 페인에서 답해야 진행됩니다": "Input needed — answer in this pane to continue",
  "권한 승인 대기": "Permission prompt",
  "다이얼로그 응답 대기": "Dialog awaiting a response",
  "목표 제안 검토 대기": "Goal proposal awaiting review",
  "샌드박스 승인 대기": "Sandbox request awaiting approval",
  "워커 승인 대기": "Worker request awaiting approval",
  "Focus — 이 페인을 전체 화면으로 잡고 키보드를 넘깁니다":
    "Focus — takes this pane fullscreen and hands it the keyboard",
  "저장됨 ✓": "Saved ✓",

  // ── 경과 시간 (types.ts fmtSince) ──
  방금: "just now",
  "{m}분째": "{m}m",
  "{h}시간째": "{h}h",

  // ── 페인 배치 6종 (state.ts PANE_LAYOUTS — 렌더 지점에서 t()로 감싼다) ──
  "그리드 · 열 우선": "Grid · column first",
  "열을 먼저 채웁니다": "Fills columns first",
  "그리드 · 행 우선": "Grid · row first",
  "행을 먼저 채웁니다": "Fills rows first",
  "세로 스택": "Vertical stack",
  "위에서 아래로 나열": "Stacked top to bottom",
  "가로 나열": "Horizontal row",
  "왼쪽에서 오른쪽으로 나열": "Laid out left to right",
  "메인 + 우측 스택": "Main + right stack",
  "첫 세션 크게, 나머지 우측": "First session large, rest on the right",
  "메인 + 하단 나열": "Main + bottom row",
  "첫 세션 크게, 나머지 하단": "First session large, rest at the bottom",

  // ── 상태 표현 (ui.tsx StatusLabel) ──
  서브: "sub",
  "낮은 신뢰": "low confidence",
  "관측 저하 (FR-G-27) — 세션 레지스트리 접근 불가. 상태는 훅 + 프로세스 생존으로만 유지됩니다 (FR-D-63)":
    "Degraded observation (FR-G-27) — session registry unreachable. Status is maintained only via hooks + process liveness (FR-D-63)",

  // ── 자주 겹치는 문구 ──
  "세션 추가": "Add session",
  "+ 세션 추가": "+ Add session",
  "빈 슬롯에 세션 추가": "Add a session to an empty slot",
  "비어 있음": "empty",
  미확인: "Unseen",
  "승인 대기": "Waiting for approval",
  "재개 대기": "awaiting resume",
  "재개 가능": "resumable",
  "재개 불가": "not resumable",
};
