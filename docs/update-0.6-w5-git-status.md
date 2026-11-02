# 0.6 W5 git 확장 — 상태

## 이어서 한 일 (2026-11-02 오후)

| 항목 | 내용 | 커밋 |
|---|---|---|
| 탐색기 [파일 히스토리 · blame] | `MissionExplorerTab.tsx`(W4) 파일 행 메뉴 → git 화면 file 모드. 열린 git 화면도 새 파일을 따라간다 | f0514a0 |
| §17-3 세션 배지 | `git_commit_sessions` — 커밋 직전 4시간 안에 그 커밋 파일을 편집 도구로 고친 세션(C4 file_touch). 추정이다(Bash · Codex는 못 잡는다) | f0514a0 |
| §17-3 동시 편집 표시 | 작업 트리 파일 행에 §13-1 경고 배지 | f0514a0 |
| 첫 커밋 전 스테이지 내리기 | HEAD가 없으면 `rm --cached -q --` | f0514a0 |
| B154 | diff · 덩어리 · blame · 충돌 칸에서 `.env` · `.env.*` 값을 가린다. [값 보기] 토글 | f0514a0 |
| index.lock 충돌 | 모든 git 호출에 `--no-optional-locks` (`run_git` 한 곳) | f0514a0 |
| **§17 3단계** | merge · rebase(비대화형) · cherry-pick · revert · stash(push/apply/pop/drop) · reset(soft/mixed/hard) · 분리 체크아웃. 진행 중 배너([충돌 보기] · [세션에게 해결 맡기기] · [계속] · [중단]). 충돌 덩어리별 우리 것/저쪽 것/둘 다. reset --hard는 사라질 커밋 · 변경 수 · 되돌릴 해시를 보이고 두 번 묻는다. `GIT_EDITOR=true`로 편집기에서 멈추지 않는다 | f0514a0 |
| §13-3 기준 모드 (W4 부탁) | `GitDiffEditor` `base` · `only` props, `diff.rs` `diff_changed_files_since` · `file_diff_since`(HEAD 자리에 base) | 4bb8860 |
| 품은 diff 닫기 | `GitDiffEditor`가 화면 자체(`view().kind === "gitdiff"`)일 때만 Esc · ✕로 닫는다. 기준 없는 임무에 품으면 Esc가 관제로 튀던 것 | b792d0d |
| 직함별 담당 경로 (§4 · §13-1) | 배관(직무 · 역할 파일 frontmatter `owns:`, 직무 편집 입력칸)은 W4가 2bff0ba로 넣었다. W5는 새 `owns.rs`: glob(`**` · `*` · `?`, `docs/` · `docs` = 그 폴더 전부, Windows 대소문자 무시), `repo_rel`(gitx에서 옮김 — 워크트리 접두를 뗀다), 역할 파일 owns 읽기, (세션, 파일) 10분 1회. `record_edit`(agent.rs)가 담당 밖 편집이면 `edit-outside-owns` `{ workspace, session, path, owns: string[], ts }`를 낸다. 막지 않는다. owns가 없거나 저장소 밖 파일이면 아무것도 하지 않는다. `eqmux who` 끝에 `내 담당: …` 한 줄(owns 있을 때, list에는 없음). Bash · Codex 편집은 못 잡는다 | 미커밋 |
| U102 | diff 화면 [줄바꿈] 버튼의 ↩ 기호 → `wrap-text` 아이콘(icons.tsx에 Lucide 경로 한 줄) | 미커밋 |
| B132 · B151 워크트리 소속 | `workspace::canon_key` — 실경로(심링크 · mac `/tmp` → `/private/tmp`), Windows `\\?\` 접두 제거, `/`, 끝 `/` 없음, Windows만 소문자. `WorktreeInfo.key`와 새 커맨드 `path_keys(paths)`(세션 cwd용)가 같은 키를 낸다. 프런트 비교(ControlCenter)는 W7 몫. **mac 실기 확인 필요**(대소문자 무시 볼륨에서 철자가 다르면 갈린다) | 미커밋 |

테스트(마지막): `npx tsc --noEmit` 통과, `npm test` 244/244, `cargo test --lib` 237 통과 · 1 실패(ports 기준선, W6), owns 4/4 · canon_key 1/1 · gitx attribute(`repo_rel` 이동 뒤) 통과, clippy W5 파일 경고 없음.

---

## 1라운드 상태

2026-11-02 · W5 eqmux-17 · 근거 `update-0.6-scope.md` §17 · §4-1, 분담 `update-0.6-work-split.md` "W5"

## 한 일

### ① 1단계 — 읽기 확장
- **git 화면**: 새 전체 화면 View `{ kind: "git"; wsId?; back?; file? }`. 왼쪽은 로컬 브랜치(↑↓ · 업스트림 사라짐), 원격, 태그, stash 사이드바다. 가운데는 그래프, 오른쪽은 커밋 상세, 아래는 작업 트리다. Esc와 ✕는 들어온 화면으로 돌아간다.
- **그래프**: `git log --topo-order`를 300개씩 읽고, 스크롤이 끝에 가까워지면 다음 300개를 읽는다. 레인은 프런트 순수 함수 `computeGraph`가 계산한다(G3). 레인 색은 가지마다 고정이다. 브랜치 · 원격 · 태그 · HEAD 라벨은 색으로 나눈다.
- **검색 · 필터**: 메시지 또는 작성자로 거른다(`-F -i`, 글자 그대로 찾는다). "모든 브랜치 / 현재 브랜치"로 범위를 바꾼다. 거르는 중에는 부모가 빠져 레인이 틀리므로 선을 그리지 않는다.
- **커밋 상세**: 작성자 · 메일 · 시각, 커밋한 사람, 부모(누르면 이동), 본문, 변경 파일을 보인다. diff는 기존 `gitdiff` 화면을 그대로 연다.
- **파일 히스토리 · blame**: 상세의 파일 행에서 연다(`--follow`). blame은 `--porcelain`으로 읽고 1만 줄에서 자른다.

### ② 2단계 — 안전한 쓰기 (G7′)
- **실행 경로**: `gitx::run` → `check_args` 허용 목록을 지나야 실행한다. 하위 명령은 fetch · pull · push · add · restore · commit · switch · branch · tag다. 옵션도 하나하나 목록에 있어야 한다. `--force`, `-f`, `--no-verify`, `-n`, `+refspec`, `:refspec`, `clean`, `reset`, `checkout`, `--upload-pack`은 거부한다. pull에는 `--ff-only`가 꼭 있어야 하고, restore에는 `--staged`가 꼭 있어야 한다. `-`로 시작하는 위치 인자는 `--` 뒤에서만 받는다.
- **인증**: `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`로 부른다. 인증에 실패하면 배너가 "터미널에서 `git fetch`를 한 번 실행해 로그인하세요"와 [`git fetch` 복사]를 보인다.
- **실행 로그**: git 화면의 [실행 로그]에 명령, 결과, [명령 복사]가 남는다. 같은 내용을 `events_log`(kind `git`)에도 남겨 로그 패널에 나온다. 훅 출력(stderr)도 보인다.
- **§4-1 작업 중 경고**: pull과 전환에 쓴다. busy · starting은 강한 경고, waiting은 약한 경고, 없으면 바로 실행한다. 자기 워크트리 세션은 뺀다. 확인창에 커밋 안 된 변경 건수와 세션 이름을 보인다. [그래도 실행]을 누른 순간 상태를 다시 보고, 더 나빠졌으면 다시 묻는다. 기본 버튼은 [취소]다.
- **fetch · pull(`--ff-only`) · push**: 업스트림이 없으면 `push -u origin <브랜치>`로 민다. 강제 push는 ▾ 메뉴 안쪽의 `--force-with-lease`만 있고, 확인창과 되돌릴 해시를 거친다.
- **스테이징**: 파일 단위(+/−, 모두), 덩어리 단위(`git apply --cached [--reverse]`). 작업 트리는 건드리지 않는다.
- **커밋 · amend**: amend하려는 커밋이 이미 푸시돼 있으면(`branch -r --contains HEAD`) 확인창이 위험 표시와 되돌릴 해시를 보인다.
- **브랜치**: 만들기(HEAD에서 또는 커밋 · 원격에서), 전환(더블클릭 · 메뉴, §4-1), 이름 변경, 삭제를 한다. 삭제는 `-d`로 하고, 병합 안 된 브랜치라 실패하면 확인창을 거쳐 `-D`로 지운다. **태그**: 가벼운 태그와 주석 태그를 달고, 지울 수 있다.
- **바뀐 뒤 에이전트 알림**: 체크박스로 켜고 끈다. 기본은 꺼짐이고 localStorage에 기억한다. pull · 전환 뒤 HEAD가 바뀌면 `@all`에게 report 한 건을 보낸다.
- 모든 버튼은 우클릭하면 [명령 복사]가 뜬다.

### ③ 사이드 패널 git 탭
- pull은 이제 누르면 실행한다(§4-1 경고 포함). push도 실행한다. commit은 git 화면을 연다. [git 화면 열기] 막대와 메뉴 항목을 더했다. G7 안내 줄 두 곳을 G7′ 문구로 바꿨다.

### 그 밖
- W6 부탁으로 `git_path_status(wsPath, paths)` → `{ path, tracked, ignored }[]`를 더했다(저장소가 아니면 빈 배열).

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `src-tauri/src/gitx.rs` (새 파일) | 읽기 · 상태 · 허용 목록 실행 · 덩어리 적용 · 경로 상태 커맨드 9개 + 테스트 7개 |
| `src-tauri/src/workspace.rs` | `run_git`(env, 다듬지 않은 원래 출력, 성공해도 stderr)을 꺼내고 `git_within`이 이것을 감싼다 |
| `src/screens/GitScreen.tsx` (새 파일) | git 화면 |
| `src/screens/gitGraph.ts` (+test, 새 파일) | 레인 계산 |
| `src/screens/gitWrite.ts` (+test, 새 파일) | 작업 중 경고, 덩어리 나누기 · 패치, 참조 이름 검사 |
| `src/backend/git.ts` (+test) | 래퍼, 실행 로그, `commandLine` |
| `src/components/GitPanelTab.tsx` | 복사 → 실행, git 화면 열기 |
| `src/screens/GitDiffEditor.tsx` | git 화면에서 왔으면 닫을 때 패널을 다시 열지 않는다 |
| `src/i18n/git.ts` | 한 · 영 99키 |

## 남의 파일을 건드린 곳 (국소 수정, 주인에게 알림)
- `lib.rs`(W1 eqmux-88): `mod gitx;` 한 줄, generate_handler에 `gitx::…` 9줄.
- `state.ts`(W7 eqmux-52): View에 `git` 한 줄.
- `App.tsx`(W7): lazy import 한 줄, Match 블록 하나.
- `screens.css`(W7): 파일 끝에 `/* 0.6 W5: … */` 블록.

## 테스트
- `npx tsc --noEmit`: 통과.
- `npm test`: 28개 파일, 197/197 통과(새로 gitGraph 5개, gitWrite 3개, git.test 1개).
- `cargo test --lib`: 196 통과, 2 실패. W5 범위(gitx · workspace · diff) 17/17은 통과했다. 실패 둘은 남의 파일이다: `ports::attributes_a_port_opened_inside_a_session_job`(기준선부터 있던 것, W6)와 `store::corrupt_db_is_moved_aside_and_recreated`(W1이 고치는 중인 store.rs).
- clippy: W5 파일에서 경고 없음.
- 실앱(`tauri dev`)은 띄우지 않았다. 화면 배치와 상호작용은 리드의 실앱 확인이 필요하다.

## 못 한 일 · 남긴 것
- **실앱 확인 전부**: 5천 커밋 스크롤(§17-8), busy 폴더에서 확인창, 자격 증명이 없는 push.
- **탐색기에서 파일 히스토리 열기**: 진입점 `setView({ kind: "git", file })`는 있다. 탐색기 파일(W6 · 리드 2라운드 개편)에 메뉴 항목이 필요하다.
- **§17-3 커밋 ↔ 세션 배지와 동시 편집 배지**: 0.6 1 · 2단계 목록 밖이라 하지 않았다. §13-2 `base_commit`(W4)과 C1(W2)이 생긴 뒤에 붙인다.
- **단축키 표에 git 화면 넣기**: 새 화면 4개(2라운드)와 같이 설계한다.
- **[터미널에서 열기]**: 인증 안내는 명령 복사만 있다. 터미널 페인을 여는 API는 W7 파일에 있다.
- **ssh 호스트 키 · 암호 문구 프롬프트**: GUI에 tty가 없어 실패로 끝나고 안내가 뜬다. `GIT_SSH_COMMAND`로 BatchMode를 강제하지는 않았다. 사용자의 `core.sshCommand`를 덮어쓰기 때문이다.
- **첫 커밋 전 저장소의 스테이지 내리기**: `restore --staged`는 HEAD가 없으면 실패한다. `rm --cached`는 허용 목록에 넣지 않았다.
- **3단계**(merge · rebase · cherry-pick · revert · stash 쓰기 · reset · 진행 중 배너 · 충돌)는 2라운드다. 메뉴에는 "다음 단계"로 표시해 두었다.
