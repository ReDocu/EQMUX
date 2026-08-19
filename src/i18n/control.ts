// 컨트롤 센터 사전 (ControlCenter.tsx · TranscriptPane.tsx)
// 공용 용어(세션·워크트리·재개 등)는 common.ts가 정본 — 여기는 이 화면 고유 문구만 담는다.
export const dict: Record<string, string> = {
  // ── ControlCenter — 헬퍼·에러 ──
  셸: "Shell",
  "브라우저 dev — 실제 생성 없음": "Browser dev — nothing actually created",
  "브랜치 부여 실패": "Branch assignment failed",

  // ── 세션 메뉴 ──
  "브랜치 부여": "Assign branch",
  "로컬 브랜치 없음": "No local branches",
  "브라우저 dev — 실측 없음": "Browser dev — no live data",
  "새 워크트리": "new worktree",
  "세션 상세": "Session details",
  "트랜스크립트 열기": "Open transcript",
  "역할 세션 제거…": "Remove role session…",
  "터미널 제거": "Remove terminal",
  "페인으로 점프": "Jump to pane",

  // ── 페인 그리드 ──
  "클릭하면 줌 토글 (B1) · 우클릭 세션 메뉴": "Click to toggle zoom (B1) · right-click for session menu",
  "승인 대기 중인 도구 요청 — y/n은 이 페인에 입력": "Tool request awaiting approval — type y/n in this pane",
  "클릭하면 이 페인을 Focus로 잡습니다 — 답은 여기에 직접 입력합니다":
    "Click to grab this pane with Focus — the answer is typed here",
  "Focus — 가장 오래 기다린 페인을 전체 화면으로 잡습니다. 답은 터미널에 직접 입력합니다":
    "Focus — grabs the longest-waiting pane fullscreen. The answer is typed in the terminal",
  "응답 대기": "Awaiting answer",
  "ESC 종료": "ESC to exit",
  "이 자리에서 재개 — --resume · 대화 복원 (FR-D-21)":
    "Resume in place — --resume · restores the conversation (FR-D-21)",
  "재개 — 대화 복원": "Resume — restore conversation",

  // ── 상태바 ──
  "활성 세션 프로세스 트리 메모리": "Active session process-tree memory",
  "SessionService 이벤트 · 저장 상태": "SessionService events · storage status",
  이벤트: "Events",
  "(실측)": "(live)",
  "(목)": "(mock)",
  "저장 (실측)": "Storage (live)",
  "저장 (목)": "Storage (mock)",
  "100ms 배치 · 30일/10만줄 보존": "100ms batches · 30-day/100K-line retention",

  // ── 상단 바 ──
  트랜스크립트: "Transcript",
  "새 터미널 셸 선택": "Choose shell for new terminals",
  "새로 추가하는 터미널부터 적용됩니다": "Applies to newly added terminals",
  "그리드로 복귀": "Back to grid",
  "페인 배치 (srpYm)": "Pane layout (srpYm)",
  "페인 배치": "Pane layout",
  "터미널 전체 화면 — ESC로 종료": "Terminal fullscreen — ESC to exit",
  "임무 · 캐스팅 · 팀 편성": "Missions · casting · team composition",
  팀: "Team",
  "임무 배정…": "Assign missions…",
  "팀 캐스팅…": "Team casting…",
  "팀 편성…": "Team composition…",
  "전체 화면 종료": "Exit fullscreen",

  // ── 워크트리 레일 ──
  외부: "external",
  "이 워크트리에서 셸 열기": "Open a shell in this worktree",
  "세션 슬롯이 가득 찼습니다 — 하나를 제거하거나 설정에서 슬롯 수를 늘리세요":
    "All session slots are in use — remove one or raise the slot count in settings",
  "동시에 열 수 있는 워크스페이스는 {n}개입니다 — 하나를 닫고 다시 시도하세요":
    "You can keep {n} workspaces open at once — close one and try again",
  "선택 터미널에 브랜치 부여": "Assign branch to selected terminal",
  "경로 복사": "Copy path",
  "삭제는 두지 않는다 — git worktree remove (FR-E-64)": "No delete here — use git worktree remove (FR-E-64)",
  "빈 슬롯에 세션 추가 — 기본 터미널 또는 역할 세션": "Add a session to an empty slot — default terminal or role session",
  // ── 에이전트 기동 ──
  "에이전트 기동": "Start agent",
  "이 셸을 끝내고 역할·권한·훅이 붙은 에이전트로 다시 엽니다":
    "Ends this shell and reopens it as an agent wired with its role, permissions, and hooks",
  // ── 종료된 슬롯 화면 ──
  "프로세스 종료": "Process ended",
  "이 슬롯을 비우고 새 세션을 추가합니다": "Frees this slot and adds a new session",
  "트랜스크립트 없음": "no transcript",
  "남긴 출력 보기": "View what it left behind",
  "로컬 폴더": "Local folder",
  "앱 내 파일 탐색기에서 열기": "Open in the in-app file explorer",
  "워크트리 생성 — 새 브랜치(eqmux/<이름>) 또는 기존 브랜치 연결":
    "Create worktree — new branch (eqmux/<name>) or attach an existing branch",
  "새 브랜치": "New branch",
  "기존 브랜치": "Existing branch",
  "이 브랜치를 체크아웃하는 워크트리를 만든다 — 새 브랜치 없음":
    "Creates a worktree that checks out this branch — no new branch",
  "연결 가능한 로컬 브랜치 없음": "No attachable local branches",
  "체크아웃 중인 브랜치는 목록에서 빠집니다 — 같은 브랜치는 한 트리에만 (git)":
    "Checked-out branches are excluded — one tree per branch (git)",
  "이름 → .eqmux/worktrees/<이름>": "name → .eqmux/worktrees/<name>",
  "분기 기준 ref (start-from)": "Base ref (start-from)",
  "HEAD (현재)": "HEAD (current)",
  "생성 후 이 트리에서 셸 열기": "Open a shell in this tree after creating",
  "연결 중…": "Attaching…",
  "생성 중…": "Creating…",
  연결: "Attach",
  생성: "Create",
  "메인 작업 트리": "Main working tree",
  "앱이 만든 워크트리 (.eqmux/worktrees/)": "Worktree created by the app (.eqmux/worktrees/)",
  "외부에서 만든 워크트리 — 순수 git 호환": "Externally created worktree — plain git compatible",
  "이 워크트리에서 기본 터미널 열기 — 역할 부여는 세션 상세에서":
    "Open a default terminal in this worktree — assign roles from session details",
  "실측 대기 — git 저장소가 아니면 비어 있습니다": "Awaiting live data — empty unless this is a git repository",
  "워크트리 없음": "No worktrees",
  "닫기 (ESC)": "Close (ESC)",

  // ── 세션 추가·제거 다이얼로그 ──
  "슬롯 사용 중": "slots in use",
  "역할 없이 즉시 시작 · 언제든 역할 부여 가능": "Starts instantly without a role · assign one anytime",
  "페르소나·직무를 정해 시작 · 권한 플래그는 스폰 시점에 적용":
    "Start with a persona and job · permission flags apply at spawn",
  "남은 페르소나가 없습니다": "No personas left",
  "워크트리 격리 — .eqmux/worktrees/<세션> · 전용 브랜치 eqmux/<세션>":
    "Worktree isolation — .eqmux/worktrees/<session> · dedicated branch eqmux/<session>",
  "의존성(node_modules 등)은 워크트리마다 별도입니다. 제거 시 워크트리는 남습니다 — 머지·정리는 사람이 합니다 (FR-E-64)":
    "Dependencies (node_modules etc.) are separate per worktree. The worktree remains on removal — merging and cleanup are up to you (FR-E-64)",
  "역할 세션 제거": "Remove role session",
  "제거하면 팀 편성의 이 슬롯이 비워지고 임무 배정이 해제되며 PTY 프로세스가 종료됩니다. 변경은 다음 캐스팅 저장 때 .eqmux/team.json에 반영됩니다.":
    "Removing empties this slot in the team composition, unassigns its missions, and terminates the PTY process. The change is written to .eqmux/team.json on the next casting save.",
  "세션 제거": "Remove session",

  // ── TranscriptPane ──
  "목 데이터": "Mock data",
  "cwd 최신 추정": "cwd-latest guess",
  실측: "live",
  "끝 2MB 창": "last-2MB window",
  "건너뜀 {n}줄": "{n} lines skipped",
  "스크롤백 폴백 (FR-G-86)": "Scrollback fallback (FR-G-86)",
  출처: "Source",
  "출처 {path} — 클릭하면 경로를 복사합니다": "Source {path} — click to copy the path",
  "▸ 사람": "▸ Human",
  "⚙ 도구": "⚙ Tool",
  에이전트: "Agent",
  "참조만 저장 (V2)": "Reference only (V2)",
  "검색 (FR-G-87)": "Search (FR-G-87)",
  "세션 저장 — 스크롤백 전체(디스크 포함, VT 제거 평문)를 .txt로 내보낸다":
    "Save session — exports the full scrollback (incl. disk, VT-stripped plain text) to .txt",
  "저장 중…": "Saving…",
  "세션 저장": "Save session",
  "트랜스크립트 없음 — 에이전트 로그도 스크롤백도 아직 없습니다": "No transcript — no agent log or scrollback yet",
  "트랜스크립트를 인식할 수 없어 스크롤백으로 표시합니다 (FR-G-86)":
    "Transcript not recognized — showing scrollback instead (FR-G-86)",
  "트랜스크립트 없음 (목)": "No transcript (mock)",
  "{name}의 PTY로 입력 전달 (V3)": "Send input to {name}'s PTY (V3)",
  전송: "Send",
};
