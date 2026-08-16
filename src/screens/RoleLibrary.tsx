// 역할 라이브러리 (화면 #7) — 직무 / 페르소나 목록 · 편집 (FR-E-28: 생성·편집·복제·삭제).
// 직무=책임, 페르소나=판단 성향 (P1 분리). 전역 라이브러리 + 워크스페이스 오버라이드 (P2).
// Tauri에서는 앱데이터 jobs/*.md·personas/*.md 실파일이 원본이다 (FR-E-20~23).
import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
  addPersonaFile,
  createCharacterFile,
  deleteCharacterFile,
  deletePersonaFile,
  listMergedLibrary,
  readCharacterFile,
  saveCharacterFile,
  saveJobFile,
  savePersonaFile,
} from "../backend/library";
import type { LibSource, MergedLibrary } from "../backend/library";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { t, tf } from "../i18n";
import { nudgeRoleReload, saveRoleFile } from "../backend/roles";
import { fileChangeTick } from "../backend/watch";
import { tick } from "../state";
import { Eyebrow, KV } from "../components/ui";
import { jobMeta } from "../jobs";
import { personaLevel, personaProfile, personaTagline } from "../types";
import type { Job, Persona, PersonaLevel, Workspace } from "../types";

// 색 팔레트 = 직무 8색 (jobs.ts JOB_META와 1:1) — 점 안 글자는 직무 이름 앞글자
const JOB_PALETTE: { color: Persona["color"]; letter: string; job: string }[] = [
  { color: "blue", letter: "리", job: "리드" },
  { color: "cyan", letter: "기", job: "기획" },
  { color: "purple", letter: "개", job: "개발" },
  { color: "pink", letter: "디", job: "디자인" },
  { color: "green", letter: "Q", job: "QA" },
  { color: "red", letter: "디", job: "디버거" },
  { color: "slate", letter: "문", job: "문서" },
  { color: "orange", letter: "릴", job: "릴리즈" },
];
const HINT_BUDGET = 10; // P3 — 페르소나 본문 5~10줄, 초과 시 경고 (FR-E-24)
const CHAR_BUDGET = 3; // 중간 단계 — 말투·성격 각 3줄 권장, 긴 캐릭터 묘사는 토큰만 먹는다 (P3와 같은 태도)
const TONE_PRESETS = ["간결한 존댓말", "친근한 반말", "차분한 설명형", "건조한 보고체"];
const LEVEL_NAME: Record<"basic" | "mid" | "adv", string> = { basic: "기본", mid: "중급", adv: "고급" };

type SJob = Job & { source?: LibSource };
type SPersona = Persona & { source?: LibSource };

export function RoleLibrary() {
  // ── 스코프 (FR-E-21, M30) — 전역 / 워크스페이스 병합. 병합에서 같은 id는 ws가 이긴다 (P2) ──
  // 스코프 칩 UI는 제거됨 — 항상 전역 보기. 병합 로직은 남겨둔다 (되살릴 때 UI만 붙이면 됨)
  const [scopeWs] = createSignal<Workspace | undefined>(undefined);
  const [mergedLib, setMergedLib] = createSignal<MergedLibrary | undefined>(undefined);
  let scopeReq = 0; // 스코프 빠른 전환 시 이전 워크스페이스의 늦은 병합 응답이 덮지 않게
  const loadScope = async (ws: Workspace) => {
    const req = ++scopeReq;
    const merged = await listMergedLibrary(ws.path);
    if (req === scopeReq) setMergedLib(merged);
  };
  /** 전역 CRUD 뒤 — 스코프 중이면 병합본도 따라잡는다 */
  const reloadScope = () => {
    const ws = scopeWs();
    if (ws) void loadScope(ws);
  };
  // 외부 편집 감지 (FR-E-73) — .eqmux/jobs·personas가 밖에서 바뀌면 병합 뷰를 재실측한다
  createEffect(on(fileChangeTick, reloadScope, { defer: true }));

  const jobs = (): SJob[] => {
    tick();
    const m = scopeWs() && mergedLib();
    return m ? m.jobs : backend.listJobs();
  };
  const personas = (): SPersona[] => {
    tick();
    const m = scopeWs() && mergedLib();
    return m ? m.personas : backend.listPersonas();
  };
  const [selId, setSelId] = createSignal<string | undefined>(undefined);
  const [saved, setSaved] = createSignal(false);
  const sel = () => personas().find((p) => p.id === selId());
  // 오버라이드 항목은 여기서 편집하지 않는다 — 원본이 .eqmux 파일이고 편집 커맨드는 전역에 쓴다 (FR-E-28)
  const selIsWs = () => sel()?.source === "ws";
  const [draftName, setDraftName] = createSignal("");
  const [draftColor, setDraftColor] = createSignal<Persona["color"]>("blue");
  const [draftJob, setDraftJob] = createSignal(""); // 기본 직무 — 역할 부여가 따라간다. "" = 미지정
  // ── 단계별 독립 프로필 3벌 — 단계 전환은 편집 대상 교체일 뿐, 다른 단계 값은 그대로 남는다 ──
  type DraftProfile = { hint: string; tone: string; personality: string };
  const emptyProf = (): DraftProfile => ({ hint: "", tone: "", personality: "" });
  const profileOf = (p: Persona, lvl: PersonaLevel): DraftProfile => {
    const src = personaProfile(p, lvl);
    return { hint: src.hint ?? "", tone: src.tone ?? "", personality: src.personality ?? "" };
  };
  const [draftProfiles, setDraftProfiles] = createSignal<Record<PersonaLevel, DraftProfile>>({
    basic: emptyProf(),
    mid: emptyProf(),
    adv: emptyProf(),
  });
  const [editLevel, setEditLevel] = createSignal<PersonaLevel>("basic");
  const prof = () => draftProfiles()[editLevel()];
  const setProf = (patch: Partial<DraftProfile>) =>
    setDraftProfiles({ ...draftProfiles(), [editLevel()]: { ...prof(), ...patch } });

  const select = (p: SPersona) => {
    setSelJobId(undefined);
    setSelId(p.id);
    setDraftName(p.name);
    setDraftColor(p.color);
    setDraftJob(p.job ?? "");
    setDraftProfiles({ basic: profileOf(p, "basic"), mid: profileOf(p, "mid"), adv: profileOf(p, "adv") });
    setEditLevel(personaLevel(p));
    setSaved(false);
    setSaveErr(undefined);
    closeSheet();
  };

  const [saveErr, setSaveErr] = createSignal<string | undefined>(undefined);
  const save = async () => {
    const p = sel();
    if (!p || selIsWs()) return;
    const d = draftProfiles();
    const active = d[editLevel()];
    // mtimeMs — 편집을 시작한 시점의 파일 상태 (P-7). 그 사이 밖에서 바뀌면 저장이 거부된다
    const err = await savePersonaFile({
      id: p.id,
      name: draftName(),
      level: editLevel(), // 활성 단계 — 어느 프로필이 표시·주입되는지
      basic: d.basic,
      mid: d.mid,
      adv: d.adv,
      hint: active.hint, // 활성 사본 — 브라우저 목 표시용 (Tauri는 재실측이 다시 채운다)
      tone: active.tone,
      personality: active.personality,
      color: draftColor(),
      job: draftJob(),
      mtimeMs: p.mtimeMs,
    });
    setSaveErr(err ?? undefined);
    reloadScope();
    setSaved(!err);
  };

  const lineCount = (s: string) => s.split("\n").filter((l) => l.trim()).length;
  const hintLines = () => lineCount(prof().hint);

  // ── 고급 캐릭터 시트 (3단계) — 파일이 원본, 존재가 곧 고급. 편집은 앱 내 텍스트영역 + mtime 충돌 ──
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [sheetText, setSheetText] = createSignal("");
  const [sheetMtime, setSheetMtime] = createSignal<number | undefined>(undefined);
  const [sheetErr, setSheetErr] = createSignal<string | undefined>(undefined);
  const [sheetSaved, setSheetSaved] = createSignal(false);
  const closeSheet = () => {
    setSheetOpen(false);
    setSheetText("");
    setSheetMtime(undefined);
    setSheetErr(undefined);
    setSheetSaved(false);
  };
  const openSheet = async (id: string) => {
    const sheet = await readCharacterFile(id);
    if (!sheet) return;
    setSheetText(sheet.content);
    setSheetMtime(sheet.mtimeMs);
    setSheetSaved(false);
    setSheetErr(undefined);
    setSheetOpen(true);
  };
  /** 시트 갱신을 캐스팅된 살아있는 세션에 알린다 — 역할 파일 재합성 + 넛지 (FR-E-44 재사용) */
  const nudgeCastSessions = (personaId: string) => {
    for (const s of backend.listSessions().filter((x) => x.personaId === personaId)) {
      void saveRoleFile(s.id).then((path) => {
        if (path) nudgeRoleReload(s.id, path);
      });
    }
  };
  const promoteToSheet = async () => {
    const p = sel();
    if (!p || selIsWs()) return;
    await createCharacterFile(p.id, draftName() || p.name);
    reloadScope();
    await openSheet(p.id);
  };
  const saveSheet = async () => {
    const id = selId();
    if (!id) return;
    const err = await saveCharacterFile(id, sheetText(), sheetMtime());
    setSheetErr(err ?? undefined);
    if (!err) {
      // 다음 편집을 위한 mtime 재실측 + 살아있는 캐스팅 세션에 "다시 읽어라"
      const fresh = await readCharacterFile(id);
      setSheetMtime(fresh?.mtimeMs);
      nudgeCastSessions(id);
      reloadScope();
    }
    setSheetSaved(!err);
  };
  const demoteSheet = async () => {
    const id = selId();
    if (!id || selIsWs()) return;
    await deleteCharacterFile(id);
    reloadScope();
    closeSheet();
  };

  // ── 3단계 생성 플로우 — 고른 단계가 명시 상태로 저장되고, 편집창 선택기로 언제든 바꾼다 ──
  const [addOpen, setAddOpen] = createSignal(false);
  const addWithLevel = async (level: "basic" | "mid" | "adv") => {
    setAddOpen(false);
    const id = await addPersonaFile(level);
    if (level === "adv" && id) await createCharacterFile(id, "새 페르소나");
    reloadScope();
    if (!id) return; // 브라우저 목 — 목록 갱신만
    const p = backend.listPersonas().find((x) => x.id === id);
    if (!p) return;
    select(p); // 저장된 명시 level대로 폼이 열린다
    if (level === "adv") await openSheet(id);
  };
  // 캐스팅된 페르소나는 삭제를 막는다 — 역할 파일 합성이 이 항목을 참조한다
  const inUse = () => backend.listSessions().some((s) => s.personaId === selId());
  const remove = async () => {
    const id = selId();
    if (!id || inUse() || selIsWs()) return;
    await deletePersonaFile(id);
    reloadScope();
    setSelId(undefined);
  };

  // ── 직무 편집 (FR-E-28) — 권한은 곧 실행 플래그의 원천이라 편집 화면에서도 정직하게 보여준다 ──
  const [selJobId, setSelJobId] = createSignal<string | undefined>(undefined);
  const selJob = () => jobs().find((j) => j.id === selJobId());
  const selJobIsWs = () => selJob()?.source === "ws";
  const [jobSaved, setJobSaved] = createSignal(false);
  const [jDraft, setJDraft] = createSignal({
    name: "",
    write: false,
    commit: false,
    push: false,
    responsibility: "",
    forbidden: "",
  });

  const selectJob = (j: SJob) => {
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
    setJobSaveErr(undefined);
  };

  const [jobSaveErr, setJobSaveErr] = createSignal<string | undefined>(undefined);
  const saveJob = async () => {
    const j = selJob();
    if (!j || selJobIsWs()) return;
    const d = jDraft();
    const err = await saveJobFile({
      id: j.id,
      name: d.name,
      permissions: { write: d.write, commit: d.commit, push: d.push },
      responsibility: d.responsibility,
      forbidden: d.forbidden,
      mtimeMs: j.mtimeMs, // 편집 시작 시점의 파일 상태 (P-7)
    });
    setJobSaveErr(err ?? undefined);
    reloadScope();
    setJobSaved(!err);
  };

  // 직무는 8종 고정 로스터 — 추가·복제·삭제 없음. 문구·권한 편집만 가능하고,
  // 파일을 밖에서 지워도 다음 부팅 시드가 기본값으로 되살린다 (library.rs fixed_jobs).

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("역할 라이브러리")}</h1>
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
          {/* 3단계 생성 — 단계는 폼 깊이 선택일 뿐, 저장 상태가 아니다 (채워진 내용이 단계를 정한다) */}
          <Show
            when={addOpen()}
            fallback={
              <button class="btn primary" title={t("전역 라이브러리에 추가 — 단계를 고릅니다")} onClick={() => setAddOpen(true)}>
                {t("+ 페르소나 추가")}
              </button>
            }
          >
            <span class="eyebrow">{t("단계")}</span>
            <button class="btn" title={t("이름 · 색 · 판단 성향")} onClick={() => void addWithLevel("basic")}>
              {t("기본")}
            </button>
            <button class="btn" title={t("+ 말투 · 성격 옵션")} onClick={() => void addWithLevel("mid")}>
              {t("중급")}
            </button>
            <button
              class="btn"
              title={t("+ 캐릭터 시트 (personas/<id>.character.md)")}
              disabled={!isTauri()}
              onClick={() => void addWithLevel("adv")}
            >
              {t("고급")}
            </button>
            <button class="btn ghost" onClick={() => setAddOpen(false)}>
              ✕
            </button>
          </Show>
        </div>
      </div>
      <div class="screen-body roles-body">
        <div>
          <Eyebrow>{t("직무")} · {jobs().length}</Eyebrow>
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
                    <span class={`badge ${jobMeta(j.id, j.name).color}`}>{jobMeta(j.id, j.name).badge}</span>
                    <span style={{ "font-weight": 800 }}>{j.name}</span>
                    <span class="mono muted" style={{ "font-size": "10px" }}>
                      {j.id}
                    </span>
                    <Show when={j.source === "ws"}>
                      <span class="badge purple" title={t("워크스페이스 오버라이드 — .eqmux/jobs가 원본 (P2)")}>
                        WS
                      </span>
                    </Show>
                  </div>
                  <div class="muted" style={{ "font-size": "11px", margin: "4px 0 6px" }}>
                    {j.responsibility}
                  </div>
                  <div class="mono" style={{ "font-size": "10px" }}>
                    write {j.permissions.write ? "✓" : "—"} · commit {j.permissions.commit ? "✓" : "—"} · push{" "}
                    {j.permissions.push ? "✓" : "—"}
                  </div>
                  <div class="mono st-dead" style={{ "font-size": "10px", "margin-top": "4px" }}>
                    {t("금지")} · {j.forbidden}
                  </div>
                </button>
              )}
            </For>
          </div>

          <div style={{ "margin-top": "16px" }}>
            <Eyebrow>{t("페르소나")} · {personas().length}</Eyebrow>
            <div class="roles-personas">
              <For each={personas()}>
                {(p) => (
                  <button class="card cast-persona role-persona" classList={{ selected: selId() === p.id }} onClick={() => select(p)}>
                    <span class={`persona-dot ${p.color}`}>{p.name.slice(0, 1)}</span>
                    <div style={{ "min-width": 0 }}>
                      <div style={{ "font-weight": 700, display: "flex", gap: "6px", "align-items": "center" }}>
                        {p.name}
                        <Show when={p.source === "ws"}>
                          <span class="badge purple" title={t("워크스페이스 오버라이드 — .eqmux/personas가 원본 (P2)")}>
                            WS
                          </span>
                        </Show>
                        {/* 3단계 배지 — 명시 level 표시, 기본은 표기 없음 (목록 밀도 유지) */}
                        <Show when={personaLevel(p) === "mid"}>
                          <span class="badge green" title={t("중급 — 말투·성격까지 주입됩니다")}>
                            {t("중급")}
                          </span>
                        </Show>
                        <Show when={personaLevel(p) === "adv"}>
                          <span class="badge amber" title={`${t("고급 단계 — 캐릭터 시트:")} ${p.characterPath ?? ""}`}>
                            {t("고급")}
                          </span>
                        </Show>
                      </div>
                      <div class="muted" style={{ "font-size": "11px" }}>
                        {personaTagline(p)}
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
                <Eyebrow>{t("직무 편집 (FR-E-28)")}</Eyebrow>
                <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "8px" }}>
                  <label class="muted" style={{ "font-size": "11px" }}>
                    {t("이름")} · <span class="mono">id: {j().id}</span>
                  </label>
                  <input value={jDraft().name} onInput={(e) => setJDraft({ ...jDraft(), name: e.currentTarget.value })} />
                  <label class="muted" style={{ "font-size": "11px" }}>
                    {t("기본 권한 (D5) — 실행 플래그로 번역됩니다 (§4.5.1)")}
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
                    {t("책임")}
                  </label>
                  <textarea
                    rows={2}
                    value={jDraft().responsibility}
                    onInput={(e) => setJDraft({ ...jDraft(), responsibility: e.currentTarget.value })}
                  />
                  <label class="muted" style={{ "font-size": "11px" }}>
                    {t("금지")}
                  </label>
                  <textarea
                    rows={2}
                    value={jDraft().forbidden}
                    onInput={(e) => setJDraft({ ...jDraft(), forbidden: e.currentTarget.value })}
                  />
                  <div class="card inset" style={{ padding: "4px 10px" }}>
                    <KV k={t("원본")} v={t(selJobIsWs() ? ".eqmux/jobs/*.md (WS 오버라이드)" : "앱 데이터 jobs/*.md")} />
                    <KV k={t("구성")} v={t("8종 고정 — 문구·권한 편집만 가능, 지워도 부팅 시 부활")} />
                    <KV k={t("권한 반영")} v={t("캐스팅 세션은 재시작 때 (E11′)")} />
                  </div>
                  <Show when={selJobIsWs()}>
                    <div class="mono st-waiting" style={{ "font-size": "10px" }}>
                      {tf(
                        "오버라이드 항목 — 원본은 워크스페이스 .eqmux/jobs/{id}.md 파일입니다. 편집 커맨드는 전역에만 씁니다 (FR-E-28) — 파일을 직접 고치거나 탐색기에서 편집하세요",
                        { id: j().id },
                      )}
                    </div>
                  </Show>
                  <Show when={jobSaveErr()}>
                    <div class="mono st-waiting" style={{ "font-size": "10px" }}>
                      {t(jobSaveErr() ?? "")}
                    </div>
                  </Show>
                  <button class="btn primary" disabled={selJobIsWs()} onClick={() => void saveJob()}>
                    {t(jobSaved() ? "저장됨 ✓" : "저장")}
                  </button>
                </div>
              </>
            )}
          </Show>
          <Show when={!selJob() && !sel()}>
            <div class="muted">{t("직무 또는 페르소나를 선택하면 편집합니다")}</div>
          </Show>
          <Show when={sel()}>
            <Eyebrow>{t("페르소나 편집")}</Eyebrow>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "8px" }}>
              {/* 단계 = 활성 프로필 선택 — 기본/중급/고급이 성향·말투·성격을 각자 한 벌씩 갖는다 */}
              <label class="muted" style={{ "font-size": "11px" }}>
                {t("단계 — 단계마다 독립 프로필(성향·말투·성격). 전환해 각각 편집하고, 활성 단계만 주입됩니다 (저장 시 적용)")}
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <For
                  each={
                    [
                      ["basic", "기본", "이름 · 판단 성향 · 색"],
                      ["mid", "중급", "+ 말투 · 성격"],
                      ["adv", "고급", "+ 캐릭터 시트"],
                    ] as const
                  }
                >
                  {([lvl, label, desc]) => (
                    <button class="btn" classList={{ primary: editLevel() === lvl }} title={t(desc)} onClick={() => setEditLevel(lvl)}>
                      {t(label)}
                    </button>
                  )}
                </For>
              </div>
              <label class="muted" style={{ "font-size": "11px" }}>
                {t("이름 (세션 이름과 분리 가능 · P5)")}
              </label>
              <input value={draftName()} onInput={(e) => setDraftName(e.currentTarget.value)} />
              <label class="muted" style={{ "font-size": "11px" }}>
                {t("색 — 직무 팔레트와 정렬 (점 글자 = 직무 앞글자) · UI 표시 전용")}
              </label>
              <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                <For each={JOB_PALETTE}>
                  {(p) => (
                    <button
                      class={`persona-dot ${p.color}`}
                      title={`${t(p.job)} ${t("색")}`}
                      style={{ cursor: "pointer", outline: draftColor() === p.color ? "2px solid var(--eq-blue)" : "none" }}
                      onClick={() => setDraftColor(p.color)}
                    >
                      {p.letter}
                    </button>
                  )}
                </For>
              </div>
              <label class="muted" style={{ "font-size": "11px" }}>
                {t("기본 직무 — 역할 부여가 직무 선택 없이 이 값을 따릅니다 (미지정이면 부여 시 개발)")}
              </label>
              <select
                value={draftJob()}
                onChange={(e) => setDraftJob(e.currentTarget.value)}
                style={{ "align-self": "flex-start" }}
              >
                <option value="">{t("미지정")}</option>
                <For each={jobs()}>{(j) => <option value={j.id}>{j.name}</option>}</For>
              </select>
              {/* ── 프로필 편집 — 단계마다 독립. 기본=성향만 · 중급=성향+말투+성격 · 고급=시트만 ── */}
              <Show when={editLevel() !== "adv"}>
                <label class="muted" style={{ "font-size": "11px" }}>
                  {tf("판단 성향 ({lvl} 프로필) — 판단 우선순위 · 강조점 · 금기 (FR-E-25) · 예산 5~10줄 (P3)", { lvl: t(LEVEL_NAME[editLevel()]) })}
                </label>
                <textarea rows={4} value={prof().hint} onInput={(e) => setProf({ hint: e.currentTarget.value })} />
                <Show when={hintLines() > HINT_BUDGET}>
                  <div class="mono st-waiting" style={{ "font-size": "11px" }}>
                    {tf("예산 초과 — {n}줄 / 권장 {max}줄. 성향 묘사는 토큰만 먹고 품질에 기여하지 않습니다 (FR-E-24)", { n: hintLines(), max: HINT_BUDGET })}
                  </div>
                </Show>
              </Show>
              {/* 말투·성격은 중급 전용 — 고급은 시트의 말투 규칙·성격 섹션이 담당한다 */}
              <Show when={editLevel() === "mid"}>
              <label class="muted" style={{ "font-size": "11px" }}>
                {tf("말투 ({lvl} 프로필) — 응답의 어조. 비우면 지시하지 않음", { lvl: t(LEVEL_NAME[editLevel()]) })}
              </label>
              <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                <For each={TONE_PRESETS}>
                  {(tp) => (
                    <button
                      class="btn ghost"
                      classList={{ primary: prof().tone === tp }}
                      style={{ "font-size": "11px" }}
                      onClick={() => setProf({ tone: prof().tone === tp ? "" : tp })}
                    >
                      {t(tp)}
                    </button>
                  )}
                </For>
              </div>
              <input
                placeholder={t("예: 간결한 존댓말 · 결론부터 말한다")}
                value={prof().tone}
                onInput={(e) => setProf({ tone: e.currentTarget.value })}
              />
              <label class="muted" style={{ "font-size": "11px" }}>
                {tf("성격 ({lvl} 프로필) — 행동 경향 1~{max}줄. 판단과 겹치면 판단 성향에", { lvl: t(LEVEL_NAME[editLevel()]), max: CHAR_BUDGET })}
              </label>
              <textarea
                rows={2}
                placeholder={t("예: 신중함 — 되돌릴 수 없는 결정을 늦춘다")}
                value={prof().personality}
                onInput={(e) => setProf({ personality: e.currentTarget.value })}
              />
              <Show when={lineCount(prof().tone) > CHAR_BUDGET || lineCount(prof().personality) > CHAR_BUDGET}>
                <div class="mono st-waiting" style={{ "font-size": "11px" }}>
                  {tf("예산 — 말투·성격 각 {max}줄 권장. 긴 캐릭터 묘사는 토큰만 먹습니다 (P3)", { max: CHAR_BUDGET })}
                </div>
              </Show>
              </Show>
              {/* ── 고급 — 캐릭터 시트가 페르소나의 전부다. Tauri 전용 (실파일이 원본) ── */}
              <Show when={editLevel() === "adv" && isTauri()}>
                <label class="muted" style={{ "font-size": "11px" }}>
                  {t("캐릭터 시트 (고급 프로필) — 고급은 시트가 페르소나의 전부입니다. 정체성·성격·말투 규칙을 시트에 적으세요")}
                </label>
                <Show
                  when={sel()!.characterPath}
                  fallback={
                    <button
                      class="btn"
                      disabled={selIsWs()}
                      title={t("personas/<id>.character.md 템플릿 생성 — 이름·출처만 채워도 에이전트가 원전 지식으로 보완합니다")}
                      onClick={() => void promoteToSheet()}
                    >
                      {t("캐릭터 시트 생성")}
                    </button>
                  }
                >
                  <div class="card inset" style={{ padding: "8px 10px", display: "flex", "flex-direction": "column", gap: "6px" }}>
                    <div style={{ display: "flex", gap: "6px", "align-items": "center", "flex-wrap": "wrap" }}>
                      <span class="badge amber">{t("고급")}</span>
                      <span style={{ "font-weight": 700, "font-size": "12px" }}>{sel()!.characterName ?? sel()!.name}</span>
                      <Show when={sel()!.characterSource}>
                        <span class="muted" style={{ "font-size": "11px" }}>{sel()!.characterSource}</span>
                      </Show>
                    </div>
                    <div class="mono muted" style={{ "font-size": "10px", "word-break": "break-all" }}>{sel()!.characterPath}</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <Show
                        when={!sheetOpen()}
                        fallback={
                          <button class="btn" onClick={closeSheet}>
                            {t("시트 닫기")}
                          </button>
                        }
                      >
                        <button
                          class="btn primary"
                          disabled={selIsWs()}
                          title={t(selIsWs() ? "오버라이드 시트는 .eqmux/personas 파일을 직접 편집하세요" : "앱 내 편집 — 저장 시 캐스팅 세션에 알립니다")}
                          onClick={() => void openSheet(sel()!.id)}
                        >
                          {t("시트 편집")}
                        </button>
                      </Show>
                      <button class="btn danger" disabled={selIsWs()} title={t("시트 파일 삭제 — 단계 설정(고급)은 유지됩니다")} onClick={() => void demoteSheet()}>
                        {t("시트 삭제")}
                      </button>
                    </div>
                  </div>
                  <Show when={sheetOpen()}>
                    <textarea
                      rows={16}
                      class="mono"
                      style={{ "font-size": "11px" }}
                      value={sheetText()}
                      onInput={(e) => {
                        setSheetText(e.currentTarget.value);
                        setSheetSaved(false);
                      }}
                    />
                    <Show when={sheetErr()}>
                      <div class="mono st-waiting" style={{ "font-size": "10px" }}>
                        {t(sheetErr() ?? "")}
                      </div>
                    </Show>
                    <button class="btn primary" onClick={() => void saveSheet()}>
                      {t(sheetSaved() ? "시트 저장됨 ✓ — 캐스팅 세션에 알림" : "시트 저장")}
                    </button>
                  </Show>
                </Show>
              </Show>
              <div class="card inset" style={{ padding: "4px 10px" }}>
                <KV k={t("원본")} v={t(selIsWs() ? ".eqmux/personas/*.md (WS 오버라이드)" : "앱 데이터 personas/*.md")} />
                <KV k={t("주입")} v={t(".eqmux/roles/<세션>.md 합성 — 시트는 경로 포인터만")} />
              </div>
              <Show when={selIsWs()}>
                <div class="mono st-waiting" style={{ "font-size": "10px" }}>
                  {tf(
                    "오버라이드 항목 — 원본은 워크스페이스 .eqmux/personas/{id}.md 파일입니다. 편집 커맨드는 전역에만 씁니다 (FR-E-28) — 파일을 직접 고치거나 탐색기에서 편집하세요",
                    { id: sel()!.id },
                  )}
                </div>
              </Show>
              <Show when={saveErr()}>
                <div class="mono st-waiting" style={{ "font-size": "10px" }}>
                  {t(saveErr() ?? "")}
                </div>
              </Show>
              <button class="btn primary" disabled={selIsWs()} onClick={() => void save()}>
                {t(saved() ? "저장됨 ✓" : "저장")}
              </button>
              <button
                class="btn danger"
                disabled={inUse() || selIsWs()}
                title={t(
                  selIsWs()
                    ? "오버라이드는 .eqmux 파일에서 지웁니다"
                    : inUse()
                      ? "캐스팅된 페르소나는 삭제할 수 없습니다"
                      : "personas/<id>.md 파일 삭제",
                )}
                onClick={() => void remove()}
              >
                {t("삭제")} {inUse() ? t("(캐스팅 중)") : ""}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
