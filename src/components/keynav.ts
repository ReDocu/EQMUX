// 키보드 이동 계산 (U37) — 대화상자 Tab 가두기와 세그먼트 화살표 이동이 같이 쓴다. DOM 없는 순수 함수라 테스트가 여기를 겨눈다.
import { IS_MAC, modDown } from "../platform";

/** n개 목록에서 i 자리를 한 칸 옮긴 자리 — 끝에서 처음으로 돈다. i가 목록 밖(-1)이면 앞으로는 처음, 뒤로는 끝. 빈 목록은 -1 */
export function stepIndex(n: number, i: number, back: boolean): number {
  if (n === 0) return -1;
  if (i < 0) return back ? n - 1 : 0;
  return (i + (back ? n - 1 : 1)) % n;
}

/** 세그먼트 키 → 옮겨 갈 자리 (라디오 그룹 관례: ←↑ 앞 · →↓ 뒤 · Home 처음 · End 끝). 상관없는 키는 undefined */
export function segKeyIndex(key: string, n: number, i: number): number | undefined {
  if (n === 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return stepIndex(n, i, true);
  if (key === "ArrowRight" || key === "ArrowDown") return stepIndex(n, i, false);
  return undefined;
}

/** 화면을 옮기는 전역 단축키 — Ctrl+Shift+U(다음 미확인) · D(관제 토글) · B(패널) · L(배치) · K(건너뛰기, §4 W3). macOS는 ⌘⇧ (U67) */
const NAV_KEYS = new Set(["u", "d", "b", "l", "k"]);

/** 화면 이동 단축키의 수정자인가 — 주 수정자(macOS ⌘ · 그 밖 Ctrl) + Shift, Alt 없이 */
export function isNavChord(
  e: { ctrlKey: boolean; metaKey?: boolean; shiftKey: boolean; altKey: boolean },
  mac = IS_MAC,
): boolean {
  return modDown({ ctrlKey: e.ctrlKey, metaKey: !!e.metaKey }, mac) && e.shiftKey && !e.altKey;
}

/** 모달이 떠 있는 동안 막을 키인가 (B72) — 뒤에서만 화면이 바뀌어 무반응처럼 보이고 '본 것'만 찍혔다.
 *  배치 창이 떠 있을 때의 Ctrl+Shift+L은 그 창을 닫는 토글이라 통과시킨다 */
export function blocksNavKey(
  e: { ctrlKey: boolean; metaKey?: boolean; shiftKey: boolean; altKey: boolean; key: string },
  modal: boolean,
  pickerOpen: boolean,
  mac = IS_MAC,
): boolean {
  if (!modal || !isNavChord(e, mac)) return false;
  const k = e.key.toLowerCase();
  return NAV_KEYS.has(k) && !(k === "l" && pickerOpen);
}

/** 화면 위 사각형 — DOMRect에서 쓰는 네 변만 */
export type Box = { left: number; top: number; right: number; bottom: number };

/** Ctrl+Shift+화살표 페인 이동 — from 페인에서 화살표 쪽 이웃 페인의 자리. 그쪽에 없으면 -1.
 *  배치 6종·분할 비율을 따로 계산하지 않고 그려진 사각형만 본다: 그 방향으로 완전히 넘어간 페인 중
 *  가까운 것, 같은 거리면 지금 페인의 가운데 줄과 겹치는 것 */
export function neighborPane(boxes: Box[], from: number, key: string): number {
  const c = boxes[from];
  if (!c) return -1;
  const horiz = key === "ArrowLeft" || key === "ArrowRight";
  if (!horiz && key !== "ArrowUp" && key !== "ArrowDown") return -1;
  const cx = (c.left + c.right) / 2;
  const cy = (c.top + c.bottom) / 2;
  const EPS = 2; // 반올림 픽셀 — 간격 0일 때 이웃 변이 1px 겹쳐 잡힐 수 있다
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (i === from) return;
    const ahead =
      key === "ArrowRight" ? b.left - c.right
      : key === "ArrowLeft" ? c.left - b.right
      : key === "ArrowDown" ? b.top - c.bottom
      : c.top - b.bottom;
    if (ahead < -EPS) return;
    // 가운데 줄에서 그 페인 범위까지의 거리 — 줄이 페인을 지나면 0
    const off = horiz ? Math.max(0, b.top - cy, cy - b.bottom) : Math.max(0, b.left - cx, cx - b.right);
    const score = Math.max(0, ahead) + off * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
