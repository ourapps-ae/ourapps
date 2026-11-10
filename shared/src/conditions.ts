// Conditions in recipes (askWhen, includedWhen): CEL (Common Expression Language) expressions of type bool over the
// answers. @bufbuild/cel parses them; this module checks the parsed expression against the allowed subset and the
// question types, and describes it in words. Authority: component-standard.md, "Standards".
import { parse } from "@bufbuild/cel";
import type { QuestionType } from "./catalogue.js";

// A CEL expression, for example "video" or "'ios' in targets".
export type Condition = string;

export type CelKind = "bool" | "int" | "string" | "list(bool)" | "list(int)" | "list(string)";

export interface ConditionQuestion {
  id: string;
  type: QuestionType;
  options?: (string | number)[];
}

export const CONDITION_MAX_LENGTH = 1000;
const LIST_MAX = 50;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

// The expression as @bufbuild/cel parses it.
export type ConditionExpr = ReturnType<typeof parse>["expr"];
type Expr = ConditionExpr;

export type CheckedCondition = { ok: true; expr: Expr; questions: Set<string> } | { ok: false; error: string };

// The CEL type a question's answer has in a condition.
export function celKindOf(type: QuestionType): CelKind {
  if (type === "set") return "list(string)";
  if (type === "boolean") return "bool";
  if (type === "integer") return "int";
  return "string";
}

const ALLOWED = "conditions use only literals, question ids, == != < <= > >=, in, && || !, parentheses and size()";
const COMPARISONS: Record<string, string> = { "_==_": "==", "_!=_": "!=", "_<_": "<", "_<=_": "<=", "_>_": ">", "_>=_": ">=" };
const OTHER_CALLS: Record<string, string> = { "_+_": "+", "_-_": "-", "_*_": "*", "_/_": "/", "_%_": "%", "-_": "unary minus", "_?_:_": "the conditional ?:", "_[_]": "indexing", "_?._": "optional selection", "_[?_]": "optional indexing" };

class Refusal extends Error {}

function literal(e: Expr): string | bigint | boolean | undefined {
  if (e.exprKind.case !== "constExpr") return undefined;
  const c = e.exprKind.value.constantKind;
  return c.case === "stringValue" || c.case === "int64Value" || c.case === "boolValue" ? c.value : undefined;
}

function show(v: string | bigint | boolean): string {
  return typeof v === "string" ? `'${v}'` : String(v);
}

class Checker {
  readonly questions = new Set<string>();
  private readonly byId: ReadonlyMap<string, ConditionQuestion>;
  constructor(byId: ReadonlyMap<string, ConditionQuestion>) {
    this.byId = byId;
  }

  question(e: Expr): ConditionQuestion | undefined {
    return e.exprKind.case === "identExpr" ? this.byId.get(e.exprKind.value.name) : undefined;
  }

  // A text literal compared with a choice or set question must be one of its options.
  option(q: ConditionQuestion | undefined, e: Expr): void {
    const v = literal(e);
    if (!q || (q.type !== "choice" && q.type !== "set") || typeof v !== "string") return;
    if (!(q.options ?? []).map(String).includes(v)) throw new Refusal(`${show(v)} is not an option of ${q.id} (${(q.options ?? []).join(", ")})`);
  }

  kind(e: Expr): CelKind {
    const k = e.exprKind;
    switch (k.case) {
      case "constExpr": {
        const c = k.value.constantKind;
        if (c.case === "boolValue") return "bool";
        if (c.case === "int64Value") {
          if (c.value < INT64_MIN || c.value > INT64_MAX) throw new Refusal(`${c.value} is outside the 64-bit integer range`);
          return "int";
        }
        if (c.case === "stringValue") return "string";
        throw new Refusal(`a ${String(c.case).replace(/Value$/, "")} literal is not allowed; literals are quoted text, whole numbers, true and false`);
      }
      case "identExpr": {
        const q = this.byId.get(k.value.name);
        if (!q) throw new Refusal(`${k.value.name} is not a question of the recipe`);
        this.questions.add(q.id);
        return celKindOf(q.type);
      }
      case "listExpr": {
        const items = k.value.elements;
        if (items.length === 0 || items.length > LIST_MAX) throw new Refusal(`a list needs 1 to ${LIST_MAX} values`);
        const kinds = new Set(items.map((item) => (literal(item) === undefined ? null : this.kind(item))));
        if (kinds.has(null)) throw new Refusal("a list holds only literals");
        if (kinds.size !== 1) throw new Refusal("a list holds values of one type");
        return `list(${[...kinds][0]})` as CelKind;
      }
      case "callExpr":
        return this.call(k.value.function, k.value.target, k.value.args);
      case "selectExpr":
        throw new Refusal(`field selection (.${k.value.field}) is not allowed; ${ALLOWED}`);
      case "structExpr":
        throw new Refusal(`a map or message literal is not allowed; ${ALLOWED}`);
      case "comprehensionExpr":
        throw new Refusal(`macros (all, exists, exists_one, map, filter) are not allowed; ${ALLOWED}`);
      default:
        throw new Refusal(`this expression is not allowed; ${ALLOWED}`);
    }
  }

  call(fn: string, target: Expr | undefined, args: Expr[]): CelKind {
    if (fn === "size" && ((target && args.length === 0) || (!target && args.length === 1))) {
      const of = this.kind(target ?? args[0]);
      if (of !== "string" && !of.startsWith("list(")) throw new Refusal(`size() takes text or a set, not ${of}`);
      return "int";
    }
    if (target) throw new Refusal(`the method ${fn}() is not allowed; ${ALLOWED}`);
    if (fn === "_&&_" || fn === "_||_" || fn === "!_") {
      for (const arg of args) {
        const of = this.kind(arg);
        if (of !== "bool") throw new Refusal(`${fn === "!_" ? "!" : fn.slice(1, -1)} takes true or false, not ${of}`);
      }
      return "bool";
    }
    if (fn in COMPARISONS) {
      const op = COMPARISONS[fn];
      const [left, right] = args.map((arg) => this.kind(arg));
      if (left !== right) throw new Refusal(`${op} compares ${left} with ${right}; both sides must have one type`);
      if (left.startsWith("list(")) throw new Refusal(`${op} cannot compare sets; use in or size()`);
      if (op !== "==" && op !== "!=" && left === "bool") throw new Refusal(`${op} cannot order true and false`);
      if (op === "==" || op === "!=") {
        this.option(this.question(args[0]), args[1]);
        this.option(this.question(args[1]), args[0]);
      }
      return "bool";
    }
    if (fn === "@in") {
      const [item, list] = args.map((arg) => this.kind(arg));
      if (list !== `list(${item})`) throw new Refusal(`in needs a value and a list of the same type, not ${item} in ${list}`);
      this.option(this.question(args[1]), args[0]);
      const q = this.question(args[0]);
      if (args[1].exprKind.case === "listExpr") for (const value of args[1].exprKind.value.elements) this.option(q, value);
      return "bool";
    }
    if (fn in OTHER_CALLS) throw new Refusal(`${OTHER_CALLS[fn]} is not allowed; ${ALLOWED}`);
    throw new Refusal(`the function ${fn}() is not allowed; ${ALLOWED}`);
  }
}

// Parses `source` with @bufbuild/cel and type-checks it to bool over the questions; names the questions it reads.
export function checkCondition(source: unknown, byId: ReadonlyMap<string, ConditionQuestion>): CheckedCondition {
  if (typeof source !== "string" || source.trim() === "" || source.length > CONDITION_MAX_LENGTH) return { ok: false, error: `a condition must be a CEL expression of 1 to ${CONDITION_MAX_LENGTH} characters, or null` };
  let expr: Expr;
  try {
    expr = parse(source).expr;
  } catch (error) {
    return { ok: false, error: `not valid CEL: ${String((error as Error).message ?? error).split("\n")[0].slice(0, 200)}` };
  }
  const checker = new Checker(byId);
  try {
    const kind = checker.kind(expr);
    if (kind !== "bool") return { ok: false, error: `the expression is of type ${kind}; a condition must be true or false` };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    throw error;
  }
  return { ok: true, expr, questions: checker.questions };
}

// The answers a condition certainly confines each question to: equality and `in` a list, through && as intersection and
// || as union; a boolean question alone or negated confines it to true or false. Anything else confines nothing.
export function confinements(expr: Expr, byId: ReadonlyMap<string, ConditionQuestion>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const k = expr.exprKind;
  const key = (v: string | bigint | boolean) => `${typeof v}:${String(v)}`;
  const boolean = (e: Expr) => {
    const q = e.exprKind.case === "identExpr" ? byId.get(e.exprKind.value.name) : undefined;
    return q?.type === "boolean" ? q.id : undefined;
  };
  if (k.case === "identExpr" && boolean(expr)) out.set(k.value.name, new Set([key(true)]));
  if (k.case !== "callExpr") return out;
  const { function: fn, args } = k.value;
  if (fn === "!_" && boolean(args[0])) out.set(boolean(args[0]) as string, new Set([key(false)]));
  else if (fn === "_==_") {
    for (const [a, b] of [[args[0], args[1]], [args[1], args[0]]]) {
      const v = literal(b);
      if (a.exprKind.case === "identExpr" && v !== undefined) out.set(a.exprKind.value.name, new Set([key(v)]));
    }
  } else if (fn === "@in" && args[0].exprKind.case === "identExpr" && args[1].exprKind.case === "listExpr") {
    out.set(args[0].exprKind.value.name, new Set(args[1].exprKind.value.elements.map((e) => key(literal(e) as string | bigint | boolean))));
  } else if (fn === "_&&_") {
    for (const part of args)
      for (const [q, values] of confinements(part, byId)) {
        const have = out.get(q);
        out.set(q, have ? new Set([...have].filter((v) => values.has(v))) : values);
      }
  } else if (fn === "_||_") {
    const [left, right] = args.map((part) => confinements(part, byId));
    for (const [q, values] of left) if (right.has(q)) out.set(q, new Set([...values, ...right.get(q)!]));
  }
  return out;
}

function plainValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(plainValue).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

const ORDER_WORDS: Record<string, string> = { "_<_": "is less than", "_<=_": "is at most", "_>_": "is more than", "_>=_": "is at least", "_==_": "is", "_!=_": "is not" };
const FLIPPED: Record<string, string> = { "_<_": "_>_", "_<=_": "_>=_", "_>_": "_<_", "_>=_": "_<=_", "_==_": "_==_", "_!=_": "_!=_" };

function words(e: Expr, value: (v: unknown) => string): string | null {
  const k = e.exprKind;
  const name = (x: Expr) => (x.exprKind.case === "identExpr" ? x.exprKind.value.name : null);
  const lit = (x: Expr) => {
    const v = literal(x);
    return v === undefined ? undefined : typeof v === "bigint" ? Number(v) : v;
  };
  if (k.case === "identExpr") return `${k.value.name} is ${value(true)}`;
  if (k.case !== "callExpr" || k.value.target) return null;
  const { function: fn, args } = k.value;
  if (fn === "_&&_" || fn === "_||_") {
    const parts: Expr[] = [];
    const flatten = (x: Expr) => (x.exprKind.case === "callExpr" && x.exprKind.value.function === fn && !x.exprKind.value.target ? x.exprKind.value.args.forEach(flatten) : parts.push(x));
    args.forEach(flatten);
    const said = parts.map((p) => words(p, value));
    return said.some((s) => s === null) ? null : said.map((s) => `(${s})`).join(fn === "_&&_" ? " and " : " or ");
  }
  if (fn === "!_") {
    const inner = args[0];
    if (name(inner)) return `${name(inner)} is ${value(false)}`;
    const i = inner.exprKind;
    if (i.case === "callExpr" && i.value.function === "@in" && name(i.value.args[1]) && lit(i.value.args[0]) !== undefined) return `${name(i.value.args[1])} does not include ${value(lit(i.value.args[0]))}`;
    const said = words(inner, value);
    return said === null ? null : `not (${said})`;
  }
  if (fn === "@in") {
    const [item, list] = args;
    if (name(list) && lit(item) !== undefined) return `${name(list)} includes ${value(lit(item))}`;
    if (name(item) && list.exprKind.case === "listExpr") return `${name(item)} is one of ${list.exprKind.value.elements.map((x) => value(lit(x))).join(", ")}`;
    return null;
  }
  if (fn in ORDER_WORDS) {
    const [left, right] = args;
    const [subject, other, op] = lit(right) !== undefined ? [left, right, fn] : [right, left, FLIPPED[fn]];
    const v = lit(other);
    if (v === undefined) return null;
    if (name(subject) && v === "" && (op === "_==_" || op === "_!=_")) return `${name(subject)} ${ORDER_WORDS[op]} empty`;
    if (name(subject)) return `${name(subject)} ${ORDER_WORDS[op]} ${value(v)}`;
    const s = subject.exprKind;
    const sized = s.case === "callExpr" && s.value.function === "size" ? name(s.value.target ?? s.value.args[0]) : null;
    if (sized && v === 0 && (op === "_==_" || op === "_<=_")) return `${sized} is empty`;
    if (sized && ((v === 0 && (op === "_!=_" || op === "_>_")) || (v === 1 && op === "_>=_"))) return `${sized} is not empty`;
    return null;
  }
  return null;
}

// The condition in plain English for the common shapes ("targets includes ios", "video is yes"), or null when it has no
// plain wording; the caller then shows the expression itself in code font.
export function describeCondition(c: Condition, value: (v: unknown) => string = plainValue): string | null {
  try {
    return words(parse(c).expr, value);
  } catch {
    return null;
  }
}
