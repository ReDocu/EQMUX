// 대화 탭 (KnvN6) — 사이드 패널 탭이며 메인 화면이 아니다 (M1).
// 시간순 평면 스트림 · 타입 강제 5종 (M2) · @멘션 (M4) — 사람도 같은 스트림의 참여자다.
import { createSignal, For } from "solid-js";
import { backend } from "../backend/mock";
import { tick } from "../state";
import { Eyebrow } from "./ui";
import type { ConversationMessage } from "../types";

const TYPES: ConversationMessage["type"][] = ["ask", "handoff", "report", "review", "escalate"];
const TYPE_COLOR: Record<ConversationMessage["type"], string> = {
  ask: "blue",
  handoff: "purple",
  report: "green",
  review: "amber",
  escalate: "red",
};

export function ConversationTab() {
  const messages = () => {
    tick();
    return backend.listMessages();
  };
  const unread = () => messages().filter((m) => m.unread).length;
  const [selType, setSelType] = createSignal<ConversationMessage["type"]>("ask");
  const [filter, setFilter] = createSignal<"전체" | "미확인">("전체");
  const [draft, setDraft] = createSignal("");

  const shown = () => (filter() === "미확인" ? messages().filter((m) => m.unread) : messages());

  const send = () => {
    const body = draft().trim();
    if (!body) return;
    // @멘션 파싱 (M4) — "@카이 내용" 형태면 수신자를 분리한다
    const m = body.match(/^@(\S+)\s+(.*)$/s);
    backend.sendMessage("나", m ? `@${m[1]}` : "@all", selType(), m ? m[2] : body);
    setDraft("");
  };

  return (
    <div class="conv-tab">
      <div class="conv-head">
        <Eyebrow>팀 대화 · {unread()} 미확인</Eyebrow>
        <div style={{ display: "flex", gap: "4px" }}>
          <For each={["전체", "미확인"] as const}>
            {(f) => (
              <button class="btn ghost" classList={{ primary: filter() === f }} onClick={() => setFilter(f)}>
                {f}
              </button>
            )}
          </For>
          <button class="btn ghost" onClick={() => backend.markAllRead()}>
            모두 읽음
          </button>
        </div>
      </div>
      <div class="conv-stream">
        <For each={shown()}>
          {(m) => (
            <div class="card conv-msg" classList={{ unread: m.unread }}>
              <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                <span style={{ "font-weight": 700, "font-size": "12px" }}>
                  {m.from} → {m.to}
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
            placeholder="@카이 질문… (@ 없으면 @all)"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button class="btn primary" onClick={send}>
            보내기
          </button>
        </div>
      </div>
    </div>
  );
}
