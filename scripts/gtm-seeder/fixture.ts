import {
  booleanParameter,
  integerParameter,
  neededConsentSettings,
  notNeededConsentSettings,
  templateParameter,
  type SeedConsentSettings,
  type SeedParameter,
} from "./parameters";
import type { MaterializedFixture, SeedFixture, SeedTag, SeedTrigger, SeedVariable } from "./types";
import { seededName } from "./types";

const constant = (label: string, value: string): SeedVariable => ({
  name: seededName(label),
  type: "c",
  parameter: [templateParameter("value", value)],
  notes: "Created by the GTM Migrate development seeder.",
});
const dataLayer = (label: string, path: string): SeedVariable => ({
  name: seededName(label),
  type: "v",
  parameter: [templateParameter("name", path), integerParameter("dataLayerVersion", 2)],
  notes: "Created by the GTM Migrate development seeder.",
});
const condition = (type: string, left: string, right: string): Record<string, unknown> => ({
  type,
  parameter: [templateParameter("arg0", left), templateParameter("arg1", right)],
});
const eventTrigger = (label: string, eventName: string, filter: unknown[] = []): SeedTrigger => ({
  name: seededName(label),
  type: "customEvent",
  customEventFilter: [condition("equals", "{{_event}}", eventName)],
  ...(filter.length ? { filter } : {}),
  notes: "Created by the GTM Migrate development seeder.",
});
const pageTrigger = (label: string, filter: unknown[] = []): SeedTrigger => ({
  name: seededName(label),
  type: "pageview",
  ...(filter.length ? { filter } : {}),
  notes: "Created by the GTM Migrate development seeder.",
});
const analyticsTag = (
  label: string,
  eventName: string,
  triggerLabels: string[],
  extraParameters: SeedParameter[] = [],
  tagFiringOption: SeedTag["tagFiringOption"] = "oncePerEvent",
): SeedTag => ({
  name: seededName(label),
  type: "gaawe",
  parameter: [
    templateParameter("measurementIdOverride", `{{${seededName("Measurement ID")}}}`),
    templateParameter("eventName", eventName),
    templateParameter("eventValue", `{{${seededName("Revenue Data Layer")}}}`),
    templateParameter("currency", `{{${seededName("Currency")}}}`),
    ...extraParameters,
  ],
  firingTriggerNames: triggerLabels.map(seededName),
  tagFiringOption,
  notes: "Created by the GTM Migrate development seeder.",
});
const htmlTag = (
  label: string,
  html: string,
  triggerLabels: string[],
  tagFiringOption: SeedTag["tagFiringOption"] = "oncePerEvent",
  consentSettings?: SeedConsentSettings,
): SeedTag => ({
  name: seededName(label),
  type: "html",
  parameter: [templateParameter("html", html), booleanParameter("supportDocumentWrite", false)],
  firingTriggerNames: triggerLabels.map(seededName),
  tagFiringOption,
  ...(consentSettings ? { consentSettings } : {}),
  notes: "Created by the GTM Migrate development seeder.",
});

export function createBaselineFixture(): SeedFixture {
  const variables: SeedVariable[] = [
    constant("Shared Tracking ID", "G-TEST123456"),
    constant("Measurement ID", `{{${seededName("Shared Tracking ID")}}}`),
    constant("Environment", "staging"),
    constant("Currency", "USD"),
    dataLayer("Revenue Data Layer", "ecommerce.value"),
    dataLayer("Order ID Data Layer", "ecommerce.transaction_id"),
    dataLayer("Customer Type Data Layer", "customer.type"),
    constant("Campaign Name", "gtm-migrate-baseline"),
    constant("Nested Base", "core"),
    constant("Nested Middle", `{{${seededName("Nested Base")}}}-middle`),
    constant(
      "Nested Final",
      `{{${seededName("Nested Middle")}}}-{{${seededName("Environment")}}}-{{${seededName("Shared Tracking ID")}}}`,
    ),
    constant("Consent Type", "analytics_storage"),
  ];

  const triggers: SeedTrigger[] = [
    pageTrigger("All Pages"),
    eventTrigger("Shared Purchase Event", "purchase"),
    pageTrigger("Checkout Pages", [condition("startsWith", "{{Page Path}}", "/checkout")]),
    pageTrigger("Thank You Pages", [condition("contains", "{{Page Path}}", "/thank-you")]),
    pageTrigger("Blog Pages", [condition("startsWith", "{{Page Path}}", "/blog")]),
    eventTrigger("High Value Purchase", "purchase", [
      condition("greater", `{{${seededName("Revenue Data Layer")}}}`, "100"),
    ]),
    eventTrigger("Add To Cart Event", "add_to_cart"),
    eventTrigger("Login Event", "login"),
    eventTrigger("Consent Update Event", "consent_update"),
    eventTrigger("Internal Environment Event", "environment_ready", [
      condition("equals", `{{${seededName("Environment")}}}`, "staging"),
    ]),
  ];

  const purchaseTags = Array.from({ length: 7 }, (_, index) =>
    analyticsTag(
      `Purchase destination ${String(index + 1).padStart(2, "0")}`,
      `purchase_destination_${index + 1}`,
      ["Shared Purchase Event"],
      [templateParameter("transactionId", `{{${seededName("Order ID Data Layer")}}}`)],
    ),
  );

  const consentSettings = neededConsentSettings(["analytics_storage", "ad_storage"]);
  const tags: SeedTag[] = [
    ...purchaseTags,
    analyticsTag("Page view analytics", "page_view", ["All Pages"]),
    htmlTag("Marketing bootstrap Custom HTML", "<script>window.gtmMigrateMarketingBootstrap = true;</script>", ["All Pages"]),
    htmlTag("Consent observer Custom HTML", "<script>window.gtmMigrateConsentObserver = true;</script>", ["All Pages"], "oncePerLoad", consentSettings),
    htmlTag("Performance beacon Custom HTML", "<script>window.gtmMigratePerformanceBeacon = true;</script>", ["All Pages"], "oncePerLoad"),
    analyticsTag("Shared audience page event", "audience_page", ["All Pages"], [
      templateParameter("campaign", `{{${seededName("Campaign Name")}}}`),
    ]),
    analyticsTag("Sitewide diagnostic event", "site_diagnostic", ["All Pages"], [
      templateParameter("diagnosticContext", `{{${seededName("Nested Final")}}}`),
    ], "oncePerLoad"),
    analyticsTag("Checkout page view", "checkout_view", ["Checkout Pages"]),
    htmlTag("Checkout abandonment helper", "<script>window.gtmMigrateCheckoutHelper = true;</script>", ["Checkout Pages"]),
    analyticsTag("Thank you conversion", "purchase_complete", ["Thank You Pages"]),
    analyticsTag("Blog engagement", "blog_view", ["Blog Pages"]),
    analyticsTag(
      "International checkout completion analytics event with an intentionally very long implementation name",
      "high_value_purchase",
      ["High Value Purchase"],
    ),
    analyticsTag("Add to cart analytics", "add_to_cart", ["Add To Cart Event"]),
    analyticsTag("Login analytics", "login", ["Login Event"]),
    analyticsTag("Consent update analytics", "consent_update", ["Consent Update Event"]),
    analyticsTag("Internal environment diagnostic", "environment_ready", ["Internal Environment Event"], [
      templateParameter("environment", `{{${seededName("Environment")}}}`),
    ]),
    analyticsTag("Checkout Pixel", "checkout_pixel", ["Checkout Pages"]),
    analyticsTag("Checkout pixel", "checkout_pixel_duplicate", ["Checkout Pages"]),
  ];

  return { variables, triggers, tags };
}

function replaceVariableValue(variable: SeedVariable, value: string): SeedVariable {
  return { ...variable, parameter: [templateParameter("value", value)] };
}

export function createChangesFixture(): SeedFixture {
  const baseline = createBaselineFixture();
  const variables = baseline.variables.map((variable) => {
    if (variable.name === seededName("Shared Tracking ID")) return replaceVariableValue(variable, "G-TEST654321");
    return variable;
  });
  const triggers = baseline.triggers.map((trigger) =>
    trigger.name === seededName("Shared Purchase Event") ? eventTrigger("Shared Purchase Event", "purchase_completed_v2") : trigger,
  );
  const tags: SeedTag[] = baseline.tags.map((tag): SeedTag => {
    if (tag.name === seededName("Purchase destination 01")) return { ...tag, tagFiringOption: "oncePerLoad" };
    if (tag.name === seededName("Consent observer Custom HTML")) {
      return { ...tag, consentSettings: notNeededConsentSettings() };
    }
    if (tag.name === seededName("Checkout page view")) {
      return { ...tag, firingTriggerNames: [seededName("All Pages")] };
    }
    return tag;
  });
  tags.push(
    htmlTag(
      "CHANGED New All Pages Custom HTML",
      "<script>window.gtmMigrateNewSitewideTest = true;</script>",
      ["All Pages"],
      "oncePerLoad",
    ),
  );
  return { variables, triggers, tags };
}

export function materializeFixtureForAnalysis(fixture: SeedFixture): MaterializedFixture {
  const variableIds = new Map(fixture.variables.map((variable, index) => [variable.name, `seed-variable-${index + 1}`]));
  const triggerIds = new Map(fixture.triggers.map((trigger, index) => [trigger.name, `seed-trigger-${index + 1}`]));
  const tagIds = new Map(fixture.tags.map((tag, index) => [tag.name, `seed-tag-${index + 1}`]));
  return {
    workspace: {
      variables: fixture.variables.map((variable) => ({ ...variable, variableId: variableIds.get(variable.name)! })),
      triggers: fixture.triggers.map((trigger) => ({ ...trigger, triggerId: triggerIds.get(trigger.name)! })),
      tags: fixture.tags.map(({ firingTriggerNames, blockingTriggerNames, ...tag }) => ({
        ...tag,
        tagId: tagIds.get(tag.name)!,
        firingTriggerId: firingTriggerNames.map((name) => triggerIds.get(name)!).filter(Boolean),
        ...(blockingTriggerNames
          ? { blockingTriggerId: blockingTriggerNames.map((name) => triggerIds.get(name)!).filter(Boolean) }
          : {}),
      })),
      builtInVariables: [
        { name: "Page Path", type: "pagePath", path: "built-in/page-path" },
        { name: "Event", type: "event", path: "built-in/event" },
      ],
      templates: [],
    },
    ids: { variables: variableIds, triggers: triggerIds, tags: tagIds },
  };
}

export const EXPECTED_BASELINE_COUNTS = { variables: 12, triggers: 10, tags: 24 } as const;
