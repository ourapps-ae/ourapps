import { describe, expect, it } from "vitest";
import type { AppStoreStatus, Release } from "./api.js";
import { appStoreCard } from "./appStore.js";
import { desktopPanel, televisionPanel } from "./desktop.js";
import { appStoreLink } from "./pages/public.js";

const APPLE = "6447402192";

function status(over: Partial<AppStoreStatus> = {}): AppStoreStatus {
  return {
    platform: "ios", setUp: true, needs: null, appleAppId: APPLE, storeUrl: `https://apps.apple.com/app/id${APPLE}`,
    links: { appPrivacy: `https://appstoreconnect.apple.com/apps/${APPLE}/distribution/privacy`, appReview: `https://appstoreconnect.apple.com/apps/${APPLE}/distribution/reviewsubmissions`, unlistedRequest: "https://developer.apple.com/support/unlisted-app-distribution/" },
    step: "app-info", stage: "draft",
    appInfo: { listing: "public", unlistedGrantedAt: null, category: "", ageRating: {}, thirdPartyContent: false, privacyPolicyUrl: "", defaultPolicy: { url: null, collects: [], storage: "device", contactEmail: "club@example.com", developerName: "Poker Night Club" }, done: false, error: null },
    privacy: { confirmedAt: null, done: false },
    version: { version: "1.2", description: "League night.", keywords: "Poker Night", supportUrl: "", copyright: "2026 Poker Night Club", whatsNew: "", firstVersion: true, suggested: "1.2", done: false, error: null },
    screenshots: { required: [{ label: "iPhone 6.9 inch", displayTypes: [{ id: "APP_IPHONE_67", label: "iPhone 6.9 inch", sizes: "1320 x 2868", uploaded: 0 }] }], missing: ["iPhone 6.9 inch is missing: add a screenshot of 1320 x 2868 pixels (upright or turned)."], pending: 0, started: false, items: [], done: false, error: null },
    review: { firstName: "Sam", lastName: "Dealer", email: "club@example.com", phone: "+44 7700 900123", notes: "", done: false, error: null },
    build: { buildNumber: "7", candidates: [{ version: "1.2", buildNumber: "7", expiresAt: null }], done: false, error: null },
    submission: { releaseType: "AFTER_APPROVAL", appleState: null, message: null, liveVersion: null, submittedAt: null, checkedAt: null, releasedAt: null, error: null },
    ...over,
  };
}

const steps = (html: string) => [...html.matchAll(/<li class="([\w-]+)" data-as-step="([\w-]+)"/g)].map((m) => `${m[2]}:${m[1]}`);

describe("App Store card", () => {
  it("asks for TestFlight first", () => {
    const card = appStoreCard(status({ setUp: false, needs: "testflight", step: null }), "tvos").html;
    expect(card).toContain("Set up Apple TV TestFlight first");
    expect(card).not.toContain("data-as-step");
  });

  it("lists the seven steps with the current one open", () => {
    const card = appStoreCard(status(), "ios").html;
    expect(steps(card)).toEqual(["app-info:now", "privacy:muted-step", "version:muted-step", "screenshots:muted-step", "review:muted-step", "build:muted-step", "submit:muted-step"]);
    expect(card).toContain('data-as-form="app-info"');
    expect(card).toContain('name="category"');
    expect(card).toContain("free, in every country and region");
    expect(card).not.toMatch(/price/i);
    expect(card).toContain('<input type="email" name="contactEmail" value="club@example.com" placeholder="" maxlength="120"  />');
  });

  it("links App Privacy, and marks done steps with what Apple has", () => {
    const card = appStoreCard(status({ step: "privacy", appInfo: { ...status().appInfo, category: "GAMES", done: true } }), "ios").html;
    expect(steps(card).slice(0, 2)).toEqual(["app-info:done", "privacy:now"]);
    expect(card).toContain("Public, Games, free in every country and region.");
    expect(card).toContain(`href="https://appstoreconnect.apple.com/apps/${APPLE}/distribution/privacy"`);
    expect(card).toContain("data-as-privacy");
    expect(card).toContain('data-as-open="app-info"');
  });

  it("says which screenshot size is missing, and why a screenshot was refused", () => {
    const shots = { ...status().screenshots, started: true, items: [{ url: "https://img.example/old.png", displayType: null, width: 1170, height: 2532, uploaded: false, error: "is 1170 x 2532 pixels, a size Apple does not take for iPhone and iPad" }] };
    const card = appStoreCard(status({ step: "screenshots", screenshots: shots }), "ios").html;
    expect(card).toContain("iPhone 6.9 inch is missing: add a screenshot of 1320 x 2868 pixels (upright or turned).");
    expect(card).toContain("old.png</a> is 1170 x 2532 pixels, a size Apple does not take for iPhone and iPad");
    expect(card).toContain("Check and upload again");
  });

  it("offers the release choice, and holds an unlisted app for Apple's grant", () => {
    const card = appStoreCard(status({ step: "submit" }), "ios").html;
    expect(card).toContain('value="AFTER_APPROVAL" checked');
    expect(card).toContain("Wait for me to press Release");
    const unlisted = appStoreCard(status({ step: "submit", appInfo: { ...status().appInfo, listing: "unlisted" } }), "ios").html;
    expect(unlisted).not.toContain('name="releaseType"');
    expect(unlisted).toContain("waits for you to release it once Apple has granted it");
  });

  it("follows the review, shows Release, and links Apple's messages when rejected", () => {
    const waiting = appStoreCard(status({ step: null, stage: "in-review", submission: { ...status().submission, appleState: "IN_REVIEW", submittedAt: "2026-11-25T10:00:00Z" } }), "ios").html;
    expect(waiting).toContain("Apple is reviewing version 1.2");
    expect(waiting).not.toContain("data-as-step");
    const pending = appStoreCard(status({ step: null, stage: "pending-release", submission: { ...status().submission, releaseType: "MANUAL" } }), "ios").html;
    expect(pending).toContain("data-as-release");
    expect(pending).not.toContain("data-as-release disabled");
    const held = appStoreCard(status({ step: null, stage: "pending-release", appInfo: { ...status().appInfo, listing: "unlisted" } }), "ios").html;
    expect(held).toContain("https://developer.apple.com/support/unlisted-app-distribution/");
    expect(held).toContain("data-as-granted");
    expect(held).toMatch(/data-as-release\s+disabled/);
    const rejected = appStoreCard(status({ step: "submit", stage: "rejected", submission: { ...status().submission, message: "Apple's App Review did not approve this version." } }), "ios").html;
    expect(rejected).toContain("Read Apple's messages in App Store Connect");
    expect(rejected).toContain(`href="https://appstoreconnect.apple.com/apps/${APPLE}/distribution/reviewsubmissions"`);
    expect(rejected).toContain('data-as-form="submit"');
  });

  it("links the App Store page once the version is on the store", () => {
    const ready = appStoreCard(status({ step: null, stage: "ready", submission: { ...status().submission, liveVersion: "1.2" } }), "ios").html;
    expect(ready).toContain("on the App Store");
    expect(ready).toContain(`href="https://apps.apple.com/app/id${APPLE}"`);
    expect(ready).toContain('data-as-open="version"');
  });
});

describe("App Store on the install page", () => {
  const release: Release = {
    version: "1.2", minPlayers: 2, maxPlayers: 9, fallbackName: "Poker Night", fallbackIcon: "", fallbackDescription: "", fallbackScreenshots: [],
    install: { ios: null, android: null, pwa: null, macos: { packages: [], testflight: { bundleId: "a.b", architectures: ["arm64"], minOsVersion: "14" } }, tvos: { bundleId: "a.b", minOsVersion: "18" } },
    apple: { ios: null, macos: null, tvos: null },
    appStore: { ios: null, macos: `https://apps.apple.com/app/id${APPLE}`, tvos: `https://apps.apple.com/app/id${APPLE}` },
  };

  it("names the App Store link plainly", () => {
    expect(appStoreLink(`https://apps.apple.com/app/id${APPLE}`).html).toContain("Get it on the App Store");
  });

  it("offers the Mac and Apple TV App Store pages beside TestFlight, and nothing without them", () => {
    expect(desktopPanel(release, "macos", true).html).toContain(`<a class="btn" href="https://apps.apple.com/app/id${APPLE}">Get it on the App Store</a>`);
    expect(desktopPanel(release, "macos", false).html).toContain("Open this page on a Mac to get it from the App Store");
    expect(televisionPanel(release, "https://ourapps.app/l/x").html).toContain("Apple TV App Store");
    const none = { ...release, appStore: { ios: null, macos: null, tvos: null } };
    expect(desktopPanel(none, "macos", true).html).not.toContain("App Store</a>");
    expect(televisionPanel(none, "https://ourapps.app/l/x").html).not.toContain("Apple TV App Store");
  });
});
