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
  "패널 닫기": "Close panel",
  "서버 셸": "Server shell",
  "셸만 열려 있습니다": "Only the shell is open",

  // ── 사이드 패널 0.5 시안 — 실행·코드·로그·브라우저 ──
  "실측 {n} · 새 {m}": "Live {n} · new {m}",
  "목 {n} · 새 {m}": "Mock {n} · new {m}",
  "열린 포트 · 이 워크스페이스의 프로세스": "Open ports · processes in this workspace",
  "다시 실측": "Re-scan",
  "브라우저로 열기": "Open in browser",
  "포트 {n} · 새 {m}": "Ports {n} · new {m}",
  "마지막 서버 명령 없음 — 이 셸에서 포트를 연 명령을 기억합니다":
    "No server command yet — the command that opens a port in this shell is remembered",
  변경: "Changed",
  내보내기: "Export",
  외부로: "External",

  // ── WorkspaceConnection 0.5 시안 (EYy9T) ──
  "워크스페이스 열기 · 관리": "Open · manage workspaces",
  "탭 줄의 + 로 연다 · 열려 있지 않은 워크스페이스가 위":
    "Opened from + in the tab bar · workspaces not open are listed first",
  "폴더 찾기…": "Browse folder…",
  "클론…": "Clone…",
  "열려 있지 않음": "Not open",
  "{branch} · {n} 세션": "{branch} · {n} sessions",
  "{branch} · {n} 세션 저장됨": "{branch} · {n} sessions saved",
  "경로 재지정": "Relocate path",
  '등록된 저장소가 없습니다. "폴더 찾기…"로 시작하세요.': 'No repositories registered. Start with "Browse folder…".',
  "원격 (origin)": "Remote (origin)",
  "저장된 세션": "Saved sessions",
  "{n} · 재개 가능 {m}": "{n} · {m} resumable",
  "등록 해제…": "Unregister…",
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
  "↻ 셸 다시 열기": "↻ Reopen shell",
  "dev 서버도 종료됩니다": "The dev server stops too",
  "셸에 마지막 서버 명령을 입력합니다": "Types the last server command into the shell",

  // ── TeamComposition (0.5 — 가짜 동작 제거) ──
  "자동 저장됨": "Saved automatically",
  "관제 화면으로": "Go to control",
  "편성은 바뀔 때마다 .eqmux/team.json · team.md에 저장됩니다": "The lineup is saved to .eqmux/team.json · team.md on every change",
  "기본 편성 채우기 ({name} 프리셋)": "Fill default lineup ({name} preset)",
  "팀 관계 표 (team.md 그대로)": "Team relations (same as team.md)",
  권한: "Permissions",
  "기본 터미널 이름은 team.json이 아니라 이 기기의 앱 데이터에 남습니다 (커밋 대상 아님)":
    "Default terminal names live in this device's app data, not team.json (not committed)",
  "주고받은 메시지 없음": "No messages exchanged",
  "프리셋 · 라이브러리 실데이터": "Presets · from the library",
  "슬롯 {n}": "{n} slots",
  "team.json에서 파생": "Derived from team.json",
  "세션마다 합성": "Composed per session",

  // ── DefaultTerminalSetup (0.5 — 실제 값) ──
  "역할 세션은 팀 캐스팅에서": "Role sessions are set up in team casting",
  "작업 폴더": "Working folder",
  "서버를 다시 실행하지 못했습니다 — {err}": "Could not restart the server — {err}",
  "기본 셸은 설정의 '기본 셸' 값입니다. 열기 전에는 아무것도 실행하지 않습니다.":
    "The shell is the Default shell from Settings. Nothing runs before you open it.",
  로그: "Logs",
  브라우저: "Browser",
  "패널을 왼쪽으로": "Move panel to the left",
  "패널을 오른쪽으로": "Move panel to the right",

  // ── ScreenOverlay ──
  "ESC 닫기": "ESC to close",

  // ── LayoutPicker ──
  "페인 배치": "Pane layout",
  "현재 워크스페이스 · {n}개 세션 · 선택 즉시 미리보기": "Current workspace · {n} sessions · previews on select",
  현재: "Current",
  "적용 후 분할선을 드래그해 비율을 조정할 수 있습니다 · 슬롯 번호는 배치와 무관하게 그대로입니다":
    "After applying, drag the dividers to adjust ratios · slot numbers stay the same in every layout",

  // ── DefaultTerminalSetup ──
  "기본 터미널 구성": "Default terminal setup",
  "역할 팀 구성": "Role team setup",
  "실제 기본 셸과 브랜치를 보입니다 · 열기 전에는 아무것도 실행하지 않습니다":
    "Shows the real default shell and branch · nothing runs before you open it",
  "실행 방식": "Launch mode",
  "이 슬롯은 비워 둡니다": "This slot stays empty",

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

  // 0.5.x QA eqmux-18 — 레이어 · 벨 · 패널 토글 · 서버 탭
  "저장하지 않은 편집이 있어 팝업을 닫지 않았습니다 — 저장하거나 편집을 취소하세요":
    "Didn't close — there are unsaved edits. Save or discard them first",
  "응답이 필요한 {n}건은 남습니다": "{n} needing a response remain",
  "확인 표시 지우기": "Clear seen marks",
  "완료 보고·턴 완료·본 적 없는 종료 표시만 지웁니다 — 응답 대기·메시지 대기·보고 전은 남습니다":
    "Clears only report/turn-done and unseen-exit marks — waiting, queued messages and pending reports stay",
  "지금 봐야 할 세션": "Sessions to look at now",
  "사이드 패널": "Side panel",
  패널: "Panel",
  "사이드 패널 토글 — 마지막 탭으로 엽니다 · Ctrl+Shift+B": "Toggle side panel — opens the last tab · Ctrl+Shift+B",
  "이 셸의 서버가 포트를 열고 있습니다 — 멈춘 뒤 다시 실행할 수 있습니다":
    "This shell's server has a port open — stop it before running again",
  "돌고 있음 · 포트 {ports}": "Running · port {ports}",
};
