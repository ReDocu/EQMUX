// git 패널 (PAlmZ) — 저장소·브랜치 컨트롤 + 변경 요약 + 커밋 그래프.
// M0 목: 버튼은 이벤트 로그만 남기고, diff는 Git Diff & Editor 화면(AXXhV)으로 연결된다.
import { For, Show } from "solid-js";
import { GIT_STATE } from "../backend/mock";
import { setPanelOpen, setView } from "../state";
import { Eyebrow } from "./ui";

export function GitPanelTab() {
  const g = GIT_STATE;
  const openDiff = () => {
    setView({ kind: "gitdiff" });
    setPanelOpen(false);
  };

  return (
    <div class="gitp">
      <div class="panel-head-row">
        <span class="panel-title">git</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          저장소 1개
        </span>
      </div>

      <button class="card inset gitp-repo mono" title="저장소 선택 (목)">
        <span>{g.repo}</span>
        <span class="muted">▾</span>
      </button>

      <div class="gitp-branch-row">
        <button class="card inset gitp-branch mono" title="브랜치 선택 (목)">
          <span>{g.branch}</span>
          <span class="muted">▾</span>
        </button>
        <span class="mono gitp-sync">
          <span class="st-waiting">↑{g.ahead}</span> <span class="muted">↓{g.behind}</span>
        </span>
      </div>

      <div class="gitp-actions">
        <button class="btn" onClick={openDiff}>
          diff
        </button>
        <button class="btn">↓ pull</button>
        <button class="btn">commit {g.changed}</button>
        <button class="btn primary">↑ push {g.ahead}</button>
      </div>

      <div class="gitp-summary">
        <For
          each={[
            { v: g.changed, k: "변경" },
            { v: g.added, k: "추가" },
            { v: g.modified, k: "수정" },
            { v: g.deleted, k: "삭제" },
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
        <For each={g.commits}>
          {(c, i) => (
            <div class="gitp-commit">
              <div class="gitp-graph">
                <div class="gitp-line" classList={{ first: i() === 0, last: i() === g.commits.length - 1 }} />
                <div class="gitp-dot" />
              </div>
              <div class="gitp-commit-body">
                <div class="gitp-commit-msg">
                  <Show when={c.tag}>
                    <span class="badge blue">{c.tag}</span>
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
      </div>

      <button class="card gitp-diff-cta" onClick={openDiff}>
        <span>{g.changed}개 변경 파일을 3분할 diff로 검토</span>
        <span class="mono">→</span>
      </button>
    </div>
  );
}
