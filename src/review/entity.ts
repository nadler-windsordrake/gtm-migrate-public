import type {
  GtmBuiltInVariable,
  GtmContainerVersion,
  GtmCustomTemplate,
  GtmTag,
  GtmTrigger,
  GtmVariable,
  GtmWorkspaceStatusEntity,
  WorkspaceEntities,
} from "../types/gtm";
import type { EntityKind, EntityReference } from "./model";

export type ReviewEntity = GtmTag | GtmTrigger | GtmVariable | GtmBuiltInVariable | GtmCustomTemplate | Record<string, unknown>;

export function entitiesFromVersion(version: GtmContainerVersion): WorkspaceEntities {
  return {
    tags: version.tag ?? [],
    triggers: version.trigger ?? [],
    variables: version.variable ?? [],
    builtInVariables: version.builtInVariable ?? [],
    templates: version.customTemplate ?? [],
  };
}

export function statusEntityValue(status: GtmWorkspaceStatusEntity): { kind: EntityKind; entity: ReviewEntity } | undefined {
  if (status.tag) return { kind: "tag", entity: status.tag };
  if (status.trigger) return { kind: "trigger", entity: status.trigger };
  if (status.variable) return { kind: "variable", entity: status.variable };
  if (status.builtInVariable) return { kind: "builtInVariable", entity: status.builtInVariable };
  if (status.customTemplate) return { kind: "template", entity: status.customTemplate };
  const other = status.folder ?? status.client ?? status.transformation ?? status.zone ?? status.gtagConfig;
  return other ? { kind: "other", entity: other } : undefined;
}

export function entityId(kind: EntityKind, entity: ReviewEntity): string | undefined {
  const value = entity as Record<string, unknown>;
  const candidate =
    kind === "tag"
      ? value.tagId
      : kind === "trigger"
        ? value.triggerId
        : kind === "variable"
          ? value.variableId
          : kind === "template"
            ? value.templateId
            : kind === "builtInVariable"
              ? value.type
              : value.folderId ?? value.clientId ?? value.transformationId ?? value.zoneId ?? value.gtagConfigId;
  return typeof candidate === "string" ? candidate : undefined;
}

export function entityName(entity: ReviewEntity, fallback = "Unnamed entity"): string {
  const name = (entity as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name : fallback;
}

export function entityKey(kind: EntityKind, entity: ReviewEntity): string {
  const id = entityId(kind, entity);
  const name = entityName(entity);
  if (kind === "variable" || kind === "builtInVariable") return `${kind}:${name}`;
  return `${kind}:${id ?? name}`;
}

export function entityReference(kind: EntityKind, entity: ReviewEntity): EntityReference {
  return { key: entityKey(kind, entity), entityKind: kind, id: entityId(kind, entity), name: entityName(entity) };
}

export function allWorkspaceEntities(workspace: WorkspaceEntities): Array<{ kind: EntityKind; entity: ReviewEntity }> {
  return [
    ...workspace.tags.map((entity) => ({ kind: "tag" as const, entity })),
    ...workspace.triggers.map((entity) => ({ kind: "trigger" as const, entity })),
    ...workspace.variables.map((entity) => ({ kind: "variable" as const, entity })),
    ...workspace.builtInVariables.map((entity) => ({ kind: "builtInVariable" as const, entity })),
    ...workspace.templates.map((entity) => ({ kind: "template" as const, entity })),
  ];
}
