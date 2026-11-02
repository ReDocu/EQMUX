// 팀 캐스팅 (IvduM · 0.5 시안 cjWtF) — 직무 + 페르소나를 세션 슬롯(상한: 설정 maxSlots, 기본 4)에 배정.
// 실행 권한을 배정 시점에 미리 보여준다.
// 프리셋의 원본은 앱데이터 presets/*.json 실파일이다 (FR-E-26) — 직무 구성만 담고,
// 페르소나는 라이브러리에서 자동 배정한다 (P1 직무/페르소나 분리).
import { createSignal, For, onMount, Show } from "solid-js";
import { listPresets } from "../backend/library";
import type { CastingPreset } from "../backend/library";
import { applyCastingWithDefaults, castingConfirmLines, permLabel, presetSlots } from "../backend/team";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { maxSlots } from "../backend/settings";
import { t, tf } from "../i18n";
import { jobName } from "../labels";
import { Icon } from "../components/icons";
import { jobMeta } from "../jobs";
import type { JobBadgeColor } from "../jobs";
import { setView, tick, view } from "../state";
import { WizardSteps } from "./LaunchMode";
import { ConfirmDialog, ContextMenu, Identity } from "../components/ui";
import type { MenuGroup } from "../components/ui";
import { PersonaAvatar } from "../components/PersonaAvatar";
import { personaTagline, projectStem, slotNo } from "../types";

type Slot = { badge: string; badgeColor: JobBadgeColor; personaId: string; jobId: string };

// 브라우저 dev 폴백 — Tauri에서는 presets/*.json 실측이 이 목록을 대체한다 (시드와 동일 구성)
const FALLBACK_PRESETS: CastingPreset[] = [
  { id: "standard", name: "표준", jobs: ["lead", "dev", "dev", "qa"] },
  { id: "dev-heavy", name: "집중개발", jobs: ["lead", "dev", "dev", "dev"] },
  { id: "product", name: "제품기획", jobs: ["lead", "plan", "design", "dev"] },
  { id: "quality", name: "품질", jobs: ["dev", "debug", "qa", "docs"] },
];

export function TeamCasting(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);

  // 직무 8종 고정 — 배지·색은 jobs.ts JOB_META가 단일 원본 (알 수 없는 id는 이름 대문자 + 파랑)
  const badgeFor = (jobId: string): { badge: string; color: Slot["badgeColor"] } => jobMeta(jobId, job(jobId)?.name);

  const withBadge = (sl: { personaId: string; jobId: string }): Slot => {
    const b = badgeFor(sl.jobId);
    return { badge: b.badge, badgeColor: b.color, ...sl };
  };
  // 프리셋 = 직무 구성 (P78 · P79) — 지금 팀원은 같은 직무 자리에 남고, 빈 자리만 기본 직무 → 라이브러리 순서로 채운다.
  // 페르소나가 부족하면 채울 수 있는 만큼만. 세션 상한은 설정 maxSlots (기본 4 · 옵션 6·8).
  const slotsFromPreset = (p: CastingPreset): Slot[] =>
    presetSlots(p.jobs, currentSlots(), backend.listPersonas(), maxSlots()).map(withBadge);

  // 지금 편성 (B69) — 역할 세션이 있으면 그 직무·페르소나로 연다. 프리셋 기본값으로 열면
  // 그대로 적용만 해도 돌고 있는 세션의 직무가 바뀌고 목록 밖 세션이 종료됐다
  const currentSlots = (): Slot[] =>
    backend
      .listSessions()
      .filter((s) => s.workspaceId === props.wsId && s.personaId)
      .sort((a, b) => a.slot - b.slot)
      .map((s) => {
        const b = badgeFor(s.jobId);
        return { badge: b.badge, badgeColor: b.color, personaId: s.personaId, jobId: s.jobId };
      });
  const initial0 = currentSlots();
  const [presets, setPresets] = createSignal<CastingPreset[]>(FALLBACK_PRESETS);
  // "" = 지금 편성에서 시작 (어느 프리셋도 아님)
  const [preset, setPreset] = createSignal(initial0.length > 0 ? "" : FALLBACK_PRESETS[0].id);
  const [slots, setSlots] = createSignal<Slot[]>(initial0.length > 0 ? initial0 : slotsFromPreset(FALLBACK_PRESETS[0]));
  const [saved, setSaved] = createSignal(false);
  // 고른 프리셋(또는 지금 편성)에서 손으로 바꿨는가 (P89 '수정됨' · B247 늦은 프리셋 실측이 덮지 않게)
  const [edited, setEdited] = createSignal(false);
  const touch = () => {
    setSaved(false);
    setEdited(true);
  };
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
      // 지금 편성으로 열렸거나, 읽는 사이 사람이 다른 프리셋을 골랐거나 슬롯을 고쳤다 — 버튼 목록만 바꾼다 (B247)
      if (preset() !== FALLBACK_PRESETS[0].id || edited()) return;
      setPreset(list[0].id);
      setSlots(slotsFromPreset(list[0]));
    });
  });

  const pickPreset = (p: CastingPreset) => {
    setPreset(p.id);
    setSlots(slotsFromPreset(p));
    setSaved(false);
    setEdited(false);
  };

  // 슬롯 추가 — 상한(설정 maxSlots)까지. 페르소나는 남은 것 중 첫 번째, 직무는 그 페르소나의 기본 직무 (P79).
  // 기본 직무가 없거나 라이브러리에 없거나 리드가 이미 있으면 dev
  const addSlot = () => {
    const used = new Set(slots().map((sl) => sl.personaId));
    const cand = backend.listPersonas().find((p) => !used.has(p.id));
    if (!cand) return;
    const jobs = backend.listJobs();
    const own = cand.job && jobs.some((j) => j.id === cand.job) && !(cand.job === "lead" && leadElsewhere(-1)) ? cand.job : undefined;
    const jobId = own ?? (jobs.some((j) => j.id === "dev") ? "dev" : (jobs[0]?.id ?? "dev"));
    setSlots([...slots(), withBadge({ personaId: cand.id, jobId })]);
    touch();
  };
  // 어느 슬롯이든 뺄 수 있다 (P89) — 돌고 있는 세션이 끝나면 적용 전 확인창이 알린다
  const removeSlot = (i: number) => {
    setSlots(slots().filter((_, j) => j !== i));
    touch();
  };

  // 캐스팅 변경 (U3) — 순환 클릭 대신 팝오버 목록에서 직접 고른다.
  // 이 편성의 다른 슬롯에 선 페르소나는 비활성, 다른 워크스페이스에서 활동 중이면 표시만 한다.
  const [castMenu, setCastMenu] = createSignal<{ x: number; y: number; slot: number } | undefined>(undefined);
  // 다른 워크스페이스에서 돌고 있는 페르소나 → 그 워크스페이스 이름 (메뉴와 카드 칩 U171이 같이 쓴다)
  const activeWs = () => {
    tick();
    return new Map(
      backend
        .listSessions()
        .filter((sess) => sess.workspaceId !== props.wsId && sess.personaId)
        .map((sess) => [sess.personaId, backend.listWorkspaces().find((w) => w.id === sess.workspaceId)?.name ?? "?"]),
    );
  };
  const personaGroups = (i: number): MenuGroup[] => {
    const usedElsewhere = new Set(slots().flatMap((sl, j) => (j === i ? [] : [sl.personaId])));
    const active = activeWs();
    // 같은 이름이 둘 이상이면 직함(없으면 id 끝)을 붙여 가른다 (U32). 기본 직무도 함께 보인다 (P79)
    const all = backend.listPersonas();
    const label = (p: (typeof all)[number]) => {
      const name = all.filter((x) => x.name === p.name).length > 1 ? `${p.name} · ${p.title?.trim() || p.id.slice(-6)}` : p.name;
      return p.job && job(p.job) ? `${name} (${jobName(job(p.job))})` : name;
    };
    return [
      all.map((p) => ({
        label: active.has(p.id) ? tf("{name} — {ws} 활동 중", { name: label(p), ws: active.get(p.id)! }) : label(p),
        checked: slots()[i].personaId === p.id,
        disabled: usedElsewhere.has(p.id),
        action: () => {
          setSlots(slots().map((sl, j) => (j === i ? { ...sl, personaId: p.id } : sl)));
          touch();
        },
      })),
    ];
  };

  // 슬롯별 직무 변경 (P1) — 툴팁이 약속하던 "추가 후 변경". 배지도 함께 바뀐다
  const [jobMenu, setJobMenu] = createSignal<{ x: number; y: number; slot: number } | undefined>(undefined);
  // 리드는 1명 (B101) — 다른 슬롯이 리드면 리드 항목은 비활성 (페르소나 메뉴와 같은 방식)
  const leadElsewhere = (i: number) => slots().some((sl, k) => k !== i && sl.jobId === "lead");
  const jobGroups = (i: number): MenuGroup[] => [
    backend.listJobs().map((j) => ({
      label: j.id === "lead" && leadElsewhere(i) ? `${jobName(j)} — ${t("리드는 1명")}` : jobName(j),
      checked: slots()[i].jobId === j.id,
      disabled: j.id === "lead" && leadElsewhere(i),
      action: () => {
        const b = badgeFor(j.id);
        setSlots(slots().map((sl, k) => (k === i ? { ...sl, jobId: j.id, badge: b.badge, badgeColor: b.color } : sl)));
        touch();
      },
    })),
  ];

  // 저장과 "편성 선택 →"(그리고 팀 편성 [기본 편성 채우기])이 같은 적용 경로를 탄다 — 기본 임무 자동 배정(FR-E-56)이 빠지지 않는다
  const apply = () => applyCastingWithDefaults(props.wsId, slots());
  const save = () => {
    apply();
    setSaved(true);
  };
  // 파괴적 적용 확인 (B69 · P35) — 세션 종료·직무 변경·자리 없음이 있으면 먼저 묻는다. 기본 포커스는 취소
  const [confirm, setConfirm] = createSignal<{ lines: string[]; then: () => void } | undefined>(undefined);
  const guarded = (then: () => void) => {
    const lines = castingConfirmLines(props.wsId, slots());
    if (lines.length === 0) then();
    else setConfirm({ lines, then });
  };
  // 첫 세션 마법사로 왔는가 (P49) — 단계 표시 · [← 실행 방식]은 그때만. 다음 화면에도 넘긴다
  const wizard = () => {
    const v = view();
    return v.kind === "casting" && !!v.wizard;
  };
  const choose = () => {
    apply();
    setView({ kind: "composition", wsId: props.wsId, wizard: wizard() || undefined });
  };

  // 남는 세션이면 지금 번호 그대로, 새 페르소나면 빈 슬롯 (0.5 시안 cjWtF 슬롯 머리 문구)
  const slotNote = (i: number, personaId: string) => {
    const n = plan()[i];
    const kept = backend.listSessions().find((s) => s.workspaceId === props.wsId && s.personaId === personaId);
    if (kept && n !== undefined && kept.slot === n) return tf("유지 · {n} 그대로", { n: slotNo(n) });
    if (n === undefined) return t("자리 없음 — 적용하면 빠집니다"); // B70
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
          : tf("빈 슬롯 · 기본 터미널은 관제에서 만듭니다 (자동 이름 {name})", { name: `${projectStem(ws()?.name ?? "")}${slotNo(n)}` }),
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
            {tf("페르소나를 {n}개 슬롯에 배정합니다. 다시 적용해도 남은 세션의 슬롯 번호는 그대로이고, 새 페르소나만 빈 슬롯에 들어갑니다", {
              n: maxSlots(),
            })}
          </div>
        </div>
        <div class="cast-head-actions">
          <Show when={wizard()}>
            <button class="btn" onClick={() => setView({ kind: "launch", wsId: props.wsId })}>
              {t("← 실행 방식")}
            </button>
          </Show>
          {/* 버튼에는 동작만 (U167) — 경로는 툴팁과 아래 ⓘ 안내에 있다 */}
          <button class="btn cast-save" classList={{ saved: saved() }} title={t(".eqmux/team.json과 team.md에 저장")} onClick={() => guarded(save)}>
            {t(saved() ? "저장됨 ✓" : "편성 저장")}
          </button>
          <button
            class="btn primary"
            onClick={() => guarded(choose)}
          >
            {t("편성 선택 →")}
          </button>
        </div>
      </div>
      <div class="screen-body cast-body">
        <Show when={wizard()}>
          <WizardSteps path="team" at={2} />
        </Show>
        <div class="cast-presets">
          <Show when={initial0.length > 0}>
            <button
              class="btn"
              classList={{ primary: preset() === "" }}
              title={t("지금 돌고 있는 편성으로 되돌립니다")}
              onClick={() => {
                setPreset("");
                setSlots(currentSlots());
                setSaved(false);
                setEdited(false);
              }}
            >
              {t("지금 편성")}
              {preset() === "" && edited() ? ` · ${t("수정됨")}` : ""}
            </button>
          </Show>
          <For each={presets()}>
            {(p) => (
              <button class="btn" classList={{ primary: preset() === p.id }} onClick={() => pickPreset(p)}>
                {t(p.name)}
                {/* 프리셋에서 벗어났다 (P89) — 누르면 프리셋 구성으로 되돌린다 */}
                {preset() === p.id && edited() ? ` · ${t("수정됨")}` : ""}
              </button>
            )}
          </For>
        </div>
        <div class="cast-grid">
          <For each={slots()}>
            {(slot, i) => {
              const pp = () => persona(slot.personaId);
              return (
                <div class="cast-slot" classList={{ "no-room": plan()[i()] === undefined }}>
                  <div class="cast-slot-head mono">
                    {/* 적용될 실제 슬롯 번호 — 남는 세션은 지금 번호, 새 페르소나는 들어갈 빈 슬롯 (0.5) */}
                    <span class="cast-slot-no">SLOT {plan()[i()] ? slotNo(plan()[i()]!) : "—"}</span>
                    <span class="muted">{slotNote(i(), slot.personaId)}</span>
                  </div>
                  <PersonaAvatar persona={pp()} />
                  <div>
                    <Identity name={pp()?.name ?? slot.personaId} title={pp()?.title} job={slot.badge} />
                    {/* 직함 (0.5) — 페르소나 직함. 슬롯 덮어쓰기는 세션 상세에서 */}
                    <Show when={!pp()?.title}>
                      <div class="cast-note">{t("직함 없음 · 역할 파일 그대로")}</div>
                    </Show>
                    {/* 다른 워크스페이스에서도 돌고 있다 (U171) — 적용하면 같은 캐릭터가 두 곳에서 돈다 */}
                    <Show when={activeWs().get(slot.personaId)}>
                      {(w) => <span class="eq-chip amber">{tf("{ws}에서 활동 중", { ws: w() })}</span>}
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
                      <span>{jobName(job(slot.jobId), `${slot.jobId} ${t("(라이브러리에 없음)")}`)}</span>
                      <Icon name="chevron-down" size={12} class="muted" />
                    </button>
                  </div>
                  <div class="cast-note">{pp() ? personaTagline(pp()!) : ""}</div>
                  <div class="cast-perm mono">
                    <span class="muted">{t("권한")}</span>
                    <span>
                      {(() => {
                        const j = job(slot.jobId);
                        return j ? permLabel(j.permissions) : t("— 직무 파일 없음 · 권한 미정");
                      })()}
                    </span>
                  </div>
                  <div class="cast-slot-actions">
                    <button class="btn" title={t("페르소나 목록에서 선택")} onClick={(e) => openMenu(e, setCastMenu, i())}>
                      {t("페르소나 변경")}
                    </button>
                    <button class="btn ghost" title={t("이 슬롯 제거")} onClick={() => removeSlot(i())}>
                      {t("제거")}
                    </button>
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

        <Show when={confirm()}>
          {(c) => (
            <ConfirmDialog
              title={t("편성을 적용할까요?")}
              body={t("적용하면 아래가 바로 일어납니다. 종료된 세션은 되돌릴 수 없습니다.")}
              info={c().lines}
              danger
              confirmLabel={t("적용")}
              onConfirm={() => {
                const go = c().then;
                setConfirm(undefined);
                go();
              }}
              onCancel={() => setConfirm(undefined)}
            />
          )}
        </Show>

        <div class="cast-info">
          <span class="launch-info">ⓘ</span>
          <span>
            {t("편성은 저장하거나 편성 선택으로 넘어갈 때 .eqmux/team.json과 team.md에 적힙니다. 직함은 페르소나 직함을 쓰고, 한 슬롯만 바꾸려면 세션 상세에서 덮어씁니다. roles/는 합성 뒤 gitignore에 들어가고, 사용자의 CLAUDE.md는 고치지 않습니다.")}
          </span>
        </div>
      </div>
    </div>
  );
}
