-- Recipe library and component catalogue. D1 holds pointers (repository, release tag, asset name,
-- digests) and the page material; the packages themselves stay in the publisher's GitHub releases.
-- An entry keeps its rows when its developer deletes the account: developer_id becomes NULL and the
-- entry is flagged owner-deleted. Components record the exact components they depend on, so a
-- deprecation flag reaches whatever uses it.

-- deprecated_at is set together with deprecated_reason. owner-deprecated is set by the developer and
-- reversible; owner-deleted is set when the account is deleted, with developer_id NULL, and never cleared.
CREATE TABLE components (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  developer_id TEXT REFERENCES developers(id) ON DELETE SET NULL,
  repo TEXT NOT NULL,
  latest_version TEXT,
  deprecated_at TEXT,
  deprecated_reason TEXT CHECK (deprecated_reason IN ('owner-deprecated', 'owner-deleted')),
  replacement TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((deprecated_at IS NULL) = (deprecated_reason IS NULL)),
  CHECK (developer_id IS NOT NULL OR COALESCE(deprecated_reason, '') = 'owner-deleted')
);
CREATE INDEX components_developer ON components(developer_id);

CREATE TABLE component_versions (
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  targets_client TEXT NOT NULL DEFAULT '[]',
  targets_server TEXT NOT NULL DEFAULT '[]',
  guardians TEXT NOT NULL DEFAULT '[]',
  provides TEXT NOT NULL DEFAULT '[]',
  requires TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  suitability TEXT NOT NULL,
  migration TEXT,
  source_repo TEXT NOT NULL,
  source_tag TEXT NOT NULL,
  bundle_asset TEXT NOT NULL,
  bundle_digest TEXT NOT NULL,
  published_at TEXT NOT NULL,
  unlisted_at TEXT,
  PRIMARY KEY (component_id, version)
);
CREATE INDEX component_versions_category ON component_versions(category);

-- One row per interface a component version provides or requires, for search by interface type.
CREATE TABLE component_interfaces (
  component_id TEXT NOT NULL,
  version TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('provides', 'requires')),
  port_id TEXT NOT NULL,
  type TEXT NOT NULL,
  interface_version TEXT NOT NULL,
  PRIMARY KEY (component_id, version, direction, port_id),
  FOREIGN KEY (component_id, version) REFERENCES component_versions(component_id, version) ON DELETE CASCADE
);
CREATE INDEX component_interfaces_type ON component_interfaces(type, direction);

-- The components each component version builds on, by name and version, to resolve a deprecation tree.
CREATE TABLE component_dependencies (
  component_id TEXT NOT NULL,
  version TEXT NOT NULL,
  dependency_name TEXT NOT NULL,
  dependency_version TEXT NOT NULL,
  PRIMARY KEY (component_id, version, dependency_name),
  FOREIGN KEY (component_id, version) REFERENCES component_versions(component_id, version) ON DELETE CASCADE
);
CREATE INDEX component_dependencies_name ON component_dependencies(dependency_name);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  developer_id TEXT REFERENCES developers(id) ON DELETE SET NULL,
  repo TEXT NOT NULL,
  latest_version TEXT,
  deprecated_at TEXT,
  deprecated_reason TEXT CHECK (deprecated_reason IN ('owner-deprecated', 'owner-deleted')),
  replacement TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((deprecated_at IS NULL) = (deprecated_reason IS NULL)),
  CHECK (developer_id IS NOT NULL OR COALESCE(deprecated_reason, '') = 'owner-deleted')
);
CREATE INDEX recipes_developer ON recipes(developer_id);

-- recipe holds the validated recipe.json, questions included.
CREATE TABLE recipe_versions (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  targets_client TEXT NOT NULL DEFAULT '[]',
  targets_server TEXT NOT NULL DEFAULT '[]',
  recipe TEXT NOT NULL,
  description TEXT NOT NULL,
  diagram TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  source_repo TEXT NOT NULL,
  source_tag TEXT NOT NULL,
  bundle_asset TEXT NOT NULL,
  bundle_digest TEXT NOT NULL,
  published_at TEXT NOT NULL,
  unlisted_at TEXT,
  PRIMARY KEY (recipe_id, version)
);
CREATE INDEX recipe_versions_category ON recipe_versions(category);

-- The components each recipe version names, for "recipes that use this component".
CREATE TABLE recipe_components (
  recipe_id TEXT NOT NULL,
  version TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  component_name TEXT NOT NULL,
  component_version TEXT NOT NULL,
  included_when TEXT,
  PRIMARY KEY (recipe_id, version, instance_id),
  FOREIGN KEY (recipe_id, version) REFERENCES recipe_versions(recipe_id, version) ON DELETE CASCADE
);
CREATE INDEX recipe_components_component ON recipe_components(component_name, component_version);

-- Search index: one row per recipe or component, holding its newest listed version.
-- entry_id is recipes.id or components.id; rows are written and removed by the worker.
CREATE VIRTUAL TABLE catalogue_fts USING fts5(
  kind UNINDEXED,
  entry_id UNINDEXED,
  name,
  title,
  summary,
  tags,
  description
);
