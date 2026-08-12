// 임무 · 파일 탐색기 패널 (ehpqx) — 워크스페이스 파일 트리 + 미리보기.
// Tauri에서는 실제 FS를 읽는다 (PRD H — 깊이·개수 상한, 읽기 전용). 파일이 원본이라는 계약 그대로:
// 임무 파일은 backend의 실측 임무 데이터로, 그 외 텍스트는 원문으로 보여준다.
import { createEffect, createSignal, For, on, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import { fsPreview, fsTree } from "../backend/panels";
import type { FsNode } from "../backend/panels";
import { isTauri } from "../backend/pty";
import { selectedSession, setPanelTab, setView, tick, view } from "../state";

// 브라우저 dev 폴백 트리 (기존 목)
const MOCK_TREE: FsNode[] = [
  { name: "src", rel: "src", depth: 0, dir: true },
  { name: ".eqmux", rel: ".eqmux", depth: 0, dir: true },
  { name: "team.json", rel: ".eqmux/team.json", depth: 1, dir: false },
  { name: "team.md", rel: ".eqmux/team.md", depth: 1, dir: false },
  { name: "missions", rel: ".eqmux/missions", depth: 1, dir: true },
  { name: "auth-refactor.md", rel: ".eqmux/missions/auth-refactor.md", depth: 2, dir: false },
  { name: "README.md", rel: "README.md", depth: 0, dir: false },
];

export function MissionExplorerTab() {
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [query, setQuery] = createSignal("");
  const [nodes, setNodes] = createSignal<FsNode[] | undefined>(undefined);
  const [preview, setPreview] = createSignal<string | undefined>(undefined);

  const session = () => {
    tick();
    const all = backend.listSessions();
    return all.find((s) => s.id === selectedSession()) ?? all[0];
  };
  // 스코프 — 선택 세션의 워크스페이스 → 활성 탭 → 첫 등록
  const ws = () => {
    tick();
    const all = backend.listWorkspaces();
    const bySession = session() && all.find((w) => w.id === session()!.workspaceId);
    if (bySession && !bySession.pathMissing) return bySession;
    const v = view();
    if (v.kind === "workspace") {
      const cur = all.find((w) => w.id === (v as { id: string }).id);
      if (cur && !cur.pathMissing) return cur;
    }
    return all.find((w) => !w.pathMissing);
  };
  const persona = () => backend.listPersonas().find((p) => p.id === session()?.personaId);
  const job = () => backend.listJobs().find((j) => j.id === session()?.jobId);

  const loadTree = async () => {
    const target = ws();
    if (!isTauri() || !target) return;
    setNodes(await fsTree(target.path));
  };
  onMount(() => {
    createEffect(on(() => ws()?.id, () => void loadTree()));
  });

  const tree = () => {
    const list = isTauri() ? (nodes() ?? []) : MOCK_TREE;
    const q = query().trim();
    return q ? list.filter((n) => n.name.includes(q)) : list;
  };

  const pickFile = async (n: FsNode) => {
    if (n.dir) return;
    setSelected(n.rel);
    setPreview(undefined);
    const target = ws();
    if (isTauri() && target) setPreview(await fsPreview(target.path, n.rel));
  };

  // 임무 파일이면 실측 임무 데이터로 구조화 미리보기 (파일이 원본 — 목록도 파일 실측이다)
  const missionOf = (rel?: string) => {
    tick();
    if (!rel) return undefined;
    return backend.listMissions().find((m) => m.file === rel);
  };
  const personaName = (sid: string) => {
    const s = backend.listSessions().find((x) => x.id === sid);
    return backend.listPersonas().find((p) => p.id === s?.personaId)?.name ?? sid.split("@")[0];
  };

  const sendBrief = () => {
    backend.sendMessage(
      persona()?.name ?? "리드",
      "@all",
      "handoff",
      `브리프 전달 · ${selected() ?? ".eqmux/missions/"}`,
    );
    setPanelTab("conversation");
  };

  return (
    <div class="msnp">
      <div class="panel-head-row">
        <span class="panel-title">임무 · 파일 탐색기</span>
        <span class="mono muted" style={{ "font-size": "9px", "letter-spacing": "0.06em" }}>
          {isTauri() ? "FS 실측 · 읽기 전용" : "목 데이터"}
        </span>
      </div>

      <div class="card inset msnp-terminal">
        <span class="msnp-status-dot" />
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ "font-weight": 700, "font-size": "11px" }}>
            {persona()?.name ?? "세션 없음"} · {job()?.name ?? "—"}
          </div>
          <div class="mono muted" style={{ "font-size": "10px" }}>
            {ws()?.path ?? "워크스페이스 없음"}
          </div>
        </div>
        <span class="badge blue mono">⎇ {ws()?.branch ?? "—"}</span>
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
                  classList={{ selected: selected() === n.rel, folder: n.dir }}
                  style={{ "padding-left": `${8 + n.depth * 12}px` }}
                  onClick={() => void pickFile(n)}
                >
                  <span class="msnp-tree-icon">
                    {n.dir ? "▸" : n.name.endsWith(".json") ? "{}" : n.name.endsWith(".md") ? "≡" : "·"}
                  </span>
                  {n.name}
                </button>
              )}
            </For>
            <Show when={tree().length === 0}>
              <div class="muted" style={{ padding: "8px", "font-size": "11px" }}>
                {isTauri() ? "파일이 없거나 워크스페이스가 없습니다" : "검색 결과 없음"}
              </div>
            </Show>
          </div>
        </div>

        <div class="msnp-preview card inset">
          <div class="msnp-preview-head">
            <div style={{ "min-width": 0 }}>
              <div class="mono" style={{ "font-weight": 700, "font-size": "11px" }}>
                {selected()?.split("/").pop() ?? "파일을 선택하세요"}
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                {selected() ?? "—"}
              </div>
            </div>
            <button class="btn ghost" title="트리 새로 읽기" style={{ padding: "2px 6px" }} onClick={() => void loadTree()}>
              ⟳
            </button>
          </div>

          <Show
            when={missionOf(selected())}
            fallback={
              <Show
                when={preview() !== undefined}
                fallback={
                  <div class="muted" style={{ padding: "14px 10px", "font-size": "11px" }}>
                    {selected()
                      ? "미리보기를 불러올 수 없습니다 (바이너리 또는 읽기 실패)"
                      : "파일을 선택하면 원문이 표시됩니다. 임무 파일(.eqmux/missions/*.md)은 구조화되어 보입니다."}
                  </div>
                }
              >
                <pre
                  class="mono"
                  style={{
                    "font-size": "11px",
                    "white-space": "pre-wrap",
                    padding: "10px",
                    margin: 0,
                    "overflow-y": "auto",
                    "max-height": "100%",
                  }}
                >
                  {preview()}
                </pre>
              </Show>
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
                    <span class="v">{m().assigned.length > 0 ? m().assigned.map(personaName).join(", ") : "—"}</span>
                  </div>
                </div>
                <div class="msnp-md">
                  <div class="msnp-md-h1"># {m().name}</div>
                  <div class="msnp-md-h2">목표</div>
                  <div class="msnp-md-p">{m().goal || "—"}</div>
                  <Show when={m().outputs.length > 0}>
                    <div class="msnp-md-h2">산출물</div>
                    <For each={m().outputs}>{(o) => <div class="msnp-md-p mono">□ {o}</div>}</For>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </div>
      </div>

      <div class="msnp-footer">
        <div>
          <div class="mono" style={{ "font-size": "10px", color: "var(--eq-green)" }}>
            {isTauri() ? "실측 · 열 때 새로 읽음" : "WATCHING · .eqmux/ (목)"}
          </div>
          <div class="muted" style={{ "font-size": "10px" }}>
            읽기 전용 · 파일 우선
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            class="btn"
            disabled={!ws()}
            onClick={() => ws() && setView({ kind: "missions", wsId: ws()!.id })}
          >
            임무 관리
          </button>
          <button class="btn primary" onClick={sendBrief}>
            브리프 전달
          </button>
        </div>
      </div>
    </div>
  );
}
