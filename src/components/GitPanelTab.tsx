// git 패널 (PAlmZ) — 저장소·브랜치 + 변경 요약 + 커밋 그래프.
// Tauri에서는 활성 워크스페이스의 저장소를 실측한다 (PRD H — 읽기 전용).
// pull·push·commit 실행 버튼은 두지 않는다 — 쓰기는 터미널 페인에서 사람이 한다 (G7과 같은 원칙).
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { gitOverview } from "../backend/git";
import type { GitOverview } from "../backend/git";
import { GIT_STATE, backend } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { setPanelOpen, setView, tick, view } from "../state";
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

  onMount(() => {
    if (!isTauri()) return;
    const load = async () => {
      const target = ws();
      if (!target || target.pathMissing) {
        setReal(undefined);
        return;
      }
      const o = await gitOverview(target.path);
      setReal(o);
      setFailed(o === undefined);
    };
    createEffect(on(() => ws()?.id, () => void load()));
    const t = setInterval(() => void load(), 10_000);
    onCleanup(() => clearInterval(t));
  });

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
    setView({ kind: "gitdiff" });
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
        <div class="card inset gitp-branch mono">
          <span>{g().branch}</span>
        </div>
        <span class="mono gitp-sync" title="업스트림 대비 ahead / behind">
          <span class="st-waiting">↑{g().ahead}</span> <span class="muted">↓{g().behind}</span>
        </span>
      </div>

      <div class="gitp-actions">
        <button class="btn" onClick={openDiff}>
          diff
        </button>
        <span class="mono muted" style={{ "font-size": "10px", "align-self": "center" }}>
          pull·push·commit은 터미널에서 — 패널은 관측만
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
