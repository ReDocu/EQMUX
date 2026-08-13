// 상태 표현 공통 — 주의 예산: 색은 waiting·dead 에만 (PRD G §4.2).
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { AgentStatus, Session } from "../types";
import { fmtSince } from "../types";

export function statusClass(st: AgentStatus): string {
  return `st-${st}`;
}

/** 셀/카드용 상태 문구 — waiting·dead는 경과 시간 병기 (FR-G-23) */
export function StatusLabel(props: { session: Session }) {
  const s = () => props.session;
  return (
    <span class={`mono ${statusClass(s().status)}`}>
      {s().status}
      <Show when={s().status === "busy" && s().subagents > 0}> · 서브 {s().subagents}</Show>
      <Show when={s().status === "waiting" || s().status === "dead"}> · {fmtSince(s().sinceMs)}</Show>
      <Show when={s().status === "dead" && s().exitCode !== undefined}> · exit {s().exitCode}</Show>
      <Show when={s().degraded}>
        {" "}
        <span
          class="badge"
          title="관측 저하 (FR-G-27) — 세션 레지스트리 접근 불가. 상태는 훅 + 프로세스 생존으로만 유지됩니다 (FR-D-63)"
        >
          낮은 신뢰
        </span>
      </Show>
    </span>
  );
}

export function Eyebrow(props: { children: JSX.Element }) {
  return <div class="eyebrow">{props.children}</div>;
}

export function KV(props: { k: string; v: JSX.Element; vClass?: string }) {
  return (
    <div class="kv">
      <span class="k">{props.k}</span>
      <span class={`v ${props.vClass ?? ""}`}>{props.v}</span>
    </div>
  );
}

export function PersonaDot(props: { name: string; color: string }) {
  return (
    <span class={`persona-dot ${props.color}`} aria-hidden>
      {props.name.slice(0, 1)}
    </span>
  );
}

/* ── 공용 컨텍스트 메뉴 (UI 리파인 §06) ─────────────────────────────
   규칙을 컴포넌트가 강제한다:
   - 그룹 순서는 호출자가 주되, danger 항목은 어디에 있든 마지막 그룹으로 모인다
   - 단축키 힌트는 우측 mono · 체크 토글은 좌측 · 서브메뉴는 1단까지
   - note = 비활성 캡션 — "메뉴에 없는 것 = 정책상 없는 것"을 명시하는 자리 */
export interface MenuEntry {
  label: string;
  kbd?: string;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  note?: boolean;
  sub?: MenuEntry[];
  action?: () => void;
}
export type MenuGroup = MenuEntry[];

export function ContextMenu(props: {
  x: number;
  y: number;
  header?: string;
  groups: MenuGroup[];
  onClose: () => void;
}) {
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal({ left: props.x, top: props.y });
  createEffect(() => {
    // 뷰포트 클램프 — 커서 기준으로 열되 화면 밖으로 나가지 않는다
    const { x, y } = props;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)),
    });
  });
  onMount(() => {
    // 닫기는 컴포넌트 책임 — ESC + 바깥 클릭(메뉴 자신은 mousedown 전파를 끊는다)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    const onDown = () => props.onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    });
  });

  const normal = () => props.groups.map((g) => g.filter((it) => !it.danger)).filter((g) => g.length > 0);
  const danger = () => props.groups.flat().filter((it) => it.danger);
  const run = (it: MenuEntry) => {
    if (it.disabled || it.note) return;
    it.action?.();
    props.onClose();
  };

  const item = (it: MenuEntry) =>
    it.sub ? (
      <div class="cmenu-it sub" role="menuitem">
        <Show when={it.checked !== undefined}>
          <span class="cmenu-chk">{it.checked ? "✓" : ""}</span>
        </Show>
        {it.label}
        <div class="cmenu-sub">
          <For each={it.sub}>{(s) => item(s)}</For>
        </div>
      </div>
    ) : it.note ? (
      <div class="cmenu-it note">{it.label}</div>
    ) : (
      <button class="cmenu-it" classList={{ danger: it.danger }} disabled={it.disabled} onClick={() => run(it)}>
        <Show when={it.checked !== undefined}>
          <span class="cmenu-chk">{it.checked ? "✓" : ""}</span>
        </Show>
        {it.label}
        <Show when={it.kbd}>
          <kbd>{it.kbd}</kbd>
        </Show>
      </button>
    );

  return (
    <div
      ref={el}
      class="cmenu"
      style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <Show when={props.header}>
        <div class="cmenu-h mono">{props.header}</div>
      </Show>
      <For each={normal()}>
        {(g, i) => (
          <>
            <Show when={i() > 0 || props.header}>
              <hr class="cmenu-hr" />
            </Show>
            <For each={g}>{(it) => item(it)}</For>
          </>
        )}
      </For>
      <Show when={danger().length > 0}>
        <hr class="cmenu-hr" />
        <For each={danger()}>{(it) => item(it)}</For>
      </Show>
    </div>
  );
}
