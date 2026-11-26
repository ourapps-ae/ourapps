// The Apple Pay card on an app's page: the merchant identifier, the payment processor's certificate, Apple Pay on the
// App ID and the App Store profiles that carry it, as a step list like the App Store card.
import { api, type ApplePayStatus, type ApplePayStep } from "./api.js";
import { html, type Raw } from "./html.js";
import { targetEnabled } from "./targets.js";
import { callout, errorBox, fmtDate, icon, pill, toast, wireCopy } from "./ui.js";

const STRIPE_CERTIFICATES = "https://dashboard.stripe.com/settings/ios_certificates";
const IDENTIFIERS = "https://developer.apple.com/account/resources/identifiers/list";
const STEP_ORDER: ApplePayStep[] = ["merchant", "certificate", "capability", "profiles"];

const stepError = (error: string | null) => (error ? callout("bad", html`<p>${error}</p>`) : "");
const copyable = (text: string): Raw => html`<code>${text}</code> <button type="button" class="btn sm ghost" data-copy="${text}">${icon("copy")} Copy</button>`;
const appIdLinks = (s: ApplePayStatus): Raw => html`${s.capability.appIds.map((a, i) => html`${i ? ", " : ""}<a href="${a.page}" target="_blank" rel="noopener">${a.identifier}</a>`)}`;

function merchantForm(s: ApplePayStatus): Raw {
  const m = s.merchant;
  const team = (m.team ?? []).filter((t) => t.identifier !== m.identifier);
  return html`
    <form data-ap-form="merchant" class="mt-s">
      ${stepError(m.error)}
      <p>Apple Pay knows the shop by its merchant identifier. ourapps makes it in your team, or uses one your team has, then turns Apple Pay on for the app's App ID.</p>
      <div class="field"><label>Merchant identifier</label><input type="text" name="identifier" value="${m.identifier ?? m.suggested.identifier}" maxlength="255" required /><div class="hint">Starts with merchant., for example merchant.com.yourname.pokernight.</div></div>
      ${team.length ? html`<div class="field"><label>Or one your team has</label><select name="existing"><option value="">The identifier above</option>${team.map((t) => html`<option value="${t.identifier}">${t.identifier}${t.name ? ` (${t.name})` : ""}</option>`)}</select></div>` : ""}
      <div class="field"><label>Description</label><input type="text" name="name" value="${m.name ?? m.suggested.name}" maxlength="60" required /><div class="hint">For your own records in the Apple Developer site.</div></div>
      <button class="btn sm" type="submit">Save with Apple</button>
    </form>`;
}

function certificateList(s: ApplePayStatus): Raw {
  const c = s.certificate;
  if (c.items.length === 0) return html``;
  return html`
    <table class="table small mt-s">${c.items.map((item) => html`<tr>
      <td>Serial ${item.serialNumber}</td>
      <td>${item.expirationDate ? `expires ${fmtDate(item.expirationDate)}` : ""}</td>
      <td>${item.expirationDate && Date.parse(item.expirationDate) <= Date.now() ? pill("expired", "bad") : item.activated === false ? pill("not in use") : item.id === c.activeId ? pill("in use", "ok") : ""}</td>
      <td><a class="btn sm secondary" href="${item.download}" download>${icon("arrow")} Download .cer</a></td>
    </tr>`)}</table>
    <p class="small">Give the .cer file back to your payment processor, in the same place the certificate request came from.</p>
    ${c.items.some((item) => item.activated === false) ? callout("info", html`<p>Apple uses one Payment Processing certificate of a merchant identifier at a time. Once your payment processor has the one not in use, revoke the one in use on the merchant identifier's page in the <a href="${IDENTIFIERS}" target="_blank" rel="noopener">Apple Developer site</a> (Certificates, Identifiers and Profiles, Identifiers, Merchant IDs); Apple then uses the other.</p>`) : ""}`;
}

function certificateStep(s: ApplePayStatus): Raw {
  return html`
    ${stepError(s.certificate.error)}
    <p>Your payment processor gives you a certificate request and keeps its private key; ourapps never holds it. In Stripe: <a href="${STRIPE_CERTIFICATES}" target="_blank" rel="noopener">Dashboard, Settings, iOS certificates</a>, <b>Add new application</b>, then download the request. Each request makes one certificate.</p>
    <form data-ap-form="certificate" class="mt-s">
      <div class="field"><label>Certificate request</label><textarea name="csr" rows="5" placeholder="-----BEGIN CERTIFICATE REQUEST-----"></textarea><div class="hint">Paste it, or choose the file: <input type="file" data-ap-file accept=".certSigningRequest,.csr,.pem,.txt" /></div></div>
      <button class="btn sm" type="submit">Make the certificate</button>
    </form>
    ${certificateList(s)}`;
}

function capabilityStep(s: ApplePayStatus): Raw {
  const c = s.capability;
  if (!c.turnedOnAt) {
    return html`${stepError(c.error)}<p>ourapps turns Apple Pay on for the app's App ID when it saves the merchant identifier.</p><button class="btn sm mt-s" type="button" data-ap-retry>Turn Apple Pay on</button>`;
  }
  return html`
    ${stepError(c.error)}
    <p>ourapps turned Apple Pay on for the App ID ${appIdLinks(s)}. Apple lets only you tick the merchant identifier on it, on Apple's site:</p>
    <ol class="steps small">
      <li>Open the App ID ${appIdLinks(s)} in the Apple Developer site (Certificates, Identifiers and Profiles), signed in to your team.</li>
      <li>In the list of capabilities, <b>Apple Pay Payment Processing</b> is ticked. Click <b>Edit</b> beside it.</li>
      <li>In the Merchant ID table, tick ${copyable(s.merchant.identifier ?? "")}, then click <b>Continue</b>.</li>
      <li>Click <b>Save</b>, and <b>Confirm</b> if Apple asks.</li>
    </ol>
    <button class="btn sm mt-s" type="button" data-ap-confirm>I have ticked it</button>
    <p class="small muted">ourapps then makes the App Store profiles again and checks that they carry the merchant identifier.</p>`;
}

function profileList(s: ApplePayStatus): Raw {
  const id = s.merchant.identifier ?? "";
  return html`<ul class="bullets small">${s.profiles.items.map((p) => html`<li><b>${p.label}</b>${p.profileName ? `, profile ${p.profileName}` : ""}: ${p.carries ? pill(`carries ${id}`, "ok") : p.merchantIdentifiers === null ? pill("could not be read", "bad") : pill(`does not carry ${id}`, "warn")}</li>`)}</ul>`;
}

function profilesStep(s: ApplePayStatus): Raw {
  const missing = s.profiles.items.some((p) => !p.carries);
  return html`
    ${stepError(s.profiles.error)}
    ${profileList(s)}
    ${missing && s.profiles.madeAt ? html`<p>Apple puts the merchant identifier in a profile once it is ticked on the App ID. Check the tick on Apple's site (the step above), then make the profiles again.</p>` : ""}
    <button class="btn sm mt-s" type="button" data-ap-profiles>Make the profiles again</button>`;
}

function stepBody(s: ApplePayStatus, step: ApplePayStep): Raw {
  switch (step) {
    case "merchant": return merchantForm(s);
    case "certificate": return certificateStep(s);
    case "capability": return capabilityStep(s);
    case "profiles": return profilesStep(s);
  }
}

const STEP_INFO: Record<ApplePayStep, { title: string; about: string; done: (s: ApplePayStatus) => Raw | string }> = {
  merchant: { title: "Merchant identifier", about: "Identifies your shop to Apple Pay, one per app.", done: (s) => html`<code>${s.merchant.identifier}</code>${s.merchant.name ? ` (${s.merchant.name})` : ""}.` },
  certificate: {
    title: "Payment Processing certificate",
    about: "Apple encrypts each payment with it; your payment processor holds its private key.",
    done: (s) => {
      const active = s.certificate.items.find((c) => c.id === s.certificate.activeId);
      return active ? `Serial ${active.serialNumber}${active.expirationDate ? `, expires ${fmtDate(active.expirationDate)}` : ""}.${s.certificate.renewBy ? ` Renew by ${fmtDate(s.certificate.renewBy)}: get another certificate request from your payment processor and make the certificate here.` : ""}` : "Made.";
    },
  },
  capability: { title: "Apple Pay on the App ID", about: "Apple Pay turned on for the app's App ID, with the merchant identifier ticked on Apple's site.", done: (s) => html`Apple Pay is on for ${appIdLinks(s)}, with the merchant identifier ticked (you confirmed it ${fmtDate(s.capability.tickedAt)}).` },
  profiles: { title: "App Store profiles", about: "The profiles builds are signed with, carrying the merchant identifier.", done: (s) => `${s.profiles.items.map((p) => p.label).join(" and ")}: the profiles carry ${s.merchant.identifier}.` },
};

function stepList(s: ApplePayStatus, open: ApplePayStep | null): Raw {
  const current = open ?? s.step;
  return html`
    <ol class="timeline">
      ${STEP_ORDER.map((step, i) => {
        const info = STEP_INFO[step];
        const done = s[step].done;
        const cls = step === current ? "now" : done ? "done" : "muted-step";
        const mark = cls === "done" ? icon("check", "icon-16") : String(i + 1);
        // Once the merchant identifier exists, the other steps can be opened in any order.
        const openable = s.merchant.done || step === "merchant";
        const body = step === current ? stepBody(s, step) : html`<p>${done ? info.done(s) : info.about}${openable ? html` <button class="link-btn" type="button" data-ap-open="${step}">${done ? "Change" : "Open"}</button>` : ""}</p>`;
        return html`<li class="${cls}" data-ap-step="${step}"><div class="mark">${mark}</div><div><h3>${info.title}</h3>${body}</div></li>`;
      })}
    </ol>`;
}

// What the app itself declares; the profiles only allow it.
function entitlementNote(s: ApplePayStatus): Raw {
  const id = s.merchant.identifier ?? s.merchant.suggested.identifier;
  return callout("info", html`
    <p>The app declares the same in its entitlements file, <code>${s.entitlement}</code> with the merchant identifier (in Xcode: Signing and Capabilities, + Capability, Apple Pay, then tick ${id}):</p>
    <pre><code>&lt;key&gt;${s.entitlement}&lt;/key&gt;
&lt;array&gt;
  &lt;string&gt;${id}&lt;/string&gt;
&lt;/array&gt;</code></pre>
    <p>Builds fetch the App Store profiles from ourapps, so the next build of the app carries Apple Pay.</p>`);
}

export function applePayCard(s: ApplePayStatus, open: ApplePayStep | null = null): Raw {
  const status = !s.setUp ? pill("needs TestFlight", "warn") : s.step === null ? pill("ready", "ok", true) : pill("not finished", "warn", true);
  const head = html`<div class="row wrap"><div class="grow card-title"><h2>Apple Pay</h2><p class="small faint">Lets a shop app take Apple Pay on iPhone, iPad and Mac, through your payment processor, in your own Apple team.</p></div>${status}</div>`;
  if (!s.setUp) return html`<div class="card mt">${head}<p class="small">Set up iPhone and iPad TestFlight first: Apple Pay goes into the App Store profile TestFlight makes.</p></div>`;
  const renew = s.certificate.renewBy && Date.now() > Date.parse(s.certificate.renewBy)
    ? callout("warn", html`<p>The Payment Processing certificate in use expires ${fmtDate(s.certificate.items.find((c) => c.id === s.certificate.activeId)?.expirationDate)}. Get another certificate request from your payment processor, make the certificate here and give it back to the processor.</p><button class="link-btn" type="button" data-ap-open="certificate">Make the certificate</button>`)
    : "";
  return html`<div class="card mt">${head}${renew}${stepList(s, open)}${entitlementNote(s)}<div data-ap-result></div></div>`;
}

// A certificate request file as the text Apple takes: as it is when it is text, wrapped when it is the bare bytes.
export async function requestText(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  if (text.includes("-----BEGIN")) return text.trim();
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return `-----BEGIN CERTIFICATE REQUEST-----\n${(btoa(s).match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE REQUEST-----`;
}

export async function loadApplePayCard(root: HTMLElement, appId: string): Promise<void> {
  const box = root.querySelector<HTMLElement>("#applepay-card");
  if (!box) return;
  const path = `/api/dev/apps/${appId}/applepay`;
  let s: ApplePayStatus;
  try {
    s = await api<ApplePayStatus>("GET", path);
  } catch (err) {
    box.innerHTML = errorBox(err).html;
    return;
  }
  let open: ApplePayStep | null = null;
  const result = (err: unknown) => {
    const el = box.querySelector<HTMLElement>("[data-ap-result]");
    if (el) el.innerHTML = errorBox(err).html;
  };
  // Runs one change at Apple and shows the answer; the button shows it is busy meanwhile.
  const act = async (button: HTMLButtonElement, busy: string, call: () => Promise<ApplePayStatus>, done: string) => {
    if (!targetEnabled(root, "ios")) return result(new Error("Switch iPhone and iPad on above first: Apple Pay uses its App ID."));
    const text = button.textContent;
    button.disabled = true;
    button.textContent = busy;
    try {
      s = await call();
      open = null;
      render();
      toast(done);
    } catch (err) {
      button.disabled = false;
      button.textContent = text;
      try {
        s = await api<ApplePayStatus>("GET", path);
        render();
      } catch {
        // The error below says enough.
      }
      result(err);
    }
  };
  const render = () => {
    box.innerHTML = applePayCard(s, open).html;
    wireCopy(box);
    box.querySelectorAll<HTMLButtonElement>("[data-ap-open]").forEach((b) => (b.onclick = () => {
      open = b.dataset.apOpen as ApplePayStep;
      render();
      box.querySelector(`[data-ap-step="${open}"]`)?.scrollIntoView({ block: "nearest" });
    }));
    const merchant = box.querySelector<HTMLFormElement>('[data-ap-form="merchant"]');
    if (merchant) merchant.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(merchant);
      const identifier = String(fd.get("existing") || fd.get("identifier") || "").trim();
      void act(merchant.querySelector("button[type=submit]")!, "Saving with Apple...", () => api<ApplePayStatus>("POST", `${path}/merchant`, { identifier, name: String(fd.get("name") ?? "") }), "Saved with Apple");
    };
    const certificate = box.querySelector<HTMLFormElement>('[data-ap-form="certificate"]');
    if (certificate) {
      const file = certificate.querySelector<HTMLInputElement>("[data-ap-file]")!;
      file.onchange = async () => {
        const chosen = file.files?.[0];
        if (chosen) certificate.querySelector<HTMLTextAreaElement>('textarea[name="csr"]')!.value = await requestText(chosen);
      };
      certificate.onsubmit = (e) => {
        e.preventDefault();
        const csr = String(new FormData(certificate).get("csr") ?? "");
        void act(certificate.querySelector("button[type=submit]")!, "Making the certificate...", () => api<ApplePayStatus>("POST", `${path}/certificate`, { csr }), "Certificate made");
      };
    }
    const retry = box.querySelector<HTMLButtonElement>("[data-ap-retry]");
    if (retry) retry.onclick = () => void act(retry, "Turning it on...", () => api<ApplePayStatus>("POST", `${path}/merchant`, { identifier: s.merchant.identifier }), "Apple Pay is on for the App ID");
    const confirm = box.querySelector<HTMLButtonElement>("[data-ap-confirm]");
    if (confirm) confirm.onclick = () => void act(confirm, "Making the profiles...", () => api<ApplePayStatus>("POST", `${path}/confirm`), "Profiles made again");
    const profiles = box.querySelector<HTMLButtonElement>("[data-ap-profiles]");
    if (profiles) profiles.onclick = () => void act(profiles, "Making the profiles...", () => api<ApplePayStatus>("POST", `${path}/profiles`), "Profiles made again");
  };
  render();
}
