// 상태 표현 공통 — 주의 예산: 색은 waiting·dead 에만 (PRD G §4.2).
import { Show } from "solid-js";
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
