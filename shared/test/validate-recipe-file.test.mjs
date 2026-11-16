import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { descriptorDigest, exampleComponentEntries, exampleRecipeEntry } from "../src/index.ts";

const script = resolve(import.meta.dirname, "../../scripts/validate-recipe-file.ts");
const content = path => path.endsWith(".json") ? '{"type":"object"}' : "console.log('behaviour');\n";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function source(folder, foundations, identity, kind, entry, patch = () => {}) {
  foundations = structuredClone(foundations);
  for (const c of foundations.classes) {
    for (const item of c.descriptor.inventory) item.digest = hash(content(item.path));
    c.reference.digest = descriptorDigest(c.descriptor);
  }
  foundations.implements = kind === "component" ? foundations.classes.map(c => c.reference) : [];
  const { licence, ...fields } = foundations;
  const manifest = { kind, identity: { ...identity, licence }, ...fields, collect: (entry?.settings ?? []).map(({ hasDefault, ...s }) => ({ ...s, ...(hasDefault ? { default: s.type === "integer" ? 2 : s.type === "boolean" ? false : "brief" } : {}) })), provides: (entry?.provides ?? []).map(p => ({ ...p, path: foundations.classes[0].descriptor.provides[0].path })), requires: entry?.requires ?? [] };
  patch(manifest);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "component.json"), JSON.stringify(manifest));
  if (entry?.suitability) writeFileSync(join(folder, "suitability.json"), JSON.stringify(entry.suitability));
  for (const f of foundations.files) { mkdirSync(dirname(join(folder, f.path)), { recursive: true }); writeFileSync(join(folder, f.path), content(f.path)); }
  return foundations;
}
function run(patchRecipe = () => {}, patchComponent = () => {}, withComponents = true, tamper = false) {
  const dir = mkdtempSync(join(tmpdir(), "recipe-foundations-"));
  const entry = exampleRecipeEntry();
  const authority = source(dir, entry.foundations, { name: entry.recipe.name, version: entry.recipe.version }, "recipe", { settings: [{ id: "startingChips", type: "integer", grammar: "integer", required: false, secret: false, hasDefault: true }], provides: [], requires: ["seating", "server-host", "apple-shell", "guided-tour"].map(id => ({ id, type: `ae/${id}`, version: "1.0.0" })) });
  for (const s of entry.recipe.components) s.class = authority.classes.find(c => c.reference.name === s.class.name).reference;
  const components = join(dir, "components"); mkdirSync(components);
  for (const e of exampleComponentEntries()) source(join(components, e.name.split("/")[1]), e.foundations, { name: e.name, version: e.version }, "component", e, patchComponent);
  patchRecipe(entry.recipe);
  const path = join(dir, "recipe.json"); writeFileSync(path, JSON.stringify(entry.recipe));
  if (tamper) writeFileSync(join(dir, authority.classes[0].descriptor.inventory[0].path), "tampered");
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, path, ...(withComponents ? ["--components", components] : ["--no-components"])], { encoding: "utf8" });
}
describe("source recipe validation", () => {
  it("reads independent class declarations and actual candidate files", () => { const r = run(); expect(r.stderr).toBe(""); expect(r.status).toBe(0); expect(r.stdout).toContain("5 components read"); });
  it("checks authority without component lookup", () => { const r = run(() => {}, () => {}, false); expect(r.stderr).toBe(""); expect(r.status).toBe(0); });
  it("rejects tampered inventory bytes", () => { const r = run(() => {}, () => {}, false, true); expect(r.status).toBe(1); expect(r.stderr).toContain("file-digest"); });
  it("rejects an unfit candidate", () => { const r = run(() => {}, m => { if (m.identity.name === "acme/seating") m.collect = []; }); expect(r.status).toBe(1); expect(r.stderr).toContain("setting:minimumPlayers"); });
  it("rejects uninstalled class modules", () => { const r = run(() => {}, m => { if (m.identity.name === "acme/card-deck") m.artefacts = []; }); expect(r.status).toBe(1); expect(r.stderr).toContain("module:web:index.mjs"); });
  it("rejects absent foundation fields", () => { const r = run(() => {}, m => delete m.maintenance); expect(r.status).toBe(1); expect(r.stderr).toContain("maintenance-fields"); });
  it("rejects undeclared inventory membership", () => { const r = run(() => {}, m => m.files = []); expect(r.status).toBe(1); expect(r.stderr).toContain("class-file-missing"); });
  it("rejects unsupported target answers", () => { const r = run(r => r.tests.answerSets[0].answers.targets = ["tvos"]); expect(r.status).toBe(1); expect(r.stderr).toContain("unsupported-platform"); });
  it("reports condition type failures", () => { const r = run(r => r.components[4].includedWhen = "lessons == 'yes'"); expect(r.status).toBe(1); expect(r.stderr).toContain("compares bool with string"); });
  it("exits 2 for an unreadable recipe", () => { const r = spawnSync(process.execPath, [script, "/nonexistent/recipe.json"], { encoding: "utf8" }); expect(r.status).toBe(2); });
});
