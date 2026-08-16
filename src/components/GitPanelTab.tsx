// git 패널 (PAlmZ) — 타이틀바 + 저장소·브랜치 툴바 + 커밋 그래프 + 워크트리·체크아웃 (M36).
// Tauri에서는 활성 워크스페이스의 저장소를 실측한다 (PRD H).
// M36 개방 범위는 커밋 이력을 바꾸지 않는 작업 트리 조작뿐이다 — 브랜치 체크아웃(2단 확인,
// FR-E-52와 같은 패턴)·워크트리 목록/생성/셸 열기. 워크트리 삭제(FR-E-64 — 정리는 사람 몫)는
// 계속 두지 않는다. pull·push·commit 버튼(UI 리파인 §git)은 실행하지 않는다 — 명령을
// 클립보드에 복사할 뿐, 실행은 터미널에서 사람이 한다 (G7 유지).
// UI 리파인 §git: 카드 스택 → 한 줄 툴바 · 밀도 높은 커밋 행(뱃지 복수 + 우측 메타) ·
// 커밋 행 클릭 = 부모 커밋 ↔ 이 커밋 diff · 워크트리는 한 줄 스트립.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { branchList, gitOverview, worktreeAdd, worktreeAttach, worktreeList } from "../backend/git";
import type { BranchInfo, GitOverview, WorktreeInfo } from "../backend/git";
import { GIT_STATE, backend } from "../backend/mock";
import { clipWriteText, isTauri } from "../backend/pty";
import { checkoutBranch } from "../backend/workspaces";
import { t, tf } from "../i18n";
import { defaultShell, scopeWorkspace, setPanelOpen, setView, tick, view } from "../state";
import { ContextMenu, Eyebrow } from "./ui";

interface CommitRow {
  hash: string;
  message: string;
  author: string;
  when: string;
  badges: string[];
}

/** refs 장식("HEAD -> main, origin/main, tag: v1")을 뱃지 목록으로 — 레퍼런스처럼 복수 표시, 3개까지 */
function refBadges(refs: string): string[] {
  return refs
    .split(",")
    .map((s) => s.trim().replace(/^HEAD -> /, ""))
    .filter((s) => s && s !== "HEAD")
    .slice(0, 3);
}

export function GitPanelTab() {
  // 스코프 = 현재 워크스페이스 문맥 (state.scopeWorkspace — 대화·임무 탐색기와 같은 단일 소스)
  const ws = () => {
    const scoped = scopeWorkspace();
    return scoped && !scoped.pathMissing ? scoped : undefined;
  };

  const [real, setReal] = createSignal<GitOverview | undefined>(undefined);
  const [failed, setFailed] = createSignal(false);
  const [branches, setBranches] = createSignal<BranchInfo[]>([]);
  const [worktrees, setWorktrees] = createSignal<WorktreeInfo[]>([]);

  let loadReq = 0; // 워크스페이스 전환·10초 폴링의 늦은 응답이 현재 저장소 표시를 덮지 않게
  const load = async () => {
    const target = ws();
    if (!target || target.pathMissing) {
      setReal(undefined);
      setFailed(false); // 스코프 없음은 읽기 실패가 아니다 — 이전 워크스페이스의 실패 표시를 지운다
      return;
    }
    const req = ++loadReq;
    const o = await gitOverview(target.path);
    if (req !== loadReq) return; // 그새 워크스페이스가 바뀌었다
    setReal(o);
    setFailed(o === undefined);
    const [b, wt] = [await branchList(target.path), await worktreeList(target.path)];
    if (req !== loadReq) return;
    setBranches(b ?? []);
    setWorktrees(wt ?? []);
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
      setCoNote(t("브라우저 dev — 실제 체크아웃 없음"));
      return;
    }
    try {
      await checkoutBranch(target.path, branch);
      setCoNote(tf("⎇ {branch} 체크아웃 완료 — 공유 세션 전체에 적용됨", { branch }));
      setBranchMenu(false);
      setNewBranch("");
      await load();
    } catch (err) {
      setCoNote(tf("체크아웃 실패 — {err}", { err: String(err) }));
    }
  };

  // ── 워크트리 (M36) — 목록·생성·셸 열기. 삭제는 없다 (FR-E-64 — 정리는 사람 몫).
  // "기존 브랜치" 모드(레일 §워크트리)는 새 브랜치 없이 그 브랜치를 체크아웃해 연결한다 ──
  const [wtFormOpen, setWtFormOpen] = createSignal(false);
  const [wtMode, setWtMode] = createSignal<"new" | "attach">("new");
  const [wtName, setWtName] = createSignal("");
  const [wtBase, setWtBase] = createSignal("");
  const [wtAttachBranch, setWtAttachBranch] = createSignal("");
  const [wtBusy, setWtBusy] = createSignal(false);
  const [wtErr, setWtErr] = createSignal<string | undefined>(undefined);
  /** 연결 가능한 브랜치 — 로컬이면서 어떤 워크트리에도 체크아웃돼 있지 않은 것 (git: 같은 브랜치는 한 트리에만) */
  const attachable = () => branches().filter((b) => !b.remote && !worktrees().some((wt) => wt.branch === b.name));
  const createWorktree = async () => {
    const target = ws();
    const attach = wtMode() === "attach";
    if (!isTauri() || !target || (attach ? !wtAttachBranch() : !wtName().trim())) return;
    setWtErr(undefined);
    setWtBusy(true);
    try {
      if (attach) await worktreeAttach(target.path, wtAttachBranch());
      else await worktreeAdd(target.path, wtName().trim(), wtBase() || undefined);
      setWtFormOpen(false);
      setWtName("");
      setWtBase("");
      setWtAttachBranch("");
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
        commits: r.commits.map<CommitRow>((c) => ({ ...c, badges: refBadges(c.refs) })),
        real: true,
      };
    }
    if (isTauri()) {
      // 워크스페이스 문맥 없음 · 읽기 실패 — 목 데이터를 실물처럼 보여주지 않는다 (빈 상태가 정직하다)
      return {
        repo: ws()?.name ?? "—",
        branch: "—",
        ahead: 0,
        behind: 0,
        changed: 0,
        added: 0,
        modified: 0,
        deleted: 0,
        commits: [] as CommitRow[],
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
      commits: GIT_STATE.commits.map<CommitRow>((c) => ({ ...c, badges: c.tag ? [c.tag] : [] })),
      real: false,
    };
  };

  const openDiff = () => {
    // 진입 시점 뷰를 기억한다 — diff의 ✕/Esc가 관제 센터가 아니라 여기로 복귀한다 (U11)
    const cur = view();
    setView({ kind: "gitdiff", wsId: ws()?.id, back: cur.kind === "gitdiff" ? cur.back : cur });
    setPanelOpen(false);
  };

  /** 커밋 행 클릭 (UI 리파인 §git) — 부모 커밋 ↔ 이 커밋 비교로 진입. 복귀 규칙은 openDiff와 동일 (U11) */
  const openCommitDiff = (c: CommitRow) => {
    const cur = view();
    setView({
      kind: "gitdiff",
      wsId: ws()?.id,
      commit: { hash: c.hash, message: c.message },
      back: cur.kind === "gitdiff" ? cur.back : cur,
    });
    setPanelOpen(false);
  };

  // ── pull·push·commit 버튼 (UI 리파인 §git) — 실행하지 않는다. 명령 복사 + 터미널 안내 (G7 유지) ──
  const [actNote, setActNote] = createSignal<string | undefined>(undefined);
  let actTimer: ReturnType<typeof setTimeout> | undefined;
  const copyCmd = (cmd: string) => {
    void clipWriteText(cmd);
    clearTimeout(actTimer);
    setActNote(tf("`{cmd}` 복사됨 — 실행은 터미널에서 (G7)", { cmd }));
    actTimer = setTimeout(() => setActNote(undefined), 3000);
  };

  // ── 저장소 드롭다운 (UI 리파인 §git) — 워크스페이스 전환 = 패널 스코프 전환 ──
  const [repoMenu, setRepoMenu] = createSignal(false);
  const repoChoices = () => {
    tick();
    return backend.listWorkspaces().filter((w) => !w.pathMissing);
  };

  // 커밋 행 우클릭 메뉴 (UI 리파인 §06)
  const [cmMenu, setCmMenu] = createSignal<{ x: number; y: number; c: CommitRow } | undefined>(undefined);

  return (
    <div class="gitp">
      {/* 타이틀바 (UI 리파인 §git) — 아이콘+제목 왼쪽 · 출처·새로 읽기 오른쪽. 경로는 툴팁으로 */}
      <div class="gitp-titlebar">
        <span class="gitp-git-ic" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" />
          </svg>
        </span>
        <span class="panel-title">git</span>
        <span class="mono muted gitp-src" title={ws()?.path ?? ""}>
          {t(g().real ? "실측" : "목 데이터")}
        </span>
        <span style={{ flex: 1 }} />
        <button class="btn ghost gitp-refresh" title={t("새로 읽기")} onClick={() => void load()}>
          ⟳
        </button>
      </div>

      <Show when={isTauri() && (failed() || !ws())}>
        <div class="card conn-error mono" style={{ "font-size": "11px" }}>
          {t(ws() ? "저장소를 읽을 수 없습니다 — git 저장소가 아니거나 git CLI가 없습니다" : "워크스페이스 문맥이 없습니다 — 워크스페이스 탭을 먼저 여세요")}
        </div>
      </Show>

      {/* 저장소 드롭다운 (UI 리파인 §git) — 풀폭. 항목 선택 = 그 워크스페이스로 전환 (스코프 단일 소스 유지) */}
      <div class="gitp-repo-wrap">
        <button
          class="card inset gitp-repo mono"
          style={{ cursor: "pointer" }}
          title={ws()?.path ?? t("저장소 = 활성 워크스페이스")}
          onClick={() => setRepoMenu(!repoMenu())}
        >
          <span>{g().repo}</span>
          <span class="muted">▾</span>
        </button>
        <Show when={repoMenu()}>
          <div class="card gitp-pop">
            <For each={repoChoices()}>
              {(w) => (
                <button
                  class="btn ghost mono"
                  style={{ "justify-content": "flex-start", "font-size": "11px", padding: "2px 6px", display: "flex", gap: "6px" }}
                  title={w.path}
                  onClick={() => {
                    setRepoMenu(false);
                    if (w.id !== ws()?.id) setView({ kind: "workspace", id: w.id });
                  }}
                >
                  <span>{w.id === ws()?.id ? "●" : "○"}</span>
                  <span style={{ flex: 1, "text-align": "left" }}>{w.name}</span>
                </button>
              )}
            </For>
            <div class="muted" style={{ "font-size": "10px" }}>
              {t("저장소 선택 = 워크스페이스 전환 — 패널 스코프가 함께 바뀝니다")}
            </div>
          </div>
        </Show>
      </div>

      {/* 한 줄 툴바 (UI 리파인 §git) — 브랜치 ▾ · ↑↓ · diff · pull · commit · push.
          브랜치 체크아웃(M36)은 팝오버, pull·push·commit은 명령 복사뿐 (G7 유지) */}
      <div class="gitp-toolbar">
        <div class="gitp-branch-wrap">
          <button
            class="card inset gitp-branch mono"
            style={{ cursor: "pointer", "text-align": "left" }}
            title={t("브랜치 체크아웃 (M36) — 공유 repo 전체에 적용, 2단 확인")}
            onClick={() => {
              setBranchMenu(!branchMenu());
              setCoArm(undefined);
            }}
          >
            <span class="gitp-branch-name">⎇ {g().branch}</span>
            <span class="muted">▾</span>
          </button>
        </div>
        <span class="mono gitp-sync" title={t("업스트림 대비 ahead / behind")}>
          <span class="st-waiting">↑{g().ahead}</span> <span class="muted">↓{g().behind}</span>
        </span>
        <span style={{ flex: 1 }} />
        <button
          class="gitp-act mono"
          title={tf("{n}개 변경 파일 — +{a} ~{m} −{d} · HEAD ↔ 워크트리 나란히 비교", { n: g().changed, a: g().added, m: g().modified, d: g().deleted })}
          onClick={openDiff}
        >
          diff
          <Show when={g().changed > 0}>
            <span class="n">{g().changed}</span>
          </Show>
        </button>
        <button class="gitp-act mono" title={t("`git pull` 복사 — 실행은 터미널에서 (G7)")} onClick={() => copyCmd("git pull")}>
          ↓ pull
        </button>
        <button
          class="gitp-act mono"
          title={t("`git add -A && git commit` 복사 — 실행은 터미널에서 (G7)")}
          onClick={() => copyCmd("git add -A && git commit")}
        >
          commit
        </button>
        <button class="gitp-act mono" title={t("`git push` 복사 — 실행은 터미널에서 (G7)")} onClick={() => copyCmd("git push")}>
          ↑ push
          <Show when={g().ahead > 0}>
            <span class="n">{g().ahead}</span>
          </Show>
        </button>
        <Show when={branchMenu()}>
          <div class="card gitp-pop">
            <For each={branches()}>
              {(b) => (
                <button
                  class="btn ghost mono"
                  classList={{ danger: coArm() === b.name }}
                  style={{ "justify-content": "flex-start", "font-size": "11px", padding: "2px 6px", display: "flex", gap: "6px" }}
                  disabled={b.current}
                  title={b.remote ? t("원격 브랜치 — 체크아웃하면 추적 브랜치가 만들어집니다") : ""}
                  onClick={() => void doCheckout(b.name)}
                >
                  <span>{b.current ? "●" : coArm() === b.name ? "⚠" : "○"}</span>
                  <span style={{ flex: 1, "text-align": "left" }}>
                    {coArm() === b.name ? tf("{name} — 공유 repo 전환 확정?", { name: b.name }) : b.name}
                  </span>
                  <Show when={b.remote}>
                    <span class="badge">{t("원격")}</span>
                  </Show>
                </button>
              )}
            </For>
            <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
              <input
                class="mono"
                style={{ flex: 1, "font-size": "11px", padding: "2px 6px" }}
                placeholder={t("새 브랜치 이름 — checkout -b")}
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
                {coArm() === newBranch().trim() && newBranch().trim() ? t("확정?") : t("생성·전환")}
              </button>
            </div>
            <div class="muted" style={{ "font-size": "10px" }}>
              {t("공유 repo의 현재 브랜치를 바꿉니다 — 워크트리 세션은 영향 없음 (FR-E-52)")}
            </div>
          </div>
        </Show>
      </div>
      {/* 체크아웃 결과·명령 복사 안내 — 한 줄 공유 (최신 것 하나만) */}
      <Show when={coNote() ?? actNote()}>
        <div class="mono muted" style={{ "font-size": "10px" }}>
          {coNote() ?? actNote()}
        </div>
      </Show>

      {/* 워크트리 (M36 — orca식 안전 범위) — 생성 폼은 팝오버, 라벨은 텍스트 (시안 §05) */}
      <Show when={isTauri() && worktrees().length > 0}>
        <div class="gitp-wt-head">
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
              {t("+ 워크트리")}
            </button>
          </div>
          <Show when={wtFormOpen()}>
            <div class="card gitp-pop">
              {/* 모드 — 새 브랜치를 만들거나, 이미 있는 브랜치를 트리에 연결하거나 (레일 §워크트리) */}
              <div class="wt-mode-toggle">
                <button classList={{ on: wtMode() === "new" }} onClick={() => setWtMode("new")}>
                  {t("새 브랜치")}
                </button>
                <button
                  classList={{ on: wtMode() === "attach" }}
                  onClick={() => {
                    setWtMode("attach");
                    if (!wtAttachBranch()) setWtAttachBranch(attachable()[0]?.name ?? "");
                  }}
                >
                  {t("기존 브랜치")}
                </button>
              </div>
              <Show
                when={wtMode() === "new"}
                fallback={
                  <>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <select
                        style={{ flex: 1, "font-size": "11px" }}
                        title={t("이 브랜치를 체크아웃하는 워크트리를 만든다 — 새 브랜치 없음")}
                        value={wtAttachBranch()}
                        onChange={(e) => setWtAttachBranch(e.currentTarget.value)}
                      >
                        <Show when={attachable().length === 0}>
                          <option value="">{t("연결 가능한 로컬 브랜치 없음")}</option>
                        </Show>
                        <For each={attachable()}>{(b) => <option value={b.name}>{b.name}</option>}</For>
                      </select>
                      <button class="btn primary" style={{ "font-size": "10px" }} disabled={!wtAttachBranch() || wtBusy()} onClick={() => void createWorktree()}>
                        {wtBusy() ? t("연결 중…") : t("연결")}
                      </button>
                    </div>
                    <div class="muted" style={{ "font-size": "10px" }}>
                      {t("체크아웃 중인 브랜치는 목록에서 빠집니다 — 같은 브랜치는 한 트리에만 (git)")}
                    </div>
                  </>
                }
              >
                <input
                  class="mono"
                  style={{ "font-size": "11px", padding: "2px 6px" }}
                  placeholder={t("이름 → .eqmux/worktrees/<이름> · 브랜치 eqmux/<이름>")}
                  value={wtName()}
                  onInput={(e) => setWtName(e.currentTarget.value)}
                />
                <div style={{ display: "flex", gap: "4px" }}>
                  <select
                    style={{ flex: 1, "font-size": "11px" }}
                    title={t("분기 기준 ref (start-from)")}
                    value={wtBase()}
                    onChange={(e) => setWtBase(e.currentTarget.value)}
                  >
                    <option value="">{t("HEAD (현재)")}</option>
                    {/* 커밋 메뉴에서 열면 해시가 기준 ref로 잡힌다 */}
                    <Show when={wtBase() && !branches().some((b) => b.name === wtBase())}>
                      <option value={wtBase()}>{wtBase()} {t("(커밋)")}</option>
                    </Show>
                    <For each={branches()}>{(b) => <option value={b.name}>{b.name}</option>}</For>
                  </select>
                  <button class="btn primary" style={{ "font-size": "10px" }} disabled={!wtName().trim() || wtBusy()} onClick={() => void createWorktree()}>
                    {wtBusy() ? t("생성 중…") : t("생성")}
                  </button>
                </div>
              </Show>
              <Show when={wtErr()}>
                <div class="mono st-dead" style={{ "font-size": "10px" }}>
                  {wtErr()}
                </div>
              </Show>
            </div>
          </Show>
        </div>
        {/* 한 줄 스트립 (UI 리파인 §git) — 경로·head는 툴팁으로. 삭제 없음 정책도 툴팁에 담는다 (FR-E-64) */}
        <div class="gitp-wt-list">
          <For each={worktrees()}>
            {(wt) => (
              <div class="gitp-wt" title={tf("{path} · {head} — 삭제는 제공하지 않습니다 (FR-E-64) · git worktree remove", { path: wt.path, head: wt.head })}>
                <span class="mono gitp-wt-name">{wtLabel(wt)}</span>
                <span
                  class="gitp-wt-tag mono"
                  classList={{ main: wt.isMain }}
                  title={t(wt.isMain ? "메인 작업 트리" : wt.isSession ? "앱이 만든 워크트리 (.eqmux/worktrees/)" : "외부에서 만든 워크트리 — 순수 git 호환")}
                >
                  {wt.isMain ? "MAIN" : t(wt.isSession ? "세션" : "외부")}
                </span>
                <span class="mono muted gitp-wt-path">{wtTail(wt.path)}</span>
                <span style={{ flex: 1 }} />
                <Show when={!wt.isMain}>
                  <button
                    class="btn ghost"
                    style={{ "font-size": "10px", padding: "1px 8px" }}
                    title={t("이 워크트리에서 기본 터미널 열기 — 역할 부여는 세션 상세에서")}
                    onClick={() => openShell(wt)}
                  >
                    {t("셸 열기")}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Eyebrow>COMMITS</Eyebrow>
      {/* 밀도 높은 커밋 행 (UI 리파인 §git) — 뱃지+메시지 왼쪽 · 작성자·시간·해시 오른쪽 한 줄.
          클릭 = 부모 커밋 ↔ 이 커밋 diff */}
      <div class="gitp-commits">
        <For each={g().commits}>
          {(c, i) => (
            <div
              class="gitp-commit"
              role="button"
              title={tf("{msg} — 클릭: 부모 커밋과 나란히 비교(diff)", { msg: c.message })}
              onClick={() => openCommitDiff(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCmMenu({ x: e.clientX, y: e.clientY, c });
              }}
            >
              <div class="gitp-graph">
                <div class="gitp-line" classList={{ first: i() === 0, last: i() === g().commits.length - 1 }} />
                <div class="gitp-dot" />
              </div>
              <div class="gitp-commit-main">
                <For each={c.badges}>
                  {(b) => (
                    <span class="gitp-ref mono" classList={{ remote: b.includes("/") }}>
                      {b}
                    </span>
                  )}
                </For>
                <span class="gitp-commit-txt">{c.message}</span>
              </div>
              <div class="gitp-commit-meta mono">
                <span class="gitp-commit-author">{c.author}</span>
                <span>{c.when}</span>
                <span class="gitp-commit-hash">{c.hash}</span>
              </div>
            </div>
          )}
        </For>
        <Show when={g().commits.length === 0}>
          <div class="muted" style={{ "font-size": "11px", padding: "8px" }}>
            {t("커밋이 없습니다")}
          </div>
        </Show>
      </div>

      {/* 정책 고지 1회 — G7. 버튼은 복사만 한다는 것을 여기서 못박는다 */}
      <div class="gitp-foot mono muted">{t("pull · push · commit 버튼은 명령 복사만 — 실행은 터미널에서 (G7)")}</div>

      <Show when={cmMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={`${m().c.hash}${m().c.badges[0] ? ` · ${m().c.badges[0]}` : ""}`}
            onClose={() => setCmMenu(undefined)}
            groups={[
              [
                { label: t("해시 복사"), action: () => clipWriteText(m().c.hash) },
                { label: t("메시지 복사"), action: () => clipWriteText(m().c.message) },
              ],
              [
                // 커밋 기준 diff (UI 리파인 §git) — 행 클릭과 같은 동작. B11의 "워크트리 비교만"은 여기서 풀렸다
                { label: t("부모 커밋과 비교 (diff)"), action: () => openCommitDiff(m().c) },
                { label: t("워크트리 diff 열기"), action: openDiff },
                {
                  label: t("이 커밋에서 워크트리 생성…"),
                  disabled: !isTauri(),
                  action: () => {
                    setWtErr(undefined);
                    setWtMode("new"); // 해시 기준 분기는 새 브랜치 흐름이다
                    setWtBase(m().c.hash);
                    setWtName("");
                    setWtFormOpen(true);
                  },
                },
              ],
              // 메뉴에 없는 것 = 정책상 없는 것 (G7)
              [{ label: t("checkout · revert는 두지 않는다 — 터미널에서"), note: true }],
            ]}
          />
        )}
      </Show>
    </div>
  );
}
