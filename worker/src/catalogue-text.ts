// Plain-text pages of the recipe library and component catalogue, for agents that read without a browser.
import { COMPONENT_PACKAGE, RECIPE_PACKAGE, deprecationLine, describeCondition, type Condition, type PackageSummary, type Deprecation, type ComponentList, ComponentSearch, ComponentSummary, ComponentVersionView, Port, RecipeComponentView, RecipeList, RecipeQuestion, RecipeSearch, RecipeSummary, RecipeVersionView, Suitability, Targets } from "@my/store-shared";

const COPYRIGHT = "Copyright Level N Ltd 2026";

const list = (items: readonly unknown[]): string => (items.length === 0 ? "none" : items.join(", "));
const targets = (t: Targets): string => `client ${list(t.client)}; server ${list(t.server)}`;
const ports = (p: Port[]): string => list(p.map((x) => `${x.id} (${x.type} ${x.version}${x.optional ? ", optional" : ""})`));

const warnings = (deprecations: Deprecation[]): string[] => deprecations.map((d) => `DEPRECATION WARNING: ${deprecationLine(d)}`);
const packageLines = (summary: PackageSummary): string[] => ["", "What you download", summary.headline, ...summary.parts.map(([label, text]) => `- ${label}: ${text}`), summary.where, summary.check];
const publisherLine = (p: { displayName: string; slug: string } | null): string => (p ? `Publisher: ${p.displayName} (${p.slug})` : "Publisher: none (the publisher deleted their account)");

function page(title: string, body: string[]): string {
  return `${[title, "", ...body, "", COPYRIGHT].join("\n")}\n`;
}

function recipeLine(r: RecipeSummary): string[] {
  return [`- ${r.title} (${r.name}) ${r.version}: ${r.summary}`, ...warnings(r.deprecations).map((w) => `  ${w}`), `  category ${r.category}; ${targets(r.targets)}; tags ${list(r.tags)}`, `  ${r.url}.txt`];
}

function componentLine(c: ComponentSummary): string[] {
  return [`- ${c.name} ${c.version}: ${c.description}`, ...warnings(c.deprecations).map((w) => `  ${w}`), `  provides ${ports(c.provides)}; requires ${ports(c.requires)}`, `  category ${c.category ?? "none"}; ${targets(c.targets)}; tags ${list(c.tags)}`, `  ${c.url}.txt`];
}

function counts(categories: { category: string; count: number }[]): string {
  return list(categories.map((c) => `${c.category} (${c.count})`));
}

export function recipeListText(l: RecipeList, origin: string): string {
  const shown = l.recipes.length === 0 ? 0 : `${l.offset + 1}-${l.offset + l.recipes.length}`;
  return page("ourapps recipe library", [
    `${l.total} recipes; showing ${shown}.`,
    `Categories: ${counts(l.categories)}`,
    `Filter with ?category=, ?target=, ?tag=, ?deprecated=exclude|include|only, search with ?q=. JSON: ${origin}/api/recipes. Components: ${origin}/components.txt`,
    "",
    ...(l.recipes.length === 0 ? ["No recipes match."] : l.recipes.flatMap(recipeLine)),
  ]);
}

export function recipeSearchText(s: RecipeSearch, origin: string): string {
  return page(`ourapps recipe search: ${s.query}`, [`${s.recipes.length} results. JSON: ${origin}/api/recipes/search?q=${encodeURIComponent(s.query)}`, "", ...(s.recipes.length === 0 ? ["No recipes match."] : s.recipes.flatMap(recipeLine))]);
}

export function componentListText(l: ComponentList, origin: string): string {
  const shown = l.components.length === 0 ? 0 : `${l.offset + 1}-${l.offset + l.components.length}`;
  return page("ourapps component catalogue", [
    `${l.total} components; showing ${shown}.`,
    `Categories: ${counts(l.categories)}`,
    `Filter with ?category=, ?target=, ?tag=, ?provides=, ?requires=, ?deprecated=exclude|include|only, search with ?q=. JSON: ${origin}/api/components. Recipes: ${origin}/recipes.txt`,
    "",
    ...(l.components.length === 0 ? ["No components match."] : l.components.flatMap(componentLine)),
  ]);
}

export function componentSearchText(s: ComponentSearch, origin: string): string {
  return page(`ourapps component search: ${s.query}`, [`${s.components.length} results. JSON: ${origin}/api/components/search?q=${encodeURIComponent(s.query)}`, "", ...(s.components.length === 0 ? ["No components match."] : s.components.flatMap(componentLine))]);
}

function answer(value: unknown): string {
  return value === undefined || value === null ? "asked" : typeof value === "string" ? value : JSON.stringify(value);
}

// A condition in words, or the CEL expression itself in backticks when it has no plain wording.
const when = (c: Condition): string => describeCondition(c) ?? `\`${c}\``;

function setValue(v: unknown): string {
  if (typeof v === "string") return v === "$answer" ? "the answer" : JSON.stringify(v);
  return JSON.stringify(v);
}

function question(q: RecipeQuestion): string[] {
  const out = [`- ${q.id} (${q.type}): ${q.ask}`];
  if (q.options) out.push(`  options: ${q.options.join(", ")}`);
  if (q.min !== undefined || q.max !== undefined) out.push(`  range: ${q.min ?? "any"} to ${q.max ?? "any"}`);
  out.push(`  default: ${answer(q.default)}`);
  if (q.askWhen) out.push(`  asked only when ${when(q.askWhen)}; otherwise it takes its default`);
  if (q.askAgent) out.push(`  agent: ${q.askAgent}`);
  for (const effect of q.effects) for (const [target, value] of Object.entries(effect.sets)) out.push(`  sets ${target} to ${setValue(value)}`);
  return out;
}

function jobLines(v: RecipeVersionView): string[] {
  if (v.jobs.length === 0 && !v.scale) return [];
  return [
    "Choosing by suitability",
    ...(v.scale ? [`Scale question: ${v.scale.question}`, ...v.scale.bands.map((b) => `- band ${b.id}: ${b.label}; load ${list(Object.entries(b.load).map(([k, n]) => `${k} ${n}`))}`)] : []),
    ...v.jobs.flatMap((j) => [`- job ${j.id}${j.overrideQuestion ? ` (the answer to ${j.overrideQuestion} restricts the candidates first)` : ""}: ${j.candidates.map((c) => `${c.component} (${c.profile})${c.includedWhen ? ` only when ${when(c.includedWhen)}` : ""}`).join(", ")}`]),
    "",
  ];
}

function connectionLines(v: RecipeVersionView): string[] {
  return ["Connections (application is the recipe's own component)", ...(v.connections.length === 0 ? ["none"] : v.connections.map((c) => `- ${c.source.instance}.${c.source.port} -> ${c.target.instance}.${c.target.port}`)), ""];
}

function suitabilityLines(s: Suitability): string[] {
  return s.profiles.map((p) => {
    const load = Object.entries(p.load).map(([k, v]) => `${k} ${v}`);
    const settings = Object.entries(p.settings ?? {}).map(([k, v]) => `${k} ${JSON.stringify(v)}`);
    return `    profile ${p.id}: cost ${p.cost}; load ${list(load)}; regions ${list(p.regions)}; compliance ${list(p.compliance)}${p.provider ? `; ${p.provider.name} ${p.provider.tier}` : ""}${settings.length > 0 ? `; settings ${list(settings)}` : ""}`;
  });
}

function componentOfRecipe(c: RecipeComponentView): string[] {
  const only = c.includedWhen ? ` (only when ${when(c.includedWhen)})` : "";
  const out = [`- ${c.id}: ${c.name} ${c.version}${only}`];
  if (c.deprecation) out.push(`    DEPRECATION WARNING: ${deprecationLine(c.deprecation)}`);
  if (c.catalogue) {
    out.push(`    catalogue: ${c.catalogue.url}.txt`, `    guardians: ${list(c.catalogue.guardians)}`, `    suitable for jobs: ${list(c.catalogue.suitability.jobs)}`, ...suitabilityLines(c.catalogue.suitability));
  } else out.push("    not listed in the catalogue");
  return out;
}

function versions(v: { versions: { version: string; publishedAt: string; digest: string }[] }): string[] {
  return v.versions.map((x) => `- ${x.version} (${x.publishedAt}) ${x.digest}`);
}

export function recipeText(v: RecipeVersionView, origin: string): string {
  return page(`${v.title} (${v.name}) ${v.version}`, [
    ...(v.deprecations.length > 0 ? [...warnings(v.deprecations), `Deprecation tree: ${origin}/api/recipes/${v.slug}/${v.version}/deprecations`, ""] : []),
    v.summary,
    "",
    `Category: ${v.category}`,
    `Tags: ${list(v.tags)}`,
    `Targets: ${targets(v.targets)}`,
    publisherLine(v.publisher),
    `Source: ${v.source.repository} release ${v.source.tag}`,
    `Digest: ${v.digest}`,
    `Bundle: ${v.bundle.asset} ${v.bundle.digest}`,
    `Bundle download: GET ${v.bundle.url} returns a link valid for one hour${v.status === "orphaned" ? "; with no publisher the link exists only while the release is public, otherwise the status is bundle-unavailable" : ""}`,
    `Build: an agent reads this page, asks the questions, and installs the components with aepm (https://github.com/ourapps-ae/aepm); one-command assembly (aepm create) is coming soon`,
    `Page: ${origin}/recipes/${v.slug}; JSON: ${origin}/api/recipes/${v.slug}/${v.version}`,
    ...packageLines(RECIPE_PACKAGE),
    v.diagram ? `Diagram: ${origin}/api/recipes/${v.slug}/${v.version}/diagram.svg` : "Diagram: none",
    "",
    "Description",
    v.description,
    "",
    `Questions (${v.questions.length})`,
    ...v.questions.flatMap(question),
    "",
    `Components (${v.components.length})`,
    ...v.components.flatMap(componentOfRecipe),
    "",
    ...jobLines(v),
    ...connectionLines(v),
    `Tested answer sets: default${v.tests.answerSets.length > 0 ? `, ${v.tests.answerSets.map((s) => s.id).join(", ")}` : ""}`,
    ...v.tests.answerSets.map((s) => `- ${s.id}: ${JSON.stringify(s.answers)}`),
    "",
    "Versions",
    ...versions(v),
  ]);
}

export function componentText(v: ComponentVersionView, origin: string): string {
  return page(`${v.name} ${v.version}`, [
    ...(v.deprecations.length > 0 ? [...warnings(v.deprecations), `Deprecation tree: ${origin}/api/components/${v.slug}/${v.version}/deprecations`, ""] : []),
    v.description,
    "",
    `Category: ${v.category ?? "none"}`,
    `Tags: ${list(v.tags)}`,
    `Targets: ${targets(v.targets)}`,
    publisherLine(v.publisher),
    `Guardians: ${list(v.guardians)}`,
    `Source: ${v.source.repository} release ${v.source.tag}`,
    `Digest: ${v.digest}`,
    `Bundle: ${v.bundle.asset} ${v.bundle.digest}`,
    `Bundle download: GET ${v.bundle.url} returns a link valid for one hour${v.status === "orphaned" ? "; with no publisher the link exists only while the release is public, otherwise the status is bundle-unavailable" : ""}`,
    `Page: ${origin}/components/${v.slug}; JSON: ${origin}/api/components/${v.slug}/${v.version}`,
    ...packageLines(COMPONENT_PACKAGE),
    "",
    `Provides: ${ports(v.provides)}`,
    `Requires: ${ports(v.requires)}`,
    `Depends on components: ${list(v.dependencies.map((x) => `${x.name} ${x.version}`))}`,
    "",
    `Suitable for jobs: ${list(v.suitability.jobs)}`,
    ...suitabilityLines(v.suitability),
    ...(v.suitability.notes ? [`Notes: ${v.suitability.notes}`] : []),
    "",
    v.migration ? `Data migration: stores ${list(v.migration.stores.map((s) => `${s.id} (${s.schema.name} ${s.schema.version})`))}; formats ${list(v.migration.formats)}; requires stop ${v.migration.requiresStop ? "yes" : "no"}; retention ${v.migration.retentionDays ?? "unspecified"} days` : "Data migration: this component keeps no data",
    "",
    `Used by recipes: ${list(v.usedBy.map((r) => `${r.name} ${r.version}`))}`,
    "",
    "Versions",
    ...versions(v),
  ]);
}
