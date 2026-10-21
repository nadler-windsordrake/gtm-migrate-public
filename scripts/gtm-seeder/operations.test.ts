import { describe, expect, it } from "vitest";
import { createBaselineFixture, materializeFixtureForAnalysis } from "./fixture";
import { runBaseline, runChanges, runCleanup } from "./operations";
import {
  seededName,
  type ApiEntity,
  type SeederApi,
  type SeederWorkspaceStatus,
  type SeedEntityKind,
  type WorkspaceIdentity,
} from "./types";

const workspacePath = "accounts/1/containers/2/workspaces/3";

class FakeApi implements SeederApi {
  readonly entities: Record<SeedEntityKind, ApiEntity[]>;
  readonly mutations: Array<{ operation: "create" | "update" | "delete"; kind: SeedEntityKind; path?: string }> = [];
  readonly listCalls: Record<SeedEntityKind, number> = { variable: 0, trigger: 0, tag: 0 };
  readonly status: SeederWorkspaceStatus;

  constructor(entities: Partial<Record<SeedEntityKind, ApiEntity[]>> = {}, status: SeederWorkspaceStatus = { workspaceChange: [] }) {
    this.entities = { variable: entities.variable ?? [], trigger: entities.trigger ?? [], tag: entities.tag ?? [] };
    this.status = status;
  }

  async getWorkspaceIdentity(): Promise<WorkspaceIdentity> {
    return {
      accountId: "1",
      accountName: "Test",
      containerId: "2",
      containerName: "Test container",
      workspaceId: "3",
      workspaceName: "Test workspace",
      workspacePath,
    };
  }

  async list(kind: SeedEntityKind): Promise<ApiEntity[]> {
    this.listCalls[kind] += 1;
    return this.entities[kind];
  }

  async getWorkspaceStatus(): Promise<SeederWorkspaceStatus> {
    return this.status;
  }

  async create(kind: SeedEntityKind, body: Record<string, unknown>): Promise<ApiEntity> {
    this.mutations.push({ operation: "create", kind });
    const id = `${kind}-${this.entities[kind].length + 1}`;
    const entity = {
      ...body,
      name: String(body.name),
      path: `${workspacePath}/${kind}s/${id}`,
      ...(kind === "variable" ? { variableId: id } : kind === "trigger" ? { triggerId: id } : { tagId: id }),
    } as ApiEntity;
    this.entities[kind].push(entity);
    return entity;
  }

  async update(kind: SeedEntityKind, path: string, body: Record<string, unknown>, _fingerprint?: string): Promise<ApiEntity> {
    void body;
    void _fingerprint;
    this.mutations.push({ operation: "update", kind, path });
    return this.entities[kind].find((entity) => entity.path === path)!;
  }

  async delete(kind: SeedEntityKind, path: string): Promise<void> {
    this.mutations.push({ operation: "delete", kind, path });
  }
}

describe("GTM seeder operations", () => {
  it("plans the full baseline without mutating in dry-run mode", async () => {
    const api = new FakeApi();
    const result = await runBaseline(api, true);
    expect(result.variables.created).toBe(12);
    expect(result.triggers.created).toBe(10);
    expect(result.tags.created).toBe(24);
    expect(api.mutations).toEqual([]);
    expect(api.listCalls).toEqual({ variable: 1, trigger: 1, tag: 1 });
  });

  it("reconciles a partially applied baseline without duplicates", async () => {
    const materialized = materializeFixtureForAnalysis(createBaselineFixture()).workspace;
    const api = new FakeApi({
      variable: materialized.variables.map((entity) => ({ ...entity, path: `${workspacePath}/variables/${entity.variableId}` })),
      trigger: materialized.triggers.map((entity) => ({ ...entity, path: `${workspacePath}/triggers/${entity.triggerId}` })),
      tag: materialized.tags.slice(0, 9).map((entity) => ({ ...entity, path: `${workspacePath}/tags/${entity.tagId}` })),
    });
    const plans: number[] = [];
    const progress: number[] = [];

    const result = await runBaseline(api, false, {
      onPlan: (plan) => plans.push(plan.tags.created),
      onProgress: (item) => progress.push(item.current),
    });

    expect(result.variables.unchanged).toBe(12);
    expect(result.triggers.unchanged).toBe(10);
    expect(result.tags.unchanged).toBe(9);
    expect(result.tags.created).toBe(15);
    expect(plans).toEqual([15]);
    expect(progress).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(api.mutations.filter((mutation) => mutation.operation === "create" && mutation.kind === "tag")).toHaveLength(15);
    expect(api.entities.tag).toHaveLength(24);
    expect(new Set(api.entities.tag.map((entity) => entity.name)).size).toBe(24);
    expect(api.listCalls).toEqual({ variable: 1, trigger: 1, tag: 1 });
  });

  it("cleanup selects only correctly prefixed resources inside the target workspace", async () => {
    const api = new FakeApi({
      variable: [
        { path: `${workspacePath}/variables/1`, name: seededName("Owned variable"), variableId: "1" },
        { path: `${workspacePath}/variables/2`, name: "Production variable", variableId: "2" },
        { path: `${workspacePath}/variables/3`, name: "[GTM MIGRATE TEST]Malformed", variableId: "3" },
        { path: "accounts/9/containers/9/workspaces/9/variables/4", name: seededName("Wrong workspace"), variableId: "4" },
      ],
      trigger: [{ path: `${workspacePath}/triggers/1`, name: seededName("Owned trigger"), triggerId: "1" }],
      tag: [{ path: `${workspacePath}/tags/1`, name: seededName("Owned tag"), tagId: "1" }],
    });
    const dryRun = await runCleanup(api, workspacePath, true);
    expect(dryRun.variables.deleted).toBe(1);
    expect(dryRun.triggers.deleted).toBe(1);
    expect(dryRun.tags.deleted).toBe(1);
    expect(api.mutations).toEqual([]);

    await runCleanup(api, workspacePath, false);
    expect(api.mutations).toEqual([
      { operation: "delete", kind: "tag", path: `${workspacePath}/tags/1` },
      { operation: "delete", kind: "trigger", path: `${workspacePath}/triggers/1` },
      { operation: "delete", kind: "variable", path: `${workspacePath}/variables/1` },
    ]);
  });

  it("refuses the changes phase while the seeded baseline is still unpublished", async () => {
    const materialized = materializeFixtureForAnalysis(createBaselineFixture()).workspace;
    const api = new FakeApi(
      {
        variable: materialized.variables.map((entity) => ({ ...entity, path: `${workspacePath}/variables/${entity.variableId}` })),
        trigger: materialized.triggers.map((entity) => ({ ...entity, path: `${workspacePath}/triggers/${entity.triggerId}` })),
        tag: materialized.tags.map((entity) => ({ ...entity, path: `${workspacePath}/tags/${entity.tagId}` })),
      },
      { workspaceChange: [{ changeStatus: "added", variable: materialized.variables[0] }] },
    );
    await expect(runChanges(api, true)).rejects.toThrow("Publish the baseline manually");
    expect(api.mutations).toEqual([]);
  });
});
