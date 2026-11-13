// An invented recipe and components for documentation and tests. Never a real application.
import { GRAMMAR_PATTERNS, componentFacts, interfaceKey, type ComponentEntry, type Port, type RecipeContext, type RecipeEntry, type SettingDeclaration, type Suitability } from "./catalogue.js";
import { DIALECT_2020_12 } from "./json-schema.js";

export const EXAMPLE_DIGEST = `sha256:${"a".repeat(64)}`;
export const EXAMPLE_BUNDLE_DIGEST = `sha256:${"b".repeat(64)}`;
// The digest of every example interface document: components that provide one interface share its document.
export const EXAMPLE_INTERFACE_DIGEST = `sha256:${"c".repeat(64)}`;

// A class configuration: the settings a recipe writes on a slot, each with its type and grammar.
export function classConfiguration(properties: Record<string, Record<string, unknown>> = {}, required: string[] = []): Record<string, unknown> {
  return { $schema: DIALECT_2020_12, type: "object", properties, required, additionalProperties: true };
}

const v1 = (type: string) => ({ type, version: "1.0.0" });

export function exampleRecipeEntry(): RecipeEntry {
  return {
    format: 1,
    recipe: {
      format: 1,
      name: "acme/poker-night",
      version: "0.1.0",
      title: "Poker Night",
      summary: "A card game for a club's league night, with house rules.",
      category: "games",
      tags: ["cards", "multiplayer"],
      targets: { client: ["web", "ios", "android", "macos"], server: ["hosting-provider"] },
      components: [
        { id: "deck", class: { provides: [v1("ae/card-deck")], requires: [], configuration: classConfiguration() }, preferred: { name: "acme/card-deck", version: "0.1.0" }, configuration: {}, includedWhen: null },
        { id: "seats", class: { provides: [v1("ae/seating")], requires: [v1("ae/card-deck")], configuration: classConfiguration({ minimumPlayers: { type: "integer" } }, ["minimumPlayers"]) }, preferred: { name: "acme/seating", version: "0.1.0" }, configuration: { minimumPlayers: 2 }, includedWhen: null },
        {
          id: "host",
          class: {
            provides: [v1("ae/server-host")],
            requires: [],
            configuration: classConfiguration({ targets: { type: "string", pattern: GRAMMAR_PATTERNS.label }, expectedPeople: { type: "integer" }, accountReference: { type: "string", pattern: GRAMMAR_PATTERNS.slug } }, ["targets", "expectedPeople"]),
          },
          preferred: { name: "acme/server-host", version: "0.1.0" },
          configuration: {},
          includedWhen: null,
        },
        { id: "apple", class: { provides: [v1("ae/apple-shell")], requires: [], configuration: classConfiguration() }, preferred: { name: "acme/apple-host", version: "0.1.0" }, configuration: {}, includedWhen: "'ios' in targets || 'macos' in targets" },
        { id: "tour", class: { provides: [v1("ae/guided-tour")], requires: [], configuration: classConfiguration({ length: { type: "string", pattern: GRAMMAR_PATTERNS.slug } }, ["length"]) }, preferred: { name: "acme/guided-tour", version: "0.1.0" }, configuration: {}, includedWhen: "lessons" },
      ],
      jobs: [{ id: "server", slot: "host", overrideQuestion: "server", candidates: [{ component: "acme/server-host", profile: "free" }, { component: "acme/server-host", profile: "paid" }] }],
      scale: { question: "scale", bands: [{ id: "small", label: "fewer than 10 people, occasional use", load: { concurrentPeople: 10, requestsPerDay: 2000 } }, { id: "medium", label: "up to 100 people, daily use", load: { concurrentPeople: 100, requestsPerDay: 50000 } }] },
      questions: [
        { id: "targets", ask: "Which devices should the game run on?", type: "set", options: ["web", "ios", "android", "macos"], default: ["web", "ios", "android"], effects: [{ sets: { "host.targets": "$answer" } }] },
        { id: "scale", ask: "How many people, and how often?", type: "choice", options: ["small", "medium"], default: "small", effects: [{ sets: { "host.expectedPeople": { fromScale: "concurrentPeople" } } }] },
        { id: "chips", ask: "Starting chips?", type: "integer", default: 5000, min: 100, max: 1000000, effects: [{ sets: { "application.startingChips": "$answer" } }] },
        { id: "lessons", ask: "Lessons for new players?", type: "boolean", default: true, effects: [] },
        { id: "tourStyle", ask: "Short or full lessons?", type: "choice", options: ["short", "full"], default: "short", askWhen: "lessons", effects: [{ sets: { "tour.length": { map: { short: "brief", full: "complete" } } } }] },
        { id: "server", ask: "Which hosting plan?", type: "choice", options: ["free", "paid"], default: "free", effects: [] },
        { id: "serverKey", ask: "Reference to the hosting access key", type: "secretRef", default: null, askWhen: "server == 'paid'", effects: [{ sets: { "host.accountReference": { ref: "serverKey" } } }] },
      ],
      connections: [
        { source: { instance: "deck", port: "card-deck" }, target: { instance: "seats", port: "card-deck" } },
        { source: { instance: "seats", port: "seating" }, target: { instance: "application", port: "seating" } },
        { source: { instance: "host", port: "server-host" }, target: { instance: "application", port: "server-host" } },
        { source: { instance: "apple", port: "apple-shell" }, target: { instance: "application", port: "apple-shell" } },
        { source: { instance: "tour", port: "guided-tour" }, target: { instance: "application", port: "guided-tour" } },
      ],
      tests: { defaultAnswers: {}, answerSets: [{ id: "web-only", answers: { targets: ["web"] } }] },
      page: { description: "page/description.md", diagram: "page/diagram.svg", screenshots: [] },
      instructions: "INSTRUCTIONS.md",
    },
    digest: EXAMPLE_DIGEST,
    source: { repository: "acme/poker-night-recipe", tag: "v0.1.0" },
    bundle: { asset: "poker-night-0.1.0.tar", digest: EXAMPLE_BUNDLE_DIGEST },
    page: {
      description: "Poker Night deals a hand for every member at the table.\n\nChoose your devices, your starting chips and whether new players get lessons.",
      diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect x="2" y="2" width="50" height="36" rx="6" fill="#ddd"/><text x="10" y="25">deck</text><rect x="68" y="2" width="50" height="36" rx="6" fill="#ddd"/><text x="76" y="25">seats</text></svg>',
      screenshots: [],
    },
  };
}

const LIBRARY: Suitability = { format: 1, jobs: ["library"], profiles: [{ id: "any", load: {}, cost: "none", regions: ["any"], compliance: [], provider: null, notes: "" }], notes: "" };

const setting = (id: string, type: SettingDeclaration["type"], grammar: string, more: Partial<SettingDeclaration> = {}): SettingDeclaration => ({ id, type, grammar, required: false, secret: false, hasDefault: true, ...more });

function component(slug: string, description: string, provides: Port[], requires: Port[], settings: SettingDeclaration[], suitability: Suitability = LIBRARY, category: string | null = null): ComponentEntry {
  return {
    format: 1,
    name: `acme/${slug}`,
    version: "0.1.0",
    digest: EXAMPLE_DIGEST,
    description,
    category,
    tags: [],
    targets: { client: ["web"], server: [] },
    guardians: [],
    provides,
    requires,
    settings,
    interfaceDigests: Object.fromEntries(provides.map((p) => [interfaceKey(p), EXAMPLE_INTERFACE_DIGEST])),
    interfaceModules: {},
    dependencies: [],
    suitability,
    migration: null,
    source: { repository: `acme/${slug}`, tag: "v0.1.0" },
    bundle: { asset: `${slug}-0.1.0.tar`, digest: EXAMPLE_BUNDLE_DIGEST },
  };
}

export function exampleComponentEntry(): ComponentEntry {
  return {
    ...component("card-deck", "A shuffled deck of 52 cards that deals and burns cards.", [{ id: "card-deck", type: "ae/card-deck", version: "1.0.0" }], [{ id: "random-source", type: "ae/random-source", version: "1.0.0", optional: true }], [], { ...LIBRARY, jobs: ["card-deck"] }, "cards"),
    tags: ["cards", "deck"],
    guardians: ["Example Guardian Ltd"],
    interfaceModules: { "ae/card-deck@1.0.0": { web: { path: "web/index.ts", installed: true }, apple: { path: "apple/Sources", installed: true } } },
  };
}

// The components the example recipe prefers, one per slot, each fitting its slot's class.
export function exampleComponentEntries(): ComponentEntry[] {
  const hosting: Suitability = {
    format: 1,
    jobs: ["server-host"],
    profiles: [
      { id: "free", load: { concurrentPeople: 10, requestsPerDay: 100000 }, cost: "free", regions: ["any"], compliance: [], provider: { name: "Example Hosting", tier: "free", limitsSource: null }, notes: "" },
      { id: "paid", load: {}, cost: "paid", regions: ["any"], compliance: [], provider: { name: "Example Hosting", tier: "paid", limitsSource: null }, notes: "" },
    ],
    notes: "",
  };
  return [
    exampleComponentEntry(),
    component("seating", "Seats for the people at a table.", [{ id: "seating", type: "ae/seating", version: "1.0.0" }], [{ id: "card-deck", type: "ae/card-deck", version: "1.0.0" }], [setting("minimumPlayers", "integer", "integer")], LIBRARY, "tables"),
    component(
      "server-host",
      "Runs the game's server on a hosting provider.",
      [{ id: "server-host", type: "ae/server-host", version: "1.0.0" }],
      [],
      [setting("targets", "string", "label", { required: true, hasDefault: false }), setting("expectedPeople", "integer", "integer"), setting("accountReference", "string", "slug", { secret: true, hasDefault: false })],
      hosting,
      "delivery",
    ),
    component("apple-host", "The iPhone, iPad and Mac shell.", [{ id: "apple-shell", type: "ae/apple-shell", version: "1.0.0" }], [], [], LIBRARY, "delivery"),
    component("guided-tour", "Lessons that walk a new player through a hand.", [{ id: "guided-tour", type: "ae/guided-tour", version: "1.0.0" }], [], [setting("length", "string", "slug")], LIBRARY, "presentation"),
  ];
}

// Another component of the class of the example recipe's seats slot.
export function exampleAlternativeEntry(): ComponentEntry {
  return component("club-seating", "Seats assigned by club membership number.", [{ id: "seating", type: "ae/seating", version: "1.0.0" }], [{ id: "card-deck", type: "ae/card-deck", version: "1.0.0" }], [setting("minimumPlayers", "integer", "integer"), setting("membership", "string", "slug")], LIBRARY, "tables");
}

// The example components as a recipe check's component source.
export function exampleRecipeContext(entries: ComponentEntry[] = exampleComponentEntries()): RecipeContext {
  const find = (name: string, version: string) => {
    const entry = entries.find((e) => e.name === name && e.version === version);
    return entry ? componentFacts(entry) : null;
  };
  return { components: { source: "the example catalogue", find } };
}
