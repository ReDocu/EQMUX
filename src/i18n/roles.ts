// 역할·캐스팅 그룹 사전 — RoleLibrary · TeamCasting · TeamComposition · LaunchMode.
// 키는 코드의 한국어 원문과 바이트 동일. 공용 용어(직무·페르소나·저장 등)는 common.ts가 담당한다.
export const dict: Record<string, string> = {
  // ── LaunchMode ──
  "실행 방식 선택": "Choose launch mode",
  "첫 세션을 어떻게 시작할까요?": "How should the first session start?",
  "기본 터미널 설정 →": "Default terminal setup →",
  "팀 캐스팅 →": "Team casting →",
  "01 저장소 연결": "01 Connect repo",
  "02 실행 방식": "02 Launch mode",
  "03 세션 구성": "03 Session setup",
  "04 시작": "04 Start",
  "선택됨 · 권장": "Selected · recommended",
  권장: "Recommended",
  "역할 없이 현재 저장소에서 바로 시작": "Start right away in the current repo, no roles",
  "일반 셸 작업, 빠른 확인, 수동 명령 실행에 적합합니다. 에이전트 역할과 임무 파일을 요구하지 않으며 필요할 때 팀 세션을 추가할 수 있습니다.":
    "Good for general shell work, quick checks and manual commands. Requires no agent roles or mission files, and team sessions can be added when needed.",
  "⚡ cwd와 셸만 확인하고 즉시 실행": "⚡ Runs immediately — only cwd and shell are confirmed",
  "◌ 역할 · 페르소나 · 임무 지정 없음": "◌ No role · persona · mission assignment",
  "⛁ 동일한 세션 복구 · WAL 보존 정책 적용": "⛁ Same session recovery · WAL retention policy applies",
  "선택됨 · 고급 구성": "Selected · advanced",
  "고급 구성": "Advanced",
  "역할 팀 구성": "Role team setup",
  "역할과 임무를 가진 에이전트 팀 시작": "Start an agent team with roles and missions",
  // 라이브러리 저장 오류 (library.ts) — 사용자에게 그대로 보이는 문구다
  "파일이 밖에서 바뀌었습니다 — 밖의 내용으로 목록을 새로고침했습니다. 항목을 다시 선택해 확인한 뒤 저장하세요":
    "The file changed outside the app — the list now shows the outside content. Re-select the item to review it, then save",
  "시트가 밖에서 바뀌었습니다 — 다시 열어 확인 후 저장하세요":
    "The sheet changed outside the app — reopen it, check, and save again",
  "최대 {n}개 세션에 역할, 페르소나, 권한과 임무를 배정합니다. 병렬 구현, 리뷰, 조사처럼 책임이 분리된 작업에 적합합니다.":
    "Assigns roles, personas, permissions and missions to up to {n} sessions. Good for work with separated responsibilities — parallel implementation, review, research.",
  "✓ 역할 · 페르소나별 세션 구성": "✓ Sessions per role · persona",
  "☰ .eqmux 임무와 권한 정책 연결": "☰ Linked to .eqmux missions and permission policy",
  "▦ 최대 {n}개 책임 영역 병렬 실행": "▦ Up to {n} responsibility areas in parallel",
  "기본 터미널로 시작합니다.": "Starting with the default terminal.",
  "역할 팀 구성으로 시작합니다.": "Starting with role team setup.",
  "역할 팀은 나중에 추가할 수 있으며 일반 터미널도 워크스페이스의 세션 한도를 사용합니다.":
    "Role teams can be added later; plain terminals also count toward the workspace session limit.",
  계속: "Continue",

  // ── TeamCasting ──
  "팀 캐스팅": "Team casting",
  "직무 + 페르소나를 최대 {n}개 세션 슬롯에 배정합니다": "Assign jobs + personas to up to {n} session slots",
  "프리셋 원본:": "Preset source:",
  "앱데이터 presets/*.json": "app data presets/*.json",
  표준: "Standard",
  집중개발: "Dev-heavy",
  제품기획: "Product",
  품질: "Quality",
  "이 슬롯 제거": "Remove this slot",
  "(라이브러리에 없음)": "(not in library)",
  "실행 권한": "Run permissions",
  "— 직무 파일 없음 · 권한 미정": "— no job file · permissions undecided",
  "페르소나 목록에서 선택": "Pick from the persona list",
  "캐스팅 변경 ▾": "Change casting ▾",
  "빈 슬롯 추가 — 직무·페르소나는 추가 후 변경": "Add an empty slot — change job/persona after adding",
  "+ 슬롯 추가": "+ Add slot",
  "페르소나 선택": "Pick persona",
  "{name} — {ws} 활동 중": "{name} — active in {ws}",
  ".eqmux/team.json과 team.md에 저장": "Saved to .eqmux/team.json and team.md",
  "roles/는 합성 후 gitignore · 사용자의 CLAUDE.md는 수정하지 않음":
    "roles/ is synthesized then gitignored · your CLAUDE.md is never modified",
  "편성 저장": "Save composition",
  "편성 선택 →": "Choose composition →",

  // ── TeamComposition ──
  리드: "Lead",
  지도: "Guides",
  "협업 — 전원": "Collab — everyone",
  보고: "Reports",
  검토: "Reviews",
  수정: "Fixes",
  "팀 편성": "Team composition",
  ".eqmux/team.json 원본 · team.md 파생 · LEAD 최대 1명":
    ".eqmux/team.json is the source · team.md derived · at most 1 LEAD",
  "기본 편성 채우기": "Fill default composition",
  "역할 라이브러리": "Role Library",
  "팀 슬롯과 관계": "Team slots & relations",
  "보고 → 지도 ⇢ 리뷰 ◇ 협업 —": "Report → Guide ⇢ Review ◇ Collab —",
  "파일이 원본 · 중복 관계와 자기 참조는 저장 시 제거 · team.json/team.md는 커밋":
    "Files are the source · duplicate relations & self-references removed on save · team.json/team.md are committed",
  "{n}개 세션 시작": "Start {n} sessions",
  "편성이 비었습니다 — 캐스팅을 먼저 하세요": "Composition is empty — do casting first",
  "권한 변경은 재시작 필요": "Permission changes require a restart",
  "파일은 즉시 저장되지만 실행 플래그는 프로세스 수명 동안 고정됩니다.":
    "Files save instantly, but runtime flags stay fixed for the process lifetime.",
  "변경 저장": "Save changes",

  // ── RoleLibrary — 목록·생성 ──
  "전역 라이브러리에 추가 — 단계를 고릅니다": "Add to the global library — pick a level",
  "+ 페르소나 추가": "+ Add persona",
  단계: "Level",
  기본: "Basic",
  중급: "Intermediate",
  고급: "Advanced",
  "이름 · 색 · 판단 성향": "Name · color · judgment style",
  "+ 말투 · 성격 옵션": "+ tone · personality options",
  "+ 캐릭터 시트 (personas/<id>.character.md)": "+ character sheet (personas/<id>.character.md)",
  "워크스페이스 오버라이드 — .eqmux/jobs가 원본": "Workspace override — .eqmux/jobs is the source",
  "워크스페이스 오버라이드 — .eqmux/personas가 원본": "Workspace override — .eqmux/personas is the source",
  금지: "Forbidden",
  "중급 — 말투·성격까지 주입됩니다": "Intermediate — tone & personality are injected too",
  "고급 단계 — 캐릭터 시트:": "Advanced — character sheet:",

  // ── RoleLibrary — 직무 편집 ──
  "직무 편집": "Edit job",
  "기본 권한 — 실행 플래그로 번역됩니다": "Default permissions — translated into runtime flags",
  책임: "Responsibility",
  원본: "Source",
  ".eqmux/jobs/*.md (WS 오버라이드)": ".eqmux/jobs/*.md (WS override)",
  "앱 데이터 jobs/*.md": "App data jobs/*.md",
  구성: "Roster",
  "8종 고정 — 문구·권한 편집만 가능, 지워도 부팅 시 부활":
    "Fixed set of 8 — only copy & permissions editable; revived at boot if deleted",
  "권한 반영": "Permissions apply",
  "캐스팅 세션은 재시작 때": "To cast sessions on restart",
  "오버라이드 항목 — 원본은 워크스페이스 .eqmux/jobs/{id}.md 파일입니다. 편집 커맨드는 전역에만 씁니다 — 파일을 직접 고치거나 탐색기에서 편집하세요":
    "Override entry — the source is the workspace .eqmux/jobs/{id}.md file. Edit commands write only to the global library — edit the file directly or via the explorer",
  "직무 또는 페르소나를 선택하면 편집합니다": "Select a job or persona to edit",

  // ── RoleLibrary — 페르소나 편집 ──
  "페르소나 편집": "Edit persona",
  "단계 — 단계마다 독립 프로필(성향·말투·성격). 전환해 각각 편집하고, 활성 단계만 주입됩니다 (저장 시 적용)":
    "Level — each level keeps an independent profile (style · tone · personality). Switch to edit each; only the active level is injected (applied on save)",
  "이름 (세션 이름과 분리 가능)": "Name (can differ from the session name)",
  "색 — 직무 팔레트와 정렬 (점 글자 = 직무 앞글자) · UI 표시 전용":
    "Color — aligned with the job palette (dot letter = job initial) · display only",
  색: "color",
  기획: "Planning",
  개발: "Dev",
  디자인: "Design",
  디버거: "Debugger",
  문서: "Docs",
  릴리즈: "Release",
  "기본 직무 — 역할 부여가 직무 선택 없이 이 값을 따릅니다 (미지정이면 부여 시 개발)":
    "Default job — role assignment follows this without a job picker (Dev if unassigned)",
  미지정: "Unassigned",
  "판단 성향 ({lvl} 프로필) — 판단 우선순위 · 강조점 · 금기 · 예산 5~10줄":
    "Judgment style ({lvl} profile) — priorities · emphases · taboos · budget 5–10 lines",
  "예산 초과 — {n}줄 / 권장 {max}줄. 성향 묘사는 토큰만 먹고 품질에 기여하지 않습니다":
    "Over budget — {n} lines / {max} recommended. Long style descriptions only burn tokens without improving quality",
  "말투 ({lvl} 프로필) — 응답의 어조. 비우면 지시하지 않음": "Tone ({lvl} profile) — the voice of responses. Empty = not instructed",
  "간결한 존댓말": "Concise formal",
  "친근한 반말": "Friendly casual",
  "차분한 설명형": "Calm explanatory",
  "건조한 보고체": "Dry report style",
  "예: 간결한 존댓말 · 결론부터 말한다": "e.g. Concise formal · conclusion first",
  "성격 ({lvl} 프로필) — 행동 경향 1~{max}줄. 판단과 겹치면 판단 성향에":
    "Personality ({lvl} profile) — behavior tendencies, 1–{max} lines. If it overlaps judgment, put it in judgment style",
  "예: 신중함 — 되돌릴 수 없는 결정을 늦춘다": "e.g. Cautious — delays irreversible decisions",
  "예산 — 말투·성격 각 {max}줄 권장. 긴 캐릭터 묘사는 토큰만 먹습니다":
    "Budget — {max} lines each for tone & personality recommended. Long character prose only burns tokens",

  // ── RoleLibrary — 캐릭터 시트 ──
  "캐릭터 시트 (고급 프로필) — 고급은 시트가 페르소나의 전부입니다. 정체성·성격·말투 규칙을 시트에 적으세요":
    "Character sheet (advanced profile) — at advanced level the sheet IS the persona. Write identity, personality and tone rules in the sheet",
  "personas/<id>.character.md 템플릿 생성 — 이름·출처만 채워도 에이전트가 원전 지식으로 보완합니다":
    "Creates a personas/<id>.character.md template — fill just name & source and the agent supplements it with canon knowledge",
  "캐릭터 시트 생성": "Create character sheet",
  "시트 닫기": "Close sheet",
  "시트 편집": "Edit sheet",
  "시트 삭제": "Delete sheet",
  "오버라이드 시트는 .eqmux/personas 파일을 직접 편집하세요": "For override sheets, edit the .eqmux/personas file directly",
  "앱 내 편집 — 저장 시 캐스팅 세션에 알립니다": "In-app editing — cast sessions are notified on save",
  "시트 파일 삭제 — 단계 설정(고급)은 유지됩니다": "Deletes the sheet file — the level setting (advanced) is kept",
  "시트 저장됨 ✓ — 캐스팅 세션에 알림": "Sheet saved ✓ — cast sessions notified",
  "시트 저장": "Save sheet",

  // ── RoleLibrary — 원본·삭제 ──
  ".eqmux/personas/*.md (WS 오버라이드)": ".eqmux/personas/*.md (WS override)",
  "앱 데이터 personas/*.md": "App data personas/*.md",
  주입: "Injection",
  ".eqmux/roles/<세션>.md 합성 — 시트는 경로 포인터만": ".eqmux/roles/<session>.md synthesis — the sheet is only a path pointer",
  "오버라이드 항목 — 원본은 워크스페이스 .eqmux/personas/{id}.md 파일입니다. 편집 커맨드는 전역에만 씁니다 — 파일을 직접 고치거나 탐색기에서 편집하세요":
    "Override entry — the source is the workspace .eqmux/personas/{id}.md file. Edit commands write only to the global library — edit the file directly or via the explorer",
  "오버라이드는 .eqmux 파일에서 지웁니다": "Overrides are deleted from the .eqmux file",
  "캐스팅된 페르소나는 삭제할 수 없습니다": "A cast persona cannot be deleted",
  "personas/<id>.md 파일 삭제": "Deletes the personas/<id>.md file",
  "(캐스팅 중)": "(in casting)",
  "팀 편성 저장 실패 — {err}": "Team save failed — {err}",

  // ── 0.5 W3 · 직함·추천 칩·캐스팅 직무 변경 ──
  "직함 — 직무 안에서 맡는 영역 (선택). 모든 워크스페이스의 이 페르소나에 쓰입니다": "Title — the area this persona covers within its job (optional). Used in every workspace",
  "예: 클라이언트 개발자": "e.g. Client developer",
  "이 슬롯의 직무를 바꿉니다 — 실행 권한이 따라 바뀝니다": "Change this slot's job — its run permissions change with it",
  "직무 변경 ▾": "Change job ▾",
  "직무 선택": "Choose job",
  "테크 리드": "Tech lead",
  "프로젝트 리드": "Project lead",
  "기획자": "Planner",
  "시스템 기획자": "Systems designer",
  "콘텐츠 기획자": "Content designer",
  "클라이언트 개발자": "Client developer",
  "서버 개발자": "Server developer",
  "프런트엔드 개발자": "Frontend developer",
  "백엔드 개발자": "Backend developer",
  "툴 개발자": "Tools developer",
  "UI 디자이너": "UI designer",
  "UX 디자이너": "UX designer",
  "QA 엔지니어": "QA engineer",
  "테스트 자동화 담당": "Test automation",
  "장애 대응 담당": "Incident response",
  "테크니컬 라이터": "Technical writer",
  "릴리즈 매니저": "Release manager",
  "빌드 엔지니어": "Build engineer",
  // ── 0.5 W2 시안 적용 — LaunchMode (xfVq4) ──
  "→ 계속": "→ Continue",
  "← 저장소 연결": "← Connect repository",
  "역할 팀": "Role team",
  "셸만 연다. 에이전트는 필요할 때 사람이 직접 띄운다. 자동 이름은 프로젝트명XX(EQMUX01…)이고, 만들 때 직접 정할 수도 있다.":
    "Opens a shell only. You launch an agent yourself when needed. Auto names are ProjectNN (EQMUX01…), or set one when creating.",
  "세션 이름 · 번호가 헤더와 레일에 붙는다": "Session name · number shown in the header and rail",
  "손으로 띄운 claude에는 기본으로 메시지를 쌓아 둔다 (넣기 칩) · 설정에서 idle 자동 넣기로 변경":
    "Messages for a hand-launched claude are held by default (insert chip) · switch to auto-insert when idle in Settings",
  "역할 팀은 나중에 팀 캐스팅으로 추가": "Add a role team later with team casting",
  "다음 → 기본 터미널 구성 (셸 · 브랜치 · 이름)": "Next → default terminal setup (shell · branch · name)",
  "페르소나·직무·직함을 슬롯에 배정해 Claude Code·Codex 세션을 띄운다. 역할 파일과 team.md가 합성되고 메시지 버스가 켜진다.":
    "Assigns personas, jobs and titles to slots and launches Claude Code·Codex sessions. Role files and team.md are synthesized and the message bus turns on.",
  "직함으로 맡는 영역을 나눈다 (클라이언트 · 서버 개발자)": "Titles split areas of ownership (client · server developer)",
  "완료 신호 · 열린 handoff 회신 · 프로젝트 간 통신": "Done signals · replies to open handoffs · cross-project messages",
  "프리셋: {list}": "Presets: {list}",
  "다음 → 팀 캐스팅 → 팀 편성 → 관제": "Next → team casting → team composition → control",
  "헤더 예": "Header",
  카이: "Kai",
  // ── 0.5 W2 시안 적용 — TeamCasting (cjWtF) ──
  "페르소나를 {n}개 슬롯에 배정한다 · 다시 적용해도 남은 세션의 슬롯 번호는 그대로, 새 페르소나만 빈 슬롯에 들어간다":
    "Assign personas to {n} slots · re-applying keeps the slot numbers of remaining sessions; only new personas take empty slots",
  "편성 저장 · .eqmux/team.json · team.md": "Save team · .eqmux/team.json · team.md",
  "저장됨 ✓ · .eqmux/team.json · team.md": "Saved ✓ · .eqmux/team.json · team.md",
  "유지 · {n} 그대로": "Kept · stays {n}",
  "새 슬롯": "New slot",
  "직함 없음 — 역할 파일에 추가 토큰 0": "No title — adds 0 tokens to the role file",
  "직무 (이 슬롯만)": "Job (this slot only)",
  "페르소나 변경": "Change persona",
  "페르소나 배정": "Assign persona",
  "기본 터미널 · {name}": "Default terminal · {name}",
  "빈 슬롯 · 기본 터미널은 관제에서 만든다 (자동 이름 {name})": "Empty slot · create default terminals from Control (auto name {name})",
  "편성은 저장하거나 편성 선택으로 넘어갈 때 .eqmux/team.json과 team.md에 적힌다. 직함은 페르소나 직함을 쓰고, 슬롯만 바꾸려면 세션 상세에서 덮어쓴다. roles/는 합성 후 gitignore · 사용자의 CLAUDE.md는 수정하지 않음.":
    "The team is written to .eqmux/team.json and team.md when you save or move on to composition. Titles come from the persona; override one slot in Session details. roles/ is gitignored after synthesis · your CLAUDE.md is never modified.",
  // ── 0.5 W2 시안 적용 — RoleLibrary (dwiBK) ──
  "직무 8종 고정 · 세분화는 직함으로 · 직함은 권한·책임·금지를 바꾸지 않는다":
    "8 fixed jobs · refine with titles · titles never change permissions, duties or prohibitions",
  "새 페르소나": "New persona",
  "추천 직함 {n}": "{n} suggested titles",
  "8종 고정 — 문구·권한만 고친다": "8 fixed — edit wording and permissions only",
  "추천 직함 — 직무 '{job}'": "Suggested titles — job '{job}'",
  "모든 워크스페이스가 함께 쓴다": "shared by all workspaces",
  "이 워크스페이스만 쓴다": "this workspace only",
  "기본 직무": "Default job",
  "역할 부여가 직무 선택 없이 이 값을 따릅니다 (미지정이면 부여 시 개발)":
    "Role assignment follows this when no job is chosen (dev if unset)",
  "한 줄 · 24자까지 · 직무 '{job}'의 책임·금지·권한은 그대로, 맡는 영역만 정한다. 모든 워크스페이스의 이 페르소나에 쓰인다":
    "One line · up to 24 chars · job '{job}' duties, prohibitions and permissions stay; this only names the area. Used for this persona in every workspace",
  "추천 직함 — 직무 '{job}' · 누른 말이 그대로 직함이 된다": "Suggested titles — job '{job}' · the chip text becomes the title as is",
  "저장하면 {name}가 들어간 세션 {n}개의 역할 파일과 팀원 {m}명의 팀 관계 표를 다시 만들고 '[EQ] 역할 갱신 — .eqmux/roles/<세션>.md 다시 읽기' 한 줄을 보낸다. 재시작 배지는 뜨지 않는다.":
    "Saving rebuilds the role files of {n} session(s) with {name} and the team tables of {m} teammate(s), and sends one line '[EQ] 역할 갱신 — .eqmux/roles/<session>.md 다시 읽기'. No restart badge.",
  // ── 0.5.x QA eqmux-66: 캐스팅 확인창 · 자리 없음 · 리드 1명 (B69 · B70 · B101 · P35) ──
  "{name} 종료 — 세션과 PTY가 끝납니다": "{name} stops — the session and its PTY end",
  "{name} 직무 {from} → {to} — 재시작해야 반영됩니다": "{name} job {from} → {to} — takes effect after a restart",
  "{name} 새로 — 빈 슬롯에 셸로": "{name} new — a shell in an empty slot",
  "{name} 자리 없음 — 빠집니다": "{name} has no slot — left out",
  "자리를 늘리려면 설정에서 슬롯 수를 올리거나 기본 터미널을 닫으세요": "To make room, raise the slot count in Settings or close a default terminal",
  "편성을 적용할까요?": "Apply this lineup?",
  "적용하면 아래가 바로 일어납니다. 종료된 세션은 되돌릴 수 없습니다.": "Applying does the following right away. Stopped sessions can't be brought back.",
  "자리 없음 — 적용하면 빠집니다": "No slot — left out when applied",
  "리드는 1명": "one lead only",
  "지금 편성": "Current lineup",
  "지금 돌고 있는 편성으로 되돌린다": "Go back to the lineup running now",
  // ── 0.5.x QA eqmux-66: 역할 라이브러리 편집 보호 (B95 · B96 · B97 · U57) ──
  "이름을 입력하세요": "Enter a name",
  "이미 쓰는 이름입니다": "This name is already in use",
  "삭제 실패 — {err}": "Delete failed — {err}",
  "캐릭터 시트를 삭제할까요?": "Delete the character sheet?",
  "페르소나를 삭제할까요?": "Delete this persona?",
  "파일을 지웁니다. 앱 안에서는 되돌릴 수 없습니다.": "This deletes the file. It can't be undone in the app.",
  "저장하지 않은 편집이 있습니다": "You have unsaved edits",
  "이동하면 고친 내용이 사라집니다. 남기려면 취소하고 [저장]을 누르세요.": "Moving on discards your edits. To keep them, cancel and press [Save].",
  "버리고 이동": "Discard and move on",
};
