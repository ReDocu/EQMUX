# EQMUX macOS QA — 0.6.5 새 기능

2026-11-24 · 브랜치 `main` · 기준 `bb18202`(0.6.5 릴리스) · 리드 실기 · 원장 `interview.csv`

> 0.6.3 라운드와 한글 입력 후속은 [qa-0.6.3-macos-usability.md](qa-0.6.3-macos-usability.md)에 있다.

## 요약

0.6.5에 새로 들어온 세 기능을 macOS에서 봤다. 환경은 Intel 맥, macOS 15.7.4, 디버그 빌드(`npx tauri build --debug --bundles app`)다.

- **페인 간격(설정 › 일반):** 실앱에서 설명대로 동작했다(T128). 작은 불편은 16px 간격의 분할선 핸들 하나다(U222).
- **⌘⇧←↑↓→ 옆 페인 포커스:** 실앱에서 네 방향 모두 맞았다. 입력칸에서는 가로채지 않는다(T129).
- **저장소 경계 '밖은 읽기만':** 큰 틀은 맞다. BSD `sed -i ''` · `ditto` · `osascript`처럼 macOS에만 있는 쓰기도 막았다(T130). 하지만 macOS 자리에서 세 가지가 나왔다.
  - 쓰기 구멍(B341, 높음)
  - 읽기 명령을 쓰기로 보는 오판(B342)
  - 셸 페인 claude에서 경계가 빠지는 우회(B343)

찾은 다섯 가지와 0.6.3 때의 B333 · B336을 고쳤다. **고친 것은 아직 커밋하지 않았다**(`bb18202` 위 작업 트리).

고친 뒤 디버그 번들을 다시 빌드해 실앱에서도 봤다(T136).

`interview.csv`에 17행을 이어 붙였고, 2행(B333 · B336)의 `제안·기대 동작` 칸 앞에 이번 판정을 덧붙였다. 각 새 행의 `재현 절차·근거` 칸은 `[0.6.5 macOS QA · 리드]` 또는 `[… · 리드 실기]`로 시작한다.

| 분류 | 번호 | 행 | 높음 |
|---|---|---|---|
| 버그 리포트 | B341–B343 | 3 | 1 |
| 불편한 UI/UX | U221–U222 | 2 | 0 |
| 사용성 평가 | P108–P109 | 2 | — |
| 태스크 기반 테스트 | T127–T136 | 10 | — |

## 고친 것

| 번호 | 내용 | 심각도 | 고친 곳 | 확인 |
|---|---|---|---|---|
| B341 | 시스템 · 점 폴더 예외가 쓰기에도 걸려 `~/.zshrc` · `~/.ssh` · LaunchAgents · EQMUX 훅 설정 · `/Applications` · `/usr/local` 쓰기가 통과한다 | 높음 | `cli.rs` `run_slots` · `can_write` · `guard_main` | CLI(T133) · 시험(T135) |
| B342 | macOS 읽기 명령(`shasum` · `md5` · `mdls` · `xattr -l`)을 쓰기로 본다 | 중간 | `cli.rs` `READ_VERBS` · `seg_read_only` | CLI(T133) · 시험(T135) |
| B343 | 로그인 셸의 path_helper가 shim을 뒤로 밀어, 사용자 설정에 따라 셸 페인 claude의 경계가 빠진다 | 중간 | `lib.rs` `write_shell_init` · `shell_launch` · `pty_spawn` | 실앱(T136) · 모의(T134) · 시험(T135) |
| U221 | 셸 페인에서 다른 저장소로 cd해도 claude가 처음 저장소를 경계로 쓴다 | 낮음 | `lib.rs` `write_claude_shim` | 실앱(T136) · 모의(T134 ⑦) |
| U222 | 간격 16px에서 8px 핸들이 간격 가운데만 덮는다 | 낮음 | `PaneDividers.tsx` | 실앱(T136) |
| B333 | Claude 스크래치(`/private/tmp/claude-<uid>/…`)에 Write하면 거부된다(Read는 0.6.5에서 풀림) | 중간 | `cli.rs` `guard_main`(임시 폴더) | CLI(T133) · 시험(T135) |
| B336 | 대소문자 · NFC/NFD · `/tmp` 링크가 다르면 저장소 안을 밖으로 본다 | 낮음 | `cli.rs` `real_path` | CLI(T133) · 시험(T135) |

1. **B341 — 시스템 · 점 폴더 예외를 '돌릴 프로그램' 자리로 좁혔다.**
   - **원인:** 0.6.5는 `/usr` · `/opt` · `/Library` · `/Applications` · `~/Library`와 홈의 점 폴더를 명령 낱말 검사에서 밖으로 치지 않았다. `/usr/bin/env node` · `~/.cargo/bin/cargo` 같은 도구 호출을 막지 않으려는 예외다. 그런데 리다이렉트와 `rm` · `cp` · `tee`의 인자에도 같은 예외가 걸렸다.
   - **결과:** macOS 사용자는 `~/Library` · `/Applications`(admin) · `/usr/local`(Intel Homebrew) · `/opt/homebrew`를 고칠 수 있다. 그래서 셸 시작 파일, SSH 키, 로그인 항목, 그리고 경계 훅을 끌 수 있는 EQMUX `hook-settings.json`까지 Bash로 고칠 수 있었다. Edit · Write 도구에는 이 예외가 없어 막혔다.
   - **고침:** 명령의 낱말을 자리로 나눈다(`run_slots`). 아래 '돌릴 프로그램' 자리에서는 지금처럼 봐준다.
     - 명령 낱말과 그 앞의 환경 변수 대입
     - `source` · `.`의 스크립트
     - `python` · `node` · `bash` 등이 돌릴 스크립트 파일(`-c` · `-e` 같은 인라인 코드 옵션이 먼저면 아니다)
     - `export`류의 `이름=값`
   - 인자와 리다이렉트 자리에서는 사용자가 고칠 수 없는 곳만 봐준다. macOS에서는 `access(W_OK)`로 본다(`/usr/bin`, root의 `/opt`). Windows에서는 SystemRoot · Program Files만 그런 곳으로 본다. 그래서 AppData · ProgramData는 밖이다(Windows 실기 미확인).
   - **남는 것:** 경로 낱말 없이 밖을 고치는 명령(`git config --global` · `defaults write 도메인` · `npm config set`)과 스크립트 파일 안의 쓰기는 여전히 못 본다.
2. **B342 — macOS 읽기 도구를 읽기 명령 목록에 더했다.**
   - 아래 명령을 읽기 명령으로 더했다.
     - 해시 · 메타데이터 도구: `shasum` · `md5` · `sha224/384/512sum` · `b2sum` · `cksum` · `mdls` · `mdfind` · `sw_vers` · `otool` · `nm`
     - 시스템 정보: `uname` · `whoami` · `id` · `printenv`
     - 셸 상태만 바꾸는 내장 명령: `export` · `unset` · `alias` · `declare` · `set` 등
   - 쓰는 옵션이 있는 도구는 그 옵션이 없을 때만 읽기다.
     - `xattr`: `-w` · `-d` · `-c`
     - `defaults`: `read` · `read-type` · `find` · `domains`만 읽기
     - `plutil`: `-convert` · `-insert` · `-o` 등
     - `codesign`: `-s` · `--sign` · `--remove-signature`
     - `spctl` · `lipo -output` · `pkgutil`
   - `open`은 `-R`(Finder에서 보이기) · `-e` · `-t`만 읽기다. 그냥 `open`은 `.command` · `.app`을 실행할 수 있으므로 그대로 막는다.
3. **B343 — 셸 시작 파일로 shim을 다시 맨 앞에 둔다.**
   - **원인:** `pty_spawn`은 shim 폴더를 PATH 맨 앞에 두고 셸을 `-l`로 띄운다. 로그인 zsh는 `/etc/zprofile`에서 path_helper를 돌리고, path_helper는 shim을 14번째로 민다(실앱에서 확인).
   - **이 기기에서 걸린 이유:** 사용자 `.zshrc`가 `~/.local/bin`을 맨 뒤에 붙인다(T131).
   - **빠지는 경우:** 아래 중 하나면 진짜 claude가 먼저 잡혀 경계가 조용히 빠진다(모의 T132).
     - `.zshrc`가 claude 폴더를 앞에 붙인다.
     - claude가 `/usr/local/bin`에 있다.
     - `nvm use`가 claude 폴더를 앞에 붙인다.
   - **고침:** VS Code · Ghostty 셸 통합과 같은 방식이다.
     - **zsh:** ZDOTDIR을 `<앱데이터>/shell/zsh`로 돌린다. 그 안의 `.zshenv` · `.zprofile` · `.zshrc` · `.zlogin`이 사용자 파일을 그대로 읽는다. 읽는 동안에는 ZDOTDIR을 사용자 값으로 돌려 둔다. 다 읽으면 shim을 맨 앞에 두고 ZDOTDIR을 되돌린다. macOS `/etc/zshrc`가 HISTFILE을 ZDOTDIR 기준으로 잡으므로 이것도 사용자 쪽으로 돌린다.
     - **bash:** `--init-file`로 `/etc/profile`과 `~/.bash_profile` · `~/.bash_login` · `~/.profile` 중 첫 것을 읽는다.
     - 프롬프트마다(`precmd` · `PROMPT_COMMAND`) 다시 맞추므로 셸이 뜬 뒤의 `nvm use`도 이긴다.
     - shim이 걸린 페인(저장소 폴더에서 연 페인)만 이렇게 띄운다.
   - **남는 것:** fish · sh는 그대로 `-l`이다. 사람이 `command claude` · 전체 경로 · `exec zsh -l`로 부르면 빠진다.
4. **U221 — shim이 cd를 따른다.** 지금 폴더가 페인 저장소 밖이면, shim이 그 자리의 git 최상위 폴더를 경계로 넘긴다. 페인 저장소 안(하위 폴더 포함)이거나 git 저장소가 아니면 그대로 둔다. Windows `claude.cmd`는 바꾸지 않았다.
5. **U222 — 핸들 폭을 `max(8px, 간격)`으로 바꿨다.** 간격이 8px보다 넓으면 핸들이 간격 전체를 덮는다.
6. **B333 · B336 — 임시 폴더를 열고, 실제 경로로 비교한다.**
   - **B333:** 임시 폴더(`/tmp` · `/private/tmp` · `/var/folders` · `$TMPDIR`)를 엔진 작업 폴더처럼 Write에도 열었다. Bash는 원래 임시 폴더를 봐줬으므로 두 길이 같아졌다.
   - **B336:** 저장소와 대상 경로를 비교 전에 실제 경로로 푼다. 있는 앞부분만 canonicalize하고 나머지를 붙인다.
     - macOS canonicalize는 디스크에 적힌 대소문자와 정규화로 돌려준다. NFC로 넣은 경로가 NFD로 나오는 것을 확인했다. 그래서 대소문자 · NFC/NFD · `/tmp` 링크가 함께 풀린다.
     - 저장소 안 링크가 밖을 가리키면 이제 밖이다. 전에는 안으로 봤다.
     - 아직 없는 새 폴더 이름의 차이는 문자열 그대로 비교한다.
     - `owns.rs`의 담당 경로 경고(S46)는 손대지 않았다.

## 실기 과업 (고치기 전, `bb18202`)

시험 저장소는 `~/eqmux-065-ws`, 밖 파일은 `~/eqmux-065-outside/b.txt`다. 앱은 cmux-cua로 조작했다. EQMUX를 맨 앞에 두는 동안은 사용자가 키보드에서 손을 뗐다.

| 과업 | 결과 |
|---|---|
| T127 빌드 · 자동 시험 | 확인. 디버그 번들 빌드 성공, `tsc` 오류 0, `npm test` 47개 파일 355개 통과. 경고는 `is_powershell` 미사용(cli.rs:176) 하나 |
| T128 페인 간격 | 성공(U222). 0 · 2 · 16px이 바로 `settings.json`의 `paneGap`에 저장되고 그리드에 반영됐다. 분할 비율이 유지됐다. 0px · 16px에서 분할선을 끌 수 있었다 |
| T129 ⌘⇧화살표 | 성공. 네 방향 모두 이웃 페인으로 옮겼다(표식 echo로 확인). 가장자리에서는 그대로이고, 셸에 이스케이프 글자가 남지 않았다. 팀 메시지 입력칸에서는 평소의 '줄 처음까지 선택'이다 |
| T130 `_guard` CLI 실측 | 부분. 35건 가운데 22건이 맞았다(밖 쓰기 거부 12 · 밖 읽기 허용 3 · 파일 도구 5 · `open` 거부 · `/tmp` 쓰기 허용). 13건이 의도와 다르다(B341 7 · B342 4 · B333 1 · B336 1) |
| T131 셸 페인 `claude -p` | 성공(이 기기 설정에서). 밖 Bash 쓰기와 밖 Write는 '막음 …' 문구로 거부됐다. 밖 `cat`은 허용됐고, 파일은 그대로였다(2회). 단 shim은 PATH 14번째였다(B343) |
| T132 로그인 셸 PATH 모의 | 실패 재현. `.zshrc`가 claude 폴더를 앞에 붙이거나, 셸이 뜬 뒤 앞에 붙이거나, bash `~/.bash_profile`이 앞에 붙이면 진짜 claude가 먼저다 |

## 고친 뒤 시험

| 과업 | 결과 |
|---|---|
| T133 `_guard` CLI 실측 | 46건 모두 기대대로다. T130의 35건에 11건을 더했다. 정상 명령 5건(오판이 새로 없는지 본다), `open -R` · `xattr -d` · `codesign -dv`, `/usr/bin` 쓰기, 저장소 안 링크 2건이다. 판정이 바뀐 15건은 모두 의도한 것이다(B341 6 · B342 5 · B336 3 · B333 1). `/opt/homebrew`는 이 Intel 기기에 없고 `/opt`가 root라 허용으로 남았다 |
| T134 셸 시작 파일 · shim 모의 | 성공. `write_shell_init` 본문을 그대로 떼어 공백이 든 폴더에 시작 파일을 썼다. 앱처럼 띄워 7가지를 봤다. ① 고치기 전 진짜 claude. ② `.zshrc` 앞 붙임 + `sh_word_split` + `typeset -A` → shim, 사용자 ZDOTDIR · HISTFILE · 변수 유지. ③ `.zshenv`가 ZDOTDIR을 옮겨도 shim. ④ 셸이 뜬 뒤 앞 붙임 → 다음 프롬프트에서 shim(고치기 전은 진짜). ⑤ 이 기기의 실제 zsh 설정 → shim, HISTFILE `~/.zsh_history`. ⑥ bash 고치기 전 진짜 → 고친 뒤 shim. ⑦ cd: 저장소 A · A/sub · git 아닌 폴더는 A, 다른 저장소 B/deep은 B |
| T135 자동 시험 | `tsc` 오류 0, `npm test` 355개 통과. `cargo test --lib`는 287개 중 284개 통과이고, 실패 3개는 T111 · T126과 같다(Windows 경로 고정값 2 · B337 1). 새 시험 3개(cli.rs)와 시작 파일 · `shell_launch` · shim 검사(lib.rs)를 더했다. 디버그 번들 빌드 성공 |
| T136 고친 뒤 실앱 | 성공. 아래 네 가지를 실앱에서 확인했다 |

T136은 고친 코드로 다시 빌드한 디버그 번들로 봤다. 앱이 뜨자 앱 데이터에 `shell/zsh`와 `shell/bash/init.bash`가 생겼다.

- **zsh 페인(B343):** `whence -a claude`가 shim을 먼저 냈다. shim은 PATH 1번째다(고치기 전 14번째). ZDOTDIR은 비어 있고, HISTFILE은 `~/.zsh_history`다. `export PATH="$HOME/.local/bin:$PATH"` 다음 줄에서도 shim이 먼저다.
- **bash 페인(B343):** 셸 팝업에서 bash를 골라 열었다. `type -a claude`가 shim을 먼저 냈고 PATH 1번째다. `PROMPT_COMMAND`는 `_eqmux_shim_first`이고, export 뒤에도 shim이 먼저다. `/etc/bashrc`의 프롬프트도 그대로 나왔다.
- **cd 뒤 claude(U221):** zsh 페인에서 `cd ~/eqmux-065-other && claude -p …`로 세 단계를 시켰다.
  - 그 저장소 안 Write는 OK였다.
  - 밖 폴더 쓰기는 BLOCKED였다.
  - 처음 저장소(`eqmux-065-ws`) 쓰기도 BLOCKED였고, 거부 문구의 배정된 저장소는 `eqmux-065-other`였다.
  - 파일도 그대로였다.
- **16px 핸들(U222):** 간격은 683–695px, 가운데는 689px이었다. 예전 8px 핸들 밖인 왼쪽 가장자리(684px)를 눌러 끌자 분할선이 옮겨졌다(01 테두리 682 → 626px). 오른쪽 가장자리를 눌러 되돌려도 옮겨졌다(626 → 680px). 머리글 글자 선택은 생기지 않았다.

## 한계 (P109)

- 고친 뒤 실앱(T136)은 이 기기 사용자 설정 하나로만 봤다. `.zshrc`가 claude 폴더를 앞에 붙이는 설정은 모의(T132 · T134)로만 봤다.
- QA 기기가 Intel 하나다. `/opt/homebrew`(Apple Silicon Homebrew)는 실제 폴더로 보지 못했고, 시험에서는 가짜 파일 시스템으로 본다.
- 디버그 빌드만 봤다. clippy는 이 기기에 없다.
- B341의 Windows 판정과 `cfg(windows)` 시험 줄은 이 기기에서 컴파일되지 않는다. Windows에서 볼 것:
  - AppData 아래 쓰기 명령은 거부되는지
  - `& "C:\Program Files\…\node.exe"` 호출은 통과하는지
- Linux에는 쓰기 가능 검사가 없다. 시스템 폴더를 모두 고칠 수 있는 곳으로 본다(안전한 쪽).
- 실제 Claude 세션을 세 번 돌렸다(T131의 `claude -p` 두 번, T136의 한 번).

## 진행 메모

- 실기 두 번(T128 · T129 · T131, T136) 모두 시험 전에 앱 데이터(`~/Library/Application Support/com.eqment.eqmux`, `com.eqment.eqmux.backup`, `~/.eqmux`)를 백업했다. 끝난 뒤 되돌리고 `diff -rq`로 같은 것을 확인했다. `~/.claude/settings.json`도 그대로였다.
- 시험 저장소와 밖 폴더(`~/eqmux-065-ws` · `~/eqmux-065-other` · `~/eqmux-065-outside`)는 끝난 뒤 스크래치패드 `after/` · `after-gui/`로 옮겼다.
- `~/.claude/projects/-Users-flybook-eqmux-065-ws` · `-eqmux-065-other`는 사용자의 Claude 데이터라 지우지 않았다.
- 원본 위치는 이 세션 스크래치패드(`c6523553…/scratchpad/`)다.
  - CLI 실측: `guard_probe.py` · `probe-before.log`(고치기 전 바이너리 `eqmux-before`), `guard_probe2.py` · `probe-after.log`
  - 셸 페인 claude: `shim-claude.txt` · `shim-claude-2.txt`
  - 셸 모의: `shell-sim.sh` · `shell-sim.log`, 생성기 `shellinit/`
  - 빌드 · 시험 로그: `build.log` · `tsc.log` · `vitest.log`(고치기 전), `build-after.log` · `tsc-after.log` · `vitest-after.log` · `cargo-after.log`(고친 뒤)
  - 고친 뒤 실앱(T136): `gui/`(셸 출력 · 스크린숏 · 픽셀 판독 `png.py`), 시험 뒤 앱 데이터 `after-gui/eqmux-data-after.tgz`
