# S1-2 · S1-4 — ConPTY 연결과 양방향 스트림

> 작성: **서이안(PM)** · 2026-08-04
> ⚠️ **원래 세아 몫이다.** 팀장님 지시로 대행했다. 인수인계용으로 결정 근거를 전부 적는다.
> 코드: `src-tauri/src/pty.rs` · `src-tauri/src/commands/pty.rs` · `src/pty.ts`
> 근거: [WORKPLAN.md](WORKPLAN.md) `S1-2`·`S1-4` · [issue.md](issue.md) #10

---

## 0. 무엇이 붙었나

```text
xterm.onData ──▶ invoke("pty_write") ──▶ ConPTY ──▶ pwsh
                                                      │
xterm.write  ◀── listen("pty://data") ◀── 읽기 스레드 ◀┘
```

| 구성 | 자리 |
|---|---|
| ConPTY 소유·수명 | `src-tauri/src/pty.rs` — `PtyManager` |
| 명령(`pty_spawn`/`write`/`resize`/`kill`/`list`) | `src-tauri/src/commands/pty.rs` |
| 프런트 연결 | `src/pty.ts` — `PtyLink` |
| 무인 검증 | `--pty-probe` (아래 §3) |

### 검증 결과 — `S1-2`·`S1-4` **완료 기준 충족** (2026-08-04, 이안 기계)

| 완료 기준 (WORKPLAN) | 결과 |
|---|---|
| `S1-2` PowerShell이 뜨고 `dir` 결과가 돌아옴 | ✅ **pwsh 7.6.4** 기동 · `dir` 출력 정상 수신 |
| `S1-4` 타이핑이 셸에 전달되고 출력이 화면에 뜸 | ✅ 표식 왕복 ×2 · **한글 왕복 ×2** |

```text
PowerShell 7.6.4
PS D:\workspace\Main\project\EQMUX\docs> dir

    Directory: D:\workspace\Main\project\EQMUX\docs

Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
-a---        2026-08-04  오후 9:49          26756 BASELINE.md
...
PS ...> echo EQMUX-PTY-OK-한글가나다漢字
EQMUX-PTY-OK-한글가나다漢字
```

**이 출력은 xterm 버퍼에서 읽어 낸 것이다** — 이벤트가 "왔다"가 아니라 파싱되어 "그려졌다"는 뜻이다.
`오후`·`한글가나다漢字`가 깨지지 않았다 → §1-3의 UTF-8 조립이 실제 왕복에서 동작한다.

> ⚠️ **이것은 관문 A-1(IME) 통과가 아니다.** 여기서 확인한 것은 *이미 완성된 한글 문자열*의
> 왕복이다. **조합 중인 글자**(IME composition)는 사람이 쳐야 나오고, **A-2 시각 폭**도 눈으로 봐야 한다.
> 둘 다 관문 A에서 해원 몫이다.

### 크기

| 산출물 | S1-3 | **S1-2·S1-4** | 증가 |
|---|---|---|---|
| `eqmux.exe` | 3.07 MB | **3.14 MB** | +0.07 |
| nsis | 1.13 | 1.16 | +0.03 |
| msi | 1.68 | 1.72 | +0.04 |

ConPTY가 붙었는데 70KB 늘었다. 지표(≤40MB) 대비 여유는 그대로다.

---

## 1. 결정 넷 — 왜 이렇게 했나

### 1-1. `portable-pty`를 쓴다 (직접 Win32를 부르지 않는다)

Windows에서 `CreatePseudoConsole`을 직접 부르면 지금은 코드가 짧다. 대신 **핸들 수명과 상속 규칙을
우리가 떠안는다** — 자식이 죽어도 읽기 핸들이 안 닫혀 스레드가 남는 실수가 이 자리의 단골이다.
크레이트는 그걸 이미 겪은 코드다. 2차 이후 다른 OS를 볼 때도 이 파일만 그대로 둔다.

### 1-2. 출력은 **이벤트로 밀고**, 입력은 **명령으로 당긴다**

셸은 아무 때나 뱉는다. 프런트가 폴링하면 폴링 주기만큼 지연이 붙고, 그 지연이 A-3 숫자에 그대로
들어간다. 반대로 입력은 사람이 칠 때만 있으니 명령 왕복으로 충분하다.

### 1-3. **UTF-8 조립은 Rust에서 한다** — 여기가 한글의 생사다

ConPTY가 주는 바이트는 **글자 경계에서 끊기지 않는다.** `가`(3바이트)의 앞 2바이트만 먼저 오는
일이 실제로 일어난다. 그대로 문자열로 만들면 그 글자가 깨지고, 남은 1바이트가 다음 덩어리 앞에
붙어 **그 뒤가 통째로 밀린다.**

```rust
// pty.rs — take_utf8()
Err(e) => {
    let valid = e.valid_up_to();
    match e.error_len() {
        None      => { /* 덜 왔다 — 남겨 두고 다음 읽기를 기다린다 */ }
        Some(bad) => { /* 진짜 깨졌다 — U+FFFD로 바꾸고 계속 간다 */ }
    }
}
```

> **깨진 바이트에서 멈추지 않는 것도 결정이다.** 멈추면 그 뒤 출력이 전부 막힌다.
> 한 글자를 잃는 쪽이 화면 전체를 잃는 쪽보다 낫다.

이 함수에는 단위 테스트를 붙였다 (`cargo test`). **관문 A-1·A-2가 이 함수 위에 서 있다.**

### 1-4. 셸 자동 감지 — `EQMUX_SHELL` → `pwsh` → Windows PowerShell → `cmd`

`pwsh`는 PATH에서 찾고, Windows PowerShell은 **절대 경로로만** 확인한다.
PATH가 오염된 환경에서 엉뚱한 `powershell.exe`를 잡는 사고를 막는다.
실제로 무엇이 떴는지는 **상태줄과 stderr 양쪽에 찍는다** — "pwsh를 띄웠다고 믿는 것"과 구분한다.

---

## 2. 계측 모드와는 **같이 돌지 않는다**

`--latency-probe`는 셸 없이 **로컬 에코로 렌더 경로만** 잰다. PTY를 함께 붙이면 셸 에코와
로컬 에코가 겹쳐 표본이 오염된다. 그래서 계측 모드에서는 PTY를 붙이지 않고, 두 플래그를 같이 주면
stderr에 경고를 찍고 PTY 검증만 돈다.

> **그래서 A-3 재측정은 아직 못 한다.** [issue.md](issue.md) #10이 요구하는
> `wait_ms`/`work_ms` 4점 분리가 먼저다. **그 작업은 세아에게 남겨 뒀다** — 내가 손대면
> 계측기 설계까지 대행하는 게 되고, 그건 인수인계가 아니라 인계 불능이다.

---

## 3. 무인 검증 — `--pty-probe`

화면 캡처로 검증하지 않는다(`RENDERER-S1-3.md` §4-4). 대신 **xterm 버퍼에 실제로 찍힌 글자**를
파일로 남긴다. 이벤트로 "왔다"가 아니라 **파싱되어 "그려졌다"** 를 증거로 삼는다.

```powershell
$env:EQMUX_STATE_PATH     = "$env:TEMP\eqmux-probe\state.json"
$env:EQMUX_WORKSPACE_ROOT = "$env:TEMP\eqmux-probe\ws"
$env:EQMUX_DATA_DIR       = "$env:TEMP\eqmux-probe\webview"

.\src-tauri\target\release\eqmux.exe --pty-probe `
  --pty-probe-cmd="dir" --pty-probe-ms=4000 `
  --pty-probe-out="$env:TEMP\eqmux-pty.txt"
```

판정은 두 가지를 **동시에** 본다.

| # | 확인 | 왜 |
|---|---|---|
| ① | 표식 `EQMUX-PTY-OK`가 **2회 이상** | 1회는 그냥 "쳐진 글자"다. 셸이 **실행**해서 되돌려 준 것이 2회째다 |
| ② | 한글 `한글가나다漢字`가 **2회 이상** | §1-3의 UTF-8 조립이 실제 왕복에서 살아남는지 |

결과는 파일 + stderr(`[eqmux][pty-probe] ...`) 양쪽에 남고, 앱은 스스로 종료한다.

---

## 4. 남은 것 — 세아에게

| # | 할 일 | 규모 | 왜 내가 안 했나 |
|---|---|---|---|
| 1 | **계측 4점 분리** (`wait_ms`/`work_ms`) | S | A-3 판정 기준([issue](issue.md) #10)의 근거를 만드는 일이다. 계측기 설계는 계측한 사람이 해야 한다 |
| 2 | 출력 폭주 시 흐름 제어 | M | 지금은 읽은 덩어리를 그대로 이벤트로 민다. `dir` 한 번은 괜찮지만 대량 출력에서 IPC가 밀릴 수 있다. **`S3-6`(스크롤백 상한)과 같이 보는 게 맞다** |
| 3 | 셸 종료 후 재기동 정책 | S | 지금은 한 줄 남기고 끝. 탭·패널이 생기는 `S2` 전에 정하면 된다 |
| 4 | 제어 채널 이름 환경변수화(`EQMUX_PIPE_NAME`) | S | `BASELINE.md` §1에서 해원이 요청한 것. 아직 제어 채널 자체가 없어 **자리만 비워 뒀다** |

> **코드가 마음에 안 들면 갈아엎어도 됩니다.** 구조를 혼자 잡는 이점이 사라지는 게
> 대행의 유일한 비용입니다. 제 판단이 세아 설계와 어긋나면 세아 쪽이 맞습니다.
