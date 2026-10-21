import path from "node:path";
import type { SeederConfig } from "./types";

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function requiredId(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required. The seeder never chooses a GTM target automatically.`);
  if (!ID_PATTERN.test(value)) throw new Error(`${name} must be a GTM identifier without spaces or path separators.`);
  return value;
}

export function parseSeederConfig(
  environment: NodeJS.ProcessEnv,
  argumentsToParse: string[],
  workingDirectory = process.cwd(),
): SeederConfig {
  if (environment.GTM_SEED_CONFIRM_TEST_ONLY !== "true") {
    throw new Error("Refusing to run: set GTM_SEED_CONFIRM_TEST_ONLY=true for a disposable test workspace.");
  }
  const knownFlags = new Set(["--apply", "--dry-run"]);
  const unknown = argumentsToParse.filter((argument) => argument.startsWith("--") && !knownFlags.has(argument));
  if (unknown.length) throw new Error(`Unknown seeder option: ${unknown.join(", ")}`);
  if (argumentsToParse.includes("--apply") && argumentsToParse.includes("--dry-run")) {
    throw new Error("Choose either --apply or --dry-run, not both.");
  }
  const localDirectory = path.resolve(workingDirectory, ".gtm-seeder");
  return {
    accountId: requiredId(environment, "GTM_ACCOUNT_ID"),
    containerId: requiredId(environment, "GTM_CONTAINER_ID"),
    workspaceId: requiredId(environment, "GTM_WORKSPACE_ID"),
    credentialsPath: path.resolve(environment.GTM_SEED_OAUTH_CREDENTIALS ?? path.join(localDirectory, "oauth-client.json")),
    tokenPath: path.resolve(environment.GTM_SEED_TOKEN_PATH ?? path.join(localDirectory, "token.json")),
    dryRun: !argumentsToParse.includes("--apply"),
  };
}

export function workspacePath(config: Pick<SeederConfig, "accountId" | "containerId" | "workspaceId">): string {
  return `accounts/${config.accountId}/containers/${config.containerId}/workspaces/${config.workspaceId}`;
}
