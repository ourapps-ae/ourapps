import { beforeEach, describe, expect, it } from "vitest";
import { Db } from "../src/db.js";
import type { Env } from "../src/env.js";
import { dlUrl } from "../src/flow.js";
import { fingerprint } from "../src/google.js";
import { APKS_PER_RUN, GRAPHICS_BYTES, tickGooglePlay } from "../src/googleplay.js";
import { handle } from "../src/index.js";
import { api, BASE, clearDb, GH_TOKEN, jsonRes, signIn, testDeps, testEnv, type TestDeps } from "./helpers.js";

// Google Play as ourapps sees it. Google's documentation, checked 26 November 2026:
// https://developers.google.com/identity/protocols/oauth2/service-account (the JWT and its exchange),
// https://developers.google.com/android-publisher/api-ref/rest/v3 (edits, edits.details, edits.listings, edits.images,
// edits.bundles, edits.tracks, edits.commit, applications.tracks.releases), https://developers.google.com/android-publisher/upload
// (resumable uploads) and https://developers.google.com/android-publisher/tracks (track names, staged rollouts);
// generatedapks.list and generatedapks.download with alt=media (the discovery document marks it supportsMediaDownload).

const PACKAGE = "club.pokernight.app";
const EMAIL = "ourapps@poker-night-club.iam.gserviceaccount.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAY = "androidpublisher.googleapis.com";
const encoder = new TextEncoder();

type Image = { type: string; bytes: number };
type Release = { name?: string; versionCodes: string[]; status: string; userFraction?: number; releaseNotes?: { language: string; text: string }[] };
type Edit = { images: Record<string, Image[]>; bundles: number[]; tracks: Record<string, Release[]>; listing: Record<string, unknown> | null; details: Record<string, unknown> | null };
type Fake = {
  publicKey: CryptoKey;
  claims: Record<string, unknown>[];
  headers: Record<string, unknown>[];
  tokens: Set<string>;
  exists: boolean;
  apiDisabled: boolean;
  noPermission: boolean;
  productionRefused: boolean;
  heldForReview: boolean;
  bundles: number[];
  images: Record<string, Image[]>;
  listing: Record<string, unknown> | null;
  details: Record<string, unknown>;
  tracks: Record<string, Release[]>;
  lifecycle: Record<number, string>;
  edits: Map<string, Edit>;
  sessions: Map<string, { editId: string; size: number }>;
  received: Uint8Array[];
  manifest: Record<string, unknown>;
  files: Record<string, Uint8Array>;
  runs: Record<string, Record<string, unknown>>;
  // Download IDs of the universal APKs Google has generated, per version code; notFound answers 404 for the others.
  generated: Record<number, string>;
  notFound: boolean;
  apkRedirect: string | null;
  apkChunks: number;
  apkPulled: number;
};
type Seen = { method: string; host: string; path: string; search: string; headers: Headers; body: unknown };

function png(width: number, height: number, colourType = 2, length = 64): Uint8Array {
  const b = new Uint8Array(length);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  b[24] = 8;
  b[25] = colourType;
  return b;
}

const bundleBytes = (code: number) => encoder.encode(`AAB:${code}:${"x".repeat(300)}`);
const CHUNK = 64 * 1024;
const apkChunk = (code: number, i: number) => encoder.encode(`APK:${code}:${i}:`.padEnd(CHUNK, "p"));
const CERT_HASH = "9c8f2e1a7b6d5c4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e";
const FINGERPRINT = "9C:8F:2E:1A:7B:6D:5C:4E:3F:2A:1B:0C:9D:8E:7F:6A:5B:4C:3D:2E:1F:0A:9B:8C:7D:6E:5F:4A:3B:2C:1D:0E";

async function serviceAccount(): Promise<{ json: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let s = "";
  for (const b of der) s += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(s).match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  const json = JSON.stringify({ type: "service_account", project_id: "poker-night-club", private_key_id: "key-1", private_key: pem, client_email: EMAIL, client_id: "1", token_uri: TOKEN_URL });
  return { json, publicKey: pair.publicKey };
}

const fromB64url = (t: string) => Uint8Array.from(atob(t.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
const googleError = (code: number, message: string, status: string, reason?: string) => jsonRes({ error: { code, message, status, ...(reason ? { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }] } : {}) } }, code);

function googleFetch(f: Fake) {
  const seen: Seen[] = [];
  let n = 0;
  const fetchStub: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const raw = req.method === "GET" || req.method === "DELETE" ? null : new Uint8Array(await req.arrayBuffer());
    let body: unknown = raw;
    try {
      if (raw && raw.length && (req.headers.get("Content-Type") ?? "").includes("json")) body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      body = raw;
    }
    seen.push({ method: req.method, host: url.host, path: url.pathname, search: url.search, headers: req.headers, body });
    const m = req.method;
    const p = url.pathname;
    if (url.host === "img.example") return f.files[p] ? new Response(f.files[p], { headers: { "Content-Type": "image/png", "Content-Length": String(f.files[p].length) } }) : new Response("gone", { status: 404 });
    if (url.host === "api.github.com") {
      if (p === "/repos/club/poker-night/releases/latest") return jsonRes({ tag_name: "v1.2.0", assets: [{ name: "my-app.json", url: "https://api.github.com/repos/club/poker-night/releases/assets/1" }] });
      if (p === "/repos/club/poker-night/releases/assets/1") return jsonRes(f.manifest);
      if (p.startsWith("/repos/club/poker-night/releases/assets/")) {
        const file = f.files[p];
        return file ? new Response(file, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(file.length) } }) : new Response("not found", { status: 404 });
      }
      if (p === "/repos/club/poker-night") return jsonRes({ private: true });
      if (p === "/repos/club/poker-night/releases") return jsonRes([{ tag_name: "v1.2.0", name: "Poker Night 1.2.0", body: "Rematch button for the last table.", draft: false, prerelease: false, published_at: "2026-10-15T10:00:00Z", html_url: "", assets: [] }]);
      if (p === "/repos/club/poker-night/tags") return jsonRes([]);
      const run = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/attempts\/(\d+)$/.exec(p);
      if (run && f.runs[`${run[1]}/${run[2]}`]) return jsonRes(f.runs[`${run[1]}/${run[2]}`]);
      return new Response("not found", { status: 404 });
    }
    if (url.host === "play-apk.googleusercontent.com") return apkResponse(f, Number(url.searchParams.get("code")));
    if (url.toString() === TOKEN_URL) {
      const form = new URLSearchParams(new TextDecoder().decode(raw!));
      const [h, c, sig] = (form.get("assertion") ?? "").split(".");
      const valid = form.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" && (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", f.publicKey, fromB64url(sig ?? ""), encoder.encode(`${h}.${c}`)).catch(() => false));
      if (!valid) return jsonRes({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400);
      f.headers.push(JSON.parse(new TextDecoder().decode(fromB64url(h))));
      f.claims.push(JSON.parse(new TextDecoder().decode(fromB64url(c))));
      const token = `ya29.fake-${++n}`;
      f.tokens.add(token);
      return jsonRes({ access_token: token, expires_in: 3599, token_type: "Bearer" });
    }
    if (url.host !== PLAY) return new Response("no stub", { status: 599 });
    const session = url.searchParams.get("upload_id");
    if (m === "PUT" && session) {
      const s = f.sessions.get(session);
      if (!s) return googleError(404, "Upload session not found.", "NOT_FOUND");
      if (raw!.length !== s.size) return googleError(400, "The upload is not the declared size.", "INVALID_ARGUMENT");
      f.received.push(raw!);
      const code = Number(new TextDecoder().decode(raw!).split(":")[1]);
      f.edits.get(s.editId)!.bundles.push(code);
      return jsonRes({ versionCode: code, sha256: "abc" });
    }
    if (!f.tokens.has((req.headers.get("Authorization") ?? "").replace("Bearer ", ""))) return googleError(401, "Request had invalid authentication credentials.", "UNAUTHENTICATED");
    if (f.apiDisabled) return googleError(403, "Google Play Android Developer API has not been used in project 123 before or it is disabled.", "PERMISSION_DENIED", "SERVICE_DISABLED");
    const r = /^(\/upload)?\/androidpublisher\/v3\/applications\/([^/]+)(\/.*)?$/.exec(p);
    if (!r) return new Response("no stub", { status: 599 });
    const [, upload, pkg, rest = ""] = r;
    if (pkg !== PACKAGE || !f.exists) return googleError(404, `Package not found: ${decodeURIComponent(pkg)}.`, "NOT_FOUND");
    if (f.noPermission) return googleError(403, "The caller does not have permission", "PERMISSION_DENIED");
    let x: RegExpExecArray | null;
    if (m === "GET" && (x = /^\/generatedApks\/(\d+)$/.exec(rest))) {
      const id = f.generated[Number(x[1])];
      if (!id && f.notFound) return googleError(404, "Requested entity was not found.", "NOT_FOUND");
      return jsonRes({ generatedApks: [{ certificateSha256Hash: CERT_HASH, generatedSplitApks: [{ downloadId: `split-${x[1]}`, variantId: 1, moduleName: "base", splitId: "" }], ...(id ? { generatedUniversalApk: { downloadId: id } } : {}) }] });
    }
    if (m === "GET" && (x = /^\/generatedApks\/(\d+)\/downloads\/([^/]+):download$/.exec(rest))) {
      const code = Number(x[1]);
      if (f.generated[code] !== decodeURIComponent(x[2])) return googleError(404, "Requested entity was not found.", "NOT_FOUND");
      // Without alt=media Google answers with no body.
      if (url.searchParams.get("alt") !== "media") return new Response(null, { status: 204 });
      if (f.apkRedirect) return new Response(null, { status: 302, headers: { Location: f.apkRedirect } });
      return apkResponse(f, code);
    }
    if (m === "GET" && (x = /^\/tracks\/([^/]+)\/releases$/.exec(rest))) {
      return jsonRes({ releases: (f.tracks[x[1]] ?? []).map((rel) => ({ releaseName: rel.name, track: x![1], activeArtifacts: rel.versionCodes.map((v) => ({ versionCode: Number(v) })), releaseLifecycleState: f.lifecycle[Number(rel.versionCodes[0])] ?? "RELEASE_LIFECYCLE_STATE_IN_REVIEW" })) });
    }
    if (m === "POST" && rest === "/edits") {
      const id = `edit-${++n}`;
      f.edits.set(id, { images: structuredClone(f.images), bundles: [], tracks: {}, listing: null, details: null });
      return jsonRes({ id, expiryTimeSeconds: String(Date.parse("2027-01-01T00:00:00Z") / 1000) });
    }
    const e = /^\/edits\/([^/:]+)(.*)$/.exec(rest);
    const edit = e ? f.edits.get(e[1]) : undefined;
    if (!e || !edit) return googleError(404, "This Edit has been deleted.", "NOT_FOUND");
    const [, editId, tail] = e;
    if (m === "DELETE" && tail === "") {
      f.edits.delete(editId);
      return new Response(null, { status: 204 });
    }
    if (m === "POST" && tail === ":commit") {
      if (f.productionRefused && edit.tracks.production) return googleError(400, "You can't release to production until your app has production access.", "FAILED_PRECONDITION");
      if (f.heldForReview && url.searchParams.get("changesNotSentForReview") !== "true") return googleError(400, "Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.", "INVALID_ARGUMENT");
      f.images = edit.images;
      f.bundles.push(...edit.bundles);
      if (edit.listing) f.listing = edit.listing;
      if (edit.details) Object.assign(f.details, edit.details);
      for (const [track, releases] of Object.entries(edit.tracks)) f.tracks[track] = releases;
      f.edits.delete(editId);
      return jsonRes({ id: editId });
    }
    if (tail === "/details") {
      if (m === "PATCH") edit.details = body as Record<string, unknown>;
      return jsonRes({ ...f.details, ...edit.details });
    }
    if (m === "PUT" && (x = /^\/listings\/([^/]+)$/.exec(tail))) {
      edit.listing = body as Record<string, unknown>;
      return jsonRes(body);
    }
    if ((x = /^\/listings\/([^/]+)\/([A-Za-z]+)$/.exec(tail))) {
      const type = x[2];
      if (m === "DELETE") {
        const deleted = edit.images[type] ?? [];
        edit.images[type] = [];
        return jsonRes({ deleted });
      }
      if (m === "POST" && upload && url.searchParams.get("uploadType") === "media") {
        (edit.images[type] ??= []).push({ type: req.headers.get("Content-Type") ?? "", bytes: raw!.length });
        return jsonRes({ image: { id: `img-${++n}`, url: "https://play-lh.example/img", sha1: "x" } });
      }
    }
    if (tail === "/bundles" && m === "GET") return jsonRes({ kind: "androidpublisher#bundlesListResponse", bundles: [...f.bundles, ...edit.bundles].map((versionCode) => ({ versionCode })) });
    if (tail === "/bundles" && m === "POST" && upload && url.searchParams.get("uploadType") === "resumable") {
      const id = `up-${++n}`;
      f.sessions.set(id, { editId, size: Number(req.headers.get("X-Upload-Content-Length")) });
      return new Response(null, { status: 200, headers: { Location: `https://${PLAY}/upload/androidpublisher/v3/applications/${pkg}/edits/${editId}/bundles?uploadType=resumable&upload_id=${id}` } });
    }
    if (m === "PUT" && (x = /^\/tracks\/([^/]+)$/.exec(tail))) {
      const track = body as { track: string; releases: Release[] };
      edit.tracks[x[1]] = track.releases;
      return jsonRes(track);
    }
    return new Response(`no stub for ${m} ${p}`, { status: 599 });
  };
  return { fetch: fetchStub, seen };
}

// The APK in chunks read only as the reader asks, so a test can see that the Worker does not hold it.
function apkResponse(f: Fake, code: number): Response {
  f.apkPulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (f.apkPulled < f.apkChunks) c.enqueue(apkChunk(code, f.apkPulled++));
      else c.close();
    },
  }, { highWaterMark: 0 });
  return new Response(body, { headers: { "Content-Type": "application/vnd.android.package-archive", "Content-Length": String(CHUNK * f.apkChunks) } });
}

let env: Env;
let deps: TestDeps;
let d: TestDeps;
let f: Fake;
let stub: ReturnType<typeof googleFetch>;
let cookie: string;
let appId: string;
let buildToken: string;
let linkId: string;
let accountJson: string;

const base = () => `/api/dev/apps/${appId}/googleplay`;
const call = async (method: string, path: string, body?: unknown, who: string | null = cookie, extra: Record<string, string> = {}) => handle(api(who, method, path, body, extra), env, d);
const view = async () => (await (await call("GET", base())).json()) as Record<string, any>;
const google = () => stub.seen.filter((s) => s.host === PLAY || s.host === "oauth2.googleapis.com");
const reserve = (body?: unknown, token = buildToken) => handle(new Request(`${BASE}/api/build/${appId}/android/version-code`, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, d);

const MANIFEST = {
  schema: 1, id: "poker-night", name: "Poker Night", version: "1.2.0", description: "League night.", icon: "https://img.example/icon.png", minPlayers: 2, maxPlayers: 9,
  install: { pwa: null, android: { apk: "https://api.github.com/repos/club/poker-night/releases/assets/2", bundle: "https://api.github.com/repos/club/poker-night/releases/assets/9", applicationId: PACKAGE }, ios: null },
};

beforeEach(async () => {
  env = testEnv();
  await clearDb(env);
  deps = testDeps();
  const account = await serviceAccount();
  accountJson = account.json;
  f = {
    publicKey: account.publicKey, claims: [], headers: [], tokens: new Set(), exists: true, apiDisabled: false, noPermission: false, productionRefused: false, heldForReview: false,
    bundles: [1], images: { phoneScreenshots: [{ type: "image/png", bytes: 1 }] }, listing: null, details: { defaultLanguage: "en-GB", contactEmail: "old@example.com" }, tracks: {}, lifecycle: {},
    edits: new Map(), sessions: new Map(), received: [], manifest: structuredClone(MANIFEST),
    files: {
      "/icon.png": png(512, 512, 6), "/feature.png": png(1024, 500), "/phone-1.png": png(1080, 1920), "/phone-2.png": png(1080, 1920), "/big.png": png(1024, 1024), "/clear.png": png(1080, 1920, 6),
      "/repos/club/poker-night/releases/assets/9": bundleBytes(42),
      "/repos/club/poker-night/releases/assets/2": encoder.encode("WORKFLOW-APK"),
    },
    runs: {},
    generated: {}, notFound: false, apkRedirect: null, apkChunks: 8, apkPulled: 0,
  };
  stub = googleFetch(f);
  d = { ...deps, fetch: stub.fetch };
  cookie = await signIn(env, deps);
  expect((await handle(api(cookie, "PUT", "/api/dev/secrets", { githubToken: GH_TOKEN, googleServiceAccount: accountJson }), env, deps)).status).toBe(200);
  expect((await handle(api(cookie, "PUT", "/api/dev/review-contact", { firstName: "George", lastName: "McIntyre", email: "club@example.com", phone: "+44 7700 900123" }), env, deps)).status).toBe(200);
  const made = await handle(api(cookie, "POST", "/api/dev/apps", {
    name: "Poker Night", repo: "club/poker-night", tagline: "Thursday table, house rules included", description: "The club's league night: fixtures, scores and the table.",
    iconUrl: "https://img.example/icon.png", screenshotsByPlatform: { android: ["https://img.example/phone-1.png", "https://img.example/phone-2.png"] },
  }), env, deps);
  ({ app: { id: appId }, buildToken } = (await made.json()) as { app: { id: string }; buildToken: string });
  linkId = ((await (await handle(api(cookie, "POST", `/api/dev/apps/${appId}/links`, { label: "club" }), env, deps)).json()) as { link: { id: string } }).link.id;
});

const POLICY = { defaultPolicy: { collects: ["names"], storage: "servers", contactEmail: "club@example.com" } };

// Every step before a release, as the console takes them.
async function prepare() {
  expect((await call("PUT", base(), { app: {} })).status).toBe(200);
  expect((await call("PUT", base(), { content: POLICY, contentConfirmed: true })).status).toBe(200);
  expect((await call("PUT", base(), { listing: {}, graphics: { featureGraphicUrl: "https://img.example/feature.png" } })).status).toBe(200);
  const shots = await call("POST", `${base()}/graphics`);
  expect(((await shots.json()) as Record<string, any>).graphics).toMatchObject({ committed: true, missing: [] });
}

describe("Google Play service account", () => {
  it("keeps the key encrypted, shows only its email, and proves it with an RS256 token Google exchanges", async () => {
    for (const bad of ["not json", JSON.stringify({ type: "authorized_user" }), JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" })]) {
      expect((await call("PUT", "/api/dev/secrets", { googleServiceAccount: bad })).status).toBe(400);
    }
    const me = (await (await call("GET", "/api/dev/me")).json()) as { secrets: Record<string, unknown> };
    expect(me.secrets).toMatchObject({ googlePlay: true, googleServiceAccount: EMAIL, googlePlaySavedAt: "2026-10-16T10:00:00.000Z" });
    const blob = (await env.DB.prepare("SELECT blob FROM developer_secrets").first<{ blob: string }>())!.blob;
    expect(blob).not.toContain("PRIVATE KEY");
    expect(blob).not.toContain(EMAIL);

    // The check is for a browser session; an API key is refused before anything reaches Google.
    const key = ((await (await call("POST", "/api/dev/keys", { name: "agent" })).json()) as { key: string }).key;
    expect((await call("POST", "/api/dev/googleplay/check", undefined, null, { Authorization: `Bearer ${key}` })).status).toBe(403);
    expect(google()).toEqual([]);

    expect((await call("PUT", `/api/dev/apps/${appId}`, { androidPackage: "not a package" })).status).toBe(400);
    expect((await call("PUT", `/api/dev/apps/${appId}`, { androidPackage: PACKAGE })).status).toBe(200);
    const checked = (await (await call("POST", "/api/dev/googleplay/check")).json()) as Record<string, any>;
    expect(checked).toEqual({ ok: true, serviceAccount: EMAIL, apps: [{ id: appId, name: "Poker Night", packageName: PACKAGE, ok: true, error: null }] });
    expect(f.headers[0]).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
    const claims = f.claims[0] as { iss: string; scope: string; aud: string; iat: number; exp: number };
    expect(claims).toMatchObject({ iss: EMAIL, scope: "https://www.googleapis.com/auth/androidpublisher", aud: TOKEN_URL });
    expect(claims.exp - claims.iat).toBe(600);
    expect(google().map((s) => `${s.method} ${s.path}`)).toEqual(["POST /token", `POST /androidpublisher/v3/applications/${PACKAGE}/edits`, `DELETE /androidpublisher/v3/applications/${PACKAGE}/edits/edit-2`]);
    expect(google()[1].headers.get("Authorization")).toBe("Bearer ya29.fake-1");

    f.apiDisabled = true;
    const disabled = (await (await call("POST", "/api/dev/googleplay/check")).json()) as Record<string, any>;
    expect(disabled.apps[0].error).toMatch(/^The Google Play Android Developer API is not turned on in the service account's Google Cloud project/);
    f.publicKey = (await serviceAccount()).publicKey;
    const refused = await call("POST", "/api/dev/googleplay/check");
    expect(refused.status).toBe(502);
    expect(((await refused.json()) as { error: string }).error).toBe("Google did not accept the service account key (Invalid JWT Signature.). Save a new JSON key for it in Settings.");
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string }[] };
    expect(log.events.map((e) => e.event)).toContain("google-play-checked");

    expect((await call("PUT", "/api/dev/secrets", { googleServiceAccount: "-" })).status).toBe(200);
    expect(await view()).toMatchObject({ setUp: false, needs: "service-account", serviceAccount: null, step: null });
  });
});

describe("Google Play steps", () => {
  it("refuses work for a disabled target, for another developer, and before the key is saved", async () => {
    const stranger = await signIn(env, deps, { id: 9, login: "sue", name: "Sue" });
    for (const [method, path] of [["GET", ""], ["PUT", ""], ["POST", "/graphics"], ["POST", "/release"]] as const) {
      expect((await call(method, `${base()}${path}`, method === "GET" ? undefined : {}, stranger)).status).toBe(404);
    }
    await Db.from(env).setAppTarget(appId, "android", false);
    for (const [method, path, body] of [["PUT", "", { app: {} }], ["POST", "/graphics", undefined], ["POST", "/release", { track: "internal" }]] as const) {
      const res = await call(method, `${base()}${path}`, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Target is disabled." });
    }
    const versionCode = await reserve();
    expect(versionCode.status).toBe(409);
    expect(await versionCode.json()).toEqual({ error: "Target is disabled." });
    expect((await call("GET", base())).status).toBe(200);
    await Db.from(env).setAppTarget(appId, "android", true);
    expect((await call("PUT", "/api/dev/secrets", { googleServiceAccount: "-" })).status).toBe(200);
    const early = await call("PUT", base(), { app: { packageName: PACKAGE } });
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "Save a Google service account key in Settings first." });
    expect(google()).toEqual([]);
  });

  it("checks the app record, taking the package name from my-app.json, and explains Google's refusals plainly", async () => {
    expect(await view()).toMatchObject({ setUp: true, serviceAccount: EMAIL, packageName: PACKAGE, packageFrom: "my-app.json", step: "app", app: { done: false } });
    expect((await call("PUT", base(), { app: { packageName: "poker night" } })).status).toBe(400);
    f.exists = false;
    const missing = await call("PUT", base(), { app: {} });
    expect(missing.status).toBe(502);
    expect(((await missing.json()) as { error: string }).error).toBe(`Google Play has no app ${PACKAGE} that ${EMAIL} can see. Create the app in Play Console with this package name, upload its first bundle there by hand, and invite ${EMAIL} in Users and permissions with access to the app.`);
    f.exists = true;
    f.noPermission = true;
    const denied = (await (await call("PUT", base(), { app: {} })).json()) as { error: string };
    expect(denied.error).toBe(`${EMAIL} has no permission for this in Play Console. In Play Console, Users and permissions, give it access to this app with Release apps to testing tracks, Release to production, and Manage store presence.`);
    expect(await view()).toMatchObject({ step: "app", app: { done: false, error: denied.error } });
    f.noPermission = false;
    const found = (await (await call("PUT", base(), { app: {} })).json()) as Record<string, any>;
    expect(found).toMatchObject({ step: "content", packageFrom: "app", app: { packageName: PACKAGE, foundAt: "2026-10-16T10:00:00.000Z", done: true, error: null } });
    expect(f.edits.size).toBe(0);
    const app = (await (await call("GET", `/api/dev/apps/${appId}`)).json()) as { app: { androidPackage: string } };
    expect(app.app.androidPackage).toBe(PACKAGE);
  });

  it("serves the default privacy policy for App content, and the developer's own address replaces it", async () => {
    const answered = (await (await call("PUT", base(), { content: POLICY })).json()) as Record<string, any>;
    expect(answered.content).toMatchObject({ done: false, confirmedAt: null, defaultPolicy: { collects: ["names"], storage: "servers", contactEmail: "club@example.com", developerName: "George" } });
    const address = answered.content.policyAddress as string;
    expect(address).toMatch(/^https:\/\/ourapps\.app\/privacy\/[a-f0-9]{24}$/);
    const page = await handle(new Request(address), env, d);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("George made Poker Night and is responsible for the app and for this policy.");
    expect(((await (await call("PUT", base(), { contentConfirmed: true })).json()) as Record<string, any>).content.done).toBe(true);
    const own = (await (await call("PUT", base(), { content: { privacyPolicyUrl: "https://club.example/privacy" } })).json()) as Record<string, any>;
    expect(own.content).toMatchObject({ privacyPolicyUrl: "https://club.example/privacy", policyAddress: "https://club.example/privacy", done: true });
    expect((await handle(new Request(address), env, d)).status).toBe(404);
    expect((await call("PUT", base(), { content: { privacyPolicyUrl: "http://club.example/privacy" } })).status).toBe(400);
    expect((await call("PUT", base(), { content: { defaultPolicy: { collects: ["nothing", "names"], contactEmail: "club@example.com" } } })).status).toBe(400);
  });

  it("writes the store listing in Play's default language through an edit, within Play's limits", async () => {
    const early = await call("PUT", base(), { listing: {} });
    expect(early.status).toBe(409);
    expect((await call("PUT", base(), { app: {} })).status).toBe(200);
    expect((await view()).listing).toMatchObject({ title: "Poker Night", shortDescription: "Thursday table, house rules included", fullDescription: "The club's league night: fixtures, scores and the table.", contactEmail: "club@example.com", done: false });
    for (const bad of [{ title: "x".repeat(31) }, { shortDescription: "x".repeat(81) }, { contactEmail: "nobody" }, { contactWebsite: "http://club.example" }]) {
      expect((await call("PUT", base(), { listing: bad })).status).toBe(400);
    }
    const before = stub.seen.length;
    const saved = (await (await call("PUT", base(), { listing: { contactWebsite: "https://club.example" } })).json()) as Record<string, any>;
    expect(saved.listing).toMatchObject({ language: "en-GB", done: true, error: null });
    expect(f.listing).toEqual({ language: "en-GB", title: "Poker Night", shortDescription: "Thursday table, house rules included", fullDescription: "The club's league night: fixtures, scores and the table." });
    expect(f.details).toEqual({ defaultLanguage: "en-GB", contactEmail: "club@example.com", contactWebsite: "https://club.example" });
    const writes = stub.seen.slice(before).filter((s) => s.host === PLAY).map((s) => `${s.method} ${s.path.replace(`/androidpublisher/v3/applications/${PACKAGE}`, "")}${s.search}`);
    expect(writes).toEqual(["POST /edits", "GET /edits/edit-4/details", "PUT /edits/edit-4/listings/en-GB", "PATCH /edits/edit-4/details", "POST /edits/edit-4:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW"]);
  });

  it("uploads the graphics into one edit, replacing the old ones, says what is missing, and commits once all are in", async () => {
    expect((await call("POST", `${base()}/graphics`)).status).toBe(409);
    expect((await call("PUT", base(), { app: {}, listing: {} })).status).toBe(200);
    await call("PUT", `/api/dev/apps/${appId}`, { iconUrl: "https://img.example/big.png", screenshotsByPlatform: { android: ["https://img.example/phone-1.png", "https://img.example/clear.png", "https://img.example/gone.png"] } });
    const first = (await (await call("POST", `${base()}/graphics`)).json()) as Record<string, any>;
    expect(first.graphics).toMatchObject({
      pending: 0, committed: false, done: false,
      missing: [
        "The icon is 1024 x 1024 pixels; Google Play takes a 512 x 512 icon.",
        "Add a feature graphic: a 1024 x 500 JPEG or PNG without transparency, under Graphics on this card.",
        "Add at least 2 phone screenshots that Google Play takes, to the app's Android screenshot list: each side between 320 and 3840 pixels, the long side at most 2.3 times the short side, no transparency.",
      ],
      items: [
        { kind: "icon", width: 1024, height: 1024, uploaded: false },
        { kind: "phone", url: "https://img.example/phone-1.png", uploaded: true, error: null },
        { kind: "phone", url: "https://img.example/clear.png", uploaded: false, error: "has transparency, which Google Play does not take here; save it without an alpha channel" },
        { kind: "phone", url: "https://img.example/gone.png", uploaded: false, error: "could not be downloaded (status 404)" },
      ],
    });
    expect(f.images.phoneScreenshots).toEqual([{ type: "image/png", bytes: 1 }]);

    await call("PUT", `/api/dev/apps/${appId}`, { iconUrl: "https://img.example/icon.png", screenshotsByPlatform: { android: ["https://img.example/phone-1.png", "https://img.example/phone-2.png"] } });
    expect((await call("PUT", base(), { graphics: { featureGraphicUrl: "https://img.example/feature.png", tabletScreenshots: ["http://x"] } })).status).toBe(400);
    expect((await call("PUT", base(), { graphics: { featureGraphicUrl: "https://img.example/feature.png" } })).status).toBe(200);
    const before = stub.seen.length;
    const second = (await (await call("POST", `${base()}/graphics`)).json()) as Record<string, any>;
    expect(second.graphics).toMatchObject({ committed: true, done: true, missing: [], pending: 0 });
    expect(second.step).toBe("content");
    const calls = stub.seen.slice(before).filter((s) => s.host === PLAY).map((s) => `${s.method} ${s.path.replace(/.*\/edits\/[^/:]+/, "")}${s.search}`);
    expect(calls).toEqual([
      "POST /androidpublisher/v3/applications/club.pokernight.app/edits",
      "DELETE /listings/en-GB/icon", "DELETE /listings/en-GB/featureGraphic", "DELETE /listings/en-GB/phoneScreenshots",
      "POST /listings/en-GB/icon?uploadType=media", "POST /listings/en-GB/featureGraphic?uploadType=media", "POST /listings/en-GB/phoneScreenshots?uploadType=media", "POST /listings/en-GB/phoneScreenshots?uploadType=media",
      "POST :commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW",
    ]);
    expect(f.images).toEqual({ icon: [{ type: "image/png", bytes: 64 }], featureGraphic: [{ type: "image/png", bytes: 64 }], phoneScreenshots: [{ type: "image/png", bytes: 64 }, { type: "image/png", bytes: 64 }] });
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string; detail: string }[] };
    expect(log.events[0]).toMatchObject({ event: "google-play-graphics-uploaded", detail: "Poker Night: 4 images" });
  });

  it("bounds each graphics request by image bytes and calls, and the ten-minute schedule continues the rest", async () => {
    expect((await call("PUT", base(), { app: {}, listing: {}, graphics: { featureGraphicUrl: "https://img.example/feature.png" } })).status).toBe(200);
    const big = Array.from({ length: 5 }, (_, i) => `/phone-big-${i}.png`);
    for (const path of big) f.files[path] = png(1080, 1920, 2, 1_500_000);
    await call("PUT", `/api/dev/apps/${appId}`, { screenshotsByPlatform: { android: big.map((p) => `https://img.example${p}`) } });
    const sent = () => [...f.edits.values()][0]?.images.phoneScreenshots?.reduce((n: number, i: Image) => n + i.bytes, 0) ?? 0;
    const before = stub.seen.length;
    const first = (await (await call("POST", `${base()}/graphics`)).json()) as Record<string, any>;
    expect(GRAPHICS_BYTES).toBe(2_000_000);
    expect(stub.seen.length - before).toBeLessThanOrEqual(45);
    expect(sent()).toBe(1_500_000);
    expect(first.graphics).toMatchObject({ pending: 4, committed: false });
    for (let i = 0; i < 5; i++) {
      deps.advance(10 * 60_000);
      await tickGooglePlay(env, d);
    }
    expect((await view()).graphics).toMatchObject({ pending: 0, committed: true, missing: [] });
    expect(f.images.phoneScreenshots.map((i) => i.bytes)).toEqual([1_500_000, 1_500_000, 1_500_000, 1_500_000, 1_500_000]);
  });
});

describe("Google Play releases", () => {
  it("sends the bundle through a resumable session, puts it on the chosen track with its notes, and commits", async () => {
    const early = await call("POST", `${base()}/release`, { track: "internal" });
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "Finish these steps first: App record, App content, Store listing, Graphics." });
    await prepare();
    for (const bad of [{}, { track: "staging" }, { track: "production", userFraction: 1.5 }, { track: "alpha", releaseNotes: "x".repeat(501) }, { track: "alpha", colour: "green" }]) {
      expect((await call("POST", `${base()}/release`, bad)).status).toBe(400);
    }
    f.manifest = { ...MANIFEST, install: { ...MANIFEST.install, android: { apk: MANIFEST.install.android.apk } } };
    const noBundle = await call("POST", `${base()}/release`, { track: "internal" });
    expect(noBundle.status).toBe(409);
    expect(((await noBundle.json()) as { error: string }).error).toBe("The latest release has no Android App Bundle. The release workflow builds the .aab, uploads it with the release and names it in my-app.json as install.android.bundle.");
    f.manifest = structuredClone(MANIFEST);

    const before = stub.seen.length;
    const res = await call("POST", `${base()}/release`, { track: "internal" });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Record<string, any>;
    expect(after.releases[0]).toMatchObject({ track: "internal", version: "1.2.0", versionCode: 42, status: "completed", userFraction: null, stage: "sent" });
    const calls = stub.seen.slice(before).filter((s) => s.host === PLAY);
    expect(calls.map((s) => `${s.method} ${s.path.replace(`/applications/${PACKAGE}`, "").replace(/edit-\d+/, "*")}${s.search.replace(/upload_id=[\w-]+/, "upload_id=*")}`)).toEqual([
      "POST /androidpublisher/v3/edits",
      "POST /upload/androidpublisher/v3/edits/*/bundles?uploadType=resumable",
      "PUT /upload/androidpublisher/v3/edits/*/bundles?uploadType=resumable&upload_id=*",
      "PUT /androidpublisher/v3/edits/*/tracks/qa",
      "POST /androidpublisher/v3/edits/*:commit",
      "GET /androidpublisher/v3/generatedApks/42",
    ]);
    expect(calls[1].headers.get("X-Upload-Content-Type")).toBe("application/octet-stream");
    expect(calls[1].headers.get("X-Upload-Content-Length")).toBe(String(bundleBytes(42).length));
    expect(f.received[0]).toEqual(bundleBytes(42));
    expect(calls[3].body).toEqual({ track: "qa", releases: [{ name: "1.2.0 (42)", versionCodes: ["42"], status: "completed", releaseNotes: [{ language: "en-GB", text: "Rematch button for the last table." }] }] });
    expect(f.bundles).toContain(42);
    expect(f.edits.size).toBe(0);

    // A staged rollout to production, with the developer's own notes.
    f.files["/repos/club/poker-night/releases/assets/9"] = bundleBytes(43);
    const staged = (await (await call("POST", `${base()}/release`, { track: "production", userFraction: 0.2, releaseNotes: "Bigger chip numbers." })).json()) as Record<string, any>;
    expect(staged.releases[0]).toMatchObject({ track: "production", versionCode: 43, status: "inProgress", userFraction: 0.2 });
    expect(f.tracks.production).toEqual([{ name: "1.2.0 (43)", versionCodes: ["43"], status: "inProgress", userFraction: 0.2, releaseNotes: [{ language: "en-GB", text: "Bigger chip numbers." }] }]);
    const log = (await (await call("GET", "/api/dev/audit")).json()) as { events: { event: string; detail: string }[] };
    expect(log.events[0]).toMatchObject({ event: "google-play-released", detail: "Poker Night 1.2.0 (43) to production, 20%" });
  });

  it("shows Google's refusal of production with the testing rule, counts the closed test's days, and holds changes Google will not send", async () => {
    await prepare();
    f.productionRefused = true;
    const refused = await call("POST", `${base()}/release`, { track: "production" });
    expect(refused.status).toBe(502);
    expect(((await refused.json()) as { error: string }).error).toBe("Google Play did not accept this: You can't release to production until your app has production access. A personal Google Play developer account created after 13 November 2023 can release to production only after a closed test with at least 12 testers opted in for 14 days in a row, and Google granting production access in Play Console.");
    expect(f.edits.size).toBe(0);
    expect((await view()).testing).toMatchObject({ firstClosedAt: null, days: null });
    expect((await call("POST", `${base()}/release`, { track: "alpha" })).status).toBe(200);
    deps.advance(3 * 86_400_000 + 3600_000);
    expect((await view()).testing).toEqual({ firstClosedAt: "2026-10-16T10:00:00.000Z", days: 3, requiredDays: 14, readyAt: "2026-10-30T10:00:00.000Z", testingLink: false });

    f.heldForReview = true;
    f.files["/repos/club/poker-night/releases/assets/9"] = bundleBytes(44);
    const held = (await (await call("POST", `${base()}/release`, { track: "alpha" })).json()) as Record<string, any>;
    expect(held.releases[0]).toMatchObject({ versionCode: 44, stage: "not-sent", message: "Google holds this release until you send it for review in Play Console, Publishing overview." });
    expect(stub.seen.filter((s) => s.path.endsWith(":commit")).slice(-2).map((s) => s.search)).toEqual(["", "?changesNotSentForReview=true"]);
    expect(held.testing.firstClosedAt).toBe("2026-10-16T10:00:00.000Z");
  });

  it("follows each release to Google's answer, and offers Google Play on the install page once production is live", async () => {
    await prepare();
    expect((await call("POST", `${base()}/release`, { track: "production" })).status).toBe(200);
    const page = async () => ((await (await handle(api(null, "GET", `/api/public/links/${linkId}`), env, d)).json()) as { release: { googlePlay: Record<string, string | null>; install: { android: Record<string, string> } } });
    expect((await page()).release.googlePlay).toEqual({ store: null, testing: null });
    expect(Object.keys((await page()).release.install.android)).toEqual(["apk"]);
    const tick = async (state: string) => {
      f.lifecycle[42] = state;
      deps.advance(10 * 60_000);
      await tickGooglePlay(env, d);
      return (await view()).releases[0] as Record<string, unknown>;
    };
    expect(await tick("RELEASE_LIFECYCLE_STATE_IN_REVIEW")).toMatchObject({ stage: "in-review", googleState: "RELEASE_LIFECYCLE_STATE_IN_REVIEW", message: null });
    expect(await tick("RELEASE_LIFECYCLE_STATE_NOT_APPROVED")).toMatchObject({ stage: "rejected", message: "Google's review did not approve this release. Google's reasons are in Play Console, under Policy status and in its email. Fix what Google asks for, then release again." });
    // A rejected release is not followed; the next one is.
    f.files["/repos/club/poker-night/releases/assets/9"] = bundleBytes(45);
    expect((await call("POST", `${base()}/release`, { track: "production" })).status).toBe(200);
    f.lifecycle[45] = "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED";
    deps.advance(10 * 60_000);
    await tickGooglePlay(env, d);
    expect((await view()).releases[0]).toMatchObject({ versionCode: 45, stage: "approved", message: "Google approved this release. Managed publishing is on for the app, so it goes live when you press Publish changes in Play Console, Publishing overview." });
    f.lifecycle[45] = "RELEASE_LIFECYCLE_STATE_PUBLISHED";
    deps.advance(10 * 60_000);
    await tickGooglePlay(env, d);
    const live = await view();
    expect(live.releases[0]).toMatchObject({ stage: "live", liveAt: "2026-10-16T10:40:00.000Z" });
    expect(live.live).toEqual({ production: true, url: `https://play.google.com/store/apps/details?id=${PACKAGE}` });
    expect((await page()).release.googlePlay).toEqual({ store: `https://play.google.com/store/apps/details?id=${PACKAGE}`, testing: null });
    const latest = (await (await handle(api(null, "GET", `/api/public/links/${linkId}/latest`), env, d)).json()) as { googlePlay: Record<string, string | null> };
    expect(latest.googlePlay.store).toBe(`https://play.google.com/store/apps/details?id=${PACKAGE}`);
    const followed = stub.seen.filter((s) => s.path.endsWith("/releases")).map((s) => s.path);
    expect(followed.at(-1)).toBe(`/androidpublisher/v3/applications/${PACKAGE}/tracks/production/releases`);

    // A live closed test's opt-in page is offered only when the developer chooses.
    f.files["/repos/club/poker-night/releases/assets/9"] = bundleBytes(46);
    expect((await call("POST", `${base()}/release`, { track: "alpha" })).status).toBe(200);
    f.lifecycle[46] = "RELEASE_LIFECYCLE_STATE_PUBLISHED";
    deps.advance(10 * 60_000);
    await tickGooglePlay(env, d);
    expect((await page()).release.googlePlay.testing).toBeNull();
    expect((await call("PUT", base(), { testingLink: true })).status).toBe(200);
    expect((await page()).release.googlePlay.testing).toBe(`https://play.google.com/apps/testing/${PACKAGE}`);
    // Turning Android off removes the Google Play links with the APK.
    await Db.from(env).setAppTarget(appId, "android", false);
    expect((await page()).release.googlePlay).toEqual({ store: null, testing: null });
  });
});

describe("Google Play's signed APK", () => {
  const page = async () => (await (await handle(api(null, "GET", `/api/public/links/${linkId}`), env, d)).json()) as Record<string, any>;
  const latest = async () => (await (await handle(api(null, "GET", `/api/public/links/${linkId}/latest`), env, d)).json()) as Record<string, any>;
  const linkOf = (url: string) => JSON.parse(new TextDecoder().decode(fromB64url(new URL(url).pathname.split("/")[2].split(".")[0]))) as Record<string, unknown>;
  const download = (url: string) => handle(new Request(url), env, d);
  const apkBytes = (code: number) => {
    const out = new Uint8Array(CHUNK * f.apkChunks);
    for (let i = 0; i < f.apkChunks; i++) out.set(apkChunk(code, i), i * CHUNK);
    return out;
  };
  const workflowApkFetched = () => stub.seen.some((s) => s.path === "/repos/club/poker-night/releases/assets/2");
  const since = (n: number) => stub.seen.slice(n).map((s) => `${s.method} ${s.host}${s.path.replace(`/androidpublisher/v3/applications/${PACKAGE}`, "")}${s.search}`);
  const release = async (code: number, version = "1.2.0") => {
    f.files["/repos/club/poker-night/releases/assets/9"] = bundleBytes(code);
    f.manifest = { ...structuredClone(MANIFEST), version };
    expect((await call("POST", `${base()}/release`, { track: "internal" })).status).toBe(200);
  };
  const PREPARING = "Google Play is preparing the Android download of this version, which usually takes a few minutes. Try again shortly.";

  it("gives Google Play's APK as the Android download once ourapps has released the app there, streamed, one call to Google each", async () => {
    await prepare();
    const before = await page();
    expect(linkOf(before.release.install.android.apk)).toMatchObject({ kind: "apk", url: MANIFEST.install.android.apk });
    expect(before.release.androidVersion).toBe("1.2.0");
    expect((await view()).apk).toBeNull();

    await release(42);
    expect((await view()).apk).toEqual({ offered: null, waiting: { versionCode: 42, version: "1.2.0", checkedAt: "2026-10-16T10:00:00.000Z", error: null } });
    const waiting = await page();
    expect(linkOf(waiting.release.install.android.apk)).toMatchObject({ kind: "playapk", url: "", app: appId, code: 42 });
    expect(waiting.deliveryRevision).not.toBe(before.deliveryRevision);
    // Until Google has generated it, the download says so; the workflow's APK, signed with another key, is never given.
    const early = await download(waiting.release.install.android.apk);
    expect(early.status).toBe(503);
    expect(await early.json()).toEqual({ error: PREPARING });

    f.generated[42] = "dl-42";
    deps.advance(10 * 60_000);
    await tickGooglePlay(env, d);
    expect((await view()).apk).toEqual({ offered: { versionCode: 42, version: "1.2.0", certificateSha256: FINGERPRINT, foundAt: "2026-10-16T10:10:00.000Z", error: null }, waiting: null });

    const ready = await page();
    expect(ready.deliveryRevision).toBe(waiting.deliveryRevision);
    for (let i = 0; i < 2; i++) {
      const n = stub.seen.length;
      const res = await download(ready.release.install.android.apk);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/vnd.android.package-archive");
      expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="app.apk"');
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      // The answer leaves before Google's APK is read; the bytes pass through as the phone reads them.
      expect(f.apkPulled).toBeLessThan(2);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(apkBytes(42));
      expect(f.apkPulled).toBe(f.apkChunks);
      expect(since(n)).toEqual(["POST oauth2.googleapis.com/token", `GET ${PLAY}/generatedApks/42/downloads/dl-42:download?alt=media`]);
      expect(stub.seen.at(-1)!.headers.get("Authorization")).toMatch(/^Bearer ya29\.fake-\d+$/);
    }

    const update = await latest();
    expect(update.version).toBe("1.2.0");
    expect(update.android).toEqual({ apkUrl: expect.stringMatching(/^https:\/\/ourapps\.app\/dl\//), version: "1.2.0" });
    expect(linkOf(update.android.apkUrl)).toMatchObject({ kind: "playapk", app: appId, code: 42 });
    expect(update.deliveryRevision).toBe(ready.deliveryRevision);
    expect(workflowApkFetched()).toBe(false);
  });

  it("keeps the last Play-signed APK while a newer GitHub release waits for Google Play, then gives the newer one once Google has it", async () => {
    await prepare();
    f.generated[42] = "dl-42";
    await release(42);
    // Google already had it when the release was sent.
    expect((await view()).apk.offered).toMatchObject({ versionCode: 42, foundAt: "2026-10-16T10:00:00.000Z" });

    f.manifest = { ...structuredClone(MANIFEST), version: "1.3.0" };
    const newer = await page();
    expect(newer.release.version).toBe("1.3.0");
    expect(newer.release.androidVersion).toBe("1.2.0");
    expect(linkOf(newer.release.install.android.apk)).toMatchObject({ kind: "playapk", code: 42 });
    const update = await latest();
    expect(update).toMatchObject({ version: "1.3.0", android: { version: "1.2.0" } });
    expect(linkOf(update.android.apkUrl).code).toBe(42);

    await release(43, "1.3.0");
    expect((await view()).apk).toMatchObject({ offered: { versionCode: 42, version: "1.2.0" }, waiting: { versionCode: 43, version: "1.3.0", error: null } });
    expect(linkOf((await page()).release.install.android.apk).code).toBe(42);
    expect((await latest()).android.version).toBe("1.2.0");

    f.generated[43] = "dl-43";
    deps.advance(10 * 60_000);
    await tickGooglePlay(env, d);
    const moved = await page();
    expect(moved.release.androidVersion).toBe("1.3.0");
    expect(linkOf(moved.release.install.android.apk).code).toBe(43);
    expect(moved.deliveryRevision).not.toBe(newer.deliveryRevision);
    expect((await latest()).android.version).toBe("1.3.0");
    expect((await view()).apk).toMatchObject({ offered: { versionCode: 43 }, waiting: null });
    expect(workflowApkFetched()).toBe(false);
  });

  it("finds the APK on a download when Google has it before the schedule asks, and keeps its ID", async () => {
    await prepare();
    f.notFound = true;
    await release(42);
    expect((await view()).apk.waiting).toMatchObject({ versionCode: 42, error: null });
    f.generated[42] = "dl-42";
    const url = (await page()).release.install.android.apk;
    const n = stub.seen.length;
    const res = await download(url);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(since(n)).toEqual(["POST oauth2.googleapis.com/token", `GET ${PLAY}/generatedApks/42`, `GET ${PLAY}/generatedApks/42/downloads/dl-42:download?alt=media`]);
    expect((await view()).apk.offered).toMatchObject({ versionCode: 42, certificateSha256: FINGERPRINT });
  });

  it("answers the cause and never the workflow's APK when the key is removed or Google refuses, and the card shows it", async () => {
    await prepare();
    f.generated[42] = "dl-42";
    await release(42);
    const url = (await page()).release.install.android.apk;

    expect((await call("PUT", "/api/dev/secrets", { googleServiceAccount: "-" })).status).toBe(200);
    const noKey = await download(url);
    expect(noKey.status).toBe(503);
    const keyMessage = "The Android download comes from Google Play with the developer's Google service account key, which is not saved in ourapps. The developer saves it in Settings, Google Play.";
    expect(await noKey.json()).toEqual({ error: keyMessage });
    expect((await view()).apk.offered.error).toBe(keyMessage);
    expect(linkOf((await page()).release.install.android.apk)).toMatchObject({ kind: "playapk", code: 42 });

    expect((await call("PUT", "/api/dev/secrets", { googleServiceAccount: accountJson })).status).toBe(200);
    f.noPermission = true;
    const refused = await download(url);
    expect(refused.status).toBe(502);
    const refusal = `Google Play did not give the Android download. ${EMAIL} has no permission for this in Play Console. In Play Console, Users and permissions, give it access to this app with Release apps to testing tracks, Release to production, and Manage store presence.`;
    expect(await refused.json()).toEqual({ error: refusal });
    expect((await view()).apk.offered.error).toBe(refusal);

    f.noPermission = false;
    const ok = await download(url);
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    expect((await view()).apk.offered.error).toBeNull();
    expect(workflowApkFetched()).toBe(false);
  });

  it("follows Google's download to a Google host without the access token, and to no other host", async () => {
    await prepare();
    f.generated[42] = "dl-42";
    await release(42);
    const url = (await page()).release.install.android.apk;
    f.apkRedirect = "https://play-apk.googleusercontent.com/apk?code=42";
    const res = await download(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(apkBytes(42));
    expect(stub.seen.find((s) => s.host === "play-apk.googleusercontent.com")!.headers.get("Authorization")).toBeNull();
    f.apkRedirect = "https://apk.example.com/apk?code=42";
    const refused = await download(url);
    expect(refused.status).toBe(502);
    expect(((await refused.json()) as { error: string }).error).toBe("Google Play did not give the Android download. Google Play did not accept this: Google redirected the request; no credentials were forwarded.");
    expect(stub.seen.some((s) => s.host === "apk.example.com")).toBe(false);
  });

  it("refuses a link to another developer's app or without a version code", async () => {
    await prepare();
    f.generated[42] = "dl-42";
    await release(42);
    const other = await dlUrl(env, d, { url: "", kind: "playapk", dev: "someone-else", app: appId, code: 42 });
    expect((await download(other)).status).toBe(404);
    const unknown = await dlUrl(env, d, { url: "", kind: "playapk", dev: (linkOf((await page()).release.install.android.apk).dev as string), app: appId, code: 41 });
    expect((await download(unknown)).status).toBe(404);
    const noCode = await dlUrl(env, d, { url: "", kind: "playapk", dev: "x", app: appId });
    expect((await download(noCode)).status).toBe(403);
  });

  it("asks Google for a few versions per scheduled run, least recently checked first, within the calls left", async () => {
    expect((await call("PUT", `/api/dev/apps/${appId}`, { androidPackage: PACKAGE })).status).toBe(200);
    for (const code of [11, 12, 13, 14, 15]) await Db.from(env).insertGooglePlayApk(appId, code, `1.0.${code}`, "2026-10-16T09:00:00.000Z");
    const asked = () => stub.seen.filter((s) => /\/generatedApks\/\d+$/.test(s.path)).map((s) => Number(s.path.split("/").pop()));
    await tickGooglePlay(env, d);
    expect(APKS_PER_RUN).toBe(3);
    expect(asked()).toHaveLength(3);
    deps.advance(10 * 60_000);
    await tickGooglePlay(env, d);
    expect(asked()).toHaveLength(6);
    expect(new Set(asked()).size).toBe(5);
    await tickGooglePlay(env, d, 2);
    expect(asked()).toHaveLength(6);
    for (const code of [11, 12, 13, 14, 15]) f.generated[code] = `dl-${code}`;
    for (let i = 0; i < 2; i++) {
      deps.advance(10 * 60_000);
      await tickGooglePlay(env, d);
    }
    expect(asked()).toHaveLength(11);
    deps.advance(10 * 60_000);
    await tickGooglePlay(env, d);
    expect(asked()).toHaveLength(11);
    expect((await view()).apk.offered).toMatchObject({ versionCode: 15, version: "1.0.15", certificateSha256: FINGERPRINT });
  });

  it("shows Google's certificate hash as the fingerprint providers ask for", () => {
    expect(fingerprint(CERT_HASH)).toBe(FINGERPRINT);
    expect(fingerprint(FINGERPRINT.toLowerCase())).toBe(FINGERPRINT);
    expect(fingerprint(btoa(String.fromCharCode(...FINGERPRINT.split(":").map((h) => parseInt(h, 16)))))).toBe(FINGERPRINT);
    expect(fingerprint("not a hash")).toBe("not a hash");
  });
});

describe("Android version codes", () => {
  it("hands out codes atomically above every earlier one and above Play's highest, reading Play at most every ten minutes", async () => {
    expect(await (await reserve()).json()).toEqual({ versionCode: 1 });
    expect(await (await reserve({ version: "1.2.0" })).json()).toEqual({ versionCode: 2 });
    const codes = await Promise.all(Array.from({ length: 6 }, async () => ((await (await reserve()).json()) as { versionCode: number }).versionCode));
    expect(new Set(codes).size).toBe(6);
    expect([...codes].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(google()).toEqual([]);

    await call("PUT", `/api/dev/apps/${appId}`, { androidPackage: PACKAGE });
    f.bundles = [1, 120];
    expect(await (await reserve()).json()).toEqual({ versionCode: 121 });
    expect(google().map((s) => `${s.method} ${s.path.replace(`/androidpublisher/v3/applications/${PACKAGE}`, "")}`)).toEqual(["POST /token", "POST /edits", "GET /edits/edit-2/bundles", "DELETE /edits/edit-2"]);
    const read = google().length;
    f.bundles = [500];
    expect(await (await reserve()).json()).toEqual({ versionCode: 122 });
    expect(google().length).toBe(read);
    deps.advance(11 * 60_000);
    expect(await (await reserve()).json()).toEqual({ versionCode: 501 });
    // When Play cannot be read, the code is still above what was last read and everything ourapps gave.
    deps.advance(11 * 60_000);
    f.apiDisabled = true;
    expect(await (await reserve()).json()).toEqual({ versionCode: 502 });
    await env.DB.prepare("UPDATE android_version_codes SET counter = 2100000000").run();
    const full = await reserve();
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "The Android version codes are used up: Google Play takes codes up to 2100000000." });
  });

  it("gives a run attempt the same code again, and checks the body, the token and the run", async () => {
    const run = (id: number, attempt: number, repo = "club/poker-night") => ({ id, run_attempt: attempt, workflow_id: 5, display_title: "Release 1.2.0", repository: { full_name: repo }, created_at: "2026-10-16T09:58:00Z", run_started_at: "2026-10-16T09:59:00Z" });
    f.runs = { "77/1": run(77, 1), "77/2": run(77, 2), "78/1": run(78, 1, "someone/else") };
    const first = await (await reserve({ version: "1.2.0", runId: "77", runAttempt: "1" })).json();
    expect(first).toEqual({ versionCode: 1 });
    expect(await (await reserve({ version: "1.2.0", runId: 77, runAttempt: 1 })).json()).toEqual({ versionCode: 1 });
    expect(await (await reserve({ runId: "77", runAttempt: "2" })).json()).toEqual({ versionCode: 2 });
    const same = await Promise.all([reserve({ runId: "77", runAttempt: "1" }), reserve({ runId: "77", runAttempt: "1" })]);
    for (const res of same) expect(await res.json()).toEqual({ versionCode: 1 });
    expect((await reserve({ runId: "78", runAttempt: "1" })).status).toBe(400);
    expect((await reserve({ runId: "79", runAttempt: "1" })).status).toBe(409);
    for (const bad of [{ runId: "77" }, { runId: "0", runAttempt: "1" }, { version: "one two" }, { build: 3 }, ["x"]]) expect((await reserve(bad)).status).toBe(400);
    expect((await reserve(undefined, "0".repeat(48))).status).toBe(401);
    const malformed = await handle(new Request(`${BASE}/api/build/${appId}/android/version-code`, { method: "POST", headers: { Authorization: `Bearer ${buildToken}` }, body: "{" }), env, d);
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("Cache-Control")).toBe("no-store");
  });
});
