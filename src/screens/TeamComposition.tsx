// 팀 편성 (0.5 시안 C9ljT) — 팀 관계 표(team.md와 같은 열) · 관계 카드 · 프리셋 레일. 파일이 원본 · LEAD 최대 1명.
// 편성은 바뀔 때마다 team.json·team.md로 자동 저장된다(startTeamSync) — 저장 버튼은 없다 (BR-10).
// 권한 번역 결과(permission-mode)는 권한 칸 툴팁에 남긴다 (FR-D-40·41).
import { createResource, For, Show } from "solid-js";
import { listPresets } from "../backend/library";
import type { CastingPreset } from "../backend/library";
import { backend } from "../backend/mock";
import { maxSlots } from "../backend/settings";
import { t, tf } from "../i18n";
import { setView, tick } from "../state";
import { Icon } from "../components/icons";
import { AGENT_CLI_LABEL, cliOf, effectiveTitle, sessionName, slotNo, translatePermissions } from "../types";
import type { ConversationMessage, Session } from "../types";

// 브라우저 dev 폴백 — Tauri에서는 presets/*.json 실측이 대체한다 (팀 캐스팅과 같은 시드 구성)
const FALLBACK_PRESET: CastingPreset = { id: "standard", name: "표준", jobs: ["lead", "dev", "dev", "qa"] };
const MSG_TYPES: ConversationMessage["type"][] = ["handoff", "ask", "report", "review", "escalate"];

export function TeamComposition(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const members = () => {
    tick();
    return backend
      .listSessions()
      .filter((s) => s.workspaceId === props.wsId)
      .sort((a, b) => a.slot - b.slot);
  };
  const [presets] = createResource(async () => {
    const list = await listPresets();
    return list.length > 0 ? list : [FALLBACK_PRESET];
  });
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);
  const nameOf = (s: Session) => sessionName(s, persona(s.personaId));
  const roleMembers = () => members().filter((m) => m.personaId);
  // 리드 = 리드 직무 세션. 없으면 첫 역할 세션 (슬롯 1이 기본 터미널일 수 있다)
  const lead = () => roleMembers().find((m) => m.jobId === "lead") ?? roleMembers()[0];

  const permsOf = (s: Session) => s.permOverride ?? job(s.jobId)?.permissions;
  const permText = (s: Session) => {
    const p = permsOf(s);
    if (!s.personaId || !p) return "—";
    return [p.write ? "write" : "read", p.commit ? "commit" : undefined, p.push ? "push" : "no-push"]
      .filter(Boolean)
      .join(" · ");
  };
  const permTip = (s: Session) => {
    const p = permsOf(s);
    if (!s.personaId || !p) return undefined;
    const f = translatePermissions(p);
    return `permission-mode ${f.permissionMode}${f.disallowedTools.length ? ` · disallowed ${f.disallowedTools.join(" ")}` : ""}`;
  };
  const engineOf = (s: Session) => (s.personaId ? AGENT_CLI_LABEL[cliOf(s)] : s.shell);

  // 관계 카드 — 리드 ↔ 팀원 보고선. 숫자는 원장(대화 기록)에서 센 값만 쓴다
  const counts = (from: string, to: string[]) => {
    tick();
    const msgs = backend
      .listMessages()
      .filter((m) => (m.workspaceId === undefined || m.workspaceId === props.wsId) && m.from === from && to.includes(m.to));
    const parts = MSG_TYPES.map((type) => {
      const of = msgs.filter((m) => m.type === type);
      if (of.length === 0) return undefined;
      return `${type} ${of.length}${type === "report" && of.some((m) => m.done) ? " (✓ done)" : ""}`;
    }).filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : t("주고받은 메시지 없음");
  };
  const relations = () => {
    const l = lead();
    if (!l) return [];
    const rest = roleMembers().filter((m) => m.id !== l.id);
    if (rest.length === 0) return [];
    return [
      { pair: `${nameOf(l)} → ${rest.map(nameOf).join(" · ")}`, note: counts(l.id, rest.map((m) => m.id)) },
      ...rest.map((m) => ({ pair: `${nameOf(m)} → ${nameOf(l)}`, note: counts(m.id, [l.id]) })),
    ];
  };

  // 프리셋 요약 — "리드 · 개발 2 · QA" (직무 이름은 라이브러리 실데이터)
  const presetDesc = (p: CastingPreset) => {
    const order: string[] = [];
    const n = new Map<string, number>();
    for (const j of p.jobs) {
      if (!n.has(j)) order.push(j);
      n.set(j, (n.get(j) ?? 0) + 1);
    }
    return order.map((j) => `${job(j)?.name ?? j}${n.get(j)! > 1 ? ` ${n.get(j)}` : ""}`).join(" · ");
  };

  // 기본 편성 = 첫 프리셋(presets/*.json 실측)의 직무 구성 + 라이브러리 페르소나 순서대로 중복 없이.
  // 팀 캐스팅의 프리셋 채우기와 같은 규칙이다. 프리셋이 없으면(브라우저 dev) 표준 구성을 쓴다
  const fillDefault = async () => {
    const jobs = (await listPresets())[0]?.jobs ?? FALLBACK_PRESET.jobs;
    const known = new Set(backend.listJobs().map((j) => j.id));
    const personas = backend.listPersonas();
    const slots = jobs
      .filter((j) => known.has(j))
      .slice(0, Math.min(maxSlots(), personas.length))
      .map((jobId, i) => ({ personaId: personas[i].id, jobId }));
    if (slots.length > 0) backend.applyCasting(props.wsId, slots);
  };

  return (
    <div class="screen tcmp">
      <div class="screen-head">
        <div>
          <h1>
            {t("팀 편성")} · {ws()?.name}
          </h1>
          <div class="sub mono">{t("편성은 바뀔 때마다 .eqmux/team.json · team.md에 저장됩니다")}</div>
        </div>
        <div class="tcmp-actions">
          {/* 편성은 바뀔 때마다 team.json·team.md로 자동 저장된다 (startTeamSync) — 저장 버튼은 하는 일이 없었다 (BR-10) */}
          <span class="tcmp-autosave mono">{t("자동 저장됨")}</span>
          <button class="btn" onClick={() => void fillDefault()}>
            <Icon name="terminal" size={12} />
            {tf("기본 편성 채우기 ({name} 프리셋)", { name: presets()?.[0]?.name ?? FALLBACK_PRESET.name })}
          </button>
          <button class="btn primary" onClick={() => setView({ kind: "workspace", id: props.wsId })}>
            <Icon name="arrow-right" size={12} />
            {t("관제 화면으로")}
          </button>
        </div>
      </div>

      <div class="screen-body tcmp-main">
        <div class="card tcmp-board">
          <div class="tcmp-title">{t("팀 관계 표 (team.md 그대로)")}</div>
          <Show when={members().length > 0} fallback={<div class="muted">{t("편성이 비었습니다 — 캐스팅을 먼저 하세요")}</div>}>
            <div class="tcmp-table">
              <div class="tcmp-row head mono">
                <span>{t("슬롯")}</span>
                <span>{t("세션 이름")}</span>
                <span>{t("직함")}</span>
                <span>{t("직무")}</span>
                <span>{t("권한")}</span>
                <span>{t("엔진")}</span>
              </div>
              <For each={members()}>
                {(m) => (
                  <div class="tcmp-row">
                    <span class="mono">{slotNo(m.slot)}</span>
                    <span>{nameOf(m)}</span>
                    <span>{effectiveTitle(m, persona(m.personaId)) ?? "—"}</span>
                    <span>{m.personaId ? (job(m.jobId)?.name ?? m.jobId) : t("기본 터미널")}</span>
                    <span class="muted" title={permTip(m)}>
                      {permText(m)}
                    </span>
                    <span class="mono">{engineOf(m)}</span>
                  </div>
                )}
              </For>
            </div>
            <div class="tcmp-note mono">{t("기본 터미널 이름은 team.json이 아니라 이 기기의 앱 데이터에 남습니다 (커밋 대상 아님)")}</div>
            <Show when={relations().length > 0}>
              <div class="tcmp-rels">
                <For each={relations()}>
                  {(r) => (
                    <div class="tcmp-rel">
                      <div class="mono tcmp-rel-pair">{r.pair}</div>
                      <div class="mono muted tcmp-rel-note">{r.note}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        <div class="card tcmp-rail">
          <div class="tcmp-title">{t("프리셋 · 라이브러리 실데이터")}</div>
          <For each={presets() ?? []}>
            {(p, i) => (
              <div class="tcmp-preset" classList={{ on: i() === 0 }}>
                <div class="tcmp-preset-name">{p.name}</div>
                <div class="muted tcmp-preset-desc">{presetDesc(p)}</div>
              </div>
            )}
          </For>
          <div class="tcmp-files">
            <div class="kv">
              <span class="k mono">.eqmux/team.json</span>
              <span class="v mono">{tf("슬롯 {n}", { n: members().length })}</span>
            </div>
            <div class="kv">
              <span class="k mono">.eqmux/team.md</span>
              <span class="v mono">{t("team.json에서 파생")}</span>
            </div>
            <div class="kv">
              <span class="k mono">.eqmux/roles/</span>
              <span class="v mono">{t("세션마다 합성")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
