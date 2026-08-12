// 페인 배치 (srpYm) — 6종 배치 선택 모달. 선택 즉시 미리보기, 적용 시 터미널 그리드에 반영.
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { PANE_LAYOUTS, paneLayout, setLayoutPickerOpen, setPaneLayout, view } from "../state";
import type { PaneLayout as PaneLayoutKey } from "../state";

function Preview(props: { mode: PaneLayoutKey }) {
  return (
    <div class={`lp-prev lp-${props.mode}`}>
      <div class="lp-cell main" />
      <div class="lp-cell" />
      <div class="lp-cell" />
      <Show when={props.mode === "grid-col" || props.mode === "grid-row"}>
        <div class="lp-cell" />
      </Show>
    </div>
  );
}

export function LayoutPicker() {
  const [pending, setPending] = createSignal<PaneLayoutKey>(paneLayout());

  const sessionCount = () => {
    const v = view();
    const wsId = v.kind === "workspace" ? v.id : undefined;
    const all = backend.listSessions();
    return wsId ? all.filter((s) => s.workspaceId === wsId).length : all.length;
  };

  const apply = () => {
    setPaneLayout(pending());
    setLayoutPickerOpen(false);
  };

  return (
    <div class="overlay" onClick={() => setLayoutPickerOpen(false)}>
      <div class="dialog lp-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="lp-head">
          <div>
            <div style={{ "font-weight": 800, "font-size": "15px" }}>페인 배치</div>
            <div class="muted" style={{ "font-size": "11px", "margin-top": "2px" }}>
              현재 워크스페이스 · {sessionCount()}개 세션 · 선택 즉시 미리보기
            </div>
          </div>
          <button class="btn ghost" onClick={() => setLayoutPickerOpen(false)}>
            ✕
          </button>
        </div>

        <div class="lp-options">
          <For each={PANE_LAYOUTS}>
            {(o) => (
              <button class="card lp-option" classList={{ selected: pending() === o.key }} onClick={() => setPending(o.key)}>
                <Preview mode={o.key} />
                <div class="lp-option-title">
                  <span style={{ "font-weight": 700, "font-size": "12px" }}>{o.name}</span>
                  <span class="badge" classList={{ blue: pending() === o.key }}>
                    {pending() === o.key ? "선택됨" : `${sessionCount()} PANES`}
                  </span>
                </div>
                <div class="muted" style={{ "font-size": "11px" }}>
                  {o.desc}
                </div>
              </button>
            )}
          </For>
        </div>

        <div class="lp-footer">
          <div>
            <div class="muted" style={{ "font-size": "11px" }}>
              적용 후 분할선을 드래그해 비율을 조정할 수 있습니다.
            </div>
            <div class="mono muted" style={{ "font-size": "10px", "margin-top": "2px" }}>
              CTRL + SHIFT + L
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button class="btn" onClick={() => setLayoutPickerOpen(false)}>
              취소
            </button>
            <button class="btn primary" onClick={apply}>
              배치 적용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
