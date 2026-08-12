// Git Diff & Editor (AXXhV) — 변경 파일 사이드바 + 커밋 ↔ 워크트리 나란히 비교.
// 좌측(BASE)은 읽기 전용, 우측(WORKTREE)은 편집 가능하다는 계약을 목으로 보여준다.
import { createSignal, For, Show } from "solid-js";
import { DIFF_BASE, DIFF_BRANCH, DIFF_CURRENT, DIFF_FILES } from "../backend/mock";
import type { DiffLine } from "../backend/mock";
import { setView } from "../state";

function placeholderLines(path: string, kind: "base" | "cur"): DiffLine[] {
  const del = path.endsWith("legacy.ts");
  return Array.from({ length: 8 }, (_, i) => ({
    no: i + 1,
    text:
      i === 0
        ? `// ${path} — ${kind === "base" ? "커밋 시점 내용" : del ? "삭제됨" : "현재 내용"} (목)`
        : del && kind === "cur"
          ? ""
          : `  /* line ${i + 1} */`,
    kind: del && kind === "cur" ? undefined : i === 0 ? undefined : kind === "cur" ? "add" : "del",
  }));
}

export function GitDiffEditor() {
  const [selected, setSelected] = createSignal("src/auth/session.ts");
  const [query, setQuery] = createSignal("");
  const [staged, setStaged] = createSignal<string[]>([]);
  const [saved, setSaved] = createSignal(false);

  const files = () => DIFF_FILES.filter((f) => !query().trim() || f.path.includes(query().trim()));
  const isSession = () => selected() === "src/auth/session.ts";
  const baseLines = () => (isSession() ? DIFF_BASE.lines : placeholderLines(selected(), "base"));
  const curLines = () => (isSession() ? DIFF_CURRENT.lines : placeholderLines(selected(), "cur"));
  const stat = () => DIFF_FILES.find((f) => f.path === selected())?.stat ?? "";

  const stageAll = () => setStaged(DIFF_FILES.map((f) => f.path));
  const stageOne = () => {
    if (!staged().includes(selected())) setStaged([...staged(), selected()]);
  };

  return (
    <div class="screen gde">
      <div class="gde-body">
        {/* 좌: 변경 파일 사이드바 */}
        <div class="gde-sidebar">
          <div class="gde-sidebar-head">
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}>
              <span style={{ "font-weight": 800 }}>변경 파일</span>
              <span class="mono muted" style={{ "font-size": "10px" }}>
                {DIFF_FILES.length} CHANGES
              </span>
            </div>
            <div class="mono muted" style={{ "font-size": "10px", "margin-top": "3px" }}>
              {DIFF_BRANCH.name} ↑{DIFF_BRANCH.ahead} ↓{DIFF_BRANCH.behind}
            </div>
          </div>
          <input
            class="panel-search mono"
            placeholder="파일 필터…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <div class="gde-files">
            <For each={files()}>
              {(f) => (
                <button
                  class="gde-file"
                  classList={{ selected: selected() === f.path, staged: staged().includes(f.path) }}
                  onClick={() => setSelected(f.path)}
                >
                  <span
                    class="gde-st mono"
                    classList={{ add: f.status === "A", del: f.status === "D", mod: f.status === "M" }}
                  >
                    {f.status}
                  </span>
                  <div style={{ "min-width": 0, flex: 1 }}>
                    <div class="mono gde-file-path">{f.path}</div>
                    <div class="mono muted" style={{ "font-size": "10px" }}>
                      {f.stat}
                      <Show when={staged().includes(f.path)}> · staged</Show>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
          <div class="gde-sidebar-actions">
            <button class="btn" style={{ flex: 1 }} onClick={stageAll}>
              모두 스테이지
            </button>
            <button class="btn primary" style={{ flex: 1 }} disabled={staged().length === 0} onClick={() => setStaged([])}>
              커밋{staged().length > 0 ? ` ${staged().length}` : ""}
            </button>
          </div>
        </div>

        {/* 우: 비교 워크스페이스 */}
        <div class="gde-main">
          <div class="gde-toolbar">
            <div>
              <div class="mono" style={{ "font-weight": 700, "font-size": "12px" }}>
                {selected().split("/").join(" / ")}
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                COMPARE · 8f31c2a ({DIFF_BRANCH.name}) ↔ WORKTREE · {stat()}
              </div>
            </div>
            <div class="gde-toolbar-actions">
              <button class="btn">◫ 나란히 비교</button>
              <button class="btn mono">8f31c2a</button>
              <button class="btn mono">현재 내용</button>
              <button class="btn primary" onClick={stageOne}>
                + 변경 스테이지
              </button>
              <button class="btn ghost" onClick={() => setView({ kind: "control" })}>
                ✕
              </button>
            </div>
          </div>

          <div class="gde-compare">
            <div class="gde-pane">
              <div class="gde-pane-head">
                <div>
                  <div class="mono" style={{ "font-weight": 700, "font-size": "11px" }}>
                    COMMIT · 8f31c2a
                  </div>
                  <div class="muted" style={{ "font-size": "10px" }}>
                    {DIFF_BASE.header}
                  </div>
                </div>
                <span class="badge">🔒 읽기 전용</span>
              </div>
              <div class="gde-range mono muted">
                {selected()} <span class="st-waiting">{isSession() ? DIFF_BASE.range : "@@ 전체 파일 @@"}</span>
              </div>
              <div class="gde-code mono">
                <For each={baseLines()}>
                  {(l) => (
                    <div class="gde-line" classList={{ del: l.kind === "del" }}>
                      <span class="gde-gutter">{l.no}</span>
                      <span class="gde-text">{l.text}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class="gde-pane">
              <div class="gde-pane-head">
                <div>
                  <div class="mono" style={{ "font-weight": 700, "font-size": "11px" }}>
                    CURRENT · WORKTREE
                  </div>
                  <div class="muted" style={{ "font-size": "10px" }}>
                    {saved() ? "현재 내용 · 저장됨" : DIFF_CURRENT.header}
                  </div>
                </div>
                <span class="badge green">✎ 편집 가능</span>
              </div>
              <div class="gde-range mono muted">
                {selected()} <span class="st-waiting">{isSession() ? DIFF_CURRENT.range : "@@ 전체 파일 @@"}</span>
              </div>
              <div class="gde-code mono">
                <For each={curLines()}>
                  {(l) => (
                    <div class="gde-line" classList={{ add: l.kind === "add", cursor: isSession() && l.no === 12 }}>
                      <span class="gde-gutter">{l.no}</span>
                      <span class="gde-text">{l.text}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>

          <div class="gde-statusbar mono">
            <div class="gde-status-left">
              <span class="muted">BASE 8f31c2a · READ ONLY</span>
              <span>
                WORKTREE <span classList={{ "st-waiting": !saved(), "st-green": saved() }}>●</span>{" "}
                {saved() ? "SAVED" : "MODIFIED"} · Ln 12, Col 34
              </span>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button class="btn" onClick={() => setSaved(true)}>
                현재 저장
              </button>
              <button class="btn ghost" onClick={() => setSaved(false)}>
                선택 변경 되돌리기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
