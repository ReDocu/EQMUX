// 세션 에이전트 감지 폴링 (셸 우선 모델) — Job 프로세스 트리에서 알려진 에이전트 CLI
// (claude/codex 등)를 찾아 관제에 표시한다. 관측 전용 · 이벤트 적재 없음.
// 5초 주기 — 사용자가 터미널에 방금 띄운 에이전트가 관제에 이내 보여야 한다 (메모리 10초와 별개).
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
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

// ── CLI 에이전트 명부 (설치 실측) ──
// 없는 CLI를 여는 카드는 눌러 봐야 "command not found"가 전부다 — PATH에 있는 것만 내놓는다.
// where.exe를 목록 수만큼 도는 호출이라 앱 수명 동안 1회만 하고, 앱을 켜 둔 채로 새로 깐
// 경우를 위해 설정 화면이 refreshAgentClis()로 다시 부른다.
export interface AgentCli {
  /** 실행 명령이자 감지 토큰 */
  cmd: string;
  name: string;
  installed: boolean;
  /** EQMUX가 관리하는 스폰 경로가 있는가 (역할·권한·훅·재개) — 지금은 claude뿐 */
  managed: boolean;
}

const [clis, setClis] = createSignal<AgentCli[]>([]);
const [clisReady, setClisReady] = createSignal(false);
let asked = false;

/** 알려진 CLI 에이전트 + 설치 여부. 첫 호출은 빈 목록을 돌려주고 실측 뒤 화면을 다시 그린다 */
export function agentClis(): AgentCli[] {
  if (!asked) {
    asked = true;
    if (isTauri()) void refreshAgentClis();
    else setClisReady(true); // 브라우저 dev — 실측이 없으니 "확인 끝, 아무것도 없음"
  }
  return clis();
}

/** 실측이 한 번이라도 끝났는가 — "아직 모른다"와 "설치 안 됨"을 화면이 구분하게 한다 */
export function agentClisReady(): boolean {
  return clisReady();
}

/** 다시 확인 — 앱을 켜 둔 채 CLI를 새로 설치한 경우 (설정 화면의 명시 액션) */
export async function refreshAgentClis(): Promise<void> {
  if (!isTauri()) return;
  const list = await invoke<AgentCli[]>("agent_clis").catch(() => undefined);
  // 실패에 빈 목록으로 덮으면 멀쩡히 설치된 것들이 화면에서 사라진다 — 성공했을 때만 교체한다
  if (list) setClis(list);
  setClisReady(true);
}
