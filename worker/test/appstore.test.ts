import { beforeEach, describe, expect, it } from "vitest";
import { Db } from "../src/db.js";
import type { Env } from "../src/env.js";
import { handle } from "../src/index.js";
import { tickAppStore } from "../src/appstore.js";
import { api, clearDb, jsonRes, saveAppleSecrets, signIn, testDeps, testEnv, type TestDeps } from "./helpers.js";

// App Store Connect as App Store review sees it. Apple's documentation, checked 25 November 2026:
// https://developer.apple.com/documentation/appstoreconnectapi (reviewSubmissions, reviewSubmissionItems, appStoreVersions,
// appStoreVersionLocalizations, appStoreReviewDetails, appInfos, ageRatingDeclarations, appPriceSchedules, appAvailabilities v2,
// appScreenshotSets, appScreenshots, appStoreVersionReleaseRequests) and
// https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications

const APPLE_APP = "6447402192";
const API = "https://api.appstoreconnect.apple.com";

type Version = { id: string; versionString: string; appVersionState: string; platform: string; releaseType?: string; copyright?: string };
type Shot = { id: string; setId: string; fileSize: number; state: string; checksum?: string };
type Fake = {
  versions: Version[];
  localizations: { id: string; versionId: string; locale: string; attributes: Record<string, unknown> }[];
  reviewDetails: { id: string; versionId: string; attributes: Record<string, unknown> }[];
  builds: { id: string; version: string; buildNumber: string; platform: string; processingState: string; expired: boolean }[];
  sets: { id: string; localizationId: string; displayType: string }[];
  shots: Shot[];
  submissions: { id: string; state: string; versionId: string | null; submitted: boolean }[];
  availability: boolean;
  // Every write Apple refuses, as for a key without the App Manager or Admin role.
  deny: boolean;
  // Screenshots Apple fails after the upload is committed.
  failShots: boolean;
  manifest: Record<string, unknown> | null;
  images: Record<string, Uint8Array>;
  uploads: Record<string, Uint8Array>;
};

type Seen = { method: string; url: string; path: string; body: unknown };

function png(width: number, height: number, colourType = 2): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  b[24] = 8;
  b[25] = colourType;
  for (let i = 26; i < b.length; i++) b[i] = (width + height + i) % 251;
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 0xff, 0xd9]);
}

function fakeStore(): Fake {
  return {
    versions: [{ id: "ver-1", versionString: "1.0", appVersionState: "PREPARE_FOR_SUBMISSION", platform: "IOS" }],
    localizations: [],
    reviewDetails: [],
    builds: [{ id: "build-7", version: "1.2", buildNumber: "7", platform: "IOS", processingState: "VALID", expired: false }, { id: "build-8", version: "1.2", buildNumber: "8", platform: "IOS", processingState: "PROCESSING", expired: false }],
    sets: [],
    shots: [],
    submissions: [],
    availability: false,
    deny: false,
    failShots: false,
    manifest: null,
    images: {},
    uploads: {},
  };
}

const resource = (type: string, id: string, attributes: Record<string, unknown> = {}, relationships?: Record<string, unknown>) => ({ type, id, attributes, ...(relationships ? { relationships } : {}) });

function storeFetch(f: Fake) {
  const seen: Seen[] = [];
  let n = 0;
  const next = (prefix: string) => `${prefix}-${++n}`;
  const fetchStub: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const raw = req.method === "GET" || req.method === "DELETE" ? null : new Uint8Array(await req.arrayBuffer());
    let body: unknown = null;
    if (raw && url.host === "api.appstoreconnect.apple.com") body = JSON.parse(new TextDecoder().decode(raw));
    seen.push({ method: req.method, url: req.url, path: url.pathname, body });
    const q = (k: string) => url.searchParams.get(k);
    const p = url.pathname;
    const m = req.method;
    if (url.host === "img.example") return f.images[p] ? new Response(f.images[p], { headers: { "Content-Type": "image/png" } }) : new Response("gone", { status: 404 });
    if (url.host === "upload.example") {
      f.uploads[p.slice(1)] = raw!;
      return new Response(null, { status: 200 });
    }
    if (url.host === "api.github.com") {
      if (!f.manifest) return new Response("not found", { status: 404 });
      if (p === "/repos/club/poker-night/releases/latest") return jsonRes({ tag_name: "v1.2", assets: [{ name: "my-app.json", url: "https://api.github.com/repos/club/poker-night/releases/assets/1" }] });
      if (p === "/repos/club/poker-night/releases/assets/1") return jsonRes(f.manifest);
      return new Response("not found", { status: 404 });
    }
    if (url.host !== "api.appstoreconnect.apple.com") return new Response("no stub", { status: 599 });
    if (f.deny && m !== "GET") return jsonRes({ errors: [{ status: "403", code: "FORBIDDEN_ERROR", title: "This request is forbidden for security reasons", detail: "The API key in use does not allow this request" }] }, 403);
    const data = (body as { data?: { attributes?: Record<string, unknown>; relationships?: Record<string, { data: { id: string } }>; id?: string } } | null)?.data;
    let r: RegExpMatchArray | null;
    if (m === "GET" && p === `/v1/apps/${APPLE_APP}`) return jsonRes({ data: resource("apps", APPLE_APP, { primaryLocale: "en-GB" }) });
    if (m === "GET" && p === `/v1/apps/${APPLE_APP}/appInfos`) return jsonRes({ data: [resource("appInfos", "info-live", { state: "READY_FOR_DISTRIBUTION" }), resource("appInfos", "info-1", { state: "PREPARE_FOR_SUBMISSION" })] });
    if (m === "GET" && p === "/v1/appInfos/info-1/ageRatingDeclaration") return jsonRes({ data: resource("ageRatingDeclarations", "age-1") });
    if (m === "PATCH" && p === "/v1/ageRatingDeclarations/age-1") return jsonRes({ data: resource("ageRatingDeclarations", "age-1") });
    if (m === "PATCH" && p === "/v1/appInfos/info-1") return jsonRes({ data: resource("appInfos", "info-1") });
    if (m === "GET" && p === "/v1/appInfos/info-1/appInfoLocalizations") return jsonRes({ data: [resource("appInfoLocalizations", "ail-1", { locale: "en-GB" })] });
    if (m === "PATCH" && p === "/v1/appInfoLocalizations/ail-1") return jsonRes({ data: resource("appInfoLocalizations", "ail-1") });
    if (m === "PATCH" && p === `/v1/apps/${APPLE_APP}`) return jsonRes({ data: resource("apps", APPLE_APP) });
    if (m === "GET" && p === `/v1/apps/${APPLE_APP}/appPricePoints`) return jsonRes({ data: [resource("appPricePoints", "pp-099", { customerPrice: "0.99" }), resource("appPricePoints", "pp-free", { customerPrice: "0.0" })] });
    if (m === "POST" && p === "/v1/appPriceSchedules") return jsonRes({ data: resource("appPriceSchedules", APPLE_APP) }, 201);
    if (m === "GET" && p === `/v1/apps/${APPLE_APP}/appAvailabilityV2`) return f.availability ? jsonRes({ data: resource("appAvailabilities", APPLE_APP, { availableInNewTerritories: false }) }) : jsonRes({ errors: [{ status: "404", code: "NOT_FOUND", detail: "There is no resource" }] }, 404);
    if (m === "GET" && p === "/v1/territories") return jsonRes({ data: ["USA", "GBR", "FRA"].map((id) => ({ type: "territories", id })) });
    if (m === "POST" && p === "/v2/appAvailabilities") {
      f.availability = true;
      return jsonRes({ data: resource("appAvailabilities", APPLE_APP) }, 201);
    }
    if (m === "GET" && p === `/v1/apps/${APPLE_APP}/appStoreVersions`) return jsonRes({ data: f.versions.filter((v) => v.platform === q("filter[platform]")).map((v) => resource("appStoreVersions", v.id, { versionString: v.versionString, appVersionState: v.appVersionState, releaseType: v.releaseType ?? null })) });
    if (m === "POST" && p === "/v1/appStoreVersions") {
      const v = { id: next("ver"), versionString: data!.attributes!.versionString as string, platform: data!.attributes!.platform as string, appVersionState: "PREPARE_FOR_SUBMISSION", copyright: data!.attributes!.copyright as string };
      f.versions.push(v);
      return jsonRes({ data: resource("appStoreVersions", v.id, { versionString: v.versionString, appVersionState: v.appVersionState }) }, 201);
    }
    if ((r = p.match(/^\/v1\/appStoreVersions\/([\w-]+)$/))) {
      const v = f.versions.find((x) => x.id === r![1])!;
      if (m === "PATCH") Object.assign(v, data!.attributes);
      return jsonRes({ data: resource("appStoreVersions", v.id, { versionString: v.versionString, appVersionState: v.appVersionState, releaseType: v.releaseType ?? null }) });
    }
    if ((r = p.match(/^\/v1\/appStoreVersions\/([\w-]+)\/appStoreVersionLocalizations$/))) return jsonRes({ data: f.localizations.filter((l) => l.versionId === r![1]).map((l) => resource("appStoreVersionLocalizations", l.id, { locale: l.locale })) });
    if (m === "POST" && p === "/v1/appStoreVersionLocalizations") {
      const l = { id: next("loc"), versionId: data!.relationships!.appStoreVersion.data.id, locale: data!.attributes!.locale as string, attributes: data!.attributes! };
      f.localizations.push(l);
      return jsonRes({ data: resource("appStoreVersionLocalizations", l.id) }, 201);
    }
    if (m === "PATCH" && (r = p.match(/^\/v1\/appStoreVersionLocalizations\/([\w-]+)$/))) {
      Object.assign(f.localizations.find((l) => l.id === r![1])!.attributes, data!.attributes);
      return jsonRes({ data: resource("appStoreVersionLocalizations", r[1]) });
    }
    if ((r = p.match(/^\/v1\/appStoreVersions\/([\w-]+)\/appStoreReviewDetail$/))) {
      const d = f.reviewDetails.find((x) => x.versionId === r![1]);
      return d ? jsonRes({ data: resource("appStoreReviewDetails", d.id) }) : jsonRes({ errors: [{ status: "404", code: "NOT_FOUND", detail: "There is no resource" }] }, 404);
    }
    if (m === "POST" && p === "/v1/appStoreReviewDetails") {
      f.reviewDetails.push({ id: next("rd"), versionId: data!.relationships!.appStoreVersion.data.id, attributes: data!.attributes! });
      return jsonRes({ data: resource("appStoreReviewDetails", "rd") }, 201);
    }
    if (m === "PATCH" && (r = p.match(/^\/v1\/appStoreReviewDetails\/([\w-]+)$/))) {
      Object.assign(f.reviewDetails.find((d) => d.id === r![1])!.attributes, data!.attributes);
      return jsonRes({ data: resource("appStoreReviewDetails", r[1]) });
    }
    if (m === "GET" && p === "/v1/builds") {
      const found = f.builds.filter((b) => b.version === q("filter[preReleaseVersion.version]") && b.buildNumber === q("filter[version]") && b.platform === q("filter[preReleaseVersion.platform]"));
      return jsonRes({ data: found.map((b) => resource("builds", b.id, { processingState: b.processingState, expired: b.expired, expirationDate: "2027-01-01T00:00:00Z", usesNonExemptEncryption: false })) });
    }
    if (m === "PATCH" && p.match(/^\/v1\/appStoreVersions\/[\w-]+\/relationships\/build$/)) return new Response(null, { status: 204 });
    if (m === "GET" && p === "/v1/reviewSubmissions") {
      const open = f.submissions.filter((s) => (q("filter[state]") ?? "").split(",").includes(s.state));
      return jsonRes({ data: open.map((s) => resource("reviewSubmissions", s.id, { state: s.state }, { appStoreVersionForReview: { data: s.versionId ? { type: "appStoreVersions", id: s.versionId } : null } })) });
    }
    if (m === "POST" && p === "/v1/reviewSubmissions") {
      const s = { id: next("sub"), state: "READY_FOR_REVIEW", versionId: null, submitted: false };
      f.submissions.push(s);
      return jsonRes({ data: resource("reviewSubmissions", s.id, { state: s.state, platform: (data!.attributes as { platform: string }).platform }) }, 201);
    }
    if (m === "POST" && p === "/v1/reviewSubmissionItems") {
      f.submissions.find((s) => s.id === data!.relationships!.reviewSubmission.data.id)!.versionId = data!.relationships!.appStoreVersion.data.id;
      return jsonRes({ data: resource("reviewSubmissionItems", next("item")) }, 201);
    }
    if (m === "PATCH" && (r = p.match(/^\/v1\/reviewSubmissions\/([\w-]+)$/))) {
      const s = f.submissions.find((x) => x.id === r![1])!;
      Object.assign(s, { submitted: true, state: "WAITING_FOR_REVIEW" });
      f.versions.find((v) => v.id === s.versionId)!.appVersionState = "WAITING_FOR_REVIEW";
      return jsonRes({ data: resource("reviewSubmissions", s.id, { state: s.state }) });
    }
    if (m === "POST" && p === "/v1/appStoreVersionReleaseRequests") {
      f.versions.find((v) => v.id === data!.relationships!.appStoreVersion.data.id)!.appVersionState = "PROCESSING_FOR_DISTRIBUTION";
      return jsonRes({ data: resource("appStoreVersionReleaseRequests", "rel-1") }, 201);
    }
    if ((r = p.match(/^\/v1\/appStoreVersionLocalizations\/([\w-]+)\/appScreenshotSets$/))) return jsonRes({ data: f.sets.filter((s) => s.localizationId === r![1]).map((s) => resource("appScreenshotSets", s.id, { screenshotDisplayType: s.displayType })) });
    if (m === "POST" && p === "/v1/appScreenshotSets") {
      const s = { id: next("set"), localizationId: data!.relationships!.appStoreVersionLocalization.data.id, displayType: data!.attributes!.screenshotDisplayType as string };
      f.sets.push(s);
      return jsonRes({ data: resource("appScreenshotSets", s.id, { screenshotDisplayType: s.displayType }) }, 201);
    }
    if ((r = p.match(/^\/v1\/appScreenshotSets\/([\w-]+)\/appScreenshots$/))) {
      return jsonRes({ data: f.shots.filter((s) => s.setId === r![1]).map((s) => resource("appScreenshots", s.id, { assetDeliveryState: { state: s.state, errors: s.state === "FAILED" ? [{ code: "IMAGE_INCORRECT_DIMENSIONS", description: "The dimensions of one or more screenshots are wrong." }] : [] } })) });
    }
    if (m === "POST" && p === "/v1/appScreenshots") {
      const s = { id: next("shot"), setId: data!.relationships!.appScreenshotSet.data.id, fileSize: data!.attributes!.fileSize as number, state: "AWAITING_UPLOAD" };
      f.shots.push(s);
      return jsonRes({ data: resource("appScreenshots", s.id, { uploadOperations: [{ method: "PUT", url: `https://upload.example/${s.id}`, offset: 0, length: s.fileSize, requestHeaders: [{ name: "Content-Type", value: "image/png" }] }] }) }, 201);
    }
    if ((r = p.match(/^\/v1\/appScreenshots\/([\w-]+)$/))) {
      if (m === "DELETE") {
        f.shots = f.shots.filter((s) => s.id !== r![1]);
        return new Response(null, { status: 204 });
      }
      const s = f.shots.find((x) => x.id === r![1])!;
      Object.assign(s, { state: f.failShots ? "FAILED" : "COMPLETE", checksum: data!.attributes!.sourceFileChecksum });
      return jsonRes({ data: resource("appScreenshots", s.id) });
    }
    return new Response(`no stub for ${m} ${p}`, { status: 599 });
  };
  return { fetch: fetchStub, seen };
}

let env: Env;
let deps: TestDeps;
let cookie: string;
let f: Fake;
let stub: ReturnType<typeof storeFetch>;
let d: TestDeps;
let appId: string;
let linkId: string;

const base = () => `/api/dev/apps/${appId}/appstore/ios`;
const call = async (method: string, path: string, body?: unknown, who = cookie) => handle(api(who, method, path, body), env, d);
const view = async () => (await (await call("GET", base())).json()) as Record<string, any>;
const writes = () => stub.seen.filter((s) => s.method !== "GET" && s.url.startsWith(API)).map((s) => `${s.method} ${s.path}`);
const sent = (method: string, path: string) => stub.seen.filter((s) => s.method === method && s.path === path).map((s) => (s.body as { data: Record<string, any> }).data);

async function md5(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("MD5", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  env = testEnv();
  await clearDb(env);
  deps = testDeps();
  f = fakeStore();
  stub = storeFetch(f);
  d = { ...deps, fetch: stub.fetch };
  cookie = await signIn(env, deps);
  await saveAppleSecrets(env, deps, cookie);
  expect((await handle(api(cookie, "PUT", "/api/dev/review-contact", { firstName: "George", lastName: "McIntyre", email: "g@example.com", phone: "+44 7700 900123" }), env, deps)).status).toBe(200);
  f.images = { "/phone-1.png": png(1320, 2868), "/phone-2.png": png(1290, 2796), "/tablet.png": png(2064, 2752), "/old-phone.png": png(1170, 2532), "/clear.png": png(1320, 2868, 6), "/tv.jpg": jpeg(1920, 1080) };
  const made = await handle(api(cookie, "POST", "/api/dev/apps", {
    name: "Poker Night", repo: "club/poker-night", bundleId: "com.example.pokernight", tagline: "Thursday table, house rules included", description: "The club's league night: fixtures, scores and the table.",
    screenshots: ["https://img.example/phone-1.png", "https://img.example/old-phone.png"], screenshotsByPlatform: { ipad: ["https://img.example/tablet.png"], tvos: ["https://img.example/tv.jpg"] },
  }), env, deps);
  appId = ((await made.json()) as { app: { id: string } }).app.id;
  linkId = ((await (await handle(api(cookie, "POST", `/api/dev/apps/${appId}/links`, { label: "club" }), env, deps)).json()) as { link: { id: string } }).link.id;
  const db = Db.from(env);
  for (const platform of ["ios", "tvos"] as const) {
    const target = await db.platformApp((await db.appById(appId))!, platform);
    Object.assign(target, { ascAppId: APPLE_APP, betaGroupId: `grp-${platform}`, testflightUrl: "https://testflight.apple.com/join/PokerNight" });
    await db.setAppTestflight(target);
  }
  const now = deps.now().toISOString();
  for (const b of [{ version: "1.1", buildNumber: "3", buildId: "build-3", state: "open" }, { version: "1.2", buildNumber: "7", buildId: "build-7", state: "open" }, { version: "1.2", buildNumber: "8", buildId: null, state: "processing" }] as const) {
    const id = await db.insertTestflightBuild({ appId, platform: "ios", version: b.version, buildNumber: b.buildNumber, uploadId: null, uploadFileId: null, buildId: b.buildId, whatsNew: b.version === "1.2" ? "Rematch button for the last table" : null, state: b.state, message: null, createdAt: now, updatedAt: now });
    await env.DB.prepare("UPDATE testflight_builds SET expires_at = ? WHERE id = ?").bind("2027-01-01T00:00:00Z", id).run();
  }
});

const APP_INFO = { category: "GAMES", ageRating: { contests: "INFREQUENT", messagingAndChat: true }, thirdPartyContent: false, defaultPolicy: { collects: ["names", "content"], storage: "servers", contactEmail: "club@example.com" } };
const VERSION = { version: "1.2", supportUrl: "https://club.example/help" };

// Every step up to the submission, as the console takes them.
async function prepare(appInfo: Record<string, unknown> = APP_INFO) {
  expect((await call("PUT", base(), { appInfo })).status).toBe(200);
  expect((await call("PUT", base(), { privacyAnswered: true })).status).toBe(200);
  expect((await call("PUT", base(), { version: VERSION })).status).toBe(200);
  let shots = await call("POST", `${base()}/screenshots`);
  while (((await shots.clone().json()) as { screenshots: { pending: number } }).screenshots.pending > 0) shots = await call("POST", `${base()}/screenshots`);
  expect(shots.status).toBe(200);
  expect((await call("PUT", base(), { review: {} })).status).toBe(200);
  expect((await call("PUT", base(), { build: { buildNumber: "7" } })).status).toBe(200);
}

describe("App Store review", () => {
  it("refuses App Store work before TestFlight is set up, for another developer, and for a disabled target", async () => {
    const other = await handle(api(cookie, "POST", "/api/dev/apps", { name: "Poker Night league table", repo: "club/league" }), env, deps);
    const otherId = ((await other.json()) as { app: { id: string } }).app.id;
    const status = (await (await call("GET", `/api/dev/apps/${otherId}/appstore/ios`)).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ platform: "ios", setUp: false, needs: "testflight", step: null, stage: "draft", appleAppId: null, storeUrl: null });
    for (const [method, path, body] of [["PUT", "", { privacyAnswered: true }], ["POST", "/screenshots", undefined], ["POST", "/submit", undefined], ["POST", "/release", undefined]] as const) {
      const res = await call(method, `/api/dev/apps/${otherId}/appstore/ios${path}`, body);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/^Set up TestFlight for this platform first/);
    }
    expect((await call("GET", `/api/dev/apps/${otherId}/appstore/android`)).status).toBe(400);

    const stranger = await signIn(env, deps, { id: 9, login: "sue", name: "Sue" });
    for (const [method, path] of [["GET", ""], ["PUT", ""], ["POST", "/submit"], ["POST", "/release"], ["POST", "/screenshots"]] as const) {
      const res = await call(method, `${base()}${path}`, method === "PUT" ? { privacyAnswered: true } : undefined, stranger);
      expect(res.status).toBe(404);
    }

    await Db.from(env).setAppTarget(appId, "ios", false);
    for (const [method, path, body] of [["PUT", "", { appInfo: APP_INFO }], ["POST", "/screenshots", undefined], ["POST", "/submit", undefined], ["POST", "/release", undefined]] as const) {
      const res = await call(method, `${base()}${path}`, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Target is disabled." });
    }
    expect((await call("GET", base())).status).toBe(200);
    expect(stub.seen.filter((s) => s.url.startsWith(API))).toEqual([]);
  });

  it("prefills the steps from the app, its TestFlight builds and the beta review contact", async () => {
    expect(await view()).toMatchObject({
      setUp: true, needs: null, step: "app-info", stage: "draft", storeUrl: `https://apps.apple.com/app/id${APPLE_APP}`,
      links: { appPrivacy: `https://appstoreconnect.apple.com/apps/${APPLE_APP}/distribution/privacy`, unlistedRequest: "https://developer.apple.com/support/unlisted-app-distribution/" },
      appInfo: { listing: "public", category: "", thirdPartyContent: false, ageRating: { contests: "NONE", gambling: false }, defaultPolicy: { url: null, contactEmail: "g@example.com", developerName: "George" }, done: false },
      version: { version: "1.2", description: "The club's league night: fixtures, scores and the table.", keywords: "Poker Night,thursday,table,house,rules,included", copyright: "2026 George", whatsNew: "Rematch button for the last table", supportUrl: "", done: false },
      review: { firstName: "George", lastName: "McIntyre", email: "g@example.com", phone: "+44 7700 900123", done: false },
      build: { buildNumber: "7", candidates: [{ version: "1.2", buildNumber: "7" }], done: false },
      screenshots: { started: false, missing: ["iPhone 6.9 inch is missing: add a screenshot of 1320 x 2868, 1290 x 2796, 1260 x 2736, or 1284 x 2778, 1242 x 2688 pixels (upright or turned).", "iPad 13 inch is missing: add a screenshot of 2064 x 2752, 2048 x 2732 pixels (upright or turned)."] },
    });
    expect(stub.seen).toEqual([]);
  });

  it("writes the app information with the default privacy policy, free and in every territory", async () => {
    const res = await call("PUT", base(), { appInfo: APP_INFO });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Record<string, any>;
    expect(after).toMatchObject({ step: "privacy", appInfo: { category: "GAMES", done: true, error: null } });
    const policyUrl = after.appInfo.defaultPolicy.url as string;
    expect(policyUrl).toMatch(/^https:\/\/ourapps\.app\/privacy\/[a-f0-9]{24}$/);
    expect(sent("PATCH", "/v1/appInfos/info-1")[0].relationships).toEqual({ primaryCategory: { data: { type: "appCategories", id: "GAMES" } } });
    const age = sent("PATCH", "/v1/ageRatingDeclarations/age-1")[0].attributes;
    expect(age).toMatchObject({ contests: "INFREQUENT", messagingAndChat: true, gambling: false, violenceRealistic: "NONE", lootBox: false });
    expect(Object.keys(age)).toHaveLength(25);
    const policy = sent("PATCH", "/v1/appInfoLocalizations/ail-1")[0].attributes;
    expect(policy.privacyPolicyUrl).toBe(policyUrl);
    // The app is on Apple TV too, which shows the policy's text.
    expect(policy.privacyPolicyText).toMatch(/^George made Poker Night and is responsible for the app and for this policy\. Level N Ltd only hosts this text on ourapps\.app\.\n\nWhat the app collects\nPoker Night collects:\n- names people type into the app\n- content people create in the app\n\n/);
    expect(sent("PATCH", `/v1/apps/${APPLE_APP}`)[0].attributes).toEqual({ contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT" });
    const price = stub.seen.find((s) => s.path === "/v1/appPriceSchedules")!.body as Record<string, any>;
    expect(price.data.relationships.baseTerritory).toEqual({ data: { type: "territories", id: "USA" } });
    expect(price.included).toEqual([{ type: "appPrices", id: "${free-price}", attributes: { startDate: null, endDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: "pp-free" } } } }]);
    const where = stub.seen.find((s) => s.path === "/v2/appAvailabilities")!.body as Record<string, any>;
    expect(where.data.attributes).toEqual({ availableInNewTerritories: true });
    expect(where.included.map((t: Record<string, any>) => [t.relationships.territory.data.id, t.attributes.available])).toEqual([["USA", true], ["GBR", true], ["FRA", true]]);
    // Availability already set in App Store Connect is kept.
    f.availability = true;
    const before = stub.seen.length;
    expect((await call("PUT", base(), { appInfo: { ...APP_INFO, thirdPartyContent: true } })).status).toBe(200);
    expect(stub.seen.slice(before).some((s) => s.path === "/v2/appAvailabilities")).toBe(false);
    expect(sent("PATCH", `/v1/apps/${APPLE_APP}`)[1].attributes).toEqual({ contentRightsDeclaration: "USES_THIRD_PARTY_CONTENT" });
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string; detail: string }[] };
    expect(log.events[0]).toMatchObject({ event: "app-store-details-saved", detail: "Poker Night ios: appInfo" });

    for (const bad of [{ appInfo: { ...APP_INFO, category: "CASINO" } }, { appInfo: { ...APP_INFO, privacyPolicyUrl: "http://club.example/privacy" } }, { appInfo: { ...APP_INFO, ageRating: { contests: "SOMETIMES" } } }, { appInfo: { ...APP_INFO, defaultPolicy: { collects: ["nothing", "names"], contactEmail: "club@example.com" } } }, { privacyAnswered: "yes" }, { colour: "green" }]) {
      expect((await call("PUT", `/api/dev/apps/${appId}/appstore/tvos`, bad)).status).toBe(400);
    }
  });

  it("serves the default privacy policy publicly and not indexed, and nothing at an unknown address", async () => {
    const after = (await (await call("PUT", base(), { appInfo: APP_INFO })).json()) as Record<string, any>;
    const address = new URL(after.appInfo.defaultPolicy.url as string).pathname;
    const page = await handle(new Request(`https://ourapps.app${address}`), env, d);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const text = await page.text();
    for (const words of ['<meta name="robots" content="noindex, nofollow">', "<h1>Poker Night privacy policy</h1>", "George made Poker Night and is responsible for the app and for this policy. Level N Ltd only hosts this text on ourapps.app.", "<li>names people type into the app</li>", "<li>content people create in the app</li>", "kept on servers run by George", "mailto:club@example.com", "Copyright Level N Ltd 2026"]) expect(text).toContain(words);
    expect(text).not.toContain("camera");
    for (const unknown of ["/privacy/0123456789abcdef0123", "/privacy/short", "/privacy/<script>"]) {
      const missing = await handle(new Request(`https://ourapps.app${unknown}`), env, d);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
    // The developer's own address replaces it, and the default policy is no longer served.
    expect((await call("PUT", base(), { appInfo: { ...APP_INFO, privacyPolicyUrl: "https://club.example/privacy" } })).status).toBe(200);
    expect(sent("PATCH", "/v1/appInfoLocalizations/ail-1").at(-1)!.attributes).toEqual({ privacyPolicyUrl: "https://club.example/privacy", privacyPolicyText: "The privacy policy for Poker Night is at https://club.example/privacy" });
    expect((await handle(new Request(`https://ourapps.app${address}`), env, d)).status).toBe(404);
  });

  it("explains a key without the App Manager or Admin role in plain words", async () => {
    f.deny = true;
    const res = await call("PUT", base(), { appInfo: APP_INFO });
    expect(res.status).toBe(502);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("Your App Store Connect key does not allow this. App Store review needs a key with the App Manager or Admin role: make one in App Store Connect, Users and Access, Integrations, and save it in Settings.");
    expect(await view()).toMatchObject({ step: "app-info", appInfo: { category: "GAMES", done: false, error } });
  });

  it("writes the version text, renaming the version App Store Connect made with the app", async () => {
    expect((await call("PUT", base(), { version: { ...VERSION, supportUrl: "" } })).status).toBe(400);
    expect((await call("PUT", base(), { version: { ...VERSION, keywords: "x".repeat(101) } })).status).toBe(400);
    expect((await call("PUT", base(), { version: { ...VERSION, version: "one" } })).status).toBe(400);
    const res = await call("PUT", base(), { version: VERSION });
    expect(res.status).toBe(200);
    expect(sent("PATCH", "/v1/appStoreVersions/ver-1")[0].attributes).toEqual({ versionString: "1.2", copyright: "2026 George" });
    const text = sent("POST", "/v1/appStoreVersionLocalizations")[0];
    expect(text.attributes).toEqual({ locale: "en-GB", description: "The club's league night: fixtures, scores and the table.", keywords: "Poker Night,thursday,table,house,rules,included", supportUrl: "https://club.example/help" });
    expect(text.relationships).toEqual({ appStoreVersion: { data: { type: "appStoreVersions", id: "ver-1" } } });
    expect(((await res.json()) as Record<string, any>).version).toMatchObject({ done: true, firstVersion: true });
    // Review details, the build and screenshots belong to the version text, which is saved now.
    expect((await call("PUT", base(), { build: { buildNumber: "8" } })).status).toBe(409);
    expect(((await (await call("PUT", base(), { build: { buildNumber: "8" } })).json()) as { error: string }).error).toBe("Apple has not finished processing build 8 of version 1.2 (it says processing).");
    expect((await call("PUT", base(), { build: { buildNumber: "9" } })).status).toBe(409);
    const chosen = await call("PUT", base(), { build: { buildNumber: "7" } });
    expect(((await chosen.json()) as Record<string, any>).build).toMatchObject({ buildNumber: "7", done: true, error: null });
    expect(stub.seen.find((s) => s.method === "PATCH" && s.path === "/v1/appStoreVersions/ver-1/relationships/build")!.body).toEqual({ data: { type: "builds", id: "build-7" } });
  });

  it("checks each screenshot against Apple's sizes, says which size is missing, and uploads the rest", async () => {
    expect((await call("POST", `${base()}/screenshots`)).status).toBe(409);
    await call("PUT", base(), { version: VERSION });
    // Without iPad screenshots, iPad 13 inch is missing; a size Apple does not take, and transparency, are refused.
    await call("PUT", `/api/dev/apps/${appId}`, { screenshots: ["https://img.example/phone-1.png", "https://img.example/old-phone.png", "https://img.example/clear.png", "https://img.example/gone.png"], screenshotsByPlatform: {} });
    const first = (await (await call("POST", `${base()}/screenshots`)).json()) as Record<string, any>;
    expect(first.screenshots).toMatchObject({
      pending: 0, done: false, missing: ["iPad 13 inch is missing: add a screenshot of 2064 x 2752, 2048 x 2732 pixels (upright or turned)."],
      items: [
        { url: "https://img.example/phone-1.png", displayType: "APP_IPHONE_67", width: 1320, height: 2868, uploaded: true, error: null },
        { url: "https://img.example/old-phone.png", displayType: null, width: 1170, height: 2532, uploaded: false, error: "is 1170 x 2532 pixels, a size Apple does not take for iPhone and iPad" },
        { url: "https://img.example/clear.png", displayType: "APP_IPHONE_67", uploaded: false, error: "has transparency, which Apple does not take; save it without an alpha channel" },
        { url: "https://img.example/gone.png", uploaded: false, error: "could not be downloaded (status 404)" },
      ],
    });
    const reserve = sent("POST", "/v1/appScreenshots");
    expect(reserve).toHaveLength(1);
    expect(reserve[0].attributes).toEqual({ fileName: "app_iphone_67-1.png", fileSize: 64 });
    const shot = f.shots[0];
    expect(f.uploads[shot.id]).toEqual(f.images["/phone-1.png"]);
    expect(sent("PATCH", `/v1/appScreenshots/${shot.id}`)[0].attributes).toEqual({ uploaded: true, sourceFileChecksum: await md5(f.images["/phone-1.png"]) });
    expect(f.sets.map((s) => s.displayType)).toEqual(["APP_IPHONE_67"]);

    // With an iPad screenshot the step is done; the earlier upload is replaced, not added to.
    await call("PUT", `/api/dev/apps/${appId}`, { screenshots: ["https://img.example/phone-1.png", "https://img.example/phone-2.png"], screenshotsByPlatform: { ipad: ["https://img.example/tablet.png"] } });
    const second = (await (await call("POST", `${base()}/screenshots`)).json()) as Record<string, any>;
    expect(second.screenshots).toMatchObject({ pending: 0, missing: [], done: true, required: [{ label: "iPhone 6.9 inch", displayTypes: [{ id: "APP_IPHONE_67", uploaded: 2 }, { id: "APP_IPHONE_65", uploaded: 0 }] }, { label: "iPad 13 inch", displayTypes: [{ id: "APP_IPAD_PRO_3GEN_129", uploaded: 1 }] }] });
    expect(f.shots.map((s) => s.id)).not.toContain(shot.id);
    expect(f.shots).toHaveLength(3);
    expect(second.step).toBe("app-info");
  });

  it("spreads screenshot uploads over requests to stay inside the free plan's outbound calls", async () => {
    await call("PUT", base(), { version: VERSION });
    const phones = Array.from({ length: 10 }, (_, i) => `/p${i}.png`);
    const tablets = Array.from({ length: 6 }, (_, i) => `/t${i}.png`);
    for (const path of phones) f.images[path] = png(1320, 2868);
    for (const path of tablets) f.images[path] = png(2048, 2732);
    await call("PUT", `/api/dev/apps/${appId}`, { screenshots: phones.map((p) => `https://img.example${p}`), screenshotsByPlatform: { ipad: tablets.map((p) => `https://img.example${p}`) } });
    const pending: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = stub.seen.length;
      const res = (await (await call("POST", `${base()}/screenshots`)).json()) as Record<string, any>;
      expect(stub.seen.length - before).toBeLessThanOrEqual(40);
      pending.push(res.screenshots.pending);
      if (res.screenshots.pending === 0) {
        expect(res.screenshots).toMatchObject({ done: true, missing: [] });
        break;
      }
    }
    expect(pending[0]).toBeGreaterThan(0);
    expect(pending.at(-1)).toBe(0);
    expect(f.shots).toHaveLength(16);
  });

  it("shows a screenshot Apple fails after the upload", async () => {
    await call("PUT", base(), { version: VERSION });
    f.failShots = true;
    const res = (await (await call("POST", `${base()}/screenshots`)).json()) as Record<string, any>;
    expect(res.screenshots.done).toBe(false);
    expect(res.screenshots.items[0].error).toBe("was not accepted by Apple: The dimensions of one or more screenshots are wrong.");
  });

  it("submits with the full sequence, follows each review state, and releases by hand", async () => {
    await prepare();
    expect((await call("PUT", base(), { privacyAnswered: false })).status).toBe(200);
    const early = await call("POST", `${base()}/submit`);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "Finish these steps first: App privacy answers." });
    const notReady = (await (await call("POST", `${base()}/release`)).json()) as { error: string };
    expect(notReady.error).toBe("Release is for a version Apple has approved and is waiting for you to release.");
    expect((await call("PUT", base(), { privacyAnswered: true })).status).toBe(200);
    expect(await view()).toMatchObject({ step: "submit", privacy: { done: true }, review: { done: true }, build: { done: true }, screenshots: { done: true } });
    expect(f.reviewDetails[0].attributes).toEqual({ contactFirstName: "George", contactLastName: "McIntyre", contactEmail: "g@example.com", contactPhone: "+44 7700 900123", notes: "Shared with the people we work with through ourapps.app. No sign-in is needed to use the app.", demoAccountRequired: false });
    expect((await call("POST", `${base()}/submit`, { releaseType: "SOON" })).status).toBe(400);

    const start = stub.seen.length;
    const submitted = await call("POST", `${base()}/submit`, { releaseType: "MANUAL" });
    expect(submitted.status).toBe(200);
    expect(stub.seen.slice(start).filter((s) => s.method !== "GET").map((s) => `${s.method} ${s.path}`)).toEqual(["PATCH /v1/appStoreVersions/ver-1", "POST /v1/reviewSubmissions", "POST /v1/reviewSubmissionItems", "PATCH /v1/reviewSubmissions/sub-6"].map((s) => s.replace("sub-6", f.submissions[0].id)));
    expect(sent("PATCH", "/v1/appStoreVersions/ver-1").at(-1)!.attributes).toEqual({ releaseType: "MANUAL" });
    expect(sent("POST", "/v1/reviewSubmissions")[0]).toEqual({ type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APPLE_APP } } } });
    expect(sent("POST", "/v1/reviewSubmissionItems")[0].relationships).toEqual({ reviewSubmission: { data: { type: "reviewSubmissions", id: f.submissions[0].id } }, appStoreVersion: { data: { type: "appStoreVersions", id: "ver-1" } } });
    expect(sent("PATCH", `/v1/reviewSubmissions/${f.submissions[0].id}`)[0].attributes).toEqual({ submitted: true });
    expect(((await submitted.json()) as Record<string, any>)).toMatchObject({ stage: "waiting", step: null, submission: { releaseType: "MANUAL", appleState: "WAITING_FOR_REVIEW" } });
    expect((await call("POST", `${base()}/submit`)).status).toBe(409);
    expect((await call("PUT", base(), { review: {} })).status).toBe(409);

    const stage = async (state: string) => {
      f.versions[0].appVersionState = state;
      deps.advance(10 * 60_000);
      await tickAppStore(env, d);
      return (await (await call("GET", base())).json()) as Record<string, any>;
    };
    expect(await stage("IN_REVIEW")).toMatchObject({ stage: "in-review", submission: { appleState: "IN_REVIEW", message: null } });
    const rejected = await stage("REJECTED");
    expect(rejected).toMatchObject({ stage: "rejected", step: "submit", links: { appReview: `https://appstoreconnect.apple.com/apps/${APPLE_APP}/distribution/reviewsubmissions/details/${f.submissions[0].id}` } });
    expect(rejected.submission.message).toMatch(/^Apple's App Review did not approve this version\. Apple's messages are in App Store Connect, under App Review\./);
    // Fixed and sent again: the submission Apple returned is reused.
    f.submissions[0].state = "UNRESOLVED_ISSUES";
    const again = stub.seen.length;
    expect((await call("POST", `${base()}/submit`, { releaseType: "MANUAL" })).status).toBe(200);
    expect(stub.seen.slice(again).filter((s) => s.method !== "GET").map((s) => `${s.method} ${s.path}`)).toEqual(["PATCH /v1/appStoreVersions/ver-1", `PATCH /v1/reviewSubmissions/${f.submissions[0].id}`]);
    expect(await stage("PENDING_DEVELOPER_RELEASE")).toMatchObject({ stage: "pending-release", submission: { appleState: "PENDING_DEVELOPER_RELEASE" } });
    const page = async () => ((await (await handle(api(null, "GET", `/api/public/links/${linkId}`), env, d)).json()) as { release: { appStore: Record<string, string | null> } | null });
    f.manifest = { schema: 1, id: "poker-night", name: "Poker Night", version: "1.2", description: "League night.", icon: "https://img.example/icon.png", minPlayers: 2, maxPlayers: 9, install: { pwa: null, android: null, ios: { bundleId: "com.example.pokernight", testflight: null } } };
    expect((await page()).release!.appStore).toEqual({ ios: null, macos: null, tvos: null });

    const released = await call("POST", `${base()}/release`);
    expect(released.status).toBe(200);
    expect(sent("POST", "/v1/appStoreVersionReleaseRequests")).toEqual([{ type: "appStoreVersionReleaseRequests", relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: "ver-1" } } } }]);
    expect(((await released.json()) as Record<string, any>).stage).toBe("releasing");
    expect(await stage("READY_FOR_DISTRIBUTION")).toMatchObject({ stage: "ready", step: null, submission: { liveVersion: "1.2" } });
    expect((await page()).release!.appStore).toEqual({ ios: `https://apps.apple.com/app/id${APPLE_APP}`, macos: null, tvos: null });
    const latest = (await (await handle(api(null, "GET", `/api/public/links/${linkId}/latest`), env, d)).json()) as { appStore: Record<string, string | null> };
    expect(latest.appStore.ios).toBe(`https://apps.apple.com/app/id${APPLE_APP}`);
    // Turning iPhone and iPad off removes the App Store link with the other iPhone options.
    await Db.from(env).setAppTarget(appId, "ios", false);
    expect((await page()).release!.appStore.ios).toBeNull();
    await Db.from(env).setAppTarget(appId, "ios", true);

    // The next version is a new App Store version, with what's new, while the store keeps the live one.
    const next = await call("PUT", base(), { version: { ...VERSION, version: "1.3", whatsNew: "Bigger chip numbers" } });
    expect(next.status).toBe(200);
    expect(((await next.json()) as Record<string, any>)).toMatchObject({ stage: "draft", step: "screenshots", version: { version: "1.3", firstVersion: false, done: true }, submission: { liveVersion: "1.2" } });
    expect(sent("POST", "/v1/appStoreVersions")[0].attributes).toEqual({ platform: "IOS", versionString: "1.3", copyright: "2026 George" });
    expect(sent("POST", "/v1/appStoreVersionLocalizations").at(-1)!.attributes).toMatchObject({ whatsNew: "Bigger chip numbers" });
    expect((await page()).release!.appStore.ios).toBe(`https://apps.apple.com/app/id${APPLE_APP}`);
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string }[] };
    expect(log.events.map((e) => e.event)).toEqual(expect.arrayContaining(["app-store-submitted", "app-store-released", "app-store-screenshots-uploaded"]));
  });

  it("releases automatically by default, and holds an unlisted app until Apple grants unlisted distribution", async () => {
    await prepare({ ...APP_INFO, listing: "unlisted" });
    expect(f.reviewDetails[0].attributes.notes).toBe("Shared with the people we work with through ourapps.app. No sign-in is needed to use the app.\n\nThis app is intended for unlisted distribution.");
    expect((await call("POST", `${base()}/submit`)).status).toBe(200);
    expect(sent("PATCH", "/v1/appStoreVersions/ver-1").at(-1)!.attributes).toEqual({ releaseType: "MANUAL" });
    f.versions[0].appVersionState = "PENDING_DEVELOPER_RELEASE";
    await tickAppStore(env, d);
    const held = await call("POST", `${base()}/release`);
    expect(held.status).toBe(409);
    expect(((await held.json()) as { error: string }).error).toMatch(/^Apple has not granted unlisted distribution yet/);
    expect((await call("PUT", base(), { unlistedGranted: true })).status).toBe(200);
    expect(((await (await call("POST", `${base()}/release`)).json()) as Record<string, any>)).toMatchObject({ stage: "releasing", appInfo: { listing: "unlisted" } });

    // A public app goes on the store when Apple approves it, unless the developer chooses otherwise.
    await clearStore();
    await prepare();
    expect((await call("POST", `${base()}/submit`)).status).toBe(200);
    expect(sent("PATCH", "/v1/appStoreVersions/ver-1").at(-1)!.attributes).toEqual({ releaseType: "AFTER_APPROVAL" });
  });

  it("follows Apple TV separately, with its own screenshots", async () => {
    f.versions.push({ id: "ver-tv", versionString: "1.0", appVersionState: "PREPARE_FOR_SUBMISSION", platform: "TV_OS" });
    expect((await call("PUT", `/api/dev/apps/${appId}/appstore/tvos`, { version: { ...VERSION, version: "1.0" } })).status).toBe(200);
    expect(sent("PATCH", "/v1/appStoreVersions/ver-tv")[0].attributes).toEqual({ copyright: "2026 George" });
    const shots = (await (await call("POST", `/api/dev/apps/${appId}/appstore/tvos/screenshots`)).json()) as Record<string, any>;
    expect(shots.screenshots).toMatchObject({ done: true, missing: [], required: [{ label: "Apple TV", displayTypes: [{ id: "APP_APPLE_TV", uploaded: 1 }] }] });
    expect(sent("POST", "/v1/appScreenshots")[0].attributes).toEqual({ fileName: "app_apple_tv-1.jpg", fileSize: 23 });
    expect((await view()).version.done).toBe(false);
  });
});

async function clearStore() {
  await env.DB.prepare("DELETE FROM app_store_versions").run();
  await env.DB.prepare("DELETE FROM app_store_apps").run();
  f.versions = [{ id: "ver-1", versionString: "1.0", appVersionState: "PREPARE_FOR_SUBMISSION", platform: "IOS" }];
  Object.assign(f, { localizations: [], reviewDetails: [], sets: [], shots: [], submissions: [] });
  stub.seen.length = 0;
}
