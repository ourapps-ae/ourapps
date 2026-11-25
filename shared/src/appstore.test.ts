import { describe, expect, it } from "vitest";
import { AGE_RATING_FREQUENCY, AGE_RATING_YES_NO, ageRatingAnswers, displayTypeFor, requiredDisplayTypes } from "./appstore.js";

describe("App Store screenshot sizes", () => {
  it("places each accepted size in its display type, either way up on iPhone and iPad", () => {
    expect(displayTypeFor("ios", 1320, 2868)?.id).toBe("APP_IPHONE_67");
    expect(displayTypeFor("ios", 2868, 1320)?.id).toBe("APP_IPHONE_67");
    expect(displayTypeFor("ios", 1284, 2778)?.id).toBe("APP_IPHONE_65");
    expect(displayTypeFor("ios", 2064, 2752)?.id).toBe("APP_IPAD_PRO_3GEN_129");
    expect(displayTypeFor("macos", 2880, 1800)?.id).toBe("APP_DESKTOP");
    expect(displayTypeFor("tvos", 1920, 1080)?.id).toBe("APP_APPLE_TV");
  });

  it("takes no other size, and Mac and Apple TV only upright", () => {
    expect(displayTypeFor("ios", 1170, 2532)).toBeNull();
    expect(displayTypeFor("ios", 1920, 1080)).toBeNull();
    expect(displayTypeFor("macos", 1800, 2880)).toBeNull();
    expect(displayTypeFor("tvos", 1080, 1920)).toBeNull();
  });

  it("asks for iPad only when the app runs on iPad", () => {
    expect(requiredDisplayTypes("ios", false).map((r) => r.label)).toEqual(["iPhone 6.9 inch"]);
    expect(requiredDisplayTypes("ios", true).map((r) => r.label)).toEqual(["iPhone 6.9 inch", "iPad 13 inch"]);
    expect(requiredDisplayTypes("tvos", true)).toEqual([{ label: "Apple TV", types: ["APP_APPLE_TV"] }]);
  });
});

describe("age rating answers", () => {
  it("answers every question, None or No unless given", () => {
    const answers = ageRatingAnswers({ contests: "FREQUENT", messagingAndChat: true, violenceRealistic: "SOMETIMES" as never });
    expect(Object.keys(answers)).toHaveLength(Object.keys(AGE_RATING_FREQUENCY).length + Object.keys(AGE_RATING_YES_NO).length);
    expect(answers).toMatchObject({ contests: "FREQUENT", messagingAndChat: true, violenceRealistic: "NONE", gambling: false });
  });
});
