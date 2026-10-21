import { describe, expect, it } from "vitest";
import { buildDependencyGraph, directDependents, directDependencies, transitiveDependents } from "../../src/review/dependencyGraph";
import { createWorkspaceReview } from "../../src/review/workspaceReview";
import type { GtmWorkspaceStatus } from "../../src/types/gtm";
import { createBaselineFixture, createChangesFixture, EXPECTED_BASELINE_COUNTS, materializeFixtureForAnalysis } from "./fixture";
import { buildTagPayload, buildVariablePayload, validateFixturePayloads } from "./payload";
import type { SeedParameter } from "./parameters";
import { SEED_PREFIX, seededName } from "./types";

describe("GTM seeder fixture generation", () => {
  it("generates the expected realistic baseline counts", () => {
    const fixture = createBaselineFixture();
    expect(fixture.variables).toHaveLength(EXPECTED_BASELINE_COUNTS.variables);
    expect(fixture.triggers).toHaveLength(EXPECTED_BASELINE_COUNTS.triggers);
    expect(fixture.tags).toHaveLength(EXPECTED_BASELINE_COUNTS.tags);
  });

  it("uses deterministic, unique, cleanup-safe names", () => {
    const first = createBaselineFixture();
    const second = createBaselineFixture();
    expect(first).toEqual(second);
    const names = [...first.variables, ...first.triggers, ...first.tags].map((entity) => entity.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith(`${SEED_PREFIX} `))).toBe(true);
  });

  it("contains the required high-blast-radius and nested relationships", () => {
    const materialized = materializeFixtureForAnalysis(createBaselineFixture());
    const graph = buildDependencyGraph(materialized.workspace);
    const trackingDependents = transitiveDependents(graph, `variable:${seededName("Shared Tracking ID")}`);
    expect(trackingDependents.length).toBeGreaterThanOrEqual(8);
    expect(directDependencies(graph, `variable:${seededName("Measurement ID")}`).map((item) => item.name)).toContain(
      seededName("Shared Tracking ID"),
    );

    const purchaseId = materialized.ids.triggers.get(seededName("Shared Purchase Event"));
    expect(purchaseId).toBeDefined();
    expect(directDependents(graph, `trigger:${purchaseId}`)).toHaveLength(7);

    expect(directDependencies(graph, `variable:${seededName("Nested Middle")}`).map((item) => item.name)).toContain(
      seededName("Nested Base"),
    );
    expect(directDependencies(graph, `variable:${seededName("Nested Final")}`).map((item) => item.name)).toEqual(
      expect.arrayContaining([seededName("Nested Middle"), seededName("Environment"), seededName("Shared Tracking ID")]),
    );
    expect(transitiveDependents(graph, `variable:${seededName("Nested Base")}`).map((item) => item.name)).toContain(
      seededName("Sitewide diagnostic event"),
    );
  });

  it("creates a deterministic unpublished changes phase", () => {
    const baseline = createBaselineFixture();
    const changes = createChangesFixture();
    expect(changes.variables).toHaveLength(baseline.variables.length);
    expect(changes.triggers).toHaveLength(baseline.triggers.length);
    expect(changes.tags).toHaveLength(baseline.tags.length + 1);
    expect(changes.tags.some((tag) => tag.name === seededName("CHANGED New All Pages Custom HTML"))).toBe(true);
  });

  it("preserves all six intended review changes without treating _event as unresolved", () => {
    const published = materializeFixtureForAnalysis(createBaselineFixture()).workspace;
    const current = materializeFixtureForAnalysis(createChangesFixture()).workspace;
    const variableName = seededName("Shared Tracking ID");
    const triggerName = seededName("Shared Purchase Event");
    const modifiedTagNames = [
      seededName("Purchase destination 01"),
      seededName("Consent observer Custom HTML"),
      seededName("Checkout page view"),
    ];
    const addedTagName = seededName("CHANGED New All Pages Custom HTML");
    const status: GtmWorkspaceStatus = {
      workspaceChange: [
        { changeStatus: "updated", variable: current.variables.find((entity) => entity.name === variableName)! },
        { changeStatus: "updated", trigger: current.triggers.find((entity) => entity.name === triggerName)! },
        ...modifiedTagNames.map((name) => ({
          changeStatus: "updated" as const,
          tag: current.tags.find((entity) => entity.name === name)!,
        })),
        { changeStatus: "added", tag: current.tags.find((entity) => entity.name === addedTagName)! },
      ],
    };

    const result = createWorkspaceReview(
      {
        source: { accountId: "test-account", containerId: "test-container", workspaceId: "test-workspace" },
        status,
        workspace: current,
        published,
      },
      new Date("2026-08-20T12:00:00Z"),
    );

    expect(result.changes.map((change) => change.name).sort()).toEqual(
      [variableName, triggerName, ...modifiedTagNames, addedTagName].sort(),
    );
    expect(result.summary.changes).toBe(6);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ ruleId: "trigger-blast-radius", severity: "high", blastRadiusCount: 7 }),
    );
    expect(result.findings).not.toContainEqual(expect.objectContaining({ ruleId: "unresolved-dependency-introduced" }));
    expect(result.relationships).toContainEqual(
      expect.objectContaining({
        dependent: expect.objectContaining({ name: triggerName }),
        dependency: expect.objectContaining({ entityKind: "builtInVariable", name: "Event" }),
        resolved: true,
      }),
    );
  });

  it("emits a non-empty measurementIdOverride for every GA4 Event tag", () => {
    for (const fixture of [createBaselineFixture(), createChangesFixture()]) {
      const triggerIds = new Map(fixture.triggers.map((trigger, index) => [trigger.name, `trigger-${index + 1}`]));
      const ga4Payloads = fixture.tags
        .map((tag) => buildTagPayload(tag, triggerIds))
        .filter((tag) => tag.type === "gaawe");

      for (const payload of ga4Payloads) {
        const parameters = payload.parameter as Array<Record<string, unknown>>;
        expect(parameters).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "measurementId" })]));
        expect(parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: "measurementIdOverride",
              value: `{{${seededName("Measurement ID")}}}`,
            }),
          ]),
        );
      }
    }
  });

  it("preflights every generated baseline and changes payload", () => {
    expect(() => validateFixturePayloads(createBaselineFixture())).not.toThrow();
    expect(() => validateFixturePayloads(createChangesFixture())).not.toThrow();
  });

  it("serializes needed and not-needed consent settings with valid GTM Parameters", () => {
    const baseline = createBaselineFixture();
    const baselineTriggerIds = new Map(baseline.triggers.map((trigger, index) => [trigger.name, `trigger-${index + 1}`]));
    const neededTag = baseline.tags.find((tag) => tag.name === seededName("Consent observer Custom HTML"))!;
    expect(buildTagPayload(neededTag, baselineTriggerIds).consentSettings).toEqual({
      consentStatus: "needed",
      consentType: {
        type: "list",
        list: [
          { type: "template", value: "analytics_storage" },
          { type: "template", value: "ad_storage" },
        ],
      },
    });

    const changes = createChangesFixture();
    const changesTriggerIds = new Map(changes.triggers.map((trigger, index) => [trigger.name, `trigger-${index + 1}`]));
    const notNeededTag = changes.tags.find((tag) => tag.name === seededName("Consent observer Custom HTML"))!;
    expect(buildTagPayload(notNeededTag, changesTriggerIds).consentSettings).toEqual({ consentStatus: "notNeeded" });
  });

  it("rejects unsupported nested GTM Parameter types during fixture preflight", () => {
    const fixture = createBaselineFixture();
    const invalidConsentType = {
      type: "list",
      list: [{ type: "string", value: "analytics_storage" }],
    } as unknown as SeedParameter;
    const invalidFixture = {
      ...fixture,
      tags: fixture.tags.map((tag) =>
        tag.name === seededName("Consent observer Custom HTML")
          ? { ...tag, consentSettings: { consentStatus: "needed" as const, consentType: invalidConsentType } }
          : tag,
      ),
    };

    expect(() => validateFixturePayloads(invalidFixture)).toThrow('unsupported GTM Parameter.type "string"');
  });

  it("rejects an empty GA4 measurementIdOverride before an API request can be made", () => {
    const fixture = createBaselineFixture();
    const tag = fixture.tags.find((candidate) => candidate.type === "gaawe")!;
    const triggerIds = new Map(fixture.triggers.map((trigger, index) => [trigger.name, `trigger-${index + 1}`]));
    const parameter: SeedParameter[] | undefined = tag.parameter?.map((item) =>
      item.key === "measurementIdOverride"
        ? { type: "template", key: "measurementIdOverride", value: "" }
        : item,
    );

    expect(() => buildTagPayload({ ...tag, parameter }, triggerIds)).toThrow("requires a non-empty measurementIdOverride");
  });

  it("omits optional empty strings and parameter records from API payloads", () => {
    const payload = buildVariablePayload({
      name: seededName("Compacted fixture"),
      type: "c",
      notes: "",
      parameter: [
        { type: "template", key: "value", value: "safe" },
        { type: "template", key: "optionalEmpty", value: "" },
      ],
    });

    expect(payload).not.toHaveProperty("notes");
    expect(payload.parameter).toEqual([{ type: "template", key: "value", value: "safe" }]);
    expect(JSON.stringify(payload)).not.toContain('""');
  });
});
