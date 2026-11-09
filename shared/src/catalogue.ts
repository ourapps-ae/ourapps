// Recipe library and component catalogue: names, versions, recipe.json (format 1) and the
// catalogue entry for a component version. Format authority: .opencode/knowledge/component-standard.md
// in the workspace root.
import { isAppTarget, type AppTarget } from "./targets.js";

export const CATALOGUE_FORMAT = 1;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const PORT_TYPE = /^[A-Za-z][A-Za-z0-9_.:/-]{0,79}$/;

// Names a recipe or component may not take, because routes use them.
export const RESERVED_NAMES: ReadonlySet<string> = new Set(["search"]);

export const QUESTION_TYPES = ["set", "choice", "boolean", "integer", "text", "secretRef", "account"] as const;
export type QuestionType = typeof QUESTION_TYPES[number];

export const COST_KINDS = ["free", "paid", "metered", "none"] as const;
export type CostKind = typeof COST_KINDS[number];

export const LIMITS = {
  recipeJson: 200_000,
  description: 20_000,
  diagram: 200_000,
  summary: 300,
  title: 80,
  componentDescription: 500,
  components: 100,
  questions: 60,
  connections: 500,
  answerSets: 50,
  tags: 20,
  screenshots: 10,
} as const;

export function isCatalogueSlug(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 40 && SLUG.test(value) && !RESERVED_NAMES.has(value);
}

export function isCatalogueScope(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 39 && SLUG.test(value);
}

export function isCatalogueName(value: unknown): value is string {
  return splitName(value) !== null;
}

// "ourapps-ae/seating" -> { scope: "ourapps-ae", slug: "seating" }
export function splitName(value: unknown): { scope: string; slug: string } | null {
  if (typeof value !== "string") return null;
  const parts = value.split("/");
  if (parts.length !== 2 || !isCatalogueScope(parts[0]) || !isCatalogueSlug(parts[1])) return null;
  return { scope: parts[0], slug: parts[1] };
}

export function isVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export function newestVersion(versions: string[]): string | null {
  return versions.reduce<string | null>((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
}

export function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

export function isRepository(value: unknown): value is string {
  return typeof value === "string" && REPOSITORY.test(value) && !value.endsWith(".git");
}

export function isReleaseTag(value: unknown): value is string {
  return typeof value === "string" && TAG.test(value) && !value.includes("..") && !value.endsWith("/");
}

export function isAssetName(value: unknown): value is string {
  return typeof value === "string" && ASSET.test(value) && !value.includes("..");
}

// A path inside a package: relative, forward slashes, no parent steps.
export function isPackagePath(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && value.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

export type Result<K extends string, T> = ({ ok: true } & { [P in K]: T }) | { ok: false; errors: string[] };

type Json = unknown;
type Rec = Record<string, Json>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function text(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function unknownKeys(record: Rec, allowed: readonly string[], where: string, errors: string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) errors.push(`${where}: unknown field ${key.slice(0, 40)}`);
}

function stringList(value: unknown, where: string, errors: string[], opts: { max: number; item: (v: unknown) => boolean; what: string; unique?: boolean }): string[] {
  if (!Array.isArray(value) || value.length > opts.max) {
    errors.push(`${where} must be a list of at most ${opts.max} ${opts.what}`);
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (!opts.item(item)) {
      errors.push(`${where} has an invalid entry: ${String(item).slice(0, 40)}`);
      continue;
    }
    if (opts.unique !== false && out.includes(item as string)) errors.push(`${where} lists ${String(item)} twice`);
    out.push(item as string);
  }
  return out;
}

// ---------------------------------------------------------------- shared pieces

export interface Targets {
  client: AppTarget[];
  server: string[];
}

function readTargets(value: unknown, where: string, errors: string[]): Targets {
  const out: Targets = { client: [], server: [] };
  if (!isRecord(value)) {
    errors.push(`${where} must be an object with client and server lists`);
    return out;
  }
  unknownKeys(value, ["client", "server"], where, errors);
  out.client = stringList(value.client, `${where}.client`, errors, { max: 6, item: isAppTarget, what: "client targets (ios, android, web, macos, windows, tvos)" }) as AppTarget[];
  out.server = stringList(value.server ?? [], `${where}.server`, errors, { max: 10, item: (v) => typeof v === "string" && SLUG.test(v) && v.length <= 40, what: "server target names" });
  return out;
}

function readTags(value: unknown, where: string, errors: string[]): string[] {
  return stringList(value ?? [], where, errors, { max: LIMITS.tags, item: (v) => typeof v === "string" && SLUG.test(v) && v.length <= 30, what: "lowercase tags" });
}

export interface ReleasePointer {
  repository: string;
  tag: string;
}

export interface BundlePointer {
  asset: string;
  digest: string;
}

function readRelease(source: unknown, bundle: unknown, errors: string[]): { source: ReleasePointer; bundle: BundlePointer } {
  const out = { source: { repository: "", tag: "" }, bundle: { asset: "", digest: "" } };
  if (!isRecord(source)) errors.push("source must be an object with repository and tag");
  else {
    unknownKeys(source, ["repository", "tag"], "source", errors);
    if (!isRepository(source.repository)) errors.push("source.repository must be owner/name");
    else out.source.repository = source.repository;
    if (!isReleaseTag(source.tag)) errors.push("source.tag must be a release tag");
    else out.source.tag = source.tag;
  }
  if (!isRecord(bundle)) errors.push("bundle must be an object with asset and digest");
  else {
    unknownKeys(bundle, ["asset", "digest"], "bundle", errors);
    if (!isAssetName(bundle.asset)) errors.push("bundle.asset must be a release asset file name");
    else out.bundle.asset = bundle.asset;
    if (!isDigest(bundle.digest)) errors.push("bundle.digest must be sha256:<64 lowercase hex>");
    else out.bundle.digest = bundle.digest;
  }
  return out;
}

// ---------------------------------------------------------------- recipe.json

// A condition over answers, used by askWhen and includedWhen.
export type Condition =
  | { question: string; equals: Json }
  | { question: string; in: Json[] }
  | { question: string; contains: Json }
  | { question: string; truthy: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

// The instance id of the recipe's own application-specific component. No component may use it.
export const APPLICATION_INSTANCE = "application";

export const SCALE_KEYS = ["concurrentPeople", "requestsPerDay", "storedMegabytes"] as const;
export type ScaleKey = typeof SCALE_KEYS[number];

export type SetLiteral = string | number | boolean;

// The value a question effect gives a setting: a literal, "$answer", or one of the object forms.
export type SetValue = SetLiteral | { map: Record<string, SetLiteral> } | { fromScale: ScaleKey } | { template: string } | { ref: string };

export interface RecipeComponent {
  id: string;
  name: string;
  version: string;
  configuration: Rec;
  includedWhen: Condition | null;
}

export interface RecipeJob {
  id: string;
  candidates: { component: string; profile: string; includedWhen?: Condition }[];
  overrideQuestion?: string;
}

export interface RecipeQuestion {
  id: string;
  ask: string;
  askAgent?: string;
  askWhen?: Condition;
  type: QuestionType;
  options?: (string | number)[];
  default?: Json;
  min?: number;
  max?: number;
  effects: { sets: Record<string, SetValue> }[];
}

export type SettingValues = Record<string, SetLiteral>;

// A setting a component collects (component.json `collect`).
export interface SettingDeclaration {
  id: string;
  type: "string" | "boolean" | "integer";
  grammar: string;
  required?: boolean;
  secret?: boolean;
}

// What the recipe check can also verify when the component data is at hand. Anything absent is accepted unchecked.
// Keys are component names (`scope/name`); `application` holds the recipe's own component.
export interface RecipeContext {
  settings?: Record<string, SettingDeclaration[]>;
  profiles?: Record<string, { id: string; settings?: SettingValues }[]>;
}

// aepm's string grammars (aepm/application.py).
export const GRAMMARS: Readonly<Record<string, RegExp>> = {
  identifier: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
  qualified: /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/,
  slug: /^[a-z][a-z0-9-]{0,63}$/,
  label: /^[A-Za-z][A-Za-z0-9 -]{0,63}$/,
  environment: /^[A-Z][A-Z0-9_]{0,63}$/,
  address: /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9_/-]*)?$/,
};

const SECRET_REFERENCE = /^[A-Za-z][A-Za-z0-9_./-]{0,127}$/;
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

export function matchesGrammar(grammar: string, value: string): boolean {
  const pattern = GRAMMARS[grammar];
  if (!pattern || !pattern.test(value)) return false;
  if (grammar !== "address") return true;
  try {
    const url = new URL(value);
    return url.hostname.split(".").every((part) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(part)) && (url.port === "" || (Number(url.port) >= 1 && Number(url.port) <= 65535));
  } catch {
    return false;
  }
}

// "<question> is <value>" and so on; `words` lets a page choose its own verbs.
export function describeCondition(c: Condition, value: (v: unknown) => string, words: { is: string; includes: string } = { is: "is", includes: "includes" }): string {
  if ("all" in c) return c.all.map((x) => `(${describeCondition(x, value, words)})`).join(" and ");
  if ("any" in c) return c.any.map((x) => `(${describeCondition(x, value, words)})`).join(" or ");
  if ("not" in c) return `not (${describeCondition(c.not, value, words)})`;
  if ("equals" in c) return `${c.question} ${words.is} ${value(c.equals)}`;
  if ("in" in c) return `${c.question} ${words.is} one of ${c.in.map(value).join(", ")}`;
  if ("contains" in c) return `${c.question} ${words.includes} ${value(c.contains)}`;
  return `${c.question} is set`;
}

export interface Recipe {
  format: 1;
  name: string;
  version: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  targets: Targets;
  components: RecipeComponent[];
  jobs: RecipeJob[];
  scale: { question: string; bands: { id: string; label: string; load: Record<string, number> }[] } | null;
  questions: RecipeQuestion[];
  connections: { source: { instance: string; port: string }; target: { instance: string; port: string } }[];
  tests: { defaultAnswers: Rec; answerSets: { id: string; answers: Rec }[] };
  page: { description: string; diagram: string; screenshots: string[] };
  instructions: string;
}

const RECIPE_FIELDS = ["format", "name", "version", "title", "summary", "category", "tags", "targets", "components", "jobs", "scale", "questions", "connections", "tests", "page", "instructions"];

function isLiteral(value: unknown): value is SetLiteral {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

// What a literal compared in a condition or a `sets` value may be: a string, number or boolean.
function conditionValueError(q: RecipeQuestion, value: unknown): string | null {
  if (!isLiteral(value)) return "must be a string, number or boolean";
  switch (q.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "must be true or false";
    case "integer":
      return Number.isSafeInteger(value) ? null : "must be an integer";
    case "choice":
    case "set":
      return q.options?.includes(value as string | number) ? null : "must be one of the question's options";
    default:
      return typeof value === "string" ? null : "must be text";
  }
}

const CONDITION_LEAVES = ["equals", "in", "contains", "truthy"] as const;
const CONDITION_DEPTH = 8;

function readCondition(value: unknown, where: string, byId: ReadonlyMap<string, RecipeQuestion>, errors: string[], depth = 0): Condition | null {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  if (depth > CONDITION_DEPTH) {
    errors.push(`${where} is nested more than ${CONDITION_DEPTH} levels deep`);
    return null;
  }
  const combinators = (["all", "any", "not"] as const).filter((k) => k in value);
  if ("question" in value) {
    unknownKeys(value, ["question", ...CONDITION_LEAVES], where, errors);
    const forms = CONDITION_LEAVES.filter((k) => k in value);
    if (forms.length !== 1) {
      errors.push(`${where} needs exactly one of equals, in, contains or truthy`);
      return null;
    }
    const q = typeof value.question === "string" ? byId.get(value.question) : undefined;
    if (!q) {
      errors.push(`${where}.question must name one of the recipe's questions`);
      return null;
    }
    const form = forms[0];
    const check = (v: unknown, at: string): boolean => {
      const problem = conditionValueError(q, v);
      if (problem) errors.push(`${at} ${problem}`);
      return problem === null;
    };
    if (form === "truthy") {
      if (value.truthy !== true) errors.push(`${where}.truthy must be true`);
      return { question: q.id, truthy: true };
    }
    if (form === "contains") {
      if (q.type !== "set") errors.push(`${where}.contains applies to set questions; ${q.id} is ${q.type}`);
      check(value.contains, `${where}.contains`);
      return { question: q.id, contains: value.contains };
    }
    if (q.type === "set") errors.push(`${where}.${form} cannot compare the set question ${q.id}; use contains`);
    if (form === "equals") {
      check(value.equals, `${where}.equals`);
      return { question: q.id, equals: value.equals };
    }
    if (!Array.isArray(value.in) || value.in.length === 0 || value.in.length > 50) {
      errors.push(`${where}.in must be a list of 1 to 50 values`);
      return { question: q.id, in: [] };
    }
    value.in.forEach((v, i) => check(v, `${where}.in[${i}]`));
    return { question: q.id, in: value.in };
  }
  if (combinators.length !== 1 || Object.keys(value).length !== 1) {
    errors.push(`${where} needs a question with one of equals, in, contains or truthy, or exactly one of all, any or not`);
    return null;
  }
  const kind = combinators[0];
  if (kind === "not") {
    const inner = readCondition(value.not, `${where}.not`, byId, errors, depth + 1);
    return inner ? { not: inner } : null;
  }
  const list = value[kind];
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) {
    errors.push(`${where}.${kind} must be a list of 1 to 20 conditions`);
    return null;
  }
  const items = list.map((c, i) => readCondition(c, `${where}.${kind}[${i}]`, byId, errors, depth + 1));
  if (items.some((c) => c === null)) return null;
  return kind === "all" ? { all: items as Condition[] } : { any: items as Condition[] };
}

function readOptionalCondition(value: unknown, where: string, byId: ReadonlyMap<string, RecipeQuestion>, errors: string[]): Condition | null {
  if (value === null || value === undefined) return null;
  return readCondition(value, where, byId, errors);
}

function conditionQuestions(c: Condition, out = new Set<string>()): Set<string> {
  if ("all" in c) c.all.forEach((x) => conditionQuestions(x, out));
  else if ("any" in c) c.any.forEach((x) => conditionQuestions(x, out));
  else if ("not" in c) conditionQuestions(c.not, out);
  else out.add(c.question);
  return out;
}

// The answers a condition certainly confines each question to: only equals and in count; anything else confines nothing.
function confinements(c: Condition): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if ("equals" in c) out.set(c.question, new Set([JSON.stringify(c.equals)]));
  else if ("in" in c) out.set(c.question, new Set(c.in.map((v) => JSON.stringify(v))));
  else if ("all" in c)
    for (const part of c.all)
      for (const [q, values] of confinements(part)) {
        const have = out.get(q);
        out.set(q, have ? new Set([...have].filter((v) => values.has(v))) : values);
      }
  else if ("any" in c) {
    const branches = c.any.map(confinements);
    for (const q of branches[0]?.keys() ?? []) if (branches.every((b) => b.has(q))) out.set(q, new Set(branches.flatMap((b) => [...b.get(q)!])));
  }
  return out;
}

// True only when no answers can satisfy both conditions: they confine one question to values that do not overlap.
function exclusive(a: Condition | undefined, b: Condition | undefined): boolean {
  if (!a || !b) return false;
  const left = confinements(a);
  const right = confinements(b);
  for (const [q, values] of left) {
    const other = right.get(q);
    if (other && [...values].every((v) => !other.has(v))) return true;
  }
  return false;
}

function checkAnswer(q: RecipeQuestion, value: unknown, where: string, errors: string[]): void {
  if (value === null || value === undefined) return;
  const inOptions = (v: unknown) => !q.options || q.options.includes(v as string | number);
  switch (q.type) {
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${where} must be true or false`);
      break;
    case "integer":
      if (!Number.isSafeInteger(value) || (q.min !== undefined && (value as number) < q.min) || (q.max !== undefined && (value as number) > q.max)) errors.push(`${where} must be an integer within the question's range`);
      break;
    case "choice":
      if (!inOptions(value)) errors.push(`${where} must be one of the options`);
      break;
    case "set":
      if (!Array.isArray(value) || !value.every(inOptions)) errors.push(`${where} must be a list drawn from the options`);
      break;
    case "text":
    case "account":
      if (typeof value !== "string" || value.length > 500) errors.push(`${where} must be text`);
      break;
    case "secretRef":
      if (typeof value !== "string" || !SECRET_REFERENCE.test(value)) errors.push(`${where} must be the name of a secret reference, never a secret value`);
      break;
  }
}

// ---------------------------------------------------------------- settings

// Why a literal cannot be the value of a setting, or null when it can.
function literalProblem(value: unknown, s: SettingDeclaration): string | null {
  if (!isLiteral(value)) return "is not a string, number or boolean";
  if (s.type === "boolean") return typeof value === "boolean" ? null : `is not a boolean, which setting ${s.id} takes`;
  if (s.type === "integer") return typeof value === "number" && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX ? null : `is not a 32-bit integer, which setting ${s.id} takes`;
  if (typeof value !== "string") return `is not text, which setting ${s.id} takes`;
  if (GRAMMARS[s.grammar] && !matchesGrammar(s.grammar, value)) return `does not satisfy the ${s.grammar} grammar of setting ${s.id}`;
  return null;
}

const TEMPLATE_TOKEN = /\{\{([^{}]*)\}\}/g;

function checkSetValue(value: unknown, q: RecipeQuestion, at: string, decl: SettingDeclaration | undefined, byId: ReadonlyMap<string, RecipeQuestion>, hasScale: boolean, errors: string[]): void {
  const fail = (message: string): void => void errors.push(`${at} ${message}`);
  const literal = (v: unknown, label: string) => {
    if (!isLiteral(v) || (typeof v === "string" && v.startsWith("$"))) return fail(`${label} must be a string, number or boolean literal not starting with $`);
    if (!decl) return;
    if (decl.secret) return fail(`${label} is a literal, but setting ${decl.id} is secret; use {"ref": <secretRef question>}`);
    const problem = literalProblem(v, decl);
    if (problem) fail(`${label} ${problem}`);
  };
  const answerFits = (what: string) => {
    if (!decl) return;
    if (decl.secret) return fail(`${what} gives a value, but setting ${decl.id} is secret; use {"ref": <secretRef question>}`);
    switch (q.type) {
      case "set": {
        if (decl.type !== "string") return fail(`${what} is a space-separated string, but setting ${decl.id} is ${decl.type}`);
        const joined = (q.options ?? []).join(" ");
        if (GRAMMARS[decl.grammar] && !matchesGrammar(decl.grammar, joined)) fail(`${what} joins ${q.id} options with spaces, which the ${decl.grammar} grammar of setting ${decl.id} refuses`);
        return;
      }
      case "choice":
        for (const o of q.options ?? []) {
          const problem = literalProblem(o, decl);
          if (problem) return fail(`${what}: option ${o} ${problem}`);
        }
        return;
      case "boolean":
        if (decl.type !== "boolean") fail(`${what} is a boolean, but setting ${decl.id} is ${decl.type}`);
        return;
      case "integer":
        if (decl.type !== "integer") fail(`${what} is an integer, but setting ${decl.id} is ${decl.type}`);
        else if ((q.min !== undefined && q.min < INT32_MIN) || (q.max !== undefined && q.max > INT32_MAX)) fail(`${what} may exceed 32 bits, which setting ${decl.id} takes`);
        return;
      default:
        if (decl.type !== "string") fail(`${what} is text, but setting ${decl.id} is ${decl.type}`);
    }
  };

  if (isLiteral(value) && !(typeof value === "string" && value.startsWith("$"))) return literal(value, "value");
  if (typeof value === "string") {
    if (value !== "$answer") return fail(`value ${value.slice(0, 40)} is not a known form; use a literal, "$answer", or an object with map, fromScale, template or ref`);
    if (q.type === "secretRef") return fail(`value "$answer" on the secretRef question ${q.id} must be {"ref": "${q.id}"}`);
    return answerFits('"$answer"');
  }
  if (!isRecord(value)) return fail("value must be a literal, \"$answer\", or an object with map, fromScale, template or ref");
  const keys = Object.keys(value);
  const form = keys.length === 1 ? keys[0] : null;
  switch (form) {
    case "map": {
      const map = value.map;
      if (q.type !== "choice") return fail(`map applies to choice questions; ${q.id} is ${q.type}`);
      if (!isRecord(map)) return fail("map must be an object from each option to a literal");
      const options = (q.options ?? []).map(String);
      for (const key of Object.keys(map)) if (!options.includes(key)) fail(`map names ${key.slice(0, 40)}, which is not an option of ${q.id}`);
      for (const option of options) {
        if (!(option in map)) fail(`map has no value for option ${option}`);
        else literal(map[option], `map[${option}]`);
      }
      return;
    }
    case "fromScale":
      if (typeof value.fromScale !== "string" || !(SCALE_KEYS as readonly string[]).includes(value.fromScale)) return fail(`fromScale must be one of ${SCALE_KEYS.join(", ")}`);
      if (!hasScale) fail("fromScale needs the recipe to have a scale");
      if (decl && decl.type !== "integer") fail(`fromScale gives a number, but setting ${decl.id} is ${decl.type}`);
      return;
    case "template": {
      const template = value.template;
      if (typeof template !== "string" || template.length === 0 || template.length > 200) return fail("template must be text of at most 200 characters");
      const tokens = [...template.matchAll(TEMPLATE_TOKEN)].map((m) => m[1]);
      if (tokens.length === 0 || tokens.some((t) => t !== "answer") || template.replace(TEMPLATE_TOKEN, "").match(/[{}]/)) return fail("template must contain {{answer}} and no other braces");
      if (q.type === "set" || q.type === "secretRef") return fail(`template applies to single-answer questions; ${q.id} is ${q.type}`);
      if (decl) {
        if (decl.secret) return fail(`template gives a value, but setting ${decl.id} is secret; use {"ref": <secretRef question>}`);
        if (decl.type !== "string") return fail(`template gives text, but setting ${decl.id} is ${decl.type}`);
        if (q.type === "choice") for (const o of q.options ?? []) if (GRAMMARS[decl.grammar] && !matchesGrammar(decl.grammar, template.replace(TEMPLATE_TOKEN, String(o)))) return fail(`template with option ${o} does not satisfy the ${decl.grammar} grammar of setting ${decl.id}`);
      }
      return;
    }
    case "ref": {
      const target = typeof value.ref === "string" ? byId.get(value.ref) : undefined;
      if (!target || target.type !== "secretRef") return fail("ref must name a secretRef question of the recipe");
      if (decl && decl.type !== "string") fail(`ref gives a reference name, but setting ${decl.id} is ${decl.type}`);
      return;
    }
    default:
      return fail("value must be an object with exactly one of map, fromScale, template or ref");
  }
}

// "<instance>.<setting>": the longest instance id that prefixes the target.
function resolveTarget(target: string, instances: Iterable<string>): { instance: string; setting: string } | null {
  let best: { instance: string; setting: string } | null = null;
  for (const id of instances) {
    if (!target.startsWith(`${id}.`) || target.length <= id.length + 1) continue;
    if (!best || id.length > best.instance.length) best = { instance: id, setting: target.slice(id.length + 1) };
  }
  return best && IDENTIFIER.test(best.setting) ? best : null;
}

function readQuestion(raw: unknown, index: number, errors: string[]): { question: RecipeQuestion; askWhen: unknown } | null {
  const where = `questions[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  unknownKeys(raw, ["id", "ask", "askAgent", "askWhen", "type", "options", "default", "min", "max", "effects"], where, errors);
  if (typeof raw.id !== "string" || !IDENTIFIER.test(raw.id)) errors.push(`${where}.id must be an identifier`);
  if (!text(raw.ask, 300)) errors.push(`${where}.ask must be text of at most 300 characters`);
  if (raw.askAgent !== undefined && !text(raw.askAgent, 300)) errors.push(`${where}.askAgent must be text of at most 300 characters`);
  const type = (QUESTION_TYPES as readonly unknown[]).includes(raw.type) ? (raw.type as QuestionType) : null;
  if (!type) {
    errors.push(`${where}.type must be one of ${QUESTION_TYPES.join(", ")}`);
    return null;
  }
  const q: RecipeQuestion = { id: String(raw.id), ask: String(raw.ask), type, effects: [] };
  if (raw.askAgent !== undefined && typeof raw.askAgent === "string") q.askAgent = raw.askAgent;
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options) || raw.options.length > 100 || !raw.options.every((o) => (typeof o === "string" && o.length <= 100) || (typeof o === "number" && Number.isFinite(o)))) errors.push(`${where}.options must be a list of at most 100 strings or numbers`);
    else q.options = raw.options as (string | number)[];
  }
  if ((type === "set" || type === "choice") && (!q.options || q.options.length === 0)) errors.push(`${where}: a ${type} question needs options`);
  if (type !== "set" && type !== "choice" && q.options !== undefined) errors.push(`${where}: only set and choice questions have options`);
  for (const key of ["min", "max"] as const) {
    if (raw[key] === undefined) continue;
    if (type !== "integer" || !Number.isSafeInteger(raw[key])) errors.push(`${where}.${key} applies to integer questions and must be an integer`);
    else q[key] = raw[key] as number;
  }
  if (q.min !== undefined && q.max !== undefined && q.min > q.max) errors.push(`${where}.min is above max`);
  if (raw.default !== undefined) {
    if (type === "secretRef" && raw.default !== null) errors.push(`${where}: a secretRef question never has a default`);
    else if (type !== "secretRef") checkAnswer(q, raw.default, `${where}.default`, errors);
    q.default = raw.default;
  }
  if (raw.askWhen !== undefined && type !== "secretRef" && (raw.default === undefined || raw.default === null)) errors.push(`${where}: a question with askWhen needs a default, which it takes when it is not asked`);
  if (raw.effects !== undefined) {
    if (!Array.isArray(raw.effects) || raw.effects.length > 20) errors.push(`${where}.effects must be a list of at most 20 effects`);
    else {
      raw.effects.forEach((effect, i) => {
        const at = `${where}.effects[${i}]`;
        if (!isRecord(effect)) return void errors.push(`${at} must be an object`);
        unknownKeys(effect, ["sets"], at, errors);
        if (effect.sets === undefined) return void errors.push(`${at} needs sets`);
        if (!isRecord(effect.sets) || Object.keys(effect.sets).length === 0 || Object.keys(effect.sets).some((k) => !text(k, 120))) return void errors.push(`${at}.sets must map "<componentId>.<settingId>" to values`);
        q.effects.push({ sets: effect.sets as Record<string, SetValue> });
      });
    }
  }
  return { question: q, askWhen: raw.askWhen };
}

// True when the condition of `from`, followed through the askWhen of the questions it names, reaches `target`.
function reaches(from: RecipeQuestion, target: string, byId: ReadonlyMap<string, RecipeQuestion>, seen: Set<string>): boolean {
  for (const id of from.askWhen ? conditionQuestions(from.askWhen) : []) {
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = byId.get(id);
    if (next && reaches(next, target, byId, seen)) return true;
  }
  return false;
}

// Rule 5: two questions may not set one target to different values unless their askWhen conditions cannot both hold.
function checkConflicts(questions: RecipeQuestion[], errors: string[]): void {
  const seen = new Map<string, { q: RecipeQuestion; value: SetValue }[]>();
  const answerDependent = (v: SetValue) => typeof v === "object" ? !("fromScale" in v) : v === "$answer";
  for (const q of questions)
    for (const effect of q.effects)
      for (const [target, value] of Object.entries(effect.sets)) {
        for (const prior of seen.get(target) ?? []) {
          const same = prior.q.id === q.id ? JSON.stringify(prior.value) === JSON.stringify(value) : !answerDependent(value) && !answerDependent(prior.value) && JSON.stringify(prior.value) === JSON.stringify(value);
          if (same) continue;
          if (prior.q.id !== q.id && exclusive(prior.q.askWhen, q.askWhen)) continue;
          errors.push(`questions ${prior.q.id} and ${q.id} both set ${target.slice(0, 60)} to different values and are not mutually exclusive by askWhen`);
        }
        seen.set(target, [...(seen.get(target) ?? []), { q, value }]);
      }
}

// `context` carries component data when the caller has it (settings from component.json, profiles from suitability.json); what it lacks is accepted unchecked.
export function validateRecipe(input: unknown, context: RecipeContext = {}): Result<"recipe", Recipe> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["recipe.json must be a JSON object"] };
  if (JSON.stringify(input).length > LIMITS.recipeJson) return { ok: false, errors: [`recipe.json is larger than ${LIMITS.recipeJson} characters`] };
  unknownKeys(input, RECIPE_FIELDS, "recipe", errors);
  if (input.format !== CATALOGUE_FORMAT) errors.push(`format must be ${CATALOGUE_FORMAT}`);
  if (!isCatalogueName(input.name)) errors.push("name must be <scope>/<name>: lowercase letters, digits and single hyphens");
  if (!isVersion(input.version)) errors.push("version must be three integers, for example 0.2.0");
  if (!text(input.title, LIMITS.title)) errors.push(`title must be text of at most ${LIMITS.title} characters`);
  if (!text(input.summary, LIMITS.summary)) errors.push(`summary must be text of at most ${LIMITS.summary} characters`);
  if (typeof input.category !== "string" || !SLUG.test(input.category) || input.category.length > 30) errors.push("category must be a lowercase slug of at most 30 characters");
  const tags = readTags(input.tags, "tags", errors);
  const targets = readTargets(input.targets, "targets", errors);

  const questions: RecipeQuestion[] = [];
  const askWhens: unknown[] = [];
  if (!Array.isArray(input.questions) || input.questions.length > LIMITS.questions) errors.push(`questions must be a list of at most ${LIMITS.questions} questions`);
  else
    input.questions.forEach((q, i) => {
      const read = readQuestion(q, i, errors);
      if (!read) return;
      if (questions.some((other) => other.id === read.question.id)) errors.push(`questions[${i}].id ${read.question.id} is used twice`);
      questions.push(read.question);
      askWhens.push(read.askWhen);
    });
  const questionIds = new Set(questions.map((q) => q.id));
  const byId: ReadonlyMap<string, RecipeQuestion> = new Map(questions.map((q) => [q.id, q]));
  questions.forEach((q, i) => {
    if (askWhens[i] === undefined) return;
    const condition = readCondition(askWhens[i], `questions[${i}].askWhen`, byId, errors);
    if (condition) q.askWhen = condition;
  });
  questions.forEach((q, i) => {
    if (q.askWhen && reaches(q, q.id, byId, new Set())) errors.push(`questions[${i}].askWhen leads back to ${q.id}: questions may not wait on each other in a circle`);
  });

  const components: RecipeComponent[] = [];
  if (!Array.isArray(input.components) || input.components.length === 0 || input.components.length > LIMITS.components) errors.push(`components must be a list of 1 to ${LIMITS.components} components`);
  else
    input.components.forEach((c, i) => {
      const where = `components[${i}]`;
      if (!isRecord(c)) return void errors.push(`${where} must be an object`);
      unknownKeys(c, ["id", "name", "version", "configuration", "includedWhen"], where, errors);
      if (typeof c.id !== "string" || !IDENTIFIER.test(c.id)) errors.push(`${where}.id must be an identifier`);
      else if (c.id === APPLICATION_INSTANCE) errors.push(`${where}.id ${APPLICATION_INSTANCE} is reserved for the recipe's own component`);
      else if (components.some((other) => other.id === c.id)) errors.push(`${where}.id ${c.id} is used twice`);
      if (!isCatalogueName(c.name)) errors.push(`${where}.name must be <scope>/<name>`);
      else if (c.name.split("/")[1] === APPLICATION_INSTANCE) errors.push(`${where}.name ${c.name} is not allowed: no component is named ${APPLICATION_INSTANCE}`);
      if (!isVersion(c.version)) errors.push(`${where}.version must be three integers`);
      if (c.configuration !== undefined && !isRecord(c.configuration)) errors.push(`${where}.configuration must be an object`);
      else if (isRecord(c.configuration) && typeof c.name === "string") {
        const declared = context.settings?.[c.name];
        for (const [setting, v] of Object.entries(c.configuration)) {
          const decl = declared?.find((d) => d.id === setting);
          if (declared && !decl) errors.push(`${where}.configuration.${setting.slice(0, 40)} is not a setting of ${c.name}`);
          else if (decl) {
            const problem = decl.secret ? "is secret: it takes its reference from a question through {\"ref\": <secretRef question>}, not from configuration" : literalProblem(v, decl);
            if (problem) errors.push(`${where}.configuration.${setting} ${problem}`);
          }
        }
      }
      components.push({
        id: String(c.id),
        name: String(c.name),
        version: String(c.version),
        configuration: isRecord(c.configuration) ? c.configuration : {},
        includedWhen: readOptionalCondition(c.includedWhen, `${where}.includedWhen`, byId, errors),
      });
    });
  const instanceIds = new Set(components.map((c) => c.id));
  const componentNames = new Set(components.map((c) => c.name));

  const jobs: RecipeJob[] = [];
  if (input.jobs !== undefined) {
    if (!Array.isArray(input.jobs) || input.jobs.length > 30) errors.push("jobs must be a list of at most 30 jobs");
    else
      input.jobs.forEach((j, i) => {
        const where = `jobs[${i}]`;
        if (!isRecord(j)) return void errors.push(`${where} must be an object`);
        unknownKeys(j, ["id", "candidates", "overrideQuestion"], where, errors);
        if (typeof j.id !== "string" || !IDENTIFIER.test(j.id)) errors.push(`${where}.id must be an identifier`);
        else if (jobs.some((other) => other.id === j.id)) errors.push(`${where}.id ${j.id} is used twice`);
        let overrideQuestion: string | undefined;
        if (j.overrideQuestion !== undefined) {
          const target = typeof j.overrideQuestion === "string" ? byId.get(j.overrideQuestion) : undefined;
          if (!target) errors.push(`${where}.overrideQuestion must name one of the recipe's questions`);
          else if (target.type !== "choice" && target.type !== "text") errors.push(`${where}.overrideQuestion must name a choice or text question, whose answer names a profile or provider`);
          else overrideQuestion = target.id;
        }
        const candidates: RecipeJob["candidates"] = [];
        if (!Array.isArray(j.candidates) || j.candidates.length === 0 || j.candidates.length > 20) errors.push(`${where}.candidates must be a list of 1 to 20 candidates`);
        else
          j.candidates.forEach((c, n) => {
            if (!isRecord(c) || !isCatalogueName(c.component) || typeof c.profile !== "string" || !IDENTIFIER.test(c.profile)) return void errors.push(`${where}.candidates[${n}] needs a component name and a profile id`);
            const at = `${where}.candidates[${n}]`;
            unknownKeys(c, ["component", "profile", "includedWhen"], at, errors);
            if (!componentNames.has(c.component)) errors.push(`${at}.component ${c.component} is not in components`);
            const profiles = context.profiles?.[c.component];
            const profile = profiles?.find((p) => p.id === c.profile);
            if (profiles && !profile) errors.push(`${at}.profile ${c.profile} is not a profile of ${c.component}`);
            const declared = context.settings?.[c.component];
            for (const [setting, v] of Object.entries(profile?.settings ?? {})) {
              const decl = declared?.find((d) => d.id === setting);
              if (declared && !decl) errors.push(`${at}.profile ${c.profile} sets ${setting.slice(0, 40)}, which is not a setting of ${c.component}`);
              else if (decl) {
                const problem = literalProblem(v, decl);
                if (problem) errors.push(`${at}.profile ${c.profile} setting ${setting} ${problem}`);
              }
            }
            const includedWhen = readOptionalCondition(c.includedWhen, `${at}.includedWhen`, byId, errors);
            candidates.push({ component: c.component, profile: c.profile, ...(includedWhen ? { includedWhen } : {}) });
          });
        jobs.push({ id: String(j.id), candidates, ...(overrideQuestion ? { overrideQuestion } : {}) });
      });
  }

  let scale: Recipe["scale"] = null;
  if (input.scale !== undefined && input.scale !== null) {
    const s = input.scale;
    if (!isRecord(s)) errors.push("scale must be an object");
    else {
      unknownKeys(s, ["question", "bands"], "scale", errors);
      const scaleQuestion = typeof s.question === "string" ? byId.get(s.question) : undefined;
      if (!scaleQuestion) errors.push("scale.question must name one of the recipe's questions");
      else if (scaleQuestion.type !== "choice") errors.push("scale.question must name a choice question whose options are the band ids");
      const bands: NonNullable<Recipe["scale"]>["bands"] = [];
      if (!Array.isArray(s.bands) || s.bands.length === 0 || s.bands.length > 10) errors.push("scale.bands must be a list of 1 to 10 bands");
      else
        s.bands.forEach((b, i) => {
          const where = `scale.bands[${i}]`;
          if (!isRecord(b) || typeof b.id !== "string" || !IDENTIFIER.test(b.id) || !text(b.label, 200)) return void errors.push(`${where} needs an id and a label`);
          unknownKeys(b, ["id", "label", "load"], where, errors);
          const load = readLoad(b.load, `${where}.load`, errors);
          bands.push({ id: b.id, label: String(b.label), load });
        });
      if (scaleQuestion?.type === "choice") for (const option of scaleQuestion.options ?? []) if (!bands.some((b) => b.id === option)) errors.push(`scale.question option ${option} is not a band id`);
      scale = { question: String(s.question), bands };
    }
  }

  const connections: Recipe["connections"] = [];
  if (!Array.isArray(input.connections) || input.connections.length > LIMITS.connections) errors.push(`connections must be a list of at most ${LIMITS.connections} connections`);
  else
    input.connections.forEach((c, i) => {
      const where = `connections[${i}]`;
      if (!isRecord(c)) return void errors.push(`${where} must be an object`);
      unknownKeys(c, ["source", "target"], where, errors);
      const ends = (["source", "target"] as const).map((side) => {
        const end = c[side];
        if (!isRecord(end) || typeof end.instance !== "string" || typeof end.port !== "string" || !IDENTIFIER.test(end.port)) {
          errors.push(`${where}.${side} needs an instance and a port`);
          return { instance: "", port: "" };
        }
        if (end.instance !== APPLICATION_INSTANCE && !instanceIds.has(end.instance)) errors.push(`${where}.${side}.instance ${end.instance.slice(0, 40)} is not a component id or ${APPLICATION_INSTANCE}`);
        return { instance: end.instance, port: end.port };
      });
      connections.push({ source: ends[0], target: ends[1] });
    });

  const instanceNames = new Map<string, string>([[APPLICATION_INSTANCE, APPLICATION_INSTANCE], ...components.map((c): [string, string] => [c.id, c.name])]);
  questions.forEach((q, i) =>
    q.effects.forEach((effect, n) => {
      for (const [target, value] of Object.entries(effect.sets)) {
        const at = `questions[${i}].effects[${n}].sets[${target.slice(0, 60)}]`;
        const resolved = resolveTarget(target, instanceNames.keys());
        if (!resolved) {
          errors.push(`${at}: the target must be <componentId>.<settingId> of a component in the recipe, or ${APPLICATION_INSTANCE}.<settingId>`);
          continue;
        }
        const declared = context.settings?.[instanceNames.get(resolved.instance) as string];
        const decl = declared?.find((d) => d.id === resolved.setting);
        if (declared && !decl) errors.push(`${at}: ${resolved.setting} is not a setting of ${resolved.instance}`);
        checkSetValue(value, q, at, decl, byId, scale !== null, errors);
      }
    }),
  );
  checkConflicts(questions, errors);

  const tests: Recipe["tests"] = { defaultAnswers: {}, answerSets: [] };
  if (!isRecord(input.tests)) errors.push("tests must be an object with defaultAnswers and answerSets");
  else {
    unknownKeys(input.tests, ["defaultAnswers", "answerSets"], "tests", errors);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const checkAnswers = (answers: unknown, where: string): Rec => {
      if (!isRecord(answers)) {
        errors.push(`${where} must be an object of answers`);
        return {};
      }
      for (const [id, value] of Object.entries(answers)) {
        const q = byId.get(id);
        if (!q) errors.push(`${where} answers ${id.slice(0, 40)}, which is not a question`);
        else checkAnswer(q, value, `${where}.${id}`, errors);
      }
      return answers;
    };
    tests.defaultAnswers = checkAnswers(input.tests.defaultAnswers, "tests.defaultAnswers");
    if (!Array.isArray(input.tests.answerSets) || input.tests.answerSets.length > LIMITS.answerSets) errors.push(`tests.answerSets must be a list of at most ${LIMITS.answerSets} answer sets`);
    else
      input.tests.answerSets.forEach((set, i) => {
        const where = `tests.answerSets[${i}]`;
        if (!isRecord(set) || typeof set.id !== "string" || !IDENTIFIER.test(set.id)) return void errors.push(`${where} needs an id`);
        unknownKeys(set, ["id", "answers"], where, errors);
        if (tests.answerSets.some((other) => other.id === set.id)) errors.push(`${where}.id ${set.id} is used twice`);
        tests.answerSets.push({ id: set.id, answers: checkAnswers(set.answers, `${where}.answers`) });
      });
  }

  const page: Recipe["page"] = { description: "", diagram: "", screenshots: [] };
  if (!isRecord(input.page)) errors.push("page must be an object with description, diagram and screenshots");
  else {
    unknownKeys(input.page, ["description", "diagram", "screenshots"], "page", errors);
    if (!isPackagePath(input.page.description)) errors.push("page.description must be a relative path inside the package");
    else page.description = input.page.description;
    if (!isPackagePath(input.page.diagram)) errors.push("page.diagram must be a relative path inside the package");
    else page.diagram = input.page.diagram;
    page.screenshots = stringList(input.page.screenshots ?? [], "page.screenshots", errors, { max: LIMITS.screenshots, item: isPackagePath, what: "relative paths" });
  }
  if (!isPackagePath(input.instructions)) errors.push("instructions must be a relative path inside the package");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    recipe: {
      format: 1,
      name: input.name as string,
      version: input.version as string,
      title: (input.title as string).trim(),
      summary: (input.summary as string).trim(),
      category: input.category as string,
      tags,
      targets,
      components,
      jobs,
      scale,
      questions,
      connections,
      tests,
      page,
      instructions: input.instructions as string,
    },
  };
}

function readLoad(value: unknown, where: string, errors: string[]): Record<string, number> {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object of maxima`);
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!IDENTIFIER.test(key) || typeof v !== "number" || !Number.isFinite(v) || v < 0) errors.push(`${where}.${key.slice(0, 40)} must be a non-negative number`);
    else out[key] = v;
  }
  return out;
}

// ---------------------------------------------------------------- recipe publication

// What a developer sends to publish a recipe version: recipe.json, where the release is, and the page material.
export interface RecipeEntry {
  format: 1;
  recipe: Recipe;
  digest: string;
  source: ReleasePointer;
  bundle: BundlePointer;
  page: { description: string; diagram: string | null; screenshots: string[] };
}

// SVG that is safe to show: no scripts, no embedded objects, no external references.
export function isSafeSvg(svg: unknown): svg is string {
  if (typeof svg !== "string" || svg.length > LIMITS.diagram) return false;
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg)) return false;
  if (/<\s*(script|foreignObject|iframe|object|embed|style\b[^>]*@import)|<!DOCTYPE|<!ENTITY|javascript:|\son[a-z]+\s*=/i.test(svg)) return false;
  for (const match of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) if (!match[1].startsWith("#")) return false;
  if (/url\(\s*["']?(?!#)/i.test(svg)) return false;
  return true;
}

export function validateRecipeEntry(input: unknown, context: RecipeContext = {}): Result<"entry", RecipeEntry> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["the body must be a JSON object"] };
  unknownKeys(input, ["format", "recipe", "digest", "source", "bundle", "page"], "body", errors);
  if (input.format !== CATALOGUE_FORMAT) errors.push(`format must be ${CATALOGUE_FORMAT}`);
  const recipe = validateRecipe(input.recipe, context);
  if (!recipe.ok) errors.push(...recipe.errors.map((e) => `recipe: ${e}`));
  if (!isDigest(input.digest)) errors.push("digest must be sha256:<64 lowercase hex>");
  const release = readRelease(input.source, input.bundle, errors);
  const page: RecipeEntry["page"] = { description: "", diagram: null, screenshots: [] };
  if (!isRecord(input.page)) errors.push("page must be an object with description, diagram and screenshots");
  else {
    unknownKeys(input.page, ["description", "diagram", "screenshots"], "page", errors);
    if (!text(input.page.description, LIMITS.description)) errors.push(`page.description must be text of at most ${LIMITS.description} characters`);
    else page.description = input.page.description.replace(/\r\n/g, "\n");
    if (input.page.diagram !== undefined && input.page.diagram !== null) {
      if (!isSafeSvg(input.page.diagram)) errors.push("page.diagram must be an SVG without scripts, embedded objects or external references, of at most 200000 characters");
      else page.diagram = input.page.diagram;
    }
    page.screenshots = stringList(input.page.screenshots ?? [], "page.screenshots", errors, { max: LIMITS.screenshots, item: isHttpsUrl, what: "https URLs" });
  }
  if (errors.length > 0 || !recipe.ok) return { ok: false, errors };
  return { ok: true, entry: { format: 1, recipe: recipe.recipe, digest: input.digest as string, ...release, page } };
}

// ---------------------------------------------------------------- component catalogue entry

export interface Port {
  id: string;
  type: string;
  version: string;
  // A requirement marked optional may stay unconnected. Only requires entries carry it.
  optional?: boolean;
}

export interface Profile {
  id: string;
  load: Record<string, number>;
  cost: CostKind;
  regions: string[];
  compliance: string[];
  provider: { name: string; tier: string; limitsSource: string | null } | null;
  notes: string;
  // Setting values the profile applies when it is selected, by setting id.
  settings?: SettingValues;
}

export interface Suitability {
  format: 1;
  jobs: string[];
  profiles: Profile[];
  notes: string;
}

// What the catalogue shows of migration.json.
export interface MigrationSummary {
  stores: { id: string; schema: { name: string; version: string } }[];
  formats: string[];
  portable: boolean;
  requiresStop: boolean;
  retentionDays: number | null;
}

// A component another component builds on, by exact name and version.
export interface ComponentDependency {
  name: string;
  version: string;
}

export interface ComponentEntry {
  format: 1;
  name: string;
  version: string;
  digest: string;
  description: string;
  category: string | null;
  tags: string[];
  targets: Targets;
  guardians: string[];
  provides: Port[];
  requires: Port[];
  dependencies: ComponentDependency[];
  suitability: Suitability;
  migration: MigrationSummary | null;
  source: ReleasePointer;
  bundle: BundlePointer;
}

const COMPONENT_FIELDS = ["format", "name", "version", "digest", "description", "category", "tags", "targets", "guardians", "provides", "requires", "dependencies", "suitability", "migration", "source", "bundle"];

function readPorts(value: unknown, where: string, errors: string[], allowOptional = false): Port[] {
  if (!Array.isArray(value) || value.length > 50) {
    errors.push(`${where} must be a list of at most 50 interfaces`);
    return [];
  }
  const out: Port[] = [];
  value.forEach((p, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(p)) return void errors.push(`${at} must be an object`);
    unknownKeys(p, allowOptional ? ["id", "type", "version", "optional"] : ["id", "type", "version"], at, errors);
    if (typeof p.id !== "string" || !IDENTIFIER.test(p.id)) errors.push(`${at}.id must be an identifier`);
    else if (out.some((o) => o.id === p.id)) errors.push(`${at}.id ${p.id} is used twice`);
    if (typeof p.type !== "string" || !PORT_TYPE.test(p.type)) errors.push(`${at}.type must be an interface type such as ae/card-deck`);
    if (!isVersion(p.version)) errors.push(`${at}.version must be three integers`);
    if (allowOptional && p.optional !== undefined && typeof p.optional !== "boolean") errors.push(`${at}.optional must be true or false`);
    out.push({ id: String(p.id), type: String(p.type), version: String(p.version), ...(allowOptional && p.optional === true ? { optional: true } : {}) });
  });
  return out;
}

function readDependencies(value: unknown, self: unknown, errors: string[]): ComponentDependency[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) {
    errors.push("dependencies must be a list of at most 50 components");
    return [];
  }
  const out: ComponentDependency[] = [];
  value.forEach((d, i) => {
    const at = `dependencies[${i}]`;
    if (!isRecord(d)) return void errors.push(`${at} must be an object`);
    unknownKeys(d, ["name", "version"], at, errors);
    if (!isCatalogueName(d.name)) errors.push(`${at}.name must be <scope>/<name>`);
    else if (d.name === self) errors.push(`${at}.name cannot be the component itself`);
    else if (out.some((o) => o.name === d.name)) errors.push(`${at}.name ${d.name} is used twice`);
    if (!isVersion(d.version)) errors.push(`${at}.version must be three integers`);
    out.push({ name: String(d.name), version: String(d.version) });
  });
  return out;
}

// suitability.json, format 1.
export function validateSuitability(input: unknown, where = "suitability"): Result<"suitability", Suitability> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: [`${where} must be an object`] };
  unknownKeys(input, ["format", "jobs", "profiles", "notes"], where, errors);
  if (input.format !== CATALOGUE_FORMAT) errors.push(`${where}.format must be ${CATALOGUE_FORMAT}`);
  const jobs = stringList(input.jobs, `${where}.jobs`, errors, { max: 20, item: (v) => typeof v === "string" && SLUG.test(v) && v.length <= 40, what: "job names" });
  if (jobs.length === 0) errors.push(`${where}.jobs needs at least one job`);
  const profiles: Profile[] = [];
  if (!Array.isArray(input.profiles) || input.profiles.length === 0 || input.profiles.length > 10) errors.push(`${where}.profiles must be a list of 1 to 10 profiles`);
  else
    input.profiles.forEach((p, i) => {
      const at = `${where}.profiles[${i}]`;
      if (!isRecord(p)) return void errors.push(`${at} must be an object`);
      unknownKeys(p, ["id", "load", "cost", "regions", "compliance", "provider", "notes", "settings"], at, errors);
      if (typeof p.id !== "string" || !IDENTIFIER.test(p.id)) errors.push(`${at}.id must be an identifier`);
      else if (profiles.some((o) => o.id === p.id)) errors.push(`${at}.id ${p.id} is used twice`);
      const load = readLoad(p.load, `${at}.load`, errors);
      if (!(COST_KINDS as readonly unknown[]).includes(p.cost)) errors.push(`${at}.cost must be one of ${COST_KINDS.join(", ")}`);
      const item = (v: unknown) => typeof v === "string" && v.length >= 1 && v.length <= 60;
      const regions = stringList(p.regions, `${at}.regions`, errors, { max: 30, item, what: "regions" });
      if (regions.length === 0) errors.push(`${at}.regions needs at least one region (any for no restriction)`);
      const compliance = stringList(p.compliance, `${at}.compliance`, errors, { max: 20, item, what: "compliance labels" });
      let provider: Profile["provider"] = null;
      if (p.provider !== undefined && p.provider !== null) {
        const pr = p.provider;
        if (!isRecord(pr) || !text(pr.name, 80) || !text(pr.tier, 40) || !(pr.limitsSource === null || isHttpsUrl(pr.limitsSource))) errors.push(`${at}.provider needs name, tier and limitsSource (an https URL or null)`);
        else {
          unknownKeys(pr, ["name", "tier", "limitsSource"], `${at}.provider`, errors);
          provider = { name: String(pr.name), tier: String(pr.tier), limitsSource: pr.limitsSource as string | null };
        }
      }
      if (p.notes !== undefined && !text(p.notes, 1000, 0)) errors.push(`${at}.notes must be text of at most 1000 characters`);
      let settings: SettingValues | undefined;
      if (p.settings !== undefined) {
        if (!isRecord(p.settings) || Object.keys(p.settings).length > 50 || !Object.entries(p.settings).every(([k, v]) => IDENTIFIER.test(k) && isLiteral(v) && !(typeof v === "string" && v.startsWith("$")))) errors.push(`${at}.settings must map setting ids to string, number or boolean values`);
        else settings = p.settings as SettingValues;
      }
      profiles.push({ id: String(p.id), load, cost: p.cost as CostKind, regions, compliance, provider, notes: typeof p.notes === "string" ? p.notes : "", ...(settings ? { settings } : {}) });
    });
  if (input.notes !== undefined && !text(input.notes, 2000, 0)) errors.push(`${where}.notes must be text of at most 2000 characters`);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, suitability: { format: 1, jobs, profiles, notes: typeof input.notes === "string" ? input.notes : "" } };
}

function readMigrationSummary(input: unknown, where: string, errors: string[]): MigrationSummary | null {
  if (input === null) return null;
  if (!isRecord(input)) {
    errors.push(`${where} must be null or an object`);
    return null;
  }
  unknownKeys(input, ["stores", "formats", "portable", "requiresStop", "retentionDays"], where, errors);
  const stores: MigrationSummary["stores"] = [];
  if (!Array.isArray(input.stores) || input.stores.length === 0 || input.stores.length > 20) errors.push(`${where}.stores must be a list of 1 to 20 stores`);
  else
    input.stores.forEach((s, i) => {
      const schema = isRecord(s) ? s.schema : null;
      if (!isRecord(s) || typeof s.id !== "string" || !IDENTIFIER.test(s.id) || !isRecord(schema) || !text(schema.name, 80) || !isVersion(schema.version)) return void errors.push(`${where}.stores[${i}] needs an id and a schema name and version`);
      stores.push({ id: s.id, schema: { name: String(schema.name), version: String(schema.version) } });
    });
  const formats = stringList(input.formats, `${where}.formats`, errors, { max: 10, item: (v) => typeof v === "string" && SLUG.test(v) && v.length <= 30, what: "format names" });
  if (input.portable !== true) errors.push(`${where}.portable must be true: every data-keeping component offers a portable format`);
  if (typeof input.requiresStop !== "boolean") errors.push(`${where}.requiresStop must be true or false`);
  if (!(input.retentionDays === null || (Number.isSafeInteger(input.retentionDays) && (input.retentionDays as number) >= 0))) errors.push(`${where}.retentionDays must be null or a non-negative integer`);
  return { stores, formats, portable: true, requiresStop: input.requiresStop === true, retentionDays: (input.retentionDays as number | null) ?? null };
}

// migration.json (format 1) to the summary the catalogue shows.
export function summariseMigration(input: unknown): Result<"migration", MigrationSummary> {
  const errors: string[] = [];
  if (!isRecord(input) || input.format !== CATALOGUE_FORMAT) return { ok: false, errors: ["migration.json must be an object with format 1"] };
  const stores = Array.isArray(input.stores) ? input.stores : [];
  const exported = Array.isArray(input.export) ? input.export : [];
  const imported = Array.isArray(input.import) ? input.import : [];
  const limits = isRecord(input.limits) ? input.limits : {};
  const retention = isRecord(input.retention) ? input.retention : {};
  const portable = [...exported, ...imported].some((f) => isRecord(f) && f.portable === true);
  const formats = [...new Set([...exported, ...imported].map((f) => (isRecord(f) ? f.format : null)).filter((f): f is string => typeof f === "string"))];
  const summary = readMigrationSummary({ stores, formats, portable, requiresStop: limits.requiresStop === true, retentionDays: Number.isSafeInteger(retention.afterRemovalDays) ? retention.afterRemovalDays : null }, "migration.json", errors);
  if (errors.length > 0 || !summary) return { ok: false, errors };
  return { ok: true, migration: summary };
}

export function validateComponentEntry(input: unknown): Result<"entry", ComponentEntry> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["the body must be a JSON object"] };
  unknownKeys(input, COMPONENT_FIELDS, "component", errors);
  if (input.format !== CATALOGUE_FORMAT) errors.push(`format must be ${CATALOGUE_FORMAT}`);
  if (!isCatalogueName(input.name)) errors.push("name must be <scope>/<name>: lowercase letters, digits and single hyphens");
  if (!isVersion(input.version)) errors.push("version must be three integers, for example 0.1.0");
  if (!isDigest(input.digest)) errors.push("digest must be sha256:<64 lowercase hex>");
  if (!text(input.description, LIMITS.componentDescription)) errors.push(`description must be text of at most ${LIMITS.componentDescription} characters`);
  if (input.category !== undefined && input.category !== null && (typeof input.category !== "string" || !SLUG.test(input.category) || input.category.length > 30)) errors.push("category must be a lowercase slug of at most 30 characters");
  const tags = readTags(input.tags, "tags", errors);
  const targets = input.targets === undefined ? { client: [], server: [] } : readTargets(input.targets, "targets", errors);
  const guardians = stringList(input.guardians ?? [], "guardians", errors, { max: 10, item: (v) => text(v, 80), what: "guardian names" });
  const provides = readPorts(input.provides, "provides", errors);
  const requires = readPorts(input.requires, "requires", errors, true);
  for (const p of provides) if (requires.some((r) => r.id === p.id)) errors.push(`interface id ${p.id} is both provided and required`);
  const dependencies = readDependencies(input.dependencies, input.name, errors);
  const suitability = validateSuitability(input.suitability);
  if (!suitability.ok) errors.push(...suitability.errors);
  const migration = readMigrationSummary(input.migration ?? null, "migration", errors);
  const release = readRelease(input.source, input.bundle, errors);
  if (errors.length > 0 || !suitability.ok) return { ok: false, errors };
  return {
    ok: true,
    entry: {
      format: 1,
      name: input.name as string,
      version: input.version as string,
      digest: input.digest as string,
      description: (input.description as string).trim(),
      category: (input.category as string | null | undefined) ?? null,
      tags,
      targets,
      guardians,
      provides,
      requires,
      dependencies,
      suitability: suitability.suitability,
      migration,
      ...release,
    },
  };
}
