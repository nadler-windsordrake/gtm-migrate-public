export const GTM_PARAMETER_TYPES = [
  "template",
  "integer",
  "boolean",
  "list",
  "map",
  "triggerReference",
  "tagReference",
] as const;

export type SeedParameterType = (typeof GTM_PARAMETER_TYPES)[number];

interface SeedScalarParameter {
  [key: string]: unknown;
  type: "template" | "integer" | "boolean" | "triggerReference" | "tagReference";
  key?: string;
  value: string;
  list?: never;
  map?: never;
}

interface SeedListParameter {
  [key: string]: unknown;
  type: "list";
  key?: string;
  value?: never;
  list: SeedParameter[];
  map?: never;
}

interface SeedMapParameter {
  [key: string]: unknown;
  type: "map";
  key?: string;
  value?: never;
  list?: never;
  map: SeedParameter[];
}

export type SeedParameter = SeedScalarParameter | SeedListParameter | SeedMapParameter;

export type SeedConsentType =
  | "ad_storage"
  | "ad_user_data"
  | "ad_personalization"
  | "analytics_storage"
  | "functionality_storage"
  | "personalization_storage"
  | "security_storage";

export interface SeedConsentSettings {
  consentStatus: "notSet" | "notNeeded" | "needed";
  consentType?: SeedParameter;
}

function scalarParameter(
  type: SeedScalarParameter["type"],
  value: string,
  key?: string,
): SeedScalarParameter {
  return { type, ...(key === undefined ? {} : { key }), value };
}

export function templateParameter(key: string, value: string): SeedParameter {
  return scalarParameter("template", value, key);
}

export function integerParameter(key: string, value: number): SeedParameter {
  return scalarParameter("integer", String(value), key);
}

export function booleanParameter(key: string, value: boolean): SeedParameter {
  return scalarParameter("boolean", String(value), key);
}

export function templateListItem(value: string): SeedParameter {
  return scalarParameter("template", value);
}

export function listParameter(list: SeedParameter[], key?: string): SeedParameter {
  return { type: "list", ...(key === undefined ? {} : { key }), list };
}

export function neededConsentSettings(consentTypes: SeedConsentType[]): SeedConsentSettings {
  return {
    consentStatus: "needed",
    consentType: listParameter(consentTypes.map(templateListItem)),
  };
}

export function notNeededConsentSettings(): SeedConsentSettings {
  return { consentStatus: "notNeeded" };
}
