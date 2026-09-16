// WebGL 컨텍스트 예산 — 크로미움은 렌더러 프로세스당 16개를 넘으면 가장 먼저 만든 것부터
// 강제로 잃게 만든다. 뺏긴 페인은 낡은 프레임인 채 굳고 창 크기를 바꿔야 돌아온다
// (진단 로그에서 webglLost = terms - 16으로 1:1 확인됐다).
//
// 세션은 페인보다 오래 살고(REGISTRY) 배치는 n분할이라, 페인 수로는 이 예산이 지켜지지 않는다.
// 그래서 여기서 직접 죈다. 상한을 넘긴 터미널은 DOM 렌더러로 돈다 — 느릴 뿐 화면은 같다.
//
// 16이 아니라 12인 이유: 16은 렌더러 프로세스 전체가 나눠 쓰는 예산이다. 터미널이 전부
// 가져가면 다른 WebGL 소비자가 생기는 순간 같은 증상이 다시 난다.
export const WEBGL_CAP = 12;

/** 컨텍스트를 하나 더 붙이기 전에 회수할 것들 — 반환 순서대로 폐기하면 자리가 하나 남는다.
 *  안 보이는 페인 먼저다: xterm은 IntersectionObserver로 안 보이는 터미널의 렌더를 멈춰 두므로
 *  그 컨텍스트는 슬롯만 먹고 아무 일도 안 한다. 그 다음이 가장 오래 붙어 있던 것. */
export function pickEvictions<T extends { mounted: boolean; touched: number }>(
  held: T[],
  cap = WEBGL_CAP,
): T[] {
  if (held.length < cap) return [];
  const order = [...held].sort((a, b) => Number(a.mounted) - Number(b.mounted) || a.touched - b.touched);
  return order.slice(0, held.length - cap + 1);
}
