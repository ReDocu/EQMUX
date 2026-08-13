// waiting 사운드 (FR-G-34 · G6) — 기본 꺼짐, 설정에서 켰을 때만 waiting 진입에 한 번 울린다.
// 오디오 파일 없이 웹오디오 비프 — 번들·권한 부담이 없다.
let ctx: AudioContext | undefined;

export function beepWaiting(): void {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.26);
  } catch {
    /* 오디오 불가 환경 — 조용히 무시 */
  }
}
