// 대화 버스 브리지 (PRD F) — msg_* 커맨드 + message-new 이벤트의 프런트 소비 표면.
// 원장은 워크스페이스 DB의 message 테이블 (M5 평면 스트림)이고, 전달(M3)은 여기서 한다:
// idle이면 즉시 PTY로 주입하고, busy·waiting·starting이면 인박스에 쌓았다가 idle 전이 때
// 흘려보낸다. waiting에 즉시 주입하지 않는 이유 — TUI 다이얼로그가 떠 있어서 본문 키가
// 다이얼로그의 오답이 된다 (G7이 승인·거부 키 주입을 금지한 것과 같은 이유).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";
import { t } from "../i18n";
import { backend } from "./mock";
import { echoPty, humanTyping, isTauri, writePty } from "./pty";
import { canInject, effectiveTitle, sessionName } from "../types";
import type { ConversationMessage } from "../types";

/** 에이전트 발신 본문 상한 (결정 8) — Rust MAX_BODY_CHARS와 같은 값. 사람이 대화 탭에서
 *  보내는 메시지는 이 상한에서 뺀다(결정 18) — 상한은 받는 에이전트의 컨텍스트를 아끼는 장치다 */
export const MSG_MAX_BODY = 800;

interface MsgRow {
  id: number;
  ts: number;
  from: string;
  to: string;
  type: ConversationMessage["type"];
  body: string;
  read: boolean;
  done?: boolean;
  file?: { path: string; size: number } | null;
  fromName?: string; // 보낸 때의 세션 이름 (원장) — 세션이 사라진 뒤의 표시용
  toName?: string;
}

/** 원장에 남은 보낸 때의 이름 — 세션 id → 이름. 세션이 사라져 nameOf가 풀지 못할 때만 쓴다 */
const ledgerNames = new Map<string, string>();

const pad = (n: number) => String(n).padStart(2, "0");

function toMsg(wsId: string, r: MsgRow): ConversationMessage {
  const t = new Date(r.ts);
  if (r.fromName) ledgerNames.set(r.from, r.fromName);
  if (r.toName) ledgerNames.set(r.to, r.toName);
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
    rowId: r.id,
    ...(r.done ? { done: true } : {}),
    ...(r.file ? { file: r.file } : {}),
  };
}

const PAGE = 200;
const loaded = new Set<string>();
const [olderLeft, setOlderLeft] = createSignal<Record<string, boolean>>({});

/** 원장에 화면보다 오래된 메시지가 남아 있는가 — 대화 탭 `▲ 이전` 칩 (BR-15) */
export const hasOlder = (wsId: string): boolean => !!olderLeft()[wsId];

/** 원장 실측 → 그 워크스페이스 스트림 교체. 부트스트랩과 늦게 열린 워크스페이스가 쓴다. */
export async function refreshConversation(wsId: string): Promise<void> {
  if (!isTauri()) return;
  const rows = await invoke<MsgRow[]>("msg_list", {
    workspace: wsId,
    beforeId: null,
    limit: PAGE,
  }).catch(() => undefined);
  if (rows) setOlderLeft((m) => ({ ...m, [wsId]: rows.length >= PAGE }));
  // 로드 실패(일시 오류)에 빈 배열로 스트림을 덮으면 대화 내역이 화면에서 사라진다 —
  // 성공했을 때만 교체하고, 실패면 다음 재실측까지 기존 표시를 유지한다
  if (rows) {
    loaded.add(wsId);
    backend.hydrateMessages(wsId, rows.map((r) => toMsg(wsId, r)));
  }
  await restoreInbox(wsId); // 인박스 영속 (F) — 재시작 전 대기분을 되살린다
}

/** 이전 페이지 (BR-15) — 화면에 있는 가장 오래된 행 앞의 PAGE건을 원장에서 더 불러온다.
 *  hydrate는 그 워크스페이스 스트림을 통째로 바꾸므로, 지금 스트림 앞에 붙여 다시 넘긴다 */
export async function loadOlder(wsId: string): Promise<void> {
  if (!isTauri()) return;
  const mine = backend.listMessages().filter((m) => m.workspaceId === wsId);
  const oldest = Math.min(...mine.map((m) => m.rowId ?? Infinity));
  if (!Number.isFinite(oldest)) return;
  const rows = await invoke<MsgRow[]>("msg_list", { workspace: wsId, beforeId: oldest, limit: PAGE }).catch(
    () => undefined,
  );
  if (!rows) return;
  setOlderLeft((m) => ({ ...m, [wsId]: rows.length >= PAGE }));
  backend.hydrateMessages(wsId, [...rows.map((r) => toMsg(wsId, r)), ...mine]);
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
    if (s.includes("RATE_LIMIT")) return t("분당 발신 상한에 닿았습니다 — 잠시 후 다시");
    if (s.includes("TOO_LONG")) return t("본문이 너무 깁니다");
    if (s.includes("EMPTY") || s.includes("BAD_TYPE")) return t("타입 5종과 본문이 필요합니다");
    return t("전송 실패 — 로그 패널을 확인하세요");
  }
}

export interface ConversationExport {
  path: string;
  count: number;
}

/** 대화 저장 — 저장 대화상자(Rust rfd)에서 위치를 고르면 그 워크스페이스의 대화 원장 전체를
 *  Markdown으로 쓴다. 화면에 하이드레이트된 최근 200건이 아니라 message 테이블 전부다.
 *  names는 세션 id → 표시 이름 — 원장에는 id만 남고 이름을 아는 것은 프런트뿐이라 넘겨준다.
 *  취소 시 null, 실패는 던진다 (FR-D-08 — 조용히 성공한 척하지 않는다) */
export async function exportConversation(
  wsId: string,
  wsName: string,
  names: Record<string, string>,
): Promise<ConversationExport | null> {
  if (!isTauri()) return null; // 브라우저 목업에는 원장도 저장 대화상자도 없다
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const safe = (wsName || "workspace").replace(/[\\/:*?"<>|]/g, "_");
  return invoke<ConversationExport | null>("msg_export", {
    workspace: wsId,
    wsName,
    suggested: `${safe}-대화-${stamp}.md`,
    names,
  });
}

/** 모두 읽음 — 원장의 read 플래그와 화면 표시를 함께 내린다 */
export function markConversationRead(wsId: string | undefined): void {
  backend.markAllRead(wsId);
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
  inboxSaveTimer = setTimeout(saveInboxNow, 500);
}

/** 바로 저장 — 배출(전달) 직후에 쓴다. 디바운스 창 안에 웹뷰가 죽으면 이미 넣은 대기분이
 *  캐시에 남아 복원 때 다시 주입된다 */
function saveInboxNow(): void {
  if (!isTauri()) return;
  clearTimeout(inboxSaveTimer);
  const byWs = new Map<string, Record<string, ConversationMessage[]>>();
  for (const [sid, q] of inbox) {
    const wsId = q[0]?.workspaceId ?? backend.listSessions().find((s) => s.id === sid)?.workspaceId;
    if (!wsId || q.length === 0) continue;
    const m = byWs.get(wsId) ?? {};
    m[sid] = q;
    byWs.set(wsId, m);
  }
  for (const ws of backend.listWorkspaces()) {
    // 아직 복원 전인 워크스페이스는 쓰지 않는다 — `{}`로 덮으면 재시작 전 대기분이 영영 사라진다
    if (ws.pathMissing || !inboxRestored.has(ws.id)) continue;
    const json = JSON.stringify(byWs.get(ws.id) ?? {});
    if (lastInboxSaved.get(ws.id) === json) continue;
    lastInboxSaved.set(ws.id, json);
    void invoke("cache_set", { workspace: ws.id, key: INBOX_KEY, value: json }).catch(() => {});
  }
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
    if (changed) {
      setInboxTick((t) => t + 1);
      // 복원된 대기분은 idle '전이'를 기다리는데, 웹뷰만 다시 뜬 경우(FR-C-06) 그 전이는 이미
      // 지나갔다 — 되살린 직후 지금 idle인 세션에 한 번 배출한다 (B49). 아니면 카드에 "턴 종료 시
      // 전달"이라고 뜬 채 영영 전달되지 않는다.
      for (const sid of Object.keys(saved)) {
        const s = backend.listSessions().find((x) => x.id === sid);
        if (s) flushInboxOnState(s.id, s.status);
      }
    }
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

/** 주소용 프로젝트 이름 (결정 20) — 열린 워크스페이스의 표시 이름. 같은 이름이 둘 열려 있으면
 *  열린 순서로 `app`, `app-2`를 붙여 주소가 하나로 풀리게 한다. Rust 디렉터리(C4)도 이 값을 받는다 */
export function projectLabels(): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const w of backend.listWorkspaces()) {
    if (!w.open) continue;
    const n = (seen.get(w.name) ?? 0) + 1;
    seen.set(w.name, n);
    out.set(w.id, n === 1 ? w.name : `${w.name}-${n}`);
  }
  return out;
}

/** 세션 id → 세션 이름. 원장에는 id만 남는다 — 이름을 아는 것은 프런트뿐이다 */
export function nameOf(sessionId: string): string {
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s) return goneName(sessionId);
  return sessionName(s, backend.listPersonas().find((p) => p.id === s.personaId));
}

/** 사라진 세션의 이름 — 원장의 보낸 때 이름 → id 앞부분이 페르소나면 그 이름 → id 그대로.
 *  "나"·"@all"은 어디에도 걸리지 않아 원문으로 남는다 (0.5 이전 행은 원장 이름이 없다) */
export function goneName(
  id: string,
  ledger: ReadonlyMap<string, string> = ledgerNames,
  personas: readonly { id: string; name: string }[] = backend.listPersonas(),
): string {
  return ledger.get(id) ?? personas.find((p) => p.id === id.split("@")[0])?.name ?? id;
}

/** 받는 쪽에서 보이는 발신자 (BR-14) — 같은 프로젝트면 `카이`, 다른 프로젝트면 `카이@app-b`.
 *  받은 그대로 `eqmux send --to @카이@app-b`로 답할 수 있게 주소 꼴을 맞춘다 */
export function senderLabel(from: string, toWs: string | undefined): string {
  const s = backend.listSessions().find((x) => x.id === from);
  if (!s) return goneName(from); // "나" · 이미 닫힌 세션
  const name = nameOf(from);
  if (!toWs || s.workspaceId === toWs) return name;
  return `${name}@${projectLabels().get(s.workspaceId) ?? s.workspaceId}`;
}

/** 세션 디렉터리 (C4) — 열린 모든 프로젝트의 세션을 Rust에 넘긴다. `eqmux send`의 주소 해석과
 *  `eqmux who`가 이것을 본다. 바뀐 때만 보낸다 — 방송은 잦고 내용은 드물게 바뀐다 */
export function startDirectorySync(): () => void {
  if (!isTauri()) return () => {};
  let last = "";
  const push = () => {
    const labels = projectLabels();
    const personas = backend.listPersonas();
    const entries = backend
      .listSessions()
      .filter((s) => labels.has(s.workspaceId))
      .map((s) => {
        const p = personas.find((x) => x.id === s.personaId);
        return {
          session: s.id,
          workspace: s.workspaceId,
          project: labels.get(s.workspaceId)!,
          name: sessionName(s, p),
          persona: p?.name ?? "",
          job: s.jobId ?? "",
          title: effectiveTitle(s, p) ?? null, // Rust Option — 직함 없음은 None
          agent: s.agent ?? "", // 손으로 띄운 에이전트 — CLI 전달 판정이 deliver()와 같은 갈래를 타게
          slot: s.slot,
          status: s.status,
        };
      });
    const json = JSON.stringify(entries);
    if (json === last) return;
    last = json;
    void invoke("directory_set", { entries }).catch(() => {});
  };
  push();
  return backend.subscribe(push);
}

/** 수신 세션의 페르소나 표시 이름 — 역할 없는 세션이면 undefined */
function personaNameOf(sessionId: string): string | undefined {
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s?.personaId) return undefined;
  return backend.listPersonas().find((p) => p.id === s.personaId)?.name ?? s.personaId;
}

/** 페르소나 리마인더 — 역할(캐릭터)은 SessionStart에 한 번 실리고 나면 대화가 길어질수록
 *  멀어진다. 그 상태로 도착한 메시지는 운영 알림처럼 보여서 에이전트가 기본 어투로 답했다
 *  (페르소나가 에이전트간 대화에서만 빠지던 자리). 다만 매 건에 붙이면 같은 꼬리가 계속
 *  반복되니, 역할이 바뀐 직후와 PERSONA_EVERY건마다만 얹는다 — 어투를 붙잡는 데 그걸로 족하다. */
const PERSONA_EVERY = 5;
const personaSeen = new Map<string, { name: string; n: number }>();

function personaTail(sessionId: string): string {
  const name = personaNameOf(sessionId);
  if (!name) return "";
  const prev = personaSeen.get(sessionId);
  const n = prev?.name === name ? prev.n + 1 : 0;
  personaSeen.set(sessionId, { name, n });
  return n % PERSONA_EVERY === 0 ? ` (답신은 ${name}의 말투로)` : "";
}

/** 주입 본문 — 한 줄로 눌러서 보낸다. 에이전트 TUI에서 개행은 곧 제출이라, 본문에 줄바꿈이
 *  있으면 첫 줄만 들어가고 나머지가 다음 프롬프트로 새거나 중간에 턴이 시작된다.
 *
 *  여러 건은 한 줄로 묶는다 — 대기분을 건건이 주입하면 래퍼도 수신자의 턴도 건수만큼 든다.
 *  묶으면 래퍼 하나에 턴 하나다. 접두를 짧게 쥐는 이유도 같다 — 건당 비용이라 길이가 곱해진다. */
export function fmt(
  msgs: ConversationMessage[],
  tail = "",
  label: (m: ConversationMessage) => string = (m) => m.from,
): string {
  const flat = (m: ConversationMessage) => m.body.replace(/\s*\r?\n\s*/g, " ") + attach(m);
  if (msgs.length === 1) return `[EQ·${msgs[0].type}] ${label(msgs[0])}: ${flat(msgs[0])}${tail}`;
  const items = msgs.map((m, i) => `${i + 1}) ${label(m)}·${m.type}: ${flat(m)}`).join(" ");
  return `[EQ ${msgs.length}건] ${items}${tail}`;
}

/** `--file` 첨부 — 본문은 요약뿐이라 경로를 붙여야 받는 쪽이 읽으러 간다 */
const attach = (m: ConversationMessage) => (m.file ? ` (파일: ${m.file.path})` : "");

const SUBMIT_DELAY_MS = 80; // 본문 접수 → 제출 사이. TUI가 붙여넣기를 정리할 시간을 준다
const TURN_GAP_MS = 400; // 연속 주입 간격 — 앞 메시지의 턴 시작과 겹치지 않게

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 세션별 주입 큐 — 묶고도 남는 덩어리가 여럿일 수 있어 직렬화는 그대로 필요하다.
 *  본문과 Enter를 한 번에 쓰면 TUI가 붙여넣기로 묶어 개행을 줄바꿈으로 삼키는 경우가 있어,
 *  본문 → 짧은 지연 → \r 두 단계로 나눈다. 이게 "도착은 했는데 턴이 안 도는" 자리였다. */
const injectQueue = new Map<string, Promise<void>>();

/** 한 번에 붙여넣는 상한 — 오래 바빴던 세션의 인박스는 수십 건까지 쌓인다. 통째로 쏟으면
 *  TUI 붙여넣기가 감당하지 못하니 덩어리로 자르고, 사이는 주입 큐가 벌려 준다. */
const BATCH_MAX_CHARS = 4000;

export function batches(msgs: ConversationMessage[]): ConversationMessage[][] {
  const out: ConversationMessage[][] = [];
  let cur: ConversationMessage[] = [];
  let n = 0;
  for (const m of msgs) {
    if (cur.length > 0 && n + m.body.length > BATCH_MAX_CHARS) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(m);
    n += m.body.length;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function injectMessages(sessionId: string, msgs: ConversationMessage[]): void {
  if (msgs.length === 0) return;
  const prev = injectQueue.get(sessionId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      // 페르소나는 큐에 넣을 때가 아니라 실제로 쓸 때 읽는다 — 앞 덩어리를 기다리는 동안
      // 재캐스팅될 수 있고, 그때는 새 인물의 이름이 맞다
      const ws = backend.listSessions().find((s) => s.id === sessionId)?.workspaceId;
      writePty(sessionId, fmt(msgs, personaTail(sessionId), (m) => senderLabel(m.from, ws)));
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
 *  화면·로컬 버퍼에만 에코한다. 원문은 어차피 대화 원장(message 테이블)에 있다.
 *  머리는 에이전트가 받는 것과 같은 `[EQ·타입] 이름:` — 사람과 에이전트가 같은 꼴을 본다. */
export function fmtEcho(m: ConversationMessage, label = m.from): string {
  const body = (m.body + attach(m)).replace(/\r?\n/g, "\r\n");
  return `\r\n\x1b[2m[EQ·${m.type}] ${label}: ${body}\x1b[0m\r\n`;
}

/** 수신 세션 결정 (M4) — "@all"이면 그 워크스페이스의 살아 있는 참여자 전원.
 *  기본 터미널(역할 없음)은 참여자다 — 프롬프트 앞의 사람이 읽는다.
 *  역할 세션은 에이전트가 아직 안 떠 있어도(shell) 참여자로 센다 — 셸 우선 모델에서는
 *  기동 전이 정상 상태이고, 그때 온 메시지는 인박스에 쌓였다가 기동 직후 흘러간다.
 *  복원(restored) 세션도 같다 — 재시작 직후가 딱 그 상태다. 예전에는 여기서 걸러내 앱을
 *  다시 켠 직후에 보낸 @all이 아무에게도 닿지 않고 흔적도 남지 않았다.
 *  dead도 뺀 적이 있었는데, 그러면 전달 루프가 한 바퀴도 안 돌아 인박스에도 안 쌓이고
 *  화면에만 정상 발신으로 남았다 (B50). 지금은 후보로 두고 deliver가 인박스에 재운다 —
 *  재개하면 idle 전이에서 기존 flush 경로가 그대로 흘려보낸다.
 *  프로젝트 간 메시지는 Rust가 받는 워크스페이스 원장에도 적고 그쪽 message-new를 낸다 —
 *  그래서 받는 사람은 언제나 이벤트의 워크스페이스 안에서 찾으면 된다. */
function recipients(wsId: string, to: string) {
  const live = backend.listSessions().filter((s) => s.workspaceId === wsId);
  return to === "@all" ? live : live.filter((s) => s.id === to);
}

/** 사람이 페인에 직접 띄운 에이전트 (M37 후속) — 관리 기동이 아니라 훅이 없고, 그래서 상태가
 *  shell에 머문 채 프로세스 트리에만 claude/codex가 보인다(agentscan). 관리 세션은 돌고 있는 동안
 *  status가 shell일 수 없으므로 이 조합이 곧 "손으로 띄웠다"는 뜻이다.
 *
 *  턴 경계도 승인 창도 모른다. 그래서 자동으로 넣지 않는다 (BR-02) — 승인 창이 떠 있으면 본문과
 *  Enter가 그 답이 되어 사람 확인 없이 도구가 실행될 수 있다. 메시지는 쌓아 두고, 페인 헤더의
 *  `메시지 N건 · 넣기` 칩을 사람이 눌렀을 때만 injectPending으로 넣는다. */
export const unmanagedAgent = (s: { status: string; agent?: string; personaId?: string }): boolean =>
  !!s.agent && (s.status === "shell" || !s.personaId);
// 역할 없는 기본 터미널의 에이전트는 상태와 상관없이 손으로 띄운 것이다 — 레지스트리가 그 pid를
// 채택하면 상태가 idle·busy로 바뀌어, status만 보던 예전 판정은 그때 다시 에코로 새었다 (실기 QA)

/** 손으로 띄운 에이전트에 쌓인 메시지 수 — 페인 헤더 칩 (반응형) */
export function pendingCount(sessionId: string): number {
  inboxTick();
  return inbox.get(sessionId)?.length ?? 0;
}

/** 쌓인 메시지 목록 — `넣기` 팝오버가 사람에게 보여 준다 (반응형) */
export function pendingFor(sessionId: string): ConversationMessage[] {
  inboxTick();
  return [...(inbox.get(sessionId) ?? [])];
}

/** 사람이 `넣기`를 눌렀다 — 그때만 넣는다. 쳐 둔 줄이 있으면 덮지 않고 그대로 둔다 */
export function injectPending(sessionId: string): boolean {
  const q = inbox.get(sessionId);
  if (!q?.length || humanTyping(sessionId)) return false;
  inbox.delete(sessionId);
  setInboxTick((t) => t + 1);
  saveInboxNow(); // 넣은 대기분 — 디바운스 없이 캐시에서 비운다
  markDelivered(q);
  for (const b of batches(q)) injectMessages(sessionId, b);
  return true;
}

// ── 사람이 보낸 메시지의 전달 상태 — `eqmux send`가 에이전트에게 돌려주는 것과 같은 판정 ──

export type Delivery = "delivered" | "queued";
const [deliveries, setDeliveries] = createSignal<Record<string, Delivery>>({});

/** 대화 탭이 "나"의 메시지 옆에 붙이는 `전달됨` · `대기 중` (반응형). 앱을 다시 켜면 비운다 */
export const deliveryOf = (msgId: string): Delivery | undefined => deliveries()[msgId];

function markDelivered(msgs: ConversationMessage[]): void {
  const mine = msgs.filter((m) => m.from === "나");
  if (mine.length === 0) return;
  setDeliveries((d) => {
    const n = { ...d };
    for (const m of mine) n[m.id] = "delivered";
    return n;
  });
}

/** 유휴 주입 묶기 (토큰 #3) — 유휴 세션은 메시지마다 바로 한 턴을 돌았다. 잠깐 모았다가 한 줄로
 *  넣으면 연달아 온 N건이 한 턴이 된다. 모으는 사이 세션이 바빠졌으면 인박스로 넘겨 기존 idle
 *  전이 경로가 흘려보낸다 */
const GATHER_MS = 2000;
const gathering = new Map<string, ConversationMessage[]>();

function gather(sessionId: string, m: ConversationMessage): void {
  const q = gathering.get(sessionId);
  if (q) {
    q.push(m);
    return;
  }
  gathering.set(sessionId, [m]);
  setTimeout(() => {
    const msgs = gathering.get(sessionId) ?? [];
    gathering.delete(sessionId);
    const s = backend.listSessions().find((x) => x.id === sessionId);
    if (!s) return;
    if (canInject(s)) {
      for (const b of batches(msgs)) injectMessages(sessionId, b);
      return;
    }
    inbox.set(sessionId, [...(inbox.get(sessionId) ?? []), ...msgs]);
    setInboxTick((t) => t + 1);
    scheduleInboxSave();
    // 모으는 사이 바빠졌다 — 먼저 붙인 `전달됨`을 `대기 중`으로 되돌린다. 배출 때 다시 전달됨이 된다
    const mine = msgs.filter((m) => m.from === "나");
    if (mine.length) setDeliveries((d) => ({ ...d, ...Object.fromEntries(mine.map((m) => [m.id, "queued" as const])) }));
  }, GATHER_MS);
}

function deliver(wsId: string, m: ConversationMessage): void {
  let queued = false;
  let reached = false;
  const park = (id: string) => {
    const q = inbox.get(id) ?? [];
    q.push(m);
    inbox.set(id, q);
    setInboxTick((t) => t + 1);
    scheduleInboxSave(); // 인박스 영속 — 대기분은 재시작을 넘긴다
    queued = true;
  };
  const inject = (id: string) => {
    gather(id, m);
    reached = true;
  };
  for (const s of recipients(wsId, m.to)) {
    if (s.id === m.from) continue; // 에이전트 발신(@all)이 자기 자신에게 되돌아가지 않게
    if (s.status === "dead") {
      park(s.id); // 프로세스가 없다 — 재개하면 idle 전이에서 흘러간다 (B50)
    } else if (unmanagedAgent(s)) {
      // 사람이 페인에 직접 띄운 에이전트 — 쌓기만 한다 (BR-02). 화면 에코도 하지 않는다:
      // TUI는 우리가 끼워 넣은 줄을 모르므로 이후 차등 재그리기가 전부 어긋난다.
      park(s.id);
    } else if (!s.personaId) {
      echoPty(s.id, fmtEcho(m, senderLabel(m.from, wsId))); // 기본 터미널 — 표시 전용 (P-2)
      reached = true;
    } else if (s.status === "shell") {
      // 역할은 있는데 에이전트가 아직 안 떴다 — 셸에 주입하면 사람이 치던 명령을 실행시킨다.
      // 사람이 읽도록 화면에만 에코하고, 원문은 인박스에 남겨 기동 직후 에이전트에게 전달한다.
      echoPty(s.id, fmtEcho(m, senderLabel(m.from, wsId)));
      park(s.id);
    } else if (canInject(s)) {
      inject(s.id); // 유휴 = 프롬프트가 비어 있다 → 즉시 (M3)
    } else {
      park(s.id);
    }
  }
  if (m.from === "나" && (queued || reached)) {
    setDeliveries((d) => ({ ...d, [m.id]: queued ? "queued" : "delivered" }));
  }
}

/** agent-state 훅 — idle 전이가 곧 "턴 종료" 신호다 (M3). agent.ts 리스너가 부른다. */
export function flushInboxOnState(sessionId: string, status: string | undefined): void {
  if (status !== "idle") return;
  const q = inbox.get(sessionId);
  if (!q?.length) return;
  inbox.delete(sessionId);
  setInboxTick((t) => t + 1);
  saveInboxNow(); // 전달 완료 — 캐시의 대기분도 바로 비운다
  markDelivered(q);
  // 대기분은 한 줄로 묶어 턴 하나로 흘린다 — 넘치는 만큼만 덩어리가 갈리고 큐가 사이를 벌린다
  for (const b of batches(q)) injectMessages(sessionId, b);
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
