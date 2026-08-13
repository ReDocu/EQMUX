// 세션 메모리 샘플링 (FR-C-09 · C11) — Job Object 계정 정보를 10초 주기로 폴링한다.
// 표시 전용(세션 상세) · 소프트 경고까지만 — 강제 개입 없음. 대시보드 셀에는 넣지 않는다 (FR-G-66).
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri } from "./pty";

interface MemSample {
  id: string;
  bytes: number;
  peakBytes: number;
}

let started = false;

export function startMemorySampling(): void {
  if (started || !isTauri()) return;
  started = true;
  const sample = async () => {
    const list = await invoke<MemSample[]>("sessions_memory").catch(() => [] as MemSample[]);
    backend.applyMemory(
      list.map((s) => ({
        id: s.id,
        mb: Math.round(s.bytes / 1048576),
        peakMb: Math.round(s.peakBytes / 1048576),
      })),
    );
  };
  void sample();
  setInterval(() => void sample(), 10_000);
}
