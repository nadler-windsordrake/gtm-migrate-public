import type { GtmTag } from "../types/gtm";
import { entityReference, type ReviewEntity } from "./entity";
import {
  directDependents,
  isAllPagesTrigger,
  tagFiresOnAllPages,
  transitiveDependents,
  type DependencyGraph,
} from "./dependencyGraph";
import type { EntityReference, RiskFinding, Severity, WorkspaceChange } from "./model";

export const BLAST_RADIUS_THRESHOLDS = { medium: 3, high: 6 } as const;

interface RiskContext {
  graph: DependencyGraph;
  workspace: Parameters<typeof tagFiresOnAllPages>[1];
}

function affectedEntity(change: WorkspaceChange): EntityReference {
  const entity = (change.after ?? change.before ?? { name: change.name }) as ReviewEntity;
  return entityReference(change.entityKind, entity);
}

function finding(
  change: WorkspaceChange,
  ruleId: string,
  severity: Severity,
  title: string,
  explanation: string,
  evidence: string,
  blastRadiusCount?: number,
): RiskFinding {
  return {
    id: `${ruleId}:${change.key}`,
    ruleId,
    severity,
    entityKey: change.key,
    affectedEntity: affectedEntity(change),
    title,
    explanation,
    evidence,
    ...(blastRadiusCount === undefined ? {} : { blastRadiusCount }),
  };
}

function blastSeverity(count: number): Severity {
  if (count >= BLAST_RADIUS_THRESHOLDS.high) return "high";
  if (count >= BLAST_RADIUS_THRESHOLDS.medium) return "medium";
  return "low";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isCustomHtml(value: unknown): boolean {
  return String(record(value).type ?? "").toLowerCase() === "html";
}

function conditionCount(value: unknown): number {
  const entity = record(value);
  return [entity.filter, entity.autoEventFilter, entity.customEventFilter].reduce<number>(
    (count, conditions) => count + (Array.isArray(conditions) ? conditions.length : 0),
    0,
  );
}

function identifierChanges(change: WorkspaceChange): string[] {
  const fieldChanges = change.fieldChanges
    .filter((field) => {
      if (field.changeType !== "changed" || typeof field.before !== "string" || typeof field.after !== "string") return false;
      const meaningfulPath = /(measurement|tracking|conversion|pixel|tag.?id|container.?id)/i.test(field.path);
      const identifierValue = /^(G|GT|AW|DC|UA)-[A-Z0-9-]+$/i.test(field.before) || /^(G|GT|AW|DC|UA)-[A-Z0-9-]+$/i.test(field.after);
      return meaningfulPath || identifierValue;
    })
    .map((field) => `${field.path}: ${String(field.before)} → ${String(field.after)}`);

  const parameterValues = (value: unknown): Map<string, string> => {
    const values = new Map<string, string>();
    const visit = (current: unknown): void => {
      if (Array.isArray(current)) {
        current.forEach(visit);
        return;
      }
      if (!current || typeof current !== "object") return;
      const item = current as Record<string, unknown>;
      if (typeof item.key === "string" && typeof item.value === "string") values.set(item.key, item.value);
      Object.values(item).forEach(visit);
    };
    visit(value);
    return values;
  };
  const beforeParameters = parameterValues(change.before);
  const afterParameters = parameterValues(change.after);
  const keys = new Set([...beforeParameters.keys(), ...afterParameters.keys()]);
  for (const key of keys) {
    const before = beforeParameters.get(key);
    const after = afterParameters.get(key);
    if (before === after || before === undefined || after === undefined) continue;
    const meaningfulKey = /(measurement|tracking|conversion|pixel|tag.?id|container.?id)/i.test(key);
    const identifierValue = /^(G|GT|AW|DC|UA)-[A-Z0-9-]+$/i.test(before) || /^(G|GT|AW|DC|UA)-[A-Z0-9-]+$/i.test(after);
    if (meaningfulKey || identifierValue) fieldChanges.push(`parameter.${key}: ${before} → ${after}`);
  }
  return [...new Set(fieldChanges)];
}

function consentWasRequired(value: unknown): boolean {
  return String(record(record(value).consentSettings).consentStatus ?? "").toLowerCase() === "needed";
}

export function evaluateRiskRules(changes: WorkspaceChange[], context: RiskContext): RiskFinding[] {
  const findings: RiskFinding[] = [];
  for (const change of changes) {
    const after = record(change.after);
    const before = record(change.before);
    const isNewCustomHtml = change.entityKind === "tag" && change.changeType === "added" && isCustomHtml(after);
    const isNewTagOnAllPages =
      change.entityKind === "tag" &&
      change.changeType === "added" &&
      tagFiresOnAllPages(after as GtmTag, context.workspace);

    if (isNewCustomHtml && isNewTagOnAllPages) {
      findings.push(
        finding(
          change,
          "new-custom-html-all-pages",
          "medium",
          "Custom HTML runs on all pages",
          "Custom HTML can execute arbitrary page code, and this tag is configured to run across the site. Review the script before publishing.",
          "The tag type is Custom HTML and at least one firing trigger runs on every page view.",
        ),
      );
    } else if (isNewCustomHtml) {
      findings.push(
        finding(
          change,
          "new-custom-html-tag",
          "medium",
          "New Custom HTML tag requires review",
          "Custom HTML can execute arbitrary page code. Review the script and where it runs before publishing.",
          "The tag type is Custom HTML.",
        ),
      );
    }

    if (isNewTagOnAllPages && !isNewCustomHtml) {
      findings.push(
        finding(
          change,
          "new-tag-all-pages",
          "medium",
          "New tag fires on all pages",
          "This tag may run across the full site. Review its configuration and intended firing coverage before publishing.",
          "At least one firing trigger runs on every page view.",
        ),
      );
    }

    if (change.changeType === "modified" && (change.entityKind === "trigger" || change.entityKind === "variable")) {
      const dependents = transitiveDependents(context.graph, change.key);
      const affected = change.entityKind === "trigger" ? dependents.filter((item) => item.entityKind === "tag") : dependents;
      if (affected.length > 0) {
        const affectedLabel =
          affected.every((item) => item.entityKind === "tag")
            ? `${affected.length} ${affected.length === 1 ? "tag" : "tags"}`
            : `${affected.length} ${affected.length === 1 ? "item" : "items"}`;
        findings.push(
          finding(
            change,
            change.entityKind === "trigger" ? "trigger-blast-radius" : "variable-blast-radius",
            blastSeverity(affected.length),
            `${change.entityKind === "trigger" ? "Trigger" : "Variable"} change affects ${affectedLabel}`,
            change.entityKind === "trigger"
              ? `This trigger is used by ${affected.length} ${affected.length === 1 ? "tag" : "tags"}. Changing its conditions may alter when those tags run.`
              : `This variable is used directly or indirectly by ${affectedLabel}. Changing it may affect the values those ${affected.every((item) => item.entityKind === "tag") ? "tags" : "items"} send or use.`,
            `Affected items: ${affected.map((item) => item.name).join(", ")}.`,
            affected.length,
          ),
        );
      }
    }

    if (change.changeType === "deleted" && (change.entityKind === "trigger" || change.entityKind === "variable")) {
      const dependents = directDependents(context.graph, change.key);
      if (dependents.length) {
        findings.push(
          finding(
            change,
            "deleted-entity-referenced",
            "high",
            "Deleted entity is still referenced",
            `The workspace still contains ${dependents.length} ${dependents.length === 1 ? "item that refers" : "items that refer"} to this deleted ${change.entityKind}.`,
            `Used by: ${dependents.map((item) => item.name).join(", ")}.`,
            dependents.length,
          ),
        );
      }
    }

    if (["tag", "trigger", "variable"].includes(change.entityKind) && change.changeType !== "deleted") {
      const unresolved = context.graph.unresolved.filter((item) => item.source.key === change.key);
      if (unresolved.length) {
        const references = [...new Set(unresolved.map((item) => `${item.referenceKind}: ${item.reference}`))];
        findings.push(
          finding(
            change,
            "unresolved-dependency-introduced",
            "high",
            "Unresolved dependency requires review",
            "This changed item refers to something that could not be found in the workspace. Confirm the referenced item still exists before publishing.",
            `Unresolved references: ${references.join(", ")}.`,
          ),
        );
      }
    }

    if (
      change.entityKind === "trigger" &&
      change.changeType === "modified" &&
      String(before.type ?? "").toLowerCase() === "pageview" &&
      conditionCount(before) > 0 &&
      isAllPagesTrigger(after)
    ) {
      findings.push(
        finding(
          change,
          "trigger-materially-broader",
          "high",
          "Page-view trigger became materially broader",
          "All page-view conditions were removed, so this trigger may now run across the full site.",
          `${conditionCount(before)} condition(s) before; 0 conditions after.`,
        ),
      );
    }

    const changedIdentifiers = identifierChanges(change);
    if (changedIdentifiers.length) {
      findings.push(
        finding(
          change,
          "measurement-identifier-changed",
          "medium",
          "Tracking or measurement identifier changed",
          "An identifier-like configuration value changed and should be verified before publishing.",
          changedIdentifiers.join("; "),
        ),
      );
    }

    if (
      change.entityKind === "tag" &&
      change.changeType === "modified" &&
      before.tagFiringOption !== after.tagFiringOption
    ) {
      findings.push(
        finding(
          change,
          "tag-firing-option-changed",
          "medium",
          "Tag firing option changed",
          "The tag's repeat-firing behavior changed. Confirm how often it should run before publishing.",
          `${String(before.tagFiringOption ?? "default")} → ${String(after.tagFiringOption ?? "default")}.`,
        ),
      );
    }

    const consentChanged = change.fieldChanges.some((field) => field.path === "consentSettings" || field.path.startsWith("consentSettings."));
    if (change.entityKind === "tag" && change.changeType === "modified" && consentChanged) {
      const removedRequiredConsent = consentWasRequired(before) && !consentWasRequired(after);
      findings.push(
        finding(
          change,
          "consent-configuration-changed",
          removedRequiredConsent ? "high" : "medium",
          "Consent configuration changed",
          removedRequiredConsent
            ? "A previously required consent condition was removed; this requires careful privacy review."
            : "The tag's consent configuration changed and requires privacy review.",
          removedRequiredConsent ? "Consent status changed from needed to a non-required state." : "The consentSettings field changed.",
        ),
      );
    }
  }
  return findings;
}
