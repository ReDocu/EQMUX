// Jump 팔레트 (0.6 §4 · W3) — Ctrl+Shift+K(macOS ⌘⇧K)로 세션 · 워크스페이스 · 임무 · 화면 · 사이드 패널 탭으로 건너뛴다.
// 모달 레이어(pushLayer + box)라 Tab이 안에서 돌고 뒤 화면 이동 키가 막힌다. 닫으면 연 자리로 포커스를 돌린다.
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { rankItems } from "../backend/jump";
import type { JumpItem, JumpKind } from "../backend/jump";
import { backend } from "../backend/mock";
import { t } from "../i18n";
import { isSubmitEnter } from "../platform";
import { openPanel, pushLayer, scopeWorkspace, setOverlay, setSettingsCat, setView, tick, view, jumpToSession } from "../state";
import type { PanelTab } from "../state";
import { sessionName } from "../types";
import { stepIndex } from "./keynav";

const [open, setOpen] = createSignal(false);
/** 단축키 토글 — 떠 있으면 닫는다 */
export const toggleJump = (): void => void setOpen(!open());
export const jumpOpen = open;

// 사이드 패널 하위 탭 — SidePanel GROUPS와 같은 이름
const PANEL_TABS: [PanelTab, string][] = [
  ["conversation", "대화"],
  ["logs", "로그"],
  ["git", "git"],
  ["files", "파일"],
  ["mdview", "문서"],
  ["server", "서버"],
  ["ports", "포트"],
  ["env", "환경변수"],
  ["browser", "브라우저"],
  ["mcp", "MCP"],
  ["plugins", "플러그인"],
  ["skills", "스킬"],
];
const KIND_LABEL: Record<JumpKind, string> = {
  session: "세션",
  workspace: "워크스페이스",
  mission: "임무",
  screen: "화면 전환",
  panel: "패널",
};

function buildItems(): JumpItem[] {
  tick();
  const wss = backend.listWorkspaces().filter((w) => w.open && !w.pathMissing);
  const wsName = (id: string) => wss.find((w) => w.id === id)?.name;
  const personas = backend.listPersonas();
  const scope = scopeWorkspace();
  const items: JumpItem[] = [];
  for (const s of backend.listSessions()) {
    const ws = wsName(s.workspaceId);
    if (!ws) continue;
    const p = personas.find((x) => x.id === s.personaId);
    items.push({ id: `s:${s.id}`, kind: "session", label: sessionName(s, p), sub: [ws, p?.title].filter(Boolean).join(" · "), run: () => void jumpToSession(s.workspaceId, s.id) });
  }
  for (const w of wss) items.push({ id: `w:${w.id}`, kind: "workspace", label: w.name, sub: w.path, run: () => void setView({ kind: "workspace", id: w.id }) });
  const back = view();
  const screens: [string, () => void][] = [
    ["관제", () => void setView({ kind: "control" })],
    ["git", () => void setView({ kind: "git", wsId: scope?.id, back })],
    ["과거 세션 검색", () => void setView({ kind: "history", wsId: scope?.id, back })],
    ["설정", () => void setOverlay("settings")],
    ["역할 라이브러리", () => void setOverlay("roles")],
    ["단축키", () => (setSettingsCat("keys"), void setOverlay("settings"))],
  ];
  if (scope) screens.splice(3, 0, ["임무", () => void setOverlay("explorer")]);
  for (const [label, run] of screens) items.push({ id: `v:${label}`, kind: "screen", label: t(label), run });
  for (const [tab, label] of PANEL_TABS) items.push({ id: `p:${tab}`, kind: "panel", label: t(label), run: () => openPanel(tab) });
  // 임무는 그 워크스페이스로 가서 임무 팝업을 연다 — 특정 임무를 골라 여는 것은 아직 없다
  for (const m of backend.listMissions()) {
    const ws = wsName(m.workspaceId);
    if (!ws) continue;
    items.push({
      id: `m:${m.workspaceId}:${m.id}`,
      kind: "mission",
      label: m.name,
      sub: `${ws} · ${m.status}`,
      run: () => (setView({ kind: "workspace", id: m.workspaceId }), void setOverlay("explorer")),
    });
  }
  return items;
}

function Palette() {
  const opener = document.activeElement as HTMLElement | null;
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const all = buildItems();
  const shown = createMemo(() => rankItems(all, query()));
  let box!: HTMLDivElement;
  let input!: HTMLInputElement;

  const close = () => {
    setOpen(false);
    if (opener?.isConnected) opener.focus();
  };
  const pick = (it: JumpItem | undefined) => {
    if (!it) return;
    close();
    it.run();
  };
  onMount(() => {
    input.focus();
    onCleanup(pushLayer(close, () => box));
  });
  const onKey = (e: KeyboardEvent) => {
    const n = shown().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(stepIndex(n, active(), e.key === "ArrowUp"));
      box.querySelector(`#jump-opt-${active()}`)?.scrollIntoView({ block: "nearest" });
    } else if (isSubmitEnter(e)) {
      e.preventDefault();
      pick(shown()[active()]);
    } else if (e.key === "Escape") {
      // 입력칸의 Esc는 원래 칸 빠져나오기라(state.ts) 여기서 바로 닫는다
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div class="overlay jump-overlay" onClick={close}>
      <div ref={box} class="dialog jump" role="dialog" aria-modal="true" aria-label={t("건너뛰기")} onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          class="jump-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="jump-list"
          aria-activedescendant={shown().length ? `jump-opt-${active()}` : undefined}
          placeholder={t("세션 · 워크스페이스 · 임무 · 화면 · 패널 이름…")}
          value={query()}
          onInput={(e) => (setQuery(e.currentTarget.value), setActive(0))}
          onKeyDown={onKey}
        />
        <div id="jump-list" class="jump-list" role="listbox" aria-label={t("건너뛸 곳")}>
          <For each={shown()} fallback={<div class="muted jump-empty">{t("맞는 곳이 없습니다")}</div>}>
            {(it, i) => (
              <div
                id={`jump-opt-${i()}`}
                class="jump-opt"
                classList={{ on: i() === active() }}
                role="option"
                aria-selected={i() === active()}
                onMouseMove={() => setActive(i())}
                onClick={() => pick(it)}
              >
                <span class="jump-kind mono">{t(KIND_LABEL[it.kind])}</span>
                <span class="jump-label">{it.label}</span>
                <Show when={it.sub}>
                  <span class="muted jump-sub">{it.sub}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="muted jump-foot mono">{t("↑↓ 고르기 · Enter 이동 · Esc 닫기")}</div>
      </div>
    </div>
  );
}

/** App이 한 번 마운트한다 — 열렸을 때만 그린다 */
export function JumpPalette() {
  return <Show when={open()}>{(_) => <Palette />}</Show>;
}
