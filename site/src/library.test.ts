import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@my/store-shared";
import { answerText, conditionHtml, costLabel, includedWhenHtml, loadText, paragraphsOf, queryString, readQuery, releaseUrl, targetLabel, versionFromSearch, withFilter } from "./library.js";
import { termsBody } from "./pages/terms.js";
import { storeFrame } from "./pages/public.js";
import { html } from "./html.js";

describe("library query", () => {
  it("reads filters, search and paging and ignores the rest", () => {
    expect(readQuery("?q=poker&category=games&target=ios&tag=cards&offset=24&x=1")).toEqual({ q: "poker", category: "games", target: "ios", tag: "cards", offset: 24 });
    expect(readQuery("?provides=ae/card-deck&requires=ae/random-source")).toEqual({ provides: ["ae/card-deck"], requires: ["ae/random-source"] });
    expect(readQuery("")).toEqual({});
    expect(readQuery("?offset=-3&category=%20")).toEqual({});
    expect(readQuery("?offset=abc")).toEqual({});
  });

  it("reads the deprecated filter and ignores include and unknown values", () => {
    expect(readQuery("?deprecated=exclude")).toEqual({ deprecated: "exclude" });
    expect(readQuery("?deprecated=only&category=games")).toEqual({ deprecated: "only", category: "games" });
    expect(readQuery("?deprecated=include")).toEqual({});
    expect(readQuery("?deprecated=maybe")).toEqual({});
    expect(queryString({ deprecated: "only" })).toBe("?deprecated=only");
    expect(withFilter({ deprecated: "only" }, "deprecated", "only")).toEqual({});
  });

  it("writes a canonical query string", () => {
    expect(queryString({})).toBe("");
    expect(queryString({ category: "games", q: "poker night", offset: 24 })).toBe("?q=poker+night&category=games&offset=24");
    expect(queryString({ provides: ["ae/card-deck"] })).toBe("?provides=ae%2Fcard-deck");
    expect(queryString({ provides: ["ae/card-deck", "ae/seating"] })).toBe("?provides=ae%2Fcard-deck&provides=ae%2Fseating");
    expect(queryString({ offset: 0 })).toBe("");
  });

  it("changes one filter, toggles it off and restarts paging", () => {
    expect(withFilter({ category: "games", offset: 24 }, "target", "ios")).toEqual({ category: "games", target: "ios" });
    expect(withFilter({ category: "games" }, "category", "games")).toEqual({});
    expect(withFilter({ category: "games", q: "x" }, "category", undefined)).toEqual({ q: "x" });
    expect(withFilter({ provides: ["ae/card-deck"] }, "provides", "ae/seating")).toEqual({ provides: ["ae/card-deck", "ae/seating"] });
    expect(withFilter({ provides: ["ae/card-deck", "ae/seating"] }, "provides", "ae/card-deck")).toEqual({ provides: ["ae/seating"] });
    expect(readQuery("?provides=ae/card-deck&provides=ae/seating")).toEqual({ provides: ["ae/card-deck", "ae/seating"] });
  });

  it("picks the version from the address", () => {
    expect(versionFromSearch("?version=0.2.0")).toBe("0.2.0");
    expect(versionFromSearch("")).toBe("latest");
    expect(versionFromSearch("?version=../x")).toBe("latest");
    expect(versionFromSearch("?version=1.2")).toBe("latest");
  });
});

describe("library wording", () => {
  it("names targets for people", () => {
    expect(targetLabel("ios")).toBe("iPhone and iPad");
    expect(targetLabel("tvos")).toBe("Apple TV");
    expect(targetLabel("hosting-provider")).toBe("Hosting provider");
    expect(targetLabel("other")).toBe("other");
  });

  it("describes loads and costs", () => {
    expect(loadText({})).toBe("no practical limit");
    expect(loadText({ concurrentPeople: 10, requestsPerDay: 100000, storedMegabytes: 1024 })).toBe("up to 10 people at once, 100,000 requests a day, 1,024 MB stored");
    expect(loadText({ seats: 4 })).toBe("up to seats 4");
    expect(costLabel("metered")).toBe("Metered");
    expect(costLabel("none")).toBe("No cost");
  });

  it("describes answers and conditions", () => {
    expect(answerText(undefined)).toBe("asked");
    expect(answerText(null)).toBe("asked");
    expect(answerText(true)).toBe("yes");
    expect(answerText(["web", "ios"])).toBe("web, ios");
    expect(answerText([])).toBe("none");
    expect(answerText(5000)).toBe("5000");
    expect(includedWhenHtml({ includedWhen: null }).html).toBe("always");
    expect(includedWhenHtml({ includedWhen: "lessons" }).html).toBe("when lessons is yes");
    expect(includedWhenHtml({ includedWhen: "lessons == true" }).html).toBe("when lessons is yes");
    expect(includedWhenHtml({ includedWhen: "scale in ['small', 'medium']" }).html).toBe("when scale is one of small, medium");
    expect(includedWhenHtml({ includedWhen: "lessons && !('web' in targets)" }).html).toBe("when (lessons is yes) and (targets does not include web)");
    expect(includedWhenHtml({ includedWhen: "'ios' in targets || 'macos' in targets" }).html).toBe("when (targets includes ios) or (targets includes macos)");
    expect(includedWhenHtml({ includedWhen: "'ios' in targets" }).html).toBe("when targets includes ios");
    expect(includedWhenHtml({ includedWhen: "size(languages) > 1" }).html).toBe("when <code>size(languages) &gt; 1</code>");
    expect(conditionHtml("players >= 4 && video").html).toBe("(players is at least 4) and (video is yes)");
  });

  it("links to the release and splits paragraphs", () => {
    expect(releaseUrl("acme/card-deck", "v0.1.0")).toBe("https://github.com/acme/card-deck/releases/tag/v0.1.0");
    expect(releaseUrl("acme/x", "rel/1")).toBe("https://github.com/acme/x/releases/tag/rel%2F1");
    expect(paragraphsOf("One.\r\n\r\nTwo.\n\n\n  \nThree")).toEqual(["One.", "Two.", "Three"]);
  });
});

describe("public copy", () => {
  it("terms describe the library and catalogue", () => {
    const text = termsBody().html;
    expect(text).toContain("public recipe library and component catalogue");
    expect(text).toContain("it does not keep the packages");
    expect(text).toContain("Recipes and components you publish");
    expect(text).toContain(`Version ${TERMS_VERSION}`);
  });

  it("the terms version is a date", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  });

  it("the store frame keeps the copyright, links the library and says what is public", () => {
    const page = storeFrame(html`<p>x</p>`).html;
    expect(page).toContain("Copyright Level N Ltd 2026");
    expect(page).toContain('href="/recipes"');
    expect(page).toContain('href="/components"');
    expect(page).toContain("The recipe library and component catalogue are public");
  });
});

describe("one story across the pages", () => {
  const sources = import.meta.glob(["./pages/*.ts", "../index.html", "../public/agents.md", "../public/llms.txt"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const read = (file: string) => {
    const text = sources[file];
    if (text === undefined) throw new Error(`${file} not found`);
    return text;
  };

  it("the guide opens with recipes and components and keeps the delivery steps", () => {
    const guide = read("./pages/guide.ts");
    const ids = [...guide.matchAll(/^ {6}id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    expect(ids.slice(0, 6)).toEqual(["how-it-works", "find-recipe", "compose", "publish", "deprecation", "tldr"]);
    for (const id of ["sign-in", "credentials", "add-app", "release", "share", "testflight"]) expect(ids).toContain(id);
  });

  it("no page or document tells the old story", () => {
    const files = ["./pages/public.ts", "./pages/guide.ts", "./pages/small.ts", "./pages/example.ts", "./pages/shell.ts", "./pages/dev.ts", "./pages/prompts.ts", "./pages/reference.ts", "./pages/terms.ts", "../index.html", "../public/agents.md", "../public/llms.txt"];
    for (const file of files) {
      const text = read(file);
      for (const old of ["Built with AI agents, shared with friends", "Private by design", "a private installer", "Builds apps for friends and family", "friends and family", "For your friends", "At eight people", "private app store"]) expect(text, `${file}: ${old}`).not.toContain(old);
    }
  });

  it("the landing page speaks to businesses, clubs, households and shops", () => {
    const landing = read("./pages/public.ts");
    for (const text of ["Our apps for our businesses, our club, our home, our shop", "For your people", "For you, the developer", "Who it is for", "A clinic's appointment board", "A club's league night", "A shop's order screen", "A household's chores planner", "A restaurant's table display", "Fast", "Low cost", "Maintainable and safe", "Delivered to your people"]) expect(landing, text).toContain(text);
    const small = read("./pages/small.ts");
    expect(small).toContain("At a small organisation's size, the expensive parts are free");
    expect(small).toContain("Choose free or paid by size");
  });

  it("the console sidebar links the library and the catalogue", () => {
    const shell = read("./pages/shell.ts");
    expect(shell).toContain('href: "/recipes"');
    expect(shell).toContain('href: "/components"');
  });
});
