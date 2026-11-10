// What the public recipe and component routes return. Never carries tokens or credentials.
import type { BundlePointer, ComponentDependency, MigrationSummary, Port, Recipe, RecipeComponent, ReleasePointer, Suitability, Targets } from "./catalogue.js";

export const DEPRECATED_FILTERS = ["exclude", "include", "only"] as const;
export type DeprecatedFilter = typeof DEPRECATED_FILTERS[number];

// deprecated: the owner flagged it. orphaned: the owner deleted the account, so nobody maintains it.
export type DeprecationStatus = "deprecated" | "orphaned";
export type DeprecationReason = "owner-deprecated" | "owner-deleted";
export type EntryStatus = "active" | DeprecationStatus;

// One flagged entry an agent should know about. `version` is the version in use; the flag covers every version of the name.
// `via` names what pulls it in: empty for the entry itself, the recipe or component that names it otherwise.
export interface Deprecation {
  name: string;
  version: string;
  status: DeprecationStatus;
  reason: DeprecationReason;
  since: string;
  replacement?: string;
  via: string[];
}

// GET /api/{recipes,components}/:name/:version/deprecations: the entry and everything under it, resolved.
export interface DeprecationReport {
  name: string;
  version: string;
  status: EntryStatus;
  affected: boolean;
  checked: number;
  deprecations: Deprecation[];
}

export function deprecationLine(d: Deprecation): string {
  const what = d.status === "orphaned" ? "orphaned: its publisher deleted their account" : "deprecated by its publisher";
  const where = d.via.length === 0 ? "" : `, used by ${d.via.join(", ")}`;
  const instead = d.replacement ? `; replacement ${d.replacement}` : "";
  return `${d.name} ${d.version} is ${what} (${d.reason}, since ${d.since}${where})${instead}`;
}

export interface Publisher {
  slug: string;
  displayName: string;
}

export interface VersionRef {
  version: string;
  digest: string;
  publishedAt: string;
}

export interface RecipeSummary {
  name: string;
  slug: string;
  version: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  targets: Targets;
  publishedAt: string;
  // Null when the publisher deleted their account.
  publisher: Publisher | null;
  repository: string;
  url: string;
  status: EntryStatus;
  deprecations: Deprecation[];
}

export interface ComponentSummary {
  name: string;
  slug: string;
  version: string;
  description: string;
  category: string | null;
  tags: string[];
  targets: Targets;
  provides: Port[];
  requires: Port[];
  publishedAt: string;
  // Null when the publisher deleted their account.
  publisher: Publisher | null;
  repository: string;
  url: string;
  status: EntryStatus;
  deprecations: Deprecation[];
}

// A recipe's component with what the catalogue knows about the named version, if it is listed.
export interface RecipeComponentView extends RecipeComponent {
  catalogue: { url: string; description: string; suitability: Suitability; guardians: string[] } | null;
  deprecation: Deprecation | null;
}

export interface RecipeVersionView extends RecipeSummary {
  digest: string;
  source: ReleasePointer;
  bundle: BundlePointer & { url: string };
  description: string;
  diagram: string | null;
  screenshots: string[];
  components: RecipeComponentView[];
  jobs: Recipe["jobs"];
  scale: Recipe["scale"];
  questions: Recipe["questions"];
  connections: Recipe["connections"];
  tests: Recipe["tests"];
  instructions: string;
  versions: VersionRef[];
}

export interface ComponentVersionView extends ComponentSummary {
  digest: string;
  guardians: string[];
  dependencies: ComponentDependency[];
  suitability: Suitability;
  migration: MigrationSummary | null;
  source: ReleasePointer;
  bundle: BundlePointer & { url: string };
  versions: VersionRef[];
  usedBy: { name: string; slug: string; title: string; version: string; url: string }[];
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface RecipeList {
  recipes: RecipeSummary[];
  total: number;
  limit: number;
  offset: number;
  categories: CategoryCount[];
}

export interface ComponentList {
  components: ComponentSummary[];
  total: number;
  limit: number;
  offset: number;
  categories: CategoryCount[];
}

export interface RecipeSearch {
  query: string;
  recipes: RecipeSummary[];
}

export interface ComponentSearch {
  query: string;
  components: ComponentSummary[];
}

// bundle-unavailable: the publisher's account is deleted and the release is not public, so no download link exists.
export interface BundleLink {
  name: string;
  version: string;
  digest: string;
  asset: string;
  assetDigest: string;
  status: "available" | "bundle-unavailable";
  url: string | null;
  expiresAt: string | null;
  deprecations: Deprecation[];
}

// What a downloaded package is, in one place: the site pages, the plain-text pages and the documents quote this.
export interface PackageSummary {
  headline: string;
  parts: [label: string, text: string][];
  where: string;
  check: string;
}

export const COMPONENT_PACKAGE: PackageSummary = {
  headline: "The component itself: reviewed source code in one archive file, not a link to code elsewhere.",
  parts: [
    ["Code", "The working implementation for each device or server it supports (the pills above), as ordinary source files in those platforms' languages."],
    ["Contract", "The interfaces it provides and requires, written as data, with its documentation and instructions for an agent."],
    ["Tests", "The tests that prove it works, and the versions of the tools they need."],
    ["Manifest", "component.json lists every file with its fingerprint and the place it takes in your application, so nothing is copied that is not listed."],
    ["Not included", "The components it requires (each is a separate download), your settings, and any secret."],
  ],
  where: "The archive is a release file on the publisher's public GitHub repository. ourapps keeps this page's details and a pointer to the release; it does not hold or run the code.",
  check: "The digest is the sha256 fingerprint of the archive. aepm checks it before anything is copied. Installing copies the listed files into your application and runs none of the package's code.",
};

export const RECIPE_PACKAGE: PackageSummary = {
  headline: "The recipe itself: source code and a form, in one archive file, not a link to code elsewhere.",
  parts: [
    ["Recipe", "recipe.json holds the questions it asks, the components it names (each by exact version), the settings that connect them, the choice of providers by size, and the tested answer sets."],
    ["Application code", "The recipe's own application-specific component: the screens, artwork, sounds, translated text, rules and end-to-end tests that belong to this application and to no other."],
    ["Instructions", "INSTRUCTIONS.md tells an agent how to answer the questions and what each answer changes, and tells the developer which accounts are needed."],
    ["Not included", "The components it names. Each is a separate download, fetched by exact version and checked against its digest."],
  ],
  where: "The archive is a release file on the publisher's public GitHub repository. ourapps keeps this page's details and a pointer to the release; it does not hold or run the code.",
  check: "The digest is the sha256 fingerprint of the archive. aepm checks it before anything is copied. Installing copies the listed files into your application and runs none of the package's code.",
};
