// 트랜스크립트 페인 (화면 #12) — 턴 단위 열람 (V1) · 입력은 PTY로 흘려보냄 (V3).
// 보조 페인이므로 세션 슬롯을 소비하지 않는다 (불변 규칙 3).
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { tick } from "../state";
import type { Session } from "../types";

export function TranscriptPane(props: { session: Session }) {
  const turns = () => {
    tick();
    return backend.listTurns(props.session.id);
  };
  const [draft, setDraft] = createSignal("");
  const persona = () => backend.listPersonas().find((p) => p.id === props.session.personaId);

  const send = () => {
    const text = draft().trim();
    if (!text) return;
    backend.sendInput(props.session.id, text);
    setDraft("");
  };

  return (
    <div class="card terminal-slot transcript">
      <div class="terminal-head mono">
        <span>
          ☰ TRANSCRIPT · {persona()?.name} · 참조만 저장 (V2 — 경로+오프셋)
        </span>
        <span class="muted">{turns().length} turns</span>
      </div>
      <div class="terminal-body transcript-body">
        <Show when={turns().length > 0} fallback={<div class="muted">트랜스크립트 없음 — 에이전트 로그 파일이 아직 없습니다 (스크롤백 폴백)</div>}>
          <For each={turns()}>
            {(t) => (
              <div class="turn" classList={{ user: t.role === "user" }}>
                <div class="mono muted" style={{ "font-size": "10px" }}>
                  {t.role === "user" ? "▸ 사람" : `◂ ${persona()?.name}`} · {t.time}
                </div>
                <div style={{ "font-size": "12px" }}>{t.text}</div>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="transcript-input">
        <input
          style={{ flex: 1, "min-width": 0 }}
          placeholder={`${persona()?.name} 세션의 PTY로 입력 전달 (V3)`}
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={props.session.status === "dead"}
        />
        <button class="btn primary" onClick={send} disabled={props.session.status === "dead"}>
          전송
        </button>
      </div>
    </div>
  );
}
