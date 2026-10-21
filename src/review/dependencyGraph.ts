import { findVariableReferences } from "../analysis/dependencyAnalyzer";
import { resolveBuiltInVariableReference } from "../analysis/builtInVariableReferences";
import type { GtmTag, WorkspaceEntities } from "../types/gtm";
import { allWorkspaceEntities, entityReference, type ReviewEntity } from "./entity";
import type { DependencyRelationship, EntityKind, EntityReference } from "./model";

export interface UnresolvedGraphReference {
  source: EntityReference;
  targetKey: string;
  referenceKind: "trigger" | "variable";
  reference: string;
}

export interface DependencyGraph {
  nodes: Map<string, EntityReference>;
  dependencies: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
  relationships: DependencyRelationship[];
  unresolved: UnresolvedGraphReference[];
}

function addEdge(
  graph: DependencyGraph,
  source: EntityReference,
  target: EntityReference,
  relation: DependencyRelationship["relation"],
  resolved: boolean,
): void {
  const dependencies = graph.dependencies.get(source.key) ?? new Set<string>();
  const isNew = !dependencies.has(target.key);
  dependencies.add(target.key);
  graph.dependencies.set(source.key, dependencies);
  const dependents = graph.dependents.get(target.key) ?? new Set<string>();
  dependents.add(source.key);
  graph.dependents.set(target.key, dependents);
  if (isNew) graph.relationships.push({ dependent: source, dependency: target, relation, resolved });
}

function missingReference(kind: "trigger" | "variable", reference: string): EntityReference {
  return {
    key: kind === "trigger" ? `trigger:${reference}` : `variable:${reference}`,
    entityKind: kind,
    ...(kind === "trigger" ? { id: reference } : {}),
    name: reference,
  };
}

export function buildDependencyGraph(workspace: WorkspaceEntities): DependencyGraph {
  const graph: DependencyGraph = {
    nodes: new Map(),
    dependencies: new Map(),
    dependents: new Map(),
    relationships: [],
    unresolved: [],
  };
  const variablesByName = new Map(workspace.variables.map((entity) => [entity.name, entity]));
  const triggersById = new Map(workspace.triggers.map((entity) => [entity.triggerId, entity]));

  for (const { kind, entity } of allWorkspaceEntities(workspace)) {
    const reference = entityReference(kind, entity);
    graph.nodes.set(reference.key, reference);
  }

  const connectVariables = (kind: EntityKind, entity: ReviewEntity): void => {
    const source = entityReference(kind, entity);
    for (const name of findVariableReferences(entity)) {
      const variable = variablesByName.get(name);
      const builtIn = resolveBuiltInVariableReference(name, workspace.builtInVariables);
      const target = variable
        ? entityReference("variable", variable)
        : builtIn
          ? entityReference("builtInVariable", builtIn)
          : missingReference("variable", name);
      addEdge(graph, source, target, "variable", Boolean(variable ?? builtIn));
      if (!variable && !builtIn) {
        graph.unresolved.push({ source, targetKey: target.key, referenceKind: "variable", reference: name });
      }
    }
  };

  for (const tag of workspace.tags) {
    const source = entityReference("tag", tag);
    for (const id of [...(tag.firingTriggerId ?? []), ...(tag.blockingTriggerId ?? [])]) {
      const trigger = triggersById.get(id);
      const target = trigger ? entityReference("trigger", trigger) : missingReference("trigger", id);
      addEdge(graph, source, target, "trigger", Boolean(trigger));
      if (!trigger) graph.unresolved.push({ source, targetKey: target.key, referenceKind: "trigger", reference: id });
    }
    connectVariables("tag", tag);
  }
  workspace.triggers.forEach((entity) => connectVariables("trigger", entity));
  workspace.variables.forEach((entity) => connectVariables("variable", entity));

  return graph;
}

function referencesForKeys(graph: DependencyGraph, keys: Iterable<string>): EntityReference[] {
  const references: EntityReference[] = [];
  for (const key of keys) {
    const node = graph.nodes.get(key) ?? graph.relationships.find((item) => item.dependency.key === key)?.dependency;
    if (node) references.push(node);
  }
  return references.sort((left, right) => left.name.localeCompare(right.name));
}

export function directDependencies(graph: DependencyGraph, key: string): EntityReference[] {
  return referencesForKeys(graph, graph.dependencies.get(key) ?? []);
}

export function directDependents(graph: DependencyGraph, key: string): EntityReference[] {
  return referencesForKeys(graph, graph.dependents.get(key) ?? []);
}

export function transitiveDependents(graph: DependencyGraph, key: string): EntityReference[] {
  const visited = new Set<string>([key]);
  const queue = [...(graph.dependents.get(key) ?? [])];
  const found = new Set<string>();
  while (queue.length) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    found.add(next);
    queue.push(...(graph.dependents.get(next) ?? []));
  }
  return referencesForKeys(graph, found);
}

export function isAllPagesTrigger(trigger: ReviewEntity): boolean {
  const value = trigger as Record<string, unknown>;
  if (String(value.type ?? "").toLowerCase() !== "pageview") return false;
  return [value.filter, value.autoEventFilter, value.customEventFilter].every(
    (conditions) => !Array.isArray(conditions) || conditions.length === 0,
  );
}

export function tagFiresOnAllPages(tag: GtmTag, workspace: WorkspaceEntities): boolean {
  const triggers = new Map(workspace.triggers.map((trigger) => [trigger.triggerId, trigger]));
  return (tag.firingTriggerId ?? []).some((id) => {
    const trigger = triggers.get(id);
    return trigger ? isAllPagesTrigger(trigger) : false;
  });
}

export function keyForChange(kind: EntityKind, id: string | undefined, name: string): string {
  return kind === "variable" || kind === "builtInVariable" ? `${kind}:${name}` : `${kind}:${id ?? name}`;
}
