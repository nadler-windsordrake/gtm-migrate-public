import { describe, expect, it } from "vitest";
import { createMigrationPackage, sanitizeFilename } from "./migrationPackage";

describe("migration package", () => {
  it("creates a stable versioned package without credentials", () => {
    const result = createMigrationPackage(
      { tagId: "1", name: "Facebook Purchase Tag" },
      { triggers: [], variables: [], builtInVariables: [], unresolvedReferences: [] },
      { accountId: "a", containerId: "c", workspaceId: "w" },
      new Date("2026-01-02T03:04:05.000Z"),
    );
    expect(result).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-01-02T03:04:05.000Z",
      source: { accountId: "a", containerId: "c", workspaceId: "w" },
      selection: { tag: { tagId: "1", name: "Facebook Purchase Tag" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/token|secret/i);
  });

  it("sanitizes unsafe and empty filenames", () => {
    expect(sanitizeFilename("  Café / Purchase: 2026!  ")).toBe("cafe-purchase-2026");
    expect(sanitizeFilename("💫")).toBe("tag");
  });
});
