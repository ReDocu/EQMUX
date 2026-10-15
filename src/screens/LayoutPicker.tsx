// 페인 배치 (srpYm) — 6종 배치 선택 모달. 선택 즉시 미리보기, 적용 시 터미널 그리드에 반영.
import { createSignal, For, onCleanup, Show } from "solid-js";
import { backend } from "../backend/mock";
import { t, tf } from "../i18n";
import { PANE_LAYOUTS, paneLayout, pushLayer, setLayoutPickerOpen, setPaneLayout, view } from "../state";
import type { PaneLayout as PaneLayoutKey } from "../state";
import { Icon } from "../components/icons";

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

  let box: HTMLDivElement | undefined;
  onCleanup(pushLayer(() => setLayoutPickerOpen(false), () => box)); // ESC 닫기 (B73) · 모달 (B72·U37)

  const apply = () => {
    setPaneLayout(pending());
    setLayoutPickerOpen(false);
  };

  return (
    <div class="overlay" onClick={() => setLayoutPickerOpen(false)}>
      <div ref={box} class="dialog lp-dialog" role="dialog" aria-modal="true" aria-label={t("페인 배치")} onClick={(e) => e.stopPropagation()}>
        <div class="lp-head">
          <div>
            <div class="lp-title">{t("페인 배치")}</div>
            <div class="mono muted lp-sub">
              {tf("현재 워크스페이스 · {n}개 세션 · 선택 즉시 미리보기", { n: sessionCount() })} · Ctrl+Shift+L
            </div>
          </div>
          <button class="btn ghost" aria-label={t("닫기")} onClick={() => setLayoutPickerOpen(false)}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div class="lp-options">
          <For each={PANE_LAYOUTS}>
            {(o) => (
              <button class="card lp-option" classList={{ selected: pending() === o.key }} onClick={() => setPending(o.key)}>
                <Preview mode={o.key} />
                <div class="lp-option-title">
                  <span>{t(o.name)}</span>
                  {/* 지금 이 워크스페이스에 적용된 배치 — 고른 것(테두리)과 구별한다 */}
                  <Show when={paneLayout() === o.key}>
                    <span class="badge blue mono">{t("현재")}</span>
                  </Show>
                </div>
                <div class="mono muted lp-note">{t(o.desc)}</div>
              </button>
            )}
          </For>
        </div>

        <div class="lp-footer">
          <div class="muted lp-hint">
            {t("적용 후 분할선을 드래그해 비율을 조정할 수 있습니다 · 슬롯 번호는 배치와 무관하게 그대로입니다")}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button class="btn" onClick={() => setLayoutPickerOpen(false)}>
              {t("취소")}
            </button>
            <button class="btn primary" onClick={apply}>
              {t("적용")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
