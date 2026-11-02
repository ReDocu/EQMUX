// 과거 세션 검색 (0.6 §4 · W3) — Rust history_search(history.rs) 래퍼와 대화별 묶기.
// 워크스페이스 폴더에서 돈 Claude Code 대화(트랜스크립트)를 읽기만 한다.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./pty";

export interface HistoryHit {
  uuid: string;
  /** 이 대화를 마지막으로 돌린 슬롯 — 없으면 앱 밖 대화이거나 슬롯의 옛 대화 */
  session?: string | null;
  /** 슬롯의 마지막 대화 — 기존 재개 경로로 열 수 있다 */
  resumable: boolean;
  ts: number;
  role: "user" | "agent";
  snippet: string;
}

export interface HistoryGroup {
  uuid: string;
  session?: string;
  resumable: boolean;
  /** 가장 최근 매치 시각 */
  last: number;
  hits: HistoryHit[];
}

/** 실패는 던진다 (B186) — 빈 배열로 삼키면 '맞는 대화가 없습니다'와 읽기 실패가 같아 보였다 */
export function historySearch(workspace: string, cwd: string, query: string): Promise<HistoryHit[]> {
  if (!isTauri() || !query.trim()) return Promise.resolve([]);
  return invoke<HistoryHit[]>("history_search", { workspace, cwd, query });
}

/** 대화별로 묶는다 — 최근 매치가 있는 대화 먼저, 대화 안은 시간 순 */
export function groupByConversation(hits: HistoryHit[]): HistoryGroup[] {
  const by = new Map<string, HistoryGroup>();
  for (const h of hits) {
    const g = by.get(h.uuid);
    if (g) {
      g.hits.push(h);
      g.last = Math.max(g.last, h.ts);
    } else {
      by.set(h.uuid, { uuid: h.uuid, session: h.session ?? undefined, resumable: h.resumable, last: h.ts, hits: [h] });
    }
  }
  const groups = [...by.values()];
  for (const g of groups) g.hits.sort((a, b) => a.ts - b.ts);
  return groups.sort((a, b) => b.last - a.last);
}

/** 앱 밖에서 이어 갈 때 — 기존 재개 경로가 없는 대화(옛 대화 · 앱 밖 대화)에 준다.
 *  --resume은 대화를 시작한 폴더에서만 찾으므로 그 폴더로 옮기는 cd를 앞에 붙인다 (P85).
 *  `;`는 PowerShell · bash · zsh 모두에서 명령 구분이다 (cmd는 아니다) */
export const resumeCommand = (uuid: string, cwd: string): string => `cd "${cwd}"; claude --resume ${uuid}`;

/** 서브에이전트 호출 (§4) — 트랜스크립트의 Agent(옛 이름 Task) 도구 턴.
 *  summary는 transcript.rs tool_summary가 만든 `{subagent_type} · {description}`이다 */
export function subagentCalls<T extends { role: string; text: string; summary: string | null }>(turns: T[]): T[] {
  return turns.filter((t) => t.role === "tool" && (t.text === "⚙ Agent" || t.text === "⚙ Task"));
}
