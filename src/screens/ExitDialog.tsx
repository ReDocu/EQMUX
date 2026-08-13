// 종료 확인 (sYRf5) — 실행 중 에이전트 목록 + 재개 가능 여부. 자동 재개하지 않는다 (FR-C-61 · C10).
// 종료를 누르면 실제 시퀀스가 돈다 (FR-C-62·63): 입력 차단(이 다이얼로그) → flush → 신호 → 유예 → 종료.
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { performShutdown } from "../backend/shutdown";
import type { ShutdownPhase } from "../backend/shutdown";
import { setExitOpen } from "../state";

const PHASE_TEXT: Record<ShutdownPhase, string> = {
  flush: "저장소 flush 중…",
  "flush-late": "flush가 2초를 넘겼습니다 — 계속 진행합니다 (FR-C-63)",
  closing: "정상 종료 신호 → 유예 후 프로세스 트리 종료…",
};

export function ExitDialog() {
  const running = () => backend.listSessions().filter((s) => s.status !== "dead");
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const ws = (id: string) => backend.listWorkspaces().find((w) => w.id === id);

  const [phase, setPhase] = createSignal<ShutdownPhase | undefined>(undefined);
  const busy = () => phase() !== undefined;

  const doExit = () => {
    if (!isTauri()) {
      setExitOpen(false); // 브라우저 dev — 실종료 없음
      return;
    }
    void performShutdown(setPhase); // 앱이 꺼지므로 반환되지 않는 것이 정상
  };

  return (
    <div class="overlay" onClick={() => !busy() && setExitOpen(false)}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ "font-size": "16px", "font-weight": 800 }}>EQMUX를 종료할까요?</div>
          <div class="muted" style={{ "font-size": "12px", "margin-top": "4px" }}>
            실행 중인 세션 {running().length}개가 종료됩니다. 자동 재개하지 않습니다.
          </div>
        </div>
        <div class="card inset" style={{ margin: "14px 20px", padding: "8px 12px" }}>
          <span class="mono" classList={{ muted: !busy(), "st-waiting": busy() }} style={{ "font-size": "11px" }}>
            {busy() ? PHASE_TEXT[phase()!] : "입력 차단 → 저장소 flush → 정상 종료 신호 → 유예 후 트리 종료 (Job Object)"}
          </span>
        </div>
        <div style={{ padding: "0 20px", "max-height": "260px", "overflow-y": "auto" }}>
          <For each={running()}>
            {(s) => (
              <div class="kv">
                <span>
                  <b>{persona(s.personaId)?.name ?? "기본 터미널"}</b>{" "}
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
          <Show when={running().length === 0}>
            <div class="muted" style={{ "font-size": "12px" }}>
              실행 중인 세션이 없습니다 — 바로 종료합니다.
            </div>
          </Show>
        </div>
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", padding: "16px 20px" }}>
          <button class="btn" disabled={busy()} onClick={() => setExitOpen(false)}>
            취소
          </button>
          <button class="btn danger" disabled={busy()} onClick={doExit}>
            {busy() ? "종료 중…" : "종료"}
          </button>
        </div>
      </div>
    </div>
  );
}
