export interface GtmAccount {
  path: string;
  accountId: string;
  name: string;
  shareData?: boolean;
  tagManagerUrl?: string;
  [key: string]: unknown;
}

export interface GtmContainer {
  path: string;
  accountId: string;
  containerId: string;
  name: string;
  publicId?: string;
  usageContext?: string[];
  features?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface GtmWorkspace {
  path: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface GtmParameter {
  type?: string;
  key?: string;
  value?: string;
  list?: GtmParameter[];
  map?: GtmParameter[];
  isWeakReference?: boolean;
  [key: string]: unknown;
}

export interface GtmTag {
  path?: string;
  accountId?: string;
  containerId?: string;
  workspaceId?: string;
  tagId: string;
  name: string;
  type?: string;
  parameter?: GtmParameter[];
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  setupTag?: Array<{ tagName?: string; stopOnSetupFailure?: boolean }>;
  teardownTag?: Array<{ tagName?: string; stopTeardownOnFailure?: boolean }>;
  [key: string]: unknown;
}

export interface GtmTrigger {
  path?: string;
  triggerId: string;
  name: string;
  type?: string;
  [key: string]: unknown;
}

export interface GtmVariable {
  path?: string;
  variableId: string;
  name: string;
  type?: string;
  parameter?: GtmParameter[];
  [key: string]: unknown;
}

export interface GtmBuiltInVariable {
  path?: string;
  type?: string;
  name: string;
  [key: string]: unknown;
}

export interface GtmCustomTemplate {
  path?: string;
  templateId: string;
  name: string;
  templateData?: string;
  galleryReference?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GtmContainerVersion {
  path?: string;
  accountId?: string;
  containerId?: string;
  containerVersionId?: string;
  name?: string;
  tag?: GtmTag[];
  trigger?: GtmTrigger[];
  variable?: GtmVariable[];
  builtInVariable?: GtmBuiltInVariable[];
  customTemplate?: GtmCustomTemplate[];
  [key: string]: unknown;
}

export type GtmChangeStatus = "changeStatusUnspecified" | "none" | "added" | "deleted" | "updated";

export interface GtmWorkspaceStatusEntity {
  changeStatus: GtmChangeStatus;
  tag?: GtmTag;
  trigger?: GtmTrigger;
  variable?: GtmVariable;
  builtInVariable?: GtmBuiltInVariable;
  customTemplate?: GtmCustomTemplate;
  folder?: Record<string, unknown>;
  client?: Record<string, unknown>;
  transformation?: Record<string, unknown>;
  zone?: Record<string, unknown>;
  gtagConfig?: Record<string, unknown>;
}

export interface GtmWorkspaceStatus {
  workspaceChange?: GtmWorkspaceStatusEntity[];
  mergeConflict?: Array<Record<string, unknown>>;
}

export interface WorkspaceEntities {
  tags: GtmTag[];
  triggers: GtmTrigger[];
  variables: GtmVariable[];
  builtInVariables: GtmBuiltInVariable[];
  templates: GtmCustomTemplate[];
}
