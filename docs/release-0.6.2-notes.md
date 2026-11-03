# EQMUX 0.6.2 릴리스 노트

2026-11-04 · 태그 `v0.6.2` · 변경 전체는 `CHANGELOG.md` [0.6.2]

## 다운로드

| 운영체제 | 파일 | 비고 |
|---|---|---|
| Windows 10·11 (x64) | `EQMUX_0.6.2_x64_portable.zip` | 압축을 풀어 `EQMUX\eqmux.exe` 실행 |

macOS 판은 나중에 따로 올립니다. 1.0 전에는 설치 파일을 내지 않습니다. 아직 코드 서명이 없습니다. Windows는 SmartScreen에서 [추가 정보] → [실행]을 누릅니다.

## 고친 것

### Claude Code가 다시 전체 화면으로 열립니다

페인에서 `claude`를 실행하면 원래는 셸 화면이 지워지고 Claude Code 화면만 보입니다. 그런데 어느 순간부터 셸 출력이 그대로 남고 Claude Code가 그 아래에 이어 그려졌습니다.

EQMUX가 아니라 Claude Code가 스스로 바꾼 동작이었습니다. Claude Code는 전체 화면으로 뜬 직후 10초 안에 닫히는 일이 두 번 생기면, 그 버전에서는 이 PC의 전체 화면을 끄고 그 사실을 `~/.claude.json`(`fullscreenAutoDisabled`)에 기록합니다. EQMUX에서는 에이전트를 띄웠다가 곧 닫는 일이 흔해서 이 조건이 쉽게 생겼습니다.

이제 EQMUX가 띄우는 셸과 에이전트에 `CLAUDE_CODE_NO_FLICKER=1`을 넣습니다. Claude Code가 이 값을 보면 꺼 둔 기록을 무시하고 늘 전체 화면으로 엽니다.

- 이미 `CLAUDE_CODE_NO_FLICKER`를 정해 두었으면 EQMUX는 덮어쓰지 않습니다. EQMUX 안에서 클래식 화면을 쓰려면 `CLAUDE_CODE_NO_FLICKER=0`으로 두세요.
- Claude Code 설정의 `"tui": "default"`는 EQMUX 안에서는 이 값에 덮입니다.
- 0.6.1 이하를 쓰는 동안 이 문제가 생겼다면, Claude Code에서 `/tui fullscreen`을 실행해도 바로 돌아옵니다.

## 파일 해시 (SHA-256)

```
(빌드 후 채움)
```
