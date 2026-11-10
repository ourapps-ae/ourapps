import { describe, expect, it } from "vitest";
import {
  GRAMMARS,
  RESERVED_NAMES,
  describeCondition,
  matchesGrammar,
  compareVersions,
  exampleComponentEntry,
  exampleRecipeEntry,
  isCatalogueName,
  isCatalogueSlug,
  isDigest,
  isPackagePath,
  isRepository,
  isSafeSvg,
  isVersion,
  newestVersion,
  splitName,
  summariseMigration,
  validateComponentEntry,
  validateRecipe,
  validateRecipeEntry,
  validateSuitability,
  type RecipeContext,
} from "./index.js";

type Mutable = Record<string, any>;

function recipe(patch: (r: Mutable) => void = () => {}): unknown {
  const r = structuredClone(exampleRecipeEntry().recipe) as unknown as Mutable;
  patch(r);
  return r;
}

function errorsOf(result: { ok: boolean; errors?: string[] }): string {
  return result.ok ? "" : (result.errors ?? []).join(" | ");
}

describe("names, versions and pointers", () => {
  it("accepts lowercase slugs with single hyphens and refuses the rest", () => {
    for (const ok of ["ab", "poker-night", "i18n", "web-host", "a1-b2-c3"]) expect(isCatalogueSlug(ok), ok).toBe(true);
    for (const bad of ["", "a", "Poker", "poker_night", "-poker", "poker-", "poker--night", "poker.night", "a".repeat(41), "search", 7, null]) expect(isCatalogueSlug(bad), String(bad)).toBe(false);
    expect(RESERVED_NAMES.has("search")).toBe(true);
  });

  it("splits scope and name", () => {
    expect(splitName("ourapps-ae/seating")).toEqual({ scope: "ourapps-ae", slug: "seating" });
    expect(isCatalogueName("seating")).toBe(false);
    expect(isCatalogueName("a/b/c")).toBe(false);
    expect(isCatalogueName("Acme/seating")).toBe(false);
    expect(isCatalogueName("acme/search")).toBe(false);
    expect(isCatalogueName("1password/vault")).toBe(true);
  });

  it("checks versions, digests, repositories and paths", () => {
    expect(isVersion("0.2.0")).toBe(true);
    expect(isVersion("10.20.30")).toBe(true);
    for (const bad of ["1.2", "1.2.3.4", "01.2.3", "1.2.x", "v1.2.3", "1.2.3-rc1", "1234567890.0.0"]) expect(isVersion(bad), bad).toBe(false);
    expect(isDigest(`sha256:${"0".repeat(64)}`)).toBe(true);
    expect(isDigest(`sha256:${"A".repeat(64)}`)).toBe(false);
    expect(isDigest("sha256:abc")).toBe(false);
    expect(isRepository("ourapps-ae/seating")).toBe(true);
    expect(isRepository("acme/poker.night_recipe")).toBe(true);
    for (const bad of ["acme", "acme/", "/x", "a/b/c", "acme/x.git", "ac me/x"]) expect(isRepository(bad), bad).toBe(false);
    expect(isPackagePath("page/description.md")).toBe(true);
    for (const bad of ["/etc/passwd", "../x", "a/../b", "a//b", "a\\b", "", "./a"]) expect(isPackagePath(bad), bad).toBe(false);
  });

  it("orders versions numerically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(newestVersion(["0.2.0", "0.10.0", "0.9.9"])).toBe("0.10.0");
    expect(newestVersion([])).toBeNull();
  });
});

describe("validateRecipe", () => {
  it("accepts the example recipe", () => {
    const result = validateRecipe(recipe());
    expect(errorsOf(result)).toBe("");
    expect(result.ok && result.recipe.components).toHaveLength(5);
    expect(result.ok && result.recipe.title).toBe("Poker Night");
  });

  it("applies defaults for optional parts", () => {
    const result = validateRecipe(
      recipe((r) => {
        delete r.jobs;
        delete r.scale;
        r.questions[1].effects = [];
        r.components[0].includedWhen = undefined;
        delete r.components[0].configuration;
      }),
    );
    expect(errorsOf(result)).toBe("");
    expect(result.ok && result.recipe.jobs).toEqual([]);
    expect(result.ok && result.recipe.scale).toBeNull();
    expect(result.ok && result.recipe.components[0].includedWhen).toBeNull();
    expect(result.ok && result.recipe.components[0].configuration).toEqual({});
  });

  it("refuses non-objects, other formats and unknown fields", () => {
    expect(validateRecipe(null).ok).toBe(false);
    expect(validateRecipe([]).ok).toBe(false);
    expect(errorsOf(validateRecipe(recipe((r) => (r.format = 2))))).toContain("format must be 1");
    expect(errorsOf(validateRecipe(recipe((r) => (r.extra = true))))).toContain("unknown field extra");
  });

  it("checks name, version and text fields", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.name = "poker-night"))))).toContain("name must be");
    expect(errorsOf(validateRecipe(recipe((r) => (r.name = "acme/Poker"))))).toContain("name must be");
    expect(errorsOf(validateRecipe(recipe((r) => (r.version = "1.0"))))).toContain("version must be three integers");
    expect(errorsOf(validateRecipe(recipe((r) => (r.title = "  "))))).toContain("title");
    expect(errorsOf(validateRecipe(recipe((r) => (r.summary = "x".repeat(301)))))).toContain("summary");
    expect(errorsOf(validateRecipe(recipe((r) => (r.category = "Games"))))).toContain("category");
    expect(errorsOf(validateRecipe(recipe((r) => (r.tags = ["a", "a"]))))).toContain("twice");
    expect(errorsOf(validateRecipe(recipe((r) => (r.tags = ["Bad Tag"]))))).toContain("invalid entry");
  });

  it("checks client and server targets", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.targets.client = ["web", "linux"]))))).toContain("targets.client");
    expect(errorsOf(validateRecipe(recipe((r) => (r.targets.client = ["web", "web"]))))).toContain("twice");
    expect(errorsOf(validateRecipe(recipe((r) => (r.targets = []))))).toContain("targets");
    expect(validateRecipe(recipe((r) => delete r.targets.server)).ok).toBe(true);
  });

  it("checks components", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.components = []))))).toContain("components must be");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[1].id = "deck"))))).toContain("used twice");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[0].name = "card-deck"))))).toContain("components[0].name");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[0].version = "latest"))))).toContain("components[0].version");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[0].pin = true))))).toContain("unknown field pin");
  });

  it("checks includedWhen against the recipe's questions", () => {
    const tour = (c: unknown) => recipe((r) => (r.components[4].includedWhen = c));
    expect(errorsOf(validateRecipe(tour({ question: "nope", equals: true })))).toContain("must name one of the recipe's questions");
    expect(errorsOf(validateRecipe(tour({ question: "lessons" })))).toContain("exactly one of equals, in, contains or truthy");
    expect(errorsOf(validateRecipe(tour({ question: "lessons", equals: true, contains: "x" })))).toContain("exactly one of equals, in, contains or truthy");
    expect(validateRecipe(tour({ question: "targets", contains: "ios" })).ok).toBe(true);
  });

  it("checks questions", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[0].type = "list"))))).toContain("type must be one of");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[1].id = "targets"))))).toContain("used twice");
    expect(errorsOf(validateRecipe(recipe((r) => delete r.questions[0].options)))).toContain("needs options");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[1].default = "huge"))))).toContain("must be one of the options");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[0].default = ["web", "tv"]))))).toContain("drawn from the options");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[2].default = 5000.5))))).toContain("integer");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[2].default = 5))))).toContain("range");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[3].default = "yes"))))).toContain("true or false");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[3].options = ["a"]))))).toContain("only set and choice");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[0].effects = [{ sets: [] }]))))).toContain("sets must map");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions = [])))).length).toBeGreaterThan(0);
  });

  it("never lets a secretRef question carry a value", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[6].default = "hunter2"))))).toContain("never has a default");
    expect(errorsOf(validateRecipe(recipe((r) => (r.tests.defaultAnswers = { serverKey: "-----BEGIN PRIVATE KEY-----" }))))).toContain("never a secret value");
    expect(errorsOf(validateRecipe(recipe((r) => (r.tests.defaultAnswers = { serverKey: "hosting-key" }))))).toBe("");
  });

  it("checks jobs, scale and connections against the components and questions", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.jobs[0].candidates[0].component = "acme/other"))))).toContain("is not in components");
    expect(errorsOf(validateRecipe(recipe((r) => (r.jobs[0].candidates = []))))).toContain("candidates must be");
    expect(errorsOf(validateRecipe(recipe((r) => (r.scale.question = "nope"))))).toContain("scale.question");
    expect(errorsOf(validateRecipe(recipe((r) => (r.scale.bands[0].load = { concurrentPeople: -1 }))))).toContain("non-negative");
    expect(errorsOf(validateRecipe(recipe((r) => (r.connections[0].target.instance = "ghost"))))).toContain("not a component id or application");
    expect(errorsOf(validateRecipe(recipe((r) => (r.connections[0].source = {}))))).toContain("needs an instance and a port");
  });

  it("checks tested answer sets", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.tests.answerSets[0].answers = { ghost: 1 }))))).toContain("not a question");
    expect(errorsOf(validateRecipe(recipe((r) => (r.tests.answerSets[0].answers = { targets: ["tv"] }))))).toContain("drawn from the options");
    expect(errorsOf(validateRecipe(recipe((r) => r.tests.answerSets.push({ id: "web-only", answers: {} }))))).toContain("used twice");
    expect(errorsOf(validateRecipe(recipe((r) => delete r.tests)))).toContain("tests must be");
  });

  it("keeps page and instruction paths inside the package", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.page.description = "../secrets"))))).toContain("page.description");
    expect(errorsOf(validateRecipe(recipe((r) => (r.page.diagram = "/etc/passwd"))))).toContain("page.diagram");
    expect(errorsOf(validateRecipe(recipe((r) => (r.instructions = "a/../../b"))))).toContain("instructions");
    expect(errorsOf(validateRecipe(recipe((r) => (r.page.screenshots = ["https://x.example/a.png"]))))).toContain("page.screenshots");
  });

  it("refuses oversized documents", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[0].configuration = { blob: "x".repeat(210_000) }))))).toContain("larger than");
  });
});

const questionById = (r: Mutable, id: string) => r.questions.find((q: Mutable) => q.id === id);
const withQuestion = (r: Mutable, q: Mutable) => r.questions.push({ ask: "A question?", effects: [], ...q });

describe("reserved instance application", () => {
  const app = (side: "source" | "target") => (r: Mutable) => (r.connections[0][side] = { instance: "application", port: "seating" });

  it("accepts application as a connection endpoint", () => {
    expect(errorsOf(validateRecipe(recipe(app("target"))))).toBe("");
    expect(errorsOf(validateRecipe(recipe(app("source"))))).toBe("");
  });

  it("refuses a component whose id or name is application", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[0].id = "application"))))).toContain("application is reserved");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[0].name = "acme/application"))))).toContain("no component is named application");
  });

  it("names any other endpoint by a component of the recipe", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.connections[0].source.instance = "ghost"))))).toContain("not a component id or application");
    expect(errorsOf(validateRecipe(recipe((r) => (r.connections[0].source.instance = "acme/card-deck"))))).toContain("not a component id or application");
  });

  it("accepts application as the owner of a setting", () => {
    expect(errorsOf(validateRecipe(recipe()))).toBe("");
    expect(JSON.stringify(recipe())).toContain("application.startingChips");
  });
});

describe("conditions", () => {
  const included = (c: unknown) => validateRecipe(recipe((r) => (r.components[4].includedWhen = c)));
  const asked = (c: unknown) => validateRecipe(recipe((r) => (questionById(r, "server").askWhen = c)));

  it("accepts equals, in, contains, truthy, all, any and not in includedWhen and askWhen", () => {
    const conditions = [
      { question: "lessons", equals: true },
      { question: "scale", in: ["small", "medium"] },
      { question: "targets", contains: "ios" },
      { question: "lessons", truthy: true },
      { all: [{ question: "lessons", truthy: true }, { question: "targets", contains: "web" }] },
      { any: [{ question: "targets", contains: "ios" }, { question: "targets", contains: "macos" }] },
      { not: { question: "scale", equals: "small" } },
      { not: { all: [{ any: [{ question: "lessons", truthy: true }] }] } },
    ];
    for (const c of conditions) {
      expect(errorsOf(included(c)), JSON.stringify(c)).toBe("");
      expect(errorsOf(asked(c)), JSON.stringify(c)).toBe("");
    }
  });

  it("keeps a condition as written", () => {
    const c = { any: [{ question: "targets", contains: "ios" }, { not: { question: "lessons", truthy: true } }] };
    const result = included(c);
    expect(result.ok && result.recipe.components[4].includedWhen).toEqual(c);
    const askedResult = asked(c);
    expect(askedResult.ok && askedResult.recipe.questions.find((q) => q.id === "server")?.askWhen).toEqual(c);
  });

  it("accepts nothing else", () => {
    expect(errorsOf(included({ question: "lessons", truthy: false }))).toContain("truthy must be true");
    expect(errorsOf(included({ question: "lessons", equals: true, in: [true] }))).toContain("exactly one of");
    expect(errorsOf(included({ question: "lessons", startsWith: "a" }))).toContain("unknown field startsWith");
    expect(errorsOf(included({ all: [], extra: 1 }))).toContain("exactly one of all, any or not");
    expect(errorsOf(included({ all: [] }))).toContain("1 to 20 conditions");
    expect(errorsOf(included({ any: "x" }))).toContain("1 to 20 conditions");
    expect(errorsOf(included({ not: [] }))).toContain("must be an object");
    expect(errorsOf(included({ all: [{ question: "ghost", equals: 1 }] }))).toContain("must name one of the recipe's questions");
    expect(errorsOf(included("lessons"))).toContain("must be an object");
    expect(errorsOf(included({ not: { question: "lessons", equals: { a: 1 } } }))).toContain("must be a string, number or boolean");
  });

  it("checks values against the question", () => {
    expect(errorsOf(included({ question: "lessons", equals: "yes" }))).toContain("must be true or false");
    expect(errorsOf(included({ question: "scale", equals: "huge" }))).toContain("one of the question's options");
    expect(errorsOf(included({ question: "scale", in: ["small", "huge"] }))).toContain("in[1] must be one of");
    expect(errorsOf(included({ question: "scale", in: [] }))).toContain("1 to 50 values");
    expect(errorsOf(included({ question: "targets", contains: "tv" }))).toContain("one of the question's options");
    expect(errorsOf(included({ question: "scale", contains: "small" }))).toContain("contains applies to set questions");
    expect(errorsOf(included({ question: "targets", equals: "web" }))).toContain("use contains");
    expect(errorsOf(included({ question: "chips", equals: 5.5 }))).toContain("must be an integer");
  });

  it("limits nesting", () => {
    let c: unknown = { question: "lessons", truthy: true };
    for (let i = 0; i < 10; i++) c = { not: c };
    expect(errorsOf(included(c))).toContain("nested more than");
  });

  it("applies to a job candidate too", () => {
    const ok = validateRecipe(recipe((r) => (r.jobs[0].candidates[1].includedWhen = { question: "lessons", truthy: true })));
    expect(errorsOf(ok)).toBe("");
    expect(ok.ok && ok.recipe.jobs[0].candidates[1].includedWhen).toEqual({ question: "lessons", truthy: true });
    expect(errorsOf(validateRecipe(recipe((r) => (r.jobs[0].candidates[1].includedWhen = { question: "ghost", truthy: true }))))).toContain("candidates[1].includedWhen.question");
  });

  it("describes a condition in words", () => {
    const say = (v: unknown) => String(v);
    expect(describeCondition({ any: [{ question: "targets", contains: "ios" }, { not: { question: "scale", in: ["small", "medium"] } }] }, say)).toBe("(targets includes ios) or (not (scale is one of small, medium))");
    expect(describeCondition({ question: "lessons", truthy: true }, say)).toBe("lessons is set");
  });
});

describe("question format", () => {
  it("accepts askWhen and requires the default the question takes when it is not asked", () => {
    expect(errorsOf(validateRecipe(recipe()))).toBe("");
    expect(errorsOf(validateRecipe(recipe((r) => delete questionById(r, "tourStyle").default)))).toContain("needs a default");
    expect(validateRecipe(recipe((r) => delete questionById(r, "serverKey").default)).ok).toBe(true);
  });

  it("refuses askWhen that names an unknown question or waits on itself", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (questionById(r, "server").askWhen = { question: "ghost", equals: 1 }))))).toContain("questions[5].askWhen.question");
    expect(errorsOf(validateRecipe(recipe((r) => (questionById(r, "server").askWhen = { question: "server", equals: "free" }))))).toContain("leads back to server");
    expect(
      errorsOf(
        validateRecipe(
          recipe((r) => {
            questionById(r, "server").askWhen = { question: "tourStyle", equals: "full" };
            questionById(r, "tourStyle").askWhen = { question: "server", equals: "paid" };
          }),
        ),
      ),
    ).toContain("leads back to");
  });

  it("accepts only sets in an effect", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[0].effects = [{ includes: { web: ["web-host"] } }]))))).toContain("questions[0].effects[0]: unknown field includes");
    expect(errorsOf(validateRecipe(recipe((r) => (r.questions[0].effects = [{ sets: { "host.targets": "$answer" }, other: 1 }]))))).toContain("questions[0].effects[0]: unknown field other");
  });

  it("accepts every question type", () => {
    const types: Mutable[] = [
      { id: "q1", type: "set", options: ["a", "b"], default: ["a"] },
      { id: "q2", type: "choice", options: ["a", "b"], default: "a" },
      { id: "q3", type: "boolean", default: false },
      { id: "q4", type: "integer", default: 3, min: 1, max: 9 },
      { id: "q5", type: "text", default: "x" },
      { id: "q6", type: "secretRef", default: null },
      { id: "q7", type: "account", default: "acct" },
    ];
    expect(errorsOf(validateRecipe(recipe((r) => types.forEach((t) => withQuestion(r, t)))))).toBe("");
  });

  it("checks min and max on integer questions", () => {
    expect(errorsOf(validateRecipe(recipe((r) => withQuestion(r, { id: "n", type: "integer", default: 3, min: 9, max: 1 }))))).toContain("min is above max");
    expect(errorsOf(validateRecipe(recipe((r) => withQuestion(r, { id: "n", type: "text", default: "a", min: 1 }))))).toContain("min applies to integer questions");
    expect(errorsOf(validateRecipe(recipe((r) => withQuestion(r, { id: "n", type: "integer", default: 50, max: 9 }))))).toContain("range");
    expect(errorsOf(validateRecipe(recipe((r) => withQuestion(r, { id: "n", type: "integer", default: 5, min: 1.5 }))))).toContain("min applies to integer questions and must be an integer");
  });

  it("gives a job an overrideQuestion that names a choice or text question", () => {
    const result = validateRecipe(recipe());
    expect(result.ok && result.recipe.jobs[0].overrideQuestion).toBe("server");
    expect(errorsOf(validateRecipe(recipe((r) => (r.jobs[0].overrideQuestion = "ghost"))))).toContain("jobs[0].overrideQuestion must name one of the recipe's questions");
    expect(errorsOf(validateRecipe(recipe((r) => (r.jobs[0].overrideQuestion = "lessons"))))).toContain("choice or text question");
    expect(validateRecipe(recipe((r) => ((r.jobs[0].overrideQuestion = "provider"), withQuestion(r, { id: "provider", type: "text", default: "" })))).ok).toBe(true);
    expect(errorsOf(validateRecipe(recipe((r) => r.jobs.push({ id: "server", candidates: r.jobs[0].candidates }))))).toContain("used twice");
  });

  it("requires the scale question to be a choice whose options are band ids", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.scale.question = "chips"))))).toContain("choice question");
    expect(errorsOf(validateRecipe(recipe((r) => questionById(r, "scale").options.push("large"))))).toContain("option large is not a band id");
  });
});

describe("sets value forms", () => {
  const withSets = (question: string, sets: Record<string, unknown>, extra: (r: Mutable) => void = () => {}) =>
    validateRecipe(
      recipe((r) => {
        extra(r);
        for (const q of r.questions) q.effects = [];
        questionById(r, question).effects = [{ sets }];
      }),
    );

  it("accepts a literal, $answer, map, fromScale, template and ref", () => {
    expect(errorsOf(withSets("chips", { "application.startingChips": "$answer", "host.expectedPeople": 5, "host.gold": true, "host.label": "gold" }))).toBe("");
    expect(errorsOf(withSets("server", { "host.plan": { map: { free: "eco", paid: "full" } } }))).toBe("");
    expect(errorsOf(withSets("scale", { "host.requests": { fromScale: "requestsPerDay" }, "host.stored": { fromScale: "storedMegabytes" } }))).toBe("");
    expect(errorsOf(withSets("server", { "host.prefix": { template: "night-{{answer}}" } }))).toBe("");
    expect(errorsOf(withSets("serverKey", { "host.accountReference": { ref: "serverKey" } }))).toBe("");
  });

  it("refuses a $ string that is not $answer and any other shape", () => {
    expect(errorsOf(withSets("chips", { "host.x": "$other" }))).toContain("is not a known form");
    expect(errorsOf(withSets("chips", { "host.x": null }))).toContain("must be a literal");
    expect(errorsOf(withSets("chips", { "host.x": ["a"] }))).toContain("must be a literal");
    expect(errorsOf(withSets("chips", { "host.x": { map: {}, ref: "serverKey" } }))).toContain("exactly one of map, fromScale, template or ref");
    expect(errorsOf(withSets("chips", { "host.x": { mapEach: {} } }))).toContain("exactly one of map, fromScale, template or ref");
    expect(errorsOf(withSets("chips", { "host.x": { $answer: { join: " " } } }))).toContain("exactly one of map, fromScale, template or ref");
  });

  it("checks map covers a choice question's options", () => {
    expect(errorsOf(withSets("chips", { "host.x": { map: { a: 1 } } }))).toContain("map applies to choice questions");
    expect(errorsOf(withSets("server", { "host.x": { map: { free: 1 } } }))).toContain("no value for option paid");
    expect(errorsOf(withSets("server", { "host.x": { map: { free: 1, paid: 2, extra: 3 } } }))).toContain("extra, which is not an option");
    expect(errorsOf(withSets("server", { "host.x": { map: { free: 1, paid: "$answer" } } }))).toContain("not starting with $");
    expect(errorsOf(withSets("server", { "host.x": { map: [] } }))).toContain("map must be an object");
  });

  it("checks fromScale, template and ref", () => {
    expect(errorsOf(withSets("scale", { "host.x": { fromScale: "people" } }))).toContain("fromScale must be one of");
    expect(errorsOf(withSets("scale", { "host.x": { fromScale: "concurrentPeople" } }, (r) => delete r.scale))).toContain("fromScale needs the recipe to have a scale");
    expect(errorsOf(withSets("server", { "host.x": { template: "night" } }))).toContain("{{answer}}");
    expect(errorsOf(withSets("server", { "host.x": { template: "{{other}}-{{answer}}" } }))).toContain("{{answer}}");
    expect(errorsOf(withSets("server", { "host.x": { template: "{{answer}}{" } }))).toContain("no other braces");
    expect(errorsOf(withSets("targets", { "host.x": { template: "a-{{answer}}" } }))).toContain("single-answer questions");
    expect(errorsOf(withSets("server", { "host.x": { ref: "server" } }))).toContain("secretRef question");
    expect(errorsOf(withSets("server", { "host.x": { ref: "ghost" } }))).toContain("secretRef question");
    expect(errorsOf(withSets("serverKey", { "host.x": "$answer" }))).toContain('{"ref": "serverKey"}');
  });

  it("names a component of the recipe or application", () => {
    expect(errorsOf(withSets("chips", { "release.targets": "$answer" }))).toContain("the target must be <componentId>.<settingId>");
    expect(errorsOf(withSets("chips", { startingChips: "$answer" }))).toContain("the target must be");
    expect(errorsOf(withSets("chips", { "host.": "$answer" }))).toContain("the target must be");
    expect(errorsOf(withSets("chips", { "application.startingChips": "$answer", "tour.other": 3 }))).toBe("");
  });

  it("allows an empty effect list and refuses an empty sets object", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (questionById(r, "chips").effects = []))))).toBe("");
    expect(errorsOf(withSets("chips", {}))).toContain("sets must map");
  });
});

describe("sets checked against component settings", () => {
  const context: RecipeContext = {
    settings: {
      "acme/server-host": [
        { id: "targets", type: "string", grammar: "label" },
        { id: "expectedPeople", type: "integer", grammar: "integer" },
        { id: "plan", type: "string", grammar: "slug" },
        { id: "prefix", type: "string", grammar: "slug" },
        { id: "accountReference", type: "string", grammar: "slug", secret: true },
        { id: "gold", type: "boolean", grammar: "boolean" },
        { id: "address", type: "string", grammar: "address" },
      ],
      application: [{ id: "startingChips", type: "integer", grammar: "integer" }],
    },
  };
  const check = (question: string, sets: Record<string, unknown>, extra: (r: Mutable) => void = () => {}) =>
    validateRecipe(
      recipe((r) => {
        extra(r);
        for (const q of r.questions) q.effects = [];
        questionById(r, question).effects = [{ sets }];
      }),
      context,
    );

  it("accepts the example when every setting fits", () => {
    const fitted = validateRecipe(
      recipe((r) => {
        r.components[0].configuration = {};
        questionById(r, "tourStyle").effects = [];
      }),
      context,
    );
    expect(errorsOf(fitted)).toBe("");
  });

  it("accepts what it cannot check", () => {
    expect(errorsOf(validateRecipe(recipe(), {}))).toBe("");
    expect(errorsOf(validateRecipe(recipe(), { settings: { "acme/other": [] } }))).toBe("");
    expect(errorsOf(check("chips", { "tour.other": "$answer" }))).toBe("");
  });

  it("refuses a setting the component does not collect", () => {
    expect(errorsOf(check("chips", { "host.nothing": 1 }))).toContain("nothing is not a setting of host");
    expect(errorsOf(check("chips", { "application.nothing": 1 }))).toContain("nothing is not a setting of application");
  });

  it("checks literals against the setting's type and grammar", () => {
    expect(errorsOf(check("chips", { "host.expectedPeople": "ten" }))).toContain("is not a 32-bit integer");
    expect(errorsOf(check("chips", { "host.expectedPeople": 3000000000 }))).toContain("is not a 32-bit integer");
    expect(errorsOf(check("chips", { "host.expectedPeople": 1.5 }))).toContain("is not a 32-bit integer");
    expect(errorsOf(check("chips", { "host.gold": "yes" }))).toContain("is not a boolean");
    expect(errorsOf(check("chips", { "host.plan": 4 }))).toContain("is not text");
    expect(errorsOf(check("chips", { "host.plan": "Not A Slug" }))).toContain("does not satisfy the slug grammar");
    expect(errorsOf(check("chips", { "host.address": "ftp://x.example" }))).toContain("address grammar");
    expect(errorsOf(check("chips", { "host.plan": "eco", "host.address": "https://x.example/a", "host.gold": false, "host.expectedPeople": 4 }))).toBe("");
  });

  it("checks $answer against the question's type", () => {
    expect(errorsOf(check("chips", { "host.plan": "$answer" }))).toContain("is an integer, but setting plan is string");
    expect(errorsOf(check("lessons", { "host.expectedPeople": "$answer" }))).toContain("is a boolean, but setting expectedPeople is integer");
    expect(errorsOf(check("lessons", { "host.gold": "$answer" }))).toBe("");
    expect(errorsOf(check("chips", { "application.startingChips": "$answer" }))).toBe("");
    expect(errorsOf(check("targets", { "host.expectedPeople": "$answer" }))).toContain("space-separated string");
    expect(errorsOf(check("targets", { "host.plan": "$answer" }))).toContain("joins targets options with spaces");
    expect(errorsOf(check("targets", { "host.targets": "$answer" }))).toBe("");
    expect(errorsOf(check("server", { "host.expectedPeople": "$answer" }))).toContain("option free is not a 32-bit integer");
    expect(errorsOf(check("server", { "host.plan": "$answer" }))).toBe("");
    expect(errorsOf(check("scale", { "host.plan": { fromScale: "concurrentPeople" } }))).toContain("fromScale gives a number");
    expect(errorsOf(check("scale", { "host.expectedPeople": { fromScale: "concurrentPeople" } }))).toBe("");
  });

  it("checks map values and template results against the setting", () => {
    expect(errorsOf(check("server", { "host.expectedPeople": { map: { free: 1, paid: "many" } } }))).toContain("map[paid] is not a 32-bit integer");
    expect(errorsOf(check("server", { "host.expectedPeople": { map: { free: 1, paid: 2 } } }))).toBe("");
    expect(errorsOf(check("server", { "host.prefix": { template: "night {{answer}}" } }))).toContain("does not satisfy the slug grammar");
    expect(errorsOf(check("server", { "host.prefix": { template: "night-{{answer}}" } }))).toBe("");
    expect(errorsOf(check("server", { "host.expectedPeople": { template: "n-{{answer}}" } }))).toContain("template gives text");
  });

  it("lets a secret setting take only a reference", () => {
    expect(errorsOf(check("chips", { "host.accountReference": "hunter2" }))).toContain("is secret");
    expect(errorsOf(check("server", { "host.accountReference": "$answer" }))).toContain("is secret");
    expect(errorsOf(check("server", { "host.accountReference": { template: "x-{{answer}}" } }))).toContain("is secret");
    expect(errorsOf(check("serverKey", { "host.accountReference": { ref: "serverKey" } }))).toBe("");
    expect(errorsOf(check("serverKey", { "host.expectedPeople": { ref: "serverKey" } }))).toContain("reference name, but setting expectedPeople is integer");
  });

  it("checks a component's configuration the same way", () => {
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[2].configuration = { plan: "eco" })), context))).toBe("");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[2].configuration = { plan: 3 })), context))).toContain("components[2].configuration.plan is not text");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[2].configuration = { ghost: 3 })), context))).toContain("ghost is not a setting of acme/server-host");
    expect(errorsOf(validateRecipe(recipe((r) => (r.components[2].configuration = { accountReference: "x" })), context))).toContain("is secret: it takes its reference from a question");
  });

  it("checks a job's profiles against the component's suitability", () => {
    const profiles: RecipeContext = { profiles: { "acme/server-host": [{ id: "free", settings: { plan: "eco" } }, { id: "paid" }] }, settings: context.settings };
    expect(errorsOf(validateRecipe(recipe(), profiles))).toBe("");
    expect(errorsOf(validateRecipe(recipe((r) => (r.jobs[0].candidates[0].profile = "gone")), profiles))).toContain("profile gone is not a profile of acme/server-host");
    const badSetting: RecipeContext = { profiles: { "acme/server-host": [{ id: "free", settings: { plan: 7, ghost: 1 } }, { id: "paid" }] }, settings: context.settings };
    const text = errorsOf(validateRecipe(recipe(), badSetting));
    expect(text).toContain("profile free setting plan is not text");
    expect(text).toContain("sets ghost, which is not a setting");
  });

  it("applies to a published entry the same way", () => {
    const entry = structuredClone(exampleRecipeEntry()) as unknown as Mutable;
    entry.recipe.questions[2].effects = [{ sets: { "host.nothing": 1 } }];
    expect(errorsOf(validateRecipeEntry(entry, context))).toContain("recipe: questions[2]");
    expect(errorsOf(validateRecipeEntry(entry))).toBe("");
  });

  it("knows aepm's string grammars", () => {
    expect(Object.keys(GRAMMARS).sort()).toEqual(["address", "environment", "identifier", "label", "qualified", "slug"]);
    expect(matchesGrammar("slug", "a-b")).toBe(true);
    expect(matchesGrammar("slug", "A")).toBe(false);
    expect(matchesGrammar("environment", "A_B")).toBe(true);
    expect(matchesGrammar("qualified", "a.b")).toBe(true);
    expect(matchesGrammar("address", "https://x.example:8080/a/b")).toBe(true);
    expect(matchesGrammar("address", "https://x.example:99999")).toBe(false);
    expect(matchesGrammar("none", "x")).toBe(false);
  });
});

describe("conflicting sets", () => {
  const clash = (patch: (r: Mutable) => void) => validateRecipe(recipe(patch));
  const setting = (value: unknown) => [{ sets: { "host.plan": value } }];

  it("refuses two questions that set one target to different values", () => {
    const text = errorsOf(clash((r) => ((questionById(r, "chips").effects = setting("a")), (questionById(r, "lessons").effects = setting("b")))));
    expect(text).toContain("questions chips and lessons both set host.plan to different values");
  });

  it("accepts the same literal from two questions", () => {
    expect(errorsOf(clash((r) => ((questionById(r, "chips").effects = setting("a")), (questionById(r, "lessons").effects = setting("a")))))).toBe("");
    expect(errorsOf(clash((r) => ((questionById(r, "chips").effects = setting({ fromScale: "concurrentPeople" })), (questionById(r, "lessons").effects = setting({ fromScale: "concurrentPeople" })))))).toBe("");
  });

  it("treats $answer of two questions as different values", () => {
    expect(errorsOf(clash((r) => ((questionById(r, "chips").effects = setting("$answer")), (questionById(r, "lessons").effects = setting("$answer")))))).toContain("both set host.plan");
  });

  it("refuses one question setting a target twice to different values", () => {
    expect(errorsOf(clash((r) => (questionById(r, "chips").effects = [{ sets: { "host.plan": "a" } }, { sets: { "host.plan": "b" } }])))).toContain("questions chips and chips both set host.plan");
    expect(errorsOf(clash((r) => (questionById(r, "chips").effects = [{ sets: { "host.plan": "a" } }, { sets: { "host.plan": "a" } }])))).toBe("");
  });

  it("accepts questions whose askWhen conditions are disjoint on equals or in values of one question", () => {
    const both = (a: unknown, b: unknown) =>
      clash((r) => {
        questionById(r, "chips").effects = setting("a");
        questionById(r, "chips").askWhen = a;
        questionById(r, "lessons").effects = setting("b");
        questionById(r, "lessons").askWhen = b;
      });
    expect(errorsOf(both({ question: "server", equals: "free" }, { question: "server", equals: "paid" }))).toBe("");
    expect(errorsOf(both({ question: "scale", in: ["small"] }, { question: "scale", in: ["medium"] }))).toBe("");
    expect(errorsOf(both({ all: [{ question: "lessons", truthy: true }, { question: "server", equals: "free" }] }, { question: "server", equals: "paid" }))).toBe("");
    expect(errorsOf(both({ any: [{ question: "server", equals: "free" }] }, { question: "server", in: ["paid"] }))).toBe("");
  });

  it("treats conditions as exclusive only when provably disjoint", () => {
    const both = (a: unknown, b: unknown) =>
      clash((r) => {
        questionById(r, "chips").effects = setting("a");
        questionById(r, "chips").askWhen = a;
        questionById(r, "lessons").effects = setting("b");
        questionById(r, "lessons").askWhen = b;
      });
    const bad = "both set host.plan";
    expect(errorsOf(both({ question: "server", equals: "free" }, { question: "server", equals: "free" }))).toContain(bad);
    expect(errorsOf(both({ question: "scale", in: ["small", "medium"] }, { question: "scale", in: ["medium"] }))).toContain(bad);
    expect(errorsOf(both({ question: "server", equals: "free" }, { question: "scale", equals: "small" }))).toContain(bad);
    expect(errorsOf(both({ question: "server", equals: "free" }, { not: { question: "server", equals: "paid" } }))).toContain(bad);
    expect(errorsOf(both({ question: "targets", contains: "web" }, { question: "targets", contains: "ios" }))).toContain(bad);
    expect(errorsOf(both({ any: [{ question: "server", equals: "free" }, { question: "scale", equals: "small" }] }, { question: "server", equals: "paid" }))).toContain(bad);
    expect(errorsOf(both(undefined, { question: "server", equals: "paid" }))).toContain(bad);
    expect(errorsOf(both({ question: "lessons", truthy: true }, { not: { question: "lessons", truthy: true } }))).toContain(bad);
  });
});

describe("validateRecipeEntry", () => {
  const entry = (patch: (e: Mutable) => void = () => {}): unknown => {
    const e = structuredClone(exampleRecipeEntry()) as unknown as Mutable;
    patch(e);
    return e;
  };

  it("accepts the example", () => {
    const result = validateRecipeEntry(entry());
    expect(errorsOf(result)).toBe("");
    expect(result.ok && result.entry.source.repository).toBe("acme/poker-night-recipe");
    expect(result.ok && result.entry.page.screenshots).toEqual([]);
  });

  it("prefixes recipe problems and checks pointers", () => {
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.recipe.name = "x"))))).toContain("recipe: name must be");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.digest = "abc"))))).toContain("digest must be sha256");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.source.repository = "nope"))))).toContain("source.repository");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.source.tag = "a..b"))))).toContain("source.tag");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.bundle.asset = "../x"))))).toContain("bundle.asset");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.bundle.digest = "sha256:zz"))))).toContain("bundle.digest");
    expect(errorsOf(validateRecipeEntry(entry((e) => delete e.bundle)))).toContain("bundle must be");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.archive = "AAAA"))))).toContain("unknown field archive");
  });

  it("checks the page material", () => {
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.page.description = ""))))).toContain("page.description");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.page.diagram = "<script>x</script>"))))).toContain("page.diagram");
    expect(errorsOf(validateRecipeEntry(entry((e) => (e.page.screenshots = ["http://x.example/a.png"]))))).toContain("page.screenshots");
    expect(validateRecipeEntry(entry((e) => (e.page.diagram = null))).ok).toBe(true);
    expect(validateRecipeEntry(entry((e) => (e.page.screenshots = ["https://x.example/a.png"]))).ok).toBe(true);
  });
});

describe("isSafeSvg", () => {
  it("accepts plain drawings", () => {
    expect(isSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')).toBe(true);
    expect(isSafeSvg('<?xml version="1.0"?>\n<!-- made by a tool -->\n<svg><use href="#a"/></svg>')).toBe(true);
    expect(isSafeSvg('<svg><rect fill="url(#grad)"/></svg>')).toBe(true);
  });

  it("refuses scripts, handlers, embedded objects and outside references", () => {
    for (const bad of [
      "<html></html>",
      "<svg><script>alert(1)</script></svg>",
      '<svg onload="x()"></svg>',
      '<svg><a href="javascript:x()"><rect/></a></svg>',
      '<svg><foreignObject><div/></foreignObject></svg>',
      '<svg><image href="https://x.example/a.png"/></svg>',
      '<svg><use xlink:href="https://x.example/a.svg#b"/></svg>',
      '<svg><rect fill="url(https://x.example/a)"/></svg>',
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>',
      '<svg><iframe src="x"/></svg>',
      7,
    ]) expect(isSafeSvg(bad), String(bad)).toBe(false);
    expect(isSafeSvg(`<svg>${"x".repeat(200_001)}</svg>`)).toBe(false);
  });
});

describe("validateSuitability", () => {
  const free = () => ({
    format: 1,
    jobs: ["server-host"],
    profiles: [
      {
        id: "free",
        load: { concurrentPeople: 10, requestsPerDay: 100000 },
        cost: "free",
        regions: ["any"],
        compliance: [],
        provider: { name: "Cloudflare Workers", tier: "free", limitsSource: "https://developers.cloudflare.com/workers/platform/limits/" },
        notes: "",
      },
    ],
    notes: "",
  });

  it("accepts a provider profile and a pure-library profile", () => {
    expect(errorsOf(validateSuitability(free()))).toBe("");
    const lib = { format: 1, jobs: ["card-deck"], profiles: [{ id: "any", load: {}, cost: "none", regions: ["any"], compliance: [] }] };
    const result = validateSuitability(lib);
    expect(errorsOf(result)).toBe("");
    expect(result.ok && result.suitability.profiles[0].provider).toBeNull();
  });

  it("lets a profile carry settings", () => {
    const withSettings = free() as Mutable;
    withSettings.profiles[0].settings = { plan: "eco", capacity: 10, durable: true };
    const result = validateSuitability(withSettings);
    expect(errorsOf(result)).toBe("");
    expect(result.ok && result.suitability.profiles[0].settings).toEqual({ plan: "eco", capacity: 10, durable: true });
    const plain = validateSuitability(free());
    expect(plain.ok && "settings" in plain.suitability.profiles[0]).toBe(false);
    for (const bad of [[], { plan: null }, { plan: ["a"] }, { plan: "$answer" }, { "9x": 1 }]) {
      const s = free() as Mutable;
      s.profiles[0].settings = bad;
      expect(errorsOf(validateSuitability(s)), JSON.stringify(bad)).toContain("settings must map");
    }
  });

  it("allows an unchecked limits source only as null", () => {
    const s = free();
    s.profiles[0].provider!.limitsSource = null as unknown as string;
    expect(validateSuitability(s).ok).toBe(true);
    s.profiles[0].provider!.limitsSource = "http://insecure.example";
    expect(errorsOf(validateSuitability(s))).toContain("limitsSource");
  });

  it("refuses bad formats, costs, loads and duplicates", () => {
    const patch = (fn: (s: Mutable) => void) => {
      const s = free() as Mutable;
      fn(s);
      return errorsOf(validateSuitability(s));
    };
    expect(patch((s) => (s.format = 2))).toContain("format");
    expect(patch((s) => (s.jobs = []))).toContain("at least one job");
    expect(patch((s) => (s.profiles = []))).toContain("1 to 10 profiles");
    expect(patch((s) => (s.profiles[0].cost = "cheap"))).toContain("cost must be");
    expect(patch((s) => (s.profiles[0].load = { concurrentPeople: "ten" }))).toContain("non-negative number");
    expect(patch((s) => (s.profiles[0].regions = []))).toContain("at least one region");
    expect(patch((s) => s.profiles.push({ ...s.profiles[0] }))).toContain("used twice");
    expect(patch((s) => (s.extra = 1))).toContain("unknown field extra");
  });
});

describe("summariseMigration", () => {
  const migration = {
    format: 1,
    stores: [{ id: "rooms", schema: { name: "ae/room-state", version: "1.0.0", file: "interfaces/room-state.schema.json" } }],
    export: [{ format: "ndjson", portable: true, operation: "exportAll", description: "everything" }],
    import: [{ format: "ndjson", portable: true, operation: "importAll" }],
    steps: [{ from: "0.9.0", to: "1.0.0", description: "x" }],
    verification: { counts: true },
    limits: { maxMegabytes: 1024, requiresStop: false, cannotPreserve: ["ordering"] },
    retention: { afterRemovalDays: 30 },
  };

  it("keeps stores, formats, stop requirement and retention", () => {
    const result = summariseMigration(migration);
    expect(errorsOf(result)).toBe("");
    expect(result.ok && result.migration).toEqual({ stores: [{ id: "rooms", schema: { name: "ae/room-state", version: "1.0.0" } }], formats: ["ndjson"], portable: true, requiresStop: false, retentionDays: 30 });
  });

  it("requires a portable format", () => {
    expect(errorsOf(summariseMigration({ ...migration, export: [{ format: "sql", portable: false }], import: [] }))).toContain("portable must be true");
    expect(summariseMigration({ format: 2 }).ok).toBe(false);
  });
});

describe("validateComponentEntry", () => {
  const entry = (patch: (e: Mutable) => void = () => {}): unknown => {
    const e = structuredClone(exampleComponentEntry()) as unknown as Mutable;
    patch(e);
    return e;
  };

  it("accepts the example and fills optional parts", () => {
    const result = validateComponentEntry(entry());
    expect(errorsOf(result)).toBe("");
    const minimal = validateComponentEntry(
      entry((e) => {
        delete e.category;
        delete e.tags;
        delete e.targets;
        delete e.guardians;
        delete e.migration;
      }),
    );
    expect(errorsOf(minimal)).toBe("");
    expect(minimal.ok && minimal.entry.category).toBeNull();
    expect(minimal.ok && minimal.entry.migration).toBeNull();
    expect(minimal.ok && minimal.entry.targets).toEqual({ client: [], server: [] });
  });

  it("carries the fields the catalogue lists", () => {
    const result = validateComponentEntry(entry());
    if (!result.ok) throw new Error(result.errors.join());
    const e = result.entry;
    expect(e.name).toBe("acme/card-deck");
    expect(e.version).toBe("0.1.0");
    expect(e.digest).toMatch(/^sha256:/);
    expect(e.provides[0]).toEqual({ id: "card-deck", type: "ae/card-deck", version: "1.0.0" });
    expect(e.requires[0].id).toBe("random-source");
    expect(e.suitability.profiles[0].cost).toBe("none");
    expect(e.source).toEqual({ repository: "acme/card-deck", tag: "v0.1.0" });
    expect(e.bundle.asset).toBe("card-deck-0.1.0.tar");
    expect(e.guardians).toEqual(["Example Guardian Ltd"]);
  });

  it("accepts a data-keeping component with its migration summary", () => {
    const result = validateComponentEntry(entry((e) => (e.migration = { stores: [{ id: "rooms", schema: { name: "ae/room-state", version: "1.0.0" } }], formats: ["ndjson"], portable: true, requiresStop: false, retentionDays: 30 })));
    expect(errorsOf(result)).toBe("");
  });

  it("refuses bad identity, pointers and unknown fields", () => {
    expect(errorsOf(validateComponentEntry(null))).toContain("JSON object");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.name = "card-deck"))))).toContain("name must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.version = "1"))))).toContain("version must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.digest = "md5:abc"))))).toContain("digest must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.description = ""))))).toContain("description");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.description = "x".repeat(501)))))).toContain("description");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.source.repository = "x"))))).toContain("source.repository");
    expect(errorsOf(validateComponentEntry(entry((e) => delete e.bundle)))).toContain("bundle must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.archive = "AAAA"))))).toContain("unknown field archive");
  });

  it("checks interfaces", () => {
    expect(errorsOf(validateComponentEntry(entry((e) => (e.provides = "x"))))).toContain("provides must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.provides[0].version = "1"))))).toContain("provides[0].version");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.provides[0].path = "interfaces/a.json"))))).toContain("unknown field path");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.requires = [{ ...e.provides[0] }]))))).toContain("both provided and required");
    expect(errorsOf(validateComponentEntry(entry((e) => e.provides.push({ ...e.provides[0] }))))).toContain("used twice");
  });

  it("reads the components this one builds on, empty by default", () => {
    const none = validateComponentEntry(entry());
    expect(none.ok && none.entry.dependencies).toEqual([]);
    const some = validateComponentEntry(entry((e) => (e.dependencies = [{ name: "acme/random-pool", version: "0.2.0" }])));
    expect(some.ok && some.entry.dependencies).toEqual([{ name: "acme/random-pool", version: "0.2.0" }]);
  });

  it("accepts optional on requires entries and keeps it only when true", () => {
    const result = validateComponentEntry(
      entry((e) => {
        e.requires = [{ id: "random-source", type: "ae/random-source", version: "1.0.0", optional: true }, { id: "audit", type: "ae/audit", version: "1.0.0", optional: false }, { id: "clock", type: "ae/clock", version: "1.0.0" }];
      }),
    );
    expect(errorsOf(result)).toBe("");
    expect(result.ok && result.entry.requires).toEqual([
      { id: "random-source", type: "ae/random-source", version: "1.0.0", optional: true },
      { id: "audit", type: "ae/audit", version: "1.0.0" },
      { id: "clock", type: "ae/clock", version: "1.0.0" },
    ]);
  });

  it("refuses a non-boolean optional and optional on provides", () => {
    expect(errorsOf(validateComponentEntry(entry((e) => (e.requires[0].optional = "yes"))))).toContain("requires[0].optional must be true or false");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.provides[0].optional = true))))).toContain("provides[0]: unknown field optional");
  });

  it("checks dependencies", () => {
    expect(errorsOf(validateComponentEntry(entry((e) => (e.dependencies = "x"))))).toContain("dependencies must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.dependencies = [{ name: "random", version: "0.2.0" }]))))).toContain("dependencies[0].name must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.dependencies = [{ name: "acme/random-pool", version: "2" }]))))).toContain("dependencies[0].version");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.dependencies = [{ name: "acme/card-deck", version: "0.1.0" }]))))).toContain("cannot be the component itself");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.dependencies = [{ name: "acme/aa", version: "0.1.0" }, { name: "acme/aa", version: "0.2.0" }]))))).toContain("used twice");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.dependencies = [{ name: "acme/aa", version: "0.1.0", path: "x" }]))))).toContain("unknown field path");
  });

  it("checks suitability, migration and guardians", () => {
    expect(errorsOf(validateComponentEntry(entry((e) => delete e.suitability)))).toContain("suitability must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.suitability.profiles[0].cost = "x"))))).toContain("cost must be");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.migration = { stores: [], formats: [], portable: false, requiresStop: false, retentionDays: null }))))).toContain("migration");
    expect(errorsOf(validateComponentEntry(entry((e) => (e.guardians = [""]))))).toContain("guardians");
  });
});
