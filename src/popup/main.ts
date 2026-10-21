import "./styles.css";
import { analyzeDependencies, type DependencyAnalysis } from "../analysis/dependencyAnalyzer";
import { GtmClient } from "../api/gtmClient";
import { getAccessToken, isOAuthConfigured, signOut } from "../auth/googleAuth";
import { createMigrationPackage, downloadMigrationPackage } from "../export/migrationPackage";
import type { GtmAccount, GtmContainer, GtmTag, GtmWorkspace, WorkspaceEntities } from "../types/gtm";
import { withBusyState } from "./withBusyState";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

const ui = {
  status: element<HTMLDivElement>("status"),
  authView: element<HTMLElement>("auth-view"),
  browserView: element<HTMLElement>("browser-view"),
  signIn: element<HTMLButtonElement>("sign-in"),
  signOut: element<HTMLButtonElement>("sign-out"),
  account: element<HTMLSelectElement>("account"),
  container: element<HTMLSelectElement>("container"),
  workspace: element<HTMLSelectElement>("workspace"),
  reviewWorkspace: element<HTMLButtonElement>("review-workspace"),
  loadWorkspace: element<HTMLButtonElement>("load-workspace"),
  workspaceView: element<HTMLElement>("workspace-view"),
  tagSearch: element<HTMLInputElement>("tag-search"),
  tagCount: element<HTMLElement>("tag-count"),
  tagList: element<HTMLDivElement>("tag-list"),
  analyze: element<HTMLButtonElement>("analyze"),
  resultsView: element<HTMLElement>("results-view"),
  selectedTag: element<HTMLElement>("selected-tag"),
  dependencyResults: element<HTMLDivElement>("dependency-results"),
  export: element<HTMLButtonElement>("export"),
};

const client = new GtmClient();
let accounts: GtmAccount[] = [];
let containers: GtmContainer[] = [];
let workspaces: GtmWorkspace[] = [];
let entities: WorkspaceEntities | undefined;
let selectedTag: GtmTag | undefined;
let analysis: DependencyAnalysis | undefined;

function setBusy(button: HTMLButtonElement, busy: boolean, busyLabel = "Loading…"): void {
  if (busy) button.dataset.originalLabel = button.textContent ?? "";
  button.textContent = busy ? busyLabel : (button.dataset.originalLabel ?? button.textContent);
  button.disabled = busy;
}

function showStatus(message?: string, kind: "error" | "info" | "success" = "info"): void {
  ui.status.hidden = !message;
  ui.status.textContent = message ?? "";
  ui.status.dataset.kind = kind;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something unexpected went wrong. Please retry.";
}

function fillSelect<T>(
  select: HTMLSelectElement,
  items: T[],
  value: (item: T) => string,
  label: (item: T) => string,
  placeholder: string,
): void {
  select.replaceChildren(new Option(placeholder, ""));
  for (const item of items) select.add(new Option(label(item), value(item)));
  select.disabled = items.length === 0;
}

function resetWorkspace(): void {
  entities = undefined;
  selectedTag = undefined;
  analysis = undefined;
  ui.workspaceView.hidden = true;
  ui.resultsView.hidden = true;
  ui.loadWorkspace.disabled = !ui.workspace.value;
  ui.reviewWorkspace.disabled = !ui.workspace.value;
}

async function loadAccounts(): Promise<void> {
  showStatus("Loading GTM accounts…");
  accounts = await client.listAccounts();
  fillSelect(ui.account, accounts, (item) => item.accountId, (item) => item.name, "Select an account");
  showStatus(accounts.length ? undefined : "No Google Tag Manager accounts are available to this Google user.", "info");
}

async function enterSignedInState(): Promise<void> {
  ui.authView.hidden = true;
  ui.browserView.hidden = false;
  try {
    await loadAccounts();
  } catch (error) {
    showStatus(errorMessage(error), "error");
  }
}

async function handleSignIn(): Promise<void> {
  await withBusyState(
    (busy) => setBusy(ui.signIn, busy, "Signing in…"),
    async () => {
      showStatus();
      try {
        await getAccessToken(true);
        await enterSignedInState();
      } catch (error) {
        showStatus(errorMessage(error), "error");
      }
    },
  );
}

async function handleAccountChange(): Promise<void> {
  fillSelect(ui.container, [], () => "", () => "", "Select a container");
  fillSelect(ui.workspace, [], () => "", () => "", "Select a workspace");
  resetWorkspace();
  if (!ui.account.value) return;
  showStatus("Loading containers…");
  try {
    containers = await client.listContainers(ui.account.value);
    fillSelect(ui.container, containers, (item) => item.containerId, (item) => item.name, "Select a container");
    showStatus(containers.length ? undefined : "This account has no GTM containers.");
  } catch (error) {
    showStatus(errorMessage(error), "error");
  }
}

async function handleContainerChange(): Promise<void> {
  fillSelect(ui.workspace, [], () => "", () => "", "Select a workspace");
  resetWorkspace();
  if (!ui.container.value) return;
  showStatus("Loading workspaces…");
  try {
    workspaces = await client.listWorkspaces(ui.account.value, ui.container.value);
    fillSelect(ui.workspace, workspaces, (item) => item.workspaceId, (item) => item.name, "Select a workspace");
    showStatus(workspaces.length ? undefined : "This container has no GTM workspaces.");
  } catch (error) {
    showStatus(errorMessage(error), "error");
  }
}

function renderTags(): void {
  if (!entities) return;
  const query = ui.tagSearch.value.trim().toLocaleLowerCase();
  const visible = entities.tags.filter((tag) => tag.name.toLocaleLowerCase().includes(query));
  ui.tagList.replaceChildren();
  ui.tagCount.textContent = `${entities.tags.length} tag${entities.tags.length === 1 ? "" : "s"} in this workspace`;

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = entities.tags.length ? "No tags match this search." : "This workspace has no tags.";
    ui.tagList.append(empty);
    return;
  }

  for (const tag of visible) {
    const label = document.createElement("label");
    label.className = "tag-row";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "selected-tag";
    radio.value = tag.tagId;
    radio.checked = selectedTag?.tagId === tag.tagId;
    radio.addEventListener("change", () => {
      selectedTag = tag;
      analysis = undefined;
      ui.analyze.disabled = false;
      ui.resultsView.hidden = true;
    });
    const copy = document.createElement("span");
    copy.className = "tag-copy";
    const name = document.createElement("strong");
    name.textContent = tag.name;
    const meta = document.createElement("small");
    meta.textContent = [tag.type && `Type: ${tag.type}`, `ID: ${tag.tagId}`].filter(Boolean).join(" · ");
    copy.append(name, meta);
    label.append(radio, copy);
    ui.tagList.append(label);
  }
}

async function handleLoadWorkspace(): Promise<void> {
  setBusy(ui.loadWorkspace, true, "Loading workspace…");
  showStatus();
  resetWorkspace();
  try {
    entities = await client.getWorkspaceEntities(ui.account.value, ui.container.value, ui.workspace.value);
    ui.tagSearch.value = "";
    ui.workspaceView.hidden = false;
    ui.analyze.disabled = true;
    renderTags();
  } catch (error) {
    showStatus(errorMessage(error), "error");
  } finally {
    setBusy(ui.loadWorkspace, false);
    ui.loadWorkspace.disabled = !ui.workspace.value;
  }
}

async function handleReviewWorkspace(): Promise<void> {
  const account = accounts.find((item) => item.accountId === ui.account.value);
  const container = containers.find((item) => item.containerId === ui.container.value);
  const workspace = workspaces.find((item) => item.workspaceId === ui.workspace.value);
  if (!account || !container || !workspace) return;
  await withBusyState(
    (busy) => setBusy(ui.reviewWorkspace, busy, "Opening review…"),
    async () => {
      try {
        const parameters = new URLSearchParams({
          accountId: account.accountId,
          accountName: account.name,
          containerId: container.containerId,
          containerName: container.name,
          workspaceId: workspace.workspaceId,
          workspaceName: workspace.name,
        });
        await chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?${parameters.toString()}`) });
      } catch (error) {
        showStatus(`Could not open workspace review: ${errorMessage(error)}`, "error");
      }
    },
  );
}

function resultGroup(title: string, items: Array<{ primary: string; secondary?: string }>, emptyText: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "result-empty";
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }
  const list = document.createElement("ul");
  for (const item of items) {
    const entry = document.createElement("li");
    const marker = document.createElement("span");
    marker.className = "resolved-marker";
    marker.textContent = "✓";
    const text = document.createElement("span");
    text.textContent = item.primary;
    if (item.secondary) {
      const detail = document.createElement("small");
      detail.textContent = item.secondary;
      text.append(detail);
    }
    entry.append(marker, text);
    list.append(entry);
  }
  section.append(list);
  return section;
}

function renderAnalysis(): void {
  if (!analysis || !selectedTag) return;
  ui.selectedTag.textContent = selectedTag.name;
  const triggerItems = analysis.triggers.map(({ trigger, roles }) => ({
    primary: trigger.name,
    secondary: `${roles.join(" + ")} trigger`,
  }));
  const variableItems = analysis.variables.map((variable) => ({ primary: variable.name, secondary: "User-defined variable" }));
  const builtInItems = analysis.builtInVariables.map((variable) => ({ primary: variable.name, secondary: "Built-in variable" }));
  const groups: HTMLElement[] = [
    resultGroup("Triggers", triggerItems, "No trigger dependencies found."),
    resultGroup("Variables", variableItems, "No user-defined variable dependencies found."),
    resultGroup("Built-in variables", builtInItems, "No built-in variable dependencies found."),
  ];
  const unresolved = resultGroup(
    "Unresolved references",
    analysis.unresolvedReferences.map((item) => ({
      primary: item.reference,
      secondary: `${item.kind} referenced by ${item.sourceType} “${item.sourceName}”`,
    })),
    "All discovered references were resolved.",
  );
  if (analysis.unresolvedReferences.length) unresolved.classList.add("has-warning");
  groups.push(unresolved);
  ui.dependencyResults.replaceChildren(...groups);
  ui.resultsView.hidden = false;
}

function handleAnalyze(): void {
  if (!entities || !selectedTag) return;
  analysis = analyzeDependencies(selectedTag, entities.triggers, entities.variables, entities.builtInVariables);
  renderAnalysis();
}

function handleExport(): void {
  if (!analysis || !selectedTag) return;
  const account = accounts.find((item) => item.accountId === ui.account.value);
  const container = containers.find((item) => item.containerId === ui.container.value);
  const workspace = workspaces.find((item) => item.workspaceId === ui.workspace.value);
  const migrationPackage = createMigrationPackage(selectedTag, analysis, {
    accountId: ui.account.value,
    containerId: ui.container.value,
    workspaceId: ui.workspace.value,
    accountName: account?.name,
    containerName: container?.name,
    workspaceName: workspace?.name,
  });
  downloadMigrationPackage(migrationPackage);
  showStatus("Migration package exported.", "success");
}

async function handleSignOut(): Promise<void> {
  try {
    await signOut();
  } finally {
    ui.browserView.hidden = true;
    ui.authView.hidden = false;
    showStatus("Signed out. Locally loaded GTM data was cleared.", "success");
    accounts = [];
    containers = [];
    workspaces = [];
    resetWorkspace();
  }
}

ui.signIn.addEventListener("click", () => void handleSignIn());
ui.signOut.addEventListener("click", () => void handleSignOut());
ui.account.addEventListener("change", () => void handleAccountChange());
ui.container.addEventListener("change", () => void handleContainerChange());
ui.workspace.addEventListener("change", () => {
  resetWorkspace();
  ui.loadWorkspace.disabled = !ui.workspace.value;
  ui.reviewWorkspace.disabled = !ui.workspace.value;
});
ui.reviewWorkspace.addEventListener("click", () => void handleReviewWorkspace());
ui.loadWorkspace.addEventListener("click", () => void handleLoadWorkspace());
ui.tagSearch.addEventListener("input", renderTags);
ui.analyze.addEventListener("click", handleAnalyze);
ui.export.addEventListener("click", handleExport);

async function initialize(): Promise<void> {
  if (!isOAuthConfigured()) {
    showStatus("Development setup needed: add your Google OAuth client ID to public/manifest.json, then rebuild.", "error");
    return;
  }
  try {
    await getAccessToken(false);
    await enterSignedInState();
  } catch {
    // A missing cached token is the normal signed-out state.
  }
}

void initialize();
