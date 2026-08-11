// 대화 탭 (KnvN6) — 시간순 평면 스트림 · 타입 강제 5종 (M2) · @멘션 (M4).
import { createSignal, For } from "solid-js";
import { backend } from "../backend/mock";
import { Eyebrow } from "../components/ui";
import type { ConversationMessage } from "../types";

const TYPES: ConversationMessage["type"][] = ["ask", "handoff", "report", "review", "escalate"];
const TYPE_COLOR: Record<ConversationMessage["type"], string> = {
  ask: "blue",
  handoff: "purple",
  report: "green",
  review: "amber",
  escalate: "red",
};

export function Conversation() {
  const messages = () => backend.listMessages();
  const unread = () => messages().filter((m) => m.unread).length;
  const [selType, setSelType] = createSignal<ConversationMessage["type"]>("ask");
  const [filter, setFilter] = createSignal<"전체" | "미확인">("전체");

  const shown = () => (filter() === "미확인" ? messages().filter((m) => m.unread) : messages());

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>팀 대화</h1>
          <div class="sub">{unread()} 미확인 · 사이드 패널 탭 — 메인 화면이 아닙니다 (M1)</div>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <For each={["전체", "미확인"] as const}>
            {(f) => (
              <button class="btn" classList={{ primary: filter() === f }} onClick={() => setFilter(f)}>
                {f}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="screen-body" style={{ display: "flex", "flex-direction": "column", gap: "8px", "max-width": "760px" }}>
        <For each={shown()}>
          {(m) => (
            <div class="card" style={{ padding: "10px 12px" }}>
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ "font-weight": 700 }}>
                  {m.from} → {m.to}
                </span>
                <span class={`badge ${TYPE_COLOR[m.type]}`}>{m.type.toUpperCase()}</span>
                <span class="mono muted" style={{ "margin-left": "auto", "font-size": "11px" }}>
                  {m.time}
                </span>
              </div>
              <div style={{ "margin-top": "6px", "font-size": "12px" }}>{m.body}</div>
            </div>
          )}
        </For>

        <div class="card" style={{ padding: "10px 12px", "margin-top": "auto" }}>
          <Eyebrow>발신 — 타입 선택이 선행됩니다 (M2)</Eyebrow>
          <div style={{ display: "flex", gap: "6px", margin: "8px 0" }}>
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
          <div style={{ display: "flex", gap: "8px" }}>
            <input style={{ flex: 1 }} placeholder="@카이 에게 물어볼 내용을 입력…" />
            <button class="btn primary">보내기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
