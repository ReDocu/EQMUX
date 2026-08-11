// 종료 확인 (sYRf5) — 실행 중 에이전트 목록 + 재개 가능 여부. 자동 재개하지 않는다 (FR-C-61 · C10).
import { For } from "solid-js";
import { backend } from "../backend/mock";
import { setExitOpen } from "../state";

export function ExitDialog() {
  const running = () => backend.listSessions().filter((s) => s.status !== "dead");
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const ws = (id: string) => backend.listWorkspaces().find((w) => w.id === id);

  return (
    <div class="overlay" onClick={() => setExitOpen(false)}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ "font-size": "16px", "font-weight": 800 }}>EQMUX를 종료할까요?</div>
          <div class="muted" style={{ "font-size": "12px", "margin-top": "4px" }}>
            실행 중인 에이전트 {running().length}개가 종료됩니다. 자동 재개하지 않습니다.
          </div>
        </div>
        <div class="card inset" style={{ margin: "14px 20px", padding: "8px 12px" }}>
          <span class="mono muted" style={{ "font-size": "11px" }}>
            입력 차단 → 저장소 flush → 정상 종료 신호 → 유예 후 강제 종료
          </span>
        </div>
        <div style={{ padding: "0 20px", "max-height": "260px", "overflow-y": "auto" }}>
          <For each={running()}>
            {(s) => (
              <div class="kv">
                <span>
                  <b>{persona(s.personaId)?.name}</b>{" "}
                  <span class="muted">
                    {ws(s.workspaceId)?.name} · {s.status}
                  </span>
                </span>
                <span class="mono" classList={{ "st-dead": !s.resumable, "st-busy": s.resumable }}>
                  {s.resumable ? "재개 가능" : `재개 불가 · ${s.resumeReason ?? "transcript 없음"}`}
                </span>
              </div>
            )}
          </For>
        </div>
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", padding: "16px 20px" }}>
          <button class="btn" onClick={() => setExitOpen(false)}>
            취소
          </button>
          <button class="btn danger" onClick={() => setExitOpen(false)}>
            종료
          </button>
        </div>
      </div>
    </div>
  );
}
