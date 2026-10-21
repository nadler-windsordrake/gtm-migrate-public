import type { FieldChange } from "./model";

const VOLATILE_KEYS = new Set([
  "path",
  "accountId",
  "containerId",
  "workspaceId",
  "fingerprint",
  "tagManagerUrl",
]);

export function normalizeEntity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeEntity);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    const normalized = normalizeEntity((value as Record<string, unknown>)[key]);
    if (normalized !== undefined) output[key] = normalized;
  }
  return output;
}

export function entitiesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeEntity(left)) === JSON.stringify(normalizeEntity(right));
}

export function diffEntities(before: unknown, after: unknown): FieldChange[] {
  const changes: FieldChange[] = [];
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const keyed = [...left, ...right].every(
        (item) => item !== null && typeof item === "object" && typeof (item as Record<string, unknown>).key === "string",
      );
      if (keyed) {
        const leftItems = new Map(left.map((item) => [String((item as Record<string, unknown>).key), item]));
        const rightItems = new Map(right.map((item) => [String((item as Record<string, unknown>).key), item]));
        const keys = new Set([...leftItems.keys(), ...rightItems.keys()]);
        for (const key of [...keys].sort()) visit(leftItems.get(key), rightItems.get(key), `${path}[${key}]`);
        return;
      }
    }
    const leftObject = left !== null && typeof left === "object";
    const rightObject = right !== null && typeof right === "object";
    if (leftObject && rightObject && !Array.isArray(left) && !Array.isArray(right)) {
      const leftRecord = left as Record<string, unknown>;
      const rightRecord = right as Record<string, unknown>;
      const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
      for (const key of [...keys].sort()) visit(leftRecord[key], rightRecord[key], path ? `${path}.${key}` : key);
      return;
    }
    changes.push({
      path: path || "configuration",
      changeType: left === undefined ? "added" : right === undefined ? "removed" : "changed",
      ...(left === undefined ? {} : { before: left }),
      ...(right === undefined ? {} : { after: right }),
    });
  };
  visit(normalizeEntity(before), normalizeEntity(after), "");
  return changes;
}
