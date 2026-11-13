// MDView 패널 — 워크스페이스의 마크다운 파일을 읽어 렌더링한다 (브라우저 탭 옆).
// 파일 후보는 탐색기와 같은 fs_tree 실측(깊이 3 · 400개 상한)에서 .md만 추려 datalist로 제안하고,
// 그 밖의 파일은 상대 경로를 직접 입력해 연다. 읽기는 fs_read(워크스페이스 밖 거부 · 1MB 상한 ·
// UTF-8만)를 그대로 쓴다 — 여기서 파일을 따로 열지 않는다.
// 본문 링크는 가로챈다 — 웹뷰가 앱 화면째 이동해 버리므로 http는 브라우저 패널로, .md는 이 패널로.
import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { fsRead, fsTree } from "../backend/panels";
import { clipWriteText, isTauri, revealPath } from "../backend/pty";
import { openInBrowserPanel, openPanel, scopeWorkspace, setPanelNote } from "../state";
import { t, tf } from "../i18n";
import { fileManagerName } from "../labels"; // mac은 Finder (U76)
import { Icon } from "./icons";
import { markdownHtml } from "./markdownHtml";
import { setExplorerPick } from "./MissionExplorerTab";
import { notify } from "./ui";

const MD_RE = /\.(md|markdown|mdx)$/i;

// 탭을 오가도 열린 문서가 남게 모듈 스코프
const [rel, setRel] = createSignal("");
const [html, setHtml] = createSignal("");
const [error, setError] = createSignal<string | null>(null);
// 문서를 연 워크스페이스 (B243) — 다른 워크스페이스로 옮기면 이전 문서를 비운다
const [docWs, setDocWs] = createSignal<string | undefined>(undefined);

/** 현재 문서 기준 상대 링크 → 워크스페이스 상대 경로 (`/`로 시작하면 루트 기준) */
export function resolveRel(from: string, href: string): string {
  const out = href.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const seg of href.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

/** 마크다운 본문(.mdview-body) 링크 클릭을 가로챈다 — 웹뷰가 앱 화면째 이동해 버리므로 (B250, 스킬 미리보기도 쓴다).
 *  앵커는 본문 안 제목으로 스크롤, http는 브라우저 패널, mailto는 복사. 상대 링크는 onRel이 연다 */
export function mdLinkClick(e: MouseEvent, onRel: (href: string) => void): void {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const raw = a.getAttribute("href") ?? "";
  // 같은 문서 앵커 — 제목 id로 스크롤 (B242). '#50%'처럼 깨진 인코딩은 원문으로 찾는다 (B263)
  if (raw.startsWith("#")) {
    let id = raw.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* 원문 그대로 */
    }
    a.closest(".mdview-body")?.querySelector(`[id="${CSS.escape(id.toLowerCase())}"]`)?.scrollIntoView({ block: "start" });
    return;
  }
  const href = raw.split("#")[0];
  if (/^https?:/i.test(href)) openInBrowserPanel(href);
  else if (/^mailto:/i.test(href)) {
    // 앱은 http(s)만 밖으로 연다 (launch_web) — 메일 주소는 복사해 준다. 실패하면 실패라고 (B262)
    const addr = href.slice(7);
    void clipWriteText(addr).then((ok) =>
      ok ? notify(tf("메일 주소를 복사했습니다 — {addr}", { addr }), "ok") : notify(t("복사하지 못했습니다")),
    );
  } else if (href) onRel(href);
}

export function MdViewTab() {
  const ws = () => scopeWorkspace();
  const [files, { refetch }] = createResource(
    () => ws()?.path,
    async (path) =>
      (await fsTree(path))?.nodes.filter((n) => !n.dir && MD_RE.test(n.name)).map((n) => n.rel) ?? [],
  );

  const open = async (target: string) => {
    // 워크스페이스는 읽기 전에 잡는다 — 읽는 사이 바뀌었으면 결과를 버린다 (B264)
    const wsId = ws()?.id;
    const path = ws()?.path;
    const r = target.trim().replace(/\\/g, "/");
    if (!path || !r) return;
    if (!isTauri()) {
      setError(t("목 모드에서는 파일을 읽을 수 없습니다 — 앱에서 실행하세요"));
      return;
    }
    try {
      const fc = await fsRead(path, r);
      if (ws()?.id !== wsId) return;
      setRel(r);
      setDocWs(wsId);
      setHtml(markdownHtml(fc.text));
      setError(null);
    } catch (e) {
      if (ws()?.id === wsId) setError(String(e));
    }
  };

  // 워크스페이스가 바뀌었으면 이전 문서를 비운다 (B243) — 탭을 떠나 있던 사이에 바뀐 것도 잡는다
  createEffect(() => {
    if (docWs() !== undefined && docWs() !== ws()?.id) {
      setRel("");
      setHtml("");
      setError(null);
      setDocWs(undefined);
    }
  });

  const onClick = (e: MouseEvent) =>
    mdLinkClick(e, (href) => {
      if (MD_RE.test(href)) return void open(resolveRel(rel(), href));
      // .md가 아닌 상대 링크(소스 · 라이선스 · 그림)는 파일 탭에서 연다 (B242)
      setExplorerPick(resolveRel(rel(), href));
      openPanel("files");
    });

  // 세그먼트 줄 오른쪽 요약 (0.5 시안 E7Ixk6) — `docs/ · 42 files`
  createEffect(() => {
    const dir = rel().includes("/") ? `${rel().slice(0, rel().lastIndexOf("/"))}/` : (ws()?.name ?? t("워크스페이스 탭을 먼저 여세요"));
    setPanelNote(tf("{dir} · 파일 {n}개", { dir, n: files()?.length ?? 0 }));
  });
  onCleanup(() => setPanelNote(""));
  const reveal = async () => {
    const w = ws();
    if (w && !(await revealPath(rel() || w.path, w.path))) notify(t("폴더를 열 수 없습니다 — 경로가 없어졌습니다"));
  };

  return (
    <div class="browserp">
      <div class="mdview-head">
      <div class="card inset browserp-url mono">
        <input
          list="mdview-files"
          style={{ flex: 1, "min-width": 0, background: "transparent", border: "none", color: "inherit" }}
          placeholder="docs/guide.md"
          title={t("상대 경로를 입력하고 Enter를 누르면 엽니다")}
          aria-label={t("상대 경로를 입력하고 Enter를 누르면 엽니다")}
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
          <Icon name="refresh-cw" size={12} />
        </button>
      </div>
        <button class="btn" disabled={!ws()} onClick={() => void reveal()}>
          <Icon name="folder-open" size={12} />
          {fileManagerName()}
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
              <div style={{ "margin-bottom": "8px" }}>
                <Icon name="file-text" size={22} />
              </div>
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
