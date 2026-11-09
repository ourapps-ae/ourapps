// Validates a recipe.json with the same rules the library applies on publication.
// Usage: node scripts/validate-recipe-file.ts <recipe.json> [--components <directory>] [--no-components]
// Component data (settings from component.json, profiles from suitability.json) is read from
// <directory>/<name>/ and checked too; the default directory is ../../components next to the
// recipe's folder when it exists. The recipe's own component.json supplies the settings of `application`.
// Exit code 0: valid. 1: errors, printed one per line. 2: the file cannot be read.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--components");
if (!file) {
  console.error("usage: node scripts/validate-recipe-file.ts <recipe.json> [--components <directory>] [--no-components]");
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ entryPoints: [join(root, "shared/src/catalogue.ts")], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const catalogue = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`)) as {
  validateRecipe: (input: unknown, context?: unknown) => { ok: true } | { ok: false; errors: string[] };
};

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

const recipePath = resolve(file);
const recipeDirectory = dirname(recipePath);
const input = readJson(recipePath);

const settings: Record<string, unknown[]> = {};
const profiles: Record<string, unknown[]> = {};
const componentsDirectory = args.includes("--no-components") ? null : flag("--components") ? resolve(flag("--components") as string) : existsSync(resolve(recipeDirectory, "../../components")) ? resolve(recipeDirectory, "../../components") : null;
let loaded = 0;
if (componentsDirectory) {
  for (const entry of readdirSync(componentsDirectory, { withFileTypes: true })) {
    const manifest = join(componentsDirectory, entry.name, "component.json");
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    const data = readJson(manifest);
    const name = data?.identity?.name;
    if (typeof name !== "string") continue;
    loaded++;
    settings[name] = Array.isArray(data.collect) ? data.collect : [];
    const suitability = join(componentsDirectory, entry.name, "suitability.json");
    if (existsSync(suitability)) {
      const s = readJson(suitability);
      if (Array.isArray(s.profiles)) profiles[name] = s.profiles;
    }
  }
}
const own = join(recipeDirectory, "component.json");
if (existsSync(own)) {
  const data = readJson(own);
  settings.application = Array.isArray(data.collect) ? data.collect : [];
}

const result = catalogue.validateRecipe(input, { settings, profiles });
if (result.ok) {
  console.log(`${recipePath}: valid (${loaded} components read for settings and profiles)`);
} else {
  console.error(`${recipePath}: ${result.errors.length} errors (${loaded} components read for settings and profiles)`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}
