import { beforeEach, describe, expect, it } from "vitest";
import { EXAMPLE_BUNDLE_DIGEST, exampleComponentEntry, exampleRecipeEntry, type BundleLink, type ComponentList, type ComponentSearch, type ComponentVersionView, type DeprecationReport, type RecipeList, type RecipeSearch, type RecipeVersionView } from "@my/store-shared";
import { Db } from "../src/db.js";
import { ftsQuery } from "../src/catalogue-db.js";
import type { Env } from "../src/env.js";
import { handle } from "../src/index.js";
import { BASE, GH_TOKEN, api, clearDb, fakeFetch, gh, jsonRes, signIn, testDeps, testEnv, type Call, type TestDeps } from "./helpers.js";

type Mutable = Record<string, any>;

let env: Env;
let deps: TestDeps;
let cookie: string;
let calls: Call[];

// GitHub as the publisher's repositories see it: pushable, with a release that holds the bundle.
function release(repo: string, tag: string, asset: string, id: number, overrides: { push?: boolean; digest?: string | null; status?: number; releaseStatus?: number } = {}) {
  return {
    [`GET ${gh(`/repos/${repo}`)}`]: () => (overrides.status ? new Response("no", { status: overrides.status }) : jsonRes({ permissions: { push: overrides.push ?? true } })),
    [`GET ${gh(`/repos/${repo}/releases/tags/${tag}`)}`]: () =>
      overrides.releaseStatus
        ? new Response("no", { status: overrides.releaseStatus })
        : jsonRes({ assets: [{ name: asset, url: `https://api.github.com/repos/${repo}/releases/assets/${id}`, digest: overrides.digest === undefined ? EXAMPLE_BUNDLE_DIGEST : overrides.digest }] }),
    [`GET ${gh(`/repos/${repo}/releases/assets/${id}`)}`]: () => new Response("BUNDLEBYTES", { status: 200 }),
  };
}

function githubFor(extra: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  const stub = fakeFetch({
    ...release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11),
    ...release("acme/poker-night-recipe", "v0.1.0", "poker-night-0.1.0.tar", 21),
    ...release("acme/seating", "v0.1.0", "seating-0.1.0.tar", 31),
    ...release("acme/random-pool", "v0.1.0", "random-pool-0.1.0.tar", 41),
    ...extra,
  });
  calls = stub.calls;
  deps = testDeps(stub.fetch);
}

async function saveToken(c = cookie) {
  const res = await handle(api(c, "PUT", "/api/dev/secrets", { githubToken: GH_TOKEN }), env, deps);
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  env = testEnv();
  await clearDb(env);
  githubFor();
  cookie = await signIn(env, deps);
  await saveToken();
});

const get = (path: string) => handle(api(null, "GET", path), env, deps);
const post = (path: string, body: unknown, c: string | null = cookie) => handle(api(c, "POST", path, body), env, deps);
const del = (path: string, c: string | null = cookie) => handle(api(c, "DELETE", path), env, deps);

function component(patch: (e: Mutable) => void = () => {}): Mutable {
  const e = structuredClone(exampleComponentEntry()) as unknown as Mutable;
  patch(e);
  return e;
}

function recipe(patch: (e: Mutable) => void = () => {}): Mutable {
  const e = structuredClone(exampleRecipeEntry()) as unknown as Mutable;
  patch(e);
  return e;
}

// A second version of the example component, with its own release.
function nextComponent(version: string, digest: string, patch: (e: Mutable) => void = () => {}): Mutable {
  return component((e) => {
    e.version = version;
    e.digest = digest;
    e.source.tag = `v${version}`;
    e.bundle.asset = `card-deck-${version}.tar`;
    patch(e);
  });
}

const digest = (c: string) => `sha256:${c.repeat(64)}`;

async function publishCard(patch?: (e: Mutable) => void) {
  const res = await post("/api/dev/components", component(patch));
  expect(res.status).toBe(201);
  return res;
}

async function publishRecipe(patch?: (e: Mutable) => void) {
  const res = await post("/api/dev/recipes", recipe(patch));
  expect(res.status).toBe(201);
  return res;
}

describe("publishing a component", () => {
  it("records the pointer after checking the release with the publisher's token", async () => {
    const res = await publishCard();
    expect(await res.json()).toMatchObject({ status: "published", name: "acme/card-deck", version: "0.1.0", url: `${BASE}/components/card-deck`, api: `${BASE}/api/components/card-deck/0.1.0` });
    const repoCall = calls.find((c) => c.url.endsWith("/repos/acme/card-deck"));
    expect(repoCall?.headers.get("Authorization")).toBe(`Bearer ${GH_TOKEN}`);
    expect(calls.some((c) => c.url.endsWith("/repos/acme/card-deck/releases/tags/v0.1.0"))).toBe(true);
    const row = await env.DB.prepare("SELECT * FROM component_versions").first<Record<string, unknown>>();
    expect(row).toMatchObject({ digest: digest("a"), source_repo: "acme/card-deck", source_tag: "v0.1.0", bundle_asset: "card-deck-0.1.0.tar", bundle_digest: EXAMPLE_BUNDLE_DIGEST });
    const audit = await env.DB.prepare("SELECT event, detail FROM audit_log WHERE event = 'component-published'").first();
    expect(audit).toMatchObject({ detail: "acme/card-deck 0.1.0" });
  });

  it("never stores an archive", async () => {
    await publishCard();
    const columns = (await env.DB.prepare("PRAGMA table_info(component_versions)").all<{ name: string }>()).results.map((c) => c.name);
    expect(columns.filter((c) => /archive|blob|bytes|content/.test(c))).toEqual([]);
    expect(calls.some((c) => c.url.includes("/releases/assets/"))).toBe(false);
  });

  it("answers the same version and digest again without change", async () => {
    await publishCard();
    const again = await post("/api/dev/components", component());
    expect(again.status).toBe(200);
    expect(((await again.json()) as { status: string }).status).toBe("unchanged");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM component_versions").first<{ n: number }>())!.n).toBe(1);
  });

  it("never binds a version to different bytes", async () => {
    await publishCard();
    const res = await post("/api/dev/components", component((e) => (e.digest = digest("c"))));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different digest");
  });

  it("keeps older versions and moves latest with the newest", async () => {
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11));
    await publishCard();
    githubFor({ ...release("acme/card-deck", "v0.10.0", "card-deck-0.10.0.tar", 12), ...release("acme/card-deck", "v0.2.0", "card-deck-0.2.0.tar", 13) });
    expect((await post("/api/dev/components", nextComponent("0.10.0", digest("d")))).status).toBe(201);
    expect((await post("/api/dev/components", nextComponent("0.2.0", digest("e")))).status).toBe(201);
    const view = (await (await get("/api/components/card-deck")).json()) as ComponentVersionView;
    expect(view.version).toBe("0.10.0");
    expect(view.versions.map((v) => v.version)).toEqual(["0.10.0", "0.2.0", "0.1.0"]);
    expect(((await (await get("/api/components/card-deck/0.2.0")).json()) as ComponentVersionView).digest).toBe(digest("e"));
  });

  it("refuses a name that belongs to another developer", async () => {
    await publishCard();
    const other = await signIn(env, deps, { id: 9, login: "sue", name: "Sue" });
    await saveToken(other);
    const res = await post("/api/dev/components", nextComponent("0.2.0", digest("e")), other);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("another developer");
    expect((await del("/api/dev/components/card-deck", other)).status).toBe(404);
    expect(((await (await get("/api/components/card-deck")).json()) as ComponentVersionView).version).toBe("0.1.0");
  });

  it("keeps one repository per name and the scope equal to its owner", async () => {
    await publishCard();
    githubFor(release("acme/other", "v0.2.0", "card-deck-0.2.0.tar", 40));
    const moved = await post("/api/dev/components", nextComponent("0.2.0", digest("e"), (e) => (e.source.repository = "acme/other")));
    expect(moved.status).toBe(409);
    const wrongScope = await post("/api/dev/components", component((e) => (e.name = "mallory/card-deck")));
    expect(wrongScope.status).toBe(400);
    expect(((await wrongScope.json()) as { error: string }).error).toContain("scope mallory");
  });

  it("validates the entry and says what is wrong", async () => {
    const res = await post("/api/dev/components", component((e) => ((e.version = "1"), (e.digest = "x"))));
    expect(res.status).toBe(400);
    const error = ((await res.json()) as { error: string }).error;
    expect(error).toContain("version must be three integers");
    expect(error).toContain("digest must be sha256");
    expect((await handle(api(cookie, "POST", "/api/dev/components", "not json"), env, deps)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses an entry that carries a secret", async () => {
    const res = await post("/api/dev/components", component((e) => (e.description = `use token ${GH_TOKEN} here`)));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("secret");
  });

  it("needs a GitHub token, push access, the release and a matching digest", async () => {
    await handle(api(cookie, "PUT", "/api/dev/secrets", { githubToken: "-" }), env, deps);
    const none = await post("/api/dev/components", component());
    expect(none.status).toBe(409);
    expect(((await none.json()) as { error: string }).error).toContain("GitHub token");
    await saveToken();

    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { push: false }));
    expect((await post("/api/dev/components", component())).status).toBe(403);
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { status: 404 }));
    expect((await post("/api/dev/components", component())).status).toBe(422);
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { status: 500 }));
    expect((await post("/api/dev/components", component())).status).toBe(502);
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { releaseStatus: 404 }));
    const noRelease = await post("/api/dev/components", component());
    expect(noRelease.status).toBe(422);
    expect(((await noRelease.json()) as { error: string }).error).toContain("no published release");
    githubFor(release("acme/card-deck", "v0.1.0", "other.tar", 11));
    expect(((await (await post("/api/dev/components", component())).json()) as { error: string }).error).toContain("no asset named");
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { digest: digest("f") }));
    const mismatch = await post("/api/dev/components", component());
    expect(mismatch.status).toBe(422);
    expect(((await mismatch.json()) as { error: string }).error).toContain("not sha256");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM components").first<{ n: number }>())!.n).toBe(0);
  });

  it("accepts a release whose asset carries no digest", async () => {
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { digest: null }));
    expect((await post("/api/dev/components", component())).status).toBe(201);
  });

  it("requires a signed-in developer, current terms and write scope", async () => {
    expect((await post("/api/dev/components", component(), null)).status).toBe(401);
    const noTerms = await signIn(env, deps, { id: 9, login: "sue", name: "Sue" }, false);
    expect((await post("/api/dev/components", component(), noTerms)).status).toBe(403);

    const read = (await (await post("/api/dev/keys", { name: "reader", scope: "read" })).json()) as { key: string };
    const manage = (await (await post("/api/dev/keys", { name: "writer", scope: "manage" })).json()) as { key: string };
    const asKey = (key: string, method: string, path: string, body?: unknown) => handle(api(null, method, path, body, { Authorization: `Bearer ${key}` }), env, deps);
    expect((await asKey(read.key, "POST", "/api/dev/components", component())).status).toBe(403);
    expect((await asKey(read.key, "GET", "/api/dev/components")).status).toBe(200);
    expect((await asKey(manage.key, "POST", "/api/dev/components", component())).status).toBe(201);
    expect((await asKey(manage.key, "DELETE", "/api/dev/components/card-deck/0.1.0")).status).toBe(200);
  });

  it("limits the names one developer can hold", async () => {
    const now = new Date().toISOString();
    const dev = (await env.DB.prepare("SELECT id FROM developers").first<{ id: string }>())!.id;
    await env.DB.batch(Array.from({ length: 50 }, (_, i) => env.DB.prepare("INSERT INTO recipes (id, name, scope, slug, developer_id, repo, created_at, updated_at) VALUES (?, ?, 'acme', ?, ?, 'acme/x', ?, ?)").bind(`r${i}`, `acme/recipe-${i}`, `recipe-${i}`, dev, now, now)));
    const res = await post("/api/dev/recipes", recipe());
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("at most 50");
  });
});

describe("publishing a recipe", () => {
  it("validates recipe.json, the pointers and the diagram", async () => {
    const bad = await post("/api/dev/recipes", recipe((e) => (e.recipe.components[0].version = "x")));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("recipe: components[0].version");
    const svg = await post("/api/dev/recipes", recipe((e) => (e.page.diagram = "<svg><script>alert(1)</script></svg>")));
    expect(svg.status).toBe(400);
  });

  it("stores the recipe, its components and its page material", async () => {
    await publishRecipe();
    const version = await env.DB.prepare("SELECT * FROM recipe_versions").first<Record<string, unknown>>();
    expect(version).toMatchObject({ title: "Poker Night", category: "games", source_repo: "acme/poker-night-recipe", source_tag: "v0.1.0", bundle_asset: "poker-night-0.1.0.tar" });
    expect(JSON.parse(version!.recipe as string).questions).toHaveLength(7);
    const components = await env.DB.prepare("SELECT instance_id, component_name FROM recipe_components ORDER BY instance_id").all();
    expect(components.results).toEqual([
      { instance_id: "apple", component_name: "acme/apple-host" },
      { instance_id: "deck", component_name: "acme/card-deck" },
      { instance_id: "host", component_name: "acme/server-host" },
      { instance_id: "seats", component_name: "acme/seating" },
      { instance_id: "tour", component_name: "acme/guided-tour" },
    ]);
  });

  it("stores CEL conditions as written and accepts the reserved application endpoint", async () => {
    await publishRecipe();
    const stored = await env.DB.prepare("SELECT instance_id, included_when FROM recipe_components WHERE instance_id IN ('apple', 'deck', 'tour') ORDER BY instance_id").all<{ instance_id: string; included_when: string | null }>();
    expect(stored.results.map((r) => [r.instance_id, r.included_when])).toEqual([
      ["apple", "'ios' in targets || 'macos' in targets"],
      ["deck", null],
      ["tour", "lessons"],
    ]);
    const bad = await post("/api/dev/recipes", recipe((e) => ((e.recipe.version = "0.2.0"), (e.recipe.components[4].includedWhen = "lessons + 1"))));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("components[4].includedWhen (component tour): + is not allowed");
    const ghost = await post("/api/dev/recipes", recipe((e) => ((e.recipe.version = "0.2.0"), (e.recipe.components[0].id = "application"))));
    expect(ghost.status).toBe(400);
    expect(((await ghost.json()) as { error: string }).error).toContain("application is reserved");
  });

  it("shows the guardians and suitability of components the catalogue lists", async () => {
    await publishCard();
    await publishRecipe();
    const view = (await (await get("/api/recipes/poker-night")).json()) as RecipeVersionView;
    const deck = view.components.find((c) => c.id === "deck")!;
    expect(deck.catalogue).toMatchObject({ url: `${BASE}/components/card-deck`, guardians: ["Example Guardian Ltd"] });
    expect(deck.catalogue!.suitability.profiles[0].cost).toBe("none");
    expect(view.components.find((c) => c.id === "seats")!.catalogue).toBeNull();
    const used = (await (await get("/api/components/card-deck")).json()) as ComponentVersionView;
    expect(used.usedBy).toEqual([{ name: "acme/poker-night", slug: "poker-night", title: "Poker Night", version: "0.1.0", url: `${BASE}/recipes/poker-night` }]);
  });
});

describe("reading recipes", () => {
  beforeEach(async () => {
    await publishRecipe();
  });

  it("lists with categories and filters by category, target and tag", async () => {
    githubFor({ ...release("acme/poker-night-recipe", "v0.1.0", "poker-night-0.1.0.tar", 21), ...release("acme/garden-recipe", "v1.0.0", "garden-1.0.0.tar", 22) });
    await publishRecipe((e) => {
      e.recipe.name = "acme/garden-planner";
      e.recipe.title = "Garden Planner";
      e.recipe.summary = "Plan beds and sowing dates.";
      e.recipe.category = "tools";
      e.recipe.tags = ["plants"];
      e.recipe.targets = { client: ["windows"], server: [] };
      e.recipe.version = "1.0.0";
      e.recipe.components = [{ id: "plan", name: "acme/planner", version: "0.1.0", includedWhen: null }];
      e.recipe.jobs = [];
      e.recipe.scale = null;
      e.recipe.questions = [];
      e.recipe.connections = [];
      e.recipe.tests = { defaultAnswers: {}, answerSets: [] };
      e.source = { repository: "acme/garden-recipe", tag: "v1.0.0" };
      e.bundle.asset = "garden-1.0.0.tar";
      e.digest = digest("1");
    });
    const all = (await (await get("/api/recipes")).json()) as RecipeList;
    expect(all.total).toBe(2);
    expect(all.categories).toEqual([{ category: "games", count: 1 }, { category: "tools", count: 1 }]);
    const names = (path: string) => get(path).then((r) => r.json() as Promise<RecipeList>).then((l) => l.recipes.map((x) => x.name));
    expect(await names("/api/recipes?category=tools")).toEqual(["acme/garden-planner"]);
    expect(await names("/api/recipes?target=ios")).toEqual(["acme/poker-night"]);
    expect(await names("/api/recipes?target=windows")).toEqual(["acme/garden-planner"]);
    expect(await names("/api/recipes?target=hosting-provider")).toEqual(["acme/poker-night"]);
    expect(await names("/api/recipes?tag=plants")).toEqual(["acme/garden-planner"]);
    expect(await names("/api/recipes?category=games&tag=plants")).toEqual([]);
    const paged = (await (await get("/api/recipes?limit=1&offset=1")).json()) as RecipeList;
    expect(paged).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(paged.recipes).toHaveLength(1);
    expect((await get("/api/recipes?limit=0")).status).toBe(400);
    expect((await get("/api/recipes?category=Bad%20Value")).status).toBe(400);
  });

  it("returns the summary fields and no secrets or internal ids", async () => {
    const text = await (await get("/api/recipes")).text();
    const list = JSON.parse(text) as RecipeList;
    expect(list.recipes[0]).toEqual({
      name: "acme/poker-night",
      slug: "poker-night",
      version: "0.1.0",
      title: "Poker Night",
      summary: "A card game for a club's league night, with house rules.",
      category: "games",
      tags: ["cards", "multiplayer"],
      targets: { client: ["web", "ios", "android", "macos"], server: ["hosting-provider"] },
      publishedAt: deps.now().toISOString(),
      publisher: { slug: "george", displayName: "George" },
      repository: "acme/poker-night-recipe",
      url: `${BASE}/recipes/poker-night`,
      status: "active",
      deprecations: [],
    });
    const detail = await (await get("/api/recipes/poker-night/0.1.0")).text();
    for (const body of [text, detail]) {
      expect(body).not.toContain(GH_TOKEN);
      expect(body).not.toMatch(/githubToken|github_id|githubId|developer_id|developerId|buildToken|secret"/i);
    }
  });

  it("serves a version and latest with questions, components, tests and versions", async () => {
    const v = (await (await get("/api/recipes/poker-night/0.1.0")).json()) as RecipeVersionView;
    const latest = (await (await get("/api/recipes/poker-night/latest")).json()) as RecipeVersionView;
    expect(latest).toEqual(v);
    expect(v.questions.map((q) => q.id)).toEqual(["targets", "scale", "chips", "lessons", "tourStyle", "server", "serverKey"]);
    expect(v.components).toHaveLength(5);
    expect(v.tests.answerSets[0].id).toBe("web-only");
    expect(v.versions).toEqual([{ version: "0.1.0", digest: digest("a"), publishedAt: deps.now().toISOString() }]);
    expect(v.bundle).toEqual({ asset: "poker-night-0.1.0.tar", digest: EXAMPLE_BUNDLE_DIGEST, url: `${BASE}/api/recipes/poker-night/0.1.0/bundle` });
    expect(v.description).toContain("Poker Night deals a hand");
    expect(v.diagram).toBe(`${BASE}/api/recipes/poker-night/0.1.0/diagram.svg`);
  });

  it("404s unknown names and versions", async () => {
    for (const path of ["/api/recipes/nope", "/api/recipes/poker-night/9.9.9", "/api/recipes/poker-night/bad", "/api/recipes/Poker/0.1.0", "/api/recipes/poker-night/0.1.0/other"]) expect((await get(path)).status, path).toBe(404);
  });

  it("serves the diagram as a sandboxed image", async () => {
    const res = await get("/api/recipes/poker-night/0.1.0/diagram.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await res.text()).toContain("<svg");
    githubFor(release("acme/poker-night-recipe", "v0.2.0", "poker-night-0.2.0.tar", 23));
    await publishRecipe((e) => ((e.recipe.version = "0.2.0"), (e.digest = digest("2")), (e.source.tag = "v0.2.0"), (e.bundle.asset = "poker-night-0.2.0.tar"), (e.page.diagram = null)));
    expect((await get("/api/recipes/poker-night/0.2.0/diagram.svg")).status).toBe(404);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await publishRecipe();
    await publishCard();
  });

  it("finds recipes by name, title, summary, tags and description, with prefixes", async () => {
    const find = async (q: string) => ((await (await get(`/api/recipes/search?q=${encodeURIComponent(q)}`)).json()) as RecipeSearch).recipes.map((r) => r.name);
    for (const q of ["poker", "Poker Night", "league", "multiplayer", "multi", "deals a hand", "lessons", "acme"]) expect(await find(q), q).toEqual(["acme/poker-night"]);
    expect(await find("zebra")).toEqual([]);
    expect(await find("poker zebra")).toEqual([]);
  });

  it("treats search syntax as plain words", async () => {
    for (const q of ['"', "poker*", "poker OR zebra", "name:poker", "(", "poker-night", "NEAR(a b)", "\\", "'; DROP TABLE recipes; --"]) {
      expect((await get(`/api/recipes/search?q=${encodeURIComponent(q)}`)).status, q).toBe(200);
    }
    expect(ftsQuery('poker "night" OR *')).toBe('"poker"* "night"* "or"*');
    expect(ftsQuery("   ")).toBeNull();
    expect(ftsQuery("a ".repeat(20))!.split(" ")).toHaveLength(8);
  });

  it("requires a query", async () => {
    expect((await get("/api/recipes/search")).status).toBe(400);
    expect((await get("/api/recipes/search?q=")).status).toBe(400);
    expect((await get(`/api/recipes/search?q=${"x".repeat(201)}`)).status).toBe(400);
    expect((await get("/api/recipes/search?q=%20%20")).status).toBe(400);
    expect(((await (await get("/api/recipes/search?q=%2A%2A")).json()) as RecipeSearch).recipes).toEqual([]);
  });

  it("keeps recipes and components apart", async () => {
    expect(((await (await get("/api/components/search?q=poker")).json()) as ComponentSearch).components).toEqual([]);
    const cards = (await (await get("/api/components/search?q=deck")).json()) as ComponentSearch;
    expect(cards.components.map((c) => c.name)).toEqual(["acme/card-deck"]);
    expect(((await (await get("/api/components/search?q=shuffled")).json()) as ComponentSearch).components).toHaveLength(1);
    expect(((await (await get("/api/recipes/search?q=deck")).json()) as RecipeSearch).recipes).toEqual([]);
  });

  it("searches the newest listed version", async () => {
    githubFor(release("acme/poker-night-recipe", "v0.2.0", "poker-night-0.2.0.tar", 23));
    await publishRecipe((e) => ((e.recipe.version = "0.2.0"), (e.recipe.title = "Showdown"), (e.digest = digest("2")), (e.source.tag = "v0.2.0"), (e.bundle.asset = "poker-night-0.2.0.tar")));
    const find = async (q: string) => ((await (await get(`/api/recipes/search?q=${q}`)).json()) as RecipeSearch).recipes.map((r) => `${r.title} ${r.version}`);
    expect(await find("showdown")).toEqual(["Showdown 0.2.0"]);
    expect(await find("poker")).toEqual(["Showdown 0.2.0"]);
    await del("/api/dev/recipes/poker-night/0.2.0");
    expect(await find("showdown")).toEqual([]);
    expect(await find("poker")).toEqual(["Poker Night 0.1.0"]);
  });
});

describe("components", () => {
  it("lists and filters by interface, category, target and tag", async () => {
    await publishCard();
    githubFor(release("acme/seating", "v0.1.0", "seating-0.1.0.tar", 31));
    expect(
      (
        await post("/api/dev/components", component((e) => {
          e.name = "acme/seating";
          e.description = "Seats for people at a table.";
          e.category = "tables";
          e.tags = ["seats"];
          e.targets = { client: ["web", "ios"], server: ["hosting-provider"] };
          e.provides = [{ id: "seating", type: "ae/seating", version: "1.0.0" }];
          e.requires = [{ id: "guest-identity", type: "ae/guest-identity", version: "1.0.0" }];
          e.source = { repository: "acme/seating", tag: "v0.1.0" };
          e.bundle.asset = "seating-0.1.0.tar";
        }))
      ).status,
    ).toBe(201);
    const names = async (q: string) => ((await (await get(`/api/components${q}`)).json()) as ComponentList).components.map((c) => c.name);
    expect(await names("")).toEqual(["acme/card-deck", "acme/seating"]);
    expect(await names("?provides=ae/card-deck")).toEqual(["acme/card-deck"]);
    expect(await names("?provides=card-deck")).toEqual(["acme/card-deck"]);
    expect(await names("?requires=ae/random-source")).toEqual(["acme/card-deck"]);
    expect(await names("?requires=ae/guest-identity")).toEqual(["acme/seating"]);
    expect(await names("?provides=ae/guest-identity")).toEqual([]);
    expect(await names("?category=tables")).toEqual(["acme/seating"]);
    expect(await names("?target=ios")).toEqual(["acme/seating"]);
    expect(await names("?target=hosting-provider")).toEqual(["acme/seating"]);
    expect(await names("?tag=deck")).toEqual(["acme/card-deck"]);
    const list = (await (await get("/api/components")).json()) as ComponentList;
    expect(list.categories).toEqual([{ category: "cards", count: 1 }, { category: "tables", count: 1 }]);
    expect(list.components[0].provides).toEqual([{ id: "card-deck", type: "ae/card-deck", version: "1.0.0" }]);
  });

  it("keeps optional requirements and profile settings through publication, reads and text", async () => {
    await publishCard((e) => {
      e.requires = [{ id: "random-source", type: "ae/random-source", version: "1.0.0", optional: true }, { id: "audit", type: "ae/audit", version: "1.0.0" }];
      e.dependencies = [{ name: "acme/random-pool", version: "0.1.0" }];
      e.suitability.profiles[0].settings = { plan: "eco", capacity: 10, durable: true };
    });
    const view = (await (await get("/api/components/card-deck")).json()) as ComponentVersionView;
    expect(view.requires).toEqual([{ id: "random-source", type: "ae/random-source", version: "1.0.0", optional: true }, { id: "audit", type: "ae/audit", version: "1.0.0" }]);
    expect(view.dependencies).toEqual([{ name: "acme/random-pool", version: "0.1.0" }]);
    expect(view.suitability.profiles[0].settings).toEqual({ plan: "eco", capacity: 10, durable: true });
    const text = await (await get("/components/card-deck.txt")).text();
    expect(text).toContain("Requires: random-source (ae/random-source 1.0.0, optional), audit (ae/audit 1.0.0)");
    expect(text).toContain("settings plan \"eco\", capacity 10, durable true");
    const bad = await post("/api/dev/components", nextComponent("0.2.0", digest("e"), (e) => (e.requires[0].optional = "yes")));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("requires[0].optional must be true or false");
  });

  it("serves the entry with suitability, guardians, migration and source", async () => {
    await publishCard((e) => (e.migration = { stores: [{ id: "rooms", schema: { name: "ae/room-state", version: "1.0.0" } }], formats: ["ndjson"], portable: true, requiresStop: false, retentionDays: 30 }));
    const v = (await (await get("/api/components/card-deck/0.1.0")).json()) as ComponentVersionView;
    expect(v).toMatchObject({
      name: "acme/card-deck",
      version: "0.1.0",
      digest: digest("a"),
      description: "A shuffled deck of 52 cards that deals and burns cards.",
      guardians: ["Example Guardian Ltd"],
      source: { repository: "acme/card-deck", tag: "v0.1.0" },
      bundle: { asset: "card-deck-0.1.0.tar", digest: EXAMPLE_BUNDLE_DIGEST },
      migration: { formats: ["ndjson"], retentionDays: 30 },
      usedBy: [],
    });
    expect(v.suitability.profiles[0]).toMatchObject({ id: "any", cost: "none" });
    expect((await get("/api/components/card-deck/0.9.0")).status).toBe(404);
  });
});

describe("unlisting", () => {
  beforeEach(async () => {
    await publishCard();
    githubFor({ ...release("acme/card-deck", "v0.2.0", "card-deck-0.2.0.tar", 12) });
    expect((await post("/api/dev/components", nextComponent("0.2.0", digest("e")))).status).toBe(201);
  });

  it("hides one version everywhere and moves latest to the next newest", async () => {
    const res = await del("/api/dev/components/card-deck/0.2.0");
    expect(await res.json()).toEqual({ ok: true, unlisted: 1 });
    expect((await get("/api/components/card-deck/0.2.0")).status).toBe(404);
    expect((await get("/api/components/card-deck/0.2.0/bundle")).status).toBe(404);
    expect(((await (await get("/api/components/card-deck")).json()) as ComponentVersionView).version).toBe("0.1.0");
    expect(((await (await get("/api/components/card-deck")).json()) as ComponentVersionView).versions.map((v) => v.version)).toEqual(["0.1.0"]);
    expect(((await (await get("/api/components")).json()) as ComponentList).components[0].version).toBe("0.1.0");
  });

  it("hides every version when none is named, and keeps the rows", async () => {
    expect(await (await del("/api/dev/components/card-deck")).json()).toEqual({ ok: true, unlisted: 2 });
    expect(((await (await get("/api/components")).json()) as ComponentList).total).toBe(0);
    expect((await get("/api/components/card-deck")).status).toBe(404);
    expect(((await (await get("/api/components/search?q=deck")).json()) as ComponentSearch).components).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM component_versions").first<{ n: number }>())!.n).toBe(2);
    const mine = (await (await handle(api(cookie, "GET", "/api/dev/components"), env, deps)).json()) as { components: { name: string; latestVersion: string | null; versions: { version: string; listed: boolean }[] }[] };
    expect(mine.components[0]).toMatchObject({ name: "acme/card-deck", latestVersion: null });
    expect(mine.components[0].versions.map((v) => v.listed)).toEqual([false, false]);
  });

  it("keeps the digest bound after unlisting, and lists the version again on republish", async () => {
    await del("/api/dev/components/card-deck/0.2.0");
    githubFor({ ...release("acme/card-deck", "v0.2.0", "card-deck-0.2.0.tar", 12) });
    expect((await post("/api/dev/components", nextComponent("0.2.0", digest("9")))).status).toBe(409);
    const again = await post("/api/dev/components", nextComponent("0.2.0", digest("e")));
    expect(again.status).toBe(201);
    expect(((await (await get("/api/components/card-deck")).json()) as ComponentVersionView).version).toBe("0.2.0");
    expect(((await (await get("/api/components/search?q=deck")).json()) as ComponentSearch).components).toHaveLength(1);
  });

  it("answers unknown names and versions with 404 and is quiet when repeated", async () => {
    expect((await del("/api/dev/components/nope")).status).toBe(404);
    expect((await del("/api/dev/components/card-deck/9.9.9")).status).toBe(404);
    await del("/api/dev/components/card-deck/0.2.0");
    expect(await (await del("/api/dev/components/card-deck/0.2.0")).json()).toEqual({ ok: true, unlisted: 0 });
    expect((await del("/api/dev/components/card-deck", null)).status).toBe(401);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'component-unlisted'").first<{ n: number }>())!.n).toBe(2);
  });
});

describe("bundle links", () => {
  beforeEach(async () => {
    await publishRecipe();
    await publishCard();
  });

  it("returns a signed one-hour link that streams the release asset with the publisher's token", async () => {
    const res = await get("/api/recipes/poker-night/0.1.0/bundle");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const link = (await res.json()) as BundleLink;
    expect(link).toMatchObject({ name: "acme/poker-night", version: "0.1.0", digest: digest("a"), asset: "poker-night-0.1.0.tar", assetDigest: EXAMPLE_BUNDLE_DIGEST });
    expect(link.status).toBe("available");
    expect(link.deprecations).toEqual([]);
    expect(link.url).toMatch(new RegExp(`^${BASE}/dl/`));
    expect(link.expiresAt).toBe("2026-10-16T11:00:00.000Z");
    expect(JSON.stringify(link)).not.toContain(GH_TOKEN);
    expect(JSON.stringify(link)).not.toContain("api.github.com");

    calls.length = 0;
    const file = await handle(new Request(link.url!), env, deps);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("BUNDLEBYTES");
    expect(file.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(file.headers.get("Content-Disposition")).toBe('attachment; filename="poker-night-0.1.0.tar"');
    expect(calls[0].headers.get("Authorization")).toBe(`Bearer ${GH_TOKEN}`);
  });

  it("expires after an hour", async () => {
    const link = (await (await get("/api/components/card-deck/latest/bundle")).json()) as BundleLink;
    deps.advance(61 * 60_000);
    expect((await handle(new Request(link.url!), env, deps)).status).toBe(403);
  });

  it("refuses to link a bundle that no longer matches the recorded digest or is gone", async () => {
    githubFor(release("acme/poker-night-recipe", "v0.1.0", "poker-night-0.1.0.tar", 21, { digest: digest("f") }));
    expect((await get("/api/recipes/poker-night/0.1.0/bundle")).status).toBe(502);
    githubFor(release("acme/poker-night-recipe", "v0.1.0", "other.tar", 21));
    expect((await get("/api/recipes/poker-night/0.1.0/bundle")).status).toBe(502);
    githubFor(release("acme/poker-night-recipe", "v0.1.0", "poker-night-0.1.0.tar", 21, { releaseStatus: 404 }));
    const res = await get("/api/recipes/poker-night/0.1.0/bundle");
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("acme");
    expect((await get("/api/recipes/nope/0.1.0/bundle")).status).toBe(404);
  });

  it("serves component bundles the same way", async () => {
    const link = (await (await get("/api/components/card-deck/0.1.0/bundle")).json()) as BundleLink;
    expect(link.asset).toBe("card-deck-0.1.0.tar");
    expect(await (await handle(new Request(link.url!), env, deps)).text()).toBe("BUNDLEBYTES");
  });
});

describe("page variants", () => {
  beforeEach(async () => {
    await publishCard();
    await publishRecipe();
  });

  it("answers a page address with plain text when the client does not ask for HTML", async () => {
    const text = await handle(api(null, "GET", "/recipes/poker-night", undefined, { Accept: "*/*" }), env, deps);
    expect(text.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await text.text()).toContain("Poker Night (acme/poker-night) 0.1.0");
    const list = await handle(api(null, "GET", "/components", undefined, { Accept: "text/plain" }), env, deps);
    expect(await list.text()).toContain("card-deck");
  });

  it("serves plain text and JSON for every public page", async () => {
    const list = await get("/recipes.txt");
    expect(list.status).toBe(200);
    expect(list.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const listText = await list.text();
    expect(listText).toContain("ourapps recipe library");
    expect(listText).toContain("- Poker Night (acme/poker-night) 0.1.0: A card game for a club's league night, with house rules.");
    expect(listText).toContain("Copyright Level N Ltd 2026");

    const page = await (await get("/recipes/poker-night.txt")).text();
    expect(page).toContain("Poker Night (acme/poker-night) 0.1.0");
    expect(page).toContain("Build it (aepm, Python 3.12, Node.js, Graphviz)");
    expect(page).toContain("python3 -m aepm fetch poker-night@0.1.0 --with-dependencies --store store");
    expect(page).toContain("- chips (integer): Starting chips?");
    expect(page).toContain("- deck: acme/card-deck 0.1.0");
    expect(page).toContain("- apple: acme/apple-host 0.1.0 (only when (targets includes ios) or (targets includes macos))");
    expect(page).toContain("asked only when lessons is yes; otherwise it takes its default");
    expect(page).toContain("sets host.targets to the answer");
    expect(page).toContain("range: 100 to 1000000");
    expect(page).toContain("- job server (the answer to server restricts the candidates first): acme/server-host (free), acme/server-host (paid)");
    expect(page).toContain("- seats.seating -> application.seating");
    expect(page).toContain("guardians: Example Guardian Ltd");
    expect(page).toContain("not listed in the catalogue");
    expect(page).toContain("Tested answer sets: default, web-only");
    expect(page).not.toContain(GH_TOKEN);

    const json = (await (await get("/recipes/poker-night.json")).json()) as RecipeVersionView;
    expect(json).toEqual((await (await get("/api/recipes/poker-night")).json()) as RecipeVersionView);
    expect(((await (await get("/recipes.json?category=games")).json()) as RecipeList).total).toBe(1);

    const components = await (await get("/components.txt")).text();
    expect(components).toContain("- acme/card-deck 0.1.0: A shuffled deck of 52 cards that deals and burns cards.");
    const one = await (await get("/components/card-deck.txt")).text();
    expect(one).toContain("Provides: card-deck (ae/card-deck 1.0.0)");
    expect(one).toContain("Used by recipes: acme/poker-night 0.1.0");
    expect(one).toContain("Data migration: this component keeps no data");
    expect(((await (await get("/components/card-deck.json")).json()) as ComponentVersionView).name).toBe("acme/card-deck");
  });

  it("searches and filters in the text variants and picks a version", async () => {
    expect(await (await get("/recipes.txt?q=poker")).text()).toContain("ourapps recipe search: poker");
    expect(await (await get("/components.txt?q=nothingmatches")).text()).toContain("No components match.");
    expect(await (await get("/recipes.txt?category=tools")).text()).toContain("No recipes match.");
    expect((await get("/recipes/poker-night.txt?version=0.1.0")).status).toBe(200);
    expect((await get("/recipes/poker-night.txt?version=9.9.9")).status).toBe(404);
    expect((await get("/recipes/nope.txt")).status).toBe(404);
    expect((await get("/recipes/Bad.txt")).status).toBe(404);
  });

  it("lists the public pages in the sitemap", async () => {
    const res = await get("/sitemap.xml");
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    const xml = await res.text();
    for (const path of ["/recipes", "/components", "/recipes/poker-night", "/components/card-deck", "/terms"]) expect(xml).toContain(`<loc>${BASE}${path}</loc>`);
  });
});

describe("names and slugs", () => {
  it("keeps recipes and components out of developer page names", async () => {
    for (const slug of ["recipes", "components"]) {
      const res = await handle(api(cookie, "PUT", "/api/dev/me", { slug, displayName: "George" }), env, deps);
      expect(res.status, slug).toBe(400);
    }
  });

  it("uses the signed-in developer's data layer only", async () => {
    await publishCard();
    const db = Db.from(env);
    expect((await db.developerBySlug("george"))!.slug).toBe("george");
  });
});

// ---------------------------------------------------------------- deprecation

const POOL = (patch: (e: Mutable) => void = () => {}) =>
  component((e) => {
    e.name = "acme/random-pool";
    e.description = "A pool of random numbers.";
    e.category = "randomness";
    e.tags = ["random"];
    e.provides = [{ id: "random-source", type: "ae/random-source", version: "1.0.0" }];
    e.requires = [];
    e.source = { repository: "acme/random-pool", tag: "v0.1.0" };
    e.bundle.asset = "random-pool-0.1.0.tar";
    patch(e);
  });

async function publishPool(patch?: (e: Mutable) => void) {
  const res = await post("/api/dev/components", POOL(patch));
  expect(res.status).toBe(201);
}

// card-deck builds on random-pool, and poker-night names card-deck (and seating, guided-tour, which are not listed).
async function publishChain() {
  await publishPool();
  await publishCard((e) => (e.dependencies = [{ name: "acme/random-pool", version: "0.1.0" }]));
  await publishRecipe();
}



describe("developer deprecation", () => {
  beforeEach(async () => {
    await publishCard();
  });

  it("deprecates a component with a replacement and shows it in every response", async () => {
    await publishPool();
    const res = await post("/api/dev/components/card-deck/deprecate", { replacement: "acme/random-pool" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "acme/card-deck", status: "deprecated", deprecated: { since: deps.now().toISOString(), reason: "owner-deprecated", replacement: "acme/random-pool" } });
    const notice = { name: "acme/card-deck", version: "0.1.0", status: "deprecated", reason: "owner-deprecated", since: deps.now().toISOString(), replacement: "acme/random-pool", via: [] };

    const detail = (await (await get("/api/components/card-deck")).json()) as ComponentVersionView;
    expect(detail.status).toBe("deprecated");
    expect(detail.deprecations).toEqual([notice]);
    const list = (await (await get("/api/components")).json()) as ComponentList;
    expect(list.components.find((c) => c.name === "acme/card-deck")!.deprecations).toEqual([notice]);
    const found = (await (await get("/api/components/search?q=deck")).json()) as ComponentSearch;
    expect(found.components[0].deprecations).toEqual([notice]);
    expect(((await (await get("/components/card-deck.json")).json()) as ComponentVersionView).deprecations).toEqual([notice]);

    const text = await (await get("/components/card-deck.txt")).text();
    expect(text.split("\n")[2]).toBe("DEPRECATION WARNING: acme/card-deck 0.1.0 is deprecated by its publisher (owner-deprecated, since 2026-10-16T10:00:00.000Z); replacement acme/random-pool");
    expect(await (await get("/components.txt")).text()).toContain("  DEPRECATION WARNING: acme/card-deck 0.1.0 is deprecated by its publisher");
    const link = (await (await get("/api/components/card-deck/0.1.0/bundle")).json()) as BundleLink;
    expect(link).toMatchObject({ status: "available", deprecations: [notice] });
    expect(await (await handle(new Request(link.url!), env, deps)).text()).toBe("BUNDLEBYTES");
    expect((await env.DB.prepare("SELECT detail FROM audit_log WHERE event = 'component-deprecated'").first<{ detail: string }>())!.detail).toBe("acme/card-deck -> acme/random-pool");
  });

  it("reverses with undeprecate and takes an empty body", async () => {
    expect((await handle(new Request(`${BASE}/api/dev/components/card-deck/deprecate`, { method: "POST", headers: { Cookie: cookie, Origin: BASE } }), env, deps)).status).toBe(200);
    expect(((await (await get("/api/components/card-deck")).json()) as ComponentVersionView).status).toBe("deprecated");
    const back = await post("/api/dev/components/card-deck/undeprecate", {});
    expect(await back.json()).toEqual({ ok: true, name: "acme/card-deck", status: "active", deprecated: null });
    const view = (await (await get("/api/components/card-deck")).json()) as ComponentVersionView;
    expect(view).toMatchObject({ status: "active", deprecations: [] });
    expect((await post("/api/dev/components/card-deck/undeprecate", {})).status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'component-undeprecated'").first<{ n: number }>())!.n).toBe(2);
  });

  it("filters lists and search with deprecated=exclude|include|only", async () => {
    await publishPool();
    await post("/api/dev/components/card-deck/deprecate", {});
    const names = async (path: string) => ((await (await get(path)).json()) as ComponentList).components.map((c) => c.name);
    expect(await names("/api/components")).toEqual(["acme/card-deck", "acme/random-pool"]);
    expect(await names("/api/components?deprecated=include")).toEqual(["acme/card-deck", "acme/random-pool"]);
    expect(await names("/api/components?deprecated=exclude")).toEqual(["acme/random-pool"]);
    expect(await names("/api/components?deprecated=only")).toEqual(["acme/card-deck"]);
    expect(((await (await get("/api/components?deprecated=exclude")).json()) as ComponentList).total).toBe(1);
    const found = async (value: string) => ((await (await get(`/api/components/search?q=a&deprecated=${value}`)).json()) as ComponentSearch).components.map((c) => c.name);
    expect(await found("only")).toEqual(["acme/card-deck"]);
    expect(await found("exclude")).toEqual(["acme/random-pool"]);
    expect((await get("/api/components?deprecated=maybe")).status).toBe(400);
    expect((await get("/components.json?deprecated=only")).status).toBe(200);
    expect(await (await get("/components.txt?deprecated=exclude")).text()).not.toContain("acme/card-deck");
  });

  it("works the same for recipes, with a recipe as the replacement", async () => {
    githubFor({ ...release("acme/poker-night-recipe", "v0.1.0", "poker-night-0.1.0.tar", 21) });
    await publishRecipe();
    const res = await post("/api/dev/recipes/poker-night/deprecate", { replacement: "acme/poker-night" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("cannot replace itself");
    expect((await post("/api/dev/recipes/poker-night/deprecate", { replacement: "acme/card-deck" })).status).toBe(400);
    expect((await post("/api/dev/recipes/poker-night/deprecate", { replacement: "acme/poker-night-two" })).status).toBe(400);
    expect((await post("/api/dev/recipes/poker-night/deprecate", {})).status).toBe(200);
    const v = (await (await get("/api/recipes/poker-night")).json()) as RecipeVersionView;
    expect(v).toMatchObject({ status: "deprecated", deprecations: [{ name: "acme/poker-night", status: "deprecated", reason: "owner-deprecated", via: [] }] });
    expect(((await (await get("/api/recipes?deprecated=only")).json()) as RecipeList).recipes).toHaveLength(1);
    expect(((await (await get("/api/recipes?deprecated=exclude")).json()) as RecipeList).recipes).toHaveLength(0);
    expect(await (await get("/recipes/poker-night.txt")).text()).toContain("DEPRECATION WARNING: acme/poker-night 0.1.0 is deprecated by its publisher");
    const mine = (await (await handle(api(cookie, "GET", "/api/dev/recipes"), env, deps)).json()) as { recipes: { status: string; deprecated: unknown }[] };
    expect(mine.recipes[0]).toMatchObject({ status: "deprecated", deprecated: { reason: "owner-deprecated", replacement: null } });
    expect((await post("/api/dev/recipes/poker-night/undeprecate", {})).status).toBe(200);
    expect(((await (await get("/api/recipes/poker-night")).json()) as RecipeVersionView).status).toBe("active");
  });

  it("is for the owner only, with write scope", async () => {
    const other = await signIn(env, deps, { id: 9, login: "sue", name: "Sue" });
    expect((await post("/api/dev/components/card-deck/deprecate", {}, other)).status).toBe(404);
    expect((await post("/api/dev/components/card-deck/undeprecate", {}, other)).status).toBe(404);
    expect((await post("/api/dev/components/nope/deprecate", {})).status).toBe(404);
    expect((await post("/api/dev/components/card-deck/deprecate", {}, null)).status).toBe(401);
    expect((await post("/api/dev/components/card-deck/deprecate", { replacement: 5 })).status).toBe(400);
    const read = (await (await post("/api/dev/keys", { name: "reader", scope: "read" })).json()) as { key: string };
    const manage = (await (await post("/api/dev/keys", { name: "writer", scope: "manage" })).json()) as { key: string };
    const asKey = (key: string, path: string) => handle(api(null, "POST", path, {}, { Authorization: `Bearer ${key}` }), env, deps);
    expect((await asKey(read.key, "/api/dev/components/card-deck/deprecate")).status).toBe(403);
    expect((await asKey(manage.key, "/api/dev/components/card-deck/deprecate")).status).toBe(200);
    expect(((await (await get("/api/components/card-deck")).json()) as ComponentVersionView).status).toBe("deprecated");
  });
});

describe("deprecation reaches what uses a flagged component", () => {
  beforeEach(publishChain);

  it("shows nothing while nothing is flagged", async () => {
    const report = (await (await get("/api/recipes/poker-night/0.1.0/deprecations")).json()) as DeprecationReport;
    expect(report).toEqual({ name: "acme/poker-night", version: "0.1.0", status: "active", affected: false, checked: 6, deprecations: [] });
  });

  it("resolves the full tree: direct components and what they depend on", async () => {
    await post("/api/dev/components/random-pool/deprecate", { replacement: "acme/card-deck" });
    const since = deps.now().toISOString();
    const pool = { name: "acme/random-pool", version: "0.1.0", status: "deprecated", reason: "owner-deprecated", since, replacement: "acme/card-deck", via: ["acme/card-deck"] };

    const report = (await (await get("/api/recipes/poker-night/0.1.0/deprecations")).json()) as DeprecationReport;
    expect(report).toEqual({ name: "acme/poker-night", version: "0.1.0", status: "active", affected: true, checked: 6, deprecations: [pool] });
    expect(((await (await get("/api/recipes/poker-night/latest/deprecations")).json()) as DeprecationReport).deprecations).toEqual([pool]);

    const recipe = (await (await get("/api/recipes/poker-night")).json()) as RecipeVersionView;
    expect(recipe.status).toBe("active");
    expect(recipe.deprecations).toEqual([pool]);
    expect(recipe.components.map((c) => c.deprecation)).toEqual([null, null, null, null, null]);
    expect(((await (await get("/api/recipes")).json()) as RecipeList).recipes[0].deprecations).toEqual([pool]);
    expect(((await (await get("/api/recipes/search?q=poker")).json()) as RecipeSearch).recipes[0].deprecations).toEqual([pool]);
    expect(((await (await get("/recipes/poker-night.json")).json()) as RecipeVersionView).deprecations).toEqual([pool]);
    const text = await (await get("/recipes/poker-night.txt")).text();
    expect(text).toContain("DEPRECATION WARNING: acme/random-pool 0.1.0 is deprecated by its publisher (owner-deprecated, since 2026-10-16T10:00:00.000Z, used by acme/card-deck); replacement acme/card-deck");
    expect(text).toContain(`Deprecation tree: ${BASE}/api/recipes/poker-night/0.1.0/deprecations`);
    expect(await (await get("/recipes.txt")).text()).toContain("  DEPRECATION WARNING: acme/random-pool 0.1.0");
    expect(((await (await get("/api/recipes/poker-night/0.1.0/bundle")).json()) as BundleLink).deprecations).toEqual([pool]);

    const card = (await (await get("/api/components/card-deck")).json()) as ComponentVersionView;
    expect(card.status).toBe("active");
    expect(card.dependencies).toEqual([{ name: "acme/random-pool", version: "0.1.0" }]);
    expect(card.deprecations).toEqual([pool]);
    expect(await (await get("/components/card-deck.txt")).text()).toContain("DEPRECATION WARNING: acme/random-pool 0.1.0");
    expect(await (await get("/components/card-deck.txt")).text()).toContain("Depends on components: acme/random-pool 0.1.0");
    const cardReport = (await (await get("/api/components/card-deck/0.1.0/deprecations")).json()) as DeprecationReport;
    expect(cardReport).toMatchObject({ affected: true, checked: 1, deprecations: [{ name: "acme/random-pool", via: ["acme/card-deck"] }] });
    expect(((await (await get("/api/components/random-pool")).json()) as ComponentVersionView).deprecations).toEqual([{ ...pool, via: [] }]);
  });

  it("marks the direct component on the recipe and merges how it is reached", async () => {
    await post("/api/dev/components/card-deck/deprecate", {});
    await post("/api/dev/components/random-pool/deprecate", {});
    const recipe = (await (await get("/api/recipes/poker-night")).json()) as RecipeVersionView;
    expect(recipe.deprecations.map((d) => [d.name, d.via])).toEqual([["acme/card-deck", ["acme/poker-night"]], ["acme/random-pool", ["acme/card-deck"]]]);
    expect(recipe.components.find((c) => c.id === "deck")!.deprecation).toMatchObject({ name: "acme/card-deck", status: "deprecated" });
    expect(recipe.components.find((c) => c.id === "seats")!.deprecation).toBeNull();
  });

  it("covers every version of a flagged name, and clears with undeprecate", async () => {
    await post("/api/dev/components/random-pool/deprecate", {});
    githubFor({ ...release("acme/random-pool", "v0.2.0", "random-pool-0.2.0.tar", 42) });
    expect((await post("/api/dev/components", POOL((e) => ((e.version = "0.2.0"), (e.digest = digest("2")), (e.source.tag = "v0.2.0"), (e.bundle.asset = "random-pool-0.2.0.tar"))))).status).toBe(201);
    expect(((await (await get("/api/components/random-pool/0.2.0")).json()) as ComponentVersionView).status).toBe("deprecated");
    await post("/api/dev/components/random-pool/undeprecate", {});
    expect(((await (await get("/api/recipes/poker-night/0.1.0/deprecations")).json()) as DeprecationReport).deprecations).toEqual([]);
  });

  it("stops at a cycle", async () => {
    await env.DB.prepare("INSERT INTO component_dependencies (component_id, version, dependency_name, dependency_version) SELECT id, '0.1.0', 'acme/card-deck', '0.1.0' FROM components WHERE name = 'acme/random-pool'").run();
    await post("/api/dev/components/random-pool/deprecate", {});
    const report = (await (await get("/api/recipes/poker-night/0.1.0/deprecations")).json()) as DeprecationReport;
    expect(report.deprecations.map((d) => d.name)).toEqual(["acme/random-pool"]);
    expect(report.deprecations[0].via).toEqual(["acme/card-deck"]);
  });

  it("answers 404 for an unknown or unlisted version", async () => {
    expect((await get("/api/recipes/poker-night/9.9.9/deprecations")).status).toBe(404);
    expect((await get("/api/components/nope/0.1.0/deprecations")).status).toBe(404);
    expect((await get("/api/recipes/Bad/0.1.0/deprecations")).status).toBe(404);
  });
});

describe("account deletion keeps the catalogue and orphans it", () => {
  const deleteAccount = async () => {
    const res = await handle(api(cookie, "DELETE", "/api/dev/me", { confirm: "george" }), env, deps);
    expect(res.status).toBe(200);
  };

  beforeEach(async () => {
    await publishChain();
    await post("/api/dev/components/card-deck/deprecate", { replacement: "acme/random-pool" });
  });

  it("keeps every catalogue row and the search rows, with a null owner and the orphaned flag", async () => {
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM catalogue_fts").first<{ n: number }>())!.n;
    await deleteAccount();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM developers").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM catalogue_fts").first<{ n: number }>())!.n).toBe(before);
    for (const [table, n] of [["recipes", 1], ["recipe_versions", 1], ["recipe_components", 5], ["components", 2], ["component_versions", 2], ["component_interfaces", 3], ["component_dependencies", 1]] as const) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n, table).toBe(n);
    }
    const rows = (await env.DB.prepare("SELECT name, developer_id, deprecated_at, deprecated_reason, replacement FROM components ORDER BY name").all<Record<string, unknown>>()).results;
    const at = deps.now().toISOString();
    expect(rows).toEqual([
      { name: "acme/card-deck", developer_id: null, deprecated_at: at, deprecated_reason: "owner-deleted", replacement: "acme/random-pool" },
      { name: "acme/random-pool", developer_id: null, deprecated_at: at, deprecated_reason: "owner-deleted", replacement: null },
    ]);
    expect((await env.DB.prepare("SELECT developer_id, deprecated_reason FROM recipes").first())).toEqual({ developer_id: null, deprecated_reason: "owner-deleted" });
  });

  it("keeps them listed and searchable, with no publisher and an orphaned warning everywhere", async () => {
    await deleteAccount();
    const at = deps.now().toISOString();
    const own = { name: "acme/card-deck", version: "0.1.0", status: "orphaned", reason: "owner-deleted", since: at, replacement: "acme/random-pool", via: [] };
    const list = (await (await get("/api/components")).json()) as ComponentList;
    expect(list.total).toBe(2);
    expect(list.components.map((c) => [c.name, c.status, c.publisher])).toEqual([["acme/card-deck", "orphaned", null], ["acme/random-pool", "orphaned", null]]);
    expect(list.components[0].deprecations).toEqual([own, { name: "acme/random-pool", version: "0.1.0", status: "orphaned", reason: "owner-deleted", since: at, via: ["acme/card-deck"] }]);
    expect(((await (await get("/api/components/search?q=pool")).json()) as ComponentSearch).components[0].status).toBe("orphaned");
    expect(((await (await get("/api/components?deprecated=only")).json()) as ComponentList).total).toBe(2);
    expect(((await (await get("/api/components?deprecated=exclude")).json()) as ComponentList).total).toBe(0);

    const recipe = (await (await get("/api/recipes/poker-night")).json()) as RecipeVersionView;
    expect(recipe).toMatchObject({ status: "orphaned", publisher: null });
    expect(recipe.deprecations.map((d) => [d.name, d.status, d.via])).toEqual([["acme/poker-night", "orphaned", []], ["acme/card-deck", "orphaned", ["acme/poker-night"]], ["acme/random-pool", "orphaned", ["acme/card-deck"]]]);
    expect(recipe.components.find((c) => c.id === "deck")!.deprecation).toMatchObject({ status: "orphaned" });

    const text = await (await get("/recipes/poker-night.txt")).text();
    expect(text).toContain("DEPRECATION WARNING: acme/poker-night 0.1.0 is orphaned: its publisher deleted their account");
    expect(text).toContain("DEPRECATION WARNING: acme/card-deck 0.1.0 is orphaned");
    expect(text).toContain("Publisher: none (the publisher deleted their account)");
    expect(text).toContain("bundle-unavailable");
    expect(JSON.stringify(recipe)).not.toMatch(/george|developerId|developer_id/i);
    const xml = await (await get("/sitemap.xml")).text();
    expect(xml).toContain("/recipes/poker-night");
  });

  it("serves a public release without any token and records no token use", async () => {
    await deleteAccount();
    calls.length = 0;
    const res = await get("/api/recipes/poker-night/0.1.0/bundle");
    expect(res.status).toBe(200);
    const link = (await res.json()) as BundleLink;
    expect(link).toMatchObject({ status: "available", name: "acme/poker-night", asset: "poker-night-0.1.0.tar", assetDigest: EXAMPLE_BUNDLE_DIGEST });
    expect(link.url).toMatch(new RegExp(`^${BASE}/dl/`));
    expect(link.expiresAt).not.toBeNull();
    const file = await handle(new Request(link.url!), env, deps);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("BUNDLEBYTES");
    expect(file.headers.get("Content-Disposition")).toBe('attachment; filename="poker-night-0.1.0.tar"');
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) expect(c.headers.get("Authorization"), c.url).toBeNull();
    expect(calls.at(-1)!.headers.get("Accept")).toBe("application/octet-stream");
    expect(JSON.stringify(link)).not.toContain("api.github.com");
  });

  it("marks bundle-unavailable when the release is private or gone", async () => {
    await deleteAccount();
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { releaseStatus: 404 }));
    const res = await get("/api/components/card-deck/0.1.0/bundle");
    expect(res.status).toBe(200);
    const link = (await res.json()) as BundleLink;
    expect(link).toMatchObject({ status: "bundle-unavailable", url: null, expiresAt: null, name: "acme/card-deck", asset: "card-deck-0.1.0.tar" });
    expect(link.deprecations.length).toBeGreaterThan(0);
    githubFor(release("acme/card-deck", "v0.1.0", "other.tar", 11));
    expect(((await (await get("/api/components/card-deck/0.1.0/bundle")).json()) as BundleLink).status).toBe("bundle-unavailable");
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { releaseStatus: 500 }));
    expect((await get("/api/components/card-deck/0.1.0/bundle")).status).toBe(502);
    githubFor(release("acme/card-deck", "v0.1.0", "card-deck-0.1.0.tar", 11, { digest: digest("f") }));
    expect((await get("/api/components/card-deck/0.1.0/bundle")).status).toBe(502);
  });

  it("keeps the name taken, and nobody can unlist, deprecate or undeprecate it", async () => {
    await deleteAccount();
    const other = await signIn(env, deps, { id: 9, login: "sue", name: "Sue" });
    await saveToken(other);
    const res = await post("/api/dev/components", nextComponent("0.2.0", digest("e")), other);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("deleted their account");
    for (const path of ["/api/dev/components/card-deck/undeprecate", "/api/dev/components/card-deck/deprecate"]) expect((await post(path, {}, other)).status, path).toBe(404);
    expect((await del("/api/dev/components/card-deck", other)).status).toBe(404);
    expect(((await (await get("/api/components/card-deck")).json()) as ComponentVersionView).status).toBe("orphaned");
  });

  it("does not count orphaned entries against a new developer's limit", async () => {
    await deleteAccount();
    cookie = await signIn(env, deps);
    await saveToken();
    const mine = (await (await handle(api(cookie, "GET", "/api/dev/components"), env, deps)).json()) as { components: unknown[] };
    expect(mine.components).toEqual([]);
  });

  it("refuses to delete a developer row that still owns an unflagged entry", async () => {
    const dev = (await env.DB.prepare("SELECT id FROM developers").first<{ id: string }>())!.id;
    await env.DB.prepare("UPDATE components SET deprecated_at = NULL, deprecated_reason = NULL").run();
    await expect(env.DB.prepare("DELETE FROM developers WHERE id = ?").bind(dev).run()).rejects.toThrow();
  });
});

