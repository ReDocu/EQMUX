// 앱 셸 사전 — App · AppBar · SidePanel · ScreenOverlay · Dashboard · LayoutPicker ·
// DefaultTerminalSetup · WorkspaceConnection. 공용 용어는 common.ts가 정본이라 여기 없다.
export const dict: Record<string, string> = {
  // ── App / AppBar ──
  "임무 · 파일 탐색기": "Missions · File explorer",
  "워크스페이스 연결": "Workspace connection",
  "역할 라이브러리": "Role Library",
  "워크스페이스 닫기 (세션은 백그라운드 유지)": "Close workspace (sessions stay in the background)",
  "대화 패널 토글 — 전체 화면에서도 열립니다": "Toggle conversation panel — opens even in fullscreen",
  "임무 배정 — 전체 화면 팝업 (헤더에서 파일 탐색기로 전환)":
    "Mission assignment — fullscreen popup (switch to the file explorer in the header)",
  "워크스페이스 연결 — 전체 화면 팝업": "Workspace connection — fullscreen popup",
  "역할 라이브러리 — 전체 화면 팝업": "Role library — fullscreen popup",
  "설정 — 전체 화면 팝업": "Settings — fullscreen popup",
  종료: "Exit",

  // ── AppBar 0.5 — 탭 메뉴 · 벨 ──
  "워크스페이스 열기·관리": "Open or manage workspaces",
  "워크스페이스 메뉴": "Workspace menu",
  폴더: "Folder",
  "경로를 찾을 수 없음": "Path not found",
  "원격 저장소 열기": "Open remote repository",
  "워크스페이스 관리…": "Manage workspaces…",
  "알림 음소거": "Mute notifications",
  "다른 프로젝트 메시지 받기": "Receive messages from other projects",
  "닫기 (세션은 유지)": "Close (sessions keep running)",
  "폴더를 열 수 없습니다 — 경로가 없어졌습니다": "Cannot open the folder — the path no longer exists",
  "받기 설정을 바꾸지 못했습니다 — {err}": "Could not change the receive setting — {err}",
  "알림 센터": "Notification center",
  "알림 센터 · 미확인 {n}": "Notification center · {n} unseen",
  "알림 · 미확인 {n}": "Notifications · {n} unseen",
  "알림 설정": "Notification settings",
  "다음 미확인으로 · Ctrl+Shift+U": "Next unseen · Ctrl+Shift+U",
  "알림이 없습니다": "No notifications",
  "최근 50건 · 앱을 다시 켜면 비웁니다 · 음소거는 소리·OS 알림만 끕니다":
    "Last 50 · cleared on restart · mute silences sound and OS alerts only",

  // ── SidePanel ──
  코드: "Code",
  실행: "Run",
  문서: "Docs",
  "포트 · {n}": "Ports · {n}",
  "포트를 처음 읽는 중…": "Reading ports for the first time…",
  "이 프로젝트 전체": "Everyone in this project",
  "받는 사람": "Recipient",
  "세션 {n} 실행 중": "{n} sessions running",
  "탭이 묶였습니다 — 대화 [대화 | 로그] · 코드 [git | 문서] · 실행 [서버 | 포트] · 브라우저":
    "Tabs are grouped — Conversation [Conversation | Logs] · Code [git | Docs] · Run [Server | Ports] · Browser",
  포트: "Ports",
  서버: "Server",
  "종료됨 (exit {code})": "Exited (exit {code})",
  "↻ 다시 실행": "↻ Run again",
  "dev 서버도 종료됩니다": "The dev server stops too",
  "셸에 마지막 서버 명령을 입력합니다 — 이미 서버가 돌고 있으면 누르지 마세요":
    "Types the last server command into the shell — don't press it while the server is already running",

  // ── TeamComposition (0.5 — 가짜 동작 제거) ──
  "자동 저장됨": "Saved automatically",
  "관제 화면으로": "Go to control",

  // ── DefaultTerminalSetup (0.5 — 실제 값) ──
  "역할 세션은 팀 캐스팅에서": "Role sessions are set up in team casting",
  "작업 폴더": "Working folder",
  "서버를 다시 실행하지 못했습니다 — {err}": "Could not restart the server — {err}",
  "기본 셸은 설정의 '기본 셸' 값입니다. 열기 전에는 아무것도 실행하지 않습니다.":
    "The shell is the Default shell from Settings. Nothing runs before you open it.",
  "파일이 원본 · 바뀔 때마다 자동 저장 · team.json/team.md는 커밋": "Files are the source · saved on every change · commit team.json/team.md",
  로그: "Logs",
  브라우저: "Browser",
  "패널을 왼쪽으로": "Move panel to the left",
  "패널을 오른쪽으로": "Move panel to the right",

  // ── ScreenOverlay ──
  "ESC 닫기": "ESC to close",

  // ── LayoutPicker ──
  "페인 배치": "Pane layout",
  "현재 워크스페이스 · {n}개 세션 · 선택 즉시 미리보기": "Current workspace · {n} sessions · previews on select",
  선택됨: "Selected",
  "적용 후 분할선을 드래그해 비율을 조정할 수 있습니다.": "After applying, drag the dividers to adjust ratios.",
  "배치 적용": "Apply layout",

  // ── DefaultTerminalSetup ──
  "기본 터미널 구성": "Default terminal setup",
  "역할 없는 셸 세션 설정": "roleless shell session setup",
  "터미널 열기": "Open terminal",
  "역할 팀 구성": "Role team setup",
  "변경하면 실행 방식 선택 단계로 돌아갑니다.": "Changing this returns to the launch-mode step.",
  "역할 없이, 바로 터미널": "No roles — straight to the terminal",
  "팀·역할·임무를 지정하지 않은 일반 셸 세션입니다. 현재 저장소를 그대로 열고 필요할 때 역할 세션으로 전환할 수 있습니다.":
    "A plain shell session with no team, role, or mission. Opens the current repo as-is; switch to role sessions whenever needed.",
  "✓ 추가 설정 없이 즉시 시작": "✓ Starts instantly, no extra setup",
  "✓ 워크스페이스당 최대 {n}개 세션": "✓ Up to {n} sessions per workspace",
  "✓ 언제든 역할 · 임무 세션으로 전환": "✓ Switch to role/mission sessions anytime",
  "스크롤백과 세션 상태는 기존 WAL 정책으로 보존됩니다.": "Scrollback and session state are preserved under the existing WAL policy.",
  "01 · 기본": "01 · default", // 슬롯 라벨 — 페르소나 단계 "기본"(Basic, roles.ts)과 키를 분리한다
  "기본 터미널 구성을 저장하시겠습니까?": "Save this default terminal setup?",
  "팀 역할은 비워 두고 현재 저장소와 셸 설정만 워크스페이스에 기록합니다.":
    "Team roles stay empty; only the current repo and shell settings are recorded to the workspace.",
  "저장 후 열기": "Save and open",

  // ── WorkspaceConnection ──
  "clone 실패": "clone failed",
  "git repo 1개 = 팀 1개 = 탭 1개 · 등록 무제한 · 동시 오픈 10개":
    "1 git repo = 1 team = 1 tab · unlimited registrations · 10 open at once",
  "원격에서 Clone": "Clone from remote",
  "+ 로컬 저장소 연결": "+ Connect local repository",
  "등록된 저장소": "Registered repositories",
  "· 목": "· mock",
  "{n} 등록 · {m} 열림": "{n} registered · {m} open",
  재지정: "Re-path",
  열림: "Open",
  '등록된 저장소가 없습니다. "+ 로컬 저장소 연결"로 시작하세요.':
    'No repositories registered. Start with "+ Connect local repository".',
  "저장소를 선택하세요": "Select a repository",
  원격: "Remote",
  "팀 편성": "Team composition",
  "마지막 사용": "Last used",
  "파일이 원본입니다": "Files are the source of truth",
  ".eqmux/team.json · team.md를 로드하고 역할 파일을 실측합니다. DB는 캐시이며 불일치 시 파일이 이깁니다.":
    "Loads .eqmux/team.json · team.md and reads role files from disk. The DB is a cache; when they disagree, files win.",
  "경로 재지정 필요": "Path re-assignment needed",
  "{name} 열기": "Open {name}",
  "레지스트리에서만 제거 — 디스크의 저장소는 그대로 · 실행 중 세션은 종료됩니다":
    "Removes from the registry only — the repo on disk stays, but running sessions are terminated",
  "등록 해제 (디스크는 그대로 · 세션 종료)": "Unregister (disk untouched · sessions end)",
  "등록을 해제할까요?": "Unregister this workspace?",
  "실행 중인 세션 {n}개가 지금 종료됩니다 — 재등록해도 돌아오지 않습니다.":
    "{n} running session(s) will be terminated now — re-registering will not bring them back.",
  "디스크의 저장소와 .eqmux 파일은 그대로 남습니다.": "The repo on disk and its .eqmux files are left untouched.",
  "세션 종료 후 등록 해제": "Terminate sessions & unregister",
  "git 저장소가 아닙니다": "Not a git repository",
  "이 폴더에서 `git init`을 실행해 저장소로 만든 뒤 등록할까요? 기존 파일은 변경되지 않습니다.":
    "Run `git init` here to turn this folder into a repository, then register it? Existing files are not changed.",
  "git init 후 등록": "git init, then register",
  "URL 입력 → 부모 폴더 선택 → clone 후 자동 등록": "Enter URL → choose parent folder → auto-register after clone",
  "clone 중…": "cloning…",
  "폴더 선택 후 Clone": "Choose folder & clone",

  // ── Dashboard ──
  셸: "Shell",
  앱: "app",
  "관제 대시보드": "Control dashboard",
  "등록 {n} · 열림 {m} · 정렬: 주의 필요 순": "Registered {n} · Open {m} · sorted by attention",
  "폴링 없음 · 상태 스트림 구독": "No polling · subscribed to the status stream",
  "⚠ 동시 작업 중 에이전트 {n}개 — 소프트 경고 (임계값 {limit}, 실측 전 잠정). 시스템이 느려지면 일부 세션을 중지하세요.":
    "⚠ {n} agents busy at once — soft warning (threshold {limit}, provisional). Stop some sessions if the system slows down.",
  "세션 메모리 임계 초과": "Session memory over threshold",
  임계: "threshold",
  "소프트 경고": "soft warning",
  "세션 상세에서 현재·피크를 확인하세요.": "Check current/peak in session details.",
  "클릭하면 해당 페인으로 점프 · 우클릭 메뉴": "Click to jump to that pane · right-click for menu",
  "미확인 — 열람하면 해제": "Unseen — cleared when viewed",
  "터미널에서 실행 중인 에이전트 CLI — 프로세스 트리 실측": "Agent CLI running in the terminal — read from the process tree",
  "팀 캐스팅으로 이동": "Go to team casting",
  "+ 빈 슬롯 {n} · 캐스팅": "+ {n} empty slots · casting",
  "열린 워크스페이스가 없습니다 — 상단 + 또는 워크스페이스 연결에서 git 저장소를 열어주세요":
    "No open workspaces — open a git repository via the + above or Workspace connection",
  닫힘: "Closed",
  "경로 소실": "Path missing",
  "워크스페이스 연결에서 경로 재지정": "Re-assign the path in Workspace connection",
  "주의 & 이벤트 · 전역": "Attention & events · global",
  "모든 세션의 미확인 해제": "Clear unseen on all sessions",
  "모두 확인": "Mark all seen",
  "아직 이벤트가 없습니다": "No events yet",
  미배정: "Unassigned",
  "페인으로 이동": "Go to pane",
  "대화 패널 열기": "Open conversation panel",
  "임무 배정…": "Assign missions…",
  "팀 편성…": "Team composition…",
  "승인·거부는 터미널 페인에서": "Approve/deny in the terminal pane",
};
