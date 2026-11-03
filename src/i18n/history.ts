// 과거 세션 검색 사전 (0.6 §4 · W3) — HistorySearch.tsx 의 한국어 원문(키) → 영어. i18n.ts가 병합한다
export const dict: Record<string, string> = {
  "과거 세션 검색": "Past session search",
  "이 워크스페이스에서 돈 Claude Code 대화에서 찾습니다 (Enter)": "Searches Claude Code conversations that ran in this workspace (Enter)",
  "찾을 말…": "Search for…",
  "찾는 중…": "Searching…",
  "찾기": "Search",
  "워크스페이스를 고르세요": "Pick a workspace",
  "맞는 대화가 없습니다": "No matching conversations",
  "대화 {n}개 · 줄 {m}개": "{n} conversations · {m} lines",
  "앱 밖 · 옛 대화": "Outside the app · older conversation",
  "사람": "Person",
  "에이전트": "Agent",
  "재개": "Resume",
  "세션으로 가기": "Go to session",
  "재개 명령 복사": "Copy resume command",
  "복사했습니다 — 이 폴더의 터미널에 붙여 넣으세요": "Copied — paste it into a terminal in this folder",
  "슬롯의 마지막 대화가 아니라 앱에서 재개할 수 없습니다 — 명령을 복사해 터미널에서 이어 가세요":
    "Not the slot's latest conversation, so the app can't resume it — copy the command and continue in a terminal",
  "Codex 대화와 워크트리 세션은 아직 찾지 않습니다": "Codex conversations and worktree sessions aren't searched yet",
  // 서브에이전트 목록 (SubagentList.tsx)
  "서브에이전트": "Subagents",
  "설명 없음": "No description",
  // ── 0.6 QA eqmux-52: B186 · P85 ──
  "복사했습니다 — 터미널에 붙여 넣으면 {path}로 옮겨 재개합니다": "Copied — paste it into a terminal to move to {path} and resume",
  "검색하지 못했습니다 — {err}": "Search failed — {err}",
  // ── 0.6 QA 3차: B252 ──
  "일부 기록을 읽지 못했습니다 — 대화 파일 {n}개": "Some history couldn't be read — {n} conversation files",
};
