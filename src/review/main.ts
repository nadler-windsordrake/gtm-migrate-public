import "./styles.css";
import { GtmClient } from "../api/gtmClient";
import { downloadWorkspaceReview } from "../export/reviewExport";
import { withBusyState } from "../popup/withBusyState";
import { entitiesFromVersion } from "./entity";
import type { EntityImpact, EntityKind, EntityReference, RiskFinding, WorkspaceChange, WorkspaceReview } from "./model";
import {
  additionalDownstreamItems,
  changesNeedingReview,
  describeEntities,
  elevatedStateCopy,
  fieldLabel,
  filterAccessibilityLabel,
  impactForChange,
  notableReason,
  reviewSummarySentence,
  severityForChange,
  sortChangesForReview,
  whyThisMatters,
} from "./presentation";
import { createWorkspaceReview } from "./workspaceReview";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing review element: ${id}`);
  return found as T;
}

const ui = {
  workspaceName: element<HTMLElement>("workspace-name"),
  sourceContext: element<HTMLElement>("source-context"),
  baselineVersion: element<HTMLElement>("baseline-version"),
  status: element<HTMLElement>("status"),
  content: element<HTMLElement>("review-content"),
  baselineNote: element<HTMLElement>("baseline-note"),
  summarySentence: element<HTMLElement>("summary-sentence"),
  summary: element<HTMLElement>("summary"),
  conflictNote: element<HTMLElement>("conflict-note"),
  empty: element<HTMLElement>("empty-state"),
  filterEmpty: element<HTMLElement>("filter-empty-state"),
  list: element<HTMLElement>("change-list"),
  needsReviewList: element<HTMLElement>("needs-review-list"),
  needsReviewSection: element<HTMLElement>("needs-review-section"),
  needsReviewColumns: element<HTMLElement>("needs-review-columns"),
  allChangeColumns: element<HTMLElement>("all-change-columns"),
  needsReviewCount: element<HTMLElement>("needs-review-count"),
  allChangesCount: element<HTMLElement>("all-changes-count"),
  elevatedState: element<HTMLElement>("elevated-state"),
  filters: element<HTMLElement>("change-filters"),
  refresh: element<HTMLButtonElement>("refresh"),
  export: element<HTMLButtonElement>("export-review"),
};

const client = new GtmClient();
const params = new URLSearchParams(location.search);
const required = ["accountId", "containerId", "workspaceId"] as const;
let review: WorkspaceReview | undefined;
let activeFilter = "all";

function value(name: string): string {
  return params.get(name) ?? "";
}

function setStatus(message?: string, error = false): void {
  ui.status.hidden = !message;
  ui.status.textContent = message ?? "";
  ui.status.classList.toggle("is-error", error);
}

function readable(valueToRead: unknown): string {
  if (valueToRead === undefined) return "Not present";
  if (typeof valueToRead === "string") return valueToRead || "(empty)";
  if (typeof valueToRead === "number" || typeof valueToRead === "boolean") return String(valueToRead);
  const serialized = JSON.stringify(valueToRead) ?? String(valueToRead);
  return serialized.length > 240 ? `${serialized.slice(0, 237)}…` : serialized;
}

function titleCase(valueToFormat: string): string {
  return valueToFormat.replace(/^./, (character) => character.toUpperCase());
}

function entityTypeLabel(kind: EntityKind): string {
  return kind === "builtInVariable" ? "Built-in variable" : titleCase(kind);
}

function createStatusMetric(label: string, metricValue: string | number, tone = "neutral"): HTMLElement {
  const item = document.createElement("div");
  item.className = `status-metric tone-${tone}`;
  const valueElement = document.createElement("strong");
  valueElement.textContent = String(metricValue);
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  item.append(valueElement, labelElement);
  return item;
}

function referenceList(title: string, values: EntityReference[]): HTMLElement {
  const block = document.createElement("div");
  block.className = "reference-group";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const item of values) {
    const entry = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = item.name;
    name.title = item.name;
    const kind = document.createElement("small");
    kind.textContent = entityTypeLabel(item.entityKind);
    entry.append(name, kind);
    list.append(entry);
  }
  block.append(heading, list);
  return block;
}

function renderFieldDiff(change: WorkspaceChange): HTMLElement {
  const section = document.createElement("section");
  section.className = "inspector-section field-diff";
  const heading = document.createElement("h3");
  heading.textContent = "Change";
  section.append(heading);
  if (!change.fieldChanges.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Before-and-after field details were not available for this change.";
    section.append(empty);
    return section;
  }

  for (const field of change.fieldChanges.slice(0, 50)) {
    const wholeItemChange = field.path === "configuration" && (field.before === undefined || field.after === undefined);
    const fieldBlock = document.createElement("div");
    fieldBlock.className = "diff-field";
    const label = document.createElement("strong");
    label.textContent = wholeItemChange ? entityTypeLabel(change.entityKind) : fieldLabel(field.path);
    const lines = document.createElement("div");
    lines.className = "diff-lines";

    const removed = document.createElement("div");
    removed.className = "diff-line diff-removed";
    const removedMarker = document.createElement("span");
    removedMarker.setAttribute("aria-label", "Before");
    removedMarker.textContent = "−";
    const before = document.createElement("code");
    before.textContent = wholeItemChange && field.before === undefined ? "Not present" : readable(field.before);
    removed.append(removedMarker, before);

    const added = document.createElement("div");
    added.className = "diff-line diff-added";
    const addedMarker = document.createElement("span");
    addedMarker.setAttribute("aria-label", "After");
    addedMarker.textContent = "+";
    const after = document.createElement("code");
    after.textContent = wholeItemChange && field.after !== undefined ? "Added" : readable(field.after);
    added.append(addedMarker, after);

    lines.append(removed, added);
    fieldBlock.append(label, lines);
    section.append(fieldBlock);
  }
  if (change.fieldChanges.length > 50) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `${change.fieldChanges.length - 50} additional field changes are available under Advanced details and in the export.`;
    section.append(note);
  }
  return section;
}

function renderFindings(findings: RiskFinding[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "inspector-section finding-list";
  const heading = document.createElement("h3");
  heading.textContent = "Findings";
  section.append(heading);
  if (!findings.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No findings were detected for this change by the current rule set.";
    section.append(empty);
    return section;
  }
  for (const item of findings) {
    const finding = document.createElement("article");
    finding.className = `finding severity-${item.severity}`;
    const titleRow = document.createElement("div");
    titleRow.className = "finding-title";
    const badge = document.createElement("span");
    badge.className = "severity-label";
    badge.textContent = item.severity.toUpperCase();
    const title = document.createElement("strong");
    title.textContent = item.title;
    titleRow.append(badge, title);
    const explanation = document.createElement("p");
    explanation.textContent = item.explanation;
    const evidence = document.createElement("small");
    evidence.textContent = item.evidence;
    finding.append(titleRow, explanation, evidence);
    section.append(finding);
  }
  return section;
}

function impactSummary(change: WorkspaceChange, impact: EntityImpact | undefined): string {
  const affected = impact?.transitiveDependents ?? [];
  if (!affected.length) return "No downstream items found";
  const description = describeEntities(affected);
  return change.entityKind === "variable" || change.entityKind === "trigger" ? `Used by ${description}` : `Blast radius: ${description}`;
}

function impactColumn(change: WorkspaceChange, impact: EntityImpact | undefined, findings: RiskFinding[]): string {
  if (impact?.transitiveDependents.length) return describeEntities(impact.transitiveDependents);
  if (
    findings.some(
      (item) =>
        item.entityKey === change.key &&
        (item.ruleId === "new-custom-html-all-pages" || item.ruleId === "new-tag-all-pages"),
    )
  ) {
    return "All pages";
  }
  if (findings.some((item) => item.entityKey === change.key && item.ruleId === "unresolved-dependency-introduced")) {
    return "Unresolved";
  }
  return "—";
}

function renderAffectedItems(change: WorkspaceChange, impact: EntityImpact | undefined): HTMLElement {
  const section = document.createElement("section");
  section.className = "inspector-section impact-section";
  const heading = document.createElement("h3");
  heading.textContent = "Impact";
  const overview = document.createElement("p");
  overview.className = "impact-overview";
  overview.textContent = impactSummary(change, impact);
  section.append(heading, overview);
  if (!impact?.transitiveDependents.length) return section;
  const groups = document.createElement("div");
  groups.className = "reference-grid";
  if (impact.directDependents.length) groups.append(referenceList("Direct", impact.directDependents));
  const additional = additionalDownstreamItems(impact);
  if (additional.length) groups.append(referenceList("Additional downstream", additional));
  section.append(groups);
  return section;
}

function renderAdvancedDetails(change: WorkspaceChange, impact: EntityImpact | undefined): HTMLElement {
  const advanced = document.createElement("details");
  advanced.className = "advanced-details";
  const summary = document.createElement("summary");
  summary.textContent = "Advanced details";
  const content = document.createElement("div");
  content.className = "advanced-content";

  const identifiers = document.createElement("section");
  const identifierHeading = document.createElement("h4");
  identifierHeading.textContent = "Identifiers";
  const identifier = document.createElement("code");
  identifier.textContent = `${change.entityKind}${change.id ? ` · ID ${change.id}` : " · No API identifier available"}`;
  identifiers.append(identifierHeading, identifier);
  content.append(identifiers);

  if (impact?.directDependencies.length) content.append(referenceList("This item depends on", impact.directDependencies));

  const paths = document.createElement("section");
  const pathsHeading = document.createElement("h4");
  pathsHeading.textContent = "Raw API field paths";
  const pathList = document.createElement("ul");
  pathList.className = "raw-path-list";
  for (const field of change.fieldChanges) {
    const item = document.createElement("li");
    const path = document.createElement("code");
    path.textContent = field.path;
    const values = document.createElement("code");
    values.textContent = `${readable(field.before)} → ${readable(field.after)}`;
    item.append(path, values);
    pathList.append(item);
  }
  paths.append(pathsHeading, pathList);
  content.append(paths);

  const raw = document.createElement("section");
  const rawHeading = document.createElement("h4");
  rawHeading.textContent = "Raw configuration";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify({ before: change.before, after: change.after }, null, 2);
  raw.append(rawHeading, pre);
  content.append(raw);
  advanced.append(summary, content);
  return advanced;
}

function renderChange(change: WorkspaceChange, impact: EntityImpact | undefined): HTMLElement {
  if (!review) return document.createElement("div");
  const severity = severityForChange(change, review.findings);
  const typeLabel = entityTypeLabel(change.entityKind);
  const changeLabel = titleCase(change.changeType);
  const impactText = impactColumn(change, impact, review.findings);
  const reasonText = notableReason(change, review.findings, impact);

  const row = document.createElement("details");
  row.className = `change-row severity-${severity}`;
  const summary = document.createElement("summary");
  summary.className = "change-summary";
  summary.setAttribute(
    "aria-label",
    `${severity} severity. ${changeLabel} ${typeLabel}. ${change.name}. Impact: ${impactText}. Open details.`,
  );

  const severityCell = document.createElement("span");
  severityCell.className = "change-cell severity-cell";
  severityCell.dataset.label = "Severity";
  const severityLabel = document.createElement("span");
  severityLabel.className = "severity-label";
  severityLabel.textContent = severity.toUpperCase();
  severityCell.append(severityLabel);

  const changeCell = document.createElement("span");
  changeCell.className = "change-cell change-kind-cell";
  changeCell.dataset.label = "Change";
  changeCell.textContent = changeLabel;

  const typeCell = document.createElement("span");
  typeCell.className = "change-cell type-cell";
  typeCell.dataset.label = "Type";
  typeCell.textContent = typeLabel;

  const nameCell = document.createElement("span");
  nameCell.className = "change-cell name-cell";
  nameCell.dataset.label = "Name";
  const name = document.createElement("strong");
  name.textContent = change.name;
  name.title = change.name;
  nameCell.append(name);
  if (reasonText && reasonText !== `Affects ${impactText}`) {
    const reason = document.createElement("small");
    reason.textContent = reasonText;
    nameCell.append(reason);
  }

  const impactCell = document.createElement("span");
  impactCell.className = "change-cell row-impact-cell";
  impactCell.dataset.label = "Impact";
  const impactValue = document.createElement("span");
  impactValue.textContent = impactText;
  const toggle = document.createElement("span");
  toggle.className = "row-toggle";
  toggle.setAttribute("aria-hidden", "true");
  impactCell.append(impactValue, toggle);
  summary.append(severityCell, changeCell, typeCell, nameCell, impactCell);

  const inspector = document.createElement("div");
  inspector.className = "inspector-pane";
  const inspectorHeader = document.createElement("div");
  inspectorHeader.className = "inspector-header";
  const inspectorTitle = document.createElement("h3");
  inspectorTitle.textContent = change.name;
  const inspectorMeta = document.createElement("code");
  inspectorMeta.textContent = `${typeLabel} · ${changeLabel} · ${severity.toUpperCase()}${change.id ? ` · ID ${change.id}` : ""}`;
  inspectorHeader.append(inspectorTitle, inspectorMeta);

  const inspectorGrid = document.createElement("div");
  inspectorGrid.className = "inspector-grid";
  const why = document.createElement("section");
  why.className = "inspector-section why-section";
  const whyHeading = document.createElement("h3");
  whyHeading.textContent = "Why this matters";
  const whyCopy = document.createElement("p");
  const elevatedFinding = review.findings.find(
    (item) => item.entityKey === change.key && (item.severity === "high" || item.severity === "medium"),
  );
  whyCopy.textContent = elevatedFinding?.explanation ?? whyThisMatters(change, impact);
  why.append(whyHeading, whyCopy);

  inspectorGrid.append(
    renderFieldDiff(change),
    renderAffectedItems(change, impact),
    why,
    renderFindings(review.findings.filter((item) => item.entityKey === change.key)),
  );
  inspector.append(inspectorHeader, inspectorGrid, renderAdvancedDetails(change, impact));
  row.append(summary, inspector);
  return row;
}

function appendChanges(container: HTMLElement, changes: WorkspaceChange[]): void {
  container.replaceChildren();
  for (const change of changes) container.append(renderChange(change, review ? impactForChange(change, review.impacts) : undefined));
}

function renderChanges(): void {
  if (!review) return;
  const sorted = sortChangesForReview(review.changes, review.findings, review.impacts);
  const filtered = activeFilter === "all" ? sorted : sorted.filter((change) => severityForChange(change, review?.findings ?? []) === activeFilter);
  appendChanges(ui.list, filtered);
  ui.filterEmpty.hidden = filtered.length > 0 || review.changes.length === 0;
}

function renderNeedsReview(): void {
  if (!review) return;
  const elevated = changesNeedingReview(review.changes, review.findings, review.impacts);
  ui.needsReviewCount.textContent = `(${elevated.length})`;
  ui.needsReviewColumns.hidden = elevated.length === 0;
  ui.elevatedState.hidden = elevated.length > 0;
  if (!elevated.length) {
    const copy = elevatedStateCopy(review.changes.length, elevated.length);
    const title = document.createElement("strong");
    title.textContent = copy.title;
    const detail = document.createElement("span");
    detail.textContent = copy.detail;
    ui.elevatedState.replaceChildren(title, detail);
  }
  appendChanges(ui.needsReviewList, elevated);
}

function renderFilters(): void {
  if (!review) return;
  ui.filters.replaceChildren();
  for (const filter of ["all", "high", "medium", "low", "info"] as const) {
    const count = filter === "all" ? review.summary.changes : review.summary[filter];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button";
    button.dataset.active = String(activeFilter === filter);
    button.setAttribute("aria-pressed", String(activeFilter === filter));
    button.setAttribute("aria-label", filterAccessibilityLabel(filter, count));
    button.textContent = `${filter === "all" ? "All" : titleCase(filter)} ${count}`;
    button.addEventListener("click", () => {
      activeFilter = filter;
      renderFilters();
      renderChanges();
    });
    ui.filters.append(button);
  }
}

function setContext(accountName: string, containerName: string, workspaceName: string): void {
  ui.sourceContext.textContent = [accountName, containerName].filter(Boolean).join(" / ");
  ui.workspaceName.textContent = workspaceName || "Workspace";
}

function renderReview(): void {
  if (!review) return;
  activeFilter = "all";
  ui.content.hidden = false;
  ui.export.hidden = false;
  const baseline = review.baseline.type === "published" ? `v${review.baseline.containerVersionId ?? "?"}` : "none";
  ui.baselineVersion.textContent = baseline;
  ui.baselineNote.textContent =
    review.baseline.type === "published"
      ? `Before values use published container version ${review.baseline.containerVersionId ?? "(unnamed)"}; GTM reports pending changes relative to the workspace base.`
      : "No published container version was available. GTM still reports pending changes, but before values may be limited.";
  const elevatedCount = review.summary.high + review.summary.medium;
  ui.summarySentence.textContent = reviewSummarySentence(review.summary.changes, elevatedCount, review.summary.affectedEntities);
  ui.summary.replaceChildren(
    createStatusMetric("Changes", review.summary.changes),
    createStatusMetric("High", review.summary.high, review.summary.high ? "high" : "neutral"),
    createStatusMetric("Medium", review.summary.medium, review.summary.medium ? "medium" : "neutral"),
    createStatusMetric("Low", review.summary.low, review.summary.low ? "low" : "neutral"),
    createStatusMetric("Affected", review.summary.affectedEntities, "impact"),
    createStatusMetric("Baseline", baseline),
  );
  ui.conflictNote.hidden = review.summary.conflicts === 0;
  ui.conflictNote.textContent = review.summary.conflicts
    ? `${review.summary.conflicts} GTM merge ${review.summary.conflicts === 1 ? "conflict needs" : "conflicts need"} attention in Tag Manager.`
    : "";
  ui.allChangesCount.textContent = `(${review.summary.changes})`;
  ui.empty.hidden = review.changes.length > 0;
  ui.allChangeColumns.hidden = review.changes.length === 0;
  ui.needsReviewSection.hidden = review.changes.length === 0;
  renderNeedsReview();
  renderFilters();
  renderChanges();
}

async function loadReview(): Promise<void> {
  const fixtureName = params.get("fixture");
  if (import.meta.env.DEV && fixtureName) {
    const { attentionWorkspaceReviewFixture, emptyWorkspaceReviewFixture, stressWorkspaceReviewFixture, workspaceReviewFixture } = await import(
      "../fixtures/workspaceReviewFixture"
    );
    const fixture =
      fixtureName === "attention"
        ? attentionWorkspaceReviewFixture
        : fixtureName === "empty"
          ? emptyWorkspaceReviewFixture
          : fixtureName === "stress"
            ? stressWorkspaceReviewFixture
            : workspaceReviewFixture;
    review = createWorkspaceReview(fixture, new Date("2026-08-19T12:00:00Z"));
    setContext(fixture.source.accountName ?? "", fixture.source.containerName ?? "", fixture.source.workspaceName ?? "Fixture workspace");
    setStatus();
    renderReview();
    return;
  }
  if (required.some((name) => !value(name))) {
    setStatus("Missing account, container, or workspace selection. Reopen this review from the GTM Migrate popup.", true);
    return;
  }
  setStatus("Reviewing workspace changes…");
  ui.content.hidden = true;
  ui.export.hidden = true;
  try {
    const [status, workspace, publishedVersion] = await Promise.all([
      client.getWorkspaceStatus(value("accountId"), value("containerId"), value("workspaceId")),
      client.getWorkspaceEntities(value("accountId"), value("containerId"), value("workspaceId")),
      client.getLiveContainerVersion(value("accountId"), value("containerId")),
    ]);
    review = createWorkspaceReview({
      source: {
        accountId: value("accountId"),
        accountName: value("accountName"),
        containerId: value("containerId"),
        containerName: value("containerName"),
        workspaceId: value("workspaceId"),
        workspaceName: value("workspaceName"),
      },
      status,
      workspace,
      ...(publishedVersion
        ? {
            published: entitiesFromVersion(publishedVersion),
            publishedVersionId: publishedVersion.containerVersionId,
            publishedVersionName: publishedVersion.name,
          }
        : {}),
    });
    setContext(value("accountName") || value("accountId"), value("containerName") || value("containerId"), value("workspaceName") || value("workspaceId"));
    setStatus();
    renderReview();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Workspace review failed. Please retry.", true);
  }
}

setContext(value("accountName"), value("containerName"), value("workspaceName"));
ui.refresh.addEventListener("click", () =>
  void withBusyState(
    (busy) => {
      ui.refresh.disabled = busy;
      ui.refresh.textContent = busy ? "Refreshing…" : "Refresh";
    },
    loadReview,
  ),
);
ui.export.addEventListener("click", () => {
  if (review) downloadWorkspaceReview(review);
});

void loadReview();
