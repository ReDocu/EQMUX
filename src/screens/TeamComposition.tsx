// 팀 편성 (nspu3) — 관계·LEAD·권한 최종 확인. 파일이 원본 · LEAD 최대 1명.
// 권한 번역 결과(permission-mode)를 시작 전에 노출한다 (FR-D-40·41).
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { setView } from "../state";
import { Eyebrow, KV } from "../components/ui";
import { translatePermissions } from "../types";

const MEMBERS = [
  {
    personaId: "kai",
    jobId: "lead",
    badge: "LEAD",
    responsibility: "전체 구조·위험·통합 판단",
    relations: ["지도 ⇢ 노엘 · 린 · 솔", "협업 — 전원"],
  },
  {
    personaId: "noel",
    jobId: "impl",
    badge: "REPORTS TO 카이",
    responsibility: "인증 모듈 구현",
    relations: ["보고 → 카이", "협업 — 린"],
  },
  {
    personaId: "lin",
    jobId: "review",
    badge: "REVIEWS 노엘",
    responsibility: "변경 검토·품질 기준",
    relations: ["리뷰 ◇ 노엘", "협업 — 노엘"],
  },
  {
    personaId: "sol",
    jobId: "verify",
    badge: "REPORTS TO 카이",
    responsibility: "테스트·증거 수집",
    relations: ["보고 → 카이", "검증 → 노엘 · 린"],
  },
];

export function TeamComposition(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const [sel, setSel] = createSignal(2); // 디자인 시안과 동일하게 린 선택
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const job = (id: string) => backend.listJobs().find((j) => j.id === id);
  const selMember = () => MEMBERS[sel()];
  const selJob = () => job(selMember().jobId)!;
  const selFlags = () => translatePermissions(selJob().permissions);

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>팀 편성 · {ws()?.name}</h1>
          <div class="sub">.eqmux/team.json 원본 · team.md 파생 · LEAD 최대 1명</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn">기본 편성 채우기</button>
          <button class="btn">역할 라이브러리</button>
          <button class="btn">편성 저장</button>
        </div>
      </div>
      <div class="screen-body comp-body">
        <div>
          <div class="conn-list-head">
            <Eyebrow>팀 슬롯과 관계</Eyebrow>
            <span class="mono muted">보고 → 지도 ⇢ 리뷰 ◇ 협업 —</span>
          </div>
          <div class="comp-grid">
            <For each={MEMBERS}>
              {(m, i) => (
                <button class="card comp-member" classList={{ selected: sel() === i() }} onClick={() => setSel(i())}>
                  <div class="cast-slot-head">
                    <span class="eyebrow">SLOT {String(i() + 1).padStart(2, "0")}</span>
                    <span class="badge" classList={{ blue: m.badge === "LEAD" }}>
                      {m.badge}
                    </span>
                  </div>
                  <div class="cast-persona">
                    <span class={`persona-dot ${persona(m.personaId)?.color}`}>
                      {persona(m.personaId)?.name.slice(0, 1)}
                    </span>
                    <div>
                      <div style={{ "font-weight": 800 }}>{persona(m.personaId)?.name}</div>
                      <div class="muted" style={{ "font-size": "11px" }}>
                        {job(m.jobId)?.name} · {m.responsibility}
                      </div>
                    </div>
                  </div>
                  <For each={m.relations}>
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
              4개 세션 시작
            </button>
          </div>
        </div>

        <div class="conn-detail">
          <Eyebrow>SELECTED · {persona(selMember().personaId)?.name}</Eyebrow>
          <div style={{ "font-size": "15px", "font-weight": 800, margin: "6px 0" }}>
            {persona(selMember().personaId)?.name} · {selJob().name}
          </div>
          <div class="card inset" style={{ padding: "4px 10px" }}>
            <KV k="write" v={String(selJob().permissions.write)} />
            <KV k="commit" v={String(selJob().permissions.commit)} />
            <KV k="push" v={String(selJob().permissions.push)} />
            <KV k="permission-mode" v={selFlags().permissionMode} />
            <Show when={selFlags().disallowedTools.length > 0}>
              <KV k="disallowed" v={selFlags().disallowedTools.join(" ")} />
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
          <button class="btn" style={{ "margin-top": "10px", width: "100%", "justify-content": "center" }}>
            변경 저장
          </button>
        </div>
      </div>
    </div>
  );
}
