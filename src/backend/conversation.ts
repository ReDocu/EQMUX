// 대화 버스 브리지 (PRD F) — msg_* 커맨드 + message-new 이벤트의 프런트 소비 표면.
// 원장은 워크스페이스 DB의 message 테이블 (M5 평면 스트림)이고, 전달(M3)은 여기서 한다:
// idle이면 즉시 PTY로 주입하고, busy·waiting·starting이면 인박스에 쌓았다가 idle 전이 때
// 흘려보낸다. waiting에 즉시 주입하지 않는 이유 — TUI 다이얼로그가 떠 있어서 본문 키가
// 다이얼로그의 오답이 된다 (G7이 승인·거부 키 주입을 금지한 것과 같은 이유).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";
import { backend } from "./mock";
import { isTauri, writePty } from "./pty";
import type { ConversationMessage } from "../types";

export const MSG_MAX_BODY = 2000; // M6 — Rust MAX_BODY_CHARS와 같은 값

interface MsgRow {
  id: number;
  ts: number;
  from: string;
  to: string;
  type: ConversationMessage["type"];
  body: string;
  read: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toMsg(wsId: string, r: MsgRow): ConversationMessage {
  const t = new Date(r.ts);
  return {
    id: `${wsId}:${r.id}`,
    time: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
    from: r.from,
    to: r.to,
    type: r.type,
    body: r.body,
    unread: !r.read,
    workspaceId: wsId,
    ts: r.ts,
  };
}

const loaded = new Set<string>();

/** 원장 실측 → 그 워크스페이스 스트림 교체. 부트스트랩과 늦게 열린 워크스페이스가 쓴다. */
export async function refreshConversation(wsId: string): Promise<void> {
  if (!isTauri()) return;
  loaded.add(wsId);
  const rows = await invoke<MsgRow[]>("msg_list", {
    workspace: wsId,
    beforeId: null,
    limit: 200,
  }).catch(() => [] as MsgRow[]);
  backend.hydrateMessages(wsId, rows.map((r) => toMsg(wsId, r)));
}

export function ensureConversation(wsId: string): void {
  if (!isTauri() || loaded.has(wsId)) return;
  void refreshConversation(wsId);
}

/** 발신 (M2 강제 타입 · M6 상한). 성공하면 message-new 이벤트가 스트림 반영과 전달을 처리한다.
 *  반환값은 사용자에게 보여줄 오류 문구 — null이면 성공. */
export async function sendConversation(
  wsId: string,
  to: string,
  type: ConversationMessage["type"],
  body: string,
): Promise<string | null> {
  if (!isTauri()) {
    backend.sendMessage("나", to, type, body);
    return null;
  }
  try {
    await invoke("msg_send", { workspace: wsId, from: "나", to, msgType: type, body });
    return null;
  } catch (e) {
    const s = String(e);
    if (s.includes("RATE_LIMIT")) return "분당 발신 상한에 닿았습니다 (M6) — 잠시 후 다시";
    if (s.includes("TOO_LONG")) return `본문이 너무 깁니다 — ${MSG_MAX_BODY}자 상한`;
    if (s.includes("EMPTY") || s.includes("BAD_TYPE")) return "타입 5종과 본문이 필요합니다 (M2)";
    return "전송 실패 — 로그 패널을 확인하세요";
  }
}

/** 모두 읽음 — 원장의 read 플래그와 화면 표시를 함께 내린다 */
export function markConversationRead(wsId: string | undefined): void {
  backend.markAllRead();
  if (isTauri() && wsId) void invoke("msg_mark_read", { workspace: wsId }).catch(() => {});
}

// ── 전달 (M3 인박스 + 상태 기반) ──

const inbox = new Map<string, ConversationMessage[]>(); // 세션 id → 대기 메시지
const [inboxTick, setInboxTick] = createSignal(0);

/** 인박스 대기 현황 — 대화 탭이 "누가 몇 건 대기"를 보여주는 데 쓴다 */
export function pendingInbox(): { sessionId: string; count: number }[] {
  inboxTick();
  const alive = new Set(backend.listSessions().map((s) => s.id));
  return [...inbox.entries()]
    .filter(([id, q]) => q.length > 0 && alive.has(id))
    .map(([sessionId, q]) => ({ sessionId, count: q.length }));
}

function fmt(m: ConversationMessage): string {
  return `[EQMUX 메시지·${m.type}] ${m.from}: ${m.body}\r`;
}

/** 수신 세션 결정 (M4) — "@all"이면 그 워크스페이스의 살아 있는 에이전트 전원.
 *  restored(에이전트 미기동)·dead·shell은 제외 — PTY 너머에 받을 사람이 없다. */
function recipients(wsId: string, to: string) {
  const live = backend
    .listSessions()
    .filter(
      (s) =>
        s.workspaceId === wsId &&
        s.personaId &&
        !s.restored &&
        s.status !== "dead" &&
        s.status !== "shell",
    );
  return to === "@all" ? live : live.filter((s) => s.id === to);
}

function deliver(wsId: string, m: ConversationMessage): void {
  for (const s of recipients(wsId, m.to)) {
    if (s.status === "idle") {
      writePty(s.id, fmt(m)); // 유휴 = 프롬프트가 비어 있다 → 즉시 (M3)
    } else {
      const q = inbox.get(s.id) ?? [];
      q.push(m);
      inbox.set(s.id, q);
      setInboxTick((t) => t + 1);
    }
  }
}

/** agent-state 훅 — idle 전이가 곧 "턴 종료" 신호다 (M3). agent.ts 리스너가 부른다. */
export function flushInboxOnState(sessionId: string, status: string | undefined): void {
  if (status !== "idle") return;
  const q = inbox.get(sessionId);
  if (!q?.length) return;
  inbox.delete(sessionId);
  setInboxTick((t) => t + 1);
  for (const m of q) writePty(sessionId, fmt(m));
}

// ── message-new 수신 — 발신 경로가 하나(msg_send)라서 수신 경로도 하나다 ──

let busReady: Promise<void> | undefined;

export function startMessageBus(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (!busReady) {
    busReady = listen<{ workspace: string; message: MsgRow }>("message-new", (e) => {
      const { workspace, message } = e.payload;
      const m = toMsg(workspace, message);
      backend.appendMessage(m);
      deliver(workspace, m);
    }).then(() => {});
  }
  return busReady;
}
