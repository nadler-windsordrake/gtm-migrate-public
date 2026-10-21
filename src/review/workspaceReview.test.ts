import { describe, expect, it } from "vitest";
import type { GtmTag, GtmTrigger, GtmVariable, GtmWorkspaceStatus, WorkspaceEntities } from "../types/gtm";
import { attentionWorkspaceReviewFixture, workspaceReviewFixture } from "../fixtures/workspaceReviewFixture";
import { detectWorkspaceChanges } from "./changeDetection";
import { buildDependencyGraph, directDependencies, transitiveDependents } from "./dependencyGraph";
import { entitiesEqual } from "./normalization";
import { createWorkspaceReview } from "./workspaceReview";

const source = { accountId: "a", containerId: "c", workspaceId: "w" };
const empty = (): WorkspaceEntities => ({ tags: [], triggers: [], variables: [], builtInVariables: [], templates: [] });
const tag = (id: string, name: string, extra: Partial<GtmTag> = {}): GtmTag => ({ tagId: id, name, type: "gaawe", ...extra });
const trigger = (id: string, name: string, extra: Partial<GtmTrigger> = {}): GtmTrigger => ({
  triggerId: id,
  name,
  type: "customEvent",
  ...extra,
});
const variable = (id: string, name: string, value?: string): GtmVariable => ({
  variableId: id,
  name,
  type: "c",
  ...(value === undefined ? {} : { parameter: [{ key: "value", value }] }),
});
const review = (status: GtmWorkspaceStatus, workspace: WorkspaceEntities, published?: WorkspaceEntities) =>
  createWorkspaceReview({ source, status, workspace, ...(published ? { published } : {}) }, new Date("2026-08-19T12:00:00Z"));

describe("workspace review", () => {
  it("handles no workspace changes", () => {
    const result = review({ workspaceChange: [] }, empty(), empty());
    expect(result.changes).toEqual([]);
    expect(result.summary.changes).toBe(0);
  });

  it("detects an added tag", () => {
    const added = tag("1", "Added tag");
    const current = { ...empty(), tags: [added] };
    const result = review({ workspaceChange: [{ changeStatus: "added", tag: added }] }, current, empty());
    expect(result.changes[0]).toMatchObject({ entityKind: "tag", changeType: "added", id: "1", name: "Added tag" });
  });

  it("detects a modified tag with a field-level diff", () => {
    const before = tag("1", "Tag", { priority: { type: "integer", value: "1" } });
    const after = tag("1", "Tag", { priority: { type: "integer", value: "2" } });
    const result = review(
      { workspaceChange: [{ changeStatus: "updated", tag: after }] },
      { ...empty(), tags: [after] },
      { ...empty(), tags: [before] },
    );
    expect(result.changes[0]?.changeType).toBe("modified");
    expect(result.changes[0]?.fieldChanges).toContainEqual({
      path: "priority.value",
      changeType: "changed",
      before: "1",
      after: "2",
    });
  });

  it("detects a deleted tag", () => {
    const deleted = tag("1", "Deleted tag");
    const result = review(
      { workspaceChange: [{ changeStatus: "deleted", tag: deleted }] },
      empty(),
      { ...empty(), tags: [deleted] },
    );
    expect(result.changes[0]).toMatchObject({ entityKind: "tag", changeType: "deleted", before: deleted });
  });

  it("rates a changed trigger with one dependent as low", () => {
    const before = trigger("1", "Purchase", { customEventFilter: [{ value: "old" }] });
    const after = trigger("1", "Purchase", { customEventFilter: [{ value: "new" }] });
    const current = { ...empty(), triggers: [after], tags: [tag("1", "Purchase tag", { firingTriggerId: ["1"] })] };
    const result = review(
      { workspaceChange: [{ changeStatus: "updated", trigger: after }] },
      current,
      { ...empty(), triggers: [before] },
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "trigger-blast-radius", severity: "low", blastRadiusCount: 1 }));
  });

  it("rates a changed trigger with six dependent tags as high", () => {
    const before = trigger("1", "Shared", { customEventFilter: [{ value: "old" }] });
    const after = trigger("1", "Shared", { customEventFilter: [{ value: "new" }] });
    const tags = Array.from({ length: 6 }, (_, index) => tag(String(index), `Tag ${index}`, { firingTriggerId: ["1"] }));
    const result = review(
      { workspaceChange: [{ changeStatus: "updated", trigger: after }] },
      { ...empty(), triggers: [after], tags },
      { ...empty(), triggers: [before] },
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "trigger-blast-radius", severity: "high", blastRadiusCount: 6 }));
  });

  it("treats _event in a changed Custom Event trigger as built-in while preserving high blast radius", () => {
    const customEventFilter = (eventName: string) => [
      {
        type: "equals",
        parameter: [
          { type: "template", key: "arg0", value: "{{_event}}" },
          { type: "template", key: "arg1", value: eventName },
        ],
      },
    ];
    const before = trigger("1", "Shared Purchase Event", { customEventFilter: customEventFilter("purchase") });
    const after = trigger("1", "Shared Purchase Event", { customEventFilter: customEventFilter("purchase_v2") });
    const tags = Array.from({ length: 6 }, (_, index) => tag(String(index), `Tag ${index}`, { firingTriggerId: ["1"] }));
    const result = review(
      { workspaceChange: [{ changeStatus: "updated", trigger: after }] },
      { ...empty(), triggers: [after], tags },
      { ...empty(), triggers: [before], tags },
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({ ruleId: "trigger-blast-radius", severity: "high", blastRadiusCount: 6 }),
    );
    expect(result.findings).not.toContainEqual(expect.objectContaining({ ruleId: "unresolved-dependency-introduced" }));
    expect(result.relationships).toContainEqual(
      expect.objectContaining({
        dependent: expect.objectContaining({ key: "trigger:1" }),
        dependency: expect.objectContaining({ key: "builtInVariable:Event", name: "Event" }),
        resolved: true,
      }),
    );
  });

  it("finds transitive dependents of a changed variable", () => {
    const rootBefore = variable("1", "Root", "old");
    const rootAfter = variable("1", "Root", "new");
    const derived = variable("2", "Derived", "{{Root}}");
    const dependentTrigger = trigger("1", "Conditional", { filter: [{ value: "{{Derived}}" }] });
    const dependentTag = tag("1", "Dependent tag", { firingTriggerId: ["1"] });
    const current = { ...empty(), variables: [rootAfter, derived], triggers: [dependentTrigger], tags: [dependentTag] };
    const result = review(
      { workspaceChange: [{ changeStatus: "updated", variable: rootAfter }] },
      current,
      { ...empty(), variables: [rootBefore, derived], triggers: [dependentTrigger], tags: [dependentTag] },
    );
    const impact = result.impacts[0];
    expect(impact?.transitiveDependents.map((item) => item.name).sort()).toEqual(["Conditional", "Dependent tag", "Derived"]);
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "variable-blast-radius", severity: "medium", blastRadiusCount: 3 }));
  });

  it("terminates traversal through a circular dependency graph", () => {
    const first = variable("1", "First", "{{Second}}");
    const second = variable("2", "Second", "{{First}}");
    const graph = buildDependencyGraph({ ...empty(), variables: [first, second], tags: [tag("1", "Tag", { parameter: [{ value: "{{First}}" }] })] });
    expect(transitiveDependents(graph, "variable:First").map((item) => item.name).sort()).toEqual(["Second", "Tag"]);
  });

  it("flags a new Custom HTML tag", () => {
    const html = tag("1", "Custom script", { type: "html" });
    const result = review({ workspaceChange: [{ changeStatus: "added", tag: html }] }, { ...empty(), tags: [html] }, empty());
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "new-custom-html-tag", severity: "medium" }));
  });

  it("flags a new Custom HTML tag firing on All Pages", () => {
    const allPages = trigger("1", "All Pages", { type: "pageview" });
    const html = tag("1", "Site script", { type: "html", firingTriggerId: ["1"] });
    const result = review(
      { workspaceChange: [{ changeStatus: "added", tag: html }] },
      { ...empty(), triggers: [allPages], tags: [html] },
      empty(),
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "new-custom-html-all-pages",
        severity: "medium",
        title: "Custom HTML runs on all pages",
      }),
    ]);
  });

  it("flags a deleted variable that is still referenced", () => {
    const deleted = variable("1", "Deleted Value", "hello");
    const referencingTag = tag("1", "Broken tag", { parameter: [{ value: "{{Deleted Value}}" }] });
    const result = review(
      { workspaceChange: [{ changeStatus: "deleted", variable: deleted }] },
      { ...empty(), tags: [referencingTag] },
      { ...empty(), variables: [deleted], tags: [referencingTag] },
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "deleted-entity-referenced", severity: "high" }));
  });

  it("flags an unresolved reference introduced by a changed entity", () => {
    const broken = tag("1", "Broken", { parameter: [{ value: "{{Missing}}" }] });
    const result = review({ workspaceChange: [{ changeStatus: "added", tag: broken }] }, { ...empty(), tags: [broken] }, empty());
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "unresolved-dependency-introduced", severity: "high" }));
  });

  it("deduplicates duplicate dependency references", () => {
    const sharedTrigger = trigger("1", "Shared");
    const sharedVariable = variable("1", "Shared Value");
    const dependent = tag("1", "Tag", {
      firingTriggerId: ["1", "1"],
      blockingTriggerId: ["1"],
      parameter: [{ value: "{{Shared Value}} {{Shared Value}}" }],
    });
    const graph = buildDependencyGraph({ ...empty(), tags: [dependent], triggers: [sharedTrigger], variables: [sharedVariable] });
    expect(directDependencies(graph, "tag:1")).toHaveLength(2);
    expect(graph.relationships).toHaveLength(2);
  });

  it("flags a tag firing-option change", () => {
    const before = tag("1", "Tag", { tagFiringOption: "oncePerEvent" });
    const after = tag("1", "Tag", { tagFiringOption: "oncePerLoad" });
    const result = review(
      { workspaceChange: [{ changeStatus: "updated", tag: after }] },
      { ...empty(), tags: [after] },
      { ...empty(), tags: [before] },
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "tag-firing-option-changed", severity: "medium" }));
  });

  it("flags removal of required consent as high", () => {
    const before = tag("1", "Tag", { consentSettings: { consentStatus: "needed" } });
    const after = tag("1", "Tag", { consentSettings: { consentStatus: "notNeeded" } });
    const result = review(
      { workspaceChange: [{ changeStatus: "updated", tag: after }] },
      { ...empty(), tags: [after] },
      { ...empty(), tags: [before] },
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "consent-configuration-changed", severity: "high" }));
  });

  it("ignores fingerprints and API metadata during canonical normalization", () => {
    expect(
      entitiesEqual(
        { tagId: "1", name: "Tag", fingerprint: "old", path: "old/path", tagManagerUrl: "https://old" },
        { tagId: "1", name: "Tag", fingerprint: "new", path: "new/path", tagManagerUrl: "https://new" },
      ),
    ).toBe(true);
  });

  it("flags a deterministic page-view broadening and measurement identifier change", () => {
    const beforeTrigger = trigger("1", "Pages", { type: "pageview", filter: [{ value: "some pages" }] });
    const afterTrigger = trigger("1", "Pages", { type: "pageview", filter: [] });
    const beforeTag = tag("2", "Google tag", { parameter: [{ key: "measurementId", value: "G-OLD123" }] });
    const afterTag = tag("2", "Google tag", { parameter: [{ key: "measurementId", value: "G-NEW456" }] });
    const result = review(
      {
        workspaceChange: [
          { changeStatus: "updated", trigger: afterTrigger },
          { changeStatus: "updated", tag: afterTag },
        ],
      },
      { ...empty(), triggers: [afterTrigger], tags: [afterTag] },
      { ...empty(), triggers: [beforeTrigger], tags: [beforeTag] },
    );
    expect(result.findings.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining(["trigger-materially-broader", "measurement-identifier-changed"]),
    );
  });

  it("produces sensible results for the manual fixture", () => {
    const result = createWorkspaceReview(workspaceReviewFixture, new Date("2026-08-19T12:00:00Z"));
    expect(result.summary).toMatchObject({ changes: 1, high: 0, medium: 0, low: 1, affectedEntities: 2 });
    expect(result.changes[0]?.fieldChanges).toContainEqual(
      expect.objectContaining({ path: "parameter[value].value", before: "goodbye", after: "danger" }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ ruleId: "variable-blast-radius", severity: "low", blastRadiusCount: 2 }),
    );
    expect(JSON.stringify(result)).not.toMatch(/oauth|access.?token|client_secret/i);
  });

  it("produces one clear finding for the Custom HTML on All Pages fixture", () => {
    const result = createWorkspaceReview(attentionWorkspaceReviewFixture, new Date("2026-08-19T12:00:00Z"));
    expect(result.summary).toMatchObject({ changes: 1, high: 0, medium: 1 });
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "new-custom-html-all-pages", title: "Custom HTML runs on all pages" }),
    ]);
  });
});

describe("detectWorkspaceChanges", () => {
  it("uses status rather than reporting unrelated published differences", () => {
    const current = { ...empty(), tags: [tag("1", "Different from published")] };
    expect(detectWorkspaceChanges({ workspaceChange: [] }, current, empty())).toEqual([]);
  });
});
