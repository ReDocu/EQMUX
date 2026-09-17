// technical-guide.md → docs/technical-guide.html (독립 파일, mermaid는 jsdelivr CDN에서 로드)
// 선택 인자 3개: [md 경로] [html 출력] [본문만 담은 HTML 출력(선택)]
import { readFileSync, writeFileSync } from "node:fs";
import { Marked } from "marked";

// 사용: 저장소 루트에서  npm i --no-save marked && node docs/tools/build-guide.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const mdPath = process.argv[2] ?? join(here, "..", "technical-guide.md");
const outDoc = process.argv[3] ?? join(here, "..", "technical-guide.html");
const outArtifact = process.argv[4] ?? null;
let md = readFileSync(mdPath, "utf8");

// 사이드바 TOC가 대신하므로 본문의 "## 목차" 절은 뺀다
md = md.replace(/## 목차\n[\s\S]*?\n---\n/, "---\n");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GitHub 방식 슬러그 (한글 유지)
const seen = new Map();
function slug(text) {
  let s = text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
  const n = seen.get(s) ?? 0;
  seen.set(s, n + 1);
  return n ? `${s}-${n}` : s;
}

const toc = []; // {depth, id, text}
const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  renderer: {
    heading({ tokens, depth, text }) {
      const html = this.parser.parseInline(tokens);
      const id = slug(text);
      const plain = html.replace(/<[^>]+>/g, "");
      if (depth === 2 || depth === 3) toc.push({ depth, id, text: plain });
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
    },
    code({ text, lang }) {
      if (lang === "mermaid") return `<figure class="diagram"><pre class="mermaid">${esc(text)}</pre></figure>\n`;
      return `<pre class="code"><code class="lang-${esc(lang || "text")}">${esc(text)}</code></pre>\n`;
    },
  },
});

let body = marked.parse(md);
body = body.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

// 첫 h1 + 인용문을 헤더로 뽑는다
const h1 = /<h1 id="([^"]+)">.*?<\/h1>\n/s.exec(body);
body = body.replace(h1[0], "");
const intro = /^<blockquote>[\s\S]*?<\/blockquote>\n/.exec(body);
body = body.replace(intro[0], "");

const tocHtml = toc
  .map((t) => `<li class="d${t.depth}"><a href="#${t.id}">${t.text}</a></li>`)
  .join("\n");

const css = readFileSync(new URL("./guide.css", import.meta.url), "utf8");
const js = readFileSync(new URL("./guide.js", import.meta.url), "utf8");

const page = (withMermaidLib) => `<title>EQMUX 기술 가이드</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${css}
</style>
<div class="shell">
  <header class="top">
    <div class="brand"><span class="mark">EQMUX</span><span class="sep">/</span><span>기술 가이드</span></div>
    <div class="meta"><span class="chip">v0.3.8</span><span class="chip mono">e422965</span><span class="chip">2026-09-06 기준</span></div>
  </header>
  <div class="cols">
    <nav class="toc" aria-label="목차">
      <div class="toc-title">목차</div>
      <ul>
${tocHtml}
      </ul>
    </nav>
    <main class="doc">
      <h1>EQMUX 기술 가이드 <small>내부 시스템 · UML · 유지보수</small></h1>
      ${intro[0].replace("<blockquote>", '<blockquote class="lede">')}
      ${body}
      <footer class="foot">원본: <code>docs/technical-guide.md</code> · 이 HTML은 원본에서 생성된 사본이며, 수정은 Markdown에서 한다.</footer>
    </main>
  </div>
</div>
${withMermaidLib ? '<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>' : ""}
<script>
${js}
${withMermaidLib ? "initMermaid();" : ""}
</script>
`;

writeFileSync(
  outDoc,
  `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${page(true).replace(/<\/style>\n/, "</style>\n</head>\n<body>\n")}\n</body>\n</html>\n`,
  "utf8"
);
if (outArtifact) writeFileSync(outArtifact, page(false), "utf8");
console.log(`toc entries: ${toc.length}, body bytes: ${body.length}`);
