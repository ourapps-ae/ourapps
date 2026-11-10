// The component diagram of a recipe, computed from the recipe and the catalogue entries of its components.
// Zones by category are stacked vertically; inside a zone, columns follow dependency depth (providers left of the
// components that use them). Columns are shared by every zone, so the gaps between columns form vertical channels
// from top to bottom, and the gaps between rows form horizontal channels. Every line runs in channels only: out of
// the provider's right side, along channels, into the consumer's side. Each line gets its own track in each channel
// it uses, so lines never overlap and never cross a card.
import type { Port } from "./catalogue.js";
import { describeCondition, type Condition } from "./conditions.js";
import { COLOURS, Canvas, LINE_COLOURS, MUTED, ZTITLE, measure, pillWidth, rowY, wrap, type CardBox, type Kind, type Zone } from "./diagram-kit.js";

export interface DiagramPart {
  name: string;
  version: string;
  category: string | null;
  provides: Port[];
  requires: Port[];
}

export interface RecipeDiagramInput {
  name: string;
  version: string;
  title: string;
  components: { id: string; name: string; version: string; includedWhen: Condition | null }[];
  connections: { source: { instance: string; port: string }; target: { instance: string; port: string } }[];
  // The catalogue entry of each component, in the same order; null when the catalogue does not list it.
  catalogue: (DiagramPart | null)[];
}

export const MAX_WIDTH = 1600;
const M = 40;
const T = 7; // distance between tracks in a channel
const CHANNEL_PAD = 12;
const GAP_PAD = 12;
const MIN_CHANNEL = 28;
const MIN_GAP = 26;
const ZONE_SPACE = 30;
// Cards in odd columns sit this much lower. Body lines are 15 apart, so a line leaving a card in one column never
// runs at the same height as a line entering a card in the next column: stubs in one channel cannot overlap.
const STAGGER = 7;
const stagger = (col: number) => (col % 2) * STAGGER;
const APPLICATION = "application";

// Card colour and zone colour for each category. Other categories take a style from their name; components without
// a category, or outside the catalogue, are grey.
const STYLES: { kind: Kind; zone: Zone; icon: string }[] = [
  { kind: "host", zone: "blue", icon: "host" },
  { kind: "rooms", zone: "green", icon: "rooms" },
  { kind: "game", zone: "purple", icon: "game" },
  { kind: "poker", zone: "amber", icon: "poker" },
  { kind: "ui", zone: "pink", icon: "ui" },
  { kind: "file", zone: "amber", icon: "file" },
];
const KNOWN_STYLE: Record<string, number> = { delivery: 0, rooms: 1, "game-framework": 2, poker: 3, presentation: 4 };
const OTHER = { kind: "part" as Kind, zone: "grey" as Zone, icon: "part" };
const OWN = { kind: "app" as Kind, zone: "pink" as Zone, icon: "app" };

export function categoryStyle(category: string | null): { kind: Kind; zone: Zone; icon: string; accent: string } {
  let style = OTHER;
  if (category !== null && category in KNOWN_STYLE) style = STYLES[KNOWN_STYLE[category]!]!;
  else if (category !== null) style = STYLES[[...category].reduce((n, ch) => n + ch.charCodeAt(0), 0) % STYLES.length]!;
  return { ...style, accent: COLOURS[style.kind][1] };
}

// The words an answer value reads as in a condition.
export function answerWords(value: unknown): string {
  if (Array.isArray(value)) return value.map(answerWords).join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function zoneTitle(category: string): string {
  const words = category.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------- layout functions

// Longest chain of providers above each node. Edges are [provider, consumer]; a cycle stops at the node count.
export function depths(keys: string[], edges: [string, string][]): Map<string, number> {
  const depth = new Map(keys.map((k) => [k, 0]));
  for (let pass = 0; pass < keys.length; pass++) {
    let changed = false;
    for (const [from, to] of edges) {
      const next = Math.min(keys.length, depth.get(from)! + 1);
      if (from !== to && next > depth.get(to)!) {
        depth.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

// Spread dependency levels over at most `max` columns: levels deeper than the last column join it, and a crowded
// level is split into neighbouring columns (its members never connect to each other) so no column is much taller
// than it has to be.
export function columnsByDepth(levels: string[][], max: number): string[][] {
  const used = levels.filter((l) => l.length > 0);
  if (used.length === 0) return [];
  if (used.length >= max) return [...used.slice(0, max - 1), used.slice(max - 1).flat()];
  let rows = 1;
  while (used.reduce((n, l) => n + Math.ceil(l.length / rows), 0) > max) rows++;
  const out: string[][] = [];
  for (const level of used) {
    const parts = Math.ceil(level.length / rows);
    for (let i = 0, start = 0; i < parts; i++) {
      const size = Math.ceil((level.length - start) / (parts - i));
      out.push(level.slice(start, start + size));
      start += size;
    }
  }
  return out;
}

// Evens out column heights. A node may sit in any column after all its providers and before all its consumers
// (`edges` are [provider, consumer] inside one zone); nodes move from the tallest column to the shortest column they
// may use while that makes the tallest shorter.
export function balanceColumns(columns: string[][], edges: [string, string][]): string[][] {
  const cols = columns.map((c) => [...c]);
  const colOf = (k: string) => cols.findIndex((c) => c.includes(k));
  const range = (k: string): [number, number] => [
    Math.max(0, ...edges.filter(([, to]) => to === k).map(([from]) => colOf(from) + 1)),
    Math.min(cols.length - 1, ...edges.filter(([from]) => from === k).map(([, to]) => colOf(to) - 1)),
  ];
  for (let guard = 0; guard < 500; guard++) {
    const tall = cols.reduce((best, c, i) => (c.length > cols[best]!.length ? i : best), 0);
    let moved = false;
    for (const key of [...cols[tall]!].reverse()) {
      const [first, last] = range(key);
      let target = -1;
      for (let c = first; c <= last; c++) if (c !== tall && cols[c]!.length + 1 < cols[tall]!.length && (target < 0 || cols[c]!.length < cols[target]!.length)) target = c;
      if (target < 0) continue;
      cols[tall] = cols[tall]!.filter((k) => k !== key);
      cols[target]!.push(key);
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return cols;
}

// Interval colouring: each interval gets the lowest track free over its whole extent. Touching intervals take
// different tracks. Returns the track of each interval, in input order.
export function assignTracks(intervals: [number, number][]): number[] {
  const order = intervals.map((iv, i) => ({ iv, i })).sort((a, b) => a.iv[0] - b.iv[0] || a.iv[1] - b.iv[1]);
  const ends: number[] = [];
  const track = new Array<number>(intervals.length);
  for (const { iv, i } of order) {
    let t = ends.findIndex((end) => end < iv[0]);
    if (t < 0) t = ends.length;
    ends[t] = iv[1];
    track[i] = t;
  }
  return track;
}

// ---------------------------------------------------------------- model

interface Node {
  key: string;
  title: string;
  lines: string[];
  kind: Kind;
  icon: string;
  dashed: boolean;
  zone: number;
  ins: Map<string, number>; // port id -> body line
  outs: Map<string, number>;
  w: number;
  h: number;
  col: number;
  row: number;
}

interface Net {
  from: Node;
  port: string;
  label: string;
  colour: string;
  to: { node: Node; port: string }[];
}

interface ZoneModel {
  title: string;
  zone: Zone;
  nodes: Node[];
  rows: number;
}

// A position along the vertical axis that sorts the same way the drawing does: zone, then gap or row, then body line.
const rowKey = (zone: number, row: number, line: number, col: number) => zone * 1e6 + (2 * row + 1) * 1e3 + 2 * line + (col % 2);
const gapKey = (zone: number, gap: number) => zone * 1e6 + 2 * gap * 1e3;

interface Route {
  net: Net;
  // channel -> points (y keys) used in that channel
  channels: Map<number, number[]>;
  // gap (zone, index) -> channels spanned
  gaps: Map<string, number[]>;
  exitChannel: number;
  entries: { node: Node; port: string; channel: number; side: "left" | "right" }[];
}

function model(input: RecipeDiagramInput) {
  const parts = new Map<string, { id: string; name: string; version: string; includedWhen: Condition | null; entry: DiagramPart | null }>();
  input.components.forEach((c, i) => parts.set(c.id, { ...c, entry: input.catalogue[i] ?? null }));
  const known = (instance: string) => instance === APPLICATION || parts.has(instance);
  const connections = input.connections.filter((c) => known(c.source.instance) && known(c.target.instance) && c.source.instance !== c.target.instance);

  const portType = (instance: string, port: string, side: "provides" | "requires"): string | null => parts.get(instance)?.entry?.[side].find((p) => p.id === port)?.type ?? null;
  const typeOf = (c: (typeof connections)[number]) => portType(c.source.instance, c.source.port, "provides") ?? portType(c.target.instance, c.target.port, "requires");
  const types = [...new Set(connections.map(typeOf).filter((t): t is string => t !== null))];
  const scopes = new Set(types.map((t) => (t.includes("/") ? t.split("/")[0] : "")));
  const scope = scopes.size === 1 && [...scopes][0] ? [...scopes][0]! : null;
  const short = (t: string) => (scope && t.startsWith(scope + "/") ? t.slice(scope.length + 1) : t);

  // Zones in category order of first appearance; "Other" for components the catalogue does not list.
  const categories: string[] = [];
  for (const p of parts.values()) {
    const c = p.entry ? (p.entry.category ?? "other") : "other";
    if (!categories.includes(c)) categories.push(c);
  }
  const styleOf = new Map(categories.map((c) => [c, c === "other" ? { ...OTHER, accent: COLOURS.part[1] } : categoryStyle(c)]));

  const inPorts = new Map<string, string[]>();
  const outPorts = new Map<string, string[]>();
  for (const c of connections) {
    const ins = inPorts.get(c.target.instance) ?? [];
    if (!ins.includes(c.target.port)) ins.push(c.target.port);
    inPorts.set(c.target.instance, ins);
    const outs = outPorts.get(c.source.instance) ?? [];
    if (!outs.includes(c.source.port)) outs.push(c.source.port);
    outPorts.set(c.source.instance, outs);
  }

  const makeNode = (key: string, title: string, head: string[], style: { kind: Kind; icon: string }, dashed: boolean, zone: number): Node => {
    const lines = [...head];
    const ins = new Map<string, number>();
    const outs = new Map<string, number>();
    for (const p of inPorts.get(key) ?? []) {
      ins.set(p, lines.length);
      lines.push(`requires ${p}`);
    }
    for (const p of outPorts.get(key) ?? []) {
      outs.set(p, lines.length);
      lines.push(`provides ${p}`);
    }
    const m = measure(title, lines);
    return { key, title, lines, kind: style.kind, icon: style.icon, dashed, zone, ins, outs, w: m.w, h: m.h, col: 0, row: 0 };
  };

  const zones: ZoneModel[] = categories.map((c) => ({ title: c === "other" ? "Other" : zoneTitle(c), zone: styleOf.get(c)!.zone, nodes: [], rows: 0 }));
  const nodes = new Map<string, Node>();
  for (const p of parts.values()) {
    const c = p.entry ? (p.entry.category ?? "other") : "other";
    const z = categories.indexOf(c);
    const head = [p.name, `version ${p.version}`];
    if (!p.entry) head.push("not in the catalogue");
    if (p.includedWhen) head.push(...wrap(`when ${describeCondition(p.includedWhen, answerWords) ?? p.includedWhen}`, 34));
    const n = makeNode(p.id, p.id, head, styleOf.get(c)!, p.includedWhen !== null, z);
    nodes.set(p.id, n);
    zones[z]!.nodes.push(n);
  }
  zones.push({ title: "The application: this recipe's own component", zone: OWN.zone, nodes: [], rows: 0 });
  const own = makeNode(APPLICATION, input.title, ["the recipe's own component,", "written for this application", "instance application"], OWN, false, zones.length - 1);
  nodes.set(APPLICATION, own);
  zones[zones.length - 1]!.nodes.push(own);

  const nets = new Map<string, Net>();
  for (const c of connections) {
    const id = `${c.source.instance} ${c.source.port}`;
    let net = nets.get(id);
    if (!net) {
      const t = typeOf(c);
      net = { from: nodes.get(c.source.instance)!, port: c.source.port, label: t ? short(t) : c.source.port, colour: "", to: [] };
      nets.set(id, net);
    }
    net.to.push({ node: nodes.get(c.target.instance)!, port: c.target.port });
  }
  const labels = [...new Set([...nets.values()].map((n) => n.label))];
  for (const n of nets.values()) n.colour = LINE_COLOURS[labels.indexOf(n.label) % LINE_COLOURS.length]!;
  return { zones, nets: [...nets.values()], nodes, connections, scope };
}

// Zones that mostly provide go above zones that mostly use; the application is always last.
function orderZones(zones: ZoneModel[], nets: Net[]): ZoneModel[] {
  const score = new Map<ZoneModel, number>(zones.map((z) => [z, 0]));
  for (const n of nets) {
    for (const t of n.to) {
      const a = zones[n.from.zone]!;
      const b = zones[t.node.zone]!;
      if (a === b) continue;
      score.set(a, score.get(a)! - 1);
      score.set(b, score.get(b)! + 1);
    }
  }
  const own = zones[zones.length - 1]!;
  const rest = zones.slice(0, -1).map((z, i) => ({ z, i })).sort((a, b) => score.get(a.z)! - score.get(b.z)! || a.i - b.i).map((x) => x.z);
  return [...rest, own];
}

// Columns and rows inside one zone.
function placeZone(zone: ZoneModel, nets: Net[], columns: number, ownColumn: number): void {
  const keys = zone.nodes.map((n) => n.key);
  const inside = new Set(keys);
  const edges: [string, string][] = [];
  for (const n of nets) for (const t of n.to) if (inside.has(n.from.key) && inside.has(t.node.key)) edges.push([n.from.key, t.node.key]);
  if (zone.nodes.length === 1 && zone.nodes[0]!.key === APPLICATION) {
    zone.nodes[0]!.col = ownColumn;
    zone.nodes[0]!.row = 0;
    zone.rows = 1;
    return;
  }
  const depth = depths(keys, edges);
  const levels: string[][] = [];
  for (const k of keys) (levels[depth.get(k)!] ??= []).push(k);
  const byKey = new Map(zone.nodes.map((n) => [n.key, n]));
  const byDepth = columnsByDepth(levels.filter((l) => l && l.length > 0), columns);
  const placed = balanceColumns([...byDepth, ...Array.from({ length: Math.max(0, columns - byDepth.length) }, () => [])], edges).filter((c) => c.length > 0);
  // Each column follows the rows of the providers it requires, so lines run as level as they can.
  const rowOf = new Map<string, number>();
  const centre = (k: string) => {
    const from = edges.filter(([, to]) => to === k).map(([f]) => rowOf.get(f)).filter((r): r is number => r !== undefined);
    return from.length === 0 ? Number.POSITIVE_INFINITY : from.reduce((a, b) => a + b, 0) / from.length;
  };
  placed.forEach((col, c) => {
    const order = col.map((k, i) => ({ k, i, c: centre(k) })).sort((a, b) => a.c - b.c || a.i - b.i);
    order.forEach(({ k }, r) => {
      Object.assign(byKey.get(k)!, { col: c, row: r });
      rowOf.set(k, r);
    });
  });
  zone.rows = Math.max(...placed.map((c) => c.length));
}

function route(nets: Net[]): Route[] {
  const routes: Route[] = [];
  for (const net of nets) {
    const src = net.from;
    const s = src.col + 1;
    const srcKey = rowKey(src.zone, src.row, src.outs.get(net.port)!, src.col);
    const r: Route = { net, channels: new Map(), gaps: new Map(), exitChannel: s, entries: [] };
    const use = (ch: number, key: number) => r.channels.set(ch, [...(r.channels.get(ch) ?? []), key]);
    use(s, srcKey);
    for (const t of net.to) {
      const dst = t.node;
      const dstKey = rowKey(dst.zone, dst.row, dst.ins.get(t.port)!, dst.col);
      const left = s <= dst.col;
      const e = left ? dst.col : dst.col + 1;
      r.entries.push({ node: dst, port: t.port, channel: e, side: left ? "left" : "right" });
      if (s === e) {
        use(s, dstKey);
      } else {
        const gap = srcKey < rowKey(dst.zone, dst.row, 0, 0) ? dst.row : dst.row + 1;
        const g = gapKey(dst.zone, gap);
        use(s, g);
        use(e, g);
        use(e, dstKey);
        const id = `${dst.zone} ${gap}`;
        r.gaps.set(id, [...(r.gaps.get(id) ?? []), s, e]);
      }
    }
    routes.push(r);
  }
  return routes;
}

interface Tracks {
  channel: Map<string, number>; // "net index channel" -> track position from the channel's left edge, in tracks
  channelCount: Map<number, number>;
  gap: Map<string, number>; // "net index zone gap" -> track
  gapCount: Map<string, number>;
}

function tracks(routes: Route[]): Tracks {
  const out: Tracks = { channel: new Map(), channelCount: new Map(), gap: new Map(), gapCount: new Map() };
  // Channels: lines with stubs to the column on the left come first, then lines with stubs both ways, then lines
  // entering the column on the right, so stubs cross as few tracks as possible.
  const perChannel = new Map<number, { i: number; cls: number; iv: [number, number] }[]>();
  routes.forEach((r, i) => {
    for (const [ch, keys] of r.channels) {
      const toLeft = r.exitChannel === ch || r.entries.some((e) => e.channel === ch && e.side === "right");
      const toRight = r.entries.some((e) => e.channel === ch && e.side === "left");
      const cls = toLeft && toRight ? 1 : toLeft ? 0 : 2;
      const list = perChannel.get(ch) ?? [];
      list.push({ i, cls, iv: [Math.min(...keys), Math.max(...keys)] });
      perChannel.set(ch, list);
    }
  });
  for (const [ch, list] of perChannel) {
    let base = 0;
    for (const cls of [0, 1, 2]) {
      const members = list.filter((m) => m.cls === cls);
      const t = assignTracks(members.map((m) => m.iv));
      members.forEach((m, j) => out.channel.set(`${m.i} ${ch}`, base + t[j]!));
      base += members.length ? Math.max(...t) + 1 : 0;
    }
    out.channelCount.set(ch, base);
  }
  const perGap = new Map<string, { i: number; iv: [number, number] }[]>();
  routes.forEach((r, i) => {
    for (const [g, chans] of r.gaps) perGap.set(g, [...(perGap.get(g) ?? []), { i, iv: [Math.min(...chans), Math.max(...chans)] }]);
  });
  for (const [g, list] of perGap) {
    const t = assignTracks(list.map((m) => m.iv));
    list.forEach((m, j) => out.gap.set(`${m.i} ${g}`, t[j]!));
    out.gapCount.set(g, Math.max(...t) + 1);
  }
  return out;
}

// ---------------------------------------------------------------- geometry and drawing

function plan(input: RecipeDiagramInput, columns: number) {
  const m = model(input);
  const zones = orderZones(m.zones, m.nets);
  zones.forEach((z, i) => z.nodes.forEach((n) => (n.zone = i)));
  const ownColumn = Math.floor((columns - 1) / 2);
  for (const z of zones) placeZone(z, m.nets, columns, ownColumn);
  const used = Math.max(1, ...zones.flatMap((z) => z.nodes.map((n) => n.col + 1)));
  const routes = route(m.nets);
  const t = tracks(routes);
  // A column is as wide as its widest card plus the pills of the lines that card provides.
  const pillRoom = (n: Node) => Math.max(0, ...m.nets.filter((x) => x.from === n).map((x) => pillWidth(x.label) + 20));
  const colW = Array.from({ length: used }, (_, c) => Math.max(0, ...zones.flatMap((z) => z.nodes.filter((n) => n.col === c).map((n) => n.w + pillRoom(n)))));
  const chW = Array.from({ length: used + 1 }, (_, ch) => Math.max(MIN_CHANNEL, (t.channelCount.get(ch) ?? 0) * T + 2 * CHANNEL_PAD - T));
  const chX: number[] = [];
  const colX: number[] = [];
  let x = M + 8;
  for (let c = 0; c <= used; c++) {
    chX.push(x);
    x += chW[c]!;
    if (c < used) {
      colX.push(x);
      x += colW[c]!;
    }
  }
  const width = x + 8 + M;
  return { m, zones, routes, t, width, used, chX, chW, colX, colW };
}

function legendFor(c: Canvas, zones: ZoneModel[], scope: string | null): CardBox {
  const chips: [string, string][] = [];
  for (const z of zones) {
    const n = z.nodes[0];
    if (!n) continue;
    const accent = COLOURS[n.kind][1];
    const text = n.key === APPLICATION ? "the recipe's own component" : `${z.title.toLowerCase()} component`;
    if (!chips.some(([t]) => t === text)) chips.push([text, accent]);
  }
  return c.legend(
    M,
    108,
    "Legend",
    chips,
    [
      { text: "interface: from the component that provides it to each component that requires it", colour: "#1E88E5", arrow: true },
      { text: "dashed card border: included only when the answers meet its condition", colour: MUTED, dash: "5 3", width: 1.4 },
    ],
    [
      "Each line is one interface. Its colour stands for the",
      "interface type and its pill names the type" + (scope ? ` (scope ${scope}/).` : "."),
      "A line leaves a card at the row of the interface it",
      "provides and enters at the row of the interface it",
      "requires. A dot joins branches of one line.",
      "Columns: a component sits right of the components in",
      "its zone that it requires.",
    ],
  );
}


export function recipeComponentsSvg(input: RecipeDiagramInput): string {
  let p = plan(input, 5);
  for (let columns = 4; p.width > MAX_WIDTH && columns >= 2; columns--) p = plan(input, columns);
  const { m, zones, routes, t, chX, colX } = p;

  const c = new Canvas();
  const legend = legendFor(c, zones, m.scope);
  const width = Math.max(p.width, legend.right + M);

  // Vertical geometry: zone by zone, gap, row, gap, row ... gap.
  const gapH = (z: number, g: number) => Math.max(MIN_GAP, (t.gapCount.get(`${z} ${g}`) ?? 0) * T + 2 * GAP_PAD - T);
  const zoneY: number[] = [];
  const zoneH: number[] = [];
  const rowYs: number[][] = [];
  const gapYs: number[][] = [];
  let y = legend.bottom + 36;
  zones.forEach((z, zi) => {
    zoneY.push(y);
    let cursor = y + ZTITLE;
    const rows: number[] = [];
    const gaps: number[] = [];
    for (let r = 0; r <= z.rows; r++) {
      gaps.push(cursor);
      cursor += gapH(zi, r);
      if (r < z.rows) {
        rows.push(cursor);
        cursor += Math.max(0, ...z.nodes.filter((n) => n.row === r).map((n) => n.h + stagger(n.col)));
      }
    }
    rowYs.push(rows);
    gapYs.push(gaps);
    zoneH.push(cursor - y);
    y = cursor + ZONE_SPACE;
  });
  const height = y - ZONE_SPACE + M;

  const nodeBox = new Map<Node, CardBox>();
  const zoneW = width - 2 * M;
  zones.forEach((z, zi) => c.zoneBody(M, zoneY[zi]!, zoneW, zoneH[zi]!, z.zone));
  zones.forEach((z, zi) => {
    for (const n of z.nodes) nodeBox.set(n, c.card(colX[n.col]!, rowYs[zi]![n.row]! + stagger(n.col), n.title, n.lines, n.kind, n.icon, { dashed: n.dashed }));
  });

  const trackX = (i: number, ch: number) => chX[ch]! + CHANNEL_PAD + t.channel.get(`${i} ${ch}`)! * T;
  const trackY = (i: number, g: string) => {
    const [z, gap] = g.split(" ").map(Number) as [number, number];
    return gapYs[z]![gap]! + GAP_PAD + t.gap.get(`${i} ${g}`)! * T;
  };
  const keyY = (key: number, i: number) => {
    const z = Math.floor(key / 1e6);
    const slot = Math.floor((key % 1e6) / 1e3);
    if (slot % 2 === 0) return trackY(i, `${z} ${slot / 2}`);
    const rest = key % 1e3;
    return rowY(rowYs[z]![(slot - 1) / 2]! + (rest % 2) * STAGGER, Math.floor(rest / 2));
  };

  routes.forEach((r, i) => {
    const colour = r.net.colour;
    const segments: [number, number][][] = [];
    const src = nodeBox.get(r.net.from)!;
    const ys = rowY(src.y, r.net.from.outs.get(r.net.port)!);
    const xs = trackX(i, r.exitChannel);
    segments.push([[src.right, ys], [xs, ys]]);
    for (const [ch, keys] of r.channels) {
      const values = keys.map((k) => keyY(k, i));
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (hi > lo) segments.push([[trackX(i, ch), lo], [trackX(i, ch), hi]]);
    }
    for (const [g, chans] of r.gaps) {
      const xsAll = chans.map((ch) => trackX(i, ch));
      const gy = trackY(i, g);
      segments.push([[Math.min(...xsAll), gy], [Math.max(...xsAll), gy]]);
    }
    for (const seg of segments) c.hv(seg, colour, 2);
    for (const e of r.entries) {
      const box = nodeBox.get(e.node)!;
      const ye = rowY(box.y, e.node.ins.get(e.port)!);
      const xe = trackX(i, e.channel);
      const end = e.side === "left" ? box.left - 1 : box.right + 1;
      c.hv([[xe, ye], [end, ye]], colour, 2, { arrow: true });
      segments.push([[xe, ye], [end, ye]]);
    }
    for (const [x0, y0] of junctions(segments)) c.dot(x0, y0, colour);
    c.pill(src.right + 12 + pillWidth(r.net.label) / 2, ys, r.net.label, colour);
  });

  zones.forEach((z, zi) => c.zoneTitle(M, zoneY[zi]!, zoneW, `${z.title}${z.nodes[0]?.key === APPLICATION ? "" : `: ${z.nodes.length} component${z.nodes.length === 1 ? "" : "s"}`}`, z.zone));

  const parts = input.components.length;
  const header = Canvas.titleBlock(`${input.title}: how its components connect`, `${input.name} ${input.version}: ${parts} component${parts === 1 ? "" : "s"} and ${m.connections.length} connection${m.connections.length === 1 ? "" : "s"}, drawn from the recipe and the catalogue`);
  return c.svg(width, height, `${input.title} (${input.name} ${input.version}): its components by category and the interfaces that connect them.`, header);
}

// Points where three or more line ends meet, or a line ends on another: where a dot shows that branches join.
function junctions(segments: [number, number][][]): [number, number][] {
  const points = new Map<string, [number, number]>();
  for (const s of segments) for (const p of [s[0]!, s[s.length - 1]!]) points.set(`${p[0]} ${p[1]}`, p);
  const out: [number, number][] = [];
  for (const p of points.values()) {
    let degree = 0;
    for (const s of segments) {
      const [a, b] = [s[0]!, s[s.length - 1]!];
      if ((a[0] === p[0] && a[1] === p[1]) || (b[0] === p[0] && b[1] === p[1])) degree += 1;
      else if (a[0] === b[0] && a[0] === p[0] && Math.min(a[1], b[1]) < p[1] && p[1] < Math.max(a[1], b[1])) degree += 2;
      else if (a[1] === b[1] && a[1] === p[1] && Math.min(a[0], b[0]) < p[0] && p[0] < Math.max(a[0], b[0])) degree += 2;
    }
    if (degree >= 3) out.push(p);
  }
  return out;
}
