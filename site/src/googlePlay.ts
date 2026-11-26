// The Google Play card on an app's page: the steps done by hand in Play Console and through Google's API, as a step list
// like the App Store card, then the releases Google is reviewing and publishing.
import { LISTING_LIMITS, POLICY_COLLECTS, POLICY_STORAGE, RELEASE_NOTES_MAX, TRACK_LABELS } from "@my/store-shared";
import { api, type GooglePlayStage, type GooglePlayStatus, type GooglePlayStep, type GooglePlayTrack } from "./api.js";
import { html, type Raw } from "./html.js";
import { targetEnabled } from "./targets.js";
import { callout, errorBox, fmtDate, icon, pill, toast, wireCopy } from "./ui.js";

const STEP_ORDER: GooglePlayStep[] = ["app", "content", "listing", "graphics", "release"];
const WAITING: GooglePlayStage[] = ["sent", "in-review"];
const CHECK_MS = 60_000;
const CHECK_FOR_MS = 30 * 60_000;

const STAGE_PILL: Record<GooglePlayStage, [string, "ok" | "warn" | "bad" | "accent" | ""]> = {
  sent: ["sent to Google", "accent"],
  "not-sent": ["held in Play Console", "warn"],
  "in-review": ["in Google's review", "accent"],
  approved: ["approved, waiting for you", "accent"],
  rejected: ["not approved by Google", "bad"],
  draft: ["draft in Play Console", "warn"],
  live: ["live", "ok"],
  replaced: ["replaced", ""],
};

interface FieldOpts { type?: string; placeholder?: string; max?: number; required?: boolean; hint?: string }
const field = (label: string, name: string, value: string, o: FieldOpts = {}): Raw =>
  html`<div class="field"><label>${label}</label><input type="${o.type ?? "text"}" name="${name}" value="${value}" placeholder="${o.placeholder ?? ""}" ${o.max ? html`maxlength="${o.max}"` : ""} ${o.required ? "required" : ""} />${o.hint ? html`<div class="hint">${o.hint}</div>` : ""}</div>`;
const area = (label: string, name: string, value: string, max: number, hint = ""): Raw =>
  html`<div class="field"><label>${label}</label><textarea name="${name}" maxlength="${max}" rows="4">${value}</textarea>${hint ? html`<div class="hint">${hint}</div>` : ""}</div>`;
const stepError = (error: string | null) => (error ? callout("bad", html`<p>${error}</p>`) : "");
const copyable = (text: string): Raw => html`<code>${text}</code> <button type="button" class="btn sm ghost" data-copy="${text}">${icon("copy")} Copy</button>`;
const external = (href: string, text: string): Raw => html`<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

// Play App Signing re-signs what Google Play delivers; only the same key lets phones with the APK take Play's updates.
export function signingNote(s: GooglePlayStatus): Raw {
  return callout("info", html`
    <p><b>Signing.</b> Google Play signs what it delivers with its own app signing key, and the key your workflow signs with becomes the upload key. A phone that has the APK from ourapps then cannot take Google Play's version as an update, because the signatures differ, unless Google Play signs with the same key. When Play Console asks how the app is signed at the first release, choose to give Google a copy of your existing key (the keystore the release workflow signs the APK with), following ${external(s.links.signing, "Google's instructions for Play App Signing")}. Use the same key for both.</p>`);
}

export const GOOGLE_PAY_CONSOLE = "https://pay.google.com/business/console";
const GOOGLE_PAY_ACCESS = "https://developers.google.com/pay/api/android/guides/test-and-deploy/request-prod-access";

// For apps that take payments: Google Pay's approval goes through the Play app, under the same Google account.
export function googlePayNote(): Raw {
  return callout("info", html`
    <p><b>Google Pay.</b> For an app that takes payments, Google approves Google Pay in the ${external(GOOGLE_PAY_CONSOLE, "Google Pay and Wallet Console")}, which lists only apps in Google Play under the Google account signed in to it. Use the same Google account for both, or invite the Play Console's owner or admin account under Users in the Google Pay and Wallet Console and sign in with it. A release on any track, Internal testing included, puts the app on that list; approval comes before the app goes public (${external(GOOGLE_PAY_ACCESS, "Google's steps")}). Google Pay in production checks the app's release signature, so the APK from ourapps takes Google Pay only when it is signed with the same key as the Google Play copy: when you gave Google Play your own key as the app signing key.</p>`);
}

function appStep(s: GooglePlayStatus): Raw {
  const pkg = s.packageName ?? "";
  return html`
    ${stepError(s.app.error)}
    <p>Google has no API to create an app. In ${external(s.links.console, "Play Console")}:</p>
    <ol class="steps small">
      <li><b>Create app</b>, with the package name ${pkg ? copyable(pkg) : "of the Android build (its application ID)"}, free, and the app's name.</li>
      <li>Upload the first bundle by hand: Test and release, Testing, <b>Internal testing</b>, <b>Create new release</b>, add the <code>.aab</code> from the latest GitHub release, then save and roll it out (${external(s.links.firstRelease, "Google's steps")}). Until Play has one bundle, Google answers ourapps that the package is not found.</li>
      <li>In <b>Users and permissions</b>, invite ${s.serviceAccount ? copyable(s.serviceAccount) : "the service account"} with access to this app: Release apps to testing tracks, Release to production, and Manage store presence.</li>
    </ol>
    <form data-gp-form="app" class="mt-s">
      ${field("Package name", "packageName", pkg, { max: 150, required: true, placeholder: "com.yourname.pokernight", hint: s.packageFrom === "my-app.json" ? "From the latest release's my-app.json." : "The Android build's application ID." })}
      <button class="btn sm" type="submit">Check with Google</button>
    </form>`;
}

function contentStep(s: GooglePlayStatus): Raw {
  const c = s.content;
  const own = Boolean(c.privacyPolicyUrl);
  const p = c.defaultPolicy;
  return html`
    ${stepError(c.error)}
    <p>Google has no API for App content; you answer it in Play Console: Monitor and improve, Policy and programs, <b>App content</b> (${external(s.links.appContent, "Google's guide")}). It covers the privacy policy, ads, app access, target audience, the content rating questionnaire and data safety.</p>
    <form data-gp-form="content" class="mt-s">
      <div class="field"><label>Privacy policy</label>
        <label class="check"><input type="radio" name="policy" value="own" ${own ? "checked" : ""} /> <span>My own policy, at this address</span></label>
        ${field("Policy address", "privacyPolicyUrl", c.privacyPolicyUrl, { type: "url", placeholder: "https://" })}
        <label class="check"><input type="radio" name="policy" value="default" ${own ? "" : "checked"} /> <span>Write one for me from these answers, the same as for the App Store</span></label>
        <div class="small mt-s">What the app collects</div>
        ${Object.entries(POLICY_COLLECTS).map(([id, label]) => html`<label class="check small"><input type="checkbox" name="collects" value="${id}" ${p.collects.includes(id) ? "checked" : ""} /> <span>${label}</span></label>`)}
        <div class="small mt-s">Where it is kept</div>
        ${Object.entries(POLICY_STORAGE).map(([id, label]) => html`<label class="check small"><input type="radio" name="storage" value="${id}" ${p.storage === id ? "checked" : ""} /> <span>${label}</span></label>`)}
        ${field("Contact email in the policy", "contactEmail", p.contactEmail, { type: "email", max: 120 })}
        ${field("Your name in the policy", "developerName", p.developerName, { max: 80 })}
      </div>
      <button class="btn sm secondary" type="submit">Save the policy</button>
    </form>
    ${c.policyAddress ? html`<p class="small mt-s">Paste this address under Privacy policy in App content: ${copyable(c.policyAddress)}</p>` : ""}
    <p class="small">In data safety, answer what the app collects as the policy says.</p>
    <button class="btn sm mt-s" type="button" data-gp-content ${c.policyAddress ? "" : "disabled"}>I have completed App content</button>`;
}

function listingForm(s: GooglePlayStatus): Raw {
  const l = s.listing;
  return html`
    <form data-gp-form="listing" class="mt-s">
      ${stepError(l.error)}
      ${field("App name", "title", l.title, { max: LISTING_LIMITS.title, required: true })}
      ${field("Short description", "shortDescription", l.shortDescription, { max: LISTING_LIMITS.shortDescription, required: true, hint: "The first line people see on the Google Play page." })}
      ${area("Full description", "fullDescription", l.fullDescription, LISTING_LIMITS.fullDescription)}
      ${field("Contact email", "contactEmail", l.contactEmail, { type: "email", max: 120, required: true, hint: "Shown on the Google Play page." })}
      ${field("Website", "contactWebsite", l.contactWebsite, { type: "url", placeholder: "https://" })}
      <button class="btn sm" type="submit">Save with Google</button>
    </form>`;
}

function graphicsStep(s: GooglePlayStatus): Raw {
  const g = s.graphics;
  const [action, label] = !g.started ? ["upload", "Check and upload graphics"] : g.pending > 0 ? ["continue", `Continue uploading (${g.pending} to go)`] : ["restart", "Upload again"];
  return html`
    ${stepError(g.error)}
    <p>ourapps takes the icon (512 x 512 PNG) from this page or my-app.json, the phone screenshots from the Android list, then the list for all versions, and the feature graphic and tablet screenshots below. It checks each against Google Play's rules, replaces the listing's earlier images and commits them together.</p>
    <form data-gp-form="graphics" class="mt-s">
      ${field("Feature graphic", "featureGraphicUrl", g.featureGraphicUrl, { type: "url", placeholder: "https://", hint: "Google Play requires one: 1024 x 500 pixels, JPEG or PNG without transparency." })}
      <div class="field"><label>Tablet screenshots <span class="faint tiny">optional</span></label><textarea name="tabletScreenshots" rows="3" placeholder="https://...">${g.tabletScreenshots.join("\n")}</textarea><div class="hint">When the app runs on tablets: up to 8, each side between 1080 and 7680 pixels; Google asks for at least 4.</div></div>
      <button class="btn sm secondary" type="submit">Save</button>
    </form>
    ${g.missing.length ? callout("warn", html`${g.missing.map((m) => html`<p>${m}</p>`)}`) : ""}
    ${g.items.some((i) => i.error) ? html`<ul class="bullets small">${g.items.filter((i) => i.error).map((i) => html`<li><a href="${i.url}" target="_blank" rel="noopener">${i.url.split("/").pop()}</a> ${i.error}</li>`)}</ul>` : ""}
    <button class="btn sm mt-s" type="button" data-gp-graphics="${action}">${label}</button>`;
}

function releaseForm(s: GooglePlayStatus): Raw {
  if (!s.release.bundle) return html`${stepError(s.release.error)}${callout("warn", html`<p>The latest release has no Android App Bundle. Google Play takes the <code>.aab</code>: the release workflow builds it, uploads it with the release and names it in my-app.json as <code>install.android.bundle</code>.</p>`)}`;
  return html`
    <form data-gp-form="release" class="mt-s">
      ${stepError(s.release.error)}
      <p class="small">Version ${s.release.version}: ourapps sends its bundle from the GitHub release to Google, puts it on the track and sends it to Google's review. It goes live when Google approves it.</p>
      <div class="field"><label>Track</label><select name="track">${(Object.keys(TRACK_LABELS) as GooglePlayTrack[]).map((t) => html`<option value="${t}">${TRACK_LABELS[t]}</option>`)}</select></div>
      ${field("Staged rollout, per cent", "rollout", "", { type: "number", placeholder: "100", hint: "Leave empty for everyone on the track; Google takes staged rollouts for updates, not a first release." })}
      ${area("Release notes", "releaseNotes", "", RELEASE_NOTES_MAX, `Empty takes version ${s.release.version}'s release notes; Google takes ${RELEASE_NOTES_MAX} characters.`)}
      <button class="btn sm" type="submit">Send to Google Play</button>
    </form>`;
}

function stepBody(s: GooglePlayStatus, step: GooglePlayStep): Raw {
  switch (step) {
    case "app": return appStep(s);
    case "content": return contentStep(s);
    case "listing": return listingForm(s);
    case "graphics": return graphicsStep(s);
    case "release": return releaseForm(s);
  }
}

const STEP_INFO: Record<GooglePlayStep, { title: string; about: string; done: (s: GooglePlayStatus) => string }> = {
  app: { title: "App record", about: "The app in Play Console, with its first bundle uploaded by hand.", done: (s) => `${s.app.packageName}, found ${fmtDate(s.app.foundAt)}.` },
  content: { title: "App content", about: "Privacy policy, ads, app access, audience, content rating and data safety, answered by you in Play Console.", done: (s) => `Completed in Play Console; policy at ${s.content.policyAddress}.` },
  listing: { title: "Store listing", about: "Name, descriptions and contact details.", done: (s) => `${s.listing.title}, in ${s.listing.language}.` },
  graphics: { title: "Graphics", about: "Icon, feature graphic and screenshots in the sizes Google Play takes.", done: (s) => `${s.graphics.items.filter((i) => i.uploaded).length} images on the listing.` },
  release: { title: "Release", about: "Sends the latest release's bundle to a track.", done: () => "" },
};

function isDone(s: GooglePlayStatus, step: GooglePlayStep): boolean {
  return step === "release" ? false : s[step].done;
}

function stepList(s: GooglePlayStatus, open: GooglePlayStep | null): Raw {
  const current = open ?? s.step;
  return html`
    <ol class="timeline">
      ${STEP_ORDER.map((step, i) => {
        const info = STEP_INFO[step];
        const done = isDone(s, step);
        const cls = step === current ? "now" : done ? "done" : "muted-step";
        const mark = cls === "done" ? icon("check", "icon-16") : String(i + 1);
        const body = step === current ? stepBody(s, step) : html`<p>${done ? info.done(s) : info.about}${done || (step === "release" && s.release.ready) ? html` <button class="link-btn" type="button" data-gp-open="${step}">${done ? "Change" : "Open"}</button>` : ""}</p>`;
        return html`<li class="${cls}" data-gp-step="${step}"><div class="mark">${mark}</div><div><h3>${info.title}</h3>${body}</div></li>`;
      })}
    </ol>`;
}

function releaseList(s: GooglePlayStatus): Raw {
  if (!s.releases.length) return html``;
  return html`
    <h3 class="mt">Releases</h3>
    <table class="table small mt-s">${s.releases.map((r) => html`<tr>
      <td>${TRACK_LABELS[r.track]}${r.userFraction ? `, ${Math.round(r.userFraction * 100)}%` : ""}</td>
      <td>${r.version} (${r.versionCode})</td>
      <td>${pill(STAGE_PILL[r.stage][0], STAGE_PILL[r.stage][1])}</td>
      <td>${r.message ?? (r.stage === "sent" || r.stage === "in-review" ? "Sent to Google for review; ourapps checks every ten minutes." : r.liveAt ? `Live since ${fmtDate(r.liveAt, true)}.` : "")}</td>
    </tr>`)}</table>`;
}

// New personal developer accounts need a closed test before Google grants production access.
function testingGate(s: GooglePlayStatus): Raw {
  const t = s.testing;
  const count = t.days === null
    ? "ourapps counts the days from its first release to Closed testing."
    : t.days >= t.requiredDays
      ? `ourapps' first closed test release was ${t.days} days ago; once 12 testers have stayed opted in for 14 days in a row, apply for production on the Dashboard in Play Console.`
      : `Day ${t.days} of ${t.requiredDays} since ourapps' first closed test release; the 14 days are complete on ${fmtDate(t.readyAt)} if 12 testers stay opted in throughout.`;
  return html`
    <h3 class="mt">Before production</h3>
    <p class="small">A personal developer account created after 13 November 2023 must run a closed test with at least 12 testers opted in for 14 days in a row, then apply for production access in Play Console; Google refuses production releases until it grants it, and Open testing opens with it (${external(s.links.testingRules, "Google's rules")}). ${count}</p>
    ${s.links.testing ? html`<p class="small">Testers join the closed or open test at ${copyable(s.links.testing)}; for Internal testing, Play Console shows the link under Testers.</p>` : ""}
    <label class="check small"><input type="checkbox" data-gp-testing ${t.testingLink ? "checked" : ""} /> <span>Offer the test's join page on the install page while a closed or open test is live</span></label>`;
}

export function googlePlayCard(s: GooglePlayStatus, open: GooglePlayStep | null = null): Raw {
  const latest = s.releases[0];
  const status = !s.setUp ? pill("needs a service account", "warn") : s.live.production ? pill("live on Google Play", "ok", true) : latest ? pill(STAGE_PILL[latest.stage][0], STAGE_PILL[latest.stage][1] || "accent", true) : pill("not released", "warn", true);
  const head = html`<div class="row wrap"><div class="grow card-title"><h2>Google Play</h2><p class="small faint">Takes the Android app to Google Play with your own Google Play developer account. The app is free.</p></div>${status}</div>`;
  if (!s.setUp) return html`<div class="card mt">${head}<p class="small">Save a Google service account key in <a href="/dev/settings#google-play">Settings</a> first; it lets ourapps work in your Google Play developer account.</p></div>`;
  const live = s.live.url ? html`<p class="small">The app is <a href="${s.live.url}" target="_blank" rel="noopener">live on Google Play</a>; the install page offers it beside the APK.</p>` : "";
  return html`<div class="card mt">${head}${live}${stepList(s, open)}${releaseList(s)}${testingGate(s)}${signingNote(s)}${googlePayNote()}<div data-gp-result></div></div>`;
}

// Reads a form into the body the worker takes for that step.
export function formBody(step: string, form: HTMLFormElement): Record<string, unknown> {
  const fd = new FormData(form);
  const value = (name: string) => String(fd.get(name) ?? "").trim();
  if (step === "app") return { app: { packageName: value("packageName") } };
  if (step === "content") {
    return value("policy") === "own"
      ? { content: { privacyPolicyUrl: value("privacyPolicyUrl") } }
      : { content: { defaultPolicy: { collects: fd.getAll("collects").map(String), storage: value("storage") || "device", contactEmail: value("contactEmail"), developerName: value("developerName") } } };
  }
  if (step === "listing") return { listing: Object.fromEntries(["title", "shortDescription", "fullDescription", "contactEmail", "contactWebsite"].map((k) => [k, value(k)])) };
  if (step === "graphics") return { graphics: { featureGraphicUrl: value("featureGraphicUrl"), tabletScreenshots: value("tabletScreenshots").split("\n").map((u) => u.trim()).filter(Boolean) } };
  const rollout = Number(value("rollout"));
  return { track: value("track"), ...(rollout > 0 && rollout < 100 ? { userFraction: rollout / 100 } : {}), ...(value("releaseNotes") ? { releaseNotes: value("releaseNotes") } : {}) };
}

export async function loadGooglePlayCard(root: HTMLElement, appId: string): Promise<void> {
  const box = root.querySelector<HTMLElement>("#android-googleplay-card");
  if (!box) return;
  const path = `/api/dev/apps/${appId}/googleplay`;
  let s: GooglePlayStatus;
  try {
    s = await api<GooglePlayStatus>("GET", path);
  } catch (err) {
    box.innerHTML = errorBox(err).html;
    return;
  }
  let open: GooglePlayStep | null = null;
  let timer: number | undefined;
  let until = Date.now() + CHECK_FOR_MS;
  const result = (err: unknown) => {
    const el = box.querySelector<HTMLElement>("[data-gp-result]");
    if (el) el.innerHTML = errorBox(err).html;
  };
  // Runs one change at Google and shows the answer; the button shows it is busy meanwhile.
  const act = async (button: HTMLButtonElement, busy: string, call: () => Promise<GooglePlayStatus>, done: string) => {
    if (!targetEnabled(root, "android")) return;
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
        s = await api<GooglePlayStatus>("GET", path);
        render();
      } catch {
        // The error below says enough.
      }
      result(err);
    }
  };
  const render = () => {
    box.innerHTML = googlePlayCard(s, open).html;
    wireCopy(box);
    box.querySelectorAll<HTMLButtonElement>("[data-gp-open]").forEach((b) => (b.onclick = () => {
      open = b.dataset.gpOpen as GooglePlayStep;
      render();
      box.querySelector(`[data-gp-step="${open}"]`)?.scrollIntoView({ block: "nearest" });
    }));
    box.querySelectorAll<HTMLFormElement>("[data-gp-form]").forEach((form) => (form.onsubmit = (e) => {
      e.preventDefault();
      const step = form.dataset.gpForm!;
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
      const body = formBody(step, form);
      if (step === "release") void act(button, "Sending the bundle to Google...", () => api<GooglePlayStatus>("POST", `${path}/release`, body), "Sent to Google Play");
      else void act(button, step === "app" || step === "listing" ? "Checking with Google..." : "Saving...", () => api<GooglePlayStatus>("PUT", path, body), "Saved");
    }));
    const content = box.querySelector<HTMLButtonElement>("[data-gp-content]");
    if (content) content.onclick = () => void act(content, "Saving...", () => api<GooglePlayStatus>("PUT", path, { contentConfirmed: true }), "Saved");
    const testing = box.querySelector<HTMLInputElement>("[data-gp-testing]");
    if (testing) testing.onchange = async () => {
      try {
        s = await api<GooglePlayStatus>("PUT", path, { testingLink: testing.checked });
        toast("Saved");
      } catch (err) {
        testing.checked = !testing.checked;
        result(err);
      }
    };
    const graphics = box.querySelector<HTMLButtonElement>("[data-gp-graphics]");
    if (graphics) {
      graphics.onclick = () => void act(graphics, "Checking and uploading...", async () => {
        // Each request does a bounded share; the rest follows in the next.
        let next = await api<GooglePlayStatus>("POST", `${path}/graphics`, graphics.dataset.gpGraphics === "restart" ? { restart: true } : undefined);
        for (let i = 0; i < 30 && next.graphics.pending > 0; i++) {
          graphics.textContent = `Uploading, ${next.graphics.pending} to go...`;
          next = await api<GooglePlayStatus>("POST", `${path}/graphics`);
        }
        return next;
      }, "Graphics checked");
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!s.releases.some((r) => WAITING.includes(r.stage)) || Date.now() > until) return;
    timer = window.setTimeout(async () => {
      if (!box.isConnected) return;
      if (document.visibilityState === "visible") {
        try {
          const next = await api<GooglePlayStatus>("GET", path);
          if (JSON.stringify(next.releases) !== JSON.stringify(s.releases)) {
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
