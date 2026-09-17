import { describe, expect, it } from "vitest";
import { markdownHtml } from "./markdownHtml";

describe("markdownHtml", () => {
  it("블록·인라인 구문을 태그로 바꾼다", () => {
    const html = markdownHtml("# T\n\n> q\n> r\n\n- a **b**\n- [x] done\n\n3. x\n\n```ts\nlet a = 1;\n```\n\n| h |\n|---|\n| c |\n\n---\n");
    expect(html).toContain("<h1> T</h1>");
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
});
