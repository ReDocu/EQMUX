# 앱 데이터 크기 리포트 (`S2-1b`)

> 구현: 진세아 · 2026-08-04 · 근거: [issue.md](issue.md) #7 ① · [WORKPLAN.md](WORKPLAN.md) `S2-1b`
> 선행 없음(관문 A와 무관). 상한 **강제**는 `S3-6` 그대로다 — 여기서 한 건 **보이게 만든 것**뿐이다.

---

## 0. 한 장 요약

| # | 항목 | 값 | 조건 |
|---|---|---|---|
| 1 | **라이브 인스턴스 앱 데이터** | **13.75 MB** | 오늘 하루 S1 개발·측정에 쓰인 폴더 |
| 2 | └ 캐시 계열 비중 | **93%** (12.84 MB) | §2-3 규칙 · ⚠️ `BASELINE.md`의 95.6%와 **다른 자다** → §3.5 |
| 3 | **빈 폴더 → 창 뜨는 순간** | **4.06 MB** | 격리 · WebView2가 창보다 먼저 쓴다 |
| 4 | **빈 폴더 → 셸 붙고 7초 후** | **13.70 MB** | 격리 · `--pty-probe` 1회 |
| 5 | KR2(60 MB) 대비 | **23%** | 1번 값 기준 |
| 6 | 배포물 | **3.20 MB** (3,353,088 B) | `eqmux.exe` — `S1-3b`의 3.16 MB에서 **+0.03** |

> **`13.70 MB`가 지금 EQMUX의 출발점이다.** 명령 두 개 치고 7초 만에 여기까지 온다.
> 대조군([BASELINE.md](BASELINE.md) §3.2b): AgentCommender는 **설치 직후 10분 유휴에 34.43 MB**였다.
>
> ⚠️ **이 둘을 "2.5배 낫다"로 읽으면 안 된다.** 조건이 다르다 — 저쪽은 10분 유휴 후,
> 이쪽은 7초 후다. **같은 층의 비교는 해원의 규격 측정(#7 ②)에서 나온다.** §4에 절차를 적었다.
>
> ⚠️ **비중 %도 나란히 놓으면 안 된다** (해원 확인, §3.5). `BASELINE.md` §6은 캐시를
> **4폴더 수동 지정**으로 셌고 §2-3은 이름 규칙으로 더 넓게 잡는다. 같은 자로 다시 재면
> AgentCommender는 96.9%가 아니라 **99.8%**다. **총계(13.75 vs 52.62 MB)는 그대로 비교해도 된다.**

---

## 1. 무엇이 생겼나

| 자리 | 무엇 |
|---|---|
| **상태줄** | `앱데이터 13.7 MB (캐시 93%) / KR2 60.0 MB` — 마우스를 올리면 경로·1단계 내역 |
| **stderr** | 기동 때 1회 + 상태줄 갱신 때(1 MB 이상 움직였을 때만) |
| **무인 플래그** | `--appdata-report` — 창을 안 열고 재고 끝낸다 |

상태줄은 **120초마다** 갱신한다. 캐시는 초 단위로 자라지 않는다 — 자주 훑을수록 디스크만 긁는다.

> **계측 모드(`--latency-probe*`)에서는 셋 다 돌지 않는다.**
> 500표본을 재는 4초 동안 옆에서 폴더를 훑으면 그 잡음이 A-3 숫자에 얹힌다.
> 용량을 보려다 지연을 오염시키면 둘 다 잃는다. (`--latency-probe-run=300` 실행에
> `[eqmux][appdata]` 줄이 하나도 안 나오는 것으로 확인)

---

## 2. 세는 규칙 — **해원의 3회 측정이 이 규칙과 같아야 한다**

`BASELINE.md` §6이 정정한 실수가 정확히 **층을 잘못 잡은 것**이었다.
브리프의 "앱 데이터 ~0 MB"는 상태 파일 폴더(0.003 MB)를 잰 값이었고,
같은 층의 대조군은 46.5 MB였다. **그래서 규칙을 코드가 아니라 여기에 적어 둔다.**

### 2-1. 세는 곳

| 뿌리 | 경로 | 왜 |
|---|---|---|
| `webview` | `EQMUX_DATA_DIR`, 없으면 **`%LOCALAPPDATA%\com.redocu.eqmux`** | 캐시가 쌓이는 곳. `EBWebView/`가 여기 생긴다 |
| `state` | 상태 파일의 부모 (`%APPDATA%\com.redocu.eqmux`) | 우리가 직접 쓰는 것 |

기본값 경로는 **추측이 아니라 Tauri 코드에서 확인했다** — `tauri 2.11.5`의
`manager/webview.rs`가 Windows/Linux에서 `data_directory`를 안 주면
`LocalData/<identifier>`로 강제한다. 이 경로가 틀리면 리포트는 빈 폴더를 재고 "0 MB"라고 보고한다.

### 2-2. 빼는 곳

- **워크스페이스** (`EQMUX_WORKSPACE_ROOT`). 기본 경로에서 워크스페이스는 `state` 폴더 **안**에 있다.
  빼지 않으면 **사용자 저장소 크기가 우리 앱 데이터로 둔갑한다.**
  → 워크스페이스에 20 MB 파일을 심고 확인했다. 총계 `0.00 MB` — 안 센다.
- **재파스 포인트**(심볼릭 링크·정션). 따라가면 고리에 빠지고 남의 것을 센다.
- 뿌리끼리 겹치면 한 번만 센다(환경변수 둘을 같은 폴더로 둘 수 있다).

### 2-3. "캐시 계열" 판정

폴더 이름이 **`cache`를 포함**하거나 다음 중 하나면, **그 아래 전부**를 캐시로 센다.

```
dictionaries · shared dictionary · service worker · blob_storage
```

기준선의 네 항목(`Cache`·`Code Cache`·`Dictionaries`·`GPUCache`)을 그대로 덮고,
WebView2에만 있는 것(`GrShaderCache`·`DawnGraphiteCache`·`DawnWebGPUCache`·`ShaderCache`)까지 잡는다.

### 2-4. 훑기 상한

`400,000개` · `3초` · `깊이 32`. 걸리면 `truncated`가 서고 stderr·상태줄에 **`⚠잘림`**이 붙는다.
**잘린 값을 안 잘린 척 내보내면 그 숫자는 나중에 못 쓴다.**

---

## 3. 재현

```powershell
# ① 무인 — 창을 안 열고 재고 끝낸다. JSON까지 남기려면 -out을 준다.
.\src-tauri\target\release\eqmux.exe --appdata-report
.\src-tauri\target\release\eqmux.exe --appdata-report-out="$env:TEMP\eqmux-appdata.json"

# ② 격리 폴더를 대상으로. 라이브를 안 건드린다.
$env:EQMUX_DATA_DIR = "$env:TEMP\eqmux-probe\webview"
.\src-tauri\target\release\eqmux.exe --appdata-report
```

출력:

```
[eqmux][appdata] 무인 — 총 13.75 MB (캐시 12.84 MB · 93%) · KR2 60 MB의 23% · 파일 189개 · 2ms
[eqmux][appdata]   webview     13.75 MB  C:\Users\USER\AppData\Local\com.redocu.eqmux
[eqmux][appdata]            └ EBWebView/Default 8.64 · EBWebView/GrShaderCache 4.57 · EBWebView/ShaderCache 0.53 · …
[eqmux][appdata]   state        0.00 MB  C:\Users\USER\AppData\Roaming\com.redocu.eqmux
```

> 1단계가 사실상 한 폴더뿐이면(WebView2가 정확히 그렇다) **그 안쪽을 보여준다.**
> `EBWebView 13.75 MB` 한 줄은 크기만 알려주고 **어디가 자랐는지는 하나도 안 알려준다.**

---

## 3.5 ✅ 해원 확인 (2026-08-05) — **총계는 같은 층이다. 캐시 비중만 비교 금지**

이안 지시로 §2의 세는 규칙이 `BASELINE.md`의 기준과 맞는지 대조했습니다. **결론: 3회 측정 그대로 가도 됩니다.**

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | **층(layer)** | ✅ **일치** | `BASELINE.md` §6은 `%APPDATA%\agent-commender`(Electron userData **한 폴더**)를 쟀다. Electron은 캐시와 상태가 한 폴더에 같이 있다. Tauri는 그걸 `LOCALAPPDATA`(webview) / `APPDATA`(state) **둘로 쪼갠다.** §2-1이 **둘을 합산**하므로 같은 층이다 |
| 2 | **워크스페이스 제외** | ✅ **일치** | AgentCommender는 워크스페이스가 userData **밖**이라(`~\AgentCommender\` 또는 사용자 지정) 애초에 안 들어갔다. §2-2가 빼는 것과 결과가 같다 |
| 3 | **캐시 계열 판정** | ⚠️ **다르다 — §2-3 규칙이 더 넓다** | 아래 |

### ⚠️ 3번 — `93%`와 `95.6%`를 나란히 놓으면 안 됩니다

`BASELINE.md` §6은 캐시를 **4폴더 수동 지정**으로 셌습니다 (`Cache`·`Code Cache`·`Dictionaries`·`GPUCache`).
§2-3 규칙은 그보다 넓습니다. **M1에서 AgentCommender에 §2-3 규칙을 그대로 적용해 봤습니다:**

| | 총계 | 캐시 계열 | 비중 |
|---|---|---|---|
| `BASELINE.md` §6 규칙 (4폴더) | 52.62 MB | 50.97 MB | **96.9%** |
| **§2-3 규칙** (`*cache*` + 4종 이름) | 52.62 MB | **52.50 MB** | **99.8%** |

§2-3이 추가로 잡는 것: `DawnGraphiteCache` 0.53 · `DawnWebGPUCache` 0.53 · `Shared Dictionary` 0.47 · `blob_storage` 0.
캐시가 **아닌** 것으로 남는 건 `Local Storage` 0.01 · `Network` 0.06 · `Session Storage` 0.01 — 합쳐서 **0.08 MB**뿐입니다.

> **그래서 §0의 "캐시 93%"와 `BASELINE.md` §6의 "95.6%"는 서로 다른 자로 잰 값입니다.**
> **총계(13.75 vs 52.62 MB)는 그대로 비교해도 되고, 비중 %만 각주를 답니다.**
> 규칙을 바꾸자는 게 아닙니다 — **§2-3이 더 정확합니다.** `BASELINE.md` 쪽이 손으로 4개만 집은 것이고,
> 지울 것을 고르는 게 목적이면(`S3-6`) 넓은 쪽이 맞습니다.

**`PowerShell로 따로 세지 말라`는 §4 요청 — 동의합니다.** 3회 측정은 `--appdata-report-out`으로만 냅니다.
다만 **AgentCommender 대조군은 그 바이너리로 못 잽니다**(Electron 앱이라 `eqmux.exe` 플래그가 없음).
대조군 값이 필요해지면 §2-3 규칙을 그대로 옮긴 스크립트로 재고, **그 사실을 값 옆에 적겠습니다.**

---

## 4. 해원에게 — `#7` ② 3회 측정 절차

도그푸딩 **시작 · 1주차 · 종료** 3회다. 각 시점에 아래 한 줄이면 된다.

```powershell
.\eqmux.exe --appdata-report-out="D:\...\appdata-<시점>.json"
```

**PowerShell로 따로 세지 말아 주세요.** 세는 규칙이 갈리면 3회 측정이 서로 비교가 안 됩니다 —
`BASELINE.md` §6에서 어긋난 게 정확히 그 실수였습니다. 같은 코드로 재고 같은 JSON을 남깁니다.

### 아직 없는 값 — **설치 직후 10분 유휴**

`BASELINE.md` §3.2b가 AgentCommender를 **빈 폴더에서 시작해 10분 유휴 후 34.43 MB**로 쟀습니다.
**EQMUX의 같은 조건 값이 없습니다.** §0의 13.70 MB는 7초 후 값이라 같은 층이 아닙니다.
10분간 창을 띄워 둬야 하는 측정이라 규격 측정 쪽에 남깁니다.

```powershell
$base = "$env:TEMP\eqmux-idle"; Remove-Item $base -Recurse -Force -EA SilentlyContinue
$env:EQMUX_STATE_PATH="$base\state.json"; $env:EQMUX_WORKSPACE_ROOT="$base\ws"; $env:EQMUX_DATA_DIR="$base\webview"
Start-Process .\eqmux.exe            # 10분 방치 (아무것도 치지 않는다)
.\eqmux.exe --appdata-report-out="$base\idle-10m.json"   # 같은 환경변수로 잰다
```

---

## 5. 남겨 둔 것

| # | 무엇 | 왜 안 했나 |
|---|---|---|
| 1 | **상한 강제**(초과 시 오래된 것부터 삭제) | `S3-6` 그대로. `#7`이 *"측정은 지금부터, 강제는 S3-6"* 으로 확정했다 |
| 2 | 스크롤백 줄 수 상한 | 같은 `S3-6` (FEATURES `A8`) |
| 3 | 증가 곡선 파일 기록 | stderr에 1 MB 단위로 남는다. 파일로 뽑는 건 필요해지면 |
| 4 | 앱 데이터 폴더 열기 버튼 | UI는 `S2-8`(이안 설계) 뒤에 |

> **`S3-6`에 넘길 때 이 문서를 같이 본다.** 무엇을 지울지는 §2-3의 "캐시 계열" 판정이 그대로 답이다 —
> 지금 그게 **93%**다. 지울 게 그것뿐이라는 뜻이기도 하다.
