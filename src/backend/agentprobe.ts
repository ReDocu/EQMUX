// 세션 에이전트 감지 폴링 (셸 우선 모델) — Job 프로세스 트리에서 알려진 에이전트 CLI
// (claude/codex 등)를 찾아 관제에 표시한다. 관측 전용 · 이벤트 적재 없음.
// 5초 주기 — 사용자가 터미널에 방금 띄운 에이전트가 관제에 이내 보여야 한다 (메모리 10초와 별개).
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri } from "./pty";

interface AgentSample {
  id: string;
  agent: string;
}

let started = false;

export function startAgentProbe(): void {
  if (started || !isTauri()) return;
  started = true;
  const probe = async () => {
    const list = await invoke<AgentSample[]>("sessions_agents").catch(() => [] as AgentSample[]);
    backend.applyAgents(list);
  };
  void probe();
  setInterval(() => void probe(), 5_000);
}
