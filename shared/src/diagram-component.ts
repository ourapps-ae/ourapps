// The neighbourhood of one component: what it requires on the left, with the catalogue components that provide each
// interface, and what it provides on the right, with the catalogue components that require it. One band per
// interface; inside a band the neighbour cards are stacked and joined by a trunk to the interface card. Lines between
// the interface cards and the component each take their own track in the channel beside the component, ordered so
// that they do not cross.
import type { Port, Targets } from "./catalogue.js";
import { CH, Canvas, LINE_COLOURS, MUTED, PAD, measure, pillWidth, rowY, type CardBox } from "./diagram-kit.js";
import { categoryStyle, zoneTitle } from "./diagram-recipe.js";

export const NEIGHBOURS_SHOWN = 4;

export interface Neighbour {
  name: string;
  version: string;
  category: string | null;
}

export interface ComponentDiagramInput {
  name: string;
  version: string;
  category: string | null;
  targets: Targets;
  provides: Port[];
  requires: Port[];
  profiles: { id: string; settings?: Record<string, unknown> }[];
  // Catalogue components that provide each required type, and that require each provided type, by interface type.
  // `total` counts every match; `components` holds the first few.
  providers: Record<string, { components: Neighbour[]; total: number }>;
  consumers: Record<string, { components: Neighbour[]; total: number }>;
}

const M = 40;
const T = 8;
const BAND_GAP = 26;
const STACK_GAP = 14;
const TRUNK = 44;
const TRACK_PAD = 18;

// Tracks for lines from interface rows `ys` to component rows `cs`, numbered from the component outwards. A line whose
// interface sits above its component row takes a track nearer the component the higher it sits; a line below, the
// lower it sits. Lines in this order never cross.
export function fanTracks(ys: number[], cs: number[]): number[] {
  const idx = ys.map((_, i) => i);
  const above = idx.filter((i) => ys[i]! <= cs[i]!).sort((a, b) => ys[a]! - ys[b]!);
  const below = idx.filter((i) => ys[i]! > cs[i]!).sort((a, b) => ys[b]! - ys[a]!);
  const out = new Array<number>(ys.length);
  [...above, ...below].forEach((i, t) => (out[i] = t));
  return out;
}

interface Band {
  port: Port;
  colour: string;
  title: string;
  lines: string[];
  pillText: string;
  w: number;
  h: number;
  neighbours: { role: "component" | "more" | "application"; title: string; lines: string[]; kind: ReturnType<typeof categoryStyle>["kind"]; icon: string; dashed: boolean; w: number; h: number }[];
  height: number;
}

function neighbourCard(n: Neighbour) {
  const style = categoryStyle(n.category);
  const title = n.name.split("/")[1] ?? n.name;
  const lines = [n.name, `version ${n.version}`];
  return { role: "component" as Band["neighbours"][number]["role"], title, lines, kind: style.kind, icon: style.icon, dashed: false, ...measure(title, lines) };
}

function bands(ports: Port[], found: ComponentDiagramInput["providers"], side: "requires" | "provides", colourOf: (t: string) => string): Band[] {
  return ports.map((port) => {
    const pillText = `${port.type} ${port.version}`;
    const lines = [" ".repeat(Math.ceil((pillWidth(pillText) + 4) / CH)), port.optional ? "optional: may stay unconnected" : side === "requires" ? "required" : "provided"];
    const m = measure(port.id, lines);
    const match = found[port.type] ?? { components: [], total: 0 };
    const neighbours = match.components.slice(0, NEIGHBOURS_SHOWN).map(neighbourCard);
    const more = match.total - neighbours.length;
    if (more > 0) {
      const title = `${more} more`;
      const lines = ["listed at", `/components?${side === "requires" ? "provides" : "requires"}=${port.type}`];
      neighbours.push({ role: "more", title, lines, kind: "file", icon: "part", dashed: false, ...measure(title, lines) });
    }
    if (neighbours.length === 0) {
      const title = "the application";
      const lines = side === "requires" ? ["supplied by the application", "that includes this component"] : ["used by the application", "that includes this component"];
      neighbours.push({ role: "application", title, lines, kind: "app", icon: "app", dashed: true, ...measure(title, lines) });
    }
    const stack = neighbours.reduce((n, c) => n + c.h, 0) + STACK_GAP * (neighbours.length - 1);
    return { port, colour: colourOf(port.type), title: port.id, lines, pillText, w: m.w, h: m.h, neighbours, height: Math.max(stack, m.h) };
  });
}

export function componentConnectionsSvg(input: ComponentDiagramInput): string {
  const types = [...new Set([...input.requires, ...input.provides].map((p) => p.type))];
  const colourOf = (t: string) => LINE_COLOURS[types.indexOf(t) % LINE_COLOURS.length]!;
  const left = bands(input.requires, input.providers, "requires", colourOf);
  const right = bands(input.provides, input.consumers, "provides", colourOf);

  // The component's own card.
  const style = categoryStyle(input.category);
  const short = input.name.split("/")[1] ?? input.name;
  const targets = [...input.targets.client, ...input.targets.server];
  const settings = new Set(input.profiles.flatMap((p) => Object.keys(p.settings ?? {})));
  const head = [
    input.name,
    `version ${input.version}`,
    ...(input.category ? [`category ${input.category}`] : []),
    `targets ${targets.length ? targets.join(", ") : "none stated"}`,
    `${input.profiles.length} suitability profile${input.profiles.length === 1 ? "" : "s"}`,
    `${settings.size} setting${settings.size === 1 ? "" : "s"} set by profiles`,
  ];
  const centreLines = [...head, ...input.requires.map((p) => `requires ${p.id}`), ...input.provides.map((p) => `provides ${p.id}`)];
  const cm = measure(short, centreLines);

  const c = new Canvas();
  const neighbours = [...left, ...right].flatMap((b) => b.neighbours);
  const chips: [string, string][] = [["this component", style.accent], ["an interface: its type and version in the pill", "#546E7A"]];
  if (neighbours.some((n) => n.role === "component")) chips.push(["a catalogue component, coloured by its category", "#43A047"]);
  if (neighbours.some((n) => n.role === "more")) chips.push(["more catalogue components, counted", "#9E9D24"]);
  if (neighbours.some((n) => n.role === "application")) chips.push(["the application, dashed: no catalogue component matches", "#E53935"]);
  const legend = c.legend(
    M,
    108,
    "Legend",
    chips,
    [{ text: "from provider to the component that requires it", colour: "#1E88E5", arrow: true }],
    ["Left: what it requires, and the catalogue", "components that provide each interface.", "Right: what it provides, and the catalogue", `components that require it. At most ${NEIGHBOURS_SHOWN} are`, "shown per interface.", "One colour per interface type."],
  );

  const colW = (list: Band[], f: (b: Band) => number) => Math.max(0, ...list.map(f));
  const lnW = colW(left, (b) => Math.max(...b.neighbours.map((n) => n.w)));
  const liW = colW(left, (b) => b.w);
  const riW = colW(right, (b) => b.w);
  const rnW = colW(right, (b) => Math.max(...b.neighbours.map((n) => n.w)));
  const lch = left.length ? left.length * T + 2 * TRACK_PAD : 0;
  const rch = right.length ? right.length * T + 2 * TRACK_PAD : 0;

  let x = M;
  const lnX = x;
  x += left.length ? lnW + TRUNK : 0;
  const liX = x;
  x += left.length ? liW : 0;
  const lchX = x;
  x += lch;
  const cX = x;
  x += cm.w;
  const rchX = x;
  x += rch;
  const riX = x;
  x += right.length ? riW + TRUNK : 0;
  const rnX = x;
  x += right.length ? rnW : 0;
  const width = Math.max(x + M, legend.right + M);

  const top = legend.bottom + 40;
  const stackH = (list: Band[]) => list.reduce((n, b) => n + b.height, 0) + BAND_GAP * Math.max(0, list.length - 1);
  const totalH = Math.max(stackH(left), stackH(right), cm.h);
  const cY = top + Math.round((totalH - cm.h) / 2);
  const centre = c.card(cX, cY, short, centreLines, style.kind, style.icon);
  const centreRow = (i: number) => rowY(cY, head.length + i);

  const count = (n: number) => (n === 0 ? "no interfaces" : `${n} interface${n === 1 ? "" : "s"}`);
  const header = Canvas.titleBlock(`${input.name}: what it connects to`, `version ${input.version}${input.category ? `, ${zoneTitle(input.category).toLowerCase()}` : ""}: requires ${count(input.requires.length)}, provides ${count(input.provides.length)}, matched against the catalogue`);

  const drawSide = (list: Band[], side: "left" | "right") => {
    let y = top + Math.round((totalH - stackH(list)) / 2);
    const placed: { band: Band; box: CardBox; iy: number }[] = [];
    for (const band of list) {
      const iy0 = y + Math.round((band.height - band.h) / 2);
      const ix = side === "left" ? liX + (liW - band.w) : riX;
      const box = c.card(ix, iy0, band.title, band.lines, "part", "part", {});
      c.pill(ix + PAD + pillWidth(band.pillText) / 2, rowY(iy0, 0), band.pillText, band.colour);
      const iy = rowY(iy0, 1);
      // Neighbours stacked in the band, joined by a trunk to the interface card.
      const stack = band.neighbours.reduce((n, k) => n + k.h, 0) + STACK_GAP * (band.neighbours.length - 1);
      let ny = y + Math.round((band.height - stack) / 2);
      const trunkX = side === "left" ? liX - TRUNK / 2 : riX + riW + TRUNK / 2;
      const ends: number[] = [];
      for (const n of band.neighbours) {
        const nx = side === "left" ? lnX + (lnW - n.w) : rnX;
        const card = c.card(nx, ny, n.title, n.lines, n.kind, n.icon, { dashed: n.dashed });
        const py = rowY(ny, 0);
        ends.push(py);
        if (side === "left") c.hv([[card.right, py], [trunkX, py]], band.colour, 2);
        else c.hv([[trunkX, py], [card.left - 1, py]], band.colour, 2, { arrow: true });
        ny += n.h + STACK_GAP;
      }
      const lo = Math.min(iy, ...ends);
      const hi = Math.max(iy, ...ends);
      if (hi > lo) c.hv([[trunkX, lo], [trunkX, hi]], band.colour, 2);
      if (side === "left") c.hv([[trunkX, iy], [box.left - 1, iy]], band.colour, 2, { arrow: true });
      else c.hv([[box.right, iy], [trunkX, iy]], band.colour, 2);
      for (const e of [...ends, iy]) if ((e > lo && e < hi) || ends.length > 1) c.dot(trunkX, e, band.colour);
      placed.push({ band, box, iy });
      y += band.height + BAND_GAP;
    }
    // Interface cards to the component, each on its own track.
    const rows = list.map((_, i) => centreRow(side === "left" ? i : input.requires.length + i));
    const tracks = fanTracks(placed.map((p) => p.iy), rows);
    placed.forEach((p, i) => {
      const cy = rows[i]!;
      if (side === "left") {
        const tx = lchX + lch - TRACK_PAD - tracks[i]! * T;
        c.hv(([[p.box.right, p.iy], [tx, p.iy], [tx, cy], [centre.left - 1, cy]] as [number, number][]).filter(dedupe), p.band.colour, 2, { arrow: true });
      } else {
        const tx = rchX + TRACK_PAD + tracks[i]! * T;
        c.hv(([[centre.right, cy], [tx, cy], [tx, p.iy], [p.box.left - 1, p.iy]] as [number, number][]).filter(dedupe), p.band.colour, 2, { arrow: true });
      }
    });
  };
  drawSide(left, "left");
  drawSide(right, "right");

  if (left.length === 0 && right.length === 0) c.text(cX, top + totalH + 30, "This component states no interfaces.", 13, MUTED);
  const height = top + totalH + (left.length || right.length ? 0 : 40) + M;
  return c.svg(width, height, `${input.name} ${input.version}: the interfaces it requires and provides, and the catalogue components on the other side of each.`, header);
}

// Drops a point equal to the one before it, which a straight line through a track produces.
function dedupe(p: [number, number], i: number, all: [number, number][]): boolean {
  return i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1];
}
