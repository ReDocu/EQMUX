# INDEX — `S2-3` 실측 원표본 (M2 · 2026-08-05)

> 측정: 진세아(Dev) · 빌드: `npx tauri build` (S2-3 드래그 + ConPTY drop 비동기화, exe 5,252,608 B)
> 격리: `EQMUX_STATE_PATH`/`EQMUX_WORKSPACE_ROOT`/`EQMUX_DATA_DIR` 전부 임시 폴더

| 파일 | 무엇 | 요약 |
|---|---|---|
| `a3-m2-s2-3-latency-500-panes4.jsonl` | 4분할 A-3 (`--latency-probe-run=500 --panes=4`) | 실작업 p99 **0.7 ms** (≤8 ✅) · 총지연 p99 **8.4 ms** (≤16.6 ✅) — **S2-2와 동일, 드래그 코드의 rAF 비용 0** |
| `s2-3-panes-probe.json` | `--panes-probe` 통과 원본 (3연속 중 1회차) | 패널 4/4 · PTY 4→1 · 캔버스 8→2 · 죽인 3개 정리 · 렌더러 4/4 · **3회 전부 exit 0** |

## 왜 3연속인가 — 행(hang) 재현과 수정

S2-3 첫 빌드에서 `--panes-probe`가 **3회 중 2회 멈췄다**(창 산 채 동결 · 판정 없음).
원인은 S2-2의 `PtyManager::kill()` — 세션 drop이 ConPTY를 닫는데, 이 닫기가 conhost 상태에
따라 **블로킹**되고, 동기 명령이라 **메인 스레드째** 얼었다. 메모리 압박(여유 ~1.7GB)에서
드러난 잠복 결함으로, S2-3 프런트 변경과 무관하다. 수정: drop을 전용 스레드로 이관
(`pty.rs::kill`). 수정 빌드에서 3연속 통과 — 그래서 이 표본은 1회가 아니라 3회다.
