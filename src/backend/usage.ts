// 사용 한도 · 컨텍스트 표시 (0.6 F1 · 토큰 #5) — W2 statusLine 값(rateLimit · contextPct)을 화면 문구로. 순수 함수
import { t, tf } from "../i18n";
import type { RateLimit } from "../types";

const WINDOW: Record<string, string> = { five_hour: "5시간", seven_day: "7일" };

/** "5시간 한도 72%" — 창 이름을 모르면 원문 그대로 */
export const limitText = (r: RateLimit): string =>
  tf("{window} 한도 {pct}%", { window: WINDOW[r.window] ? t(WINDOW[r.window]) : r.window, pct: Math.round(r.usedPct) });

/** 재설정 시각 — 오늘이면 "14:30", 아니면 "11/3 14:30" */
export function resetAt(r: RateLimit, now = Date.now()): string | undefined {
  if (!r.resetsAt) return undefined;
  const d = new Date(r.resetsAt * 1000);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 여러 세션 중 가장 많이 쓴 한도 — 같은 계정이면 값이 같고, 다르면 가장 급한 것을 보인다 */
export function worstLimit(list: readonly { rateLimit?: RateLimit }[]): RateLimit | undefined {
  let w: RateLimit | undefined;
  for (const s of list) if (s.rateLimit && (!w || s.rateLimit.usedPct > w.usedPct)) w = s.rateLimit;
  return w;
}

/** 이만큼 쓰면 amber — 넘김·요약을 생각할 때 */
export const LIMIT_WARN = 80;
export const CTX_WARN = 85;
