import { describe, expect, it } from "vitest";
import { matchRoute } from "./router.js";

describe("matchRoute", () => {
  it("maps every page", () => {
    expect(matchRoute("/")).toEqual({ page: "landing" });
    expect(matchRoute("/george")).toEqual({ page: "dev-page", slug: "george" });
    expect(matchRoute("/l/abc123")).toEqual({ page: "install", linkId: "abc123" });
    expect(matchRoute("/l/abc123/wait/e1")).toEqual({ page: "install", linkId: "abc123" });
    expect(matchRoute("/dev")).toEqual({ page: "dashboard" });
    expect(matchRoute("/dev/apps/new")).toEqual({ page: "app-new" });
    expect(matchRoute("/dev/apps/a1")).toEqual({ page: "app-edit", appId: "a1" });
    expect(matchRoute("/dev/apps/a1/links")).toEqual({ page: "app-links", appId: "a1" });
    expect(matchRoute("/dev/apps")).toEqual({ page: "apps" });
    expect(matchRoute("/dev/apps/a1/preview")).toEqual({ page: "app-preview", appId: "a1" });
    expect(matchRoute("/dev/settings")).toEqual({ page: "settings" });
    expect(matchRoute("/dev/guide")).toEqual({ page: "guide" });
    expect(matchRoute("/dev/agents")).toEqual({ page: "agents" });
    expect(matchRoute("/example")).toEqual({ page: "example" });
    expect(matchRoute("/terms")).toEqual({ page: "terms" });
    expect(matchRoute("/reference")).toEqual({ page: "reference" });
    expect(matchRoute("/small")).toEqual({ page: "small" });
    expect(matchRoute("/example/poker-night")).toEqual({ page: "example-app" });
  });

  it("maps the recipe library and component catalogue", () => {
    expect(matchRoute("/recipes")).toEqual({ page: "recipes" });
    expect(matchRoute("/recipes/poker-night")).toEqual({ page: "recipe", slug: "poker-night" });
    expect(matchRoute("/components")).toEqual({ page: "components" });
    expect(matchRoute("/components/card-deck")).toEqual({ page: "component", slug: "card-deck" });
  });

  it("does not take /recipes or /components for developer pages", () => {
    expect(matchRoute("/recipes").page).not.toBe("dev-page");
    expect(matchRoute("/components").page).not.toBe("dev-page");
    expect(matchRoute("/recipes/Bad")).toEqual({ page: "not-found" });
    expect(matchRoute("/recipes/search")).toEqual({ page: "not-found" });
    expect(matchRoute("/recipes/a/b")).toEqual({ page: "not-found" });
    expect(matchRoute("/components/x")).toEqual({ page: "not-found" });
    expect(matchRoute("/components/card-deck/0.1.0")).toEqual({ page: "not-found" });
  });

  it("rejects everything else", () => {
    expect(matchRoute("/l")).toEqual({ page: "not-found" });
    expect(matchRoute("/l/a/b")).toEqual({ page: "not-found" });
    expect(matchRoute("/dev/other")).toEqual({ page: "not-found" });
    expect(matchRoute("/dev/devices")).toEqual({ page: "not-found" });
    expect(matchRoute("/George")).toEqual({ page: "not-found" });
    expect(matchRoute("/a/b")).toEqual({ page: "not-found" });
    expect(matchRoute("/example/other")).toEqual({ page: "not-found" });
  });
});
