import { describe, expect, it } from "vitest";
import { Canvas, measure, wrap } from "./diagram-kit.js";

describe("diagram kit", () => {
  it("sizes a card from its text and draws a valid document", () => {
    const c = new Canvas();
    const a = c.card(40, 40, "theme", ["provides ae/theme"], "ui", "ui");
    expect(a.w).toBe(measure("theme", ["provides ae/theme"]).w);
    const b = c.card(300, 40, "web-host", ["uses ae/theme"], "host", "host");
    c.hv([[a.right, a.cy], [b.left, b.cy]], "#1E88E5", 2, { arrow: true });
    const svg = c.svg(600, 200, "test -- comment");
    expect(svg).toContain('viewBox="0 0 600 200"');
    expect(svg).toContain('marker-end="url(#arr-1E88E5)"');
    expect(svg).not.toContain("--  ");
  });

  it("refuses overlapping cards, diagonal lines and lines through cards", () => {
    const overlapping = new Canvas();
    overlapping.card(40, 40, "a", ["x"], "part");
    overlapping.card(60, 50, "b", ["x"], "part");
    expect(() => overlapping.svg(200, 200, "t")).toThrow(/overlap/);

    expect(() => new Canvas().hv([[0, 0], [5, 5]], "#000000")).toThrow(/diagonal/);

    const through = new Canvas();
    through.card(100, 100, "middle", ["x", "y"], "part");
    through.hv([[20, 130], [400, 130]], "#1E88E5");
    expect(() => through.svg(500, 300, "t")).toThrow(/through card/);
  });

  it("wraps text on spaces", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });
});
