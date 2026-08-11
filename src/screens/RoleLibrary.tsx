// 역할 라이브러리 (화면 #7) — 직무 / 페르소나 목록 · 편집.
// 직무=책임, 페르소나=판단 성향 (P1 분리). 전역 라이브러리 + 워크스페이스 오버라이드 (P2).
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { tick } from "../state";
import { Eyebrow, KV } from "../components/ui";
import type { Persona } from "../types";

const COLORS: Persona["color"][] = ["blue", "purple", "green", "amber"];

export function RoleLibrary() {
  const jobs = () => backend.listJobs();
  const personas = () => {
    tick();
    return backend.listPersonas();
  };
  const [selId, setSelId] = createSignal<string | undefined>(undefined);
  const [saved, setSaved] = createSignal(false);
  const sel = () => personas().find((p) => p.id === selId());
  const [draftName, setDraftName] = createSignal("");
  const [draftHint, setDraftHint] = createSignal("");
  const [draftColor, setDraftColor] = createSignal<Persona["color"]>("blue");

  const select = (p: Persona) => {
    setSelId(p.id);
    setDraftName(p.name);
    setDraftHint(p.hint);
    setDraftColor(p.color);
    setSaved(false);
  };

  const save = () => {
    const p = sel();
    if (!p) return;
    backend.savePersona({ ...p, name: draftName(), hint: draftHint(), color: draftColor() });
    setSaved(true);
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>역할 라이브러리</h1>
          <div class="sub">직무=책임 · 페르소나=판단 성향 — 전역 라이브러리, 워크스페이스 오버라이드 (P2)</div>
        </div>
        <button class="btn primary" onClick={() => backend.addPersona()}>
          + 페르소나 추가
        </button>
      </div>
      <div class="screen-body roles-body">
        <div>
          <Eyebrow>직무 · {jobs().length}</Eyebrow>
          <div class="roles-jobs">
            <For each={jobs()}>
              {(j) => (
                <div class="card" style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                    <span style={{ "font-weight": 800 }}>{j.name}</span>
                    <span class="mono muted" style={{ "font-size": "10px" }}>
                      {j.id}
                    </span>
                  </div>
                  <div class="muted" style={{ "font-size": "11px", margin: "4px 0 6px" }}>
                    {j.responsibility}
                  </div>
                  <div class="mono" style={{ "font-size": "10px" }}>
                    write {j.permissions.write ? "✓" : "—"} · commit {j.permissions.commit ? "✓" : "—"} · push{" "}
                    {j.permissions.push ? "✓" : "—"}
                  </div>
                  <div class="mono st-dead" style={{ "font-size": "10px", "margin-top": "4px" }}>
                    금지 · {j.forbidden}
                  </div>
                </div>
              )}
            </For>
          </div>

          <div style={{ "margin-top": "16px" }}>
            <Eyebrow>페르소나 · {personas().length}</Eyebrow>
            <div class="roles-personas">
              <For each={personas()}>
                {(p) => (
                  <button class="card cast-persona role-persona" classList={{ selected: selId() === p.id }} onClick={() => select(p)}>
                    <span class={`persona-dot ${p.color}`}>{p.name.slice(0, 1)}</span>
                    <div style={{ "min-width": 0 }}>
                      <div style={{ "font-weight": 700 }}>{p.name}</div>
                      <div class="muted" style={{ "font-size": "11px" }}>
                        {p.hint}
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="conn-detail">
          <Show when={sel()} fallback={<div class="muted">페르소나를 선택하면 편집합니다</div>}>
            <Eyebrow>페르소나 편집</Eyebrow>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "8px" }}>
              <label class="muted" style={{ "font-size": "11px" }}>
                이름 (세션 이름과 분리 가능 · P5)
              </label>
              <input value={draftName()} onInput={(e) => setDraftName(e.currentTarget.value)} />
              <label class="muted" style={{ "font-size": "11px" }}>
                판단 성향 — 프롬프트 예산 5~10줄 (P3)
              </label>
              <textarea rows={3} value={draftHint()} onInput={(e) => setDraftHint(e.currentTarget.value)} />
              <label class="muted" style={{ "font-size": "11px" }}>
                색 — 캐릭터성은 UI에서만 표현
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <For each={COLORS}>
                  {(c) => (
                    <button
                      class={`persona-dot ${c}`}
                      style={{ cursor: "pointer", outline: draftColor() === c ? "2px solid var(--eq-blue)" : "none" }}
                      onClick={() => setDraftColor(c)}
                    >
                      {draftName().slice(0, 1) || "?"}
                    </button>
                  )}
                </For>
              </div>
              <div class="card inset" style={{ padding: "4px 10px" }}>
                <KV k="원본" v="앱 데이터 personas/*.md" />
                <KV k="주입" v=".eqmux/roles/<세션>.md 합성" />
              </div>
              <button class="btn primary" onClick={save}>
                {saved() ? "저장됨 ✓" : "저장"}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
