import type { WorkspaceEntities } from "../../src/types/gtm";
import type { SeedConsentSettings, SeedParameter } from "./parameters";

export const SEED_PREFIX = "[GTM MIGRATE TEST]";
export const GTM_WRITE_SCOPE = "https://www.googleapis.com/auth/tagmanager.edit.containers";

export type SeedEntityKind = "variable" | "trigger" | "tag";

export interface SeedVariable {
  name: string;
  type: string;
  parameter?: SeedParameter[];
  notes?: string;
}

export interface SeedTrigger {
  name: string;
  type: string;
  filter?: unknown[];
  customEventFilter?: unknown[];
  notes?: string;
}

export interface SeedTag {
  name: string;
  type: string;
  parameter?: SeedParameter[];
  firingTriggerNames: string[];
  blockingTriggerNames?: string[];
  tagFiringOption?: "unlimited" | "oncePerEvent" | "oncePerLoad";
  consentSettings?: SeedConsentSettings;
  notes?: string;
}

export interface SeedFixture {
  variables: SeedVariable[];
  triggers: SeedTrigger[];
  tags: SeedTag[];
}

export interface ApiEntity {
  path: string;
  name: string;
  fingerprint?: string;
  variableId?: string;
  triggerId?: string;
  tagId?: string;
  [key: string]: unknown;
}

export interface WorkspaceIdentity {
  accountId: string;
  accountName: string;
  containerId: string;
  containerName: string;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
}

export interface SeederWorkspaceStatus {
  workspaceChange?: Array<Record<string, unknown>>;
}

export interface SeederApi {
  getWorkspaceIdentity(): Promise<WorkspaceIdentity>;
  getWorkspaceStatus(): Promise<SeederWorkspaceStatus>;
  list(kind: SeedEntityKind): Promise<ApiEntity[]>;
  create(kind: SeedEntityKind, body: Record<string, unknown>): Promise<ApiEntity>;
  update(kind: SeedEntityKind, path: string, body: Record<string, unknown>, fingerprint?: string): Promise<ApiEntity>;
  delete(kind: SeedEntityKind, path: string): Promise<void>;
}

export interface MutationCount {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export interface SeederSummary {
  mode: "baseline" | "changes" | "cleanup";
  dryRun: boolean;
  variables: MutationCount;
  triggers: MutationCount;
  tags: MutationCount;
  dependencyRelationships: string[];
  expectedRiskFindings: string[];
  expectedBlastRadius: string[];
}

export interface SeederProgress {
  current: number;
  total: number;
  action: "Creating" | "Updating" | "Deleting";
  kind: SeedEntityKind;
  name: string;
}

export interface SeederRunOptions {
  onPlan?: (summary: SeederSummary) => void;
  onProgress?: (progress: SeederProgress) => void;
}

export interface SeederConfig {
  accountId: string;
  containerId: string;
  workspaceId: string;
  credentialsPath: string;
  tokenPath: string;
  dryRun: boolean;
}

export interface MaterializedFixture {
  workspace: WorkspaceEntities;
  ids: {
    variables: Map<string, string>;
    triggers: Map<string, string>;
    tags: Map<string, string>;
  };
}

export function seededName(label: string): string {
  return `${SEED_PREFIX} ${label}`;
}

export function isSeederOwnedName(name: string): boolean {
  return name.startsWith(`${SEED_PREFIX} `);
}
