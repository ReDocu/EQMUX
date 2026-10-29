// 설정 화면 사전 (Settings.tsx)
export const dict: Record<string, string> = {
  "저장 실패 — 다음 실행에 반영되지 않습니다": "Save failed — this will not apply on the next run",
  "100ms / 200행": "100ms / 200 lines",
  // 헤드
  "settings.json 즉시 저장": "Saved to settings.json instantly",
  "브라우저 dev — 저장 없음": "Browser dev — not persisted",
  "값을 클릭하면 다음 옵션으로": "click a value to cycle options",
  "기본값 복원": "Restore defaults",
  "클릭하면 다음 옵션 — 즉시 저장": "Click for next option — saved instantly",
  "고정 정책 — 설정으로 바꾸지 않습니다": "Fixed policy — not configurable",

  // 언어
  "UI 언어 — 한국어(기본)·영어. 코드·데이터의 한국어 원문은 그대로 두고 화면 표시만 바꿉니다.":
    "UI language — Korean (default) or English. Only the display changes; Korean source data stays as-is.",
  "표시 언어": "Display language",
  "한국어 (기본)": "한국어 (default)",
  "이벤트 로그·생성 파일": "Event logs · generated files",
  "원문 유지 (데이터 불변)": "Kept as written (data is immutable)",

  // 화면
  화면: "Display",
  "테마는 디자인 토큰만 바꿉니다. 터미널 페인은 TUI·ANSI 가독성을 위해 항상 다크입니다.":
    "Theme swaps design tokens only. Terminal panes stay dark for TUI/ANSI legibility.",
  "다크 (기본)": "Dark (default)",
  라이트: "Light",
  "시스템 따름": "Follow system",
  "터미널 페인": "Terminal panes",
  "항상 다크 (ANSI 팔레트 전제)": "Always dark (assumes ANSI palette)",
  "색 팔레트": "Color palette",
  "부드러움 (기본)": "Soft (default)",
  고대비: "High contrast",
  중성: "Neutral",
  따뜻함: "Warm",
  "터미널 렌더러": "Terminal renderer",
  "WebGL (기본 — 빠름)": "WebGL (default — fast)",
  "DOM — 잔상이 보일 때": "DOM — when you see stale glyphs",
  강조색: "Accent colors",
  "팔레트 공통 — 배경 명도·색온도만 바뀝니다": "Shared across palettes — only surface lightness and warmth change",

  // 세션 슬롯
  "세션 슬롯": "Session slots",
  "워크스페이스당 세션(터미널 페인) 수의 상한입니다. 줄여도 이미 열린 세션은 닫지 않습니다.":
    "Cap on sessions (terminal panes) per workspace. Lowering it never closes sessions already open.",
  "슬롯 수": "Slot count",
  "4개 (기본)": "4 (default)",
  "6개": "6",
  "8개": "8",
  "복원 허용": "Restore allowance",
  "team.json 최대 8슬롯 — 설정과 무관": "team.json up to 8 slots — independent of this setting",

  // 시작과 복원
  "시작과 복원": "Startup & restore",
  "자동 실행 없이 화면 상태만 복원합니다.":
    "Restores screen state only — nothing auto-runs.",
  "시작 화면": "Start view",
  "관제 대시보드": "Control dashboard",
  "마지막 워크스페이스": "Last workspace",
  "웹 페이지 열기": "Open web pages in",
  "누른 링크와 에이전트의 eqmux browser open이 열리는 곳 · Chrome이면 에이전트가 페이지를 조작(snapshot·click)하지 못한다":
    "Where clicked links and agents' eqmux browser open go · with Chrome, agents can't drive the page (snapshot·click)",
  "EQMUX 브라우저 (기본)": "EQMUX browser (default)",
  "스크롤백 재생": "Scrollback replay",
  "열린 탭·배치 복원": "Open tabs & layout restore",
  "항상 (layout.json)": "Always (layout.json)",

  // 알림
  "사람의 행동이 필요한 상태만 알립니다. 꺼도 인앱 미확인은 유지됩니다.":
    "Notifies only states that need a human. In-app unseen markers persist even when off.",
  "OS 알림": "OS notifications",
  "응답 대기 · 종료": "Waiting · exited",
  "응답 대기만": "Waiting only",
  꺼짐: "Off",
  "waiting 사운드": "waiting sound",
  "켜짐 (예약 — OS 알림 기본음)": "On (reserved — OS default sound)",
  "메모리 배너": "Memory banner",
  "꺼짐 (기본)": "Off (default)",
  "세션 2 GB↑": "Session over 2 GB",
  "세션 4 GB↑": "Session over 4 GB",
  "세션 8 GB↑": "Session over 8 GB",
  "창 포커스 시": "When window focused",
  "억제": "Suppressed",

  // 저장소와 보존
  "저장소와 보존": "Storage & retention",
  "워크스페이스별 SQLite WAL — 보존 상한은 고정 정책. SGR 저장은 끌 수 있습니다.":
    "Per-workspace SQLite WAL — retention caps are fixed policy. SGR storage can be turned off.",
  "SGR 색 저장": "SGR color storage",
  "켜짐 (기본)": "On (default)",
  "꺼짐 — 용량 절감": "Off — saves space",
  "세션당 상한": "Per-session cap",
  "보존 기간": "Retention period",
  "배치 커밋": "Batch commit",

  // Claude Code 런타임
  "Claude Code 런타임": "Claude Code runtime",
  "검증된 CLI와 관측 어댑터 — 고정 정책. 상태 줄 표시만 고를 수 있습니다.":
    "Verified CLI and observation adapter — fixed policy. Only the status line display is configurable.",
  "세션 상태 줄": "Session status line",
  "모델 · 비용 (기본)": "Model · cost (default)",
  "모델만 — 비용 숨김": "Model only — hide cost",
  숨김: "Hidden",
  "상태 소스": "Status source",
  "세션 레지스트리 watch + 2s 재스캔": "Session registry watch + 2s rescan",
  "--resume · 같은 UUID · 같은 cwd": "--resume · same UUID · same cwd",
  훅: "Hooks",
  "2차 소스 (PRD I 대기)": "Secondary source (pending PRD I)",
  "훅 인라인 주입 · resume <id> · 샌드박스 = 권한": "Inline hook injection · resume <id> · sandbox = permissions",

  // 권한 정책
  "권한 정책": "Permission policy",
  "bypassPermissions는 앱에서 제공하지 않습니다.": "bypassPermissions is not offered by this app.",
  "권한 원천": "Permission source",
  "역할 파일 frontmatter": "Role file frontmatter",
  "권한 변경": "Permission change",
  "재개 기반 재시작": "Resume-based restart",

  // 사용자 파일 불가침
  "사용자 파일 불가침": "User files untouched",
  "개인 Claude 설정은 수정하지 않습니다.": "Personal Claude settings are never modified.",
  "수정 안 함": "Never modified",
  "수정 안 함 (읽기만)": "Never modified (read-only)",

  // 문의 · 피드백
  "문의 · 피드백": "Feedback",
  "버그와 개선 제안을 받고 있습니다. 아직 1.0 이전이라 어떤 이야기든 도움이 됩니다.":
    "Bug reports and feature requests are welcome — it's still pre-1.0, so anything helps.",
  "문의 폼": "Feedback form",
  "브라우저에서 열기": "Open in browser",
  "앱 밖 브라우저로 엽니다": "Opens in a browser outside the app",

  // 정보
  정보: "About",
  "하나의 git 저장소를 4명의 AI 에이전트 팀이 함께 작업하고, 사람이 그것을 관제하는 데스크톱 앱입니다.":
    "A desktop app where a team of 4 AI agents works on one git repository together, overseen by a human.",
  제품: "Product",
  "EQMUX — 멀티 에이전트 관제 MUX": "EQMUX — multi-agent mission-control MUX",
  버전: "Version",
  라이선스: "License",
  // ── 0.5 — 세그먼트·드롭다운 · 완료 알림 · 낡은 문구 · 단축키 ──
  "바뀔 때마다 저장": "Saved on every change",
  "완료 OS 알림": "Completion OS notifications",
  "손으로 띄운 에이전트 메시지": "Messages to hand-launched agents",
  "기본 터미널에서 직접 실행한 claude·codex에 온 메시지 · 자동이어도 idle일 때만 넣고, 승인 대기·상태 모름이면 쌓아 벨에 남긴다":
    "Messages to claude/codex you started yourself in a default terminal · even on auto they go in only when idle; while awaiting approval or with unknown state they queue and stay in the bell",
  "쌓아 두기 (기본)": "Queue (default)",
  "idle이면 자동으로 넣기": "Auto-insert when idle",
  "완료 보고만 (기본)": "Completion reports only (default)",
  "턴 끝날 때마다": "Every finished turn",
  끔: "Off",
  "응답 대기 알림 소리": "Waiting sound",
  "250줄": "250 lines",
  "500줄": "500 lines",
  "1,000줄": "1,000 lines",
  "켜짐 — 창이 포커스가 아닐 때": "On — when the window is not focused",
  "Stop · Notification 훅으로 idle·waiting 판정": "Stop · Notification hooks decide idle and waiting",
  단축키: "Shortcuts",
  "읽기 전용입니다. xterm은 Ctrl+Shift+글자를 터미널로 보내지 않아 셸 단축키와 겹치지 않습니다.":
    "Read-only. xterm does not pass Ctrl+Shift+letter to the terminal, so these never clash with shell keys.",
  "다음 미확인으로 (= ⛶ 응답 대기 칩)": "Next unseen (= ⛶ Waiting chip)",
  "N번 슬롯 페인에 키보드 포커스": "Keyboard focus to slot N's pane",
  "관제 토글": "Toggle control",
  "복사 · 붙여넣기": "Copy · paste",
  "사이드 패널 토글 (마지막 탭)": "Toggle side panel (last tab)",
  "선택이 있으면 복사 · 붙여넣기 (앱)": "Copy when text is selected · paste (app)",
  // macOS 단축키 표 (U67·B126)
  "복사 · 붙여넣기 (이미지는 파일 경로로)": "Copy · paste (images paste as a file path)",
  "터미널 화면 · 스크롤백 비우기": "Clear terminal screen · scrollback",
  "셸로 그대로 — 인터럽트 · 커서 이동 · 글자 그대로 넣기": "Passed to the shell — interrupt · cursor move · quoted insert",
  "Meta 키 — Option+B/F 단어 이동 · Option+Enter 줄바꿈": "Meta key — Option+B/F word jump · Option+Enter newline",
  "맨 위 창·팝업·메뉴 하나만 닫기 · 입력칸에서는 칸 빠져나오기": "Closes only the topmost dialog/popup/menu · in a field, leaves the field",
  "확인창에서 취소 (위험 버튼은 Tab으로 옮겨 Enter)": "Cancels in confirm dialogs (Tab to the danger button, then Enter)",
  "화면이 깨졌을 때 진단 기록에 표시": "Marks the diagnostics log when the screen looks broken",
  // ── 0.5 카테고리 내비 ──
  일반: "General",
  "에이전트 런타임": "Agent runtime",
  저장소: "Storage",
  보안: "Security",
  // ── 0.5 시안 (mT3kL·fvlW8) — 행 설명 · 고정 사실 ──
  "기본 셸": "Default shell",
  "새로 여는 터미널이 쓰는 셸 · 이미 열린 터미널은 그대로": "Shell for newly opened terminals · open ones keep theirs",
  "화면 표시만 바뀝니다 — 코드·데이터의 한국어 원문과 직함 값은 그대로":
    "Changes only what's shown — Korean source text in code/data and title values stay as they are",
  한국어: "한국어",
  "디자인 토큰만 바꿉니다 — 터미널 페인은 항상 다크": "Swaps design tokens only — terminal panes stay dark",
  "배경 명도·색온도만 바뀝니다 — 강조색은 팔레트 공통":
    "Changes background lightness and warmth only — accent colors are shared",
  "WebGL이 빠르다 · 잔상이 보일 때만 DOM으로": "WebGL is faster · switch to DOM only if you see ghosting",
  "WebGL (기본)": "WebGL (default)",
  "자동 실행 없이 화면 상태만 복원합니다": "Restores screen state only, nothing runs automatically",
  "앱을 다시 켰을 때 페인에 다시 그리는 줄 수": "Lines redrawn in each pane when the app restarts",
  "워크스페이스당 세션 수의 상한 · 줄여도 이미 열린 세션은 닫지 않는다":
    "Session limit per workspace · lowering it doesn't close open sessions",
  "workspaces.json · layout.json은 버전 업에도 남는다": "workspaces.json · layout.json survive version updates",
  "검증된 CLI와 관측 어댑터는 고정 정책이다 · 상태 줄 표시만 고른다":
    "Verified CLIs and observation adapters are fixed policy · only the status line is selectable",
  "사람의 행동이 필요한 상태만 알립니다 · 꺼도 인앱 미확인은 유지됩니다":
    "Notifies only states that need a human · in-app unseen marks stay even when off",
  "완료 보고는 에이전트가 끝났다고 밝힌 것 · 턴 완료는 하루 수십 번이라 기본 끔 · 인앱 칩은 설정과 무관하게 뜬다":
    "A completion report is the agent saying it's done · turn ends happen dozens of times a day, so off by default · in-app chips show regardless",
  "승인·입력 대기가 되면 소리를 냅니다 · 창이 포커스면 내지 않는다":
    "Plays a sound when waiting for approval or input · silent while the window is focused",
  켜짐: "On",
  "세션 메모리가 넘으면 배너로 알린다 — 소프트 경고만": "Shows a banner when a session exceeds it — soft warning only",
  "같은 세션 반복 합치기": "Merge repeats from one session",
  "60초 안의 반복을 합친다 · 완료 알림은 따로 센다": "Repeats within 60s are merged · completion alerts count separately",
  "60초": "60s",
  "훅 기반 상태 감지": "Hook-based state detection",
  "Stop · Notification 훅으로 idle·waiting을 판정한다": "Stop · Notification hooks decide idle and waiting",
  "항상 켬": "Always on",
  "창이 포커스면 OS 알림을 내지 않는다": "No OS notification while the window is focused",
  "스크롤백에 색 시퀀스를 남긴다 · 끄면 용량 절감": "Keeps color sequences in scrollback · turn off to save space",
  "메시지 · 스크롤백 보존": "Message · scrollback retention",
  "30일": "30 days",
  "버전 업 때 session.db": "session.db on version update",
  "지우지 않고 .bak으로 옮긴다 · workspaces.json · layout.json은 남긴다":
    "Moved to .bak, not deleted · workspaces.json · layout.json are kept",
  "캐릭터 시트 상한": "Character sheet limit",
  "SessionStart 훅이 싣는 시트 본문": "Sheet body loaded by the SessionStart hook",
  "4,000자": "4,000 chars",
  "브라우저 결과 상한": "Browser result limit",
  "snapshot · get-text 한 번": "One snapshot · get-text call",
  "10,000자": "10,000 chars",
  "권한 우회": "Permission bypass",
  "bypass를 쓰지 않는다 — 승인은 사람이 터미널 페인에서": "Never bypassed — a human approves in the terminal pane",
  "항상 끔": "Always off",
  "외부 열기": "External open",
  "http/https만 연다 · 원격 주소의 토큰은 화면·툴팁·링크 어디에도 나오지 않는다":
    "Opens http/https only · tokens in remote URLs never appear on screen, in tooltips or links",
  "메시지 경계 문장": "Message boundary sentence",
  "팀원·다른 프로젝트 메시지는 요청일 뿐 — 승인·허가로 쓰지 않는다":
    "Messages from teammates or other projects are requests only — never approval or permission",
  "역할 파일에 포함": "In role files",
  "이벤트 방송 범위": "Event broadcast scope",
  "PTY 출력·메시지·상태 이벤트는 main 창에만": "PTY output, message and state events go to the main window only",
  "단축키 (읽기 전용)": "Shortcuts (read-only)",
};
