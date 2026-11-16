import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const FOUNDATION_PLATFORMS = ["web", "server", "ios", "macos", "tvos", "android", "windows"] as const;
export interface ClassReference { name: string; version: string; digest: string }
export interface ClassDescriptor {
  format: 1; name: string; version: string;
  provides: { type: string; version: string; path: string; modules: Record<string, string[]> }[];
  requires: { type: string; version: string }[];
  settings: { type: "object"; properties: Record<string, { type: "string" | "integer" | "boolean"; pattern?: string }>; required: string[]; additionalProperties: false };
  inventory: { path: string; digest: string }[];
  verification: { id: string; root: "package"; argv: string[]; cwd: "."; prepare: { argv: string[]; cwd: "."; network: boolean }[]; tools: Record<string, string>; fixtures: string[]; locks: string[]; network: boolean; timeoutSeconds: number; expectedExit: 0; scope: "required-local"; requirements: [] }[];
}
export interface Compatibility {
  runtimes: Record<string, string>;
  frameworks: Record<string, { name: string; range: string }>;
  dependencies: { name: string; version: string; isolation: "shared" | "isolated" }[];
  styles: { scope: "none" | "scoped" | "global"; namespaces: string[]; conflicts: string[] };
}
export interface Foundations {
  licence: string;
  platforms: string[];
  classes: { reference: ClassReference; descriptor: ClassDescriptor }[];
  implements: ClassReference[];
  upstream: { name: string; version: string; revision: string | null; repository: string; purl: string; licence: string; notices: string[]; delivery: UpstreamDelivery }[];
  compatibility: Compatibility;
  maintenance: { owners: string[]; contact: string; repository: string; updates: { source: string; strategy: "manual" | "release" } };
  files: { path: string; executable: boolean }[];
  artefacts: { source: string; destination: string; template: boolean; executable: boolean; component?: string | string[]; withoutComponent?: string | string[] }[];
}
export type UpstreamDelivery =
  | { kind: "bundled"; files: { path: string; digest: string }[]; gradleWrapper?: { jar: string; properties: string; distribution: { url: string; digest: string } } }
  | { kind: "build-time"; manager: "npm"; lock: string; digest: string; packagePath: string; integrity: string }
  | { kind: "build-time"; manager: "swift"; lock: string; digest: string }
  | { kind: "build-time"; manager: "gradle"; lock: string; digest: string; verification: { path: string; digest: string }; configurations: string[]; artifacts: { name: string; digest: string }[] };

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !v.includes("\0");
const version = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const path = (v: unknown): v is string => text(v) && !/[\\:\x00-\x1f]/.test(v) && v.split("/").every(p => p !== "" && p !== "." && p !== "..");
const strings = (v: unknown, nonempty = false): v is string[] => Array.isArray(v) && (!nonempty || v.length > 0) && v.every(text) && new Set(v).size === v.length;
const keys = (v: unknown, names: string): v is Obj => object(v) && Object.keys(v).length === names.split(" ").length && names.split(" ").every(k => Object.prototype.hasOwnProperty.call(v, k));
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const unique = (values: unknown[]) => new Set(values).size === values.length;
function url(v: unknown, mail = false): boolean {
  if (mail && typeof v === "string" && /^mailto:[^\s@]+@[^\s@]+$/.test(v)) return true;
  if (!text(v) || [...v].length > 2048 || /\s|\\/.test(v) || !/^https:\/\//.test(v)) return false;
  const rawHost = v.slice(8).split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9.:[\]-]+$/.test(rawHost) || rawHost.includes("@")) return false;
  try {
    const u = new URL(v); const host = u.hostname;
    return !!host && !u.username && !u.password && (!u.port || Number(u.port) >= 1) && (host.startsWith("[") || (host.length <= 253 && host.replace(/\.$/, "").split(".").every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))));
  } catch { return false; }
}
function purl(v: unknown, pin: string | null = null): boolean {
  if (!text(v) || /\s|\\/.test(v) || !/^pkg:[a-z][a-z0-9.+-]*\/.+/.test(v)) return false;
  const tail = v.split(/[?#]/)[0].split("/").at(-1)!;
  try { return (tail.includes("@") ? decodeURIComponent(tail.slice(tail.lastIndexOf("@") + 1)) : null) === pin; } catch { return false; }
}

// RFC 8785 uses ECMAScript number serialization and UTF-16 property ordering.
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const n = value.charCodeAt(i);
      if (n >= 0xd800 && n <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error("invalid-unicode"); }
      else if (n >= 0xdc00 && n <= 0xdfff) throw Error("invalid-unicode");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${canonical(k)}:${canonical(value[k])}`).join(",")}}`;
  throw Error("invalid-json");
}
export const descriptorDigest = (value: unknown): string => bytesToHex(sha256(new TextEncoder().encode(canonical(value))));
export function isClassReference(v: unknown): v is ClassReference {
  return keys(v, "name version digest") && /^ourapps-ae\/[a-z][a-z0-9-]*$/.test(v.name) && version(v.version) && digest(v.digest);
}
export function validLicence(v: unknown): boolean {
  if (typeof v !== "string" || !v.length || v.length > 512 || v !== v.trim()) return false;
  const tokens: string[] = []; let pos = 0;
  while (pos < v.length) { const m = /^\s*(\(|\)|[A-Za-z0-9.:+-]+)/.exec(v.slice(pos)); if (!m) return false; tokens.push(m[1]); pos += m[0].length; }
  let i = 0;
  const identifier = (s: string | undefined, prefix: string): boolean => {
    if (!s || ["AND", "OR", "WITH"].includes(s)) return false;
    if (s.startsWith("DocumentRef-")) return new RegExp(`^DocumentRef-[A-Za-z0-9.-]+:${prefix}[A-Za-z0-9.-]+$`).test(s);
    if (s.startsWith(prefix)) return new RegExp(`^${prefix}[A-Za-z0-9.-]+$`).test(s);
    return new RegExp(`^[A-Za-z0-9.-]+${prefix === "LicenseRef-" ? "\\+?" : ""}$`).test(s);
  };
  const primary = (): boolean => {
    if (tokens[i] === "(") { i++; if (!disjunction() || tokens[i++] !== ")") return false; return true; }
    if (!identifier(tokens[i++], "LicenseRef-")) return false;
    if (tokens[i] === "WITH") { i++; return identifier(tokens[i++], "AdditionRef-"); } return true;
  };
  const conjunction = (): boolean => { if (!primary()) return false; while (tokens[i] === "AND") { i++; if (!primary()) return false; } return true; };
  const disjunction = (): boolean => { if (!conjunction()) return false; while (tokens[i] === "OR") { i++; if (!conjunction()) return false; } return true; };
  return disjunction() && i === tokens.length;
}

type V = [bigint, bigint, bigint];
type Bounds = { lower: V; upper: V | null };
const compare = (a: V, b: V): number => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
function intersect(a: Bounds, b: Bounds): Bounds {
  const lower = compare(a.lower, b.lower) > 0 ? a.lower : b.lower;
  const upper = a.upper === null ? b.upper : b.upper === null ? a.upper : compare(a.upper, b.upper) < 0 ? a.upper : b.upper;
  if (upper && compare(lower, upper) >= 0) throw Error("compatibility-range-conflict");
  return { lower, upper };
}
export function rangeBounds(expression: unknown): Bounds {
  if (!text(expression)) throw Error("invalid-version-range");
  let result: Bounds = { lower: [0n, 0n, 0n], upper: null };
  for (const term of expression.split(" ")) {
    const m = /^(>=|<=|=|>|<)((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/.exec(term);
    if (!m) throw Error("invalid-version-range");
    const v = m[2].split(".").map(BigInt) as V; const next: V = [v[0], v[1], v[2] + 1n];
    result = intersect(result, { lower: [">=", ">", "="].includes(m[1]) ? m[1] === ">" ? next : v : [0n, 0n, 0n], upper: ["<=", "<", "="].includes(m[1]) ? m[1] === "<" ? v : next : null });
  }
  return result;
}

export function validateDescriptor(value: unknown, patterns: readonly string[]): string[] {
  try { return descriptorProblems(value, patterns); } catch { return ["class-invalid-structure"]; }
}

function descriptorProblems(value: unknown, patterns: readonly string[]): string[] {
  const e: string[] = []; const need = (ok: unknown, code: string) => { if (!ok) e.push(code); };
  if (!keys(value, "format name version provides requires settings inventory verification")) return ["class-fields"];
  const c = value;
  need(c.format === 1 && isClassReference({ name: c.name, version: c.version, digest: "0".repeat(64) }), "class-identity");
  const inventory = list(c.inventory);
  need(inventory.length && inventory.every(v => keys(v, "path digest") && path(v.path) && digest(v.digest)) && unique(inventory.map(v => v.path)), "class-inventory");
  const paths = new Set(inventory.map(v => v.path));
  for (const key of ["provides", "requires"]) {
    need(Array.isArray(c[key]), "class-ports");
    for (const p of list(c[key])) {
      need(keys(p, key === "provides" ? "type version path modules" : "type version") && text(p.type) && version(p.version), "class-port");
      if (key === "provides") {
        need(path(p.path) && paths.has(p.path), "class-interface-inventory");
        need(object(p.modules) && Object.keys(p.modules).length > 0 && Object.entries(p.modules).every(([platform, entries]) => (FOUNDATION_PLATFORMS as readonly string[]).includes(platform) && strings(entries, true) && entries.every(path)), "class-modules");
      }
    }
    need(unique(list(c[key]).map(p => `${p.type}@${p.version}`)), "class-ports-duplicate");
  }
  const s = c.settings;
  need(keys(s, "type properties required additionalProperties") && s.type === "object" && s.additionalProperties === false && object(s.properties) && strings(s.required) && s.required.every((k: string) => k in s.properties), "class-settings");
  if (object(s?.properties)) for (const [id, prop] of Object.entries(s.properties)) {
    need(text(id) && object(prop) && (prop.type === "string" ? keys(prop, "type pattern") && patterns.includes(prop.pattern) : keys(prop, "type") && ["boolean", "integer"].includes(prop.type)), "class-setting-pattern");
  }
  const command = (argv: unknown, tools: Obj) => Array.isArray(argv) && argv.length > 0 && argv.every(text) && (argv[0].startsWith("./") ? paths.has(argv[0].slice(2)) : argv.length >= 2 && argv[0] in tools && paths.has(argv[1]));
  need(Array.isArray(c.verification) && c.verification.length > 0, "class-verification");
  for (const suite of list(c.verification)) {
    if (!keys(suite, "id root argv cwd prepare tools fixtures locks network timeoutSeconds expectedExit scope requirements")) { e.push("class-suite-fields"); continue; }
    need(typeof suite.id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(suite.id), "class-suite-id");
    need(suite.root === "package" && suite.scope === "required-local" && Array.isArray(suite.requirements) && suite.requirements.length === 0 && suite.cwd === ".", "class-suite-scope");
    need(object(suite.tools) && Object.entries(suite.tools).every(([tool, pin]) => /^[A-Za-z0-9_-]+$/.test(tool) && typeof pin === "string" && /^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,2}$/.test(pin)), "class-tools");
    need(object(suite.tools) && command(suite.argv, suite.tools), "class-command-inventory");
    need(Array.isArray(suite.prepare) && suite.prepare.every((p: any) => keys(p, "argv cwd network") && p.cwd === "." && typeof p.network === "boolean" && object(suite.tools) && command(p.argv, suite.tools)), "class-prepare");
    for (const key of ["fixtures", "locks"]) need(strings(suite[key], key === "fixtures") && suite[key].every((p: string) => paths.has(p)), "class-suite-inventory");
    need(typeof suite.network === "boolean" && Number.isInteger(suite.timeoutSeconds) && suite.timeoutSeconds >= 1 && suite.timeoutSeconds <= 900 && suite.expectedExit === 0, "class-suite-limit");
  }
  need(unique(list(c.verification).map(s => s.id)), "class-suite-duplicate");
  return e;
}

export function validateFoundations(value: unknown, kind: "component" | "recipe", patterns: readonly string[]): string[] {
  try { return foundationProblems(value, kind, patterns); } catch { return ["foundations-invalid-structure"]; }
}

function foundationProblems(value: unknown, kind: "component" | "recipe", patterns: readonly string[]): string[] {
  const e: string[] = []; const need = (ok: unknown, code: string) => { if (!ok) e.push(code); };
  if (!keys(value, "licence platforms classes implements upstream compatibility maintenance files artefacts")) return ["foundations: required fields are licence, platforms, classes, implements, upstream, compatibility, maintenance, files, artefacts"];
  const f = value;
  need(validLicence(f.licence), "invalid-licence");
  need(strings(f.platforms, true) && f.platforms.every((p: string) => (FOUNDATION_PLATFORMS as readonly string[]).includes(p)), "invalid-platforms");
  need(Array.isArray(f.files) && f.files.every((v: any) => keys(v, "path executable") && path(v.path) && typeof v.executable === "boolean") && unique(f.files.map((v: any) => v.path)), "invalid-files");
  const files = new Set(list(f.files).map(v => v.path));
  const slotCondition = (v: unknown) => {
    const ids = typeof v === "string" ? [v] : Array.isArray(v) && v.length >= 2 ? v : [];
    return ids.length > 0 && unique(ids) && ids.every(id => typeof id === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(id) && id !== "application");
  };
  need(Array.isArray(f.artefacts) && f.artefacts.every((v: any) => object(v) && !("component" in v && "withoutComponent" in v) && keys(v, "source destination template executable" + ("component" in v ? " component" : "") + ("withoutComponent" in v ? " withoutComponent" : "")) && path(v.source) && files.has(v.source) && path(v.destination) && typeof v.template === "boolean" && typeof v.executable === "boolean" && (!("component" in v) || slotCondition(v.component)) && (!("withoutComponent" in v) || slotCondition(v.withoutComponent))), "invalid-artefacts");
  need(Array.isArray(f.classes), "invalid-classes");
  const identities: string[] = []; const refs: string[] = []; const bound = new Map<string, string>();
  for (const item of list(f.classes)) {
    if (!keys(item, "reference descriptor") || !isClassReference(item.reference)) { e.push("invalid-class-reference"); continue; }
    const errors = validateDescriptor(item.descriptor, patterns); e.push(...errors);
    if (errors.length) continue;
    const c = item.descriptor;
    try { need(item.reference.name === c.name && item.reference.version === c.version && item.reference.digest === descriptorDigest(c), "class-digest"); } catch { e.push("class-digest"); }
    identities.push(`${item.reference.name}@${item.reference.version}`); refs.push(canonical(item.reference));
    for (const entry of c.inventory) {
      need(files.has(entry.path), "class-file-missing");
      need(!bound.has(entry.path) || bound.get(entry.path) === entry.digest, "class-file-conflict"); bound.set(entry.path, entry.digest);
    }
  }
  need(unique(identities), "class-identity-conflict");
  need(Array.isArray(f.implements) && (kind !== "component" || f.implements.length > 0), "class-implementation");
  for (const ref of list(f.implements)) need(isClassReference(ref) && refs.includes(canonical(ref)), "class-unavailable");
  need(unique(list(f.implements).map(v => JSON.stringify(v))), "class-implementation-duplicate");
  need(Array.isArray(f.upstream), "invalid-upstream");
  for (const u of list(f.upstream)) {
    if (!keys(u, "name version revision repository purl licence notices delivery")) { e.push("upstream-fields"); continue; }
    need([u.name, u.version].every(text) && (u.revision === null || text(u.revision)) && purl(u.purl, u.version) && url(u.repository), "upstream-provenance");
    need(validLicence(u.licence), "upstream-licence");
    need(strings(u.notices, true) && u.notices.every((p: string) => path(p) && files.has(p)), "upstream-notice-missing");
    const d = u.delivery;
    need(u.revision !== null || d?.manager === "gradle" || object(d?.gradleWrapper), "upstream-source-revision");
    if (object(d) && d.kind === "bundled") {
      need(keys(d, "gradleWrapper" in d ? "kind files gradleWrapper" : "kind files") && Array.isArray(d.files) && d.files.length && d.files.every((v: any) => keys(v, "path digest") && path(v.path) && files.has(v.path) && digest(v.digest)) && unique(d.files.map((v: any) => v.path)), "upstream-source-missing");
      if ("gradleWrapper" in d) {
        const w = d.gradleWrapper;
        need(keys(w, "jar properties distribution") && path(w.jar) && w.jar.endsWith("gradle-wrapper.jar") && w.jar !== w.properties && [w.jar, w.properties].every(p => list(d.files).some(f => f.path === p)) && keys(w.distribution, "url digest") && url(w.distribution.url) && digest(w.distribution.digest), "upstream-wrapper-inventory");
        try { const address = new URL(w.distribution.url); need(!address.search && !address.hash && [`gradle-${u.version}-bin.zip`, `gradle-${u.version}-all.zip`].includes(address.pathname.split("/").at(-1)!), "upstream-distribution-version"); } catch { e.push("upstream-distribution-version"); }
      }
    }
    else {
      const manager = d?.manager;
      const extras = manager === "npm" ? " packagePath integrity" : manager === "gradle" ? " verification configurations artifacts" : "";
      need(keys(d, "kind manager lock digest" + extras) && d.kind === "build-time" && path(d.lock) && files.has(d.lock) && digest(d.digest) && ["npm", "swift", "gradle"].includes(manager), "upstream-lock");
      need(typeof u.purl === "string" && u.purl.startsWith(`pkg:${manager === "gradle" ? "maven" : manager}/`), "unsupported-upstream-delivery");
      if (manager === "npm") {
        const segment = "node_modules/(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+";
        need(path(d.packagePath) && new RegExp(`^${segment}(?:/${segment})*$`).test(d.packagePath) && d.packagePath.split("node_modules/").at(-1) === u.name && decodeURIComponent(u.purl.slice(8).split(/[?#]/)[0].slice(0, u.purl.slice(8).split(/[?#]/)[0].lastIndexOf("@"))) === u.name, "upstream-package-path");
        let integrity = false; try { integrity = typeof d.integrity === "string" && d.integrity.startsWith("sha512-") && atob(d.integrity.slice(7)).length === 64 && btoa(atob(d.integrity.slice(7))) === d.integrity.slice(7); } catch { /* Invalid base64. */ }
        need(integrity, "upstream-integrity");
      } else if (manager === "swift") need(typeof u.revision === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(u.revision), "upstream-source-revision");
      else if (manager === "gradle") {
        const coordinate = /^pkg:maven\/([^/:@]+)\/([^/:@]+)@(.+)$/.exec(decodeURIComponent(u.purl));
        need(coordinate && coordinate[2] === u.name && coordinate[3] === u.version, "upstream-coordinate");
        need(keys(d.verification, "path digest") && path(d.verification.path) && files.has(d.verification.path) && digest(d.verification.digest), "upstream-verification");
        need(strings(d.configurations, true) && d.configurations.every((v: string) => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v)), "upstream-configuration");
        need(Array.isArray(d.artifacts) && d.artifacts.length > 0 && d.artifacts.every((v: any) => keys(v, "name digest") && path(v.name) && !v.name.includes("/") && digest(v.digest)) && unique(d.artifacts.map((v: any) => v.name)), "upstream-artifacts");
      }
    }
  }
  const wrappers = new Set(list(f.upstream).flatMap(u => u.delivery?.gradleWrapper ? [u.delivery.gradleWrapper.jar] : []));
  for (const file of files) if (file.split("/").at(-1) === "gradle-wrapper.jar") need(wrappers.has(file), "upstream-wrapper-unattributed");
  need(unique(list(f.upstream).map(u => u.purl)), "upstream-duplicate");
  const c = f.compatibility;
  if (!keys(c, "runtimes frameworks dependencies styles")) e.push("compatibility-fields");
  else {
    for (const kind of ["runtimes", "frameworks"]) {
      need(object(c[kind]), "compatibility-map");
      if (object(c[kind])) for (const [name, expr] of Object.entries(c[kind])) {
        need(text(name), "compatibility-name");
        if (kind === "frameworks") need(keys(expr, "name range") && text(expr.name), "framework-fields");
        try { rangeBounds(kind === "frameworks" ? (expr as any)?.range : expr); } catch (error) { e.push((error as Error).message); }
      }
    }
    need(Array.isArray(c.dependencies) && c.dependencies.every((d: any) => keys(d, "name version isolation") && purl(d.name) && typeof d.version === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d.version) && !/^latest\./i.test(d.version) && !/^(LATEST|RELEASE)$/i.test(d.version) && !/-SNAPSHOT$/i.test(d.version) && ["shared", "isolated"].includes(d.isolation)) && unique(c.dependencies.map((d: any) => d.name)), "compatibility-dependencies");
    const s = c.styles;
    need(keys(s, "scope namespaces conflicts") && ["none", "scoped", "global"].includes(s.scope) && strings(s.namespaces, s.scope !== "none") && strings(s.conflicts) && (s.scope !== "none" || (!s.namespaces.length && !s.conflicts.length)), "stylesheet-scope");
  }
  const m = f.maintenance;
  need(keys(m, "owners contact repository updates") && strings(m.owners, true) && url(m.contact, true) && url(m.repository) && keys(m.updates, "source strategy") && url(m.updates.source) && ["manual", "release"].includes(m.updates.strategy), "maintenance-fields");
  return e;
}

export function classDescriptor(reference: ClassReference, authority: Pick<Foundations, "classes">): ClassDescriptor | null {
  const entry = authority.classes.find(c => canonical(c.reference) === canonical(reference));
  if (!entry || descriptorDigest(entry.descriptor) !== reference.digest) return null;
  return entry.descriptor;
}

export function selectedTargets(authority: Foundations, answers: Record<string, unknown>): string[] {
  if (!("targets" in answers)) return [...authority.platforms];
  if (!strings(answers.targets, true) || !answers.targets.every(t => authority.platforms.includes(t))) throw Error("unsupported-platform:answers.targets");
  return [...new Set([...answers.targets, ...(authority.platforms.includes("server") ? ["server"] : [])])].sort();
}

export function graphProblems(manifests: { name: string; foundations: Foundations }[], targets?: string[]): string[] {
  const errors: string[] = []; const identities = new Map<string, string>(); const pins = new Map<string, string>(); const ranges = new Map<string, Bounds>(); const frameworks = new Map<string, string>(); const styles: Compatibility["styles"][] = [];
  for (const { name, foundations: f } of manifests) {
    if (targets && !targets.some(t => f.platforms.includes(t))) errors.push(`unsupported-platform:${name}`);
    for (const { reference: r } of f.classes) { const key = `${r.name}@${r.version}`; if (identities.has(key) && identities.get(key) !== r.digest) errors.push(`class-identity-conflict:${r.name}`); identities.set(key, r.digest); }
    for (const kind of ["runtimes", "frameworks"] as const) for (const [name, value] of Object.entries(f.compatibility[kind])) {
      const key = `${kind}.${name}`; const expr = typeof value === "string" ? value : value.range;
      if (typeof value !== "string") { if (frameworks.has(name) && frameworks.get(name) !== value.name) errors.push(`framework-conflict:${name}`); frameworks.set(name, value.name); }
      try { const bound = rangeBounds(expr); ranges.set(key, ranges.has(key) ? intersect(ranges.get(key)!, bound) : bound); } catch { errors.push(`compatibility-range-conflict:${key}`); }
    }
    for (const d of f.compatibility.dependencies) if (d.isolation === "shared") { if (pins.has(d.name) && pins.get(d.name) !== d.version) errors.push(`shared-dependency-conflict:${d.name}`); pins.set(d.name, d.version); }
    const current = f.compatibility.styles;
    for (const other of styles) if ((current.namespaces.some(n => other.namespaces.includes(n)) && [current.scope, other.scope].includes("global")) || current.conflicts.some(n => other.namespaces.includes(n)) || other.conflicts.some(n => current.namespaces.includes(n))) errors.push(`stylesheet-conflict:${name}`);
    styles.push(current);
  }
  return errors;
}
