// 대화 버스 브리지 (PRD F) — msg_* 커맨드 + message-new 이벤트의 프런트 소비 표면.
// 원장은 워크스페이스 DB의 message 테이블 (M5 평면 스트림)이고, 전달(M3)은 여기서 한다:
// idle이면 즉시 PTY로 주입하고, busy·waiting·starting이면 인박스에 쌓았다가 idle 전이 때
// 흘려보낸다. waiting에 즉시 주입하지 않는 이유 — TUI 다이얼로그가 떠 있어서 본문 키가
// 다이얼로그의 오답이 된다 (G7이 승인·거부 키 주입을 금지한 것과 같은 이유).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";
import { t, tf } from "../i18n";
import { backend } from "./mock";
import { echoPty, isTauri, writePty } from "./pty";
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
  const rows = await invoke<MsgRow[]>("msg_list", {
    workspace: wsId,
    beforeId: null,
    limit: 200,
  }).catch(() => undefined);
  // 로드 실패(일시 오류)에 빈 배열로 스트림을 덮으면 대화 내역이 화면에서 사라진다 —
  // 성공했을 때만 교체하고, 실패면 다음 재실측까지 기존 표시를 유지한다
  if (rows) {
    loaded.add(wsId);
    backend.hydrateMessages(wsId, rows.map((r) => toMsg(wsId, r)));
  }
  await restoreInbox(wsId); // 인박스 영속 (F) — 재시작 전 대기분을 되살린다
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
    if (s.includes("RATE_LIMIT")) return t("분당 발신 상한에 닿았습니다 (M6) — 잠시 후 다시");
    if (s.includes("TOO_LONG")) return tf("본문이 너무 깁니다 — {n}자 상한", { n: MSG_MAX_BODY });
    if (s.includes("EMPTY") || s.includes("BAD_TYPE")) return t("타입 5종과 본문이 필요합니다 (M2)");
    return t("전송 실패 — 로그 패널을 확인하세요");
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

// 인박스 영속 (F 잔여) — 재시작해도 대기분이 남게 워크스페이스 KV에 캐시한다.
// 저장 형태: { [세션id]: ConversationMessage[] } — 복원 시 세션이 살아 있는 것만 되살린다.
const INBOX_KEY = "inbox";
const lastInboxSaved = new Map<string, string>();
let inboxSaveTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleInboxSave(): void {
  if (!isTauri()) return;
  clearTimeout(inboxSaveTimer);
  inboxSaveTimer = setTimeout(() => {
    const byWs = new Map<string, Record<string, ConversationMessage[]>>();
    for (const [sid, q] of inbox) {
      const wsId = q[0]?.workspaceId ?? backend.listSessions().find((s) => s.id === sid)?.workspaceId;
      if (!wsId || q.length === 0) continue;
      const m = byWs.get(wsId) ?? {};
      m[sid] = q;
      byWs.set(wsId, m);
    }
    for (const ws of backend.listWorkspaces()) {
      if (ws.pathMissing) continue;
      const json = JSON.stringify(byWs.get(ws.id) ?? {});
      if (lastInboxSaved.get(ws.id) === json) continue;
      lastInboxSaved.set(ws.id, json);
      void invoke("cache_set", { workspace: ws.id, key: INBOX_KEY, value: json }).catch(() => {});
    }
  }, 500);
}

const inboxRestored = new Set<string>();

/** 재시작 복원 — 세션이 하이드레이트된 뒤(refreshConversation 시점) 워크스페이스별 1회 */
async function restoreInbox(wsId: string): Promise<void> {
  if (!isTauri() || inboxRestored.has(wsId)) return;
  inboxRestored.add(wsId);
  const raw = await invoke<string | null>("cache_get", { workspace: wsId, key: INBOX_KEY }).catch(() => null);
  if (!raw) return;
  lastInboxSaved.set(wsId, raw);
  try {
    const saved = JSON.parse(raw) as Record<string, ConversationMessage[]>;
    const alive = new Set(backend.listSessions().map((s) => s.id));
    let changed = false;
    for (const [sid, msgs] of Object.entries(saved)) {
      if (!alive.has(sid) || msgs.length === 0) continue;
      inbox.set(sid, [...(inbox.get(sid) ?? []), ...msgs]);
      changed = true;
    }
    if (changed) setInboxTick((t) => t + 1);
  } catch {
    /* 손상 캐시 — 무시하고 다음 저장이 덮는다 */
  }
}

/** 인박스 대기 현황 — 대화 탭이 "누가 몇 건 대기"를 보여주는 데 쓴다 */
export function pendingInbox(): { sessionId: string; count: number }[] {
  inboxTick();
  const alive = new Set(backend.listSessions().map((s) => s.id));
  return [...inbox.entries()]
    .filter(([id, q]) => q.length > 0 && alive.has(id))
    .map(([sessionId, q]) => ({ sessionId, count: q.length }));
}

/** 주입 본문 — 한 줄로 눌러서 보낸다. 에이전트 TUI에서 개행은 곧 제출이라, 본문에 줄바꿈이
 *  있으면 첫 줄만 들어가고 나머지가 다음 프롬프트로 새거나 중간에 턴이 시작된다. */
function fmt(m: ConversationMessage): string {
  return `[EQMUX 메시지·${m.type}] ${m.from}: ${m.body.replace(/\s*\r?\n\s*/g, " ")}`;
}

const SUBMIT_DELAY_MS = 80; // 본문 접수 → 제출 사이. TUI가 붙여넣기를 정리할 시간을 준다
const TURN_GAP_MS = 400; // 연속 주입 간격 — 앞 메시지의 턴 시작과 겹치지 않게

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 세션별 주입 큐 — 인박스 flush는 여러 건을 한꺼번에 흘리므로 직렬화가 필요하다.
 *  본문과 Enter를 한 번에 쓰면 TUI가 붙여넣기로 묶어 개행을 줄바꿈으로 삼키는 경우가 있어,
 *  본문 → 짧은 지연 → \r 두 단계로 나눈다. 이게 "도착은 했는데 턴이 안 도는" 자리였다. */
const injectQueue = new Map<string, Promise<void>>();

function injectMessage(sessionId: string, m: ConversationMessage): void {
  const prev = injectQueue.get(sessionId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      writePty(sessionId, fmt(m));
      await sleep(SUBMIT_DELAY_MS);
      writePty(sessionId, "\r"); // 제출 — 여기서 비로소 수신자의 턴이 돈다
      await sleep(TURN_GAP_MS);
    })
    .catch(() => {
      /* 세션이 그 사이 사라졌다 — 큐는 다음 메시지를 위해 계속 산다 */
    });
  injectQueue.set(sessionId, next);
  void next.then(() => {
    if (injectQueue.get(sessionId) === next) injectQueue.delete(sessionId);
  });
}

/** 기본 터미널용 표시 전용 라인 (P-2) — PTY 입력에 넣지 않는다. 주석 접두(`#`)를 붙여도
 *  사용자가 치던 미제출 명령 뒤에 이어 붙어 \r이 그 명령을 그대로 실행하므로,
 *  화면·로컬 버퍼에만 에코한다. 원문은 어차피 대화 원장(message 테이블)에 있다. */
function fmtEcho(m: ConversationMessage): string {
  const body = m.body.replace(/\r?\n/g, "\r\n");
  return `\r\n\x1b[2m[EQMUX 메시지·${m.type}] ${m.from}: ${body}\x1b[0m\r\n`;
}

/** 수신 세션 결정 (M4) — "@all"이면 그 워크스페이스의 살아 있는 참여자 전원.
 *  기본 터미널(역할 없음)은 참여자다 — 프롬프트 앞의 사람이 읽는다.
 *  역할 세션은 에이전트가 아직 안 떠 있어도(shell) 참여자로 센다 — 셸 우선 모델에서는
 *  기동 전이 정상 상태이고, 그때 온 메시지는 인박스에 쌓였다가 기동 직후 흘러간다.
 *  제외는 진짜로 받을 수 없는 것만 — dead(프로세스 없음)와 restored(재시작 잔상). */
function recipients(wsId: string, to: string) {
  const live = backend.listSessions().filter(
    (s) => s.workspaceId === wsId && !s.restored && s.status !== "dead",
  );
  return to === "@all" ? live : live.filter((s) => s.id === to);
}

function deliver(wsId: string, m: ConversationMessage): void {
  for (const s of recipients(wsId, m.to)) {
    if (s.id === m.from) continue; // 에이전트 발신(@all)이 자기 자신에게 되돌아가지 않게
    if (!s.personaId) {
      echoPty(s.id, fmtEcho(m)); // 기본 터미널 — 표시 전용, 셸 입력에는 닿지 않는다 (P-2)
    } else if (s.status === "shell") {
      // 역할은 있는데 에이전트가 아직 안 떴다 — 셸에 주입하면 사람이 치던 명령을 실행시킨다.
      // 사람이 읽도록 화면에만 에코하고, 원문은 인박스에 남겨 기동 직후 에이전트에게 전달한다.
      echoPty(s.id, fmtEcho(m));
      const q = inbox.get(s.id) ?? [];
      q.push(m);
      inbox.set(s.id, q);
      setInboxTick((t) => t + 1);
      scheduleInboxSave();
    } else if (s.status === "idle") {
      injectMessage(s.id, m); // 유휴 = 프롬프트가 비어 있다 → 즉시 (M3)
    } else {
      const q = inbox.get(s.id) ?? [];
      q.push(m);
      inbox.set(s.id, q);
      setInboxTick((t) => t + 1);
      scheduleInboxSave(); // 인박스 영속 — 대기분은 재시작을 넘긴다
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
  scheduleInboxSave(); // 전달 완료 — 캐시의 대기분도 비운다
  for (const m of q) injectMessage(sessionId, m); // 큐가 직렬화한다 — 한꺼번에 쏟지 않는다
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
