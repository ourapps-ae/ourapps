// D1 access for the recipe library and the component catalogue.
import { newestVersion, type ComponentDependency, type ComponentEntry, type Deprecation, type DeprecationReason, type EntryStatus, type MigrationSummary, type Port, type Recipe, type RecipeEntry, type Suitability, type Targets, type VersionRef, type AppTarget, type DeprecatedFilter } from "@my/store-shared";

export type Kind = "recipe" | "component";

const MAX_TREE_DEPTH = 8;

const TABLES = {
  recipe: { entries: "recipes", versions: "recipe_versions", fk: "recipe_id" },
  component: { entries: "components", versions: "component_versions", fk: "component_id" },
} as const;

type Raw = Record<string, unknown>;

function parse<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

// The flag on a name; it covers every version.
export interface Flag {
  at: string;
  reason: DeprecationReason;
  replacement: string | null;
}

export interface EntryRow {
  id: string;
  name: string;
  scope: string;
  slug: string;
  // Null once the developer deleted the account.
  developerId: string | null;
  repo: string;
  latestVersion: string | null;
  flag: Flag | null;
  createdAt: string;
  updatedAt: string;
}

function flagOf(r: Raw): Flag | null {
  return r.deprecated_at ? { at: r.deprecated_at as string, reason: r.deprecated_reason as DeprecationReason, replacement: (r.replacement as string | null) ?? null } : null;
}

function entryRow(r: Raw): EntryRow {
  return { id: r.id as string, name: r.name as string, scope: r.scope as string, slug: r.slug as string, developerId: (r.developer_id as string | null) ?? null, repo: r.repo as string, latestVersion: (r.latest_version as string | null) ?? null, flag: flagOf(r), createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}

export function entryStatus(developerId: string | null, flag: Flag | null): EntryStatus {
  return flag === null ? "active" : developerId === null ? "orphaned" : "deprecated";
}

export function noticeFor(name: string, version: string, developerId: string | null, flag: Flag, via: string[]): Deprecation {
  const notice: Deprecation = { name, version, status: developerId === null ? "orphaned" : "deprecated", reason: flag.reason, since: flag.at, via };
  if (flag.replacement) notice.replacement = flag.replacement;
  return notice;
}

interface Common {
  entryId: string;
  name: string;
  slug: string;
  developerId: string | null;
  flag: Flag | null;
  version: string;
  category: string | null;
  tags: string[];
  targets: Targets;
  publishedAt: string;
  unlistedAt: string | null;
  digest: string;
  sourceRepo: string;
  sourceTag: string;
  bundleAsset: string;
  bundleDigest: string;
  repo: string;
  publisherSlug: string | null;
  publisherName: string | null;
}

export interface RecipeRow extends Common {
  title: string;
  summary: string;
  category: string;
  recipe: Recipe;
  description: string;
  diagram: string | null;
  screenshots: string[];
}

export interface ComponentRow extends Common {
  description: string;
  guardians: string[];
  provides: Port[];
  requires: Port[];
  dependencies: ComponentDependency[];
  suitability: Suitability;
  migration: MigrationSummary | null;
}

function common(r: Raw): Common {
  return {
    entryId: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    developerId: (r.developer_id as string | null) ?? null,
    flag: flagOf(r),
    version: r.version as string,
    category: (r.category as string | null) ?? null,
    tags: parse<string[]>(r.tags, []),
    targets: { client: parse<AppTarget[]>(r.targets_client, []), server: parse<string[]>(r.targets_server, []) },
    publishedAt: r.published_at as string,
    unlistedAt: (r.unlisted_at as string | null) ?? null,
    digest: r.digest as string,
    sourceRepo: r.source_repo as string,
    sourceTag: r.source_tag as string,
    bundleAsset: r.bundle_asset as string,
    bundleDigest: r.bundle_digest as string,
    repo: r.repo as string,
    publisherSlug: (r.publisher_slug as string | null) ?? null,
    publisherName: (r.publisher_name as string | null) ?? null,
  };
}

function recipeRow(r: Raw): RecipeRow {
  return { ...common(r), category: r.category as string, title: r.title as string, summary: r.summary as string, recipe: parse<Recipe>(r.recipe, null as unknown as Recipe), description: r.description as string, diagram: (r.diagram as string | null) ?? null, screenshots: parse<string[]>(r.screenshots, []) };
}

function componentRow(r: Raw): ComponentRow {
  return {
    ...common(r),
    description: r.description as string,
    guardians: parse<string[]>(r.guardians, []),
    provides: parse<Port[]>(r.provides, []),
    requires: parse<Port[]>(r.requires, []),
    dependencies: parse<ComponentDependency[]>(r.dependencies, []),
    suitability: parse<Suitability>(r.suitability, null as unknown as Suitability),
    migration: parse<MigrationSummary | null>(r.migration, null),
  };
}

export interface ListFilter {
  category?: string;
  target?: string;
  tag?: string;
  provides?: string;
  requires?: string;
  deprecated: DeprecatedFilter;
  limit: number;
  offset: number;
}

const RECIPE_COLUMNS = `e.id, e.developer_id, e.deprecated_at, e.deprecated_reason, e.replacement, e.name, e.slug, e.repo, v.version, v.digest, v.title, v.summary, v.category, v.tags, v.targets_client, v.targets_server, v.recipe, v.description, v.diagram, v.screenshots,
  v.source_repo, v.source_tag, v.bundle_asset, v.bundle_digest, v.published_at, v.unlisted_at, d.slug AS publisher_slug, d.display_name AS publisher_name`;

const COMPONENT_COLUMNS = `e.id, e.developer_id, e.deprecated_at, e.deprecated_reason, e.replacement, e.name, e.slug, e.repo, v.version, v.digest, v.description, v.category, v.tags, v.targets_client, v.targets_server, v.guardians, v.provides, v.requires, v.dependencies, v.suitability, v.migration,
  v.source_repo, v.source_tag, v.bundle_asset, v.bundle_digest, v.published_at, v.unlisted_at, d.slug AS publisher_slug, d.display_name AS publisher_name`;

// Characters that FTS5 treats as syntax never reach it: every word is quoted, with a prefix star.
export function ftsQuery(input: string): string | null {
  const words = (input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => w.slice(0, 40));
  return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(" ");
}

function deprecatedClause(filter: DeprecatedFilter): string {
  return filter === "exclude" ? " AND e.deprecated_at IS NULL" : filter === "only" ? " AND e.deprecated_at IS NOT NULL" : "";
}

export class CatalogueDb {
  constructor(private d1: D1Database) {}

  // Entries (a recipe or a component name)

  async entryBySlug(kind: Kind, slug: string): Promise<EntryRow | null> {
    const r = await this.d1.prepare(`SELECT * FROM ${TABLES[kind].entries} WHERE slug = ?`).bind(slug).first<Raw>();
    return r ? entryRow(r) : null;
  }

  async entriesByDeveloper(kind: Kind, developerId: string): Promise<EntryRow[]> {
    const res = await this.d1.prepare(`SELECT * FROM ${TABLES[kind].entries} WHERE developer_id = ? ORDER BY name`).bind(developerId).all<Raw>();
    return res.results.map(entryRow);
  }

  async countByDeveloper(kind: Kind, developerId: string): Promise<number> {
    const r = await this.d1.prepare(`SELECT COUNT(*) AS n FROM ${TABLES[kind].entries} WHERE developer_id = ?`).bind(developerId).first<{ n: number }>();
    return r?.n ?? 0;
  }

  async countVersions(kind: Kind, entryId: string): Promise<number> {
    const t = TABLES[kind];
    const r = await this.d1.prepare(`SELECT COUNT(*) AS n FROM ${t.versions} WHERE ${t.fk} = ?`).bind(entryId).first<{ n: number }>();
    return r?.n ?? 0;
  }

  // Versions of one entry, newest first. Unlisted versions are included only when asked.
  async versions(kind: Kind, entryId: string, includeUnlisted = false): Promise<(VersionRef & { unlistedAt: string | null })[]> {
    const t = TABLES[kind];
    const res = await this.d1.prepare(`SELECT version, digest, published_at, unlisted_at FROM ${t.versions} WHERE ${t.fk} = ?${includeUnlisted ? "" : " AND unlisted_at IS NULL"}`).bind(entryId).all<Raw>();
    return res.results
      .map((r) => ({ version: r.version as string, digest: r.digest as string, publishedAt: r.published_at as string, unlistedAt: (r.unlisted_at as string | null) ?? null }))
      .sort((a, b) => (newestVersion([a.version, b.version]) === a.version ? -1 : 1));
  }

  // Publishing

  // Records a version and refreshes the entry's newest listed version and search row.
  async publishRecipe(entry: EntryRow | null, fresh: EntryRow, e: RecipeEntry, now: string): Promise<void> {
    const target = entry ?? fresh;
    const statements: D1PreparedStatement[] = [];
    if (!entry) statements.push(this.insertEntryStatement("recipe", fresh));
    const r = e.recipe;
    statements.push(
      this.d1
        .prepare(
          `INSERT INTO recipe_versions (recipe_id, version, digest, title, summary, category, tags, targets_client, targets_server, recipe, description, diagram, screenshots, source_repo, source_tag, bundle_asset, bundle_digest, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(target.id, r.version, e.digest, r.title, r.summary, r.category, JSON.stringify(r.tags), JSON.stringify(r.targets.client), JSON.stringify(r.targets.server), JSON.stringify(r), e.page.description, e.page.diagram, JSON.stringify(e.page.screenshots), e.source.repository, e.source.tag, e.bundle.asset, e.bundle.digest, now),
    );
    for (const c of r.components) {
      statements.push(
        this.d1.prepare("INSERT INTO recipe_components (recipe_id, version, instance_id, component_name, component_version, included_when) VALUES (?, ?, ?, ?, ?, ?)").bind(target.id, r.version, c.id, c.name, c.version, c.includedWhen ? JSON.stringify(c.includedWhen) : null),
      );
    }
    statements.push(...(await this.refreshStatements("recipe", target.id, now, r.version)));
    await this.d1.batch(statements);
  }

  async publishComponent(entry: EntryRow | null, fresh: EntryRow, e: ComponentEntry, now: string): Promise<void> {
    const target = entry ?? fresh;
    const statements: D1PreparedStatement[] = [];
    if (!entry) statements.push(this.insertEntryStatement("component", fresh));
    statements.push(
      this.d1
        .prepare(
          `INSERT INTO component_versions (component_id, version, digest, description, category, tags, targets_client, targets_server, guardians, provides, requires, dependencies, suitability, migration, source_repo, source_tag, bundle_asset, bundle_digest, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(target.id, e.version, e.digest, e.description, e.category, JSON.stringify(e.tags), JSON.stringify(e.targets.client), JSON.stringify(e.targets.server), JSON.stringify(e.guardians), JSON.stringify(e.provides), JSON.stringify(e.requires), JSON.stringify(e.dependencies), JSON.stringify(e.suitability), e.migration ? JSON.stringify(e.migration) : null, e.source.repository, e.source.tag, e.bundle.asset, e.bundle.digest, now),
    );
    for (const [direction, ports] of [["provides", e.provides], ["requires", e.requires]] as const) {
      for (const p of ports) {
        statements.push(this.d1.prepare("INSERT INTO component_interfaces (component_id, version, direction, port_id, type, interface_version) VALUES (?, ?, ?, ?, ?, ?)").bind(target.id, e.version, direction, p.id, p.type, p.version));
      }
    }
    for (const dep of e.dependencies) {
      statements.push(this.d1.prepare("INSERT INTO component_dependencies (component_id, version, dependency_name, dependency_version) VALUES (?, ?, ?, ?)").bind(target.id, e.version, dep.name, dep.version));
    }
    statements.push(...(await this.refreshStatements("component", target.id, now, e.version)));
    await this.d1.batch(statements);
  }

  private insertEntryStatement(kind: Kind, e: EntryRow): D1PreparedStatement {
    return this.d1
      .prepare(`INSERT INTO ${TABLES[kind].entries} (id, name, scope, slug, developer_id, repo, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(e.id, e.name, e.scope, e.slug, e.developerId, e.repo, e.createdAt, e.updatedAt);
  }

  // Lists a version again after it was unlisted.
  async relist(kind: Kind, entryId: string, version: string, now: string): Promise<void> {
    const t = TABLES[kind];
    await this.d1.batch([this.d1.prepare(`UPDATE ${t.versions} SET unlisted_at = NULL WHERE ${t.fk} = ? AND version = ?`).bind(entryId, version), ...(await this.refreshStatements(kind, entryId, now, version))]);
  }

  // Hides one version, or every version when none is named. Rows stay so a version keeps its digest.
  async unlist(kind: Kind, entryId: string, version: string | null, now: string): Promise<number> {
    const t = TABLES[kind];
    const update = version
      ? this.d1.prepare(`UPDATE ${t.versions} SET unlisted_at = ? WHERE ${t.fk} = ? AND version = ? AND unlisted_at IS NULL`).bind(now, entryId, version)
      : this.d1.prepare(`UPDATE ${t.versions} SET unlisted_at = ? WHERE ${t.fk} = ? AND unlisted_at IS NULL`).bind(now, entryId);
    const changed = (await update.run()).meta.changes ?? 0;
    await this.d1.batch(await this.refreshStatements(kind, entryId, now));
    return changed;
  }

  // Newest listed version and the search row for one entry. `adding` is a version inserted by the same batch.
  private async refreshStatements(kind: Kind, entryId: string, now: string, adding?: string): Promise<D1PreparedStatement[]> {
    const t = TABLES[kind];
    const listed = (await this.d1.prepare(`SELECT version FROM ${t.versions} WHERE ${t.fk} = ? AND unlisted_at IS NULL`).bind(entryId).all<{ version: string }>()).results.map((r) => r.version);
    const latest = newestVersion(adding ? [...listed, adding] : listed);
    const statements = [
      this.d1.prepare(`UPDATE ${t.entries} SET latest_version = ?, updated_at = ? WHERE id = ?`).bind(latest, now, entryId),
      this.d1.prepare("DELETE FROM catalogue_fts WHERE kind = ? AND entry_id = ?").bind(kind, entryId),
    ];
    if (latest) {
      statements.push(
        kind === "recipe"
          ? this.d1
              .prepare(
                `INSERT INTO catalogue_fts (kind, entry_id, name, title, summary, tags, description)
                 SELECT 'recipe', e.id, e.name, v.title, v.summary, COALESCE((SELECT group_concat(value, ' ') FROM json_each(v.tags)), ''), v.description
                 FROM recipes e JOIN recipe_versions v ON v.recipe_id = e.id AND v.version = e.latest_version WHERE e.id = ?`,
              )
              .bind(entryId)
          : this.d1
              .prepare(
                `INSERT INTO catalogue_fts (kind, entry_id, name, title, summary, tags, description)
                 SELECT 'component', e.id, e.name, replace(e.slug, '-', ' '), '', COALESCE((SELECT group_concat(value, ' ') FROM json_each(v.tags)), ''), v.description
                 FROM components e JOIN component_versions v ON v.component_id = e.id AND v.version = e.latest_version WHERE e.id = ?`,
              )
              .bind(entryId),
      );
    }
    return statements;
  }

  // Reading

  // One version of a recipe or component, by name slug; `latest` resolves to the newest listed one.
  async recipeVersion(slug: string, version: string, includeUnlisted = false): Promise<{ entry: EntryRow; row: RecipeRow } | null> {
    return this.version("recipe", slug, version, includeUnlisted, RECIPE_COLUMNS, recipeRow);
  }

  async componentVersion(slug: string, version: string, includeUnlisted = false): Promise<{ entry: EntryRow; row: ComponentRow } | null> {
    return this.version("component", slug, version, includeUnlisted, COMPONENT_COLUMNS, componentRow);
  }

  private async version<T>(kind: Kind, slug: string, version: string, includeUnlisted: boolean, columns: string, convert: (r: Raw) => T): Promise<{ entry: EntryRow; row: T } | null> {
    const t = TABLES[kind];
    const entry = await this.entryBySlug(kind, slug);
    if (!entry) return null;
    const wanted = version === "latest" ? entry.latestVersion : version;
    if (!wanted) return null;
    const r = await this.d1
      .prepare(`SELECT ${columns} FROM ${t.entries} e JOIN ${t.versions} v ON v.${t.fk} = e.id LEFT JOIN developers d ON d.id = e.developer_id WHERE e.id = ? AND v.version = ?${includeUnlisted ? "" : " AND v.unlisted_at IS NULL"}`)
      .bind(entry.id, wanted)
      .first<Raw>();
    return r ? { entry, row: convert(r) } : null;
  }

  async listRecipes(f: ListFilter): Promise<{ rows: RecipeRow[]; total: number }> {
    const { where, binds } = this.filters("recipe", f);
    const from = `FROM recipes e JOIN recipe_versions v ON v.recipe_id = e.id AND v.version = e.latest_version LEFT JOIN developers d ON d.id = e.developer_id WHERE e.latest_version IS NOT NULL${where}`;
    const res = await this.d1.prepare(`SELECT ${RECIPE_COLUMNS} ${from} ORDER BY v.published_at DESC, e.name LIMIT ? OFFSET ?`).bind(...binds, f.limit, f.offset).all<Raw>();
    const total = await this.d1.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds).first<{ n: number }>();
    return { rows: res.results.map(recipeRow), total: total?.n ?? 0 };
  }

  async listComponents(f: ListFilter): Promise<{ rows: ComponentRow[]; total: number }> {
    const { where, binds } = this.filters("component", f);
    const from = `FROM components e JOIN component_versions v ON v.component_id = e.id AND v.version = e.latest_version LEFT JOIN developers d ON d.id = e.developer_id WHERE e.latest_version IS NOT NULL${where}`;
    const res = await this.d1.prepare(`SELECT ${COMPONENT_COLUMNS} ${from} ORDER BY e.name LIMIT ? OFFSET ?`).bind(...binds, f.limit, f.offset).all<Raw>();
    const total = await this.d1.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds).first<{ n: number }>();
    return { rows: res.results.map(componentRow), total: total?.n ?? 0 };
  }

  private filters(kind: Kind, f: ListFilter): { where: string; binds: string[] } {
    let where = deprecatedClause(f.deprecated);
    const binds: string[] = [];
    if (f.category) {
      where += " AND v.category = ?";
      binds.push(f.category);
    }
    if (f.target) {
      where += " AND (EXISTS (SELECT 1 FROM json_each(v.targets_client) WHERE value = ?) OR EXISTS (SELECT 1 FROM json_each(v.targets_server) WHERE value = ?))";
      binds.push(f.target, f.target);
    }
    if (f.tag) {
      where += " AND EXISTS (SELECT 1 FROM json_each(v.tags) WHERE value = ?)";
      binds.push(f.tag);
    }
    if (kind === "component") {
      for (const [direction, value] of [["provides", f.provides], ["requires", f.requires]] as const) {
        if (!value) continue;
        where += ` AND EXISTS (SELECT 1 FROM component_interfaces i WHERE i.component_id = e.id AND i.version = e.latest_version AND i.direction = '${direction}' AND (i.type = ? OR i.port_id = ?))`;
        binds.push(value, value);
      }
    }
    return { where, binds };
  }

  // Listed entries per category, newest version of each.
  async categories(kind: Kind): Promise<{ category: string; count: number }[]> {
    const t = TABLES[kind];
    const res = await this.d1
      .prepare(`SELECT v.category AS category, COUNT(*) AS n FROM ${t.entries} e JOIN ${t.versions} v ON v.${t.fk} = e.id AND v.version = e.latest_version WHERE e.latest_version IS NOT NULL AND v.category IS NOT NULL GROUP BY v.category ORDER BY n DESC, v.category`)
      .all<{ category: string; n: number }>();
    return res.results.map((r) => ({ category: r.category, count: r.n }));
  }

  async searchRecipes(query: string, limit: number, deprecated: DeprecatedFilter): Promise<RecipeRow[]> {
    const match = ftsQuery(query);
    if (!match) return [];
    const res = await this.d1
      .prepare(
        `SELECT ${RECIPE_COLUMNS} FROM catalogue_fts JOIN recipes e ON e.id = catalogue_fts.entry_id JOIN recipe_versions v ON v.recipe_id = e.id AND v.version = e.latest_version LEFT JOIN developers d ON d.id = e.developer_id
         WHERE catalogue_fts MATCH ? AND catalogue_fts.kind = 'recipe' AND e.latest_version IS NOT NULL${deprecatedClause(deprecated)} ORDER BY bm25(catalogue_fts) LIMIT ?`,
      )
      .bind(match, limit)
      .all<Raw>();
    return res.results.map(recipeRow);
  }

  async searchComponents(query: string, limit: number, deprecated: DeprecatedFilter): Promise<ComponentRow[]> {
    const match = ftsQuery(query);
    if (!match) return [];
    const res = await this.d1
      .prepare(
        `SELECT ${COMPONENT_COLUMNS} FROM catalogue_fts JOIN components e ON e.id = catalogue_fts.entry_id JOIN component_versions v ON v.component_id = e.id AND v.version = e.latest_version LEFT JOIN developers d ON d.id = e.developer_id
         WHERE catalogue_fts MATCH ? AND catalogue_fts.kind = 'component' AND e.latest_version IS NOT NULL${deprecatedClause(deprecated)} ORDER BY bm25(catalogue_fts) LIMIT ?`,
      )
      .bind(match, limit)
      .all<Raw>();
    return res.results.map(componentRow);
  }

  // Deprecation

  // Flags a name. Re-flagging replaces the replacement.
  async deprecate(kind: Kind, entryId: string, replacement: string | null, now: string): Promise<void> {
    await this.d1.prepare(`UPDATE ${TABLES[kind].entries} SET deprecated_at = ?, deprecated_reason = 'owner-deprecated', replacement = ? WHERE id = ? AND developer_id IS NOT NULL`).bind(now, replacement, entryId).run();
  }

  async undeprecate(kind: Kind, entryId: string): Promise<void> {
    await this.d1.prepare(`UPDATE ${TABLES[kind].entries} SET deprecated_at = NULL, deprecated_reason = NULL, replacement = NULL WHERE id = ? AND developer_id IS NOT NULL`).bind(entryId).run();
  }

  // Flagged entries under one version: what a recipe names, or what a component depends on, followed through dependencies.
  // `checked` counts the distinct components examined, whether or not the catalogue lists them. One result per request, in order.
  async deprecationsFor(items: { kind: Kind; entryId: string; name: string; version: string; developerId: string | null; flag: Flag | null }[]): Promise<{ notices: Deprecation[]; checked: number }[]> {
    if (items.length === 0) return [];
    const statements = items.map((i) => {
      const seed =
        i.kind === "recipe"
          ? "SELECT component_name, component_version, ?1, 1 FROM recipe_components WHERE recipe_id = ?2 AND version = ?3"
          : "SELECT dependency_name, dependency_version, ?1, 1 FROM component_dependencies WHERE component_id = ?2 AND version = ?3";
      return this.d1
        .prepare(
          `WITH RECURSIVE tree(name, version, via, depth) AS (
             ${seed}
             UNION
             SELECT cd.dependency_name, cd.dependency_version, tree.name, tree.depth + 1
             FROM tree JOIN components c ON c.name = tree.name JOIN component_dependencies cd ON cd.component_id = c.id AND cd.version = tree.version
             WHERE tree.depth < ${MAX_TREE_DEPTH}
           )
           SELECT t.name, t.version, t.via, c.developer_id, c.deprecated_at, c.deprecated_reason, c.replacement FROM tree t LEFT JOIN components c ON c.name = t.name ORDER BY t.name, t.version, t.via`,
        )
        .bind(i.name, i.entryId, i.version);
    });
    const results = await this.d1.batch<Raw>(statements);
    return results.map((res, n) => {
      const item = items[n];
      const merged = new Map<string, Deprecation>();
      if (item.flag) merged.set(`${item.name} ${item.version}`, noticeFor(item.name, item.version, item.developerId, item.flag, []));
      const seen = new Set<string>();
      for (const r of res.results) {
        seen.add(`${r.name} ${r.version}`);
        const flag = flagOf(r);
        if (!flag) continue;
        const key = `${r.name} ${r.version}`;
        const via = r.via as string;
        const known = merged.get(key);
        if (known) {
          if (!known.via.includes(via)) known.via.push(via);
        } else merged.set(key, noticeFor(r.name as string, r.version as string, (r.developer_id as string | null) ?? null, flag, [via]));
      }
      return { notices: [...merged.values()], checked: seen.size };
    });
  }

  // What the catalogue lists for the components a recipe names; null where a name and version are not listed.
  async catalogueFor(refs: { name: string; version: string }[]): Promise<(ComponentRow | null)[]> {
    if (refs.length === 0) return [];
    const statements = refs.map((ref) =>
      this.d1
        .prepare(`SELECT ${COMPONENT_COLUMNS} FROM components e JOIN component_versions v ON v.component_id = e.id AND v.version = ? AND v.unlisted_at IS NULL LEFT JOIN developers d ON d.id = e.developer_id WHERE e.name = ?`)
        .bind(ref.version, ref.name),
    );
    const results = await this.d1.batch<Raw>(statements);
    return results.map((res) => (res.results[0] ? componentRow(res.results[0]) : null));
  }

  // Listed recipes whose newest version names the component.
  async recipesUsing(componentName: string): Promise<{ name: string; slug: string; title: string; version: string }[]> {
    const res = await this.d1
      .prepare(
        `SELECT DISTINCT e.name, e.slug, v.title, v.version FROM recipe_components rc JOIN recipes e ON e.id = rc.recipe_id AND e.latest_version = rc.version
         JOIN recipe_versions v ON v.recipe_id = e.id AND v.version = e.latest_version WHERE rc.component_name = ? ORDER BY e.name`,
      )
      .bind(componentName)
      .all<Raw>();
    return res.results.map((r) => ({ name: r.name as string, slug: r.slug as string, title: r.title as string, version: r.version as string }));
  }
}
