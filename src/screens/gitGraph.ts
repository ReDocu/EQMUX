// git 화면 그래프 레인 계산 (§17 G3) — 의존성 없이 프런트에서 직접 한다.
// 입력은 `git log --topo-order` 순서(최신 먼저)의 커밋과 부모 해시다. 레인은 압축하지 않는다:
// 지나가는 선은 제자리에 있고, 끝난 레인 자리는 다음 새 레인이 다시 쓴다.
// 색은 레인 자리가 아니라 "가지"에 붙는다 — 첫 부모로 이어지는 동안 같은 색이다 (브랜치마다 고정).

export interface GraphInput {
  hash: string;
  parents: string[];
}

/** 한 행의 선 조각 — 위 절반(행 머리 → 점 높이) 또는 아래 절반(점 높이 → 행 바닥), 레인 번호로 */
export interface GraphLine {
  half: "top" | "bottom";
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  col: number; // 이 커밋의 점이 놓이는 레인
  color: number;
  lines: GraphLine[];
  /** 이 행에 그릴 레인 수 (점 · 선 중 가장 오른쪽 + 1) */
  width: number;
}

export function computeGraph(commits: GraphInput[]): GraphRow[] {
  const lanes: (string | null)[] = []; // 레인마다 다음에 나올 것으로 기다리는 해시
  const colors: number[] = [];
  let nextColor = 0;
  const free = () => {
    const i = lanes.indexOf(null);
    return i < 0 ? lanes.length : i;
  };
  const rows: GraphRow[] = [];
  for (const c of commits) {
    const lines: GraphLine[] = [];
    let col = lanes.indexOf(c.hash);
    if (col < 0) {
      // 기다린 레인이 없다 — 가지 끝(브랜치 머리)이다. 새 색, 점 위에 선이 없다
      col = free();
      colors[col] = nextColor++;
    }
    const color = colors[col];
    // 위 절반: 이 커밋을 기다린 레인은 점으로 모이고, 나머지는 곧게 지나간다
    lanes.forEach((h, i) => {
      if (h === null) return;
      lines.push({ half: "top", from: i, to: h === c.hash ? col : i, color: colors[i] });
      if (h === c.hash) lanes[i] = null; // 합쳐진 레인은 여기서 끝난다 (col은 아래에서 다시 채운다)
    });
    // 아래 절반: 첫 부모는 같은 레인 · 같은 색, 나머지 부모는 기다리는 레인으로 가거나 새 레인을 연다
    const [first, ...rest] = c.parents;
    lanes[col] = first ?? null; // 뿌리 커밋이면 레인이 끝난다
    if (first) lines.push({ half: "bottom", from: col, to: col, color });
    for (const p of rest) {
      let j = lanes.indexOf(p);
      if (j < 0) {
        j = free();
        lanes[j] = p;
        colors[j] = nextColor++;
      }
      lines.push({ half: "bottom", from: col, to: j, color: colors[j] });
    }
    // 지나가는 레인 — 위 절반에서 곧게 들어온 것만 아래로 잇는다
    for (const l of lines) {
      if (l.half === "top" && l.from === l.to && l.from !== col && lanes[l.from] !== null) {
        lines.push({ half: "bottom", from: l.from, to: l.from, color: l.color });
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const width = Math.max(col, ...lines.map((l) => Math.max(l.from, l.to))) + 1;
    rows.push({ col, color, lines, width });
  }
  return rows;
}
