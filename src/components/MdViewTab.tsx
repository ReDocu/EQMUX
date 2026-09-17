// MDView 패널 — 워크스페이스의 마크다운 파일을 읽어 렌더링한다 (브라우저 탭 옆).
// 파일 후보는 탐색기와 같은 fs_tree 실측(깊이 3 · 400개 상한)에서 .md만 추려 datalist로 제안하고,
// 그 밖의 파일은 상대 경로를 직접 입력해 연다. 읽기는 fs_read(워크스페이스 밖 거부 · 1MB 상한 ·
// UTF-8만)를 그대로 쓴다 — 여기서 파일을 따로 열지 않는다.
// 본문 링크는 가로챈다 — 웹뷰가 앱 화면째 이동해 버리므로 http는 브라우저 패널로, .md는 이 패널로.
import { createResource, createSignal, For, Show } from "solid-js";
import { fsRead, fsTree } from "../backend/panels";
import { isTauri } from "../backend/pty";
import { openInBrowserPanel, scopeWorkspace } from "../state";
import { t } from "../i18n";
import { markdownHtml } from "./markdownHtml";

const MD_RE = /\.(md|markdown|mdx)$/i;

// 탭을 오가도 열린 문서가 남게 모듈 스코프
const [rel, setRel] = createSignal("");
const [html, setHtml] = createSignal("");
const [error, setError] = createSignal<string | null>(null);

/** 현재 문서 기준 상대 링크 → 워크스페이스 상대 경로 (`/`로 시작하면 루트 기준) */
function resolveRel(from: string, href: string): string {
  const out = href.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const seg of href.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

export function MdViewTab() {
  const ws = () => scopeWorkspace();
  const [files, { refetch }] = createResource(
    () => ws()?.path,
    async (path) =>
      (await fsTree(path))?.nodes.filter((n) => !n.dir && MD_RE.test(n.name)).map((n) => n.rel) ?? [],
  );

  const open = async (target: string) => {
    const path = ws()?.path;
    const r = target.trim().replace(/\\/g, "/");
    if (!path || !r) return;
    if (!isTauri()) {
      setError(t("목 모드에서는 파일을 읽을 수 없습니다 — 앱에서 실행하세요"));
      return;
    }
    try {
      const fc = await fsRead(path, r);
      setRel(r);
      setHtml(markdownHtml(fc.text));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = (a.getAttribute("href") ?? "").split("#")[0];
    if (/^https?:/i.test(href)) openInBrowserPanel(href);
    else if (MD_RE.test(href)) void open(resolveRel(rel(), href));
  };

  return (
    <div class="browserp">
      <div class="panel-head-row">
        <span class="panel-title">MDView</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {ws()?.name ?? t("워크스페이스 탭을 먼저 여세요")}
        </span>
      </div>

      <div class="card inset browserp-url mono">
        <input
          list="mdview-files"
          style={{ flex: 1, "min-width": 0, background: "transparent", border: "none", color: "inherit" }}
          placeholder={t("상대 경로 — Enter로 열기 (docs/guide.md)")}
          value={rel()}
          onChange={(e) => void open(e.currentTarget.value)}
        />
        <datalist id="mdview-files">
          <For each={files() ?? []}>{(f) => <option value={f} />}</For>
        </datalist>
        <button
          class="browserp-navbtn"
          title={t("새로고침")}
          onClick={() => {
            void refetch();
            void open(rel());
          }}
        >
          ⟳
        </button>
      </div>
      <Show when={error()}>
        <div style={{ color: "var(--eq-red, #ef6b73)", "font-size": "11px" }}>{error()}</div>
      </Show>

      <Show
        when={rel()}
        fallback={
          <div class="card inset browserp-view">
            <div class="muted" style={{ "text-align": "center" }}>
              <div style={{ "font-size": "22px", "margin-bottom": "8px" }}>≡</div>
              {t("마크다운 파일 보기")}
              <div class="mono" style={{ "font-size": "10px", "margin-top": "6px" }}>
                {t("워크스페이스의 .md 파일을 고르거나 상대 경로를 입력하세요")}
              </div>
            </div>
          </div>
        }
      >
        <div class="card inset mdview-body" innerHTML={html()} onClick={onClick} />
      </Show>
    </div>
  );
}
