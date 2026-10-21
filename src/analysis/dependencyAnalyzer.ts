import type { GtmBuiltInVariable, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm";
import { resolveBuiltInVariableReference } from "./builtInVariableReferences";

export type TriggerRole = "firing" | "blocking";

export interface TriggerDependency {
  trigger: GtmTrigger;
  roles: TriggerRole[];
}

export interface UnresolvedReference {
  kind: "variable" | "trigger" | "tag";
  reference: string;
  sourceType: "tag" | "trigger" | "variable";
  sourceName: string;
}

export interface DependencyAnalysis {
  triggers: TriggerDependency[];
  variables: GtmVariable[];
  builtInVariables: GtmBuiltInVariable[];
  unresolvedReferences: UnresolvedReference[];
}

interface ReferenceSource {
  sourceType: UnresolvedReference["sourceType"];
  sourceName: string;
}

const VARIABLE_REFERENCE = /{{\s*([^{}]+?)\s*}}/g;

export function findVariableReferences(value: unknown): string[] {
  const references = new Set<string>();
  const seen = new WeakSet<object>();

  const visit = (current: unknown): void => {
    if (typeof current === "string") {
      for (const match of current.matchAll(VARIABLE_REFERENCE)) {
        const name = match[1]?.trim();
        if (name) references.add(name);
      }
      return;
    }
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach(visit);
    } else {
      Object.values(current).forEach(visit);
    }
  };

  visit(value);
  return [...references];
}

export function analyzeDependencies(
  tag: GtmTag,
  triggers: GtmTrigger[],
  variables: GtmVariable[],
  builtInVariables: GtmBuiltInVariable[] = [],
): DependencyAnalysis {
  const triggersById = new Map(triggers.map((trigger) => [trigger.triggerId, trigger]));
  const variablesByName = new Map(variables.map((variable) => [variable.name, variable]));
  const resolvedTriggers = new Map<string, TriggerDependency>();
  const resolvedVariables = new Map<string, GtmVariable>();
  const resolvedBuiltIns = new Map<string, GtmBuiltInVariable>();
  const unresolved = new Map<string, UnresolvedReference>();
  const visitedVariableNames = new Set<string>();

  const addUnresolved = (kind: UnresolvedReference["kind"], reference: string, source: ReferenceSource): void => {
    const key = `${kind}\0${reference}\0${source.sourceType}\0${source.sourceName}`;
    unresolved.set(key, { kind, reference, ...source });
  };

  const resolveReferences = (value: unknown, source: ReferenceSource): void => {
    for (const reference of findVariableReferences(value)) {
      const variable = variablesByName.get(reference);
      if (variable) {
        resolvedVariables.set(variable.variableId || variable.name, variable);
        if (!visitedVariableNames.has(variable.name)) {
          visitedVariableNames.add(variable.name);
          resolveReferences(variable, { sourceType: "variable", sourceName: variable.name });
        }
        continue;
      }
      const builtIn = resolveBuiltInVariableReference(reference, builtInVariables);
      if (builtIn) {
        resolvedBuiltIns.set(builtIn.path || `${builtIn.type ?? "built-in"}:${builtIn.name}`, builtIn);
        continue;
      }
      addUnresolved("variable", reference, source);
    }
  };

  const resolveTriggerIds = (ids: string[] | undefined, role: TriggerRole): void => {
    for (const id of ids ?? []) {
      const trigger = triggersById.get(id);
      if (!trigger) {
        addUnresolved("trigger", id, { sourceType: "tag", sourceName: tag.name });
        continue;
      }
      const existing = resolvedTriggers.get(id);
      if (existing) {
        if (!existing.roles.includes(role)) existing.roles.push(role);
      } else {
        resolvedTriggers.set(id, { trigger, roles: [role] });
        resolveReferences(trigger, { sourceType: "trigger", sourceName: trigger.name });
      }
    }
  };

  resolveTriggerIds(tag.firingTriggerId, "firing");
  resolveTriggerIds(tag.blockingTriggerId, "blocking");
  resolveReferences(tag, { sourceType: "tag", sourceName: tag.name });

  for (const relatedTag of [...(tag.setupTag ?? []), ...(tag.teardownTag ?? [])]) {
    if (relatedTag.tagName) {
      addUnresolved("tag", relatedTag.tagName, { sourceType: "tag", sourceName: tag.name });
    }
  }

  return {
    triggers: [...resolvedTriggers.values()],
    variables: [...resolvedVariables.values()],
    builtInVariables: [...resolvedBuiltIns.values()],
    unresolvedReferences: [...unresolved.values()],
  };
}
