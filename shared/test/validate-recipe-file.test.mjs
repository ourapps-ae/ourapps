import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleComponentEntries, exampleRecipeEntry } from "../src/index.ts";

const script = resolve(import.meta.dirname, "../../scripts/validate-recipe-file.ts");

function run(recipe, extra = ["--no-components"]) {
  const dir = mkdtempSync(join(tmpdir(), "recipe-"));
  const path = join(dir, "recipe.json");
  writeFileSync(path, JSON.stringify(recipe));
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, path, ...extra], { encoding: "utf8" });
}

// The interface document of a type: one text for every component that provides it. The deck's declares an entry module.
const documentOf = (type) => JSON.stringify({ title: type, ...(type === "ae/card-deck" ? { "x-ourapps-modules": { web: "web/index.ts" } } : {}) });

// A components directory as a workspace holds one: <short name>/component.json, suitability.json and the documents.
// `patch(manifest, documents)` may change a manifest and the documents (path to text) written beside it.
function componentsDirectory(patch = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "components-"));
  for (const entry of exampleComponentEntries()) {
    const short = entry.name.split("/")[1];
    const documents = Object.fromEntries(entry.provides.map((p) => [`interfaces/${p.id}.json`, documentOf(p.type)]));
    const manifest = {
      identity: { name: entry.name, version: entry.version },
      provides: entry.provides.map((p) => ({ ...p, path: `interfaces/${p.id}.json` })),
      requires: entry.requires.map((p) => ({ ...p, path: `interfaces/required-${p.id}.json` })),
      collect: entry.settings.map(({ hasDefault, ...s }) => ({ ...s, ...(hasDefault ? { default: s.type === "integer" ? 2 : s.type === "boolean" ? false : "brief" } : {}) })),
      files: Object.keys(documents).map((path) => ({ path, executable: false })),
      artefacts: [{ source: "web/index.ts", destination: `components/${short}/web/index.ts` }],
    };
    patch(manifest, documents);
    const folder = join(dir, short);
    mkdirSync(join(folder, "interfaces"), { recursive: true });
    writeFileSync(join(folder, "component.json"), JSON.stringify(manifest));
    writeFileSync(join(folder, "suitability.json"), JSON.stringify(entry.suitability));
    for (const [path, text] of Object.entries(documents)) writeFileSync(join(folder, path), text);
  }
  return dir;
}

describe("scripts/validate-recipe-file.ts", () => {
  it("exits 0 for a valid recipe", () => {
    const result = run(exampleRecipeEntry().recipe);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("valid (no components read)");
  });

  it("prints each error and exits 1 for an invalid recipe", () => {
    const recipe = structuredClone(exampleRecipeEntry().recipe);
    recipe.questions[0].effects = [{ includes: { web: ["web-host"] } }];
    recipe.extra = {};
    const result = run(recipe);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- questions[0].effects[0]: unknown field includes");
    expect(result.stderr).toContain("- recipe: unknown field extra");
  });

  it("type-checks CEL conditions and names the slot or question", () => {
    const recipe = structuredClone(exampleRecipeEntry().recipe);
    recipe.components[4].includedWhen = "lessons == 'yes'";
    recipe.questions[4].askWhen = "{'a': 1}";
    const result = run(recipe);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- components[4].includedWhen (slot tour): == compares bool with string; both sides must have one type");
    expect(result.stderr).toContain("- questions[4].askWhen (question tourStyle): a map or message literal is not allowed");
  });

  it("checks each slot's preferred component against a components directory", () => {
    const valid = run(exampleRecipeEntry().recipe, ["--components", componentsDirectory()]);
    expect(valid.stderr).toBe("");
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("valid (5 components read from");

    const unfit = run(exampleRecipeEntry().recipe, ["--components", componentsDirectory((m) => m.identity.name === "acme/seating" && (m.collect = []))]);
    expect(unfit.status).toBe(1);
    expect(unfit.stderr).toContain("- components[1].preferred: acme/seating 0.1.0 does not fit the class of slot seats: setting:minimumPlayers");

    const unlisted = run(exampleRecipeEntry().recipe, ["--components", componentsDirectory((m) => m.identity.name === "acme/card-deck" && (m.files = []))]);
    expect(unlisted.stderr).toContain("- components[0].preferred: acme/card-deck 0.1.0 does not fit the class of slot deck: document:ae/card-deck@1.0.0");

    const uninstalled = run(exampleRecipeEntry().recipe, ["--components", componentsDirectory((m) => m.identity.name === "acme/card-deck" && (m.artefacts = []))]);
    expect(uninstalled.stderr).toContain("- components[0].preferred: acme/card-deck 0.1.0 does not fit the class of slot deck: module:web:web/index.ts");

    const moved = run(exampleRecipeEntry().recipe, ["--components", componentsDirectory((m) => m.identity.name === "acme/apple-host" && (m.identity.version = "0.2.0"))]);
    expect(moved.status).toBe(1);
    expect(moved.stderr).toContain("- components[3].preferred acme/apple-host 0.1.0 is not in the components in");
    expect(moved.stderr).toContain("which has version 0.2.0");

    const secret = structuredClone(exampleRecipeEntry().recipe);
    secret.components[2].configuration = { accountReference: "plain" };
    expect(run(secret, ["--components", componentsDirectory()]).stderr).toContain("- components[2].configuration.accountReference is secret");
  });

  it("checks a job candidate's interface documents against the preferred component's", () => {
    const recipe = structuredClone(exampleRecipeEntry().recipe);
    recipe.jobs[0].candidates.push({ component: "acme/other-host", version: "0.1.0", profile: "free" });
    // Another host: a copy of the server host under another name, with the given interface document.
    const withOther = (text) => {
      const dir = componentsDirectory();
      const folder = join(dir, "other-host");
      cpSync(join(dir, "server-host"), folder, { recursive: true });
      const manifest = JSON.parse(readFileSync(join(folder, "component.json"), "utf8"));
      manifest.identity.name = "acme/other-host";
      writeFileSync(join(folder, "component.json"), JSON.stringify(manifest));
      writeFileSync(join(folder, "interfaces/server-host.json"), text);
      return dir;
    };
    const same = run(recipe, ["--components", withOther(documentOf("ae/server-host"))]);
    expect(same.stderr).toBe("");
    expect(same.status).toBe(0);
    const changed = run(recipe, ["--components", withOther(`${documentOf("ae/server-host")}\n`)]);
    expect(changed.stderr).toContain("- jobs[0].candidates[2]: acme/other-host 0.1.0 does not fit the class of slot host: document:ae/server-host@1.0.0");
  });

  it("exits 2 when the file cannot be read", () => {
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "/nonexistent/recipe.json"], { encoding: "utf8" });
    expect(result.status).toBe(2);
  });
});
