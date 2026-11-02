// Jump 팔레트 (0.6 §4 · W3) — 항목 거르기 · 순위. DOM 없는 순수 함수라 테스트가 여기를 겨눈다.

export type JumpKind = "session" | "workspace" | "mission" | "screen" | "panel";

export interface JumpItem {
  id: string;
  kind: JumpKind;
  label: string;
  /** 회색 보조 줄 — 워크스페이스 이름 · 직함 등. 찾기에도 쓴다 */
  sub?: string;
  run: () => void;
}

/** 부분 일치(대소문자 무시) — 이름 앞부분 > 이름 안 단어 앞 > 이름 어디든 > 보조 줄. 같은 점수는 원래 순서 */
export function rankItems(items: JumpItem[], query: string, max = 50): JumpItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, max);
  const score = (it: JumpItem): number => {
    const l = it.label.toLowerCase();
    if (l.startsWith(q)) return 0;
    const at = l.indexOf(q);
    if (at > 0 && /[\s·\-_/@]/.test(l[at - 1])) return 1;
    if (at > 0) return 2;
    return it.sub?.toLowerCase().includes(q) ? 3 : -1;
  };
  return items
    .map((it, i) => ({ it, i, s: score(it) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.it);
}
