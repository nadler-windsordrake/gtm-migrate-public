import type { GtmWorkspaceStatus, WorkspaceEntities } from "../types/gtm";

export type EntityKind = "tag" | "trigger" | "variable" | "builtInVariable" | "template" | "other";
export type ChangeType = "added" | "modified" | "deleted";
export type Severity = "info" | "low" | "medium" | "high";

export interface FieldChange {
  path: string;
  changeType: "added" | "changed" | "removed";
  before?: unknown;
  after?: unknown;
}

export interface WorkspaceChange {
  key: string;
  entityKind: EntityKind;
  changeType: ChangeType;
  id?: string;
  name: string;
  before?: unknown;
  after?: unknown;
  fieldChanges: FieldChange[];
}

export interface EntityReference {
  key: string;
  entityKind: EntityKind;
  id?: string;
  name: string;
}

export interface DependencyRelationship {
  dependent: EntityReference;
  dependency: EntityReference;
  relation: "trigger" | "variable";
  resolved: boolean;
}

export interface EntityImpact {
  entityKey: string;
  directDependencies: EntityReference[];
  directDependents: EntityReference[];
  transitiveDependents: EntityReference[];
}

export interface RiskFinding {
  id: string;
  ruleId: string;
  severity: Severity;
  entityKey: string;
  affectedEntity: EntityReference;
  title: string;
  explanation: string;
  evidence: string;
  blastRadiusCount?: number;
}

export interface ReviewSource {
  accountId: string;
  containerId: string;
  workspaceId: string;
  accountName?: string;
  containerName?: string;
  workspaceName?: string;
}

export interface WorkspaceReviewInput {
  source: ReviewSource;
  status: GtmWorkspaceStatus;
  workspace: WorkspaceEntities;
  published?: WorkspaceEntities;
  publishedVersionId?: string;
  publishedVersionName?: string;
}

export interface WorkspaceReview {
  schemaVersion: 2;
  analyzedAt: string;
  source: ReviewSource;
  baseline: {
    type: "published" | "none";
    containerVersionId?: string;
    name?: string;
  };
  summary: {
    changes: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    affectedEntities: number;
    conflicts: number;
  };
  changes: WorkspaceChange[];
  findings: RiskFinding[];
  impacts: EntityImpact[];
  relationships: DependencyRelationship[];
  mergeConflicts: Array<Record<string, unknown>>;
}
