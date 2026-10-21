import { describe, expect, it } from "vitest";
import type { EntityImpact, EntityReference, RiskFinding, Severity, WorkspaceChange } from "./model";
import {
  additionalDownstreamItems,
  changesNeedingReview,
  elevatedStateCopy,
  fieldLabel,
  filterAccessibilityLabel,
  impactWording,
  reviewSummarySentence,
  sortChangesForReview,
  whyThisMatters,
} from "./presentation";

function change(key: string, name: string, changeType: WorkspaceChange["changeType"] = "added"): WorkspaceChange {
  return { key, name, changeType, entityKind: "variable", fieldChanges: [] };
}

function finding(entityKey: string, severity: Severity): RiskFinding {
  return {
    id: `${entityKey}-${severity}`,
    ruleId: "test-rule",
    severity,
    entityKey,
    affectedEntity: { key: entityKey, entityKind: "variable", name: entityKey },
    title: "Test finding",
    explanation: "Test explanation",
    evidence: "Test evidence",
  };
}

function reference(key: string, entityKind: EntityReference["entityKind"] = "tag"): EntityReference {
  return { key, entityKind, name: key };
}

function impact(entityKey: string, transitive: EntityReference[], direct = transitive): EntityImpact {
  return { entityKey, directDependencies: [], directDependents: direct, transitiveDependents: transitive };
}

describe("review presentation", () => {
  it("sorts by severity, blast radius, change type, and name", () => {
    const changes = [
      change("added", "Zulu", "added"),
      change("modified", "Beta", "modified"),
      change("deleted", "Alpha", "deleted"),
      change("medium-small", "Medium small"),
      change("medium-large", "Medium large"),
      change("high", "High"),
    ];
    const findings = [finding("high", "high"), finding("medium-small", "medium"), finding("medium-large", "medium")];
    const impacts = [impact("medium-small", [reference("one")]), impact("medium-large", [reference("one"), reference("two")])];
    expect(sortChangesForReview(changes, findings, impacts).map((item) => item.key)).toEqual([
      "high",
      "medium-large",
      "medium-small",
      "deleted",
      "modified",
      "added",
    ]);
  });

  it("uses plain-language blast-radius wording with entity-specific counts", () => {
    const mixed = impact("variable:value", [reference("trigger", "trigger"), reference("tag-1"), reference("tag-2")]);
    expect(impactWording(mixed)).toBe("Affects 1 trigger and 2 tags");
    expect(whyThisMatters(change("variable:value", "Value", "modified"), mixed)).toBe(
      "This variable is used by 1 trigger and 2 tags. Changing it may affect the values those items send or use.",
    );
    const tagsOnly = impact("variable:value", [reference("tag-1"), reference("tag-2")]);
    expect(whyThisMatters(change("variable:value", "Value", "modified"), tagsOnly)).toBe(
      "This variable is used by 2 tags. Changing it may affect the values those tags send or use.",
    );
  });

  it("maps common GTM API paths to human-readable field labels without changing the raw path", () => {
    const rawPath = "parameter[value].value";
    expect(fieldLabel(rawPath)).toBe("Value");
    expect(rawPath).toBe("parameter[value].value");
    expect(fieldLabel("parameter[measurementId].value")).toBe("Measurement ID");
    expect(fieldLabel("parameter[html].value")).toBe("Tag HTML");
    expect(fieldLabel("tagFiringOption")).toBe("Tag firing option");
    expect(fieldLabel("consentSettings.consentStatus")).toBe("Consent requirement");
    expect(fieldLabel("filter[0].parameter[0].value")).toBe("Trigger conditions");
    expect(fieldLabel("firingTriggerId[0]")).toBe("Firing triggers");
    expect(fieldLabel("blockingTriggerId[0]")).toBe("Blocking triggers");
  });

  it("selects only high and medium changes for Needs review", () => {
    const changes = [change("high", "High"), change("medium", "Medium"), change("low", "Low"), change("info", "Info")];
    const findings = [finding("high", "high"), finding("medium", "medium"), finding("low", "low")];
    expect(changesNeedingReview(changes, findings, []).map((item) => item.key)).toEqual(["high", "medium"]);
  });

  it("uses a conservative no-elevated-findings state", () => {
    expect(elevatedStateCopy(2, 0)).toEqual({
      title: "No elevated findings detected",
      detail: "The current rules did not identify any medium- or high-impact changes. Review the changes below before publishing.",
    });
  });

  it("uses a restrained empty-workspace state", () => {
    expect(elevatedStateCopy(0, 0)).toEqual({
      title: "No pending workspace changes",
      detail: "There is currently nothing to review in this workspace.",
    });
  });

  it("does not repeat direct items in the additional downstream list", () => {
    const direct = reference("Direct tag");
    const downstream = reference("Downstream tag");
    const entityImpact = impact("variable:value", [direct, downstream], [direct]);
    expect(additionalDownstreamItems(entityImpact)).toEqual([downstream]);
    expect(additionalDownstreamItems(impact("variable:value", [direct], [direct]))).toEqual([]);
  });

  it("provides concise summary and accessible filter labels", () => {
    expect(reviewSummarySentence(5, 1, 3)).toBe("5 pending changes · 1 change needs review · 3 affected items");
    expect(filterAccessibilityLabel("medium", 2)).toBe("Show medium changes (2)");
    expect(filterAccessibilityLabel("all", 5)).toBe("Show all changes (5)");
  });
});
