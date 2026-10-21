import type { SeedFixture, SeedTag, SeedTrigger, SeedVariable } from "./types";
import { GTM_PARAMETER_TYPES } from "./parameters";

const OMIT = Symbol("omit-empty-seeder-value");

function sanitizeValue(value: unknown): unknown | typeof OMIT {
  if (typeof value === "string" && value.trim() === "") return OMIT;
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((item): item is unknown => item !== OMIT);
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  if (typeof record.key === "string" && typeof record.value === "string" && record.value.trim() === "") {
    return OMIT;
  }

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, child]) => [key, sanitizeValue(child)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== OMIT),
  );
}

export function sanitizePayloadForApi(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeValue(payload);
  if (!sanitized || sanitized === OMIT || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    throw new Error("Seeder payload must be a non-empty object.");
  }
  return sanitized as Record<string, unknown>;
}

function assertNonEmptyString(record: Record<string, unknown>, key: string, context: string): void {
  if (typeof record[key] !== "string" || record[key].trim() === "") {
    throw new Error(`${context} requires a non-empty ${key}.`);
  }
}

function assertNoEmptyStrings(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (value.trim() === "") throw new Error(`${path} must not be empty.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoEmptyStrings(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => assertNoEmptyStrings(child, `${path}.${key}`));
}

const parameterTypes = new Set<string>(GTM_PARAMETER_TYPES);
const scalarParameterTypes = new Set<string>(["template", "integer", "boolean", "triggerReference", "tagReference"]);
const consentStatuses = new Set<string>(["notSet", "notNeeded", "needed"]);

function assertParameter(value: unknown, path: string, requireKey: boolean): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a GTM Parameter object.`);
  }
  const parameter = value as Record<string, unknown>;
  const type = parameter.type;
  if (typeof type !== "string" || !parameterTypes.has(type)) {
    throw new Error(
      `${path} has unsupported GTM Parameter.type ${JSON.stringify(type)}. Supported types: ${GTM_PARAMETER_TYPES.join(", ")}.`,
    );
  }
  if (requireKey) assertNonEmptyString(parameter, "key", path);
  if (parameter.key !== undefined && (typeof parameter.key !== "string" || parameter.key.trim() === "")) {
    throw new Error(`${path}.key must not be empty when provided.`);
  }

  if (scalarParameterTypes.has(type)) {
    assertNonEmptyString(parameter, "value", path);
    if (parameter.list !== undefined || parameter.map !== undefined) {
      throw new Error(`${path} must not contain list or map for GTM Parameter.type ${type}.`);
    }
    if (type === "boolean" && parameter.value !== "true" && parameter.value !== "false") {
      throw new Error(`${path}.value must be "true" or "false" for a boolean parameter.`);
    }
    if (type === "integer" && !/^-?\d+$/.test(parameter.value as string)) {
      throw new Error(`${path}.value must be a base-10 integer for an integer parameter.`);
    }
    return;
  }

  const collectionKey = type === "list" ? "list" : "map";
  const otherCollectionKey = type === "list" ? "map" : "list";
  if (parameter.value !== undefined || parameter[otherCollectionKey] !== undefined) {
    throw new Error(`${path} must contain only ${collectionKey} for GTM Parameter.type ${type}.`);
  }
  const collection = parameter[collectionKey];
  if (!Array.isArray(collection) || collection.length === 0) {
    throw new Error(`${path}.${collectionKey} must contain at least one GTM Parameter.`);
  }
  collection.forEach((child, index) => assertParameter(child, `${path}.${collectionKey}[${index}]`, type === "map"));
}

function assertConsentSettings(value: unknown, path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a ConsentSetting object.`);
  }
  const consentSettings = value as Record<string, unknown>;
  const status = consentSettings.consentStatus;
  if (typeof status !== "string" || !consentStatuses.has(status)) {
    throw new Error(`${path}.consentStatus must be notSet, notNeeded, or needed.`);
  }
  if (status !== "needed") {
    if (consentSettings.consentType !== undefined) {
      throw new Error(`${path}.consentType must be omitted unless consentStatus is needed.`);
    }
    return;
  }

  assertParameter(consentSettings.consentType, `${path}.consentType`, false);
  const consentType = consentSettings.consentType as Record<string, unknown>;
  if (consentType.type !== "list") {
    throw new Error(`${path}.consentType must be a GTM Parameter of type list.`);
  }
  const list = consentType.list as Array<Record<string, unknown>>;
  list.forEach((item, index) => {
    if (item.type !== "template") {
      throw new Error(`${path}.consentType.list[${index}] must use GTM Parameter.type template.`);
    }
  });
}

function assertNestedSchemas(payload: Record<string, unknown>, context: string): void {
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.parameter)) {
      record.parameter.forEach((parameter, index) =>
        assertParameter(parameter, `${context} ${path}.parameter[${index}]`, true),
      );
    }
    if (record.consentSettings !== undefined) {
      assertConsentSettings(record.consentSettings, `${context} ${path}.consentSettings`);
    }
    Object.entries(record).forEach(([key, child]) => {
      if (key !== "parameter" && key !== "consentSettings") visit(child, `${path}.${key}`);
    });
  };
  visit(payload, "payload");
}

function assertEntityPayload(payload: Record<string, unknown>, kind: string): void {
  const name = typeof payload.name === "string" ? payload.name : "(unnamed)";
  assertNonEmptyString(payload, "name", `${kind} payload`);
  assertNonEmptyString(payload, "type", `${kind} ${name}`);
  assertNoEmptyStrings(payload, `${kind} ${name}`);
  assertNestedSchemas(payload, `${kind} ${name}`);
}

export function buildVariablePayload(variable: SeedVariable): Record<string, unknown> {
  const payload = sanitizePayloadForApi({ ...variable });
  assertEntityPayload(payload, "Variable");
  return payload;
}

export function buildTriggerPayload(trigger: SeedTrigger): Record<string, unknown> {
  const payload = sanitizePayloadForApi({ ...trigger });
  assertEntityPayload(payload, "Trigger");
  return payload;
}

export function buildTagPayload(tag: SeedTag, triggerIds: Map<string, string>): Record<string, unknown> {
  const firingTriggerId = tag.firingTriggerNames.map((name) => {
    const id = triggerIds.get(name);
    if (!id) throw new Error(`Cannot resolve firing trigger ${name} for ${tag.name}.`);
    return id;
  });
  const blockingTriggerId = tag.blockingTriggerNames?.map((name) => {
    const id = triggerIds.get(name);
    if (!id) throw new Error(`Cannot resolve blocking trigger ${name} for ${tag.name}.`);
    return id;
  });
  const body: Record<string, unknown> = { ...tag };
  delete body.firingTriggerNames;
  delete body.blockingTriggerNames;
  const payload = sanitizePayloadForApi({
    ...body,
    firingTriggerId,
    ...(blockingTriggerId ? { blockingTriggerId } : {}),
  });
  assertEntityPayload(payload, "Tag");

  if (payload.type === "gaawe") {
    const parameters = Array.isArray(payload.parameter) ? payload.parameter : [];
    const measurementIdOverride = parameters.find(
      (parameter) =>
        parameter &&
        typeof parameter === "object" &&
        !Array.isArray(parameter) &&
        (parameter as Record<string, unknown>).key === "measurementIdOverride",
    ) as Record<string, unknown> | undefined;
    if (typeof measurementIdOverride?.value !== "string" || measurementIdOverride.value.trim() === "") {
      throw new Error(`GA4 Event tag ${tag.name} requires a non-empty measurementIdOverride parameter.`);
    }
  }
  return payload;
}

export function validateFixturePayloads(fixture: SeedFixture): void {
  fixture.variables.forEach(buildVariablePayload);
  fixture.triggers.forEach(buildTriggerPayload);
  const triggerIds = new Map(fixture.triggers.map((trigger, index) => [trigger.name, `preflight-trigger-${index + 1}`]));
  fixture.tags.forEach((tag) => buildTagPayload(tag, triggerIds));
}
