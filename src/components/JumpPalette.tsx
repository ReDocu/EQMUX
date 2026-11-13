// Jump 팔레트 (0.6 §4 · W3) — Ctrl+Shift+K(macOS ⌘⇧K)로 세션 · 워크스페이스 · 임무 · 화면 · 사이드 패널 탭으로 건너뛴다.
// 모달 레이어(pushLayer + box)라 Tab이 안에서 돌고 뒤 화면 이동 키가 막힌다. 닫으면 연 자리로 포커스를 돌린다.
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { rankItems } from "../backend/jump";
import type { JumpItem, JumpKind } from "../backend/jump";
import { backend } from "../backend/mock";
import { missionStatusText } from "../backend/missions";
import { t, tf } from "../i18n";
import { setMissionToOpen } from "../screens/Missions";
import { isSubmitEnter } from "../platform";
import { openPanel, overlay, pushLayer, scopeWorkspace, setOverlay, setSettingsCat, setView, tick, view, jumpToSession } from "../state";
import type { PanelTab } from "../state";
import { sessionName, statusText } from "../types";
import { stepIndex } from "./keynav";

const [open, setOpen] = createSignal(false);
/** 단축키 토글 — 떠 있으면 닫는다 */
export const toggleJump = (): void => void setOpen(!open());
export const jumpOpen = open;

// 사이드 패널 하위 탭 — SidePanel GROUPS와 같은 이름
const PANEL_TABS: [PanelTab, string][] = [
  ["conversation", "대화"],
  ["logs", "로그"],
  ["git", "git 패널"], // 화면 전환의 git과 이름이 같아 두 줄이 나란히 보였다 (P87)
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
    // 상태를 함께 적는다 (P87) — 종료된 세션으로 건너뛰는 것을 미리 안다
    items.push({ id: `s:${s.id}`, kind: "session", label: sessionName(s, p), sub: [ws, p?.title, statusText(s.status)].filter(Boolean).join(" · "), run: () => void jumpToSession(s.workspaceId, s.id) });
  }
  for (const w of wss) items.push({ id: `w:${w.id}`, kind: "workspace", label: w.name, sub: w.path, run: () => void setView({ kind: "workspace", id: w.id }) });
  const back = view();
  // git · 기록 · 임무는 워크스페이스 문맥이 있어야 쓸 것이 있다 — 하나도 안 열었으면 빼서 빈 화면으로 보내지 않는다
  // 워크스페이스 화면은 하위 줄에 어느 워크스페이스로 가는지 적는다 (P87) — 관제에서 열면 마지막 워크스페이스다
  const target = scope ? tf("{ws}에서", { ws: scope.name }) : undefined;
  const screens: [string, () => void, string?][] = [
    ["관제", () => void setView({ kind: "control" })],
    ...(scope
      ? ([
          ["git", () => void setView({ kind: "git", wsId: scope.id, back }), target],
          ["과거 세션 검색", () => void setView({ kind: "history", wsId: scope.id, back }), target],
          ["임무", () => void setOverlay("explorer"), target],
        ] as [string, () => void, string?][])
      : []),
    ["설정", () => void setOverlay("settings")],
    ["역할 라이브러리", () => void setOverlay("roles")],
    ["단축키", () => (setSettingsCat("keys"), void setOverlay("settings"))],
  ];
  for (const [label, run, sub] of screens) items.push({ id: `v:${label}`, kind: "screen", label: t(label), sub, run });
  for (const [tab, label] of PANEL_TABS) items.push({ id: `p:${tab}`, kind: "panel", label: t(label), run: () => openPanel(tab) });
  // 임무는 그 워크스페이스로 가서 임무 팝업을 열고 그 임무를 고른다 (B221 — 전에는 첫 임무가 열렸다).
  // 상태는 임무 화면 · 검토 화면과 같은 라벨(할 일 · 진행 중 …)로 보인다 (U184 — P87 재발)
  for (const m of backend.listMissions()) {
    const ws = wsName(m.workspaceId);
    if (!ws) continue;
    items.push({
      id: `m:${m.workspaceId}:${m.id}`,
      kind: "mission",
      label: m.name,
      sub: `${ws} · ${missionStatusText(m.status)}`,
      run: () => {
        setMissionToOpen({ wsId: m.workspaceId, id: m.id });
        setView({ kind: "workspace", id: m.workspaceId });
        setOverlay("explorer");
      },
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
    // 화면 · 세션 · 임무로 가는 항목은 도착한 자리가 포커스를 갖는다 (B245) — 연 자리(패널 탭 버튼 등)로
    // 돌려 두면 키보드로 연 검색 화면에 친 글자가 아무 데도 들어가지 않았다. 패널 탭만 연 자리로 돌린다
    const v0 = view();
    const o0 = overlay();
    setOpen(false);
    if (it.kind === "panel" && opener?.isConnected) opener.focus();
    it.run();
    // 화면이 바뀌지 않은 고르기(지금 보는 워크스페이스 · 관제)는 close()처럼 연 자리로 돌린다 (B265) — 포커스가
    // body로 빠져 터미널에 이어 친 글자가 사라졌다. setView는 같은 화면이면 지금 객체를 그대로 둔다. 세션은 페인이 갖는다
    if (it.kind !== "panel" && it.kind !== "session" && view() === v0 && overlay() === o0 && opener?.isConnected) opener.focus();
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
