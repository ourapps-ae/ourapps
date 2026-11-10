import { pickScreenshots, type ScreenshotSets } from "@my/store-shared";
import { ApiError, api, whoAmI, type AppDetails, type HistoryEntry, type Install, type LinkPage, type Me } from "../api.js";
import { html, mount, paragraphs, raw, type Raw } from "../html.js";
import { navigate } from "../nav.js";
import { notesHtml } from "../notes.js";
import { desktopAvailability, desktopPanel, televisionPanel, televisionSetupLink } from "../desktop.js";
import { screenshotSvg } from "../placeholders.js";
import { appleDeviceName, detectInAppBrowser, detectPlatform, type InAppBrowser, type Platform } from "../platform.js";
import { qrSvg, shareOrCopy } from "../qr.js";
import { VIEW_ICON, VIEW_LABEL, availableViews, chooseView, shapeFor, showTabs, type ViewKind } from "../views.js";
import { setTheme } from "../theme.js";
import { appIcon, avatar, callout, copyRow, fmtDate, icon, toast, wireCopy, wireImages } from "../ui.js";

// Shared frame for every store-themed page.
export const COPYRIGHT = "Copyright Level N Ltd 2026";
export const TAGLINE = "Delivering Our Applications, built from Our Recipes, using Our Agentically-Engineered Components.";
export const SOURCE_URL = "https://github.com/ourapps-ae/ourapps";

export function storeFrame(body: Raw, opts: { me?: Me | null; nav?: boolean; footnote?: string } = {}): Raw {
  const right = opts.me
    ? html`<a href="/dev" class="row" style="gap:8px">${avatar(opts.me.developer.displayName, `https://github.com/${opts.me.developer.githubLogin}.png?size=64`, "sm")} <span>Console</span></a>`
    : html`<a href="/dev">For developers</a>`;
  const nav = opts.nav === false ? "" : html`<nav class="store-nav"><a class="brand" href="/">${icon("logo")} ourapps</a><span class="row wrap" style="gap:18px"><a href="/recipes">Recipes</a><a href="/components">Components</a>${right}</span></nav>`;
  const footer = html`<footer class="store-footer"><span>${COPYRIGHT} · <a href="/terms">Terms</a></span><span>${opts.footnote ?? "Share links are private. The recipe library and component catalogue are public. No tracking."}</span></footer>`;
  return html`<div class="store fade-in">${nav}${body}${footer}</div>`;
}

function finish(root: HTMLElement): void {
  wireImages(root);
  wireCopy(root);
}

export async function landing(root: HTMLElement): Promise<void> {
  setTheme("store", `ourapps: ${TAGLINE}`, true);
  const me = await whoAmI();
  mount(
    root,
    storeFrame(
      html`
        <section class="hero">
          <div>
            <span class="pill accent">${icon("bot", "icon-16")} Software for your business, club, home and shop</span>
            <h1 style="margin-top:14px">${TAGLINE}</h1>
            <p class="lead">Our apps for our businesses, our club, our home, our shop. Pick a <a href="/recipes">recipe</a> from the library, or compose your own from <a href="/components">components</a> in the catalogue. A coding agent builds the application in minutes from reviewed parts, on your own accounts. Send one link, and your staff, members, customers or family open it on the phone, tablet, computer or television they already use.</p>
            <div class="ctas">
              ${me ? html`<a class="btn lg" href="/dev">Open your console ${icon("arrow")}</a>` : html`<a class="btn lg" href="/api/auth/github">${icon("github")} Sign in with GitHub</a>`}
              <a class="btn lg secondary" href="/example">See an example: Poker Night</a>
            </div>
            <p class="small faint mt">Free. No ourapps accounts for the people you share with. Install paths for iPhone, iPad, Android, Mac, Windows, Apple TV and web apps. Credentials encrypted per account, nothing sold or tracked: <a href="/dev/guide#security">how we keep it safe</a>.</p>
          </div>
          <a class="phone" href="/example/poker-night" aria-label="Open the Poker Night example page">
            <div class="screen">
              <div class="mini-head">${appIcon("Poker Night", null, "md")}<div><b>Poker Night</b><span>Thursday table, house rules included</span><div class="mini-get"></div></div></div>
              <div class="mini-shot" style="background:linear-gradient(135deg,hsl(150 60% 22%),hsl(160 55% 38%))"></div>
              <div class="mini-line"></div><div class="mini-line"></div><div class="mini-line short"></div>
            </div>
          </a>
        </section>

        <section class="how" id="benefits">
          <div class="section-title"><h2>Why ourapps</h2></div>
          <div class="grid-3">
            <div class="card"><h3>Fast</h3><p class="muted">An application from a recipe in minutes, rather than days of building.</p></div>
            <div class="card"><h3>Low cost</h3><p class="muted">Little AI spending. A clinic of fewer than ten people can run on free plans; a larger business pays only for the provider tier it needs, chosen from one answer about size.</p></div>
            <div class="card"><h3>Maintainable and safe</h3><p class="muted">Reviewed components, small updates you approve, security tests built in, a record of what is inside, and data you can move.</p></div>
            <div class="card"><h3>Yours</h3><p class="muted">Your accounts and your data. Your application's servers and databases run on your own accounts, not ours, and there is no lock-in.</p></div>
            <div class="card"><h3>Delivered to your people</h3><p class="muted">Staff, members and customers get it on phones, tablets, computers and televisions through one link.</p></div>
          </div>
        </section>

        <section class="how" id="who">
          <div class="section-title"><h2>Who it is for</h2></div>
          <p class="muted">A small business, a club or society, a household, a shop or practice: people who want software that fits how they work. Invented examples:</p>
          <div class="grid-3">
            <div class="card"><h3>A clinic's appointment board</h3><p class="muted">Today's appointments on the waiting-room television and on reception's tablet.</p></div>
            <div class="card"><h3>A club's league night</h3><p class="muted">Fixtures, scores and the table for every member's phone.</p></div>
            <div class="card"><h3>A shop's order screen</h3><p class="muted">Orders from the counter to the back room, on a screen the team already has.</p></div>
            <div class="card"><h3>A household's chores planner</h3><p class="muted">Who does what this week, on the fridge tablet and every family phone.</p></div>
            <div class="card"><h3>A restaurant's table display</h3><p class="muted">Which tables are free, seated or waiting for the bill, for the host and the kitchen.</p></div>
          </div>
        </section>

        <section class="card pad-l" style="margin-top:14px">
          <div class="row wrap top" style="gap:20px">
            <div style="flex:1 1 300px">
              <span class="pill">Worked example</span>
              <h2 style="margin-top:8px">Poker Night: a club league night for eight people</h2>
              <p class="muted">Just the three options the club uses, house rules written the way members say them, a page of help for the member who has never played, and the club's own photos on the felt. Built by an agent, from a recipe or from components, and installed from one link.</p>
            </div>
            <div class="stack" style="flex:0 0 auto"><a class="btn" href="/example">Read the story ${icon("arrow")}</a><a class="btn secondary" href="/example/poker-night">See the install page</a></div>
          </div>
        </section>

        <section class="card pad-l" style="margin-top:14px">
          <div class="row wrap top" style="gap:20px">
            <div style="flex:1 1 300px">
              <span class="pill accent">Recipe library</span>
              <h2 style="margin-top:8px">Start from a recipe</h2>
              <p class="muted">A recipe asks a few questions and an agent assembles the application from reviewed components for the devices you choose. Browse recipes by category and device, search by what an application does, and read the components behind each one.</p>
            </div>
            <div class="stack" style="flex:0 0 auto"><a class="btn" href="/recipes">Browse recipes ${icon("arrow")}</a><a class="btn secondary" href="/components">Component catalogue</a></div>
          </div>
        </section>

        <section class="card pad-l" style="margin-top:14px">
          <div class="row wrap top" style="gap:20px">
            <div style="flex:1 1 300px">
              <span class="pill accent">Why small is powerful</span>
              <h2 style="margin-top:8px">At a small organisation's size, the expensive parts are free</h2>
              <p class="muted">Video calls, live multiplayer, databases and AI cost a public app money every month. For a household, a club or a practice of fewer than ten people they fit inside free plans: LiveKit's 5,000 free video minutes a month is about twenty one-hour calls for four, and Cloudflare's free plan runs about 80 hours of four-player play a day. A larger organisation answers one question about its size, and the recipe picks the provider tier that fits.</p>
            </div>
            <div class="stack" style="flex:0 0 auto"><a class="btn" href="/small">How it works ${icon("arrow")}</a><a class="btn secondary" href="/free-tiers.md">The list of free services</a></div>
          </div>
        </section>

        <section class="how" id="how">
          <div class="section-title"><h2>For you, the developer</h2></div>
          <div class="grid-3">
            <div class="card"><div class="num">1</div><h3>Choose how to start</h3><p class="muted">Pick a <a href="/recipes">recipe</a> and answer its questions, or compose your own from the <a href="/components">component catalogue</a>. A recipe you compose can be published for others to use.</p></div>
            <div class="card"><div class="num">2</div><h3>Add your app</h3><p class="muted">Sign in with GitHub. Give the app a name, icon, screenshots and a few lines of text, and point it at the GitHub repository that publishes releases.</p></div>
            <div class="card"><div class="num">3</div><h3>Share it</h3><p class="muted">Create one share link per person or group, with a label, an expiry and a revoke button. Each has a QR code. ourapps signs each iPhone build, sends it through TestFlight and asks for a fresh build before one expires.</p></div>
          </div>
          <div class="section-title"><h2>For your people: staff, members, customers, family</h2></div>
          <div class="grid-3">
            <div class="card"><div class="num">1</div><h3>Open the link</h3><p class="muted">A link or QR code from your organisation opens an install page that looks and feels like the store they already use.</p></div>
            <div class="card"><div class="num">2</div><h3>Choose your version</h3><p class="muted">Android, Mac and Windows offer direct packages. Apple devices use matching TestFlight invitations when ready. Web apps open in your browser.</p></div>
            <div class="card"><div class="num">3</div><h3>Follow the install steps</h3><p class="muted">The page shows system requirements, package choices and instructions. Updates arrive through TestFlight or a fresh download.</p></div>
          </div>
          <div class="card mt pad-l row wrap" style="justify-content:space-between">
            <div style="flex:1 1 260px"><h3>Agents welcome</h3><p class="muted small">Everything in the console is also an API. Give your coding agent an API key and the prompts on the Agents and API page, and it can search recipes and components, publish your own, register apps, publish releases and hand you share links.</p></div>
            <div class="row wrap"><a class="btn secondary" href="/reference">Technical reference</a><a class="btn secondary" href="/agents.md">Read agents.md ${icon("external")}</a></div>
          </div>
        </section>
      `,
      { me },
    ),
  );
  finish(root);
}

export async function devPage(root: HTMLElement, slug: string): Promise<void> {
  setTheme("store", "ourapps");
  try {
    const [data, me] = await Promise.all([api<{ developer: { id: string; displayName: string }; apps: AppDetails[] }>("GET", `/api/public/dev/${encodeURIComponent(slug)}`), whoAmI()]);
    setTheme("store", `${data.developer.displayName} on ourapps`);
    const owner = me?.developer.id === data.developer.id;
    mount(
      root,
      storeFrame(
        html`
          ${owner ? html`<div class="owner-bar"><span class="pill">You</span> This is your public page. Apps appear here when "Show on my public page" is on. <a href="/dev/apps">Manage apps</a></div>` : ""}
          <div class="dev-hero">
            ${avatar(data.developer.displayName, null, "lg")}
            <div><h1>${data.developer.displayName}</h1><p class="muted" style="margin:2px 0 0">Delivers applications built from recipes and components to its own people.</p></div>
          </div>
          <div class="card">
            ${data.apps.length === 0 ? html`<p class="muted center" style="padding:20px 0">Nothing listed yet.</p>` : data.apps.map((a) => html`
              <div class="app-tile">${appIcon(a.name, a.iconUrl, "md")}<div><b>${a.name}</b><span>${a.tagline || "Delivered through ourapps"}</span></div><span class="pill">by invitation</span></div>
            `)}
          </div>
          <p class="small faint mt">These apps are shared privately. Ask ${data.developer.displayName} for a link if you want one.</p>
        `,
        { me },
      ),
    );
    finish(root);
  } catch (err) {
    notFound(root, err instanceof ApiError && err.status === 404 ? "No developer page here." : String(err));
  }
}

export function notFound(root: HTMLElement, message = "There is nothing at this address."): void {
  setTheme("store", "Not found");
  mount(root, storeFrame(html`<div class="card pad-l center" style="margin-top:30px"><h1>Not found</h1><p class="muted">${message}</p><a class="btn secondary mt" href="/">Go to the start</a></div>`));
}

export function inactive(root: HTMLElement): void {
  setTheme("store", "Link no longer active");
  mount(root, storeFrame(html`<div class="card pad-l center" style="margin-top:30px">${icon("lock", "icon-20")}<h1 style="margin-top:8px">This link is no longer active</h1><p class="muted">Ask the person who sent it for a new one.</p></div>`, { nav: false }));
}

export interface Detected {
  platform: Platform;
  inApp: InAppBrowser | null;
  // "iPhone" or "iPad", used in wording on Apple devices.
  device: "iPhone" | "iPad";
}

export function detect(): Detected {
  const ua = navigator.userAgent;
  const platform = detectPlatform(ua, navigator.platform, navigator.maxTouchPoints);
  return { platform, inApp: detectInAppBrowser(ua, platform), device: appleDeviceName(ua, navigator.platform, navigator.maxTouchPoints) };
}

export async function installPage(root: HTMLElement, linkId: string): Promise<void> {
  setTheme("store", "ourapps");
  let data: LinkPage;
  try {
    data = await api<LinkPage>("GET", `/api/public/links/${encodeURIComponent(linkId)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 410) return inactive(root);
    return notFound(root, err instanceof ApiError && err.status === 404 ? "No app behind this link." : String(err));
  }
  const me = await whoAmI();
  renderInstall(root, data, { me, pageUrl: `${location.origin}/l/${linkId}` });
  const marker = root.querySelector(".product");
  let busy = false;
  let checkedAt = Date.now();
  const refresh = async () => {
    if (!marker?.isConnected) return stop();
    if (document.visibilityState !== "visible" || busy || Date.now() - checkedAt < 1000) return;
    busy = true;
    checkedAt = Date.now();
    try {
      const next = await api<LinkPage>("GET", `/api/public/links/${encodeURIComponent(linkId)}`);
      const changed = deliveryChanged(data, next);
      if (changed && marker.isConnected) {
        stop();
        const y = scrollY;
        await installPage(root, linkId);
        scrollTo(0, y);
      }
    } catch {
      // Keep the current page during a connection failure.
    } finally {
      busy = false;
    }
  };
  const timer = window.setInterval(() => void refresh(), 60_000);
  const stop = () => {
    clearInterval(timer);
    removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
    removeEventListener("navigate", stop);
    removeEventListener("popstate", stop);
  };
  addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  addEventListener("navigate", stop, { once: true });
  addEventListener("popstate", stop, { once: true });
}

export async function previewPage(root: HTMLElement, appId: string): Promise<void> {
  setTheme("store", "Preview");
  try {
    const [data, me] = await Promise.all([api<LinkPage>("GET", `/api/dev/apps/${appId}/preview`), whoAmI()]);
    renderInstall(root, data, { me, pageUrl: `${location.origin}/l/preview`, preview: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return navigate("/dev");
    notFound(root, String(err));
  }
}

interface InstallOpts {
  me: Me | null;
  pageUrl: string;
  preview?: boolean;
  example?: boolean;
}

export function deliveryChanged(previous: LinkPage, next: LinkPage): boolean {
  if (previous.release?.version !== next.release?.version) return true;
  if (previous.deliveryRevision !== undefined || next.deliveryRevision !== undefined) return previous.deliveryRevision !== next.deliveryRevision;
  return JSON.stringify([previous.release?.version, previous.release?.install, previous.release?.apple]) !== JSON.stringify([next.release?.version, next.release?.install, next.release?.apple]);
}

export function hasDelivery(data: LinkPage): boolean {
  const install = data.release?.install;
  return Boolean(install && (install.ios || install.android || install.pwa || install.macos || install.windows || install.tvos));
}

export function noDelivery(): Raw {
  return html`<div class="install-card"><h3>No install options available</h3><p class="muted">The developer has not enabled any delivery options for this release. App details and previews are available below.</p></div>`;
}

export function renderInstall(root: HTMLElement, data: LinkPage, opts: InstallOpts): void {
  const d = detect();
  const app = data.app;
  const name = app.name || data.release?.fallbackName || "App";
  const icon0 = app.iconUrl || data.release?.fallbackIcon || null;
  const description = app.description || data.release?.fallbackDescription || "";
  const sets: ScreenshotSets = data.screenshots;
  const offered = availableViews(data.release?.install, (v) => Boolean(sets[v]?.length));
  const views = d.platform === "macos" || d.platform === "windows" ? offered.filter(v => v === d.platform || v === "web" || v === "tvos") : offered;
  const current = chooseView(views, d.platform, d.device);
  const tabbed = showTabs(d.platform, views);
  // Computers show selectable versions; phones show their matching version.
  const shown: (ViewKind | null)[] = tabbed ? views : [current];
  const blocked = Boolean(d.inApp && !d.inApp.installWorks) || !data.release || !hasDelivery(data);
  const history = data.history ?? [];
  // The latest release's notes are the truth; the dashboard field only fills in when there are none.
  // iPhone and iPad get what TestFlight has, which can be older than the latest release.
  const compatibilityVersion = d.platform === "macos" && !data.release?.install.macos?.packages.length && !data.release?.apple?.macos ? data.release?.apple?.iosOnMac?.version : null;
  const version = compatibilityVersion ?? (d.platform === "ios" && data.release?.install.ios?.testflight ? (data.release.apple?.ios?.version ?? data.release.testflightVersion ?? data.release.version) : data.release?.version);
  const latest = history.find((h) => h.version === version) ?? history[0];
  const whatsNew = latest?.notes || app.whatsNew || "";
  const updated = latest?.date ?? (history.length === 0 ? app.updatedAt : null);
  const owner = opts.me?.developer.id === data.developer.id;
  setTheme("store", `${name} by ${data.developer.displayName}`);

  const facts: Raw[] = [];
  if (data.release) facts.push(html`<div class="fact"><b>Version</b><span>${version}</span></div>`);
  if (app.ageNote) facts.push(html`<div class="fact"><b>Age</b><span>${factLines(app.ageNote)}</span></div>`);
  if (data.release && data.release.maxPlayers > 1) facts.push(html`<div class="fact"><b>Players</b><span>${data.release.minPlayers === data.release.maxPlayers ? data.release.minPlayers : `${data.release.minPlayers} to ${data.release.maxPlayers}`}</span></div>`);
  if (app.size) facts.push(html`<div class="fact"><b>Size</b><span>${factLines(app.size)}</span></div>`);
  facts.push(html`<div class="fact"><b>Developer</b><span>${data.developer.displayName}</span><small>a person you know</small></div>`);
  facts.push(html`<div class="fact"><b>Shared</b><span>Privately</span><small>by invitation</small></div>`);

  const info: [string, string][] = [
    ["Provider", data.developer.displayName],
    ["Size", app.size],
    ["Compatibility", app.minOs || compat(data)],
    ["Age", app.ageNote],
    ["Version", version ?? ""],
    ["Updated", updated ? new Date(updated).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""],
  ];

  mount(
    root,
    storeFrame(
      html`
        ${opts.example ? html`<div class="owner-bar"><span class="pill">Example</span> This is the page the people you share with would get for an imaginary app. Nothing installs. <a href="/example">Why Poker Night</a> <a href="/dev">Build yours</a></div>` : ""}
        ${opts.preview ? html`<div class="owner-bar"><span class="pill">Preview</span> This is how the install page looks to the people you share with. Install buttons are shown; this preview is not a share link. <a href="/dev/apps/${app.id}">Back to the app</a></div>` : ""}
        ${owner && !opts.preview && !opts.example ? html`<div class="owner-bar"><span class="pill">You</span> You are the developer of this app. <a href="/dev/apps/${app.id}">Edit</a> <a href="/dev/apps/${app.id}/links">Links</a></div>` : ""}
        ${(owner || opts.preview) && !opts.example && data.release?.install.ios && !data.release.install.ios.testflight
          ? html`<div class="owner-bar"><span class="pill warn">iPhone</span> TestFlight is not open yet, so people on iPhone and iPad see "Coming to ${d.device} soon". <a href="/dev/apps/${app.id}#testflight">What it is waiting for</a></div>`
          : ""}
        <header class="product">
          ${appIcon(name, icon0, "xl")}
          <div>
            <h1>${name}</h1>
            <p class="tagline">${app.tagline || "Delivered through ourapps"}</p>
            <div class="dev">${data.developer.displayName}</div>
            <div class="cta" id="cta">${ctaArea(data, d, name)}${televisionSetupLink(data.release, d.platform === "ios", blocked)}</div>
          </div>
        </header>
        <div class="facts-strip">${facts}</div>
        ${!blocked && data.release && (d.platform === "macos" || d.platform === "windows") ? desktopAvailability(data.release, d.platform) : ""}
        ${tabbed
          ? html`<div class="platform-tabs" role="tablist" aria-label="Versions of ${name}">${views.map((v) => html`<button type="button" role="tab" id="tab-${v}" aria-controls="panel-${v}" aria-selected="${v === current ? "true" : "false"}" tabindex="${v === current ? "0" : "-1"}" data-view="${v}">${icon(VIEW_ICON[v])} ${VIEW_LABEL[v]}</button>`)}</div>`
          : ""}
        <div id="install-area">${
          blocked
            ? installArea(data, d, name, opts.preview === true)
            : shown.map((v) => html`<div ${tabbed ? html`role="tabpanel" id="panel-${v}" aria-labelledby="tab-${v}"` : ""} data-panel="${v ?? "none"}" ${tabbed && v !== current ? raw("hidden") : ""}>${installPanel(v, data, d, name, opts.pageUrl)}</div>`)
        }</div>
        ${!blocked && (d.platform === "ios" || d.platform === "android") && data.release?.install.tvos ? televisionPanel(data.release, opts.pageUrl, d.platform === "ios") : ""}

        <section class="store-section">
          <h2>Preview</h2>
          ${shown.map((v) => html`<div data-shots="${v ?? "none"}" ${tabbed && v !== current ? raw("hidden") : ""}>${shotsBlock(v, sets, name, app.tagline)}</div>`)}
        </section>

        <section class="store-section">
          <h2>About</h2>
          <div class="readmore" id="about">${description ? paragraphs(description) : html`<p class="muted">${name} is an app ${data.developer.displayName} built and shares privately with the people it is for. There is no store listing, no advertising and no account to create.</p>`}</div>
          <button class="link-btn readmore-btn" id="more" hidden>more</button>
        </section>

        ${whatsNew ? html`<section class="store-section"><h2>What's new</h2>${data.release ? html`<p class="sub">Version ${version}</p>` : ""}${notesHtml(whatsNew)}</section>` : ""}

        <section class="store-section">
          <h2>App privacy</h2>
          <div class="privacy-card">${icon("shield")}<div>${app.privacySummary ? paragraphs(app.privacySummary) : html`<p>The developer has not written a privacy summary yet. Ask ${data.developer.displayName} what the app collects and where it goes; they are a person you know, not a company.</p>`}<p class="small faint">Written by the developer, not checked by anyone else.</p></div></div>
        </section>

        ${history.length > 0 ? html`<section class="store-section"><h2>Revision history</h2>${historyBlock(history)}</section>` : ""}

        <section class="store-section">
          <h2>Information</h2>
          <div class="info-list">${info.filter(([, v]) => v).map(([k, v]) => html`<div class="item"><span class="k">${k}</span><span class="v">${v}</span></div>`)}</div>
        </section>

        <section class="store-section">
          <h2>Share</h2>
          <p class="sub">Pass this page to someone else ${data.developer.displayName} would want to have it.</p>
          <div class="share-row mt">
            <div class="qr">${qrSvg(opts.pageUrl)}</div>
            <div class="stack">
              ${copyRow(opts.pageUrl, "Copy")}
              <button class="btn secondary" id="share">${icon("share")} Share</button>
            </div>
          </div>
        </section>
      `,
      { me: opts.me, nav: true, footnote: `${name} is shared privately by ${data.developer.displayName}. Not from the App Store or Google Play.` },
    ),
  );
  finish(root);
  if (opts.example) {
    root.querySelectorAll<HTMLAnchorElement>("#cta a, #install-area a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      toast("Example only: nothing to install");
    }));
  }

  const about = root.querySelector<HTMLElement>("#about")!;
  const more = root.querySelector<HTMLButtonElement>("#more")!;
  if (about.scrollHeight > about.clientHeight + 8) {
    more.hidden = false;
    more.onclick = () => {
      about.classList.toggle("open");
      more.textContent = about.classList.contains("open") ? "less" : "more";
    };
  } else about.classList.add("open");

  const historyEl = root.querySelector<HTMLElement>("#history");
  const moreBtn = root.querySelector<HTMLButtonElement>("#history-more");
  if (historyEl && moreBtn) {
    const latestNotes = historyEl.querySelector<HTMLElement>(".rev-notes");
    const overflows = latestNotes ? latestNotes.scrollHeight > latestNotes.clientHeight + 4 : false;
    if (history.length === 1 && !overflows) {
      moreBtn.hidden = true;
      latestNotes?.classList.remove("clamp");
    }
    moreBtn.onclick = () => {
      const open = historyEl.classList.toggle("open");
      historyEl.querySelectorAll<HTMLElement>(".rev-more").forEach((el) => (el.hidden = !open));
      latestNotes?.classList.toggle("clamp", !open);
      moreBtn.textContent = open ? "less" : "more...";
    };
  }

  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".platform-tabs [data-view]")];
  const select = (view: string, focus = false) => {
    for (const t of tabs) {
      const on = t.dataset.view === view;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    root.querySelectorAll<HTMLElement>("[data-panel], [data-shots]").forEach((el) => (el.hidden = (el.dataset.panel ?? el.dataset.shots) !== view));
  };
  tabs.forEach((t, i) => {
    t.onclick = () => select(t.dataset.view!);
    t.onkeydown = (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step) select(tabs[(i + step + tabs.length) % tabs.length].dataset.view!, true);
    };
  });

  root.querySelector<HTMLButtonElement>("#share")!.onclick = async () => {
    const result = await shareOrCopy(opts.pageUrl, name);
    if (result === "copied") toast("Link copied");
  };
  root.querySelectorAll<HTMLButtonElement>("[data-get]").forEach((b) => (b.onclick = () => {
    const target = root.querySelector<HTMLElement>("#install-area");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }));
}

function factLines(text: string): Raw {
  return html`${text.split(/[;,]\s*/).map((line, i) => html`${i ? html`<br />` : ""}${line}`)}`;
}

// Latest version with a clamped summary; "more..." reveals the full list.
function historyBlock(history: HistoryEntry[]): Raw {
  return html`
    <div class="history" id="history">
      ${history.map((h, i) => {
        const sha = h.sha ? html`<code title="${h.sha}">${h.sha.slice(0, 7)}</code>` : "";
        return html`
          <div class="rev ${i === 0 ? "" : "rev-more"}" ${i === 0 ? "" : raw("hidden")}>
            <div class="rev-head">
              <b>${h.version}</b>
              ${h.date ? html`<span class="muted small">${fmtDate(h.date)}</span>` : ""}
              ${h.sha ? (h.commitUrl ? html`<a class="rev-sha" href="${h.commitUrl}" target="_blank" rel="noopener" title="Commit ${h.sha}">${sha}</a>` : html`<span class="rev-sha">${sha}</span>`) : ""}
              ${h.releaseUrl ? html`<a class="small" href="${h.releaseUrl}" target="_blank" rel="noopener">release</a>` : ""}
            </div>
            ${h.title ? html`<div class="rev-title">${h.title}</div>` : ""}
            <div class="rev-notes ${i === 0 ? "clamp" : ""}">${h.notes ? notesHtml(h.notes) : html`<p class="faint">No notes for this version.</p>`}</div>
          </div>`;
      })}
      <button class="link-btn" id="history-more">more...</button>
      <p class="tiny faint">Every entry is a release of the app's code; the short code is the commit it was built from.</p>
    </div>
  `;
}

// "iPhone and iPad", "iPhone" or "iPad" from install.ios.devices; "iOS" when the developer makes no claim.
export function appleTargets(devices: ("iphone" | "ipad")[] | undefined): string {
  if (!devices || devices.length === 0) return "iOS";
  const names = devices.map((d) => (d === "ipad" ? "iPad" : "iPhone"));
  return names.length === 2 ? "iPhone and iPad" : names[0];
}

// A note shown on the Apple device the build was not made for; never blocks the install.
export function deviceNote(devices: ("iphone" | "ipad")[] | undefined, device: "iPhone" | "iPad"): string {
  if (!devices || devices.length === 0) return "";
  if (device === "iPad" && !devices.includes("ipad")) return "Made for iPhone. On this iPad it runs in a phone-sized window.";
  if (device === "iPhone" && !devices.includes("iphone")) return "Made for iPad. It will not install on an iPhone; open this page on an iPad instead.";
  return "";
}

function compat(data: LinkPage): string {
  const i = data.release?.install;
  if (!i) return "";
  const parts = [];
  if (i.ios) parts.push(appleTargets(i.ios.devices));
  if (i.android) parts.push("Android");
  if (i.macos) parts.push("Mac");
  if (i.windows) parts.push("Windows");
  if (i.tvos) parts.push("Apple TV");
  if (i.pwa) parts.push("Web");
  return parts.join(", ");
}

// The pill button next to the icon; the detailed flow lives in installArea.
function ctaArea(data: LinkPage, d: Detected, name: string): Raw {
  if (!data.release) return html`<span class="pill warn">${icon("info", "icon-16")} No build published yet</span>`;
  if (!hasDelivery(data)) return html`<span class="pill">No install options available</span>`;
  const install = data.release.install;
  if (d.inApp && !d.inApp.installWorks) return html`<button class="btn get" data-get>Get</button><span class="small muted">Open in ${d.platform === "ios" ? "Safari" : "Chrome"} first</span>`;
  if (d.platform === "ios") {
    if (install.ios?.testflight) return html`<button class="btn get" data-get>Get</button><span class="small muted">via Apple's TestFlight</span>`;
    if (install.pwa) return html`<a class="btn get" href="${install.pwa}">Open</a><span class="small muted">web app</span>`;
    return html`<span class="pill">Not for ${d.device} yet</span>`;
  }
  if (d.platform === "android") {
    if (install.android) return html`<a class="btn get" href="${install.android.apk}">Get</a><span class="small muted">direct download</span>`;
    if (install.pwa) return html`<a class="btn get" href="${install.pwa}">Open</a><span class="small muted">web app</span>`;
    return html`<span class="pill">Not for Android yet</span>`;
  }
  if (d.platform === "macos" || d.platform === "windows") {
    const native = install[d.platform];
    if (native?.packages.length || (d.platform === "macos" && data.release.apple?.macos)) return html`<button class="btn get" data-get>Get</button><span class="small muted">See install options below</span>`;
    if (d.platform === "macos" && data.release.apple?.iosOnMac) return html`<a class="btn get" href="${data.release.apple.iosOnMac.testflightUrl}">Get iPhone/iPad app</a><span class="small muted">Apple-silicon Mac · TestFlight</span>`;
    if (install.pwa) return html`<a class="btn get" href="${install.pwa}">Open web app</a>`;
    return html`<span class="pill">No compatible download available</span>`;
  }
  return html`<button class="btn get" data-get>Get</button><span class="small muted">See the versions below</span>`;
}

// Shown instead of any version when nothing can be installed from this browser or release.
function installArea(data: LinkPage, d: Detected, name: string, preview: boolean): Raw {
  if (data.release && !hasDelivery(data)) return noDelivery();
  if (d.inApp && !d.inApp.installWorks) {
    const browser = d.platform === "ios" ? "Safari" : "Chrome";
    return callout("warn", html`
      <b>Open this page in ${browser}</b>
      <p>${d.inApp.name === "this app" ? "This app's built-in browser" : d.inApp.name} cannot install apps. Tap the menu (three dots or the share icon) and choose <b>Open in ${browser}</b>, or copy the link below and paste it into ${browser}.</p>
    `);
  }
  return callout("info", html`<b>${name} has no published build yet.</b><p>${data.releaseError && preview ? html`<span class="small">${data.releaseError}</span>` : "Check back soon, or ask the developer."}</p>`);
}

// One version's install steps: on the matching device they install, on a computer they point to the device.
function installPanel(view: ViewKind | null, data: LinkPage, d: Detected, name: string, pageUrl: string): Raw {
  const install = data.release!.install;
  const deviceWord = d.platform === "macos" ? "Mac" : d.platform === "windows" ? "Windows" : d.platform === "other" ? "this device" : d.platform === "android" ? "Android" : d.device;
  if (view === null) return html`<div class="install-card"><h3>Not on ${deviceWord} yet</h3><p class="muted">There is no ${deviceWord} version of ${name} at the moment.</p></div>`;
  if (view === "macos" || view === "windows") return desktopPanel(data.release!, view, d.platform === view);
  if (view === "tvos") return televisionPanel(data.release!, pageUrl);
  const remote = d.platform === "other" || d.platform === "macos" || d.platform === "windows";
  if (view === "web") return remote ? webOnComputer(install.pwa!, name) : pwaSteps(install.pwa!, d.platform);
  if (remote) return remoteCard(view, install, pageUrl, data.release!.testflightVersion ?? null, data.release!.version);
  if (view === "android") return androidSteps(install.android!.apk, name);
  const note = deviceNote(install.ios?.devices, d.device);
  if (install.ios?.testflight) return testflightSteps(name, d.device, install.ios.testflight, note);
  return iosComingSoon(name, d.device, install.pwa);
}

const TESTFLIGHT_APP = "https://apps.apple.com/app/testflight/id899247664";

// iPhone and iPad installs go through Apple's TestFlight app: no settings to change, nothing to approve.
function testflightSteps(name: string, device: string, invite: string, note: string): Raw {
  return html`
    <div class="install-card" id="testflight-card">
      <h3>${icon("phone", "icon-20")} Install on this ${device}</h3>
      <p class="muted small">Your ${device} installs ${name} through TestFlight, Apple's free app for sharing apps before the App Store.</p>
      ${note ? callout("warn", html`<p class="small">${note}</p>`) : ""}
      <ol class="steps">
        <li><b>Get TestFlight</b> from the App Store, if you do not have it yet.<a class="btn block secondary mt-s" href="${TESTFLIGHT_APP}">Get TestFlight</a></li>
        <li>Come back here and open the invitation. TestFlight opens.<a class="btn block mt-s" href="${invite}">Open the invitation</a></li>
        <li>In TestFlight tap <b>Accept</b>, then <b>Install</b>. ${name} appears on your home screen.</li>
      </ol>
      <p class="tiny faint mt-s">TestFlight keeps ${name} up to date; say yes to automatic updates when it asks. If TestFlight says the beta isn't accepting testers, try again later today.</p>
    </div>`;
}

// Until the invitation accepts testers; the web version stands in when there is one.
function iosComingSoon(name: string, device: string, pwa: string | null): Raw {
  return html`
    <div class="install-card">
      <h3>${icon("phone", "icon-20")} Coming to ${device} soon</h3>
      <p class="muted small">The developer is getting ${name} ready for ${device}s.${pwa ? " Until then, the web version runs on this " + device + " too." : ""}</p>
      ${pwa ? html`<a class="btn block" href="${pwa}" rel="noopener">Open the web version</a>` : ""}
    </div>`;
}

function remoteCard(view: "iphone" | "ipad" | "android", install: Install, pageUrl: string, tfVersion: string | null, version: string): Raw {
  const device = view === "android" ? "Android phone" : VIEW_LABEL[view];
  const steps =
    view === "android"
      ? html`<li>Tap <b>Get</b>; the app downloads.</li><li>The first time, allow installs from the browser when Android asks.</li><li>Tap <b>Install</b>.</li>`
      : install.ios?.testflight
        ? html`<li>Get Apple's free <b>TestFlight</b> app from the App Store.</li><li>Tap <b>Open the invitation</b> on this page, on the ${device}.</li><li>In TestFlight tap <b>Accept</b>, then <b>Install</b>.${tfVersion && tfVersion !== version ? html` TestFlight has version ${tfVersion}.` : ""}</li>`
        : html`<li>The ${device} version is coming soon${install.pwa ? "; the web version works there meanwhile" : ""}.</li>`;
  return html`
    <div class="install-card remote-card">
      <div class="qr">${qrSvg(pageUrl)}</div>
      <div class="grow">
        <h3>${icon(VIEW_ICON[view], "icon-20")} Install on your ${device}</h3>
        <p class="muted small">Point the ${device}'s camera at the code, or send yourself this link, then:</p>
        <ol class="steps small">${steps}</ol>
      </div>
    </div>`;
}

function webOnComputer(url: string, name: string): Raw {
  return html`
    <div class="install-card">
      <h3>${icon("globe", "icon-20")} Web version</h3>
      <p class="muted small">Runs in this browser; nothing to install.</p>
      <a class="btn lg" href="${url}" rel="noopener">Open ${name}</a>
      <p class="small muted mt">On a phone or tablet, open this page there and add the web version to the home screen.</p>
    </div>`;
}

// The version's own screenshots, else the general list, else the closest other platform's, else generated previews.
function shotsBlock(view: ViewKind | null, sets: ScreenshotSets, name: string, tagline: string): Raw {
  const picked = pickScreenshots(view, sets);
  if (picked.urls.length === 0) {
    const shape = shapeFor(view);
    return html`<div class="shots shape-${shape}">${[0, 1, 2].map((i) => screenshotSvg(name, tagline, i, shape))}</div><p class="sub">Screenshots coming soon.</p>`;
  }
  const source = picked.source === "all" ? null : (picked.source as ViewKind);
  const shape = shapeFor(source ?? view);
  return html`${source ? html`<p class="sub">${VIEW_LABEL[source]} screenshots</p>` : ""}<div class="shots shape-${shape}">${picked.urls.map((u) => html`<img src="${u}" alt="Screenshot of ${name}" loading="lazy" />`)}</div>`;
}


function androidSteps(apkUrl: string, name: string): Raw {
  return html`
    <div class="install-card">
      <h3>${icon("android", "icon-20")} Install on this Android phone</h3>
      <a class="btn block lg" href="${apkUrl}">Download ${name}</a>
      <p class="muted small mt">The first time, Android asks for permission because the app is not from the Play Store. This is normal for apps shared by a person.</p>
      <ol class="steps small">
        <li>When the download finishes, tap <b>Open</b> on the notification.</li>
        <li>If you see "not allowed to install unknown apps from this source", tap <b>Settings</b>, switch on <b>Allow from this source</b>, then go back.</li>
        <li>Tap <b>Install</b>.</li>
        <li>If Play Protect says it has not seen this developer before, tap <b>More details</b>, then <b>Install anyway</b>.</li>
      </ol>
    </div>
  `;
}

function pwaSteps(url: string, platform: Platform): Raw {
  const steps = platform === "ios"
    ? html`<li>Open the page in Safari.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>`
    : html`<li>Open the page in Chrome.</li><li>Tap the three-dot menu.</li><li>Choose <b>Add to Home screen</b> or <b>Install app</b>.</li>`;
  return html`
    <div class="install-card">
      <h3>${icon("globe", "icon-20")} Web app</h3>
      <a class="btn block lg" href="${url}" rel="noopener">Open the web app</a>
      <p class="muted small mt">It opens in the browser and offers to add itself to your home screen; one tap and it launches like an app from then on, and remembers permissions such as camera and microphone. If you miss the offer:</p>
      <ol class="steps small">${steps}</ol>
    </div>
  `;
}

export { raw };
