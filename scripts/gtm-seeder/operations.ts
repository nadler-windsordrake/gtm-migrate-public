import { buildDependencyGraph, directDependents, transitiveDependents } from "../../src/review/dependencyGraph";
import { createBaselineFixture, createChangesFixture, materializeFixtureForAnalysis } from "./fixture";
import { buildTagPayload, buildTriggerPayload, buildVariablePayload, validateFixturePayloads } from "./payload";
import {
  isSeederOwnedName,
  seededName,
  type ApiEntity,
  type MutationCount,
  type SeederApi,
  type SeederProgress,
  type SeederRunOptions,
  type SeederSummary,
  type SeedEntityKind,
  type SeedFixture,
} from "./types";

interface Inventory {
  variable: ApiEntity[];
  trigger: ApiEntity[];
  tag: ApiEntity[];
}

interface ProgressState {
  current: number;
  total: number;
  onProgress?: (progress: SeederProgress) => void;
}

const emptyCount = (): MutationCount => ({ created: 0, updated: 0, deleted: 0, unchanged: 0 });

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, comparable(child)]));
}

function matchesDesired(existing: ApiEntity, desired: Record<string, unknown>): boolean {
  return Object.entries(desired).every(([key, value]) => JSON.stringify(comparable(existing[key])) === JSON.stringify(comparable(value)));
}

function entityId(kind: SeedEntityKind, entity: ApiEntity): string | undefined {
  const value = kind === "variable" ? entity.variableId : kind === "trigger" ? entity.triggerId : entity.tagId;
  return typeof value === "string" ? value : undefined;
}

function mutationTotal(summary: SeederSummary): number {
  return summary.variables.created + summary.variables.updated + summary.variables.deleted +
    summary.triggers.created + summary.triggers.updated + summary.triggers.deleted +
    summary.tags.created + summary.tags.updated + summary.tags.deleted;
}

function reportProgress(
  progress: ProgressState | undefined,
  action: SeederProgress["action"],
  kind: SeedEntityKind,
  name: string,
): void {
  if (!progress) return;
  progress.current += 1;
  progress.onProgress?.({ current: progress.current, total: progress.total, action, kind, name });
}

async function loadInventory(api: SeederApi): Promise<Inventory> {
  const [variable, trigger, tag] = await Promise.all([api.list("variable"), api.list("trigger"), api.list("tag")]);
  return { variable, trigger, tag };
}

async function upsertEntities(
  api: SeederApi,
  kind: SeedEntityKind,
  desiredEntities: Array<{ name: string; body: Record<string, unknown> }>,
  inventory: ApiEntity[],
  dryRun: boolean,
  counts: MutationCount,
  progress?: ProgressState,
): Promise<Map<string, string>> {
  const byName = new Map(inventory.map((entity) => [entity.name, entity]));
  const ids = new Map<string, string>();
  for (const desired of desiredEntities) {
    const existing = byName.get(desired.name);
    if (!existing) {
      counts.created += 1;
      if (dryRun) {
        ids.set(desired.name, `dry-run-${kind}-${ids.size + 1}`);
        continue;
      }
      reportProgress(progress, "Creating", kind, desired.name);
      const created = await api.create(kind, desired.body);
      const createdId = entityId(kind, created);
      if (!createdId) throw new Error(`GTM created ${desired.name} without returning its ${kind} ID.`);
      ids.set(desired.name, createdId);
      byName.set(desired.name, created);
      continue;
    }
    const existingId = entityId(kind, existing);
    if (!existingId) throw new Error(`Existing ${kind} ${desired.name} has no API identifier.`);
    ids.set(desired.name, existingId);
    if (matchesDesired(existing, desired.body)) {
      counts.unchanged += 1;
      continue;
    }
    counts.updated += 1;
    if (!dryRun) {
      reportProgress(progress, "Updating", kind, desired.name);
      await api.update(kind, existing.path, desired.body, existing.fingerprint);
    }
  }
  return ids;
}

function expectedSummary(mode: "baseline" | "changes", fixture: SeedFixture, dryRun: boolean): SeederSummary {
  const materialized = materializeFixtureForAnalysis(fixture);
  const graph = buildDependencyGraph(materialized.workspace);
  const sharedTracking = transitiveDependents(graph, `variable:${seededName("Shared Tracking ID")}`);
  const purchaseId = materialized.ids.triggers.get(seededName("Shared Purchase Event"))!;
  const purchaseDependents = directDependents(graph, `trigger:${purchaseId}`);
  const nestedBase = transitiveDependents(graph, `variable:${seededName("Nested Base")}`);
  return {
    mode,
    dryRun,
    variables: emptyCount(),
    triggers: emptyCount(),
    tags: emptyCount(),
    dependencyRelationships: [
      `${graph.relationships.length} resolved dependency edges in the generated workspace graph`,
      `${purchaseDependents.length} tags use ${seededName("Shared Purchase Event")}`,
      `${nestedBase.length} entities are downstream of the Nested Base → Nested Middle → Nested Final chain`,
    ],
    expectedRiskFindings:
      mode === "changes"
        ? [
            "High blast radius for Shared Tracking ID",
            "High blast radius for Shared Purchase Event",
            "New Custom HTML tag firing on All Pages",
            "Measurement identifier changed",
            "Tag firing option changed",
            "Required consent removed",
          ]
        : ["No elevated findings are expected after the coherent baseline is published"],
    expectedBlastRadius: [
      `${seededName("Shared Tracking ID")} has ${sharedTracking.length} direct/transitive dependents`,
      `${seededName("Shared Purchase Event")} is used by ${purchaseDependents.length} tags`,
    ],
  };
}

function assertBaselinePresent(inventory: Inventory): void {
  const baseline = createBaselineFixture();
  const expected: Array<[SeedEntityKind, string[]]> = [
    ["variable", baseline.variables.map((entity) => entity.name)],
    ["trigger", baseline.triggers.map((entity) => entity.name)],
    ["tag", baseline.tags.map((entity) => entity.name)],
  ];
  const missing = expected.flatMap(([kind, names]) => {
    const existing = new Set(inventory[kind].map((entity) => entity.name));
    return names.filter((name) => !existing.has(name)).map((name) => `${kind}: ${name}`);
  });
  if (missing.length) {
    throw new Error(
      `The changes phase requires a published baseline in this workspace. Missing ${missing.length} seeded entities; first missing: ${missing[0]}.`,
    );
  }
}

function changeEntityName(change: Record<string, unknown>): string | undefined {
  for (const kind of ["variable", "trigger", "tag"] as const) {
    const entity = change[kind];
    if (entity && typeof entity === "object" && typeof (entity as Record<string, unknown>).name === "string") {
      return (entity as Record<string, unknown>).name as string;
    }
  }
  return undefined;
}

function changesPhaseAlreadyStarted(inventory: Inventory): boolean {
  return inventory.tag.some((entity) => entity.name === seededName("CHANGED New All Pages Custom HTML"));
}

async function upsertFixture(
  api: SeederApi,
  fixture: SeedFixture,
  inventory: Inventory,
  summary: SeederSummary,
  progress?: ProgressState,
): Promise<SeederSummary> {
  validateFixturePayloads(fixture);
  await upsertEntities(
    api,
    "variable",
    fixture.variables.map((entity) => ({ name: entity.name, body: buildVariablePayload(entity) })),
    inventory.variable,
    summary.dryRun,
    summary.variables,
    progress,
  );
  const triggerIds = await upsertEntities(
    api,
    "trigger",
    fixture.triggers.map((entity) => ({ name: entity.name, body: buildTriggerPayload(entity) })),
    inventory.trigger,
    summary.dryRun,
    summary.triggers,
    progress,
  );
  await upsertEntities(
    api,
    "tag",
    fixture.tags.map((entity) => ({ name: entity.name, body: buildTagPayload(entity, triggerIds) })),
    inventory.tag,
    summary.dryRun,
    summary.tags,
    progress,
  );
  return summary;
}

async function runFixture(
  api: SeederApi,
  mode: "baseline" | "changes",
  fixture: SeedFixture,
  inventory: Inventory,
  dryRun: boolean,
  options: SeederRunOptions,
): Promise<SeederSummary> {
  const dryRunPlan = await upsertFixture(api, fixture, inventory, expectedSummary(mode, fixture, true));
  const plan = { ...dryRunPlan, dryRun };
  options.onPlan?.(plan);
  if (dryRun) return plan;

  const progress: ProgressState = {
    current: 0,
    total: mutationTotal(plan),
    onProgress: options.onProgress,
  };
  return upsertFixture(api, fixture, inventory, expectedSummary(mode, fixture, false), progress);
}

export async function runBaseline(api: SeederApi, dryRun: boolean, options: SeederRunOptions = {}): Promise<SeederSummary> {
  const fixture = createBaselineFixture();
  const inventory = await loadInventory(api);
  return runFixture(api, "baseline", fixture, inventory, dryRun, options);
}

export async function runChanges(api: SeederApi, dryRun: boolean, options: SeederRunOptions = {}): Promise<SeederSummary> {
  const fixture = createChangesFixture();
  const inventory = await loadInventory(api);
  assertBaselinePresent(inventory);
  const status = await api.getWorkspaceStatus();
  const hasUnpublishedSeededChanges = (status.workspaceChange ?? []).some((change) => {
    const name = changeEntityName(change);
    return name ? isSeederOwnedName(name) : false;
  });
  if (hasUnpublishedSeededChanges && !changesPhaseAlreadyStarted(inventory)) {
    throw new Error("The selected workspace still contains unpublished baseline seeder changes. Publish the baseline manually before running the changes phase.");
  }
  return runFixture(api, "changes", fixture, inventory, dryRun, options);
}

export async function runCleanup(
  api: SeederApi,
  workspacePath: string,
  dryRun: boolean,
  options: SeederRunOptions = {},
): Promise<SeederSummary> {
  const inventory = await loadInventory(api);
  const summary: SeederSummary = {
    mode: "cleanup",
    dryRun,
    variables: emptyCount(),
    triggers: emptyCount(),
    tags: emptyCount(),
    dependencyRelationships: [],
    expectedRiskFindings: ["Cleanup creates workspace deletions only; publishing those deletions remains a manual decision"],
    expectedBlastRadius: [],
  };
  const ownedByKind = new Map<SeedEntityKind, ApiEntity[]>();
  for (const kind of ["tag", "trigger", "variable"] as const) {
    const owned = inventory[kind].filter(
      (entity) => isSeederOwnedName(entity.name) && entity.path.startsWith(`${workspacePath}/`),
    );
    ownedByKind.set(kind, owned);
    summary[`${kind}s`].deleted = owned.length;
  }
  options.onPlan?.(summary);
  if (dryRun) return summary;

  const progress: ProgressState = { current: 0, total: mutationTotal(summary), onProgress: options.onProgress };
  for (const kind of ["tag", "trigger", "variable"] as const) {
    const owned = ownedByKind.get(kind) ?? [];
    for (const entity of owned) {
      reportProgress(progress, "Deleting", kind, entity.name);
      await api.delete(kind, entity.path);
    }
  }
  return summary;
}
