# Gotchas

- Default `Python-urllib` requests to ourapps can receive Cloudflare HTTP403/error1010 before Worker authentication. A descriptive application User-Agent reaches the expected unauthenticated401 response; keep redirect/credential protections intact. Controlled curl/Python probes and Cloudflare's Error1010 documentation confirm this behavior.

- Approved TestFlight versions refresh through `refreshApprovedVersions` on public page and update reads, at most once a minute while builds are pending. Install pages re-read on return to the foreground and every visible minute; `installPage` owns listener cleanup.

- `@cloudflare/vitest-pool-workers` is deprecated; this repo uses `@cloudflare/vitest-plugin`
  with `cloudflareTest()` and `readD1Migrations` in `worker/vitest.config.ts`. Tests import
  `env` from `cloudflare:workers` and `applyD1Migrations` from `cloudflare:test`.
- Handlers take `deps` (`fetch`, `now`, `sleep`) so tests stub Apple, GitHub and time
  without network; see `worker/test/helpers.ts`.
- The session cookie only works because the site and `/api` share one origin. Do not move
  the site to another host (GitHub Pages) without switching to bearer tokens.
- Apple profiles cannot be edited: the worker deletes and recreates the App Store profile with
  the same name when it lacks the current certificate.
- Apple JSON Web Tokens must expire within 20 minutes of `iat` (the worker uses 10).
- Installs do not work inside most apps' web views (Instagram, Facebook, Gmail). The install
  page shows an "open in Safari" instruction; WhatsApp is the exception.
- Developer slugs may not collide with `api`, `dl`, `dev`, `l` or the other paths in `RESERVED_SLUGS`.
- `wrangler` is not installed globally; use `npx wrangler` inside `worker/`.
- GitHub Pages on a private repo needs a paid plan; this repo is public for that reason
  even though Pages is no longer used.
- Cookie sessions refuse writes whose `Origin` differs from `PUBLIC_ORIGIN` (localhost origins
  allowed when `PUBLIC_ORIGIN` is localhost). API keys (`oa_...`) skip that check and cannot
  create or revoke keys.
- Grid children need `min-width: 0` or a long URL widens the page on phones; `style.css`
  sets it for `.stack`, `.grid-2`, `.grid-3` and the card layouts. Keep that in mind for new
  grids.
- Desktop Chrome will not open a window narrower than about 500 px, so headless screenshots
  at phone widths lie; use `npx playwright screenshot --channel chrome --viewport-size=390,844`.
- `site/public/contract.md` is generated (gitignored); edit `CONTRACT.md` at the root.
- Credentials: one ciphertext per field (`worker/src/secrets.ts`, format 2 with `kid`). Token
  hashes carry the `h2:` prefix and are peppered from `MASTER_KEY`; verification also tries
  `MASTER_KEY_PREVIOUS` and plain SHA-256, rewriting on match. Never compare a token against a
  stored hash without going through `hashMatches`.
- `PUT /api/dev/secrets` and key management are session-only; tests that need credentials must
  sign in with a cookie, not an API key.
- Per-link app hosts are detected by host suffix in `handle()` before any console routing;
  they never see the session cookie logic, and `/api/*` and `/dl/*` are 404 there on purpose.
  Local `wrangler dev` cannot exercise wildcard hosts; tests cover it with synthetic Requests.
- Never inflate a web.zip per request: the free plan's 10 ms CPU budget fails on bundles of a
  few MB (Cloudflare error 1102). `webapp.ts` unpacks once per release tag into ~2 MB packs in
  the `WEBAPP_FILES` KV namespace (a handful of writes; the free plan allows 1,000 writes a day
  for the whole account) and caches single files at the edge; the current tag is cached 60 s.
  Deflated content is capped at 8 MB for the same CPU reason; bundles should use `zip -0`.
- Session and OAuth state cookies are `__Host-` prefixed on https so `<link>.ourapps.app`
  pages cannot toss cookies to the console; plain names only on http://localhost.
- Cache API keys use `${PUBLIC_ORIGIN}/__cache/...`; arbitrary hostnames are not documented to
  cache.
- Never rename the Cloudflare Worker (`"name": "app-game-store"` in `worker/wrangler.jsonc`):
  a new name deploys a new Worker without the secrets, and `MASTER_KEY` cannot be read back, so
  every stored credential would become undecryptable. The D1 database name stays too. Users only
  ever see `ourapps.app`.
- Never create a new GitHub repository named `app-game-store` under the account; it would break
  GitHub's forwarding from the old name.
- Client-facing error text must be thrown as `HttpError`; any other error becomes a generic 500
  with a reference (`errorResponse` in `worker/src/index.ts`), and public web app pages show a
  fixed sentence. Plain `Error` messages can name private repositories, so never return them.
  CodeQL `js/stack-trace-exposure` still flags the HttpError path; alert 1 was dismissed as a
  false positive for that reason.
- Accepted risks, decided by the owner on 2026-10-18; do not "fix" them unasked: (1) anyone can
  use up the free plan's 100,000 requests a day, stopping installs until the next day; (2) open
  sign-up lets any GitHub user serve files through ourapps.app, which could get the domain
  flagged by Safe Browsing (deferred until the owner has investigated options).
- iPads use the same path as iPhones (`platform` "ios"); wording comes from `appleDeviceName`.
- `wrangler dev` presents requests as coming from the route's host (ourapps.app), so with
  `PUBLIC_ORIGIN=http://localhost:8787` every console save was refused as cross-site locally.
  `npm run dev -w worker` passes `--local-upstream localhost:8787`; running plain `wrangler dev`
  reproduces the refusal. Production is unaffected.
- SQLite CHECKs pass on NULL: `CHECK (a IS NOT NULL OR b = 'x')` accepts a NULL `b`; use `COALESCE(b, '')`.
- Unauthenticated `api.github.com` asset requests return JSON metadata unless `Accept: application/octet-stream` is sent; `fetchUpstream` sets it for every `api.github.com` URL.
- App Store Connect API shapes were checked on 2026-11-25 against developer.apple.com/documentation/appstoreconnectapi (JSON under `https://developer.apple.com/tutorials/data/documentation/appstoreconnectapi/<page>.json`, for example `post-v1-reviewsubmissions`, `reviewsubmissioncreaterequest`, `appstoreversioncreaterequest`, `appversionstate`, `ageratingdeclarationupdaterequest`, `apppriceschedulecreaterequest`, `get-v1-apppriceschedules-_id_-manualprices`, `appavailabilityv2createrequest`) and the screenshot sizes at developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications. `appStoreState` is deprecated for `appVersionState`; age rating levels `INFREQUENT_OR_MILD` and `FREQUENT_OR_INTENSE` are deprecated for `INFREQUENT` and `FREQUENT`.
- App Store screenshots use the App Asset Library (API 4.5.1; `appScreenshotSets` and `appScreenshots` are deprecated): pages `app-asset-library`, `understanding-the-app-asset-library`, `uploading-and-managing-image-assets`, `placing-assets-on-your-app-store-surfaces`, `discovering-asset-specifications`, `migrating-to-the-app-asset-library`, `app-store-connect-api-4-5-1-release-notes`. Library from `GET /v1/apps/{id}/assetLibrary`; image reserved with `POST /v1/appAssetLibraryImages` (`category` `APP_SCREENSHOTS_AND_PREVIEWS`) and committed with `uploaded: true` alone, no checksum; placed with `POST /v1/appAssetLibraryPlacements` (`placementType` `APP_SCREENSHOT`, `placementGroup` from `GET /v1/appAssetLibraryRefData`); ordered with `POST /v1/appAssetLibraryPlacementOrderingRequests`. Deletes do not cascade: placements first, then the image, or Apple answers 409 `STATE_ERROR.ASSET_HAS_PLACEMENTS`. Group identifiers are runtime strings (`worker/src/asset-library.ts` reads them); `FALLBACK_SCREENSHOT_GROUPS` in `shared/src/appstore.ts` is used only when the reference data cannot be read, and its Apple TV identifier is a guess.
- App Store screenshots: the Worker downloads, measures (`worker/src/image.ts`, header only) and uploads each one itself without hashing. `runScreenshots` stops at about 2 MB of images (at least one) and 40 outbound calls per request; the console repeats the POST while `screenshots.pending` is above 0 and the cron continues one unfinished version per run with the calls TestFlight left (`scheduled` in `worker/src/index.ts`).
- App Store following never maps `PREPARE_FOR_SUBMISSION` back to draft, so a just-submitted version is not dropped while Apple catches up; only `DEVELOPER_REJECTED` returns it to draft.
- Apple Pay shapes were checked on 2026-11-26 against developer.apple.com/documentation/appstoreconnectapi (JSON under `https://developer.apple.com/tutorials/data/documentation/appstoreconnectapi/<page>.json`): `managing-payment-processing-certificates`, `merchantids`, `post-v1-merchantids`, `merchantidcreaterequest/data-data.dictionary/attributes-data.dictionary` (identifier, name), `get-v1-merchantids` (`filter[identifier]`, `fields[merchantIds]`), `post-v1-certificates`, `certificatecreaterequest/data-data.dictionary/relationships-data.dictionary` (`merchantId`), `certificatetype` (`APPLE_PAY` is the elliptic curve certificate; `APPLE_PAY_RSA` exists for processing in China mainland and is not used), `certificate/attributes-data.dictionary` (`activated`, `expirationDate`, `certificateContent`), `capabilitytype` (`APPLE_PAY`), `bundleidcapabilitycreaterequest/data-data.dictionary/attributes-data.dictionary`, `capabilitysetting` (keys only `ICLOUD_VERSION`, `DATA_PROTECTION_PERMISSION_LEVEL`, `APPLE_ID_AUTH_APP_CONSENT`: nothing assigns a merchant identifier, as developer.apple.com/forums/thread/842704 says), `get-v1-bundleids-_id_-bundleidcapabilities`, `profile/attributes-data.dictionary`; entitlement at `https://developer.apple.com/tutorials/data/documentation/bundleresources/entitlements/com.apple.developer.in-app-payments.json` (array of merchant identifiers). Roles and portal steps: developer.apple.com/help/account/capabilities/configure-apple-pay (Account Holder or Admin), developer.apple.com/help/account/access/roles ("Create other certificate types": Account Holder, Admin, App Manager only with Certificates, Identifiers and Profiles access), developer.apple.com/help/account/identifiers/enable-app-capabilities (Apple Pay: Edit, tick in the Merchant ID table, Continue, Save; a changed App ID invalidates its profiles). Certificates last 25 months; only one per merchant identifier is activated, and one made while another is active is not activated until the old one is revoked or it is activated. Activation (checked 2026-11-26): `PATCH /v1/certificates/{id}` with `{ data: { type: "certificates", id, attributes: { activated: true } } }`, answering 200 with the certificate (pages `patch-v1-certificates-_id_`, `certificateupdaterequest/data-data.dictionary`, `certificateupdaterequest/data-data.dictionary/attributes-data.dictionary`); Apple deactivates the merchant identifier's other certificate itself, and ourapps reads the flags back with `GET /v1/merchantIds/{id}/certificates?filter[certificateType]=APPLE_PAY&fields[certificates]=activated` (`get-v1-merchantids-_id_-certificates`).
- Google Play shapes were checked on 2026-11-26 against developers.google.com/android-publisher/api-ref/rest/v3: `edits` (insert, delete, `:commit` with `changesNotSentForReview` and `changesInReviewBehavior` `CANCEL_IN_REVIEW_AND_SUBMIT` by default or `ERROR_IF_IN_REVIEW`), `edits.details` (`defaultLanguage`, `contactEmail`, `contactWebsite`, `contactPhone`; patch), `edits.listings/update` (`title`, `shortDescription`, `fullDescription`), `edits.images/upload` and `deleteall` with `AppImageType` (`icon`, `featureGraphic`, `phoneScreenshots`, `sevenInchScreenshots`, `tenInchScreenshots`, `tvScreenshots`, `wearScreenshots`, `tvBanner`), `edits.bundles/upload` and `list` (`versionCode`), `edits.tracks/update` (`Release`: `name`, `versionCodes` as strings, `releaseNotes` `{language, text}`, `status` `draft|inProgress|halted|completed`, `userFraction` only with inProgress or halted), `applications.tracks.releases/list` (`releaseLifecycleState` `..._DRAFT`, `_NOT_SENT_FOR_REVIEW`, `_IN_REVIEW`, `_APPROVED_NOT_PUBLISHED`, `_NOT_APPROVED`, `_PUBLISHED`; the only review state the API gives), and `applications/dataSafety` (takes Google's CSV of data safety answers; ourapps' policy answers cannot fill it honestly, so it is not used). Track names: developers.google.com/android-publisher/tracks (internal testing is `qa`, open is `beta`, closed is `alpha` or a custom name). Uploads: developers.google.com/android-publisher/upload (resumable session from `?uploadType=resumable` with `X-Upload-Content-Type` and `X-Upload-Content-Length`, `Location` holds `upload_id`; the session PUT carries no access token, but ourapps sends it from the Worker as a stream). Tokens: developers.google.com/identity/protocols/oauth2/service-account (RS256, `iss` the client email, `scope`, `aud` `https://oauth2.googleapis.com/token`, at most an hour; grant type `urn:ietf:params:oauth:grant-type:jwt-bearer`). Setup: developers.google.com/android-publisher/getting_started. The Edits API works only on an app with one bundle uploaded in Play Console, and answers "Package not found" until then (developers.google.com/android-publisher/edits); a draft app takes only `draft` releases until it is rolled out once by hand.
- Play Console Help, checked 2026-11-26: create app 9859152 (30, 80 and 4,000 characters; versionCode at most 2100000000, also developer.android.com/studio/publish/versioning), graphics 9866151 (icon 512 x 512 32-bit PNG at most 1024 KB; feature graphic 1024 x 500 JPEG or 24-bit PNG; 2 to 8 phone screenshots, sides 320 to 3,840, long side at most 2.3 times the short; tablets 1,080 to 7,680), testing for personal accounts created after 13 November 2023 14151465 (closed test, 12 testers opted in for 14 days in a row, then apply for production; open testing opens with production access), App content 9859455 (privacy policy address set only there), managed publishing 9859654, releases 9859348 (500 characters of notes per language), staged rollouts 6346149 (not for a first release), Play App Signing 9842756 (upload key and app signing key; the key can be changed before an open or production release). Android developer verification: developer.android.com/developer-verification and its guides `google-play-console`, `developer-console-api` (OAuth with a user, not a service account) and `check-registration-status` (`androiddeveloperidstatus.googleapis.com/v1/packages/{package}/packageRegistrationStatus:check`, an API key, 1,000 a day; not built). Google Pay production access: developers.google.com/pay/api/android/guides/test-and-deploy/request-prod-access (the Google Pay and Wallet Console lists only apps in Google Play under the same account).
