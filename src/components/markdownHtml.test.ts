import { describe, expect, it } from "vitest";
import { markdownHtml } from "./markdownHtml";

describe("markdownHtml", () => {
  it("블록·인라인 구문을 태그로 바꾼다", () => {
    const html = markdownHtml("# T\n\n> q\n> r\n\n- a **b**\n- [x] done\n\n3. x\n\n```ts\nlet a = 1;\n```\n\n| h |\n|---|\n| c |\n\n---\n");
    expect(html).toContain('<h1 id="t"> T</h1>');
    expect(html).toContain("<blockquote><p>q\n r</p></blockquote>");
    expect(html).toContain("<ul><li><p>a <strong>b</strong></p></li><li><input type=\"checkbox\" disabled checked> done</li></ul>");
    expect(html).toContain('<ol start="3"><li><p>x</p></li></ol>');
    expect(html).toContain('<pre><code class="lang-ts">let a = 1;</code></pre>');
    expect(html).toContain("<table><thead><tr><th>h</th></tr></thead><tr><td>c</td></tr></table>");
    expect(html).toContain("<hr>");
  });

  it("원문 HTML은 글자로만 남고 링크는 안전한 스킴만 통과한다", () => {
    const html = markdownHtml('text <script>x()</script> [a](javascript:alert(1)) [b](http://x) ~~d~~ &amp; \*');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="">a</a>');
    expect(html).toContain('<a href="http://x">b</a>');
    expect(html).toContain("<del>d</del> &amp; *");
  });

  it("제목에 앵커 id를 달고, 상대 경로 그림은 파일 링크로 남긴다 (B242)", () => {
    const html = markdownHtml("## 설치 방법!\n\n## 설치 방법\n\nSetext\n---\n\n![shot](docs/a.png) ![w](https://x/a.png)");
    expect(html).toContain('<h2 id="설치-방법"> 설치 방법!</h2>');
    expect(html).toContain('<h2 id="설치-방법-1">');
    expect(html).toContain('<h2 id="setext">');
    expect(html).toContain('<a href="docs/a.png" class="md-img">🖼 shot</a>');
    expect(html).toContain('<img alt="w" src="https://x/a.png">');
  });

  it("제목 앵커는 링크 주소 · 강조 기호를 뺀 보이는 글자로 만든다 — GitHub와 같게 (B263)", () => {
    const html = markdownHtml("## [EQMUX](https://x.io) 소개\n\n### **굵게** `code` 끝 ##\n\nA <b>b</b>\n===\n");
    expect(html).toContain('<h2 id="eqmux-소개">');
    expect(html).toContain('<h3 id="굵게-code-끝">');
    expect(html).toContain('<h1 id="a-b">');
  });
});
