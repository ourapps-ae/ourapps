# Building an application from a recipe on GitHub, with no machine of your own

GitHub Actions does the work a computer does in "Building an application from a recipe" (https://ourapps.app/agents.md): aepm fetches the recipe and its components, designs the application from your answers, resolves exact versions and installs it into your repository. The workflows the design installs then check, build, release and update it. A person can do every step below on github.com in a browser; an agent with the GitHub CLI (`gh`) signed in can do them with the commands shown.

The examples use the OurPoker recipe (`ourpoker@0.7.0`, https://ourapps.app/recipes/ourpoker.txt). Another recipe works the same way when its design includes the `ourapps-release` component, which brings the workflows.

## 1. The repository

1. Create a private repository: on github.com, "New repository", with a README; or `gh repo create <owner>/<name> --private --add-readme`.
2. Settings, Actions, General: tick "Allow GitHub Actions to create and approve pull requests". `aepm-update` needs it to propose updates.
3. Add three files to the main branch ("Add file", "Create new file"; or commit them from a clone):
   - `answers.json`: the recipe's answers, an object from question id to answer. The questions, their defaults and the conditions that ask them are on the recipe's text page (`https://ourapps.app/recipes/<name>.txt`). The design must include the `ourapps-release` component: for OurPoker, `publish` or `releases` is true. Example: `{"targets": ["web", "android"], "server": "cloudflare", "hostingAccount": "ourpoker-cloudflare-account", "releases": true}`. Secret reference answers are names, never values.
   - `CHANGELOG.md`: the release notes, read by the release workflow and shown to your people. To start: `# Changelog`, then `## [0.1.0]`, `### Added`, `- First release.`
   - `.github/workflows/aepm-assemble.yml`: a copy of https://ourapps.app/aepm-assemble.yml.

## 2. The secrets

Settings, "Secrets and variables", Actions, "New repository secret"; or `gh secret set <NAME> --repo <owner>/<name>`, which reads the value from standard input. The agent never sees a value.

| Secret | What it is | Used by |
|---|---|---|
| `AEPM_OWNER_KEY` | the owner's private key: `openssl genpkey -algorithm ed25519 -out owner.pem`, then `gh secret set AEPM_OWNER_KEY --repo <owner>/<name> < owner.pem`. Keep `owner.pem` in a password manager. | `aepm-assemble` puts its public key in the policy; `aepm-update` approves each update with it |
| `AEPM_PUSH_TOKEN` | a fine-grained personal access token for this repository only, with Contents and Workflows read and write. GitHub refuses a workflow's own token a push that adds files under `.github/workflows`. | `aepm-assemble` pushes the application with it |

Publishing needs the secrets the reference answers name. The workflows read the names from `components/ourapps-release/server/release.json`: the reference in capitals, hyphens as underscores, then a suffix. A secret that is not set is skipped, and that part stays unsigned or is not deployed. For OurPoker 0.7.0, with references starting `ourpoker-`:

| Answer (reference name) | Repository secrets | Without them |
|---|---|---|
| `hostingAccount`: `ourpoker-cloudflare-account` | `OURPOKER_CLOUDFLARE_ACCOUNT_API_TOKEN`, `OURPOKER_CLOUDFLARE_ACCOUNT_ACCOUNT_ID` | the release deploys no server |
| `webDeploy`: `ourpoker-web-deploy` | `OURPOKER_WEB_DEPLOY_API_TOKEN` (a Cloudflare token from the "Edit Cloudflare Workers" template), `OURPOKER_WEB_DEPLOY_ACCOUNT_ID` | the web client is released as `web.zip`, which ourapps.app serves |
| `androidSigning`: `ourpoker-android-signing` | `OURPOKER_ANDROID_SIGNING_KEYSTORE_BASE64` (the keystore file in base64), `OURPOKER_ANDROID_SIGNING_KEYSTORE_PASSWORD`, `OURPOKER_ANDROID_SIGNING_KEY_ALIAS`, `OURPOKER_ANDROID_SIGNING_KEY_PASSWORD` | the APK is signed with a key made for that run |
| `storeCredentials`: `ourpoker-store-credentials` | `OURPOKER_STORE_CREDENTIALS_APP_ID`, `OURPOKER_STORE_CREDENTIALS_BUILD_TOKEN` (the app's id and build token from ourapps.app) | no store call and no iPhone, Mac or Apple TV TestFlight build |

The recipe's `INSTRUCTIONS.md` (part 4, "Repository and releases") has the same table for its version.

## 3. Assemble

Actions, aepm-assemble, "Run workflow", with the recipe `ourpoker@0.7.0`; or `gh workflow run aepm-assemble.yml --repo <owner>/<name> -f recipe=ourpoker@0.7.0`.

It runs `aepm fetch` (checking every archive's sha256 digest and signatures), `aepm design` with `answers.json`, `aepm resolve`, makes the policy from Level N's release and guardian keys (https://ourapps.app/policy/levelnpolicy.json) and the public key of `AEPM_OWNER_KEY`, runs `aepm install` and commits the application to main. A refused design fails the run with the list of what is missing; fix `answers.json` and run it again. It refuses a repository that already holds an assembled application (a `.aepm` folder).

## 4. The workflows the application brings

| Workflow | When | What |
|---|---|---|
| `ci-server` | a push to main or a pull request that changes the server, rules or components; by hand | type check and tests |
| `ci-web` | a push to main or a pull request that changes the web client, server or components; by hand | type check and build, then the server started on the runner and a browser playing a hand against it |
| `ci-android` | a push to main or a pull request that changes the Android app, server or components; by hand | unit tests and the debug build, then the app started in an Android emulator until it shows the room list |
| `platform-packages` | a push to main that changes the Windows app; by hand | the unsigned Windows installer built, installed, started and uninstalled on a Windows runner |
| `apple-builds` | a version tag; by hand | unsigned iPhone and iPad, Mac (Mac Catalyst) and Apple TV builds on a macOS runner |
| `release` | a version tag (`v0.1.0`); ourapps.app asking for a build; by hand | builds the web client, the Android APK and the Windows installer the design has and publishes a GitHub Release with `my-app.json` for ourapps.app |
| `aepm-update` | weekly and by hand | see below |

`ci-web`, `ci-android`, `platform-packages` and `apple-builds` are in the design only when their devices are targets. Start one by hand with Actions, the workflow, "Run workflow"; or `gh workflow run ci-web.yml --repo <owner>/<name>`. To release a version, add its section to `CHANGELOG.md`, then create the tag from a clone (`git tag v0.1.0 && git push origin v0.1.0`) or with `gh api repos/<owner>/<name>/git/refs -f ref=refs/tags/v0.1.0 -f sha="$(gh api repos/<owner>/<name>/commits/main -q .sha)"`.

## 5. Updates

`aepm-update` runs every Monday and by hand (optionally with a version). It designs the newest published recipe version with the answers recorded in `.aepm/definition.json`, has aepm stage it and run the packages' checks, and opens a pull request with the package versions that change. Merging the pull request approves the update with `AEPM_OWNER_KEY`, applies it and commits the result to main. That commit starts no other workflow; start `ci-server`, `ci-web` and `ci-android` by hand after it.

## Limits

- iPhone, iPad, Mac and Apple TV apps build only on macOS runners (`apple-builds`), and those builds are unsigned. TestFlight builds need the `storeCredentials` secrets and the TestFlight set-up on ourapps.app.
- Every run uses the repository owner's GitHub Actions minutes.
- These workflows are checked with actionlint. The browser and Android room-list checks they run were run on a Mac against a local server. `aepm-assemble` is checked with actionlint, and its fetch, design, resolve and install steps were run on a Mac with `ourpoker@0.7.0`.

Copyright Level N Ltd 2026.
