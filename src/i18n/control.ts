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
  "클릭하면 줌 토글 · 우클릭 세션 메뉴": "Click to toggle zoom · right-click for session menu",
  "승인 대기 중인 도구 요청 — y/n은 이 페인에 입력": "Tool request awaiting approval — type y/n in this pane",
  "클릭하면 이 페인을 Focus로 잡습니다 — 답은 여기에 직접 입력합니다":
    "Click to grab this pane with Focus — the answer is typed here",
  "Focus — 가장 오래 기다린 페인을 전체 화면으로 잡습니다. 답은 터미널에 직접 입력합니다":
    "Focus — grabs the longest-waiting pane fullscreen. The answer is typed in the terminal",
  "응답 대기": "Awaiting answer",
  "ESC 종료": "ESC to exit",
  "이 자리에서 재개 — --resume · 대화 복원":
    "Resume in place — --resume · restores the conversation",
  "재개 — 대화 복원": "Resume — restore conversation",

  // ── 상태바 ──
  "활성 세션 프로세스 트리 메모리": "Active session process-tree memory",
  "SessionService 이벤트 · 저장 상태": "SessionService events · storage status",
  이벤트: "Events",
  "(실측)": "(live)",
  "(목)": "(mock)",
  "저장 (실측)": "Storage (live)",
  "저장 (목)": "Storage (mock)",
  "100ms 배치 · 30일/1,000줄 보존": "100ms batches · 30-day/1,000-line retention",

  // ── 저장 기록 초기화 (FR-C-52) ──
  "기록 비우기": "Clear history",
  "저장 기록 초기화": "Clear stored history",
  "이 워크스페이스에 저장된 줄과 검색 색인을 비웁니다 — 화면 스크롤백은 그대로":
    "Clears the lines and search index stored for this workspace — on-screen scrollback stays",
  "저장된 스크롤백과 검색 색인을 모두 비우고 WAL을 접습니다. 세션 목록·이벤트·대화·재개 정보와 화면에 떠 있는 스크롤백은 그대로 남습니다. 되돌릴 수 없습니다.":
    "Empties the stored scrollback and its search index, then truncates the WAL. Sessions, events, conversations, resume anchors and the scrollback on screen all stay. This cannot be undone.",
  "비우는 중…": "Clearing…",
  "초기화 실패": "Clear failed",

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
  "삭제는 두지 않는다 — git worktree remove": "No delete here — use git worktree remove",
  "빈 슬롯에 세션 추가 — 클로드코드 · 코덱스 · 기본 터미널":
    "Add a session to an empty slot — Claude Code · Codex · default terminal",
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
  "레일 접기": "Collapse rail",
  "레일 펼치기": "Expand rail",
  "닫기 (ESC)": "Close (ESC)",

  // ── 세션 추가·제거 다이얼로그 ──
  "슬롯 사용 중": "slots in use",
  "역할 없이 즉시 시작 · 언제든 역할 부여 가능": "Starts instantly without a role · assign one anytime",
  "클로드코드 에이전트 열기": "Open Claude Code agent",
  "에이전트 열기": "Open agent",
  엔진: "Engine",
  "페르소나·직무를 정해 바로 기동 · 역할·권한 플래그·훅이 붙은 유일한 경로":
    "Pick a persona and job and launch right away · the only path that carries the role, permission flags and hooks",
  "페르소나·직무를 정해 바로 기동 · 역할·권한 플래그·훅이 붙은 유일한 경로 (Claude Code · Codex)":
    "Pick a persona and job and launch right away · the only path that carries the role, permission flags and hooks (Claude Code · Codex)",
  "PATH에 {cmd}가 없습니다 — 설치 후 설정 > CLI 에이전트에서 다시 확인하세요":
    "{cmd} is not on PATH — install it, then re-check under Settings > CLI agents",
  "{name} 열기": "Open {name}",
  "셸에서 {cmd} 실행 · 역할·훅·재개는 붙지 않고 관제에는 실행 중으로만 보입니다":
    "Runs {cmd} in a shell · no role, hooks or resume attach; control center only shows it running",
  "PATH에 claude가 없습니다 — 설치 후 설정 > CLI 에이전트에서 다시 확인하세요":
    "claude is not on PATH — install it, then re-check under Settings > CLI agents",
  "기본 터미널 열기": "Open default terminal",
  "남은 페르소나가 없습니다": "No personas left",
  "워크트리 격리 — .eqmux/worktrees/<세션> · 전용 브랜치 eqmux/<세션>":
    "Worktree isolation — .eqmux/worktrees/<session> · dedicated branch eqmux/<session>",
  "의존성(node_modules 등)은 워크트리마다 별도입니다. 제거 시 워크트리는 남습니다 — 머지·정리는 사람이 합니다":
    "Dependencies (node_modules etc.) are separate per worktree. The worktree remains on removal — merging and cleanup are up to you",
  "역할 세션 제거": "Remove role session",
  "제거하면 팀 편성의 이 슬롯이 비워지고 임무 배정이 해제되며 PTY 프로세스가 종료됩니다. 변경은 다음 캐스팅 저장 때 .eqmux/team.json에 반영됩니다.":
    "Removing empties this slot in the team composition, unassigns its missions, and terminates the PTY process. The change is written to .eqmux/team.json on the next casting save.",
  "세션 제거": "Remove session",

  // ── 설정 > CLI 에이전트 ──
  "CLI 에이전트": "CLI agents",
  "PATH 실측 — 설치된 것만 세션 추가에서 열 수 있습니다. 감지 목록과 같은 명부라, 열 수 있는 것은 관제에도 잡힙니다.":
    "Measured against PATH — only installed CLIs can be opened from Add session. Same roster as detection, so anything you can open also shows up in the control center.",
  "확인 중…": "Checking…",
  "관리 실행": "Managed launch",
  "역할·권한 플래그·훅·재개가 붙습니다. 세션 추가의 [에이전트 열기]가 이 경로입니다.":
    "Carries the role, permission flags, hooks and resume. [Open agent] in Add session uses this path.",
  "셸 실행": "Shell launch",
  "셸에 명령을 치는 것과 같습니다 — 역할·훅·재개는 붙지 않고 관제에는 실행 중으로만 보입니다.":
    "Same as typing the command in a shell — no role, hooks or resume attach; the control center only shows it running.",
  "미설치": "Not installed",
  "PATH에 없습니다 — 세션 추가에 나오지 않습니다. 설치한 뒤 다시 확인하세요.":
    "Not on PATH — it does not appear in Add session. Install it, then re-check.",
  설치됨: "installed",
  없음: "missing",
  "다시 확인": "Re-check",
  "PATH를 다시 훑습니다": "Scans PATH again",

  // ── TranscriptPane ──
  "목 데이터": "Mock data",
  "cwd 최신 추정": "cwd-latest guess",
  실측: "live",
  "끝 2MB 창": "last-2MB window",
  "건너뜀 {n}줄": "{n} lines skipped",
  "스크롤백 폴백": "Scrollback fallback",
  출처: "Source",
  "출처 {path} — 클릭하면 경로를 복사합니다": "Source {path} — click to copy the path",
  "▸ 사람": "▸ Human",
  "⚙ 도구": "⚙ Tool",
  에이전트: "Agent",
  "참조만 저장 (V2)": "Reference only (V2)",
  "검색": "Search",
  "세션 저장 — 스크롤백 전체(디스크 포함, VT 제거 평문)를 .txt로 내보낸다":
    "Save session — exports the full scrollback (incl. disk, VT-stripped plain text) to .txt",
  "저장 중…": "Saving…",
  "세션 저장": "Save session",
  "트랜스크립트 없음 — 에이전트 로그도 스크롤백도 아직 없습니다": "No transcript — no agent log or scrollback yet",
  "트랜스크립트를 인식할 수 없어 스크롤백으로 표시합니다":
    "Transcript not recognized — showing scrollback instead",
  "트랜스크립트 없음 (목)": "No transcript (mock)",
  // 0.5 시안 Yd4E5 (W1)
  "사람 → {name}": "Human → {name}",
  "턴 검색…": "Search turns…",
  "턴 개요": "Turn outline",
  "1급 소스 · JSONL": "Primary source · JSONL",
  "{name}의 PTY로 입력 전달 (V3)": "Send input to {name}'s PTY (V3)",
  전송: "Send",

  // ── 0.5 W3 · 확인창·페인 헤더·주의 칩·세션 이름 ──
  "{name} 중지": "Stop {name}",
  "이 세션의 프로세스를 끝냅니다. 하던 턴은 멈추고, 대화는 나중에 재개로 이어 갈 수 있습니다.": "This ends the session's process. The current turn stops; you can pick the conversation up later with Resume.",
  "이 세션의 프로세스를 끝냅니다. 하던 턴은 멈추고, 이 세션은 재개할 수 없어 되돌릴 수 없습니다.": "This ends the session's process. The current turn stops, and this session can't be resumed — this can't be undone.",
  "{name} 제거": "Remove {name}",
  "셸 프로세스가 종료되고 이 페인의 화면이 닫힙니다. 되돌릴 수 없습니다.": "The shell process ends and this pane closes. This can't be undone.",
  "메시지 {n}건": "{n} messages",
  "손으로 띄운 에이전트라 자동으로 넣지 않습니다": "Started by hand, so messages aren't typed in automatically",
  "넣기": "Insert",
  "✓ 턴 끝남 · 보고 전": "✓ Turn ended · no report yet",
  "맡은 handoff·ask에 아직 report --done이 없습니다": "No report --done yet for the handoff or ask it received",
  "보고 요청": "Ask for report",
  "이 세션에 결과를 report --done으로 알려 달라는 ask를 보냅니다": "Sends this session an ask to report its result with report --done",
  "맡은 일의 결과를 eqmux report --done 으로 알려 주세요": "Please report the result of your task with eqmux report --done",
  "✓ 완료 보고": "✓ Reported done",
  "✓ 턴 끝남": "✓ Turn ended",
  "나머지 신호 보기": "Show other signals",
  "작업 폴더 열기": "Open working folder",
  "폴더를 열 수 없습니다": "Couldn't open the folder",
  "{engine} 기동": "Start {engine}",
  "다음 미확인으로 (Ctrl+Shift+U) — 누를 때마다 기다리는 페인을 차례로 잡습니다. 답은 터미널에 직접 입력합니다": "Next unseen (Ctrl+Shift+U) — each press moves to the next waiting pane. Answer directly in the terminal",
  "비우면 {auto} · 역할 세션은 페르소나 이름": "Leave empty for {auto} · role sessions use the persona name",
  "{name} 쓰기": "Use {name}",
  "PATH에 {cmd}가 없습니다 — 아래 명령으로 설치한 뒤 다시 감지하세요": "{cmd} isn't on PATH — install it with the command below, then detect again",
  "다시 감지": "Detect again",
  "쌓인 메시지 {n}건": "{n} queued messages",
  "승인 창이 떠 있으면 먼저 답하세요. 넣으면 본문과 Enter가 그 페인에 들어갑니다.": "If an approval prompt is open, answer it first. Inserting types the text and Enter into that pane.",
  "페인에 치던 줄이 있어 넣지 않았습니다 — 줄을 비우고 다시 누르세요": "Not inserted — there's a half-typed line in the pane. Clear it and try again",
  "재개 실패": "Resume failed",
  "24자까지 쓸 수 있습니다": "Up to 24 characters",
  "공백과 @는 쓸 수 없습니다": "Spaces and @ aren't allowed",
  "이 워크스페이스에서 이미 쓰는 이름입니다": "This name is already used in this workspace",

  // ── 0.5 W3 · 상주 상태 줄·새로 시작 ──
  "새로 시작 (요약만 넘김 · 이전 대화는 잇지 않음)": "Start fresh (carry summary only · doesn't continue the old conversation)",
  "{agent} 실행 중 — 손으로 띄워 역할·훅이 붙지 않았습니다": "{agent} running — started by hand, so no role or hooks are attached",
  "에이전트 없음 — 직무 권한을 찾을 수 없어 기동할 수 없습니다. 역할을 다시 지정하세요": "No agent — can't start because the job's permissions weren't found. Reassign the role",
  "에이전트 없음 — PATH에 {cmd}가 없어 기동할 수 없습니다": "No agent — can't start because {cmd} isn't on PATH",
  "에이전트 없음": "No agent",
  "직무 권한을 찾을 수 없습니다 — 역할을 다시 지정하세요": "Job permissions not found — reassign the role",

  // ── 0.5 W3 · 시안 적용 — 관제·확인창·세션 만들기 ──
  "{no} {name} 세션을 중지할까요?": "Stop session {no} {name}?",
  "실행 중인 {engine} 프로세스가 즉시 종료됩니다. 대화 기록과 슬롯은 남고, 이 세션은 재개할 수 있습니다.": "The running {engine} process ends immediately. The conversation and slot stay, and this session can be resumed.",
  "실행 중인 {engine} 프로세스가 즉시 종료됩니다. 대화 기록과 슬롯은 남지만, 이 세션은 재개할 수 없습니다.": "The running {engine} process ends immediately. The conversation and slot stay, but this session can't be resumed.",
  "{no} {name} 역할 세션을 제거할까요?": "Remove role session {no} {name}?",
  "{no} {name} 기본 터미널을 제거할까요?": "Remove default terminal {no} {name}?",
  "셸 프로세스를 끝내고 이 슬롯({no})을 비웁니다. 되돌릴 수 없습니다. 스크롤백은 30일 보존 규칙대로 남습니다.": "Ends the shell process and frees slot {no}. This can't be undone. Scrollback is kept under the 30-day retention rule.",
  "승인 대기 중": "waiting for approval",
  "열린 handoff": "Open handoff",
  "있음 — 중지해도 원장에 남는다": "yes — it stays in the ledger after stopping",
  "종료됨": "Exited",
  "메시지 {n}": "{n} msgs",
  "✓ 보고 전": "✓ No report",
  "슬롯 비우기…": "Clear slot…",
  "중지…": "Stop…",
  "빈 슬롯": "Empty slot",
  "슬롯 {no}에 세션 만들기": "New session in slot {no}",
  "세션 종류": "Session type",
  "비워 두면 {name}": "Empty = {name}",
  "24자 이내 · 공백·@·줄바꿈 불가 · 만들 때 한 번 정해져 폴더 이름이 바뀌어도 그대로": "Up to 24 characters · no spaces, @ or line breaks · set once at creation, kept even if the folder is renamed",
  "{name}에 쌓인 메시지 {n}건": "{n} messages queued for {name}",
  "승인 창이 떠 있으면 먼저 답하세요. 넣기는 본문과 Enter를 그대로 보냅니다.": "If an approval prompt is open, answer it first. Insert types the text and Enter as-is.",
  "{n}건 넣기": "Insert {n}",
  "{name}에게 보고 요청": "Ask {name} for a report",
  "이 메시지가 그 세션에 들어갑니다. 앱이 스스로 보내지 않습니다.": "This message goes into that session. The app never sends it on its own.",

  // ── 0.5 W3 · 시안 적용 — 대시보드 ──
  "열린 워크스페이스 {m} · 주의 정렬: waiting › dead › 확인 필요 › busy › idle": "Open workspaces {m} · attention order: waiting › dead › needs check › busy › idle",
  "{n} 세션": "{n} sessions",
  "전체 세션": "All sessions",
  "행동 필요": "Needs action",
  "확인 필요": "Needs check",
  "행동": "Action",
  "기다리는 에이전트 · 모든 워크스페이스": "Waiting agents · all workspaces",
};
