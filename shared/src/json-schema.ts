// JSON Schema 2020-12 checks with @cfworker/json-schema, which interprets schemas: Cloudflare Workers refuse the code
// generation from strings that compiling validators (Ajv) needs. A schema that declares the 2020-12 dialect resolves the
// meta-schemas' dynamic reference "#meta" to the dialect schema itself, so it is followed as a plain reference to it.
import { Validator, type OutputUnit, type Schema } from "@cfworker/json-schema";
import { META_SCHEMAS_2020_12 } from "./json-schema-2020-12.js";

export const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

let meta: Validator | null = null;

function metaValidator(): Validator {
  if (meta) return meta;
  const [dialect, ...vocabularies] = META_SCHEMAS_2020_12.map((d) => JSON.parse(JSON.stringify(d).replaceAll('"$dynamicRef":"#meta"', `"$ref":"${DIALECT_2020_12}"`)) as Schema);
  const v = new Validator(dialect!, "2020-12", false);
  for (const s of vocabularies) v.addSchema(s);
  meta = v;
  return v;
}

const APPLICATORS = new Set(["$ref", "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "properties", "patternProperties", "additionalProperties", "propertyNames", "dependentSchemas", "items", "prefixItems", "contains", "unevaluatedProperties", "unevaluatedItems"]);

// The most specific error: the deepest place, then a keyword that checks the value itself.
function describe(errors: OutputUnit[]): string {
  const depth = (e: OutputUnit) => e.instanceLocation.split("/").length;
  const best = [...errors].sort((a, b) => depth(b) - depth(a) || Number(APPLICATORS.has(a.keyword)) - Number(APPLICATORS.has(b.keyword)))[0];
  if (!best) return "it does not validate";
  const at = best.instanceLocation.replace(/^#/, "");
  return `${at === "" ? "" : `at ${at}: `}${best.error}`;
}

const checked = new Map<string, string | null>();

// Why `schema` is not a JSON Schema 2020-12 schema, or null. Results are kept, so a repeated schema is checked once.
export function schemaProblem(schema: unknown): string | null {
  const key = JSON.stringify(schema);
  const known = checked.get(key);
  if (known !== undefined) return known;
  const result = metaValidator().validate(schema);
  const problem = result.valid ? null : describe(result.errors);
  if (key.length <= 2000) {
    if (checked.size >= 1000) checked.clear();
    checked.set(key, problem);
  }
  return problem;
}

// Why `value` fails `schema`, a schema schemaProblem accepted, or null.
export function valueProblem(schema: object, value: unknown): string | null {
  const result = new Validator(structuredClone(schema) as Schema, "2020-12", false).validate(value);
  return result.valid ? null : describe(result.errors);
}
