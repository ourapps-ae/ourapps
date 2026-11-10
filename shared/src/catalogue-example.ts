// An invented recipe and components for documentation and tests. Never a real application.
import type { ComponentEntry, RecipeEntry } from "./catalogue.js";

export const EXAMPLE_DIGEST = `sha256:${"a".repeat(64)}`;
export const EXAMPLE_BUNDLE_DIGEST = `sha256:${"b".repeat(64)}`;

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
        { id: "deck", name: "acme/card-deck", version: "0.1.0", configuration: {}, includedWhen: null },
        { id: "seats", name: "acme/seating", version: "0.1.0", configuration: { minimumPlayers: 2 }, includedWhen: null },
        { id: "host", name: "acme/server-host", version: "0.1.0", configuration: {}, includedWhen: null },
        { id: "apple", name: "acme/apple-host", version: "0.1.0", configuration: {}, includedWhen: { any: [{ question: "targets", contains: "ios" }, { question: "targets", contains: "macos" }] } },
        { id: "tour", name: "acme/guided-tour", version: "0.1.0", configuration: {}, includedWhen: { question: "lessons", truthy: true } },
      ],
      jobs: [{ id: "server", overrideQuestion: "server", candidates: [{ component: "acme/server-host", profile: "free" }, { component: "acme/server-host", profile: "paid" }] }],
      scale: { question: "scale", bands: [{ id: "small", label: "fewer than 10 people, occasional use", load: { concurrentPeople: 10, requestsPerDay: 2000 } }, { id: "medium", label: "up to 100 people, daily use", load: { concurrentPeople: 100, requestsPerDay: 50000 } }] },
      questions: [
        { id: "targets", ask: "Which devices should the game run on?", type: "set", options: ["web", "ios", "android", "macos"], default: ["web", "ios", "android"], effects: [{ sets: { "host.targets": "$answer" } }] },
        { id: "scale", ask: "How many people, and how often?", type: "choice", options: ["small", "medium"], default: "small", effects: [{ sets: { "host.expectedPeople": { fromScale: "concurrentPeople" } } }] },
        { id: "chips", ask: "Starting chips?", type: "integer", default: 5000, min: 100, max: 1000000, effects: [{ sets: { "application.startingChips": "$answer" } }] },
        { id: "lessons", ask: "Lessons for new players?", type: "boolean", default: true, effects: [] },
        { id: "tourStyle", ask: "Short or full lessons?", type: "choice", options: ["short", "full"], default: "short", askWhen: { question: "lessons", truthy: true }, effects: [{ sets: { "tour.length": { map: { short: "brief", full: "complete" } } } }] },
        { id: "server", ask: "Which hosting plan?", type: "choice", options: ["free", "paid"], default: "free", effects: [] },
        { id: "serverKey", ask: "Reference to the hosting access key", type: "secretRef", default: null, askWhen: { question: "server", equals: "paid" }, effects: [{ sets: { "host.accountReference": { ref: "serverKey" } } }] },
      ],
      connections: [
        { source: { instance: "deck", port: "card-deck" }, target: { instance: "seats", port: "card-deck" } },
        { source: { instance: "seats", port: "seating" }, target: { instance: "application", port: "seating" } },
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

export function exampleComponentEntry(): ComponentEntry {
  return {
    format: 1,
    name: "acme/card-deck",
    version: "0.1.0",
    digest: EXAMPLE_DIGEST,
    description: "A shuffled deck of 52 cards that deals and burns cards.",
    category: "cards",
    tags: ["cards", "deck"],
    targets: { client: ["web"], server: [] },
    guardians: ["Example Guardian Ltd"],
    provides: [{ id: "card-deck", type: "ae/card-deck", version: "1.0.0" }],
    requires: [{ id: "random-source", type: "ae/random-source", version: "1.0.0" }],
    dependencies: [],
    suitability: {
      format: 1,
      jobs: ["card-deck"],
      profiles: [{ id: "any", load: {}, cost: "none", regions: ["any"], compliance: [], provider: null, notes: "" }],
      notes: "",
    },
    migration: null,
    source: { repository: "acme/card-deck", tag: "v0.1.0" },
    bundle: { asset: "card-deck-0.1.0.tar", digest: EXAMPLE_BUNDLE_DIGEST },
  };
}
