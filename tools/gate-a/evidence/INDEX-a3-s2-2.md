# INDEX — `S2-2` 실측 원표본 (M2 · 2026-08-05)

> 측정: 진세아(Dev) · 빌드: `npx tauri build` (S2-2 누수 수정 포함, exe 5,250,560 B)
> 격리: `EQMUX_STATE_PATH`/`EQMUX_WORKSPACE_ROOT`/`EQMUX_DATA_DIR` 전부 임시 폴더
> 기계: M2 (Ryzen 7 8845HS · Radeon 780M · 120 Hz — 요약 JSON `machine` 블록이 실측값)

| 파일 | 무엇 | 요약 |
|---|---|---|
| `a3-m2-s2-2-latency-500-panes4.jsonl` | **4분할 A-3** (`--latency-probe-run=500 --panes=4`) | 실작업 p99 **0.7 ms** (≤8 통과) · 총지연 p99 **8.4 ms** (≤16.6 통과) · `config.panels: 4` |
| `a3-m2-s2-2-latency-500-panes1.jsonl` | 같은 빌드 1패널 대조 | 실작업 p99 **0.7 ms** · 총지연 p99 **8.6 ms** — 4분할과 차이 없음(회귀 없음) |
| `s2-2-panes-probe.json` | `--panes-probe` 통과 원본 | 패널 4/4 · PTY 4→1 · 캔버스 8→2(패널당 2장) · 죽인 3개 모두 정리 · 렌더러 4/4 · exit 0 |

## 읽는 법

- 두 지연 파일 모두 마지막 줄이 `kind: "summary"`다. `gate.verdict_valid: true` 확인 후
  `a3_1_*`/`a3_2_*`만 집어가면 된다. **`config.panels`가 1과 4를 가른다** — 섞으면 안 된다.
- 4분할 계측은 화면만 나눈다(백엔드 트리·PTY 없음 — `docs/LAYOUT-S2-2.md` §4).
  WebGL 컨텍스트는 패널당 1개로 4개가 산다 — 하나라도 유실되면 stderr에 남고
  `panels[]` 판정이 갈린다. 이번 실행은 4/4 전부 "WebGL2 · 하드웨어"였다.
- S1-3 시절 원표본은 `INDEX-a3-s1-3.md`. 이번 값과 직접 비교해도 된다(같은 기계 M2).
