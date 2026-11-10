// The recipe library and the component catalogue: browse, search, and read one entry.
import { COMPONENT_PACKAGE, RECIPE_PACKAGE, describeCondition, type BundleLink, type PackageSummary, type ComponentList, type ComponentSearch, type ComponentSummary, type ComponentVersionView, type Deprecation, type EntryStatus, type Profile, type RecipeList, type RecipeSearch, type RecipeSummary, type RecipeVersionView } from "@my/store-shared";
import { ApiError, api, whoAmI } from "../api.js";
import { html, mount, raw, type Raw } from "../html.js";
import { svgFigure } from "../figures.js";
import { renderMarkdown } from "../markdown.js";
import { CLIENT_TARGET_LABEL, answerText, costLabel, deprecationAdvice, deprecationSentence, includedWhenText, loadText, queryString, readQuery, releaseUrl, statusLabel, targetLabel, versionFromSearch, withFilter, type LibraryQuery } from "../library.js";
import { navigate } from "../nav.js";
import { setTheme } from "../theme.js";
import { callout, copyRow, emptyState, errorBox, fmtDate, icon, toast, wireCopy } from "../ui.js";
import { notFound, storeFrame } from "./public.js";
import { mountShell } from "./shell.js";
import { termsPending } from "./terms.js";

type Kind = "recipes" | "components";

const PAGE_SIZE = 24;
const none = html``;
const FOOTNOTE = "The recipe library and component catalogue are public. Share links stay private. No tracking.";

function variants(path: string, version?: string): Raw {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
  return html`<span class="small faint">Also as <a href="${path}.txt${suffix}">plain text</a> and <a href="${path}.json${suffix}">JSON</a>.</span>`;
}

function targetPills(targets: { client: string[]; server: string[] }): Raw {
  const all = [...targets.client, ...targets.server];
  return all.length === 0 ? html`<span class="small faint">No targets stated</span>` : html`<span class="row wrap" style="gap:6px">${all.map((t) => html`<span class="pill">${targetLabel(t)}</span>`)}</span>`;
}

function tagPills(tags: string[], kind: Kind): Raw {
  return tags.length === 0 ? none : html`<span class="row wrap" style="gap:6px">${tags.map((t) => html`<a class="pill" href="/${kind}?tag=${encodeURIComponent(t)}">${t}</a>`)}</span>`;
}

function publisherText(p: { displayName: string } | null): string {
  return p ? `By ${p.displayName}` : "Publisher's account deleted";
}

function statusPill(status: EntryStatus, deprecations: Deprecation[]): Raw {
  if (status === "orphaned") return html`<span class="pill bad">Orphaned</span>`;
  if (status === "deprecated") return html`<span class="pill warn">Deprecated</span>`;
  return deprecations.length > 0 ? html`<span class="pill warn">Uses deprecated parts</span>` : none;
}

// Banner at the top of a page: the entry's own flag, then every flagged part under it.
export function deprecationBanner(v: { name: string; version: string; status: EntryStatus; deprecations: Deprecation[] }, kind: Kind): Raw {
  if (v.deprecations.length === 0) return none;
  const own = v.deprecations.find((d) => d.name === v.name);
  const parts = v.deprecations.filter((d) => d !== own);
  const replacement = (d: Deprecation) => {
    if (!d.replacement) return none;
    const slug = d.replacement.split("/")[1];
    return html` Replacement: <a href="/${d.name === v.name ? kind : "components"}/${slug}">${d.replacement}</a>.`;
  };
  return html`
    <div class="mt" role="alert">
      ${callout(
        v.status === "orphaned" ? "bad" : "warn",
        html`
          ${own ? html`<p><b>${statusLabel(v.status)}.</b> ${deprecationSentence(own, v.name)}${replacement(own)} ${deprecationAdvice(v.status)}</p>` : none}
          ${parts.length > 0 ? html`<p><b>${kind === "recipes" ? "This recipe uses" : "This component builds on"} deprecated or orphaned components.</b> ${deprecationAdvice(parts.some((d) => d.status === "orphaned") ? "orphaned" : "deprecated")}</p><ul class="bullets">${parts.map((d) => html`<li>${deprecationSentence(d, v.name)}${replacement(d)}</li>`)}</ul>` : none}
          <p class="small">Machine-readable: <a href="/api/${kind}/${encodeURIComponent(v.name.split("/")[1])}/${v.version}/deprecations">deprecations</a>.</p>
        `,
      )}
    </div>
  `;
}

function deprecatedRow(kind: Kind, query: LibraryQuery): Raw {
  const options = [{ value: "exclude" as const, label: "Hide deprecated" }, { value: "only" as const, label: "Only deprecated" }];
  return html`
    <div class="row wrap" style="gap:6px;margin-top:10px">
      <span class="small muted" style="min-width:76px">Status</span>
      ${options.map((o) => html`<a class="pill ${query.deprecated === o.value ? "accent" : ""}" href="/${kind}${queryString(withFilter(query, "deprecated", o.value))}" aria-current="${query.deprecated === o.value ? "true" : "false"}">${o.label}</a>`)}
    </div>
  `;
}

function searchBox(kind: Kind, query: LibraryQuery): Raw {
  const label = kind === "recipes" ? "Search recipes by what the application does" : "Search components by what they do or the interfaces they offer";
  return html`
    <form class="row" id="library-search" role="search" style="gap:8px">
      <input type="search" name="q" value="${query.q ?? ""}" placeholder="${label}" aria-label="${label}" maxlength="200" />
      <button class="btn" type="submit">Search</button>
    </form>
  `;
}

function filterRow(kind: Kind, query: LibraryQuery, key: "category" | "target", title: string, options: { value: string; label: string; count?: number }[]): Raw {
  if (options.length === 0) return none;
  return html`
    <div class="row wrap" style="gap:6px;margin-top:10px">
      <span class="small muted" style="min-width:76px">${title}</span>
      ${options.map((o) => html`<a class="pill ${query[key] === o.value ? "accent" : ""}" href="/${kind}${queryString(withFilter(query, key, o.value))}" aria-current="${query[key] === o.value ? "true" : "false"}">${o.label}${o.count === undefined ? "" : ` (${o.count})`}</a>`)}
    </div>
  `;
}

function activeFilters(kind: Kind, query: LibraryQuery): Raw {
  const keys = ["category", "target", "tag", "provides", "requires", "deprecated"] as const;
  const active = keys.filter((k) => query[k]);
  if (active.length === 0) return none;
  return html`<p class="small muted mt-s">Showing ${active.map((k) => html`<a class="pill accent" href="/${kind}${queryString(withFilter(query, k, undefined))}">${k} ${query[k]} &times;</a> `)}</p>`;
}

function pager(kind: Kind, query: LibraryQuery, total: number, shown: number): Raw {
  const offset = query.offset ?? 0;
  if (total <= PAGE_SIZE) return none;
  const prev = offset > 0 ? html`<a class="btn secondary sm" href="/${kind}${queryString({ ...query, offset: Math.max(0, offset - PAGE_SIZE) })}">Previous</a>` : "";
  const next = offset + shown < total ? html`<a class="btn secondary sm" href="/${kind}${queryString({ ...query, offset: offset + PAGE_SIZE })}">Next</a>` : "";
  return html`<div class="row mt" style="justify-content:space-between"><span>${prev}</span><span class="small muted">${offset + 1} to ${offset + shown} of ${total}</span><span>${next}</span></div>`;
}

export function recipeCard(r: RecipeSummary): Raw {
  return html`
    <div class="card">
      <div class="row wrap top" style="justify-content:space-between">
        <div class="grow">
          <h3 style="margin:0"><a href="/recipes/${r.slug}">${r.title}</a></h3>
          <p class="muted" style="margin:4px 0 8px">${r.summary}</p>
        </div>
        <span class="pill">${r.version}</span>
      </div>
      <div class="row wrap" style="gap:8px">${statusPill(r.status, r.deprecations)}<a class="pill accent" href="/recipes?category=${encodeURIComponent(r.category)}">${r.category}</a>${targetPills(r.targets)}</div>
      <p class="small faint mt-s">${publisherText(r.publisher)}</p>
    </div>
  `;
}

export function componentCard(c: ComponentSummary): Raw {
  const ports = (list: { id: string; type: string; optional?: boolean }[]) => (list.length === 0 ? "none" : list.map((p) => (p.optional ? `${p.id} (optional)` : p.id)).join(", "));
  return html`
    <div class="card">
      <div class="row wrap top" style="justify-content:space-between">
        <div class="grow">
          <h3 style="margin:0"><a href="/components/${c.slug}">${c.name}</a></h3>
          <p class="muted" style="margin:4px 0 8px">${c.description}</p>
        </div>
        <span class="pill">${c.version}</span>
      </div>
      <p class="small muted" style="margin:0 0 8px">Provides ${ports(c.provides)}. Requires ${ports(c.requires)}.</p>
      <div class="row wrap" style="gap:8px">${statusPill(c.status, c.deprecations)}${c.category ? html`<a class="pill accent" href="/components?category=${encodeURIComponent(c.category)}">${c.category}</a>` : ""}${targetPills(c.targets)}</div>
      <p class="small faint mt-s">${publisherText(c.publisher)}</p>
    </div>
  `;
}

function wireSearch(root: HTMLElement, kind: Kind, query: LibraryQuery): void {
  root.querySelector<HTMLFormElement>("#library-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = root.querySelector<HTMLInputElement>("#library-search input")!.value.trim();
    navigate(`/${kind}${queryString({ ...query, q: q || undefined, offset: undefined })}`);
  });
}

// Signed-in developers see the library inside the console frame (sidebar kept); everyone else gets the public store frame.
function showInFrame(root: HTMLElement, me: Awaited<ReturnType<typeof whoAmI>>, title: string, body: Raw, opts: { sub?: string; bare?: boolean } = {}, publicBody: Raw = body): void {
  if (me && !termsPending(me)) mountShell(root, me, title, body, opts);
  else mount(root, storeFrame(publicBody, { me, footnote: FOOTNOTE }));
}

function listFrame(root: HTMLElement, kind: Kind, query: LibraryQuery, filters: Raw, body: Raw, me: Awaited<ReturnType<typeof whoAmI>>): void {
  const recipes = kind === "recipes";
  const title = recipes ? "Recipes: applications you can build from questions" : "Components: the reviewed parts recipes are made from";
  const lead = recipes ? "A recipe asks a few questions, then an agent assembles the application from reviewed components for the devices you choose. Browse by category and device, or search by what an application does." : "Each component is a reviewed part with a contract: the interfaces it provides and requires, who it suits, and how its data moves. Recipes name the components they use.";
  const controls = html`
        ${searchBox(kind, query)}
        ${filters}
        ${activeFilters(kind, query)}
        <p class="mt-s">${variants(`/${kind}`)} ${recipes ? html`<a class="small" href="/components">Components</a>` : html`<a class="small" href="/recipes">Recipes</a>`}</p>`;
  const publicBody = html`
      <section style="padding:26px 0 6px">
        <span class="pill accent">${recipes ? "Recipe library" : "Component catalogue"}</span>
        <h1 style="margin-top:10px">${title}</h1>
        <p class="lead muted">${lead}</p>
        ${controls}
      </section>
      ${body}
    `;
  showInFrame(root, me, recipes ? "Recipes" : "Components", html`<section style="padding:0 0 6px">${controls}</section>${body}`, { sub: lead }, publicBody);
}

export async function recipesPage(root: HTMLElement): Promise<void> {
  setTheme("store", "Recipes on ourapps", true);
  const query = readQuery(location.search);
  const me = await whoAmI();
  try {
    const searching = Boolean(query.q);
    const filterParams = queryString({ ...query, q: undefined, offset: undefined }).slice(1);
    const [list, found] = await Promise.all([
      api<RecipeList>("GET", `/api/recipes?${filterParams}${filterParams ? "&" : ""}limit=${PAGE_SIZE}&offset=${query.offset ?? 0}`),
      searching ? api<RecipeSearch>("GET", `/api/recipes/search?q=${encodeURIComponent(query.q!)}${query.deprecated ? `&deprecated=${query.deprecated}` : ""}`) : Promise.resolve(null),
    ]);
    const shown = found ? found.recipes.filter((r) => matches(r, query)) : list.recipes;
    const targetOptions = Object.entries(CLIENT_TARGET_LABEL).map(([value, label]) => ({ value, label }));
    const filters = html`${filterRow("recipes", query, "category", "Category", list.categories.map((c) => ({ value: c.category, label: c.category, count: c.count })))}${filterRow("recipes", query, "target", "Device", targetOptions)}${deprecatedRow("recipes", query)}`;
    const body = shown.length === 0
      ? emptyState("apps", searching ? "No recipes match" : "No recipes yet", searching ? "Try fewer words, or browse by category and device." : "Recipes appear here when developers publish them. An example looks like Poker Night, a card game for a club's league night.")
      : html`<div class="grid-2">${shown.map(recipeCard)}</div>${found ? "" : pager("recipes", query, list.total, shown.length)}`;
    listFrame(root, "recipes", query, filters, body, me);
    wireSearch(root, "recipes", query);
  } catch (err) {
    listFrame(root, "recipes", query, none, errorBox(err), me);
    wireSearch(root, "recipes", query);
  }
}

// Search ranks by text only; the page's filters narrow its results.
function matches(r: RecipeSummary, q: LibraryQuery): boolean {
  return (!q.category || r.category === q.category) && (!q.target || [...r.targets.client, ...r.targets.server].includes(q.target)) && (!q.tag || r.tags.includes(q.tag));
}

function componentMatches(c: ComponentSummary, q: LibraryQuery): boolean {
  return (
    (!q.category || c.category === q.category) &&
    (!q.target || [...c.targets.client, ...c.targets.server].includes(q.target)) &&
    (!q.tag || c.tags.includes(q.tag)) &&
    (!q.provides || c.provides.some((p) => p.type === q.provides || p.id === q.provides)) &&
    (!q.requires || c.requires.some((p) => p.type === q.requires || p.id === q.requires))
  );
}

export async function componentsPage(root: HTMLElement): Promise<void> {
  setTheme("store", "Components on ourapps", true);
  const query = readQuery(location.search);
  const me = await whoAmI();
  try {
    const searching = Boolean(query.q);
    const filterParams = queryString({ ...query, q: undefined, offset: undefined }).slice(1);
    const [list, found] = await Promise.all([
      api<ComponentList>("GET", `/api/components?${filterParams}${filterParams ? "&" : ""}limit=${PAGE_SIZE}&offset=${query.offset ?? 0}`),
      searching ? api<ComponentSearch>("GET", `/api/components/search?q=${encodeURIComponent(query.q!)}${query.deprecated ? `&deprecated=${query.deprecated}` : ""}`) : Promise.resolve(null),
    ]);
    const shown = found ? found.components.filter((c) => componentMatches(c, query)) : list.components;
    const targetOptions = Object.entries(CLIENT_TARGET_LABEL).map(([value, label]) => ({ value, label }));
    const filters = html`${filterRow("components", query, "category", "Category", list.categories.map((c) => ({ value: c.category, label: c.category, count: c.count })))}${filterRow("components", query, "target", "Device", targetOptions)}${deprecatedRow("components", query)}`;
    const body = shown.length === 0
      ? emptyState("apps", searching ? "No components match" : "No components yet", searching ? "Try fewer words, or browse by category and device." : "Components appear here when developers publish them.")
      : html`<div class="grid-2">${shown.map(componentCard)}</div>${found ? "" : pager("components", query, list.total, shown.length)}`;
    listFrame(root, "components", query, filters, body, me);
    wireSearch(root, "components", query);
  } catch (err) {
    listFrame(root, "components", query, none, errorBox(err), me);
    wireSearch(root, "components", query);
  }
}

function versionList(kind: Kind, slug: string, current: string, versions: { version: string; publishedAt: string; digest: string }[]): Raw {
  return html`
    <table class="table">
      <tr><th>Version</th><th>Published</th><th>Digest</th></tr>
      ${versions.map((v) => html`<tr><td>${v.version === current ? html`<b>${v.version}</b>` : html`<a href="/${kind}/${slug}?version=${v.version}">${v.version}</a>`}</td><td>${fmtDate(v.publishedAt)}</td><td><code class="small">${v.digest.slice(0, 19)}</code></td></tr>`)}
    </table>
  `;
}

function profileRows(profiles: Profile[]): Raw {
  return html`
    ${profiles.map(
      (p) => html`<tr>
        <td><b>${p.id}</b>${p.provider ? html`<br /><span class="small muted">${p.provider.name}, ${p.provider.tier}</span>` : ""}</td>
        <td>${costLabel(p.cost)}</td>
        <td>${loadText(p.load)}</td>
        <td>${p.regions.join(", ")}${p.compliance.length > 0 ? html`<br /><span class="small muted">${p.compliance.join(", ")}</span>` : ""}</td>
      </tr>`,
    )}
  `;
}

function suitabilityTable(profiles: Profile[]): Raw {
  return html`<table class="table"><tr><th>Profile</th><th>Cost</th><th>Load it carries</th><th>Regions and compliance</th></tr>${profileRows(profiles)}</table>`;
}

function wireBundle(root: HTMLElement, url: string): void {
  const button = root.querySelector<HTMLButtonElement>("#bundle-link");
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const link = await api<BundleLink>("GET", new URL(url).pathname);
      if (link.url === null) toast("This bundle cannot be downloaded: its publisher deleted their account and the release is not public.");
      else location.assign(link.url);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      button.disabled = false;
    }
  };
}

// What a download is, at a glance: the same words appear in the plain-text pages and the documents.
export function packageCard(summary: PackageSummary, v: { bundle: { asset: string }; digest: string; source: { repository: string; tag: string } }): Raw {
  return html`
          <div class="card mt" id="what-you-download">
            <h2>What you download</h2>
            <p><b>${summary.headline}</b></p>
            <table class="table small mt-s">
              <tr><td>File</td><td><code>${v.bundle.asset}</code>, an archive of files, from <a href="${releaseUrl(v.source.repository, v.source.tag)}" target="_blank" rel="noopener">the ${v.source.tag} release of ${v.source.repository}</a></td></tr>
              ${summary.parts.map(([label, text]) => html`<tr><td>${label}</td><td>${text}</td></tr>`)}
            </table>
            <p class="small muted mt-s">${summary.where}</p>
            <p class="small muted">${summary.check} Digest <code>${v.digest}</code></p>
          </div>
  `;
}

export function recipeBody(v: RecipeVersionView, requested: string): Raw {
  return html`
        <article style="max-width:900px;margin:0 auto">
          <p class="small"><a href="/recipes">All recipes</a></p>
          <div class="row wrap top" style="justify-content:space-between">
            <div class="grow">
              <span class="pill accent">${v.category}</span> <span class="pill">${v.version}</span>
              <h1 style="margin-top:10px">${v.title}</h1>
              <p class="lead muted">${v.summary}</p>
            </div>
          </div>
          ${deprecationBanner(v, "recipes")}
          <div class="row wrap" style="gap:8px">${targetPills(v.targets)}${tagPills(v.tags, "recipes")}</div>
          <p class="small muted mt-s">${publisherText(v.publisher)}. Source <a href="${releaseUrl(v.source.repository, v.source.tag)}" target="_blank" rel="noopener">${v.source.repository} ${v.source.tag}</a>.</p>

          ${packageCard(RECIPE_PACKAGE, v)}

          <div class="card mt">
            <h2>Build it</h2>
            <p class="muted">Give your coding agent this line. It asks the questions below, shows you the components it will install, and installs them with aepm. One-command assembly (<code>aepm create</code>) is coming soon. <a href="/dev/agents#recipes-and-components">Tools and instructions for agents</a>.</p>
            ${copyRow(`Build an application from the ${v.title} recipe: https://ourapps.app/recipes/${v.slug}.txt`)}
            <div class="row wrap mt-s"><button class="btn secondary sm" id="bundle-link" type="button">${icon("external")} Download the archive</button><span class="small faint">The link is valid for one hour. Digest ${v.bundle.digest.slice(0, 19)}</span></div>
          </div>

          <div class="card mt">
            <h2>About</h2>
            <div class="markdown">${raw(renderMarkdown(v.description))}</div>
            ${v.screenshots.length > 0 ? html`<h3 class="mt">Screenshots</h3><div class="row wrap" style="gap:10px;align-items:flex-start">${v.screenshots.map((s) => html`<img src="${s}" alt="" loading="lazy" style="max-height:320px;border-radius:12px;border:1px solid var(--line)" />`)}</div>` : ""}
          </div>

          <div class="card mt" id="how-components-connect">
            <h2>How its components connect</h2>
            <p class="muted small">Drawn by ourapps from the recipe and the catalogue: each component in a zone by category, each line an interface from the component that provides it to the one that requires it.</p>
            ${svgFigure(`/api/recipes/${v.slug}/${v.version}/components.svg`, `Diagram of the ${v.components.length} components of ${v.title}, grouped by category, with ${v.connections.length} lines from each component that provides an interface to each component that requires it.`)}
            ${v.diagram ? html`<h3 class="mt">Publisher's diagram</h3>${svgFigure(v.diagram, `The publisher's design diagram of ${v.title}`)}` : ""}
          </div>

          <div class="card mt">
            <h2>Questions it asks (${v.questions.length})</h2>
            ${v.questions.length === 0 ? html`<p class="muted">This recipe asks no questions.</p>` : html`
              <table class="table">
                <tr><th>Question</th><th>Answer</th><th>Default</th></tr>
                ${v.questions.map((q) => html`<tr><td>${q.ask}<br /><code class="small">${q.id}</code></td><td>${q.type}${q.options ? html`<br /><span class="small muted">${q.options.join(", ")}</span>` : ""}${q.askWhen ? html`<br /><span class="small muted">asked when ${describeCondition(q.askWhen, answerText)}</span>` : ""}</td><td>${q.type === "secretRef" ? "a reference, never a value" : answerText(q.default)}</td></tr>`)}
              </table>`}
          </div>

          <div class="card mt">
            <h2>Components (${v.components.length})</h2>
            <p class="muted small">Each is checked at build time for the author and guardian signatures the owner trusts.</p>
            <table class="table">
              <tr><th>Part</th><th>Included</th><th>Suitability and guardians</th></tr>
              ${v.components.map(
                (c) => html`<tr>
                  <td>${c.catalogue ? html`<a href="${new URL(c.catalogue.url).pathname}">${c.name}</a>` : c.name}${c.deprecation ? html` ${statusPill(c.deprecation.status, [c.deprecation])}` : none}<br /><span class="small muted">${c.version}, as <code>${c.id}</code></span>${c.catalogue ? html`<br /><span class="small muted">${c.catalogue.description}</span>` : ""}</td>
                  <td>${includedWhenText(c)}</td>
                  <td>${c.catalogue ? html`${c.catalogue.suitability.profiles.map((p) => html`<div class="small"><b>${p.id}</b>: ${costLabel(p.cost)}, ${loadText(p.load)}</div>`)}<div class="small muted mt-s">Guardians: ${c.catalogue.guardians.length > 0 ? c.catalogue.guardians.join(", ") : "none recorded"}</div>` : html`<span class="small muted">Not in the catalogue</span>`}</td>
                </tr>`,
              )}
            </table>
          </div>

          ${v.jobs.length > 0 || v.scale ? html`
            <div class="card mt">
              <h2>Choosing by suitability</h2>
              ${v.scale ? html`<p class="muted">The <code>${v.scale.question}</code> question sets the load the application must carry.</p><ul class="bullets">${v.scale.bands.map((b) => html`<li><b>${b.id}</b>: ${b.label} (${loadText(b.load)})</li>`)}</ul>` : ""}
              ${v.jobs.map((j) => html`<p><b>${j.id}</b>: ${j.candidates.map((c) => `${c.component} (${c.profile})${c.includedWhen ? ` when ${describeCondition(c.includedWhen, answerText)}` : ""}`).join(", ")}${j.overrideQuestion ? html`<br /><span class="small muted">The answer to <code>${j.overrideQuestion}</code> restricts the candidates first.</span>` : ""}</p>`)}
            </div>` : ""}

          <div class="card mt">
            <h2>Targets</h2>
            <p><b>Client</b> ${v.targets.client.length === 0 ? "none" : v.targets.client.map(targetLabel).join(", ")}</p>
            <p><b>Server</b> ${v.targets.server.length === 0 ? "none" : v.targets.server.map(targetLabel).join(", ")}</p>
          </div>

          <div class="card mt">
            <h2>Tested answer sets</h2>
            <p class="muted">Every combination of answers cannot be tested. These were: the defaults${v.tests.answerSets.length > 0 ? " and" : "."}</p>
            ${v.tests.answerSets.length === 0 ? "" : html`<ul class="bullets">${v.tests.answerSets.map((s) => html`<li><b>${s.id}</b>: ${Object.keys(s.answers).length === 0 ? "defaults" : Object.entries(s.answers).map(([k, a]) => `${k} ${answerText(a)}`).join("; ")}</li>`)}</ul>`}
          </div>

          <div class="card mt">
            <h2>Versions</h2>
            ${versionList("recipes", v.slug, v.version, v.versions)}
          </div>
          <p class="mt">${variants(`/recipes/${v.slug}`, requested === "latest" ? undefined : v.version)}</p>
        </article>
  `;
}

export async function recipePage(root: HTMLElement, slug: string): Promise<void> {
  setTheme("store", "Recipe on ourapps", true);
  const me = await whoAmI();
  const requested = versionFromSearch(location.search);
  let v: RecipeVersionView;
  try {
    v = await api<RecipeVersionView>("GET", `/api/recipes/${encodeURIComponent(slug)}/${requested}`);
  } catch (err) {
    return notFound(root, err instanceof ApiError && err.status === 404 ? "No such recipe or version." : String(err));
  }
  setTheme("store", `${v.title}: a recipe on ourapps`, true);
  showInFrame(root, me, v.title, recipeBody(v, requested), { bare: true });
  wireCopy(root);
  wireBundle(root, v.bundle.url);
}

export function componentBody(v: ComponentVersionView, requested: string): Raw {
  const ports = (list: { id: string; type: string; version: string; optional?: boolean }[], key: "provides" | "requires") =>
    list.length === 0
      ? html`<p class="muted">None.</p>`
      : html`<table class="table"><tr><th>Id</th><th>Type</th></tr>${list.map((p) => html`<tr><td><code>${p.id}</code>${p.optional ? html` <span class="small muted">optional</span>` : ""}</td><td><a href="/components?${key === "provides" ? "requires" : "provides"}=${encodeURIComponent(p.type)}">${p.type}</a> ${p.version}</td></tr>`)}</table>`;
  return html`
        <article style="max-width:900px;margin:0 auto">
          <p class="small"><a href="/components">All components</a></p>
          <div>
            ${v.category ? html`<span class="pill accent">${v.category}</span>` : ""} <span class="pill">${v.version}</span>
            <h1 style="margin-top:10px">${v.name}</h1>
            <p class="lead muted">${v.description}</p>
          </div>
          ${deprecationBanner(v, "components")}
          <div class="row wrap" style="gap:8px">${targetPills(v.targets)}${tagPills(v.tags, "components")}</div>
          <p class="small muted mt-s">${publisherText(v.publisher)}. Source <a href="${releaseUrl(v.source.repository, v.source.tag)}" target="_blank" rel="noopener">${v.source.repository} ${v.source.tag}</a>.</p>

          ${packageCard(COMPONENT_PACKAGE, v)}

          <div class="card mt">
            <h2>Reviewed by</h2>
            <p>${v.guardians.length === 0 ? "No guardian is recorded for this version." : v.guardians.join(", ")}</p>
            <div class="row wrap"><button class="btn secondary sm" id="bundle-link" type="button">${icon("external")} Download the archive</button><span class="small faint">The link is valid for one hour.</span></div>
          </div>

          <div class="grid-2 mt">
            <div class="card"><h2>Provides</h2>${ports(v.provides, "provides")}</div>
            <div class="card"><h2>Requires</h2>${ports(v.requires, "requires")}</div>
          </div>

          <div class="card mt" id="what-it-connects-to">
            <h2>What it connects to</h2>
            <p class="muted small">Left: the catalogue components that provide what it requires. Right: the catalogue components that require what it provides.</p>
            ${svgFigure(`/api/components/${v.slug}/${v.version}/connections.svg`, `Diagram of ${v.name} ${v.version}: on the left the ${v.requires.length} interfaces it requires and the catalogue components that provide them, on the right the ${v.provides.length} interfaces it provides and the catalogue components that require them.`)}
          </div>

          ${v.dependencies.length > 0 ? html`<div class="card mt"><h2>Builds on</h2><ul class="bullets">${v.dependencies.map((d) => html`<li><a href="/components/${d.name.split("/")[1]}">${d.name}</a> ${d.version}</li>`)}</ul></div>` : none}

          <div class="card mt">
            <h2>Who it is for</h2>
            <p class="muted">Jobs a recipe can choose it for: ${v.suitability.jobs.join(", ")}.</p>
            ${suitabilityTable(v.suitability.profiles)}
            ${v.suitability.notes ? html`<p class="small muted mt-s">${v.suitability.notes}</p>` : ""}
          </div>

          <div class="card mt">
            <h2>Data and migration</h2>
            ${v.migration
              ? html`<p>Keeps data in ${v.migration.stores.map((s) => `${s.id} (${s.schema.name} ${s.schema.version})`).join(", ")}. Moves as ${v.migration.formats.join(", ")}; ${v.migration.requiresStop ? "it must stop while data moves" : "it can keep running while data moves"}. ${v.migration.retentionDays === null ? "" : `Data is kept ${v.migration.retentionDays} days after removal.`}</p>`
              : html`<p class="muted">This component keeps no data.</p>`}
          </div>

          <div class="card mt">
            <h2>Used by recipes</h2>
            ${v.usedBy.length === 0 ? html`<p class="muted">No listed recipe names it yet.</p>` : html`<ul class="bullets">${v.usedBy.map((r) => html`<li><a href="/recipes/${r.slug}">${r.title}</a> ${r.version}</li>`)}</ul>`}
          </div>

          <div class="card mt">
            <h2>Versions</h2>
            ${versionList("components", v.slug, v.version, v.versions)}
          </div>
          <p class="mt">${variants(`/components/${v.slug}`, requested === "latest" ? undefined : v.version)}</p>
        </article>
  `;
}

export async function componentPage(root: HTMLElement, slug: string): Promise<void> {
  setTheme("store", "Component on ourapps", true);
  const me = await whoAmI();
  const requested = versionFromSearch(location.search);
  let v: ComponentVersionView;
  try {
    v = await api<ComponentVersionView>("GET", `/api/components/${encodeURIComponent(slug)}/${requested}`);
  } catch (err) {
    return notFound(root, err instanceof ApiError && err.status === 404 ? "No such component or version." : String(err));
  }
  setTheme("store", `${v.name}: a component on ourapps`, true);
  showInFrame(root, me, v.name, componentBody(v, requested), { bare: true });
  wireBundle(root, v.bundle.url);
}
