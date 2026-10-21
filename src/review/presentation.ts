import type { EntityImpact, EntityKind, EntityReference, RiskFinding, Severity, WorkspaceChange } from "./model";

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };
const CHANGE_RANK: Record<WorkspaceChange["changeType"], number> = { modified: 0, deleted: 0, added: 1 };
const ENTITY_ORDER: EntityKind[] = ["trigger", "tag", "variable", "builtInVariable", "template", "other"];

const FIELD_LABELS: Array<[RegExp, string]> = [
  [/^parameter\[value\]\.value$/i, "Value"],
  [/^parameter\[html\]\.value$/i, "Tag HTML"],
  [/^tagFiringOption$/i, "Tag firing option"],
  [/^consentSettings\.consentStatus$/i, "Consent requirement"],
  [/^consentSettings(?:\.|$)/i, "Consent settings"],
  [/^(?:filter|autoEventFilter|customEventFilter)(?:\.|\[|$)/i, "Trigger conditions"],
  [/^firingTriggerId(?:\.|\[|$)/i, "Firing triggers"],
  [/^blockingTriggerId(?:\.|\[|$)/i, "Blocking triggers"],
];

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function entityLabel(kind: EntityKind, count: number): string {
  const labels: Record<EntityKind, [string, string]> = {
    tag: ["tag", "tags"],
    trigger: ["trigger", "triggers"],
    variable: ["variable", "variables"],
    builtInVariable: ["built-in variable", "built-in variables"],
    template: ["template", "templates"],
    other: ["item", "items"],
  };
  const [singular, plural] = labels[kind];
  return pluralize(count, singular, plural);
}

function joinNatural(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? "0 items";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bid\b/gi, "ID")
    .replace(/\bhtml\b/gi, "HTML")
    .replace(/^./, (character) => character.toUpperCase());
}

export function fieldLabel(path: string): string {
  for (const [pattern, label] of FIELD_LABELS) {
    if (pattern.test(path)) return label;
  }
  const parameterKey = path.match(/^parameter\[([^\]]+)\](?:\.value)?$/i)?.[1];
  if (parameterKey) return humanizeIdentifier(parameterKey);
  const lastSegment = path.split(".").at(-1)?.replace(/\[[^\]]+\]/g, "") || path;
  return humanizeIdentifier(lastSegment);
}

export function severityForChange(change: WorkspaceChange, findings: RiskFinding[]): Severity {
  return findings
    .filter((finding) => finding.entityKey === change.key)
    .reduce<Severity>(
      (highest, finding) => (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[highest] ? finding.severity : highest),
      "info",
    );
}

export function impactForChange(change: WorkspaceChange, impacts: EntityImpact[]): EntityImpact | undefined {
  return impacts.find((impact) => impact.entityKey === change.key);
}

export function sortChangesForReview(
  changes: WorkspaceChange[],
  findings: RiskFinding[],
  impacts: EntityImpact[],
): WorkspaceChange[] {
  return [...changes].sort((left, right) => {
    const severityDifference = SEVERITY_RANK[severityForChange(right, findings)] - SEVERITY_RANK[severityForChange(left, findings)];
    if (severityDifference) return severityDifference;
    const leftImpact = impactForChange(left, impacts)?.transitiveDependents.length ?? 0;
    const rightImpact = impactForChange(right, impacts)?.transitiveDependents.length ?? 0;
    if (leftImpact !== rightImpact) return rightImpact - leftImpact;
    const changeDifference = CHANGE_RANK[left.changeType] - CHANGE_RANK[right.changeType];
    return changeDifference || left.name.localeCompare(right.name);
  });
}

export function changesNeedingReview(
  changes: WorkspaceChange[],
  findings: RiskFinding[],
  impacts: EntityImpact[],
): WorkspaceChange[] {
  return sortChangesForReview(changes, findings, impacts).filter((change) => {
    const severity = severityForChange(change, findings);
    return severity === "high" || severity === "medium";
  });
}

export function describeEntities(entities: EntityReference[]): string {
  const counts = new Map<EntityKind, number>();
  entities.forEach((entity) => counts.set(entity.entityKind, (counts.get(entity.entityKind) ?? 0) + 1));
  return joinNatural(
    ENTITY_ORDER.filter((kind) => counts.has(kind)).map((kind) => entityLabel(kind, counts.get(kind) ?? 0)),
  );
}

export function impactWording(impact: EntityImpact | undefined): string {
  const entities = impact?.transitiveDependents ?? [];
  return entities.length ? `Affects ${describeEntities(entities)}` : "No downstream items found";
}

export function additionalDownstreamItems(impact: EntityImpact | undefined): EntityReference[] {
  if (!impact) return [];
  const directKeys = new Set(impact.directDependents.map((item) => item.key));
  return impact.transitiveDependents.filter((item) => !directKeys.has(item.key));
}

export function whyThisMatters(change: WorkspaceChange, impact: EntityImpact | undefined): string {
  const affected = impact?.transitiveDependents ?? [];
  if (!affected.length) return "No downstream items were found. Review the configuration change before publishing.";
  const description = describeEntities(affected);
  if (change.entityKind === "variable") {
    const target = affected.every((item) => item.entityKind === "tag") ? "those tags" : "those items";
    return `This variable is used by ${description}. Changing it may affect the values ${target} send or use.`;
  }
  if (change.entityKind === "trigger") {
    return `This trigger is used by ${description}. Changing its conditions may alter when those items run.`;
  }
  return `${description.replace(/^./, (character) => character.toUpperCase())} may be affected by this change.`;
}

export function notableReason(change: WorkspaceChange, findings: RiskFinding[], impact: EntityImpact | undefined): string | undefined {
  const changeFindings = findings.filter((finding) => finding.entityKey === change.key);
  const combined = changeFindings.find((finding) => finding.ruleId === "new-custom-html-all-pages");
  if (combined) return "Custom HTML running on all pages";
  const blast = changeFindings.find((finding) => finding.blastRadiusCount !== undefined);
  if (blast && impact?.transitiveDependents.length) return impactWording(impact);
  return changeFindings[0]?.title;
}

export function changeTypeLabel(change: WorkspaceChange): string {
  return `${change.changeType.replace(/^./, (character) => character.toUpperCase())} ${
    change.entityKind === "builtInVariable" ? "built-in variable" : change.entityKind
  }`;
}

export function reviewSummarySentence(changes: number, needsReview: number, affected: number): string {
  return `${pluralize(changes, "pending change")} · ${pluralize(needsReview, "change")} ${needsReview === 1 ? "needs" : "need"} review · ${pluralize(affected, "affected item")}`;
}

export function filterAccessibilityLabel(filter: string, count: number): string {
  return `${filter === "all" ? "Show all" : `Show ${filter}`} changes (${count})`;
}

export function elevatedStateCopy(changes: number, needsReview: number): { title: string; detail: string } {
  if (changes === 0) {
    return { title: "No pending workspace changes", detail: "There is currently nothing to review in this workspace." };
  }
  if (needsReview === 0) {
    return {
      title: "No elevated findings detected",
      detail: "The current rules did not identify any medium- or high-impact changes. Review the changes below before publishing.",
    };
  }
  return {
    title: `${pluralize(needsReview, "change")} ${needsReview === 1 ? "deserves" : "deserve"} review`,
    detail: "Start with these medium- and high-impact findings, then review the full change inventory below.",
  };
}
