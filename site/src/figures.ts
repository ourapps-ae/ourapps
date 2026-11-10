// Drawn SVG diagrams on the pages: each opens full size in a new tab.
import { html, type Raw } from "./html.js";

// A drawn SVG diagram at its own proportions that opens full size in a new tab.
export function svgFigure(src: string, alt: string): Raw {
  return html`<a class="figure-link" href="${src}" target="_blank" rel="noopener" title="Open full size"><img class="svg-figure" src="${src}" alt="${alt}" loading="lazy" /><span class="figure-hint">Open full size</span></a>`;
}

export const COOKING_FILE = "/diagrams/cooking-a-recipe.svg";

export const COOKING_ALT =
  "How a recipe is cooked, in five parts. You and your agent: find a recipe in the library, read its questions, answer them; the agent infers what it can and asks you the rest. " +
  "Evaluation: conditions over the answers decide which components are included, the scale band chooses a provider for each job, settings are applied and connections checked, giving a design. " +
  "aepm: resolve exact versions, download each archive from its publisher's GitHub release, check its sha256 digest and signatures, review, install by copying the listed files without running their code, and verify with the components' tests, giving the application; one-command assembly with aepm create is coming soon. " +
  "Delivery: the application runs on your own hosting, Apple and Android accounts, and an ourapps share link brings it to your staff, members and customers. " +
  "Updates: a new component version becomes a proposal, you approve it, and aepm applies it with recovery.";

// The process overview, from site/src/diagrams/cooking.ts.
export function cookingFigure(): Raw {
  return svgFigure(COOKING_FILE, COOKING_ALT);
}
