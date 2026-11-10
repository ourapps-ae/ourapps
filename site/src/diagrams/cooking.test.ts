import { describe, expect, it } from "vitest";
import committed from "../../public/diagrams/cooking-a-recipe.svg?raw";
import { COOKING_ALT, COOKING_FILE, cookingFigure } from "../figures.js";
import { cookingSvg } from "./cooking.js";

describe("How a recipe is cooked", () => {
  const svg = cookingSvg();

  it("matches the committed file; run node scripts/build-diagrams.ts after a change", () => {
    expect(committed.trim()).toBe(svg.trim());
  });

  it("shows every step and marks aepm create as coming soon", () => {
    for (const step of ["1 Find a recipe", "2 Read its questions", "3 Answer them", "4 Include components", "5 Choose providers", "6 Apply settings", "7 Check connections", "8 Resolve versions", "9 Download", "10 Check", "11 Review", "12 Install", "13 Verify", "14 Your accounts", "15 Share link", "16 Your people", "17 New version", "18 Proposal", "19 Approve", "20 Apply"]) {
      expect(svg, step).toContain(`>${step}</text>`);
    }
    expect(svg).toContain(">aepm create</text>");
    expect(svg).toContain("coming soon: one command");
    expect(svg).toContain("Legend");
  });

  it("keeps text at 11px or more, lines straight, and no em dashes", () => {
    const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    for (const m of svg.matchAll(/<path d="(M [^"]+)" fill="none"/g)) {
      const points = m[1]!.slice(2).split(" L ").map((p) => p.split(" ").map(Number));
      for (let i = 1; i < points.length; i++) expect(points[i]![0] === points[i - 1]![0] || points[i]![1] === points[i - 1]![1]).toBe(true);
    }
    expect(svg).not.toContain("\u2014");
    expect(COOKING_ALT).not.toContain("\u2014");
  });

  it("links the figure to the full-size file with alt text that names the steps", () => {
    const html = cookingFigure().html;
    expect(html).toContain(`href="${COOKING_FILE}" target="_blank"`);
    expect(html).toContain(`src="${COOKING_FILE}"`);
    for (const words of ["find a recipe", "conditions over the answers", "sha256 digest", "aepm create is coming soon", "share link", "you approve it"]) expect(COOKING_ALT).toContain(words);
  });
});
