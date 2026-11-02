// 임무 그룹 사전 — Missions.tsx · MissionExplorerTab.tsx 의 한국어 원문(키) → 영어. i18n.ts가 병합한다.
export const dict: Record<string, string> = {
  // ── 임무 배정 화면 (Missions.tsx) ──
  "완료 보고": "Done report",
  "검토 중으로": "Move to review",
  "임무 저장 실패 — {err}": "Mission save failed — {err}",
  "임무 배정": "Mission assignment",
  "클릭하면 다음 단계로": "Click for next stage",
  "기본 임무 해제": "Unset default mission",
  "기본 임무로 지정 — 임무 없는 새 역할 세션이 자동 배정받습니다":
    "Set as default mission — new role sessions without a mission are auto-assigned to it",
  "★ 기본": "★ Default",
  "브랜치 미연결": "no branch linked",
  "공유 repo 전환 확정?": "Confirm shared repo switch?",
  "⎇ 체크아웃": "⎇ Checkout",
  "브라우저 dev — 실제 체크아웃 없음": "Browser dev — no actual checkout",
  "체크아웃 완료 — 공유 세션 전체에 적용됨": "checked out — applied to all shared sessions",
  "체크아웃 실패": "Checkout failed",
  "세션 없음 — 캐스팅을 먼저 하세요": "No sessions — run casting first",
  "새 임무": "New mission",
  "임무 이름": "Mission name",
  "목표 — 완료 조건을 측정 가능하게": "Goal — make the completion criteria measurable",
  "브랜치 (선택)": "Branch (optional)",
  "임무 생성": "Create mission",
  "만들면 .eqmux/missions/<id>.md 파일이 생깁니다. 이 파일이 원본이고, 앱의 목록은 파일을 따라갑니다.":
    "Creating makes .eqmux/missions/<id>.md. That file is the source; the list in the app follows it.",

  // ── 임무 · 파일 탐색기 (MissionExplorerTab.tsx) ──
  "임무 · 파일 탐색기": "Missions · File explorer",
  "FS 실측 · CRUD": "Live FS · CRUD",
  "목 데이터": "Mock data",
  "세션 없음": "No session",
  "워크스페이스 없음": "No workspace",
  "파일 검색": "Search files",
  "새 파일": "New file",
  "새 폴더": "New folder",
  루트: "root",
  "+파일": "+File",
  "+폴더": "+Folder",
  "이름 변경 (같은 폴더 안)": "Rename (within the same folder)",
  "휴지통으로 이동 — 영구 삭제 아님": "Move to trash — not permanent deletion",
  "휴지통 확정?": "Confirm trash?",
  "새 이름": "New name",
  "폴더 이름": "Folder name",
  "파일 이름": "File name",
  펼치기: "Expand",
  접기: "Collapse",
  "파일이 없거나 워크스페이스가 없습니다": "No files, or no workspace",
  "검색 결과 없음": "No matches",
  "파일을 선택하세요": "Select a file",
  "편집 중": "editing",
  "원문 편집 (1MB 상한)": "Edit source (1MB cap)",
  "트리 새로 읽기": "Reload tree",
  "미저장 변경이 있습니다 — 한 번 더 클릭하면 버리고 이동합니다":
    "Unsaved changes — click again to discard and switch",
  "미리보기를 불러올 수 없습니다 (바이너리 또는 읽기 실패)":
    "Preview unavailable (binary or read failure)",
  "폴더 선택됨 — +파일/+폴더는 이 안에 만들어집니다":
    "Folder selected — +File/+Folder create inside it",
  "파일을 선택하면 원문이 표시됩니다. 임무 파일(.eqmux/missions/*.md)은 구조화되어 보입니다.":
    "Select a file to view its source. Mission files (.eqmux/missions/*.md) render structured.",
  목표: "Goal",
  산출물: "Outputs",
  "실측 · 열 때 새로 읽음": "Live · reread on open",
  "WATCHING · .eqmux/ (목)": "WATCHING · .eqmux/ (mock)",
  "파일 우선 · 삭제는 휴지통 · .git 불가침": "Files first · deletes go to trash · .git untouchable",
  "임무 관리": "Manage missions",
  "브리프 전달": "Send brief",
  "산출물 — 한 줄에 하나 (선택)": "Deliverables — one per line (optional)",
  "산출물 · {done}/{total} 체크": "Deliverables · {done}/{total} checked",
  "산출물 {n}개가 아직 체크되지 않았습니다 — 검토 중으로 옮겼습니다": "{n} deliverable(s) not checked yet — moved to in review anyway",

  // ── 0.5 시안 jc2Fm (목록 | 편집 | 배정) ──
  "+ 새 임무": "+ New mission",
  "임무 파일(.eqmux/missions/*.md)이 원본입니다. 세션을 누르면 배정하거나 빼고, 배정은 그 세션의 역할 파일에 적힙니다":
    "Mission files (.eqmux/missions/*.md) are the source. Click a session to assign or unassign; assignments go into that session's role file",
  "배정 없음": "unassigned",
  "임무가 없습니다 — + 새 임무로 만드세요": "No missions — create one with + New mission",
  "임무 상태": "Mission status",
  "목표 없음": "No goal",
  "파일을 열 수 없습니다": "Cannot open the file",
  "세션 배정": "Assign sessions",
  "배정하면 역할 파일을 갱신하고 [EQ] 임무 배정 한 줄을 보냅니다. 유휴면 바로, 작업 중이면 턴이 끝날 때. 세션의 임무는 하나라 배정하면 이전 임무에서 빠집니다.":
    "Assigning updates the role file and sends an [EQ] mission line — right away if idle, at turn end if busy. A session has one mission, so assigning moves it out of the previous one.",
  "죽은 세션은 배정해도 재개 전까지 메시지가 쌓입니다": "Dead sessions queue the message until resumed",
  "현재: {name}": "Now: {name}",
  "임무를 옮길까요?": "Move the mission?",
  "{session}은(는) '{from}'에서 빠지고 '{to}'에 배정됩니다. 세션의 임무는 하나입니다.":
    "{session} leaves '{from}' and is assigned to '{to}'. A session has one mission.",
  옮기기: "Move",
  // 0.6 §13-2 임무 시작점
  "시작 {sha}": "Started at {sha}",
  "시작 {sha} · 그 뒤 커밋 {n}개": "Started at {sha} · {n} commits since",
  // 0.6 §4 선행 임무
  "선행 임무": "Depends on",
  "없는 임무": "Unknown mission",
  "진행 중 {n}": "In progress {n}",
  // 0.6 §13-3 임무 검토
  검토하기: "Review",
  "임무 검토": "Mission review",
  "시작점 기록 없음 — 지금 작업 트리의 변경을 보입니다": "No start point recorded — showing current working tree changes",
  "되돌려 보내기": "Send back",
  승인: "Approve",
  "아직 완료 보고가 없습니다": "No done report yet",
  "담당 세션이 고친 파일 · {n}개": "Files edited by assigned sessions · {n}",
  "편집 도구로 고친 것만": "edit-tool changes only",
  "편집 기록이 없습니다 — 전체 변경을 보세요": "No edit records — review all changes",
  "비용 {usd}": "Cost {usd}",
  "시작점 {sha}을 git에서 찾을 수 없습니다(rebase 등) — 지금 작업 트리의 변경을 보입니다":
    "Start point {sha} is no longer in git (rebase etc.) — showing current working tree changes",
  "전체 변경 보기 — 한 폴더를 같이 쓰므로 다른 세션의 변경도 섞입니다": "Show all changes — the folder is shared, so other sessions' changes mix in",
  "테스트 실행 — 서버 탭 셸에서 돕니다": "Run tests — runs in the server tab shell",
  "테스트 실행": "Run tests",
  "실행 중 — 서버 탭에서 출력을 볼 수 있습니다": "Running — output is in the server tab",
  "서버 탭 셸이 없습니다 — 서버 탭을 열었습니다. 셸이 뜬 뒤 다시 누르세요": "No server tab shell — opened the server tab. Press again once the shell is up",
  "이 셸(cmd)에서는 종료 코드를 읽을 수 없습니다 — 서버 탭 출력으로 판단하세요": "Can't read the exit code in this shell (cmd) — judge from the server tab output",
  "30분 동안 끝나지 않았습니다 — 서버 탭을 확인하세요": "Didn't finish in 30 minutes — check the server tab",
  "종료 코드 {code} — 통과": "Exit code {code} — passed",
  "종료 코드 {code} — 실패": "Exit code {code} — failed",
  "{n}명에게 검토 의견을 보내고 진행 중으로 되돌렸습니다": "Sent review notes to {n} and moved back to in progress",
  "고칠 점을 적어야 보낼 수 있습니다": "Write what to fix before sending",
  "담당 세션이 없어 보낼 곳이 없습니다 — 임무 화면에서 먼저 배정하세요":
    "No assigned session to send to — assign one on the Missions screen first",
  "보내지 못해 임무 상태를 그대로 두었습니다 — {err}": "Couldn't send, so the mission status is unchanged — {err}",
  "임무를 찾을 수 없습니다": "Mission not found",
  "되돌려 보낼까요?": "Send it back?",
  "고칠 점 — 담당 세션에게 review 메시지로 갑니다": "What to fix — sent to the assigned sessions as a review message",
  "받는 세션: {names}": "To: {names}",
  "임무는 진행 중으로 돌아갑니다": "The mission goes back to in progress",

  // ── 0.6 QA (eqmux-ae) — 임무 · 담당 경로 · 트랜스크립트 · 첫 실행 고지 ──
  // U136 임무 상태 표시 이름 (파일 값은 그대로)
  "할 일": "To do",
  "진행 중": "In progress",
  "검토 중": "In review",
  끝남: "Done",
  // B188 · P60
  "산출물 {n}개가 체크되지 않은 채 끝났습니다 — 임무 파일에서 확인하세요": "Done with {n} deliverable(s) unchecked — check the mission file",
  "누르면 걸거나 풉니다": "click to add or remove",
  "선행 임무가 끝나지 않았습니다": "Prerequisites aren't done",
  "선행 {deps}이(가) 아직 끝나지 않았습니다. 그래도 배정하면 브리프에 선행 정보가 붙고, 선행이 끝날 때 알림이 갑니다.":
    "Prerequisite {deps} isn't done yet. If you assign anyway, the brief notes the prerequisites and a notice goes out when they finish.",
  "그래도 배정": "Assign anyway",
  "선행: {deps} — 끝나면 알림이 옵니다": "Prerequisites: {deps} — you'll be notified when they finish",
  "'{name}'의 선행 임무가 모두 끝났습니다 — 담당 세션이 없어 아무도 시작하지 않습니다":
    "All prerequisites of '{name}' are done — it has no assigned session, so nobody will start it",
  // U123 에이전트에게 가는 문구 — `[EQ]` 머리는 번역하지 않는다
  "임무 배정: {name}{goal} · 정의 {file}": "Mission assigned: {name}{goal} · definition {file}",
  "임무 '{name}' 검토 의견 — ": "Review notes on mission '{name}' — ",
  "브리프 전달 · {file}": "Brief handoff · {file}",
  // U119
  '테스트 명령이 없습니다 — .eqmux/commands.json에 kind: "test" 항목을 넣으면 여기서 돌릴 수 있습니다.':
    'No test command — add an entry with kind: "test" to .eqmux/commands.json to run it here.',
  "서버 탭 열기 →": "Open the server tab →",
  // U120 담당 밖 편집 칩
  "담당 밖 · {path}": "Outside owns · {path}",
  "담당 밖": "Outside owns",
  // U160 · U159 트랜스크립트 · 서브에이전트
  "같은 폴더의 최근 대화로 추정 — 이 세션 것이 아닐 수 있습니다": "Guessed from the latest conversation in this folder — may not be this session's",
  "최근 2MB만": "last 2MB only",
  "{n}턴": "{n} turns",
  "{shown} / {total}턴": "{shown} / {total} turns",
  "{n}줄": "{n} lines",
  "{shown} / {total}줄": "{shown} / {total} lines",
  "최근 서브에이전트 호출 (기록)": "Recent subagent calls (history)",
  "지금 도는 서브에이전트": "Subagents running now",
  // U116 · U127 · U128 첫 실행 고지 · 설정 › 보안
  "세션 터미널 출력 로그 · 진단 로그 — 토큰이 평문으로 남을 수 있습니다(설정 › 저장소에서 끔)":
    "Session terminal output logs · diagnostic logs — tokens may be kept in plain text (turn off in Settings › Storage)",
  "<저장소>/.claude/skills · settings.local.json": "<repo>/.claude/skills · settings.local.json",
  "확장 탭에서 사람이 누를 때만 씁니다 — 플러그인 켜기 · 끄기, 스킬 만들기 · 고치기 · 지우기 · 복사":
    "Written only when you press it in the Extensions tab — enabling or disabling plugins, creating, editing, deleting or copying skills",
  "엔진 설정은 스스로 고치지 않습니다(확장 탭에서 사람이 누른 변경만 위 목록대로 씁니다). 훅은 세션을 띄울 때 인자로만 싣습니다":
    "Engine settings are never changed on their own (only changes you press in the Extensions tab, as listed above). Hooks are passed only as launch arguments",
  "읽기만 합니다 — 확장 탭에서 사람이 누른 스킬 · 플러그인 변경은 예외입니다":
    "Read only — except skill and plugin changes you press in the Extensions tab",
  "{tool}의 훅 {n}개가 EQMUX 세션의 도구 호출마다 실행됩니다": "{n} {tool} hook(s) run on every tool call in EQMUX sessions",
  "{tool}의 훅 {n}개가 EQMUX 세션의 도구 호출마다 실행됩니다 — EQMUX가 막을 수 없습니다":
    "{n} {tool} hook(s) run on every tool call in EQMUX sessions — EQMUX can't block them",
  "EQMUX가 막을 수 없습니다 · 누르면 끄는 방법": "EQMUX can't block them · click for how to turn them off",
  "스스로 고치지 않음": "Never changed on its own",
  "확장 탭에서 사람이 누른 플러그인 · 스킬 변경만 씁니다": "Only plugin and skill changes you press in the Extensions tab are written",
  "확장 탭에서 사람이 누른 스킬 · settings.local.json 변경만 씁니다":
    "Only skill and settings.local.json changes you press in the Extensions tab are written",
  // P83 관제 빈 상태 — 화면 이름 '워크스페이스 열기'로
  "열린 워크스페이스가 없습니다 — 탭 줄의 + 또는 [워크스페이스 열기]에서 git 저장소를 여세요":
    "No open workspaces — open a git repository with + in the tab bar or [Open workspace]",
  // ── 0.6 QA eqmux-52: 파일 탭(탐색기) — U163 · B215 · B220 ──
  "상한에 걸려 이 폴더 안은 읽지 않았습니다": "Stopped at the limit — this folder's contents weren't read",
  "{n}개 상한에서 멈췄습니다 — 이 아래로 더 있습니다": "Stopped at the {n}-entry limit — there's more below",
  "파일 트리를 읽지 못했습니다 — ⟳로 다시 시도하세요": "Couldn't read the file tree — try again with ⟳",
  배정: "Assigned",
  "임무 파일(.eqmux/missions/*.md)을 고르면 전달할 수 있습니다": "Pick a mission file (.eqmux/missions/*.md) to hand off",
};
