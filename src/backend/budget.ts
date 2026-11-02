// 하루 비용 예산 알림 (0.6 §13-6) — statusLine 누적 비용(costUsd)의 증분을 오늘 합계에 더하고,
// 설정 예산을 넘으면 알림 센터와 OS 알림으로 하루 한 번 알린다. 세션을 멈추지 않는다.
// ponytail: 오늘 합계는 이 웹뷰의 localStorage에 둔다 — 임무별 합계(W2 집계)가 생기면 그 값을 쓴다
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { notifyLocal } from "./attention";
import { isTauri } from "./pty";
import { settings } from "./settings";
import { tf } from "../i18n";

/** 누적 비용의 증분 — 처음 보는 세션은 기준선(0)이다(어제 쓴 것일 수 있다). 줄었으면 에이전트를 새로 띄웠다. 순수 함수 */
export function costDelta(last: number | undefined, now: number): number {
  if (last === undefined) return 0;
  return now < last ? now : now - last;
}

/** 로컬 날짜 키 — 자정에 합계가 다시 0부터 */
export const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

interface Spend {
  day: string;
  usd: number;
  alerted: boolean;
}
const KEY = "eqmux.spend";
const load = (): Spend => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "") as Spend;
    if (typeof v.usd === "number") return v;
  } catch {
    /* 없거나 깨졌다 — 0부터 */
  }
  return { day: "", usd: 0, alerted: false };
};

const [spend, setSpend] = createSignal<Spend>(typeof localStorage === "undefined" ? { day: "", usd: 0, alerted: false } : load());
/** 오늘 쓴 금액 (USD) — 대시보드 지표가 본다 */
export const spentToday = (): number => (spend().day === dayKey(Date.now()) ? spend().usd : 0);

const lastCost = new Map<string, number>();

/** agent-state의 costUsd 한 건 — agent.ts가 부른다 */
export function noteCost(session: string, cost: number | null | undefined, now = Date.now()): void {
  if (cost == null) return;
  const d = costDelta(lastCost.get(session), cost);
  lastCost.set(session, cost);
  const day = dayKey(now);
  const cur = spend().day === day ? spend() : { day, usd: 0, alerted: false };
  const next = { ...cur, usd: cur.usd + d };
  const budget = settings().dailyBudgetUsd;
  if (budget > 0 && next.usd >= budget && !next.alerted) {
    next.alerted = true;
    const title = tf("오늘 비용이 예산 ${budget}을 넘었습니다", { budget });
    const body = tf("지금 ${usd} · 세션은 멈추지 않습니다", { usd: next.usd.toFixed(2) });
    notifyLocal({ session: "app:budget", workspace: "", kind: "app", title, body });
    // OS 알림 — notification 플러그인 커맨드를 바로 부른다(JS 패키지 없이). 실패해도 인앱 알림은 남는다
    if (isTauri()) void invoke("plugin:notification|notify", { options: { title: `EQMUX · ${title}`, body } }).catch(() => {});
  }
  if (d === 0 && next.alerted === cur.alerted && cur === spend()) return;
  setSpend(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장 실패는 알림만 다시 올 수 있을 뿐이다 */
  }
}

/** 지표 문구 — "$3.20 / $10" · 예산이 꺼져 있으면 금액만 */
export const spendText = (): string => {
  const b = settings().dailyBudgetUsd;
  return b > 0 ? `$${spentToday().toFixed(2)} / $${b}` : `$${spentToday().toFixed(2)}`;
};
export const overBudget = (): boolean => settings().dailyBudgetUsd > 0 && spentToday() >= settings().dailyBudgetUsd;
