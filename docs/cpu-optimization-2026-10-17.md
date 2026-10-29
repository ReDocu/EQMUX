# CPU 사용량 점검 (2026-10-17)

## 요약

- 점검할 때 EQMUX가 꺼져 있었다. 그래서 실측 없이 코드만 읽었다. 아래 순위는 추정이고, 측정 방법은 맨 끝에 적었다.
- 10/14 점검(`docs/archive/optimization-candidates-2026-10-14.md`)에서 나온 48건 가운데 41건이 이미 반영됐다. PTY 출력 묶기, 저장 배치, async 커맨드, WebGL 반납이 여기에 들어간다. 이 문서에는 아직 남은 것과 새로 찾은 것만 적었다.
- 효과가 가장 클 것으로 보는 두 가지는 이렇다.
  1. 에이전트 도구 호출 한 번마다 화면 전체가 다시 계산된다(전역 tick 팬아웃).
  2. 창이 숨겨지거나 최소화돼도 폴링 4개가 계속 돌고, 그중 하나는 10초마다 git 프로세스를 5개씩 띄운다.

  둘 다 몇 줄만 고치면 된다.

## 후보 (효과 ÷ 수고 순)

| # | 무엇 | 위치 | 왜 CPU를 쓰나 | 처방 | 수고 |
|---|---|---|---|---|---|
| 1 | **전역 방송 팬아웃** | `src/backend/mock.ts:552` `broadcast()`, `src/state.ts:296` `tick`, `mock.ts:1110` `applyAgentState` | 훅 이벤트(도구 시작·끝)마다 `applyAgentState` → `broadcast` → `tick`이 오르고, 15개 파일의 `tick()` 구독 41곳이 전부 다시 계산된다. 바쁜 에이전트 4명이면 초당 여러 번 일어난다. 10/14의 D2·C10이고 0.6으로 미뤄 둔 항목이다. | **빠른 길:** `broadcast()`를 프레임당 한 번으로 묶는다(`requestAnimationFrame`으로 예약하고, 이미 예약돼 있으면 건너뛴다). 한 프레임 안의 이벤트 N개가 재계산 1번이 된다. **근본:** 도메인별 신호(세션·메시지·이벤트)로 나눈다(0.6 계획 그대로). | 빠른 길은 몇 줄, 근본은 큼 |
| 2 | **숨김 중에도 도는 폴링** | `src/screens/ControlCenter.tsx:276` (저장 사용량 10초), `:369` (1초), `:410` (worktree·branch git 10초), `src/components/GitPanelTab.tsx:80` (10초) | `GitPanelTab`의 `gitOverview`는 git을 5번 띄운다(`branch`, `rev-parse`, `rev-list`, `status --porcelain -uall`, `log`, `src-tauri/src/workspace.rs:427`). Windows에서는 프로세스를 띄우는 것 자체가 비싸다. `-uall`은 추적하지 않는 파일을 하위까지 전부 훑는다. 같은 처방(C6·D7)을 `agentprobe`·`diag`·`memory`에는 이미 넣었는데 이 네 곳은 빠졌다. | 틱 시작에 `if (document.hidden) return;`을 한 줄씩 넣는다. 다시 보일 때 한 번 갱신하는 것은 `agentprobe.ts`의 `visibilitychange` 패턴을 따른다. | 한 줄 × 4 |
| 3 | **UnicodeGraphemesAddon** | `src/components/TerminalPane.tsx:590` | 실험 단계 애드온이다. 출력의 모든 문자를 grapheme 단위로 나누며, 이 일이 xterm 파서 안에서 돈다. Claude Code TUI는 스피너를 계속 다시 그리기 때문에 출력이 끊이지 않는다. | 끈 경우와 켠 경우를 측정한다. 차이가 크면 `@xterm/addon-unicode11`로 바꾼다. 대신 이모지 ZWJ 결합의 폭이 부정확해질 수 있다. | 한 줄 + 측정 |
| 4 | **모든 페인 커서 깜빡임** | `TerminalPane.tsx:577` `cursorBlink: true` | 보이는 페인마다 약 0.6초에 한 번 다시 그린다. 페인이 6개면 렌더가 그만큼 는다. | 포커스된 페인만 `term.options.cursorBlink = true`로 둔다(포커스·블러 때 토글). | 작음 |
| 5 | **PTY 출력을 이벤트로 보냄** | `src-tauri/src/lib.rs:346` `emit_to("main", "pty-output", …)` | Tauri 이벤트는 청크마다 페이로드를 JSON으로 만들어 스크립트 문자열로 웹뷰에서 `eval`한다. 3ms 묶기는 이미 있지만, 스피너 프레임 하나하나가 이벤트 하나씩이다. | 스폰할 때 `tauri::ipc::Channel<PtyOutput>`을 넘겨 그 채널로 보낸다. Tauri가 스트리밍 용도로 권하는 방식이다. 효과는 측정한 뒤 판단한다. | 중간 |
| 6 | **레지스트리 감시에 디바운스가 없음** | `src-tauri/src/agent.rs:1241` | `~/.claude/sessions/*.json`에 쓰기가 생길 때마다 바로 `scan`한다. 버스트 병합은 이미 큐에 들어온 것만 합친다. Claude는 상태가 바뀔 때마다 이 파일을 쓴다. | 첫 이벤트 뒤 150ms 동안 `recv_timeout`으로 더 모은 다음 한 번만 스캔한다. | 몇 줄 |
| 7 | **개발 빌드로 실행할 때** | `src-tauri/Cargo.toml` (`[profile.release]`만 있음) | `tauri dev`는 Rust 디버그 빌드다. 그래서 PTY 핫패스(`LineAssembler`, UTF-8 이월, 로그 쓰기)와 SQLite가 최적화 없이 돈다. 체감 CPU가 릴리스보다 몇 배 높을 수 있다. | CPU는 릴리스 빌드로 잰다. 개발 중에도 줄이고 싶으면 `[profile.dev.package."*"] opt-level = 2`(의존성만 최적화)를 넣는다. | 한 줄 |

CPU와는 상관없지만 같이 본 것이 있다. `~/.eqmux/logs`가 851MB이고, 가장 큰 파일은 118MB다(`shell1@mobilepuzzleadless-…log`). 세션 로그에는 크기 상한이나 보존 기간이 없다.

## 문제 없음으로 확인

- PTY 리더와 코얼레서(`lib.rs:318-347`): 3ms 무입력·25ms 시한·256KB 상한으로 묶고, 로그는 `BufWriter`로 쓴다.
- 저장 스레드(`store.rs:274`): 100ms 무입력 또는 `BATCH_MAX`일 때 커밋하고, 쉴 때는 깨어나지 않는다.
- Rust 폴링 루프: `git_within`의 20ms `try_wait`는 git 한 번이 도는 동안만 돈다. `diag` 10초, `ipc` 대기는 블로킹이다. 상시 비용은 작다.
- CSS: 무한 애니메이션, `backdrop-filter`, `blur`가 하나도 없다.
- 세션 DB: 0.3MB라서 10초마다 도는 `COUNT(*)`(`lib.rs:940`)는 지금 크기에서는 문제가 아니다.

## 측정 방법

어느 프로세스가 CPU를 쓰는지에 따라 손볼 곳이 달라진다.

| 프로세스 | 의미 | 해당 후보 |
|---|---|---|
| `EQMUX.exe` | Rust 코어 | 5, 6, 7 |
| `msedgewebview2` `--type=renderer` | 프런트 JS·xterm 파싱 | 1, 2, 3 |
| `msedgewebview2` `--type=gpu-process` | WebGL 렌더 | 4, 페인 수 |
| `git.exe`가 자주 뜨고 꺼짐 | 폴링 | 2 |

조건을 세 가지로 나눠 각각 10초씩 잰다. (a) 셸만 열고 아무것도 안 함, (b) 에이전트 4명 작업 중, (c) (b) 상태에서 창 최소화.

```powershell
# 프로세스별 CPU % (10초 평균) — 웹뷰는 명령줄의 --type으로 구분
$n=[Environment]::ProcessorCount
$before=@{}; Get-Process EQMUX,msedgewebview2 -EA 0 | % { $before[$_.Id]=$_.CPU }
Start-Sleep 10
Get-CimInstance Win32_Process -Filter "Name='EQMUX.exe' or Name='msedgewebview2.exe'" | % {
  $p=Get-Process -Id $_.ProcessId -EA 0
  if($p -and $before.ContainsKey($p.Id)){
    [pscustomobject]@{Pid=$p.Id;Name=$p.ProcessName
      Type=([regex]'--type=(\S+)').Match($_.CommandLine).Groups[1].Value
      Pct=[math]::Round(($p.CPU-$before[$p.Id])/10/$n*100,1)} }
} | sort Pct -Desc | ft
```

renderer가 가장 높게 나오면 웹뷰 DevTools의 Performance 탭에서 5초를 녹화한다. Bottom-up에서 `broadcast`·`tick` 쪽(후보 1)이 큰지, xterm `InputHandler`·`parse` 쪽(후보 3)이 큰지 보면 된다.

## 권하는 순서

1. 후보 1의 빠른 길(방송을 프레임 단위로 묶기)과 후보 2(숨김 체크 4줄)를 고친다. 위험이 낮고 바로 효과가 난다.
2. 릴리스 빌드에서 위 측정을 한다.
3. renderer가 여전히 높으면 후보 3·4를, `EQMUX.exe`가 높으면 후보 5·6을 고친다.

## 반영 (2026-10-17)

- **후보 1 빠른 길:** `src/backend/mock.ts`에 `broadcastSoon()`을 넣었다. Rust 이벤트에서 오는 갱신 4종(`applyAgentState`·`applyMemory`·`applyAgents`·`applyRecap`)만 16ms 안의 방송을 한 번으로 묶는다. 사람이 직접 한 조작은 지금처럼 바로 방송한다. 묶음 방송이 예약된 사이에 즉시 방송이 나가면 예약은 취소된다. 타이머를 `rAF`가 아니라 `setTimeout`으로 쓴 이유는 숨김 중에도 구독자(디렉터리 동기화·고아 해제)가 돌아야 하기 때문이다. 확인용 테스트는 `src/backend/mock.test.ts`다.
- **후보 2:** `GitPanelTab.tsx`의 10초 git 폴링과 `ControlCenter.tsx`의 저장 사용량 10초 폴링이 숨김 중에는 쉰다. 다시 보이면 다음 틱(10초 안)에 따라잡는다. 워크트리 레일 폴링은 같은 날 다른 작업에서 레일이 통째로 빠져 손볼 대상이 없어졌다. 1초 타이머(`ControlCenter.tsx`의 '본 것' 판정)는 창 포커스가 없으면 이미 아무것도 하지 않아서 그대로 두었다.
- `tsc --noEmit` 통과, `vitest` 133건 통과. 앱 실측은 아직 하지 않았다.
- **후보 5 (완료, a9bb3ff):** PTY 출력을 `emit_to("pty-output")` 대신 `tauri::ipc::Channel`로 보낸다. `lib.rs`에 `PtyOutChannel` 상태와 `pty_output_channel` 커맨드를 두고, 코얼레서가 채널이 있으면 채널로 보낸다. `src/backend/pty.ts`의 `ensureListeners`가 채널을 등록하고, `listen("pty-output")`은 폴백으로 남겼다. 같은 부하(최소화 + 초당 6천 줄)에서 웹뷰 렌더러가 emit일 때 167→427MB(복원 뒤 약 470MB)까지 올랐는데, Channel로 바꾼 뒤에는 73~126MB에 머문다. 본체 CPU는 같다. 근거는 `docs/cpu-ram-risks-2026-10-17.md`의 실측 절에 있다.
