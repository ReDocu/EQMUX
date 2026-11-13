# 코드 리뷰 — 커밋 안 된 변경 (vt100 줄 조립기 · 포터블 전용 CI) · 2026-11-03

범위: `git diff` 작업 트리(sub_main). 코드 변경은 `src-tauri/src/store.rs`(LineAssembler를 vt100 가상 화면으로 교체)와 `src-tauri/src/lib.rs`(PTY 크기 추적), `.github/workflows/build.yml`(`--no-bundle`)이다.
확인: `cargo test --lib store`가 20개 모두 통과했다. 아래 1~3은 vt100 0.18.1로 만든 스크래치 프로브에서 실제로 재현했다.

## 1. [높음] 화면 지우기(ED 2)를 만나면 화면에 있던 줄이 저장되지 않는다
- 위치: `store.rs` `Spill::on_scroll`. vt100의 `erase_all`은 콜백을 부르지 않고 행만 비운다.
- 재현: 10행 화면에 `line1..3` 뒤 `ESC[2J ESC[H after` → 저장 결과 `["after"]`. line1~3은 사라진다.
- 실제로 일어나는 곳: `cls`, `Clear-Host`, `clear`, 에이전트 `/clear`. 옛 조립기는 `\n`마다 확정했기 때문에 이런 손실이 없었다.
- 고칠 방향: CSI `J`(인자 2·3)와 `ESC c`를 보기 전에 화면의 비어 있지 않은 행을 먼저 밀어내 확정한다. `finish()`에서 쓰는 방식을 그대로 쓰면 된다.

## 2. [높음] 화면에 보이는 줄은 세션이 끝날 때까지 스토어에 없다
- 줄은 화면 위로 밀려나야 확정된다. 그래서 페인 높이만큼의 최근 출력(마지막 1행 포함)은 `finish()` 전까지 저장되지 않는다.
- 영향:
  - 세션이 살아 있는 동안 `scrollback_tail`(TranscriptPane 폴백 · `TranscriptPane.tsx:49`)과 `scrollback_page` 검색에 가장 최근 출력이 빠진다. 40행 페인에서 짧은 명령 출력은 아예 보이지 않는다.
  - 크래시·강제 종료·전원 차단 때는 화면 한 장이 통째로 사라진다(옛 조립기는 미완성 줄 하나만 잃었다).
  - 정상 종료도 `app_exit`의 200ms 유예(`lib.rs:2548`) 안에 리더가 `finish()`까지 가야 저장된다. 판돈이 줄 1개에서 화면 1장으로 커졌다.
- 코드 주석(`ponytail:`)은 크래시 경우만 적었다. 실행 중에 조회가 비는 문제는 적혀 있지 않다.

## 3. [중간] `finish()` 경로가 TUI 잔해 필터를 건너뛴다
- 위치: `lib.rs:730`. `push` 콜백에는 `is_tui_noise`와 `last_spilled` 중복 거르기가 있지만, `finish` 콜백에는 둘 다 없다.
- 옛 조립기에서는 `finish`가 미완성 줄 하나만 냈기 때문에 문제가 없었다. 이제는 화면 전체를 내놓는다.
- 재현: 종료 시점 화면이 `answer` 다음에 Ink 입력창 `╭──╮ │ > _ │ ╰──╯`이면, 테두리 3줄이 그대로 저장된다. 에이전트 세션마다 재생 끝에 입력창 잔해가 남는다.
- 고칠 방향: `push`와 같은 클로저를 두 곳에서 같이 쓴다.

## 4. [낮음·의심] PTY 크기가 바뀐 것을 리더가 ConPTY 리페인트를 읽은 뒤에야 안다
- 위치: `lib.rs` `pty_resize`. `size.store`는 `m.resize()`가 돌아온 **뒤**에 실행된다. 그런데 같은 함수 주석에는 ResizePseudoConsole이 리페인트를 파이프에 동기로 밀어 넣는다고 적혀 있다. 따라서 리페인트는 대개 옛 크기의 가상 화면에서 처리된다.
- 프로브로 만든 단순한 경우에서는 손실이나 중복이 재현되지 않았다. 실제 ConPTY 출력으로는 확인하지 못했다.
- 비용 없는 수정: `resize_is_current` 확인 바로 뒤, `m.resize()` 앞에서 `size.store`를 한다. 같은 함수에서 `resize_hint`를 먼저 찍는 것과 같은 원리다.

## 5. [낮음] 주석·잔여 코드
- `lib.rs:646` 주석 "꺼져 있으면 조립기가 색 사본 자체를 만들지 않는다 (C9)"가 이제 틀렸다. `write_formatted_basic`은 항상 SGR을 넣어 만들고, 평문은 나중에 벗겨 낸다. CPU·RAM 절감(C9)이 사라졌으니 주석을 고치거나 절감을 포기한다고 적는다.
- `lib.rs:737` `if sgr_on { styled } else { None }`은 조립기가 이미 같은 처리를 하므로 중복이다.
- `scroll_up`은 `scroll_top == 0`일 때만 콜백을 부른다. 위쪽 고정 영역(DECSTBM top>0)을 쓰는 TUI의 출력은 저장되지 않는다. 드문 경우라 기록만 해 둔다.

## CI (`build.yml`) — 문제 없음
`--no-bundle`과 포터블 zip만 올리는 변경은 1.0 전 설치본 금지 정책과 맞다. mac 잡과 릴리스 잡에는 NSIS 산출물을 참조하는 곳이 남아 있지 않다. 다만 `tauri.conf.json`의 `targets: ["nsis"]`는 그대로라서, 로컬에서 `npm run tauri build`를 하면 setup.exe가 계속 만들어진다(`명령어 정리.md §4`에 적힌 그대로다).
