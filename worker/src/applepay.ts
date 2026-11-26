// Apple Pay for a shop app, with the developer's own App Store Connect key in their own team: the merchant identifier,
// Payment Processing certificates made from the payment processor's request, the Apple Pay capability on the App ID, and
// App Store profiles that carry the merchant identifier. Apple's API cannot tick the merchant identifier on the App ID;
// the developer does that on Apple's site and confirms it here.
import { AppleError, type AppleClient } from "./apple.js";
import { audit } from "./audit.js";
import { Db, type AppRow, type ApplePayAppRow, type ApplePayCertificateRow, type ApplePayStep, type Developer } from "./db.js";
import type { Deps, Env } from "./env.js";
import { appleClient } from "./flow.js";
import { HttpError } from "./http.js";
import { loadSecrets } from "./secrets.js";
import { requireTarget, TargetDisabledError } from "./targets.js";
import { renewStoreProfile } from "./testflight.js";

export const ENTITLEMENT = "com.apple.developer.in-app-payments";
// Apple Pay runs on iPhone and iPad (the iOS profile) and on Mac (its own profile); Apple TV has no Apple Pay.
const PLATFORMS = ["ios", "macos"] as const;
type PayPlatform = typeof PLATFORMS[number];
const PLATFORM_NAMES: Record<PayPlatform, string> = { ios: "iPhone and iPad", macos: "Mac" };
const STEPS: ApplePayStep[] = ["merchant", "certificate", "capability", "profiles"];
export const NOT_SET_UP = "Set up TestFlight for iPhone and iPad first: Apple Pay goes into the App Store profile TestFlight makes.";
// The payment processor gets the next certificate this many days before the active one expires (Apple's last 25 months).
export const RENEW_DAYS = 30;
const MERCHANT = /^merchant(\.[A-Za-z0-9-]+)+$/;
const CSR = /^-----BEGIN (NEW )?CERTIFICATE REQUEST-----[A-Za-z0-9+/=\s]+-----END (NEW )?CERTIFICATE REQUEST-----$/;

export const appIdPage = (bundleIdRes: string) => `https://developer.apple.com/account/resources/identifiers/bundleId/edit/${encodeURIComponent(bundleIdRes)}`;
const merchantName = (name: string) => name.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const isObj = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// What Apple's answers mean for the developer, in plain words.
export function applePayProblem(err: unknown): string {
  if (err instanceof AppleError) {
    if (err.status === 401) return "Apple did not accept your App Store Connect key. Check the issuer ID, key ID and private key in Settings.";
    if (err.status === 403 && /agreement/i.test(`${err.code} ${err.detail}`)) return "Apple needs the account holder to accept the latest agreement in App Store Connect, under Business, first.";
    if (err.status === 403) return "Your App Store Connect key does not allow this. Apple lets only the Account Holder and Admins make merchant identifiers, Payment Processing certificates and App ID capabilities: make a team key with the Admin role in App Store Connect, Users and Access, Integrations, and save it in Settings.";
    return `Apple did not accept this: ${err.detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// The merchant identifiers an App Store profile grants under the Apple Pay entitlement: none without the entitlement,
// null when the profile cannot be read. The profile is a signed message holding a property list as text.
export function profileMerchants(profileBase64: string | null | undefined): string[] | null {
  if (!profileBase64) return null;
  let raw: string;
  try {
    raw = atob(profileBase64);
  } catch {
    return null;
  }
  const start = raw.indexOf("<?xml");
  const end = raw.indexOf("</plist>", start);
  if (start < 0 || end < 0) return null;
  const found = raw.slice(start, end).match(/<key>com\.apple\.developer\.in-app-payments<\/key>\s*(?:<array\s*\/>|<array>([\s\S]*?)<\/array>)/);
  if (!found) return [];
  return [...(found[1] ?? "").matchAll(/<string>\s*([^<]*?)\s*<\/string>/g)].map((m) => m[1]);
}

const emptyRow = (appId: string, now: string): ApplePayAppRow => ({ appId, merchantId: null, merchantIdentifier: null, merchantName: null, appIds: [], capabilityAt: null, tickedAt: null, profilesAt: null, errors: {}, updatedAt: now });

async function save(env: Env, deps: Deps, row: ApplePayAppRow): Promise<void> {
  row.updatedAt = deps.now().toISOString();
  await Db.from(env).putApplePayApp(row);
}

// Every Apple Pay write needs the iPhone and iPad target on and its TestFlight set up, which made the App Store profile.
async function requireReady(env: Env, base: AppRow): Promise<AppRow> {
  const ios = await Db.from(env).platformApp(base, "ios");
  await requireTarget(env, ios);
  if (!ios.ascAppId || !ios.storeProfileBase64) throw new HttpError(409, NOT_SET_UP);
  return ios;
}

// The app's platforms that take Apple Pay, switched on and set up for TestFlight.
async function payPlatforms(env: Env, base: AppRow): Promise<(AppRow & { platform: PayPlatform })[]> {
  const db = Db.from(env);
  const targets = await db.appTargets(base.id);
  const out: (AppRow & { platform: PayPlatform })[] = [];
  for (const platform of PLATFORMS) {
    const app = await db.platformApp(base, platform);
    if (targets[platform] && app.ascAppId && app.storeProfileBase64) out.push({ ...app, platform });
  }
  return out;
}

async function client(env: Env, deps: Deps, base: AppRow): Promise<AppleClient> {
  return appleClient(env, deps, await loadSecrets(env, base.developerId, ["appleIssuerId", "appleKeyId", "applePrivateKey"]));
}

const renewBy = (c: ApplePayCertificateRow) => (c.expirationDate ? new Date(Date.parse(c.expirationDate) - RENEW_DAYS * 86_400_000).toISOString() : null);

// Where Apple Pay stands for the app; the console's step list and agents read it. With team, the merchant identifiers
// already in the developer's team are read from Apple while none is chosen.
export async function applePayView(env: Env, deps: Deps, app: AppRow, team = false) {
  const db = Db.from(env);
  const now = deps.now();
  // The iOS profile lives on the app's row, which making the profiles again has changed.
  const base = (await db.appById(app.id)) ?? app;
  const ios = await db.platformApp(base, "ios");
  const setUp = Boolean(ios.ascAppId && ios.storeProfileBase64);
  const row = (await db.applePayApp(base.id)) ?? emptyRow(base.id, now.toISOString());
  const certificates = row.merchantId ? await db.applePayCertificates(base.id, row.merchantId) : [];
  const identifier = row.merchantIdentifier;
  const profiles = (setUp ? await payPlatforms(env, base) : []).map((app) => {
    const granted = profileMerchants(app.storeProfileBase64);
    return { platform: app.platform, label: PLATFORM_NAMES[app.platform], profileName: app.storeProfileName ?? null, merchantIdentifiers: granted, carries: Boolean(identifier && granted?.includes(identifier)) };
  });
  const active = certificates.find((c) => c.activated !== false && (!c.expirationDate || Date.parse(c.expirationDate) > now.getTime())) ?? null;
  const done: Record<ApplePayStep, boolean> = {
    merchant: Boolean(row.merchantId),
    certificate: Boolean(active),
    capability: Boolean(row.merchantId && row.capabilityAt && row.tickedAt),
    profiles: Boolean(row.tickedAt) && profiles.length > 0 && profiles.every((p) => p.carries),
  };
  let teamMerchants: { identifier: string; name: string }[] | null = null;
  if (team && setUp && !row.merchantId) {
    try {
      teamMerchants = (await (await client(env, deps, base)).merchants()).map((m) => ({ identifier: m.identifier, name: m.name }));
    } catch (err) {
      console.error(`apple pay merchants ${base.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    setUp,
    needs: setUp ? null : "testflight",
    step: setUp ? STEPS.find((s) => !done[s]) ?? null : null,
    entitlement: ENTITLEMENT,
    merchant: {
      id: row.merchantId,
      identifier,
      name: row.merchantName,
      suggested: { identifier: base.bundleId ? `merchant.${base.bundleId}` : "", name: merchantName(base.name) },
      team: teamMerchants,
      done: done.merchant,
      error: row.errors.merchant ?? null,
    },
    certificate: {
      items: certificates.map((c) => ({ id: c.certificateId, name: c.name, serialNumber: c.serialNumber, expirationDate: c.expirationDate, renewBy: renewBy(c), activated: c.activated, createdAt: c.createdAt, download: `/api/dev/apps/${base.id}/applepay/certificate/${encodeURIComponent(c.certificateId)}` })),
      activeId: active?.certificateId ?? null,
      renewBy: active ? renewBy(active) : null,
      done: done.certificate,
      error: row.errors.certificate ?? null,
    },
    capability: { appIds: row.appIds.map((a) => ({ ...a, page: appIdPage(a.id) })), turnedOnAt: row.capabilityAt, tickedAt: row.tickedAt, done: done.capability, error: row.errors.capability ?? null },
    profiles: { items: profiles, madeAt: row.profilesAt, done: done.profiles, error: row.errors.profiles ?? null },
  };
}

// Saves what was done and gives the developer Apple's refusal in plain words.
async function fail(env: Env, deps: Deps, row: ApplePayAppRow, step: ApplePayStep, err: unknown): Promise<never> {
  if (err instanceof TargetDisabledError) throw err;
  const message = applePayProblem(err);
  row.errors[step] = message;
  await save(env, deps, row);
  throw new HttpError(err instanceof HttpError ? err.status : 502, message);
}

// Turns the Apple Pay capability on for the App ID of each platform that takes Apple Pay; Mac Catalyst shares the iOS one.
// Returns the App IDs, and whether any capability was turned on now.
async function turnOnApplePay(env: Env, apple: AppleClient, base: AppRow, check: () => Promise<void>): Promise<{ appIds: ApplePayAppRow["appIds"]; changed: boolean }> {
  const appIds: ApplePayAppRow["appIds"] = [];
  let changed = false;
  for (const app of await payPlatforms(env, base)) {
    const id = await apple.ensureBundleId(app.bundleId, app.name, app.platform === "macos" && app.nativeMac, check);
    const found = appIds.find((a) => a.id === id);
    if (found) {
      found.platforms.push(app.platform);
      continue;
    }
    if (await apple.ensureCapability(id, "APPLE_PAY", check)) changed = true;
    appIds.push({ id, identifier: app.bundleId, platforms: [app.platform] });
  }
  return { appIds, changed };
}

// Makes the App Store profile of each platform that takes Apple Pay again, unless keep accepts the one Apple has. A
// changed App ID invalidates its profiles at Apple. Returns what failed, per platform.
async function renewProfiles(env: Env, apple: AppleClient, base: AppRow, keep: (profileContent: string) => boolean): Promise<string[]> {
  const certificate = await Db.from(env).signingCertificate(base.developerId);
  if (!certificate) return ["Set up iPhone signing again under Settings first."];
  const failed: string[] = [];
  for (const app of await payPlatforms(env, base)) {
    try {
      await renewStoreProfile(env, apple, app, certificate.certificateId, keep);
    } catch (err) {
      if (err instanceof TargetDisabledError && app.platform !== "ios") continue;
      if (err instanceof TargetDisabledError) throw err;
      failed.push(`${PLATFORM_NAMES[app.platform]}: ${applePayProblem(err)}`);
    }
  }
  return failed;
}

// POST /api/dev/apps/:id/applepay/merchant - uses the team's merchant identifier when it exists, creates it otherwise,
// then turns the Apple Pay capability on for the App ID and makes the profiles it invalidated again. Body: optional
// { identifier, name }.
export async function chooseMerchant(request: Request, env: Env, deps: Deps, dev: Developer, base: AppRow, body: unknown) {
  const ios = await requireReady(env, base);
  if (!isObj(body)) throw new HttpError(400, "body must be an object with identifier and name, or empty");
  const input = body;
  const unknown = Object.keys(input).filter((k) => k !== "identifier" && k !== "name");
  if (unknown.length) throw new HttpError(400, `unknown field ${unknown[0]}; send identifier and name`);
  const identifier = input.identifier === undefined ? `merchant.${base.bundleId}` : typeof input.identifier === "string" ? input.identifier.trim() : "";
  if (!MERCHANT.test(identifier) || identifier.length > 255) throw new HttpError(400, "identifier must look like merchant.com.yourname.pokernight");
  const name = input.name === undefined ? merchantName(base.name) : typeof input.name === "string" ? merchantName(input.name) : "";
  if (!name) throw new HttpError(400, "name must be text with letters or digits, for example Poker Night");
  const now = deps.now().toISOString();
  const row = (await Db.from(env).applePayApp(base.id)) ?? emptyRow(base.id, now);
  const check = () => requireTarget(env, ios);
  let step: ApplePayStep = "merchant";
  try {
    const apple = await client(env, deps, base);
    const merchant = (await apple.merchants(identifier))[0] ?? (await apple.createMerchant(identifier, name, check));
    // Another merchant identifier has to be ticked on the App ID again, and the profiles made again for it.
    if (row.merchantId !== merchant.id) Object.assign(row, { tickedAt: null, profilesAt: null });
    Object.assign(row, { merchantId: merchant.id, merchantIdentifier: merchant.identifier, merchantName: merchant.name });
    delete row.errors.merchant;
    step = "capability";
    const turnedOn = await turnOnApplePay(env, apple, base, check);
    row.appIds = turnedOn.appIds;
    row.capabilityAt ??= now;
    delete row.errors.capability;
    if (turnedOn.changed) {
      step = "profiles";
      const failed = await renewProfiles(env, apple, base, () => false);
      if (failed.length) throw new Error(failed.join(" "));
      row.profilesAt = now;
      delete row.errors.profiles;
    }
  } catch (err) {
    return fail(env, deps, row, step, err);
  }
  await save(env, deps, row);
  await audit(request, env, deps, dev.id, "apple-pay-merchant-set", `${base.name}: ${row.merchantIdentifier}`);
  return applePayView(env, deps, base);
}

// POST /api/dev/apps/:id/applepay/certificate - a Payment Processing certificate from the processor's request { csr }.
export async function createCertificate(request: Request, env: Env, deps: Deps, dev: Developer, base: AppRow, body: unknown) {
  const ios = await requireReady(env, base);
  const csr = isObj(body) && typeof body.csr === "string" ? body.csr.trim() : "";
  if (!CSR.test(csr) || csr.length > 8000) throw new HttpError(400, "csr must be the certificate signing request from your payment processor, the text from -----BEGIN CERTIFICATE REQUEST----- to -----END CERTIFICATE REQUEST-----");
  const db = Db.from(env);
  const row = await db.applePayApp(base.id);
  if (!row?.merchantId) throw new HttpError(409, "Choose the merchant identifier first; the certificate belongs to it.");
  let made: Awaited<ReturnType<AppleClient["createPaymentCertificate"]>>;
  try {
    made = await (await client(env, deps, base)).createPaymentCertificate(csr, row.merchantId, () => requireTarget(env, ios));
  } catch (err) {
    return fail(env, deps, row, "certificate", err);
  }
  await db.insertApplePayCertificate({ certificateId: made.id, appId: base.id, merchantId: row.merchantId, name: made.name, serialNumber: made.serialNumber, certificateBase64: made.certificateContent, expirationDate: made.expirationDate, activated: made.activated, createdAt: deps.now().toISOString() });
  delete row.errors.certificate;
  await save(env, deps, row);
  await audit(request, env, deps, dev.id, "apple-pay-certificate-created", `${base.name}: ${row.merchantIdentifier} ${made.serialNumber}`);
  return applePayView(env, deps, base);
}

// POST /api/dev/apps/:id/applepay/profiles, and after the developer confirms the tick: the profiles made again until
// each carries the merchant identifier. Builds fetch them from GET /api/build/:app/:platform/signing.
async function profilesWithMerchant(request: Request, env: Env, deps: Deps, dev: Developer, base: AppRow, row: ApplePayAppRow) {
  const identifier = row.merchantIdentifier!;
  let failed: string[];
  try {
    failed = await renewProfiles(env, await client(env, deps, base), base, (content) => profileMerchants(content)?.includes(identifier) === true);
  } catch (err) {
    return fail(env, deps, row, "profiles", err);
  }
  row.profilesAt = deps.now().toISOString();
  if (failed.length) return fail(env, deps, row, "profiles", new Error(failed.join(" ")));
  delete row.errors.profiles;
  await save(env, deps, row);
  await audit(request, env, deps, dev.id, "apple-pay-profiles-made", `${base.name}: ${identifier}`);
  return applePayView(env, deps, base);
}

// POST /api/dev/apps/:id/applepay/confirm - the developer has ticked the merchant identifier on the App ID at Apple.
export async function confirmTicked(request: Request, env: Env, deps: Deps, dev: Developer, base: AppRow) {
  await requireReady(env, base);
  const row = await Db.from(env).applePayApp(base.id);
  if (!row?.merchantId || !row.capabilityAt) throw new HttpError(409, "Choose the merchant identifier first; ourapps then turns Apple Pay on for the App ID.");
  row.tickedAt = deps.now().toISOString();
  delete row.errors.capability;
  await save(env, deps, row);
  await audit(request, env, deps, dev.id, "apple-pay-ticked", `${base.name}: ${row.merchantIdentifier}`);
  return profilesWithMerchant(request, env, deps, dev, base, row);
}

export async function makeProfiles(request: Request, env: Env, deps: Deps, dev: Developer, base: AppRow) {
  await requireReady(env, base);
  const row = await Db.from(env).applePayApp(base.id);
  if (!row?.merchantIdentifier || !row.tickedAt) throw new HttpError(409, "Tick the merchant identifier on the App ID first, then press I have ticked it.");
  return profilesWithMerchant(request, env, deps, dev, base, row);
}

// GET /api/dev/apps/:id/applepay/certificate/:certId - the certificate for the payment processor, as a .cer file.
export async function certificateFile(env: Env, base: AppRow, certificateId: string): Promise<Response> {
  const db = Db.from(env);
  const cert = /^[A-Za-z0-9_-]{1,64}$/.test(certificateId) ? await db.applePayCertificate(base.id, certificateId) : null;
  if (!cert) throw new HttpError(404, "unknown certificate");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(cert.certificateBase64), (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(502, "Apple's certificate could not be read; make the certificate again.");
  }
  const merchant = (await db.applePayApp(base.id))?.merchantIdentifier ?? "apple_pay";
  return new Response(bytes, {
    headers: { "Content-Type": "application/pkix-cert", "Content-Disposition": `attachment; filename="${merchant.replace(/[^A-Za-z0-9.-]+/g, "-")}.cer"`, "Cache-Control": "no-store" },
  });
}
