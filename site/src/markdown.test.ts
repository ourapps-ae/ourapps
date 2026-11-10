import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("renders headings one level below the card heading, paragraphs and lists", () => {
    const out = renderMarkdown("# Title\n\nSome **bold** and `code` text.\n\n## Devices\n\n1. First\n2. Second\n\n- one\n- two");
    expect(out).toContain("<h3>Title</h3>");
    expect(out).toContain("<h4>Devices</h4>");
    expect(out).toContain("<p>Some <strong>bold</strong> and <code>code</code> text.</p>");
    expect(out).toContain("<ol><li>First</li><li>Second</li></ol>");
    expect(out).toContain('<ul class="bullets"><li>one</li><li>two</li></ul>');
  });

  it("joins wrapped lines into one paragraph and keeps separate paragraphs apart", () => {
    expect(renderMarkdown("a\nb\n\nc")).toBe("<p>a b</p>\n<p>c</p>");
  });

  it("escapes raw HTML and refuses unsafe links", () => {
    const out = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://ourapps.app/a?b=1&c=2) [rel](/recipes)');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("[x](javascript:alert(1))");
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('<a href="https://ourapps.app/a?b=1&amp;c=2" target="_blank" rel="noopener">ok</a>');
    expect(out).toContain('<a href="/recipes">rel</a>');
  });

  it("renders code fences verbatim and tables", () => {
    expect(renderMarkdown("```\n<b>*x*</b>\n```")).toBe("<pre><code>&lt;b&gt;*x*&lt;/b&gt;</code></pre>");
    const table = renderMarkdown("| a | b |\n|---|---|\n| 1 | **2** |");
    expect(table).toContain("<th>a</th><th>b</th>");
    expect(table).toContain("<td>1</td><td><strong>2</strong></td>");
  });

  it("does not turn code contents or snake_case words into emphasis", () => {
    expect(renderMarkdown("`a*b*c` and snake_case_name")).toBe("<p><code>a*b*c</code> and snake_case_name</p>");
  });
});
