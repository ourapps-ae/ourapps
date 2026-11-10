// Every diagram the OurPoker fixture can produce, by file name.
import { componentConnectionsSvg, type ComponentDiagramInput } from "../diagram-component.js";
import { recipeComponentsSvg } from "../diagram-recipe.js";
import { NEIGHBOURS_SHOWN } from "../diagram-component.js";
import { OURPOKER_CATALOGUE, OURPOKER_RECIPE, type FixtureComponent } from "./ourpoker.js";

export function ourpokerRecipeInput() {
  const byName = new Map(OURPOKER_CATALOGUE.map((c) => [c.name, c]));
  return { ...OURPOKER_RECIPE, catalogue: OURPOKER_RECIPE.components.map((c) => byName.get(c.name) ?? null) };
}

// What the catalogue queries return for one component, answered from the fixture.
export function neighbourhoodInput(slug: string, catalogue: FixtureComponent[] = OURPOKER_CATALOGUE): ComponentDiagramInput {
  const self = catalogue.find((c) => c.name.endsWith(`/${slug}`));
  if (!self) throw new Error(`no ${slug} in the fixture`);
  const find = (direction: "provides" | "requires", type: string) => {
    const all = catalogue.filter((c) => c.name !== self.name && c[direction].some((p) => p.type === type)).sort((a, b) => a.name.localeCompare(b.name));
    return { components: all.slice(0, NEIGHBOURS_SHOWN + 1).map((c) => ({ name: c.name, version: c.version, category: c.category })), total: all.length };
  };
  return {
    ...self,
    providers: Object.fromEntries(self.requires.map((p) => [p.type, find("provides", p.type)])),
    consumers: Object.fromEntries(self.provides.map((p) => [p.type, find("requires", p.type)])),
  };
}

export function renderAll(): Record<string, string> {
  const out: Record<string, string> = { "recipe-ourpoker.svg": recipeComponentsSvg(ourpokerRecipeInput()) };
  for (const slug of ["card-deck", "turn-engine", "theme", "video-calls"]) out[`component-${slug}.svg`] = componentConnectionsSvg(neighbourhoodInput(slug));
  return out;
}
