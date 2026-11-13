// 종료 시퀀스 브리지 (FR-C-60~63) — ① 입력 차단(다이얼로그가 UI를 덮는다) → ② flush →
// ③ 정상 종료 신호 → ④ 유예 후 트리 종료(Rust app_exit). 자동 재개는 하지 않는다 (C10).
import { invoke } from "@tauri-apps/api/core";
import { flushUnseenNow } from "./flags";
import { flushLayoutNow } from "./layout";
import { isTauri } from "./pty";
import { flushTeamNow } from "./team";

import type { Session } from "../types";

export type ShutdownPhase = "flush" | "flush-late" | "closing";

/** 끌 것이 있는 세션 (B292) — 살아 있는 PTY가 있는 것만. team.json으로 복원한 슬롯은 status가 'shell'이어도
 *  이번 실행에서 그 페인을 열어 보지 않았으면 프로세스가 없다. alive가 없으면(브라우저 목 · 목록 실패) 상태로 센다 */
export function liveSessions(list: readonly Session[], alive: readonly string[] | undefined): Session[] {
  const up = alive && new Set(alive);
  return list.filter((s) => s.status !== "dead" && (!up || up.has(s.id)));
}

/** flush 후 앱 종료. 브라우저 dev에서는 no-op. 반환되지 않는 것이 정상이다(앱이 꺼진다) —
 *  false로 돌아오면 app_exit가 실패한 것이다. 부른 쪽이 입력 차단을 풀어야 한다 (B110). */
export async function performShutdown(onPhase?: (p: ShutdownPhase) => void): Promise<boolean> {
  if (!isTauri()) return false;
  onPhase?.("flush");
  // 프런트 디바운스 즉시 flush — 대기 타이머만 믿으면 종료 직전 0.5~0.8초의
  // 팀 편성·레이아웃·미확인 변경이 유실된다. SQLite flush(shutdown_flush)보다 먼저.
  flushTeamNow();
  flushLayoutNow();
  flushUnseenNow();
  const flushed = await invoke<boolean>("shutdown_flush").catch(() => false);
  if (!flushed) onPhase?.("flush-late"); // FR-C-63 — 2초 초과 시 진행 표시를 띄우고 계속
  onPhase?.("closing");
  return invoke("app_exit").then(
    () => true,
    () => false,
  );
}
