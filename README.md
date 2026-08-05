# EQMUX

AgentCommender의 후속작. **Tauri 2 + WebView2 + Rust**로 재작성한 터미널 멀티플렉서.

> wmux는 경쟁 제품이지 원본이 아니다. 원본은 AgentCommender다.
> 재작성의 명분은 *"불안정해서"가 아니라 "무거워서"*다 — 배포물 ≈440MB → 8.55MB.
> 자세한 근거: [docs/OBJECTIVES.md](docs/OBJECTIVES.md)

---

## 상태

**1차 (터미널 모드) · S1 구현 완료 · 관문 A 판정 대기.** 날짜 없이 관문 통과로만 진행한다.

| 단계 | 목표 | 상태 |
|---|---|---|
| S0 | 준비 — 기준선·전제·스파이크·저장소 | **6/6 완료** — `S0-2`는 [FEATURE-DIFF.md](docs/FEATURE-DIFF.md)가 101개 전수로 닫았다 |
| S1 | Walking Skeleton → **관문 A** | **구현 7/7 완료** — S1-1·S1-2·S1-3·S1-4·S1-3b·S1-3c·S1-3d ✅ / **관문 A 판정만 남음**(`S1-5`·`S1-6`) |
| S2 | 멀티플렉싱 | 대기 — 단 `S2-1b`(앱 데이터 크기 리포트)는 선행이 없어 **완료** ✅ |
| S3 | 기본기 마감 | 대기 |
| S4 | 도그푸딩 → **관문 B** | 대기 |

> **셸이 붙었다.** 실행하면 **pwsh가 뜨고 실제로 명령이 돈다** ([docs/PTY-S1-2.md](docs/PTY-S1-2.md)).
> 창 하나·터미널 하나다. **분할·탭·세션은 아직 없다**(S2).
>
> ✅ **최대 리스크 R1(WebGL) 해소** — 기계 2대에서 WebGL2 하드웨어 경로 확인
> (AMD 780M · NVIDIA 4070 Ti SUPER). 렌더러 자작은 없다.
>
> ✅ **관문 A 통과** (2026-08-05 · [docs/GATE-A.md](docs/GATE-A.md)).
> A-1(IME) ✅ · **A-3(키 입력 지연) ✅** — 실작업 p99 **0.4 ms**(≤8) · 총지연 p99 **16.9 ms**(≤33.4).
> `S1-3b` 4점 분리로 잴 수 있게 됐고, **계측기는 자가 검증 3항을 통과해 인수됐다**
> ([docs/LATENCY-S1-3b.md](docs/LATENCY-S1-3b.md) §10).
>
> ✅ **A-2(CJK 폭) — 계측 + 육안 둘 다 통과** ([docs/FONT-A2.md](docs/FONT-A2.md) §0-A · `GATE-A.md` §1-4).
> 폭 계측이 현행 스택을 **1.7067배 미달**로 잡았고(2.0이어야 한다), 원인은 ASCII를
> Cascadia Mono(0.586em)가 그리는데 한글은 1.0em이라 **산술적으로 2배가 될 수 없는 조합**이었다.
> `#8` 조건이 발동해 **D2Coding을 동봉**했다 — 지금은 가·漢 **2.0000**, →·■ **1.0000**,
> 굵게까지 **오차 0.000px**다. 육안도 **겹침·잘림·틈 없음**으로 통과했다
> (한글 코딩 폰트가 **없는** 기계에서 판정 · 근거 화면 `tools/gate-a/evidence/`).
>
> 🔴 **배포 전 남은 것: OFL 1.1 전문 파일**([docs/FONT-A2.md](docs/FONT-A2.md) §8). 관문은 안 막지만 배포는 막는다.

---

## 폴더 구조

```
EQMUX/
├── src/             프런트 (TypeScript + Vite)
│   ├── font.ts          A-2 폭 계측 — advance 비율 · 글리프 판별
│   └── assets/fonts/    **동봉 D2Coding** (OFL 1.1) — A-2의 답. NOTICE 함께 볼 것
├── src-tauri/       백엔드 (Rust)
│   ├── src/
│   │   ├── lib.rs       빌더 구성 · 창 생성
│   │   ├── config.rs    경로 해석 · 측정용 격리 스위치
│   │   ├── appdata.rs   앱 데이터 폴더 크기 리포트 (S2-1b)
│   │   ├── error.rs     공통 에러 타입
│   │   ├── pty.rs       ConPTY 소유 · UTF-8 조립 (S1-2)
│   │   ├── probe.rs     무인 측정 플래그 (지연 · PTY)
│   │   └── commands/    Tauri 명령 (도메인별)
│   └── capabilities/    창 권한 — 필요한 것만 연다
├── docs/            사양·계획·측정 기록 (아래 표)
├── spike/           검증용 실험 코드. 제품 코드가 아니다
│   └── s0-4-tauri/  S0-4 — WebGL 프로브. 다른 기계 확인용으로 남겨 둔다
├── .claude/         Claude Code 프로젝트 설정 (권한 allowlist)
└── LICENSE          미정 — 5차에 확정
```

---

## 빌드

```powershell
npm install                # 최초 1회
npm run tauri -- build     # 릴리스 exe + msi + nsis  (cargo-tauri 설치 불필요)
npm run tauri -- dev       # 개발 모드로 실행

cargo tauri build          # cargo-tauri를 따로 깔았다면 이것도 같다
```

> ⚠️ **`cargo build --release`를 직접 쓰지 말 것.**
> 프런트 번들은 `tauri::generate_context!`가 **컴파일 시점에 실행 파일 안으로 심는다.**
> 그런데 `dist/`만 바뀌고 Rust 소스가 그대로면 cargo는 다시 빌드할 이유가 없다고 판단한다.
> 결과: **옛 프런트가 박힌 바이너리가 조용히 그대로 남는다.**
> 실제로 여기서 한 시간을 잃었다 — 고친 코드가 실행되지 않는데 빌드는 성공한다.
> `cargo tauri build`는 `npm run build`를 먼저 돌리고 이 관계를 처리한다.

**필요한 것**: Rust(stable-msvc) · MSVC 빌드도구 · Windows SDK · Node · WebView2 런타임.
설치·검증 절차는 [docs/SPIKE-S0-4.md](docs/SPIKE-S0-4.md) §6에 있다.

### 측정용 격리 실행

도그푸딩 중에 성능을 재려면 라이브 인스턴스와 상태를 분리해야 한다.
분리하지 않고 앱을 새로 띄우면 살아 있는 세션이 죽는다 ([docs/BASELINE.md](docs/BASELINE.md) §1).

```powershell
$env:EQMUX_STATE_PATH     = "$env:TEMP\eqmux-probe\state.json"
$env:EQMUX_WORKSPACE_ROOT = "$env:TEMP\eqmux-probe\ws"
$env:EQMUX_DATA_DIR       = "$env:TEMP\eqmux-probe\webview"   # Electron --user-data-dir 대응
.\src-tauri\target\release\EQMUX.exe
```

셋 중 하나라도 설정되면 창 오른쪽 위 배지가 **격리 인스턴스**로 바뀌고 stderr에 경로가 찍힌다.
격리인 줄 알고 잰 값이 사실 라이브였으면 측정이 통째로 무의미해지므로, 눈으로 확인되게 해 뒀다.

### CJK 폭 계측 (관문 A-2)

한글 글리프의 advance width가 ASCII의 정확히 2배인가. **A-2를 사람 눈에서 풀어낸 자리다.**

```powershell
# 3종 스택(현행 / D2Coding 제외 / Cascadia 단독)을 한 번에 잰다
.\src-tauri\target\release\eqmux.exe --font-probe --font-probe-out="$env:TEMP\font.json"

# 스택을 강제한다. 창도 이 스택으로 뜬다 — 육안 확인도 같은 조건에서 한다
.\src-tauri\target\release\eqmux.exe --font-probe '--font-stack="굴림체", monospace'
$env:EQMUX_FONT_STACK = '"D2Coding ligature", monospace'   # 환경변수도 같다(플래그 우선)
```

판정은 stderr `[eqmux][font-probe]`에 나온다. 글자마다 **어느 폰트가 실제로 그렸는지**까지 찍는다.

> **규칙 한 줄**: CJK는 거의 모든 폰트에서 1.0em이다. 그래서 **ASCII advance가 정확히 0.5em이어야만**
> 2배가 나온다. Cascadia Mono는 0.586em이라 무엇을 폴백으로 붙여도 2가 안 된다.
> **그래서 D2Coding을 동봉했다**(`src/assets/fonts/` · `styles.css`의 `@font-face`) —
> 기계에 뭐가 깔렸든 ASCII가 0.5em으로 고정된다. 근거·한계는 [docs/FONT-A2.md](docs/FONT-A2.md).
>
> 동봉을 뺐을 때 무슨 일이 나는지는 `D2Coding 전부 제외` 스택이 계속 보여준다 — **여전히 1.7067 미달**이다.
>
> ⚠️ **이건 육안이 아니다.** 폰트가 몇 픽셀로 그리는가이지 화면이 밀리는가가 아니다.
> 육안 전에 싸게 거르는 자리다 — 비율이 틀리면 볼 것도 없이 미달이다.

### 앱 데이터 폴더 크기 (`S2-1b`)

배포물 4.93 MB는 사용자가 지불하는 용량의 **일부일 뿐**이다. 나머지는 WebView2가 쌓는 캐시고,
wmux가 497.6 MB가 된 자리가 정확히 여기다 — 그중 **95.6%가 캐시 계열**이었다.

```powershell
# 창을 안 열고 재고 끝낸다. JSON까지 남기려면 -out을 준다.
.\src-tauri\target\release\eqmux.exe --appdata-report
.\src-tauri\target\release\eqmux.exe --appdata-report-out="$env:TEMP\eqmux-appdata.json"
```

앱을 그냥 띄우면 **기동 때 stderr에 1회**, 그 뒤 **상태줄에 120초마다** 나온다.
1 MB 이상 움직였을 때만 stderr에 다시 찍으므로 로그에 증가 곡선이 남는다.

**현재 13.75 MB (캐시 93%)** · KR2 상한 60 MB의 23%. 세는 규칙·대조군·재현 절차는
[docs/APPDATA-S2-1b.md](docs/APPDATA-S2-1b.md)에 있다 — **해원의 3회 측정(`#7` ②)은 이 규칙으로 잰다.**

> 계측 모드(`--latency-probe*`)에서는 이 리포트가 **아예 돌지 않는다.**
> 표본을 재는 동안 옆에서 폴더를 훑으면 그 잡음이 A-3 숫자에 얹힌다.

### 키 입력 지연 계측 (관문 A-3)

```powershell
# 무인 측정 — 500회 자동 입력 후 결과를 쓰고 종료한다 (관문 판정은 n ≥ 500)
.\src-tauri\target\release\eqmux.exe --latency-probe-run=500 `
  --latency-probe-out="$env:TEMP\eqmux-latency.jsonl"

# 손으로 쳐 보면서 실시간으로 보기
.\src-tauri\target\release\eqmux.exe --latency-probe
```

**4점을 잰다** (`S1-3b`) — `keydown → 파싱 완료 → 프레임 시작 → 렌더 완료`.

| 필드 | 뜻 |
|---|---|
| **`work_ms`** | 이 키에 귀속된 **메인 스레드 실행 시간** — **A-3-① 판정 대상 (≤ 8ms)** |
| **`wait_ms`** | `total - work`. 프레임 대기 등 유휴 |
| `total_ms` | `t2 - t0`. 정의상 항상 `work + wait` — **A-3-②(≤ 2프레임)** |
| `parse_ms` `render_ms` | 3점 계측과 같은 정의. 비교용 |
| `seg_*` `frame_wait_ms` `naive_work_ms` | 구간 내역과 진단 |

JSONL 마지막 줄이 요약이고, `gate` 객체에 A-3-①·② 판정이 그대로 들어 있다.

> ⚠️ **`gate.verdict_valid`를 먼저 본다.** 자가 검증 실행(`--latency-probe-inject-ms`·
> `--latency-probe-frame-hold`)도 `gate`를 판정과 똑같은 모양으로 찍는다. 예를 들어
> `--latency-probe-frame-hold=4`는 유효 주사율을 1/4로 낮추므로 A-3-②의 상한이
> 33.4 → **133.4 ms**로 벌어지고 `a3_2_pass: true`가 나온다 — 통과가 아니라 무의미다.
> 그런 실행은 `verdict_valid: false`와 이유 문자열이 붙는다. **`false`면 판정에 인용하지 않는다.**

`machine.frame_interval_ms`가 **실효 주사율**(rAF 간격)이다 — A-3-③ 기록 항목이라 자동으로 붙는다.
**가정이 아니라 그 실행에서 실제로 잰 값이다** — `#10`의 근거가 이 값 위에 선다([issue.md](docs/issue.md) #10).

#### 계측기 자가 검증 (`docs/GATE-A.md` §2-2)

계측기가 회귀를 잡는지 **증명한 뒤에** 판정에 쓴다. 두 플래그가 그 자리다.

```powershell
# ② 입력 경로에 5ms 바쁜 루프 → work_ms가 약 5ms 올라야 한다
.\...\eqmux.exe --latency-probe-run=500 --latency-probe-inject-ms=5 --latency-probe-out=...

# ③ 프레임을 1/4로 늦춘다 → work_ms는 불변, wait_ms만 올라야 한다
#    ⚠️ 대조군과 실험군의 --latency-probe-gap-ms를 같게 두고 짝지어 잰다.
#    그리고 그 간격을 프레임 주기(16.7ms)의 정수배로 두면 안 된다 — wait가 위상 고정된다.
.\...\eqmux.exe --latency-probe-run=500 --latency-probe-gap-ms=21 --latency-probe-out=...
.\...\eqmux.exe --latency-probe-run=500 --latency-probe-gap-ms=21 --latency-probe-frame-hold=4 --latency-probe-out=...
```

결과는 [docs/LATENCY-S1-3b.md](docs/LATENCY-S1-3b.md) §3에 있다.

> **측정 범위를 그대로 옮겨 적는다.**
> 포함: keydown 핸들러 → 파싱 → 렌더 프레임.
> **미포함: OS 키보드 입력 → 브라우저 keydown 디스패치.** 앱 밖이라 잴 수 없다.
> `--latency-probe-run`은 합성 `KeyboardEvent`를 쓰므로 이 구간이 빠진다 — 결과 JSON의
> `note` 필드에도 같은 문장이 들어간다.

> ### ⚠️ 이 계측은 **셸을 붙이지 않는다** — 그리고 옛 기준(16ms)은 폐기됐다
>
> `--latency-probe`는 렌더 경로만 재려고 PTY를 일부러 뺀다(로컬 에코). PTY 왕복이 섞이면
> 두 시점의 숫자가 뒤엉킨다.
>
> **A-3 기준이 바뀌었다** ([docs/issue.md](docs/issue.md) #10) — 옛 `p99 ≤ 16ms`는 60Hz 한 프레임
> (16.67ms)보다 짧아 원리적으로 달성 불가였다. 새 기준은 **① 프레임 대기 제외 실작업 p99 ≤ 8ms**
> **② 총지연 p99 ≤ 2프레임**이고, `S1-3b`에서 **4점 분리를 넣어 ①을 잰다.**
> **측정 기계의 GPU·주사율은 요약 JSON에 자동으로 들어간다** — 그래도 문서에 함께 적는다.
>
> ⚠️ **`S1-3`의 3점 계측은 `t0`를 한 키씩 밀려 읽었다** ([docs/LATENCY-S1-3b.md](docs/LATENCY-S1-3b.md) §4).
> `#10`에 인용된 `12.7ms`·`26.1ms`·`parse p50 8.8ms`는 그만큼 부풀려진 값이다.
> **그 시점 숫자와 지금 숫자를 섞어 쓰면 안 된다.**

### 셸 왕복 무인 검증 (`S1-2`·`S1-4`)

창을 열어 눈으로 보지 않고 셸이 붙었는지 확인한다. **xterm 버퍼에 실제로 찍힌 글자**를 파일로 남긴다.

```powershell
.\src-tauri\target\release\eqmux.exe --pty-probe `
  --pty-probe-cmd=dir --pty-probe-ms=4000 `
  --pty-probe-out="$env:TEMP\eqmux-pty.txt"
```

판정은 stderr에 `[eqmux][pty-probe] 통과 — …` 로 나온다. 두 가지를 같이 본다 —
**표식이 2회 이상**(1회는 그냥 쳐진 글자다) 그리고 **한글이 2회 이상**(UTF-8 조립 확인).
셸은 `EQMUX_SHELL` → `pwsh` → Windows PowerShell → `cmd` 순으로 고른다.

---

## 문서

읽는 순서대로.

| # | 문서 | 내용 |
|---|---|---|
| 1 | [OBJECTIVES.md](docs/OBJECTIVES.md) | 목적·철학 5개·모드 3개·5단계 로드맵 |
| 2 | [WORKPLAN.md](docs/WORKPLAN.md) | 1차 작업 29개 · 담당 · 관문 |
| 3 | [BASELINE.md](docs/BASELINE.md) | AgentCommender 기준선 실측 (S0-1) |
| 4 | [SPIKE-S0-4.md](docs/SPIKE-S0-4.md) | Tauri/WebView2 스파이크 결과 (S0-4) |
| 4b | [RENDERER-S1-3.md](docs/RENDERER-S1-3.md) | 렌더러·키 입력 지연 (S1-3) + 이안 판정 |
| 4c | [PTY-S1-2.md](docs/PTY-S1-2.md) | **ConPTY 연결·양방향 스트림 (S1-2·S1-4)** |
| 4d | [GATE-A.md](docs/GATE-A.md) | **관문 A 판정 기록 — 현재 보류** + A-3 계측 사양 |
| 4e | [APPDATA-S2-1b.md](docs/APPDATA-S2-1b.md) | **앱 데이터 크기 리포트 (S2-1b)** — 세는 규칙·실측·해원 측정 절차 |
| 4f | [FONT-A2.md](docs/FONT-A2.md) | **CJK 폭 계측 (A-2)** — 미달 원인 · D2Coding 동봉 · 한계 |
| 4g | [HANDOVER-DEV-2026-08-05.md](docs/HANDOVER-DEV-2026-08-05.md) | **Dev 작업분 인수 문서** — 코드·플래그·결함·남은 결정 |
| 4g | [성능테스트-1.md](docs/성능테스트-1.md) | **성능 실측 종합 (S1 완료 시점)** — 크기·렌더러·지연·셸 왕복 |
| 4h | [BACKLOG.md](docs/BACKLOG.md) | **신규 기능 요청 목록** — 101개 대조표 이후 들어온 것 |
| 5 | [FEATURES.md](docs/FEATURES.md) | 기능 101개 전수 판정 |
| 6 | [issue.md](docs/issue.md) | 안건함 — 열림 / 결정 대기 / 확정 / 닫힘 |
| 7 | [PRD-EQMUX.md](docs/PRD-EQMUX.md) | ⚠️ 전제가 낡음 — 수정 중 (S0-3) |
| 8 | [TEAM.md](docs/TEAM.md) | 동원 가능한 에이전트·스킬·도구 |

---

## 팀

| 이름 | 세션 | 역할 |
|---|---|---|
| 서이안 | Manager | PM — 문서·설계 결정·관문 판정 |
| 진세아 | Dev | 구현 전부 |
| 윤해원 | Supporter | 실측·대조·교차검증 |

**구현은 세아만 한다** (충돌 방지). 관문 판정은 이안이 한다.
