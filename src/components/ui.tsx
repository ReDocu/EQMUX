// 상태 표현 공통 — 주의 예산: 색은 waiting·dead 에만 (PRD G §4.2).
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { t, tf } from "../i18n";
import type { AgentCliId, AgentStatus, Session } from "../types";
import { AGENT_CLI_LABEL, fmtSince, nameBesideNo, slotNo } from "../types";

export function statusClass(st: AgentStatus): string {
  return `st-${st}`;
}

/** 셀/카드용 상태 문구 — waiting·dead는 경과 시간 병기 (FR-G-23) */
export function StatusLabel(props: { session: Session }) {
  const s = () => props.session;
  return (
    <span class={`mono ${statusClass(s().status)}`}>
      {s().status}
      <Show when={s().status === "busy" && s().subagents > 0}> · {t("서브")} {s().subagents}</Show>
      <Show when={s().status === "waiting" || s().status === "dead"}> · {fmtSince(s().sinceMs)}</Show>
      <Show when={s().status === "dead" && s().exitCode !== undefined}> · exit {s().exitCode}</Show>
      <Show when={s().degraded}>
        {" "}
        <span
          class="badge"
          title={t("관측 저하 — 세션 레지스트리 접근 불가. 상태는 훅 + 프로세스 생존으로만 유지됩니다")}
        >
          {t("낮은 신뢰")}
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
      <div class="cmenu-it sub" role="menuitem" tabIndex={0} aria-haspopup="menu">
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

/* ── 0.5 공통 부품 (기획서 §UX 기반 › 공통 부품) ───────────────────── */

/** 화면 아래 한 줄 토스트, 4초 — 사람이 한 동작의 실패·거부만. 벨(세션이 사람을 부름)과 섞지 않는다.
 *  호스트 컴포넌트 없이 어디서든 부를 수 있게 DOM에 직접 붙인다 */
export function notify(msg: string): void {
  let host = document.getElementById("eq-toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "eq-toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "eq-toast";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/** 되돌릴 수 없는 동작 확인창 — 제목에 대상 이름, 본문에 되돌릴 수 있는지, 위험 버튼은 동사.
 *  기본 포커스는 취소이고 Enter·Esc 모두 취소다 (위험 버튼에 탭으로 옮겨 누른 Enter만 실행) */
export function ConfirmDialog(props: {
  title: string;
  body: JSX.Element;
  /** 정보 상자 — 대상의 id·상태처럼 확인에 필요한 사실 몇 줄 (시안 Confirm Info) */
  info?: string[];
  danger?: boolean;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  let cancelBtn!: HTMLButtonElement;
  let okBtn!: HTMLButtonElement;
  onMount(() => {
    cancelBtn.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "Enter" && document.activeElement !== okBtn)) {
        e.preventDefault();
        e.stopPropagation();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });
  return (
    <div class="overlay" onClick={(e) => (e.stopPropagation(), props.onCancel())}>
      <div
        class="dialog eq-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="eq-confirm-t">{props.title}</div>
        <div class="eq-confirm-b">{props.body}</div>
        <Show when={props.info?.length}>
          <div class="eq-confirm-info mono">
            <For each={props.info}>{(l) => <div>{l}</div>}</For>
          </div>
        </Show>
        <div class="eq-confirm-f">
          <button ref={cancelBtn} class="btn" onClick={() => props.onCancel()}>
            {props.cancelLabel ?? t("취소")}
          </button>
          <button
            ref={okBtn}
            class={`btn ${props.danger ? "danger" : "primary"}`}
            disabled={props.busy}
            onClick={() => props.onConfirm()}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface SegItem<T extends string> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

/** 2~3개 중 하나 — 다른 화면으로 바꾸는 데만 쓴다. 목록 거르기는 필터 칩 */
export function Segmented<T extends string>(props: {
  items: SegItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div class="eq-seg" role="radiogroup" aria-label={props.label}>
      <For each={props.items}>
        {(it) => (
          <button
            class="eq-seg-it"
            classList={{ on: it.value === props.value }}
            role="radio"
            aria-checked={it.value === props.value}
            title={it.title}
            disabled={it.disabled}
            onClick={() => it.value !== props.value && props.onChange(it.value)}
          >
            {it.label}
          </button>
        )}
      </For>
    </div>
  );
}

/** 주의 단계 (§주의 단계) — 색은 행동(amber·red)·확인(blue)에만, 정보는 색 없음 */
export type ChipTone = "amber" | "red" | "blue" | "info";

/** 칩 — 글자 + 선택적 동작 버튼. 칩 자체는 span이고 동작은 형제 버튼이라 헤더 안에서도 탭으로 닿는다 */
export function Chip(props: {
  tone?: ChipTone;
  text: string;
  short?: string; // 좁은 페인(8슬롯)에서 대신 보일 짧은 글자 — 시안 T1sVdJ
  title?: string;
  action?: { label: string; onClick: () => void; title?: string; disabled?: boolean };
  onClick?: () => void; // 칩 글자 자체가 동작일 때 (+N 펼치기 등)
}) {
  const tone = () => props.tone ?? "info";
  return (
    <span class={`eq-chip ${tone()}`} title={props.title}>
      <Show when={props.onClick} fallback={<span class="eq-chip-tx">{chipText(props)}</span>}>
        <button class="eq-chip-tx" onClick={(e) => (e.stopPropagation(), props.onClick!())}>
          {chipText(props)}
        </button>
      </Show>
      <Show when={props.action}>
        {(a) => (
          <button
            class="eq-chip-act"
            title={a().title}
            disabled={a().disabled}
            onClick={(e) => (e.stopPropagation(), a().onClick())}
          >
            {a().label}
          </button>
        )}
      </Show>
    </span>
  );
}

const chipText = (p: { text: string; short?: string }) => (
  <>
    <span class="eq-chip-full">{p.text}</span>
    <Show when={p.short}>
      <span class="eq-chip-short">{p.short}</span>
    </Show>
  </>
);

/** 정체성 — `번호 이름 · 직함 엔진`. 좁으면(compact) 직함을 접고 툴팁에 남긴다.
 *  persona는 세션 이름과 다를 때만 괄호로 붙인다 */
export function Identity(props: {
  slot?: number;
  /** 번호 칸 글자 — 없으면 슬롯 번호. Claude Code 세션 이름 끝 조각을 줄 때 쓴다 (paneNo) */
  no?: string;
  name: string;
  persona?: string;
  title?: string;
  cli?: AgentCliId;
  job?: string; // 직무 배지 글자 (LEAD · DEV …) — 있을 때만
  compact?: boolean;
}) {
  const showPersona = () => !!props.persona && props.persona !== props.name;
  const noText = () => props.no ?? slotNo(props.slot ?? 0);
  const tip = () =>
    [
      props.slot !== undefined ? noText() : "",
      props.slot !== undefined && noText() !== slotNo(props.slot) ? `(${t("슬롯")} ${slotNo(props.slot)})` : "",
      props.name,
      showPersona() ? `(${props.persona})` : "",
      props.title ? `· ${props.title}` : "",
      props.cli ? `· ${AGENT_CLI_LABEL[props.cli]}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <span class="eq-id" classList={{ compact: props.compact }} title={tip()}>
      <Show when={props.slot !== undefined}>
        <span class="eq-id-no mono">{noText()}</span>
      </Show>
      <span class="eq-id-nm">
        {props.slot !== undefined ? nameBesideNo(props.slot, props.name) : props.name}
        <Show when={showPersona()}> ({props.persona})</Show>
      </span>
      <Show when={props.title}>
        <span class="eq-id-ti">· {props.title}</span>
      </Show>
      {/* 엔진 — Claude ✦ · Codex >_ (시안 sparkles · terminal 아이콘) */}
      <Show when={props.cli}>
        <span class="eq-id-cli mono" aria-label={AGENT_CLI_LABEL[props.cli!]}>
          {props.cli === "codex" ? ">_" : "✦"}
        </span>
      </Show>
      <Show when={props.job}>
        <span class="eq-id-job mono">{props.job}</span>
      </Show>
    </span>
  );
}

/** 입력 칸 아래 — 검증 이유(있으면 빨강) 또는 도움말, 오른쪽에 글자 수. 자르지 않고 maxLength로 막는다 */
export function FieldHint(props: { error?: string; hint?: string; count?: number; max?: number }) {
  return (
    <div class="eq-fh" classList={{ err: !!props.error }}>
      <span class="eq-fh-m">{props.error || props.hint || ""}</span>
      <Show when={props.max !== undefined}>
        <span class="eq-fh-c mono">
          {props.count ?? 0}/{props.max}
        </span>
      </Show>
    </div>
  );
}

/** 세션 중지 확인 (BR-08) — 대시보드·페인 메뉴·세션 상세가 같은 문구를 쓴다 */
export function StopConfirm(props: {
  session: Session;
  name: string;
  openHandoff?: boolean; // 열린 handoff·ask가 있으면 정보 상자에 한 줄
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 시안 TzzVT — 제목은 "번호 이름 세션을 중지할까요?", 본문은 무엇이 끝나고 무엇이 남는지, 정보 상자는 사실
  const s = () => props.session;
  const engine = () => (s().personaId ? AGENT_CLI_LABEL[s().cli ?? "claude"] : (s().agent ?? t("셸")));
  return (
    <ConfirmDialog
      title={tf("{no} {name} 세션을 중지할까요?", { no: slotNo(s().slot), name: props.name })}
      body={tf(
        s().resumable
          ? "실행 중인 {engine} 프로세스가 즉시 종료됩니다. 대화 기록과 슬롯은 남고, 이 세션은 재개할 수 있습니다."
          : "실행 중인 {engine} 프로세스가 즉시 종료됩니다. 대화 기록과 슬롯은 남지만, 이 세션은 재개할 수 없습니다.",
        { engine: engine() },
      )}
      info={[
        `${t("세션")}  ${s().id} · ${t("슬롯")} ${slotNo(s().slot)}`,
        `${t("상태")}  ${s().status}${s().status === "waiting" && s().waitingFor ? ` · ${t("승인 대기 중")} (${t(s().waitingFor!)})` : ""}`,
        ...(props.openHandoff ? [`${t("열린 handoff")}  ${t("있음 — 중지해도 원장에 남는다")}`] : []),
      ]}
      danger
      confirmLabel={t("중지")}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  );
}
