import { describe, expect, it } from "vitest";
import { AGE_RATING_FREQUENCY, AGE_RATING_YES_NO, FALLBACK_SCREENSHOT_GROUPS, ageRatingAnswers, groupFor, requiredScreenshots } from "./appstore.js";

describe("App Store screenshot groups", () => {
  const groups = FALLBACK_SCREENSHOT_GROUPS;
  it("places each accepted size in its group, either way up on iPhone and iPad", () => {
    expect(groupFor(groups, "ios", 1320, 2868)?.group.id).toBe("IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE");
    expect(groupFor(groups, "ios", 2868, 1320)?.group.id).toBe("IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE");
    expect(groupFor(groups, "ios", 1284, 2778)?.group.id).toBe("IPHONE_FACE_ID_LARGE_PROFILE");
    expect(groupFor(groups, "ios", 2064, 2752)?.group.id).toBe("IPAD_13_PROFILE");
    expect(groupFor(groups, "macos", 2880, 1800)).toEqual({ group: groups[3], alphaAllowed: true });
    expect(groupFor(groups, "tvos", 1920, 1080)?.group.id).toBe("APPLE_TV_PROFILE");
  });

  it("takes no other size, and Mac and Apple TV only upright", () => {
    expect(groupFor(groups, "ios", 1000, 2000)).toBeNull();
    expect(groupFor(groups, "ios", 1920, 1080)).toBeNull();
    expect(groupFor(groups, "macos", 1800, 2880)).toBeNull();
    expect(groupFor(groups, "tvos", 1080, 1920)).toBeNull();
  });

  it("asks for iPad only when the app runs on iPad", () => {
    expect(requiredScreenshots(groups, "ios", false)).toEqual([{ label: "iPhone 6.9 inch", groups: ["IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", "IPHONE_FACE_ID_LARGE_PROFILE"] }]);
    expect(requiredScreenshots(groups, "ios", true).map((r) => r.label)).toEqual(["iPhone 6.9 inch", "iPad 13 inch"]);
    expect(requiredScreenshots(groups, "tvos", true)).toEqual([{ label: "Apple TV", groups: ["APPLE_TV_PROFILE"] }]);
  });
});

describe("age rating answers", () => {
  it("answers every question, None or No unless given", () => {
    const answers = ageRatingAnswers({ contests: "FREQUENT", messagingAndChat: true, violenceRealistic: "SOMETIMES" as never });
    expect(Object.keys(answers)).toHaveLength(Object.keys(AGE_RATING_FREQUENCY).length + Object.keys(AGE_RATING_YES_NO).length);
    expect(answers).toMatchObject({ contests: "FREQUENT", messagingAndChat: true, violenceRealistic: "NONE", gambling: false });
  });
});
