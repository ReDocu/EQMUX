// 분할선 드래그 (PRD B 잔여, M30) — 터미널 그리드의 트랙 경계(8px gap)에 겹쳐 앉는
// 절대 위치 핸들. 드래그로 이웃 두 트랙의 비율을 바꾸고, 더블클릭으로 그 축을 초기화한다.
// 비율은 state.paneRatios에 살고 layout.json으로 영속된다. 페인 크기 변화는
// TerminalPane의 ResizeObserver가 받아 PTY resize로 이어진다 — 여기서 따로 하지 않는다.
import { For } from "solid-js";
import { DEFAULT_RATIOS, paneLayout, ratioFor, setRatioAxis } from "../state";
import type { PaneLayout } from "../state";

const GAP = 8; // .terminal-grid gap과 일치해야 한다
const MIN = 0.08; // 트랙 최소 비율 — 페인이 0으로 접히지 않게

type Axis = "cols" | "rows";

/** 축의 k번째 경계(트랙 k와 k+1 사이) 위치 — gap의 시작점. calc로 반환한다 */
function edgePos(fractions: number[], k: number): string {
  const totalGap = (fractions.length - 1) * GAP;
  const cum = fractions.slice(0, k + 1).reduce((a, b) => a + b, 0);
  return `calc((100% - ${totalGap}px) * ${cum} + ${k * GAP}px)`;
}

function startDrag(ev: PointerEvent, layout: PaneLayout, axis: Axis, k: number): void {
  ev.preventDefault();
  const grid = (ev.currentTarget as HTMLElement).parentElement;
  if (!grid) return;
  const rect = grid.getBoundingClientRect();
  const fr = (ratioFor(layout)[axis] ?? []).slice();
  if (fr.length < 2) return;
  const totalGap = (fr.length - 1) * GAP;
  const avail = (axis === "cols" ? rect.width : rect.height) - totalGap;
  if (avail <= 0) return;
  const before = fr.slice(0, k).reduce((a, b) => a + b, 0);
  const pair = fr[k] + fr[k + 1];
  const move = (e: PointerEvent) => {
    const pos = axis === "cols" ? e.clientX - rect.left : e.clientY - rect.top;
    // 경계 앞 gap들을 빼고 비율로 환산 — 이웃 두 트랙 안에서만 움직인다
    let cum = (pos - k * GAP) / avail;
    cum = Math.max(before + MIN, Math.min(before + pair - MIN, cum));
    const next = fr.slice();
    next[k] = cum - before;
    next[k + 1] = pair - next[k];
    setRatioAxis(layout, axis, next);
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

/** 그리드 인라인 스타일 — 비율을 fr 템플릿으로. 축이 없는 배치는 그 축을 클래스 규칙에 맡긴다 */
export function gridTemplateStyle(layout: PaneLayout): Record<string, string> {
  const d = DEFAULT_RATIOS[layout];
  const r = ratioFor(layout);
  const tpl = (f: number[]) => f.map((x) => `minmax(0, ${x.toFixed(4)}fr)`).join(" ");
  const st: Record<string, string> = {};
  if (d.cols && r.cols) st["grid-template-columns"] = tpl(r.cols);
  if (d.rows && r.rows) st["grid-template-rows"] = tpl(r.rows);
  return st;
}

/** 현재 배치의 분할선들 — .terminal-grid 안에 절대 위치로 그린다 (grid 자식이지만 out-of-flow) */
export function PaneDividers() {
  const dividers = (axis: Axis) => {
    const layout = paneLayout();
    if (!DEFAULT_RATIOS[layout][axis]) return [];
    const fr = ratioFor(layout)[axis] ?? [];
    return Array.from({ length: Math.max(0, fr.length - 1) }, (_, k) => ({ layout, k, fr }));
  };
  return (
    <>
      <For each={dividers("cols")}>
        {(d) => (
          <div
            class="pane-divider v"
            style={{ left: edgePos(d.fr, d.k) }}
            title="드래그 — 페인 폭 조정 · 더블클릭 — 초기화"
            onPointerDown={(ev) => startDrag(ev, d.layout, "cols", d.k)}
            onDblClick={() => setRatioAxis(d.layout, "cols", DEFAULT_RATIOS[d.layout].cols!)}
          />
        )}
      </For>
      <For each={dividers("rows")}>
        {(d) => (
          <div
            class="pane-divider h"
            style={{ top: edgePos(d.fr, d.k) }}
            title="드래그 — 페인 높이 조정 · 더블클릭 — 초기화"
            onPointerDown={(ev) => startDrag(ev, d.layout, "rows", d.k)}
            onDblClick={() => setRatioAxis(d.layout, "rows", DEFAULT_RATIOS[d.layout].rows!)}
          />
        )}
      </For>
    </>
  );
}
