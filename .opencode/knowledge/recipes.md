# Recipe library and component catalogue

Authority for formats: `../../../.opencode/knowledge/component-standard.md` (recipe.json, suitability.json, migration.json) and the paper's Sections 2.4, 3.9, 3.10. What a recipe or component repository implements: `CONTRACT.md`. Routes for agents: `site/public/agents.md`.

## Storage

Migration `worker/migrations/0019_recipes_components.sql` creates the catalogue tables with owner, deprecation and dependency columns and the search index. D1 holds entries and pointers; the package stays in the publisher's GitHub release and no column holds archive bytes.

- `components`, `recipes`: one row per name (`scope/slug`, `slug` unique across scopes because routes use the short name), owning `developer_id` (NULL once the developer deleted the account), the one `repo`, `latest_version` (newest listed, NULL when none), and the flag `deprecated_at`, `deprecated_reason` (`owner-deprecated` or `owner-deleted`), `replacement` (a name or NULL). CHECKs: `deprecated_at` and `deprecated_reason` are set together; a NULL owner needs `owner-deleted`, so a developer row cannot be deleted while it owns an unflagged entry.
- `component_versions`, `recipe_versions`: one row per version, never deleted by unlisting (`unlisted_at`). JSON text columns: tags, targets, guardians, provides, requires, dependencies, suitability, migration; `recipe_versions.recipe` is the validated recipe.json. Release pointer: `source_repo`, `source_tag`, `bundle_asset`, `bundle_digest`; package fingerprint: `digest`.
- `component_interfaces`: provides/requires rows for filtering by interface type. `component_dependencies`: the `{name, version}` each component version builds on. `recipe_components`: components each recipe version names, for "used by" and the deprecation tree.
- `catalogue_fts` (FTS5; `kind`, `entry_id` unindexed; `name, title, summary, tags, description`): one row per entry holding its newest listed version. It is rewritten with the entry in the same batch (`refreshStatements` in `worker/src/catalogue-db.ts`). Developer deletion keeps entries and their search rows (`deleteDeveloper` in `worker/src/db.ts` flags and un-owns them in the same batch as the delete); entries are removed only through `CatalogueDb`.

## Code

- `shared/src/catalogue.ts`: `validateRecipe(input, context?)`, `validateRecipeEntry`, `validateComponentEntry`, `validateSuitability`, `summariseMigration`, name/version/digest/path rules, `isSafeSvg`, the `Condition` type with `describeCondition`, aepm's string grammars (`GRAMMARS`, `matchesGrammar`). `catalogue-views.ts`: public response types. `catalogue-example.ts`: invented example (acme/poker-night, acme/card-deck) for tests and docs.
- `worker/src/catalogue-db.ts` (queries, `ftsQuery`), `worker/src/routes/catalogue.ts` (reads, publishing, unlisting, text/JSON variants, sitemap), `worker/src/catalogue-text.ts` (plain-text pages). Routing in `worker/src/index.ts`: `/api/recipes*`, `/api/components*`, `/api/dev/{recipes,components}*`, and the non-API paths `/recipes.txt|json`, `/recipes/<name>.txt|json`, `/components...`, `/sitemap.xml` before the asset fallthrough.
- `site/src/pages/library.ts` (`/recipes`, `/recipes/:name`, `/components`, `/components/:name`), pure helpers in `site/src/library.ts`, paths in `site/src/router.ts`.

## Recipe validation

The authority is the "Recipe evaluation rules" section of `../../../.opencode/knowledge/component-standard.md`; `validateRecipe` enforces the parts that need no answers.

- Instance ids: `application` (`APPLICATION_INSTANCE`) is the recipe's own component. It is valid in `connections` and as a `sets` target instance; a component whose id or name is `application` is refused. Every other endpoint or target names a component id of the recipe.
- Conditions (`askWhen`, `includedWhen`, a job candidate's `includedWhen`): equals, in, contains (set questions only), truthy, all, any, not; at most 8 levels deep. Values are checked against the question's type and options. A question's `askWhen` may not lead back to itself, and a question with `askWhen` needs a `default` (a secretRef question excepted).
- Effects: only `sets`; a component is included only through its `includedWhen`.
- `sets` values: literal, `"$answer"`, `{map}` (choice question, every option mapped), `{fromScale}` (recipe needs a scale), `{template}` (only `{{answer}}`, single-answer question), `{ref}` (names a secretRef question). `"$answer"` on a secretRef question and any other `$` string are refused. Targets resolve by the longest component id that prefixes `<id>.<setting>`.
- Conflicts (`checkConflicts`): two questions, or two effects of one question, set one target to different values. Literals and `fromScale` of equal value are the same; answer-dependent forms of different questions never are. Two questions are exclusive only when `confinements` finds one question that their `askWhen` conditions confine to disjoint `equals`/`in` values (through `all` as intersection and `any` as union); `contains`, `truthy` and `not` confine nothing.
- Scale: `scale.question` is a choice question and each of its options is a band id. A job's `overrideQuestion` is a choice or text question.
- `RecipeContext` (second argument): `settings` by component name (`application` for the recipe's own component) and `profiles` by component name. When present, `sets` targets must be declared settings, literals and `"$answer"` must fit each setting's type and grammar, a secret setting takes only `ref`, `components[].configuration` is checked the same way, job candidate profiles must exist and their `settings` must fit. What the context lacks is accepted unchecked. The publishing route passes no context.
- Component entries: a `requires` entry may carry `optional: true` (kept only when true); `provides` entries may not. Suitability profiles may carry `settings`.
- File check with component data: `npm run validate-recipe -- <recipe.json> [--components <dir>] [--no-components]` (`scripts/validate-recipe-file.ts`; bundles `shared/src/catalogue.ts` with esbuild, reads `<dir>/*/component.json` `collect` and `suitability.json`, and the recipe folder's own `component.json` for `application`). Exit 0 valid, 1 errors, 2 unreadable.

## Deprecation and orphaning

- The flag is on the name and covers every version. `status`: `active`; `deprecated` (owner set it, reversible with `POST /api/dev/{recipes,components}/:name/{deprecate,undeprecate}`, optional `replacement` naming a published entry of the same kind); `orphaned` (owner NULL, `owner-deleted`, `since` is the deletion time, permanent, nobody can change it or publish to the name).
- `CatalogueDb.deprecationsFor` resolves one version's tree with a recursive query (recipe: `recipe_components`; component: `component_dependencies`, followed to depth 8) and merges duplicates into `Deprecation` elements `{name, version, status, reason, since, replacement?, via}`. It runs batched for list and search pages. Every summary, view, `.txt`, `.json` and bundle response carries `deprecations`; `.txt` lines start `DEPRECATION WARNING:`; `GET /api/{recipes,components}/:name/:version/deprecations` returns `{name, version, status, affected, checked, deprecations}`.
- `deprecated=exclude|include|only` (default `include`) filters lists and search on the entry's own flag only. A recipe that uses a flagged component is `active` with a non-empty `deprecations`.
- The component entry's optional `dependencies` (`{name, version}`, at most 50) is the only link from a component to other components; component.json `dependencies` must be sent by the publishing tool.
- Orphaned bundle: `releaseAsset` in `routes/catalogue.ts` reads the release with no token; a public release returns a `/dl/` link whose payload `dev` is empty (`serveArtefact` then sends no token); a 404 release or missing asset returns `status: "bundle-unavailable"` (200, `url` null). GitHub errors other than 404 are 502. `fetchUpstream` asks `api.github.com` for the raw asset (`Accept: application/octet-stream`) with or without a token.
- Site: `deprecationBanner` and `statusPill` in `site/src/pages/library.ts`, `deprecated` filter in `site/src/library.ts`. Terms version bumps with the account-deletion wording.

## Rules

- A name's scope equals its repository owner (lowercase). A name belongs to its first developer and repository; another developer gets 409. Publishing needs no approval and no guardian and has no queue; the per-developer limits below apply.
- A version is bound to its digest: same version, same digest is a no-op (200), same version with another digest is 409. Unlisted versions keep their digest and are listed again by publishing them again.
- Publishing checks with the publisher's saved GitHub token that the token can push to the repository and that release `source.tag` holds `bundle.asset` (GitHub's `digest` field for the asset must equal `bundle.digest` when GitHub gives one). Without a saved token: 409.
- Bundle route (`/api/{recipes,components}/:name/:version/bundle`) re-reads the release with the publisher's token and returns a `/dl/` link of kind `bundle` (`worker/src/links.ts`, `serveArtefact`). The asset address and token never appear in a response.
- Public responses carry the publisher's slug and display name only. `SECRET_PATTERN` in `routes/catalogue.ts` refuses private key blocks, GitHub tokens, ourapps API keys and AWS key identifiers in an entry.
- Diagrams are checked by `isSafeSvg`, stored in D1, served from `/api/recipes/:name/:version/diagram.svg` with a sandboxing Content Security Policy, shown through `<img>`.
- Short names are unique across scopes. Scoped URLs (`/recipes/<scope>/<name>`) are to be revisited after collaborators have reviewed the library (George's decision).
- Limits: 50 recipes, 200 components per developer; 200 versions per name; recipe.json 200,000 characters.
- `/recipes`, `/components` and `sitemap.xml` are in `RESERVED_SLUGS` (`worker/src/auth.ts`); the site router tests path shape with `isCatalogueSlug`, so `search` is not a name.
- Public wording (terms, footer, guide) says the library and catalogue are public and share links are private; any change to the terms text bumps `TERMS_VERSION`.

## Tests

`shared/src/catalogue.test.ts`, `shared/test/validate-recipe-file.test.mjs` (runs the script), `worker/test/catalogue.test.ts` (GitHub stubbed with `fakeFetch`; D1 is the real test database with migrations applied), `site/src/library.test.ts`, `site/src/pages/library.test.ts`, `site/src/router.test.ts`.
