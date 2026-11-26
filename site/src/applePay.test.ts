import { describe, expect, it } from "vitest";
import type { ApplePayStatus } from "./api.js";
import { applePayCard, requestText } from "./applePay.js";

const MERCHANT = "merchant.com.example.pokernight";

function status(over: Partial<ApplePayStatus> = {}): ApplePayStatus {
  return {
    setUp: true, needs: null, step: "merchant", entitlement: "com.apple.developer.in-app-payments",
    merchant: { id: null, identifier: null, name: null, suggested: { identifier: MERCHANT, name: "Poker Night" }, team: [{ identifier: "merchant.club.poker", name: "Poker Club" }], done: false, error: null },
    certificate: { items: [], activeId: null, renewBy: null, done: false, error: null },
    capability: { appIds: [], turnedOnAt: null, tickedAt: null, done: false, error: null },
    profiles: { items: [{ platform: "ios", label: "iPhone and iPad", profileName: "Poker Night App Store", merchantIdentifiers: [], carries: false }], madeAt: null, done: false, error: null },
    ...over,
  };
}

const chosen = (over: Partial<ApplePayStatus> = {}) => status({
  merchant: { ...status().merchant, id: "M1", identifier: MERCHANT, name: "Poker Night", team: null, done: true },
  capability: { appIds: [{ id: "bid-1", identifier: "com.example.pokernight", platforms: ["ios"], page: "https://developer.apple.com/account/resources/identifiers/bundleId/edit/bid-1" }], turnedOnAt: "2026-11-26T10:00:00Z", tickedAt: null, done: false, error: null },
  ...over,
});

const certificate = { id: "C1", name: `Apple Pay Payment Processing: ${MERCHANT}`, serialNumber: "7A1B", expirationDate: "2028-12-26T10:00:00Z", renewBy: "2028-11-26T10:00:00Z", activated: true, createdAt: "2026-11-26T10:00:00Z", download: "/api/dev/apps/a1/applepay/certificate/C1" };
const steps = (html: string) => [...html.matchAll(/<li class="([\w-]+)" data-ap-step="([\w-]+)"/g)].map((m) => `${m[2]}:${m[1]}`);

describe("Apple Pay card", () => {
  it("asks for TestFlight first", () => {
    const card = applePayCard(status({ setUp: false, needs: "testflight", step: null })).html;
    expect(card).toContain("Set up iPhone and iPad TestFlight first");
    expect(card).not.toContain("data-ap-step");
  });

  it("starts with the merchant identifier from the bundle identifier, or one the team has", () => {
    const card = applePayCard(status()).html;
    expect(steps(card)).toEqual(["merchant:now", "certificate:muted-step", "capability:muted-step", "profiles:muted-step"]);
    expect(card).toContain(`name="identifier" value="${MERCHANT}"`);
    expect(card).toContain('<option value="merchant.club.poker">merchant.club.poker (Poker Club)</option>');
    expect(card).toContain("&lt;key&gt;com.apple.developer.in-app-payments&lt;/key&gt;");
    expect(card).toContain(`&lt;string&gt;${MERCHANT}&lt;/string&gt;`);
  });

  it("takes the processor's certificate request and offers the certificate with its expiry", () => {
    const card = applePayCard(chosen({ step: "certificate", certificate: { items: [certificate], activeId: "C1", renewBy: certificate.renewBy, done: false, error: null } })).html;
    expect(steps(card).slice(0, 2)).toEqual(["merchant:done", "certificate:now"]);
    expect(card).toContain('href="https://dashboard.stripe.com/settings/ios_certificates"');
    expect(card).toContain('name="csr"');
    expect(card).toContain('href="/api/dev/apps/a1/applepay/certificate/C1" download');
    expect(card).toContain("in use");
    expect(card).toContain("never holds it");
  });

  it("offers Activate on the next certificate, once the processor holds it", () => {
    const next = { ...certificate, id: "C2", serialNumber: "7A1C", activated: false };
    const old = { ...certificate, id: "C0", serialNumber: "7A10", activated: false, expirationDate: "2026-01-01T00:00:00Z" };
    const card = applePayCard(chosen({ step: "certificate", certificate: { items: [next, certificate, old], activeId: "C1", renewBy: certificate.renewBy, done: true, error: null } }), "certificate").html;
    expect(card.match(/data-ap-activate="([\w-]+)"/g)).toEqual(['data-ap-activate="C2"']);
    expect(card).toContain("so the processor must already hold its .cer file. Give it to the processor first, then press Activate");
    expect(card).not.toContain("revoke");
    expect(applePayCard(chosen({ step: "certificate", certificate: { items: [certificate], activeId: "C1", renewBy: certificate.renewBy, done: true, error: null } })).html).not.toContain("data-ap-activate");
  });

  it("says when to renew, and loudly once the date has passed", () => {
    const done = { items: [certificate], activeId: "C1", renewBy: certificate.renewBy, done: true, error: null };
    const card = applePayCard(chosen({ step: "capability", certificate: done })).html;
    expect(card).toMatch(/Serial 7A1B, expires .+\. Renew by .+: get another certificate request from your payment processor, make the certificate here, give it to the processor, then activate it here\./);
    expect(card).not.toContain("callout warn");
    const late = applePayCard(chosen({ step: "capability", certificate: { ...done, renewBy: "2026-01-01T00:00:00Z" } })).html;
    expect(late).toContain("The Payment Processing certificate in use expires");
  });

  it("links the App ID with the exact steps for the tick Apple's API cannot do", () => {
    const card = applePayCard(chosen({ step: "capability" })).html;
    expect(card).toContain('href="https://developer.apple.com/account/resources/identifiers/bundleId/edit/bid-1"');
    expect(card).toContain("<b>Apple Pay Payment Processing</b> is ticked. Click <b>Edit</b> beside it.");
    expect(card).toContain(`data-copy="${MERCHANT}"`);
    expect(card).toContain("data-ap-confirm");
  });

  it("shows whether each profile carries the merchant identifier", () => {
    const lacking = applePayCard(chosen({ step: "profiles", capability: { ...chosen().capability, tickedAt: "2026-11-26T11:00:00Z", done: true }, profiles: { ...status().profiles, madeAt: "2026-11-26T11:00:00Z" } })).html;
    expect(lacking).toContain(`does not carry ${MERCHANT}`);
    expect(lacking).toContain("Check the tick on Apple's site");
    expect(lacking).toContain("data-ap-profiles");
    const carrying = applePayCard(chosen({ step: null, profiles: { items: [{ platform: "ios", label: "iPhone and iPad", profileName: "Poker Night App Store", merchantIdentifiers: [MERCHANT], carries: true }, { platform: "macos", label: "Mac", profileName: "Poker Night App Store macos", merchantIdentifiers: [MERCHANT], carries: true }], madeAt: "2026-11-26T11:00:00Z", done: true, error: null } })).html;
    expect(carrying).toContain(`iPhone and iPad and Mac: the profiles carry ${MERCHANT}.`);
    expect(carrying).toContain("ready");
  });
});

describe("a certificate request file", () => {
  it("is taken as it is when it is text, and wrapped when it is the bare bytes", async () => {
    const pem = "-----BEGIN CERTIFICATE REQUEST-----\nMIIBVzCBwQIBADAY\n-----END CERTIFICATE REQUEST-----\n";
    expect(await requestText(new Blob([pem]))).toBe(pem.trim());
    expect(await requestText(new Blob([new Uint8Array([0x30, 0x82, 0x01, 0x57])]))).toBe("-----BEGIN CERTIFICATE REQUEST-----\nMIIBVw==\n-----END CERTIFICATE REQUEST-----");
  });
});
