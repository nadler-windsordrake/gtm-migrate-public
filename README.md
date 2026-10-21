# GTM Migrate

GTM Migrate V0.2.3 is a read-only Chrome extension for reviewing Google Tag Manager workspace changes before publishing. Its compact technical interface shows authoritative pending changes, understandable diffs, affected items, blast radius, and deterministic findings. The V0.1 single-tag dependency analyzer and migration-package export remain available.

GTM Migrate never writes to GTM. It does not publish, import, fix, revert, or sync anything.

## Workspace Change Review (V0.2.3)

1. Sign in and choose an account, container, and workspace in the popup.
2. Click **Review workspace changes**. A full extension tab opens so the review is not constrained by popup dimensions.
3. Scan the compact status strip and **Needs review** work queue, which prioritizes medium- and high-impact findings, then inspect **All changes** for the complete inventory.
4. Expand a change row to open its inline inspector with a technical diff, impact, review context, and plain-language findings.
5. Open **Advanced details** when raw API paths, identifiers, dependencies, or full before/after configuration are needed.
6. Click **Export review** to download a schema-versioned JSON report.

Change classifications come from the official read-only `workspaces.getStatus` endpoint, which reports changes since the workspace base version. Published before-state detail comes from `versions:live`. A missing published version is handled as an explicit empty-baseline state rather than an error.

### Implemented deterministic rules

- New Custom HTML tag (`medium`)
- New tag firing through an unfiltered page-view/All Pages trigger (`medium`); combined into one finding when both apply
- Modified trigger blast radius (`low` for 1–2 affected tags, `medium` for 3–5, `high` for 6+)
- Modified variable recursive blast radius using the same thresholds
- Deleted trigger or variable still referenced in the resulting workspace (`high`)
- Unresolved trigger or `{{Variable}}` reference in an added/modified entity (`high`)
- Page-view trigger with all previous conditions removed (`high`)
- Identifier-like measurement/tracking parameter change (`medium`)
- Tag firing-option change (`medium`)
- Consent configuration change (`medium`, or `high` when required consent is removed)

The engine reports evidence and counts, never probabilities or a fabricated aggregate score.

### Interface direction

V0.2.3 uses a dense technical-utility layout: a persistent context toolbar, compact status strip, columnar change queues, line-based diffs, and an inline inspector. The review and toolbar use fluid 24px desktop gutters with a 1680px maximum width so technical data has room without stretching indefinitely on ultrawide screens. Borders and separators carry the hierarchy; production UI uses no gradients, decorative shadows, oversized KPI cards, or pill-shaped filters. Normal copy uses the system UI font, while values, IDs, paths, and raw configuration use the system monospace font.

## Preserved V0.1 tag analysis

- Authenticates with Google through `chrome.identity` using the read-only GTM OAuth scope.
- Lists accessible GTM accounts, containers, and workspaces through the official Tag Manager API v2.
- Fetches tags, triggers, user-defined variables, and enabled built-in variables.
- Resolves firing and blocking triggers.
- Recursively finds `{{Variable Name}}` references in nested objects, arrays, parameters, variables, and resolved triggers.
- Follows variable-to-variable references with cycle protection and deduplication.
- Reports references it cannot confidently resolve instead of guessing.
- Downloads a human-readable, schema-versioned JSON package locally.

OAuth tokens are managed by Chrome, are never manually persisted or logged, and are never included in exports. Fetched GTM configuration is held only in the popup's memory and is cleared when the popup closes or the user signs out.

## Local development

Requirements: Node.js 20+ and a recent Chrome installation.

```bash
npm install
npm run build
```

The unpacked extension is produced in `dist/`. The development Chrome-extension OAuth client ID is configured; follow [GOOGLE_SETUP.md](./GOOGLE_SETUP.md) to load the extension and verify sign-in.

Available commands:

```bash
npm run dev        # Rebuild dist/ whenever source files change
npm run build      # Type-check and create a production build
npm run typecheck  # Run TypeScript only
npm run test       # Run unit tests once
npm run test:watch # Run unit tests in watch mode
npm run lint       # Run ESLint
```

After a source edit, reload the extension from `chrome://extensions`. `npm run dev` rebuilds files but Chrome does not automatically reload unpacked extensions.

## Project structure

```text
public/manifest.json                  Manifest V3 permissions and OAuth configuration
src/auth/googleAuth.ts                Chrome Identity OAuth lifecycle
src/api/gtmClient.ts                  Paginated GTM API v2 client and error mapping
src/types/gtm.ts                      Minimal GTM resource types
src/analysis/dependencyAnalyzer.ts    V0.1 recursive dependency resolver
src/review/changeDetection.ts         Status-driven normalized change detection
src/review/normalization.ts           Canonical normalization and field diffs
src/review/dependencyGraph.ts         Indexed forward/reverse dependency graph
src/review/riskRules.ts               Deterministic explainable rule engine
src/review/presentation.ts            Human labels, impact wording, sorting, and review grouping
src/review/workspaceReview.ts         Review orchestration and summary model
src/review/main.ts                    Full-page review UI
src/fixtures/                         Local manual/test review dataset
src/export/migrationPackage.ts        Versioned package creation and local download
src/export/reviewExport.ts            Schema-v2 workspace review export
src/popup/main.ts                     Popup workflow and state
src/popup/styles.css                  Product UI styling
popup.html                            Accessible popup shell
review.html                           Full workspace-review shell
GOOGLE_SETUP.md                       Exact Google Cloud and Chrome setup
```

## Dependency-analysis behavior

The analyzer is deliberately conservative. It resolves trigger IDs explicitly named in `firingTriggerId` and `blockingTriggerId`. It finds GTM variable syntax in every nested string, matches names exactly against fetched user-defined and enabled built-in variables, and recursively inspects resolved variables and triggers. Repeated references are deduplicated and cycles are stopped.

Missing trigger IDs, unknown `{{...}}` names, and related setup/teardown tag references are placed in `unresolvedReferences`. V0.1 does not infer opaque dependencies hidden inside custom-template code or undocumented tag-type semantics.

## Migration package

Downloads are named like `gtm-migrate-facebook-purchase-tag.json` and contain:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-19T12:00:00.000Z",
  "source": {
    "accountId": "...",
    "containerId": "...",
    "workspaceId": "..."
  },
  "selection": { "tag": {} },
  "dependencies": {
    "triggers": [],
    "variables": [],
    "builtInVariables": [],
    "unresolvedReferences": []
  }
}
```

The trigger entries retain the complete GTM trigger object plus whether it was a firing trigger, blocking trigger, or both. The selected tag and resolved variable objects are likewise preserved for future import work. No OAuth credential is part of this model.

## Test against a GTM Migrate Test container

Use a disposable workspace and do not publish the V0.2.3 test changes. If the container already has equivalent entities, reuse them.

1. Establish a published baseline containing a Constant variable named `Test Value` with value `goodbye`, an unfiltered Page View trigger named `All Pages`, and two tags named `GTM Migrate Test Tag` and `GTM Migrate test tag 2`. Both tags should reference `{{Test Value}}`. Publishing this baseline is a deliberate human action; the extension cannot and will not do it.
2. In the selected test workspace, change `Test Value` from `goodbye` to `danger` and save without publishing.
3. Run `npm run build`, reload GTM Migrate from `chrome://extensions`, open the popup, and select the test account/container/workspace.
4. Click **Review workspace changes**.
5. Confirm the row reads **Test Value**, **Modified**, **Variable**, **Low**, and **2 tags**.
6. Expand it and confirm **Change** shows `Value: goodbye → danger`, **Why this matters** explains that the variable is used by two tags, and **Affected items** lists both tag names once.
7. Confirm **Advanced details** is collapsed by default and contains `parameter[value].value`, the variable ID, dependencies, and raw configuration when opened.
8. Click **Export review** and inspect the JSON. It should have `schemaVersion: 2` and must not contain an OAuth token.

For the elevated-review scenario, add a harmless Custom HTML tag named `New Marketing Script` and configure it to fire on `All Pages`. Confirm **Needs review** prioritizes one Medium finding titled **Custom HTML runs on all pages** with a plain-language explanation.

Both scenarios are represented locally in `src/fixtures/workspaceReviewFixture.ts`; tests exercise them without accessing or changing a real GTM container.

For rendered development QA, run `npx vite --host 127.0.0.1` and open `review.html?fixture=1`, `?fixture=attention`, `?fixture=empty`, or `?fixture=stress`. The stress fixture includes 12 changes, multiple Medium/High findings, seven-item blast radius, and a deliberately long entity name. Fixture code is removed from production builds.

## Development-only GTM data seeder

A separate local seeder can populate a disposable GTM workspace with 12 variables, 10 triggers, 24 baseline tags, realistic dependency relationships, and a second phase of unpublished review changes. It uses a separate Desktop OAuth client and the `tagmanager.edit.containers` scope; the production extension manifest and read-only scope are unchanged.

The commands are dry-run by default and require explicit GTM IDs plus `GTM_SEED_CONFIRM_TEST_ONLY=true`:

```bash
npm run seed:gtm-baseline
npm run seed:gtm-changes
npm run seed:gtm-cleanup
```

Pass `-- --apply` only after reviewing the printed account, container, workspace, and mutation plan. See [DEV_SEEDER_SETUP.md](./DEV_SEEDER_SETUP.md) for the required OAuth setup, safety model, manual publication step, cleanup behavior, and exact workflow.

## Minimal V0.1 tag-export workspace

Create these items in a disposable web container workspace. GTM's current UI calls the former “GA4 Configuration” tag a **Google tag**.

1. In **Variables → New → Variable Configuration → Constant**, name the variable `GA4 Measurement ID` and set a test value such as `G-TEST123456`.
2. In **Triggers → New → Trigger Configuration → Page View**, name the trigger `All Pages`, select **All Page Views**, and save it. A new web container commonly includes this trigger already; reuse it rather than duplicating it.
3. In **Tags → New → Tag Configuration → Google tag**, name the tag `GA4 Configuration` and enter `{{GA4 Measurement ID}}` in **Tag ID**. Select the `All Pages` trigger and save without publishing.
4. Build and load GTM Migrate, select this account/container/workspace, and click **Load tags** under **Tag dependency export**.
5. Select `GA4 Configuration` and click **Analyze dependencies**. The results should contain the `All Pages` firing trigger and `GA4 Measurement ID` user-defined variable.
6. Export the package and inspect the JSON. Keep this test workspace unpublished if the measurement ID is only a placeholder.

## Security and reliability notes

- Only `identity` permission and the `https://tagmanager.googleapis.com/*` host permission are requested.
- The OAuth scope is `https://www.googleapis.com/auth/tagmanager.readonly`; no edit, delete, or publish permission is requested.
- The manifest enforces an extension-only script content security policy. There is no remote executable JavaScript, backend, analytics, or telemetry.
- API list endpoints are fully paginated. Human-readable handling covers authentication expiry, denial, 401/403/404, quota exhaustion, server errors, empty resources, and network failure.
- Development builds log OAuth lifecycle events and error messages to the extension console without logging access tokens; production builds omit these debug logs.
- Production builds omit source maps and local review fixtures; development watch builds retain source maps for debugging.
- Built-in-variable listing tolerates a 404 for container types that do not support built-ins; other failures remain visible.

## Known limitations

- Dependency discovery is schema- and syntax-based; it cannot prove runtime dependencies encoded in arbitrary custom JavaScript, template code, or opaque vendor parameters.
- `workspaces.getStatus` is authoritative for added/updated/deleted classification relative to the GTM workspace base. Before-state field detail uses the published container version, which can differ from an older workspace base in containers with unpublished/latest-version drift.
- The material-broadening rule only fires for a page-view trigger that had conditions and now has none. Other filter edits are not classified as broader because GTM condition semantics are too varied for a reliable general heuristic.
- Measurement-identifier detection is limited to explicit identifier-like parameter keys and recognizable Google measurement ID formats. It does not inspect arbitrary executable code.
- Reverse dependencies cover documented trigger IDs and GTM `{{Variable Name}}` references. Custom-template internals and opaque vendor schemas can hide additional runtime coupling.
- Only the selected tag is exported. Setup/teardown tag references are reported unresolved rather than recursively exporting other tags.
- Enabled built-in variables are resolved by exact display name. A disabled or API-omitted built-in reference remains unresolved.
- Export packages are not yet validated for importability, because import is intentionally out of scope.
- Automated tests use local fixtures and mocked read-only API responses. Final live accuracy depends on the GTM API data returned for the selected container type.

## Future direction (not implemented)

Potential V0.3 work should be chosen only after validating the review workflow with real containers. Candidates include deeper template-aware dependency metadata and comparison against an explicitly selected historical version. No V0.3 functionality is included here.

## References

- [Tag Manager API v2 reference](https://developers.google.com/tag-platform/tag-manager/api/reference/rest)
- [Workspace status method](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces/getStatus)
- [Published container version method](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.versions/live)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Chrome manifest OAuth configuration](https://developer.chrome.com/docs/extensions/reference/manifest/oauth2)

## License

Private project; no public license is granted.
