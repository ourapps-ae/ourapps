// The recipe library and component catalogue: public reads, and publishing by a signed-in developer or a manage key.
// D1 holds pointers and page material; the packages stay in the publisher's GitHub releases.
import {
  DEPRECATED_FILTERS,
  NEIGHBOURS_SHOWN,
  fit,
  componentConnectionsSvg,
  providersPath,
  recipeComponentsSvg,
  isCatalogueName,
  isCatalogueSlug,
  isVersion,
  splitName,
  validateComponentEntry,
  validateRecipeEntry,
  type BundleLink,
  type ComponentList,
  type ComponentSearch,
  type ComponentSummary,
  type ComponentVersionView,
  type ComponentFacts,
  type Deprecation,
  type DeprecatedFilter,
  type DeprecationReport,
  type RecipeContext,
  type RecipeList,
  type RecipeSearch,
  type RecipeSlot,
  type RecipeSlotView,
  type RecipeSummary,
  type RecipeVersionView,
} from "@my/store-shared";
import { audit } from "../audit.js";
import type { AuthedDeveloper } from "../auth.js";
import { componentListText, componentSearchText, componentText, recipeListText, recipeSearchText, recipeText } from "../catalogue-text.js";
import { CatalogueDb, entryStatus, type ComponentRow, type EntryRow, type Kind, type ListFilter, type RecipeRow } from "../catalogue-db.js";
import { randomId } from "../crypto.js";
import type { Deps, Env } from "../env.js";
import { dlUrl } from "../flow.js";
import { HttpError, json, readJson } from "../http.js";
import { loadSecrets } from "../secrets.js";
import { fetchUpstream } from "../upstream.js";

export const MAX_RECIPES_PER_DEVELOPER = 50;
export const MAX_COMPONENTS_PER_DEVELOPER = 200;
export const MAX_VERSIONS_PER_ENTRY = 200;

const SECRET_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\boa_[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b/;

// ---------------------------------------------------------------- public reads

function db(env: Env): CatalogueDb {
  return new CatalogueDb(env.DB);
}

function word(url: URL, key: string, pattern: RegExp): string | undefined {
  const value = url.searchParams.get(key)?.trim();
  if (!value) return undefined;
  if (!pattern.test(value)) throw new HttpError(400, `${key} is not valid`);
  return value;
}

function intParam(url: URL, key: string, fallback: number, min: number, max: number): number {
  const value = url.searchParams.get(key);
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${key} must be a whole number from ${min} to ${max}`);
  return n;
}

function deprecatedParam(url: URL): DeprecatedFilter {
  const value = url.searchParams.get("deprecated")?.trim() || "include";
  if (!(DEPRECATED_FILTERS as readonly string[]).includes(value)) throw new HttpError(400, `deprecated must be one of ${DEPRECATED_FILTERS.join(", ")}`);
  return value as DeprecatedFilter;
}

// Every value of a repeated parameter: a component must match each one.
function words(url: URL, key: string, pattern: RegExp, max: number): string[] | undefined {
  const values = [...new Set(url.searchParams.getAll(key).map((v) => v.trim()).filter(Boolean))];
  if (values.length > max) throw new HttpError(400, `${key} may be given at most ${max} times`);
  for (const value of values) if (!pattern.test(value)) throw new HttpError(400, `${key} is not valid`);
  return values.length === 0 ? undefined : values;
}

function listFilter(url: URL): ListFilter {
  const slug = /^[a-z0-9-]{1,40}$/;
  return {
    category: word(url, "category", slug),
    target: word(url, "target", slug),
    tag: word(url, "tag", slug),
    provides: words(url, "provides", /^[A-Za-z0-9_.:/-]{1,80}$/, 10),
    requires: words(url, "requires", /^[A-Za-z0-9_.:/-]{1,80}$/, 10),
    deprecated: deprecatedParam(url),
    limit: intParam(url, "limit", 50, 1, 100),
    offset: intParam(url, "offset", 0, 0, 100_000),
  };
}

function query(url: URL): string {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q === "") throw new HttpError(400, "q is required");
  if (q.length > 200) throw new HttpError(400, "q is at most 200 characters");
  return q;
}

function slugOf(input: string): string {
  if (!isCatalogueSlug(input)) throw new HttpError(404, "not found");
  return input;
}

function versionOf(input: string): string {
  if (input !== "latest" && !isVersion(input)) throw new HttpError(404, "not found");
  return input;
}

const publisher = (r: { publisherSlug: string | null; publisherName: string | null }) => (r.publisherSlug === null ? null : { slug: r.publisherSlug, displayName: r.publisherName ?? r.publisherSlug });

export function recipeSummary(env: Env, r: RecipeRow, deprecations: Deprecation[]): RecipeSummary {
  return { name: r.name, slug: r.slug, version: r.version, title: r.title, summary: r.summary, category: r.category, tags: r.tags, targets: r.targets, publishedAt: r.publishedAt, publisher: publisher(r), repository: r.sourceRepo, url: `${env.PUBLIC_ORIGIN}/recipes/${r.slug}`, status: entryStatus(r.developerId, r.flag), deprecations };
}

export function componentSummary(env: Env, r: ComponentRow, deprecations: Deprecation[]): ComponentSummary {
  return { name: r.name, slug: r.slug, version: r.version, description: r.description, category: r.category, tags: r.tags, targets: r.targets, provides: r.provides, requires: r.requires, publishedAt: r.publishedAt, publisher: publisher(r), repository: r.sourceRepo, url: `${env.PUBLIC_ORIGIN}/components/${r.slug}`, status: entryStatus(r.developerId, r.flag), deprecations };
}

const subject = (kind: Kind, r: RecipeRow | ComponentRow) => ({ kind, entryId: r.entryId, name: r.name, version: r.version, developerId: r.developerId, flag: r.flag });

async function recipeSummaries(env: Env, d: CatalogueDb, rows: RecipeRow[]): Promise<RecipeSummary[]> {
  const trees = await d.deprecationsFor(rows.map((r) => subject("recipe", r)));
  return rows.map((r, i) => recipeSummary(env, r, trees[i].notices));
}

async function componentSummaries(env: Env, d: CatalogueDb, rows: ComponentRow[]): Promise<ComponentSummary[]> {
  const trees = await d.deprecationsFor(rows.map((r) => subject("component", r)));
  return rows.map((r, i) => componentSummary(env, r, trees[i].notices));
}

// For each slot, the catalogue list of the components providing every interface type its class provides, and how many
// of them, other than the preferred component, fit the class (newest listed version of each). The preferred component's
// interface documents define the class's documents, so without it listed nothing fits; as with aepm alternatives, a
// class that provides no interface has no alternatives.
async function alternativesFor(env: Env, d: CatalogueDb, slots: RecipeSlot[], preferred: (ComponentFacts | null)[]): Promise<RecipeSlotView["alternatives"][]> {
  const candidates = await d.providerFacts([...new Set(slots.flatMap((s) => s.class.provides.map((p) => p.type)))]);
  return slots.map((s, i) => {
    const own = preferred[i];
    return {
      count: s.class.provides.length === 0 || !own ? 0 : candidates.filter((c) => c.name !== s.preferred.name && fit(s.class, c, own).length === 0).length,
      url: `${env.PUBLIC_ORIGIN}${providersPath(s.class.provides.map((p) => p.type))}`,
    };
  });
}

async function recipeView(env: Env, d: CatalogueDb, entry: EntryRow, r: RecipeRow): Promise<RecipeVersionView> {
  const recipe = r.recipe;
  const [listed, [tree], preferred] = await Promise.all([d.catalogueFor(recipe.components.map((s) => s.preferred)), d.deprecationsFor([subject("recipe", r)]), d.componentFacts(recipe.components.map((s) => s.preferred))]);
  const alternatives = await alternativesFor(env, d, recipe.components, preferred);
  return {
    ...recipeSummary(env, r, tree.notices),
    digest: r.digest,
    source: { repository: r.sourceRepo, tag: r.sourceTag },
    bundle: { asset: r.bundleAsset, digest: r.bundleDigest, url: `${env.PUBLIC_ORIGIN}/api/recipes/${r.slug}/${r.version}/bundle` },
    description: r.description,
    diagram: r.diagram ? `${env.PUBLIC_ORIGIN}/api/recipes/${r.slug}/${r.version}/diagram.svg` : null,
    screenshots: r.screenshots,
    components: recipe.components.map((s, i) => {
      const listedEntry = listed[i] ?? null;
      return {
        ...s,
        preferred: { ...s.preferred, url: listedEntry ? `${env.PUBLIC_ORIGIN}/components/${listedEntry.slug}` : null },
        catalogue: listedEntry ? { description: listedEntry.description, suitability: listedEntry.suitability, guardians: listedEntry.guardians } : null,
        deprecation: tree.notices.find((n) => n.name === s.preferred.name && n.version === s.preferred.version && n.via.includes(r.name)) ?? null,
        alternatives: alternatives[i]!,
      };
    }),
    jobs: recipe.jobs,
    scale: recipe.scale,
    questions: recipe.questions,
    connections: recipe.connections,
    tests: recipe.tests,
    instructions: recipe.instructions,
    versions: (await d.versions("recipe", entry.id)).map(({ version, digest, publishedAt }) => ({ version, digest, publishedAt })),
  };
}

async function componentView(env: Env, d: CatalogueDb, entry: EntryRow, r: ComponentRow): Promise<ComponentVersionView> {
  const [tree] = await d.deprecationsFor([subject("component", r)]);
  return {
    ...componentSummary(env, r, tree.notices),
    digest: r.digest,
    guardians: r.guardians,
    settings: r.settings,
    interfaceDigests: r.interfaceDigests,
    interfaceModules: r.interfaceModules,
    dependencies: r.dependencies,
    suitability: r.suitability,
    migration: r.migration,
    source: { repository: r.sourceRepo, tag: r.sourceTag },
    bundle: { asset: r.bundleAsset, digest: r.bundleDigest, url: `${env.PUBLIC_ORIGIN}/api/components/${r.slug}/${r.version}/bundle` },
    versions: (await d.versions("component", entry.id)).map(({ version, digest, publishedAt }) => ({ version, digest, publishedAt })),
    usedBy: (await d.recipesUsing(r.name)).map((u) => ({ ...u, url: `${env.PUBLIC_ORIGIN}/recipes/${u.slug}` })),
  };
}

// GET /api/recipes
export async function listRecipes(env: Env, url: URL): Promise<Response> {
  return json(await recipeList(env, url));
}

async function recipeList(env: Env, url: URL): Promise<RecipeList> {
  const f = listFilter(url);
  const d = db(env);
  const { rows, total } = await d.listRecipes(f);
  return { recipes: await recipeSummaries(env, d, rows), total, limit: f.limit, offset: f.offset, categories: await d.categories("recipe") };
}

// GET /api/recipes/search?q=
export async function searchRecipes(env: Env, url: URL): Promise<Response> {
  return json(await recipeSearch(env, url));
}

async function recipeSearch(env: Env, url: URL): Promise<RecipeSearch> {
  const q = query(url);
  const d = db(env);
  return { query: q, recipes: await recipeSummaries(env, d, await d.searchRecipes(q, intParam(url, "limit", 20, 1, 50), deprecatedParam(url))) };
}

// GET /api/recipes/:name/:version (version may be "latest")
export async function recipeDetail(env: Env, name: string, version: string): Promise<Response> {
  return json(await recipeDetailView(env, name, version));
}

async function recipeDetailView(env: Env, name: string, version: string): Promise<RecipeVersionView> {
  const d = db(env);
  const found = await d.recipeVersion(slugOf(name), versionOf(version));
  if (!found) throw new HttpError(404, "no such recipe version");
  return recipeView(env, d, found.entry, found.row);
}

export async function listComponents(env: Env, url: URL): Promise<Response> {
  return json(await componentList(env, url));
}

async function componentList(env: Env, url: URL): Promise<ComponentList> {
  const f = listFilter(url);
  const d = db(env);
  const { rows, total } = await d.listComponents(f);
  return { components: await componentSummaries(env, d, rows), total, limit: f.limit, offset: f.offset, categories: await d.categories("component") };
}

export async function searchComponents(env: Env, url: URL): Promise<Response> {
  return json(await componentSearch(env, url));
}

async function componentSearch(env: Env, url: URL): Promise<ComponentSearch> {
  const q = query(url);
  const d = db(env);
  return { query: q, components: await componentSummaries(env, d, await d.searchComponents(q, intParam(url, "limit", 20, 1, 50), deprecatedParam(url))) };
}

export async function componentDetail(env: Env, name: string, version: string): Promise<Response> {
  return json(await componentDetailView(env, name, version));
}

async function componentDetailView(env: Env, name: string, version: string): Promise<ComponentVersionView> {
  const d = db(env);
  const found = await d.componentVersion(slugOf(name), versionOf(version));
  if (!found) throw new HttpError(404, "no such component version");
  return componentView(env, d, found.entry, found.row);
}

const SVG_HEADERS = { "Content-Type": "image/svg+xml", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };

// GET /api/recipes/:name/:version/diagram.svg
export async function recipeDiagram(env: Env, name: string, version: string): Promise<Response> {
  const found = await db(env).recipeVersion(slugOf(name), versionOf(version));
  if (!found?.row.diagram) throw new HttpError(404, "no diagram");
  return new Response(found.row.diagram, { headers: { ...SVG_HEADERS, "Cache-Control": "no-store" } });
}

// GET /api/recipes/:name/:version/components.svg: the recipe's slots, each with its preferred component, by category
// and the connections between them.
export async function recipeComponentsDiagram(env: Env, name: string, version: string): Promise<Response> {
  const d = db(env);
  const found = await d.recipeVersion(slugOf(name), versionOf(version));
  if (!found) throw new HttpError(404, "no such recipe version");
  const r = found.row;
  const listed = await d.catalogueFor(r.recipe.components.map((s) => s.preferred));
  const svg = recipeComponentsSvg({ name: r.name, version: r.version, title: r.title, components: r.recipe.components, connections: r.recipe.connections, catalogue: listed });
  return new Response(svg, { headers: { ...SVG_HEADERS, "Cache-Control": "public, max-age=300" } });
}

// GET /api/components/:name/:version/connections.svg: what the component requires and provides, and the catalogue
// components on the other side of each interface, found with the same queries as ?provides= and ?requires=.
export async function componentConnectionsDiagram(env: Env, name: string, version: string): Promise<Response> {
  const d = db(env);
  const found = await d.componentVersion(slugOf(name), versionOf(version));
  if (!found) throw new HttpError(404, "no such component version");
  const r = found.row;
  const lookup = async (direction: "provides" | "requires", type: string) => {
    const { rows, total } = await d.listComponents({ [direction]: [type], deprecated: "include", limit: NEIGHBOURS_SHOWN + 1, offset: 0 });
    const others = rows.filter((x) => x.name !== r.name);
    return { components: others.map((x) => ({ name: x.name, version: x.version, category: x.category })), total: total - (rows.length - others.length) };
  };
  const pairs = async (ports: { type: string }[], direction: "provides" | "requires") => Object.fromEntries(await Promise.all([...new Set(ports.map((p) => p.type))].map(async (t) => [t, await lookup(direction, t)] as const)));
  const [providers, consumers] = await Promise.all([pairs(r.requires, "provides"), pairs(r.provides, "requires")]);
  const svg = componentConnectionsSvg({ name: r.name, version: r.version, category: r.category, targets: r.targets, provides: r.provides, requires: r.requires, profiles: r.suitability?.profiles ?? [], providers, consumers });
  return new Response(svg, { headers: { ...SVG_HEADERS, "Cache-Control": "public, max-age=300" } });
}

// The release asset behind a version, checked against the recorded digest. The publisher's token is used while the
// publisher exists; an orphaned entry is read without any token, which only works for a public release.
async function releaseAsset(env: Env, deps: Deps, developerId: string | null, repo: string, tag: string, assetName: string, digest: string): Promise<{ url: string } | "unavailable"> {
  const token = developerId === null ? undefined : (await loadSecrets(env, developerId, ["githubToken"])).githubToken;
  const release = await githubRelease(env, deps, repo, tag, token);
  if (release.status === "missing" && developerId === null) return "unavailable";
  if (release.status !== "ok") throw new HttpError(502, "the release holding this bundle is not available right now");
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    if (developerId === null) return "unavailable";
    throw new HttpError(502, "the release does not hold this bundle");
  }
  if (asset.digest && asset.digest !== digest) throw new HttpError(502, "the release asset does not match the recorded digest");
  return { url: asset.url };
}

interface ReleaseAsset {
  name: string;
  url: string;
  digest?: string | null;
}

type ReleaseLookup = { status: "ok"; assets: ReleaseAsset[] } | { status: "missing" } | { status: "error" };

async function githubRelease(env: Env, deps: Deps, repo: string, tag: string, token: string | undefined): Promise<ReleaseLookup> {
  const path = tag.split("/").map(encodeURIComponent).join("/");
  let res: Response;
  try {
    res = await fetchUpstream(env, deps, `${env.GITHUB_API_BASE}/repos/${repo}/releases/tags/${path}`, token, "application/vnd.github+json");
  } catch {
    return { status: "error" };
  }
  if (res.status === 404) return { status: "missing" };
  if (!res.ok) return { status: "error" };
  const body = (await res.json().catch(() => null)) as { assets?: ReleaseAsset[] } | null;
  return { status: "ok", assets: Array.isArray(body?.assets) ? body!.assets! : [] };
}

async function bundleLink(env: Env, deps: Deps, d: CatalogueDb, kind: Kind, found: { entry: EntryRow; row: RecipeRow | ComponentRow }): Promise<Response> {
  const { entry, row } = found;
  const [tree] = await d.deprecationsFor([subject(kind, row)]);
  const base = { name: row.name, version: row.version, digest: row.digest, asset: row.bundleAsset, assetDigest: row.bundleDigest, deprecations: tree.notices };
  const asset = await releaseAsset(env, deps, entry.developerId, row.sourceRepo, row.sourceTag, row.bundleAsset, row.bundleDigest);
  if (asset === "unavailable") {
    const body: BundleLink = { ...base, status: "bundle-unavailable", url: null, expiresAt: null };
    return json(body);
  }
  const url = await dlUrl(env, deps, { url: asset.url, kind: "bundle", dev: entry.developerId ?? "", name: row.bundleAsset });
  const expiresAt = new Date(Math.floor(deps.now().getTime() / 1000) * 1000 + 60 * 60 * 1000).toISOString();
  const body: BundleLink = { ...base, status: "available", url, expiresAt };
  return json(body);
}

// GET /api/recipes/:name/:version/bundle
export async function recipeBundle(env: Env, deps: Deps, name: string, version: string): Promise<Response> {
  const d = db(env);
  const found = await d.recipeVersion(slugOf(name), versionOf(version));
  if (!found) throw new HttpError(404, "no such recipe version");
  return bundleLink(env, deps, d, "recipe", found);
}

export async function componentBundle(env: Env, deps: Deps, name: string, version: string): Promise<Response> {
  const d = db(env);
  const found = await d.componentVersion(slugOf(name), versionOf(version));
  if (!found) throw new HttpError(404, "no such component version");
  return bundleLink(env, deps, d, "component", found);
}

// GET /api/recipes/:name/:version/deprecations and the same for components
export async function deprecations(env: Env, kind: Kind, name: string, version: string): Promise<Response> {
  const d = db(env);
  const slug = slugOf(name);
  const wanted = versionOf(version);
  const found = kind === "recipe" ? await d.recipeVersion(slug, wanted) : await d.componentVersion(slug, wanted);
  if (!found) throw new HttpError(404, `no such ${kind} version`);
  const [tree] = await d.deprecationsFor([subject(kind, found.row)]);
  const report: DeprecationReport = { name: found.row.name, version: found.row.version, status: entryStatus(found.row.developerId, found.row.flag), affected: tree.notices.length > 0, checked: tree.checked, deprecations: tree.notices };
  return json(report);
}

// ---------------------------------------------------------------- page variants

const plain = (body: string): Response => new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

// A browser sends Accept with text/html; fetch tools and curl do not.
export function wantsHtml(request: Request): boolean {
  return /text\/html/i.test(request.headers.get("Accept") ?? "");
}

// /recipes.txt, /recipes.json, /recipes/:name.txt, /recipes/:name.json and the same for components.
// Returns null for any other path. ?version= picks a version; ?q= searches a list.
export function pageVariant(env: Env, parts: string[], url: URL, request?: Request): Promise<Response> | null {
  // A client that does not ask for HTML (an agent's fetch tool, curl) gets the plain-text page at the page's own address.
  const bare = parts.length <= 2 && (parts[0] === "recipes" || parts[0] === "components") && !/\.(txt|json)$/.test(parts[parts.length - 1] ?? "");
  if (bare && request && !wantsHtml(request)) return variant(env, parts[0] as "recipes" | "components", parts[1] ?? null, "txt", url);
  const top = /^(recipes|components)\.(txt|json)$/.exec(parts[0] ?? "");
  const nested = parts.length === 2 && (parts[0] === "recipes" || parts[0] === "components") ? /^(.+)\.(txt|json)$/.exec(parts[1]) : null;
  if (parts.length === 1 && top) return variant(env, top[1] as "recipes" | "components", null, top[2] as "txt" | "json", url);
  if (nested) return variant(env, parts[0] as "recipes" | "components", nested[1], nested[2] as "txt" | "json", url);
  return null;
}

async function variant(env: Env, what: "recipes" | "components", name: string | null, format: "txt" | "json", url: URL): Promise<Response> {
  const origin = env.PUBLIC_ORIGIN;
  const searching = url.searchParams.has("q");
  if (name === null && what === "recipes") {
    if (searching) {
      const s = await recipeSearch(env, url);
      return format === "json" ? json(s) : plain(recipeSearchText(s, origin));
    }
    const l = await recipeList(env, url);
    return format === "json" ? json(l) : plain(recipeListText(l, origin));
  }
  if (name === null) {
    if (searching) {
      const s = await componentSearch(env, url);
      return format === "json" ? json(s) : plain(componentSearchText(s, origin));
    }
    const l = await componentList(env, url);
    return format === "json" ? json(l) : plain(componentListText(l, origin));
  }
  const version = url.searchParams.get("version") ?? "latest";
  if (what === "recipes") {
    const v = await recipeDetailView(env, name, version);
    return format === "json" ? json(v) : plain(recipeText(v, origin));
  }
  const v = await componentDetailView(env, name, version);
  return format === "json" ? json(v) : plain(componentText(v, origin));
}

// GET /sitemap.xml
export async function sitemap(env: Env): Promise<Response> {
  const d = db(env);
  const [recipes, components] = await Promise.all([d.listRecipes({ deprecated: "include", limit: 100, offset: 0 }), d.listComponents({ deprecated: "include", limit: 100, offset: 0 })]);
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const urls = ["/", "/example", "/terms", "/reference", "/small", "/recipes", "/components", ...recipes.rows.map((r) => `/recipes/${r.slug}`), ...components.rows.map((c) => `/components/${c.slug}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${escape(env.PUBLIC_ORIGIN + u)}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}

// ---------------------------------------------------------------- publishing

function problems(errors: string[]): HttpError {
  return new HttpError(400, `invalid entry: ${errors.slice(0, 10).join("; ")}${errors.length > 10 ? `; and ${errors.length - 10} more` : ""}`);
}

interface Candidate {
  kind: Kind;
  name: string;
  version: string;
  digest: string;
  source: { repository: string; tag: string };
  bundle: { asset: string; digest: string };
}

// Checks the name against the repository and the publisher, finds or makes the entry, and decides what to do with the version.
async function prepare(env: Env, deps: Deps, dev: AuthedDeveloper, c: Candidate): Promise<{ entry: EntryRow | null; fresh: EntryRow; existing: "none" | "same" }> {
  const d = db(env);
  const { scope, slug } = splitName(c.name)!;
  const owner = c.source.repository.split("/")[0].toLowerCase();
  if (scope !== owner) throw new HttpError(400, `the name's scope ${scope} must be the owner of ${c.source.repository}`);
  const entry = await d.entryBySlug(c.kind, slug);
  if (entry && entry.developerId === null) throw new HttpError(409, "that name belongs to a developer who deleted their account; it cannot be published to");
  if (entry && entry.developerId !== dev.id) throw new HttpError(409, "that name belongs to another developer");
  if (entry && entry.name !== c.name) throw new HttpError(409, `the name ${slug} is already published as ${entry.name}`);
  if (entry && entry.repo.toLowerCase() !== c.source.repository.toLowerCase()) throw new HttpError(409, `${entry.name} is published from ${entry.repo}; every version comes from that repository`);
  const now = deps.now().toISOString();
  const fresh: EntryRow = { id: entry?.id ?? randomId(8), name: c.name, scope, slug, developerId: dev.id, repo: c.source.repository, latestVersion: null, flag: null, createdAt: now, updatedAt: now };
  if (!entry) {
    const cap = c.kind === "recipe" ? MAX_RECIPES_PER_DEVELOPER : MAX_COMPONENTS_PER_DEVELOPER;
    if ((await d.countByDeveloper(c.kind, dev.id)) >= cap) throw new HttpError(409, `a developer can publish at most ${cap} ${c.kind === "recipe" ? "recipes" : "components"}`);
    return { entry: null, fresh, existing: "none" };
  }
  const known = (await d.versions(c.kind, entry.id, true)).find((v) => v.version === c.version);
  if (known) {
    if (known.digest !== c.digest) throw new HttpError(409, `version ${c.version} is already published with a different digest; publish a new version`);
    return { entry, fresh, existing: "same" };
  }
  if ((await d.countVersions(c.kind, entry.id)) >= MAX_VERSIONS_PER_ENTRY) throw new HttpError(409, `at most ${MAX_VERSIONS_PER_ENTRY} versions can be published under one name`);
  return { entry, fresh, existing: "none" };
}

// The publisher must be able to push to the repository, and the release must hold the bundle.
async function verifyRelease(env: Env, deps: Deps, dev: AuthedDeveloper, c: Candidate): Promise<void> {
  const token = (await loadSecrets(env, dev.id, ["githubToken"])).githubToken;
  if (!token) throw new HttpError(409, "save a GitHub token in Settings first: it checks your release and serves the bundle");
  let repo: Response;
  try {
    repo = await fetchUpstream(env, deps, `${env.GITHUB_API_BASE}/repos/${c.source.repository}`, token, "application/vnd.github+json");
  } catch {
    throw new HttpError(502, "GitHub could not be reached");
  }
  if (repo.status === 404) throw new HttpError(422, `your GitHub token cannot see ${c.source.repository}`);
  if (!repo.ok) throw new HttpError(502, `GitHub answered ${repo.status} for ${c.source.repository}`);
  const permissions = ((await repo.json().catch(() => ({}))) as { permissions?: { push?: boolean; maintain?: boolean; admin?: boolean } }).permissions;
  if (!permissions?.push && !permissions?.maintain && !permissions?.admin) throw new HttpError(403, `your GitHub account cannot push to ${c.source.repository}; publish only from repositories you maintain`);
  const release = await githubRelease(env, deps, c.source.repository, c.source.tag, token);
  if (release.status === "error") throw new HttpError(502, "GitHub could not return the release");
  if (release.status === "missing") throw new HttpError(422, `no published release tagged ${c.source.tag} on ${c.source.repository}`);
  const asset = release.assets.find((a) => a.name === c.bundle.asset);
  if (!asset) throw new HttpError(422, `release ${c.source.tag} has no asset named ${c.bundle.asset}`);
  if (asset.digest && asset.digest !== c.bundle.digest) throw new HttpError(422, `the digest of ${c.bundle.asset} on GitHub is ${asset.digest}, not ${c.bundle.digest}`);
}

function refuseSecrets(body: unknown): void {
  if (SECRET_PATTERN.test(JSON.stringify(body))) throw new HttpError(400, "the entry appears to contain a secret; publish references to secrets, never values");
}

function published(env: Env, kind: Kind, status: "published" | "unchanged", name: string, slug: string, version: string): Response {
  const base = kind === "recipe" ? "recipes" : "components";
  return json({ status, name, version, url: `${env.PUBLIC_ORIGIN}/${base}/${slug}`, api: `${env.PUBLIC_ORIGIN}/api/${base}/${slug}/${version}` }, status === "published" ? 201 : 200);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// The catalogue's stored entries for every component version a recipe body prefers or names as a job candidate, so
// the recipe check applies the fit rule to them.
async function catalogueContext(d: CatalogueDb, body: unknown): Promise<RecipeContext> {
  const recipe = isObject(body) && isObject(body.recipe) ? body.recipe : {};
  const refs: { name: string; version: string }[] = [];
  const add = (name: unknown, version: unknown) => {
    if (isCatalogueName(name) && isVersion(version) && refs.length < 200 && !refs.some((r) => r.name === name && r.version === version)) refs.push({ name, version });
  };
  for (const s of Array.isArray(recipe.components) ? recipe.components : []) if (isObject(s) && isObject(s.preferred)) add(s.preferred.name, s.preferred.version);
  for (const j of Array.isArray(recipe.jobs) ? recipe.jobs : []) for (const c of isObject(j) && Array.isArray(j.candidates) ? j.candidates : []) if (isObject(c)) add(c.component, c.version);
  const facts = await d.componentFacts(refs);
  const found = new Map(refs.map((r, i) => [`${r.name} ${r.version}`, facts[i] ?? null]));
  return { components: { source: "the catalogue", find: (name, version) => found.get(`${name} ${version}`) ?? null } };
}

// POST /api/dev/recipes
export async function publishRecipe(request: Request, env: Env, deps: Deps, dev: AuthedDeveloper): Promise<Response> {
  const body = await readJson<unknown>(request);
  const d = db(env);
  const result = validateRecipeEntry(body, await catalogueContext(d, body));
  if (!result.ok) throw problems(result.errors);
  refuseSecrets(body);
  const e = result.entry;
  const c: Candidate = { kind: "recipe", name: e.recipe.name, version: e.recipe.version, digest: e.digest, source: e.source, bundle: e.bundle };
  const plan = await prepare(env, deps, dev, c);
  const slug = splitName(c.name)!.slug;
  const now = deps.now().toISOString();
  if (plan.existing === "same") {
    const wasUnlisted = (await d.versions("recipe", plan.entry!.id, true)).find((v) => v.version === c.version)?.unlistedAt;
    if (!wasUnlisted) return published(env, "recipe", "unchanged", c.name, slug, c.version);
    await verifyRelease(env, deps, dev, c);
    await d.relist("recipe", plan.entry!.id, c.version, now);
  } else {
    await verifyRelease(env, deps, dev, c);
    await d.publishRecipe(plan.entry, plan.fresh, e, now);
  }
  await audit(request, env, deps, dev.id, "recipe-published", `${c.name} ${c.version}`);
  return published(env, "recipe", "published", c.name, slug, c.version);
}

// POST /api/dev/components
export async function publishComponent(request: Request, env: Env, deps: Deps, dev: AuthedDeveloper): Promise<Response> {
  const body = await readJson<unknown>(request);
  const result = validateComponentEntry(body);
  if (!result.ok) throw problems(result.errors);
  refuseSecrets(body);
  const e = result.entry;
  const c: Candidate = { kind: "component", name: e.name, version: e.version, digest: e.digest, source: e.source, bundle: e.bundle };
  const plan = await prepare(env, deps, dev, c);
  const slug = splitName(c.name)!.slug;
  const d = db(env);
  const now = deps.now().toISOString();
  if (plan.existing === "same") {
    const wasUnlisted = (await d.versions("component", plan.entry!.id, true)).find((v) => v.version === c.version)?.unlistedAt;
    if (!wasUnlisted) return published(env, "component", "unchanged", c.name, slug, c.version);
    await verifyRelease(env, deps, dev, c);
    await d.relist("component", plan.entry!.id, c.version, now);
  } else {
    await verifyRelease(env, deps, dev, c);
    await d.publishComponent(plan.entry, plan.fresh, e, now);
  }
  await audit(request, env, deps, dev.id, "component-published", `${c.name} ${c.version}`);
  return published(env, "component", "published", c.name, slug, c.version);
}

// GET /api/dev/recipes and /api/dev/components: the developer's own, unlisted versions included.
export async function listMine(env: Env, dev: AuthedDeveloper, kind: Kind): Promise<Response> {
  const d = db(env);
  const entries = await Promise.all(
    (await d.entriesByDeveloper(kind, dev.id)).map(async (e) => ({
      name: e.name,
      slug: e.slug,
      repository: e.repo,
      latestVersion: e.latestVersion,
      status: entryStatus(e.developerId, e.flag),
      deprecated: e.flag ? { since: e.flag.at, reason: e.flag.reason, replacement: e.flag.replacement } : null,
      versions: (await d.versions(kind, e.id, true)).map((v) => ({ version: v.version, digest: v.digest, publishedAt: v.publishedAt, listed: v.unlistedAt === null })),
    })),
  );
  return json(kind === "recipe" ? { recipes: entries } : { components: entries });
}

// DELETE /api/dev/recipes/:name[/:version] and /api/dev/components/:name[/:version]
export async function unlist(request: Request, env: Env, deps: Deps, dev: AuthedDeveloper, kind: Kind, name: string, version: string | null): Promise<Response> {
  const d = db(env);
  if (!isCatalogueSlug(name) || (version !== null && !isVersion(version))) throw new HttpError(404, "not found");
  const entry = await d.entryBySlug(kind, name);
  if (!entry || entry.developerId !== dev.id) throw new HttpError(404, "not found");
  if (version !== null && !(await d.versions(kind, entry.id, true)).some((v) => v.version === version)) throw new HttpError(404, "not found");
  const unlisted = await d.unlist(kind, entry.id, version, deps.now().toISOString());
  await audit(request, env, deps, dev.id, kind === "recipe" ? "recipe-unlisted" : "component-unlisted", `${entry.name}${version ? ` ${version}` : ""}`);
  return json({ ok: true, unlisted });
}

// POST /api/dev/recipes/:name/deprecate|undeprecate and the same for components. Body for deprecate: optional { replacement }.
export async function setDeprecation(request: Request, env: Env, deps: Deps, dev: AuthedDeveloper, kind: Kind, name: string, deprecate: boolean): Promise<Response> {
  const d = db(env);
  if (!isCatalogueSlug(name)) throw new HttpError(404, "not found");
  const entry = await d.entryBySlug(kind, name);
  if (!entry || entry.developerId !== dev.id) throw new HttpError(404, "not found");
  const body = deprecate ? await optionalJson(request) : {};
  let replacement: string | null = null;
  if (deprecate && body.replacement !== undefined && body.replacement !== null) {
    if (!isCatalogueName(body.replacement)) throw new HttpError(400, "replacement must be a name such as scope/name");
    if (body.replacement === entry.name) throw new HttpError(400, "an entry cannot replace itself");
    const target = await d.entryBySlug(kind, splitName(body.replacement)!.slug);
    if (!target || target.name !== body.replacement) throw new HttpError(400, `replacement must be a published ${kind} name`);
    replacement = body.replacement;
  }
  if (deprecate) await d.deprecate(kind, entry.id, replacement, deps.now().toISOString());
  else await d.undeprecate(kind, entry.id);
  await audit(request, env, deps, dev.id, `${kind}-${deprecate ? "deprecated" : "undeprecated"}`, `${entry.name}${replacement ? ` -> ${replacement}` : ""}`);
  const after = (await d.entryBySlug(kind, name))!;
  return json({ ok: true, name: after.name, status: entryStatus(after.developerId, after.flag), deprecated: after.flag ? { since: after.flag.at, reason: after.flag.reason, replacement: after.flag.replacement } : null });
}

// An absent body means no fields; anything else must be a JSON object.
async function optionalJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, "body must be a JSON object");
  return parsed as Record<string, unknown>;
}
