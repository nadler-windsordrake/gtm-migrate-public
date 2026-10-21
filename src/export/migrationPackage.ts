import type { DependencyAnalysis } from "../analysis/dependencyAnalyzer";
import type { GtmTag } from "../types/gtm";

export interface MigrationSource {
  accountId: string;
  containerId: string;
  workspaceId: string;
  accountName?: string;
  containerName?: string;
  workspaceName?: string;
}

export interface MigrationPackage {
  schemaVersion: 1;
  exportedAt: string;
  source: MigrationSource;
  selection: { tag: GtmTag };
  dependencies: DependencyAnalysis;
}

export function createMigrationPackage(
  tag: GtmTag,
  dependencies: DependencyAnalysis,
  source: MigrationSource,
  exportedAt = new Date(),
): MigrationPackage {
  return {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    source,
    selection: { tag },
    dependencies,
  };
}

export function sanitizeFilename(name: string): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe || "tag";
}

export function downloadMigrationPackage(migrationPackage: MigrationPackage): void {
  const filename = `gtm-migrate-${sanitizeFilename(migrationPackage.selection.tag.name)}.json`;
  const blob = new Blob([`${JSON.stringify(migrationPackage, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
