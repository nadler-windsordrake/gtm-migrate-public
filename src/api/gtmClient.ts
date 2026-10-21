import { getAccessToken, invalidateAccessToken } from "../auth/googleAuth";
import type {
  GtmAccount,
  GtmBuiltInVariable,
  GtmContainer,
  GtmContainerVersion,
  GtmCustomTemplate,
  GtmTag,
  GtmTrigger,
  GtmVariable,
  GtmWorkspace,
  GtmWorkspaceStatus,
  WorkspaceEntities,
} from "../types/gtm";

const API_ROOT = "https://tagmanager.googleapis.com/tagmanager/v2";

interface ListResponse<T> {
  nextPageToken?: string;
  [key: string]: T[] | string | undefined;
}

export class GtmApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GtmApiError";
  }
}

function apiErrorMessage(status: number, detail?: string, reason?: string): string {
  if (/quota|rateLimit|resource_exhausted/i.test(reason ?? "")) {
    return "The Google Tag Manager API quota was exceeded. Wait briefly, then retry.";
  }
  switch (status) {
    case 401:
      return "Your Google session expired. Sign in again and retry.";
    case 403:
      return "Google denied access. Confirm the Tag Manager API is enabled and your account has access to this GTM resource.";
    case 404:
      return "This GTM resource no longer exists or is not accessible.";
    case 429:
      return "The Google Tag Manager API quota was exceeded. Wait briefly, then retry.";
    default:
      return status >= 500
        ? "Google Tag Manager is temporarily unavailable. Try again shortly."
        : detail || `The Google Tag Manager API returned HTTP ${status}.`;
  }
}

interface GoogleApiErrorDetail {
  message?: string;
  reason?: string;
}

async function responseDetail(response: Response): Promise<GoogleApiErrorDetail> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
    };
    return {
      message: body.error?.message,
      reason: body.error?.errors?.[0]?.reason ?? body.error?.status,
    };
  } catch {
    return {};
  }
}

export class GtmClient {
  private async request<T>(path: string, retryAuth = true): Promise<T> {
    let token: string;
    try {
      token = await getAccessToken(false);
    } catch (error) {
      throw new GtmApiError(error instanceof Error ? error.message : "Google authentication is required.", 401, { cause: error });
    }

    let response: Response;
    try {
      response = await fetch(`${API_ROOT}/${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch (error) {
      throw new GtmApiError("Could not reach Google Tag Manager. Check your network connection and retry.", undefined, {
        cause: error,
      });
    }

    if (response.status === 401 && retryAuth) {
      await invalidateAccessToken(token);
      return this.request<T>(path, false);
    }
    if (!response.ok) {
      const detail = await responseDetail(response);
      throw new GtmApiError(apiErrorMessage(response.status, detail.message, detail.reason), response.status);
    }
    return (await response.json()) as T;
  }

  private async listAll<T>(path: string, collectionKey: string): Promise<T[]> {
    const all: T[] = [];
    let pageToken: string | undefined;
    do {
      const separator = path.includes("?") ? "&" : "?";
      const pagePath = pageToken ? `${path}${separator}pageToken=${encodeURIComponent(pageToken)}` : path;
      const response = await this.request<ListResponse<T>>(pagePath);
      const items = response[collectionKey];
      if (Array.isArray(items)) all.push(...items);
      pageToken = typeof response.nextPageToken === "string" ? response.nextPageToken : undefined;
    } while (pageToken);
    return all;
  }

  listAccounts(): Promise<GtmAccount[]> {
    return this.listAll("accounts", "account");
  }

  listContainers(accountId: string): Promise<GtmContainer[]> {
    return this.listAll(`accounts/${encodeURIComponent(accountId)}/containers`, "container");
  }

  listWorkspaces(accountId: string, containerId: string): Promise<GtmWorkspace[]> {
    return this.listAll(
      `accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces`,
      "workspace",
    );
  }

  async getWorkspaceEntities(accountId: string, containerId: string, workspaceId: string): Promise<WorkspaceEntities> {
    const workspacePath = `accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}`;
    const [tags, triggers, variables, builtInVariables, templates] = await Promise.all([
      this.listAll<GtmTag>(`${workspacePath}/tags`, "tag"),
      this.listAll<GtmTrigger>(`${workspacePath}/triggers`, "trigger"),
      this.listAll<GtmVariable>(`${workspacePath}/variables`, "variable"),
      this.listAll<GtmBuiltInVariable>(`${workspacePath}/built_in_variables`, "builtInVariable").catch((error: unknown) => {
        if (error instanceof GtmApiError && error.status === 404) return [];
        throw error;
      }),
      this.listAll<GtmCustomTemplate>(`${workspacePath}/templates`, "template").catch((error: unknown) => {
        if (error instanceof GtmApiError && error.status === 404) return [];
        throw error;
      }),
    ]);
    return { tags, triggers, variables, builtInVariables, templates };
  }

  getWorkspaceStatus(accountId: string, containerId: string, workspaceId: string): Promise<GtmWorkspaceStatus> {
    const path = `accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/status`;
    return this.request<GtmWorkspaceStatus>(path);
  }

  async getLiveContainerVersion(accountId: string, containerId: string): Promise<GtmContainerVersion | undefined> {
    const parent = `accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}`;
    try {
      return await this.request<GtmContainerVersion>(`${parent}/versions:live`);
    } catch (error) {
      if (error instanceof GtmApiError && error.status === 404) return undefined;
      throw error;
    }
  }
}
