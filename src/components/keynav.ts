// 키보드 이동 계산 (U37) — 대화상자 Tab 가두기와 세그먼트 화살표 이동이 같이 쓴다. DOM 없는 순수 함수라 테스트가 여기를 겨눈다.

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

/** 화면을 옮기는 전역 단축키 — Ctrl+Shift+U(다음 미확인) · D(관제 토글) · B(패널) · L(배치) */
const NAV_KEYS = new Set(["u", "d", "b", "l"]);
/** 모달이 떠 있는 동안 막을 키인가 (B72) — 뒤에서만 화면이 바뀌어 무반응처럼 보이고 '본 것'만 찍혔다.
 *  배치 창이 떠 있을 때의 Ctrl+Shift+L은 그 창을 닫는 토글이라 통과시킨다 */
export function blocksNavKey(
  e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string },
  modal: boolean,
  pickerOpen: boolean,
): boolean {
  if (!modal || !e.ctrlKey || !e.shiftKey || e.altKey) return false;
  const k = e.key.toLowerCase();
  return NAV_KEYS.has(k) && !(k === "l" && pickerOpen);
}
