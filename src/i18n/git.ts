// git 영역 사전 — GitDiffEditor.tsx · GitPanelTab.tsx · backend/git.ts 의 한국어 원문(키) → 영어.
// i18n.ts가 병합한다. 공용 용어(세션·워크스페이스 등)는 common.ts 것을 재사용한다.
export const dict: Record<string, string> = {
  // ── backend/git.ts ──
  "브라우저 dev — 실측 없음": "Browser dev — no live data",

  // ── GitDiffEditor.tsx ──
  "목 데이터 — 실측 없음": "Mock data — no live read",
  "{n}줄 접힘 — 펼치기": "{n} lines folded — expand",
  "변경 파일": "Changed files",
  "· 실측": "· live",
  "· 목": "· mock",
  "파일 필터…": "Filter files…",
  "새 파일만": "Added only",
  수정만: "Modified only",
  삭제만: "Deleted only",
  이름변경만: "Renamed only",
  "변경 파일을 읽을 수 없습니다 — git 저장소가 아니거나 git CLI가 없습니다":
    "Cannot read changed files — not a git repository or git CLI is missing",
  "다시 시도": "Retry",
  "이 커밋에는 변경 파일이 없습니다": "This commit has no changed files",
  "변경된 파일이 없습니다 — 워크트리가 깨끗합니다": "No changed files — the worktree is clean",
  "검색 결과 없음": "No matches",
  "읽는 중…": "Reading…",
  "⟳ 새로 읽기": "⟳ Refresh",
  "파일을 선택하세요": "Select a file",
  "비교 · 부모 커밋 {base} ↔ {hash} · {stat}": "Compare · parent commit {base} ↔ {hash} · {stat}",
  "비교 · {base} ({branch}) ↔ 워크트리 · {stat} — 커밋·편집은 터미널에서":
    "Compare · {base} ({branch}) ↔ worktree · {stat} — commit/edit in the terminal",
  "변경 {cur}/{total}": "Change {cur}/{total}",
  "변경 없음": "No changes",
  "이전 변경 (p)": "Previous change (p)",
  "다음 변경 (n)": "Next change (n)",
  "전체 문맥 보기": "Show full context",
  "변경 ±{n}줄만 보기": "Show only changes ±{n} lines",
  "전체 문맥": "Full context",
  변경만: "Changes only",
  줄바꿈: "Wrap",
  "닫기 (Esc) — 진입한 화면으로 복귀": "Close (Esc) — return to previous screen",
  "비교 대상 — 부모 커밋 ({base})": "Base — parent commit ({base})",
  "비교 대상 — 기준 커밋 ({base})": "Base — base commit ({base})",
  "커밋 직전 내용": "Content just before this commit",
  "HEAD 커밋 시점 내용": "Content at the HEAD commit",
  "🔒 읽기 전용": "🔒 Read-only",
  "(이 시점에는 파일이 없습니다 — 새 파일)": "(file does not exist at this point — new file)",
  "비교 대상 없음 — 새 파일입니다": "No base — this is a new file",
  "이 파일의 내용을 표시할 수 없습니다": "Cannot display this file's contents",
  "현재 — 이 커밋 ({hash})": "Current — this commit ({hash})",
  "현재 — 워크트리": "Current — worktree",
  "커밋된 내용": "Committed content",
  "현재 파일 내용": "Current file content",
  "(이 커밋에서 삭제된 파일입니다)": "(file deleted in this commit)",
  "워크트리에 없음 — 삭제된 파일입니다": "Not in the worktree — this file was deleted",
  "변경 {n}로 이동": "Go to change {n}",
  "첫 변경으로 이동": "Go to the first change",
  "이 파일 +{a} −{d} · 전체 {n}파일": "This file +{a} −{d} · {n} files total",
  "기준 {base}": "Base {base}",
  "{n}개 파일": "{n} files",
  // diff.rs가 돌려주는 오류·통계 문자열 (U65 — English 설정에서도 한국어로 나오던 것)
  바이너리: "binary",
  "파일을 읽을 수 없습니다 (바이너리 또는 없음)": "Cannot read the file (binary or missing)",
  "바이너리 파일 — 텍스트 비교 불가": "Binary file — text comparison unavailable",
  "워크스페이스 밖 경로": "Path outside the workspace",
  "잘못된 커밋 해시": "Invalid commit hash",
  "3,000줄에서 잘림": "truncated at 3,000 lines",
  "git diff {a}^ {b} 실측": "git diff {a}^ {b} (live)",
  "git diff -U999999 실측": "git diff -U999999 (live)",
  "목 데이터": "Mock data",
  실측: "live",

  // ── GitPanelTab.tsx ──
  "변경 {n}건 · diff 보기": "{n} changes · View diff",
  "브라우저 dev — 실제 체크아웃 없음": "Browser dev — no actual checkout",
  "`{cmd}` 복사됨 — 실행은 터미널에서": "`{cmd}` copied — run it in the terminal",
  "새로 읽기": "Refresh",
  "저장소를 읽을 수 없습니다 — git 저장소가 아니거나 git CLI가 없습니다":
    "Cannot read the repository — not a git repository or git CLI is missing",
  "워크스페이스 문맥이 없습니다 — 워크스페이스 탭을 먼저 여세요":
    "No workspace context — open a workspace tab first",
  "저장소 = 활성 워크스페이스": "Repository = active workspace",
  "저장소 선택 = 워크스페이스 전환 — 패널 스코프가 함께 바뀝니다":
    "Selecting a repository switches the workspace — panel scope follows",
  "업스트림 대비 ahead / behind": "ahead / behind upstream",
  "{n}개 변경 파일 — +{a} ~{m} −{d} · HEAD ↔ 워크트리 나란히 비교":
    "{n} changed files — +{a} ~{m} −{d} · HEAD ↔ worktree side by side",
  "`git pull` 복사 — 실행은 터미널에서": "Copy `git pull` — run it in the terminal",
  "`git add -A && git commit` 복사 — 실행은 터미널에서":
    "Copy `git add -A && git commit` — run it in the terminal",
  "`git push` 복사 — 실행은 터미널에서": "Copy `git push` — run it in the terminal",
  "공유 repo의 현재 브랜치를 바꿉니다 — 워크트리 세션은 영향 없음":
    "Changes the shared repo's current branch — worktree sessions unaffected",
  "{msg} — 클릭: 부모 커밋과 나란히 비교(diff)": "{msg} — click: side-by-side diff vs the parent commit",
  "커밋이 없습니다": "No commits",
  "pull · push · commit 버튼은 명령 복사만 — 실행은 터미널에서":
    "pull · push · commit buttons only copy the command — run it in the terminal",
  "해시 복사": "Copy hash",
  "메시지 복사": "Copy message",
  "부모 커밋과 비교 (diff)": "Diff vs parent commit",
  "워크트리 diff 열기": "Open worktree diff",
  "checkout · revert는 두지 않는다 — 터미널에서": "checkout · revert are not offered — use the terminal",
  // ── 0.5 바로 가기 · BR-11 ──
  "원격 저장소": "Remote repository",
  "원격에서 보기 (푸시 안 한 커밋은 없을 수 있음)": "View on remote (unpushed commits may be missing)",
  // ── 0.5.x QA eqmux-8a: 워크스페이스 연결 · 실행 방식 · 기본 터미널 구성 (같은 영역이라 여기 둔다) ──
  "선택한 워크스페이스": "Selected workspace",
  "탭으로 가기": "Go to tab",
  "첫 세션을 어떻게 시작할까요? 나중에 바꿀 수 있어요 · 두 방식 모두 워크스페이스의 슬롯 {n}개를 써요":
    "How should the first session start? You can change it later · both use the workspace's {n} slots",
  "기본 터미널로 시작해요. 역할 팀은 나중에 추가할 수 있고, 두 방식 모두 슬롯 {n}개를 함께 써요.":
    "Starting with a default terminal. You can add a role team later; both share the {n} slots.",
  "역할 팀으로 시작해요. 기본 터미널은 나중에 추가할 수 있고, 두 방식 모두 슬롯 {n}개를 함께 써요.":
    "Starting with a role team. You can add a default terminal later; both share the {n} slots.",
  "기본 터미널이 이미 열려 있습니다 — 탭으로 갑니다": "A default terminal is already open — going to its tab",
  "빈 슬롯이 없습니다 ({n}/{n}) — 세션 하나를 닫고 다시 여세요":
    "No free slot ({n}/{n}) — close a session and open again",
  "사용 중 · {name}": "In use · {name}",
  "직전 비정상 종료 · {n}세션": "Last run ended abnormally · {n} sessions",
};
