// 마크다운 → HTML — CodeMirror 마크다운 언어의 원천인 lezer 파서(이미 번들에 있음)의 트리를
// 걸으며 태그를 붙인다. 모든 원문 텍스트는 이스케이프되므로 파일 안의 HTML·스크립트는
// 글자로만 남는다 (innerHTML로 꽂아도 안전). 링크는 http(s)·mailto·상대 경로만 통과시킨다.
import { parser, GFM } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

const md = parser.configure([GFM]);

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const safeHref = (h: string) => (/^(https?:|mailto:|[^:]*$)/i.test(h.trim()) ? h.trim() : "");

// 구문 기호 노드 — 출력하지 않는다
const MARKS = new Set([
  "HeaderMark", "QuoteMark", "ListMark", "CodeMark", "CodeInfo", "EmphasisMark", "LinkMark",
  "LinkTitle", "LinkLabel", "StrikethroughMark", "TableDelimiter", "TaskMarker",
  "LinkReference", "CommentBlock", "ProcessingInstructionBlock",
]);
// 자식 사이의 원문(들여쓰기·빈 줄·파이프)을 버리는 블록 컨테이너
const BLOCKS = new Set([
  "Document", "Blockquote", "BulletList", "OrderedList", "ListItem", "Table", "TableHeader", "TableRow",
]);
const TAG: Record<string, string> = {
  Paragraph: "p", ATXHeading1: "h1", ATXHeading2: "h2", ATXHeading3: "h3", ATXHeading4: "h4",
  ATXHeading5: "h5", ATXHeading6: "h6", SetextHeading1: "h1", SetextHeading2: "h2",
  Blockquote: "blockquote", BulletList: "ul", ListItem: "li", Emphasis: "em", StrongEmphasis: "strong",
  Strikethrough: "del", InlineCode: "code", Table: "table", TableRow: "tr",
};

const text = (n: SyntaxNode, src: string) => src.slice(n.from, n.to);

function children(n: SyntaxNode, src: string, skip?: string): string {
  const gaps = !BLOCKS.has(n.name);
  let out = "";
  let pos = n.from;
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (gaps) out += esc(src.slice(pos, c.from));
    if (c.name !== skip) out += walk(c, src);
    pos = c.to;
  }
  return gaps ? out + esc(src.slice(pos, n.to)) : out;
}

function walk(n: SyntaxNode, src: string): string {
  const name = n.name;
  if (MARKS.has(name)) return "";
  switch (name) {
    case "FencedCode":
    case "CodeBlock": {
      const info = n.getChild("CodeInfo");
      const code = n.getChildren("CodeText").map((c) => text(c, src)).join("");
      const cls = info ? ` class="lang-${esc(text(info, src).trim())}"` : "";
      return `<pre><code${cls}>${esc(code)}</code></pre>`;
    }
    case "HorizontalRule":
      return "<hr>";
    case "HardBreak":
      return "<br>";
    case "HTMLBlock":
    case "HTMLTag":
      return esc(text(n, src));
    case "Entity":
      return text(n, src);
    case "Escape":
      return esc(src.slice(n.from + 1, n.to));
    case "URL":
    case "Autolink": {
      const u = n.getChild("URL");
      const href = u ? text(u, src) : text(n, src);
      return `<a href="${esc(safeHref(href))}">${esc(href)}</a>`;
    }
    case "Link": {
      const u = n.getChild("URL");
      return `<a href="${esc(safeHref(u ? text(u, src) : ""))}">${children(n, src, "URL")}</a>`;
    }
    case "Image": {
      const u = n.getChild("URL");
      const m = n.getChildren("LinkMark");
      const alt = m.length > 1 ? src.slice(m[0].to, m[1].from) : "";
      return `<img alt="${esc(alt)}" src="${esc(safeHref(u ? text(u, src) : ""))}">`;
    }
    case "TableHeader":
      return `<thead><tr>${children(n, src)}</tr></thead>`;
    case "TableCell":
      return n.parent?.name === "TableHeader" ? `<th>${children(n, src)}</th>` : `<td>${children(n, src)}</td>`;
    case "OrderedList": {
      const m = n.firstChild?.getChild("ListMark");
      const start = m ? parseInt(text(m, src), 10) : 1;
      return `<ol${start > 1 ? ` start="${start}"` : ""}>${children(n, src)}</ol>`;
    }
    case "Task": {
      const checked = /^\[[xX]\]/.test(text(n, src));
      return `<input type="checkbox" disabled${checked ? " checked" : ""}>${children(n, src)}`;
    }
    default: {
      const tag = TAG[name];
      return tag ? `<${tag}>${children(n, src)}</${tag}>` : children(n, src);
    }
  }
}

export function markdownHtml(src: string): string {
  return walk(md.parse(src).topNode, src);
}
