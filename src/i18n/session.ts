// 세션 그룹 사전 — SessionDetailPanel · TerminalPane · ExitDialog · CrashRecovery.
// 공용 용어(재개·중지·적용 등)는 common.ts가 정본이라 여기 없다.
export const dict: Record<string, string> = {
  // ── 세션 상세 (SessionDetailPanel) ──
  셸: "Shell",
  "에이전트 미기동": "Agent not started",
  "승인·거부는 터미널 페인에서 수행합니다.": "Approve or deny in the terminal pane.",
  개요: "Overview",
  관측: "Observation",
  "저하 — 레지스트리 접근 불가 · 훅 + 프로세스 생존으로 유지 (FR-D-63)":
    "Degraded — registry unreachable · maintained via hooks + process liveness (FR-D-63)",
  미배정: "Unassigned",
  서브에이전트: "Subagents",
  "활동 (훅 2차)": "Activity (hook, secondary)",
  "비용 (statusLine)": "Cost (statusLine)",
  누적: "cumulative",
  "— (보고 전)": "— (not yet reported)",
  메모리: "Memory",
  "측정 불가": "not measurable",
  가능: "available",
  불가: "unavailable",
  "PID · 셸": "PID · shell",
  격리: "Isolation",
  "워크트리 · 전용 브랜치 (E1′)": "Worktree · dedicated branch (E1′)",
  "공유 · repo 루트 (FR-E-60)": "Shared · repo root (FR-E-60)",
  "이 세션의 OS 알림·사운드 음소거 (FR-G-35) — 인앱 미확인 점은 유지":
    "Mute OS notifications & sound for this session (FR-G-35) — the in-app unseen dot remains",
  "🔇 음소거 중 — 해제": "🔇 Muted — unmute",
  "🔇 워크스페이스 음소거 중": "🔇 Workspace muted",
  "🔔 켜짐 — 음소거": "🔔 On — mute",
  실행: "Execution",
  "세션 이름": "Session name",
  "실제 실행 플래그 (FR-D-41)": "Actual runtime flags (FR-D-41)",
  "슬롯 권한 (FR-E-34)": "Slot permissions (FR-E-34)",
  "직무 기본값과 다른 슬롯 오버라이드 — team.json·역할 파일에 영속":
    "Slot override differing from job defaults — persisted to team.json and the role file",
  오버라이드: "Override",
  "오버라이드 해제 — 직무 기본값으로": "Clear override — back to job defaults",
  기본값: "Defaults",
  "직무 기본": "Job defaults",
  "유효 권한이 달라지면 재시작이 필요합니다 (E11′)":
    "If the effective permissions change, a restart is required (E11′)",
  "권한 변경 감지 · 재시작 필요": "Permission change detected · restart needed",
  "권한 변경 감지 · 다음 기동 때 적용됩니다": "Permission change detected · applies at the next start",
  "재개 기반 재시작 — 대화를 잃지 않는다 (FR-D-26)":
    "Resume-based restart — the conversation is preserved (FR-D-26)",
  "대화 유지 재시작": "Restart, keep conversation",
  "역할 부여": "Assign role",
  "기본 터미널입니다. 저장된 페르소나를 붙이면 역할 세션이 됩니다 — 직무는 페르소나의 저장 직무를 따릅니다.":
    "This is a default terminal. Attach a saved persona to make it a role session — the job follows the persona's saved job.",
  "페르소나의 저장 직무 (미지정이면 기본값) — 라이브러리의 페르소나 편집에서 바꿉니다":
    "The persona's saved job (default if unset) — change it in the library's persona editor",
  "이미 돌던 셸이라 권한 플래그 적용을 위해 재시작이 필요합니다 (E11′).":
    "This shell was already running — a restart is needed to apply the permission flags (E11′).",
  "역할 변경": "Change role",
  "직무를 바꾸면 실행 권한이 달라져 재시작이 필요합니다 (E11′).":
    "Changing the job changes runtime permissions, requiring a restart (E11′).",
  "역할 해제 — 기본 터미널로 전환": "Detach role — switch to default terminal",
  영속성: "Persistence",
  스크롤백: "Scrollback",
  "세션 로그": "Session log",
  "로그 폴더 열기": "Open log folder",
  "기록 저장": "Save transcript",
  "스크롤백 전체(디스크 포함)를 평문 텍스트로 저장": "Save the full scrollback (including disk) as plain text",
  "저장 중…": "Saving…",
  ".txt로 내보내기…": "Export as .txt…",
  "세션 이벤트 (FR-G-61)": "Session events (FR-G-61)",
  "페인으로 점프": "Jump to pane",

  // 세션 데이터의 고정 문구 (mock.ts resumeReason) — 렌더 지점 t()가 푼다
  "transcript + cwd 일치": "transcript + cwd match",
  "transcript 없음": "no transcript",
  "일반 셸 · cwd 유지": "plain shell · cwd kept",

  // ── 종료 다이얼로그 (ExitDialog) ──
  "저장소 flush 중…": "Flushing store…",
  "flush가 2초를 넘겼습니다 — 계속 진행합니다 (FR-C-63)": "Flush exceeded 2 seconds — continuing anyway (FR-C-63)",
  "정상 종료 신호 → 유예 후 프로세스 트리 종료…": "Graceful shutdown signal → grace period, then process tree termination…",
  "EQMUX를 종료할까요?": "Quit EQMUX?",
  "실행 중인 세션 {n}개가 종료됩니다. 자동 재개하지 않습니다.":
    "{n} running session(s) will be terminated. They will not auto-resume.",
  "입력 차단 → 저장소 flush → 정상 종료 신호 → 유예 후 트리 종료 (Job Object)":
    "Block input → flush store → graceful shutdown signal → grace period, then tree termination (Job Object)",
  "실행 중인 세션이 없습니다 — 바로 종료합니다.": "No sessions running — quitting immediately.",
  "종료 중…": "Quitting…",
  종료: "Exit",

  // ── 비정상 종료 복구 (CrashRecovery) ──
  "{m}분 전": "{m} min ago",
  "{h}시간 전": "{h}h ago",
  "{d}일 전": "{d}d ago",
  "직전 실행이 정상 종료되지 않았습니다": "The previous run did not shut down cleanly",
  "종료 시퀀스를 거치지 못한 채 끝났습니다. 그때 실행 중이던 세션과 마지막 활동 시각입니다.":
    "It ended without completing the shutdown sequence. These are the sessions running at the time and their last activity.",
  "자동으로 재실행하지 않습니다 — 워크스페이스 탭에서 페인의 [▶ 에이전트 기동]으로 다시 시작하거나, 세션 상세에서 이전 대화를 재개하세요.":
    "Nothing is re-run automatically — open the workspace tab and start again with [▶ Start agent] on the pane, or resume the previous conversation from the session detail.",

  // ── 터미널 페인 (TerminalPane) ──
  "터미널 검색": "Search terminal",
  "이전 일치 (Shift+Enter)": "Previous match (Shift+Enter)",
  "다음 일치 (Enter)": "Next match (Enter)",
  "닫기 (ESC)": "Close (ESC)",
  "▲ 디스크 기록 보기 — 링버퍼 위 기록 (FR-C-13)": "▲ View disk history — lines above the ring buffer (FR-C-13)",
  "트랜스크립트 없음": "no transcript",
  "이전 에이전트 세션 발견 — 재개 대기": "Previous agent session found — awaiting resume",
  "같은 대화를 --resume으로 이어갑니다. 자동 실행하지 않습니다 (C5).":
    "Continues the same conversation via --resume. Nothing auto-runs (C5).",
  "이전 대화를 이어갈 수 없습니다 — 새 대화 또는 셸로 시작하세요.":
    "The previous conversation can't be continued — start a new one or a shell.",
  "▶ 이전 대화 재개": "▶ Resume previous conversation",
  "새 대화 시작": "Start new conversation",
  "셸로 시작": "Start as shell",
  "디스크 스크롤백 · {n}줄 로드됨": "Disk scrollback · {n} lines loaded",
  "▲ 더 이전 200줄": "▲ 200 older lines",
  "디스크에 저장된 확정 줄이 없습니다": "No committed lines stored on disk",
  붙여넣기: "Paste",
  "모두 선택": "Select all",
  검색: "Search",
  "화면 지우기": "Clear screen",
  "이미지 붙여넣기 → 파일 저장 후 경로 삽입": "Paste image → saved to file, path inserted",
};
