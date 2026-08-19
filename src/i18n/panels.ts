// 패널 그룹 사전 — 대화·로그·포트·브라우저 패널 + 분할선 + 대화 브리지 오류 문구.
// 공용 용어(세션·저장·미확인·기본 터미널 등)는 common.ts가 정본이라 여기 중복하지 않는다.
export const dict: Record<string, string> = {
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
  "인박스 대기 (M3 — 턴 종료 시 전달)": "Inbox pending (M3 — delivered at turn end)",
  "{n}건": "{n} msg(s)",
  "아직 메시지가 없습니다 — 아래에서 타입을 골라 팀에 보내보세요.":
    "No messages yet — pick a type below and send one to the team.",
  "idle 세션에는 즉시, 작업 중이면 턴 종료 시 전달됩니다 (M3)":
    "Delivered instantly to idle sessions; busy sessions receive at turn end (M3)",
  나: "Me",
  "@카이 질문… (@ 없으면 @all)": "@Kai your question… (no @ = @all)",
  "워크스페이스 탭을 먼저 여세요": "Open a workspace tab first",
  보내기: "Send",
  "수신자 없음: @{name} — 이 워크스페이스의 페르소나·세션 이름으로":
    "No recipient: @{name} — use a persona or session name in this workspace",

  // ── 대화 브리지 오류 (conversation.ts) ──
  "분당 발신 상한에 닿았습니다 (M6) — 잠시 후 다시": "Per-minute send limit reached (M6) — try again shortly",
  "본문이 너무 깁니다 — {n}자 상한": "Body too long — {n} character limit",
  "타입 5종과 본문이 필요합니다 (M2)": "One of the 5 types and a body are required (M2)",
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
  "세션이 연 LISTENING 포트가 없습니다": "No LISTENING ports opened by sessions",
  "포트 사용 요약": "Port usage summary",
  "세션 포트": "Session ports",
  "시스템 포트": "System ports",
  충돌: "Conflicts",
  "외부 노출": "Exposed",
  "루프백 밖으로 바인딩된 포트가 있습니다.": "Some ports are bound outside loopback.",
  "세션 포트가 루프백에만 바인딩되어 있습니다.": "Session ports are bound to loopback only.",

  // ── 브라우저 패널 (BrowserPanelTab) ──
  브라우저: "Browser",
  "세션 포트 미리보기": "Session port preview",
  새로고침: "Refresh",
  "localhost · 127.0.0.1 대상만 미리봅니다 — 외부 웹은 사용자의 브라우저에서":
    "Previews localhost · 127.0.0.1 only — use your own browser for the open web",
  "127.0.0.1:5173 — Enter로 열기": "127.0.0.1:5173 — press Enter to open",
  "위 포트 칩을 누르거나 주소를 입력하세요": "Click a port chip above or type an address",
  "세션이 LISTENING 포트를 열면 칩이 나타납니다": "Chips appear when a session opens a LISTENING port",
  "Tauri에서 실행하면 실측 포트가 연결됩니다": "Run in Tauri to see live ports",

  // ── 분할선 (PaneDividers) ──
  "드래그 — 페인 폭 조정 · 더블클릭 — 초기화": "Drag — adjust pane width · double-click — reset",
  "드래그 — 페인 높이 조정 · 더블클릭 — 초기화": "Drag — adjust pane height · double-click — reset",
};
