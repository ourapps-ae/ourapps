// App Store review: takes a TestFlight build of an app to Apple's App Review and onto the App Store, per Apple
// platform, with the developer's own App Store Connect key. The developer's answers are saved here and written to
// Apple step by step; the ten-minute schedule follows each submitted version until it is on the store.
import {
  AGE_RATING_FREQUENCY, AGE_RATING_LEVELS, AGE_RATING_YES_NO, APP_STORE_CATEGORIES, FALLBACK_SCREENSHOT_GROUPS, POLICY_COLLECTS, POLICY_STORAGE,
  ageRatingAnswers, groupFor, requiredScreenshots, sizeText, type AgeRatingAnswers, type AppManifest, type ScreenshotGroup,
} from "@my/store-shared";
import { AppleClient, AppleError, type UploadOperation } from "./apple.js";
import type { ApplePlatform } from "./apple-platform.js";
import { screenshotGroups } from "./asset-library.js";
import { audit } from "./audit.js";
import { randomId } from "./crypto.js";
import { Db, type AppRow, type AppStoreAppRow, type AppStoreDraft, type AppStoreVersionRow, type DefaultPolicy, type Developer, type ReleaseType, type ScreenshotState, type TestflightBuildRow } from "./db.js";
import type { Deps, Env } from "./env.js";
import { appleClient } from "./flow.js";
import { HttpError, httpsUrlOrEmpty } from "./http.js";
import { imageInfo } from "./image.js";
import { loadSecrets } from "./secrets.js";
import { requireTarget, TargetDisabledError } from "./targets.js";
import { reviewContact } from "./testflight.js";
import { fetchUpstream, loadManifest } from "./upstream.js";

export const UNLISTED_REQUEST = "https://developer.apple.com/support/unlisted-app-distribution/";
// Apple asks for this in the review notes of an app meant for unlisted distribution.
export const UNLISTED_NOTE = "This app is intended for unlisted distribution.";
const DEFAULT_NOTES = "Shared with the people we work with through ourapps.app. No sign-in is needed to use the app.";
// What one screenshots request may do: outbound calls (the Workers free plan allows 50) and image bytes held and sent,
// which cost CPU time against the free plan's 10 ms. At least one image is handled per request.
export const SCREENSHOT_CALLS = 40;
export const SCREENSHOT_BYTES = 2_000_000;

export const storeUrl = (appleAppId: string) => `https://apps.apple.com/app/id${appleAppId}`;
const connectUrl = (appleAppId: string, page = "") => `https://appstoreconnect.apple.com/apps/${appleAppId}/distribution${page}`;
const PLATFORM_NAMES: Record<ApplePlatform, string> = { ios: "iPhone and iPad", macos: "Mac", tvos: "Apple TV" };

export const STEPS = ["app-info", "privacy", "version", "screenshots", "review", "build", "submit"] as const;
export type AppStoreStep = typeof STEPS[number];
const STEP_NAMES: Record<AppStoreStep, string> = {
  "app-info": "App information",
  privacy: "App privacy answers",
  version: "Version text",
  screenshots: "Screenshots",
  review: "Review contact and notes",
  build: "The build",
  submit: "Submit",
};

// Versions whose text Apple still lets the developer change, and versions that have been on the store.
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const LIVE = new Set(["READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION"]);
const FOLLOWED = new Set(["waiting", "in-review", "rejected", "pending-release", "releasing"]);

// Apple's appVersionState to the stage the console shows.
const STAGE_OF: Record<string, AppStoreVersionRow["stage"]> = {
  READY_FOR_REVIEW: "waiting",
  WAITING_FOR_REVIEW: "waiting",
  WAITING_FOR_EXPORT_COMPLIANCE: "waiting",
  IN_REVIEW: "in-review",
  REJECTED: "rejected",
  METADATA_REJECTED: "rejected",
  INVALID_BINARY: "rejected",
  PENDING_DEVELOPER_RELEASE: "pending-release",
  ACCEPTED: "releasing",
  PENDING_APPLE_RELEASE: "releasing",
  PROCESSING_FOR_DISTRIBUTION: "releasing",
  READY_FOR_DISTRIBUTION: "ready",
  REPLACED_WITH_NEW_VERSION: "ready",
  DEVELOPER_REJECTED: "draft",
};

// What Apple's answers mean for the developer, in plain words.
export function appStoreProblem(err: unknown): string {
  if (err instanceof AppleError) {
    if (err.status === 401) return "Apple did not accept your App Store Connect key. Check the issuer ID, key ID and private key in Settings.";
    if (err.status === 403 && /agreement/i.test(`${err.code} ${err.detail}`)) return "Apple needs the account holder to accept the latest agreement in App Store Connect, under Business, first.";
    if (err.status === 403) return "Your App Store Connect key does not allow this. App Store review needs a key with the App Manager or Admin role: make one in App Store Connect, Users and Access, Integrations, and save it in Settings.";
    return `Apple did not accept this: ${err.detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function requireReady(env: Env, app: AppRow): Promise<void> {
  await requireTarget(env, app);
  if (!app.ascAppId) throw new HttpError(409, "Set up TestFlight for this platform first; App Store review takes a TestFlight build.");
}

function defaultKeywords(app: AppRow): string {
  const out: string[] = [];
  for (const word of [app.name.trim(), ...app.tagline.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)]) {
    if (word && !out.includes(word) && [...out, word].join(",").length <= 100) out.push(word);
  }
  return out.join(",");
}

// Builds Apple has processed for this platform, newest first, that have not expired.
function processedBuilds(builds: TestflightBuildRow[], now: Date): TestflightBuildRow[] {
  return builds.filter((b) => b.buildId && ["in-review", "approved", "open"].includes(b.state) && (!b.expiresAt || Date.parse(b.expiresAt) > now.getTime()));
}

function defaultDraft(app: AppRow, dev: Developer, builds: TestflightBuildRow[], now: Date): AppStoreDraft {
  const latest = processedBuilds(builds, now)[0];
  const contact = reviewContact(dev);
  return {
    version: latest?.version ?? "1.0",
    description: app.description || app.tagline || app.name,
    keywords: defaultKeywords(app),
    supportUrl: "",
    copyright: `${now.getUTCFullYear()} ${dev.displayName}`,
    whatsNew: latest?.whatsNew || app.whatsNew || "",
    review: { firstName: contact?.firstName ?? "", lastName: contact?.lastName ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", notes: DEFAULT_NOTES },
    buildNumber: null,
  };
}

async function loadState(env: Env, deps: Deps, dev: Developer, app: AppRow, builds: TestflightBuildRow[]): Promise<{ info: AppStoreAppRow; v: AppStoreVersionRow }> {
  const db = Db.from(env);
  const now = deps.now();
  const info: AppStoreAppRow = (await db.appStoreApp(app.id)) ?? { appId: app.id, listing: "public", unlistedGrantedAt: null, info: null, policyId: null, policy: null, privacyConfirmedAt: null, infoSyncedTo: null, updatedAt: now.toISOString() };
  const v: AppStoreVersionRow = (await db.appStoreVersion(app.id, app.platform ?? "ios")) ?? {
    appId: app.id, platform: app.platform ?? "ios", draft: defaultDraft(app, dev, builds, now), synced: {}, screenshots: null, errors: {}, appleAppId: app.ascAppId ?? null,
    appleVersionId: null, submissionId: null, stage: "draft", appleState: null, releaseType: "AFTER_APPROVAL", message: null, liveVersion: null, submittedAt: null, checkedAt: null, releasedAt: null, updatedAt: now.toISOString(),
  };
  return { info, v };
}

async function save(env: Env, deps: Deps, info: AppStoreAppRow, v: AppStoreVersionRow): Promise<void> {
  const db = Db.from(env);
  info.updatedAt = v.updatedAt = deps.now().toISOString();
  await db.putAppStoreApp(info);
  await db.putAppStoreVersion(v);
}

function screenshotSummary(v: AppStoreVersionRow, platform: ApplePlatform) {
  const s = v.screenshots && v.screenshots.version === v.draft.version ? v.screenshots : null;
  const groups = s?.groups ?? FALLBACK_SCREENSHOT_GROUPS;
  const required = requiredScreenshots(groups, platform, s?.runsOnIpad ?? platform === "ios");
  const placed = (group: string) => s?.items.filter((i) => i.done && !i.error && i.group === group).length ?? 0;
  const group = (id: string) => groups.find((g) => g.id === id)!;
  const missing = required.filter((r) => !r.groups.some((id) => placed(id) > 0)).map((r) => {
    const either = r.groups.some((id) => group(id).turnable) ? " (upright or turned)" : "";
    return `${r.label} is missing: add a screenshot of ${r.groups.map((id) => sizeText(group(id))).join(", or ") || "a size Apple lists"} pixels${either}.`;
  });
  const pending = s?.items.filter((i) => !i.done).length ?? 0;
  return {
    required: required.map((r) => ({ label: r.label, groups: r.groups.map((id) => ({ id, label: group(id).label, sizes: sizeText(group(id)), uploaded: placed(id) })) })),
    missing,
    pending,
    started: Boolean(s),
    // Screenshots Apple is still processing; the step is done once Apple has processed them all.
    processing: s && pending === 0 && !s.checked ? s.processing : 0,
    checked: Boolean(s?.checked),
    items: (s?.items ?? []).map((i) => ({ url: i.url, group: i.group, width: i.width ?? null, height: i.height ?? null, uploaded: i.done && !i.error && Boolean(i.placementId), error: i.error ?? null })),
    done: Boolean(s) && pending === 0 && missing.length === 0 && s!.checked,
  };
}

function stepsDone(info: AppStoreAppRow, v: AppStoreVersionRow, appleAppId: string | null): Record<AppStoreStep, boolean> {
  return {
    "app-info": Boolean(info.info && appleAppId && info.infoSyncedTo === appleAppId && !v.errors["app-info"]),
    privacy: Boolean(info.privacyConfirmedAt),
    version: v.synced.version === v.draft.version && !v.errors.version,
    screenshots: screenshotSummary(v, v.platform).done,
    review: v.synced.review === v.draft.version && !v.errors.review,
    build: Boolean(v.synced.buildId && v.draft.buildNumber && !v.errors.build),
    submit: v.stage !== "draft" && v.stage !== "rejected",
  };
}

// Where App Store review stands for the app on one platform; the console's step list and agents read it.
export async function appStoreView(env: Env, deps: Deps, dev: Developer, app: AppRow, refresh = false) {
  const platform = app.platform ?? "ios";
  const now = deps.now();
  const builds = await Db.from(env).testflightBuilds(app.id, 30, platform);
  const { info, v } = await loadState(env, deps, dev, app, builds);
  if (refresh && v.appleVersionId && FOLLOWED.has(v.stage) && (!v.checkedAt || now.getTime() - Date.parse(v.checkedAt) >= 60_000)) {
    try {
      const apple = appleClient(env, deps, await loadSecrets(env, app.developerId, ["appleIssuerId", "appleKeyId", "applePrivateKey"]));
      await followVersion(apple, v, now.toISOString());
      await save(env, deps, info, v);
    } catch (err) {
      console.error(`app store ${app.id} ${platform}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const appleAppId = app.ascAppId ?? null;
  const done = stepsDone(info, v, appleAppId);
  const editing = v.stage === "draft" || v.stage === "rejected";
  const candidates = processedBuilds(builds, now).filter((b) => b.version === v.draft.version);
  const policyUrl = info.policyId && info.policy ? `${env.PUBLIC_ORIGIN}/privacy/${info.policyId}` : null;
  const { review, buildNumber, ...text } = v.draft;
  return {
    platform,
    setUp: Boolean(appleAppId),
    needs: appleAppId ? null : "testflight",
    appleAppId,
    storeUrl: appleAppId ? storeUrl(appleAppId) : null,
    links: appleAppId ? { appPrivacy: connectUrl(appleAppId, "/privacy"), appReview: connectUrl(appleAppId, `/reviewsubmissions${v.submissionId ? `/details/${v.submissionId}` : ""}`), unlistedRequest: UNLISTED_REQUEST } : null,
    step: editing && appleAppId ? STEPS.find((s) => !done[s]) ?? null : null,
    stage: v.stage,
    appInfo: {
      listing: info.listing,
      unlistedGrantedAt: info.unlistedGrantedAt,
      category: info.info?.category ?? "",
      ageRating: info.info?.ageRating ?? ageRatingAnswers(),
      thirdPartyContent: info.info?.thirdPartyContent ?? false,
      privacyPolicyUrl: info.info?.privacyPolicyUrl ?? "",
      defaultPolicy: { url: info.info && !info.info.privacyPolicyUrl ? policyUrl : null, ...(info.policy ?? { collects: [], storage: "device", contactEmail: dev.reviewEmail ?? "", developerName: dev.displayName }) },
      done: done["app-info"],
      error: v.errors["app-info"] ?? null,
    },
    privacy: { confirmedAt: info.privacyConfirmedAt, done: done.privacy },
    version: { ...text, firstVersion: v.synced.firstVersion ?? !v.liveVersion, suggested: processedBuilds(builds, now)[0]?.version ?? null, done: done.version, error: v.errors.version ?? null },
    screenshots: { ...screenshotSummary(v, platform), error: v.errors.screenshots ?? null },
    review: { ...review, done: done.review, error: v.errors.review ?? null },
    build: { buildNumber: buildNumber ?? candidates[0]?.buildNumber ?? null, candidates: candidates.map((b) => ({ version: b.version, buildNumber: b.buildNumber, expiresAt: b.expiresAt ?? null })), done: done.build, error: v.errors.build ?? null },
    submission: {
      releaseType: v.releaseType,
      appleState: v.appleState,
      message: v.message,
      liveVersion: v.liveVersion,
      submittedAt: v.submittedAt,
      checkedAt: v.checkedAt,
      releasedAt: v.releasedAt,
      error: v.errors.submit ?? v.errors.release ?? v.errors.follow ?? null,
    },
  };
}

// Request parsing: every section is checked before anything is written to Apple.

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(o: Obj, key: string, max: number, fallback = "", required = true): string {
  const value = o[key] === undefined ? fallback : o[key];
  if (typeof value !== "string") throw new HttpError(400, `${key} must be text`);
  const out = value.trim();
  if (out.length > max) throw new HttpError(400, `${key} is longer than Apple takes (${max} characters)`);
  if (required && !out) throw new HttpError(400, `${key} is required`);
  return out;
}

function parseAppInfo(input: unknown, current: AppStoreAppRow, dev: Developer): Pick<AppStoreAppRow, "listing" | "info" | "policy"> {
  if (!isObj(input)) throw new HttpError(400, "appInfo must be an object");
  const listing = input.listing ?? current.listing;
  if (listing !== "public" && listing !== "unlisted") throw new HttpError(400, "listing must be public or unlisted");
  const category = input.category ?? current.info?.category;
  if (typeof category !== "string" || !(category in APP_STORE_CATEGORIES)) throw new HttpError(400, `category must be one of ${Object.keys(APP_STORE_CATEGORIES).join(", ")}`);
  const answers = input.ageRating ?? current.info?.ageRating ?? {};
  if (!isObj(answers)) throw new HttpError(400, "ageRating must be an object");
  for (const [key, value] of Object.entries(answers)) {
    if (key in AGE_RATING_FREQUENCY ? !AGE_RATING_LEVELS.includes(value as never) : key in AGE_RATING_YES_NO ? typeof value !== "boolean" : true) {
      throw new HttpError(400, `ageRating.${key} must be ${key in AGE_RATING_YES_NO ? "true or false" : key in AGE_RATING_FREQUENCY ? AGE_RATING_LEVELS.join(", ") : "one of Apple's age rating questions"}`);
    }
  }
  const thirdPartyContent = input.thirdPartyContent ?? current.info?.thirdPartyContent ?? false;
  if (typeof thirdPartyContent !== "boolean") throw new HttpError(400, "thirdPartyContent must be true or false");
  const privacyPolicyUrl = httpsUrlOrEmpty(input.privacyPolicyUrl ?? current.info?.privacyPolicyUrl ?? "");
  const policy = privacyPolicyUrl ? null : parseDefaultPolicy(input.defaultPolicy ?? current.policy, dev);
  return { listing, info: { category, ageRating: ageRatingAnswers(answers as Partial<AgeRatingAnswers>), thirdPartyContent, privacyPolicyUrl }, policy };
}

// The answers the default privacy policy is written from; Google Play's App content step takes the same ones.
export function parseDefaultPolicy(p: unknown, dev: Developer): DefaultPolicy {
  if (!isObj(p)) throw new HttpError(400, "give privacyPolicyUrl, or defaultPolicy for the policy ourapps writes");
  const collects = p.collects;
  if (!Array.isArray(collects) || collects.length === 0 || collects.some((c) => typeof c !== "string" || !(c in POLICY_COLLECTS)) || new Set(collects).size !== collects.length) {
    throw new HttpError(400, `defaultPolicy.collects must list one or more of ${Object.keys(POLICY_COLLECTS).join(", ")}`);
  }
  if (collects.includes("nothing") && collects.length > 1) throw new HttpError(400, "defaultPolicy.collects cannot be nothing and something else");
  const storage = p.storage ?? "device";
  if (typeof storage !== "string" || !(storage in POLICY_STORAGE)) throw new HttpError(400, `defaultPolicy.storage must be ${Object.keys(POLICY_STORAGE).join(" or ")}`);
  const contactEmail = field(p, "contactEmail", 120);
  if (!EMAIL.test(contactEmail)) throw new HttpError(400, "defaultPolicy.contactEmail must be an email address");
  return { collects: collects as string[], storage: storage as DefaultPolicy["storage"], contactEmail, developerName: field(p, "developerName", 80, dev.displayName) };
}

function parseVersion(input: unknown, draft: AppStoreDraft): Omit<AppStoreDraft, "review" | "buildNumber"> {
  if (!isObj(input)) throw new HttpError(400, "version must be an object");
  const version = field(input, "version", 20, draft.version);
  if (!/^\d+(\.\d+){0,2}$/.test(version)) throw new HttpError(400, "version must be a version number such as 1.0 or 1.2.3");
  const supportUrl = httpsUrlOrEmpty(field(input, "supportUrl", 2000, draft.supportUrl, false));
  if (!supportUrl) throw new HttpError(400, "supportUrl is required: an https address where people can reach you about the app");
  return {
    version,
    description: field(input, "description", 4000, draft.description),
    keywords: field(input, "keywords", 100, draft.keywords),
    supportUrl,
    copyright: field(input, "copyright", 200, draft.copyright),
    whatsNew: field(input, "whatsNew", 4000, draft.whatsNew, false),
  };
}

function parseReview(input: unknown, draft: AppStoreDraft): AppStoreDraft["review"] {
  if (!isObj(input)) throw new HttpError(400, "review must be an object");
  const r = draft.review;
  const out = { firstName: field(input, "firstName", 60, r.firstName), lastName: field(input, "lastName", 60, r.lastName), email: field(input, "email", 120, r.email), phone: field(input, "phone", 40, r.phone), notes: field(input, "notes", 3900, r.notes, false) };
  if (!EMAIL.test(out.email)) throw new HttpError(400, "email must be an email address");
  if (!/^\+?[0-9 ().-]{6,}$/.test(out.phone)) throw new HttpError(400, "phone must be a phone number, for example +44 7700 900123");
  return out;
}

function parseBuild(input: unknown): string {
  if (!isObj(input) || typeof input.buildNumber !== "string" || !/^[0-9][0-9.]{0,30}$/.test(input.buildNumber.trim())) throw new HttpError(400, "build must be { buildNumber } with the build number as text");
  return input.buildNumber.trim();
}

function parseBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, `${key} must be true or false`);
  return value;
}

const SECTIONS = ["appInfo", "privacyAnswered", "unlistedGranted", "version", "review", "build"] as const;

function requireEditable(v: AppStoreVersionRow): void {
  if (v.stage === "draft" || v.stage === "rejected") return;
  if (v.stage === "ready") throw new HttpError(409, `Version ${v.draft.version} is on the App Store. Save the version text with the next version number first.`);
  throw new HttpError(409, `Version ${v.draft.version} is with Apple. It can change once Apple has answered.`);
}

function requireVersionText(v: AppStoreVersionRow): void {
  if (v.synced.version !== v.draft.version || !v.appleVersionId || v.errors.version) throw new HttpError(409, "Save the version text first; this belongs to that version at Apple.");
}

// PUT /api/dev/apps/:id/appstore/:platform - saves the sections sent and writes each to Apple.
export async function saveAppStoreDetails(request: Request, env: Env, deps: Deps, dev: Developer, app: AppRow, body: unknown) {
  await requireReady(env, app);
  if (!isObj(body) || Object.keys(body).length === 0 || Object.keys(body).some((k) => !(SECTIONS as readonly string[]).includes(k))) {
    throw new HttpError(400, `Send one or more of ${SECTIONS.join(", ")}.`);
  }
  const platform = app.platform ?? "ios";
  const builds = await Db.from(env).testflightBuilds(app.id, 30, platform);
  const { info, v } = await loadState(env, deps, dev, app, builds);
  const appInfo = body.appInfo === undefined ? undefined : parseAppInfo(body.appInfo, info, dev);
  const privacyAnswered = body.privacyAnswered === undefined ? undefined : parseBoolean(body.privacyAnswered, "privacyAnswered");
  const unlistedGranted = body.unlistedGranted === undefined ? undefined : parseBoolean(body.unlistedGranted, "unlistedGranted");
  const version = body.version === undefined ? undefined : parseVersion(body.version, v.draft);
  const review = body.review === undefined ? undefined : parseReview(body.review, v.draft);
  const buildNumber = body.build === undefined ? undefined : parseBuild(body.build);
  // A new version number after the store's version starts the next draft; anything else waits for Apple's answer.
  const nextVersion = version && version.version !== v.draft.version && v.stage === "ready";
  if ((version || review || buildNumber !== undefined) && !nextVersion) requireEditable(v);
  if ((review || buildNumber !== undefined) && !version) requireVersionText(v);
  const appleAppId = app.ascAppId!;
  const now = deps.now().toISOString();
  v.appleAppId = appleAppId;
  if (privacyAnswered !== undefined) info.privacyConfirmedAt = privacyAnswered ? now : null;
  if (unlistedGranted !== undefined) info.unlistedGrantedAt = unlistedGranted ? now : null;
  let step: AppStoreStep = "app-info";
  let apple: AppleClient | null = null;
  const client = async () => (apple ??= appleClient(env, deps, await loadSecrets(env, app.developerId, ["appleIssuerId", "appleKeyId", "applePrivateKey"])));
  try {
    if (appInfo) {
      step = "app-info";
      // Google Play's App content may still name the default policy; it stays served while it does.
      if (!appInfo.policy && (await Db.from(env).googlePlayApp(app.id))?.policyUrl === "") appInfo.policy = info.policy;
      Object.assign(info, appInfo, { infoSyncedTo: null });
      if (appInfo.policy) info.policyId ??= randomId(12);
      await writeAppInfo(await client(), env, app, info);
      info.infoSyncedTo = appleAppId;
      delete v.errors["app-info"];
    }
    if (version) {
      step = "version";
      if (version.version !== v.draft.version) startVersion(v);
      Object.assign(v.draft, version);
      await writeVersion(await client(), app, v);
      delete v.errors.version;
    }
    if (review) {
      step = "review";
      v.draft.review = review;
      const notes = info.listing === "unlisted" && !review.notes.includes(UNLISTED_NOTE) ? `${review.notes}\n\n${UNLISTED_NOTE}`.trim() : review.notes;
      await (await client()).writeReviewDetail(v.appleVersionId!, { contactFirstName: review.firstName, contactLastName: review.lastName, contactEmail: review.email, contactPhone: review.phone, notes, demoAccountRequired: false });
      v.synced.review = v.draft.version;
      delete v.errors.review;
    }
    if (buildNumber !== undefined) {
      step = "build";
      v.draft.buildNumber = buildNumber;
      delete v.synced.buildId;
      const apple = await client();
      const build = await apple.findBuild(appleAppId, v.draft.version, buildNumber, platform);
      if (!build) throw new HttpError(409, `Apple has no ${PLATFORM_NAMES[platform]} build ${buildNumber} of version ${v.draft.version}.`);
      if (build.expired) throw new HttpError(409, `Build ${buildNumber} of version ${v.draft.version} has expired; choose a newer build.`);
      if (build.processingState !== "VALID") throw new HttpError(409, `Apple has not finished processing build ${buildNumber} of version ${v.draft.version} (it says ${build.processingState.toLowerCase()}).`);
      await apple.attachBuild(v.appleVersionId!, build.id);
      v.synced.buildId = build.id;
      delete v.errors.build;
    }
  } catch (err) {
    const message = appStoreProblem(err);
    v.errors[step] = message;
    await save(env, deps, info, v);
    throw new HttpError(err instanceof HttpError ? err.status : 502, message);
  }
  await save(env, deps, info, v);
  await audit(request, env, deps, dev.id, "app-store-details-saved", `${app.name} ${platform}: ${Object.keys(body).join(", ")}`);
  return appStoreView(env, deps, dev, app);
}

// A new version number: what Apple held for the previous one no longer applies; the version on the store stays.
function startVersion(v: AppStoreVersionRow): void {
  const infoError = v.errors["app-info"];
  Object.assign(v, { synced: {}, screenshots: null, appleVersionId: null, submissionId: null, stage: "draft", appleState: null, message: null, submittedAt: null, releasedAt: null, errors: infoError ? { "app-info": infoError } : {} });
  v.draft.buildNumber = null;
}

// Writes only what differs from what Apple holds, so saving the same answers again sends Apple nothing.
async function writeAppInfo(apple: AppleClient, env: Env, app: AppRow, info: AppStoreAppRow): Promise<void> {
  const appleAppId = app.ascAppId!;
  const answers = info.info!;
  const current = await apple.editableAppInfo(appleAppId);
  const settings = await apple.appSettings(appleAppId);
  if (current.category !== answers.category) await apple.setCategory(current.id, answers.category);
  const age = current.ageRating?.attributes ? current.ageRating as { id: string; attributes: Record<string, unknown> } : await apple.ageRatingDeclaration(current.id);
  const ageChanges = Object.fromEntries(Object.entries(answers.ageRating).filter(([key, value]) => age.attributes[key] !== value));
  if (Object.keys(ageChanges).length) await apple.updateAgeRating(age.id, ageChanges);
  const policyUrl = answers.privacyPolicyUrl || `${env.PUBLIC_ORIGIN}/privacy/${info.policyId}`;
  // Apple TV shows the policy's text rather than its address.
  const tv = app.platform === "tvos" || Boolean((await Db.from(env).platformApp(app, "tvos")).ascAppId);
  const policy: Record<string, string> = { privacyPolicyUrl: policyUrl };
  if (tv) policy.privacyPolicyText = info.policy && !answers.privacyPolicyUrl ? policyText(app.name, info.policy) : `The privacy policy for ${app.name} is at ${policyUrl}`;
  for (const l of current.localizations) {
    const changes = Object.fromEntries(Object.entries(policy).filter(([key, value]) => l[key as "privacyPolicyUrl" | "privacyPolicyText"] !== value));
    if (Object.keys(changes).length) await apple.updateAppInfoLocalization(l.id, changes);
  }
  if (!current.localizations.some((l) => l.locale === settings.primaryLocale)) await apple.createAppInfoLocalization(current.id, settings.primaryLocale, app.name, policy);
  const rights = answers.thirdPartyContent ? "USES_THIRD_PARTY_CONTENT" : "DOES_NOT_USE_THIRD_PARTY_CONTENT";
  if (settings.contentRightsDeclaration !== rights) await apple.setContentRights(appleAppId, rights);
  if (!(await apple.isFree(appleAppId))) await apple.makeFree(appleAppId);
  await apple.makeAvailableEverywhere(appleAppId);
}

// The App Store version for the draft's number: the one Apple has, the version still being prepared renumbered, or a new one.
async function writeVersion(apple: AppleClient, app: AppRow, v: AppStoreVersionRow): Promise<void> {
  const appleAppId = app.ascAppId!;
  const d = v.draft;
  const versions = await apple.appStoreVersions(appleAppId, v.platform);
  let target = versions.find((x) => x.versionString === d.version);
  if (target && !EDITABLE.has(target.state)) throw new HttpError(409, `Version ${d.version} is ${target.state.toLowerCase().replaceAll("_", " ")} in App Store Connect. Give this version a higher number.`);
  if (target) await apple.updateAppStoreVersion(target.id, { copyright: d.copyright });
  else {
    const editable = versions.find((x) => EDITABLE.has(x.state));
    if (editable) {
      await apple.updateAppStoreVersion(editable.id, { versionString: d.version, copyright: d.copyright });
      target = editable;
    } else target = await apple.createAppStoreVersion(appleAppId, v.platform, d.version, d.copyright);
  }
  if (v.appleVersionId && v.appleVersionId !== target.id) {
    delete v.synced.review;
    delete v.synced.buildId;
  }
  const first = !versions.some((x) => x.id !== target!.id && LIVE.has(x.state));
  const locale = await apple.primaryLocale(appleAppId);
  const localizationId = await apple.writeVersionText(target.id, locale, { description: d.description, keywords: d.keywords, supportUrl: d.supportUrl, ...(first || !d.whatsNew ? {} : { whatsNew: d.whatsNew }) });
  v.appleVersionId = target.id;
  Object.assign(v.synced, { version: d.version, localizationId, firstVersion: first });
}

// Screenshots

async function screenshotSource(env: Env, deps: Deps, app: AppRow, githubToken: string | undefined): Promise<{ urls: string[]; runsOnIpad: boolean }> {
  const platform = app.platform ?? "ios";
  let manifest: AppManifest | null = null;
  try {
    manifest = await loadManifest(env, deps, app, githubToken);
  } catch {
    manifest = null;
  }
  const list = (key: "iphone" | "ipad" | "macos" | "tvos") => (app.screenshotsByPlatform[key]?.length ? app.screenshotsByPlatform[key]! : manifest?.screenshotsByPlatform?.[key] ?? []);
  const general = app.screenshots.length ? app.screenshots : manifest?.screenshots ?? [];
  const urls = platform === "ios" ? [...list("iphone"), ...list("ipad"), ...general] : [...list(platform), ...general];
  const devices = manifest?.install.ios?.devices;
  return { urls: [...new Set(urls)].slice(0, 40), runsOnIpad: platform === "ios" && (!devices?.length || devices.includes("ipad")) };
}

async function uploadPart(deps: Deps, op: UploadOperation, bytes: Uint8Array): Promise<void> {
  if (!op.url.startsWith("https://")) throw new HttpError(502, "Apple gave an upload address that is not https; upload again.");
  const headers = new Headers();
  for (const h of op.requestHeaders ?? []) headers.set(h.name, h.value);
  const body = op.offset === 0 && op.length === bytes.length ? bytes : bytes.subarray(op.offset, op.offset + op.length);
  const res = await deps.fetch(op.url, { method: op.method, headers, body, redirect: "manual" });
  if (!res.ok) throw new HttpError(502, `Apple's upload address refused a screenshot (status ${res.status}); upload again.`);
}

// Apple's placement groups for screenshots, from its reference data; the fallback table only when that cannot be read.
async function loadGroups(apple: AppleClient): Promise<{ groups: ScreenshotGroup[]; from: "apple" | "fallback" }> {
  try {
    const groups = screenshotGroups(await apple.assetReferenceData());
    if (groups.length) return { groups, from: "apple" };
  } catch (err) {
    if (err instanceof AppleError && (err.status === 401 || err.status === 403)) throw err;
    console.error(`asset library reference data: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { groups: FALLBACK_SCREENSHOT_GROUPS, from: "fallback" };
}

// POST /api/dev/apps/:id/appstore/:platform/screenshots - checks the app's screenshots against Apple's sizes, uploads them
// to the app's asset library and places them on the version. Each request does a bounded share; while `pending` is above 0,
// or Apple is still processing them, call it again. The ten-minute schedule continues unfinished uploads too.
export async function uploadScreenshots(request: Request, env: Env, deps: Deps, dev: Developer, app: AppRow, body: { restart?: unknown }) {
  await requireReady(env, app);
  if (body.restart !== undefined && typeof body.restart !== "boolean") throw new HttpError(400, "restart must be true or false");
  const platform = app.platform ?? "ios";
  const builds = await Db.from(env).testflightBuilds(app.id, 30, platform);
  const { info, v } = await loadState(env, deps, dev, app, builds);
  requireEditable(v);
  requireVersionText(v);
  await runScreenshots(env, deps, app, info, v, { calls: SCREENSHOT_CALLS, bytes: SCREENSHOT_BYTES, restart: body.restart === true });
  const view = await appStoreView(env, deps, dev, app);
  if (view.screenshots.pending === 0 && view.screenshots.checked) await audit(request, env, deps, dev.id, "app-store-screenshots-uploaded", `${app.name} ${platform}: ${view.screenshots.items.filter((i) => i.uploaded).length} uploaded`);
  return view;
}

async function runScreenshots(env: Env, deps: Deps, app: AppRow, info: AppStoreAppRow, v: AppStoreVersionRow, limits: { calls: number; bytes: number; restart?: boolean }): Promise<void> {
  let used = 0;
  const counted: Deps = { ...deps, fetch: (input, init) => { used++; return deps.fetch(input, init); } };
  const budget = { calls: () => limits.calls - used, bytes: limits.bytes };
  try {
    const secrets = await loadSecrets(env, app.developerId, ["appleIssuerId", "appleKeyId", "applePrivateKey", "githubToken"]);
    const apple = appleClient(env, counted, secrets);
    const source = await screenshotSource(env, counted, app, secrets.githubToken);
    const key = source.urls.join("\n");
    let s: ScreenshotState | null = v.screenshots;
    if (limits.restart || !s || s.version !== v.draft.version || s.source !== key) {
      const loaded = await loadGroups(apple);
      const previous = [...(s?.previous ?? []), ...(s?.items.flatMap((i) => (i.imageId ? [i.imageId] : [])) ?? [])];
      s = { version: v.draft.version, source: key, runsOnIpad: source.runsOnIpad, items: source.urls.map((url) => ({ url, group: null, done: false })), groups: loaded.groups, groupsFrom: loaded.from, libraryId: s?.libraryId ?? null, previous, cleared: false, ordered: false, checked: false, processing: 0 };
    }
    s.runsOnIpad = source.runsOnIpad;
    v.screenshots = s;
    await placeScreenshots(apple, counted, env, secrets.githubToken, app, v, s, budget);
    delete v.errors.screenshots;
  } catch (err) {
    if (err instanceof TargetDisabledError) throw err;
    const message = appStoreProblem(err);
    v.errors.screenshots = message;
    await save(env, deps, info, v);
    throw new HttpError(err instanceof HttpError ? err.status : 502, message);
  }
  await save(env, deps, info, v);
}

async function placeScreenshots(apple: AppleClient, deps: Deps, env: Env, githubToken: string | undefined, app: AppRow, v: AppStoreVersionRow, s: ScreenshotState, budget: { calls: () => number; bytes: number }): Promise<void> {
  const platform = v.platform;
  const localizationId = v.synced.localizationId!;
  s.libraryId ??= await apple.assetLibrary(app.ascAppId!);
  // The version's earlier screenshots are replaced: their placements go first, then the images ourapps uploaded,
  // only once nothing else places them.
  if (!s.cleared) {
    for (const placement of await apple.screenshotPlacements(localizationId)) {
      if (budget.calls() < 6) return;
      await apple.deletePlacement(placement.id);
    }
    for (const imageId of [...s.previous]) {
      if (budget.calls() < 6) return;
      if (!(await apple.imageIsPlaced(imageId))) {
        try {
          await apple.deleteImage(imageId);
        } catch (err) {
          if (!(err instanceof AppleError && err.status === 404)) throw err;
        }
      }
      s.previous = s.previous.filter((id) => id !== imageId);
    }
    s.cleared = true;
  }
  let bytesUsed = 0;
  for (const [index, item] of s.items.entries()) {
    if (item.done) continue;
    if (budget.calls() < 8 || bytesUsed >= budget.bytes) return;
    const res = await fetchUpstream(env, deps, item.url, githubToken);
    if (!res.ok) {
      await res.body?.cancel();
      Object.assign(item, { done: true, error: `could not be downloaded (status ${res.status})` });
      continue;
    }
    const declared = Number(res.headers.get("Content-Length") ?? "");
    if (bytesUsed > 0 && declared > 0 && bytesUsed + declared > budget.bytes) {
      await res.body?.cancel();
      return;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    bytesUsed += bytes.length;
    const image = imageInfo(bytes);
    if (!image) {
      Object.assign(item, { done: true, error: "is not a PNG or JPEG image, which is what Apple takes" });
      continue;
    }
    Object.assign(item, { width: image.width, height: image.height });
    const found = groupFor(s.groups, platform, image.width, image.height);
    if (!found) {
      Object.assign(item, { done: true, error: `is ${image.width} x ${image.height} pixels, a size Apple does not take for ${PLATFORM_NAMES[platform]}` });
      continue;
    }
    item.group = found.group.id;
    if (image.alpha && !found.alphaAllowed) {
      Object.assign(item, { done: true, error: "has transparency, which Apple does not take; save it without an alpha channel" });
      continue;
    }
    if (s.items.filter((i) => i.done && !i.error && i.group === found.group.id).length >= found.group.maxCount) {
      Object.assign(item, { done: true, error: `is more than the ${found.group.maxCount} screenshots Apple takes for ${found.group.label}` });
      continue;
    }
    // An image reserved by an earlier request that did not finish is left for the next replacement to delete.
    if (item.imageId) s.previous.push(item.imageId);
    const reserved = await apple.reserveImage(s.libraryId, `${found.group.id.toLowerCase()}-${index + 1}.${image.type === "png" ? "png" : "jpg"}`, bytes.length, `${app.name} ${found.group.label} ${index + 1}`.slice(0, 64));
    item.imageId = reserved.id;
    for (const op of reserved.operations) await uploadPart(deps, op, bytes);
    await apple.commitImage(reserved.id);
    item.placementId = await apple.placeScreenshot(localizationId, reserved.id, found.group.id);
    item.done = true;
  }
  if (!s.ordered) {
    const groups = [...new Set(s.items.flatMap((i) => (i.placementId && i.group ? [i.group] : [])))];
    if (budget.calls() < groups.length + 1) return;
    for (const group of groups) {
      const placements = s.items.filter((i) => i.group === group && i.placementId).map((i) => i.placementId!);
      if (placements.length > 1) await apple.orderPlacements(localizationId, group, placements);
    }
    s.ordered = true;
  }
  if (s.checked || budget.calls() < 1) return;
  // Apple processes each image after it is committed; a failure there is shown on the screenshot.
  const placed = await apple.screenshotPlacements(localizationId);
  let processing = 0;
  for (const item of s.items) {
    const placement = placed.find((p) => p.id === item.placementId);
    if (!item.placementId || !placement) continue;
    if (placement.imageState === "FAILED" || placement.state === "FAILED") item.error = `was not accepted by Apple: ${placement.imageDetails.join("; ") || "no reason given"}`;
    else if (placement.imageState === "AWAITING_UPLOAD" || placement.imageState === "UPLOAD_COMPLETE" || placement.state === "ASSET_PROCESSING") processing++;
  }
  s.processing = processing;
  s.checked = processing === 0;
}

// Submit and release

// POST /api/dev/apps/:id/appstore/:platform/submit - sends the version with its build to App Review.
export async function submitAppStore(request: Request, env: Env, deps: Deps, dev: Developer, app: AppRow, body: { releaseType?: unknown }) {
  await requireReady(env, app);
  if (body.releaseType !== undefined && body.releaseType !== "AFTER_APPROVAL" && body.releaseType !== "MANUAL") throw new HttpError(400, "releaseType must be AFTER_APPROVAL or MANUAL");
  const platform = app.platform ?? "ios";
  const builds = await Db.from(env).testflightBuilds(app.id, 30, platform);
  const { info, v } = await loadState(env, deps, dev, app, builds);
  requireEditable(v);
  const done = stepsDone(info, v, app.ascAppId!);
  const open = STEPS.filter((s) => s !== "submit" && !done[s]);
  if (open.length) throw new HttpError(409, `Finish these steps first: ${open.map((s) => STEP_NAMES[s]).join(", ")}.`);
  // An unlisted app waits for Apple's grant before it goes on the store, so it is released by hand.
  const releaseType: ReleaseType = info.listing === "unlisted" && !info.unlistedGrantedAt ? "MANUAL" : (body.releaseType as ReleaseType | undefined) ?? "AFTER_APPROVAL";
  const appleAppId = app.ascAppId!;
  const versionId = v.appleVersionId!;
  try {
    const apple = appleClient(env, deps, await loadSecrets(env, app.developerId, ["appleIssuerId", "appleKeyId", "applePrivateKey"]));
    await apple.updateAppStoreVersion(versionId, { releaseType });
    const existing = await apple.openReviewSubmission(appleAppId, platform);
    const submissionId = existing?.id ?? (await apple.createReviewSubmission(appleAppId, platform));
    if (existing?.versionId !== versionId) await apple.addToReviewSubmission(submissionId, versionId);
    await apple.submitReviewSubmission(submissionId);
    v.submissionId = submissionId;
  } catch (err) {
    const message = appStoreProblem(err);
    v.errors.submit = message;
    await save(env, deps, info, v);
    throw new HttpError(err instanceof HttpError ? err.status : 502, message);
  }
  const now = deps.now().toISOString();
  Object.assign(v, { stage: "waiting", appleState: "WAITING_FOR_REVIEW", releaseType, submittedAt: now, checkedAt: now, releasedAt: null, message: null });
  delete v.errors.submit;
  delete v.errors.follow;
  await save(env, deps, info, v);
  await audit(request, env, deps, dev.id, "app-store-submitted", `${app.name} ${platform} ${v.draft.version} (${releaseType === "MANUAL" ? "release by hand" : "release when approved"})`);
  return appStoreView(env, deps, dev, app);
}

// POST /api/dev/apps/:id/appstore/:platform/release - the Release button for a version Apple approved.
export async function releaseAppStore(request: Request, env: Env, deps: Deps, dev: Developer, app: AppRow) {
  await requireReady(env, app);
  const platform = app.platform ?? "ios";
  const { info, v } = await loadState(env, deps, dev, app, []);
  if (v.stage !== "pending-release" || !v.appleVersionId) throw new HttpError(409, "Release is for a version Apple has approved and is waiting for you to release.");
  if (info.listing === "unlisted" && !info.unlistedGrantedAt) throw new HttpError(409, "Apple has not granted unlisted distribution yet. Mark it granted once Apple's email arrives, or make the listing public.");
  try {
    const apple = appleClient(env, deps, await loadSecrets(env, app.developerId, ["appleIssuerId", "appleKeyId", "applePrivateKey"]));
    await apple.releaseVersion(v.appleVersionId);
  } catch (err) {
    const message = appStoreProblem(err);
    v.errors.release = message;
    await save(env, deps, info, v);
    throw new HttpError(err instanceof HttpError ? err.status : 502, message);
  }
  const now = deps.now().toISOString();
  Object.assign(v, { stage: "releasing", releasedAt: now, checkedAt: now });
  delete v.errors.release;
  await save(env, deps, info, v);
  await audit(request, env, deps, dev.id, "app-store-released", `${app.name} ${platform} ${v.draft.version}`);
  return appStoreView(env, deps, dev, app);
}

// Following the review

const STAGE_MESSAGES: Partial<Record<string, string>> = {
  REJECTED: "Apple's App Review did not approve this version. Apple's messages are in App Store Connect, under App Review. Fix what Apple asks for, then submit again.",
  METADATA_REJECTED: "Apple's App Review asks for changes to the App Store text or screenshots. Apple's messages are in App Store Connect, under App Review. Change them here, then submit again.",
  INVALID_BINARY: "Apple found a problem with the build. Choose another build, then submit again.",
  DEVELOPER_REJECTED: "This version was taken out of review in App Store Connect. Submit again when ready.",
  WAITING_FOR_EXPORT_COMPLIANCE: "Apple is waiting for the build's export compliance answer in App Store Connect.",
};

async function followVersion(apple: AppleClient, v: AppStoreVersionRow, now: string): Promise<void> {
  const at = await apple.readAppStoreVersion(v.appleVersionId!);
  v.appleState = at.state;
  v.checkedAt = now;
  const stage = STAGE_OF[at.state];
  if (stage) v.stage = stage;
  if (v.stage === "ready") v.liveVersion = at.versionString || v.draft.version;
  v.message = STAGE_MESSAGES[at.state] ?? null;
  delete v.errors.follow;
}

// Run on the ten-minute schedule after TestFlight, with the outbound calls the run has left: a few submitted versions
// read from Apple, least recently checked first, then one version's unfinished screenshots.
export async function tickAppStore(env: Env, deps: Deps, calls = 45): Promise<void> {
  let used = 0;
  const counted: Deps = { ...deps, fetch: (input, init) => { used++; return deps.fetch(input, init); } };
  const db = Db.from(env);
  const clients = new Map<string, AppleClient>();
  for (const v of await db.followedAppStoreVersions(4)) {
    if (calls - used < 2) return;
    try {
      const app = await db.appById(v.appId);
      if (!app) continue;
      if (!clients.has(app.developerId)) clients.set(app.developerId, appleClient(env, counted, await loadSecrets(env, app.developerId, ["appleIssuerId", "appleKeyId", "applePrivateKey"])));
      await followVersion(clients.get(app.developerId)!, v, deps.now().toISOString());
    } catch (err) {
      v.checkedAt = deps.now().toISOString();
      v.errors.follow = `Could not check with Apple: ${appStoreProblem(err)}`;
      console.error(`app store ${v.appId} ${v.platform}: ${err instanceof Error ? err.message : String(err)}`);
    }
    v.updatedAt = deps.now().toISOString();
    await db.putAppStoreVersion(v);
  }
  const left = calls - used;
  if (left < 12) return;
  const v = (await db.appStoreScreenshotWork()).find((row) => row.screenshots && row.screenshots.version === row.draft.version && (row.screenshots.items.some((i) => !i.done) || !row.screenshots.checked));
  if (!v) return;
  try {
    const base = await db.appById(v.appId);
    if (!base) return;
    const app = await db.platformApp(base, v.platform);
    await requireReady(env, app);
    const info = (await db.appStoreApp(v.appId))!;
    await runScreenshots(env, deps, app, info, v, { calls: Math.min(left, SCREENSHOT_CALLS), bytes: SCREENSHOT_BYTES });
  } catch (err) {
    console.error(`app store screenshots ${v.appId} ${v.platform}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The App Store page per platform, once a version is on the store.
export async function appStoreLinks(env: Env, appId: string): Promise<Record<ApplePlatform, string | null>> {
  const out: Record<ApplePlatform, string | null> = { ios: null, macos: null, tvos: null };
  for (const r of await Db.from(env).liveAppStore(appId)) out[r.platform] = storeUrl(r.appleAppId);
  return out;
}

// The default privacy policy

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function policyPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escape(title)}</title>
<style>body{font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:680px;margin:0 auto;padding:32px 20px;color:#1d1d1f;background:#fff}h1{font-size:28px;margin:0 0 16px}h2{font-size:19px;margin:28px 0 8px}footer{margin-top:40px;font-size:13px;color:#6e6e73}@media(prefers-color-scheme:dark){body{background:#111;color:#f2f2f2}footer{color:#a1a1a6}a{color:#6cb4ff}}</style>
</head><body>${body}<footer>Hosted on ourapps.app. Copyright Level N Ltd 2026.</footer></body></html>`;
}

// The policy in sections of plain text: a heading, paragraphs and a list.
function policySections(appName: string, p: DefaultPolicy): { heading: string; paragraphs: string[]; list?: string[] }[] {
  const dev = p.developerName;
  const items: Record<string, string> = { names: "names people type into the app", content: "content people create in the app", calls: "the camera and microphone, only during calls people start in the app" };
  const contact = { heading: "Contact", paragraphs: [`Questions about ${appName} or this policy: ${p.contactEmail}.`] };
  const intro = { heading: "", paragraphs: [`${dev} made ${appName} and is responsible for the app and for this policy. Level N Ltd only hosts this text on ourapps.app.`] };
  if (p.collects.includes("nothing")) return [intro, { heading: "What the app collects", paragraphs: [`${appName} collects no information about the people who use it.`] }, contact];
  const servers = p.storage === "servers";
  return [
    intro,
    { heading: "What the app collects", paragraphs: [`${appName} collects:`], list: p.collects.map((c) => items[c]) },
    { heading: "Where it is kept and how it is used", paragraphs: [servers
      ? `What the app collects is kept on servers run by ${dev}, and is used only to make the app work. It is not sold, not used for advertising and not shared with anyone else.`
      : `What the app collects stays on the device it was entered on. ${dev} does not receive it, and it is not sold, used for advertising or shared with anyone.`] },
    { heading: "Removing it", paragraphs: [servers ? `To have what is kept on ${dev}'s servers deleted, write to ${p.contactEmail}.` : "Deleting the app removes what it keeps on the device."] },
    contact,
  ];
}

// The text Apple TV shows in place of a policy address.
export function policyText(appName: string, p: DefaultPolicy): string {
  return policySections(appName, p).map((s) => [s.heading, ...s.paragraphs, ...(s.list ?? []).map((i) => `- ${i}`)].filter(Boolean).join("\n")).join("\n\n");
}

export function policyHtml(appName: string, p: DefaultPolicy, updatedAt: string): string {
  const email = escape(p.contactEmail);
  const linked = (text: string) => escape(text).replaceAll(email, `<a href="mailto:${email}">${email}</a>`);
  return [
    `<h1>${escape(appName)} privacy policy</h1>`,
    ...policySections(appName, p).map((s) => `${s.heading ? `<h2>${escape(s.heading)}</h2>` : ""}${s.paragraphs.map((t) => `<p>${linked(t)}</p>`).join("")}${s.list ? `<ul>${s.list.map((i) => `<li>${escape(i)}</li>`).join("")}</ul>` : ""}`),
    `<p>Updated ${escape(updatedAt.slice(0, 10))}.</p>`,
  ].join("");
}

// GET /privacy/:id - public and not indexed; an unknown id is a 404.
export async function privacyPage(env: Env, id: string): Promise<Response> {
  const found = /^[a-f0-9]{16,64}$/.test(id) ? await Db.from(env).privacyPolicy(id) : null;
  const headers = { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" };
  if (!found) return new Response(policyPage("Not found", "<h1>Not found</h1><p>There is no privacy policy at this address.</p>"), { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
  return new Response(policyPage(`${found.appName} privacy policy`, policyHtml(found.appName, found.policy, found.updatedAt)), { headers: { ...headers, "Cache-Control": "public, max-age=300" } });
}
