// 이벤트 피드 브리지 (PRD G §4.4) — 원천은 PRD C의 event 테이블 (FR-G-40). G는 별도 저장을 하지 않는다.
// 스코프 3단 (FR-G-41): 세션 = session 필터 / 워크스페이스 = DB 하나 / 전역 = 워크스페이스별 병합.
// DB가 워크스페이스 단위(FR-C-20a)라서 전역은 각 DB를 읽어 시간순으로 합친다.
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri } from "./pty";
import type { EventRecord } from "../types";

export interface FeedEvent {
  id: number;
  ts: number;
  time: string; // HH:MM
  sessionId?: string;
  workspaceId: string;
  kind: EventRecord["kind"];
  message: string;
}

export interface EventRow {
  id: number;
  ts: number;
  sessionId: string | null;
  kind: string;
  payload: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 셸 하나의 종료가 세 줄('프로세스 종료 · exit ?' · 'dead' · '세션 종료 · exit ?')로 남던 것을 한 줄로 (U175).
 *  PTY가 끝나면 Rust가 늘 session-exit 줄을 적으므로 그것이 정본이다 — 같은 세션 · 같은 때(5초 안)의
 *  agent-state 'dead'와 프런트가 적던 '프로세스 종료 · exit …'(앞 실행의 기록)은 뺀다.
 *  ponytail: 조회 한도 끝에서 짝이 잘리면 남은 쪽이 한 줄로 보인다 — 그대로 둔다 */
export function dropExitTwins(rows: EventRow[]): EventRow[] {
  const exits = rows.filter((r) => r.kind === "session-exit");
  const twin = (r: EventRow) =>
    ((r.kind === "agent-state" && r.payload === "dead") || (r.kind === "state" && !!r.payload?.startsWith("프로세스 종료 · exit"))) &&
    exits.some((x) => x.sessionId === r.sessionId && Math.abs(x.ts - r.ts) <= 5000);
  return rows.filter((r) => !twin(r));
}

function toFeed(wsId: string, r: EventRow): FeedEvent {
  const t = new Date(r.ts);
  let kind: EventRecord["kind"] = "store";
  let message = r.payload ?? r.kind;
  if (r.kind === "agent-state") {
    kind = "state";
    if (message === "dead") message = "종료됨"; // 내부 상태 토큰을 그대로 보이지 않는다 (U175)
  } else if (r.kind === "session-start") {
    kind = "app";
    message = `세션 시작 · ${r.payload ?? ""}`;
  } else if (r.kind === "session-exit") {
    kind = "app";
    // Rust가 format!("{:?}", code)로 남긴 "Some(0)"/"None"을 사람이 읽게 정리. 'exit ?'는 뜻이 읽히지 않았다 (U175)
    const m = /Some\((\d+)\)/.exec(r.payload ?? "");
    message = `세션 종료 · ${m ? `exit ${m[1]}` : "종료 코드 없음"}`;
  } else if (r.kind === "session-kill") {
    kind = "app";
    message = r.payload ?? "사용자 요청으로 종료";
  }
  return {
    id: r.id,
    ts: r.ts,
    time: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
    sessionId: r.sessionId ?? undefined,
    workspaceId: wsId,
    kind,
    message,
  };
}

/** 워크스페이스 / 세션 스코프 조회 — before_id 커서 페이징 (FR-G-43) */
export async function queryEvents(
  wsId: string,
  opts: { session?: string; beforeId?: number; limit?: number } = {},
): Promise<FeedEvent[]> {
  if (!isTauri()) return [];
  const rows = await invoke<EventRow[]>("events_query", {
    workspace: wsId,
    session: opts.session ?? null,
    beforeId: opts.beforeId ?? null,
    limit: opts.limit ?? 50,
  }).catch(() => [] as EventRow[]);
  return dropExitTwins(rows).map((r) => toFeed(wsId, r));
}

/** 전역 스코프 — 등록된 워크스페이스의 DB를 각각 읽어 시간순 병합 (FR-G-41) */
export async function queryGlobalEvents(limit = 60): Promise<FeedEvent[]> {
  if (!isTauri()) return [];
  const wss = backend.listWorkspaces();
  const all = await Promise.all(wss.map((w) => queryEvents(w.id, { limit })));
  return all
    .flat()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}
