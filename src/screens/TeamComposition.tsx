// 팀 편성 (nspu3) — 관계·LEAD·권한 최종 확인. 파일이 원본 · LEAD 최대 1명.
// 권한 번역 결과(permission-mode)를 시작 전에 노출한다 (FR-D-40·41).
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { setView, tick } from "../state";
import { Eyebrow, KV } from "../components/ui";
import { translatePermissions } from "../types";
import type { Session } from "../types";

export function TeamComposition(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const members = () => {
    tick();
    return backend
      .listSessions()
      .filter((s) => s.workspaceId === props.wsId)
      .sort((a, b) => a.slot - b.slot);
  };
  const [sel, setSel] = createSignal(0);
  const [saved, setSaved] = createSignal(false);
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);
  const lead = () => members().find((m) => m.slot === 1);
  const leadName = () => persona(lead()?.personaId ?? "")?.name ?? "리드";

  const badge = (m: Session) =>
    m.slot === 1 ? "LEAD" : m.jobId === "review" ? "REVIEW" : `REPORTS TO ${leadName()}`;
  const relations = (m: Session): string[] => {
    if (m.slot === 1) {
      const rest = members().filter((x) => x.slot !== 1).map((x) => persona(x.personaId)?.name);
      return [`지도 ⇢ ${rest.join(" · ") || "—"}`, "협업 — 전원"];
    }
    const rel = [`보고 → ${leadName()}`];
    if (m.jobId === "review") {
      const impls = members().filter((x) => x.jobId === "impl").map((x) => persona(x.personaId)?.name);
      if (impls.length) rel.push(`리뷰 ◇ ${impls.join(" · ")}`);
    }
    if (m.jobId === "verify") {
      const targets = members().filter((x) => x.jobId === "impl" || x.jobId === "review").map((x) => persona(x.personaId)?.name);
      if (targets.length) rel.push(`검증 → ${targets.join(" · ")}`);
    }
    return rel;
  };

  const selMember = () => members()[Math.min(sel(), members().length - 1)];
  const selJob = () => (selMember() ? job(selMember().jobId) : undefined);
  const selFlags = () => (selJob() ? translatePermissions(selJob()!.permissions) : undefined);

  const fillDefault = () => {
    backend.applyCasting(props.wsId, [
      { personaId: "kai", jobId: "lead" },
      { personaId: "noel", jobId: "impl" },
      { personaId: "lin", jobId: "review" },
      { personaId: "sol", jobId: "verify" },
    ]);
    setSaved(false);
  };

  // 관계도 SVG — 리드 상단 중앙, 나머지 하단. 보고선은 아래→위.
  const svgNodes = () => {
    const ms = members();
    const rest = ms.filter((m) => m.slot !== 1);
    const nodes: { m: Session; x: number; y: number }[] = [];
    const l = ms.find((m) => m.slot === 1);
    if (l) nodes.push({ m: l, x: 200, y: 26 });
    rest.forEach((m, i) => nodes.push({ m, x: 70 + (260 / Math.max(1, rest.length - 1)) * i, y: 104 }));
    if (rest.length === 1) nodes[nodes.length - 1].x = 200;
    return nodes;
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>팀 편성 · {ws()?.name}</h1>
          <div class="sub">.eqmux/team.json 원본 · team.md 파생 · LEAD 최대 1명</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn" onClick={fillDefault}>
            기본 편성 채우기
          </button>
          <button class="btn" onClick={() => setView({ kind: "roles" })}>
            역할 라이브러리
          </button>
          <button class="btn" onClick={() => setSaved(true)}>
            {saved() ? "저장됨 ✓" : "편성 저장"}
          </button>
        </div>
      </div>
      <div class="screen-body comp-body">
        <div>
          <div class="conn-list-head">
            <Eyebrow>팀 슬롯과 관계</Eyebrow>
            <span class="mono muted">보고 → 지도 ⇢ 리뷰 ◇ 협업 —</span>
          </div>

          <Show when={members().length > 1}>
            <div class="card" style={{ "margin-bottom": "10px" }}>
              <svg viewBox="0 0 400 130" style={{ width: "100%", display: "block" }}>
                <For each={svgNodes().filter((n) => n.m.slot !== 1)}>
                  {(n) => {
                    const l = svgNodes().find((x) => x.m.slot === 1);
                    return l ? (
                      <line x1={n.x} y1={n.y - 14} x2={l.x} y2={l.y + 14} stroke="var(--eq-line)" stroke-width="1.5" />
                    ) : null;
                  }}
                </For>
                <For each={svgNodes()}>
                  {(n) => (
                    <g>
                      <rect x={n.x - 44} y={n.y - 14} width="88" height="28" fill="var(--eq-surface-2)" stroke={n.m.slot === 1 ? "var(--eq-blue)" : "var(--eq-line)"} />
                      <text x={n.x} y={n.y + 4} text-anchor="middle" fill="var(--eq-text)" font-size="11" font-weight="700">
                        {persona(n.m.personaId)?.name} · {job(n.m.jobId)?.name}
                      </text>
                    </g>
                  )}
                </For>
              </svg>
            </div>
          </Show>

          <div class="comp-grid">
            <For each={members()}>
              {(m, i) => (
                <button class="card comp-member" classList={{ selected: sel() === i() }} onClick={() => setSel(i())}>
                  <div class="cast-slot-head">
                    <span class="eyebrow">SLOT {String(m.slot).padStart(2, "0")}</span>
                    <span class="badge" classList={{ blue: m.slot === 1 }}>
                      {badge(m)}
                    </span>
                  </div>
                  <div class="cast-persona">
                    <span class={`persona-dot ${persona(m.personaId)?.color}`}>
                      {persona(m.personaId)?.name.slice(0, 1)}
                    </span>
                    <div>
                      <div style={{ "font-weight": 800 }}>{persona(m.personaId)?.name}</div>
                      <div class="muted" style={{ "font-size": "11px" }}>
                        {job(m.jobId)?.name} · {job(m.jobId)?.responsibility}
                      </div>
                    </div>
                  </div>
                  <For each={relations(m)}>
                    {(r) => (
                      <div class="mono muted" style={{ "font-size": "11px" }}>
                        {r}
                      </div>
                    )}
                  </For>
                </button>
              )}
            </For>
          </div>
          <div class="card cast-footer" style={{ "margin-top": "12px" }}>
            <div class="muted" style={{ "font-size": "11px" }}>
              파일이 원본 · 중복 관계와 자기 참조는 저장 시 제거 · team.json/team.md는 커밋
            </div>
            <button class="btn primary" onClick={() => setView({ kind: "workspace", id: props.wsId })}>
              {members().length}개 세션 시작
            </button>
          </div>
        </div>

        <div class="conn-detail">
          <Show when={selMember()} fallback={<div class="muted">편성이 비었습니다 — 캐스팅을 먼저 하세요</div>}>
            <Eyebrow>SELECTED · {persona(selMember().personaId)?.name}</Eyebrow>
            <div style={{ "font-size": "15px", "font-weight": 800, margin: "6px 0" }}>
              {persona(selMember().personaId)?.name} · {selJob()?.name}
            </div>
            <div class="card inset" style={{ padding: "4px 10px" }}>
              <KV k="write" v={String(selJob()?.permissions.write)} />
              <KV k="commit" v={String(selJob()?.permissions.commit)} />
              <KV k="push" v={String(selJob()?.permissions.push)} />
              <KV k="permission-mode" v={selFlags()?.permissionMode ?? "—"} />
              <Show when={(selFlags()?.disallowedTools.length ?? 0) > 0}>
                <KV k="disallowed" v={selFlags()!.disallowedTools.join(" ")} />
              </Show>
            </div>
            <div class="card inset" style={{ padding: "10px", "margin-top": "10px" }}>
              <div class="mono st-waiting" style={{ "font-size": "11px", "font-weight": 700 }}>
                권한 변경은 재시작 필요
              </div>
              <div class="muted" style={{ "font-size": "11px", "margin-top": "4px" }}>
                파일은 즉시 저장되지만 실행 플래그는 프로세스 수명 동안 고정됩니다.
              </div>
            </div>
            <button class="btn" style={{ "margin-top": "10px", width: "100%", "justify-content": "center" }} onClick={() => setSaved(true)}>
              {saved() ? "저장됨 ✓" : "변경 저장"}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
