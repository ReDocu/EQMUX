// 팀 캐스팅 (IvduM) — 직무 + 페르소나를 4개 세션 슬롯에 배정. 실행 권한을 배정 시점에 미리 보여준다.
// 프리셋의 원본은 앱데이터 presets/*.json 실파일이다 (FR-E-26) — 직무 구성만 담고,
// 페르소나는 라이브러리에서 자동 배정한다 (P1 직무/페르소나 분리).
import { createSignal, For, onMount } from "solid-js";
import { listPresets } from "../backend/library";
import type { CastingPreset } from "../backend/library";
import { autoAssignDefault } from "../backend/missions";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { setView } from "../state";
import type { Permissions } from "../types";

type Slot = { badge: string; badgeColor: "blue" | "purple" | "green" | "amber"; personaId: string; jobId: string };

// 브라우저 dev 폴백 — Tauri에서는 presets/*.json 실측이 이 목록을 대체한다 (시드와 동일 구성)
const FALLBACK_PRESETS: CastingPreset[] = [
  { id: "standard", name: "표준", jobs: ["lead", "impl", "impl", "verify"] },
  { id: "impl-heavy", name: "집중구현", jobs: ["lead", "impl", "impl", "impl"] },
  { id: "review-heavy", name: "리뷰중심", jobs: ["impl", "impl", "review", "review"] },
  { id: "explore", name: "탐색", jobs: ["lead", "impl", "verify", "review"] },
];

const BADGES: Record<string, { badge: string; color: Slot["badgeColor"] }> = {
  lead: { badge: "LEAD", color: "blue" },
  impl: { badge: "BUILDER", color: "purple" },
  review: { badge: "REVIEW", color: "green" },
  verify: { badge: "VERIFY", color: "amber" },
};

function permText(p: Permissions): string {
  const mark = (b: boolean) => (b ? "✓" : "—");
  return `write ${mark(p.write)} · commit ${mark(p.commit)} · push ${mark(p.push)}`;
}

export function TeamCasting(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);

  const badgeFor = (jobId: string): { badge: string; color: Slot["badgeColor"] } =>
    BADGES[jobId] ?? { badge: (job(jobId)?.name ?? jobId).toUpperCase(), color: "blue" };

  // 프리셋 = 직무 구성 → 페르소나는 라이브러리 순서대로 중복 없이 채운다.
  // 페르소나가 부족하면 채울 수 있는 만큼만 (세션 상한 4는 프리셋 로드에서 이미 잘려 있다).
  const slotsFromPreset = (p: CastingPreset): Slot[] => {
    const personas = backend.listPersonas();
    const used = new Set<string>();
    const out: Slot[] = [];
    for (const jobId of p.jobs) {
      const cand = personas.find((x) => !used.has(x.id));
      if (!cand) break;
      used.add(cand.id);
      const b = badgeFor(jobId);
      out.push({ badge: b.badge, badgeColor: b.color, personaId: cand.id, jobId });
    }
    return out;
  };

  const [presets, setPresets] = createSignal<CastingPreset[]>(FALLBACK_PRESETS);
  const [preset, setPreset] = createSignal(FALLBACK_PRESETS[0].id);
  const [slots, setSlots] = createSignal<Slot[]>(slotsFromPreset(FALLBACK_PRESETS[0]));
  const [saved, setSaved] = createSignal(false);

  // 프리셋 실측 (FR-E-26) — 파일이 원본. 깨졌거나 비어 있으면 폴백 목록이 남는다.
  onMount(() => {
    if (!isTauri()) return;
    void listPresets().then((list) => {
      if (list.length === 0) return;
      setPresets(list);
      setPreset(list[0].id);
      setSlots(slotsFromPreset(list[0]));
    });
  });

  const pickPreset = (p: CastingPreset) => {
    setPreset(p.id);
    setSlots(slotsFromPreset(p));
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
    // 기본 임무 자동 배정 (FR-E-56) — 캐스팅으로 생긴 임무 없는 역할 세션에만
    for (const sl of slots()) {
      if (sl.personaId) void autoAssignDefault(props.wsId, `${sl.personaId}@${props.wsId}`);
    }
    setSaved(true);
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>팀 캐스팅 · {ws()?.name}</h1>
          <div class="sub">
            직무 + 페르소나를 4개 세션 슬롯에 배정합니다 · 프리셋 원본: <span class="mono">앱데이터 presets/*.json</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <For each={presets()}>
            {(p) => (
              <button class="btn" classList={{ primary: preset() === p.id }} onClick={() => pickPreset(p)}>
                {p.name}
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
                    <div class="muted">{job(slot.jobId)?.name ?? `${slot.jobId} (라이브러리에 없음)`}</div>
                  </div>
                </div>
                <div class="muted" style={{ "font-size": "11px" }}>
                  {persona(slot.personaId)?.hint}
                </div>
                <div class="card inset" style={{ padding: "6px 10px", "margin-top": "auto" }}>
                  <div class="eyebrow">실행 권한</div>
                  <div class="mono" style={{ "font-size": "11px", "margin-top": "2px" }}>
                    {(() => {
                      const j = job(slot.jobId);
                      return j ? permText(j.permissions) : "— 직무 파일 없음 · 권한 미정";
                    })()}
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
