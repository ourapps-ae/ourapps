# Catalogue package foundations

Copyright Level N Ltd 2026

## Publication fields

The publisher calls `aepm.bundle.read_archive(reference, archive_bytes)` and derives fields from the returned canonical manifest and verified payloads. Both publication bodies require `foundations`. Worker validation establishes declared metadata consistency; it does not establish archive or execution evidence.

| Publication field | Validated package source |
| --- | --- |
| `foundations.licence` | `manifest.identity.licence`, unchanged expression string |
| `foundations.platforms` | `manifest.platforms` |
| `foundations.classes` | `manifest.classes`, complete inline descriptors and exact references |
| `foundations.implements` | `manifest.implements` |
| `foundations.upstream` | `manifest.upstream`, including notices and delivery inventories/locks |
| `foundations.compatibility` | `manifest.compatibility` |
| `foundations.maintenance` | `manifest.maintenance` |
| `foundations.files` | `manifest.files`, each `{path,executable}` |
| `foundations.artefacts` | `manifest.artefacts`, each `{source,destination,template,executable}` with any `component` or `withoutComponent` slot condition retained |
| Component `name`, `version` | `manifest.identity.name`, `manifest.identity.version` |
| `digest`, `bundle.digest` | Validated archive reference digest with `sha256:` prefix |
| Component `provides`, `requires` | Manifest ports projected to `{id,type,version}`; requirements retain `optional:true` |
| Component `settings` | Each `manifest.collect` declaration projected to `{id,type,grammar,required,secret,hasDefault}`; `hasDefault` is key presence of `default` |
| Component `interfaceDigests` | Provided document bytes keyed by `type@version`, hashed with `sha256:` prefix |
| Component `interfaceModules` | Provided document module declarations keyed by `type@version`, with each platform's `{path,installed}` computed from artefact destinations |
| Component `dependencies` | Manifest dependency names and exact versions |
| Component `suitability`, `migration` | Packaged suitability document and migration summary |
| Recipe `recipe` | Packaged `recipe.json` |
| Recipe `page` | Packaged description text, safe diagram text and screenshot addresses |
| `source`, `bundle.asset` | Publisher release repository/tag and validated archive asset name |

Component publication keys are `format,name,version,digest,description,category,tags,targets,guardians,provides,requires,settings,interfaceDigests,interfaceModules,dependencies,suitability,migration,source,bundle,foundations`. Recipe publication keys are `format,recipe,digest,source,bundle,page,foundations`. Catalogue titles, descriptions, categories, tags, guardian names and release pointers are publisher-provided presentation facts. `format` is `1`.

## Class schema example

This descriptor and its digest-bound reference are independent of any preferred implementation:

```json
{
  "reference": {"name":"ourapps-ae/counter-class","version":"1.0.0","digest":"6a64a8ced4936b20db0cf0e54193b361e5922f8f013a71ab7ea885ffe3e8085d"},
  "descriptor": {
    "format":1,"name":"ourapps-ae/counter-class","version":"1.0.0",
    "provides":[{"type":"counter","version":"1.0.0","path":"classes/counter/interface.json","modules":{"web":["counter.mjs"],"server":["counter.mjs"]}}],
    "requires":[],
    "settings":{"type":"object","properties":{},"required":[],"additionalProperties":false},
    "inventory":[
      {"path":"classes/counter/interface.json","digest":"316538fd92c18f09d76df05de128d1099d00d7cfbf34401f82b1bd56989ba0d2"},
      {"path":"classes/counter/check.mjs","digest":"7b6a4b0a9ba601c7c2f058f62d46b4d349c8010bd6c3f9f5d28b762209735770"}
    ],
    "verification":[{"id":"behaviour","root":"package","argv":["node","classes/counter/check.mjs"],"cwd":".","prepare":[],"tools":{"node":"26"},"fixtures":["classes/counter/check.mjs"],"locks":[],"network":false,"timeoutSeconds":30,"expectedExit":0,"scope":"required-local","requirements":[]}]
  }
}
```

A slot uses only `class:{name,version,digest}`. Both the recipe authority and candidate carry that class entry in `foundations.classes`; the candidate lists its reference in `foundations.implements`. The descriptor digest is SHA-256 of RFC 8785 canonical bytes, without a prefix. Archive digests and descriptive `interfaceDigests` use a `sha256:` prefix. Independent class files must occur in the package file list. Shared behaviour suites and module declarations are visible on the package page; they are declarations of checks, not execution results.

## Provenance and compatibility

Wrapper licence expressions and upstream licence expressions are separate. Upstream records require name, exact upstream version, source revision, repository, package URL, licence, notices and delivery. Original packages declare `upstream:[]`. Maven and bundled Gradle wrapper source revisions may be explicit null.

- Bundled delivery: `{kind:"bundled",files:[{path,digest}]}`, optionally `gradleWrapper:{jar,properties,distribution:{url,digest}}`. Wrapper jar and properties belong to the same inventory.
- npm build-time delivery: `{kind:"build-time",manager:"npm",lock,digest,packagePath,integrity}`; `packagePath` is the exact nested or scoped package-lock entry.
- Swift build-time delivery: `{kind:"build-time",manager:"swift",lock,digest}`; upstream revision is an exact lowercase 40- or 64-character Git revision.
- Gradle build-time delivery: `{kind:"build-time",manager:"gradle",lock,digest,verification:{path,digest},configurations,artifacts:[{name,digest}]}`.

Compatibility requires `runtimes`, `frameworks`, `dependencies` and `styles`. Ranges are space-separated comparisons against exact three-integer versions. Runtime and framework-role range intersections must be nonempty; framework names agree within each role. Shared dependency versions must be identical. Isolated dependency versions may differ. Styles declare `scope`, `namespaces` and `conflicts`; overlapping global namespaces and either side's declared conflicts are rejected.

## Evidence and selection

Version responses contain `foundationEvidence:"publisher-declared"` and `lastSuccessfulVerification:null`. The Worker has no signed-review trust-policy verifier. Publisher dates, named guardians, suite declarations and archive release metadata cannot populate successful verification time.

Publication validates independent class digests, declared inputs and individual candidate fit. It checks graph conflicts between the recipe and each candidate, and among unconditional non-job preferred slots. It does not combine all conditional alternatives into one graph. aepm evaluates actual answers, chooses job candidates, retains `server` when declared, checks the selected graph and verifies archive bytes and signed review evidence.

The source-file validator reads the recipe's own `component.json`, component manifests and class inventory bytes. It checks inventory hashes, nonempty upstream notices, bundled file hashes and lock hashes. npm and Swift pins and Gradle lock configurations are checked locally; full Gradle verification metadata and wrapper-properties byte validation remain in aepm.
