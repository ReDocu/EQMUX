// 팀 캐스팅 (IvduM) — 직무 + 페르소나를 4개 세션 슬롯에 배정. 실행 권한을 배정 시점에 미리 보여준다.
import { createSignal, For } from "solid-js";
import { backend } from "../backend/mock";
import { setView } from "../state";
import type { Permissions } from "../types";

type Slot = { badge: string; badgeColor: "blue" | "purple" | "green" | "amber"; personaId: string; jobId: string };

const PRESET_PLANS: Record<string, Slot[]> = {
  표준: [
    { badge: "LEAD", badgeColor: "blue", personaId: "kai", jobId: "lead" },
    { badge: "BUILDER", badgeColor: "purple", personaId: "noel", jobId: "impl" },
    { badge: "REVIEW", badgeColor: "green", personaId: "lin", jobId: "review" },
    { badge: "VERIFY", badgeColor: "amber", personaId: "sol", jobId: "verify" },
  ],
  집중구현: [
    { badge: "LEAD", badgeColor: "blue", personaId: "kai", jobId: "lead" },
    { badge: "BUILDER", badgeColor: "purple", personaId: "noel", jobId: "impl" },
    { badge: "BUILDER", badgeColor: "purple", personaId: "lin", jobId: "impl" },
    { badge: "BUILDER", badgeColor: "purple", personaId: "jun", jobId: "impl" },
  ],
  리뷰중심: [
    { badge: "LEAD", badgeColor: "blue", personaId: "kai", jobId: "lead" },
    { badge: "REVIEW", badgeColor: "green", personaId: "lin", jobId: "review" },
    { badge: "REVIEW", badgeColor: "green", personaId: "hana", jobId: "review" },
    { badge: "VERIFY", badgeColor: "amber", personaId: "sol", jobId: "verify" },
  ],
  탐색: [
    { badge: "LEAD", badgeColor: "blue", personaId: "luca", jobId: "lead" },
    { badge: "BUILDER", badgeColor: "purple", personaId: "mira", jobId: "impl" },
    { badge: "BUILDER", badgeColor: "purple", personaId: "jun", jobId: "impl" },
    { badge: "VERIFY", badgeColor: "amber", personaId: "hana", jobId: "verify" },
  ],
};
const PRESETS = Object.keys(PRESET_PLANS);

function permText(p: Permissions): string {
  const mark = (b: boolean) => (b ? "✓" : "—");
  return `write ${mark(p.write)} · commit ${mark(p.commit)} · push ${mark(p.push)}`;
}

export function TeamCasting(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const [preset, setPreset] = createSignal(PRESETS[0]);
  const [slots, setSlots] = createSignal<Slot[]>(PRESET_PLANS[PRESETS[0]]);
  const [saved, setSaved] = createSignal(false);
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);

  const pickPreset = (p: string) => {
    setPreset(p);
    setSlots(PRESET_PLANS[p]);
    setSaved(false);
  };

  // 캐스팅 변경 — 현재 편성에 없는 다음 페르소나로 순환
  const cyclePersona = (i: number) => {
    const all = backend.listPersonas();
    const used = new Set(slots().map((sl) => sl.personaId));
    const cur = all.findIndex((p) => p.id === slots()[i].personaId);
    for (let step = 1; step <= all.length; step++) {
      const cand = all[(cur + step) % all.length];
      if (!used.has(cand.id)) {
        setSlots(slots().map((sl, j) => (j === i ? { ...sl, personaId: cand.id } : sl)));
        setSaved(false);
        return;
      }
    }
  };

  const save = () => {
    backend.applyCasting(props.wsId, slots());
    setSaved(true);
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>팀 캐스팅 · {ws()?.name}</h1>
          <div class="sub">직무 + 페르소나를 4개 세션 슬롯에 배정합니다</div>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <For each={PRESETS}>
            {(p) => (
              <button class="btn" classList={{ primary: preset() === p }} onClick={() => pickPreset(p)}>
                {p}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="screen-body">
        <div class="cast-grid">
          <For each={slots()}>
            {(slot, i) => (
              <div class="card cast-slot">
                <div class="cast-slot-head">
                  <span class="eyebrow">SLOT {String(i() + 1).padStart(2, "0")}</span>
                  <span class={`badge ${slot.badgeColor}`}>{slot.badge}</span>
                </div>
                <div class="cast-persona">
                  <span class={`persona-dot ${persona(slot.personaId)?.color}`}>
                    {persona(slot.personaId)?.name.slice(0, 1)}
                  </span>
                  <div>
                    <div style={{ "font-weight": 800, "font-size": "15px" }}>{persona(slot.personaId)?.name}</div>
                    <div class="muted">{job(slot.jobId)?.name}</div>
                  </div>
                </div>
                <div class="muted" style={{ "font-size": "11px" }}>
                  {persona(slot.personaId)?.hint}
                </div>
                <div class="card inset" style={{ padding: "6px 10px", "margin-top": "auto" }}>
                  <div class="eyebrow">실행 권한</div>
                  <div class="mono" style={{ "font-size": "11px", "margin-top": "2px" }}>
                    {permText(job(slot.jobId)!.permissions)}
                  </div>
                </div>
                <button class="btn ghost" style={{ "align-self": "start" }} onClick={() => cyclePersona(i())}>
                  캐스팅 변경
                </button>
              </div>
            )}
          </For>
        </div>
        <div class="cast-footer card">
          <div>
            <div style={{ "font-weight": 700, "font-size": "12px" }}>.eqmux/team.json과 team.md에 저장</div>
            <div class="muted" style={{ "font-size": "11px" }}>
              roles/는 합성 후 gitignore · 사용자의 CLAUDE.md는 수정하지 않음
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button class="btn" onClick={save}>
              {saved() ? "저장됨 ✓" : "편성 저장"}
            </button>
            <button
              class="btn primary"
              onClick={() => {
                backend.applyCasting(props.wsId, slots());
                setView({ kind: "composition", wsId: props.wsId });
              }}
            >
              편성 선택 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
