import type { GtmTag, GtmTrigger, WorkspaceEntities } from "../types/gtm";
import type { WorkspaceReviewInput } from "../review/model";

const source = {
  accountId: "account-1",
  containerId: "container-1",
  workspaceId: "workspace-1",
  accountName: "GTM Migrate Test",
  containerName: "Test Website",
  workspaceName: "Default Workspace",
};

export const publishedFixture: WorkspaceEntities = {
  triggers: [{ triggerId: "1", name: "All Pages", type: "pageview" }],
  variables: [{ variableId: "1", name: "Test Value", type: "c", parameter: [{ key: "value", value: "goodbye" }] }],
  tags: [
    {
      tagId: "1",
      name: "GTM Migrate Test Tag",
      type: "gaawe",
      firingTriggerId: ["1"],
      parameter: [{ key: "eventValue", value: "{{Test Value}}" }],
    },
    {
      tagId: "2",
      name: "GTM Migrate test tag 2",
      type: "gaawe",
      firingTriggerId: ["1"],
      parameter: [{ key: "eventValue", value: "{{Test Value}}" }],
    },
  ],
  builtInVariables: [],
  templates: [],
};

export const workspaceFixture: WorkspaceEntities = {
  ...publishedFixture,
  variables: [{ variableId: "1", name: "Test Value", type: "c", parameter: [{ key: "value", value: "danger" }] }],
};

export const workspaceReviewFixture: WorkspaceReviewInput = {
  source,
  status: { workspaceChange: [{ changeStatus: "updated", variable: workspaceFixture.variables[0] }] },
  workspace: workspaceFixture,
  published: publishedFixture,
  publishedVersionId: "1",
  publishedVersionName: "Published fixture",
};

const customHtmlTag = {
  tagId: "3",
  name: "New Marketing Script",
  type: "html",
  firingTriggerId: ["1"],
  parameter: [{ key: "html", value: "<script>window.fixture = true;</script>" }],
};

export const attentionWorkspaceReviewFixture: WorkspaceReviewInput = {
  source: { ...source, workspaceName: "Attention fixture" },
  status: { workspaceChange: [{ changeStatus: "added", tag: customHtmlTag }] },
  workspace: { ...publishedFixture, tags: [...publishedFixture.tags, customHtmlTag] },
  published: publishedFixture,
  publishedVersionId: "1",
  publishedVersionName: "Published fixture",
};

export const emptyWorkspaceReviewFixture: WorkspaceReviewInput = {
  source: { ...source, workspaceName: "Empty fixture" },
  status: { workspaceChange: [] },
  workspace: publishedFixture,
  published: publishedFixture,
  publishedVersionId: "1",
  publishedVersionName: "Published fixture",
};

const sharedTriggerBefore: GtmTrigger = {
  triggerId: "20",
  name: "Shared Purchase Trigger",
  type: "customEvent",
  filter: [{ value: "purchase-old" }],
};
const sharedTriggerAfter: GtmTrigger = {
  ...sharedTriggerBefore,
  filter: [{ value: "purchase-new" }],
};
const sharedTriggerTags: GtmTag[] = Array.from({ length: 7 }, (_, index) => ({
  tagId: String(100 + index),
  name: `Existing purchase destination ${index + 1}`,
  type: "gaawe",
  firingTriggerId: ["20"],
}));
const addedAllPagesTags: GtmTag[] = Array.from({ length: 8 }, (_, index) => ({
  tagId: String(200 + index),
  name:
    index === 0
      ? "Client Production — International Checkout Completion Analytics Event With Exceptionally Long Naming Convention"
      : `New sitewide analytics event ${index + 1}`,
  type: "gaawe",
  firingTriggerId: ["1"],
}));
const stressCustomHtmlTag: GtmTag = {
  tagId: "300",
  name: "Risky All Pages Script",
  type: "html",
  firingTriggerId: ["1"],
  parameter: [{ key: "html", value: "<script>window.stressFixture = true;</script>" }],
};
const unresolvedTag: GtmTag = {
  tagId: "301",
  name: "Checkout Pixel With Missing Variable",
  type: "gaawe",
  parameter: [{ key: "eventValue", value: "{{Missing Checkout Value}}" }],
};
const addedVariable = { variableId: "400", name: "Launch Cohort", type: "c", parameter: [{ key: "value", value: "beta" }] };

const stressPublishedFixture: WorkspaceEntities = {
  tags: sharedTriggerTags,
  triggers: [publishedFixture.triggers[0]!, sharedTriggerBefore],
  variables: [],
  builtInVariables: [],
  templates: [],
};
const stressWorkspaceFixture: WorkspaceEntities = {
  ...stressPublishedFixture,
  tags: [...sharedTriggerTags, ...addedAllPagesTags, stressCustomHtmlTag, unresolvedTag],
  triggers: [publishedFixture.triggers[0]!, sharedTriggerAfter],
  variables: [addedVariable],
};

export const stressWorkspaceReviewFixture: WorkspaceReviewInput = {
  source: { ...source, containerName: "Enterprise Production Web Container", workspaceName: "Q4 measurement release / agency QA" },
  status: {
    workspaceChange: [
      { changeStatus: "updated", trigger: sharedTriggerAfter },
      ...addedAllPagesTags.map((tag) => ({ changeStatus: "added" as const, tag })),
      { changeStatus: "added", tag: stressCustomHtmlTag },
      { changeStatus: "added", tag: unresolvedTag },
      { changeStatus: "added", variable: addedVariable },
    ],
  },
  workspace: stressWorkspaceFixture,
  published: stressPublishedFixture,
  publishedVersionId: "42",
  publishedVersionName: "Production v42",
};
