// 임무 · 파일 탐색기 패널 (ehpqx) — 워크스페이스 파일 트리 + 미리보기 + 파일 CRUD (M24).
// Tauri에서는 실제 FS를 읽고 쓴다 (깊이·개수 상한 · .git 불가침 · 삭제는 휴지통).
// 파일이 원본이라는 계약 그대로: 임무 파일은 backend의 실측 임무 데이터로, 그 외 텍스트는 원문으로.
import { createEffect, createSignal, For, on, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import { fsCreate, fsDelete, fsPreview, fsRead, fsRename, fsTree, fsWrite } from "../backend/panels";
import type { FsNode } from "../backend/panels";
import { refreshMissions } from "../backend/missions";
import { sendConversation } from "../backend/conversation";
import { isTauri } from "../backend/pty";
import { openPanel, selectedSession, setExplorerOpen, setView, tick, view } from "../state";

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

const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

// 미저장 이탈 보호 — 오버레이(ESC 닫기)가 편집 중 여부를 알아야 한다
export const [editorGuard, setEditorGuard] = createSignal(false);

export function MissionExplorerTab() {
  const [sel, setSel] = createSignal<FsNode | undefined>(undefined);
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

  // 브라우저 dev — 정적 목 트리에 이 워크스페이스의 임무 파일을 실측(MISSIONS)으로 합친다.
  // 임무 생성이 곧 파일 생성이라는 계약(FR-E-51)이 목에서도 보이게 한다 (B6).
  const mockTree = () => {
    tick();
    const wsId = ws()?.id;
    const seen = new Set(MOCK_TREE.map((n) => n.rel));
    const missionNodes: FsNode[] = backend
      .listMissions()
      .filter((m) => m.workspaceId === wsId && !seen.has(m.file) && seen.add(m.file))
      .map((m) => ({ name: m.file.split("/").pop()!, rel: m.file, depth: 2, dir: false }));
    if (missionNodes.length === 0) return MOCK_TREE;
    const merged = [...MOCK_TREE];
    let at = merged.findIndex((n) => n.rel === ".eqmux/missions") + 1;
    while (at < merged.length && merged[at].rel.startsWith(".eqmux/missions/")) at++;
    merged.splice(at, 0, ...missionNodes);
    return merged;
  };

  const tree = () => {
    const list = isTauri() ? (nodes() ?? []) : mockTree();
    const q = query().trim();
    return q ? list.filter((n) => n.name.includes(q)) : list;
  };

  const loadPreview = async (rel: string) => {
    setPreview(undefined);
    const target = ws();
    if (isTauri() && target) setPreview(await fsPreview(target.path, rel));
  };

  const pick = (n: FsNode) => {
    // 미저장 이탈 보호 — 편집 중 다른 파일 클릭은 1회 경고, 같은 파일 재클릭이 곧 확인
    if (editing() !== undefined && dirty() && pendingSwitch() !== n.rel) {
      setPendingSwitch(n.rel);
      setFsErr("미저장 변경이 있습니다 — 한 번 더 클릭하면 버리고 이동합니다");
      return;
    }
    setPendingSwitch(undefined);
    setSel(n);
    setFsErr(undefined);
    setConfirmDel(false);
    setNameMode(undefined);
    setEditing(undefined);
    setDirty(false);
    if (n.dir) setPreview(undefined);
    else void loadPreview(n.rel);
  };

  // ── 파일 CRUD (M24) — .git 불가침·탈출 거부는 Rust 가드가, 사유 표시는 여기가 맡는다 ──
  const [nameMode, setNameMode] = createSignal<"file" | "dir" | "rename" | undefined>(undefined);
  const [nameVal, setNameVal] = createSignal("");
  const [fsErr, setFsErr] = createSignal<string | undefined>(undefined);
  const [confirmDel, setConfirmDel] = createSignal(false);
  const [editing, setEditing] = createSignal<string | undefined>(undefined);
  const [dirty, setDirty] = createSignal(false);
  const [editMtime, setEditMtime] = createSignal<number | undefined>(undefined); // 충돌 감지 기준
  const [pendingSwitch, setPendingSwitch] = createSignal<string | undefined>(undefined);
  // 오버레이 ESC 가드 — 편집 중 + 미저장일 때만 닫기를 막는다
  createEffect(() => setEditorGuard(editing() !== undefined && dirty()));

  // 생성 대상 폴더 — 폴더 선택 시 그 안, 파일 선택 시 그 옆, 없으면 루트
  const createDir = () => {
    const s = sel();
    if (!s) return "";
    return s.dir ? s.rel : parentOf(s.rel);
  };

  const openName = (kind: "file" | "dir" | "rename") => {
    setFsErr(undefined);
    setNameVal(kind === "rename" ? (sel()?.name ?? "") : "");
    setNameMode(kind);
  };

  const isMissionFile = (rel: string) => rel.startsWith(".eqmux/missions/");

  const submitName = async () => {
    const target = ws();
    const kind = nameMode();
    const name = nameVal().trim();
    if (!target || !kind || !name) return;
    setFsErr(undefined);
    try {
      if (kind === "rename") {
        const s = sel();
        if (!s) return;
        const next = await fsRename(target.path, s.rel, name);
        setSel({ ...s, rel: next, name });
        if (!s.dir) void loadPreview(next);
        if (isMissionFile(s.rel) || isMissionFile(next)) void refreshMissions(target.id);
      } else {
        const rel = await fsCreate(target.path, createDir(), name, kind === "dir");
        if (kind === "file") {
          setSel({ name, rel, depth: 0, dir: false });
          setPreview("");
        }
      }
      setNameMode(undefined);
      await loadTree();
    } catch (err) {
      setFsErr(String(err));
    }
  };

  const doDelete = async () => {
    const target = ws();
    const s = sel();
    if (!target || !s) return;
    if (!confirmDel()) {
      setConfirmDel(true); // 2단 확인 — 실수 클릭 방지. 그래도 영구 삭제가 아니라 휴지통이다
      return;
    }
    setConfirmDel(false);
    setFsErr(undefined);
    try {
      await fsDelete(target.path, s.rel);
      setSel(undefined);
      setPreview(undefined);
      setEditing(undefined);
      if (isMissionFile(s.rel)) void refreshMissions(target.id);
      await loadTree();
    } catch (err) {
      setFsErr(String(err));
    }
  };

  const startEdit = async () => {
    const target = ws();
    const s = sel();
    if (!target || !s || s.dir) return;
    setFsErr(undefined);
    try {
      // 편집은 전문 읽기 — 64KB 미리보기를 저장해 뒷부분을 날리지 않는다 (1MB 초과는 거부)
      const fc = await fsRead(target.path, s.rel);
      setEditing(fc.text);
      setEditMtime(fc.mtimeMs);
      setDirty(false);
    } catch (err) {
      setFsErr(String(err));
    }
  };

  const saveEdit = async () => {
    const target = ws();
    const s = sel();
    const content = editing();
    if (!target || !s || content === undefined) return;
    setFsErr(undefined);
    try {
      // 충돌 감지 — 편집 시작 후 파일이 밖에서(에이전트 등) 바뀌었으면 거부된다
      const next = await fsWrite(target.path, s.rel, content, editMtime());
      setEditMtime(next);
      setEditing(undefined);
      setDirty(false);
      void loadPreview(s.rel);
      if (isMissionFile(s.rel)) void refreshMissions(target.id); // 임무는 파일이 원본 (FR-E-74)
    } catch (err) {
      setFsErr(String(err));
    }
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
    // 원장 경로(msg_send)로 보낸다 — backend.sendMessage 직접 호출은 Tauri에서 DB·PTY 전달 없이
    // workspaceId undefined인 유령 메시지가 됐다가 다음 hydrate에서 사라진다
    const wsId = ws()?.id;
    if (wsId) {
      void sendConversation(wsId, "@all", "handoff", `브리프 전달 · ${sel()?.rel ?? ".eqmux/missions/"}`);
    }
    // 전체 화면 팝업(M25)에서 부르므로 — 팝업을 접고 대화 패널을 연다
    setExplorerOpen(false);
    openPanel("conversation");
  };

  return (
    <div class="msnp">
      <div class="panel-head-row">
        <span class="panel-title">임무 · 파일 탐색기</span>
        <span class="mono muted" style={{ "font-size": "9px", "letter-spacing": "0.06em" }}>
          {isTauri() ? "FS 실측 · CRUD" : "목 데이터"}
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
          {/* 파일 CRUD (M24) — 대상: 선택 폴더 안 / 선택 파일 옆 / 루트 */}
          <div class="msnp-crud">
            <button class="btn ghost" disabled={!isTauri() || !ws()} title={`새 파일 — ${createDir() || "루트"}`} onClick={() => openName("file")}>
              +파일
            </button>
            <button class="btn ghost" disabled={!isTauri() || !ws()} title={`새 폴더 — ${createDir() || "루트"}`} onClick={() => openName("dir")}>
              +폴더
            </button>
            <button class="btn ghost" disabled={!isTauri() || !sel()} title="이름 변경 (같은 폴더 안)" onClick={() => openName("rename")}>
              이름
            </button>
            <button
              class="btn ghost"
              classList={{ danger: confirmDel() }}
              disabled={!isTauri() || !sel()}
              title="휴지통으로 이동 — 영구 삭제 아님"
              onClick={() => void doDelete()}
            >
              {confirmDel() ? "휴지통 확정?" : "삭제"}
            </button>
          </div>
          <Show when={nameMode()}>
            <div class="msnp-name-row">
              <input
                class="mono"
                placeholder={nameMode() === "rename" ? "새 이름" : nameMode() === "dir" ? "폴더 이름" : "파일 이름"}
                value={nameVal()}
                onInput={(e) => setNameVal(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitName();
                  if (e.key === "Escape") setNameMode(undefined);
                }}
                ref={(el) => setTimeout(() => el.focus())}
              />
              <button class="btn primary" style={{ padding: "2px 8px" }} onClick={() => void submitName()}>
                확인
              </button>
              <button class="btn ghost" style={{ padding: "2px 6px" }} onClick={() => setNameMode(undefined)}>
                ✕
              </button>
            </div>
          </Show>
          <Show when={fsErr()}>
            <div class="mono st-dead" style={{ "font-size": "10px", padding: "2px 4px" }}>
              {fsErr()}
            </div>
          </Show>
          <div class="msnp-tree-rows">
            <For each={tree()}>
              {(n) => (
                <button
                  class="msnp-tree-row mono"
                  classList={{ selected: sel()?.rel === n.rel, folder: n.dir }}
                  style={{ "padding-left": `${8 + n.depth * 12}px` }}
                  onClick={() => pick(n)}
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
                {sel()?.name ?? "파일을 선택하세요"}
                <Show when={editing() !== undefined}>
                  <span class="st-waiting"> · 편집 중{dirty() ? " *" : ""}</span>
                </Show>
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                {sel()?.rel ?? "—"}
              </div>
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <Show when={isTauri() && sel() && !sel()!.dir && editing() === undefined}>
                <button class="btn ghost" title="원문 편집 (1MB 상한)" style={{ padding: "2px 6px" }} onClick={() => void startEdit()}>
                  편집
                </button>
              </Show>
              <Show when={editing() !== undefined}>
                <button class="btn primary" style={{ padding: "2px 8px" }} onClick={() => void saveEdit()}>
                  저장
                </button>
                <button class="btn ghost" style={{ padding: "2px 6px" }} onClick={() => setEditing(undefined)}>
                  취소
                </button>
              </Show>
              <button class="btn ghost" title="트리 새로 읽기" style={{ padding: "2px 6px" }} onClick={() => void loadTree()}>
                ⟳
              </button>
            </div>
          </div>

          <Show
            when={editing() !== undefined}
            fallback={
              <Show
                when={missionOf(sel()?.rel)}
                fallback={
                  <Show
                    when={preview() !== undefined}
                    fallback={
                      <div class="muted" style={{ padding: "14px 10px", "font-size": "11px" }}>
                        {sel() && !sel()!.dir
                          ? "미리보기를 불러올 수 없습니다 (바이너리 또는 읽기 실패)"
                          : sel()?.dir
                            ? "폴더 선택됨 — +파일/+폴더는 이 안에 만들어집니다"
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
            }
          >
            <textarea
              class="mono msnp-edit"
              value={editing()}
              onInput={(e) => {
                setEditing(e.currentTarget.value);
                setDirty(true);
              }}
              onKeyDown={(e) => {
                // Ctrl+S 저장 — 브라우저 저장 다이얼로그를 가로챈다
                if (e.ctrlKey && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  void saveEdit();
                }
              }}
            />
          </Show>
        </div>
      </div>

      <div class="msnp-footer">
        <div>
          <div class="mono" style={{ "font-size": "10px", color: "var(--eq-green)" }}>
            {isTauri() ? "실측 · 열 때 새로 읽음" : "WATCHING · .eqmux/ (목)"}
          </div>
          <div class="muted" style={{ "font-size": "10px" }}>
            파일 우선 · 삭제는 휴지통 · .git 불가침
          </div>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            class="btn"
            disabled={!ws()}
            onClick={() => {
              if (!ws()) return;
              setExplorerOpen(false); // 팝업 아래로 이동하므로 접는다
              setView({ kind: "missions", wsId: ws()!.id });
            }}
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
