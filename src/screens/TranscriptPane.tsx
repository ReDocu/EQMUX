// 트랜스크립트 페인 (화면 #12) — 턴 단위 열람 (V1) · 입력은 PTY로 흘려보냄 (V3).
// 보조 페인이므로 세션 슬롯을 소비하지 않는다 (불변 규칙 3).
// Tauri: 에이전트 JSONL이 1급 소스 (FR-G-80), 인식 불가면 스크롤백 폴백 + 그 사실 표시 (FR-G-86).
// 도구 호출은 접힌 상태가 기본이다 (FR-G-83).
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import { cleanScrollback, exportSessionScrollback } from "../backend/panels";
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
        // 스크롤백 폴백 (FR-G-86) — 로그가 없거나 스키마 인식 불가. 여기는 평문만 쓴다.
        // TUI 잔해(프레임·로고 조각·연속 중복)는 걸러낸다 — 재생 필터와 같은 판정
        const lines = await scrollbackTail(props.session.workspaceId, props.session.id, 200);
        setFallback(cleanScrollback(lines).map((l) => l.text));
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
  // 도구 턴은 요약 줄과 상세를 함께 검색한다. 필터 결과는 메모 — 카운터와 본문이
  // 같은 배열을 공유해 렌더당 이중 필터·정규화를 없앤다.
  const [query, setQuery] = createSignal("");
  const q = createMemo(() => query().trim().toLowerCase());
  const hit = (...texts: (string | null | undefined)[]) => {
    const qq = q();
    if (!qq) return true;
    return texts.some((t) => t?.toLowerCase().includes(qq));
  };
  const shownTurns = createMemo(() => (data()?.turns ?? []).filter((t) => hit(t.text, t.detail)));
  const shownFallback = createMemo(() => (fallback() ?? []).filter((l) => hit(l)));
  const shownMock = createMemo(() => (isTauri() ? [] : mockTurns().filter((t) => hit(t.text))));

  // 세션 저장 — 세션 상세의 "기록 저장"과 같은 공용 흐름(exportSessionScrollback)을
  // 라인 카운터 옆에서 바로 연다. 대화상자·파일 쓰기는 Rust 몫, 여기선 결과 표시만 (FR-D-08)
  const [saving, setSaving] = createSignal(false);
  const [saveMsg, setSaveMsg] = createSignal<{ text: string; err: boolean } | undefined>(undefined);
  let saveMsgTimer: ReturnType<typeof setTimeout> | undefined;
  const showSaveMsg = (text: string, err: boolean) => {
    clearTimeout(saveMsgTimer);
    setSaveMsg({ text, err });
    saveMsgTimer = setTimeout(() => setSaveMsg(undefined), 8000);
  };
  createEffect(on(() => props.session.id, () => {
    clearTimeout(saveMsgTimer);
    setSaveMsg(undefined);
  }));
  onCleanup(() => clearTimeout(saveMsgTimer));
  const saveSession = async () => {
    setSaving(true);
    try {
      const msg = await exportSessionScrollback(props.session, persona()?.name ?? "기본 터미널");
      if (msg) showSaveMsg(msg, false);
    } catch (err) {
      showSaveMsg(String(err), true);
    } finally {
      setSaving(false);
    }
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
      const parts = [`JSONL ${d.guessed ? "· cwd 최신 추정" : "실측"}${d.windowed ? " · 끝 2MB 창" : ""}`];
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
        <span class="transcript-head-title" title={`${persona()?.name ?? props.session.id} · ${sourceLabel()}`}>
          ☰ TRANSCRIPT · {persona()?.name ?? props.session.id} · 참조만 저장 (V2) · {sourceLabel()}
        </span>
        <span class="transcript-head-tools">
          <input
            class="transcript-search mono"
            placeholder="검색 (FR-G-87)"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <span class="muted transcript-count">
            {(() => {
              // 검색 중에는 필터 결과를 함께 보인다 — 총계만 남으면 카운터가 거짓말이 된다 (B6)
              const label = data() || !isTauri() ? "turns" : "lines";
              const total = isTauri() ? (data()?.turns.length ?? fallback()?.length ?? 0) : mockTurns().length;
              if (!q()) return `${total} ${label}`;
              const shown = isTauri()
                ? (data() ? shownTurns().length : shownFallback().length)
                : shownMock().length;
              return `${shown} / ${total} ${label}`;
            })()}
          </span>
          <button
            class="btn mono transcript-save"
            title="세션 저장 — 스크롤백 전체(디스크 포함, VT 제거 평문)를 .txt로 내보낸다"
            disabled={saving() || !isTauri()}
            onClick={() => void saveSession()}
          >
            {saving() ? "저장 중…" : "💾 세션 저장"}
          </button>
        </span>
      </div>
      <Show when={saveMsg()}>
        {(m) => (
          <div class="mono transcript-save-msg" classList={{ "st-dead": m().err }}>
            {m().text}
          </div>
        )}
      </Show>
      <div class="terminal-body transcript-body">
        {/* Tauri — 실측 턴 */}
        <Show when={isTauri() && data()}>
          <For each={shownTurns()}>
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
            <For each={shownFallback()}>
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
            <For each={shownMock()}>
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
