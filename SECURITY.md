# Security

How ourapps protects developer credentials and tokens, what to do on rotation, and what the design
does not cover. The public recipe library and component catalogue hold entries and release
pointers only, never packages or secret values.

## What is stored and how

| data | at rest | notes |
|---|---|---|
| Apple issuer id, key id, .p8 private key, team id, GitHub token, signing key | AES-256-GCM, one ciphertext per field | key derived per developer with HKDF-SHA256 from `MASTER_KEY`; developer id, field name and format version bound as additional authenticated data; random 96-bit nonce per write |
| API keys (`oa_` + 160 random bits) | HMAC-SHA256 keyed hash (`h2:` prefix) | pepper derived from `MASTER_KEY`; only an 11-character prefix is kept for display |
| Per-app build tokens (192 random bits) | HMAC-SHA256 keyed hash | same pepper scheme, purpose string `build-token` |
| Apple Distribution certificate (public) | plain, `signing_certificates` | its private key is the `signingKey` field above, made in the developer's browser |
| Session ids (192 random bits) | HMAC-SHA256 keyed hash | cookie `HttpOnly; Secure; SameSite=Lax`, 30 days, purpose string `session` |
| Signed download links | HMAC-SHA256 over the payload with `LINK_SECRET` | expire after one hour |
| Recipes and components (entry, page text, diagram, release pointer, digests) | plain, `recipes`, `components` and their version tables | public by design; never holds a package, token or secret value |
| Audit log | plain text | event name, short detail, country; never values |

`MASTER_KEY` and `LINK_SECRET` live only in Cloudflare Worker secrets. D1 is encrypted at rest by
Cloudflare; the scheme above assumes it is not and treats a copied database as useless without the
Worker secrets.

A copy of the database therefore yields no plaintext credentials, no usable API keys, build
tokens or sessions, and no way to forge any of them (forging a keyed hash needs the pepper).

## Access rules

- Credentials can be written only from a browser session (`PUT /api/dev/secrets` refuses API
  keys). They are never returned by any endpoint; the console sees presence and save dates.
- Cookie sessions refuse state-changing requests whose `Origin` is not this site.
- API keys have a scope (`read` or `manage`) and an optional expiry (default 90 days in the
  console, at most one year when set, or none). Keys cannot create or revoke keys. Every key is revocable alone
  or all at once.
- Decryption is on demand and field-level: install pages decrypt only the GitHub token; the
  Apple private key is decrypted only while setting up signing or TestFlight, brokering a
  workflow's upload, and in the ten-minute check that looks after TestFlight builds; the signing
  key only when a release workflow presents one of the developer's build tokens at
  `/api/build/<app>/signing`. A build token therefore lets its holder sign builds as that
  developer and upload them to the app's TestFlight.
- The signing key is written only by `POST /api/dev/signing` from a browser session (validated as
  a 2048-bit RSA PKCS#8 key); `PUT /api/dev/secrets` cannot set it.
- The Apple key is validated as an EC P-256 PKCS#8 key before it is stored; GitHub tokens must
  match the `github_pat_`, `ghp_` or `gho_` shape.
- Security events (sign-in, sign-out, credential saves and removals, signing setup, key creation
  and revocation, build token rotation, app deletion, recipe and component publishing, unlisting and deprecation) are written to the audit log
  and shown under Settings, Security, with "Sign out everywhere" next to them.
- Every response carries HSTS (preload), a strict Content Security Policy, `nosniff`,
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, a Referrer-Policy and a
  Permissions-Policy.

## Recipe library and component catalogue

- Reads are public and carry no developer credentials. Responses name the publisher by display
  name and page address only, or by nothing once the publisher deleted their account.
- Publishing needs a browser session with the current terms accepted, or a `manage` API key. The
  service checks with the publisher's saved GitHub token that the token can push to the named
  repository and that the tagged release holds the named asset; a name's scope must equal the
  repository owner, and a name stays with its first developer and repository.
- A version is bound to its digest. Unlisting hides a version and keeps its digest.
- Deleting an account removes the developer record and everything the developer owns except
  recipes and components: those keep their rows with a null owner, flagged `owner-deleted`
  (orphaned), and nobody can change, unlist or republish them. Deprecation by the owner
  (`owner-deprecated`) is reversible; orphaning is not. Responses for anything that uses a flagged
  entry carry a `deprecations` warning.
- An orphaned bundle is fetched with no GitHub token: a public release downloads, a private one
  answers `bundle-unavailable`. The deleted developer's token is gone with their credentials and is
  never used.
- Entries that contain a private key block, a GitHub token, an ourapps API key or an AWS access
  key identifier are refused.
- A diagram is an SVG without scripts, event handlers, embedded objects, doctype declarations
  or references outside the file. It is served as an image with a sandboxing Content Security
  Policy and is shown through `<img>`.
- Bundles are fetched server-side with the publisher's token and handed out through the
  signed one-hour `/dl/` link; the release asset's address and the token are never returned. A
  link request fails if GitHub's recorded digest for the asset differs from the recorded one.
- Search terms are quoted word by word before they reach the full-text index.
- Limits: 50 recipes and 200 components per developer, 200 versions per name.

## Rotating the master key

1. Generate a new value: `openssl rand -hex 32`.
2. `npx wrangler secret put MASTER_KEY_PREVIOUS` with the current value, then
   `npx wrangler secret put MASTER_KEY` with the new one. Deploy is not needed; secrets apply
   on the next request.
3. Credentials are rewrapped under the new key the first time they are read; API keys, build
   tokens and sessions are rehashed the first time they are used. Nothing stops working.
4. After every active developer has used the console once (check
   `SELECT json_extract(blob, '$.kid') AS kid, count(*) FROM developer_secrets GROUP BY kid`),
   remove the old value: `npx wrangler secret delete MASTER_KEY_PREVIOUS`. Credentials still
   under the old key id after that cannot be decrypted; their owners re-enter them.

Rotating `LINK_SECRET` only invalidates download links that are less than an hour old.

## If a credential leaks

- GitHub token: revoke it on GitHub, create a new one, paste it under Settings.
- Apple key: revoke it in App Store Connect, Users and Access, Integrations; generate a new one.
- API key: revoke it on the Agents page (or revoke all).
- Build token: rotate it on the app page and update the repository secret. If it may have been
  used, also replace the certificate under Settings and revoke the old one in the Apple developer
  portal. Apple refuses uploads signed with a revoked certificate and may mark builds signed with
  it that are not yet submitted for review as invalid; apps already on the App Store are
  unaffected.
- Suspected account takeover: Settings, Sign out everywhere; Agents, Revoke all keys; then
  rotate the two external credentials above.

## Not covered

- Compromise of the Cloudflare account or of GitHub sign-in itself.
- A malicious developer: each developer only ever sees their own rows, but the service trusts
  Cloudflare and GitHub for identity.
- Secrets in Worker memory during a request; the runtime does not offer zeroisation.
- Brute force against sign-in is bounded by GitHub; against API keys it is bounded by 160 bits.
  No per-IP rate limit is applied on the free tier.

## Reporting a vulnerability

Report it privately at https://github.com/ourapps-ae/ourapps/security/advisories/new
(GitHub's private vulnerability reporting: only the maintainer sees it). Do not open a public
issue for a security problem, and do not include real secrets or personal data in any report.
Expect a reply within a few days; fixes are released before details are published.
