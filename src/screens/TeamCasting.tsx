// 팀 캐스팅 (IvduM) — 직무 + 페르소나를 4개 세션 슬롯에 배정. 실행 권한을 배정 시점에 미리 보여준다.
// 프리셋의 원본은 앱데이터 presets/*.json 실파일이다 (FR-E-26) — 직무 구성만 담고,
// 페르소나는 라이브러리에서 자동 배정한다 (P1 직무/페르소나 분리).
import { createSignal, For, onMount, Show } from "solid-js";
import { listPresets } from "../backend/library";
import type { CastingPreset } from "../backend/library";
import { autoAssignDefault } from "../backend/missions";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { jobMeta } from "../jobs";
import type { JobBadgeColor } from "../jobs";
import { setView } from "../state";
import { ContextMenu } from "../components/ui";
import type { MenuGroup } from "../components/ui";
import { personaTagline } from "../types";
import type { Permissions } from "../types";

type Slot = { badge: string; badgeColor: JobBadgeColor; personaId: string; jobId: string };

// 브라우저 dev 폴백 — Tauri에서는 presets/*.json 실측이 이 목록을 대체한다 (시드와 동일 구성)
const FALLBACK_PRESETS: CastingPreset[] = [
  { id: "standard", name: "표준", jobs: ["lead", "dev", "dev", "qa"] },
  { id: "dev-heavy", name: "집중개발", jobs: ["lead", "dev", "dev", "dev"] },
  { id: "product", name: "제품기획", jobs: ["lead", "plan", "design", "dev"] },
  { id: "quality", name: "품질", jobs: ["dev", "debug", "qa", "docs"] },
];

function permText(p: Permissions): string {
  const mark = (b: boolean) => (b ? "✓" : "—");
  return `write ${mark(p.write)} · commit ${mark(p.commit)} · push ${mark(p.push)}`;
}

export function TeamCasting(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);

  // 직무 8종 고정 — 배지·색은 jobs.ts JOB_META가 단일 원본 (알 수 없는 id는 이름 대문자 + 파랑)
  const badgeFor = (jobId: string): { badge: string; color: Slot["badgeColor"] } => jobMeta(jobId, job(jobId)?.name);

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

  // 캐스팅 변경 (U3) — 순환 클릭 대신 팝오버 목록에서 직접 고른다.
  // 이 편성의 다른 슬롯에 선 페르소나는 비활성, 다른 워크스페이스에서 활동 중이면 표시만 한다.
  const [castMenu, setCastMenu] = createSignal<{ x: number; y: number; slot: number } | undefined>(undefined);
  const personaGroups = (i: number): MenuGroup[] => {
    const usedElsewhere = new Set(slots().flatMap((sl, j) => (j === i ? [] : [sl.personaId])));
    const activeWs = new Map(
      backend
        .listSessions()
        .filter((sess) => sess.workspaceId !== props.wsId && sess.personaId)
        .map((sess) => [sess.personaId, backend.listWorkspaces().find((w) => w.id === sess.workspaceId)?.name ?? "?"]),
    );
    return [
      backend.listPersonas().map((p) => ({
        label: activeWs.has(p.id) ? `${p.name} — ${activeWs.get(p.id)} 활동 중` : p.name,
        checked: slots()[i].personaId === p.id,
        disabled: usedElsewhere.has(p.id),
        action: () => {
          setSlots(slots().map((sl, j) => (j === i ? { ...sl, personaId: p.id } : sl)));
          setSaved(false);
        },
      })),
    ];
  };

  // 저장과 "편성 선택 →"이 같은 적용 경로를 탄다 — 선택으로 바로 넘어가도
  // 기본 임무 자동 배정(FR-E-56)이 빠지지 않는다 (autoAssignDefault는 임무 있으면 건너뛴다)
  const apply = () => {
    backend.applyCasting(props.wsId, slots());
    for (const sl of slots()) {
      if (sl.personaId) void autoAssignDefault(props.wsId, `${sl.personaId}@${props.wsId}`);
    }
  };
  const save = () => {
    apply();
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
                  {(() => {
                    const pp = persona(slot.personaId);
                    return pp ? personaTagline(pp) : "";
                  })()}
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
                <button
                  class="btn ghost"
                  style={{ "align-self": "start" }}
                  title="페르소나 목록에서 선택"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setCastMenu({ x: r.left, y: r.bottom + 4, slot: i() });
                  }}
                >
                  캐스팅 변경 ▾
                </button>
              </div>
            )}
          </For>
        </div>
        {/* 페르소나 선택 팝오버 (U3) */}
        <Show when={castMenu()}>
          {(m) => (
            <ContextMenu
              x={m().x}
              y={m().y}
              header={`SLOT ${String(m().slot + 1).padStart(2, "0")} · 페르소나 선택`}
              onClose={() => setCastMenu(undefined)}
              groups={personaGroups(m().slot)}
            />
          )}
        </Show>

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
                apply();
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
