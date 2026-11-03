// 앱 셸 사전 — App · AppBar · SidePanel · ScreenOverlay · Dashboard · LayoutPicker ·
// DefaultTerminalSetup · WorkspaceConnection. 공용 용어는 common.ts가 정본이라 여기 없다.
export const dict: Record<string, string> = {
  // ── App / AppBar ──
  "임무 · 파일 탐색기": "Missions · File explorer",
  "워크스페이스 연결": "Workspace connection",
  "역할 라이브러리": "Role Library",
  "워크스페이스 닫기 (세션은 백그라운드 유지)": "Close workspace (sessions stay in the background)",
  "임무 배정 — 전체 화면 팝업": "Mission assignment — fullscreen popup",
  "기록": "History",
  "워크스페이스 연결 — 전체 화면 팝업": "Workspace connection — fullscreen popup",
  "역할 라이브러리 — 전체 화면 팝업": "Role library — fullscreen popup",
  "설정 — 전체 화면 팝업": "Settings — fullscreen popup",
  종료: "Exit",

  // ── AppBar 0.5 — 탭 메뉴 · 벨 ──
  "워크스페이스 열기·관리": "Open or manage workspaces",
  "워크스페이스 메뉴": "Workspace menu",
  "이전 탭": "Previous tabs",
  "다음 탭": "Next tabs",
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
  "워크스페이스 연결 · 관리": "Connect · manage workspaces",
  "탭 줄의 + 로 연다 · 열려 있지 않은 워크스페이스가 위":
    "Opened from + in the tab bar · workspaces not open are listed first",
  "폴더 찾기…": "Browse folder…",
  "클론…": "Clone…",
  "열려 있지 않음": "Not open",
  "{branch} · {n} 세션": "{branch} · {n} sessions",
  "{branch} · {n} 세션 저장됨": "{branch} · {n} sessions saved",
  "경로 재지정": "Relocate path",
  '등록된 워크스페이스가 없습니다. "폴더 찾기…"로 시작하세요.': 'No workspaces registered. Start with "Browse folder…".',
  "원격 (origin)": "Remote (origin)",
  "저장된 세션": "Saved sessions",
  "{n} · 재개 가능 {m}": "{n} · {m} resumable",
  "등록 해제…": "Unregister…",
  폴더: "Folder",
  "경로를 찾을 수 없음": "Path not found",
  "원격 저장소 열기": "Open remote repository",
  "워크스페이스 관리…": "Manage workspaces…",
  "알림 음소거": "Mute notifications",
  "다른 워크스페이스 메시지 받기": "Receive messages from other workspaces",
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
  포트: "Ports",
  서버: "Server",
  "종료됨 (exit {code})": "Exited (exit {code})",
  "dev 서버를 띄울 셸이 아직 없습니다": "No shell for the dev server yet",
  "서버 터미널 만들기": "Create server terminal",
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
  "기본 셸은 설정의 '기본 셸' 값이고, 이름은 자동으로 붙습니다 — 연 뒤 세션 상세에서 바꿀 수 있습니다. 열기 전에는 아무것도 실행하지 않습니다.":
    "The shell is the Default shell from Settings, and the name is set automatically — rename it in session details after opening. Nothing runs before you open it.",
  로그: "Logs",
  브라우저: "Browser",
  "패널을 왼쪽으로": "Move panel to the left",
  "패널을 오른쪽으로": "Move panel to the right",

  // ── ScreenOverlay ──
  "ESC 닫기": "ESC to close",

  // ── LayoutPicker ──
  "페인 배치": "Pane layout",
  "현재 워크스페이스 · {n}개 세션 · 고른 배치는 [적용] 뒤 바뀝니다": "Current workspace · {n} sessions · the layout changes when you apply",
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
  "clone 완료 · 목록에 등록했습니다 — {name}": "Clone finished · added to the list — {name}",
  "git repo 1개 = 팀 1개 = 탭 1개 · 등록 무제한 · 동시 오픈 10개":
    "1 git repo = 1 team = 1 tab · unlimited registrations · 10 open at once",
  "원격에서 Clone": "Clone from remote",
  "등록된 저장소": "Registered repositories",
  "· 목": "· mock",
  "{n} 등록 · {m} 열림": "{n} registered · {m} open",
  재지정: "Re-path",
  열림: "Open",
  "저장소를 선택하세요": "Select a repository",
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
  "터미널에서 실행 중인 에이전트 CLI": "Agent CLI running in the terminal",
  "팀 캐스팅으로 이동": "Go to team casting",
  "+ 빈 슬롯 {n} · 캐스팅": "+ empty slots: {n} · casting", // U112 — n=1에도 맞게
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
  // ── 셸 목록 (macOS, B114) ──
  "로그인 셸 ($SHELL)": "Login shell ($SHELL)",

  // ── 0.6 W7: 빠른 시작 · 첫 흐름 길 안내 (§10 · P49 · P50) ──
  "진행 단계": "Progress",
  "빠른 시작": "Quick start",
  "폴더만 있으면 됩니다. 리드와 개발 Claude Code 세션 2개를 바로 띄웁니다. 캐스팅 · 페르소나 · 임무는 건너뛰고, 팀은 나중에 고칠 수 있습니다.":
    "All you need is a folder. Starts two Claude Code sessions right away, a lead and a developer. Casting, personas and missions are skipped; you can change the team later.",
  "편성: {list}": "Team: {list}",
  "페르소나가 없어 쓸 수 없습니다 — 역할 팀으로 시작하세요": "No personas, so this is unavailable. Use Role team",
  "세션이 많을수록 사용 한도를 빨리 씁니다 — 2개로 시작합니다": "More sessions use up your usage limits faster, so this starts with two",
  "더 필요하면 팀 캐스팅에서 {n}개까지 늘릴 수 있습니다": "Need more? Grow to {n} in Team casting",
  "다음 → 워크스페이스 (Claude Code 2개 기동)": "Next → Workspace (launches 2 Claude Code sessions)",
  "페르소나가 없어 빠른 시작을 할 수 없습니다 — 역할 팀으로 시작하세요": "No personas, so quick start can't run. Start with Role team",
  "2세션으로 시작 → 워크스페이스": "Start with 2 sessions → Workspace",
  // 0.6 QA P64 — claude가 없고 codex만 있을 때
  "Codex 2세션으로 시작 → 워크스페이스": "Start with 2 Codex sessions → Workspace",
  "다음 → 워크스페이스 (Codex 2개 기동)": "Next → Workspace (launches 2 Codex sessions)",
  "Codex는 설치돼 있어 같은 편성을 Codex 2세션으로 시작할 수 있습니다": "Codex is installed, so you can start the same team as 2 Codex sessions",
  "리드와 개발 2세션으로 시작합니다. 워크스페이스가 열리면 Codex가 바로 뜹니다. 슬롯 {n}개 중 2개를 씁니다.":
    "Starts with two sessions, a lead and a developer. Codex launches as soon as the workspace opens. Uses 2 of {n} slots.",
  "빠른 시작이 지금 팀을 바꿉니다": "Quick start will replace the current team",
  "시작하면 아래가 바로 일어납니다. 종료된 세션은 되돌릴 수 없습니다.": "Starting does the following right away. Stopped sessions can't be brought back.",
  "바꾸고 시작": "Replace and start",
  "다음: 기본 터미널 구성 →": "Next: Default terminal setup →",
  "다음: 팀 캐스팅 →": "Next: Team casting →",
  "리드와 개발 2세션으로 시작합니다. 워크스페이스가 열리면 Claude Code가 바로 뜹니다. 슬롯 {n}개 중 2개를 씁니다.":
    "Starts with two sessions, a lead and a developer. Claude Code launches as soon as the workspace opens. Uses 2 of {n} slots.",
  "← 실행 방식": "← Launch mode",
  "← 워크스페이스 연결": "← Workspace connection", // 0.6 QA U129 — 단계 01 · 연결 화면의 이름
  "셸 열기 → 워크스페이스": "Open shell → Workspace",
  "역할 팀으로 바꾸기 →": "Switch to Role team →",
  "← 팀 캐스팅": "← Team casting",
  "워크스페이스 열기": "Open workspace",
  "기동 없이 열기": "Open without launching",
  "{n}개 모두 기동 → 워크스페이스": "Launch all {n} → Workspace",

  // ── 0.6 W7: 첫 실행 고지 · 다른 도구 전역 지시 · 진단 정보 복사 (§10 · §14 · §9-3) ──
  "EQMUX가 쓰는 곳 · 쓰지 않는 곳": "Where EQMUX writes, and where it doesn't",
  "처음 한 번만 보입니다. 설정 › 정보에서 다시 볼 수 있습니다.": "Shown once. You can see it again in Settings › About.",
  "쓰는 곳": "Writes to",
  "설정 · 워크스페이스 목록 · 세션 기록 · 훅과 상태 줄 합성 설정(hook-settings.json)":
    "Settings · workspace list · session history · generated hook and status line settings (hook-settings.json)",
  "진단 로그": "Diagnostic logs",
  "<저장소>/.eqmux/": "<repo>/.eqmux/",
  "팀 편성 · 역할 파일 · 임무 — 커밋하면 동료가 같은 팀으로 시작합니다. 개인용이면 .gitignore에 .eqmux/를 넣습니다(팀 공유가 꺼집니다)":
    "Team setup · role files · missions — commit them and teammates start with the same team. For personal use, add .eqmux/ to .gitignore (team sharing turns off)",
  "쓰지 않는 곳": "Never writes to",
  "엔진 설정은 고치지 않습니다. 훅은 세션을 띄울 때 인자(--settings, Codex는 -c)로만 싣습니다":
    "Engine settings are never changed. Hooks are passed only as launch arguments (--settings, or -c for Codex)",
  "저장소의 .claude/ · .codex/ · CLAUDE.md": "The repo's .claude/ · .codex/ · CLAUDE.md",
  "읽기만 합니다": "Read only",
  "요청하지 않으면 다른 시스템으로 아무것도 보내지 않습니다. 진단 정보도 사람이 복사해 붙일 때만 나갑니다.":
    "Nothing is sent to other systems unless you ask. Diagnostic info leaves only when you copy and paste it yourself.",
  "다른 도구의 전역 지시": "Global instructions from other tools",
  "점검 중…": "Checking…",
  "찾지 못했습니다 — EQMUX 세션에 다른 도구의 지시가 실리지 않습니다":
    "None found. No other tool's instructions are loaded into EQMUX sessions",
  "{tool}의 전역 지시가 EQMUX 세션에도 실립니다": "{tool}'s global instructions also load into EQMUX sessions",
  "{tool}의 전역 지시가 EQMUX 세션에도 실립니다 — 세션 안내문으로 덮어 두었습니다":
    "{tool}'s global instructions also load into EQMUX sessions. The session briefing overrides them",
  "세션 안내문으로 덮어 두었습니다 · 누르면 자세히": "Overridden by the session briefing · click for details",
  "세션 안내문으로 덮어 두었습니다 · 훅 {n}개는 막을 수 없습니다 · 누르면 자세히":
    "Overridden by the session briefing · {n} hooks can't be blocked · click for details",
  "자동 관리 구역": "Auto-managed block",
  "도구를 쓸 때마다 도는 훅 {n}개": "{n} hooks that run on every tool call",
  '"You are running inside …" 문장': '"You are running inside …" sentence',
  "EQMUX는 이 파일을 고치지 않습니다. 그 도구가 다시 써 넣기 때문입니다.":
    "EQMUX doesn't edit these files, because that tool would write them back.",
  "끄는 방법 →": "How to turn it off →",
  "앱이 쓰는 곳 · 진단": "Where the app writes · Diagnostics",
  "다시 점검": "Check again",
  "진단 정보 복사": "Copy diagnostic info",
  "모으는 중…": "Collecting…",
  "진단 정보를 복사했습니다 — GitHub 이슈에 붙여 주세요": "Diagnostic info copied. Paste it into a GitHub issue",
  "진단 정보를 만들지 못했습니다 · {err}": "Couldn't collect diagnostic info · {err}",
  "진단 정보에서 경로의 사용자 이름과 토큰은 가립니다. 앱이 보내지 않습니다 — 복사해서 직접 붙입니다.":
    "User names in paths and tokens are masked. The app never sends this; you copy and paste it yourself.",
  // ── 0.6 W7: 이 팀으로 시작 (D3 · W4 team.ts) ──
  "이 팀으로 시작": "Start with this team",
  "저장소의 편성(.eqmux/team.json) {n}명으로 바로 기동합니다": "Launch right away with the repo's {n}-member team (.eqmux/team.json)",
  "라이브러리에 없는 페르소나는 셸로 둡니다: {names}": "Personas not in your library stay as shells: {names}",
  "편성은 팀 캐스팅에서 나중에 바꿀 수 있습니다": "You can change the team later in Team casting",
  "다음 → 워크스페이스 (편성대로 기동)": "Next → Workspace (launches the saved team)",
  "저장된 팀": "Saved team",
  "이 팀으로 시작 → 워크스페이스": "Start with this team → Workspace",
  "저장소의 편성대로 시작합니다. 워크스페이스가 열리면 역할 세션이 바로 뜹니다. 슬롯은 {n}개까지 씁니다.":
    "Starts with the repo's team. Role sessions launch as soon as the workspace opens. Uses up to {n} slots.",
  // ── 0.6 W7: 스크롤백 저장 토글 (E4 · W6) ──
  "스크롤백 · 세션 로그 저장": "Save scrollback and session logs",
  "스크롤백과 세션 로그 파일에는 토큰·비밀번호가 평문으로 남을 수 있습니다. 끄면 디스크에 쓰지 않습니다 — 꺼 둔 동안은 eqmux read · 로그 검색 · 과거 세션 검색에 새 출력이 남지 않고, 재시작 뒤 이전 출력도 다시 볼 수 없습니다.":
    "Scrollback and session log files can keep tokens and passwords in plain text. When off, nothing is written to disk — while it's off, new output won't show up in eqmux read, log search or past-session search, and earlier output can't be viewed after a restart.",
  // ── 0.6 QA eqmux-dd ──
  "라이브러리에 없는 페르소나": "Persona not in your library",
  "실행 중 {n} — 에이전트 {a} · 셸만 연 역할 세션 {r} · 기본 터미널 {d} · 서버 {s}. 자동 재개하지 않습니다.":
    "{n} running — {a} agent(s) · {r} role session(s) with only a shell · {d} default terminal(s) · {s} server(s). Nothing auto-resumes.",
  "git 저장소 아님": "Not a git repository",
  "git init…": "git init…",
  "등록 해제": "Unregister",
  "{name}을(를) 목록에서 뺍니다. 저장된 세션 {n} · 재개 가능 {m}": "Removes {name} from the list. Saved sessions {n} · resumable {m}",
  "clone 중… {s}초 · 창을 닫아도 계속됩니다": "Cloning… {s}s · keeps going if you close this window",
  "오래 걸리면 Git 로그인 창이 다른 창 뒤에 떠 있을 수 있습니다.":
    "If this takes long, a Git sign-in window may be hidden behind other windows.",
  // ── 0.6 QA P71 · P72 (WorkspaceConnection.tsx · backend/workspaces.ts) ──
  "{name}을(를) 등록 해제했습니다": "Unregistered {name}",
  "되돌리기": "Undo",
  "되돌리기 실패": "Undo failed",
  "clone 취소": "Cancel clone",
  "clone을 취소했습니다": "Clone cancelled",
  "clone이 60분 안에 끝나지 않아 멈췄습니다": "Clone stopped — it didn't finish within 60 minutes",
  "받다 만 폴더를 지웠습니다": "removed the partly cloned folder",
  "받다 만 폴더가 남았습니다 — {path}": "the partly cloned folder is still there — {path}",
  "원격 객체 세는 중": "Counting remote objects",
  "원격 압축 중": "Remote compressing",
  "객체 받는 중": "Receiving objects",
  "델타 정리 중": "Resolving deltas",
  "파일 풀어놓는 중": "Checking out files",
  "기동 중…": "Launching…",
  "알겠습니다": "Got it",
};
