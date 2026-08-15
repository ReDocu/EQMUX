// 대화 탭 (KnvN6) — 사이드 패널 탭이며 메인 화면이 아니다 (M1).
// 워크스페이스 = 팀 = 스트림 하나 (M5 평면). 원장은 message 테이블(PRD F)이고
// 발신은 msg_send, 전달은 conversation.ts의 인박스 + 상태 기반 PTY 주입 (M3).
// 사람도 같은 스트림의 참여자다 (M4) — "@카이 내용"이면 그 세션, 없으면 @all.
import { createEffect, createSignal, For, Show } from "solid-js";
import {
  ensureConversation,
  markConversationRead,
  MSG_MAX_BODY,
  pendingInbox,
  sendConversation,
} from "../backend/conversation";
import { backend } from "../backend/mock";
import { scopeWorkspace, tick } from "../state";
import { Eyebrow } from "./ui";
import { sessionDisplayName } from "../types";
import type { ConversationMessage, Session } from "../types";

const TYPES: ConversationMessage["type"][] = ["ask", "handoff", "report", "review", "escalate"];
const TYPE_COLOR: Record<ConversationMessage["type"], string> = {
  ask: "blue",
  handoff: "purple",
  report: "green",
  review: "amber",
  escalate: "red",
};

export function ConversationTab() {
  // 스코프 = 현재 워크스페이스 문맥 (state.scopeWorkspace — 단일 소스). 활성 워크스페이스
  // 화면이 없으면 마지막으로 있던 워크스페이스를 유지한다. 임의 폴백은 없다 —
  // 조용히 다른 팀의 스트림을 보여주지 않는다.
  const ws = () => scopeWorkspace();
  createEffect(() => {
    const w = ws();
    if (w) ensureConversation(w.id); // 늦게 등록된 워크스페이스도 첫 열람 때 원장을 읽는다
  });

  const personaName = (personaId: string) =>
    backend.listPersonas().find((p) => p.id === personaId)?.name ?? personaId;
  // 기본 터미널(역할 없음)도 대화 참여자다 — 수신은 셸 프롬프트의 주석 라인 (conversation.ts)
  const wsSessions = () => backend.listSessions().filter((s) => s.workspaceId === ws()?.id);
  const nameOf = (s: Session) =>
    sessionDisplayName(s, s.personaId ? personaName(s.personaId) : "기본 터미널");
  const sessionName = (id: string) => {
    const s = backend.listSessions().find((x) => x.id === id);
    return s ? nameOf(s) : id;
  };
  const displayTo = (to: string) => (to === "@all" ? "@all" : sessionName(to));

  const messages = () => {
    tick();
    const id = ws()?.id;
    return backend.listMessages().filter((m) => m.workspaceId === id || m.workspaceId === undefined);
  };
  const unread = () => messages().filter((m) => m.unread).length;
  const waitingInbox = () => {
    tick();
    const ids = new Set(wsSessions().map((s) => s.id));
    return pendingInbox().filter((p) => ids.has(p.sessionId));
  };

  const [selType, setSelType] = createSignal<ConversationMessage["type"]>("ask");
  const [filter, setFilter] = createSignal<"전체" | "미확인">("전체");
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const shown = () => (filter() === "미확인" ? messages().filter((m) => m.unread) : messages());

  // @멘션 해석 (M4) — 표시 이름·페르소나 이름·페르소나 id·세션 id 무엇으로든 그 세션을 찾는다.
  // 이름 없는 기본 터미널 여럿이면 첫 번째가 잡힌다 — 구분하려면 세션 이름(FR-E-36)을 붙인다
  const target = (mention: string): Session | undefined =>
    wsSessions().find(
      (s) =>
        nameOf(s) === mention ||
        (s.personaId && (personaName(s.personaId) === mention || s.personaId === mention)) ||
        s.id === mention,
    );

  const send = async () => {
    const w = ws();
    const body = draft().trim();
    if (!w || !body) return;
    const m = body.match(/^@(\S+)\s+(.*)$/s);
    let to = "@all";
    let text = body;
    if (m && m[1] !== "all") {
      const t = target(m[1]);
      if (!t) {
        setError(`수신자 없음: @${m[1]} — 이 워크스페이스의 페르소나·세션 이름으로`);
        return;
      }
      to = t.id;
      text = m[2];
    } else if (m) {
      text = m[2];
    }
    setError(await sendConversation(w.id, to, selType(), text));
    if (!error()) setDraft("");
  };

  return (
    <div class="conv-tab">
      <div class="conv-head">
        <Eyebrow>
          팀 대화{ws() ? ` · ${ws()!.name}` : ""} · {unread()} 미확인
        </Eyebrow>
        <div style={{ display: "flex", gap: "4px" }}>
          <For each={["전체", "미확인"] as const}>
            {(f) => (
              <button class="btn ghost" classList={{ primary: filter() === f }} onClick={() => setFilter(f)}>
                {f}
              </button>
            )}
          </For>
          <button class="btn ghost" onClick={() => markConversationRead(ws()?.id)}>
            모두 읽음
          </button>
        </div>
      </div>
      <Show when={waitingInbox().length > 0}>
        <div class="card inset" style={{ padding: "6px 10px", "font-size": "11px" }}>
          <span class="muted">인박스 대기 (M3 — 턴 종료 시 전달): </span>
          <For each={waitingInbox()}>
            {(p, i) => (
              <span class="mono">
                {i() > 0 ? " · " : ""}
                {sessionName(p.sessionId)} {p.count}건
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="conv-stream">
        <Show
          when={shown().length > 0}
          fallback={
            <div class="muted" style={{ padding: "16px", "font-size": "12px", "text-align": "center" }}>
              아직 메시지가 없습니다 — 아래에서 타입을 골라 팀에 보내보세요.
              <div class="mono" style={{ "font-size": "10px", "margin-top": "6px" }}>
                idle 세션에는 즉시, 작업 중이면 턴 종료 시 전달됩니다 (M3)
              </div>
            </div>
          }
        >
          <For each={shown()}>
            {(m) => (
              <div class="card conv-msg" classList={{ unread: m.unread }}>
                <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                  <span style={{ "font-weight": 700, "font-size": "12px" }}>
                    {m.from === "나" ? "나" : sessionName(m.from)} → {displayTo(m.to)}
                  </span>
                  <span class={`badge ${TYPE_COLOR[m.type]}`}>{m.type.toUpperCase()}</span>
                  <span class="mono muted" style={{ "margin-left": "auto", "font-size": "10px" }}>
                    {m.time}
                  </span>
                </div>
                <div style={{ "margin-top": "4px", "font-size": "12px" }}>{m.body}</div>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="conv-composer card">
        <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap", "margin-bottom": "6px" }}>
          <For each={TYPES}>
            {(t) => (
              <button
                class={`badge ${selType() === t ? TYPE_COLOR[t] : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelType(t)}
              >
                {t.toUpperCase()}
              </button>
            )}
          </For>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            style={{ flex: 1, "min-width": 0 }}
            placeholder={ws() ? "@카이 질문… (@ 없으면 @all)" : "워크스페이스 탭을 먼저 여세요"}
            disabled={!ws()}
            maxLength={MSG_MAX_BODY}
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void send()}
          />
          <button class="btn primary" disabled={!ws()} onClick={() => void send()}>
            보내기
          </button>
        </div>
        <Show when={error()}>
          <div style={{ color: "var(--red, #e5534b)", "font-size": "11px", "margin-top": "4px" }}>
            {error()}
          </div>
        </Show>
      </div>
    </div>
  );
}
