# EQMUX

AgentCommender의 후속작. **Tauri 2 + WebView2 + Rust**로 재작성한 터미널 멀티플렉서.

> wmux는 경쟁 제품이지 원본이 아니다. 원본은 AgentCommender다.
> 재작성의 명분은 *"불안정해서"가 아니라 "무거워서"*다 — 배포물 ≈440MB → 8.55MB.
> 자세한 근거: [docs/OBJECTIVES.md](docs/OBJECTIVES.md)

---

## 상태

**1차 (터미널 모드) · S0 준비 단계.** 날짜 없이 관문 통과로만 진행한다.

| 단계 | 목표 | 상태 |
|---|---|---|
| S0 | 준비 — 기준선·전제·스파이크·저장소 | 진행 중 |
| S1 | Walking Skeleton → **관문 A** | 대기 |
| S2 | 멀티플렉싱 | 대기 |
| S3 | 기본기 마감 | 대기 |
| S4 | 도그푸딩 → **관문 B** | 대기 |

---

## 폴더 구조

```
EQMUX/
├── src/             프런트 (TypeScript + Vite)
├── src-tauri/       백엔드 (Rust)
│   ├── src/
│   │   ├── lib.rs       빌더 구성 · 창 생성
│   │   ├── config.rs    경로 해석 · 측정용 격리 스위치
│   │   ├── error.rs     공통 에러 타입
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
cargo tauri build          # 릴리스 exe + msi + nsis
cargo tauri dev            # 개발 모드로 실행
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

### 키 입력 지연 계측 (관문 A-3)

```powershell
# 무인 측정 — 200회 자동 입력 후 결과를 쓰고 종료한다
.\src-tauri\target\release\eqmux.exe --latency-probe-run=200 `
  --latency-probe-out="$env:TEMP\eqmux-latency.jsonl"

# 손으로 쳐 보면서 실시간으로 보기
.\src-tauri\target\release\eqmux.exe --latency-probe
```

3점을 잰다 — `keydown → 파싱 완료 → 렌더 완료`. JSONL 표본마다 `parse_ms / render_ms / total_ms`,
마지막 줄에 `p50 / p95 / p99 / max` 요약이 붙는다.

> **측정 범위를 그대로 옮겨 적는다.**
> 포함: keydown 핸들러 → 파싱 → 렌더 프레임.
> **미포함: OS 키보드 입력 → 브라우저 keydown 디스패치.** 앱 밖이라 잴 수 없다.
> `--latency-probe-run`은 합성 `KeyboardEvent`를 쓰므로 이 구간이 빠진다 — 결과 JSON의
> `note` 필드에도 같은 문장이 들어간다.

**아직 PTY가 없다(S1-2).** 지금 재는 것은 *입력 → 로컬 에코 → 렌더*다.
S1-4에서 PTY 왕복이 이 경로에 들어가면 값이 올라간다. **두 시점의 숫자를 섞어 쓰면 안 된다.**

---

## 문서

읽는 순서대로.

| # | 문서 | 내용 |
|---|---|---|
| 1 | [OBJECTIVES.md](docs/OBJECTIVES.md) | 목적·철학 5개·모드 3개·5단계 로드맵 |
| 2 | [WORKPLAN.md](docs/WORKPLAN.md) | 1차 작업 29개 · 담당 · 관문 |
| 3 | [BASELINE.md](docs/BASELINE.md) | AgentCommender 기준선 실측 (S0-1) |
| 4 | [SPIKE-S0-4.md](docs/SPIKE-S0-4.md) | Tauri/WebView2 스파이크 결과 (S0-4) |
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
