// 세션 그룹 사전 — SessionDetailPanel · TerminalPane · ExitDialog · CrashRecovery.
// 공용 용어(재개·중지·적용 등)는 common.ts가 정본이라 여기 없다.
export const dict: Record<string, string> = {
  // ── 세션 상세 (SessionDetailPanel) ──
  셸: "Shell",
  "에이전트 미기동": "Agent not started",
  "승인·거부는 터미널 페인에서 수행합니다.": "Approve or deny in the terminal pane.",
  개요: "Overview",
  관측: "Observation",
  "저하 — 레지스트리 접근 불가 · 훅 + 프로세스 생존으로 유지":
    "Degraded — registry unreachable · maintained via hooks + process liveness",
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
  "워크트리 · 전용 브랜치": "Worktree · dedicated branch",
  "워크트리 · 이 머신엔 없음 — repo 루트 폴백":
    "Worktree · not on this machine — falling back to repo root",
  "공유 · repo 루트": "Shared · repo root",
  "이 세션의 OS 알림·사운드 음소거 — 인앱 미확인 점은 유지":
    "Mute OS notifications & sound for this session — the in-app unseen dot remains",
  "🔇 음소거 중 — 해제": "🔇 Muted — unmute",
  "🔇 워크스페이스 음소거 중": "🔇 Workspace muted",
  "🔔 켜짐 — 음소거": "🔔 On — mute",
  "실행 정보": "Execution", // 세션 상세 묶음 — 사이드 패널의 '실행'(Run)과 원문을 가른다 (B80)
  "세션 이름": "Session name",
  "실제 실행 플래그": "Actual runtime flags",
  "예상 실행 플래그": "Expected runtime flags",
  "이 앱이 띄운 기록이 없어 현재 권한으로 계산한 값입니다 — 돌고 있는 프로세스는 다를 수 있습니다.":
    "This app has no spawn record for this session, so the value is computed from current permissions — the running process may differ.",
  "슬롯 권한": "Slot permissions",
  "직무 기본값과 다른 슬롯 오버라이드 — team.json·역할 파일에 영속":
    "Slot override differing from job defaults — persisted to team.json and the role file",
  오버라이드: "Override",
  "오버라이드 해제 — 직무 기본값으로": "Clear override — back to job defaults",
  기본값: "Defaults",
  "직무 기본": "Job defaults",
  "유효 권한이 달라지면 재시작이 필요합니다":
    "If the effective permissions change, a restart is required",
  "권한 변경 감지 · 재시작 필요": "Permission change detected · restart needed",
  "권한 변경 감지 · 다음 기동 때 적용됩니다": "Permission change detected · applies at the next start",
  "재개 기반 재시작 — 대화를 잃지 않는다":
    "Resume-based restart — the conversation is preserved",
  "대화 유지 재시작": "Restart, keep conversation",
  "역할 부여": "Assign role",
  "기본 터미널입니다. 저장된 페르소나를 붙이면 역할 세션이 됩니다 — 직무는 페르소나의 저장 직무를 따릅니다.":
    "This is a default terminal. Attach a saved persona to make it a role session — the job follows the persona's saved job.",
  "페르소나의 저장 직무 (미지정이면 기본값) — 라이브러리의 페르소나 편집에서 바꿉니다":
    "The persona's saved job (default if unset) — change it in the library's persona editor",
  "이미 돌던 셸이라 권한 플래그 적용을 위해 재시작이 필요합니다.":
    "This shell was already running — a restart is needed to apply the permission flags.",
  "역할 변경": "Change role",
  "직무를 바꾸면 실행 권한이 달라져 재시작이 필요합니다.":
    "Changing the job changes runtime permissions, requiring a restart.",
  "역할 해제 — 기본 터미널로 전환": "Detach role — switch to default terminal",
  영속성: "Persistence",
  스크롤백: "Scrollback",
  "세션 로그": "Session log",
  "로그 폴더 열기": "Open log folder",
  "기록 저장": "Save transcript",
  "스크롤백 전체(디스크 포함)를 평문 텍스트로 저장": "Save the full scrollback (including disk) as plain text",
  "저장 중…": "Saving…",
  ".txt로 내보내기…": "Export as .txt…",
  "세션 이벤트": "Session events",
  "페인으로 점프": "Jump to pane",

  // 세션 데이터의 고정 문구 (mock.ts resumeReason) — 렌더 지점 t()가 푼다
  "transcript + cwd 일치": "transcript + cwd match",
  "transcript 없음": "no transcript",
  "일반 셸 · cwd 유지": "plain shell · cwd kept",

  // ── 종료 다이얼로그 (ExitDialog) ──
  "저장소 flush 중…": "Flushing store…",
  "flush가 2초를 넘겼습니다 — 계속 진행합니다": "Flush exceeded 2 seconds — continuing anyway",
  "정상 종료 신호 → 유예 후 프로세스 트리 종료…": "Graceful shutdown signal → grace period, then process tree termination…",
  "EQMUX를 종료할까요?": "Quit EQMUX?",
  "실행 중인 세션 {n}개가 종료됩니다. 자동 재개하지 않습니다.":
    "{n} running session(s) will be terminated. They will not auto-resume.",
  "입력 차단 → 저장소 flush → 정상 종료 신호 → 유예 후 트리 종료 (Job Object)":
    "Block input → flush store → graceful shutdown signal → grace period, then tree termination (Job Object)",
  "실행 중인 세션이 없습니다 — 바로 종료합니다.": "No sessions running — quitting immediately.",
  "실행 중 {n} — 에이전트 {a} · 기본 터미널 {d} · 서버 {s}. 자동 재개하지 않습니다.":
    "{n} running — {a} agent(s) · {d} default terminal(s) · {s} server(s). Nothing auto-resumes.",
  "승인 대기 — 종료하면 거부로 끝남": "awaiting approval — quitting denies it",
  "모두 종료": "Quit all",
  "종료 중…": "Quitting…",
  종료: "Exit",

  // ── 비정상 종료 복구 (CrashRecovery) ──
  "{m}분 전": "{m} min ago",
  "{h}시간 전": "{h}h ago",
  "{d}일 전": "{d}d ago",
  "직전 실행이 정상 종료되지 않았습니다": "The previous run did not shut down cleanly",
  "종료 시퀀스를 거치지 못한 채 끝났습니다. 그때 실행 중이던 세션과 마지막 활동 시각입니다.":
    "It ended without completing the shutdown sequence. These are the sessions running at the time and their last activity.",
  "자동으로 재실행하지 않습니다 — 역할 세션은 페인 위 상태 줄의 [▶ 기동]으로, 이전 대화는 세션 상세의 [▶ 이전 대화 재개]로 다시 시작합니다. 기본 터미널은 셸이 다시 열립니다.":
    "Nothing is re-run automatically — start a role session again with [▶ Start] on the status line above its pane, or continue the previous conversation with [▶ Resume previous conversation] in the session detail. Default terminals reopen as a shell.",

  // ── 터미널 페인 (TerminalPane) ──
  "터미널 검색": "Search terminal",
  "이전 일치 (Shift+Enter)": "Previous match (Shift+Enter)",
  "다음 일치 (Enter)": "Next match (Enter)",
  "닫기 (ESC)": "Close (ESC)",
  "▲ 디스크 기록 보기 — 링버퍼 위 기록": "▲ View disk history — lines above the ring buffer",
  "트랜스크립트 없음": "no transcript",
  "이전 에이전트 세션 발견 — 재개 대기": "Previous agent session found — awaiting resume",
  "같은 대화를 --resume으로 이어갑니다. 자동 실행하지 않습니다.":
    "Continues the same conversation via --resume. Nothing auto-runs.",
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
  "스크롤백까지 지우기": "Clear including scrollback",
  "스크롤백까지 지우기 — 에이전트 화면(TUI)에서는 불가":
    "Clear including scrollback — unavailable on an agent (TUI) screen",
  "{n}줄을 붙여넣어 실행합니다": "Pasting {n} lines — they will run",
  "직무 권한을 찾을 수 없습니다 — 역할을 다시 지정하세요":
    "No job permissions found — assign the role again",
  "이미지 붙여넣기 → 파일 저장 후 경로 삽입": "Paste image → saved to file, path inserted",
  "탐색기에서 열기": "Reveal in File Explorer",
  더블클릭: "Double-click",
  "탐색기에서 열 수 없습니다 — 실재하는 경로가 아닙니다": "Can't open File Explorer — no such path",
  "경로 더블클릭 → 탐색기에서 열기 (실재하는 경로만)":
    "Double-click a path → reveal in File Explorer (existing paths only)",

  // ── 0.5 W3 · 직함 덮어쓰기·엔진 ──
  "직함": "Title",
  "페르소나 직함: {title}": "Persona title: {title}",
  "직함 없음": "No title",
  "페르소나 직함으로": "Use persona title",
  "직무나 엔진을 바꾸면 실행 권한이 달라져 재시작이 필요합니다.": "Changing the job or engine changes the run flags, so a restart is needed.",

  // ── 0.5 W3 · 새로 시작 ──
  "새로 시작 (요약 이월)": "Start fresh (carry summary)",
  "이전 대화는 잇지 않습니다 — 마지막 요약만 시작 안내문에 붙여 새 대화를 엽니다. 사람이 치기 전에는 아무것도 실행하지 않습니다": "Doesn't continue the old conversation — opens a new one with only the last summary attached to the start note. Nothing runs until you type",

  // ── 0.5 W3 · 시안 적용 — 세션 상세 ──
  "기동됨": "running",
  "직함 (이 워크스페이스만)": "Title (this workspace only)",
  "비어 있으면 페르소나 직함을 물려받는다 · 덮어쓰면 team.json 슬롯 title에만 남는다": "Empty inherits the persona title · an override is kept only in the team.json slot title",
  "비우면 페르소나 이름({name})으로 돌아간다 · 공백·@·줄바꿈 불가 · claude --name과 @멘션에 쓴다": "Empty returns to the persona name ({name}) · no spaces, @ or line breaks · used for claude --name and @mentions",
  "비우면 자동 이름({name})으로 돌아간다 · 공백·@·줄바꿈 불가 · @멘션에 쓴다": "Empty returns to the automatic name ({name}) · no spaces, @ or line breaks · used for @mentions",
  "권한·엔진 변경 감지 · 다음 기동 때 적용됩니다": "Permission or engine change detected · applies at next start",
  "권한·엔진 변경 감지 · 재시작 필요": "Permission or engine change detected · restart needed",
  "새로 시작": "Start fresh",
  // ── 0.5.x QA eqmux-08 ──
  "슬롯 엔진 {cli} — 재시작 때 적용": "slot engine {cli} — applies on restart",
  "엔진 사이에는 대화를 이을 수 없습니다 — 새 엔진으로 새 대화를 시작합니다": "A conversation can't carry over between engines — starts a new conversation on the new engine",
  "새 엔진으로 새로 시작": "Start fresh on new engine",

  // ── 0.5.x QA eqmux-8a · 종료·복구 (B109 · B110 · U63 · U64) ──
  "셸만 복원": "shell only",
  "세션으로 가기": "Go to session",
  "알 수 없는 워크스페이스": "Unknown workspace",
  "종료하지 못했습니다 — 다시 시도하세요": "Couldn't quit — try again",
  "입력 차단 → 저장소 flush → 정상 종료 신호 → 유예 후 하위 프로세스까지 정리":
    "Block input → flush store → graceful shutdown signal → grace period, then clean up child processes too",
  "작업 중": "Working",
  대기: "Idle",
  "기동 중": "Starting",
};
