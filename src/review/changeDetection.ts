import type { GtmWorkspaceStatus, WorkspaceEntities } from "../types/gtm";
import { allWorkspaceEntities, entityId, entityKey, entityName, statusEntityValue, type ReviewEntity } from "./entity";
import type { ChangeType, EntityKind, WorkspaceChange } from "./model";
import { diffEntities } from "./normalization";

interface EntityIndex {
  byKey: Map<string, ReviewEntity>;
  byId: Map<string, ReviewEntity>;
}

function buildIndex(entities: WorkspaceEntities | undefined): EntityIndex {
  const index: EntityIndex = { byKey: new Map(), byId: new Map() };
  if (!entities) return index;
  for (const { kind, entity } of allWorkspaceEntities(entities)) {
    index.byKey.set(entityKey(kind, entity), entity);
    const id = entityId(kind, entity);
    if (id) index.byId.set(`${kind}:${id}`, entity);
  }
  return index;
}

function findEntity(index: EntityIndex, kind: EntityKind, entity: ReviewEntity): ReviewEntity | undefined {
  const id = entityId(kind, entity);
  return (id ? index.byId.get(`${kind}:${id}`) : undefined) ?? index.byKey.get(entityKey(kind, entity));
}

function changeType(status: string): ChangeType | undefined {
  if (status === "added" || status === "deleted") return status;
  return status === "updated" ? "modified" : undefined;
}

export function detectWorkspaceChanges(
  status: GtmWorkspaceStatus,
  workspace: WorkspaceEntities,
  published?: WorkspaceEntities,
): WorkspaceChange[] {
  const currentIndex = buildIndex(workspace);
  const publishedIndex = buildIndex(published);
  const changes: WorkspaceChange[] = [];

  for (const statusChange of status.workspaceChange ?? []) {
    const type = changeType(statusChange.changeStatus);
    const value = statusEntityValue(statusChange);
    if (!type || !value) continue;
    const { kind, entity } = value;
    const current = findEntity(currentIndex, kind, entity);
    const baseline = findEntity(publishedIndex, kind, entity);
    const before = type === "added" ? undefined : baseline ?? (type === "deleted" ? entity : undefined);
    const after = type === "deleted" ? undefined : current ?? entity;
    const identity = after ?? before ?? entity;
    changes.push({
      key: entityKey(kind, identity),
      entityKind: kind,
      changeType: type,
      id: entityId(kind, identity),
      name: entityName(identity),
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      fieldChanges: diffEntities(before, after),
    });
  }

  return changes.sort((left, right) => left.name.localeCompare(right.name));
}
