// Pure helpers for the recipe library and component catalogue pages.
import { describeCondition, type Deprecation, type EntryStatus, type Profile, type RecipeComponent } from "@my/store-shared";

export const CLIENT_TARGET_LABEL: Record<string, string> = {
  web: "Web",
  ios: "iPhone and iPad",
  android: "Android",
  macos: "Mac",
  windows: "Windows",
  tvos: "Apple TV",
};

const SERVER_TARGET_LABEL: Record<string, string> = {
  "own-hardware": "Own hardware",
  "hosting-provider": "Hosting provider",
  "cloud-account": "Cloud account",
};

export function targetLabel(target: string): string {
  return CLIENT_TARGET_LABEL[target] ?? SERVER_TARGET_LABEL[target] ?? target;
}

export interface LibraryQuery {
  q?: string;
  category?: string;
  target?: string;
  tag?: string;
  provides?: string;
  requires?: string;
  deprecated?: "exclude" | "only";
  offset?: number;
}

const FILTER_KEYS = ["q", "category", "target", "tag", "provides", "requires", "deprecated"] as const;

export function readQuery(search: string): LibraryQuery {
  const params = new URLSearchParams(search);
  const query: LibraryQuery = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    if (key === "deprecated") {
      if (value === "exclude" || value === "only") query.deprecated = value;
    } else query[key] = value;
  }
  const offset = Number(params.get("offset"));
  if (Number.isInteger(offset) && offset > 0) query.offset = offset;
  return query;
}

export function queryString(query: LibraryQuery): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (query[key]) params.set(key, query[key]!);
  if (query.offset && query.offset > 0) params.set("offset", String(query.offset));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

// The same filters with one changed; paging restarts.
export function withFilter(query: LibraryQuery, key: (typeof FILTER_KEYS)[number], value: string | undefined): LibraryQuery {
  const next: LibraryQuery = { ...query, offset: undefined };
  if (value === undefined || value === "" || query[key] === value) delete next[key];
  else (next as Record<string, string | number | undefined>)[key] = value;
  return next;
}

export function number(n: number): string {
  return n.toLocaleString("en-GB");
}

const LOAD_LABEL: Record<string, (n: number) => string> = {
  concurrentPeople: (n) => `${number(n)} people at once`,
  requestsPerDay: (n) => `${number(n)} requests a day`,
  storedMegabytes: (n) => `${number(n)} MB stored`,
};

// "up to 10 people at once, 100,000 requests a day"; empty load is "no practical limit".
export function loadText(load: Record<string, number>): string {
  const parts = Object.entries(load).map(([key, n]) => (LOAD_LABEL[key] ? LOAD_LABEL[key](n) : `${key} ${number(n)}`));
  return parts.length === 0 ? "no practical limit" : `up to ${parts.join(", ")}`;
}

export function costLabel(cost: Profile["cost"]): string {
  return { free: "Free", paid: "Paid", metered: "Metered", none: "No cost" }[cost];
}

export function answerText(value: unknown): string {
  if (value === undefined || value === null) return "asked";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map(answerText).join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function includedWhenText(c: Pick<RecipeComponent, "includedWhen">): string {
  const w = c.includedWhen;
  return w ? `when ${describeCondition(w, answerText)}` : "always";
}

// The version a page shows: ?version=, else the newest.
export function versionFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("version")?.trim() ?? "";
  return /^\d+\.\d+\.\d+$/.test(value) ? value : "latest";
}

export function releaseUrl(repository: string, tag: string): string {
  return `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`;
}

export function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function statusLabel(status: EntryStatus): string {
  return status === "orphaned" ? "Orphaned" : status === "deprecated" ? "Deprecated" : "Active";
}

// One sentence an agent or a reader can act on. `ownName` is the entry the page is about.
export function deprecationSentence(d: Deprecation, ownName: string): string {
  const what = d.status === "orphaned" ? "is orphaned: its publisher deleted their account and nobody maintains it" : "is deprecated by its publisher";
  const where = d.name === ownName ? "" : d.via.length > 0 ? `, used by ${d.via.join(", ")}` : "";
  return `${d.name} ${d.version} ${what} (since ${d.since.slice(0, 10)}${where}).`;
}

// What an entry's flag changes for someone choosing it.
export function deprecationAdvice(status: EntryStatus): string {
  if (status === "orphaned") return "It stays listed and may still be downloadable, but it receives no updates. Look for a similar entry, or decide never to update.";
  if (status === "deprecated") return "It stays listed and downloadable. Look for a replacement or a similar entry, or decide never to update.";
  return "";
}
