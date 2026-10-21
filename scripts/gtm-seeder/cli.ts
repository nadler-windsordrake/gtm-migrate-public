import process from "node:process";
import { createAccessTokenProvider } from "./auth";
import { GtmSeederApiClient } from "./client";
import { runBaseline, runChanges, runCleanup } from "./operations";
import { GTM_REQUEST_INTERVAL_MS, GtmRequestScheduler } from "./rateLimiter";
import { parseSeederConfig } from "./safety";
import type { MutationCount, SeederRunOptions, SeederSummary, WorkspaceIdentity } from "./types";
import { GTM_WRITE_SCOPE } from "./types";

type SeederCommand = "baseline" | "changes" | "cleanup";

function countLine(label: string, count: MutationCount): string {
  return `${label}: ${count.created} created, ${count.updated} updated, ${count.deleted} deleted, ${count.unchanged} unchanged`;
}

function printIdentity(identity: WorkspaceIdentity, dryRun: boolean): void {
  console.log("\nSelected GTM test target:");
  console.log(`  Account:   ${identity.accountName} (${identity.accountId})`);
  console.log(`  Container: ${identity.containerName} (${identity.containerId})`);
  console.log(`  Workspace: ${identity.workspaceName} (${identity.workspaceId})`);
  console.log(`  Mode:      ${dryRun ? "DRY RUN — no mutations" : "APPLY — mutations enabled"}`);
}

function printSummary(summary: SeederSummary): void {
  console.log(`\n${summary.mode.toUpperCase()} ${summary.dryRun ? "dry-run plan" : "result"}`);
  console.log(countLine("Variables", summary.variables));
  console.log(countLine("Triggers", summary.triggers));
  console.log(countLine("Tags", summary.tags));
  if (summary.dependencyRelationships.length) {
    console.log("Dependency relationships:");
    summary.dependencyRelationships.forEach((item) => console.log(`  - ${item}`));
  }
  console.log("Expected review findings:");
  summary.expectedRiskFindings.forEach((item) => console.log(`  - ${item}`));
  if (summary.expectedBlastRadius.length) {
    console.log("Expected blast radius:");
    summary.expectedBlastRadius.forEach((item) => console.log(`  - ${item}`));
  }
}

function mutationTotal(summary: SeederSummary): number {
  return summary.variables.created + summary.variables.updated + summary.variables.deleted +
    summary.triggers.created + summary.triggers.updated + summary.triggers.deleted +
    summary.tags.created + summary.tags.updated + summary.tags.deleted;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function main(): Promise<void> {
  const command = process.argv[2] as SeederCommand | undefined;
  if (!command || !(["baseline", "changes", "cleanup"] as const).includes(command)) {
    throw new Error("Seeder command must be baseline, changes, or cleanup.");
  }
  const config = parseSeederConfig(process.env, process.argv.slice(3));
  console.log("GTM Migrate development seeder");
  console.log(`Requested target IDs: account=${config.accountId}, container=${config.containerId}, workspace=${config.workspaceId}`);
  console.log(`Development OAuth scope: ${GTM_WRITE_SCOPE}`);
  console.log(`GTM API request spacing: ${(GTM_REQUEST_INTERVAL_MS / 1_000).toFixed(1)} seconds`);
  console.log(config.dryRun ? "Dry-run is the default. Pass --apply only after reviewing this target." : "Explicit --apply confirmation received.");

  const tokenProvider = await createAccessTokenProvider(config);
  const scheduler = new GtmRequestScheduler({
    onWait: (milliseconds, label) =>
      console.log(`Waiting for GTM API rate limit (${(milliseconds / 1_000).toFixed(1)}s): ${label}`),
  });
  const api = new GtmSeederApiClient(config, tokenProvider, {
    scheduler,
    onRetry: (message) => console.warn(message),
  });
  const identity = await api.getWorkspaceIdentity();
  printIdentity(identity, config.dryRun);
  const runOptions: SeederRunOptions = {
    onPlan: (plan) => {
      if (config.dryRun) return;
      const mutations = mutationTotal(plan);
      console.log(`\nPlanned API mutations: ${mutations}`);
      console.log(
        `Approximate minimum mutation runtime at ${(GTM_REQUEST_INTERVAL_MS / 1_000).toFixed(1)}s/request: ${formatDuration(mutations * GTM_REQUEST_INTERVAL_MS)} plus network and retry time.`,
      );
    },
    onProgress: ({ current, total, action, kind, name }) =>
      console.log(`[${current}/${total}] ${action} ${kind}: ${name}`),
  };
  const summary =
    command === "baseline"
      ? await runBaseline(api, config.dryRun, runOptions)
      : command === "changes"
        ? await runChanges(api, config.dryRun, runOptions)
        : await runCleanup(api, identity.workspacePath, config.dryRun, runOptions);
  printSummary(summary);
  if (command === "baseline" && !config.dryRun) {
    console.log("\nBaseline seeded. Review it in GTM, then publish it manually. This tool does not request the publish scope.");
    console.log("After publishing, confirm the active workspace ID and update GTM_WORKSPACE_ID before running the changes phase.");
  }
}

main().catch((error: unknown) => {
  console.error(`\nSeeder stopped: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
