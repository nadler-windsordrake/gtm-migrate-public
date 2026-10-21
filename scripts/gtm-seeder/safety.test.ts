import { describe, expect, it } from "vitest";
import { parseSeederConfig, workspacePath } from "./safety";

const validEnvironment = {
  GTM_SEED_CONFIRM_TEST_ONLY: "true",
  GTM_ACCOUNT_ID: "123",
  GTM_CONTAINER_ID: "456",
  GTM_WORKSPACE_ID: "7",
};

describe("GTM seeder safety guards", () => {
  it("requires explicit test-only confirmation", () => {
    expect(() => parseSeederConfig({ ...validEnvironment, GTM_SEED_CONFIRM_TEST_ONLY: undefined }, [], "/repo")).toThrow(
      "GTM_SEED_CONFIRM_TEST_ONLY=true",
    );
  });

  it.each(["GTM_ACCOUNT_ID", "GTM_CONTAINER_ID", "GTM_WORKSPACE_ID"])("requires %s", (key) => {
    expect(() => parseSeederConfig({ ...validEnvironment, [key]: undefined }, [], "/repo")).toThrow(`${key} is required`);
  });

  it("defaults to dry-run and requires an explicit apply flag", () => {
    expect(parseSeederConfig(validEnvironment, [], "/repo").dryRun).toBe(true);
    expect(parseSeederConfig(validEnvironment, ["--dry-run"], "/repo").dryRun).toBe(true);
    expect(parseSeederConfig(validEnvironment, ["--apply"], "/repo").dryRun).toBe(false);
  });

  it("rejects ambiguous or unknown flags", () => {
    expect(() => parseSeederConfig(validEnvironment, ["--apply", "--dry-run"], "/repo")).toThrow("either --apply or --dry-run");
    expect(() => parseSeederConfig(validEnvironment, ["--force"], "/repo")).toThrow("Unknown seeder option");
  });

  it("constructs only the explicitly configured workspace path", () => {
    const config = parseSeederConfig(validEnvironment, [], "/repo");
    expect(workspacePath(config)).toBe("accounts/123/containers/456/workspaces/7");
    expect(config.credentialsPath).toBe("/repo/.gtm-seeder/oauth-client.json");
    expect(config.tokenPath).toBe("/repo/.gtm-seeder/token.json");
  });
});
