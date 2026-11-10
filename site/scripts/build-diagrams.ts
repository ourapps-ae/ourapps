// Writes the fixed diagrams into public/diagrams from their builders in src/diagrams.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(site, "public", "diagrams");
const bundled = await build({ entryPoints: [join(site, "src/diagrams/cooking.ts")], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { cookingSvg } = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString("base64")}`)) as { cookingSvg: () => string };
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "cooking-a-recipe.svg"), cookingSvg() + "\n");
console.log(`wrote ${join(out, "cooking-a-recipe.svg")}`);
