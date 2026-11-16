import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { descriptorDigest, graphProblems, GRAMMAR_PATTERNS, componentFacts, exampleComponentEntry, fit, validateFoundations, validateDescriptor } from "../src/index.ts";

const fixtures = JSON.parse(readFileSync(new URL("../src/fixtures/foundation-parity.json", import.meta.url), "utf8"));
const apply = (root, fixture) => { if (!fixture.path.length) return; let target = root; for (const key of fixture.path.slice(0, -1)) target = target[key]; target[fixture.path.at(-1)] = fixture.value; };
function base() {
  const e = exampleComponentEntry();
  // These hashes bind the bytes supplied by the Python comparison package.
  for (const c of e.foundations.classes) {
    for (const item of c.descriptor.inventory) item.digest = item.path.endsWith(".json") ? "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    c.reference.digest = descriptorDigest(c.descriptor);
  }
  e.foundations.implements = e.foundations.classes.map(c => structuredClone(c.reference));
  return e;
}
function result(fixture) {
  if (fixture.area === "graph") return graphProblems(fixture.compatibility.map((compatibility, i) => { const entry = base(); Object.assign(entry.foundations.compatibility, compatibility); return { name: `package-${i}`, foundations: entry.foundations }; })).length === 0;
  const e = base(); const authority = structuredClone(e.foundations); const reference = structuredClone(e.foundations.implements[0]);
  apply(fixture.area === "fit" ? e : e.foundations, fixture);
  return fixture.area === "fit" ? fit(reference, componentFacts(e), authority) : validateFoundations(e.foundations, "component", Object.values(GRAMMAR_PATTERNS)).length === 0;
}
describe("cross-language foundation fixtures", () => {
  it("checks the documented class descriptor and its digest", () => {
    const doc = readFileSync(new URL("../../docs/package-foundations.md", import.meta.url), "utf8");
    const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(doc)[1]);
    expect(validateDescriptor(example.descriptor, Object.values(GRAMMAR_PATTERNS))).toEqual([]);
    expect(descriptorDigest(example.descriptor)).toBe(example.reference.digest);
  });
  it.each(fixtures)("$id", fixture => expect(result(fixture)).toEqual(fixture.area === "fit" ? fixture.reasons : fixture.valid));
  it.skipIf(!process.env.AEPM_SOURCE)("matches Python foundation and fit results", () => {
    const script = String.raw`
import copy, json, sys
from aepm.foundations import validate_foundations, validate_graph
from aepm.recipe import fit
from aepm.model import AepmError, licence
data = json.load(sys.stdin)
def manifest(entry):
    f = copy.deepcopy(entry['foundations'])
    f['identity'] = {'name': entry['name'], 'version': entry['version'], 'licence': f.pop('licence')}
    f['kind'] = 'component'
    f['provides'], f['requires'] = entry['provides'], entry['requires']
    f['collect'] = [{**{k:v for k,v in s.items() if k != 'hasDefault'}, **({'default': 0} if s['hasDefault'] else {})} for s in entry['settings']]
    return f
class Package:
    def __init__(self, entry): self.manifest = manifest(entry); self.name = entry['name']
    def file(self, path): return b'{}' if path.endswith('.json') else b''
results = []
for fixture in data['fixtures']:
    if fixture['area'] == 'graph':
        manifests = []
        for compatibility in fixture['compatibility']:
            entry = copy.deepcopy(data['entry']); entry['foundations']['compatibility'].update(compatibility); manifests.append(manifest(entry))
        try: validate_graph(manifests); results.append(True)
        except AepmError: results.append(False)
        continue
    entry = copy.deepcopy(data['entry']); authority = Package(copy.deepcopy(entry)); ref = copy.deepcopy(entry['foundations']['implements'][0])
    target = entry if fixture['area'] == 'fit' else entry['foundations']
    if fixture['path']:
        for key in fixture['path'][:-1]: target = target[key]
        target[fixture['path'][-1]] = fixture['value']
    if fixture['area'] == 'fit': results.append(fit(ref, Package(entry), authority))
    else:
        try: licence(entry['foundations']['licence'], 'identity.licence'); validate_foundations(manifest(entry)); results.append(True)
        except AepmError: results.append(False)
print(json.dumps(results))
`;
    const child = spawnSync("python3", ["-c", script], { input: JSON.stringify({ entry: base(), fixtures }), encoding: "utf8", env: { ...process.env, PYTHONPATH: process.env.AEPM_SOURCE, PYTHONDONTWRITEBYTECODE: "1" } });
    expect(child.stderr).toBe(""); expect(child.status).toBe(0); expect(JSON.parse(child.stdout)).toEqual(fixtures.map(result));
  });
});
