// git 패널 (PAlmZ) — 저장소·브랜치 + 변경 요약 + 커밋 그래프 + 워크트리·체크아웃 (M36).
// Tauri에서는 활성 워크스페이스의 저장소를 실측한다 (PRD H).
// M36 개방 범위는 커밋 이력을 바꾸지 않는 작업 트리 조작뿐이다 — 브랜치 체크아웃(2단 확인,
// FR-E-52와 같은 패턴)·워크트리 목록/생성/셸 열기. 워크트리 삭제(FR-E-64 — 정리는 사람 몫)와
// pull·push·commit·stage(G7 — 실행은 터미널에서 사람이)는 계속 두지 않는다.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { branchList, gitOverview, worktreeAdd, worktreeList } from "../backend/git";
import type { BranchInfo, GitOverview, WorktreeInfo } from "../backend/git";
import { GIT_STATE, backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { checkoutBranch } from "../backend/workspaces";
import { defaultShell, setPanelOpen, setView, tick, view } from "../state";
import { Eyebrow } from "./ui";

interface CommitRow {
  hash: string;
  message: string;
  author: string;
  when: string;
  badge?: string;
}

/** refs 장식("HEAD -> main, origin/main")에서 뱃지 하나만 뽑는다 */
function refBadge(refs: string): string | undefined {
  const first = refs.split(",")[0]?.trim().replace(/^HEAD -> /, "");
  return first || undefined;
}

export function GitPanelTab() {
  // 스코프 = 활성 워크스페이스 탭, 아니면 첫 번째 열린 워크스페이스
  const ws = () => {
    tick();
    const v = view();
    const all = backend.listWorkspaces();
    if (v.kind === "workspace") {
      const cur = all.find((w) => w.id === (v as { id: string }).id);
      if (cur) return cur;
    }
    return all.find((w) => w.open && !w.pathMissing);
  };

  const [real, setReal] = createSignal<GitOverview | undefined>(undefined);
  const [failed, setFailed] = createSignal(false);
  const [branches, setBranches] = createSignal<BranchInfo[]>([]);
  const [worktrees, setWorktrees] = createSignal<WorktreeInfo[]>([]);

  const load = async () => {
    const target = ws();
    if (!target || target.pathMissing) {
      setReal(undefined);
      return;
    }
    const o = await gitOverview(target.path);
    setReal(o);
    setFailed(o === undefined);
    setBranches((await branchList(target.path)) ?? []);
    setWorktrees((await worktreeList(target.path)) ?? []);
  };

  onMount(() => {
    if (!isTauri()) return;
    createEffect(on(() => ws()?.id, () => void load()));
    const t = setInterval(() => void load(), 10_000);
    onCleanup(() => clearInterval(t));
  });

  // ── 브랜치 체크아웃 (M36) — 공유 repo 전체에 적용되므로 2단 확인 (FR-E-52 패턴) ──
  const [branchMenu, setBranchMenu] = createSignal(false);
  const [coArm, setCoArm] = createSignal<string | undefined>(undefined);
  const [coNote, setCoNote] = createSignal<string | undefined>(undefined);
  const [newBranch, setNewBranch] = createSignal("");
  const doCheckout = async (branch: string) => {
    if (coArm() !== branch) {
      setCoArm(branch);
      setCoNote(undefined);
      return;
    }
    setCoArm(undefined);
    const target = ws();
    if (!isTauri() || !target) {
      setCoNote("브라우저 dev — 실제 체크아웃 없음");
      return;
    }
    try {
      await checkoutBranch(target.path, branch);
      setCoNote(`⎇ ${branch} 체크아웃 완료 — 공유 세션 전체에 적용됨`);
      setBranchMenu(false);
      setNewBranch("");
      await load();
    } catch (err) {
      setCoNote(`체크아웃 실패 — ${String(err)}`);
    }
  };

  // ── 워크트리 (M36) — 목록·생성·셸 열기. 삭제는 없다 (FR-E-64 — 정리는 사람 몫) ──
  const [wtFormOpen, setWtFormOpen] = createSignal(false);
  const [wtName, setWtName] = createSignal("");
  const [wtBase, setWtBase] = createSignal("");
  const [wtBusy, setWtBusy] = createSignal(false);
  const [wtErr, setWtErr] = createSignal<string | undefined>(undefined);
  const createWorktree = async () => {
    const target = ws();
    if (!isTauri() || !target || !wtName().trim()) return;
    setWtErr(undefined);
    setWtBusy(true);
    try {
      await worktreeAdd(target.path, wtName().trim(), wtBase() || undefined);
      setWtFormOpen(false);
      setWtName("");
      setWtBase("");
      await load();
    } catch (err) {
      setWtErr(String(err));
    } finally {
      setWtBusy(false);
    }
  };
  /** 워크트리에서 기본 터미널 열기 — 셸로 시작, 역할 부여는 세션 상세에서 이어서 가능 */
  const openShell = (wt: WorktreeInfo) => {
    const target = ws();
    if (!target) return;
    backend.addTerminal(target.id, defaultShell().label, wt.path);
    setView({ kind: "workspace", id: target.id });
    setPanelOpen(false);
  };
  const wtLabel = (wt: WorktreeInfo) => wt.branch ?? `detached @ ${wt.head}`;
  const wtTail = (p: string) => p.replace(/\\/g, "/").split("/").slice(-2).join("/");

  // 실측/목 폴백 공용 뷰모델 — 화면은 이것만 본다
  const g = () => {
    const r = real();
    if (isTauri() && r) {
      return {
        repo: ws()?.name ?? "—",
        branch: r.branch,
        ahead: r.ahead,
        behind: r.behind,
        changed: r.changed,
        added: r.added,
        modified: r.modified,
        deleted: r.deleted,
        commits: r.commits.map<CommitRow>((c) => ({ ...c, badge: refBadge(c.refs) })),
        real: true,
      };
    }
    return {
      repo: GIT_STATE.repo,
      branch: GIT_STATE.branch,
      ahead: GIT_STATE.ahead,
      behind: GIT_STATE.behind,
      changed: GIT_STATE.changed,
      added: GIT_STATE.added,
      modified: GIT_STATE.modified,
      deleted: GIT_STATE.deleted,
      commits: GIT_STATE.commits.map<CommitRow>((c) => ({ ...c, badge: c.tag })),
      real: false,
    };
  };

  const openDiff = () => {
    setView({ kind: "gitdiff", wsId: ws()?.id });
    setPanelOpen(false);
  };

  return (
    <div class="gitp">
      <div class="panel-head-row">
        <span class="panel-title">git</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {g().real ? `실측 · ${ws()?.path ?? ""}` : "목 데이터"}
        </span>
      </div>

      <Show when={isTauri() && failed()}>
        <div class="card conn-error mono" style={{ "font-size": "11px" }}>
          저장소를 읽을 수 없습니다 — {ws() ? "git 저장소가 아니거나 git CLI가 없습니다" : "열린 워크스페이스가 없습니다"}
        </div>
      </Show>

      <div class="card inset gitp-repo mono">
        <span>{g().repo}</span>
        <span class="muted">{g().real ? "" : "▾"}</span>
      </div>

      <div class="gitp-branch-row">
        <button
          class="card inset gitp-branch mono"
          style={{ cursor: "pointer", "text-align": "left" }}
          title="브랜치 체크아웃 (M36) — 공유 repo 전체에 적용, 2단 확인"
          onClick={() => {
            setBranchMenu(!branchMenu());
            setCoArm(undefined);
          }}
        >
          <span>⎇ {g().branch} ▾</span>
        </button>
        <span class="mono gitp-sync" title="업스트림 대비 ahead / behind">
          <span class="st-waiting">↑{g().ahead}</span> <span class="muted">↓{g().behind}</span>
        </span>
      </div>

      {/* 브랜치 체크아웃 (M36) — 워크트리 세션은 자기 브랜치라 영향 없음 (FR-E-52와 동일 고지) */}
      <Show when={branchMenu()}>
        <div class="card inset" style={{ padding: "6px 8px", display: "flex", "flex-direction": "column", gap: "2px" }}>
          <For each={branches()}>
            {(b) => (
              <button
                class="btn ghost mono"
                classList={{ danger: coArm() === b.name }}
                style={{ "justify-content": "flex-start", "font-size": "11px", padding: "2px 6px", display: "flex", gap: "6px" }}
                disabled={b.current}
                title={b.remote ? "원격 브랜치 — 체크아웃하면 추적 브랜치가 만들어집니다" : ""}
                onClick={() => void doCheckout(b.name)}
              >
                <span>{b.current ? "●" : coArm() === b.name ? "⚠" : "○"}</span>
                <span style={{ flex: 1, "text-align": "left" }}>
                  {coArm() === b.name ? `${b.name} — 공유 repo 전환 확정?` : b.name}
                </span>
                <Show when={b.remote}>
                  <span class="badge">원격</span>
                </Show>
              </button>
            )}
          </For>
          <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
            <input
              class="mono"
              style={{ flex: 1, "font-size": "11px", padding: "2px 6px" }}
              placeholder="새 브랜치 이름 — checkout -b"
              value={newBranch()}
              onInput={(e) => setNewBranch(e.currentTarget.value)}
            />
            <button
              class="btn ghost"
              classList={{ danger: !!newBranch().trim() && coArm() === newBranch().trim() }}
              style={{ "font-size": "10px", padding: "2px 8px" }}
              disabled={!newBranch().trim()}
              onClick={() => void doCheckout(newBranch().trim())}
            >
              {coArm() === newBranch().trim() && newBranch().trim() ? "확정?" : "생성·전환"}
            </button>
          </div>
          <div class="muted" style={{ "font-size": "10px" }}>
            공유 repo의 현재 브랜치를 바꿉니다 — 워크트리 세션은 영향 없음 (FR-E-52)
          </div>
        </div>
      </Show>
      <Show when={coNote()}>
        <div class="mono muted" style={{ "font-size": "10px" }}>
          {coNote()}
        </div>
      </Show>

      <div class="gitp-actions">
        <button class="btn" onClick={openDiff}>
          diff
        </button>
        <span class="mono muted" style={{ "font-size": "10px", "align-self": "center" }}>
          pull·push·commit은 터미널에서 — 이력 조작은 두지 않는다
        </span>
      </div>

      <div class="gitp-summary">
        <For
          each={[
            { v: g().changed, k: "변경" },
            { v: g().added, k: "추가" },
            { v: g().modified, k: "수정" },
            { v: g().deleted, k: "삭제" },
          ]}
        >
          {(m) => (
            <div class="card inset gitp-metric">
              <div class="gitp-metric-v mono">{m.v}</div>
              <div class="eyebrow">{m.k}</div>
            </div>
          )}
        </For>
      </div>

      {/* 워크트리 (M36 — orca식 안전 범위) — 외부 생성 워크트리도 실측에 잡힌다 (순수 git 호환) */}
      <Show when={isTauri() && worktrees().length > 0}>
        <div class="panel-head-row" style={{ "margin-top": "4px" }}>
          <span class="eyebrow">WORKTREES · {worktrees().length}</span>
          <button
            class="btn ghost"
            style={{ "font-size": "10px", padding: "1px 8px" }}
            onClick={() => {
              setWtErr(undefined);
              setWtBase(g().branch);
              setWtFormOpen(!wtFormOpen());
            }}
          >
            + 워크트리
          </button>
        </div>
        <Show when={wtFormOpen()}>
          <div class="card inset" style={{ padding: "8px", display: "flex", "flex-direction": "column", gap: "4px" }}>
            <input
              class="mono"
              style={{ "font-size": "11px", padding: "2px 6px" }}
              placeholder="이름 → .eqmux/worktrees/<이름> · 브랜치 eqmux/<이름>"
              value={wtName()}
              onInput={(e) => setWtName(e.currentTarget.value)}
            />
            <div style={{ display: "flex", gap: "4px" }}>
              <select
                style={{ flex: 1, "font-size": "11px" }}
                title="분기 기준 ref (start-from)"
                value={wtBase()}
                onChange={(e) => setWtBase(e.currentTarget.value)}
              >
                <option value="">HEAD (현재)</option>
                <For each={branches()}>{(b) => <option value={b.name}>{b.name}</option>}</For>
              </select>
              <button class="btn primary" style={{ "font-size": "10px" }} disabled={!wtName().trim() || wtBusy()} onClick={() => void createWorktree()}>
                {wtBusy() ? "생성 중…" : "생성"}
              </button>
            </div>
            <Show when={wtErr()}>
              <div class="mono st-dead" style={{ "font-size": "10px" }}>
                {wtErr()}
              </div>
            </Show>
          </div>
        </Show>
        <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
          <For each={worktrees()}>
            {(wt) => (
              <div class="card inset" style={{ padding: "5px 8px", display: "flex", "align-items": "center", gap: "6px" }}>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div class="mono" style={{ "font-size": "11px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    {wtLabel(wt)}
                  </div>
                  <div class="mono muted" style={{ "font-size": "9px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }} title={wt.path}>
                    {wtTail(wt.path)} · {wt.head}
                  </div>
                </div>
                <Show when={wt.isMain}>
                  <span class="badge blue">MAIN</span>
                </Show>
                <Show when={wt.isSession && !wt.isMain}>
                  <span class="badge purple" title="앱이 만든 워크트리 (.eqmux/worktrees/)">
                    세션
                  </span>
                </Show>
                <Show when={!wt.isSession && !wt.isMain}>
                  <span class="badge" title="외부에서 만든 워크트리 — 순수 git 호환">
                    외부
                  </span>
                </Show>
                <Show when={!wt.isMain}>
                  <button
                    class="btn ghost"
                    style={{ "font-size": "10px", padding: "1px 8px" }}
                    title="이 워크트리에서 기본 터미널 열기 — 역할 부여는 세션 상세에서"
                    onClick={() => openShell(wt)}
                  >
                    셸 열기
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="muted" style={{ "font-size": "10px" }}>
          삭제는 제공하지 않습니다 — 머지·정리는 사람 몫 (FR-E-64) · <span class="mono">git worktree remove</span>
        </div>
      </Show>

      <Eyebrow>COMMIT GRAPH</Eyebrow>
      <div class="gitp-commits">
        <For each={g().commits}>
          {(c, i) => (
            <div class="gitp-commit">
              <div class="gitp-graph">
                <div class="gitp-line" classList={{ first: i() === 0, last: i() === g().commits.length - 1 }} />
                <div class="gitp-dot" />
              </div>
              <div class="gitp-commit-body">
                <div class="gitp-commit-msg">
                  <Show when={c.badge}>
                    <span class="badge blue">{c.badge}</span>
                  </Show>
                  <span>{c.message}</span>
                </div>
                <div class="mono muted" style={{ "font-size": "10px" }}>
                  {c.author} · {c.when} · {c.hash}
                </div>
              </div>
            </div>
          )}
        </For>
        <Show when={g().commits.length === 0}>
          <div class="muted" style={{ "font-size": "11px", padding: "8px" }}>
            커밋이 없습니다
          </div>
        </Show>
      </div>

      <button class="card gitp-diff-cta" onClick={openDiff}>
        <span>{g().changed}개 변경 파일을 3분할 diff로 검토</span>
        <span class="mono">→</span>
      </button>
    </div>
  );
}
