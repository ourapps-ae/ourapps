import { describe, expect, it } from "vitest";
import { isPackageName, playImageProblem } from "./googleplay.js";

const png = (width: number, height: number, alpha = false, bytes = 1000) => ({ type: "png" as const, width, height, alpha, bytes });

describe("Google Play image rules", () => {
  it("takes a 512 x 512 PNG icon of at most 1024 KB", () => {
    expect(playImageProblem("icon", png(512, 512, true))).toBeNull();
    expect(playImageProblem("icon", png(1024, 1024))).toBe("is 1024 x 1024 pixels; Google Play takes a 512 x 512 icon");
    expect(playImageProblem("icon", { ...png(512, 512), type: "jpeg" })).toBe("is not a PNG, which Google Play takes for the icon");
    expect(playImageProblem("icon", png(512, 512, false, 1024 * 1024 + 1))).toBe("is larger than the 1024 KB Google Play takes for the icon");
  });

  it("takes a 1024 x 500 feature graphic without transparency", () => {
    expect(playImageProblem("featureGraphic", png(1024, 500))).toBeNull();
    expect(playImageProblem("featureGraphic", png(1024, 500, true))).toMatch(/^has transparency/);
    expect(playImageProblem("featureGraphic", png(1000, 500))).toBe("is 1000 x 500 pixels; Google Play takes a 1024 x 500 feature graphic");
  });

  it("checks screenshot sides and proportions", () => {
    expect(playImageProblem("phone", png(1080, 1920))).toBeNull();
    expect(playImageProblem("phone", png(1920, 1080))).toBeNull();
    expect(playImageProblem("phone", png(300, 600))).toBe("is 300 x 600 pixels; each side must be between 320 and 3840 pixels");
    expect(playImageProblem("phone", png(1000, 2400))).toBe("is 1000 x 2400 pixels; the long side can be at most 2.3 times the short side");
    expect(playImageProblem("phone", png(1080, 1920, false, 9 * 1024 * 1024))).toBe("is larger than the 8 MB Google Play takes for a screenshot");
    expect(playImageProblem("tablet", png(1080, 1920))).toBeNull();
    expect(playImageProblem("tablet", png(1000, 1500))).toBe("is 1000 x 1500 pixels; each side must be between 1080 and 7680 pixels");
  });

  it("knows an Android package name", () => {
    for (const ok of ["com.example.pokernight", "club.poker_night.app"]) expect(isPackageName(ok)).toBe(true);
    for (const bad of ["pokernight", "com.example.poker-night", "com.1example.app", "", 5]) expect(isPackageName(bad)).toBe(false);
  });
});
