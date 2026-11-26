import type { AppTargets, AppleTarget, MacTarget, WindowsTarget, ScreenshotPlatform, ScreenshotSets } from "@my/store-shared";

// Calls to the worker on the same origin.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `request failed (${res.status})`);
  return data;
}

export interface AppDetails {
  id: string;
  name: string;
  tagline: string;
  description: string;
  whatsNew: string;
  size: string;
  minOs: string;
  ageNote: string;
  privacySummary: string;
  iconUrl: string;
  screenshots: string[];
  screenshotsByPlatform?: Partial<Record<ScreenshotPlatform, string[]>>;
  updatedAt: string;
}

export interface DevApp extends AppDetails {
  targets?: AppTargets;
  repo: string;
  manifestUrl: string;
  bundleId: string;
  androidPackage?: string;
  showOnPage: boolean;
  ascAppId?: string | null;
  testflightUrl?: string | null;
  releaseIcon?: string;
  createdAt: string;
}

export interface Install {
  macos?: MacTarget | null;
  windows?: WindowsTarget | null;
  tvos?: AppleTarget | null;
  pwa: string | null;
  android: { apk: string } | null;
  ios: { bundleId: string; testflight: string | null; devices?: ("iphone" | "ipad")[] } | null;
}

export interface Release {
  apple?: Partial<Record<"ios" | "macos" | "tvos" | "iosOnMac", { version: string; testflightUrl: string } | null>>;
  // The App Store page per Apple platform, once a version is on the store.
  appStore?: Partial<Record<"ios" | "macos" | "tvos", string | null>>;
  // Google Play's page once the app is live in production, and its testing opt-in page when the developer offers it.
  googlePlay?: { store: string | null; testing: string | null };
  version: string;
  minPlayers: number;
  maxPlayers: number;
  install: Install;
  fallbackName: string;
  fallbackIcon: string;
  fallbackDescription: string;
  fallbackScreenshots: string[];
  // The version TestFlight installs, when it differs from the release; null when TestFlight is not open.
  testflightVersion?: string | null;
  // The version the Android download installs: Google Play's signed APK can be older than the release. Null without Android.
  androidVersion?: string | null;
}

export interface HistoryEntry {
  version: string;
  tag: string;
  title: string;
  notes: string;
  date: string | null;
  sha: string | null;
  releaseUrl: string | null;
  commitUrl: string | null;
}

export interface LinkPage {
  deliveryRevision?: string;
  linkId: string | null;
  preview?: boolean;
  developer: { id: string; slug: string; displayName: string };
  app: AppDetails;
  release: Release | null;
  releaseError: string | null;
  history: HistoryEntry[];
  // The general list and the per-platform lists; the page picks one per version.
  screenshots: ScreenshotSets;
}

export interface ShareLink {
  id: string;
  appId: string;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface SecretStatus {
  apple: boolean;
  appleSavedAt: string | null;
  appleTeamId: string;
  appleTeamIdSavedAt: string | null;
  github: boolean;
  githubSavedAt: string | null;
  signing: SigningStatus | null;
  googlePlay?: boolean;
  googlePlaySavedAt?: string | null;
  // The service account's email, which is invited in Play Console; the key itself is never shown.
  googleServiceAccount?: string | null;
}

export interface SigningStatus {
  name: string;
  serialNumber: string;
  expirationDate: string | null;
  createdAt: string;
}

// The result of POST /api/dev/signing: the certificate, then one line per app on TestFlight.
export interface SigningSetUp {
  signing: SigningStatus;
  apps: { id: string; name: string; error: string | null }[];
}

export interface Me {
  developer: { id: string; slug: string; displayName: string; githubLogin: string; createdAt: string; termsAcceptedVersion: string | null; termsAcceptedAt: string | null };
  authVia: "session" | "key";
  scope: "read" | "manage";
  termsVersion: string;
  secrets: SecretStatus;
  // Who Apple's TestFlight beta review contacts; null until saved.
  reviewContact: { firstName: string; lastName: string; email: string; phone: string } | null;
}

// The developer's next step before TestFlight can be set up, in the order they meet them.
export type TestflightNeed = "bundle-id" | "apple-key" | "signing" | "review-contact" | "store-app";

// After set-up: what the invitation waits for.
export type TestflightStage = "no-build" | "waiting-for-upload" | "processing" | "in-review" | "approved" | "open" | "link-closed" | "rejected" | "failed";

export interface TestflightBuild {
  version: string;
  buildNumber: string;
  state: string;
  appleState: string | null;
  message: string | null;
  uploadedAt: string;
  submittedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface TestflightStatus {
  buildStatus?: BuildStatus;
  profileType?: "IOS_APP_STORE" | "MAC_CATALYST_APP_STORE" | "MAC_APP_STORE" | "TVOS_APP_STORE";
  setUp: boolean;
  // null with setUp false: ourapps can check with Apple whether the app is in App Store Connect yet.
  needs: TestflightNeed | null;
  // What to type into App Store Connect's New App form, until the app is set up.
  storeApp: { name: string; otherName: string; bundleId: string; sku: string } | null;
  stage: TestflightStage | null;
  url: string | null;
  // What testflight.apple.com shows a friend opening the invitation.
  invitation: { state: "open" | "not-accepting" | "full" | "missing" | null; checkedAt: string | null };
  buildRequest: { at: string; error: string | null } | null;
  profile: string | null;
  contact: boolean;
  builds: TestflightBuild[];
}

export type AppStoreStep = "app-info" | "privacy" | "version" | "screenshots" | "review" | "build" | "submit";
// draft and rejected can be changed; waiting and in-review are with Apple; pending-release waits for the Release button;
// releasing is on its way to the store; ready is on the App Store.
export type AppStoreStage = "draft" | "waiting" | "in-review" | "rejected" | "pending-release" | "releasing" | "ready";

export interface AppStoreStatus {
  platform: "ios" | "macos" | "tvos";
  setUp: boolean;
  // "testflight" until TestFlight is set up for the platform.
  needs: "testflight" | null;
  appleAppId: string | null;
  storeUrl: string | null;
  links: { appPrivacy: string; appReview: string; unlistedRequest: string } | null;
  // The first step not done while the version can be changed; null otherwise.
  step: AppStoreStep | null;
  stage: AppStoreStage;
  appInfo: {
    listing: "public" | "unlisted";
    unlistedGrantedAt: string | null;
    category: string;
    ageRating: Record<string, string | boolean>;
    thirdPartyContent: boolean;
    privacyPolicyUrl: string;
    defaultPolicy: { url: string | null; collects: string[]; storage: "device" | "servers"; contactEmail: string; developerName: string };
    done: boolean;
    error: string | null;
  };
  privacy: { confirmedAt: string | null; done: boolean };
  version: { version: string; description: string; keywords: string; supportUrl: string; copyright: string; whatsNew: string; firstVersion: boolean; suggested: string | null; done: boolean; error: string | null };
  screenshots: {
    // Apple's placement groups that meet each requirement, with the sizes each takes.
    required: { label: string; groups: { id: string; label: string; sizes: string; uploaded: number }[] }[];
    missing: string[];
    pending: number;
    started: boolean;
    // Screenshots Apple is still processing, and whether Apple's processing has been read back.
    processing: number;
    checked: boolean;
    items: { url: string; group: string | null; width: number | null; height: number | null; uploaded: boolean; error: string | null }[];
    done: boolean;
    error: string | null;
  };
  review: { firstName: string; lastName: string; email: string; phone: string; notes: string; done: boolean; error: string | null };
  build: { buildNumber: string | null; candidates: { version: string; buildNumber: string; expiresAt: string | null }[]; done: boolean; error: string | null };
  submission: { releaseType: "AFTER_APPROVAL" | "MANUAL"; appleState: string | null; message: string | null; liveVersion: string | null; submittedAt: string | null; checkedAt: string | null; releasedAt: string | null; error: string | null };
}

export type ApplePayStep = "merchant" | "certificate" | "capability" | "profiles";

export interface ApplePayCertificate {
  id: string;
  name: string;
  serialNumber: string;
  expirationDate: string | null;
  // When to give the payment processor the next certificate.
  renewBy: string | null;
  // Apple uses one certificate of a merchant identifier at a time; null when Apple did not say.
  activated: boolean | null;
  createdAt: string;
  download: string;
}

export interface ApplePayStatus {
  setUp: boolean;
  // "testflight" until iPhone and iPad TestFlight is set up.
  needs: "testflight" | null;
  step: ApplePayStep | null;
  entitlement: string;
  merchant: {
    id: string | null;
    identifier: string | null;
    name: string | null;
    suggested: { identifier: string; name: string };
    // The team's merchant identifiers, read while none is chosen; null when not read.
    team: { identifier: string; name: string }[] | null;
    done: boolean;
    error: string | null;
  };
  certificate: { items: ApplePayCertificate[]; activeId: string | null; renewBy: string | null; done: boolean; error: string | null };
  capability: { appIds: { id: string; identifier: string; platforms: ("ios" | "macos")[]; page: string }[]; turnedOnAt: string | null; tickedAt: string | null; done: boolean; error: string | null };
  profiles: {
    // merchantIdentifiers is null when the profile could not be read.
    items: { platform: "ios" | "macos"; label: string; profileName: string | null; merchantIdentifiers: string[] | null; carries: boolean }[];
    madeAt: string | null;
    done: boolean;
    error: string | null;
  };
}

export type GooglePlayStep = "app" | "content" | "listing" | "graphics" | "release";
export type GooglePlayTrack = "internal" | "alpha" | "beta" | "production";
export type GooglePlayStage = "sent" | "not-sent" | "in-review" | "approved" | "rejected" | "draft" | "live" | "replaced";

export interface GooglePlayRelease {
  track: GooglePlayTrack;
  version: string;
  versionCode: number;
  status: "completed" | "inProgress" | "draft";
  userFraction: number | null;
  stage: GooglePlayStage;
  googleState: string | null;
  message: string | null;
  committedAt: string;
  checkedAt: string | null;
  liveAt: string | null;
}

export interface GooglePlayStatus {
  setUp: boolean;
  needs: "service-account" | null;
  serviceAccount: string | null;
  packageName: string | null;
  packageFrom: "app" | "my-app.json" | null;
  step: GooglePlayStep | null;
  links: { console: string; appContent: string; testingRules: string; signing: string; firstRelease: string; verification: string; playPage: string | null; testing: string | null };
  app: { packageName: string | null; foundAt: string | null; done: boolean; error: string | null };
  content: { privacyPolicyUrl: string; defaultPolicy: { url: string | null; collects: string[]; storage: "device" | "servers"; contactEmail: string; developerName: string }; policyAddress: string | null; confirmedAt: string | null; done: boolean; error: string | null };
  listing: { title: string; shortDescription: string; fullDescription: string; contactEmail: string; contactWebsite: string; language: string | null; syncedAt: string | null; done: boolean; error: string | null };
  graphics: {
    featureGraphicUrl: string;
    tabletScreenshots: string[];
    started: boolean;
    pending: number;
    committed: boolean;
    missing: string[];
    items: { kind: "icon" | "featureGraphic" | "phone" | "tablet"; url: string; width: number | null; height: number | null; uploaded: boolean; error: string | null }[];
    done: boolean;
    error: string | null;
  };
  release: { version: string | null; bundle: boolean; ready: boolean; error: string | null };
  releases: GooglePlayRelease[];
  testing: { firstClosedAt: string | null; days: number | null; requiredDays: number; readyAt: string | null; testingLink: boolean };
  live: { production: boolean; url: string | null };
  // The install page's Android download once ourapps has released the app to Google Play: Google Play's signed APK of the
  // offered version, and a newer released version Google has not generated the APK of yet.
  apk: {
    offered: { versionCode: number; version: string; certificateSha256: string | null; foundAt: string | null; error: string | null } | null;
    waiting: { versionCode: number; version: string; checkedAt: string | null; error: string | null } | null;
  } | null;
}

export interface BuildStatus {
  state: "not-started" | "requested" | "pending" | "running" | "complete" | "failed" | "cancelled" | "unavailable";
  checkedAt: string;
  requestedAt: string | null;
  reason: string | null;
  message: string | null;
  workflowName: string | null;
  runUrl: string | null;
  runId: number | null;
  runNumber: number | null;
  runAttempt: number | null;
  conclusion: string | null;
  correlation: "none" | "request-time" | "build-number" | "workflow-only" | "platform-title" | "reservation";
  platformVerified: boolean;
  uploadReceived: boolean | null;
  startedAt: string | null;
  elapsedSeconds: number | null;
  expectedSeconds: number | null;
  estimateSampleCount: number;
  estimateSource: "median-successful-job-completion" | null;
  progressPercent: number | null;
}

export interface ReleaseStatus {
  ok: boolean;
  githubToken: boolean;
  appleKey: boolean;
  tag: string | null;
  publishedAt: string | null;
  assets: string[];
  manifestUrl: string | null;
  version: string | null;
  install: { ios: boolean; android: boolean; pwa: boolean; macos?: boolean; windows?: boolean; tvos?: boolean } | null;
  // Web version: copied from web.zip by ourapps, or at the developer's own address.
  web: { hosting: "ourapps" | "own"; url: string | null; ok: boolean | null; status: number | null } | null;
  screenshots: number;
  changelog: boolean;
  errors: string[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "manage";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface AuditEvent {
  id: number;
  event: string;
  detail: string;
  country: string | null;
  createdAt: string;
}

// Cached for the page lifetime so store pages can show the owner bar without a second round trip.
let mePromise: Promise<Me | null> | null = null;
export function whoAmI(force = false): Promise<Me | null> {
  if (!mePromise || force) {
    mePromise = api<Me | null>("GET", "/api/auth/session").catch(() => null);
  }
  return mePromise;
}
