// Validates a recipe.json with the same rules the library applies on publication.
// Usage: node scripts/validate-recipe-file.ts <recipe.json> [--components <directory>] [--no-components]
// Each <directory>/<name>/component.json (provides, requires, collect, files, artefacts, and the provided interface
// documents) and suitability.json (profiles) is the component source the slots are checked against: every preferred
// component and job candidate must be there at its version and fit its slot's class by aepm's fit rule. The default directory is ../../components next to the recipe's folder when it exists. The
// recipe's own component.json supplies the settings and ports of `application`.
// Exit code 0: valid. 1: errors, printed one per line. 2: a file cannot be read.
import { createHash } from "node:crypto";
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

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
// component.json collect, as a catalogue entry records it.
const settingsOf = (manifest: any) => list(manifest?.collect).map((s: any) => ({ id: s.id, type: s.type, grammar: s.grammar, required: s.required === true, secret: s.secret === true, hasDefault: "default" in s }));
const portsOf = (value: unknown) => list(value).map((p: any) => ({ id: p.id, type: p.type, version: p.version, ...(p.optional === true ? { optional: true } : {}) }));

const NATIVE = ["apple", "android"];

// The fit facts of the provided interface documents, as a catalogue entry records them: the sha256 of each document
// the manifest lists in `files`, and the entry modules each declares in "x-ourapps-modules", installed when an artefact
// lands at components/<short name>/<path> (inside that folder for apple and android).
function interfacesOf(manifest: any, folder: string) {
  const listed = new Set(list(manifest.files).map((f: any) => f?.path));
  const short = `components/${String(manifest.identity.name).split("/")[1]}/`;
  const destinations = list(manifest.artefacts).map((a: any) => a?.destination).filter((d: unknown): d is string => typeof d === "string");
  const interfaceDigests: Record<string, string> = {};
  const interfaceModules: Record<string, Record<string, { path: string | null; installed: boolean }>> = {};
  for (const port of list(manifest.provides)) {
    const path = join(folder, String(port.path));
    if (!listed.has(port.path) || !existsSync(path)) continue;
    const bytes = readFileSync(path);
    const key = `${port.type}@${port.version}`;
    interfaceDigests[key] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    let document: any;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    const modules = document && typeof document === "object" ? document["x-ourapps-modules"] : null;
    if (!modules || typeof modules !== "object") continue;
    interfaceModules[key] = Object.fromEntries(
      Object.entries(modules).map(([platform, path]) => {
        if (typeof path !== "string") return [platform, { path: null, installed: false }];
        const installed = NATIVE.includes(platform) ? destinations.some((d) => d.startsWith(`${short}${path.replace(/\/+$/, "")}/`)) : destinations.includes(short + path);
        return [platform, { path, installed }];
      }),
    );
  }
  return { interfaceDigests, interfaceModules };
}

const recipePath = resolve(file);
const recipeDirectory = dirname(recipePath);
const input = readJson(recipePath);

const componentsDirectory = args.includes("--no-components") ? null : flag("--components") ? resolve(flag("--components") as string) : existsSync(resolve(recipeDirectory, "../../components")) ? resolve(recipeDirectory, "../../components") : null;
const facts = new Map<string, unknown>();
if (componentsDirectory) {
  for (const entry of readdirSync(componentsDirectory, { withFileTypes: true })) {
    const manifestPath = join(componentsDirectory, entry.name, "component.json");
    if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    const name = manifest?.identity?.name;
    if (typeof name !== "string") continue;
    const suitabilityPath = join(componentsDirectory, entry.name, "suitability.json");
    const profiles = existsSync(suitabilityPath) ? list(readJson(suitabilityPath).profiles).map((p: any) => ({ id: p.id, ...(p.settings ? { settings: p.settings } : {}) })) : [];
    facts.set(name, { name, version: manifest.identity.version, provides: portsOf(manifest.provides), requires: portsOf(manifest.requires), settings: settingsOf(manifest), ...interfacesOf(manifest, join(componentsDirectory, entry.name)), profiles });
  }
}
const own = join(recipeDirectory, "component.json");
const application = existsSync(own) ? (() => {
  const manifest = readJson(own);
  return { settings: settingsOf(manifest), provides: portsOf(manifest.provides), requires: portsOf(manifest.requires) };
})() : undefined;

const context = {
  ...(componentsDirectory ? { components: { source: `the components in ${componentsDirectory}`, find: (name: string) => facts.get(name) ?? null } } : {}),
  ...(application ? { application } : {}),
};
const result = catalogue.validateRecipe(input, context);
const read = componentsDirectory ? `${facts.size} components read from ${componentsDirectory}` : "no components read";
if (result.ok) {
  console.log(`${recipePath}: valid (${read})`);
} else {
  console.error(`${recipePath}: ${result.errors.length} errors (${read})`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}
