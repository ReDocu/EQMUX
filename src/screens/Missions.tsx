// 임무 배정 (화면 #8) — 임무 목록 · 생성 · 세션 배정. 임무 = 브랜치 + 목표 (E12 — 연결하되 강제 아님).
// Tauri에서는 .eqmux/missions/*.md 실파일이 원본이다 (FR-E-51) — 화면은 브리지를 통해서만 쓴다.
import { createSignal, For, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import { createMission, cycleMissionStatus, refreshMissions, toggleAssign } from "../backend/missions";
import { setView, tick } from "../state";
import { Eyebrow, PersonaDot } from "../components/ui";

export function Missions(props: { wsId: string }) {
  onMount(() => void refreshMissions(props.wsId));
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const missions = () => {
    tick();
    return backend.listMissions().filter((m) => m.workspaceId === props.wsId);
  };
  const sessions = () => {
    tick();
    return backend.listSessions().filter((s) => s.workspaceId === props.wsId);
  };
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);

  const [name, setName] = createSignal("");
  const [goal, setGoal] = createSignal("");
  const [branch, setBranch] = createSignal("");

  const create = () => {
    if (!name().trim()) return;
    void createMission(props.wsId, name().trim(), goal().trim(), branch().trim() || undefined);
    setName("");
    setGoal("");
    setBranch("");
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>임무 배정 · {ws()?.name}</h1>
          <div class="sub">.eqmux/missions/*.md 가 원본 · 상태 뱃지 클릭 = 단계 전환 · 세션 클릭 = 배정 토글</div>
        </div>
        <button class="btn" onClick={() => setView({ kind: "workspace", id: props.wsId })}>
          ← 컨트롤 센터
        </button>
      </div>
      <div class="screen-body conn-body">
        <div>
          <Eyebrow>임무 · {missions().length}</Eyebrow>
          <For each={missions()}>
            {(m) => (
              <div class="card" style={{ padding: "12px", "margin-top": "8px" }}>
                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                  <span style={{ "font-weight": 700 }}>{m.name}</span>
                  <button
                    class="badge"
                    classList={{ blue: m.status === "in-progress", purple: m.status === "in-review", green: m.status === "done" }}
                    style={{ cursor: "pointer" }}
                    title="클릭하면 다음 단계로"
                    onClick={() => void cycleMissionStatus(props.wsId, m.id)}
                  >
                    {m.status.toUpperCase()}
                  </button>
                  <span class="mono muted" style={{ "margin-left": "auto", "font-size": "10px" }}>
                    {m.branch ?? "브랜치 미연결"}
                  </span>
                </div>
                <div class="muted" style={{ "font-size": "12px", margin: "6px 0" }}>
                  {m.goal}
                </div>
                <Show when={m.outputs.length > 0}>
                  <div class="mono muted" style={{ "font-size": "11px", "margin-bottom": "6px" }}>
                    산출물 · {m.outputs.join(" · ")}
                  </div>
                </Show>
                <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                  <For each={sessions()}>
                    {(s) => (
                      <button
                        class="btn ghost assign-chip"
                        classList={{ assigned: m.assigned.includes(s.id) }}
                        onClick={() => void toggleAssign(props.wsId, m.id, s.id)}
                      >
                        <PersonaDot name={persona(s.personaId)?.name ?? "?"} color={persona(s.personaId)?.color ?? "blue"} />
                        {persona(s.personaId)?.name}
                        {m.assigned.includes(s.id) ? " ✓" : ""}
                      </button>
                    )}
                  </For>
                  <Show when={sessions().length === 0}>
                    <span class="muted" style={{ "font-size": "11px" }}>
                      세션 없음 — 캐스팅을 먼저 하세요
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="conn-detail">
          <Eyebrow>새 임무</Eyebrow>
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "8px" }}>
            <input placeholder="임무 이름" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            <textarea rows={3} placeholder="목표 — 완료 조건을 측정 가능하게" value={goal()} onInput={(e) => setGoal(e.currentTarget.value)} />
            <input
              placeholder="브랜치 (선택 · E12)"
              class="mono"
              value={branch()}
              onInput={(e) => setBranch(e.currentTarget.value)}
            />
            <button class="btn primary" onClick={create} disabled={!name().trim()}>
              임무 생성
            </button>
            <div class="card inset" style={{ padding: "10px" }}>
              <div class="muted" style={{ "font-size": "11px" }}>
                생성하면 .eqmux/missions/&lt;id&gt;.md 파일이 만들어지고 DB는 캐시로 따라갑니다. 불일치 시 파일이
                이깁니다 (불변 규칙 4).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
