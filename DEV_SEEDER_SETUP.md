# GTM development seeder setup

The GTM seeder is a local development tool for disposable test workspaces. It is not imported by the extension, is not included in the Vite entry points, and uses credentials that are completely separate from the Chrome extension OAuth client.

The extension remains read-only. The seeder requests only:

```text
https://www.googleapis.com/auth/tagmanager.edit.containers
```

It does not request `tagmanager.publish`, does not create container versions, and never publishes a container.

## 1. Prepare a disposable GTM target

1. Create or choose a GTM account and Web container used only for development.
2. Create a workspace dedicated to seeder testing.
3. Confirm your Google user has permission to edit that container.
4. Copy the numeric account, container, and workspace IDs from their GTM URLs or API paths.
5. Never point the seeder at a production container. Every seeded entity is prefixed with `[GTM MIGRATE TEST]`, but the explicit test-only target remains the primary safety boundary.

## 2. Create separate development OAuth credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a development-only Google Cloud project.
3. Open **APIs & Services → Library**, search for **Tag Manager API**, and enable it.
4. Open **APIs & Services → OAuth consent screen** and configure the consent screen.
5. If the app is in Testing status, add your Google account as a test user.
6. Open **APIs & Services → Credentials**.
7. Click **Create credentials → OAuth client ID**.
8. Choose **Desktop app**. Do not reuse the Chrome extension OAuth client.
9. Download the client JSON.
10. Create a local `.gtm-seeder` directory in this repository and save the file as:

```text
.gtm-seeder/oauth-client.json
```

The credentials and generated refresh token are ignored by Git. The token is written to `.gtm-seeder/token.json` with user-only file permissions. Never commit either file.

## 3. Configure the explicit target

Set these variables in the terminal where you will run the seeder:

```bash
export GTM_SEED_CONFIRM_TEST_ONLY=true
export GTM_ACCOUNT_ID="1234567890"
export GTM_CONTAINER_ID="98765432"
export GTM_WORKSPACE_ID="7"
```

Optional non-default local paths:

```bash
export GTM_SEED_OAUTH_CREDENTIALS="/absolute/path/to/oauth-client.json"
export GTM_SEED_TOKEN_PATH="/absolute/path/to/token.json"
```

The seeder refuses to run without all three IDs and the exact `GTM_SEED_CONFIRM_TEST_ONLY=true` value. It never selects an account, container, or workspace automatically.

## 4. Seed and publish the baseline

Dry-run is the default. It reads the selected workspace, prints the resolved account/container/workspace names, and reports what would change without sending create, update, or delete requests:

```bash
npm run seed:gtm-baseline
```

The first run opens Google OAuth in a browser. Confirm that the consent screen requests only **Manage your Google Tag Manager containers** (`tagmanager.edit.containers`). Tokens are never printed.

After checking the displayed target and plan, apply the baseline:

```bash
npm run seed:gtm-baseline -- --apply
```

The baseline creates or updates exactly 12 user-defined variables, 10 triggers, and 24 tags. The operation is name-based and safe to rerun: matching prefixed entities are updated or left unchanged rather than duplicated.

If an apply is interrupted or GTM rejects a later entity, successful earlier requests remain in the workspace because the API has no transaction rollback. Fix the reported payload, run the dry-run again, and then rerun the baseline apply. The seeder resolves its exact prefixed names before each phase, so it reuses or updates partial resources and creates only those still missing; it does not duplicate them.

The GTM API allows only 0.25 requests per second per project, enforced as 25 requests in a rolling 100-second window. Every seeder read and write therefore uses one shared scheduler with a conservative five-second start-to-start interval (20 requests per 100 seconds). A fresh baseline normally uses six planning/identity reads plus 46 writes and takes approximately 4 minutes 15 seconds before network latency. Partial retries are faster because only missing or changed entities are mutated. The apply command prints its reconciled mutation count, estimated minimum mutation time, and per-entity progress before writing.

HTTP 429, quota-related HTTP 403, HTTP 500/502/503/504, and transient network failures are retried up to five times with 1, 2, 4, 8, and 16-second exponential delays plus up to 25% jitter. Retry attempts still pass through the shared five-second scheduler, and a longer `Retry-After` response is honored. HTTP 400 and other non-retryable errors stop immediately.

Review the workspace in GTM. Then publish the baseline manually in the GTM user interface. Publication is intentionally outside this tool because it requires a separate publish scope and is consequential.

Publishing can change or replace the active workspace. After publishing, open the workspace that will hold the unpublished test changes, copy its current workspace ID, and update `GTM_WORKSPACE_ID` before continuing.

## 5. Seed unpublished changes

Preview the changes phase:

```bash
npm run seed:gtm-changes
```

Apply it only after verifying the target:

```bash
npm run seed:gtm-changes -- --apply
```

The changes phase refuses to mutate anything unless all baseline entities are present and the workspace status no longer contains unpublished baseline seeder changes. It then creates realistic unpublished review data:

- changes the shared tracking identifier with 8+ downstream dependencies;
- modifies a purchase trigger used by seven tags;
- adds a Custom HTML tag firing on All Pages;
- changes a tag from once-per-event to once-per-load;
- removes a seeded tag's manual consent requirement;
- broadens a checkout tag from a narrow page trigger to All Pages.

## 6. Verify in GTM Migrate

1. Run `npm run build` and reload `dist` from `chrome://extensions`.
2. Open GTM Migrate and select the same account, container, and unpublished workspace.
3. Click **Review workspace changes**.
4. Confirm the review includes the shared-variable and shared-trigger blast radii, identifier changes, Custom HTML/All Pages finding, firing-option change, consent change, and broadened firing coverage.
5. Expand rows to inspect variable chains, trigger relationships, and raw GTM configuration.
6. Do not publish the changes workspace unless you deliberately want those test changes to become the next baseline.

## 7. Cleanup

Cleanup only selects tags, triggers, and variables whose names begin with the exact `[GTM MIGRATE TEST] ` prefix and whose API paths belong to the configured workspace. It deletes tags first, then triggers, then variables. It never deletes containers, workspaces, unprefixed resources, or resources from another workspace.

Preview cleanup:

```bash
npm run seed:gtm-cleanup
```

Apply cleanup:

```bash
npm run seed:gtm-cleanup -- --apply
```

If the baseline was already published, cleanup creates unpublished deletion changes in the selected workspace. Whether those deletions should be published is a separate manual decision.

## GTM API limitations and deliberate omissions

- The Tag Manager API has no test transaction: a successful create/update/delete request immediately changes the selected workspace, so dry-run plus explicit `--apply` is used instead.
- The seeder does not call `workspaces.create_version` or any publish method. The baseline must be published manually.
- Circular variable references and intentionally missing variable references are not seeded live. GTM can reject invalid or unresolved configurations, and acceptance can vary by entity type. Those analyzer cases remain deterministic local unit fixtures instead.
- Built-in variable references such as `Page Path` and the internal event value are used by trigger conditions but are not modified by cleanup.
- GTM may normalize or add default fields to API resources. The seeder compares the fields it owns and uses API fingerprints when updating existing resources.

## Troubleshooting

- **OAuth denied or expired:** delete `.gtm-seeder/token.json` and rerun the command.
- **403:** confirm the Tag Manager API is enabled, the Desktop client consent screen includes your test user, and your Google user can edit the selected GTM container.
- **404:** recheck all three IDs, especially `GTM_WORKSPACE_ID` after publishing.
- **Changes phase reports missing baseline entities:** select the workspace based on the manually published baseline or run the baseline phase in the intended test workspace first.
- **Vendor-template parameter validation:** rerun with the latest seeder code. API payloads are compacted to omit optional empty strings, and all generated variable, trigger, and tag payloads are validated locally before the first mutation.
- **Browser does not open:** copy the authorization URL printed by the script into a browser on the same computer; the loopback callback expires after five minutes.
