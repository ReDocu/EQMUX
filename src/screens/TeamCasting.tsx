// 팀 캐스팅 (IvduM · 0.5 시안 cjWtF) — 직무 + 페르소나를 세션 슬롯(상한: 설정 maxSlots, 기본 4)에 배정.
// 실행 권한을 배정 시점에 미리 보여준다.
// 프리셋의 원본은 앱데이터 presets/*.json 실파일이다 (FR-E-26) — 직무 구성만 담고,
// 페르소나는 라이브러리에서 자동 배정한다 (P1 직무/페르소나 분리).
import { createSignal, For, onMount, Show } from "solid-js";
import { listPresets } from "../backend/library";
import type { CastingPreset } from "../backend/library";
import { autoAssignDefault } from "../backend/missions";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { maxSlots } from "../backend/settings";
import { t, tf } from "../i18n";
import { jobMeta } from "../jobs";
import type { JobBadgeColor } from "../jobs";
import { setView, tick } from "../state";
import { ContextMenu, Identity } from "../components/ui";
import type { MenuGroup } from "../components/ui";
import { personaTagline, projectStem, slotNo } from "../types";
import type { Permissions } from "../types";

type Slot = { badge: string; badgeColor: JobBadgeColor; personaId: string; jobId: string };

// 브라우저 dev 폴백 — Tauri에서는 presets/*.json 실측이 이 목록을 대체한다 (시드와 동일 구성)
const FALLBACK_PRESETS: CastingPreset[] = [
  { id: "standard", name: "표준", jobs: ["lead", "dev", "dev", "qa"] },
  { id: "dev-heavy", name: "집중개발", jobs: ["lead", "dev", "dev", "dev"] },
  { id: "product", name: "제품기획", jobs: ["lead", "plan", "design", "dev"] },
  { id: "quality", name: "품질", jobs: ["dev", "debug", "qa", "docs"] },
];

/** 아바타 글자 — `[강사]실버울프`처럼 기호로 시작하는 이름은 첫 글자·숫자를 쓴다 */
const initial = (name: string) => name.match(/[\p{L}\p{N}]/u)?.[0] ?? name.slice(0, 1);

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
  // 페르소나가 부족하면 채울 수 있는 만큼만. 세션 상한은 설정 maxSlots (기본 4 · 옵션 6·8).
  const slotsFromPreset = (p: CastingPreset): Slot[] => {
    const personas = backend.listPersonas();
    const used = new Set<string>();
    const out: Slot[] = [];
    for (const jobId of p.jobs.slice(0, maxSlots())) {
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
  // 슬롯 번호 계획 — applyCasting과 같은 계산 (tick: 세션 목록이 바뀌면 다시)
  const plan = () => {
    tick();
    return backend.planCasting(props.wsId, slots().map((sl) => sl.personaId));
  };

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

  // 현재 프리셋이 채우는 슬롯 수 — 그 밖(추가된 슬롯)만 개별 제거를 허용한다
  const presetLen = () => {
    const p = presets().find((x) => x.id === preset());
    return p ? Math.min(p.jobs.length, maxSlots()) : slots().length;
  };

  // 슬롯 추가 — 상한(설정 maxSlots)까지. 직무는 dev 기본, 페르소나는 남은 것 중 첫 번째
  const addSlot = () => {
    const used = new Set(slots().map((sl) => sl.personaId));
    const cand = backend.listPersonas().find((p) => !used.has(p.id));
    if (!cand) return;
    const jobs = backend.listJobs();
    const jobId = jobs.some((j) => j.id === "dev") ? "dev" : (jobs[0]?.id ?? "dev");
    const b = badgeFor(jobId);
    setSlots([...slots(), { badge: b.badge, badgeColor: b.color, personaId: cand.id, jobId }]);
    setSaved(false);
  };
  const removeSlot = (i: number) => {
    setSlots(slots().filter((_, j) => j !== i));
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
        label: activeWs.has(p.id) ? tf("{name} — {ws} 활동 중", { name: p.name, ws: activeWs.get(p.id)! }) : p.name,
        checked: slots()[i].personaId === p.id,
        disabled: usedElsewhere.has(p.id),
        action: () => {
          setSlots(slots().map((sl, j) => (j === i ? { ...sl, personaId: p.id } : sl)));
          setSaved(false);
        },
      })),
    ];
  };

  // 슬롯별 직무 변경 (P1) — 툴팁이 약속하던 "추가 후 변경". 배지도 함께 바뀐다
  const [jobMenu, setJobMenu] = createSignal<{ x: number; y: number; slot: number } | undefined>(undefined);
  const jobGroups = (i: number): MenuGroup[] => [
    backend.listJobs().map((j) => ({
      label: j.name,
      checked: slots()[i].jobId === j.id,
      action: () => {
        const b = badgeFor(j.id);
        setSlots(slots().map((sl, k) => (k === i ? { ...sl, jobId: j.id, badge: b.badge, badgeColor: b.color } : sl)));
        setSaved(false);
      },
    })),
  ];

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

  // 남는 세션이면 지금 번호 그대로, 새 페르소나면 빈 슬롯 (0.5 시안 cjWtF 슬롯 머리 문구)
  const slotNote = (i: number, personaId: string) => {
    const n = plan()[i];
    const kept = backend.listSessions().find((s) => s.workspaceId === props.wsId && s.personaId === personaId);
    if (kept && n !== undefined && kept.slot === n) return tf("유지 · {n} 그대로", { n: slotNo(n) });
    return t("새 슬롯");
  };
  // 캐스팅 밖 슬롯 — 기본 터미널이 차지했거나 비어 있다
  const otherSlots = () => {
    const used = new Set(plan().filter((n): n is number => n !== undefined));
    const out: { n: number; text: string }[] = [];
    for (let n = 1; n <= maxSlots(); n++) {
      if (used.has(n)) continue;
      const s = backend.listSessions().find((x) => x.workspaceId === props.wsId && x.slot === n && !x.personaId);
      out.push({
        n,
        text: s
          ? tf("기본 터미널 · {name}", { name: s.name ?? "" })
          : tf("빈 슬롯 · 기본 터미널은 관제에서 만든다 (자동 이름 {name})", { name: `${projectStem(ws()?.name ?? "")}${slotNo(n)}` }),
      });
    }
    return out;
  };
  const openMenu = (e: MouseEvent, set: (m: { x: number; y: number; slot: number }) => void, slot: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    set({ x: r.left, y: r.bottom + 4, slot });
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>
            {t("팀 캐스팅")} · {ws()?.name}
          </h1>
          <div class="sub mono">
            {tf("페르소나를 {n}개 슬롯에 배정한다 · 다시 적용해도 남은 세션의 슬롯 번호는 그대로, 새 페르소나만 빈 슬롯에 들어간다", {
              n: maxSlots(),
            })}
          </div>
        </div>
        <div class="cast-head-actions">
          <button class="cast-save mono" classList={{ saved: saved() }} title={t(".eqmux/team.json과 team.md에 저장")} onClick={save}>
            {t(saved() ? "저장됨 ✓ · .eqmux/team.json · team.md" : "편성 저장 · .eqmux/team.json · team.md")}
          </button>
          <button
            class="btn primary"
            onClick={() => {
              apply();
              setView({ kind: "composition", wsId: props.wsId });
            }}
          >
            {t("편성 선택 →")}
          </button>
        </div>
      </div>
      <div class="screen-body cast-body">
        <div class="cast-presets">
          <For each={presets()}>
            {(p) => (
              <button class="btn" classList={{ primary: preset() === p.id }} onClick={() => pickPreset(p)}>
                {t(p.name)}
              </button>
            )}
          </For>
        </div>
        <div class="cast-grid">
          <For each={slots()}>
            {(slot, i) => {
              const pp = () => persona(slot.personaId);
              return (
                <div class="cast-slot">
                  <div class="cast-slot-head mono">
                    {/* 적용될 실제 슬롯 번호 — 남는 세션은 지금 번호, 새 페르소나는 들어갈 빈 슬롯 (0.5) */}
                    <span class="cast-slot-no">SLOT {plan()[i()] ? slotNo(plan()[i()]!) : "—"}</span>
                    <span class="muted">{slotNote(i(), slot.personaId)}</span>
                  </div>
                  <span class={`cast-avatar ${pp()?.color ?? ""}`}>{initial(pp()?.name ?? "")}</span>
                  <div>
                    <Identity name={pp()?.name ?? slot.personaId} title={pp()?.title} job={slot.badge} />
                    {/* 직함 (0.5) — 페르소나 직함. 슬롯 덮어쓰기는 세션 상세에서 */}
                    <Show when={!pp()?.title}>
                      <div class="cast-note">{t("직함 없음 — 역할 파일에 추가 토큰 0")}</div>
                    </Show>
                  </div>
                  <div class="cast-field">
                    <span class="cast-field-label">{t("직무 (이 슬롯만)")}</span>
                    <button
                      class="cast-select"
                      title={t("이 슬롯의 직무를 바꿉니다 — 실행 권한이 따라 바뀝니다")}
                      onClick={(e) => openMenu(e, setJobMenu, i())}
                    >
                      <span class={`badge ${slot.badgeColor}`}>{slot.badge}</span>
                      <span>{job(slot.jobId)?.name ?? `${slot.jobId} ${t("(라이브러리에 없음)")}`} ▾</span>
                    </button>
                  </div>
                  <div class="cast-note">{pp() ? personaTagline(pp()!) : ""}</div>
                  <div class="cast-perm mono">
                    <span class="muted">{t("권한")}</span>
                    <span>
                      {(() => {
                        const j = job(slot.jobId);
                        return j ? permText(j.permissions) : t("— 직무 파일 없음 · 권한 미정");
                      })()}
                    </span>
                  </div>
                  <div class="cast-slot-actions">
                    <button class="btn" title={t("페르소나 목록에서 선택")} onClick={(e) => openMenu(e, setCastMenu, i())}>
                      {t("페르소나 변경")}
                    </button>
                    {/* 추가된 슬롯(프리셋 구성 밖)만 제거 가능 — 프리셋 슬롯은 프리셋 전환으로 되돌린다 */}
                    <Show when={i() >= presetLen()}>
                      <button class="btn ghost" title={t("이 슬롯 제거")} onClick={() => removeSlot(i())}>
                        {t("제거…")}
                      </button>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
          {/* 슬롯 추가 — 상한(설정 maxSlots)까지. 남은 페르소나가 없으면 나오지 않는다 */}
          <Show when={slots().length < maxSlots() && backend.listPersonas().length > slots().length}>
            <button class="cast-slot cast-slot-add" title={t("빈 슬롯 추가 — 직무·페르소나는 추가 후 변경")} onClick={addSlot}>
              <span class="cast-add-plus">+</span>
              <span class="cast-add-label">{t("페르소나 배정")}</span>
              <span class="cast-note mono">
                {slots().length}/{maxSlots()}
              </span>
            </button>
          </Show>
        </div>
        <Show when={otherSlots().length > 0}>
          <div class="cast-more">
            <For each={otherSlots()}>
              {(o) => (
                <div class="cast-mini">
                  <span class="mono cast-mini-no">SLOT {slotNo(o.n)}</span>
                  <span>{o.text}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
        {/* 페르소나 선택 팝오버 (U3) */}
        <Show when={castMenu()}>
          {(m) => (
            <ContextMenu
              x={m().x}
              y={m().y}
              header={`SLOT ${plan()[m().slot] ? slotNo(plan()[m().slot]!) : "—"} · ${t("페르소나 선택")}`}
              onClose={() => setCastMenu(undefined)}
              groups={personaGroups(m().slot)}
            />
          )}
        </Show>

        <Show when={jobMenu()}>
          {(m) => (
            <ContextMenu
              x={m().x}
              y={m().y}
              header={`SLOT ${plan()[m().slot] ? slotNo(plan()[m().slot]!) : "—"} · ${t("직무 선택")}`}
              onClose={() => setJobMenu(undefined)}
              groups={jobGroups(m().slot)}
            />
          )}
        </Show>

        <div class="cast-info">
          <span class="launch-info">ⓘ</span>
          <span>
            {t("편성은 저장하거나 편성 선택으로 넘어갈 때 .eqmux/team.json과 team.md에 적힌다. 직함 칸은 슬롯 덮어쓰기이고 비우면 페르소나 직함을 쓴다. roles/는 합성 후 gitignore · 사용자의 CLAUDE.md는 수정하지 않음.")}
          </span>
        </div>
      </div>
    </div>
  );
}
