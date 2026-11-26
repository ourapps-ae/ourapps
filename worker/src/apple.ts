// App Store Connect API: ES256 tokens, the signing certificate, App IDs, profiles and TestFlight.
import type { Deps, Env } from "./env.js";
import { applePlatformName, type ApplePlatform } from "./apple-platform.js";
import { numericBuildNumber } from "./build-number.js";

export interface AppleCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

// Token lifetime stays under Apple's 20 minute ceiling.
export async function makeToken(creds: AppleCredentials, now: Date): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(creds.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "ES256", kid: creds.keyId, typ: "JWT" })));
  const payload = base64url(encoder.encode(JSON.stringify({ iss: creds.issuerId, iat, exp: iat + 10 * 60, aud: "appstoreconnect-v1" })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

interface Linkage {
  id: string;
  type: string;
}

const asList = (data: Linkage | Linkage[] | undefined): Linkage[] => (data === undefined ? [] : Array.isArray(data) ? data : [data]);

interface Resource<A = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: A;
  // To-one relationships (bundleId) carry one object; to-many (certificates) an array.
  relationships?: Record<string, { data?: Linkage | Linkage[] }>;
}

interface BuildNumberPage {
  data: Resource<{ version: string }>[];
  included?: Resource<{ version?: string; platform?: string }>[];
  links?: { next?: string | null };
  meta?: { paging?: { total?: number } };
}

export class AppleClient {
  // One token serves every call in a request, keeping CPU time inside the Workers free plan.
  private token: { value: string; until: number } | null = null;

  constructor(private env: Env, private deps: Deps, private creds: AppleCredentials) {}

  private async bearer(): Promise<string> {
    const now = this.deps.now();
    if (!this.token || now.getTime() > this.token.until) this.token = { value: await makeToken(this.creds, now), until: now.getTime() + 5 * 60_000 };
    return this.token.value;
  }

  private async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal, check?: () => Promise<void>): Promise<T> {
    const token = await this.bearer();
    await check?.();
    const res = await this.deps.fetch(`${this.env.APPLE_API_BASE}${path}`, {
      method,
      signal, redirect: "manual",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status >= 300 && res.status < 400) throw new AppleError(res.status, "Apple redirected the request; no credentials were forwarded.");
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as T & { errors?: { detail?: string; title?: string; code?: string }[] };
    if (!res.ok) {
      const detail = json.errors?.map((e) => e.detail ?? e.title).join("; ") ?? res.statusText;
      throw new AppleError(res.status, `${method} ${path}: ${detail}`, detail, json.errors?.[0]?.code ?? "");
    }
    return json;
  }

  // Exact name match; Apple's name filter is not guaranteed to be exact.
  async findProfileByName(name: string): Promise<Resource<{ name: string; uuid: string; profileContent: string; expirationDate: string }> | null> {
    const res = await this.call<{ data: Resource<{ name: string; uuid: string; profileContent: string; expirationDate: string }>[] }>(
      "GET",
      `/v1/profiles?filter[name]=${encodeURIComponent(name)}&include=bundleId,certificates&limit=200`,
    );
    return res.data.find((p) => p.attributes.name === name) ?? null;
  }

  // Returns Apple's id for an explicit App ID, creating it when it does not exist yet.
  async ensureBundleId(identifier: string, appName: string, nativeMac = false, check?: () => Promise<void>): Promise<string> {
    const res = await this.call<{ data: Resource<{ identifier: string; platform?: string }>[] }>("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200`);
    const expected = nativeMac ? "MAC_OS" : "IOS";
    const found = res.data.find((b) => b.attributes.identifier === identifier && (b.attributes.platform === "UNIVERSAL" || b.attributes.platform === expected || (!nativeMac && b.attributes.platform === undefined)));
    if (found) return found.id;
    const name = `ourapps ${appName}`.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    const created = await this.call<{ data: Resource }>("POST", "/v1/bundleIds", {
      data: { type: "bundleIds", attributes: { identifier, name, platform: nativeMac ? "MAC_OS" : "IOS" } },
    }, undefined, check);
    return created.data.id;
  }

  // TestFlight

  // The App Store Connect app for a bundle ID. Apple has no API to create one; the developer adds it once.
  async findStoreApp(bundleId: string): Promise<{ id: string; name: string } | null> {
    const res = await this.call<{ data: Resource<{ bundleId: string; name: string }>[] }>("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=200`);
    const app = res.data.find((a) => a.attributes.bundleId === bundleId);
    return app ? { id: app.id, name: app.attributes.name } : null;
  }

  // An App Store profile for TestFlight builds, made again when it lacks the certificate or what keep asks of its content.
  async ensureStoreProfile(name: string, bundleIdRes: string, certificateId: string, profileType = "IOS_APP_STORE", check?: () => Promise<void>, keep: (profileContent: string) => boolean = () => true): Promise<{ id: string; uuid: string; profileContent: string; expirationDate: string }> {
    const old = await this.findProfileByName(name);
    const certs = asList(old?.relationships?.certificates?.data).map((c) => c.id);
    const attrs = old?.attributes as { profileType?: string; profileState?: string } | undefined;
    if (old && certs.includes(certificateId) && attrs?.profileType === profileType && attrs?.profileState !== "INVALID" && Date.parse(old.attributes.expirationDate) > this.deps.now().getTime() && keep(old.attributes.profileContent)) {
      return { id: old.id, uuid: old.attributes.uuid, profileContent: old.attributes.profileContent, expirationDate: old.attributes.expirationDate };
    }
    if (old) await this.call("DELETE", `/v1/profiles/${old.id}`, undefined, undefined, check);
    const res = await this.call<{ data: Resource<{ uuid: string; profileContent: string; expirationDate: string }> }>("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name, profileType },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundleIdRes } }, certificates: { data: [{ type: "certificates", id: certificateId }] } },
      },
    }, undefined, check);
    return { id: res.data.id, ...res.data.attributes };
  }

  // The external beta group friends join through its public link; created with the link switched on.
  async ensureBetaGroup(storeAppId: string, name: string, check?: () => Promise<void>): Promise<{ id: string; publicLink: string | null }> {
    const res = await this.call<{ data: Resource<{ name: string; isInternalGroup: boolean; publicLinkEnabled: boolean; publicLink: string | null }>[] }>("GET", `/v1/apps/${storeAppId}/betaGroups?limit=200`);
    let group = res.data.find((g) => g.attributes.name === name && !g.attributes.isInternalGroup);
    if (!group) {
      const made = await this.call<{ data: Resource<{ name: string; isInternalGroup: boolean; publicLinkEnabled: boolean; publicLink: string | null }> }>("POST", "/v1/betaGroups", {
        data: { type: "betaGroups", attributes: { name, publicLinkEnabled: true, publicLinkLimitEnabled: false, feedbackEnabled: true }, relationships: { app: { data: { type: "apps", id: storeAppId } } } },
      }, undefined, check);
      group = made.data;
    } else if (!group.attributes.publicLinkEnabled) {
      const updated = await this.call<{ data: Resource<{ name: string; isInternalGroup: boolean; publicLinkEnabled: boolean; publicLink: string | null }> }>("PATCH", `/v1/betaGroups/${group.id}`, {
        data: { type: "betaGroups", id: group.id, attributes: { publicLinkEnabled: true, publicLinkLimitEnabled: false } },
      }, undefined, check);
      group = updated.data;
    }
    return { id: group.id, publicLink: group.attributes.publicLink ?? null };
  }

  async betaGroupLink(groupId: string): Promise<string | null> {
    const res = await this.call<{ data: Resource<{ publicLink: string | null }> }>("GET", `/v1/betaGroups/${groupId}`);
    return res.data.attributes.publicLink ?? null;
  }

  async iosOnMac(groupId: string): Promise<boolean | null> {
    const res = await this.call<{ data: Resource<{ iosBuildsAvailableForAppleSiliconMac?: boolean }> }>("GET", `/v1/betaGroups/${groupId}?fields[betaGroups]=iosBuildsAvailableForAppleSiliconMac`);
    const value = res.data.attributes.iosBuildsAvailableForAppleSiliconMac;
    return typeof value === "boolean" ? value : null;
  }

  // Who Apple's beta review contacts, and the description testers see; both are required for review.
  async setBetaReviewDetails(storeAppId: string, contact: { firstName: string; lastName: string; email: string; phone: string }, notes: string, check?: () => Promise<void>): Promise<void> {
    const res = await this.call<{ data: Resource }>("GET", `/v1/apps/${storeAppId}/betaAppReviewDetail`);
    await this.call("PATCH", `/v1/betaAppReviewDetails/${res.data.id}`, {
      data: {
        type: "betaAppReviewDetails",
        id: res.data.id,
        attributes: { contactFirstName: contact.firstName, contactLastName: contact.lastName, contactEmail: contact.email, contactPhone: contact.phone, demoAccountRequired: false, notes: notes.slice(0, 4000) },
      },
    }, undefined, check);
  }

  // Beta review needs a description in every beta localization, and one in the app's primary language.
  // Returns the locales found, for error messages.
  async setBetaDescription(storeAppId: string, text: { description: string; feedbackEmail?: string }, check?: () => Promise<void>): Promise<string> {
    const app = await this.call<{ data: Resource<{ primaryLocale?: string }> }>("GET", `/v1/apps/${storeAppId}?fields[apps]=primaryLocale`);
    const primary = app.data.attributes.primaryLocale ?? "en-US";
    const res = await this.call<{ data: Resource<{ locale: string; feedbackEmail?: string | null }>[] }>("GET", `/v1/apps/${storeAppId}/betaAppLocalizations?limit=50`);
    const feedbackEmail = text.feedbackEmail ?? res.data.find((l) => l.attributes.feedbackEmail)?.attributes.feedbackEmail ?? undefined;
    const attributes = { description: text.description.slice(0, 4000), ...(feedbackEmail ? { feedbackEmail } : {}) };
    for (const l of res.data) await this.call("PATCH", `/v1/betaAppLocalizations/${l.id}`, { data: { type: "betaAppLocalizations", id: l.id, attributes } }, undefined, check);
    if (!res.data.some((l) => l.attributes.locale === primary)) {
      await this.call("POST", "/v1/betaAppLocalizations", { data: { type: "betaAppLocalizations", attributes: { locale: primary, ...attributes }, relationships: { app: { data: { type: "apps", id: storeAppId } } } } }, undefined, check);
    }
    return `primary ${primary}; beta localizations before: ${res.data.map((l) => l.attributes.locale).join(", ") || "none"}`;
  }

  // Reserves an upload; the workflow sends the bytes straight to Apple with the returned operations.
  async reserveBuildUpload(storeAppId: string, version: string, buildNumber: string, fileName: string, fileSize: number, platform: ApplePlatform = "ios", check?: () => Promise<void>, record?: (uploadId: string, fileId: string | null) => Promise<void>): Promise<{ uploadId: string; fileId: string; operations: UploadOperation[] }> {
    const upload = await this.call<{ data: Resource }>("POST", "/v1/buildUploads", {
      data: { type: "buildUploads", attributes: { cfBundleShortVersionString: version, cfBundleVersion: buildNumber, platform: applePlatformName(platform) }, relationships: { app: { data: { type: "apps", id: storeAppId } } } },
    }, undefined, check);
    await record?.(upload.data.id, null);
    const file = await this.call<{ data: Resource<{ uploadOperations?: UploadOperation[] }> }>("POST", "/v1/buildUploadFiles", {
      data: { type: "buildUploadFiles", attributes: { assetType: "ASSET", fileName, fileSize, uti: platform === "macos" ? "com.apple.pkg" : "com.apple.ipa" }, relationships: { buildUpload: { data: { type: "buildUploads", id: upload.data.id } } } },
    }, undefined, check);
    await record?.(upload.data.id, file.data.id);
    return { uploadId: upload.data.id, fileId: file.data.id, operations: file.data.attributes.uploadOperations ?? [] };
  }

  async commitBuildUpload(fileId: string, md5: string, check?: () => Promise<void>): Promise<void> {
    await this.call("PATCH", `/v1/buildUploadFiles/${fileId}`, {
      data: { type: "buildUploadFiles", id: fileId, attributes: { uploaded: true, sourceFileChecksums: { file: { algorithm: "MD5", hash: md5 } } } },
    }, undefined, check);
  }

  async readBuildUploadFile(fileId: string): Promise<unknown> {
    const result = await this.call<{ data: Resource<unknown> }>("GET", `/v1/buildUploadFiles/${encodeURIComponent(fileId)}`);
    if (result?.data?.id !== fileId || result.data.type !== "buildUploadFiles" || !result.data.attributes || typeof result.data.attributes !== "object" || Array.isArray(result.data.attributes)) throw new AppleError(502, "Invalid Apple upload-file response.");
    return result.data.attributes;
  }

  async buildUploadState(uploadId: string): Promise<{ state: string; errors: string[] }> {
    const res = await this.call<{ data: Resource<{ state?: { state?: string; errors?: { description?: string; code?: string }[] } }> }>("GET", `/v1/buildUploads/${uploadId}`);
    const st = res.data.attributes.state;
    return { state: st?.state ?? "UNKNOWN", errors: (st?.errors ?? []).map((e) => e.description ?? e.code ?? "error") };
  }

  async findBuild(storeAppId: string, version: string, buildNumber: string, platform: ApplePlatform = "ios"): Promise<{ id: string; processingState: string; usesNonExemptEncryption: boolean | null; expirationDate: string | null; expired: boolean } | null> {
    const res = await this.call<{ data: Resource<{ processingState: string; usesNonExemptEncryption: boolean | null; expirationDate: string | null; expired?: boolean }>[] }>(
      "GET",
      `/v1/builds?filter[app]=${storeAppId}&filter[version]=${encodeURIComponent(buildNumber)}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&filter[preReleaseVersion.platform]=${applePlatformName(platform)}&limit=1`,
    );
    const b = res.data[0];
    return b
      ? { id: b.id, processingState: b.attributes.processingState, usesNonExemptEncryption: b.attributes.usesNonExemptEncryption ?? null, expirationDate: b.attributes.expirationDate ?? null, expired: b.attributes.expired === true }
      : null;
  }

  async maximumBuildNumber(storeAppId: string, version: string, platform: ApplePlatform): Promise<number> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scan = async () => {
      const base = new URL(this.env.APPLE_API_BASE);
      const query = new URLSearchParams({ "filter[app]": storeAppId, "filter[preReleaseVersion.version]": version, "filter[preReleaseVersion.platform]": applePlatformName(platform), include: "app,preReleaseVersion", "fields[builds]": "version,app,preReleaseVersion", "fields[preReleaseVersions]": "version,platform", limit: "200" });
      let next: string | null = `/v1/builds?${query}`;
      let maximum = 0;
      let seen = 0;
      const visited = new Set<string>();
      for (let page = 0; next && page < 10; page++) {
        const url: URL = new URL(next, base);
        if (url.origin !== base.origin || url.pathname !== "/v1/builds" || url.username || url.password || visited.has(url.href)) throw new Error("Apple returned an invalid build pagination link.");
        visited.add(url.href);
        for (const [key, value] of query) url.searchParams.set(key, value);
        const result: BuildNumberPage = await this.call<BuildNumberPage>("GET", `${url.pathname}${url.search}`, undefined, controller.signal);
        if (!Array.isArray(result.data) || result.data.length > 200) throw new Error("Apple returned an invalid builds page.");
        for (const build of result.data) {
          const app = asList(build.relationships?.app?.data)[0];
          const releaseId = asList(build.relationships?.preReleaseVersion?.data)[0];
          const release = result.included?.find((item) => item.type === "preReleaseVersions" && item.id === releaseId?.id);
          if (app?.id !== storeAppId || release?.attributes.version !== version || release.attributes.platform !== applePlatformName(platform)) throw new Error("Apple build scope could not be verified.");
          maximum = Math.max(maximum, numericBuildNumber(build.attributes.version));
        }
        seen += result.data.length;
        next = result.links?.next ?? null;
        if (next !== null && typeof next !== "string") throw new Error("Apple returned an invalid build pagination link.");
        if (!next && typeof result.meta?.paging?.total === "number" && result.meta.paging.total > seen) throw new Error("Apple build pagination was incomplete.");
      }
      if (next) throw new Error("Apple build pagination exceeded ten pages.");
      return maximum;
    };
    try {
      return await Promise.race([scan(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Apple build lookup timed out.")); }, 8000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  // Apple's export compliance answer for one build.
  async setBuildEncryption(buildId: string, usesNonExemptEncryption: boolean): Promise<void> {
    await this.call("PATCH", `/v1/builds/${buildId}`, { data: { type: "builds", id: buildId, attributes: { usesNonExemptEncryption } } });
  }

  // Where the build stands for external testers (ExternalBetaState), and the record that holds it.
  async betaDetail(buildId: string): Promise<{ id: string; externalBuildState: string; autoNotifyEnabled: boolean }> {
    const res = await this.call<{ data: Resource<{ externalBuildState?: string; autoNotifyEnabled?: boolean }> }>("GET", `/v1/builds/${buildId}/buildBetaDetail`);
    return { id: res.data.id, externalBuildState: res.data.attributes.externalBuildState ?? "UNKNOWN", autoNotifyEnabled: res.data.attributes.autoNotifyEnabled === true };
  }

  async buildInBetaGroup(buildId: string, groupId: string): Promise<boolean | null> {
    const res = await this.call<{ data: Linkage[]; links?: { next?: string | null }; meta?: { paging?: { total?: number } } }>("GET", `/v1/betaGroups/${encodeURIComponent(groupId)}/relationships/builds?limit=200`);
    if (!Array.isArray(res.data) || res.data.length > 200 || res.data.some(build => build.type !== "builds" || typeof build.id !== "string")) throw new AppleError(502, "Invalid Apple group builds response.");
    if (res.data.some(build => build.id === buildId)) return true;
    return res.links?.next || (res.meta?.paging?.total ?? 0) > res.data.length ? null : false;
  }

  async betaGroupDistribution(groupId: string): Promise<{ isInternalGroup: boolean | null; publicLinkEnabled: boolean | null; publicLink: string | null }> {
    const id = encodeURIComponent(groupId);
    const res = await this.call<{ data: Resource<{ isInternalGroup?: boolean; publicLinkEnabled?: boolean; publicLink?: string }> }>("GET", `/v1/betaGroups/${id}`);
    if (res.data?.type !== "betaGroups" || res.data.id !== groupId || !res.data.attributes) throw new AppleError(502, "Invalid Apple testing group response.");
    const a = res.data.attributes;
    return { isInternalGroup: typeof a.isInternalGroup === "boolean" ? a.isInternalGroup : null,
      publicLinkEnabled: typeof a.publicLinkEnabled === "boolean" ? a.publicLinkEnabled : null,
      publicLink: typeof a.publicLink === "string" ? a.publicLink : null };
  }

  async betaGroupTesterCount(groupId: string): Promise<number | null> {
    const testers = await this.call<{ data: Linkage[]; meta?: { paging?: { total?: number } }; links?: { next?: string | null } }>("GET", `/v1/betaGroups/${encodeURIComponent(groupId)}/relationships/betaTesters?limit=1`);
    if (!Array.isArray(testers.data) || testers.data.length > 1 || testers.data.some(tester => tester.type !== "betaTesters" || typeof tester.id !== "string")) throw new AppleError(502, "Invalid Apple tester count response.");
    const total = testers.meta?.paging?.total;
    return typeof total === "number" && Number.isSafeInteger(total) && total >= testers.data.length ? total : !testers.links?.next && total === undefined ? testers.data.length : null;
  }

  // Apple then makes the build available to its external groups as soon as beta review approves it.
  async setAutoNotify(betaDetailId: string): Promise<void> {
    await this.call("PATCH", `/v1/buildBetaDetails/${betaDetailId}`, { data: { type: "buildBetaDetails", id: betaDetailId, attributes: { autoNotifyEnabled: true } } });
  }

  // The "Notify Testers" step of App Store Connect: makes an approved build available to its groups.
  async notifyTesters(buildId: string): Promise<void> {
    await this.call("POST", "/v1/buildBetaNotifications", { data: { type: "buildBetaNotifications", relationships: { build: { data: { type: "builds", id: buildId } } } } });
  }

  // The newest build that has not expired, to know when the next one is due.
  async latestLiveBuild(storeAppId: string, platform: ApplePlatform = "ios"): Promise<{ id: string; expirationDate: string | null } | null> {
    const res = await this.call<{ data: Resource<{ expirationDate: string | null }>[] }>("GET", `/v1/builds?filter[app]=${storeAppId}&filter[preReleaseVersion.platform]=${applePlatformName(platform)}&filter[expired]=false&sort=-uploadedDate&limit=1`);
    const b = res.data[0];
    return b ? { id: b.id, expirationDate: b.attributes.expirationDate ?? null } : null;
  }

  async addBuildToGroup(groupId: string, buildId: string): Promise<void> {
    await this.call("POST", `/v1/betaGroups/${groupId}/relationships/builds`, { data: [{ type: "builds", id: buildId }] });
  }

  async setWhatsNew(buildId: string, whatsNew: string): Promise<void> {
    const res = await this.call<{ data: Resource<{ locale: string }>[] }>("GET", `/v1/builds/${buildId}/betaBuildLocalizations?limit=50`);
    const existing = res.data[0];
    const attributes = { whatsNew: whatsNew.slice(0, 4000) };
    if (existing) await this.call("PATCH", `/v1/betaBuildLocalizations/${existing.id}`, { data: { type: "betaBuildLocalizations", id: existing.id, attributes } });
    else await this.call("POST", "/v1/betaBuildLocalizations", { data: { type: "betaBuildLocalizations", attributes: { locale: "en-US", ...attributes }, relationships: { build: { data: { type: "builds", id: buildId } } } } });
  }

  async submitForBetaReview(buildId: string): Promise<void> {
    await this.call("POST", "/v1/betaAppReviewSubmissions", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: buildId } } } } });
  }

  // App Store

  async primaryLocale(appId: string): Promise<string> {
    return (await this.appSettings(appId)).primaryLocale;
  }

  async appSettings(appId: string): Promise<{ primaryLocale: string; contentRightsDeclaration: string | null }> {
    const app = await this.call<{ data: Resource<{ primaryLocale?: string; contentRightsDeclaration?: string | null }> }>("GET", `/v1/apps/${appId}?fields[apps]=primaryLocale,contentRightsDeclaration`);
    return { primaryLocale: app.data.attributes.primaryLocale ?? "en-US", contentRightsDeclaration: app.data.attributes.contentRightsDeclaration ?? null };
  }

  // The app information that goes live with the next version, not the one on the store now, with what Apple holds for it:
  // the primary category, the age rating answers and each localization's privacy policy.
  async editableAppInfo(appId: string): Promise<AppInfoState> {
    const res = await this.call<{ data: Resource<{ state?: string; appStoreState?: string }>[]; included?: Resource<Record<string, unknown>>[] }>(
      "GET",
      `/v1/apps/${appId}/appInfos?include=primaryCategory,ageRatingDeclaration,appInfoLocalizations&limit=10&limit[appInfoLocalizations]=50`,
    );
    const live = ["READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_INFO", "READY_FOR_SALE"];
    const info = res.data.find((i) => !live.includes(i.attributes.state ?? i.attributes.appStoreState ?? "")) ?? res.data[0];
    if (!info) throw new AppleError(404, "Apple has no app information for this app.");
    const included = (type: string, id: string | undefined) => res.included?.find((r) => r.type === type && r.id === id);
    const ageId = asList(info.relationships?.ageRatingDeclaration?.data)[0]?.id;
    const age = included("ageRatingDeclarations", ageId);
    return {
      id: info.id,
      category: asList(info.relationships?.primaryCategory?.data)[0]?.id ?? null,
      ageRating: ageId ? { id: ageId, attributes: age?.attributes ?? null } : null,
      localizations: asList(info.relationships?.appInfoLocalizations?.data).map((l) => {
        const a = included("appInfoLocalizations", l.id)?.attributes ?? {};
        return { id: l.id, locale: String(a.locale ?? ""), privacyPolicyUrl: (a.privacyPolicyUrl as string | null | undefined) ?? null, privacyPolicyText: (a.privacyPolicyText as string | null | undefined) ?? null };
      }),
    };
  }

  async ageRatingDeclaration(appInfoId: string): Promise<{ id: string; attributes: Record<string, unknown> }> {
    const res = await this.call<{ data: Resource<Record<string, unknown>> }>("GET", `/v1/appInfos/${appInfoId}/ageRatingDeclaration`);
    return { id: res.data.id, attributes: res.data.attributes ?? {} };
  }

  async updateAgeRating(declarationId: string, attributes: Record<string, unknown>): Promise<void> {
    await this.call("PATCH", `/v1/ageRatingDeclarations/${declarationId}`, { data: { type: "ageRatingDeclarations", id: declarationId, attributes } });
  }

  async setCategory(appInfoId: string, category: string): Promise<void> {
    await this.call("PATCH", `/v1/appInfos/${appInfoId}`, { data: { type: "appInfos", id: appInfoId, relationships: { primaryCategory: { data: { type: "appCategories", id: category } } } } });
  }

  async updateAppInfoLocalization(id: string, attributes: Record<string, string>): Promise<void> {
    await this.call("PATCH", `/v1/appInfoLocalizations/${id}`, { data: { type: "appInfoLocalizations", id, attributes } });
  }

  async createAppInfoLocalization(appInfoId: string, locale: string, name: string, attributes: Record<string, string>): Promise<void> {
    await this.call("POST", "/v1/appInfoLocalizations", { data: { type: "appInfoLocalizations", attributes: { locale, name: name.slice(0, 30), ...attributes }, relationships: { appInfo: { data: { type: "appInfos", id: appInfoId } } } } });
  }

  async setContentRights(appId: string, declaration: string): Promise<void> {
    await this.call("PATCH", `/v1/apps/${appId}`, { data: { type: "apps", id: appId, attributes: { contentRightsDeclaration: declaration } } });
  }

  // Free when every price in the base territory, now or scheduled, is the free price point.
  async isFree(appId: string): Promise<boolean> {
    let schedule: { data?: Resource | null };
    try {
      schedule = await this.call<{ data?: Resource | null }>("GET", `/v1/apps/${appId}/appPriceSchedule?include=baseTerritory`);
    } catch (err) {
      if (err instanceof AppleError && err.status === 404) return false;
      throw err;
    }
    const base = asList(schedule?.data?.relationships?.baseTerritory?.data)[0]?.id;
    if (!schedule?.data || !base) return false;
    const prices = await this.call<{ data: Resource<{ startDate?: string | null; endDate?: string | null }>[]; included?: Resource<{ customerPrice?: string }>[] }>(
      "GET",
      `/v1/appPriceSchedules/${schedule.data.id}/manualPrices?filter[territory]=${base}&include=appPricePoint&fields[appPricePoints]=customerPrice&limit=200`,
    );
    const today = this.deps.now().toISOString().slice(0, 10);
    const current = prices.data.filter((p) => !p.attributes.endDate || p.attributes.endDate > today);
    return current.length > 0 && current.every((p) => {
      const point = prices.included?.find((i) => i.type === "appPricePoints" && i.id === asList(p.relationships?.appPricePoint?.data)[0]?.id);
      return point?.attributes.customerPrice !== undefined && Number(point.attributes.customerPrice) === 0;
    });
  }

  // Free everywhere: the base territory's free price point, which Apple applies in every territory.
  async makeFree(appId: string): Promise<void> {
    const points = await this.call<{ data: Resource<{ customerPrice?: string }>[] }>("GET", `/v1/apps/${appId}/appPricePoints?filter[territory]=USA&limit=200`);
    const free = points.data.find((p) => p.attributes.customerPrice !== undefined && Number(p.attributes.customerPrice) === 0);
    if (!free) throw new AppleError(404, "Apple offered no free price for this app.");
    await this.call("POST", "/v1/appPriceSchedules", {
      data: { type: "appPriceSchedules", relationships: { app: { data: { type: "apps", id: appId } }, baseTerritory: { data: { type: "territories", id: "USA" } }, manualPrices: { data: [{ type: "appPrices", id: "${free-price}" }] } } },
      included: [{ type: "appPrices", id: "${free-price}", attributes: { startDate: null, endDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: free.id } } } }],
    });
  }

  // Every territory, and those Apple adds later. Returns false, changing nothing, when availability is already set.
  async makeAvailableEverywhere(appId: string): Promise<boolean> {
    try {
      const existing = await this.call<{ data?: Resource | null }>("GET", `/v1/apps/${appId}/appAvailabilityV2`);
      if (existing?.data) return false;
    } catch (err) {
      if (!(err instanceof AppleError && err.status === 404)) throw err;
    }
    const territories = await this.call<{ data: Linkage[] }>("GET", "/v1/territories?limit=200");
    const local = (id: string) => `\${territory-${id}}`;
    await this.call("POST", "/v2/appAvailabilities", {
      data: { type: "appAvailabilities", attributes: { availableInNewTerritories: true }, relationships: { app: { data: { type: "apps", id: appId } }, territoryAvailabilities: { data: territories.data.map((t) => ({ type: "territoryAvailabilities", id: local(t.id) })) } } },
      included: territories.data.map((t) => ({ type: "territoryAvailabilities", id: local(t.id), attributes: { available: true }, relationships: { territory: { data: { type: "territories", id: t.id } } } })),
    });
    return true;
  }

  async appStoreVersions(appId: string, platform: ApplePlatform): Promise<StoreVersion[]> {
    const res = await this.call<{ data: Resource<{ versionString?: string; appVersionState?: string; appStoreState?: string; releaseType?: string }>[] }>("GET", `/v1/apps/${appId}/appStoreVersions?filter[platform]=${applePlatformName(platform)}&limit=50`);
    return res.data.map(storeVersion);
  }

  async readAppStoreVersion(versionId: string): Promise<StoreVersion> {
    const res = await this.call<{ data: Resource<{ versionString?: string; appVersionState?: string; appStoreState?: string; releaseType?: string }> }>("GET", `/v1/appStoreVersions/${versionId}`);
    return storeVersion(res.data);
  }

  async createAppStoreVersion(appId: string, platform: ApplePlatform, versionString: string, copyright: string): Promise<StoreVersion> {
    const res = await this.call<{ data: Resource<{ versionString?: string; appVersionState?: string; releaseType?: string }> }>("POST", "/v1/appStoreVersions", {
      data: { type: "appStoreVersions", attributes: { platform: applePlatformName(platform), versionString, copyright }, relationships: { app: { data: { type: "apps", id: appId } } } },
    });
    return storeVersion(res.data);
  }

  async updateAppStoreVersion(versionId: string, attributes: { versionString?: string; copyright?: string; releaseType?: string }): Promise<void> {
    await this.call("PATCH", `/v1/appStoreVersions/${versionId}`, { data: { type: "appStoreVersions", id: versionId, attributes } });
  }

  // The version's text in one language: created when missing, otherwise changed. Returns its id.
  async writeVersionText(versionId: string, locale: string, attributes: { description: string; keywords: string; supportUrl: string; whatsNew?: string }): Promise<string> {
    const res = await this.call<{ data: Resource<{ locale: string }>[] }>("GET", `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
    const found = res.data.find((l) => l.attributes.locale === locale);
    if (found) {
      await this.call("PATCH", `/v1/appStoreVersionLocalizations/${found.id}`, { data: { type: "appStoreVersionLocalizations", id: found.id, attributes } });
      return found.id;
    }
    const made = await this.call<{ data: Resource }>("POST", "/v1/appStoreVersionLocalizations", {
      data: { type: "appStoreVersionLocalizations", attributes: { locale, ...attributes }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } } },
    });
    return made.data.id;
  }

  async writeReviewDetail(versionId: string, attributes: { contactFirstName: string; contactLastName: string; contactEmail: string; contactPhone: string; notes: string; demoAccountRequired: boolean }): Promise<void> {
    let id: string | null = null;
    try {
      id = (await this.call<{ data?: Resource | null }>("GET", `/v1/appStoreVersions/${versionId}/appStoreReviewDetail`))?.data?.id ?? null;
    } catch (err) {
      if (!(err instanceof AppleError && err.status === 404)) throw err;
    }
    if (id) await this.call("PATCH", `/v1/appStoreReviewDetails/${id}`, { data: { type: "appStoreReviewDetails", id, attributes } });
    else await this.call("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } } } });
  }

  async attachBuild(versionId: string, buildId: string): Promise<void> {
    await this.call("PATCH", `/v1/appStoreVersions/${versionId}/relationships/build`, { data: { type: "builds", id: buildId } });
  }

  // A submission that is not with App Review yet, or that Apple returned with issues, and the version it holds.
  async openReviewSubmission(appId: string, platform: ApplePlatform): Promise<{ id: string; versionId: string | null } | null> {
    const res = await this.call<{ data: Resource[] }>("GET", `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=${applePlatformName(platform)}&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES&include=appStoreVersionForReview&limit=5`);
    const found = res.data[0];
    return found ? { id: found.id, versionId: asList(found.relationships?.appStoreVersionForReview?.data)[0]?.id ?? null } : null;
  }

  async createReviewSubmission(appId: string, platform: ApplePlatform): Promise<string> {
    const res = await this.call<{ data: Resource }>("POST", "/v1/reviewSubmissions", {
      data: { type: "reviewSubmissions", attributes: { platform: applePlatformName(platform) }, relationships: { app: { data: { type: "apps", id: appId } } } },
    });
    return res.data.id;
  }

  async addToReviewSubmission(submissionId: string, versionId: string): Promise<void> {
    await this.call("POST", "/v1/reviewSubmissionItems", {
      data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: submissionId } }, appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } } },
    });
  }

  async submitReviewSubmission(submissionId: string): Promise<void> {
    await this.call("PATCH", `/v1/reviewSubmissions/${submissionId}`, { data: { type: "reviewSubmissions", id: submissionId, attributes: { submitted: true } } });
  }

  // The Release button for a version Apple approved with manual release.
  async releaseVersion(versionId: string): Promise<void> {
    await this.call("POST", "/v1/appStoreVersionReleaseRequests", { data: { type: "appStoreVersionReleaseRequests", relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } } } });
  }

  // The App Asset Library: an image is uploaded once into the app's library, then placed on a version localization.

  async assetLibrary(appId: string): Promise<string> {
    return (await this.call<{ data: Resource }>("GET", `/v1/apps/${appId}/assetLibrary`)).data.id;
  }

  // Apple's catalog of placement groups and image sizes for App Store version screenshots.
  async assetReferenceData(): Promise<AssetReferenceData> {
    const res = await this.call<{ data: Resource<AssetReferenceData>[] }>("GET", "/v1/appAssetLibraryRefData?filter[features]=APP_STORE_VERSIONS&fields[appAssetLibraryRefData]=features,placementProfileGroups,imageSpecs,placementTypes,displayClasses");
    return res.data[0]?.attributes ?? {};
  }

  // The screenshot placements on a version localization, in display order, with the image each places and its state.
  async screenshotPlacements(localizationId: string): Promise<{ id: string; group: string; state: string; imageId: string | null; imageState: string | null; imageDetails: string[] }[]> {
    const res = await this.call<{ data: Resource<{ placementGroup?: string; state?: string }>[]; included?: Resource<{ state?: string; stateDetails?: { code?: string; description?: string }[] | null }>[] }>(
      "GET",
      `/v1/appStoreVersionLocalizations/${localizationId}/placements?filter[placementType]=APP_SCREENSHOT&sort=placementGroupPosition&include=image&fields[appAssetLibraryImages]=state,stateDetails&limit=200`,
    );
    return res.data.map((p) => {
      const imageId = asList(p.relationships?.image?.data)[0]?.id ?? null;
      const image = res.included?.find((i) => i.type === "appAssetLibraryImages" && i.id === imageId);
      return { id: p.id, group: p.attributes.placementGroup ?? "", state: p.attributes.state ?? "", imageId, imageState: image?.attributes.state ?? null, imageDetails: (image?.attributes.stateDetails ?? []).map((d) => d.description ?? d.code ?? "error") };
    });
  }

  async deletePlacement(placementId: string): Promise<void> {
    await this.call("DELETE", `/v1/appAssetLibraryPlacements/${placementId}`);
  }

  async imageIsPlaced(imageId: string): Promise<boolean> {
    return (await this.call<{ data: Linkage[] }>("GET", `/v1/appAssetLibraryImages/${imageId}/relationships/placements?limit=1`)).data.length > 0;
  }

  async deleteImage(imageId: string): Promise<void> {
    await this.call("DELETE", `/v1/appAssetLibraryImages/${imageId}`);
  }

  // Reserves an image in the library; the bytes go to the returned operations, then commitImage.
  async reserveImage(libraryId: string, fileName: string, fileSize: number, referenceName: string): Promise<{ id: string; operations: UploadOperation[] }> {
    const res = await this.call<{ data: Resource<{ uploadOperations?: UploadOperation[] }> }>("POST", "/v1/appAssetLibraryImages", {
      data: { type: "appAssetLibraryImages", attributes: { fileName, fileSize, category: "APP_SCREENSHOTS_AND_PREVIEWS", referenceName }, relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: libraryId } } } },
    });
    return { id: res.data.id, operations: res.data.attributes.uploadOperations ?? [] };
  }

  // Apple checks the bytes against the reserved file size; the asset library takes no checksum.
  async commitImage(imageId: string): Promise<void> {
    await this.call("PATCH", `/v1/appAssetLibraryImages/${imageId}`, { data: { type: "appAssetLibraryImages", id: imageId, attributes: { uploaded: true } } });
  }

  async placeScreenshot(localizationId: string, imageId: string, group: string): Promise<string> {
    const res = await this.call<{ data: Resource }>("POST", "/v1/appAssetLibraryPlacements", {
      data: {
        type: "appAssetLibraryPlacements",
        attributes: { placementType: "APP_SCREENSHOT", placementGroup: group },
        relationships: { image: { data: { type: "appAssetLibraryImages", id: imageId } }, appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } } },
      },
    });
    return res.data.id;
  }

  async orderPlacements(localizationId: string, group: string, placementIds: string[]): Promise<void> {
    await this.call("POST", "/v1/appAssetLibraryPlacementOrderingRequests", {
      data: {
        type: "appAssetLibraryPlacementOrderingRequests",
        attributes: { placementGroup: group },
        relationships: { orderedPlacements: { data: placementIds.map((id) => ({ type: "appAssetLibraryPlacements", id })) }, appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } } },
      },
    });
  }

  // An Apple Distribution certificate signs the iPhone and iPad builds that go to TestFlight.
  async createDistributionCertificate(csrPem: string, certificateType: "DISTRIBUTION" | "MAC_INSTALLER_DISTRIBUTION" = "DISTRIBUTION", check?: () => Promise<void>): Promise<{ id: string; name: string; serialNumber: string; certificateContent: string; expirationDate: string | null }> {
    const res = await this.call<{ data: Resource<{ name: string; serialNumber: string; certificateContent: string; expirationDate?: string }> }>("POST", "/v1/certificates", {
      data: { type: "certificates", attributes: { certificateType, csrContent: csrPem } },
    }, undefined, check);
    const a = res.data.attributes;
    return { id: res.data.id, name: a.name, serialNumber: a.serialNumber, certificateContent: a.certificateContent, expirationDate: a.expirationDate ?? null };
  }

  // Apple Pay

  async merchants(identifier?: string): Promise<Merchant[]> {
    const filter = identifier ? `filter[identifier]=${encodeURIComponent(identifier)}&` : "";
    const res = await this.call<{ data: Resource<{ identifier?: string; name?: string }>[] }>("GET", `/v1/merchantIds?${filter}fields[merchantIds]=identifier,name&sort=identifier&limit=200`);
    return res.data.map((m) => ({ id: m.id, identifier: m.attributes.identifier ?? "", name: m.attributes.name ?? "" })).filter((m) => !identifier || m.identifier === identifier);
  }

  async createMerchant(identifier: string, name: string, check?: () => Promise<void>): Promise<Merchant> {
    const res = await this.call<{ data: Resource<{ identifier?: string; name?: string }> }>("POST", "/v1/merchantIds", { data: { type: "merchantIds", attributes: { identifier, name } } }, undefined, check);
    return { id: res.data.id, identifier: res.data.attributes.identifier ?? identifier, name: res.data.attributes.name ?? name };
  }

  // A Payment Processing certificate from the payment processor's request; the private key stays with the processor.
  async createPaymentCertificate(csrPem: string, merchantId: string, check?: () => Promise<void>): Promise<{ id: string; name: string; serialNumber: string; certificateContent: string; expirationDate: string | null; activated: boolean | null }> {
    const res = await this.call<{ data: Resource<{ name: string; serialNumber: string; certificateContent: string; expirationDate?: string; activated?: boolean }> }>("POST", "/v1/certificates", {
      data: { type: "certificates", attributes: { certificateType: "APPLE_PAY", csrContent: csrPem }, relationships: { merchantId: { data: { type: "merchantIds", id: merchantId } } } },
    }, undefined, check);
    const a = res.data.attributes;
    return { id: res.data.id, name: a.name, serialNumber: a.serialNumber, certificateContent: a.certificateContent, expirationDate: a.expirationDate ?? null, activated: typeof a.activated === "boolean" ? a.activated : null };
  }

  // Apple uses one Payment Processing certificate of a merchant identifier at a time; activating one deactivates the others.
  async activateCertificate(certificateId: string, check?: () => Promise<void>): Promise<void> {
    await this.call("PATCH", `/v1/certificates/${encodeURIComponent(certificateId)}`, { data: { type: "certificates", id: certificateId, attributes: { activated: true } } }, undefined, check);
  }

  // Which of a merchant identifier's Payment Processing certificates Apple uses.
  async paymentCertificates(merchantId: string): Promise<{ id: string; activated: boolean | null }[]> {
    const res = await this.call<{ data: Resource<{ activated?: boolean }>[] }>("GET", `/v1/merchantIds/${encodeURIComponent(merchantId)}/certificates?filter[certificateType]=APPLE_PAY&fields[certificates]=activated&limit=200`);
    return res.data.map((c) => ({ id: c.id, activated: typeof c.attributes?.activated === "boolean" ? c.attributes.activated : null }));
  }

  // Turns a capability on for an App ID unless it is on already; true when it was turned on now. Apple has no setting
  // that assigns a merchant identifier.
  async ensureCapability(bundleIdRes: string, capabilityType: string, check?: () => Promise<void>): Promise<boolean> {
    const res = await this.call<{ data: Resource<{ capabilityType?: string }>[] }>("GET", `/v1/bundleIds/${encodeURIComponent(bundleIdRes)}/bundleIdCapabilities?limit=200`);
    if (res.data.some((c) => c.attributes.capabilityType === capabilityType)) return false;
    await this.call("POST", "/v1/bundleIdCapabilities", {
      data: { type: "bundleIdCapabilities", attributes: { capabilityType }, relationships: { bundleId: { data: { type: "bundleIds", id: bundleIdRes } } } },
    }, undefined, check);
    return true;
  }
}

export interface Merchant {
  id: string;
  identifier: string;
  name: string;
}

export interface UploadOperation {
  method: string;
  url: string;
  offset: number;
  length: number;
  requestHeaders?: { name: string; value: string }[];
}

// detail is Apple's own explanation, without the request; code is Apple's first error code.
export class AppleError extends Error {
  constructor(public status: number, message: string, public detail = message, public code = "") {
    super(message);
  }
}

export interface AppInfoState {
  id: string;
  category: string | null;
  // attributes is null when Apple returned the declaration's id without its answers.
  ageRating: { id: string; attributes: Record<string, unknown> | null } | null;
  localizations: { id: string; locale: string; privacyPolicyUrl: string | null; privacyPolicyText: string | null }[];
}

// The parts of Apple's App Asset Library reference data ourapps reads.
export interface AssetReferenceData {
  features?: { featureId?: string; placementPolicies?: { placementType?: string; groupLimits?: { groupIds?: string[]; maxCount?: number }[] }[] }[];
  placementProfileGroups?: { placementProfileGroupId?: string; platform?: string; displayClassId?: string }[];
  imageSpecs?: { specId?: string; dimensions?: { minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number }; alphaAllowed?: boolean }[];
  placementTypes?: { placementTypeId?: string; specMappings?: { placementGroupId?: string; specs?: string[] }[] }[];
  displayClasses?: { displayClassId?: string; deviceFamily?: string; screenDimensions?: string[] }[];
}

export interface StoreVersion {
  id: string;
  versionString: string;
  // Apple's appVersionState, or the older appStoreState in its terms.
  state: string;
  releaseType: string | null;
}

const OLD_STATES: Record<string, string> = { READY_FOR_SALE: "READY_FOR_DISTRIBUTION", PROCESSING_FOR_APP_STORE: "PROCESSING_FOR_DISTRIBUTION" };

function storeVersion(r: Resource<{ versionString?: string; appVersionState?: string; appStoreState?: string; releaseType?: string }>): StoreVersion {
  const a = r.attributes ?? {};
  const old = a.appStoreState ?? "";
  return { id: r.id, versionString: a.versionString ?? "", state: a.appVersionState ?? OLD_STATES[old] ?? old, releaseType: a.releaseType ?? null };
}
