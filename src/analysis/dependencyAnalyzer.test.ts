import { describe, expect, it } from "vitest";
import { analyzeDependencies, findVariableReferences } from "./dependencyAnalyzer";
import type { GtmBuiltInVariable, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm";

const tag = (overrides: Partial<GtmTag> = {}): GtmTag => ({
  tagId: "tag-1",
  name: "Purchase tag",
  type: "gaawe",
  ...overrides,
});

const trigger = (triggerId: string, name = `Trigger ${triggerId}`, extra: Record<string, unknown> = {}): GtmTrigger => ({
  triggerId,
  name,
  type: "customEvent",
  ...extra,
});

const variable = (variableId: string, name: string, value?: string): GtmVariable => ({
  variableId,
  name,
  type: "c",
  ...(value === undefined ? {} : { parameter: [{ key: "value", type: "template", value }] }),
});

describe("analyzeDependencies", () => {
  it("returns no dependencies for a tag with no references", () => {
    expect(analyzeDependencies(tag(), [], [])).toEqual({
      triggers: [],
      variables: [],
      builtInVariables: [],
      unresolvedReferences: [],
    });
  });

  it("resolves one firing trigger", () => {
    const result = analyzeDependencies(tag({ firingTriggerId: ["10"] }), [trigger("10", "All Pages")], []);
    expect(result.triggers).toEqual([{ trigger: trigger("10", "All Pages"), roles: ["firing"] }]);
  });

  it("resolves multiple firing and blocking triggers", () => {
    const triggers = [trigger("10"), trigger("11"), trigger("12")];
    const result = analyzeDependencies(
      tag({ firingTriggerId: ["10", "11"], blockingTriggerId: ["12"] }),
      triggers,
      [],
    );
    expect(result.triggers.map(({ trigger: item, roles }) => [item.triggerId, roles])).toEqual([
      ["10", ["firing"]],
      ["11", ["firing"]],
      ["12", ["blocking"]],
    ]);
  });

  it("resolves a user-defined variable reference", () => {
    const orderValue = variable("v1", "Order Value");
    const result = analyzeDependencies(tag({ parameter: [{ value: "{{Order Value}}" }] }), [], [orderValue]);
    expect(result.variables).toEqual([orderValue]);
  });

  it("recursively resolves nested variable references", () => {
    const productPrice = variable("v1", "Product Price", "{{Currency}}");
    const currency = variable("v2", "Currency", "CAD");
    const result = analyzeDependencies(tag({ parameter: [{ value: "{{Product Price}}" }] }), [], [productPrice, currency]);
    expect(result.variables.map((item) => item.name)).toEqual(["Product Price", "Currency"]);
  });

  it("terminates safely for circular variable references", () => {
    const first = variable("v1", "First", "{{Second}}");
    const second = variable("v2", "Second", "{{First}}");
    const result = analyzeDependencies(tag({ parameter: [{ value: "{{First}}" }] }), [], [first, second]);
    expect(result.variables.map((item) => item.name)).toEqual(["First", "Second"]);
    expect(result.unresolvedReferences).toEqual([]);
  });

  it("reports an unresolved variable with its source", () => {
    const result = analyzeDependencies(tag({ parameter: [{ value: "{{Missing Variable}}" }] }), [], []);
    expect(result.unresolvedReferences).toEqual([
      { kind: "variable", reference: "Missing Variable", sourceType: "tag", sourceName: "Purchase tag" },
    ]);
  });

  it("follows variable references found inside a resolved trigger", () => {
    const eventName = variable("v1", "Event Name");
    const customEvent = trigger("10", "Purchase Event", {
      customEventFilter: [{ parameter: [{ type: "template", value: "{{Event Name}}" }] }],
    });
    const result = analyzeDependencies(tag({ firingTriggerId: ["10"] }), [customEvent], [eventName]);
    expect(result.variables).toEqual([eventName]);
  });

  it("maps the Custom Event trigger's internal _event reference to the built-in Event value", () => {
    const customEvent = trigger("10", "Purchase Event", {
      customEventFilter: [
        {
          type: "equals",
          parameter: [
            { type: "template", key: "arg0", value: "{{_event}}" },
            { type: "template", key: "arg1", value: "purchase" },
          ],
        },
      ],
    });
    const result = analyzeDependencies(tag({ firingTriggerId: ["10"] }), [customEvent], []);

    expect(result.variables).toEqual([]);
    expect(result.builtInVariables).toEqual([{ name: "Event", type: "event" }]);
    expect(result.unresolvedReferences).toEqual([]);
  });

  it("does not suppress a truly nonexistent variable reference", () => {
    const result = analyzeDependencies(tag({ parameter: [{ value: "{{Some Missing Variable}}" }] }), [], []);

    expect(result.builtInVariables).toEqual([]);
    expect(result.unresolvedReferences).toEqual([
      { kind: "variable", reference: "Some Missing Variable", sourceType: "tag", sourceName: "Purchase tag" },
    ]);
  });

  it("walks arrays and nested GTM parameter structures", () => {
    const deep = variable("v1", "Deep Variable");
    const input = tag({
      parameter: [
        {
          type: "list",
          list: [{ type: "map", map: [{ key: "value", value: "prefix {{Deep Variable}} suffix" }] }],
        },
      ],
    });
    expect(analyzeDependencies(input, [], [deep]).variables).toEqual([deep]);
    expect(findVariableReferences(input)).toEqual(["Deep Variable"]);
  });

  it("deduplicates repeated variables, built-ins, trigger IDs, and unresolved references", () => {
    const currency = variable("v1", "Currency");
    const pageUrl: GtmBuiltInVariable = { name: "Page URL", type: "pageUrl", path: "built-in/page-url" };
    const repeatedTrigger = trigger("10", "Repeated", { filter: [{ value: "{{Currency}} {{Unknown}}" }] });
    const result = analyzeDependencies(
      tag({
        firingTriggerId: ["10", "10"],
        blockingTriggerId: ["10"],
        parameter: [{ value: "{{Currency}} / {{Currency}} / {{Page URL}} / {{Unknown}} / {{Unknown}}" }],
      }),
      [repeatedTrigger],
      [currency],
      [pageUrl],
    );
    expect(result.triggers).toHaveLength(1);
    expect(result.triggers[0]?.roles).toEqual(["firing", "blocking"]);
    expect(result.variables).toEqual([currency]);
    expect(result.builtInVariables).toEqual([pageUrl]);
    expect(result.unresolvedReferences).toHaveLength(2);
    expect(result.unresolvedReferences.map((item) => item.sourceType).sort()).toEqual(["tag", "trigger"]);
  });
});
