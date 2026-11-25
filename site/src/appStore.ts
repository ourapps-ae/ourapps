// The App Store card on an app's page: per Apple platform, the steps from a TestFlight build to App Review,
// then Apple's review until the version is on the App Store.
import { AGE_RATING_FREQUENCY, AGE_RATING_LEVEL_LABELS, AGE_RATING_LEVELS, AGE_RATING_YES_NO, APP_STORE_CATEGORIES, POLICY_COLLECTS, POLICY_STORAGE } from "@my/store-shared";
import { api, type AppStoreStage, type AppStoreStatus, type AppStoreStep } from "./api.js";
import { html, type Raw } from "./html.js";
import { targetEnabled } from "./targets.js";
import { callout, errorBox, fmtDate, icon, pill, toast } from "./ui.js";

type Platform = AppStoreStatus["platform"];

export const PLATFORM_NAMES: Record<Platform, string> = { ios: "iPhone and iPad", macos: "Mac", tvos: "Apple TV" };

const STAGE_PILL: Record<AppStoreStage, [string, "ok" | "warn" | "bad" | "accent"]> = {
  draft: ["not submitted", "warn"],
  waiting: ["waiting for App Review", "accent"],
  "in-review": ["in App Review", "accent"],
  rejected: ["not approved by Apple", "bad"],
  "pending-release": ["approved, waiting for you", "accent"],
  releasing: ["going on the App Store", "accent"],
  ready: ["on the App Store", "ok"],
};

// Stages that wait on Apple; the card checks again by itself while one of them lasts.
const WAITING: AppStoreStage[] = ["waiting", "in-review", "releasing"];
const CHECK_MS = 60_000;
const CHECK_FOR_MS = 30 * 60_000;

interface FieldOpts { type?: string; placeholder?: string; max?: number; required?: boolean; hint?: string }
const field = (label: string, name: string, value: string, o: FieldOpts = {}): Raw =>
  html`<div class="field"><label>${label}</label><input type="${o.type ?? "text"}" name="${name}" value="${value}" placeholder="${o.placeholder ?? ""}" ${o.max ? html`maxlength="${o.max}"` : ""} ${o.required ? "required" : ""} />${o.hint ? html`<div class="hint">${o.hint}</div>` : ""}</div>`;
const area = (label: string, name: string, value: string, max: number, hint = ""): Raw =>
  html`<div class="field"><label>${label}</label><textarea name="${name}" maxlength="${max}" rows="4">${value}</textarea>${hint ? html`<div class="hint">${hint}</div>` : ""}</div>`;
const saveButton = (text = "Save and continue") => html`<button class="btn sm" type="submit">${text}</button>`;
const stepError = (error: string | null) => (error ? callout("bad", html`<p>${error}</p>`) : "");

function appInfoForm(s: AppStoreStatus): Raw {
  const a = s.appInfo;
  const own = Boolean(a.privacyPolicyUrl);
  const p = a.defaultPolicy;
  return html`
    <form data-as-form="app-info" class="mt-s">
      ${stepError(a.error)}
      <p class="small muted">Once per app, for every platform. The app is free, in every country and region the App Store serves.</p>
      <div class="field"><label>Listing</label>
        <label class="check"><input type="radio" name="listing" value="public" ${a.listing === "public" ? "checked" : ""} /> <span>Public: anyone can find it on the App Store</span></label>
        <label class="check"><input type="radio" name="listing" value="unlisted" ${a.listing === "unlisted" ? "checked" : ""} /> <span>Unlisted: only people with the link can find it</span></label>
        <div class="hint">Apple grants unlisted distribution on request, after the app is submitted to App Review. ourapps adds Apple's note to the review notes and holds the release until you mark it granted.</div>
      </div>
      <div class="field"><label>Category</label><select name="category"><option value="">Choose one</option>${Object.entries(APP_STORE_CATEGORIES).map(([id, label]) => html`<option value="${id}" ${a.category === id ? "selected" : ""}>${label}</option>`)}</select></div>
      <div class="field"><label>Age rating: how often does the app show</label>
        ${Object.entries(AGE_RATING_FREQUENCY).map(([key, label]) => html`<div class="row wrap small"><span class="grow">${label}</span><select name="age-${key}">${AGE_RATING_LEVELS.map((level) => html`<option value="${level}" ${a.ageRating[key] === level ? "selected" : ""}>${AGE_RATING_LEVEL_LABELS[level]}</option>`)}</select></div>`)}
      </div>
      <div class="field"><label>Age rating: does the app have</label>
        ${Object.entries(AGE_RATING_YES_NO).map(([key, label]) => html`<label class="check small"><input type="checkbox" name="age-${key}" ${a.ageRating[key] === true ? "checked" : ""} /> <span>${label}</span></label>`)}
      </div>
      <label class="check"><input type="checkbox" name="thirdPartyContent" ${a.thirdPartyContent ? "checked" : ""} /> <span>The app shows, or gives access to, content that belongs to someone else</span></label>
      <div class="field"><label>Privacy policy</label>
        <label class="check"><input type="radio" name="policy" value="own" ${own ? "checked" : ""} /> <span>My own policy, at this address</span></label>
        ${field("Policy address", "privacyPolicyUrl", a.privacyPolicyUrl, { type: "url", placeholder: "https://" })}
        <label class="check"><input type="radio" name="policy" value="default" ${own ? "" : "checked"} /> <span>Write one for me from these answers</span></label>
        <div class="hint">ourapps serves it at its own address, in your name; you are responsible for it. Level N Ltd only hosts the text.${p.url ? html` <a href="${p.url}" target="_blank" rel="noopener">Read it</a>.` : ""}</div>
        <div class="small mt-s">What the app collects</div>
        ${Object.entries(POLICY_COLLECTS).map(([id, label]) => html`<label class="check small"><input type="checkbox" name="collects" value="${id}" ${p.collects.includes(id) ? "checked" : ""} /> <span>${label}</span></label>`)}
        <div class="small mt-s">Where it is kept</div>
        ${Object.entries(POLICY_STORAGE).map(([id, label]) => html`<label class="check small"><input type="radio" name="storage" value="${id}" ${p.storage === id ? "checked" : ""} /> <span>${label}</span></label>`)}
        ${field("Contact email in the policy", "contactEmail", p.contactEmail, { type: "email", max: 120 })}
        ${field("Your name in the policy", "developerName", p.developerName, { max: 80 })}
      </div>
      ${saveButton()}
    </form>`;
}

function privacyStep(s: AppStoreStatus): Raw {
  return html`
    <p>Apple lets only you give the app's privacy answers. In App Store Connect, App Privacy, say what the app collects, matching the privacy policy, then press <b>Publish</b>.</p>
    <a class="btn sm secondary mt-s" href="${s.links!.appPrivacy}" target="_blank" rel="noopener">${icon("external")} Open App Privacy</a>
    <button class="btn sm mt-s" type="button" data-as-privacy>I have answered them</button>`;
}

function versionForm(s: AppStoreStatus): Raw {
  const v = s.version;
  return html`
    <form data-as-form="version" class="mt-s">
      ${stepError(v.error)}
      ${field("Version", "version", v.version, { max: 20, required: true, hint: v.suggested && v.suggested !== v.version ? `The newest TestFlight build is version ${v.suggested}.` : "The version number of the TestFlight build to submit." })}
      ${area("Description", "description", v.description, 4000)}
      ${field("Keywords", "keywords", v.keywords, { max: 100, required: true, hint: "Words people search for, separated by commas; 100 characters in all." })}
      ${field("Support address", "supportUrl", v.supportUrl, { type: "url", placeholder: "https://", required: true, hint: "A web page where people can reach you about the app." })}
      ${field("Copyright", "copyright", v.copyright, { max: 200, required: true, hint: "For example 2026 Poker Night Club." })}
      ${v.firstVersion ? "" : area("What's new", "whatsNew", v.whatsNew, 4000, "Shown on the App Store for this version.")}
      ${saveButton()}
    </form>`;
}

function screenshotStep(s: AppStoreStatus, platform: Platform): Raw {
  const sh = s.screenshots;
  const lists = platform === "ios" ? "iPhone and iPad lists" : `${PLATFORM_NAMES[platform]} list`;
  const [action, label] = !sh.started ? ["upload", "Check and upload screenshots"] : sh.pending > 0 ? ["continue", `Continue uploading (${sh.pending} to go)`] : !sh.checked ? ["continue", "Check with Apple"] : ["restart", "Upload again"];
  return html`
    ${stepError(sh.error)}
    <p>ourapps takes the app's screenshots from the ${lists} and the list for all versions on this page, then from my-app.json, checks each against the sizes Apple takes, uploads it to the app's asset library and places it on this version.</p>
    <ul class="bullets small">${sh.required.map((r) => html`<li><b>${r.label}</b>: ${r.groups.map((g, i) => html`${i ? ", or " : ""}${g.sizes} pixels${g.uploaded ? html` ${pill(`${g.uploaded} placed`, "ok")}` : ""}`)}</li>`)}</ul>
    ${sh.missing.length && sh.started ? callout("warn", html`${sh.missing.map((m) => html`<p>${m}</p>`)}`) : ""}
    ${sh.processing ? callout("info", html`<p>Apple is processing ${sh.processing} screenshot${sh.processing === 1 ? "" : "s"}; this usually takes a minute.</p>`) : ""}
    ${sh.items.some((i) => i.error) ? html`<ul class="bullets small">${sh.items.filter((i) => i.error).map((i) => html`<li><a href="${i.url}" target="_blank" rel="noopener">${i.url.split("/").pop()}</a> ${i.error}</li>`)}</ul>` : ""}
    <button class="btn sm mt-s" type="button" data-as-screenshots="${action}">${label}</button>`;
}

function reviewForm(s: AppStoreStatus): Raw {
  const r = s.review;
  return html`
    <form data-as-form="review" class="mt-s">
      ${stepError(r.error)}
      <p class="small muted">Who Apple's App Review contacts with questions, and anything a reviewer needs to know. Taken from the TestFlight review contact.</p>
      <div class="row wrap">${field("First name", "firstName", r.firstName, { max: 60, required: true })}${field("Last name", "lastName", r.lastName, { max: 60, required: true })}</div>
      <div class="row wrap">${field("Email", "email", r.email, { type: "email", max: 120, required: true })}${field("Phone, with country code", "phone", r.phone, { type: "tel", max: 40, required: true, placeholder: "+44 7700 900123" })}</div>
      ${area("Notes for the reviewer", "notes", r.notes, 3900, s.appInfo.listing === "unlisted" ? "ourapps adds Apple's note that the app is meant for unlisted distribution." : "")}
      ${saveButton()}
    </form>`;
}

function buildForm(s: AppStoreStatus): Raw {
  const b = s.build;
  if (b.candidates.length === 0) {
    return html`${stepError(b.error)}<p>TestFlight has no processed build of version ${s.version.version} yet. Once Apple has processed one, choose it here; the TestFlight card above shows where builds stand.</p>`;
  }
  return html`
    <form data-as-form="build" class="mt-s">
      ${stepError(b.error)}
      <div class="field"><label>TestFlight build of version ${s.version.version}</label><select name="buildNumber">${b.candidates.map((c) => html`<option value="${c.buildNumber}" ${c.buildNumber === b.buildNumber ? "selected" : ""}>Build ${c.buildNumber}${c.expiresAt ? `, lasts until ${fmtDate(c.expiresAt)}` : ""}</option>`)}</select></div>
      ${saveButton("Use this build")}
    </form>`;
}

function submitForm(s: AppStoreStatus): Raw {
  const held = s.appInfo.listing === "unlisted" && !s.appInfo.unlistedGrantedAt;
  const manual = s.submission.releaseType === "MANUAL";
  return html`
    <form data-as-form="submit" class="mt-s">
      ${stepError(s.submission.error)}
      ${held
        ? html`<p class="small">Apple grants unlisted distribution after the app is submitted, so this version waits for you to release it once Apple has granted it.</p>`
        : html`<div class="field"><label>When Apple approves it</label>
            <label class="check"><input type="radio" name="releaseType" value="AFTER_APPROVAL" ${manual ? "" : "checked"} /> <span>Put it on the App Store straight away</span></label>
            <label class="check"><input type="radio" name="releaseType" value="MANUAL" ${manual ? "checked" : ""} /> <span>Wait for me to press Release</span></label></div>`}
      <button class="btn sm" type="submit">Submit for review</button>
    </form>`;
}

const STEP_INFO: Record<AppStoreStep, { title: string; about: string; done: (s: AppStoreStatus) => string }> = {
  "app-info": { title: "App information", about: "Listing, category, age rating, content rights and privacy policy, once per app.", done: (s) => `${s.appInfo.listing === "unlisted" ? "Unlisted" : "Public"}, ${APP_STORE_CATEGORIES[s.appInfo.category] ?? s.appInfo.category}, free in every country and region.` },
  privacy: { title: "App privacy answers", about: "What the app collects, answered by you in App Store Connect.", done: () => "Answered in App Store Connect." },
  version: { title: "Version text", about: "Description, keywords, support address and copyright.", done: (s) => `Version ${s.version.version}.` },
  screenshots: { title: "Screenshots", about: "The app's screenshots in the sizes Apple takes.", done: (s) => `${s.screenshots.items.filter((i) => i.uploaded).length} uploaded.` },
  review: { title: "Review contact and notes", about: "Who Apple's App Review contacts.", done: (s) => `${s.review.firstName} ${s.review.lastName}, ${s.review.email}.` },
  build: { title: "The build", about: "A processed TestFlight build of this version.", done: (s) => `Build ${s.build.buildNumber}.` },
  submit: { title: "Submit", about: "Sends the version to Apple's App Review.", done: () => "Submitted." },
};

const STEP_ORDER: AppStoreStep[] = ["app-info", "privacy", "version", "screenshots", "review", "build", "submit"];

function stepBody(s: AppStoreStatus, step: AppStoreStep, platform: Platform): Raw {
  switch (step) {
    case "app-info": return appInfoForm(s);
    case "privacy": return privacyStep(s);
    case "version": return versionForm(s);
    case "screenshots": return screenshotStep(s, platform);
    case "review": return reviewForm(s);
    case "build": return buildForm(s);
    case "submit": return submitForm(s);
  }
}

function isDone(s: AppStoreStatus, step: AppStoreStep): boolean {
  return step === "submit" ? false : step === "privacy" ? s.privacy.done : (s[step === "app-info" ? "appInfo" : step] as { done: boolean }).done;
}

// Each step before the submission: done ones say what Apple has and can be opened again, the current one asks for
// what it needs, later ones say what they are for.
function stepList(s: AppStoreStatus, platform: Platform, open: AppStoreStep | null): Raw {
  const current = open ?? s.step;
  return html`
    <ol class="timeline">
      ${STEP_ORDER.map((step, i) => {
        const info = STEP_INFO[step];
        const done = isDone(s, step);
        const cls = step === current ? "now" : done ? "done" : "muted-step";
        const mark = cls === "done" ? icon("check", "icon-16") : String(i + 1);
        const body = step === current ? stepBody(s, step, platform) : html`<p>${done ? info.done(s) : info.about}${done ? html` <button class="link-btn" type="button" data-as-open="${step}">Change</button>` : ""}</p>`;
        return html`<li class="${cls}" data-as-step="${step}"><div class="mark">${mark}</div><div><h3>${info.title}</h3>${body}</div></li>`;
      })}
    </ol>`;
}

// After the submission: Apple's review, the release, and the App Store.
function reviewProgress(s: AppStoreStatus, platform: Platform): Raw {
  const sub = s.submission;
  const label = `version ${s.version.version}`;
  const unlisted = s.appInfo.listing === "unlisted";
  const granted = Boolean(s.appInfo.unlistedGrantedAt);
  const unlistedNote = unlisted && s.stage !== "ready"
    ? granted
      ? html`<p class="small muted">Apple granted unlisted distribution ${fmtDate(s.appInfo.unlistedGrantedAt)}.</p>`
      : html`<p class="small">Ask Apple for unlisted distribution with <a href="${s.links!.unlistedRequest}" target="_blank" rel="noopener">Apple's request form</a>. When Apple's email says it is granted, <button class="link-btn" type="button" data-as-granted>mark it granted</button>.</p>`
    : "";
  const order: AppStoreStage[][] = [["waiting", "in-review"], ["pending-release", "releasing"], ["ready"]];
  const at = order.findIndex((list) => list.includes(s.stage));
  const reviewNow = html`<p>${s.stage === "in-review" ? "Apple is reviewing" : "Waiting for Apple to review"} ${label}${sub.submittedAt ? `, sent ${fmtDate(sub.submittedAt, true)}` : ""}. Nothing to do: ourapps checks every ten minutes.${sub.appleState ? html` Apple says <code>${sub.appleState}</code>.` : ""}</p>${sub.message ? callout("info", html`<p>${sub.message}</p>`) : ""}`;
  const releaseNow = s.stage === "pending-release"
    ? html`<p>Apple approved ${label}. It goes on the App Store when you press Release.</p>${unlisted && !granted ? callout("warn", html`<p>Release once Apple has granted unlisted distribution.</p>`) : ""}<button class="btn sm mt-s" type="button" data-as-release ${unlisted && !granted ? "disabled" : ""}>Release</button>`
    : html`<p>Apple is putting ${label} on the App Store${sub.releasedAt ? `, released ${fmtDate(sub.releasedAt, true)}` : ""}. It can take up to a day to appear.</p>`;
  const steps = [
    { title: "App Review", done: `Approved.`, now: reviewNow, later: "" },
    { title: "Release", done: "Released.", now: releaseNow, later: sub.releaseType === "MANUAL" ? "You press Release once Apple approves it." : "Goes on the App Store as soon as Apple approves it." },
    { title: "On the App Store", done: "", now: html`<p>${label} is on the App Store. ${s.storeUrl ? html`<a href="${s.storeUrl}" target="_blank" rel="noopener">Open its page</a>.` : ""} The install page offers it for ${PLATFORM_NAMES[platform]} beside the TestFlight invitation.</p><button class="btn sm secondary mt-s" type="button" data-as-open="version">Prepare the next version</button>`, later: "" },
  ];
  return html`
    ${unlistedNote}
    <ol class="timeline">
      ${steps.map((step, i) => {
        const cls = i < at ? "done" : i === at ? "now" : "muted-step";
        const mark = cls === "done" ? icon("check", "icon-16") : String(i + 1);
        const body = cls === "done" ? html`<p>${step.done}</p>` : cls === "now" ? step.now : html`<p>${step.later}</p>`;
        return html`<li class="${cls}"><div class="mark">${mark}</div><div><h3>${step.title}</h3>${body}</div></li>`;
      })}
    </ol>`;
}

export function appStoreCard(s: AppStoreStatus, platform: Platform, open: AppStoreStep | null = null): Raw {
  const name = PLATFORM_NAMES[platform];
  const head = html`<div class="row wrap"><div class="grow card-title"><h2>App Store</h2><p class="small faint">Takes a TestFlight build of the ${name} app to Apple's App Review and onto the App Store.</p></div>${s.setUp ? pill(STAGE_PILL[s.stage][0], STAGE_PILL[s.stage][1], true) : pill("needs TestFlight", "warn")}</div>`;
  if (!s.setUp) return html`<div class="card mt">${head}<p class="small">Set up ${name} TestFlight first: App Store review takes one of its builds.</p></div>`;
  const editing = s.stage === "draft" || s.stage === "rejected";
  const live = s.submission.liveVersion && s.storeUrl ? html`<p class="small">Version ${s.submission.liveVersion} is <a href="${s.storeUrl}" target="_blank" rel="noopener">on the App Store</a>.</p>` : "";
  const rejected = s.stage === "rejected"
    ? callout("bad", html`<p>${s.submission.message ?? "Apple's App Review did not approve this version."}</p><p><a href="${s.links!.appReview}" target="_blank" rel="noopener">Read Apple's messages in App Store Connect</a>.</p>`)
    : "";
  const followError = s.submission.error && !editing ? callout("warn", html`<p>${s.submission.error}</p>`) : "";
  const body = editing || open ? html`${rejected}${stepList(s, platform, open)}` : reviewProgress(s, platform);
  return html`<div class="card mt">${head}${live}${followError}${body}<div data-as-result></div></div>`;
}

// Reads a form into the body the worker takes for that step.
export function formBody(step: AppStoreStep, form: HTMLFormElement): Record<string, unknown> {
  const fd = new FormData(form);
  const value = (name: string) => String(fd.get(name) ?? "");
  if (step === "app-info") {
    const ageRating: Record<string, string | boolean> = {};
    for (const key of Object.keys(AGE_RATING_FREQUENCY)) ageRating[key] = value(`age-${key}`) || "NONE";
    for (const key of Object.keys(AGE_RATING_YES_NO)) ageRating[key] = fd.get(`age-${key}`) === "on";
    const own = value("policy") === "own";
    return {
      appInfo: {
        listing: value("listing") || "public",
        category: value("category"),
        ageRating,
        thirdPartyContent: fd.get("thirdPartyContent") === "on",
        privacyPolicyUrl: own ? value("privacyPolicyUrl") : "",
        ...(own ? {} : { defaultPolicy: { collects: fd.getAll("collects").map(String), storage: value("storage") || "device", contactEmail: value("contactEmail"), developerName: value("developerName") } }),
      },
    };
  }
  if (step === "version") return { version: Object.fromEntries(["version", "description", "keywords", "supportUrl", "copyright", "whatsNew"].filter((k) => fd.has(k)).map((k) => [k, value(k)])) };
  if (step === "review") return { review: Object.fromEntries(["firstName", "lastName", "email", "phone", "notes"].map((k) => [k, value(k)])) };
  if (step === "build") return { build: { buildNumber: value("buildNumber") } };
  return { releaseType: value("releaseType") || undefined };
}

export async function loadAppStoreCard(root: HTMLElement, appId: string, platform: Platform): Promise<void> {
  const box = root.querySelector<HTMLElement>(`#${platform}-appstore-card`);
  if (!box) return;
  const path = `/api/dev/apps/${appId}/appstore/${platform}`;
  let s: AppStoreStatus;
  try {
    s = await api<AppStoreStatus>("GET", path);
  } catch (err) {
    box.innerHTML = errorBox(err).html;
    return;
  }
  let open: AppStoreStep | null = null;
  let timer: number | undefined;
  let until = Date.now() + CHECK_FOR_MS;
  const result = (err: unknown) => {
    const el = box.querySelector<HTMLElement>("[data-as-result]");
    if (el) el.innerHTML = errorBox(err).html;
  };
  // Runs one change at Apple and shows the answer; the button shows it is busy meanwhile.
  const act = async (button: HTMLButtonElement, busy: string, call: () => Promise<AppStoreStatus>, done: string) => {
    if (!targetEnabled(root, platform)) return;
    const text = button.textContent;
    button.disabled = true;
    button.textContent = busy;
    try {
      s = await call();
      open = null;
      render();
      toast(done);
      until = Date.now() + CHECK_FOR_MS;
      schedule();
    } catch (err) {
      button.disabled = false;
      button.textContent = text;
      try {
        s = await api<AppStoreStatus>("GET", path);
        render();
      } catch {
        // The error below says enough.
      }
      result(err);
    }
  };
  const render = () => {
    box.innerHTML = appStoreCard(s, platform, open).html;
    box.querySelectorAll<HTMLButtonElement>("[data-as-open]").forEach((b) => (b.onclick = () => {
      open = b.dataset.asOpen as AppStoreStep;
      render();
      box.querySelector(`[data-as-step="${open}"]`)?.scrollIntoView({ block: "nearest" });
    }));
    box.querySelectorAll<HTMLFormElement>("[data-as-form]").forEach((form) => (form.onsubmit = (e) => {
      e.preventDefault();
      const step = form.dataset.asForm as AppStoreStep;
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      const body = formBody(step, form);
      if (step === "submit") void act(button, "Submitting...", () => api<AppStoreStatus>("POST", `${path}/submit`, body), "Sent to Apple's App Review");
      else void act(button, "Saving with Apple...", () => api<AppStoreStatus>("PUT", path, body), "Saved with Apple");
    }));
    const privacy = box.querySelector<HTMLButtonElement>("[data-as-privacy]");
    if (privacy) privacy.onclick = () => void act(privacy, "Saving...", () => api<AppStoreStatus>("PUT", path, { privacyAnswered: true }), "Saved");
    const granted = box.querySelector<HTMLButtonElement>("[data-as-granted]");
    if (granted) granted.onclick = () => void act(granted, "Saving...", () => api<AppStoreStatus>("PUT", path, { unlistedGranted: true }), "Saved");
    const release = box.querySelector<HTMLButtonElement>("[data-as-release]");
    if (release) release.onclick = () => void act(release, "Releasing...", () => api<AppStoreStatus>("POST", `${path}/release`), "Released");
    const shots = box.querySelector<HTMLButtonElement>("[data-as-screenshots]");
    if (shots) {
      shots.onclick = () => void act(shots, "Checking and uploading...", async () => {
        // Each request does a bounded share; the rest follows in the next, while Apple processes what arrived.
        let next = await api<AppStoreStatus>("POST", `${path}/screenshots`, shots.dataset.asScreenshots === "restart" ? { restart: true } : undefined);
        for (let i = 0; i < 30 && (next.screenshots.pending > 0 || (!next.screenshots.checked && i < 3)); i++) {
          shots.textContent = next.screenshots.pending > 0 ? `Uploading, ${next.screenshots.pending} to go...` : "Waiting for Apple...";
          if (next.screenshots.pending === 0) await new Promise((done) => setTimeout(done, 5000));
          next = await api<AppStoreStatus>("POST", `${path}/screenshots`);
        }
        return next;
      }, "Screenshots checked");
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!WAITING.includes(s.stage) || Date.now() > until) return;
    timer = window.setTimeout(async () => {
      if (!box.isConnected) return;
      if (document.visibilityState === "visible") {
        try {
          const next = await api<AppStoreStatus>("GET", path);
          if (next.stage !== s.stage || next.submission.appleState !== s.submission.appleState) {
            s = next;
            if (!open) render();
          }
        } catch {
          // The next check tries again.
        }
      }
      schedule();
    }, CHECK_MS);
  };
  render();
  schedule();
}
