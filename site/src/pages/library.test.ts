import { describe, expect, it } from "vitest";
import { exampleComponentEntry, exampleRecipeEntry, type ComponentSummary, type ComponentVersionView, type Deprecation, type RecipeSummary, type RecipeVersionView } from "@my/store-shared";
import { componentBody, componentCard, deprecationBanner, recipeBody, recipeCard } from "./library.js";

const origin = "https://ourapps.app";
const publisher = { slug: "dana", displayName: "Dana" };

function recipeView(patch: Partial<RecipeVersionView> = {}): RecipeVersionView {
  const e = exampleRecipeEntry();
  const r = e.recipe;
  const suitability = exampleComponentEntry().suitability;
  return {
    name: r.name,
    slug: "poker-night",
    version: r.version,
    title: r.title,
    summary: r.summary,
    category: r.category,
    tags: r.tags,
    targets: r.targets,
    publishedAt: "2026-10-16T10:00:00.000Z",
    publisher,
    repository: e.source.repository,
    url: `${origin}/recipes/poker-night`,
    status: "active",
    deprecations: [],
    digest: e.digest,
    source: e.source,
    bundle: { ...e.bundle, url: `${origin}/api/recipes/poker-night/0.1.0/bundle` },
    description: e.page.description,
    diagram: `${origin}/api/recipes/poker-night/0.1.0/diagram.svg`,
    screenshots: [],
    components: r.components.map((c) => ({ ...c, catalogue: c.id === "deck" ? { url: `${origin}/components/card-deck`, description: "A shuffled deck.", suitability, guardians: ["Example Guardian Ltd"] } : null, deprecation: null })),
    jobs: r.jobs,
    scale: r.scale,
    questions: r.questions,
    connections: r.connections,
    tests: r.tests,
    instructions: r.instructions,
    versions: [{ version: r.version, digest: e.digest, publishedAt: "2026-10-16T10:00:00.000Z" }],
    ...patch,
  };
}

function componentView(patch: Partial<ComponentVersionView> = {}): ComponentVersionView {
  const e = exampleComponentEntry();
  return {
    name: e.name,
    slug: "card-deck",
    version: e.version,
    description: e.description,
    category: e.category,
    tags: e.tags,
    targets: e.targets,
    provides: e.provides,
    requires: e.requires,
    publishedAt: "2026-10-16T10:00:00.000Z",
    publisher,
    repository: e.source.repository,
    url: `${origin}/components/card-deck`,
    status: "active",
    deprecations: [],
    digest: e.digest,
    guardians: e.guardians,
    dependencies: [],
    suitability: e.suitability,
    migration: null,
    source: e.source,
    bundle: { ...e.bundle, url: `${origin}/api/components/card-deck/0.1.0/bundle` },
    versions: [{ version: e.version, digest: e.digest, publishedAt: "2026-10-16T10:00:00.000Z" }],
    usedBy: [{ name: "acme/poker-night", slug: "poker-night", title: "Poker Night", version: "0.1.0", url: `${origin}/recipes/poker-night` }],
    ...patch,
  };
}

describe("recipe page", () => {
  it("shows description, diagram, questions, components with suitability and guardians, targets, answer sets and versions", () => {
    const html = recipeBody(recipeView(), "latest").html;
    expect(html).toContain("Poker Night");
    expect(html).toContain("Build an application from the Poker Night recipe");
    expect(html).toContain("coming soon");
    expect(html).not.toContain("aepm create poker-night");
    expect(html).toContain("Poker Night deals a hand");
    expect(html).toContain('src="https://ourapps.app/api/recipes/poker-night/0.1.0/diagram.svg"');
    expect(html).toContain("Publisher's diagram");
    expect(html).toContain("How its components connect");
    expect(html).toContain('href="/api/recipes/poker-night/0.1.0/components.svg" target="_blank"');
    expect(html).toContain('src="/api/recipes/poker-night/0.1.0/components.svg"');
    expect(html.indexOf("components.svg")).toBeLessThan(html.indexOf("diagram.svg"));
    expect(html).toContain("Questions it asks (7)");
    expect(html).toContain("Starting chips?");
    expect(html).toContain("a reference, never a value");
    expect(html).toContain('href="/components/card-deck"');
    expect(html).toContain("Guardians: Example Guardian Ltd");
    expect(html).toContain("Not in the catalogue");
    expect(html).toContain("when lessons is set");
    expect(html).toContain("when (targets includes ios) or (targets includes macos)");
    expect(html).toContain("asked when lessons is set");
    expect(html).toContain("asked when server is paid");
    expect(html).toContain("fewer than 10 people, occasional use");
    expect(html).toContain("iPhone and iPad");
    expect(html).toContain("Hosting provider");
    expect(html).toContain("<b>web-only</b>");
    expect(html).toContain("<b>0.1.0</b>");
    expect(html).toContain('href="/recipes/poker-night.txt"');
    expect(html).toContain('href="/recipes/poker-night.json"');
    expect(html).toContain("https://github.com/acme/poker-night-recipe/releases/tag/v0.1.0");
  });

  it("links the variants to the shown version when one is chosen", () => {
    const html = recipeBody(recipeView(), "0.1.0").html;
    expect(html).toContain('href="/recipes/poker-night.json?version=0.1.0"');
  });

  it("escapes publisher text and leaves out an absent diagram and empty parts", () => {
    const html = recipeBody(recipeView({ publisher: { slug: "x", displayName: "<img src=x onerror=alert(1)>" }, diagram: null, questions: [], jobs: [], scale: null, description: "<script>x</script>" }), "latest").html;
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Publisher's diagram");
    expect(html).toContain("components.svg");
    expect(html).toContain("This recipe asks no questions.");
    expect(html).not.toContain("Choosing by suitability");
  });

  it("shows jobs and the scale question when the recipe has them", () => {
    const html = recipeBody(recipeView(), "latest").html;
    expect(html).toContain("Choosing by suitability");
    expect(html).toContain("acme/server-host (free), acme/server-host (paid)");
    expect(html).toContain("restricts the candidates first");
  });

  it("names the condition of a job candidate", () => {
    const r = recipeView();
    const html = recipeBody(recipeView({ jobs: [{ ...r.jobs[0], candidates: [{ component: "acme/server-host", profile: "paid", includedWhen: { question: "server", equals: "paid" } }] }] }), "latest").html;
    expect(html).toContain("acme/server-host (paid) when server is paid");
  });
});

describe("component page", () => {
  it("shows interfaces, suitability, guardians, migration, recipes that use it and versions", () => {
    const html = componentBody(componentView(), "latest").html;
    expect(html).toContain("acme/card-deck");
    expect(html).toContain("What it connects to");
    expect(html).toContain('href="/api/components/card-deck/0.1.0/connections.svg" target="_blank"');
    expect(html).toContain('src="/api/components/card-deck/0.1.0/connections.svg"');
    expect(html).toContain("Example Guardian Ltd");
    expect(html).toContain("ae/card-deck");
    expect(html).toContain('href="/components?requires=ae%2Fcard-deck"');
    expect(html).toContain('href="/components?provides=ae%2Frandom-source"');
    expect(html).toContain("no practical limit");
    expect(html).toContain("No cost");
    expect(html).toContain("This component keeps no data.");
    expect(html).toContain('href="/recipes/poker-night"');
    expect(html).toContain('href="/components/card-deck.json"');
  });

  it("marks an optional requirement", () => {
    const html = componentBody(componentView({ requires: [{ id: "random-source", type: "ae/random-source", version: "1.0.0", optional: true }, { id: "audit", type: "ae/audit", version: "1.0.0" }] }), "latest").html;
    expect(html).toContain('<code>random-source</code> <span class="small muted">optional</span>');
    expect(html).not.toContain('<code>audit</code> <span class="small muted">optional</span>');
  });

  it("describes a data-keeping component and no guardian", () => {
    const html = componentBody(componentView({ guardians: [], usedBy: [], migration: { stores: [{ id: "rooms", schema: { name: "ae/room-state", version: "1.0.0" } }], formats: ["ndjson"], portable: true, requiresStop: true, retentionDays: 30 } }), "latest").html;
    expect(html).toContain("No guardian is recorded");
    expect(html).toContain("rooms (ae/room-state 1.0.0)");
    expect(html).toContain("it must stop while data moves");
    expect(html).toContain("kept 30 days after removal");
    expect(html).toContain("No listed recipe names it yet.");
  });
});

const orphan: Deprecation = { name: "acme/card-deck", version: "0.1.0", status: "orphaned", reason: "owner-deleted", since: "2026-11-01T09:00:00.000Z", via: [] };
const deprecatedPart: Deprecation = { name: "acme/seating", version: "0.1.0", status: "deprecated", reason: "owner-deprecated", since: "2026-11-02T09:00:00.000Z", replacement: "acme/seating-two", via: ["acme/poker-night"] };

describe("deprecation banner", () => {
  it("shows nothing for an active entry", () => {
    expect(recipeBody(recipeView(), "latest").html).not.toContain("role=\"alert\"");
    expect(componentBody(componentView(), "latest").html).not.toContain("role=\"alert\"");
  });

  it("says an orphaned component is orphaned, since when, and what to do", () => {
    const html = componentBody(componentView({ status: "orphaned", publisher: null, deprecations: [orphan] }), "latest").html;
    expect(html).toContain('role="alert"');
    expect(html).toContain("Orphaned.");
    expect(html).toContain("its publisher deleted their account and nobody maintains it (since 2026-11-01)");
    expect(html).toContain("decide never to update");
    expect(html).toContain("Publisher&#39;s account deleted");
    expect(html).toContain('href="/api/components/card-deck/0.1.0/deprecations"');
  });

  it("lists flagged components under a recipe, with the replacement as a link", () => {
    const html = recipeBody(recipeView({ deprecations: [deprecatedPart] }), "latest").html;
    expect(html).toContain("This recipe uses deprecated or orphaned components.");
    expect(html).toContain("acme/seating 0.1.0 is deprecated by its publisher (since 2026-11-02, used by acme/poker-night)");
    expect(html).toContain('href="/components/seating-two"');
    expect(html).toContain('href="/api/recipes/poker-night/0.1.0/deprecations"');
  });

  it("flags a deprecated recipe itself and links its replacement as a recipe", () => {
    const own: Deprecation = { name: "acme/poker-night", version: "0.1.0", status: "deprecated", reason: "owner-deprecated", since: "2026-11-03T09:00:00.000Z", replacement: "acme/poker-night-two", via: [] };
    const html = deprecationBanner({ name: "acme/poker-night", version: "0.1.0", status: "deprecated", deprecations: [own] }, "recipes").html;
    expect(html).toContain("Deprecated.");
    expect(html).toContain('href="/recipes/poker-night-two"');
    expect(html).not.toContain("uses deprecated");
  });

  it("marks a flagged part in the component table and cards carry a status pill", () => {
    const base = recipeView();
    const view = recipeView({ components: base.components.map((c) => (c.id === "seats" ? { ...c, deprecation: deprecatedPart } : c)), deprecations: [deprecatedPart] });
    expect(recipeBody(view, "latest").html).toContain('<span class="pill warn">Deprecated</span>');
    expect(recipeCard({ ...view, status: "deprecated" }).html).toContain('<span class="pill warn">Deprecated</span>');
    expect(recipeCard({ ...view, deprecations: [deprecatedPart] }).html).toContain("Uses deprecated parts");
    expect(componentCard({ ...componentView(), status: "orphaned", publisher: null, deprecations: [orphan] }).html).toContain('<span class="pill bad">Orphaned</span>');
  });

  it("lists what a component builds on", () => {
    const html = componentBody(componentView({ dependencies: [{ name: "acme/random-pool", version: "0.2.0" }] }), "latest").html;
    expect(html).toContain("Builds on");
    expect(html).toContain('href="/components/random-pool"');
  });
});

describe("cards", () => {
  it("link to the page and filter by category", () => {
    const r: RecipeSummary = { ...recipeView(), publisher };
    expect(recipeCard(r).html).toContain('href="/recipes/poker-night"');
    expect(recipeCard(r).html).toContain('href="/recipes?category=games"');
    const c: ComponentSummary = { ...componentView() };
    const html = componentCard(c).html;
    expect(html).toContain('href="/components/card-deck"');
    expect(html).toContain("Provides card-deck. Requires random-source.");
  });
});
