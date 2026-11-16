// Plain-text pages of the recipe library and component catalogue, for agents that read without a browser.
import { COMPONENT_PACKAGE, RECIPE_PACKAGE, classSettings, deprecationLine, describeCondition, kindText, type ClassInterface, type Condition, type PackageSummary, type Deprecation, type ComponentList, ComponentSearch, ComponentSummary, ComponentVersionView, Port, RecipeList, RecipeQuestion, RecipeSearch, RecipeSlotView, RecipeSummary, RecipeVersionView, SettingDeclaration, Suitability, Targets } from "@my/store-shared";
import type { Foundations } from "@my/store-shared";

const COPYRIGHT = "Copyright Level N Ltd 2026";

const list = (items: readonly unknown[]): string => (items.length === 0 ? "none" : items.join(", "));
const targets = (t: Targets): string => `client ${list(t.client)}; server ${list(t.server)}`;
const ports = (p: Port[]): string => list(p.map((x) => `${x.id} (${x.type} ${x.version}${x.optional ? ", optional" : ""})`));
const interfaces = (p: ClassInterface[]): string => list(p.map((x) => `${x.type} ${x.version}${x.optional ? " (optional)" : ""}`));

const warnings = (deprecations: Deprecation[]): string[] => deprecations.map((d) => `DEPRECATION WARNING: ${deprecationLine(d)}`);
const packageLines = (summary: PackageSummary): string[] => ["", "What you download", summary.headline, ...summary.parts.map(([label, text]) => `- ${label}: ${text}`), summary.where, summary.check];
// The steps an agent runs to build an application from this recipe with aepm.
const buildSteps = (v: { slug: string; version: string; instructions?: string | null }): string[] => [
  "",
  "Build it (aepm, Python 3.12, Node.js, Graphviz)",
  "1. git clone https://github.com/ourapps-ae/aepm && export PYTHONPATH=$PWD/aepm",
  `2. python3 -m aepm fetch ${v.slug}@${v.version} --with-dependencies --store store   (downloads the recipe and the component it prefers for each slot, checks each sha256 digest and the signatures)`,
  `3. python3 -m aepm questions ${v.slug}@${v.version} --store store   (the questions as JSON; answer from the person's description, ask the rest)`,
  `4. write answers.json (question id to answer), then: python3 -m aepm design ${v.slug}@${v.version} --store store --answers answers.json --out definition.json`,
  `   another component of a slot's class instead of the preferred one: python3 -m aepm alternatives ${v.slug}@${v.version} SLOT --store store lists the components that fit, then python3 -m aepm design ${v.slug}@${v.version} --store store --answers answers.json --substitute SLOT=NAME@VERSION --out definition.json`,
  "5. python3 -m aepm resolve definition.json --catalogue store/catalogue.json --out lock.json",
  "6. make the owner policy: Level N's release and guardian keys from https://ourapps.app/policy/levelnpolicy.json plus your own owner key (python3 -m aepm.test_identities DIR makes a disposable one); INSTRUCTIONS.md in the recipe archive shows how",
  "7. python3 -m aepm install definition.json --lock lock.json --store store --policy policy.json --target app",
  "8. build and run: section \"Build and run\" of INSTRUCTIONS.md in the recipe archive (local: cd app/server && npm ci && npm start, then cd app/web && npm ci && npm run dev)",
];
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
    `Filter with ?category=, ?target=, ?tag=, ?provides=, ?requires= (each may repeat; a component matches every one), ?deprecated=exclude|include|only, search with ?q=. JSON: ${origin}/api/components. Recipes: ${origin}/recipes.txt`,
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
    ...v.jobs.flatMap((j) => [`- job ${j.id} fills slot ${j.slot}${j.overrideQuestion ? ` (the answer to ${j.overrideQuestion} restricts the candidates first)` : ""}: ${j.candidates.map((c) => `${c.component}${c.version ? ` ${c.version}` : ""} (${c.profile})${c.includedWhen ? ` only when ${when(c.includedWhen)}` : ""}`).join(", ")}`]),
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

// One slot: its class (interfaces and the settings the recipe writes), its preferred component, and the others of its class.
function slotLines(s: RecipeSlotView, recipe: string): string[] {
  const only = s.includedWhen ? ` (only when ${when(s.includedWhen)})` : "";
  const settings = classSettings(s.declaration.settings).map((p) => `${p.id} ${p.kind ? kindText(p.kind) : "unknown"}${p.required ? ", always written" : ""}`);
  const out = [
    `- slot ${s.id}${only}`,
    `    class: ${s.class.name} ${s.class.version} ${s.class.digest}; provides ${interfaces(s.declaration.provides)}; requires ${interfaces(s.declaration.requires)}; settings ${list(settings)}`,
    `    preferred: ${s.preferred.name} ${s.preferred.version}${s.preferred.url ? ` (${s.preferred.url}.txt)` : ", not listed in the catalogue"}`,
  ];
  if (s.deprecation) out.push(`    DEPRECATION WARNING: ${deprecationLine(s.deprecation)}`);
  if (s.catalogue) out.push(`    guardians: ${list(s.catalogue.guardians)}`, `    suitable for jobs: ${list(s.catalogue.suitability.jobs)}`, ...suitabilityLines(s.catalogue.suitability));
  out.push(`    other components of this class (${s.alternatives.count}): ${s.alternatives.url}`, `    python3 -m aepm alternatives ${recipe} ${s.id} --store store`);
  return out;
}

function settingLine(s: SettingDeclaration): string {
  const traits = [s.required ? "required" : "optional", s.hasDefault ? "has a default" : "no default", ...(s.secret ? ["secret"] : [])];
  return `- ${s.id}: ${kindText(s)}; ${traits.join(", ")}`;
}

function versions(v: { versions: { version: string; publishedAt: string; digest: string }[] }): string[] {
  return v.versions.map((x) => `- ${x.version} (${x.publishedAt}) ${x.digest}`);
}

function foundationLines(f: Foundations): string[] {
  return ["", "Package foundations (publisher-declared)", "Last successful verification: no verified record", `Wrapper licence: ${f.licence}`, `Platforms: ${f.platforms.join(", ")}`, `Runtime requirements: ${JSON.stringify(f.compatibility.runtimes)}`, `Framework requirements: ${JSON.stringify(f.compatibility.frameworks)}`, `Exact dependencies: ${JSON.stringify(f.compatibility.dependencies)}`, `Styles: ${JSON.stringify(f.compatibility.styles)}`, `Maintainers: ${f.maintenance.owners.join(", ")}; ${f.maintenance.contact}`, `Maintenance repository: ${f.maintenance.repository}`, `Updates: ${f.maintenance.updates.source} (${f.maintenance.updates.strategy})`, ...f.upstream.map(u => `Upstream: ${u.name} ${u.version}; revision ${u.revision ?? "not supplied"}; ${u.repository}; ${u.purl}; licence ${u.licence}; notices ${u.notices.join(", ")}; delivery ${JSON.stringify(u.delivery)}`), ...f.classes.flatMap(c => [`Class: ${c.reference.name} ${c.reference.version} ${c.reference.digest}`, `Shared behaviour suites: ${c.descriptor.verification.map(s => s.id).join(", ")}`, `Class modules: ${JSON.stringify(c.descriptor.provides.map(p => ({ type: p.type, modules: p.modules })))}`, `Class interface and test inventory: ${JSON.stringify(c.descriptor.inventory)}`])];
}

// One line per slot: its class, its preferred component and when it is included.
function slotLine(s: RecipeSlotView): string[] {
  const only = s.includedWhen ? `; only when ${when(s.includedWhen)}` : "";
  return [`- ${s.id}: class ${s.class.name}@${s.class.version}; preferred ${s.preferred.name}@${s.preferred.version}${only}`, ...(s.deprecation ? [`  DEPRECATION WARNING: ${deprecationLine(s.deprecation)}`] : [])];
}

// Every component the recipe names, preferred or job candidate, once.
function componentLines(v: RecipeVersionView): string[] {
  const urls = new Map<string, string | null>();
  for (const s of v.components) urls.set(`${s.preferred.name}@${s.preferred.version}`, s.preferred.url);
  for (const j of v.jobs) for (const c of j.candidates) if (c.version && !urls.has(`${c.component}@${c.version}`)) urls.set(`${c.component}@${c.version}`, null);
  return [...urls.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, url]) => `- ${id}${url ? ` ${url}.txt` : ""}`);
}

const detailsAddress = (v: RecipeVersionView, origin: string): string => `${origin}/recipes/${v.slug}/details.txt?version=${v.version}`;

// The recipe page an agent reads first: what it is, how to build it, the questions, the slots and the components.
// The bulky parts are on the details page (recipeDetailsText).
export function recipeText(v: RecipeVersionView, origin: string): string {
  const components = componentLines(v);
  return page(`${v.title} (${v.name}) ${v.version}`, [
    ...(v.deprecations.length > 0 ? [...warnings(v.deprecations), `Deprecation tree: ${origin}/api/recipes/${v.slug}/${v.version}/deprecations`, ""] : []),
    v.summary,
    "",
    `Targets: ${targets(v.targets)}`,
    `Category: ${v.category}; tags ${list(v.tags)}`,
    publisherLine(v.publisher),
    `Source: ${v.source.repository} release ${v.source.tag}; digest ${v.digest}`,
    `Bundle download: GET ${v.bundle.url} returns a link valid for one hour${v.status === "orphaned" ? "; with no publisher the link exists only while the release is public, otherwise the status is bundle-unavailable" : ""}`,
    ...buildSteps(v),
    "",
    `Questions (${v.questions.length})`,
    ...v.questions.flatMap(question),
    "",
    `Slots (${v.components.length}): each needs a component of its class; the preferred component fills it unless another component that fits the class is substituted (python3 -m aepm alternatives ${v.slug}@${v.version} SLOT --store store)`,
    ...v.components.flatMap(slotLine),
    "",
    ...jobLines(v),
    `Tested answer sets: default${v.tests.answerSets.length > 0 ? `, ${v.tests.answerSets.map((s) => s.id).join(", ")}` : ""}`,
    "",
    `Components (${components.length})`,
    ...components,
    "",
    "Links",
    `Details (description, slot classes and suitability, connections, tested answers, package foundations and upstream sources, versions): ${detailsAddress(v, origin)}`,
    `Page: ${origin}/recipes/${v.slug}; JSON: ${origin}/api/recipes/${v.slug}/${v.version}`,
    ...(v.diagram ? [`Diagram: ${origin}/api/recipes/${v.slug}/${v.version}/diagram.svg`] : []),
    `Components diagram: ${origin}/api/recipes/${v.slug}/${v.version}/components.svg`,
  ]);
}

// The rest of a recipe: what the summary page leaves out.
export function recipeDetailsText(v: RecipeVersionView, origin: string): string {
  return page(`${v.title} (${v.name}) ${v.version}: details`, [
    `The recipe page, with the build steps, questions, slots and components: ${origin}/recipes/${v.slug}.txt?version=${v.version}`,
    `Digest: ${v.digest}`,
    `Bundle: ${v.bundle.asset} ${v.bundle.digest}`,
    ...packageLines(RECIPE_PACKAGE),
    "",
    "Description",
    v.description,
    "",
    `Slot details (${v.components.length})`,
    ...v.components.flatMap((s) => slotLines(s, `${v.slug}@${v.version}`)),
    "",
    ...connectionLines(v),
    `Tested answer sets: default${v.tests.answerSets.length > 0 ? `, ${v.tests.answerSets.map((s) => s.id).join(", ")}` : ""}`,
    ...v.tests.answerSets.map((s) => `- ${s.id}: ${JSON.stringify(s.answers)}`),
    "",
    "Versions",
    ...versions(v),
    ...foundationLines(v.foundations),
  ]);
}

const requirementLines = (f: Foundations): string[] => {
  const runtimes = Object.entries(f.compatibility.runtimes).map(([k, r]) => `${k} ${r}`);
  const frameworks = Object.entries(f.compatibility.frameworks).map(([k, x]) => `${k}: ${x.name} ${x.range}`);
  const styles = f.compatibility.styles;
  return [
    `Platforms: ${list(f.platforms)}`,
    `Toolchains: ${list(runtimes)}`,
    `Frameworks: ${list(frameworks)}`,
    `Styles: scope ${styles.scope}; ${styles.namespaces.length} namespaces; ${styles.conflicts.length} conflicts`,
    `Licence: ${f.licence}; ${f.upstream.length} upstream sources, ${f.compatibility.dependencies.length} exact dependencies, ${f.files.length} files (listed on the details page)`,
  ];
};

// The classes the component implements, with the entry modules each provided interface declares per platform.
function classLines(f: Foundations): string[] {
  return f.classes.flatMap((c) => [
    `Implements: ${c.reference.name}@${c.reference.version} ${c.reference.digest}`,
    ...c.descriptor.provides.map((p) => `  ${p.type} ${p.version} entry modules: ${list(Object.entries(p.modules).map(([platform, m]) => `${platform} ${m.join(" ")}`))}`),
    `  shared behaviour suites: ${list(c.descriptor.verification.map((x) => x.id))}`,
  ]);
}

// The recipe.json slot that names this component, and the aepm commands that use it in another slot of its class.
function recipeUseLines(v: ComponentVersionView): string[] {
  const c = v.foundations.implements[0];
  if (!c) return ["How to use in a recipe: this component implements no class, so no slot can name it"];
  const slot = { id: v.slug, class: { name: c.name, version: c.version, digest: c.digest }, preferred: { name: v.name, version: v.version } };
  return [
    "How to use in a recipe",
    `- as a slot in recipe.json components: ${JSON.stringify(slot)}`,
    `- in place of another component of the class: python3 -m aepm fetch ${v.name}@${v.version} --store store --from https://ourapps.app, then python3 -m aepm design RECIPE@VERSION --store store --answers answers.json --substitute SLOT=${v.name}@${v.version} --out definition.json`,
  ];
}

// The component page an agent reads first. Upstream sources, dependency pins, file inventories and the package
// explanation are on the details page (componentDetailsText).
export function componentText(v: ComponentVersionView, origin: string): string {
  const f = v.foundations;
  return page(`${v.name} ${v.version}`, [
    ...(v.deprecations.length > 0 ? [...warnings(v.deprecations), `Deprecation tree: ${origin}/api/components/${v.slug}/${v.version}/deprecations`, ""] : []),
    v.description,
    "",
    `Category: ${v.category ?? "none"}; tags ${list(v.tags)}`,
    `Targets: ${targets(v.targets)}`,
    publisherLine(v.publisher),
    `Guardians: ${list(v.guardians)}`,
    `Source: ${v.source.repository} release ${v.source.tag}; digest ${v.digest}`,
    `Bundle download: GET ${v.bundle.url} returns a link valid for one hour${v.status === "orphaned" ? "; with no publisher the link exists only while the release is public, otherwise the status is bundle-unavailable" : ""}`,
    "",
    ...classLines(f),
    `Provides: ${ports(v.provides)}`,
    `Requires: ${ports(v.requires)}`,
    ...requirementLines(f),
    "",
    `Settings (${v.settings.length})`,
    ...v.settings.map(settingLine),
    `Depends on components: ${list(v.dependencies.map((x) => `${x.name} ${x.version}`))}`,
    "",
    `Suitable for jobs: ${list(v.suitability.jobs)}`,
    ...suitabilityLines(v.suitability),
    ...(v.suitability.notes ? [`Notes: ${v.suitability.notes}`] : []),
    v.migration ? `Data migration: stores ${list(v.migration.stores.map((s) => `${s.id} (${s.schema.name} ${s.schema.version})`))}; formats ${list(v.migration.formats)}; requires stop ${v.migration.requiresStop ? "yes" : "no"}; retention ${v.migration.retentionDays ?? "unspecified"} days` : "Data migration: this component keeps no data",
    "",
    ...recipeUseLines(v),
    `Used by recipes: ${list(v.usedBy.map((r) => `${r.name} ${r.version} (${r.slots.map((s) => `slot ${s.id}${s.preferred ? "" : " as a job candidate"}`).join(", ")})`))}`,
    `Maintainers: ${f.maintenance.owners.join(", ")}; ${f.maintenance.contact}; updates ${f.maintenance.updates.source} (${f.maintenance.updates.strategy})`,
    "",
    "Versions",
    ...versions(v),
    "",
    "Links",
    `Details (package foundations, upstream sources, exact dependencies, styles, class inventories, files): ${origin}/components/${v.slug}/details.txt?version=${v.version}`,
    `Page: ${origin}/components/${v.slug}; JSON: ${origin}/api/components/${v.slug}/${v.version}; connections diagram: ${origin}/api/components/${v.slug}/${v.version}/connections.svg`,
  ]);
}

// The rest of a component: what the summary page leaves out.
export function componentDetailsText(v: ComponentVersionView, origin: string): string {
  return page(`${v.name} ${v.version}: details`, [
    `The component page, with its class, interfaces, settings and how to use it in a recipe: ${origin}/components/${v.slug}.txt?version=${v.version}`,
    `Digest: ${v.digest}`,
    `Bundle: ${v.bundle.asset} ${v.bundle.digest}`,
    ...packageLines(COMPONENT_PACKAGE),
    ...foundationLines(v.foundations),
    "",
    `Files (${v.foundations.files.length})`,
    ...v.foundations.files.map((x) => `- ${x.path}${x.executable ? " (executable)" : ""}`),
    "",
    `Installed as (${v.foundations.artefacts.length})`,
    ...v.foundations.artefacts.map((a) => `- ${a.source} -> ${a.destination}${a.template ? " (template)" : ""}${a.executable ? " (executable)" : ""}`),
  ]);
}
