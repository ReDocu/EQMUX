// 설정 화면 사전 (Settings.tsx)
export const dict: Record<string, string> = {
  // 헤드
  "settings.json 즉시 저장": "Saved to settings.json instantly",
  "브라우저 dev — 저장 없음": "Browser dev — not persisted",
  "값을 클릭하면 다음 옵션으로": "click a value to cycle options",
  "기본값 복원": "Restore defaults",
  "클릭하면 다음 옵션 — 즉시 저장": "Click for next option — saved instantly",
  "고정 정책 — 설정으로 바꾸지 않습니다": "Fixed policy — not configurable",

  // 언어
  "UI 언어 — 한국어(기본)·영어. 코드·데이터의 한국어 원문은 그대로 두고 화면 표시만 바꿉니다.":
    "UI language — Korean (default) or English. Only the display changes; Korean source data stays as-is.",
  "표시 언어": "Display language",
  "한국어 (기본)": "한국어 (default)",
  "이벤트 로그·생성 파일": "Event logs · generated files",
  "원문 유지 (데이터 불변)": "Kept as written (data is immutable)",

  // 화면
  화면: "Display",
  "테마는 디자인 토큰만 바꿉니다 (M29). 터미널 페인은 TUI·ANSI 가독성을 위해 항상 다크입니다.":
    "Theme swaps design tokens only (M29). Terminal panes stay dark for TUI/ANSI legibility.",
  "다크 (기본)": "Dark (default)",
  라이트: "Light",
  "시스템 따름": "Follow system",
  "터미널 페인": "Terminal panes",
  "항상 다크 (ANSI 팔레트 전제)": "Always dark (assumes ANSI palette)",
  "색 팔레트": "Color palette",
  "부드러움 (기본)": "Soft (default)",
  고대비: "High contrast",
  중성: "Neutral",
  따뜻함: "Warm",
  강조색: "Accent colors",
  "팔레트 공통 — 배경 명도·색온도만 바뀝니다": "Shared across palettes — only surface lightness and warmth change",

  // 세션 슬롯
  "세션 슬롯": "Session slots",
  "워크스페이스당 세션(터미널 페인) 수의 상한입니다. 줄여도 이미 열린 세션은 닫지 않습니다.":
    "Cap on sessions (terminal panes) per workspace. Lowering it never closes sessions already open.",
  "슬롯 수": "Slot count",
  "4개 (기본)": "4 (default)",
  "6개": "6",
  "8개": "8",
  "복원 허용": "Restore allowance",
  "team.json 최대 8슬롯 — 설정과 무관": "team.json up to 8 slots — independent of this setting",

  // 시작과 복원
  "시작과 복원": "Startup & restore",
  "자동 실행 없이 화면 상태만 복원합니다 (FR-G-02 · FR-C-30).":
    "Restores screen state only — nothing auto-runs (FR-G-02 · FR-C-30).",
  "시작 화면": "Start view",
  "관제 대시보드": "Control dashboard",
  "마지막 워크스페이스": "Last workspace",
  "스크롤백 재생": "Scrollback replay",
  "열린 탭·배치 복원": "Open tabs & layout restore",
  "항상 (layout.json)": "Always (layout.json)",

  // 알림
  "사람의 행동이 필요한 상태만 알립니다 (G3). 꺼도 인앱 미확인은 유지됩니다 (FR-G-37).":
    "Notifies only states that need a human (G3). In-app unseen markers persist even when off (FR-G-37).",
  "OS 알림": "OS notifications",
  "waiting만": "waiting only",
  꺼짐: "Off",
  "waiting 사운드": "waiting sound",
  "켜짐 (예약 — OS 알림 기본음)": "On (reserved — OS default sound)",
  "메모리 배너": "Memory banner",
  "꺼짐 (기본)": "Off (default)",
  "세션 2 GB↑": "Session over 2 GB",
  "세션 4 GB↑": "Session over 4 GB",
  "세션 8 GB↑": "Session over 8 GB",
  "창 포커스 시": "When window focused",
  "억제 (FR-G-31)": "Suppressed (FR-G-31)",

  // 저장소와 보존
  "저장소와 보존": "Storage & retention",
  "워크스페이스별 SQLite WAL — 보존 상한은 고정 정책 (C4). SGR 저장은 끌 수 있습니다 (FR-C-15).":
    "Per-workspace SQLite WAL — retention caps are fixed policy (C4). SGR storage can be turned off (FR-C-15).",
  "SGR 색 저장": "SGR color storage",
  "켜짐 (기본)": "On (default)",
  "꺼짐 — 용량 절감": "Off — saves space",
  "세션당 상한": "Per-session cap",
  "보존 기간": "Retention period",
  "배치 커밋": "Batch commit",

  // Claude Code 런타임
  "Claude Code 런타임": "Claude Code runtime",
  "검증된 CLI와 관측 어댑터 — 고정 정책 (D2).": "Verified CLI and observation adapter — fixed policy (D2).",
  "상태 소스": "Status source",
  "세션 레지스트리 watch + 2s 재스캔": "Session registry watch + 2s rescan",
  "--resume · 같은 UUID · 같은 cwd": "--resume · same UUID · same cwd",
  훅: "Hooks",
  "2차 소스 (PRD I 대기)": "Secondary source (pending PRD I)",

  // 권한 정책
  "권한 정책": "Permission policy",
  "bypassPermissions는 앱에서 제공하지 않습니다.": "bypassPermissions is not offered by this app.",
  "권한 원천": "Permission source",
  "역할 파일 frontmatter (D5)": "Role file frontmatter (D5)",
  "권한 변경": "Permission change",
  "재개 기반 재시작 (E11′)": "Resume-based restart (E11′)",

  // 사용자 파일 불가침
  "사용자 파일 불가침": "User files untouched",
  "개인 Claude 설정은 수정하지 않습니다 (D3 · FR-E-70).": "Personal Claude settings are never modified (D3 · FR-E-70).",
  "수정 안 함": "Never modified",
  "수정 안 함 (읽기만)": "Never modified (read-only)",

  // 문의 · 피드백
  "문의 · 피드백": "Feedback",
  "버그와 개선 제안을 받고 있습니다. 아직 1.0 이전이라 어떤 이야기든 도움이 됩니다.":
    "Bug reports and feature requests are welcome — it's still pre-1.0, so anything helps.",
  "문의 폼": "Feedback form",
  "브라우저에서 열기": "Open in browser",
  "기본 브라우저로 엽니다": "Opens in your default browser",
};
