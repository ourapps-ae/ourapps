import { beforeEach, describe, expect, it } from "vitest";
import { EXAMPLE_BUNDLE_DIGEST, EXAMPLE_DIGEST, exampleRecipeEntry, type ComponentEntry, type RecipeEntry } from "@my/store-shared";
import { OURPOKER_CATALOGUE, OURPOKER_RECIPE } from "../../shared/src/fixtures/ourpoker.js";
import { CatalogueDb, type EntryRow } from "../src/catalogue-db.js";
import type { Env } from "../src/env.js";
import { SECURITY_HEADERS, handle } from "../src/index.js";
import { api, clearDb, signIn, testDeps, testEnv } from "./helpers.js";

let env: Env;
const deps = testDeps();
const now = "2026-11-10T10:00:00.000Z";

const get = (path: string) => handle(api(null, "GET", path), env, deps);

function entry(name: string, developerId: string): EntryRow {
  const [scope, slug] = name.split("/") as [string, string];
  return { id: `id-${slug}`, name, scope, slug, developerId, repo: `${scope}/${slug}`, latestVersion: null, flag: null, createdAt: now, updatedAt: now };
}

// The OurPoker recipe and its 39 components, stored as publishing stores them.
async function seed(): Promise<void> {
  const developerId = (await env.DB.prepare("SELECT id FROM developers").first<{ id: string }>())!.id;
  const d = new CatalogueDb(env.DB);
  for (const c of OURPOKER_CATALOGUE) {
    const e: ComponentEntry = {
      format: 1,
      name: c.name,
      version: c.version,
      digest: EXAMPLE_DIGEST,
      description: c.name,
      category: c.category,
      tags: [],
      targets: c.targets,
      guardians: [],
      provides: c.provides,
      requires: c.requires,
      dependencies: [],
      suitability: { format: 1, jobs: [], profiles: c.profiles.map((p) => ({ id: p.id, load: {}, cost: "none", regions: ["any"], compliance: [], provider: null, notes: "", settings: p.settings })), notes: "" },
      migration: null,
      source: { repository: c.name, tag: `v${c.version}` },
      bundle: { asset: "bundle.tar", digest: EXAMPLE_BUNDLE_DIGEST },
    };
    await d.publishComponent(null, entry(c.name, developerId), e, now);
  }
  const base = exampleRecipeEntry();
  const r: RecipeEntry = {
    ...base,
    recipe: { ...base.recipe, name: OURPOKER_RECIPE.name, version: OURPOKER_RECIPE.version, title: OURPOKER_RECIPE.title, components: OURPOKER_RECIPE.components.map((c) => ({ ...c, configuration: {} })), connections: OURPOKER_RECIPE.connections, jobs: [], scale: null, questions: [] },
    source: { repository: "ourapps-ae/ourpoker", tag: `v${OURPOKER_RECIPE.version}` },
  };
  await d.publishRecipe(null, entry(OURPOKER_RECIPE.name, developerId), r, now);
}

beforeEach(async () => {
  env = testEnv();
  await clearDb(env);
  await signIn(env, deps);
  await seed();
});

function expectSvgResponse(res: Response): void {
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
  expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]) expect(res.headers.get(k), k).toBe(SECURITY_HEADERS[k]);
}

describe("recipe component diagram", () => {
  it("draws every component of the recipe, by exact version and as latest", async () => {
    for (const version of [OURPOKER_RECIPE.version, "latest"]) {
      const res = await get(`/api/recipes/ourpoker/${version}/components.svg`);
      expectSvgResponse(res);
      const svg = await res.text();
      expect(svg.startsWith("<svg")).toBe(true);
      for (const c of OURPOKER_RECIPE.components) expect(svg, c.id).toContain(`>${c.id}</text>`);
      for (const zone of ["Rooms", "Presentation", "Delivery", "Game framework", "Poker"]) expect(svg).toContain(zone);
      expect(svg).toContain("when video is yes");
      expect(svg).not.toMatch(/<script|href=/);
    }
  });

  it("puts components the catalogue does not list in Other", async () => {
    await env.DB.prepare("UPDATE component_versions SET unlisted_at = ? WHERE component_id = 'id-card-deck'").bind(now).run();
    const svg = await (await get("/api/recipes/ourpoker/latest/components.svg")).text();
    expect(svg).toContain("Other: 1 component");
    expect(svg).toContain("not in the catalogue");
  });

  it("404s unknown recipes and versions", async () => {
    for (const path of ["/api/recipes/nope/latest/components.svg", "/api/recipes/ourpoker/9.9.9/components.svg", "/api/recipes/ourpoker/bad/components.svg", "/api/components/ourpoker/latest/components.svg"]) expect((await get(path)).status, path).toBe(404);
  });
});

describe("component connections diagram", () => {
  it("draws the providers of each requirement and the users of each provided interface", async () => {
    const res = await get("/api/components/turn-engine/latest/connections.svg");
    expectSvgResponse(res);
    const svg = await res.text();
    const engine = OURPOKER_CATALOGUE.find((c) => c.name === "ourapps-ae/turn-engine")!;
    expect(engine.requires).toHaveLength(9);
    for (const p of [...engine.requires, ...engine.provides]) expect(svg, p.type).toContain(`${p.type} ${p.version}`);
    for (const name of ["holdem-rules", "seating", "game-clock", "private-views", "presence", "tournament", "computer-players", "round-history", "rules-settings", "realtime-rooms"]) expect(svg, name).toContain(`ourapps-ae/${name}<`);
    expect(svg).toContain("optional: may stay unconnected");
  });

  it("lists four users of a popular interface and counts the rest", async () => {
    const svg = await (await get("/api/components/theme/0.3.0/connections.svg")).text();
    const users = OURPOKER_CATALOGUE.filter((c) => c.requires.some((p) => p.type === "ae/theme")).map((c) => c.name).sort();
    expect(users.length).toBeGreaterThan(4);
    for (const name of users.slice(0, 4)) expect(svg, name).toContain(`${name}<`);
    expect(svg).toContain(`>${users.length - 4} more</text>`);
  });

  it("shows a requirement no catalogue component provides as supplied by the application", async () => {
    const svg = await (await get("/api/components/video-calls/latest/connections.svg")).text();
    expect(svg).toContain("supplied by the application");
    expect(svg).toContain("ae/video-calls-configuration 1.0.0");
  });

  it("404s unknown components and versions", async () => {
    for (const path of ["/api/components/nope/latest/connections.svg", "/api/components/card-deck/9.9.9/connections.svg", "/api/components/Card/latest/connections.svg", "/api/recipes/card-deck/latest/connections.svg"]) expect((await get(path)).status, path).toBe(404);
  });
});
