// Drawing kit for ourapps diagrams: hand-computed flat-design SVG, no layout engine and no dependencies.
// Style: light background, Material palette, cards with a coloured header band, orthogonal lines only, white
// label pills, a legend in the picture. Every coordinate is computed by the caller from measure(), so text never
// overflows a card. write() fails the build when two cards overlap or a line passes through a card.
// Adapted from the topology kit of the pvxs-cms project (slac).

export const CH = 6.65; // advance of 11px Menlo
export const LH = 15; // line height
export const HDR = 30; // card header band
export const PAD = 12; // card side padding
export const ZTITLE = 44; // zone title strip

export const INK = "#263238";
export const BACKGROUND = "#FAFAFA";
export const MUTED = "#607D8B";

export type Kind = "host" | "rooms" | "game" | "poker" | "ui" | "app" | "part" | "file";
export type Zone = "blue" | "green" | "purple" | "amber" | "pink" | "grey";

// [body, accent]
export const COLOURS: Record<Kind, [string, string]> = {
  host: ["#E3F2FD", "#1E88E5"],
  rooms: ["#E8F5E9", "#43A047"],
  game: ["#EDE7F6", "#5E35B1"],
  poker: ["#FFF3E0", "#FB8C00"],
  ui: ["#FCE4EC", "#AD1457"],
  app: ["#FFEBEE", "#E53935"],
  part: ["#ECEFF1", "#546E7A"],
  file: ["#FFFDE7", "#9E9D24"],
};

export const ZONES: Record<Zone, [string, string]> = {
  blue: ["#E8EAF6", "#3949AB"],
  green: ["#E0F2F1", "#00897B"],
  purple: ["#F3E5F5", "#8E24AA"],
  amber: ["#FFF8E1", "#FFB300"],
  pink: ["#FCE4EC", "#AD1457"],
  grey: ["#ECEFF1", "#546E7A"],
};

// One colour per interface type on a diagram (lines carry the colour of the interface they stand for).
export const LINE_COLOURS = ["#1E88E5", "#43A047", "#FB8C00", "#8E24AA", "#E53935", "#00897B", "#9E9D24", "#AD1457", "#5D4037", "#3949AB", "#546E7A", "#F4511E"];

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The vertical middle of body line `i` of a card whose top is `y`: where a line attaches to that row.
export function rowY(y: number, i: number): number {
  return y + HDR + 8 + 11 + i * LH - 4;
}

export function pillWidth(text: string): number {
  return Math.ceil(text.length * CH + 14);
}

export function measure(title: string, lines: string[]): { w: number; h: number } {
  const w = Math.max(title.length * 7.4 + 52, ...lines.map((l) => l.replace(/^§/, "").length * CH)) + 2 * PAD;
  return { w: Math.ceil(w), h: HDR + 14 + lines.length * LH };
}

// Break text into lines of at most `max` characters, on spaces.
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > max) {
      out.push(line);
      line = word;
    } else line = line ? line + " " + word : word;
  }
  if (line) out.push(line);
  return out;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "\u2026";
}

const N = (n: number) => Math.round(n * 100) / 100;

export const ICONS: Record<string, (x: number, y: number) => string> = {
  host: (x, y) => `<rect x="${x}" y="${y + 2}" width="16" height="10" rx="1.5" fill="none" stroke="white" stroke-width="1.8"/><line x1="${x + 8}" y1="${y + 12}" x2="${x + 8}" y2="${y + 15}" stroke="white" stroke-width="1.8"/><line x1="${x + 4}" y1="${y + 15.5}" x2="${x + 12}" y2="${y + 15.5}" stroke="white" stroke-width="1.8"/>`,
  rooms: (x, y) => `<circle cx="${x + 3}" cy="${y + 13}" r="2.6" fill="white"/><circle cx="${x + 13}" cy="${y + 13}" r="2.6" fill="white"/><circle cx="${x + 8}" cy="${y + 3}" r="2.6" fill="white"/><path d="M ${x + 8} ${y + 3} L ${x + 3} ${y + 13} M ${x + 8} ${y + 3} L ${x + 13} ${y + 13} M ${x + 3} ${y + 13} H ${x + 13}" stroke="white" stroke-width="1.4"/>`,
  game: (x, y) => `<rect x="${x + 1}" y="${y + 4}" width="14" height="9" rx="4" fill="none" stroke="white" stroke-width="1.8"/><path d="M ${x + 5} ${y + 6.5} v4 m-2 -2 h4" stroke="white" stroke-width="1.5" fill="none"/><circle cx="${x + 11}" cy="${y + 8.5}" r="1.2" fill="white"/>`,
  poker: (x, y) => `<path d="M ${x + 8} ${y + 1} c4 4 7 5 7 8 a3.2 3.2 0 0 1 -6 1.2 c0 2 .4 3.4 1.6 4.8 h-5.2 c1.2 -1.4 1.6 -2.8 1.6 -4.8 a3.2 3.2 0 0 1 -6 -1.2 c0 -3 3 -4 7 -8 z" fill="none" stroke="white" stroke-width="1.6" stroke-linejoin="round"/>`,
  ui: (x, y) => `<path d="M ${x + 8} ${y + 1} a7 7 0 1 0 0 14 c1.6 0 2 -1.2 1.2 -2.4 c-.8 -1.2 -.2 -2.6 1.4 -2.6 h2 a2.4 2.4 0 0 0 2.4 -2.4 c0 -3.8 -3.2 -6.6 -7 -6.6 z" fill="none" stroke="white" stroke-width="1.6"/><circle cx="${x + 5}" cy="${y + 7}" r="1.1" fill="white"/><circle cx="${x + 8.5}" cy="${y + 4.5}" r="1.1" fill="white"/>`,
  app: (x, y) => `<path d="M ${x + 8} ${y + 1} l6.5 3.5 v7 l-6.5 3.5 l-6.5 -3.5 v-7 z M ${x + 1.5} ${y + 4.5} l6.5 3.5 l6.5 -3.5 M ${x + 8} ${y + 8} v7.5" fill="none" stroke="white" stroke-width="1.6" stroke-linejoin="round"/>`,
  part: (x, y) => `<path d="M ${x + 2} ${y + 5} h4 a2 2 0 1 1 4 0 h4 v4 a2 2 0 1 1 0 4 v2 h-12 z" fill="none" stroke="white" stroke-width="1.6" stroke-linejoin="round"/>`,
  file: (x, y) => `<path d="M ${x + 2} ${y} h8 l4 4 v12 h-12 z" fill="none" stroke="white" stroke-width="1.8"/><path d="M ${x + 10} ${y} v4 h4" fill="none" stroke="white" stroke-width="1.4"/>`,
  net: (x, y) => `<circle cx="${x + 3}" cy="${y + 13}" r="2.6" fill="white"/><circle cx="${x + 13}" cy="${y + 13}" r="2.6" fill="white"/><circle cx="${x + 8}" cy="${y + 3}" r="2.6" fill="white"/><path d="M ${x + 8} ${y + 3} L ${x + 3} ${y + 13} M ${x + 8} ${y + 3} L ${x + 13} ${y + 13} M ${x + 3} ${y + 13} H ${x + 13}" stroke="white" stroke-width="1.4"/>`,
};

export type Rect = { name: string; x: number; y: number; w: number; h: number };
export type CardBox = { x: number; y: number; w: number; h: number; cx: number; cy: number; top: number; bottom: number; left: number; right: number };

const overlap = (a: Rect, b: Rect) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const touches = (px: number, py: number, r: Rect, m = 8) => r.x - m <= px && px <= r.x + r.w + m && r.y - m <= py && py <= r.y + r.h + m;

export class Canvas {
  private out: string[] = [];
  private cards: Rect[] = [];
  private segments: [number, number, number, number][] = [];
  private markers = new Set<string>();

  emit(markup: string): void {
    this.out.push(markup);
  }

  // A rectangle the assertions must respect but that is drawn by hand.
  noteCard(name: string, x: number, y: number, w: number, h: number): void {
    this.cards.push({ name, x, y, w, h });
  }

  card(x: number, y: number, title: string, lines: string[], kind: Kind, icon: string = "part", opts: { dashed?: boolean; width?: number } = {}): CardBox {
    const [body, accent] = COLOURS[kind];
    const m = measure(title, lines);
    const w = Math.max(m.w, opts.width ?? 0);
    const h = m.h;
    const dash = opts.dashed ? ' stroke-dasharray="5 3"' : "";
    this.out.push(`<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${body}" stroke="${accent}" stroke-width="1.4"${dash}/>`);
    this.out.push(`<path d="M ${x} ${y + 8} a8 8 0 0 1 8 -8 h${w - 16} a8 8 0 0 1 8 8 v${HDR - 8} h-${w} z" fill="${accent}"/>`);
    this.out.push((ICONS[icon] ?? ICONS.part!)(x + 9, y + 7));
    this.out.push(`<text x="${x + 32}" y="${y + 20}" font-family="Menlo,Consolas,monospace" font-size="12" font-weight="bold" fill="white" xml:space="preserve">${esc(title)}</text>`);
    let ty = y + HDR + 8 + 11;
    for (const l of lines) {
      const bold = l.startsWith("§") ? ' font-weight="bold"' : "";
      this.out.push(`<text x="${x + PAD}" y="${ty}" font-family="Menlo,Consolas,monospace" font-size="11"${bold} fill="${INK}" xml:space="preserve">${esc(l.replace(/^§/, ""))}</text>`);
      ty += LH;
    }
    this.out.push("</g>");
    this.cards.push({ name: title, x, y, w, h });
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, top: y, bottom: y + h, left: x, right: x + w };
  }

  zone(x: number, y: number, w: number, h: number, title: string, kind: Zone): void {
    this.zoneBody(x, y, w, h, kind);
    this.zoneTitle(x, y, w, title, kind);
  }

  // The zone's background alone; zoneTitle() draws its strip later, over any line that passes under it.
  zoneBody(x: number, y: number, w: number, h: number, kind: Zone): void {
    const [body, accent] = ZONES[kind];
    this.out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${body}" stroke="${accent}" stroke-width="1.6"/>`);
  }

  zoneTitle(x: number, y: number, w: number, title: string, kind: Zone): void {
    const accent = ZONES[kind][1];
    this.out.push(`<path d="M ${x} ${y + 10} a10 10 0 0 1 10 -10 h${w - 20} a10 10 0 0 1 10 10 v${ZTITLE - 10} h-${w} z" fill="${accent}" fill-opacity="0.92"/>`);
    this.out.push(ICONS.net!(x + 14, y + 14));
    this.out.push(`<text x="${x + 40}" y="${y + 28}" font-family="Helvetica Neue,Arial,sans-serif" font-size="15" font-weight="bold" fill="white">${esc(title)}</text>`);
  }

  pill(x: number, y: number, text: string, colour: string): void {
    const w = pillWidth(text);
    this.out.push(
      `<g><rect x="${N(x - w / 2)}" y="${N(y - 9)}" width="${w}" height="18" rx="9" fill="white" stroke="${colour}" stroke-width="1.2"/>` +
        `<text x="${N(x)}" y="${N(y + 4)}" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="11" fill="${colour}" xml:space="preserve">${esc(text)}</text></g>`,
    );
  }

  // Horizontal and vertical segments only. `arrow` puts an arrowhead of the line's colour at the end.
  hv(points: [number, number][], colour: string, width = 2, opts: { dash?: string; arrow?: boolean } = {}): void {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (a[0] !== b[0] && a[1] !== b[1]) throw new Error(`diagonal segment ${a} to ${b}`);
      this.segments.push([a[0], a[1], b[0], b[1]]);
    }
    const d = "M " + points.map((p) => `${N(p[0])} ${N(p[1])}`).join(" L ");
    const dash = opts.dash ? ` stroke-dasharray="${opts.dash}"` : "";
    let marker = "";
    if (opts.arrow) {
      const id = "arr-" + colour.slice(1);
      this.markers.add(colour);
      marker = ` marker-end="url(#${id})"`;
    }
    this.out.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}"${dash}${marker} stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  dot(x: number, y: number, colour: string): void {
    this.out.push(`<circle cx="${N(x)}" cy="${N(y)}" r="4" fill="${colour}"/>`);
  }

  text(x: number, y: number, content: string, size = 14, colour = INK, opts: { bold?: boolean; anchor?: string; mono?: boolean } = {}): void {
    const family = opts.mono ? "Menlo,Consolas,monospace" : "Helvetica Neue,Arial,sans-serif";
    this.out.push(`<text x="${N(x)}" y="${N(y)}" font-family="${family}" font-size="${size}"${opts.bold ? ' font-weight="bold"' : ""}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""} fill="${colour}" xml:space="preserve">${esc(content)}</text>`);
  }

  // A white card with a dark header: the legend. Returns its box so callers can reserve the space.
  legend(x: number, y: number, title: string, chips: [string, string][], samples: { text: string; colour: string; width?: number; dash?: string; arrow?: boolean }[], notes: string[]): CardBox {
    const left = Math.max(...chips.map(([t]) => t.length * CH + 24), ...samples.map((s) => s.text.length * CH + 50)) + 10;
    const right = notes.length ? Math.max(...notes.map((l) => l.length * CH)) + 10 : 0;
    const gap = right ? 34 : 0;
    const w = 14 + left + gap + right + 14;
    const rows = Math.max(12 + chips.length * 24 + 10 + samples.length * 24, notes.length ? 12 + notes.length * LH : 0);
    const h = HDR + rows + 14;
    this.out.push(`<rect x="${x}" y="${y}" width="${N(w)}" height="${h}" rx="8" fill="white" stroke="#90A4AE" stroke-width="1.4"/>`);
    this.out.push(`<path d="M ${x} ${y + 8} a8 8 0 0 1 8 -8 h${N(w - 16)} a8 8 0 0 1 8 8 v${HDR - 8} h-${N(w)} z" fill="#37474F"/>`);
    this.out.push(`<text x="${x + 14}" y="${y + 20}" font-family="Helvetica Neue,Arial,sans-serif" font-size="14" font-weight="bold" fill="white">${esc(title)}</text>`);
    let cy = y + HDR + 12;
    for (const [text, colour] of chips) {
      this.out.push(`<rect x="${x + 14}" y="${cy}" width="14" height="14" rx="3" fill="${colour}"/>`);
      this.out.push(`<text x="${x + 36}" y="${cy + 11}" font-family="Menlo,Consolas,monospace" font-size="11" fill="${INK}" xml:space="preserve">${esc(text)}</text>`);
      cy += 24;
    }
    cy += 10;
    for (const s of samples) {
      const lx = x + 14;
      const ly = cy + 7;
      if (s.arrow) this.markers.add(s.colour);
      const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : "";
      const marker = s.arrow ? ` marker-end="url(#arr-${s.colour.slice(1)})"` : "";
      this.out.push(`<path d="M ${lx} ${ly} L ${lx + 30} ${ly}" stroke="${s.colour}" stroke-width="${s.width ?? 2}"${dash}${marker} fill="none" stroke-linecap="round"/>`);
      this.out.push(`<text x="${lx + 40}" y="${cy + 11}" font-family="Menlo,Consolas,monospace" font-size="11" fill="${INK}" xml:space="preserve">${esc(s.text)}</text>`);
      cy += 24;
    }
    let ny = y + HDR + 12 + 11;
    for (const l of notes) {
      this.out.push(`<text x="${N(x + 14 + left + gap)}" y="${ny}" font-family="Menlo,Consolas,monospace" font-size="11" fill="${INK}" xml:space="preserve">${esc(l)}</text>`);
      ny += LH;
    }
    this.cards.push({ name: "legend:" + title, x, y, w, h });
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, top: y, bottom: y + h, left: x, right: x + w };
  }

  // Cards must not overlap and no line may cross a card it does not start or end at.
  check(): void {
    const bad: string[] = [];
    this.cards.forEach((a, i) => this.cards.slice(i + 1).forEach((b) => overlap(a, b) && bad.push(`${a.name} / ${b.name}`)));
    if (bad.length) throw new Error(`card overlaps: ${bad.join("; ")}`);
    const through: string[] = [];
    for (const [x1, y1, x2, y2] of this.segments) {
      for (const r of this.cards) {
        if (touches(x1, y1, r) || touches(x2, y2, r)) continue;
        const [lox, hix] = [Math.min(x1, x2), Math.max(x1, x2)];
        const [loy, hiy] = [Math.min(y1, y2), Math.max(y1, y2)];
        if (x1 === x2 && r.x + 2 < x1 && x1 < r.x + r.w - 2 && Math.min(hiy, r.y + r.h - 2) - Math.max(loy, r.y + 2) > 4) through.push(`${r.name} v@${x1}`);
        if (y1 === y2 && r.y + 2 < y1 && y1 < r.y + r.h - 2 && Math.min(hix, r.x + r.w - 2) - Math.max(lox, r.x + 2) > 4) through.push(`${r.name} h@${y1}`);
      }
    }
    if (through.length) throw new Error(`line through card: ${through.join("; ")}`);
  }

  // Assert, then wrap the accumulated elements in the document. `header` is raw markup drawn before the cards.
  svg(width: number, height: number, comment: string, header: string[] = []): string {
    this.check();
    const w = Math.ceil(width);
    const h = Math.ceil(height);
    const defs = [...this.markers]
      .map((c) => `<marker id="arr-${c.slice(1)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${c}"/></marker>`)
      .join("");
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-synthesis="none">`,
      `<!-- ${esc(comment).replace(/--/g, "- -")} -->`,
      `<defs>${defs}</defs>`,
      `<rect x="0" y="0" width="${w}" height="${h}" fill="${BACKGROUND}"/>`,
      ...header,
      ...this.out,
      "</svg>",
    ].join("\n");
  }

  // The page title block used by every picture.
  static titleBlock(title: string, subtitle: string, x = 40, y = 52): string[] {
    return [
      `<text x="${x}" y="${y}" font-family="Helvetica Neue,Arial,sans-serif" font-size="26" font-weight="bold" fill="${INK}">${esc(title)}</text>`,
      `<text x="${x}" y="${y + 26}" font-family="Helvetica Neue,Arial,sans-serif" font-size="14" fill="${MUTED}">${esc(subtitle)}</text>`,
    ];
  }
}
