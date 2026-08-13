// 트랜스크립트 페인 (화면 #12) — 턴 단위 열람 (V1) · 입력은 PTY로 흘려보냄 (V3).
// 보조 페인이므로 세션 슬롯을 소비하지 않는다 (불변 규칙 3).
// Tauri: 에이전트 JSONL이 1급 소스 (FR-G-80), 인식 불가면 스크롤백 폴백 + 그 사실 표시 (FR-G-86).
// 도구 호출은 접힌 상태가 기본이다 (FR-G-83).
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import { isTauri, scrollbackTail, writePty } from "../backend/pty";
import { readTranscript } from "../backend/transcript";
import type { TranscriptData } from "../backend/transcript";
import { tick } from "../state";
import type { Session } from "../types";

export function TranscriptPane(props: { session: Session }) {
  const persona = () => backend.listPersonas().find((p) => p.id === props.session.personaId);

  const [data, setData] = createSignal<TranscriptData | undefined>(undefined);
  const [fallback, setFallback] = createSignal<string[] | undefined>(undefined);
  const [openTurn, setOpenTurn] = createSignal<number | undefined>(undefined); // 펼친 도구 턴 index

  onMount(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const d = await readTranscript(props.session);
      setData(d);
      if (!d) {
        // 스크롤백 폴백 (FR-G-86) — 로그가 없거나 스키마 인식 불가. 여기는 평문만 쓴다
        const lines = await scrollbackTail(props.session.workspaceId, props.session.id, 200);
        setFallback(lines.map((l) => l.text));
      }
    };
    createEffect(on(() => props.session.id, () => void load()));
    const unsub = backend.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 1000);
    });
    onCleanup(() => {
      clearTimeout(timer);
      unsub();
    });
  });

  // 브라우저 dev — 기존 목 턴 유지
  const mockTurns = () => {
    tick();
    return backend.listTurns(props.session.id);
  };

  // 트랜스크립트 검색 (FR-G-87) — 로드된 창(끝 2MB) 안에서 클라이언트 필터.
  // 도구 턴은 요약 줄과 상세를 함께 검색한다.
  const [query, setQuery] = createSignal("");
  const hit = (...texts: (string | null | undefined)[]) => {
    const q = query().trim().toLowerCase();
    if (!q) return true;
    return texts.some((t) => t?.toLowerCase().includes(q));
  };

  const [draft, setDraft] = createSignal("");
  const send = () => {
    const text = draft().trim();
    if (!text) return;
    if (isTauri()) {
      writePty(props.session.id, text + "\r"); // V3 — 별도 경로 없이 PTY로
    } else {
      backend.sendInput(props.session.id, text);
    }
    setDraft("");
  };

  const sourceLabel = () => {
    const d = data();
    if (!isTauri()) return "목 데이터";
    if (d) {
      const parts = [`JSONL 실측${d.windowed ? " · 끝 2MB 창" : ""}`];
      if (d.skipped > 0) parts.push(`건너뜀 ${d.skipped}줄`);
      return parts.join(" · ");
    }
    return "스크롤백 폴백 (FR-G-86)";
  };

  const roleLabel = (role: string) =>
    role === "user" ? "▸ 사람" : role === "tool" ? "⚙ 도구" : `◂ ${persona()?.name ?? "에이전트"}`;

  return (
    <div class="card terminal-slot transcript">
      <div class="terminal-head mono">
        <span>
          ☰ TRANSCRIPT · {persona()?.name ?? props.session.id} · 참조만 저장 (V2) · {sourceLabel()}
        </span>
        <span style={{ display: "inline-flex", "align-items": "center", gap: "8px" }}>
          <input
            class="transcript-search mono"
            placeholder="검색 (FR-G-87)"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <span class="muted">
            {isTauri() ? (data()?.turns.length ?? fallback()?.length ?? 0) : mockTurns().length} {data() || !isTauri() ? "turns" : "lines"}
          </span>
        </span>
      </div>
      <div class="terminal-body transcript-body">
        {/* Tauri — 실측 턴 */}
        <Show when={isTauri() && data()}>
          {(d) => (
            <For each={d().turns.filter((t) => hit(t.text, t.detail))}>
              {(t, i) => (
                <div class="turn" classList={{ user: t.role === "user" }}>
                  <div class="mono muted" style={{ "font-size": "10px" }}>
                    {roleLabel(t.role)} · {t.time}
                  </div>
                  <Show
                    when={t.role === "tool"}
                    fallback={<div style={{ "font-size": "12px", "white-space": "pre-wrap" }}>{t.text}</div>}
                  >
                    {/* 도구 호출 — 접힌 상태 기본, 클릭 시 입력·출력 (FR-G-83) */}
                    <button
                      class="mono"
                      style={{
                        background: "none",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                        padding: 0,
                        "font-size": "12px",
                        "text-align": "left",
                      }}
                      onClick={() => setOpenTurn(openTurn() === i() ? undefined : i())}
                    >
                      {t.text} <span class="muted">{openTurn() === i() ? "▾" : "▸"}</span>
                    </button>
                    <Show when={openTurn() === i() && t.detail}>
                      <pre
                        class="mono muted"
                        style={{
                          "font-size": "10px",
                          "white-space": "pre-wrap",
                          "margin": "4px 0 0",
                          "max-height": "220px",
                          "overflow-y": "auto",
                        }}
                      >
                        {t.detail}
                      </pre>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          )}
        </Show>

        {/* Tauri — 스크롤백 폴백 */}
        <Show when={isTauri() && !data()}>
          <Show
            when={(fallback()?.length ?? 0) > 0}
            fallback={<div class="muted">트랜스크립트 없음 — 에이전트 로그도 스크롤백도 아직 없습니다</div>}
          >
            <div class="mono st-waiting" style={{ "font-size": "10px", "margin-bottom": "6px" }}>
              트랜스크립트를 인식할 수 없어 스크롤백으로 표시합니다 (FR-G-86)
            </div>
            <For each={fallback()!.filter((l) => hit(l))}>
              {(line) => (
                <div class="mono muted" style={{ "font-size": "11px", "white-space": "pre-wrap" }}>
                  {line}
                </div>
              )}
            </For>
          </Show>
        </Show>

        {/* 브라우저 dev — 목 턴 */}
        <Show when={!isTauri()}>
          <Show when={mockTurns().length > 0} fallback={<div class="muted">트랜스크립트 없음 (목)</div>}>
            <For each={mockTurns().filter((t) => hit(t.text))}>
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
        </Show>
      </div>
      <div class="transcript-input">
        <input
          style={{ flex: 1, "min-width": 0 }}
          placeholder={`${persona()?.name ?? "세션"}의 PTY로 입력 전달 (V3)`}
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
