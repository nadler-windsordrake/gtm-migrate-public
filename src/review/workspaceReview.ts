import { buildDependencyGraph, directDependencies, directDependents, transitiveDependents } from "./dependencyGraph";
import { detectWorkspaceChanges } from "./changeDetection";
import { evaluateRiskRules } from "./riskRules";
import type { EntityImpact, EntityReference, Severity, WorkspaceReview, WorkspaceReviewInput } from "./model";

const SEVERITY_ORDER: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };

export function createWorkspaceReview(input: WorkspaceReviewInput, analyzedAt = new Date()): WorkspaceReview {
  const changes = detectWorkspaceChanges(input.status, input.workspace, input.published);
  const graph = buildDependencyGraph(input.workspace);
  const publishedGraph = input.published ? buildDependencyGraph(input.published) : undefined;
  const findings = evaluateRiskRules(changes, { graph, workspace: input.workspace });
  const impacts: EntityImpact[] = changes.map((change) => {
    const dependencyGraph = change.changeType === "deleted" && publishedGraph ? publishedGraph : graph;
    return {
      entityKey: change.key,
      directDependencies: directDependencies(dependencyGraph, change.key),
      directDependents: directDependents(graph, change.key),
      transitiveDependents: transitiveDependents(graph, change.key),
    };
  });

  const highestSeverity = new Map<string, Severity>(changes.map((change) => [change.key, "info"]));
  for (const item of findings) {
    const existing = highestSeverity.get(item.entityKey) ?? "info";
    if (SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[existing]) highestSeverity.set(item.entityKey, item.severity);
  }
  const severityCounts = { high: 0, medium: 0, low: 0, info: 0 };
  highestSeverity.forEach((severity) => severityCounts[severity]++);
  const affected = new Map<string, EntityReference>();
  impacts.forEach((impact) => impact.transitiveDependents.forEach((entity) => affected.set(entity.key, entity)));

  return {
    schemaVersion: 2,
    analyzedAt: analyzedAt.toISOString(),
    source: input.source,
    baseline: input.published
      ? { type: "published", containerVersionId: input.publishedVersionId, name: input.publishedVersionName }
      : { type: "none" },
    summary: {
      changes: changes.length,
      ...severityCounts,
      affectedEntities: affected.size,
      conflicts: input.status.mergeConflict?.length ?? 0,
    },
    changes,
    findings,
    impacts,
    relationships: graph.relationships,
    mergeConflicts: input.status.mergeConflict ?? [],
  };
}
