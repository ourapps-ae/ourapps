import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@my/store-shared";
import { termsBody } from "./pages/terms.js";
import { TAGLINE, storeFrame } from "./pages/public.js";
import { html } from "./html.js";

describe("public copy", () => {
  it("terms describe delivery and what is held", () => {
    const text = termsBody().html;
    expect(text).toContain("ourapps delivers apps privately");
    expect(text).toContain("sign-in reads your public profile only");
    expect(text).toContain(`Version ${TERMS_VERSION}`);
    for (const words of ["For the App Store", "default privacy policy", "Level N Ltd only hosts the text", "For Apple Pay", "never a private key", "For Google Play", "service account key"]) expect(text).toContain(words);
    for (const word of ["recipe", "component", "catalogue", "organisations you are an active member", "build report", "network address"]) expect(text.toLowerCase(), word).not.toContain(word);
  });

  it("the terms version is a date at or after the delivery-only terms", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
    expect(TERMS_VERSION >= "2026-11-25").toBe(true);
  });

  it("the store frame keeps the copyright and says share links are private", () => {
    const page = storeFrame(html`<p>x</p>`).html;
    expect(page).toContain("Copyright Level N Ltd 2026");
    expect(page).toContain("Share links are private");
    expect(page).not.toContain('href="/recipes"');
    expect(page).not.toContain('href="/components"');
  });

  it("the tagline is about delivery", () => {
    expect(TAGLINE).toBe("Deliver the apps you build to every device, through one private link.");
  });
});

describe("one story across the pages", () => {
  const sources = import.meta.glob(["./pages/*.ts", "../index.html", "../public/agents.md", "../public/llms.txt", "../public/robots.txt"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const read = (file: string) => {
    const text = sources[file];
    if (text === undefined) throw new Error(`${file} not found`);
    return text;
  };
  const files = ["./pages/public.ts", "./pages/guide.ts", "./pages/example.ts", "./pages/shell.ts", "./pages/dev.ts", "./pages/prompts.ts", "./pages/reference.ts", "./pages/terms.ts", "../index.html", "../public/agents.md", "../public/llms.txt", "../public/robots.txt"];

  it("the guide opens with how ourapps works and keeps the delivery steps", () => {
    const guide = read("./pages/guide.ts");
    const ids = [...guide.matchAll(/^ {6}id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    expect(ids.slice(0, 2)).toEqual(["overview", "tldr"]);
    for (const id of ["sign-in", "credentials", "add-app", "release", "share", "testflight", "app-store", "updates", "security"]) expect(ids).toContain(id);
    expect(ids.indexOf("app-store")).toBe(ids.indexOf("testflight") + 1);
    expect(ids.indexOf("apple-pay")).toBe(ids.indexOf("app-store") + 1);
    expect(ids.indexOf("google-play")).toBe(ids.indexOf("apple-pay") + 1);
  });

  it("no page or document tells another story", () => {
    for (const file of files) {
      const text = read(file);
      for (const old of ["Built with AI agents, shared with friends", "Private by design", "a private installer", "Builds apps for friends and family", "friends and family", "For your friends", "At eight people", "private app store"]) expect(text, `${file}: ${old}`).not.toContain(old);
      for (const word of [/recipe/i, /catalogue/i, /\baepm\b/i, /\bclod(hub)?\b/i, /free-tiers/i, /\/components\b/, /\bcomponents?\b/i, /read:org/, /sitemap/i]) expect(text, `${file}: ${word}`).not.toMatch(word);
    }
  });

  it("the landing page speaks to businesses, clubs, households and shops", () => {
    const landing = read("./pages/public.ts");
    for (const text of ["Our apps for our businesses, our club, our home, our shop", "For your people", "For you, the developer", "Who it is for", "A clinic's appointment board", "A club's league night", "A shop's order screen", "A household's chores planner", "A restaurant's table display", "Any coding agent", "Every device", "One private link", "No accounts for your people", "Updates on every platform", 'href="#how"']) expect(landing, text).toContain(text);
  });

  it("the console sidebar lists only delivery pages", () => {
    const shell = read("./pages/shell.ts");
    for (const href of ['href: "/dev"', 'href: "/dev/apps"', 'href: "/dev/guide"', 'href: "/reference"', 'href: "/dev/agents"', 'href: "/dev/settings"']) expect(shell, href).toContain(href);
  });
});
