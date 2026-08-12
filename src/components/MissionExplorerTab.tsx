// 임무 · 파일 탐색기 패널 (ehpqx) — 현재 터미널과 연동된 .eqmux 탐색기 + 임무 파일 미리보기.
// 파일이 원본(FILE SOURCE OF TRUTH)이라는 계약을 그대로 보여준다.
import { createSignal, For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { selectedSession, setPanelTab, setView } from "../state";

interface TreeNode {
  name: string;
  depth: number;
  kind: "folder" | "folder-open" | "json" | "md" | "ignore";
  missionId?: string;
}

const TREE: TreeNode[] = [
  { name: "Academy", depth: 0, kind: "folder-open" },
  { name: "src", depth: 1, kind: "folder" },
  { name: ".eqmux", depth: 1, kind: "folder-open" },
  { name: "team.json", depth: 2, kind: "json" },
  { name: "team.md", depth: 2, kind: "md" },
  { name: "roles", depth: 2, kind: "folder" },
  { name: "missions", depth: 2, kind: "folder-open" },
  { name: "auth-refactor.md", depth: 3, kind: "md", missionId: "auth-refactor" },
  { name: "payment-hardening.md", depth: 3, kind: "md" },
  { name: "release-checklist.md", depth: 3, kind: "md" },
  { name: ".gitignore", depth: 1, kind: "ignore" },
  { name: "README.md", depth: 1, kind: "md" },
];

const ICONS: Record<TreeNode["kind"], string> = {
  folder: "▸",
  "folder-open": "▾",
  json: "{}",
  md: "≡",
  ignore: "−",
};

export function MissionExplorerTab() {
  const [selected, setSelected] = createSignal("auth-refactor.md");
  const [query, setQuery] = createSignal("");

  const session = () => {
    const all = backend.listSessions();
    return all.find((s) => s.id === selectedSession()) ?? all[0];
  };
  const persona = () => backend.listPersonas().find((p) => p.id === session()?.personaId);
  const job = () => backend.listJobs().find((j) => j.id === session()?.jobId);
  const mission = () => backend.listMissions().find((m) => m.id === "auth-refactor");

  const tree = () => TREE.filter((n) => !query().trim() || n.name.includes(query().trim()));
  const isMissionFile = () => selected() === "auth-refactor.md";

  const sendBrief = () => {
    backend.sendMessage(persona()?.name ?? "카이", "@all", "handoff", `브리프 전달 · .eqmux/missions/${selected()}`);
    setPanelTab("conversation");
  };

  return (
    <div class="msnp">
      <div class="panel-head-row">
        <span class="panel-title">임무 · 파일 탐색기</span>
        <span class="mono muted" style={{ "font-size": "9px", "letter-spacing": "0.06em" }}>
          CURRENT TERMINAL LINKED
        </span>
      </div>

      <div class="card inset msnp-terminal">
        <span class="msnp-status-dot" />
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ "font-weight": 700, "font-size": "11px" }}>
            {persona()?.name ?? "—"} · {job()?.name ?? "—"}
          </div>
          <div class="mono muted" style={{ "font-size": "10px" }}>
            {session()?.cwd ?? "—"}
          </div>
        </div>
        <span class="badge blue mono">⎇ {mission()?.branch ?? "main"}</span>
      </div>

      <div class="msnp-content">
        <div class="msnp-tree">
          <input
            class="panel-search mono"
            placeholder="파일 검색"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <div class="msnp-tree-rows">
            <For each={tree()}>
              {(n) => (
                <button
                  class="msnp-tree-row mono"
                  classList={{ selected: selected() === n.name, folder: n.kind.startsWith("folder") }}
                  style={{ "padding-left": `${8 + n.depth * 12}px` }}
                  onClick={() => !n.kind.startsWith("folder") && setSelected(n.name)}
                >
                  <span class="msnp-tree-icon">{ICONS[n.kind]}</span>
                  {n.name}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="msnp-preview card inset">
          <div class="msnp-preview-head">
            <div style={{ "min-width": 0 }}>
              <div class="mono" style={{ "font-weight": 700, "font-size": "11px" }}>
                {selected()}
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                {isMissionFile() || selected().includes("hardening") || selected().includes("checklist")
                  ? ".eqmux/missions/"
                  : selected().startsWith("team")
                    ? ".eqmux/"
                    : "./"}
              </div>
            </div>
            <button class="btn ghost" title="편집기로 열기 (목)" style={{ padding: "2px 6px" }}>
              ✎
            </button>
          </div>

          <Show
            when={isMissionFile() && mission()}
            fallback={
              <div class="muted" style={{ padding: "14px 10px", "font-size": "11px" }}>
                이 파일의 임무 미리보기가 없습니다. 임무 파일(.eqmux/missions/*.md)을 선택하면 frontmatter와
                본문이 표시됩니다.
              </div>
            }
          >
            {(m) => (
              <div class="msnp-doc">
                <div class="msnp-source-notice mono">✓ FILE SOURCE OF TRUTH</div>
                <div class="msnp-frontmatter mono">
                  <div class="kv">
                    <span class="k">status</span>
                    <span class="v st-waiting">{m().status}</span>
                  </div>
                  <div class="kv">
                    <span class="k">branch</span>
                    <span class="v">{m().branch ?? "—"}</span>
                  </div>
                  <div class="kv">
                    <span class="k">assigned</span>
                    <span class="v">noel, lin</span>
                  </div>
                  <div class="kv">
                    <span class="k">updated</span>
                    <span class="v">2026-08-11 10:42</span>
                  </div>
                </div>
                <div class="msnp-md">
                  <div class="msnp-md-h1"># {m().name}</div>
                  <div class="msnp-md-h2">목표</div>
                  <div class="msnp-md-p">{m().goal}</div>
                  <div class="msnp-md-h2">산출물</div>
                  <For each={m().outputs}>{(o) => <div class="msnp-md-p mono">□ {o}</div>}</For>
                </div>
              </div>
            )}
          </Show>
        </div>
      </div>

      <div class="msnp-footer">
        <div>
          <div class="mono" style={{ "font-size": "10px", color: "var(--eq-green)" }}>
            WATCHING · .eqmux/
          </div>
          <div class="muted" style={{ "font-size": "10px" }}>
            외부 편집 감지 · 파일 우선
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button class="btn" onClick={() => setView({ kind: "missions", wsId: session()?.workspaceId ?? "academy" })}>
            파일 열기
          </button>
          <button class="btn primary" onClick={sendBrief}>
            브리프 전달
          </button>
        </div>
      </div>
    </div>
  );
}
