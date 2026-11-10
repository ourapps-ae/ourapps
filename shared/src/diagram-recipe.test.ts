import { describe, expect, it } from "vitest";
import { fanTracks } from "./diagram-component.js";
import { assignTracks, balanceColumns, columnsByDepth, depths, recipeComponentsSvg, MAX_WIDTH } from "./diagram-recipe.js";
import { componentConnectionsSvg } from "./diagram-component.js";
import { neighbourhoodInput, ourpokerRecipeInput } from "./fixtures/render.js";
import { OURPOKER_CATALOGUE, OURPOKER_RECIPE } from "./fixtures/ourpoker.js";

const size = (svg: string) => /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.slice(1).map(Number) as [number, number];
const fontSizes = (svg: string) => [...svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
const pathPoints = (svg: string) =>
  [...svg.matchAll(/<path d="(M [^"]+)" fill="none"/g)].map((m) =>
    m[1]!
      .slice(2)
      .split(" L ")
      .map((p) => p.split(" ").map(Number) as [number, number]),
  );

describe("layout functions", () => {
  it("measures dependency depth along the longest chain and survives a cycle", () => {
    const d = depths(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["a", "c"]]);
    expect(Object.fromEntries(d)).toEqual({ a: 0, b: 1, c: 2, d: 0 });
    const cyclic = depths(["a", "b"], [["a", "b"], ["b", "a"]]);
    expect(Math.max(...cyclic.values())).toBeLessThanOrEqual(2);
  });

  it("splits crowded levels and folds deep ones into the last column", () => {
    expect(columnsByDepth([["a", "b", "c", "d"], ["e"]], 3)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(columnsByDepth([["a"], ["b"], ["c"], ["d"]], 2)).toEqual([["a"], ["b", "c", "d"]]);
    expect(columnsByDepth([], 3)).toEqual([]);
  });

  it("moves nodes out of the tallest column only within their providers and users", () => {
    const cols = balanceColumns([["a", "b", "c", "d"], [], ["e"]], [["a", "e"], ["b", "e"]]);
    expect(cols.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(cols[2]).toEqual(["e"]);
    const held = balanceColumns([["a", "b", "c"], ["d"]], [["a", "d"], ["b", "d"], ["c", "d"]]);
    expect(held).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("gives overlapping intervals different tracks and reuses free ones", () => {
    expect(assignTracks([[0, 10], [5, 15], [11, 20], [16, 30]])).toEqual([0, 1, 0, 1]);
    expect(assignTracks([[0, 10], [10, 20]])).toEqual([0, 1]);
  });

  it("orders fan tracks so lines into one card do not cross", () => {
    // interface rows 0, 100, 400 into component rows 200, 215, 230
    expect(fanTracks([0, 100, 400], [200, 215, 230])).toEqual([0, 1, 2]);
    expect(fanTracks([300, 400], [200, 215])).toEqual([1, 0]);
  });
});

describe("recipe component diagram", () => {
  const svg = recipeComponentsSvg(ourpokerRecipeInput());

  it("draws every OurPoker component, its zones and its own component within the width", () => {
    for (const c of OURPOKER_RECIPE.components) expect(svg, c.id).toContain(`>${c.id}</text>`);
    expect(svg).toContain(">OurPoker</text>");
    for (const zone of ["Rooms: 9 components", "Presentation: 8 components", "Delivery: 7 components", "Game framework: 11 components", "Poker: 4 components"]) expect(svg).toContain(zone);
    expect(size(svg)[0]).toBeLessThanOrEqual(MAX_WIDTH);
    expect(svg).toContain("Legend");
  });

  it("marks conditional components with a dashed border and the condition in words", () => {
    expect(svg).toContain("when targets includes web");
    expect(svg).toContain("when computerPlayers is not none");
    expect(svg.match(/stroke-dasharray="5 3"\/>/g)!.length).toBe(OURPOKER_RECIPE.components.filter((c) => c.includedWhen).length);
  });

  it("draws one arrowhead per connection, lines only horizontal or vertical, text 11px or more", () => {
    expect(svg.match(/<path d="M [^"]+" fill="none" stroke="#[0-9A-F]{6}" stroke-width="2" marker-end/g)!.length).toBe(OURPOKER_RECIPE.connections.length);
    for (const points of pathPoints(svg)) for (let i = 1; i < points.length; i++) expect(points[i]![0] === points[i - 1]![0] || points[i]![1] === points[i - 1]![1]).toBe(true);
    expect(Math.min(...fontSizes(svg))).toBeGreaterThanOrEqual(11);
  });

  it("puts components the catalogue does not list in a zone named Other", () => {
    const input = ourpokerRecipeInput();
    input.catalogue = input.catalogue.map((c, i) => (i === 0 ? null : c));
    const other = recipeComponentsSvg(input);
    expect(other).toContain("Other: 1 component");
    expect(other).toContain("not in the catalogue");
  });

  it("draws a recipe with no connections and one with an unknown category", () => {
    const tiny = recipeComponentsSvg({ name: "acme/tiny", version: "1.0.0", title: "Tiny", components: [{ id: "x", name: "acme/x", version: "1.0.0", includedWhen: null }], connections: [], catalogue: [{ name: "acme/x", version: "1.0.0", category: "gardening", provides: [], requires: [] }] });
    expect(tiny).toContain("Gardening: 1 component");
    expect(tiny).toContain(">Tiny</text>");
  });

  it("escapes names", () => {
    const odd = recipeComponentsSvg({ name: "acme/odd", version: "1.0.0", title: "A <b> & c", components: [], connections: [], catalogue: [] });
    expect(odd).toContain("A &lt;b&gt; &amp; c");
    expect(odd).not.toContain("<b>");
  });
});

describe("component connections diagram", () => {
  for (const slug of ["card-deck", "turn-engine", "theme", "video-calls"]) {
    it(`draws ${slug} with text 11px or more and only straight lines`, () => {
      const svg = componentConnectionsSvg(neighbourhoodInput(slug));
      const self = OURPOKER_CATALOGUE.find((c) => c.name.endsWith(`/${slug}`))!;
      for (const p of [...self.requires, ...self.provides]) expect(svg).toContain(`${p.type} ${p.version}`);
      expect(Math.min(...fontSizes(svg))).toBeGreaterThanOrEqual(11);
      for (const points of pathPoints(svg)) for (let i = 1; i < points.length; i++) expect(points[i]![0] === points[i - 1]![0] || points[i]![1] === points[i - 1]![1]).toBe(true);
    });
  }

  it("draws a component with no interfaces", () => {
    const svg = componentConnectionsSvg({ name: "acme/alone", version: "1.0.0", category: null, targets: { client: [], server: [] }, provides: [], requires: [], profiles: [], providers: {}, consumers: {} });
    expect(svg).toContain("This component states no interfaces.");
  });
});
