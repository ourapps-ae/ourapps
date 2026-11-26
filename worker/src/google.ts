// Google Play Android Developer API with the developer's own service account: an RS256-signed JSON Web Token is
// exchanged for an access token (developers.google.com/identity/protocols/oauth2/service-account), then the edits,
// tracks, releases and generatedapks resources of developers.google.com/android-publisher/api-ref/rest/v3.
import type { Deps, Env } from "./env.js";
import { fromBase64, toBase64url } from "./crypto.js";

export const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const encoder = new TextEncoder();

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string;
  projectId: string;
}

const der = (pem: string) => fromBase64(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));

function importKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", der(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

// Reads the JSON key Google Cloud downloads for a service account; the reason it cannot be used, or the account.
export async function parseServiceAccount(text: string): Promise<ServiceAccount | string> {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return "the service account key must be the JSON file Google Cloud downloads (Keys, Add key, Create new key, JSON)";
  }
  if (typeof json !== "object" || json === null || json.type !== "service_account") return "that JSON is not a service account key: its type must be service_account";
  const email = json.client_email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(email)) return "the key has no service account email (client_email)";
  const pem = json.private_key;
  if (typeof pem !== "string" || !pem.includes("-----BEGIN PRIVATE KEY-----")) return "the key has no private key (private_key)";
  try {
    await importKey(pem);
  } catch {
    return "the key's private key is not an RSA key Google signs with";
  }
  return { clientEmail: email, privateKey: pem, privateKeyId: typeof json.private_key_id === "string" ? json.private_key_id : "", projectId: typeof json.project_id === "string" ? json.project_id : "" };
}

// The stored form: only what ourapps uses.
export function storedServiceAccount(a: ServiceAccount): string {
  return JSON.stringify({ type: "service_account", client_email: a.clientEmail, private_key: a.privateKey, private_key_id: a.privateKeyId, project_id: a.projectId });
}

export function serviceAccountEmail(stored: string | undefined): string | null {
  if (!stored) return null;
  try {
    const email = (JSON.parse(stored) as { client_email?: unknown }).client_email;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

// The assertion lasts ten minutes; Google takes at most an hour.
export async function serviceAccountAssertion(a: ServiceAccount, now: Date, audience: string): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const header = toBase64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", ...(a.privateKeyId ? { kid: a.privateKeyId } : {}) })));
  const claims = toBase64url(encoder.encode(JSON.stringify({ iss: a.clientEmail, scope: ANDROID_PUBLISHER_SCOPE, aud: audience, iat, exp: iat + 600 })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importKey(a.privateKey), encoder.encode(`${header}.${claims}`));
  return `${header}.${claims}.${toBase64url(new Uint8Array(signature))}`;
}

// status is the HTTP status; reason is Google's reason code (SERVICE_DISABLED, invalid_grant, ...); detail its message.
export class GoogleError extends Error {
  constructor(public status: number, public detail: string, public reason = "", public token = false) {
    super(detail);
  }
}

export interface Bundle {
  versionCode: number;
  sha256?: string;
}

export interface PlayRelease {
  name?: string;
  versionCodes: string[];
  status: "completed" | "inProgress" | "draft" | "halted";
  userFraction?: number;
  releaseNotes?: { language: string; text: string }[];
}

export interface ReleaseSummary {
  releaseName?: string;
  track?: string;
  activeArtifacts?: { versionCode?: number }[];
  releaseLifecycleState?: string;
}

export class GooglePlayClient {
  private token: { value: string; until: number } | null = null;

  constructor(private env: Env, private deps: Deps, private account: ServiceAccount) {}

  get email(): string {
    return this.account.clientEmail;
  }

  // Proves the key: Google gives the service account an access token.
  async accessToken(): Promise<void> {
    await this.bearer();
  }

  private async bearer(): Promise<string> {
    const now = this.deps.now();
    if (this.token && now.getTime() < this.token.until) return this.token.value;
    const assertion = await serviceAccountAssertion(this.account, now, this.env.GOOGLE_TOKEN_URL);
    const res = await this.deps.fetch(this.env.GOOGLE_TOKEN_URL, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !json.access_token) throw new GoogleError(res.status, json.error_description || json.error || `status ${res.status}`, json.error ?? "", true);
    this.token = { value: json.access_token, until: now.getTime() + Math.min(json.expires_in ?? 3600, 3600) * 1000 - 60_000 };
    return this.token.value;
  }

  private async call<T>(method: string, path: string, init: { body?: BodyInit; json?: unknown; headers?: Record<string, string>; raw?: boolean; follow?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.bearer()}`, Accept: "application/json", ...init.headers };
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    const url = path.startsWith("https://") ? path : `${this.env.GOOGLE_PLAY_API_BASE}${path}`;
    let res = await this.deps.fetch(url, { method, headers, redirect: "manual", body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    // A media download Google sends elsewhere is followed once, to a Google host, without the access token.
    if (init.follow && res.status >= 300 && res.status < 400 && googleHost(res.headers.get("Location"))) {
      await res.body?.cancel();
      res = await this.deps.fetch(res.headers.get("Location")!, { headers: { Accept: headers.Accept }, redirect: "manual" });
    }
    if (res.status >= 300 && res.status < 400 && res.status !== 308) throw new GoogleError(res.status, "Google redirected the request; no credentials were forwarded.");
    if (init.raw && res.ok) return res as T;
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } };
    if (!res.ok) {
      const e = json.error;
      const reason = e?.details?.find((d) => d.reason)?.reason ?? e?.errors?.find((d) => d.reason)?.reason ?? e?.status ?? "";
      throw new GoogleError(res.status, e?.message ?? res.statusText ?? `status ${res.status}`, reason);
    }
    return json;
  }

  private app(packageName: string, rest = ""): string {
    return `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}${rest}`;
  }

  async insertEdit(packageName: string): Promise<{ id: string; expiresAt: number | null }> {
    const edit = await this.call<{ id: string; expiryTimeSeconds?: string }>("POST", this.app(packageName, "/edits"), { json: {} });
    return { id: edit.id, expiresAt: edit.expiryTimeSeconds ? Number(edit.expiryTimeSeconds) * 1000 : null };
  }

  async deleteEdit(packageName: string, editId: string): Promise<void> {
    await this.call("DELETE", this.app(packageName, `/edits/${encodeURIComponent(editId)}`));
  }

  // Sends the edit's changes to Google's review. When Google holds them (after a rejection), they wait for the
  // developer to send them for review in Play Console; the answer is then false.
  async commitEdit(packageName: string, editId: string, cancelInReview = true): Promise<boolean> {
    const path = this.app(packageName, `/edits/${encodeURIComponent(editId)}:commit`);
    const behaviour = cancelInReview ? "" : "?changesInReviewBehavior=ERROR_IF_IN_REVIEW";
    try {
      await this.call("POST", `${path}${behaviour}`);
      return true;
    } catch (err) {
      if (!(err instanceof GoogleError && err.status === 400 && /changesNotSentForReview/.test(err.detail))) throw err;
    }
    await this.call("POST", `${path}${behaviour ? `${behaviour}&` : "?"}changesNotSentForReview=true`);
    return false;
  }

  async details(packageName: string, editId: string): Promise<{ defaultLanguage?: string; contactEmail?: string; contactWebsite?: string }> {
    return this.call("GET", this.app(packageName, `/edits/${encodeURIComponent(editId)}/details`));
  }

  async patchDetails(packageName: string, editId: string, details: { contactEmail: string; contactWebsite?: string }): Promise<void> {
    await this.call("PATCH", this.app(packageName, `/edits/${encodeURIComponent(editId)}/details`), { json: details });
  }

  async updateListing(packageName: string, editId: string, language: string, listing: { title: string; shortDescription: string; fullDescription: string }): Promise<void> {
    await this.call("PUT", this.app(packageName, `/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}`), { json: { language, ...listing } });
  }

  async deleteAllImages(packageName: string, editId: string, language: string, imageType: string): Promise<void> {
    await this.call("DELETE", this.app(packageName, `/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${imageType}`));
  }

  async uploadImage(packageName: string, editId: string, language: string, imageType: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.call("POST", `/upload${this.app(packageName, `/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${imageType}`)}?uploadType=media`, { body: bytes, headers: { "Content-Type": contentType } });
  }

  async listBundles(packageName: string, editId: string): Promise<Bundle[]> {
    return (await this.call<{ bundles?: Bundle[] }>("GET", this.app(packageName, `/edits/${encodeURIComponent(editId)}/bundles`))).bundles ?? [];
  }

  // Opens a resumable upload session for a bundle of this size; returns the session address Google gives.
  async startBundleUpload(packageName: string, editId: string, size: number): Promise<string> {
    const res = await this.call<Response>("POST", `/upload${this.app(packageName, `/edits/${encodeURIComponent(editId)}/bundles`)}?uploadType=resumable`, {
      raw: true,
      body: "",
      headers: { "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(size), "Content-Length": "0" },
    });
    const session = res.headers.get("Location");
    if (!session || !session.startsWith("https://")) throw new GoogleError(502, "Google opened no upload session for the bundle.");
    return session;
  }

  // Sends the bundle's bytes to the session as they arrive; Google answers once it has read the bundle.
  async sendBundle(session: string, body: ReadableStream<Uint8Array>, size: number): Promise<Bundle> {
    await this.bearer();
    const fixed = new FixedLengthStream(size);
    const stop = new AbortController();
    const piping = body.pipeTo(fixed.writable, { signal: stop.signal });
    piping.catch(() => undefined);
    try {
      const bundle = await this.call<Bundle>("PUT", session, { body: fixed.readable, headers: { "Content-Type": "application/octet-stream" } });
      await piping;
      return bundle;
    } catch (err) {
      stop.abort();
      throw err;
    }
  }

  async updateTrack(packageName: string, editId: string, track: string, release: PlayRelease): Promise<void> {
    await this.call("PUT", this.app(packageName, `/edits/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(track)}`), { json: { track, releases: [release] } });
  }

  // Releases on a track that are ready to send for review, in review, approved, not approved or available.
  async trackReleases(packageName: string, track: string): Promise<ReleaseSummary[]> {
    return (await this.call<{ releases?: ReleaseSummary[] }>("GET", this.app(packageName, `/tracks/${encodeURIComponent(track)}/releases`))).releases ?? [];
  }

  // The universal APK Google Play generated from the bundle with this version code, signed with the app signing key
  // Play holds (generatedapks.list); null until Google has generated it.
  async universalApk(packageName: string, versionCode: number): Promise<UniversalApk | null> {
    const list = await this.call<{ generatedApks?: { certificateSha256Hash?: string; generatedUniversalApk?: { downloadId?: string } }[] }>("GET", this.app(packageName, `/generatedApks/${versionCode}`));
    const found = (list.generatedApks ?? []).find((g) => g.generatedUniversalApk?.downloadId);
    return found ? { downloadId: found.generatedUniversalApk!.downloadId!, certificateSha256: found.certificateSha256Hash ?? "" } : null;
  }

  // The APK's bytes as Google sends them (generatedapks.download with alt=media), for the caller to stream.
  async downloadApk(packageName: string, versionCode: number, downloadId: string): Promise<Response> {
    return this.call<Response>("GET", this.app(packageName, `/generatedApks/${versionCode}/downloads/${encodeURIComponent(downloadId)}:download?alt=media`), { raw: true, follow: true, headers: { Accept: "*/*" } });
  }
}

export interface UniversalApk {
  downloadId: string;
  certificateSha256: string;
}

function googleHost(location: string | null): boolean {
  try {
    const u = new URL(location ?? "");
    return u.protocol === "https:" && /(^|\.)(googleapis|googleusercontent)\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

// Google's certificate hash as the colon-separated upper-case hex that Google Pay and other providers ask for.
export function fingerprint(hash: string): string {
  const plain = hash.replace(/[:\s]/g, "");
  if (/^[0-9a-fA-F]{64}$/.test(plain)) return plain.toUpperCase().match(/../g)!.join(":");
  try {
    const bytes = Uint8Array.from(atob(plain.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
    if (bytes.length === 32) return [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  } catch {
    // Neither hex nor base64: shown as Google gave it.
  }
  return hash;
}

export function googleClient(env: Env, deps: Deps, stored: string | undefined): GooglePlayClient | null {
  if (!stored) return null;
  try {
    const json = JSON.parse(stored) as { client_email: string; private_key: string; private_key_id?: string; project_id?: string };
    return new GooglePlayClient(env, deps, { clientEmail: json.client_email, privateKey: json.private_key, privateKeyId: json.private_key_id ?? "", projectId: json.project_id ?? "" });
  } catch {
    return null;
  }
}
