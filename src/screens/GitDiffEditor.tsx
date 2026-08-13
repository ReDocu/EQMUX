// Git Diff (AXXhV) — 변경 파일 사이드바 + HEAD ↔ 워크트리 나란히 비교.
// Tauri에서는 실측 (PRD H) · 읽기 전용이다 — 스테이지·커밋·편집은 터미널에서 사람이 한다
// (다른 패널과 같은 원칙). 브라우저 dev에서는 기존 목 데이터를 보여준다.
import { createEffect, createSignal, For, on, onMount, Show } from "solid-js";
import { diffChangedFiles, diffFile, gitOverview } from "../backend/git";
import type { ChangedFile, FileDiff } from "../backend/git";
import { backend, DIFF_BASE, DIFF_BRANCH, DIFF_CURRENT, DIFF_FILES } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { setView, tick } from "../state";

export function GitDiffEditor(props: { wsId?: string }) {
  const ws = () => {
    tick();
    const all = backend.listWorkspaces();
    return (
      (props.wsId && all.find((w) => w.id === props.wsId)) ||
      all.find((w) => w.open && !w.pathMissing) ||
      all.find((w) => !w.pathMissing)
    );
  };

  const [files, setFiles] = createSignal<ChangedFile[]>(
    isTauri() ? [] : DIFF_FILES.map((f) => ({ status: f.status, path: f.path, stat: f.stat })),
  );
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [query, setQuery] = createSignal("");
  const [real, setReal] = createSignal<FileDiff | undefined>(undefined);
  const [diffErr, setDiffErr] = createSignal<string | undefined>(undefined);
  const [branch, setBranch] = createSignal<string>(isTauri() ? "—" : DIFF_BRANCH.name);
  const [sync, setSync] = createSignal<{ ahead: number; behind: number }>(
    isTauri() ? { ahead: 0, behind: 0 } : { ahead: DIFF_BRANCH.ahead, behind: DIFF_BRANCH.behind },
  );

  const loadFiles = async () => {
    const target = ws();
    if (!isTauri() || !target) return;
    const list = (await diffChangedFiles(target.path)) ?? [];
    setFiles(list);
    if (!selected() || !list.some((f) => f.path === selected())) {
      setSelected(list[0]?.path);
    }
    void gitOverview(target.path).then((o) => {
      if (o) {
        setBranch(o.branch);
        setSync({ ahead: o.ahead, behind: o.behind });
      }
    });
  };

  const loadDiff = async () => {
    const target = ws();
    const path = selected();
    setReal(undefined);
    setDiffErr(undefined);
    if (!isTauri() || !target || !path) return;
    const d = await diffFile(target.path, path);
    if (typeof d === "string") setDiffErr(d);
    else setReal(d);
  };

  onMount(() => {
    if (!isTauri()) {
      setSelected(DIFF_FILES[0]?.path);
      return;
    }
    createEffect(on(() => ws()?.id, () => void loadFiles()));
    createEffect(on(selected, () => void loadDiff()));
  });

  const filtered = () => files().filter((f) => !query().trim() || f.path.includes(query().trim()));
  const stat = () => files().find((f) => f.path === selected())?.stat ?? "";

  // 목 폴백 라인 (브라우저 dev)
  const mockIsSession = () => selected() === "src/auth/session.ts";
  const baseLines = () => {
    if (isTauri()) return real()?.base ?? [];
    return mockIsSession() ? DIFF_BASE.lines : [];
  };
  const curLines = () => {
    if (isTauri()) return real()?.current ?? [];
    return mockIsSession() ? DIFF_CURRENT.lines : [];
  };
  const baseLabel = () => (isTauri() ? (real()?.baseLabel ?? "HEAD") : "8f31c2a");

  return (
    <div class="screen gde">
      <div class="gde-body">
        {/* 좌: 변경 파일 사이드바 */}
        <div class="gde-sidebar">
          <div class="gde-sidebar-head">
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}>
              <span style={{ "font-weight": 800 }}>변경 파일</span>
              <span class="mono muted" style={{ "font-size": "10px" }}>
                {files().length} CHANGES {isTauri() ? "· 실측" : "· 목"}
              </span>
            </div>
            <div class="mono muted" style={{ "font-size": "10px", "margin-top": "3px" }}>
              {branch()} ↑{sync().ahead} ↓{sync().behind} · {ws()?.name ?? "—"}
            </div>
          </div>
          <input
            class="panel-search mono"
            placeholder="파일 필터…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <div class="gde-files">
            <For each={filtered()}>
              {(f) => (
                <button
                  class="gde-file"
                  classList={{ selected: selected() === f.path }}
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
                    </div>
                  </div>
                </button>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>
                {isTauri() ? "변경된 파일이 없습니다 — 워크트리가 깨끗합니다" : "검색 결과 없음"}
              </div>
            </Show>
          </div>
          <div class="gde-sidebar-actions">
            <button class="btn" style={{ flex: 1 }} onClick={() => void loadFiles()}>
              ⟳ 새로 읽기
            </button>
          </div>
        </div>

        {/* 우: 비교 뷰어 (읽기 전용) */}
        <div class="gde-main">
          <div class="gde-toolbar">
            <div>
              <div class="mono" style={{ "font-weight": 700, "font-size": "12px" }}>
                {selected()?.split("/").join(" / ") ?? "파일을 선택하세요"}
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                COMPARE · {baseLabel()} ({branch()}) ↔ WORKTREE · {stat()}
              </div>
            </div>
            <div class="gde-toolbar-actions">
              <span class="mono muted" style={{ "font-size": "10px", "align-self": "center" }}>
                읽기 전용 — 스테이지·커밋·편집은 터미널에서
              </span>
              <button class="btn ghost" onClick={() => setView({ kind: "control" })}>
                ✕
              </button>
            </div>
          </div>

          <Show when={diffErr()}>
            <div class="card conn-error mono" style={{ margin: "10px" }}>
              {diffErr()}
            </div>
          </Show>

          <div class="gde-compare">
            <div class="gde-pane">
              <div class="gde-pane-head">
                <div>
                  <div class="mono" style={{ "font-weight": 700, "font-size": "11px" }}>
                    BASE · {baseLabel()}
                  </div>
                  <div class="muted" style={{ "font-size": "10px" }}>
                    커밋 시점 내용
                  </div>
                </div>
                <span class="badge">🔒 읽기 전용</span>
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
                <Show when={baseLines().length === 0}>
                  <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>
                    {isTauri() && real() ? "BASE 없음 — 새 파일입니다" : ""}
                  </div>
                </Show>
              </div>
            </div>

            <div class="gde-pane">
              <div class="gde-pane-head">
                <div>
                  <div class="mono" style={{ "font-weight": 700, "font-size": "11px" }}>
                    CURRENT · WORKTREE
                  </div>
                  <div class="muted" style={{ "font-size": "10px" }}>
                    현재 파일 내용
                  </div>
                </div>
                <span class="badge">🔒 읽기 전용</span>
              </div>
              <div class="gde-code mono">
                <For each={curLines()}>
                  {(l) => (
                    <div class="gde-line" classList={{ add: l.kind === "add" }}>
                      <span class="gde-gutter">{l.no}</span>
                      <span class="gde-text">{l.text}</span>
                    </div>
                  )}
                </For>
                <Show when={curLines().length === 0}>
                  <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>
                    {isTauri() && real() ? "워크트리에 없음 — 삭제된 파일입니다" : ""}
                  </div>
                </Show>
              </div>
            </div>
          </div>

          <div class="gde-statusbar mono">
            <div class="gde-status-left">
              <span class="muted">BASE {baseLabel()} · READ ONLY</span>
              <span>
                WORKTREE · {curLines().filter((l) => l.kind === "add").length} 추가 ·{" "}
                {baseLines().filter((l) => l.kind === "del").length} 삭제
                <Show when={real()?.truncated}> · 3,000줄에서 잘림</Show>
              </span>
            </div>
            <span class="muted">{isTauri() ? "git diff -U999999 실측" : "목 데이터"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
