import { describe, expect, it } from "vitest";
import type { GooglePlayRelease, GooglePlayStatus } from "./api.js";
import { googlePlayCard } from "./googlePlay.js";
import { googlePlayLink } from "./pages/public.js";
import { targetSections } from "./targets.js";

const PACKAGE = "club.pokernight.app";
const EMAIL = "ourapps@poker-night-club.iam.gserviceaccount.com";

function status(over: Partial<GooglePlayStatus> = {}): GooglePlayStatus {
  return {
    setUp: true, needs: null, serviceAccount: EMAIL, packageName: PACKAGE, packageFrom: "my-app.json", step: "app",
    links: {
      console: "https://play.google.com/console", appContent: "https://support.google.com/googleplay/android-developer/answer/9859455", testingRules: "https://support.google.com/googleplay/android-developer/answer/14151465",
      signing: "https://support.google.com/googleplay/android-developer/answer/9842756", firstRelease: "https://support.google.com/googleplay/android-developer/answer/9859348", verification: "https://developer.android.com/developer-verification",
      playPage: `https://play.google.com/store/apps/details?id=${PACKAGE}`, testing: `https://play.google.com/apps/testing/${PACKAGE}`,
    },
    app: { packageName: PACKAGE, foundAt: null, done: false, error: null },
    content: { privacyPolicyUrl: "", defaultPolicy: { url: null, collects: [], storage: "device", contactEmail: "club@example.com", developerName: "Poker Night Club" }, policyAddress: null, confirmedAt: null, done: false, error: null },
    listing: { title: "Poker Night", shortDescription: "Thursday table, house rules included", fullDescription: "League night.", contactEmail: "club@example.com", contactWebsite: "", language: null, syncedAt: null, done: false, error: null },
    graphics: { featureGraphicUrl: "", tabletScreenshots: [], started: false, pending: 0, committed: false, missing: [], items: [], done: false, error: null },
    release: { version: "1.2.0", bundle: true, ready: false, error: null },
    releases: [],
    testing: { firstClosedAt: null, days: null, requiredDays: 14, readyAt: null, testingLink: false },
    live: { production: false, url: null },
    ...over,
  };
}

const steps = (html: string) => [...html.matchAll(/<li class="([\w-]+)" data-gp-step="([\w-]+)"/g)].map((m) => `${m[2]}:${m[1]}`);
const release = (over: Partial<GooglePlayRelease> = {}): GooglePlayRelease => ({ track: "alpha", version: "1.2.0", versionCode: 42, status: "completed", userFraction: null, stage: "in-review", googleState: null, message: null, committedAt: "2026-11-26T10:00:00Z", checkedAt: null, liveAt: null, ...over });

describe("Google Play card", () => {
  it("asks for the service account first", () => {
    const card = googlePlayCard(status({ setUp: false, needs: "service-account", serviceAccount: null, step: null })).html;
    expect(card).toContain('href="/dev/settings#google-play"');
    expect(card).not.toContain("data-gp-step");
  });

  it("starts with the app record made by hand in Play Console and the service account to invite", () => {
    const card = googlePlayCard(status()).html;
    expect(steps(card)).toEqual(["app:now", "content:muted-step", "listing:muted-step", "graphics:muted-step", "release:muted-step"]);
    expect(card).toContain(`data-copy="${PACKAGE}"`);
    expect(card).toContain(`data-copy="${EMAIL}"`);
    expect(card).toContain("Upload the first bundle by hand");
    expect(card).toContain("Release apps to testing tracks, Release to production, and Manage store presence");
    expect(card).toContain("From the latest release&#39;s my-app.json.");
  });

  it("says how signing decides whether phones with the APK take Google Play's updates", () => {
    const card = googlePlayCard(status()).html;
    expect(card).toContain("A phone that has the APK from ourapps then cannot take Google Play's version as an update, because the signatures differ, unless Google Play signs with the same key.");
    expect(card).toContain("Use the same key for both.");
  });

  it("notes how Google Pay is approved for an app in Google Play, and when the APK takes it", () => {
    const card = googlePlayCard(status()).html;
    expect(card).toContain('href="https://pay.google.com/business/console"');
    expect(card).toContain("which lists only apps in Google Play under the Google account signed in to it");
    expect(card).toContain("invite the Play Console's owner or admin account under Users in the Google Pay and Wallet Console and sign in with it");
    expect(card).toContain("Internal testing included");
    expect(card).toContain("the APK from ourapps takes Google Pay only when it is signed with the same key as the Google Play copy");
  });

  it("shows the address to paste in App content and waits for the developer's confirmation", () => {
    const card = googlePlayCard(status({ step: "content", app: { packageName: PACKAGE, foundAt: "2026-11-26T10:00:00Z", done: true, error: null }, content: { ...status().content, policyAddress: "https://ourapps.app/privacy/0123456789abcdef01234567" } })).html;
    expect(steps(card).slice(0, 2)).toEqual(["app:done", "content:now"]);
    expect(card).toContain('data-copy="https://ourapps.app/privacy/0123456789abcdef01234567"');
    expect(card).toMatch(/<button class="btn sm mt-s" type="button" data-gp-content >/);
  });

  it("asks for the bundle in my-app.json before a release, then offers the tracks", () => {
    const ready = { app: { ...status().app, done: true }, content: { ...status().content, done: true }, listing: { ...status().listing, done: true }, graphics: { ...status().graphics, done: true, committed: true } };
    const missing = googlePlayCard(status({ ...ready, step: "release", release: { version: "1.2.0", bundle: false, ready: true, error: null } })).html;
    expect(missing).toContain("names it in my-app.json as <code>install.android.bundle</code>");
    const form = googlePlayCard(status({ ...ready, step: "release", release: { version: "1.2.0", bundle: true, ready: true, error: null } })).html;
    for (const track of ["Internal testing", "Closed testing", "Open testing", "Production"]) expect(form).toContain(track);
    expect(form).toContain('name="rollout"');
  });

  it("lists releases with Google's stage, counts the closed test's days and offers the test's join page", () => {
    const card = googlePlayCard(status({ releases: [release(), release({ track: "production", stage: "live", liveAt: "2026-11-27T10:00:00Z", versionCode: 41 })], testing: { firstClosedAt: "2026-11-26T10:00:00Z", days: 3, requiredDays: 14, readyAt: "2026-12-10T10:00:00Z", testingLink: false } })).html;
    expect(card).toContain("in Google&#39;s review");
    expect(card).toContain("Sent to Google for review; ourapps checks every ten minutes.");
    expect(card).toContain("Day 3 of 14 since ourapps&#39; first closed test release");
    expect(card).toContain("at least 12 testers opted in for 14 days in a row");
    expect(card).toContain(`data-copy="https://play.google.com/apps/testing/${PACKAGE}"`);
    expect(card).toContain("data-gp-testing");
  });

  it("puts the card and the developer verification note in the Android section", () => {
    const sections = targetSections({}).html;
    expect(sections).toContain('id="android-googleplay-card"');
    expect(sections).toContain("Android developer verification");
    expect(sections).toContain("one-day wait");
  });

  it("offers Google Play on the install page", () => {
    expect(googlePlayLink(`https://play.google.com/store/apps/details?id=${PACKAGE}`).html).toContain("Get it on Google Play");
  });
});
