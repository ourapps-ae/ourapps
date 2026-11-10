// "How a recipe is cooked": the whole process, from a recipe in the library to an application on your people's devices
// and every update after. Hand-laid: every coordinate is computed here from the text. One zone per party that acts;
// steps run left to right, a second row starts again at the left, and a line down the left margin carries the result
// of one zone into the next. Regenerated into public/diagrams/cooking-a-recipe.svg by scripts/build-diagrams.ts.
import { COLOURS, Canvas, INK, measure, pillWidth, ZTITLE, type CardBox, type Kind, type Zone } from "@my/store-shared";

interface Step {
  title: string;
  lines: string[];
  dashed?: boolean;
  apart?: boolean; // stands to the right of its row, not joined to it
}

interface Part {
  title: string;
  who: string;
  zone: Zone;
  kind: Kind;
  icon: string;
  rows: Step[][];
  then?: string; // what passes to the next part
}

const PARTS: Part[] = [
  {
    title: "You and your agent",
    who: "you and your agent",
    zone: "blue",
    kind: "host",
    icon: "host",
    rows: [
      [
        { title: "1 Find a recipe", lines: ["in the recipe library at", "ourapps.app/recipes, or", "compose one from components"] },
        { title: "2 Read its questions", lines: ["the recipe page lists each", "question, its options and", "its default"] },
        { title: "3 Answer them", lines: ["your agent infers what it", "can from your repository", "and asks you the rest"] },
      ],
    ],
    then: "answers",
  },
  {
    title: "Evaluation: the recipe and your answers make a design",
    who: "the recipe evaluation",
    zone: "purple",
    kind: "game",
    icon: "game",
    rows: [
      [
        { title: "4 Include components", lines: ["conditions over the answers", "(Common Expression Language)", "decide which components", "are included"] },
        { title: "5 Choose providers", lines: ["the answer about size picks", "a scale band; the band", "chooses a provider profile", "for each job"] },
        { title: "6 Apply settings", lines: ["answers and the chosen", "profiles set each", "component's settings"] },
        { title: "7 Check connections", lines: ["every interface a component", "requires is connected to", "one that provides it"] },
      ],
    ],
    then: "a design",
  },
  {
    title: "aepm: assembles the design on your computer",
    who: "aepm",
    zone: "amber",
    kind: "poker",
    icon: "file",
    rows: [
      [
        { title: "8 Resolve versions", lines: ["the exact version of each", "component in the design"] },
        { title: "9 Download", lines: ["each archive from its", "publisher's GitHub release"] },
        { title: "10 Check", lines: ["the sha256 digest of each", "archive, and the signatures", "of the guardians you trust"] },
        { title: "11 Review", lines: ["you or your agent read what", "will be installed, before", "anything is written"] },
      ],
      [
        { title: "12 Install", lines: ["copy the files each package", "lists; run none of their code"] },
        { title: "13 Verify", lines: ["run the components' own", "tests on the result"] },
        { title: "aepm create", lines: ["coming soon: one command", "that runs steps 4 to 13", "from your answers"], dashed: true, apart: true },
      ],
    ],
    then: "the application",
  },
  {
    title: "Delivery: your accounts, your people",
    who: "your accounts and ourapps",
    zone: "green",
    kind: "rooms",
    icon: "rooms",
    rows: [
      [
        { title: "14 Your accounts", lines: ["the application runs on", "hosting, Apple and Android", "accounts you own"] },
        { title: "15 Share link", lines: ["ourapps makes one private", "link per person or group"] },
        { title: "16 Your people", lines: ["staff, members, customers", "open the link and install", "on their devices"] },
      ],
    ],
    then: "later",
  },
  {
    title: "Updates: you approve every change",
    who: "aepm and you, the owner",
    zone: "pink",
    kind: "ui",
    icon: "ui",
    rows: [
      [
        { title: "17 New version", lines: ["a publisher releases a new", "version of a component"] },
        { title: "18 Proposal", lines: ["aepm proposes the update", "and shows what changes"] },
        { title: "19 Approve", lines: ["you, the owner, approve", "it or leave it"] },
        { title: "20 Apply", lines: ["aepm applies it with", "recovery: it can return to", "the previous version; your", "people update through the", "same link"] },
      ],
    ],
  },
];

const M = 40;
const SPINE = 24; // the left margin line that joins the parts
const ZX = M + SPINE + 20;
const ZP = 26;
const GAP = 56;
const APART = 90;
const ROW_GAP = 44;
const PART_GAP = 54;
const FLOW = "#455A64";
const ARROW_Y = 44; // where a step-to-step arrow meets a card, from its top

export function cookingSvg(): string {
  const c = new Canvas();
  const legend = c.legend(
    M,
    108,
    "Legend",
    PARTS.map((p) => [`a step by ${p.who}`, COLOURS[p.kind][1]] as [string, string]),
    [
      { text: "the next step", colour: FLOW, arrow: true },
      { text: "dashed card: coming soon", colour: "#FB8C00", dash: "5 3", width: 1.4 },
    ],
    ["Each zone is one party that acts.", "A pill names what passes from one", "zone to the next.", "ourapps keeps the library, the catalogue", "and the share links. The building happens", "in your repository, on your computer."],
  );

  // Every card's size first, so every row and zone can be sized.
  const sized = PARTS.map((p) => p.rows.map((row) => row.map((s) => ({ s, ...measure(s.title, s.lines) }))));
  const rowWidth = (row: { s: Step; w: number }[]) => row.reduce((n, x, i) => n + x.w + (i === 0 ? 0 : x.s.apart ? APART : GAP), 0);
  const zoneW = Math.max(...sized.flatMap((rows) => rows.map(rowWidth))) + 2 * ZP;
  const width = Math.max(ZX + zoneW + M, legend.right + M);

  const boxes: CardBox[][][] = [];
  const zoneTops: number[] = [];
  let y = legend.bottom + 50;
  PARTS.forEach((p, pi) => {
    const top = y;
    zoneTops.push(top);
    let ry = top + ZTITLE + 24;
    const rowBoxes: CardBox[][] = [];
    const heights = sized[pi]!.map((row) => Math.max(...row.map((x) => x.h)));
    const zoneH = ZTITLE + 24 + heights.reduce((n, h) => n + h, 0) + ROW_GAP * (heights.length - 1) + ZP;
    c.zone(ZX, top, zoneW, zoneH, p.title, p.zone);
    sized[pi]!.forEach((row, ri) => {
      let x = ZX + ZP;
      const placed: CardBox[] = [];
      row.forEach((x0, i) => {
        if (i > 0) x += x0.s.apart ? APART : GAP;
        const box = c.card(x, ry, x0.s.title, x0.s.lines, x0.s.dashed ? "poker" : p.kind, x0.s.dashed ? "file" : p.icon, { dashed: x0.s.dashed });
        if (i > 0 && !x0.s.apart) c.hv([[placed[i - 1]!.right, ry + ARROW_Y], [box.left - 1, ry + ARROW_Y]], FLOW, 2, { arrow: true });
        placed.push(box);
        x = box.right;
      });
      // A new row starts at the left: down from the end of the row before, across the gap, down into the first card.
      if (ri > 0) {
        const prev = rowBoxes[ri - 1]!;
        const last = prev[prev.length - 1]!;
        const gy = ry - ROW_GAP / 2;
        const first = placed[0]!;
        c.hv([[last.cx, last.bottom], [last.cx, gy], [first.cx, gy], [first.cx, first.top - 1]], FLOW, 2, { arrow: true });
      }
      rowBoxes.push(placed);
      ry += heights[ri]! + ROW_GAP;
    });
    boxes.push(rowBoxes);
    y = top + zoneH + PART_GAP;
  });
  const height = y - PART_GAP + M;

  // The spine: from the last step of a part, down into the gap below it, left to the margin, down beside the next
  // part and into its first step. A pill on the run across the gap names what passes.
  const spineX = M + SPINE / 2;
  PARTS.forEach((p, pi) => {
    if (!p.then) return;
    const rows = boxes[pi]!;
    const lastRow = rows[rows.length - 1]!;
    const steps = lastRow.filter((_, i) => !PARTS[pi]!.rows[rows.length - 1]![i]!.apart);
    const from = steps[steps.length - 1]!;
    const to = boxes[pi + 1]![0]![0]!;
    const gy = zoneTops[pi + 1]! - PART_GAP / 2;
    c.hv([[from.cx, from.bottom], [from.cx, gy], [spineX, gy], [spineX, to.top + ARROW_Y], [to.left - 1, to.top + ARROW_Y]], FLOW, 2, { arrow: true });
    c.pill(Math.min(from.cx - pillWidth(p.then) / 2 - 16, ZX + zoneW - pillWidth(p.then) / 2 - 20), gy, p.then, INK);
  });

  const header = Canvas.titleBlock("How a recipe is cooked", "From a recipe in the library to an application on your people's devices, and every update after");
  return c.svg(width, height, "How a recipe is cooked: the steps from a recipe to an application and its updates, by who acts.", header);
}
