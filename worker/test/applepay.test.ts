import { beforeEach, describe, expect, it } from "vitest";
import { Db } from "../src/db.js";
import type { Env } from "../src/env.js";
import { handle } from "../src/index.js";
import { NOT_SET_UP, profileMerchants } from "../src/applepay.js";
import { CSR, api, appleRoutes, clearDb, fakeFetch, jsonRes, rsaPem, saveAppleSecrets, signIn, testDeps, testEnv, type TestDeps } from "./helpers.js";

// App Store Connect as Apple Pay sees it. Apple's documentation, checked 26 November 2026:
// https://developer.apple.com/documentation/appstoreconnectapi/managing-payment-processing-certificates (merchantIds,
// certificates with certificateType APPLE_PAY and the merchantId relationship), .../bundle-id-capabilities (capabilityType
// APPLE_PAY; no setting assigns a merchant identifier), .../profiles, and
// https://developer.apple.com/help/account/identifiers/enable-app-capabilities (a changed App ID invalidates its profiles).

const MERCHANT = "merchant.com.example.pokernight";
const CER = String.fromCharCode(0x30, 0x82, 0x01, 0x0a, 0x30, 0x81) + "Poker Night Payment Processing";

type Profile = { id: string; name: string; profileType: string; bundleId: string; certificateId: string; state: string; content: string };
type Fake = {
  merchants: { id: string; identifier: string; name: string }[];
  certificates: { id: string; merchantId: string; activated: boolean }[];
  bundleIds: { id: string; identifier: string; platform: string }[];
  capabilities: Record<string, string[]>;
  // The merchant identifiers ticked on each App ID on Apple's site, which the API cannot do.
  ticked: Record<string, string[]>;
  profiles: Profile[];
  // Every write Apple refuses, as for a key without the Admin role.
  deny: boolean;
};
type Seen = { method: string; path: string; body: Record<string, any> | null };

// A profile as Apple serves it: a signed message around the property list, with the Apple Pay entitlement when given.
function profileFixture(merchants: string[] | null, name = "Poker Night App Store"): string {
  const entitlement = merchants === null ? "" : merchants.length
    ? `\t\t<key>com.apple.developer.in-app-payments</key>\n\t\t<array>\n${merchants.map((m) => `\t\t\t<string>${m}</string>\n`).join("")}\t\t</array>\n`
    : "\t\t<key>com.apple.developer.in-app-payments</key>\n\t\t<array/>\n";
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>AppIDName</key>\n\t<string>ourapps Poker Night</string>\n\t<key>Entitlements</key>\n\t<dict>\n${entitlement}\t\t<key>application-identifier</key>\n\t\t<string>TEAM123456.com.example.pokernight</string>\n\t</dict>\n\t<key>Name</key>\n\t<string>${name}</string>\n</dict>\n</plist>`;
  return btoa(String.fromCharCode(0x30, 0x80, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7) + plist + String.fromCharCode(0xa0, 0x82, 0x03, 0x00, 0x31));
}

function fake(): Fake {
  return { merchants: [], certificates: [], bundleIds: [{ id: "bid-1", identifier: "com.example.pokernight", platform: "IOS" }], capabilities: { "bid-1": ["IN_APP_PURCHASE"] }, ticked: {}, profiles: [], deny: false };
}

function payFetch(f: Fake) {
  const seen: Seen[] = [];
  let n = 0;
  const content = (bundleId: string, name: string) => profileFixture(f.capabilities[bundleId]?.includes("APPLE_PAY") ? f.ticked[bundleId] ?? [] : null, name);
  const fetchStub: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const body = req.method === "GET" || req.method === "DELETE" ? null : ((await req.json()) as Record<string, any>);
    seen.push({ method: req.method, path: url.pathname, body });
    if (url.host !== "api.appstoreconnect.apple.com") return new Response("no stub", { status: 599 });
    const p = url.pathname;
    const m = req.method;
    const q = (k: string) => url.searchParams.get(k);
    if (f.deny && m !== "GET") return jsonRes({ errors: [{ status: "403", code: "FORBIDDEN_ERROR", title: "This request is forbidden for security reasons", detail: "The API key in use does not allow this request" }] }, 403);
    const data = body?.data;
    let r: RegExpMatchArray | null;
    if (m === "GET" && p === "/v1/merchantIds") return jsonRes({ data: f.merchants.filter((x) => !q("filter[identifier]") || x.identifier === q("filter[identifier]")).map((x) => ({ type: "merchantIds", id: x.id, attributes: { identifier: x.identifier, name: x.name } })) });
    if (m === "POST" && p === "/v1/merchantIds") {
      const made = { id: `M${++n}`, identifier: data.attributes.identifier, name: data.attributes.name };
      f.merchants.push(made);
      return jsonRes({ data: { type: "merchantIds", id: made.id, attributes: { identifier: made.identifier, name: made.name } } }, 201);
    }
    if (m === "POST" && p === "/v1/certificates") {
      const merchantId = data.relationships.merchantId.data.id;
      const made = { id: `C${++n}`, merchantId, activated: !f.certificates.some((c) => c.merchantId === merchantId && c.activated) };
      f.certificates.push(made);
      const identifier = f.merchants.find((x) => x.id === merchantId)!.identifier;
      return jsonRes({ data: { type: "certificates", id: made.id, attributes: { name: `Apple Pay Payment Processing: ${identifier}`, certificateType: "APPLE_PAY", serialNumber: `7A1B${n}`, certificateContent: btoa(CER), expirationDate: "2028-11-16T10:00:00.000+00:00", activated: made.activated } } }, 201);
    }
    if (m === "GET" && p === "/v1/bundleIds") return jsonRes({ data: f.bundleIds.filter((b) => b.identifier === q("filter[identifier]")).map((b) => ({ type: "bundleIds", id: b.id, attributes: { identifier: b.identifier, platform: b.platform } })) });
    if (m === "GET" && (r = p.match(/^\/v1\/bundleIds\/([\w-]+)\/bundleIdCapabilities$/))) return jsonRes({ data: (f.capabilities[r[1]] ?? []).map((c) => ({ type: "bundleIdCapabilities", id: `${r![1]}_${c}`, attributes: { capabilityType: c, settings: [] } })) });
    if (m === "POST" && p === "/v1/bundleIdCapabilities") {
      const bundleId = data.relationships.bundleId.data.id;
      (f.capabilities[bundleId] ??= []).push(data.attributes.capabilityType);
      for (const profile of f.profiles) if (profile.bundleId === bundleId) profile.state = "INVALID";
      return jsonRes({ data: { type: "bundleIdCapabilities", id: `${bundleId}_${data.attributes.capabilityType}`, attributes: data.attributes } }, 201);
    }
    if (m === "GET" && p === "/v1/profiles") {
      return jsonRes({ data: f.profiles.filter((x) => x.name === q("filter[name]")).map((x) => ({
        type: "profiles", id: x.id,
        attributes: { name: x.name, profileType: x.profileType, profileState: x.state, uuid: `uuid-${x.id}`, profileContent: x.content, expirationDate: "2027-10-01T00:00:00Z" },
        relationships: { bundleId: { data: { type: "bundleIds", id: x.bundleId } }, certificates: { data: [{ type: "certificates", id: x.certificateId }] } },
      })) });
    }
    if (m === "DELETE" && (r = p.match(/^\/v1\/profiles\/([\w-]+)$/))) {
      f.profiles = f.profiles.filter((x) => x.id !== r![1]);
      return new Response(null, { status: 204 });
    }
    if (m === "POST" && p === "/v1/profiles") {
      const bundleId = data.relationships.bundleId.data.id;
      const made: Profile = { id: `prof-${++n}`, name: data.attributes.name, profileType: data.attributes.profileType, bundleId, certificateId: data.relationships.certificates.data[0].id, state: "ACTIVE", content: content(bundleId, data.attributes.name) };
      f.profiles.push(made);
      return jsonRes({ data: { type: "profiles", id: made.id, attributes: { uuid: `uuid-${made.id}`, profileContent: made.content, expirationDate: "2027-10-01T00:00:00Z" } } }, 201);
    }
    return new Response(`no stub for ${m} ${p}`, { status: 599 });
  };
  return { fetch: fetchStub, seen };
}

let env: Env;
let deps: TestDeps;
let cookie: string;
let f: Fake;
let stub: ReturnType<typeof payFetch>;
let d: TestDeps;
let appId: string;
let buildToken: string;

const base = () => `/api/dev/apps/${appId}/applepay`;
const call = (method: string, path: string, body?: unknown, who = cookie) => handle(api(who, method, path, body), env, d);
const view = async () => (await (await call("GET", base())).json()) as Record<string, any>;
const writes = () => stub.seen.filter((s) => s.method !== "GET").map((s) => `${s.method} ${s.path}`);
const sent = (method: string, path: string) => stub.seen.filter((s) => s.method === method && s.path === path).map((s) => s.body!.data);
const appleCalls = () => stub.seen.filter((s) => s.path.startsWith("/v1/"));

// TestFlight set up for a platform, with the App Store profile Apple made before Apple Pay.
async function setUpPlatform(platform: "ios" | "macos" | "tvos", profileType: string, bundleId = "bid-1") {
  const db = Db.from(env);
  const app = await db.platformApp((await db.appById(appId))!, platform);
  const name = platform === "ios" ? "Poker Night App Store" : `Poker Night App Store ${platform}`;
  const id = `prof-${platform}`;
  f.profiles.push({ id, name, profileType, bundleId, certificateId: "cert-ours", state: "ACTIVE", content: profileFixture(null, name) });
  Object.assign(app, { ascAppId: "6447402192", betaGroupId: `grp-${platform}`, testflightUrl: "https://testflight.apple.com/join/PokerNight", storeProfileId: id, storeProfileUuid: `uuid-${id}`, storeProfileName: name, storeProfileBase64: profileFixture(null, name) });
  await db.setAppTestflight(app);
}

beforeEach(async () => {
  env = testEnv();
  await clearDb(env);
  deps = testDeps();
  f = fake();
  stub = payFetch(f);
  d = { ...deps, fetch: stub.fetch };
  cookie = await signIn(env, deps);
  await saveAppleSecrets(env, deps, cookie);
  expect((await handle(api(cookie, "POST", "/api/dev/signing", { csr: CSR, privateKey: await rsaPem() }), env, { ...deps, fetch: fakeFetch(appleRoutes()).fetch })).status).toBe(201);
  const made = await handle(api(cookie, "POST", "/api/dev/apps", { name: "Poker Night", repo: "club/poker-night", bundleId: "com.example.pokernight", tagline: "Thursday table, house rules included" }), env, deps);
  ({ app: { id: appId }, buildToken } = (await made.json()) as { app: { id: string }; buildToken: string });
  await setUpPlatform("ios", "IOS_APP_STORE");
});

describe("Apple Pay", () => {
  it("refuses Apple Pay work before TestFlight is set up, for another developer, and for a disabled target", async () => {
    const other = await handle(api(cookie, "POST", "/api/dev/apps", { name: "Poker Night league table", repo: "club/league", bundleId: "com.example.league" }), env, deps);
    const otherId = ((await other.json()) as { app: { id: string } }).app.id;
    expect(await (await call("GET", `/api/dev/apps/${otherId}/applepay`)).json()).toMatchObject({ setUp: false, needs: "testflight", step: null, entitlement: "com.apple.developer.in-app-payments", merchant: { suggested: { identifier: "merchant.com.example.league", name: "Poker Night league table" } } });
    for (const [action, body] of [["merchant", {}], ["certificate", { csr: CSR }], ["confirm", undefined], ["profiles", undefined]] as const) {
      const res = await call("POST", `/api/dev/apps/${otherId}/applepay/${action}`, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: NOT_SET_UP });
    }
    expect(NOT_SET_UP).toBe("Set up TestFlight for iPhone and iPad first: Apple Pay goes into the App Store profile TestFlight makes.");

    const stranger = await signIn(env, deps, { id: 9, login: "sue", name: "Sue" });
    for (const [method, path] of [["GET", ""], ["POST", "/merchant"], ["POST", "/certificate"], ["POST", "/confirm"], ["POST", "/profiles"], ["GET", "/certificate/C1"]] as const) {
      expect((await call(method, `${base()}${path}`, method === "POST" ? {} : undefined, stranger)).status).toBe(404);
    }

    await Db.from(env).setAppTarget(appId, "ios", false);
    for (const action of ["merchant", "certificate", "confirm", "profiles"]) {
      const res = await call("POST", `${base()}/${action}`, {});
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Target is disabled." });
    }
    expect((await call("GET", base())).status).toBe(200);
    expect(appleCalls().filter((s) => s.method !== "GET")).toEqual([]);
  });

  it("creates the merchant identifier from the bundle identifier, turns Apple Pay on for the App ID and makes the profile again", async () => {
    expect(await view()).toMatchObject({ setUp: true, needs: null, step: "merchant", merchant: { id: null, identifier: null, suggested: { identifier: MERCHANT, name: "Poker Night" }, team: [], done: false }, certificate: { items: [], done: false }, capability: { appIds: [], done: false }, profiles: { items: [{ platform: "ios", label: "iPhone and iPad", profileName: "Poker Night App Store", merchantIdentifiers: [], carries: false }], done: false } });
    const res = await call("POST", `${base()}/merchant`);
    expect(res.status).toBe(200);
    expect(sent("POST", "/v1/merchantIds")).toEqual([{ type: "merchantIds", attributes: { identifier: MERCHANT, name: "Poker Night" } }]);
    expect(sent("POST", "/v1/bundleIdCapabilities")).toEqual([{ type: "bundleIdCapabilities", attributes: { capabilityType: "APPLE_PAY" }, relationships: { bundleId: { data: { type: "bundleIds", id: "bid-1" } } } }]);
    // The changed App ID invalidated its profile, so it is made again at once; it carries no merchant identifier yet.
    expect(writes()).toEqual(["POST /v1/merchantIds", "POST /v1/bundleIdCapabilities", "DELETE /v1/profiles/prof-ios", "POST /v1/profiles"]);
    expect(await res.json()).toMatchObject({
      step: "certificate",
      merchant: { id: "M1", identifier: MERCHANT, name: "Poker Night", team: null, done: true, error: null },
      capability: { appIds: [{ id: "bid-1", identifier: "com.example.pokernight", platforms: ["ios"], page: "https://developer.apple.com/account/resources/identifiers/bundleId/edit/bid-1" }], turnedOnAt: deps.now().toISOString(), tickedAt: null, done: false },
      profiles: { items: [{ platform: "ios", merchantIdentifiers: [], carries: false }], done: false },
    });
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string; detail: string }[] };
    expect(log.events[0]).toMatchObject({ event: "apple-pay-merchant-set", detail: `Poker Night: ${MERCHANT}` });

    // Again: the merchant identifier is found and the capability is on, so Apple receives nothing.
    const before = writes().length;
    expect((await call("POST", `${base()}/merchant`, {})).status).toBe(200);
    expect(writes().slice(before)).toEqual([]);
    for (const bad of [{ identifier: "com.example.pokernight" }, { identifier: "merchant" }, { name: "&&" }, { colour: "green" }, ["merchant.x.y"]]) {
      expect((await call("POST", `${base()}/merchant`, bad)).status).toBe(400);
    }
  });

  it("reuses a merchant identifier the team has, listed while none is chosen", async () => {
    f.merchants.push({ id: "M-club", identifier: "merchant.club.poker", name: "Poker Club" });
    expect((await view()).merchant.team).toEqual([{ identifier: "merchant.club.poker", name: "Poker Club" }]);
    const res = await call("POST", `${base()}/merchant`, { identifier: "merchant.club.poker" });
    expect(res.status).toBe(200);
    expect(sent("POST", "/v1/merchantIds")).toEqual([]);
    expect(((await res.json()) as Record<string, any>).merchant).toMatchObject({ id: "M-club", identifier: "merchant.club.poker", name: "Poker Club", done: true });
  });

  it("makes the Payment Processing certificate from the processor's request and offers it as a .cer file", async () => {
    const early = await call("POST", `${base()}/certificate`, { csr: CSR });
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "Choose the merchant identifier first; the certificate belongs to it." });
    await call("POST", `${base()}/merchant`);
    for (const bad of [{}, { csr: "not a request" }, { csr: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" }]) expect((await call("POST", `${base()}/certificate`, bad)).status).toBe(400);
    const res = await call("POST", `${base()}/certificate`, { csr: CSR });
    expect(res.status).toBe(200);
    expect(sent("POST", "/v1/certificates")).toEqual([{ type: "certificates", attributes: { certificateType: "APPLE_PAY", csrContent: CSR.trim() }, relationships: { merchantId: { data: { type: "merchantIds", id: "M1" } } } }]);
    const after = (await res.json()) as Record<string, any>;
    expect(after).toMatchObject({ step: "capability", certificate: { done: true, error: null, renewBy: "2028-10-17T10:00:00.000Z", items: [{ name: `Apple Pay Payment Processing: ${MERCHANT}`, serialNumber: "7A1B3", expirationDate: "2028-11-16T10:00:00.000+00:00", renewBy: "2028-10-17T10:00:00.000Z", activated: true }] } });
    const cert = after.certificate.items[0];
    expect(cert.download).toBe(`/api/dev/apps/${appId}/applepay/certificate/${cert.id}`);
    expect(after.certificate.activeId).toBe(cert.id);

    const file = await call("GET", cert.download);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("application/pkix-cert");
    expect(file.headers.get("Content-Disposition")).toBe(`attachment; filename="${MERCHANT}.cer"`);
    expect(file.headers.get("Cache-Control")).toBe("no-store");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([...CER].map((c) => c.charCodeAt(0)));
    expect((await call("GET", `${base()}/certificate/C999`)).status).toBe(404);
    expect((await call("GET", `${base()}/certificate/${cert.id}`, undefined, await signIn(env, deps, { id: 9, login: "sue", name: "Sue" }))).status).toBe(404);

    // A second certificate is made inactive while the first is in use; the card lists both, newest first.
    const second = (await (await call("POST", `${base()}/certificate`, { csr: CSR })).json()) as Record<string, any>;
    expect(second.certificate.items.map((c: Record<string, unknown>) => c.activated)).toEqual([false, true]);
    expect(second.certificate.activeId).toBe(cert.id);
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string; detail: string }[] };
    expect(log.events[0]).toMatchObject({ event: "apple-pay-certificate-created", detail: `Poker Night: ${MERCHANT} 7A1B4` });
  });

  it("waits for the developer's tick, then makes the profiles again until they carry the merchant identifier", async () => {
    await call("POST", `${base()}/merchant`);
    await call("POST", `${base()}/certificate`, { csr: CSR });
    const early = await call("POST", `${base()}/profiles`);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "Tick the merchant identifier on the App ID first, then press I have ticked it." });

    // Confirmed without the tick at Apple: the profile Apple makes carries no merchant identifier.
    const unticked = (await (await call("POST", `${base()}/confirm`)).json()) as Record<string, any>;
    expect(unticked).toMatchObject({ step: "profiles", capability: { tickedAt: deps.now().toISOString(), done: true }, profiles: { items: [{ platform: "ios", merchantIdentifiers: [], carries: false }], done: false, error: null } });

    f.ticked["bid-1"] = [MERCHANT];
    const before = writes().length;
    const ticked = (await (await call("POST", `${base()}/profiles`)).json()) as Record<string, any>;
    expect(writes().slice(before)).toEqual([expect.stringMatching(/^DELETE \/v1\/profiles\/prof-\d+$/), "POST /v1/profiles"]);
    expect(sent("POST", "/v1/profiles").at(-1)).toMatchObject({ attributes: { name: "Poker Night App Store", profileType: "IOS_APP_STORE" }, relationships: { bundleId: { data: { id: "bid-1" } }, certificates: { data: [{ id: "cert-ours" }] } } });
    expect(ticked).toMatchObject({ step: null, profiles: { items: [{ platform: "ios", merchantIdentifiers: [MERCHANT], carries: true }], done: true, madeAt: deps.now().toISOString() } });
    // A profile that carries it is kept.
    const kept = writes().length;
    expect((await call("POST", `${base()}/profiles`)).status).toBe(200);
    expect(writes().slice(kept)).toEqual([]);

    // Builds get the profile with the entitlement.
    const signing = await handle(api(null, "GET", `/api/build/${appId}/ios/signing`, undefined, { Authorization: `Bearer ${buildToken}` }), env, d);
    expect(signing.status).toBe(200);
    const served = ((await signing.json()) as { storeProfile: { profileBase64: string } }).storeProfile.profileBase64;
    expect(profileMerchants(served)).toEqual([MERCHANT]);
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string }[] };
    expect(log.events.map((e) => e.event)).toEqual(expect.arrayContaining(["apple-pay-ticked", "apple-pay-profiles-made"]));
  });

  it("covers Mac with its own profile on the same App ID, and leaves Apple TV out", async () => {
    await setUpPlatform("macos", "MAC_CATALYST_APP_STORE");
    await setUpPlatform("tvos", "TVOS_APP_STORE");
    const chosen = (await (await call("POST", `${base()}/merchant`)).json()) as Record<string, any>;
    expect(sent("POST", "/v1/bundleIdCapabilities")).toHaveLength(1);
    expect(chosen.capability.appIds).toEqual([expect.objectContaining({ id: "bid-1", platforms: ["ios", "macos"] })]);
    expect(sent("POST", "/v1/profiles").map((p) => p.attributes.profileType)).toEqual(["IOS_APP_STORE", "MAC_CATALYST_APP_STORE"]);
    f.ticked["bid-1"] = [MERCHANT];
    const done = (await (await call("POST", `${base()}/confirm`)).json()) as Record<string, any>;
    expect(done.profiles.items.map((p: Record<string, unknown>) => [p.platform, p.carries])).toEqual([["ios", true], ["macos", true]]);
    expect(f.profiles.find((p) => p.profileType === "TVOS_APP_STORE")!.id).toBe("prof-tvos");
    expect(stub.seen.some((s) => s.method === "DELETE" && s.path === "/v1/profiles/prof-tvos")).toBe(false);

    // A Mac target switched off is left as it is.
    await Db.from(env).setAppTarget(appId, "macos", false);
    f.ticked["bid-1"] = [MERCHANT, "merchant.club.poker"];
    for (const profile of f.profiles) profile.state = "INVALID";
    const before = sent("POST", "/v1/profiles").length;
    expect((await call("POST", `${base()}/profiles`)).status).toBe(200);
    expect(sent("POST", "/v1/profiles").slice(before).map((p) => p.attributes.profileType)).toEqual(["IOS_APP_STORE"]);
  });

  it("explains a key without the Admin role in plain words", async () => {
    f.deny = true;
    const res = await call("POST", `${base()}/merchant`);
    expect(res.status).toBe(502);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("Your App Store Connect key does not allow this. Apple lets only the Account Holder and Admins make merchant identifiers, Payment Processing certificates and App ID capabilities: make a team key with the Admin role in App Store Connect, Users and Access, Integrations, and save it in Settings.");
    expect(await view()).toMatchObject({ step: "merchant", merchant: { done: false, error } });
    f.deny = false;
    await call("POST", `${base()}/merchant`);
    f.deny = true;
    const refused = await call("POST", `${base()}/certificate`, { csr: CSR });
    expect(refused.status).toBe(502);
    expect(await view()).toMatchObject({ step: "certificate", merchant: { error: null }, certificate: { done: false, error } });
  });
});

describe("the Apple Pay entitlement in a profile", () => {
  it("reads the merchant identifiers, none without the entitlement, and nothing from a profile it cannot read", () => {
    expect(profileMerchants(profileFixture([MERCHANT, "merchant.club.poker"]))).toEqual([MERCHANT, "merchant.club.poker"]);
    expect(profileMerchants(profileFixture([]))).toEqual([]);
    expect(profileMerchants(profileFixture(null))).toEqual([]);
    expect(profileMerchants(btoa("not a profile"))).toBeNull();
    expect(profileMerchants("%%%")).toBeNull();
    expect(profileMerchants(null)).toBeNull();
  });
});
