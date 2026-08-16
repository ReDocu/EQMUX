// 임무 그룹 사전 — Missions.tsx · MissionExplorerTab.tsx 의 한국어 원문(키) → 영어. i18n.ts가 병합한다.
export const dict: Record<string, string> = {
  // ── 임무 배정 화면 (Missions.tsx) ──
  "임무 배정": "Mission assignment",
  ".eqmux/missions/*.md 가 원본 · 상태 뱃지 클릭 = 단계 전환 · 세션 클릭 = 배정 토글":
    ".eqmux/missions/*.md is the source of truth · click status badge = next stage · click session = toggle assignment",
  "← 컨트롤 센터": "← Control center",
  "클릭하면 다음 단계로": "Click for next stage",
  "기본 임무 해제 (FR-E-56)": "Unset default mission (FR-E-56)",
  "기본 임무로 지정 — 임무 없는 새 역할 세션이 자동 배정받습니다":
    "Set as default mission — new role sessions without a mission are auto-assigned to it",
  "★ 기본": "★ Default",
  "브랜치 미연결": "no branch linked",
  "공유 repo의 현재 브랜치를 바꿉니다 — 워크트리 세션은 영향 없음 (FR-E-52)":
    "Changes the shared repo's current branch — worktree sessions unaffected (FR-E-52)",
  "공유 repo 전환 확정?": "Confirm shared repo switch?",
  "⎇ 체크아웃": "⎇ Checkout",
  "브라우저 dev — 실제 체크아웃 없음": "Browser dev — no actual checkout",
  "체크아웃 완료 — 공유 세션 전체에 적용됨": "checked out — applied to all shared sessions",
  "체크아웃 실패": "Checkout failed",
  "세션 없음 — 캐스팅을 먼저 하세요": "No sessions — run casting first",
  "새 임무": "New mission",
  "임무 이름": "Mission name",
  "목표 — 완료 조건을 측정 가능하게": "Goal — make the completion criteria measurable",
  "브랜치 (선택 · E12)": "Branch (optional · E12)",
  "임무 생성": "Create mission",
  "생성하면 .eqmux/missions/<id>.md 파일이 만들어지고 DB는 캐시로 따라갑니다. 불일치 시 파일이 이깁니다 (불변 규칙 4).":
    "Creating writes .eqmux/missions/<id>.md; the DB follows as a cache. On mismatch the file wins (invariant 4).",

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
};
