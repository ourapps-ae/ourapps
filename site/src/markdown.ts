// A small, safe Markdown renderer for publisher text (a recipe's About). Everything is HTML-escaped first, so no raw
// HTML or script in the source can survive; only the constructs below produce tags.
// Supported: headings, paragraphs, bulleted and numbered lists, block quotes, fenced code, rules, tables, bold, italic,
// inline code and http(s) or site-relative links.
import { escapeHtml } from "./html.js";

const SAFE_LINK = /^(https?:\/\/|\/(?!\/))/;

function inline(source: string): string {
  const stash: string[] = [];
  let text = escapeHtml(source).replace(/`([^`]+)`/g, (_m, code: string) => {
    stash.push(`<code>${code}</code>`);
    return `\u0000${stash.length - 1}\u0000`;
  });
  text = text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
      const plain = url.replace(/&amp;/g, "&");
      if (!SAFE_LINK.test(plain)) return m;
      const external = /^https?:/.test(plain) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${url}"${external}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?![\w*])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?![\w])/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)]!);
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

const isRule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isTableSeparator = (l: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(l);

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = /^\s*```/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]!.length + 2, 6);
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (isRule(line)) {
      out.push("<hr />");
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") rows.push(cells(lines[i++]!));
      out.push(
        `<table class="table"><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i]!)) {
        let item = lines[i++]!.replace(marker, "");
        while (i < lines.length && lines[i]!.trim() !== "" && /^\s{2,}\S/.test(lines[i]!) && !marker.test(lines[i]!)) item += " " + lines[i++]!.trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul class="bullets">${items.join("")}</ul>`);
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^\s*```/.test(lines[i]!) &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !/^\s*[-*+]\s+/.test(lines[i]!) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]!) &&
      !/^\s*>/.test(lines[i]!) &&
      !isRule(lines[i]!)
    ) {
      paragraph.push(lines[i++]!.trim());
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
}
