# S0-4 스파이크 — Tauri / WebView2 동작 확인

> 작성: 진세아 (Dev) · 2026-08-04
> 근거: [WORKPLAN.md](WORKPLAN.md) S0-4 · [BRIEF-2026-08-04.md](BRIEF-2026-08-04.md) 3절
> 산출물 위치: `project/EQMUX/spike/s0-4-tauri/`

---

## 0. 결론

**DoD 충족.** `cargo tauri dev`로 창이 떴고, WebView2가 정상 렌더했고, 프런트↔Rust IPC 왕복이 성공했다.

덤으로 확인한 것 하나와, 새로 걸린 것 하나가 있다.

| | |
|---|---|
| ✅ **좋은 소식** | WebView2에서 **WebGL2가 하드웨어(D3D11) 경로로** 잡힌다. R1의 전제가 깨지지 않았다 |
| ⚠️ **나쁜 소식** | 빈 창 하나에 **RAM 147MB(private) / 404MB(WorkingSet)**. 관문 A-4 기준을 다시 봐야 한다 |

---

## 1. 환경 — 재현에 필요한 값

측정을 재현하거나 다른 기계와 비교할 때 이 표를 먼저 맞춘다.

| 항목 | 값 |
|---|---|
| OS | Windows 11 Home 10.0.22631 |
| CPU 논리코어 | 16 |
| GPU | AMD Radeon 780M Graphics (0x1900) |
| 화면 / 배율 | 1440×810 논리 · `devicePixelRatio 2` (200%) |
| WebView2 런타임 | **150.0.4078.105** (Evergreen, 사전 설치됨) |
| MSVC 툴셋 | 14.51.36231 (VS Community 2026) |
| Windows SDK | 10.0.26100.0 |
| rustc / cargo | **1.97.1** `stable-x86_64-pc-windows-msvc` |
| tauri-cli | **2.11.4** |
| tauri (crate) | 2.11.5 |
| Node / npm | 24.18.0 / 11.16.0 |
| 프런트 | Vite 6.4.3 + TypeScript (vanilla-ts 템플릿) |

**설치가 필요했던 것은 Rust 하나뿐이다.** 나머지(WebView2·MSVC·Win SDK·Node)는 이미 있었다.
Rust는 rustup으로 넣었으므로 `rustup self uninstall`로 되돌릴 수 있다.

---

## 2. WebGL 프로브 — R1 관련

스파이크에 빈 창만 띄우지 않고 환경 프로브를 같이 넣었다.
S1-3이 프로젝트를 뒤집을 수 있는 항목인데, 창을 띄우는 김에 재면 추가 비용이 0이기 때문이다.

```json
{
  "userAgent": "... Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0",
  "devicePixelRatio": 2,
  "hardwareConcurrency": 16,
  "webgl1": true,
  "webgl2": true,
  "webgl2.unmaskedVendor": "Google Inc. (AMD)",
  "webgl2.unmaskedRenderer": "ANGLE (AMD, AMD Radeon 780M Graphics (0x00001900) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "webgl2.version": "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
  "webgl2.maxTextureSize": 16384,
  "softwareRasterizer": false
}
```

원본: `spike/s0-4-tauri/src-tauri/probe-result.json`

### 읽는 법

| 항목 | 의미 |
|---|---|
| `webgl2: true` | 컨텍스트가 잡힌다 |
| `unmaskedRenderer`에 **D3D11** | ANGLE이 Direct3D11로 붙었다 — **실제 GPU** |
| `softwareRasterizer: false` | **SwiftShader 폴백이 아니다** |
| `maxTextureSize: 16384` | xterm.js 글리프 아틀라스에 넉넉하다 |

### 왜 `softwareRasterizer`를 따로 쟀는가

**"WebGL이 된다"와 "쓸 만하다"는 다르다.**
WebView2가 GPU 블록리스트에 걸리면 SwiftShader(소프트웨어 래스터라이저)로 폴백하는데,
이때도 `webgl2` 컨텍스트는 **정상적으로 잡힌다.** 그 상태로 S1-3을 통과시키면
관문 A-3(키 입력 p99 ≤ 16ms)에서 원인을 모른 채 막힌다.
렌더러 문자열 한 줄을 지금 찍어두면 그때 헤매지 않는다.

### ⚠️ R1은 아직 죽지 않았다

여기서 확인한 것은 **"WebView2에서 하드웨어 WebGL2 컨텍스트가 잡힌다"까지다.**

S1-3의 실제 판정은 xterm.js WebGL 애드온을 붙여서 ① 글자가 그려지고 ② p99가 나오는가이다.
**전제 조건이 깨지지 않았다는 뜻이지, 통과가 아니다.** 규모 `?`는 그대로 두는 것을 권한다.

---

## 3. 배포물 크기 — 432MB와 비교할 숫자

| 산출물 | 크기 |
|---|---|
| `s0-4-tauri.exe` (릴리스 실행 파일) | **8.55 MB** |
| `.msi` 인스톨러 | 2.81 MB |
| `-setup.exe` (NSIS) | **1.82 MB** |
| 프런트 `dist/` | 3.9 KB |

### AgentCommender와 나란히

| | AgentCommender | EQMUX 스파이크 |
|---|---|---|
| 자체 코드 | 7.3 MB | 8.55 MB (단일 exe, 런타임 포함) |
| 런타임 | **432.5 MB** (node_modules) | **0 MB** (WebView2는 OS 제공) |
| **배포 합계** | **≈440 MB** | **8.55 MB** |

**OBJECTIVES 지표(배포물 ≤ 40MB)는 충분히 여유가 있다.**
빈 앱이 8.55MB이므로 기능을 다 넣어도 40MB 안에 들어갈 가능성이 높다.
다만 이 8.55MB에는 xterm.js·PTY·레이아웃이 아직 하나도 없다. S3 끝나고 다시 잰다.

> **갱신 (S1-1, 2026-08-04).** 제품 골격은 **2.97 MB**로 나왔다 —
> 릴리스 프로파일에 `opt-level="s"` · `lto` · `codegen-units=1` · `panic="abort"` · `strip`을 걸어서
> 위 8.55MB(기본 프로파일)에서 65% 줄었다. nsis 1.04MB / msi 1.58MB.
> **8.55MB는 스파이크의 기본 프로파일 값이므로 기준으로 쓰지 말 것.**
> RAM은 거의 그대로다 — 369.8 MB(WS) / 120.8 MB(private). 4절의 논지가 여기서도 유지된다.

### 참고 — 빌드 캐시

`src-tauri/target/` 이 **5.7 GB**다. 배포물이 아니라 로컬 빌드 산출물이다.
**S0-6의 `.gitignore`에 반드시 들어가야 한다.** (`target/`, `dist/`, `node_modules/`)

---

## 4. ⚠️ RAM — 이안에게 재검토 요청

### 측정값

빈 페이지 1개, 터미널 0개, 기동 12초 후.

| 빌드 | 프로세스 | WorkingSet | PrivateWorkingSet |
|---|---|---|---|
| dev | 7 (앱 1 + webview2 6) | 417.8 MB | — |
| **release** | **7** (앱 1 + webview2 6) | **404.1 MB** | **147.0 MB** |

내역 (release): `msedgewebview2.exe` ×6 = 377.0 MB · `s0-4-tauri.exe` = 27.1 MB

### 여기서 나온 것

> **Tauri가 줄이는 것은 디스크이지 RAM이 아니다.**

배포물 440MB → 8.55MB는 브라우저 엔진을 안 싣기 때문이고, 이건 확실하다(3절).
그러나 **실행 중에는 결국 Chromium이 뜬다.** Electron이든 WebView2든 같은 엔진이다.
dev(417.8)와 release(404.1)가 거의 같은 것도 같은 이유다 — 우리 코드가 아니라 엔진이 쓰는 메모리다.

**관문 A-4 `유휴 RAM ≤ 기준선의 40%`는 엔진 교체만으로 달성되는 항목이 아닐 수 있다.**

### 해원의 S0-1과 교차 확인 (추가 · 2026-08-04)

[BASELINE.md](BASELINE.md)가 나왔다. **해원이 다른 경로로 같은 결론에 도달했다.**

- 내 근거: 빈 창 하나가 이미 404 MB를 쓴다 (엔진이 쓰는 것이지 우리 코드가 아니다)
- 해원의 근거(§3.1): 트리 기준 목표 408.1 MB인데 **셸 페이로드만 454.0 MB**다.
  pwsh·conhost는 EQMUX가 띄워도 똑같이 뜨므로 **앱이 0 MB여도 미통과**

두 근거는 서로 독립적이고, 둘 다 A-4가 지금 정의로는 성립하지 않는다고 말한다.

### ⚠️ 그런데 해원의 재정의안(앱 전용)으로도 빠듯하다

해원의 제안: 기준선을 앱 전용 **566.3 MB**로 바꾸고 40% = **226.5 MB**를 목표로.

내 실측을 같은 지표(WorkingSet)로 나란히 놓으면:

| | 조건 | WorkingSet |
|---|---|---|
| AgentCommender (electron만) | **터미널 4개** | 566.3 MB |
| 재정의 목표 (40%) | — | **226.5 MB** |
| **EQMUX 스파이크** | **터미널 0개, 빈 페이지** | **404.1 MB** |

**터미널이 하나도 없는 빈 창이 이미 목표의 1.8배다.**

단, 이 비교에는 유보가 있다 — WebView2 프로세스 6개는 웹뷰 1개에 딸린 고정 비용에 가깝다.
터미널을 4개 열어도 프로세스가 4배로 늘지는 않을 것이다(같은 웹뷰 안의 DOM이다).
**즉 EQMUX는 초기 비용이 크고 증가분이 작은 형태일 가능성이 있다.**
확인은 S1-4(터미널이 실제로 붙은 뒤)에 같은 스크립트로 다시 재야 한다.

지금 말할 수 있는 것은 하나다: **A-4는 "40%"라는 비율이 아니라 절대값으로 다시 잡아야 한다.**
기준선의 몇 %가 아니라 "터미널 4개에 몇 MB"로. 판정은 이안 몫이고, `issue.md #6`에 붙는다.

### 지표 통일 요청

해원은 `WorkingSet64`로, 나는 `WorkingSet` + `PrivateWorkingSet`으로 쟀다.
WorkingSet끼리는 비교가 성립하지만(위 표), **절대값 판단에는 private가 맞다** —
WorkingSet은 공유 페이지를 프로세스마다 중복으로 센다. Electron과 WebView2 **둘 다 다중 프로세스**라
중복 계산의 영향이 양쪽 다 크다.

6절의 `measure-ram.ps1`이 두 값을 동시에 낸다. **해원이 이 스크립트로 AgentCommender를 재면
지표가 통일된다** — `-ProcessName` 인자만 바꾸면 된다.

---

## 5. 콜드 스타트 — 참고값

DoD 항목은 아니지만 같은 자리에서 잴 수 있어 남긴다.

| 회차 | 창 핸들 생성 | 콘텐츠 준비(IPC 완료) |
|---|---|---|
| 1 (콜드) | 493 ms | 1,144 ms |
| 2 (웜) | 27 ms | 527 ms |
| 3 (웜) | 44 ms | 495 ms |

- **콜드**: OS 파일 캐시·WebView2 런타임이 안 올라온 최초 실행
- **웜**: 직전 실행 직후. 실사용 체감에 가까운 쪽은 웜이다
- `콘텐츠 준비`는 `프로세스 시작 → 프런트가 Rust 명령 호출 완료`까지다.
  해원의 S0-1 정의(`실행 → 첫 프롬프트 입력 가능`)와 **정확히 같은 지점이 아니다.**
  이 스파이크에는 프롬프트가 없다. 비교하려면 S1-4 이후 같은 방법으로 다시 재야 한다

OBJECTIVES 지표(콜드 스타트 ≤ 1.5초) 기준으로 보면 빈 앱은 1.14초다. 아직 여유가 없지는 않다.

---

## 6. 재현 절차

```powershell
# 0. 전제: WebView2 런타임 · MSVC 빌드도구 · Windows SDK · Node
winget install --id Rustlang.Rustup --exact --silent `
  --accept-package-agreements --accept-source-agreements
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo install tauri-cli --version "^2.0" --locked      # 약 10분

# 1. 실행
cd project\EQMUX\spike\s0-4-tauri
npm install
cargo tauri dev                                        # 첫 빌드 2분 34초

# 2. 릴리스 + 인스톨러
cargo tauri build                                      # 릴리스 컴파일 2분 26초
```

RAM 측정 스크립트는 `spike/s0-4-tauri/measure-ram.ps1`에 있다.
프로세스 트리를 따라가 자식 WebView2 프로세스까지 합산하고, WorkingSet과
PrivateWorkingSet을 함께 낸다. **해원은 이 스크립트로 AgentCommender를 재면 된다** —
`-ProcessName` 인자만 바꾸면 같은 방법이 보장된다.

---

## 7. 걸린 것 세 가지

기록해 두지 않으면 다음 사람이 같은 자리에서 멈춘다.

### 7-1. NSIS 번들이 1회차에 실패 (`os error 5`)

```
Info extracting NSIS
Error failed to bundle project: `액세스가 거부되었습니다. (os error 5)`
```

- **증상**: `.msi`는 나오는데 NSIS만 실패
- **원인**: `%LOCALAPPDATA%\tauri\nsis-3.11` 압축 해제가 중간에 끊겼다.
  루트 `makensis.exe`가 2,560바이트(정상 아님)로 남았고, `nsis_tauri_utils.dll` 다운로드도 안 됐다
- **Defender 탐지 아님** — 이벤트 로그 확인함(최근 탐지는 7월, 무관)
- **해결**: `%LOCALAPPDATA%\tauri\nsis-3.11` 삭제 후 `cargo tauri build --bundles nsis` 재실행 → 통과
- **다음에**: CI에 넣을 때 이 캐시 디렉터리를 신뢰하지 말 것. 실패 시 지우고 1회 재시도하는 단계를 둔다

### 7-2. 스크린샷이 DPI 200%에서 어긋난다

`GetWindowRect`는 논리 좌표를, `CopyFromScreen`은 물리 픽셀을 쓴다.
캡처 프로세스에 `SetProcessDpiAwarenessContext(-4)`를 먼저 걸어야 맞는다.
**검증 스크린샷을 찍는 모든 자리에 해당한다** — 해원의 관문 A 증빙에도 같은 문제가 생긴다.

### 7-3. npm이 esbuild postinstall을 막는다

```
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   esbuild@0.25.12 (postinstall: node install.js)
```

이번에는 `@esbuild/win32-x64` 바이너리가 optionalDependencies로 이미 들어와서 **문제없이 동작했다**
(vite 6.4.3 정상). 다만 경고가 남으므로 S0-6에서 방침을 정해 둔다.

---

## 8. 관찰 — CJK 폭 (관문 A-2 예고편)

프로브 화면에 박스 문자를 같이 그려 봤다.

```
┌─────────────┐
│ 한글 폭 확인 │
└─────────────┘
```

`Cascadia Mono → Consolas → monospace` 지정인데 **테두리가 미세하게 어긋난다.**
Consolas에 한글 글리프가 없어 폴백 폰트(Malgun Gothic 등)로 넘어가고,
그 폰트의 advance width가 모노 폭의 정확히 2배가 아니기 때문이다.

> **⚠️ 이것은 관문 A-2의 결과가 아니다.**
> 이건 **DOM 텍스트 렌더링**이다. xterm.js는 셀 격자를 자기가 계산해서 글리프를 배치하므로
> DOM에서 어긋난다고 xterm에서 어긋난다는 뜻이 아니다. **A-2의 판정은 S1-3 이후에 한다.**
>
> 다만 폰트 선택이 A-2에 영향을 준다는 것은 지금 알 수 있다.
> 한글 글리프를 자체적으로 가진 모노 폰트(D2Coding, Sarasa Mono K 등)를 후보로 미리 검토해 둘 만하다.

---

## 9. 해원의 요청 두 건 — 받았다

[BASELINE.md](BASELINE.md)에서 나에게 온 요청이다. **둘 다 S1에 넣는다.** 이안의 순서 조정만 필요하다.

### 9-1. 측정 전용 플래그 `--latency-probe` (BASELINE §5)

관문 A-3(키 입력 p99 ≤ 16ms)은 **앱 안에 계측기가 없으면 측정 자체가 불가능하다.** 해원 말이 맞다.
외부에서 재면 프로세스 기동 잡음이 측정 대상보다 크고, `session.log` 왕복으로 재면
**xterm 렌더 구간이 통째로 빠진다** — 그 구간이 정확히 S1-3의 관심사다.

계측 지점 3개는 해원이 잡은 대로 간다:

```
keydown (performance.now)
  → term.write() 직후
  → 렌더 완료 (WebGL 프레임 present / rAF 콜백)
```

**S1-3에 함께 넣는 것을 제안한다.** S1-3의 완료 기준이 "화면에 글자가 그려짐 + WebGL 활성 확인"인데,
계측기가 같이 들어가면 **S1-3의 판정 근거가 바로 그 숫자가 된다.** 나중에 붙이면 렌더 경로를 다시 건드려야 한다.

> AgentCommender 쪽 계측기 이식(기능 동결 예외)은 **이안 판단**이다. 다만 순서를 짚어둔다 —
> EQMUX 쪽 숫자만 있어도 "16ms 이하인가"는 판정된다. 기준선은 "얼마나 나아졌나"에만 필요하다.
> **A-3의 통과 판정 자체는 EQMUX 단독으로 가능하다.**

### 9-2. 측정용 격리 스위치 (BASELINE §1)

해원이 AgentCommender를 잴 때 `--user-data-dir` + 상태 경로 환경변수로 라이브 인스턴스를 피했다.
**EQMUX도 관문 B 도그푸딩 중에 팀 세션을 물고 있을 것이므로 같은 장치가 필요하다.**
없으면 재측정이 파괴적 행위가 된다.

**S1-1(Tauri 골격 + Rust 백엔드 구조)에 넣는다.** 상태 경로·워크스페이스 루트를 처음부터
환경변수로 뽑아두는 일이라 나중에 넣는 것보다 지금이 싸다. 구조 결정이라 골격 단계가 맞다.

### 9-3. 측정 하니스 위치 — 정리 필요

지금 측정 스크립트가 두 군데로 갈라지고 있다.

| 파일 | 위치 | 문제 |
|---|---|---|
| `baseline-run2.ps1` (해원) | scratchpad | **세션 끝나면 사라진다** |
| `measure-ram.ps1` (나) | `spike/s0-4-tauri/` | 스파이크에 딸려 있다 — 스파이크는 언젠가 정리된다 |

**둘 다 `EQMUX/tools/`로 옮기는 것을 제안한다.** 관문 A·B에서 계속 쓸 물건이고,
두 앱을 같은 스크립트로 재는 것이 지표 통일의 전제다.
해원이 작업 규칙(구현은 세아만) 때문에 저장소에 코드를 못 둔 것이므로,
**이안이 승인하면 내가 옮기고 관리하겠다.**

---

## 10. 다음

- **S0-6 저장소 초기화** — 폴더 구조 · `.gitignore`(`target/` 5.7GB 필수) · 라이선스 자리
  · `EQMUX/.claude/settings.json` allowlist (브리핑 3절 지시)
- 스킬 중복 정리 · EQMUX 전용 에이전트 정의는 **S2로 보류** (브리핑대로)

### 스파이크 코드 처리

`spike/s0-4-tauri/`는 **버리지 않고 남긴다.** S1-1의 출발점으로 그대로 쓸 수 있고,
프로브 페이지는 다른 기계에서 WebGL 환경을 재확인할 때 다시 쓴다.
S0-6에서 정식 구조를 잡을 때 `spike/`를 그대로 둘지 `apps/`로 승격할지는 그때 정한다.
