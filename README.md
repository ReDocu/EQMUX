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
├── docs/            사양·계획·측정 기록 (아래 표)
├── spike/           검증용 실험 코드. 제품 코드가 아니다
│   └── s0-4-tauri/  S0-4 — Tauri/WebView2 동작 확인 + WebGL 프로브
├── .claude/         Claude Code 프로젝트 설정 (권한 allowlist)
├── LICENSE          미정 — 5차에 확정
└── README.md
```

**제품 코드 자리는 아직 없다.** `S1-1`(Tauri 골격 + Rust 백엔드 구조)에서 만든다.
그때 `spike/s0-4-tauri`를 승격할지 새로 잡을지 정한다.

---

## 빌드

현재 빌드 가능한 것은 S0-4 스파이크뿐이다.

```powershell
cd spike\s0-4-tauri
npm install
cargo tauri build          # 릴리스 exe + msi + nsis
cargo tauri dev            # 창 띄우고 확인
```

**필요한 것**: Rust(stable-msvc) · MSVC 빌드도구 · Windows SDK · Node · WebView2 런타임.
설치·검증 절차는 [docs/SPIKE-S0-4.md](docs/SPIKE-S0-4.md) §6에 있다.

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
