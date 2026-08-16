// 종료 시퀀스 브리지 (FR-C-60~63) — ① 입력 차단(다이얼로그가 UI를 덮는다) → ② flush →
// ③ 정상 종료 신호 → ④ 유예 후 트리 종료(Rust app_exit). 자동 재개는 하지 않는다 (C10).
import { invoke } from "@tauri-apps/api/core";
import { flushUnseenNow } from "./flags";
import { flushLayoutNow } from "./layout";
import { isTauri } from "./pty";
import { flushTeamNow } from "./team";

export type ShutdownPhase = "flush" | "flush-late" | "closing";

/** flush 후 앱 종료. 브라우저 dev에서는 no-op. 반환되지 않는 것이 정상이다(앱이 꺼진다). */
export async function performShutdown(onPhase?: (p: ShutdownPhase) => void): Promise<void> {
  if (!isTauri()) return;
  onPhase?.("flush");
  // 프런트 디바운스 즉시 flush — 대기 타이머만 믿으면 종료 직전 0.5~0.8초의
  // 팀 편성·레이아웃·미확인 변경이 유실된다. SQLite flush(shutdown_flush)보다 먼저.
  flushTeamNow();
  flushLayoutNow();
  flushUnseenNow();
  const flushed = await invoke<boolean>("shutdown_flush").catch(() => false);
  if (!flushed) onPhase?.("flush-late"); // FR-C-63 — 2초 초과 시 진행 표시를 띄우고 계속
  onPhase?.("closing");
  await invoke("app_exit").catch(() => {});
}
