// 역할 라이브러리 (화면 #7) — 직무 / 페르소나 목록 · 편집 (FR-E-28: 생성·편집·복제·삭제).
// 직무=책임, 페르소나=판단 성향 (P1 분리). 전역 라이브러리 + 워크스페이스 오버라이드 (P2).
// Tauri에서는 앱데이터 jobs/*.md·personas/*.md 실파일이 원본이다 (FR-E-20~23).
import { createSignal, For, Show } from "solid-js";
import {
  addJobFile,
  addPersonaFile,
  deleteJobFile,
  deletePersonaFile,
  duplicateJobFile,
  saveJobFile,
  savePersonaFile,
} from "../backend/library";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { tick } from "../state";
import { Eyebrow, KV } from "../components/ui";
import type { Job, Persona } from "../types";

const COLORS: Persona["color"][] = ["blue", "purple", "green", "amber"];
const HINT_BUDGET = 10; // P3 — 페르소나 본문 5~10줄, 초과 시 경고 (FR-E-24)

export function RoleLibrary() {
  const jobs = () => {
    tick();
    return backend.listJobs();
  };
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
    setSelJobId(undefined);
    setSelId(p.id);
    setDraftName(p.name);
    setDraftHint(p.hint);
    setDraftColor(p.color);
    setSaved(false);
  };

  const save = () => {
    const p = sel();
    if (!p) return;
    void savePersonaFile({ ...p, name: draftName(), hint: draftHint(), color: draftColor() });
    setSaved(true);
  };

  const hintLines = () => draftHint().split("\n").filter((l) => l.trim()).length;
  // 캐스팅된 페르소나는 삭제를 막는다 — 역할 파일 합성이 이 항목을 참조한다
  const inUse = () => backend.listSessions().some((s) => s.personaId === selId());
  const remove = () => {
    const id = selId();
    if (!id || inUse()) return;
    void deletePersonaFile(id);
    setSelId(undefined);
  };

  // ── 직무 편집 (FR-E-28) — 권한은 곧 실행 플래그의 원천이라 편집 화면에서도 정직하게 보여준다 ──
  const [selJobId, setSelJobId] = createSignal<string | undefined>(undefined);
  const selJob = () => jobs().find((j) => j.id === selJobId());
  const [jobSaved, setJobSaved] = createSignal(false);
  const [jDraft, setJDraft] = createSignal({
    name: "",
    write: false,
    commit: false,
    push: false,
    responsibility: "",
    forbidden: "",
  });

  const selectJob = (j: Job) => {
    setSelId(undefined);
    setSelJobId(j.id);
    setJDraft({
      name: j.name,
      write: j.permissions.write,
      commit: j.permissions.commit,
      push: j.permissions.push,
      responsibility: j.responsibility,
      forbidden: j.forbidden,
    });
    setJobSaved(false);
  };

  const saveJob = () => {
    const j = selJob();
    if (!j) return;
    const d = jDraft();
    void saveJobFile({
      ...j,
      name: d.name,
      permissions: { write: d.write, commit: d.commit, push: d.push },
      responsibility: d.responsibility,
      forbidden: d.forbidden,
    });
    setJobSaved(true);
  };

  // 캐스팅된 직무는 삭제를 막는다 — 세션의 실행 권한 번역(§4.5.1)이 이 항목을 참조한다
  const jobInUse = () => backend.listSessions().some((s) => s.jobId === selJobId());
  const removeJob = () => {
    const id = selJobId();
    if (!id || jobInUse()) return;
    void deleteJobFile(id);
    setSelJobId(undefined);
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>역할 라이브러리</h1>
          <div class="sub">
            직무=책임 · 페르소나=판단 성향 — {isTauri() ? "앱데이터 jobs/·personas/ 실파일" : "전역 라이브러리 (목)"} ·
            워크스페이스 오버라이드는 .eqmux/jobs·personas (P2)
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn" onClick={() => void addJobFile()}>
            + 직무 추가
          </button>
          <button class="btn primary" onClick={() => void addPersonaFile()}>
            + 페르소나 추가
          </button>
        </div>
      </div>
      <div class="screen-body roles-body">
        <div>
          <Eyebrow>직무 · {jobs().length}</Eyebrow>
          <div class="roles-jobs">
            <For each={jobs()}>
              {(j) => (
                <button
                  class="card role-job"
                  classList={{ selected: selJobId() === j.id }}
                  style={{ padding: "10px 12px", "text-align": "left", cursor: "pointer" }}
                  onClick={() => selectJob(j)}
                >
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
                </button>
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
          <Show when={selJob()}>
            {(j) => (
              <>
                <Eyebrow>직무 편집 (FR-E-28)</Eyebrow>
                <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "8px" }}>
                  <label class="muted" style={{ "font-size": "11px" }}>
                    이름 · <span class="mono">id: {j().id}</span>
                  </label>
                  <input value={jDraft().name} onInput={(e) => setJDraft({ ...jDraft(), name: e.currentTarget.value })} />
                  <label class="muted" style={{ "font-size": "11px" }}>
                    기본 권한 (D5) — 실행 플래그로 번역됩니다 (§4.5.1)
                  </label>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <For
                      each={[
                        ["write", "write"],
                        ["commit", "commit"],
                        ["push", "push"],
                      ] as const}
                    >
                      {([key, label]) => (
                        <label class="mono" style={{ "font-size": "11px", display: "flex", gap: "4px", "align-items": "center", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={jDraft()[key]}
                            onChange={(e) => setJDraft({ ...jDraft(), [key]: e.currentTarget.checked })}
                          />
                          {label}
                        </label>
                      )}
                    </For>
                  </div>
                  <label class="muted" style={{ "font-size": "11px" }}>
                    책임
                  </label>
                  <textarea
                    rows={2}
                    value={jDraft().responsibility}
                    onInput={(e) => setJDraft({ ...jDraft(), responsibility: e.currentTarget.value })}
                  />
                  <label class="muted" style={{ "font-size": "11px" }}>
                    금지
                  </label>
                  <textarea
                    rows={2}
                    value={jDraft().forbidden}
                    onInput={(e) => setJDraft({ ...jDraft(), forbidden: e.currentTarget.value })}
                  />
                  <div class="card inset" style={{ padding: "4px 10px" }}>
                    <KV k="원본" v="앱 데이터 jobs/*.md" />
                    <KV k="권한 반영" v="캐스팅 세션은 재시작 때 (E11′)" />
                  </div>
                  <button class="btn primary" onClick={saveJob}>
                    {jobSaved() ? "저장됨 ✓" : "저장"}
                  </button>
                  <button class="btn" title="새 id로 복제 — jobs/<id>-copy-*.md" onClick={() => void duplicateJobFile(j())}>
                    복제
                  </button>
                  <button
                    class="btn danger"
                    disabled={jobInUse()}
                    title={jobInUse() ? "캐스팅된 직무는 삭제할 수 없습니다" : "jobs/<id>.md 파일 삭제"}
                    onClick={removeJob}
                  >
                    삭제 {jobInUse() ? "(캐스팅 중)" : ""}
                  </button>
                </div>
              </>
            )}
          </Show>
          <Show when={!selJob() && !sel()}>
            <div class="muted">직무 또는 페르소나를 선택하면 편집합니다</div>
          </Show>
          <Show when={sel()}>
            <Eyebrow>페르소나 편집</Eyebrow>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "8px" }}>
              <label class="muted" style={{ "font-size": "11px" }}>
                이름 (세션 이름과 분리 가능 · P5)
              </label>
              <input value={draftName()} onInput={(e) => setDraftName(e.currentTarget.value)} />
              <label class="muted" style={{ "font-size": "11px" }}>
                판단 성향 — 말투·성격 묘사가 아니라 판단 우선순위 · 강조점 · 금기 (FR-E-25) · 예산 5~10줄 (P3)
              </label>
              <textarea rows={4} value={draftHint()} onInput={(e) => setDraftHint(e.currentTarget.value)} />
              <Show when={hintLines() > HINT_BUDGET}>
                <div class="mono st-waiting" style={{ "font-size": "11px" }}>
                  예산 초과 — {hintLines()}줄 / 권장 {HINT_BUDGET}줄. 성향 묘사는 토큰만 먹고 품질에 기여하지 않습니다 (FR-E-24)
                </div>
              </Show>
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
              <button
                class="btn danger"
                disabled={inUse()}
                title={inUse() ? "캐스팅된 페르소나는 삭제할 수 없습니다" : "personas/<id>.md 파일 삭제"}
                onClick={remove}
              >
                삭제 {inUse() ? "(캐스팅 중)" : ""}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
