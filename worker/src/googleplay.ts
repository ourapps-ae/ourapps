// Google Play: takes an app's Android App Bundle to a Google Play track with the developer's own service account.
// The app record and App content are done by hand in Play Console; the store listing, graphics and releases go through
// the Android Publisher API's edits, and the ten-minute schedule follows each release until it is published.
import {
  LISTING_LIMITS, MAX_VERSION_CODE, PLAY_IMAGE_LABELS, PLAY_IMAGE_TYPES, PLAY_TRACK_IDS, RELEASE_NOTES_MAX, SCREENSHOT_COUNT, TRACK_LABELS,
  isGooglePlayTrack, isPackageName, playImageProblem, type AppManifest, type GooglePlayTrack, type PlayImageKind,
} from "@my/store-shared";
import { parseDefaultPolicy } from "./appstore.js";
import { audit } from "./audit.js";
import { requireSession, type AuthedDeveloper } from "./auth.js";
import { randomId } from "./crypto.js";
import { Db, type AppRow, type AppStoreAppRow, type Developer, type DeveloperSecrets, type GooglePlayApkRow, type GooglePlayAppRow, type GooglePlayGraphic, type GooglePlayGraphics, type GooglePlayListing, type GooglePlayReleaseRow, type GooglePlayStage } from "./db.js";
import type { Deps, Env } from "./env.js";
import type { PlayApk } from "./flow.js";
import { parseBuildRunMetadata, verifyBuildRun } from "./github.js";
import { fingerprint, GoogleError, GooglePlayClient, googleClient, serviceAccountEmail } from "./google.js";
import { loadHistory } from "./history.js";
import { HttpError, httpsUrlOrEmpty } from "./http.js";
import { imageInfo } from "./image.js";
import { loadSecrets } from "./secrets.js";
import { requireTarget, TargetDisabledError } from "./targets.js";
import { fetchUpstream, loadManifest } from "./upstream.js";

// What one graphics request may do, as for App Store screenshots: outbound calls and image bytes held and sent.
export const GRAPHICS_CALLS = 40;
export const GRAPHICS_BYTES = 2_000_000;
// How long Play's highest version code is trusted before a reservation reads it again.
export const PLAY_MAXIMUM_TTL_MS = 10 * 60_000;
export const TESTING_DAYS = 14;
// Versions whose generated APK one scheduled run asks Google for.
export const APKS_PER_RUN = 3;

export const playUrl = (packageName: string) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
export const testingUrl = (packageName: string) => `https://play.google.com/apps/testing/${encodeURIComponent(packageName)}`;
const LINKS = {
  console: "https://play.google.com/console",
  appContent: "https://support.google.com/googleplay/android-developer/answer/9859455",
  testingRules: "https://support.google.com/googleplay/android-developer/answer/14151465",
  signing: "https://support.google.com/googleplay/android-developer/answer/9842756",
  firstRelease: "https://support.google.com/googleplay/android-developer/answer/9859348",
  verification: "https://developer.android.com/developer-verification",
};

export const STEPS = ["app", "content", "listing", "graphics"] as const;
export type GooglePlayStep = typeof STEPS[number] | "release";
const STEP_NAMES: Record<typeof STEPS[number], string> = { app: "App record", content: "App content", listing: "Store listing", graphics: "Graphics" };

const FOLLOWED = new Set<GooglePlayStage>(["sent", "not-sent", "in-review", "approved", "draft"]);
const STAGE_OF: Record<string, GooglePlayStage> = {
  RELEASE_LIFECYCLE_STATE_DRAFT: "draft",
  RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW: "not-sent",
  RELEASE_LIFECYCLE_STATE_IN_REVIEW: "in-review",
  RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED: "approved",
  RELEASE_LIFECYCLE_STATE_NOT_APPROVED: "rejected",
  RELEASE_LIFECYCLE_STATE_PUBLISHED: "live",
};
const STAGE_MESSAGES: Partial<Record<GooglePlayStage, string>> = {
  "not-sent": "Google holds this release until you send it for review in Play Console, Publishing overview.",
  approved: "Google approved this release. Managed publishing is on for the app, so it goes live when you press Publish changes in Play Console, Publishing overview.",
  rejected: "Google's review did not approve this release. Google's reasons are in Play Console, under Policy status and in its email. Fix what Google asks for, then release again.",
  draft: "Google keeps this release as a draft. Roll it out in Play Console, on the track's page.",
};
const PRODUCTION_GATE = "A personal Google Play developer account created after 13 November 2023 can release to production only after a closed test with at least 12 testers opted in for 14 days in a row, and Google granting production access in Play Console.";

// What Google's answers mean for the developer, in plain words.
export function googlePlayProblem(err: unknown, email = "the service account", packageName = "this package"): string {
  if (err instanceof GoogleError) {
    if (err.token) return `Google did not accept the service account key (${err.detail}). Save a new JSON key for it in Settings.`;
    if (["SERVICE_DISABLED", "accessNotConfigured"].includes(err.reason) || /has not been used in project|is disabled/i.test(err.detail)) {
      return "The Google Play Android Developer API is not turned on in the service account's Google Cloud project. Turn it on in Google Cloud Console (APIs and services, Library, Google Play Android Developer API, Enable), wait a few minutes, then try again.";
    }
    if (err.status === 401) return "Google did not accept the service account. Save its JSON key again in Settings.";
    if (err.status === 404 && /package not found/i.test(err.detail)) {
      return `Google Play has no app ${packageName} that ${email} can see. Create the app in Play Console with this package name, upload its first bundle there by hand, and invite ${email} in Users and permissions with access to the app.`;
    }
    if (err.reason === "CHANGES_ALREADY_IN_REVIEW" || /changes in review/i.test(err.detail)) return "Google is reviewing earlier changes to this app. Try again once that review has finished; the Releases list on this card says when.";
    if (/only releases with status draft/i.test(err.detail)) return "Google Play takes only draft releases until the app has been rolled out once by hand: roll out the first release in Play Console (Internal testing is enough), then release again here.";
    if (err.status === 403) return `${email} has no permission for this in Play Console. In Play Console, Users and permissions, give it access to this app with Release apps to testing tracks, Release to production, and Manage store presence.`;
    return `Google Play did not accept this: ${err.detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

interface Context {
  secrets: DeveloperSecrets;
  email: string | null;
  manifest: AppManifest | null;
}

async function context(env: Env, deps: Deps, app: AppRow): Promise<Context> {
  const secrets = await loadSecrets(env, app.developerId, ["googleServiceAccount", "githubToken"]);
  let manifest: AppManifest | null = null;
  try {
    manifest = await loadManifest(env, deps, app, secrets.githubToken);
  } catch {
    manifest = null;
  }
  return { secrets, email: serviceAccountEmail(secrets.googleServiceAccount), manifest };
}

const packageOf = (app: AppRow, manifest: AppManifest | null) => app.androidPackage || manifest?.install.android?.applicationId || "";

function client(env: Env, deps: Deps, ctx: Pick<Context, "secrets">): GooglePlayClient {
  const c = googleClient(env, deps, ctx.secrets.googleServiceAccount);
  if (!c) throw new HttpError(409, "Save a Google service account key in Settings first.");
  return c;
}

async function loadState(env: Env, deps: Deps, app: AppRow): Promise<GooglePlayAppRow> {
  return (await Db.from(env).googlePlayApp(app.id)) ?? {
    appId: app.id, foundPackage: null, foundAt: null, contentConfirmedAt: null, listing: null, listingSyncedAt: null, policyUrl: null,
    graphics: null, testingLink: false, firstClosedAt: null, errors: {}, updatedAt: deps.now().toISOString(),
  };
}

async function save(env: Env, deps: Deps, state: GooglePlayAppRow): Promise<void> {
  state.updatedAt = deps.now().toISOString();
  await Db.from(env).putGooglePlayApp(state);
}

function defaultListing(app: AppRow, dev: Developer): GooglePlayListing {
  const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}.`.slice(0, max));
  return {
    title: cut(app.name, LISTING_LIMITS.title),
    shortDescription: cut(app.tagline || app.description || app.name, LISTING_LIMITS.shortDescription),
    fullDescription: cut(app.description || app.tagline || app.name, LISTING_LIMITS.fullDescription),
    contactEmail: dev.reviewEmail ?? "",
    contactWebsite: "",
    featureGraphicUrl: "",
    tabletScreenshots: [],
  };
}

// Graphics

interface Wanted { kind: PlayImageKind; url: string }

function graphicSources(app: AppRow, manifest: AppManifest | null, listing: GooglePlayListing): Wanted[] {
  const icon = app.iconUrl || manifest?.icon || "";
  const lists = [app.screenshotsByPlatform.android, manifest?.screenshotsByPlatform?.android, app.screenshots, manifest?.screenshots];
  const phones = lists.find((l) => l && l.length > 0) ?? [];
  return [
    ...(icon ? [{ kind: "icon" as const, url: icon }] : []),
    ...(listing.featureGraphicUrl ? [{ kind: "featureGraphic" as const, url: listing.featureGraphicUrl }] : []),
    ...[...new Set(phones)].map((url) => ({ kind: "phone" as const, url })),
    ...[...new Set(listing.tabletScreenshots)].map((url) => ({ kind: "tablet" as const, url })),
  ];
}

function missingGraphics(items: GooglePlayGraphic[]): string[] {
  const ok = (kind: PlayImageKind) => items.filter((i) => i.kind === kind && i.done && !i.error).length;
  const failed = (kind: PlayImageKind) => items.find((i) => i.kind === kind && i.error);
  const out: string[] = [];
  if (!ok("icon")) out.push(failed("icon") ? `The icon ${failed("icon")!.error}.` : "Add an icon: a 512 x 512 PNG, as the app's icon on this page or in my-app.json.");
  if (!ok("featureGraphic")) out.push(failed("featureGraphic") ? `The feature graphic ${failed("featureGraphic")!.error}.` : "Add a feature graphic: a 1024 x 500 JPEG or PNG without transparency, under Graphics on this card.");
  if (ok("phone") < SCREENSHOT_COUNT.min) out.push(`Add at least ${SCREENSHOT_COUNT.min} phone screenshots that Google Play takes, to the app's Android screenshot list: each side between 320 and 3840 pixels, the long side at most 2.3 times the short side, no transparency.`);
  return out;
}

function graphicsSummary(state: GooglePlayAppRow) {
  const g = state.graphics;
  const listing = state.listing;
  const items = g?.items ?? [];
  const pending = items.filter((i) => !i.done).length;
  return {
    featureGraphicUrl: listing?.featureGraphicUrl ?? "",
    tabletScreenshots: listing?.tabletScreenshots ?? [],
    started: Boolean(g),
    pending,
    committed: Boolean(g?.committed),
    missing: g && pending === 0 ? g.missing : [],
    items: items.map((i) => ({ kind: i.kind, url: i.url, width: i.width ?? null, height: i.height ?? null, uploaded: i.done && !i.error, error: i.error ?? null })),
    done: Boolean(g?.committed),
  };
}

// POST /api/dev/apps/:id/googleplay/graphics - checks the icon, feature graphic and screenshots against Google Play's
// rules and uploads them into one edit, committed once they are all in. Each request does a bounded share; while
// pending is above 0, call it again. The ten-minute schedule continues unfinished uploads too.
export async function uploadGraphics(request: Request, env: Env, deps: Deps, dev: Developer, app: AppRow, body: { restart?: unknown }) {
  await requireTarget(env, app, "android");
  if (body.restart !== undefined && typeof body.restart !== "boolean") throw new HttpError(400, "restart must be true or false");
  const ctx = await context(env, deps, app);
  const state = await loadState(env, deps, app);
  const packageName = packageOf(app, ctx.manifest);
  if (!packageName || state.foundPackage !== packageName) throw new HttpError(409, "Check the app record with Google Play first.");
  if (!state.listing || !state.listingSyncedAt) throw new HttpError(409, "Save the store listing first; the graphics go with its language.");
  await runGraphics(env, deps, app, packageName, state, ctx, { calls: GRAPHICS_CALLS, bytes: GRAPHICS_BYTES, restart: body.restart === true });
  const view = await googlePlayView(env, deps, dev, app);
  if (view.graphics.committed) await audit(request, env, deps, dev.id, "google-play-graphics-uploaded", `${app.name}: ${view.graphics.items.filter((i) => i.uploaded).length} images`);
  return view;
}

async function runGraphics(env: Env, deps: Deps, app: AppRow, packageName: string, state: GooglePlayAppRow, ctx: Context, limits: { calls: number; bytes: number; restart?: boolean }): Promise<void> {
  let used = 0;
  const counted: Deps = { ...deps, fetch: (input, init) => { used++; return deps.fetch(input, init); } };
  try {
    await placeGraphics(env, counted, app, packageName, state, ctx, { ...limits, left: () => limits.calls - used });
    delete state.errors.graphics;
  } catch (err) {
    if (err instanceof TargetDisabledError || (err instanceof HttpError && err.status === 409)) throw err;
    const message = googlePlayProblem(err, ctx.email ?? undefined, packageName);
    state.errors.graphics = message;
    // An edit Google no longer has cannot take more images; the next request starts a new one.
    if (state.graphics && err instanceof GoogleError && (err.status === 404 || (err.status < 500 && /\bedit\b/i.test(err.detail)))) Object.assign(state.graphics, { editId: null, editExpiresAt: null });
    await save(env, deps, state);
    throw new HttpError(err instanceof HttpError ? err.status : 502, message);
  }
  await save(env, deps, state);
}

async function placeGraphics(env: Env, deps: Deps, app: AppRow, packageName: string, state: GooglePlayAppRow, ctx: Context, limits: { bytes: number; restart?: boolean; left: () => number }): Promise<void> {
  const google = client(env, deps, ctx);
  const wanted = graphicSources(app, ctx.manifest, state.listing!);
  const source = JSON.stringify(wanted);
  let g: GooglePlayGraphics | null = state.graphics;
  if (limits.restart || !g || g.source !== source) {
    g = { source, items: wanted.map((w) => ({ ...w, done: false })), editId: null, editExpiresAt: null, cleared: [], committed: false, missing: [] };
  }
  state.graphics = g;
  if (g.committed) return;
  const language = state.listing!.language ?? "en-US";
  // Images uploaded into an edit that expired are gone with it, so they go again into a new one.
  if (!g.editId || (g.editExpiresAt !== null && g.editExpiresAt < deps.now().getTime() + 5 * 60_000)) {
    if (limits.left() < 3) return;
    const edit = await google.insertEdit(packageName);
    Object.assign(g, { editId: edit.id, editExpiresAt: edit.expiresAt, cleared: [] });
    for (const item of g.items) if (item.done && !item.error) item.done = false;
  }
  const editId = g.editId!;
  // The listing's earlier images of each kind ourapps uploads are replaced; kinds it does not upload are left alone.
  for (const type of [...new Set(g.items.map((i) => PLAY_IMAGE_TYPES[i.kind]))]) {
    if (g.cleared.includes(type)) continue;
    if (limits.left() < 3) return;
    await google.deleteAllImages(packageName, editId, language, type);
    g.cleared.push(type);
  }
  let bytesUsed = 0;
  for (const item of g.items) {
    if (item.done) continue;
    if (limits.left() < 3 || bytesUsed >= limits.bytes) return;
    const count = g.items.filter((i) => i.kind === item.kind && i.done && !i.error).length;
    if ((item.kind === "phone" || item.kind === "tablet") && count >= SCREENSHOT_COUNT.max) {
      Object.assign(item, { done: true, error: `is more than the ${SCREENSHOT_COUNT.max} ${PLAY_IMAGE_LABELS[item.kind].toLowerCase()}s Google Play takes` });
      continue;
    }
    const res = await fetchUpstream(env, deps, item.url, ctx.secrets.githubToken);
    if (!res.ok) {
      await res.body?.cancel();
      Object.assign(item, { done: true, error: `could not be downloaded (status ${res.status})` });
      continue;
    }
    const declared = Number(res.headers.get("Content-Length") ?? "");
    if (bytesUsed > 0 && declared > 0 && bytesUsed + declared > limits.bytes) {
      await res.body?.cancel();
      return;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    bytesUsed += bytes.length;
    const image = imageInfo(bytes);
    if (!image) {
      Object.assign(item, { done: true, error: "is not a PNG or JPEG image, which is what Google Play takes" });
      continue;
    }
    Object.assign(item, { width: image.width, height: image.height });
    const problem = playImageProblem(item.kind, { ...image, bytes: bytes.length });
    if (problem) {
      Object.assign(item, { done: true, error: problem });
      continue;
    }
    await google.uploadImage(packageName, editId, language, PLAY_IMAGE_TYPES[item.kind], bytes, image.type === "png" ? "image/png" : "image/jpeg");
    item.done = true;
  }
  g.missing = missingGraphics(g.items);
  if (g.missing.length || limits.left() < 1) return;
  await google.commitEdit(packageName, editId, false);
  Object.assign(g, { committed: true, editId: null, editExpiresAt: null });
}

// The view

function stepsDone(state: GooglePlayAppRow, packageName: string, policyServed: boolean): Record<typeof STEPS[number], boolean> {
  return {
    app: Boolean(packageName && state.foundPackage === packageName && !state.errors.app),
    content: Boolean(state.contentConfirmedAt && state.policyUrl !== null && (state.policyUrl !== "" || policyServed)),
    listing: Boolean(state.listing && state.listingSyncedAt && !state.errors.listing),
    graphics: Boolean(state.graphics?.committed),
  };
}

function releaseView(r: GooglePlayReleaseRow) {
  return { track: r.track, version: r.version, versionCode: r.versionCode, status: r.status, userFraction: r.userFraction, stage: r.stage, googleState: r.googleState, message: r.message, committedAt: r.committedAt, checkedAt: r.checkedAt, liveAt: r.liveAt };
}

// Where Google Play stands for the app; the console's card and agents read it.
export async function googlePlayView(env: Env, deps: Deps, dev: Developer, app: AppRow, refresh = false) {
  const db = Db.from(env);
  const now = deps.now();
  const ctx = await context(env, deps, app);
  const state = await loadState(env, deps, app);
  const packageName = packageOf(app, ctx.manifest);
  let releases = await db.googlePlayReleases(app.id, 6);
  const followed = releases.filter((r) => FOLLOWED.has(r.stage) && (!r.checkedAt || now.getTime() - Date.parse(r.checkedAt) >= 60_000)).slice(0, 2);
  if (refresh && followed.length && packageName && ctx.email) {
    try {
      const google = client(env, deps, ctx);
      for (const r of followed) {
        await followRelease(google, packageName, r, now);
        await db.updateGooglePlayRelease(r);
      }
      releases = await db.googlePlayReleases(app.id, 6);
    } catch (err) {
      console.error(`google play ${app.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const store = await db.appStoreApp(app.id);
  const policyServed = Boolean(store?.policyId && store.policy);
  const policyUrl = state.policyUrl === "" && policyServed ? `${env.PUBLIC_ORIGIN}/privacy/${store!.policyId}` : state.policyUrl || null;
  const done = stepsDone(state, packageName, policyServed);
  const listing = state.listing ?? defaultListing(app, dev);
  const live = await db.googlePlayLive(app.id);
  const apks = await db.googlePlayApks(app.id);
  const firstClosed = state.firstClosedAt ? Date.parse(state.firstClosedAt) : null;
  const days = firstClosed === null ? null : Math.max(0, Math.floor((now.getTime() - firstClosed) / 86_400_000));
  return {
    setUp: Boolean(ctx.email),
    needs: ctx.email ? null : "service-account",
    serviceAccount: ctx.email,
    packageName: packageName || null,
    packageFrom: app.androidPackage ? "app" : packageName ? "my-app.json" : null,
    step: ctx.email ? STEPS.find((s) => !done[s]) ?? "release" : null,
    links: { ...LINKS, playPage: packageName ? playUrl(packageName) : null, testing: packageName ? testingUrl(packageName) : null },
    app: { packageName: packageName || null, foundAt: state.foundPackage === packageName ? state.foundAt : null, done: done.app, error: state.errors.app ?? null },
    content: {
      privacyPolicyUrl: state.policyUrl ?? "",
      defaultPolicy: { url: state.policyUrl === "" ? policyUrl : null, ...(store?.policy ?? { collects: [], storage: "device", contactEmail: dev.reviewEmail ?? "", developerName: dev.displayName }) },
      policyAddress: policyUrl,
      confirmedAt: state.contentConfirmedAt,
      done: done.content,
      error: state.errors.content ?? null,
    },
    listing: {
      title: listing.title, shortDescription: listing.shortDescription, fullDescription: listing.fullDescription, contactEmail: listing.contactEmail, contactWebsite: listing.contactWebsite,
      language: state.listing?.language ?? null, syncedAt: state.listingSyncedAt, done: done.listing, error: state.errors.listing ?? null,
    },
    graphics: { ...graphicsSummary(state), error: state.errors.graphics ?? null },
    release: {
      version: ctx.manifest?.version ?? null,
      bundle: Boolean(ctx.manifest?.install.android?.bundle),
      ready: STEPS.every((s) => done[s]),
      error: state.errors.release ?? null,
    },
    releases: releases.map(releaseView),
    testing: { firstClosedAt: state.firstClosedAt, days, requiredDays: TESTING_DAYS, readyAt: firstClosed === null ? null : new Date(firstClosed + TESTING_DAYS * 86_400_000).toISOString(), testingLink: state.testingLink },
    live: { production: live.production, url: live.production && packageName ? playUrl(packageName) : null },
    // The install page's Android download: Google Play's signed APK of the offered version, while a newer one waits for Google.
    apk: apks.newest
      ? {
          offered: apks.offered ? { versionCode: apks.offered.versionCode, version: apks.offered.version, certificateSha256: apks.offered.certificateSha256, foundAt: apks.offered.foundAt, error: apks.offered.error } : null,
          waiting: apks.newest.downloadId ? null : { versionCode: apks.newest.versionCode, version: apks.newest.version, checkedAt: apks.newest.checkedAt, error: apks.newest.error },
        }
      : null,
  };
}

// Request parsing: every section is checked before anything is written to Google.

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(o: Obj, key: string, max: number, fallback: string, required = true): string {
  const value = o[key] === undefined ? fallback : o[key];
  if (typeof value !== "string") throw new HttpError(400, `${key} must be text`);
  const out = value.trim();
  if (out.length > max) throw new HttpError(400, `${key} is longer than Google Play takes (${max} characters)`);
  if (required && !out) throw new HttpError(400, `${key} is required`);
  return out;
}

function parseListing(input: unknown, current: GooglePlayListing): Omit<GooglePlayListing, "featureGraphicUrl" | "tabletScreenshots"> {
  if (!isObj(input)) throw new HttpError(400, "listing must be an object");
  const out = {
    title: field(input, "title", LISTING_LIMITS.title, current.title),
    shortDescription: field(input, "shortDescription", LISTING_LIMITS.shortDescription, current.shortDescription),
    fullDescription: field(input, "fullDescription", LISTING_LIMITS.fullDescription, current.fullDescription),
    contactEmail: field(input, "contactEmail", 120, current.contactEmail),
    contactWebsite: httpsUrlOrEmpty(field(input, "contactWebsite", 2000, current.contactWebsite, false)),
  };
  if (!EMAIL.test(out.contactEmail)) throw new HttpError(400, "contactEmail must be an email address; Google Play shows it on the listing");
  return out;
}

function parseGraphics(input: unknown, current: GooglePlayListing): Pick<GooglePlayListing, "featureGraphicUrl" | "tabletScreenshots"> {
  if (!isObj(input)) throw new HttpError(400, "graphics must be an object");
  const featureGraphicUrl = httpsUrlOrEmpty(input.featureGraphicUrl ?? current.featureGraphicUrl);
  const tablets = input.tabletScreenshots ?? current.tabletScreenshots;
  if (!Array.isArray(tablets) || tablets.length > SCREENSHOT_COUNT.max) throw new HttpError(400, `tabletScreenshots must be a list of at most ${SCREENSHOT_COUNT.max} https URLs`);
  return { featureGraphicUrl, tabletScreenshots: tablets.map((u) => httpsUrlOrEmpty(u)).filter(Boolean) };
}

function parseBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, `${key} must be true or false`);
  return value;
}

const SECTIONS = ["app", "content", "contentConfirmed", "listing", "graphics", "testingLink"] as const;

// PUT /api/dev/apps/:id/googleplay - saves the sections sent; the app record is checked with Google and the listing
// written there.
export async function saveGooglePlay(request: Request, env: Env, deps: Deps, dev: Developer, app: AppRow, body: unknown) {
  await requireTarget(env, app, "android");
  if (!isObj(body) || Object.keys(body).length === 0 || Object.keys(body).some((k) => !(SECTIONS as readonly string[]).includes(k))) throw new HttpError(400, `Send one or more of ${SECTIONS.join(", ")}.`);
  const state = await loadState(env, deps, app);
  const current = state.listing ?? defaultListing(app, dev);
  let packageName: string | undefined;
  if (body.app !== undefined) {
    if (!isObj(body.app)) throw new HttpError(400, "app must be { packageName }");
    if (body.app.packageName !== undefined && !isPackageName(body.app.packageName)) throw new HttpError(400, "packageName must be an Android application ID such as com.example.pokernight");
    packageName = body.app.packageName as string | undefined;
  }
  let content: { url: string; policy: AppStoreAppRow["policy"] } | undefined;
  if (body.content !== undefined) {
    if (!isObj(body.content)) throw new HttpError(400, "content must be { privacyPolicyUrl } or { defaultPolicy }");
    const url = httpsUrlOrEmpty(body.content.privacyPolicyUrl ?? "");
    content = { url, policy: url ? null : parseDefaultPolicy(body.content.defaultPolicy, dev) };
  }
  const confirmed = body.contentConfirmed === undefined ? undefined : parseBoolean(body.contentConfirmed, "contentConfirmed");
  const listing = body.listing === undefined ? undefined : parseListing(body.listing, current);
  const graphics = body.graphics === undefined ? undefined : parseGraphics(body.graphics, current);
  const testingLink = body.testingLink === undefined ? undefined : parseBoolean(body.testingLink, "testingLink");

  const ctx = body.app !== undefined || listing ? await context(env, deps, app) : null;
  const now = deps.now().toISOString();
  if (confirmed !== undefined) state.contentConfirmedAt = confirmed ? now : null;
  if (testingLink !== undefined) state.testingLink = testingLink;
  if (graphics) state.listing = { ...current, ...state.listing, ...graphics };
  if (content) await savePolicy(env, deps, app, state, content);
  let step = "app";
  try {
    if (body.app !== undefined) {
      step = "app";
      if (packageName && packageName !== app.androidPackage) {
        app.androidPackage = packageName;
        app.updatedAt = now;
        await Db.from(env).updateApp(app);
      }
      const pkg = packageOf(app, ctx!.manifest);
      if (!pkg) throw new HttpError(400, "packageName is required: the app's Android application ID, the package name of its app in Play Console");
      state.foundPackage = null;
      const google = client(env, deps, ctx!);
      const edit = await google.insertEdit(pkg);
      await google.deleteEdit(pkg, edit.id).catch(() => undefined);
      Object.assign(state, { foundPackage: pkg, foundAt: now });
      if (app.androidPackage !== pkg) {
        app.androidPackage = pkg;
        app.updatedAt = now;
        await Db.from(env).updateApp(app);
      }
      delete state.errors.app;
    }
    if (listing) {
      step = "listing";
      const pkg = packageOf(app, ctx!.manifest);
      if (!pkg || state.foundPackage !== pkg) throw new HttpError(409, "Check the app record with Google Play first.");
      state.listing = { ...current, ...state.listing, ...listing };
      state.listingSyncedAt = null;
      const google = client(env, deps, ctx!);
      const edit = await google.insertEdit(pkg);
      let language: string;
      try {
        language = (await google.details(pkg, edit.id)).defaultLanguage || "en-US";
        await google.updateListing(pkg, edit.id, language, { title: listing.title, shortDescription: listing.shortDescription, fullDescription: listing.fullDescription });
        await google.patchDetails(pkg, edit.id, { contactEmail: listing.contactEmail, ...(listing.contactWebsite ? { contactWebsite: listing.contactWebsite } : {}) });
        await google.commitEdit(pkg, edit.id, false);
      } catch (err) {
        await google.deleteEdit(pkg, edit.id).catch(() => undefined);
        throw err;
      }
      state.listing.language = language;
      state.listingSyncedAt = now;
      delete state.errors.listing;
    }
  } catch (err) {
    const message = googlePlayProblem(err, ctx?.email ?? undefined, packageOf(app, ctx?.manifest ?? null));
    state.errors[step] = message;
    await save(env, deps, state);
    throw new HttpError(err instanceof HttpError ? err.status : 502, message);
  }
  await save(env, deps, state);
  await audit(request, env, deps, dev.id, "google-play-details-saved", `${app.name}: ${Object.keys(body).join(", ")}`);
  return googlePlayView(env, deps, dev, app);
}

// The default policy's answers live with the App Store's, served at the same /privacy address for both stores.
async function savePolicy(env: Env, deps: Deps, app: AppRow, state: GooglePlayAppRow, content: { url: string; policy: AppStoreAppRow["policy"] }): Promise<void> {
  const db = Db.from(env);
  const store = await db.appStoreApp(app.id);
  state.policyUrl = content.url;
  delete state.errors.content;
  const appStoreUsesIt = Boolean(store?.info && !store.info.privacyPolicyUrl && store.policy);
  if (!content.policy && (!store || appStoreUsesIt)) return;
  const row: AppStoreAppRow = store ?? { appId: app.id, listing: "public", unlistedGrantedAt: null, info: null, policyId: null, policy: null, privacyConfirmedAt: null, infoSyncedTo: null, updatedAt: "" };
  row.policy = content.policy;
  if (content.policy) row.policyId ??= randomId(12);
  row.updatedAt = deps.now().toISOString();
  await db.putAppStoreApp(row);
}

// The release

function parseRelease(body: Obj): { track: GooglePlayTrack; userFraction: number | null; notes: string | null } {
  const unknown = Object.keys(body).filter((k) => !["track", "userFraction", "releaseNotes"].includes(k));
  if (unknown.length) throw new HttpError(400, `Send track, and optionally userFraction and releaseNotes; not ${unknown.join(", ")}.`);
  if (!isGooglePlayTrack(body.track)) throw new HttpError(400, "track must be internal, alpha (closed testing), beta (open testing) or production");
  const fraction = body.userFraction ?? null;
  if (fraction !== null && (typeof fraction !== "number" || !(fraction > 0 && fraction < 1))) throw new HttpError(400, "userFraction must be a number between 0 and 1, for example 0.1 for a tenth of people; leave it out to release to everyone");
  const notes = body.releaseNotes ?? null;
  if (notes !== null && (typeof notes !== "string" || notes.trim().length > RELEASE_NOTES_MAX)) throw new HttpError(400, `releaseNotes must be text of at most ${RELEASE_NOTES_MAX} characters`);
  return { track: body.track, userFraction: fraction as number | null, notes: notes === null ? null : (notes as string).trim() };
}

function cutNotes(text: string): string {
  const plain = text.replace(/\r\n/g, "\n").trim();
  if (plain.length <= RELEASE_NOTES_MAX) return plain;
  return plain.slice(0, RELEASE_NOTES_MAX).replace(/\n[^\n]*$/, "").trim();
}

// POST /api/dev/apps/:id/googleplay/release - sends the latest release's Android App Bundle to a Google Play track.
// The bundle goes from the GitHub release to Google's upload session as it arrives, without being held in the Worker.
export async function releaseGooglePlay(request: Request, env: Env, deps: Deps, dev: Developer, app: AppRow, body: unknown) {
  await requireTarget(env, app, "android");
  if (!isObj(body)) throw new HttpError(400, "Send { track }, with track internal, alpha, beta or production.");
  const plan = parseRelease(body);
  const ctx = await context(env, deps, app);
  const state = await loadState(env, deps, app);
  const packageName = packageOf(app, ctx.manifest);
  const store = await Db.from(env).appStoreApp(app.id);
  const done = stepsDone(state, packageName, Boolean(store?.policyId && store.policy));
  const open = STEPS.filter((s) => !done[s]);
  if (open.length) throw new HttpError(409, `Finish these steps first: ${open.map((s) => STEP_NAMES[s]).join(", ")}.`);
  const manifest = ctx.manifest;
  if (!manifest) throw new HttpError(409, "The latest release cannot be read; the app's Latest release card says why.");
  const bundleUrl = manifest.install.android?.bundle;
  if (!bundleUrl) throw new HttpError(409, "The latest release has no Android App Bundle. The release workflow builds the .aab, uploads it with the release and names it in my-app.json as install.android.bundle.");
  let notes = plan.notes;
  if (!notes) {
    const history = await loadHistory(env, deps, app, ctx.secrets.githubToken).catch(() => []);
    notes = cutNotes(history.find((h) => h.version === manifest.version)?.notes || app.whatsNew || `Version ${manifest.version}.`);
  }
  const google = client(env, deps, ctx);
  const language = state.listing?.language ?? "en-US";
  let editId: string | null = null;
  let sentForReview = true;
  let versionCode = 0;
  try {
    const upstream = await fetchUpstream(env, deps, bundleUrl, ctx.secrets.githubToken);
    const size = Number(upstream.headers.get("Content-Length") ?? "");
    if (!upstream.ok || !upstream.body || !(size > 0)) {
      await upstream.body?.cancel();
      throw new HttpError(502, upstream.ok ? "GitHub did not say how large the bundle is; Google's upload needs its size." : `GitHub did not give the bundle (status ${upstream.status}).`);
    }
    try {
      editId = (await google.insertEdit(packageName)).id;
      const session = await google.startBundleUpload(packageName, editId, size);
      versionCode = (await google.sendBundle(session, upstream.body, size)).versionCode;
    } catch (err) {
      await upstream.body.cancel().catch(() => undefined);
      throw err;
    }
    await google.updateTrack(packageName, editId, PLAY_TRACK_IDS[plan.track], {
      name: `${manifest.version} (${versionCode})`,
      versionCodes: [String(versionCode)],
      status: plan.userFraction ? "inProgress" : "completed",
      ...(plan.userFraction ? { userFraction: plan.userFraction } : {}),
      releaseNotes: [{ language, text: notes }],
    });
    sentForReview = await google.commitEdit(packageName, editId);
  } catch (err) {
    if (editId) await google.deleteEdit(packageName, editId).catch(() => undefined);
    let message = googlePlayProblem(err, ctx.email ?? undefined, packageName);
    // Google's refusal of production for an account without production access; permission and package problems say their own cause.
    if (plan.track === "production" && err instanceof GoogleError && !err.token && (err.status === 400 || (err.status === 403 && /production/i.test(err.detail)))) message = `${message} ${PRODUCTION_GATE}`;
    state.errors.release = message;
    await save(env, deps, state);
    throw new HttpError(err instanceof HttpError ? err.status : 502, message);
  }
  const now = deps.now().toISOString();
  const db = Db.from(env);
  await db.insertGooglePlayRelease({
    appId: app.id, track: plan.track, version: manifest.version, versionCode, bundleUrl, status: plan.userFraction ? "inProgress" : "completed", userFraction: plan.userFraction,
    stage: sentForReview ? "sent" : "not-sent", googleState: null, message: sentForReview ? null : STAGE_MESSAGES["not-sent"]!, committedAt: now, checkedAt: null, liveAt: null, updatedAt: now,
  });
  await db.insertGooglePlayApk(app.id, versionCode, manifest.version, now);
  const apk = (await db.googlePlayApk(app.id, versionCode))!;
  if (!apk.downloadId) {
    // Google usually takes a few minutes to generate the APK; the ten-minute schedule asks again.
    await findApk(google, packageName, apk, deps.now()).catch(() => undefined);
    await db.updateGooglePlayApk(apk);
  }
  if (plan.track === "alpha" && !state.firstClosedAt) state.firstClosedAt = now;
  delete state.errors.release;
  await save(env, deps, state);
  await audit(request, env, deps, dev.id, "google-play-released", `${app.name} ${manifest.version} (${versionCode}) to ${TRACK_LABELS[plan.track].toLowerCase()}${plan.userFraction ? `, ${Math.round(plan.userFraction * 100)}%` : ""}`);
  return googlePlayView(env, deps, dev, app);
}

// Following releases

async function followRelease(google: GooglePlayClient, packageName: string, r: GooglePlayReleaseRow, now: Date): Promise<void> {
  const releases = await google.trackReleases(packageName, PLAY_TRACK_IDS[r.track]);
  const found = releases.find((x) => x.activeArtifacts?.some((a) => Number(a.versionCode) === r.versionCode));
  r.checkedAt = r.updatedAt = now.toISOString();
  if (!found) {
    // Google lists a committed release at once; one missing an hour later was replaced by a later release.
    if (now.getTime() - Date.parse(r.committedAt) > 60 * 60_000) Object.assign(r, { stage: "replaced", message: "Google no longer lists this release on the track; a later release took its place." });
    return;
  }
  r.googleState = found.releaseLifecycleState ?? null;
  const stage = STAGE_OF[r.googleState ?? ""];
  if (stage) r.stage = stage;
  if (r.stage === "live") r.liveAt ??= now.toISOString();
  r.message = STAGE_MESSAGES[r.stage] ?? null;
}

// Asks Google for the universal APK of a released version code and keeps its download ID once Google has generated it.
// Google answers "not found" for a version code it has not finished with, as for one it never had.
async function findApk(google: GooglePlayClient, packageName: string, a: GooglePlayApkRow, now: Date): Promise<void> {
  a.checkedAt = now.toISOString();
  let apk;
  try {
    apk = await google.universalApk(packageName, a.versionCode);
  } catch (err) {
    if (err instanceof GoogleError && err.status === 404 && !/package not found/i.test(err.detail)) apk = null;
    else throw err;
  }
  if (apk) Object.assign(a, { downloadId: apk.downloadId, certificateSha256: apk.certificateSha256 ? fingerprint(apk.certificateSha256) : null, foundAt: a.checkedAt, error: null });
  else a.error = null;
}

const APK_PREPARING = "Google Play is preparing the Android download of this version, which usually takes a few minutes. Try again shortly.";
const APK_NO_KEY = "The Android download comes from Google Play with the developer's Google service account key, which is not saved in ourapps. The developer saves it in Settings, Google Play.";

// GET /dl/<token> for Google Play's signed APK of a version code: the developer's access token, then one call to Google
// whose bytes go through as they arrive. When Google refuses, the answer says why; the workflow's APK, signed with
// another key, is never given in its place.
export async function serveGooglePlayApk(env: Env, deps: Deps, developerId: string, appId: string, versionCode: number): Promise<Response> {
  const db = Db.from(env);
  const app = await db.appById(appId);
  const a = app && app.developerId === developerId && app.androidPackage ? await db.googlePlayApk(appId, versionCode) : null;
  if (!app || !a) throw new HttpError(404, "this download is no longer offered; open the install page again");
  const google = googleClient(env, deps, (await loadSecrets(env, developerId, ["googleServiceAccount"])).googleServiceAccount);
  const before = JSON.stringify(a);
  let res: Response;
  try {
    if (!google) throw new HttpError(503, APK_NO_KEY);
    if (!a.downloadId) await findApk(google, app.androidPackage, a, deps.now());
    if (!a.downloadId) throw new HttpError(503, APK_PREPARING);
    res = await google.downloadApk(app.androidPackage, versionCode, a.downloadId);
    a.error = null;
  } catch (err) {
    if (!(err instanceof HttpError && err.message === APK_PREPARING)) {
      a.error = err instanceof HttpError ? err.message : `Google Play did not give the Android download. ${googlePlayProblem(err, google?.email, app.androidPackage)}`;
      a.checkedAt = deps.now().toISOString();
    }
    await db.updateGooglePlayApk(a);
    throw err instanceof HttpError ? err : new HttpError(502, a.error!);
  }
  if (JSON.stringify(a) !== before) await db.updateGooglePlayApk(a);
  const length = Number(res.headers.get("Content-Length") ?? "");
  let body = res.body;
  if (body && Number.isSafeInteger(length) && length > 0) {
    const fixed = new FixedLengthStream(length);
    body.pipeTo(fixed.writable).catch(() => undefined);
    body = fixed.readable;
  }
  return new Response(body, { status: 200, headers: { "Content-Type": "application/vnd.android.package-archive", "Content-Disposition": 'attachment; filename="app.apk"', "Cache-Control": "no-store" } });
}

// The Android download once ourapps has released the app to Google Play: Google Play's signed APK of the newest version
// Google has generated it for, else of the newest released, which Google is preparing. Null before the first release.
export async function playApk(env: Env, appId: string): Promise<PlayApk | null> {
  const { offered, newest } = await Db.from(env).googlePlayApks(appId);
  const a = offered ?? newest;
  return a ? { appId, versionCode: a.versionCode, version: a.version } : null;
}

// Run on the ten-minute schedule after the App Store, with the outbound calls the run has left: a few releases read
// from Google, least recently checked first, then a few versions whose APK Google has not generated yet, then one app's
// unfinished graphics.
export async function tickGooglePlay(env: Env, deps: Deps, calls = 45): Promise<void> {
  let used = 0;
  const counted: Deps = { ...deps, fetch: (input, init) => { used++; return deps.fetch(input, init); } };
  const db = Db.from(env);
  const clients = new Map<string, GooglePlayClient | null>();
  const clientFor = async (developerId: string) => {
    if (!clients.has(developerId)) clients.set(developerId, googleClient(env, counted, (await loadSecrets(env, developerId, ["googleServiceAccount"])).googleServiceAccount));
    return clients.get(developerId)!;
  };
  for (const r of await db.followedGooglePlayReleases(4)) {
    if (calls - used < 3) return;
    try {
      const app = await db.appById(r.appId);
      if (!app?.androidPackage) continue;
      const google = await clientFor(app.developerId);
      if (!google) continue;
      await followRelease(google, app.androidPackage, r, deps.now());
    } catch (err) {
      r.checkedAt = r.updatedAt = deps.now().toISOString();
      r.message = `Could not check with Google: ${googlePlayProblem(err)}`;
      console.error(`google play ${r.appId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await db.updateGooglePlayRelease(r);
  }
  for (const a of await db.googlePlayApksToFind(APKS_PER_RUN)) {
    if (calls - used < 3) return;
    try {
      const app = await db.appById(a.appId);
      const google = app?.androidPackage ? await clientFor(app.developerId) : null;
      if (!app?.androidPackage) a.checkedAt = deps.now().toISOString();
      else if (!google) Object.assign(a, { checkedAt: deps.now().toISOString(), error: APK_NO_KEY });
      else await findApk(google, app.androidPackage, a, deps.now());
    } catch (err) {
      a.error = `Google Play did not give the Android download. ${googlePlayProblem(err)}`;
      console.error(`google play apk ${a.appId} ${a.versionCode}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await db.updateGooglePlayApk(a);
  }
  const left = calls - used;
  if (left < 12) return;
  const state = (await db.googlePlayGraphicsWork(1))[0];
  if (!state) return;
  try {
    const app = await db.appById(state.appId);
    if (!app) return;
    await requireTarget(env, app, "android");
    const ctx = await context(env, deps, app);
    const packageName = packageOf(app, ctx.manifest);
    if (!packageName || !state.listing) return;
    await runGraphics(env, deps, app, packageName, state, ctx, { calls: Math.min(left - 2, GRAPHICS_CALLS), bytes: GRAPHICS_BYTES });
  } catch (err) {
    console.error(`google play graphics ${state.appId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The install page's Google Play links: the store page once production is live, and the testing opt-in page when the
// developer offers it for a live open or closed test.
export async function googlePlayLinks(env: Env, app: AppRow): Promise<{ store: string | null; testing: string | null }> {
  if (!app.androidPackage) return { store: null, testing: null };
  const live = await Db.from(env).googlePlayLive(app.id);
  return { store: live.production ? playUrl(app.androidPackage) : null, testing: live.testing ? testingUrl(app.androidPackage) : null };
}

// POST /api/dev/googleplay/check - dashboard only. Proves the saved service account works: Google gives it an access
// token, and for each app with a package name it opens and deletes an edit.
export async function checkGooglePlay(request: Request, env: Env, deps: Deps, dev: AuthedDeveloper) {
  requireSession(dev);
  const secrets = await loadSecrets(env, dev.id, ["googleServiceAccount"]);
  const google = client(env, deps, { secrets });
  const apps = (await Db.from(env).appsByDeveloper(dev.id)).filter((a) => a.androidPackage).slice(0, 5);
  const results: { id: string; name: string; packageName: string; ok: boolean; error: string | null }[] = [];
  try {
    await google.accessToken();
  } catch (err) {
    throw new HttpError(502, googlePlayProblem(err, google.email));
  }
  for (const app of apps) {
    try {
      const edit = await google.insertEdit(app.androidPackage);
      await google.deleteEdit(app.androidPackage, edit.id).catch(() => undefined);
      results.push({ id: app.id, name: app.name, packageName: app.androidPackage, ok: true, error: null });
    } catch (err) {
      results.push({ id: app.id, name: app.name, packageName: app.androidPackage, ok: false, error: googlePlayProblem(err, google.email, app.androidPackage) });
    }
  }
  await audit(request, env, deps, dev.id, "google-play-checked", `${google.email}: ${results.filter((r) => r.ok).length} of ${results.length} apps`);
  return { ok: true, serviceAccount: google.email, apps: results };
}

// Android version codes

// Play's highest version code for the app, read with a fresh edit at most every ten minutes; null when Play cannot be read.
async function playMaximum(env: Env, deps: Deps, app: AppRow, stored: string | undefined): Promise<number | null> {
  const google = googleClient(env, deps, stored);
  if (!app.androidPackage || !google) return null;
  const db = Db.from(env);
  const saved = await db.versionCodeState(app.id);
  if (saved.playMaximum !== null && saved.playCheckedAt && deps.now().getTime() - Date.parse(saved.playCheckedAt) < PLAY_MAXIMUM_TTL_MS) return saved.playMaximum;
  try {
    const edit = await google.insertEdit(app.androidPackage);
    const bundles = await google.listBundles(app.androidPackage, edit.id).finally(() => google.deleteEdit(app.androidPackage, edit.id).catch(() => undefined));
    const maximum = Math.max(0, ...bundles.map((b) => Number(b.versionCode)).filter((n) => Number.isSafeInteger(n)));
    await db.setPlayMaximum(app.id, maximum, deps.now().toISOString());
    return maximum;
  } catch (err) {
    console.error(`play version codes ${app.id}: ${err instanceof Error ? err.message : String(err)}`);
    return saved.playMaximum;
  }
}

// POST /api/build/:app/android/version-code - the next Android versionCode for the app's release workflow. It is above
// every code ourapps gave the app and above Play's highest when Play can be read; the same verified run attempt gets
// the same code again.
export async function reserveVersionCode(env: Env, deps: Deps, app: AppRow, body: unknown): Promise<{ versionCode: number }> {
  await requireTarget(env, app, "android");
  if (body !== undefined && !isObj(body)) throw new HttpError(400, "The body must be a JSON object with optional version, runId and runAttempt.");
  const input = (body ?? {}) as Obj;
  const unknown = Object.keys(input).filter((k) => !["version", "runId", "runAttempt"].includes(k));
  if (unknown.length) throw new HttpError(400, `Send only version, runId and runAttempt; not ${unknown.join(", ")}.`);
  const version = input.version ?? null;
  if (version !== null && (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(version))) throw new HttpError(400, "version must be the release's version, for example 1.2.0");
  const metadata = parseBuildRunMetadata("runId" in input || "runAttempt" in input ? { runId: input.runId, runAttempt: input.runAttempt } : {});
  const secrets = await loadSecrets(env, app.developerId, ["githubToken", "googleServiceAccount"]);
  const db = Db.from(env);
  let verified;
  if (metadata) {
    if (!secrets.githubToken) throw new HttpError(502, "Save a GitHub token with repository access and Actions: read in Settings to tie version codes to workflow runs.");
    verified = await verifyBuildRun(env, deps, app, secrets.githubToken, metadata, false);
    const existing = await db.versionCodeRun(app.id, app.repo, metadata);
    if (existing !== null) return { versionCode: existing };
  }
  const floor = (await playMaximum(env, deps, app, secrets.googleServiceAccount)) ?? 0;
  await requireTarget(env, app, "android");
  const code = await db.reserveVersionCode(app.id, floor);
  if (code === null) throw new HttpError(409, `The Android version codes are used up: Google Play takes codes up to ${MAX_VERSION_CODE}.`);
  if (verified) return { versionCode: await db.associateVersionCodeRun(app.id, verified, code, version as string | null, deps.now().toISOString()) };
  return { versionCode: code };
}
