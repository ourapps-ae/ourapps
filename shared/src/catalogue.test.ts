import { describe, expect, it } from "vitest";
import { classDescriptor, canonical, descriptorDigest, graphProblems, selectedTargets, validLicence, validateFoundations, validateDescriptor, GRAMMAR_PATTERNS, componentFacts, fit, exampleComponentEntries, exampleComponentEntry, exampleAlternativeEntry, exampleRecipeEntry, exampleRecipeContext, isCatalogueName, isCatalogueSlug, isDigest, isPackagePath, isRepository, isSafeSvg, isVersion, compareVersions, newestVersion, propertyKind, settingSchema, validateRecipe, validateRecipeEntry, validateComponentEntry, validateSuitability, summariseMigration } from "./index.js";

const patterns = Object.values(GRAMMAR_PATTERNS);
const errors = (r: { ok: boolean; errors?: string[] }) => r.ok ? "" : r.errors!.join(" | ");
type Mutable = Record<string, any>;
const changedComponent = (patch: (e: Mutable) => void) => { const e = exampleComponentEntry(); patch(e); return validateComponentEntry(e); };
const changedRecipe = (patch: (e: Mutable) => void, components = true) => { const e = exampleRecipeEntry(); patch(e); return validateRecipeEntry(e, components ? exampleRecipeContext() : {}); };

describe("catalogue names and pointers", () => {
  it.each(["ab", "poker-night", "i18n", "web-host", "a1-b2"])("accepts slug %s", v => expect(isCatalogueSlug(v)).toBe(true));
  it.each(["", "a", "Poker", "poker_night", "-poker", "poker-", "poker--night", "a".repeat(41), "search"])("refuses slug %s", v => expect(isCatalogueSlug(v)).toBe(false));
  it.each(["0.0.0", "1.2.3", "10.20.30"])("accepts version %s", v => expect(isVersion(v)).toBe(true));
  it.each(["1", "1.2", "1.2.3.4", "01.2.3", "1.2.x", "v1.2.3", "1.2.3-rc1"])("refuses version %s", v => expect(isVersion(v)).toBe(false));
  it("orders numeric versions", () => { expect(compareVersions("1.10.0", "1.2.0")).toBe(1); expect(newestVersion(["1.2.0", "1.10.0"])).toBe("1.10.0"); expect(newestVersion([])).toBeNull(); });
  it("checks names, digests, repository and package paths", () => {
    expect(isCatalogueName("acme/card-deck")).toBe(true); expect(isCatalogueName("Card-Deck")).toBe(false);
    expect(isDigest(`sha256:${"a".repeat(64)}`)).toBe(true); expect(isDigest("sha256:abc")).toBe(false);
    expect(isRepository("acme/deck")).toBe(true); expect(isRepository("https://github.com/acme/deck")).toBe(false);
    expect(isPackagePath("src/main.ts")).toBe(true); for (const p of ["../x", "/x", "x/../y", "x\\y", "x//y"]) expect(isPackagePath(p)).toBe(false);
  });
  it.each(["<script>x</script>", '<svg onload="x()"></svg>', '<svg><image href="https://evil.example/x" /></svg>', '<svg><foreignObject /></svg>'])("rejects unsafe diagram %s", v => expect(isSafeSvg(v)).toBe(false));
});

describe("foundation declarations", () => {
  it("validates every example and recipe without preferred documents", () => {
    for (const e of [...exampleComponentEntries(), exampleAlternativeEntry()]) expect(errors(validateComponentEntry(e)), e.name).toBe("");
    expect(errors(validateRecipeEntry(exampleRecipeEntry()))).toBe("");
    expect(errors(validateRecipeEntry(exampleRecipeEntry(), exampleRecipeContext()))).toBe("");
  });
  it.each(["licence", "platforms", "classes", "implements", "upstream", "compatibility", "maintenance", "files", "artefacts"])("requires %s", field => {
    expect(changedComponent(e => delete e.foundations[field]).ok).toBe(false);
  });
  it.each(["MIT", "MIT OR Apache-2.0", "(MIT OR Apache-2.0) AND BSD-3-Clause", "GPL-2.0+ WITH Classpath-exception-2.0", "LicenseRef-Private", "DocumentRef-src:LicenseRef-Custom"])("accepts licence expression %s", v => expect(validLicence(v)).toBe(true));
  it.each(["", "MIT ", "MIT Apache-2.0", "MIT AND", "(MIT", "MIT WITH", "MIT || BSD", "MIT AND OR BSD"])("rejects licence expression %s", v => expect(validLicence(v)).toBe(false));
  it("rejects timestamp claims and absent metadata", () => {
    expect(changedComponent(e => e.foundations.lastSuccessfulVerification = "2026-11-15").ok).toBe(false);
    expect(changedComponent(e => e.lastSuccessfulVerification = "2026-11-15").ok).toBe(false);
    expect(changedComponent(e => delete e.foundations).ok).toBe(false);
  });
  it("retains strict artefact slot conditions", () => {
    const e = exampleComponentEntry(); e.foundations.artefacts[0].component = ["video", "rooms"];
    expect(errors(validateComponentEntry(e))).toBe("");
    e.foundations.artefacts[0].withoutComponent = "video"; expect(validateComponentEntry(e).ok).toBe(false);
  });
  it.each([
    ["unknown platform", (f: Mutable) => f.platforms.push("apple")],
    ["empty platforms", (f: Mutable) => f.platforms = []],
    ["duplicate platforms", (f: Mutable) => f.platforms.push("web")],
    ["invalid licence", (f: Mutable) => f.licence = { name: "MIT" }],
    ["no owners", (f: Mutable) => f.maintenance.owners = []],
    ["contact", (f: Mutable) => f.maintenance.contact = "not-an-address"],
    ["update source", (f: Mutable) => f.maintenance.updates.source = "http://example.org"],
    ["update strategy", (f: Mutable) => f.maintenance.updates.strategy = "automatic"],
    ["class digest", (f: Mutable) => f.classes[0].descriptor.version = "2.0.0"],
    ["class reference", (f: Mutable) => f.classes[0].reference.extra = true],
    ["class inventory missing", (f: Mutable) => f.files = []],
    ["implementation missing", (f: Mutable) => f.implements = []],
    ["unknown implementation", (f: Mutable) => f.implements[0].digest = "0".repeat(64)],
    ["runtime range", (f: Mutable) => f.compatibility.runtimes.node = "^22.0.0"],
    ["empty range", (f: Mutable) => f.compatibility.runtimes.node = ">=22.0.0 <22.0.0"],
    ["dependency pin", (f: Mutable) => f.compatibility.dependencies = [{ name: "pkg:npm/x@1.0.0", version: "1.0.0", isolation: "shared" }]],
    ["style namespace", (f: Mutable) => f.compatibility.styles = { scope: "global", namespaces: [], conflicts: [] }],
    ["none styles", (f: Mutable) => f.compatibility.styles.namespaces = ["body"]],
  ] as [string, (f: Mutable) => void][])("rejects malformed %s", (_, patch) => expect(changedComponent(e => patch(e.foundations)).ok).toBe(false));
  it.each([
    ["fields", (c: Mutable) => c.extra = 1], ["format", (c: Mutable) => c.format = true],
    ["interface path", (c: Mutable) => c.provides[0].path = "missing.json"], ["module map", (c: Mutable) => c.provides[0].modules = {}],
    ["module platform", (c: Mutable) => c.provides[0].modules.apple = ["x"]], ["unsafe module", (c: Mutable) => c.provides[0].modules.web = ["../x"]],
    ["open settings", (c: Mutable) => c.settings.additionalProperties = true], ["setting grammar", (c: Mutable) => c.settings.properties.x = { type: "string", pattern: "^x$" }],
    ["setting type", (c: Mutable) => c.settings.properties.x = { type: "number" }], ["required setting", (c: Mutable) => c.settings.required = ["ghost"]],
    ["empty suite", (c: Mutable) => c.verification = []], ["external requirement", (c: Mutable) => c.verification[0].requirements = ["internet"]],
    ["suite root", (c: Mutable) => c.verification[0].root = "application"], ["suite working directory", (c: Mutable) => c.verification[0].cwd = "src"],
    ["suite inventory", (c: Mutable) => c.verification[0].fixtures = ["missing.mjs"]], ["suite command", (c: Mutable) => c.verification[0].argv = ["node", "missing.mjs"]],
    ["tool pin", (c: Mutable) => c.verification[0].tools.node = "latest"], ["suite timeout", (c: Mutable) => c.verification[0].timeoutSeconds = 901],
    ["suite exit", (c: Mutable) => c.verification[0].expectedExit = 1], ["suite network", (c: Mutable) => c.verification[0].network = "no"],
  ] as [string, (c: Mutable) => void][])("rejects invalid class %s", (_, patch) => {
    const c = exampleComponentEntry().foundations.classes[0].descriptor; patch(c); expect(validateDescriptor(c, patterns).length).toBeGreaterThan(0);
  });
  it.each([null, [], 1, "x", {}, { classes: [null] }])("returns errors for arbitrary input %j", v => expect(validateFoundations(v, "component", patterns).length).toBeGreaterThan(0));
  it("hashes canonical descriptor bytes and rejects lone surrogates", () => {
    expect(canonical({ z: 1, a: [true, null, "é"] })).toBe('{"a":[true,null,"é"],"z":1}');
    const c = exampleComponentEntry().foundations.classes[0]; expect(descriptorDigest(c.descriptor)).toBe(c.reference.digest);
    expect(descriptorDigest(Object.fromEntries(Object.entries(c.descriptor).reverse()))).toBe(c.reference.digest);
    expect(() => canonical("\ud800")).toThrow();
  });
  it("preserves separate upstream and wrapper licences and exact delivery", () => {
    const e = exampleComponentEntry(); e.foundations.upstream = [{ name: "library", version: "4.2.0", revision: "abc123", repository: "https://example.org/library", purl: "pkg:npm/library@4.2.0", licence: "MIT OR BSD-3-Clause", notices: ["NOTICE.library"], delivery: { kind: "bundled", files: [{ path: "vendor/library.mjs", digest: "e".repeat(64) }] } }];
    e.foundations.files.push({ path: "NOTICE.library", executable: false }, { path: "vendor/library.mjs", executable: false });
    expect(errors(validateComponentEntry(e))).toBe("");
    for (const change of [(u: Mutable) => u.notices = [], (u: Mutable) => u.notices = ["absent"], (u: Mutable) => u.purl = "pkg:npm/library@4.1.0", (u: Mutable) => u.revision = "", (u: Mutable) => u.licence = "MIT AND", (u: Mutable) => u.delivery.files[0].digest = "oops"]) {
      const invalid = structuredClone(e); change(invalid.foundations.upstream[0]); expect(validateComponentEntry(invalid).ok).toBe(false);
    }
    const build = structuredClone(e); build.foundations.files.push({ path: "package-lock.json", executable: false });
    build.foundations.upstream[0].delivery = { kind: "build-time", manager: "npm", lock: "package-lock.json", digest: "f".repeat(64), packagePath: "node_modules/library", integrity: `sha512-${btoa("a".repeat(64))}` };
    expect(errors(validateComponentEntry(build))).toBe("");
    build.foundations.upstream[0].delivery.integrity = "sha512-bad"; expect(validateComponentEntry(build).ok).toBe(false);
  });
});

describe("independent class fit", () => {
  const candidate = () => componentFacts(exampleComponentEntries()[1]);
  const authority = () => exampleRecipeEntry().foundations;
  const reference = () => exampleRecipeEntry().recipe.components[1].class;
  it("fits independent implementation metadata with different provider documents", () => {
    const e = exampleAlternativeEntry(); e.interfaceDigests["ae/seating@1.0.0"] = `sha256:${"f".repeat(64)}`;
    expect(fit(reference(), componentFacts(e), authority())).toEqual([]);
  });
  it.each([
    ["provides", (c: Mutable) => c.provides = [], "provides:ae/seating@1.0.0"],
    ["version", (c: Mutable) => c.provides[0].version = "2.0.0", "provides:ae/seating@1.0.0"],
    ["requirement", (c: Mutable) => c.requires.push({ id: "audit", type: "ae/audit", version: "1.0.0" }), "requires:ae/audit@1.0.0"],
    ["setting", (c: Mutable) => c.settings = [], "setting:minimumPlayers"],
    ["setting type", (c: Mutable) => { c.settings[0].type = "string"; c.settings[0].grammar = "slug"; }, "setting-type:minimumPlayers"],
    ["required default", (c: Mutable) => c.settings.push({ id: "extra", type: "integer", grammar: "integer", required: true, secret: false, hasDefault: false }), "unset-setting:extra"],
    ["implementation", (c: Mutable) => c.foundations.implements = [], "class-implementation:ourapps-ae/seating-class"],
    ["platform", (c: Mutable) => c.foundations.platforms = ["server"], "platform:web"],
    ["module", (c: Mutable) => c.foundations.artefacts = [], "module:web:index.mjs"],
  ] as [string, (c: Mutable) => void, string][])("rejects candidate %s", (_, patch, reason) => { const c = candidate(); patch(c); expect(fit(reference(), c, authority())).toContain(reason); });
  it("rejects altered descriptor under the same reference", () => { const c = candidate(); c.foundations.classes[0].descriptor.provides[0].modules.web = ["changed.mjs"]; expect(fit(reference(), c, authority())).toContain("class-digest:ourapps-ae/seating-class"); });
  it("reports absent independent authority", () => expect(fit(reference(), candidate(), null)).toEqual(["class-unavailable:ourapps-ae/seating-class"]));
  it("checks selected target modules and retains server", () => {
    const c = candidate(); c.foundations.platforms = ["server"]; expect(fit(reference(), c, authority(), ["server"])).toEqual([]);
    expect(selectedTargets(authority(), { targets: ["web"] })).toEqual(["server", "web"]);
    expect(() => selectedTargets(authority(), { targets: ["tvos"] })).toThrow("unsupported-platform");
    expect(selectedTargets(authority(), {})).toEqual(authority().platforms);
  });
  it("accepts optional additional requirements and required settings with defaults", () => {
    const c = candidate(); c.requires.push({ id: "audit", type: "ae/audit", version: "1.0.0", optional: true }); c.settings.push({ id: "extra", type: "integer", grammar: "integer", required: true, secret: false, hasDefault: true }); expect(fit(reference(), c, authority())).toEqual([]);
  });
});

describe("native provenance declarations", () => {
  const source = (manager: "swift" | "gradle" | "npm") => {
    const e = exampleComponentEntry();
    e.foundations.files.push({ path: "NOTICE", executable: false }, { path: "lock", executable: false }, { path: "verification.xml", executable: false });
    const delivery = manager === "swift" ? { kind: "build-time", manager, lock: "lock", digest: "e".repeat(64) } : manager === "gradle" ? { kind: "build-time", manager, lock: "lock", digest: "e".repeat(64), verification: { path: "verification.xml", digest: "f".repeat(64) }, configurations: ["runtimeClasspath"], artifacts: [{ name: "lib-1.0.jar", digest: "d".repeat(64) }] } : { kind: "build-time", manager, lock: "lock", digest: "e".repeat(64), packagePath: "node_modules/parent/node_modules/lib", integrity: `sha512-${btoa("a".repeat(64))}` };
    const upstream = { name: "lib", version: "1.0", revision: manager === "gradle" ? null : "a".repeat(40), repository: "https://example.org/lib", purl: manager === "gradle" ? "pkg:maven/org.example/lib@1.0" : `pkg:${manager}/lib@1.0`, licence: "MIT", notices: ["NOTICE"], delivery };
    e.foundations.upstream = [upstream as any]; return e;
  };
  it.each(["swift", "gradle", "npm"] as const)("accepts exact %s delivery", manager => expect(errors(validateComponentEntry(source(manager)))).toBe(""));
  it.each(["swift", "gradle", "npm"] as const)("rejects mismatched %s package URL", manager => { const e = source(manager); e.foundations.upstream[0].purl = "pkg:generic/lib@1.0"; expect(validateComponentEntry(e).ok).toBe(false); });
  it("requires npm packagePath and matching scoped or nested identity", () => { const e = source("npm") as any; delete e.foundations.upstream[0].delivery.packagePath; expect(validateComponentEntry(e).ok).toBe(false); e.foundations.upstream[0].delivery.packagePath = "node_modules/other"; expect(validateComponentEntry(e).ok).toBe(false); });
  it("requires Swift Git revision and Gradle verification inventory", () => { const swift = source("swift"); swift.foundations.upstream[0].revision = "v1.0"; expect(validateComponentEntry(swift).ok).toBe(false); const gradle = source("gradle") as any; gradle.foundations.upstream[0].delivery.verification.path = "absent.xml"; expect(validateComponentEntry(gradle).ok).toBe(false); });
  it("requires wrapper attribution and exact distribution version", () => {
    const e = exampleComponentEntry(); e.foundations.files.push({ path: "gradle/gradle-wrapper.jar", executable: false }, { path: "gradle/gradle-wrapper.properties", executable: false }, { path: "NOTICE", executable: false });
    expect(validateComponentEntry(e).ok).toBe(false);
    e.foundations.upstream = [{ name: "gradle-wrapper", version: "8.14", revision: null, repository: "https://github.com/gradle/gradle", purl: "pkg:generic/gradle-wrapper@8.14", licence: "Apache-2.0", notices: ["NOTICE"], delivery: { kind: "bundled", files: [{ path: "gradle/gradle-wrapper.jar", digest: "e".repeat(64) }, { path: "gradle/gradle-wrapper.properties", digest: "f".repeat(64) }], gradleWrapper: { jar: "gradle/gradle-wrapper.jar", properties: "gradle/gradle-wrapper.properties", distribution: { url: "https://services.gradle.org/distributions/gradle-8.14-bin.zip", digest: "a".repeat(64) } } } }];
    expect(errors(validateComponentEntry(e))).toBe("");
    (e.foundations.upstream[0].delivery as any).gradleWrapper.distribution.url = "https://services.gradle.org/distributions/gradle-8.15-bin.zip"; expect(validateComponentEntry(e).ok).toBe(false);
  });
});

describe("graph constraints", () => {
  const pair = () => [exampleComponentEntry(), exampleAlternativeEntry()].map(e => ({ name: e.name, foundations: e.foundations }));
  it.each(["runtimes", "frameworks"] as const)("checks %s range intersections", kind => {
    const p = pair(); if (kind === "runtimes") { p[0].foundations.compatibility.runtimes.node = ">=22.0.0 <24.0.0"; p[1].foundations.compatibility.runtimes.node = ">=24.0.0"; }
    else { p[0].foundations.compatibility.frameworks["web-ui"] = { name: "react", range: "=19.0.0" }; p[1].foundations.compatibility.frameworks["web-ui"] = { name: "react", range: ">19.0.0" }; }
    expect(graphProblems(p).join()).toContain("compatibility-range-conflict");
  });
  it("rejects different frameworks in the same role", () => { const p = pair(); p[0].foundations.compatibility.frameworks.ui = { name: "react", range: ">=1.0.0" }; p[1].foundations.compatibility.frameworks.ui = { name: "vue", range: ">=1.0.0" }; expect(graphProblems(p)).toContain("framework-conflict:ui"); });
  it.each(["shared", "isolated"] as const)("checks %s dependency versions", isolation => { const p = pair(); for (let i = 0; i < 2; i++) p[i].foundations.compatibility.dependencies = [{ name: "pkg:npm/lib", version: `${i + 1}.0.0`, isolation }]; expect(graphProblems(p).length).toBe(isolation === "shared" ? 1 : 0); });
  it.each(["global", "scoped"] as const)("checks %s namespace overlap", scope => { const p = pair(); for (const m of p) m.foundations.compatibility.styles = { scope, namespaces: ["controls"], conflicts: [] }; expect(graphProblems(p).length).toBe(scope === "global" ? 1 : 0); });
  it("checks conflicts in both directions", () => { const p = pair(); p[0].foundations.compatibility.styles = { scope: "scoped", namespaces: ["one"], conflicts: ["two"] }; p[1].foundations.compatibility.styles = { scope: "scoped", namespaces: ["two"], conflicts: [] }; expect(graphProblems(p)).toHaveLength(1); expect(graphProblems(p.reverse())).toHaveLength(1); });
  it("rejects same class identity with a different digest", () => { const p = pair(); p[1].foundations.classes = structuredClone(p[0].foundations.classes); p[1].foundations.classes[0].reference.digest = "f".repeat(64); expect(graphProblems(p).join()).toContain("class-identity-conflict"); });
  it("rejects a package irrelevant to selected platforms", () => { const p = pair(); p[1].foundations.platforms = ["android"]; expect(graphProblems(p, ["web", "server"]).join()).toContain("unsupported-platform"); });
});

describe("recipe structural validation", () => {
  it.each([
    ["inline class", (r: Mutable) => r.components[0].class = { provides: [], requires: [], configuration: {} }],
    ["tampered reference", (r: Mutable) => r.components[0].class.digest = "0".repeat(64)],
    ["reserved instance", (r: Mutable) => r.components[0].id = "application"],
    ["duplicate instance", (r: Mutable) => r.components[1].id = "deck"],
    ["unknown setting", (r: Mutable) => r.components[1].configuration.ghost = 1],
    ["setting value", (r: Mutable) => r.components[1].configuration.minimumPlayers = "two"],
    ["unknown condition question", (r: Mutable) => r.components[4].includedWhen = "ghost"],
    ["nonboolean condition", (r: Mutable) => r.components[4].includedWhen = "1"],
    ["condition type", (r: Mutable) => r.components[4].includedWhen = "lessons == 'yes'"],
    ["question default", (r: Mutable) => delete r.questions[4].default],
    ["question cycle", (r: Mutable) => r.questions[3].askWhen = "tourStyle == 'short'"],
    ["secret literal", (r: Mutable) => r.questions[6].effects[0].sets["host.accountReference"] = "secret"],
    ["unknown effect target", (r: Mutable) => r.questions[2].effects[0].sets = { "ghost.count": 1 }],
    ["bad effect", (r: Mutable) => r.questions[2].effects = [{ includes: {} }]],
    ["bad map", (r: Mutable) => r.questions[4].effects[0].sets["tour.length"] = { map: { short: "brief" } }],
    ["secret answer", (r: Mutable) => r.questions[6].effects[0].sets["host.accountReference"] = "$answer"],
    ["unknown port", (r: Mutable) => r.connections[0].source.port = "ghost"],
    ["wrong type", (r: Mutable) => r.connections[0].source = { instance: "seats", port: "seating" }],
    ["unknown profile", (r: Mutable) => r.jobs[0].candidates[0].profile = "ghost"],
    ["bad candidate", (r: Mutable) => r.jobs[0].candidates.push({ component: "acme/other", profile: "free" })],
    ["bad answer", (r: Mutable) => r.tests.answerSets[0].answers.targets = ["tvos"]],
    ["bad question", (r: Mutable) => r.questions[2].type = "float"],
  ] as [string, (r: Mutable) => void][])("rejects %s", (_, patch) => expect(changedRecipe(e => patch(e.recipe)).ok).toBe(false));
  it("requires independent authority even without component lookup", () => { expect(validateRecipe(exampleRecipeEntry().recipe).ok).toBe(false); expect(errors(validateRecipe(exampleRecipeEntry().recipe, { authority: exampleRecipeEntry().foundations }))).toBe(""); });
  it("checks unconditional graph conflicts without combining conditional alternatives", () => {
    const entries = exampleComponentEntries(); entries[0].foundations.compatibility.runtimes.node = "<22.0.0"; entries[1].foundations.compatibility.runtimes.node = ">=22.0.0";
    expect(errors(validateRecipeEntry(exampleRecipeEntry(), exampleRecipeContext(entries)))).toContain("compatibility-range-conflict");
    const conditional = exampleRecipeEntry(); conditional.recipe.components[1].includedWhen = "lessons";
    expect(errors(validateRecipeEntry(conditional, exampleRecipeContext(entries)))).toBe("");
  });
  it("refuses incompatible simultaneous setting effects", () => { expect(changedRecipe(e => e.recipe.questions[3].effects = [{ sets: { "host.expectedPeople": 9 } }]).ok).toBe(false); });
  it("keeps recipe class declarations independent of preferred publication", () => { const e = exampleRecipeEntry(); const d = classDescriptor(e.recipe.components[0].class, e.foundations); expect(d?.verification[0].id).toBe("behaviour"); expect(errors(validateRecipeEntry(e))).toBe(""); });
  it("validates suitability and migration", () => { expect(validateSuitability(exampleComponentEntry().suitability).ok).toBe(true); expect(validateSuitability({ format: 1, jobs: [], profiles: [] }).ok).toBe(false); expect(summariseMigration(null).ok).toBe(false); });
});
