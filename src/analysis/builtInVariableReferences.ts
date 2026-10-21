import type { GtmBuiltInVariable } from "../types/gtm";

const INTERNAL_EVENT_REFERENCE = "_event";
const EVENT_BUILT_IN_NAME = "Event";
const EVENT_BUILT_IN_TYPE = "event";

const canonicalEventBuiltIn: GtmBuiltInVariable = {
  name: EVENT_BUILT_IN_NAME,
  type: EVENT_BUILT_IN_TYPE,
};

/**
 * GTM serializes the Event value used by Custom Event trigger filters as
 * `{{_event}}`. It represents GTM's built-in Event variable rather than a
 * user-defined variable with that name.
 */
export function resolveBuiltInVariableReference(
  reference: string,
  builtInVariables: readonly GtmBuiltInVariable[],
): GtmBuiltInVariable | undefined {
  if (reference === INTERNAL_EVENT_REFERENCE) {
    return (
      builtInVariables.find(
        (variable) => variable.type === EVENT_BUILT_IN_TYPE || variable.name === EVENT_BUILT_IN_NAME,
      ) ?? canonicalEventBuiltIn
    );
  }

  return builtInVariables.find((variable) => variable.name === reference);
}
