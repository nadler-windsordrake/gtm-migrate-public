import { GtmRequestScheduler, type RequestScheduler } from "./rateLimiter";
import { workspacePath } from "./safety";
import type { ApiEntity, SeederApi, SeederConfig, SeederWorkspaceStatus, SeedEntityKind, WorkspaceIdentity } from "./types";

const API_ROOT = "https://tagmanager.googleapis.com/tagmanager/v2";
const COLLECTION: Record<SeedEntityKind, string> = { variable: "variables", trigger: "triggers", tag: "tags" };
export const GTM_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const QUOTA_ERROR_PATTERN = /quota|rate.?limit|resource.?exhausted|userRateLimitExceeded|rateLimitExceeded/i;

type AccessTokenProvider = () => Promise<string>;
type Sleep = (milliseconds: number) => Promise<void>;

export interface GtmSeederApiClientOptions {
  scheduler?: RequestScheduler;
  fetch?: typeof fetch;
  sleep?: Sleep;
  random?: () => number;
  onRetry?: (message: string) => void;
}

const defaultSleep: Sleep = async (milliseconds) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

function errorDetails(payload: unknown): string {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const error = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : {};
  return typeof error.message === "string" ? error.message : "";
}

function errorMessage(status: number, payload: unknown): string {
  return `GTM API request failed (${status}): ${errorDetails(payload) || `HTTP ${status}`}`;
}

function isRetryableResponse(status: number, payload: unknown): boolean {
  if (RETRYABLE_STATUSES.has(status)) return true;
  if (status !== 403) return false;
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = errorDetails(payload);
  }
  return QUOTA_ERROR_PATTERN.test(serialized);
}

function retryAfterMilliseconds(response: Response): number {
  const value = response.headers.get("Retry-After");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : Math.max(0, timestamp - Date.now());
}

export class GtmSeederApiClient implements SeederApi {
  readonly #config: SeederConfig;
  readonly #getAccessToken: AccessTokenProvider;
  readonly #scheduler: RequestScheduler;
  readonly #fetch: typeof fetch;
  readonly #sleep: Sleep;
  readonly #random: () => number;
  readonly #onRetry?: (message: string) => void;
  readonly #listCache = new Map<SeedEntityKind, ApiEntity[]>();
  readonly #listRequests = new Map<SeedEntityKind, Promise<ApiEntity[]>>();
  #identityRequest?: Promise<WorkspaceIdentity>;

  constructor(config: SeederConfig, getAccessToken: AccessTokenProvider, options: GtmSeederApiClientOptions = {}) {
    this.#config = config;
    this.#getAccessToken = getAccessToken;
    this.#scheduler = options.scheduler ?? new GtmRequestScheduler();
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
    this.#onRetry = options.onRetry;
  }

  async #waitForRetry(retryIndex: number, response?: Response): Promise<void> {
    const baseDelay = GTM_RETRY_DELAYS_MS[retryIndex];
    if (baseDelay === undefined) return;
    const jitteredDelay = Math.round(baseDelay * (1 + this.#random() * 0.25));
    const delay = Math.max(jitteredDelay, response ? retryAfterMilliseconds(response) : 0);
    this.#onRetry?.(`Retrying GTM API request in ${(delay / 1_000).toFixed(1)}s (attempt ${retryIndex + 2}/${GTM_RETRY_DELAYS_MS.length + 1}).`);
    this.#scheduler.defer(delay);
    await this.#sleep(delay);
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? "GET";
    for (let attempt = 0; attempt <= GTM_RETRY_DELAYS_MS.length; attempt += 1) {
      const accessToken = await this.#getAccessToken();
      let response: Response;
      try {
        response = await this.#scheduler.schedule(
          () =>
            this.#fetch(`${API_ROOT}/${path}`, {
              ...init,
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${accessToken}`,
                ...(init.body ? { "Content-Type": "application/json" } : {}),
              },
            }),
          `${method} ${path}`,
        );
      } catch (error) {
        if (attempt < GTM_RETRY_DELAYS_MS.length) {
          await this.#waitForRetry(attempt);
          continue;
        }
        throw new Error(`GTM API network request failed after ${attempt + 1} attempts: ${error instanceof Error ? error.message : "unknown error"}`, {
          cause: error,
        });
      }
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (isRetryableResponse(response.status, payload) && attempt < GTM_RETRY_DELAYS_MS.length) {
        await this.#waitForRetry(attempt, response);
        continue;
      }
      throw new Error(errorMessage(response.status, payload));
    }
    throw new Error("GTM API request exhausted its retry limit.");
  }

  getWorkspaceIdentity(): Promise<WorkspaceIdentity> {
    this.#identityRequest ??= this.#loadWorkspaceIdentity();
    return this.#identityRequest;
  }

  async #loadWorkspaceIdentity(): Promise<WorkspaceIdentity> {
    const accountPath = `accounts/${this.#config.accountId}`;
    const containerPath = `${accountPath}/containers/${this.#config.containerId}`;
    const targetWorkspacePath = workspacePath(this.#config);
    const [account, container, workspace] = await Promise.all([
      this.#request<Record<string, unknown>>(accountPath),
      this.#request<Record<string, unknown>>(containerPath),
      this.#request<Record<string, unknown>>(targetWorkspacePath),
    ]);
    return {
      accountId: String(account.accountId ?? this.#config.accountId),
      accountName: String(account.name ?? "(unnamed account)"),
      containerId: String(container.containerId ?? this.#config.containerId),
      containerName: String(container.name ?? "(unnamed container)"),
      workspaceId: String(workspace.workspaceId ?? this.#config.workspaceId),
      workspaceName: String(workspace.name ?? "(unnamed workspace)"),
      workspacePath: targetWorkspacePath,
    };
  }

  list(kind: SeedEntityKind): Promise<ApiEntity[]> {
    const cached = this.#listCache.get(kind);
    if (cached) return Promise.resolve(cached);
    const pending = this.#listRequests.get(kind);
    if (pending) return pending;
    const request = this.#loadList(kind)
      .then((entities) => {
        this.#listCache.set(kind, entities);
        return entities;
      })
      .finally(() => this.#listRequests.delete(kind));
    this.#listRequests.set(kind, request);
    return request;
  }

  async #loadList(kind: SeedEntityKind): Promise<ApiEntity[]> {
    const collection = COLLECTION[kind];
    const entities: ApiEntity[] = [];
    let pageToken: string | undefined;
    do {
      const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "";
      const response = await this.#request<Record<string, unknown>>(`${workspacePath(this.#config)}/${collection}${query}`);
      const page = response[kind];
      if (Array.isArray(page)) entities.push(...(page as ApiEntity[]));
      pageToken = typeof response.nextPageToken === "string" ? response.nextPageToken : undefined;
    } while (pageToken);
    return entities;
  }

  getWorkspaceStatus(): Promise<SeederWorkspaceStatus> {
    return this.#request(`${workspacePath(this.#config)}/status`);
  }

  async create(kind: SeedEntityKind, body: Record<string, unknown>): Promise<ApiEntity> {
    const created = await this.#request<ApiEntity>(`${workspacePath(this.#config)}/${COLLECTION[kind]}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    this.#listCache.get(kind)?.push(created);
    return created;
  }

  async update(kind: SeedEntityKind, path: string, body: Record<string, unknown>, fingerprint?: string): Promise<ApiEntity> {
    const query = fingerprint ? `?fingerprint=${encodeURIComponent(fingerprint)}` : "";
    const updated = await this.#request<ApiEntity>(`${path}${query}`, { method: "PUT", body: JSON.stringify(body) });
    const cached = this.#listCache.get(kind);
    const index = cached?.findIndex((entity) => entity.path === path) ?? -1;
    if (cached && index >= 0) cached[index] = updated;
    return updated;
  }

  async delete(kind: SeedEntityKind, path: string): Promise<void> {
    await this.#request<void>(path, { method: "DELETE" });
    const cached = this.#listCache.get(kind);
    const index = cached?.findIndex((entity) => entity.path === path) ?? -1;
    if (cached && index >= 0) cached.splice(index, 1);
  }
}
