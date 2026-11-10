// Renders the diagrams of the OurPoker test fixture into a directory, for looking at them.
// Usage: node scripts/render-diagrams.ts <directory>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const out = resolve(process.argv[2] ?? "diagrams");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ entryPoints: [join(root, "shared/src/fixtures/render.ts")], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { renderAll } = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`)) as { renderAll: () => Record<string, string> };
mkdirSync(out, { recursive: true });
for (const [name, svg] of Object.entries(renderAll())) {
  writeFileSync(join(out, name), svg);
  const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  console.log(`${join(out, name)} ${size?.[1]}x${size?.[2]}`);
}
