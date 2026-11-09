import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleRecipeEntry } from "../src/index.ts";

const script = resolve(import.meta.dirname, "../../scripts/validate-recipe-file.ts");

function run(recipe) {
  const dir = mkdtempSync(join(tmpdir(), "recipe-"));
  const path = join(dir, "recipe.json");
  writeFileSync(path, JSON.stringify(recipe));
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, path, "--no-components"], { encoding: "utf8" });
}

describe("scripts/validate-recipe-file.ts", () => {
  it("exits 0 for a valid recipe", () => {
    const result = run(exampleRecipeEntry().recipe);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("valid");
  });

  it("prints each error and exits 1 for an invalid recipe", () => {
    const recipe = structuredClone(exampleRecipeEntry().recipe) ;
    recipe.questions[0].effects = [{ includes: { web: ["web-host"] } }];
    recipe.extra = {};
    const result = run(recipe);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- questions[0].effects[0]: unknown field includes");
    expect(result.stderr).toContain("- recipe: unknown field extra");
  });

  it("exits 2 when the file cannot be read", () => {
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "/nonexistent/recipe.json"], { encoding: "utf8" });
    expect(result.status).toBe(2);
  });
});
