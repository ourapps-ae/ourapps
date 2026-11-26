import { TERMS_VERSION } from "@my/store-shared";
import { currentDeveloper, finishLogin, logout, logoutEverywhere, oauthConfigured, requireDeveloper, requireTerms, startLogin } from "./auth.js";
import { defaultDeps, type Deps, type Env } from "./env.js";
import { randomId } from "./crypto.js";
import { HttpError, json } from "./http.js";
import { buildTargets, buildSigning, buildTestflight, buildUploadFileOperations, buildUploadFileStatus, buildDistributionStatus } from "./routes/build.js";
import { tickTestflight } from "./testflight.js";
import { privacyPage, tickAppStore } from "./appstore.js";
import * as dev from "./routes/dev.js";
import { devPage, linkLatest, linkPage, linkQr, serveArtefact } from "./routes/public.js";
import { serveWebApp, webAppLinkId } from "./webapp.js";

// Sent on every response so browsers and scanners see a locked-down site.
export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};

// HttpError messages are written for clients; anything else may carry internal detail, so it is
// logged and the client gets a reference only.
export function errorResponse(request: Request, err: unknown): Response {
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error(err.message);
    return json({ error: err.message }, err.status);
  }
  const ref = request.headers.get("cf-ray") ?? randomId(6);
  console.error(`unexpected error ${ref}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  return json({ error: `something went wrong (reference ${ref})` }, 500);
}

export async function handle(request: Request, env: Env, deps: Deps = defaultDeps): Promise<Response> {
  // Per-link app hosts get the bundle and nothing else; they set their own headers.
  const webLink = webAppLinkId(request, env);
  if (webLink) return serveWebApp(request, env, deps, webLink);
  let res: Response;
  try {
    res = await route(request, env, deps);
  } catch (err) {
    res = errorResponse(request, err);
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  return res;
}

async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const m = request.method;

  if (parts[0] === "dl" && parts.length === 2 && m === "GET") return serveArtefact(env, deps, parts[1]);
  if (parts[0] === "privacy" && parts.length === 2 && m === "GET") return privacyPage(env, parts[1]);
  if (parts[0] !== "api") {
    const verification = env.GOOGLE_SITE_VERIFICATION;
    if (verification && parts.length === 1 && parts[0] === verification && m === "GET") {
      return new Response(`google-site-verification: ${verification}`, { headers: { "Content-Type": "text/html" } });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    throw new HttpError(404, "not found");
  }
  const p = parts.slice(1);

  if (p[0] === "health" && m === "GET") return json({ ok: true, oauth: oauthConfigured(env), links: Boolean(env.LINK_SECRET), secrets: Boolean(env.MASTER_KEY) });

  if (p[0] === "auth") {
    if (p[1] === "github" && m === "GET") return startLogin(env);
    if (p[1] === "callback" && m === "GET") return finishLogin(request, env, deps);
    // The site asks who is signed in on every page; a visitor gets null, not an error.
    if (p[1] === "session" && m === "GET") {
      const me = await currentDeveloper(request, env, deps);
      return me ? dev.me(env, me) : json(null);
    }
    if (p[1] === "logout" && m === "POST") return logout(request, env, deps);
    if (p[1] === "logout-everywhere" && m === "POST") return logoutEverywhere(request, env, deps, await requireDeveloper(request, env, deps));
  }

  if (p[0] === "public") {
    if (p[1] === "dev" && p.length === 3 && m === "GET") return devPage(env, p[2]);
    if (p[1] === "links" && p.length === 3 && m === "GET") return linkPage(env, deps, p[2]);
    if (p[1] === "links" && p.length === 4 && p[3] === "qr.svg" && m === "GET") return linkQr(env, deps, p[2]);
    if (p[1] === "links" && p.length === 4 && p[3] === "latest" && m === "GET") return linkLatest(env, deps, p[2]);
  }

  if (p[0] === "build" && p.length === 3 && p[2] === "targets" && m === "GET") return buildTargets(request, env, p[1]);
  if (p[0] === "build" && p.length === 5 && p[3] === "testflight" && p[4] === "distribution" && m === "GET") return buildDistributionStatus(request, env, deps, p[1], p[2]);
  if (p[0] === "build" && p.length === 3 && p[2] === "signing" && (m === "GET" || m === "HEAD")) return buildSigning(request, env, p[1]);
  if (p[0] === "build" && p.length === 4 && p[3] === "signing" && (m === "GET" || m === "HEAD")) return buildSigning(request, env, p[1], p[2]);
  if (p[0] === "build" && p.length === 7 && p[3] === "testflight" && p[4] === "upload" && p[6] === "status" && m === "GET") return buildUploadFileStatus(request, env, deps, p[1], p[2], p[5]);
  if (p[0] === "build" && p.length === 7 && p[3] === "testflight" && p[4] === "upload" && p[6] === "operations" && m === "POST") return buildUploadFileOperations(request, env, deps, p[1], p[2], p[5]);
  if (p[0] === "build" && p.length === 5 && p[3] === "testflight" && (p[4] === "upload" || p[4] === "commit" || p[4] === "reserve-build") && m === "POST") return buildTestflight(request, env, deps, p[1], p[4], p[2]);
  if (p[0] === "build" && p.length === 4 && p[2] === "testflight" && (p[3] === "upload" || p[3] === "commit") && m === "POST") return buildTestflight(request, env, deps, p[1], p[3]);

  if (p[0] === "dev") {
    const me = await requireDeveloper(request, env, deps);
    if (p[1] === "me" && m === "GET") return dev.me(env, me);
    if (p[1] === "terms" && m === "POST") return dev.acceptTerms(request, env, deps, me);
    requireTerms(me, TERMS_VERSION);
    if (p[1] === "me" && m === "DELETE") return dev.deleteAccount(request, env, me);
    if (p[1] === "me" && m === "PUT") return dev.updateMe(request, env, me);
    if (p[1] === "secrets" && m === "PUT") return dev.updateSecrets(request, env, deps, me);
    if (p[1] === "signing" && p.length === 2 && m === "POST") return dev.setUpSigning(request, env, deps, me);
    if (p[1] === "review-contact" && p.length === 2 && m === "PUT") return dev.updateReviewContact(request, env, me);
    if (p[1] === "apps") {
      if (p.length === 2 && m === "GET") return dev.listApps(env, deps, me);
      if (p.length === 2 && m === "POST") return dev.createApp(request, env, deps, me);
      if (p.length === 3 && m === "GET") return dev.getApp(env, me, p[2]);
      if (p.length === 3 && m === "PUT") return dev.updateApp(request, env, deps, me, p[2]);
      if (p.length === 3 && m === "DELETE") return dev.deleteApp(request, env, deps, me, p[2]);
      if (p.length === 5 && p[3] === "targets" && m === "PUT") return dev.setTarget(request, env, me, p[2], p[4]);
      if (p.length === 4 && p[3] === "build-token" && m === "POST") return dev.rotateBuildToken(request, env, deps, me, p[2]);
      if (p.length === 4 && p[3] === "release" && m === "GET") return dev.releaseStatus(env, deps, me, p[2]);
      if (p.length === 4 && p[3] === "preview" && m === "GET") return dev.previewApp(env, deps, me, p[2]);
      if (p.length === 4 && p[3] === "links" && m === "POST") return dev.createLink(request, env, deps, me, p[2]);
      if (p.length === 4 && p[3] === "testflight" && m === "GET") return dev.testflightStatus(env, me, p[2], "ios", deps);
      if (p.length === 4 && p[3] === "testflight" && m === "POST") return dev.setUpAppTestflight(request, env, deps, me, p[2]);
      if (p.length === 5 && p[3] === "testflight" && p[4] === "build" && m === "POST") return dev.requestAppBuild(env, deps, me, p[2]);
      if (p.length === 5 && p[3] === "testflight" && m === "GET") return dev.testflightStatus(env, me, p[2], p[4], deps);
      if (p.length === 5 && p[3] === "testflight" && m === "POST") return dev.setUpAppTestflight(request, env, deps, me, p[2], p[4]);
      if (p.length === 6 && p[3] === "testflight" && p[5] === "build" && m === "POST") return dev.requestAppBuild(env, deps, me, p[2], p[4]);
      if (p.length === 5 && p[3] === "appstore" && m === "GET") return dev.appStoreStatus(env, deps, me, p[2], p[4]);
      if (p.length === 5 && p[3] === "appstore" && m === "PUT") return dev.saveAppStore(request, env, deps, me, p[2], p[4]);
      if (p.length === 6 && p[3] === "appstore" && ["screenshots", "submit", "release"].includes(p[5]) && m === "POST") return dev.appStoreAction(request, env, deps, me, p[2], p[4], p[5]);
      if (p.length === 4 && p[3] === "applepay" && m === "GET") return dev.applePayStatus(env, deps, me, p[2]);
      if (p.length === 5 && p[3] === "applepay" && ["merchant", "certificate", "confirm", "profiles"].includes(p[4]) && m === "POST") return dev.applePayAction(request, env, deps, me, p[2], p[4]);
      if (p.length === 6 && p[3] === "applepay" && p[4] === "certificate" && m === "GET") return dev.applePayCertificate(env, me, p[2], p[5]);
    }
    if (p[1] === "links" && p.length === 4 && p[3] === "revoke" && m === "POST") return dev.revokeLink(env, deps, me, p[2], false);
    if (p[1] === "links" && p.length === 3 && m === "DELETE") return dev.revokeLink(env, deps, me, p[2], true);
    if (p[1] === "links" && p.length === 3 && m === "PUT") return dev.renameLink(request, env, me, p[2]);
    if (p[1] === "keys") {
      if (p.length === 2 && m === "GET") return dev.listKeys(env, me);
      if (p.length === 2 && m === "POST") return dev.createKey(request, env, deps, me);
      if (p.length === 3 && p[2] === "revoke-all" && m === "POST") return dev.revokeAllKeys(request, env, deps, me);
      if (p.length === 3 && m === "DELETE") return dev.revokeKey(request, env, deps, me, p[2]);
    }
    if (p[1] === "audit" && p.length === 2 && m === "GET") return dev.auditLog(env, me);
  }
  throw new HttpError(404, "not found");
}

// Every ten minutes: TestFlight builds into the testers' group and fresh builds before expiry, then App Store work with
// the outbound calls left of the free plan's 50.
export async function scheduled(env: Env, deps: Deps): Promise<void> {
  let used = 0;
  const counted: Deps = { ...deps, fetch: (input, init) => { used++; return deps.fetch(input, init); } };
  try {
    await tickTestflight(env, counted);
  } catch (err) {
    console.error(`testflight schedule: ${err instanceof Error ? err.message : String(err)}`);
  }
  await tickAppStore(env, deps, 45 - used);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(scheduled(env, defaultDeps)),
} satisfies ExportedHandler<Env>;
