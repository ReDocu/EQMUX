// 패널 그룹 사전 — 대화·로그·포트·브라우저 패널 + 분할선 + 대화 브리지 오류 문구.
// 공용 용어(세션·저장·미확인·기본 터미널 등)는 common.ts가 정본이라 여기 중복하지 않는다.
export const dict: Record<string, string> = {
  "{name} · 메시지 {n}건": "{name} · {n} message(s)",
  // ── 대화 탭 0.5 (W5) ──
  "모든 프로젝트": "All projects",
  "사람이 쓰는 메시지는 800자 상한에서 뺍니다": "Messages you write are exempt from the 800-character limit",
  "끄면 다른 프로젝트와 오간 메시지를 숨깁니다": "Turn off to hide messages exchanged with other projects",
  "이전 200건": "Previous 200",
  "완료 보고 — 에이전트가 맡은 일을 끝냈다고 밝혔습니다": "Done report — the agent says its assigned work is finished",
  "대기 중 · 상대 작업 중": "Queued · recipient busy",
  "전달됨": "Delivered",
  "접기": "Collapse",
  "펼치기": "Expand",
  "파일을 열 수 없습니다 — {path}": "Cannot open file — {path}",
  "답장 (@{name})": "Reply (@{name})",
  "다른 프로젝트로 전달…": "Forward to another project…",
  "다른 프로젝트로 전달": "Forward to another project",
  "페인으로 점프": "Jump to pane",
  "본문 복사": "Copy text",
  "첨부 파일 열기": "Open attachment",
  전달: "Forward",
  "@이름 질문… (@ 없으면 @all)": "@name question… (no @ means @all)",
  // ── 대화 탭 (ConversationTab) ──
  "팀 대화": "Team chat",
  전체: "All",
  "모두 읽음": "Mark all read",
  "이 팀의 대화 전체를 Markdown 파일로 저장": "Save this team's whole conversation to a Markdown file",
  "파일 저장은 앱에서만 됩니다 — 브라우저 목업에는 원장이 없습니다":
    "Saving to a file works in the app only — the browser mock has no ledger",
  "{n}건 저장됨 — {path}": "Saved {n} message(s) — {path}",
  "저장 실패 — 로그 패널을 확인하세요": "Save failed — check the logs panel",
  "본문이 없습니다 — 받는 사람 뒤에 보낼 내용을 적어주세요":
    "No message body — write what you want to send after the recipient",
  "화면 지우기": "Clear",
  "화면만 지웁니다 — 대화 원장과 저장 파일은 그대로 남습니다":
    "Clears the view only — the conversation ledger and saved files stay intact",
  "이전 {n}건 숨김 — 다시 보기": "{n} earlier message(s) hidden — show them",
  "화면을 지웠습니다 — 새 메시지부터 여기에 표시됩니다":
    "View cleared — new messages will appear here",
  "응답 대기 — 대화로는 답할 수 없습니다. 페인에서 직접 입력하세요":
    "Awaiting your answer — chat cannot reach it. Type in the pane itself",
  "인박스 대기 (턴 종료 시 전달)": "Inbox pending (delivered at turn end)",
  "{n}건": "{n} msg(s)",
  "아직 메시지가 없습니다 — 아래에서 타입을 골라 팀에 보내보세요.":
    "No messages yet — pick a type below and send one to the team.",
  "idle 세션에는 즉시, 작업 중이면 턴 종료 시 전달됩니다":
    "Delivered instantly to idle sessions; busy sessions receive at turn end",
  나: "Me",
  "@카이 질문… (@ 없으면 @all)": "@Kai your question… (no @ = @all)",
  "워크스페이스 탭을 먼저 여세요": "Open a workspace tab first",
  보내기: "Send",
  "수신자 없음: @{name} — 이 워크스페이스의 페르소나·세션 이름으로":
    "No recipient: @{name} — use a persona or session name in this workspace",

  // ── 대화 브리지 오류 (conversation.ts) ──
  "분당 발신 상한에 닿았습니다 — 잠시 후 다시": "Per-minute send limit reached — try again shortly",
  "본문이 너무 깁니다": "Body too long",
  "타입 5종과 본문이 필요합니다": "One of the 5 types and a body are required",
  "전송 실패 — 로그 패널을 확인하세요": "Send failed — check the logs panel",

  // ── 서버 로그 패널 (LogsPanelTab) ──
  "서버 로그": "Server logs",
  "표시 중인 로그를 파일로 저장": "Save displayed logs to a file",
  "필터 입력 · Enter = 디스크 전문 검색(FTS)": "Type to filter · Enter = disk full-text search (FTS)",
  "분류 · 세션 · 내용 검색": "Search by type · session · content",
  "디스크 검색 · {n}건 (전체 스크롤백 FTS)": "Disk search · {n} hits (full scrollback FTS)",
  "결과 닫기": "Close results",
  "검색 중…": "Searching…",
  "디스크 스크롤백에서 찾지 못했습니다": "No matches in disk scrollback",
  "문맥 {n}줄 (디스크 페이징)": "context · {n} lines (disk paging)",
  "더 이전 60줄": "60 older lines",
  "조건에 맞는 로그가 없습니다": "No logs match the filters",
  "event 테이블 스트림 연결됨": "event table stream connected",
  "실시간 스트림 (목)": "Live stream (mock)",
  "event 테이블 실측": "measured from event table",
  "세션 로그 (PTY 원문)": "Session logs (raw PTY)",
  "~/.eqmux/logs/<세션>.log · 실시간 append": "~/.eqmux/logs/<session>.log · live append",
  "폴더 열기": "Open folder",

  // ── 포트 패널 (PortsPanelTab) ──
  포트: "Ports",
  "· 실측": "· live",
  "· 목": "· mock",
  "포트 · 프로세스 · 세션 검색": "Search port · process · session",
  "주소 복사": "Copy address",
  "브라우저 패널에서 열기": "Open in the browser panel",
  "세션이 연 새 포트가 있습니다": "A session opened a new port",
  "세션이 연 LISTENING 포트가 없습니다": "No LISTENING ports opened by sessions",
  "포트 사용 요약": "Port usage summary",
  "세션 포트": "Session ports",
  "시스템 포트": "System ports",
  충돌: "Conflicts",
  "세션 외부 노출": "Session ports exposed",
  "세션 포트 {n}개가 루프백 밖에 바인딩되어 있습니다.": "{n} session port(s) bound outside loopback.",
  "세션 포트가 루프백에만 바인딩되어 있습니다.": "Session ports are bound to loopback only.",

  // ── 브라우저 패널 (BrowserPanelTab) ──
  브라우저: "Browser",
  "세션 포트 · 웹 미리보기": "Session ports · web preview",
  새로고침: "Refresh",
  뒤로: "Back",
  앞으로: "Forward",
  "브라우저 닫기": "Close browser",
  "목 모드는 localhost 미리보기만 됩니다 — 앱에서 실행하세요":
    "The browser mock previews localhost only — run the app for the real webview",
  "주소 입력 — Enter로 열기 (127.0.0.1:5173 · https://…)":
    "Type an address — Enter opens (127.0.0.1:5173 · https://…)",
  "위 포트 칩을 누르거나 주소를 입력하세요": "Click a port chip above or type an address",
  "세션이 LISTENING 포트를 열면 칩이 나타납니다": "Chips appear when a session opens a LISTENING port",
  "Tauri에서 실행하면 실측 포트가 연결됩니다": "Run in Tauri to see live ports",

  // ── MDView 패널 (MdViewTab) ──
  "마크다운 파일 보기": "Markdown viewer",
  "워크스페이스의 .md 파일을 고르거나 상대 경로를 입력하세요": "Pick a .md file in the workspace or type a relative path",
  "상대 경로 — Enter로 열기 (docs/guide.md)": "Relative path — Enter opens (docs/guide.md)",
  "목 모드에서는 파일을 읽을 수 없습니다 — 앱에서 실행하세요": "The mock cannot read files — run the app",

  // ── 분할선 (PaneDividers) ──
  "드래그 — 페인 폭 조정 · 더블클릭 — 초기화": "Drag — adjust pane width · double-click — reset",
  "드래그 — 페인 높이 조정 · 더블클릭 — 초기화": "Drag — adjust pane height · double-click — reset",
  // ── 0.5.x QA eqmux-66: 대화 탭 (B99 · U50 · U53 · U54) ──
  "다른 프로젝트 포함": "Include other projects",
  "지운 {n}건 다시 보기": "Show {n} cleared",
  "원장에서 이전 200건 불러오기": "Load 200 older from the ledger",
  "불러오는 중…": "Loading…",
  "인박스 대기": "Waiting in inbox",
  "이 페인으로 이동": "Go to this pane",
  "종료됨 · 재개해야 전달": "stopped · delivered after resume",
  "손으로 띄운 에이전트 · 넣기 필요": "hand-started agent · needs Insert",
  "에이전트 미기동 · 띄우면 전달": "agent not started · delivered on launch",
  "응답 대기 · 답한 뒤 전달": "waiting for you · delivered after you answer",
  "작업 중 · 턴 끝나면 전달": "busy · delivered at turn end",
  "대기 중": "Queued",
  "받을 사람 인박스에 남아 있습니다 — 사유는 위 인박스 대기 줄에": "Still in a recipient's inbox — see the reason in the inbox line above",
  복사됨: "Copied",
  "복사하지 못했습니다": "Couldn't copy",
  // 넣기 팝오버 (U51 · U52) — 관제 화면 칩
  "승인 대기이거나 상태를 몰라 쌓아 두었습니다 — idle이 되면 넣습니다": "Held because it's awaiting approval or its state is unknown — inserted once idle",
  "넣지 않고 치웁니다 — 원문은 대화 기록에 남습니다": "Clears without inserting — the original stays in the conversation log",
  "{n}건 버리기": "Discard {n}",

  // 실행 › 환경변수 (.env)
  "환경변수": "Env",
  "환경변수 · .env 파일 (읽기 전용)": "Environment · .env files (read-only)",
  "값 보기": "Show values",
  "값 가리기": "Hide values",
  "다시 읽기": "Reload",
  "변수 이름 검색": "Search variable names",
  "변수 {n}개": "{n} variables",
  "이 파일에 변수가 없습니다": "No variables in this file",
  "(빈 값)": "(empty)",
  "클릭하면 값을 복사합니다": "Click to copy the value",
  "{k} 값을 복사했습니다": "Copied {k}",
};
