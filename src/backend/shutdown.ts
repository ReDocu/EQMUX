// 종료 시퀀스 브리지 (FR-C-60~63) — ① 입력 차단(다이얼로그가 UI를 덮는다) → ② flush →
// ③ 정상 종료 신호 → ④ 유예 후 트리 종료(Rust app_exit). 자동 재개는 하지 않는다 (C10).
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./pty";

export type ShutdownPhase = "flush" | "flush-late" | "closing";

/** flush 후 앱 종료. 브라우저 dev에서는 no-op. 반환되지 않는 것이 정상이다(앱이 꺼진다). */
export async function performShutdown(onPhase?: (p: ShutdownPhase) => void): Promise<void> {
  if (!isTauri()) return;
  onPhase?.("flush");
  const flushed = await invoke<boolean>("shutdown_flush").catch(() => false);
  if (!flushed) onPhase?.("flush-late"); // FR-C-63 — 2초 초과 시 진행 표시를 띄우고 계속
  onPhase?.("closing");
  await invoke("app_exit").catch(() => {});
}
