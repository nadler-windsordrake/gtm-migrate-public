import { describe, expect, it, vi } from "vitest";
import { GTM_RETRY_DELAYS_MS, GtmSeederApiClient } from "./client";
import type { RequestScheduler } from "./rateLimiter";
import type { SeederConfig } from "./types";

const config: SeederConfig = {
  accountId: "1",
  containerId: "2",
  workspaceId: "3",
  credentialsPath: "/credentials.json",
  tokenPath: "/token.json",
  dryRun: true,
};

const immediateScheduler: RequestScheduler = {
  schedule: (task) => task(),
  defer: () => undefined,
};

function response(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function successList(kind: "variable" | "trigger" | "tag", entities: unknown[] = []): Response {
  return response(200, { [kind]: entities });
}

function retrySleepMock(): ReturnType<typeof vi.fn<(milliseconds: number) => Promise<void>>> {
  return vi.fn(async (milliseconds: number) => {
    void milliseconds;
  });
}

function clientWith(fetchMock: typeof fetch, sleep = retrySleepMock()): GtmSeederApiClient {
  return new GtmSeederApiClient(config, async () => "test-token", {
    scheduler: immediateScheduler,
    fetch: fetchMock,
    sleep,
    random: () => 0,
  });
}

describe("GTM seeder API retry policy", () => {
  it("retries HTTP 429 with backoff", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(429, { error: { message: "Quota exceeded" } }))
      .mockResolvedValueOnce(successList("variable"));
    const sleep = retrySleepMock();

    await expect(clientWith(fetchMock, sleep).list("variable")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("retries only quota-related HTTP 403 responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(403, { error: { message: "Quota exceeded for quota metric Queries" } }))
      .mockResolvedValueOnce(successList("trigger"));
    const sleep = retrySleepMock();

    await expect(clientWith(fetchMock, sleep).list("trigger")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("uses bounded exponential backoff with jitter disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    for (let index = 0; index < GTM_RETRY_DELAYS_MS.length; index += 1) {
      fetchMock.mockResolvedValueOnce(response(503, { error: { message: "Temporarily unavailable" } }));
    }
    fetchMock.mockResolvedValueOnce(successList("tag"));
    const sleep = retrySleepMock();

    await expect(clientWith(fetchMock, sleep).list("tag")).resolves.toEqual([]);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([...GTM_RETRY_DELAYS_MS]);
    expect(fetchMock).toHaveBeenCalledTimes(GTM_RETRY_DELAYS_MS.length + 1);
  });

  it("stops after the bounded retry count", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(429, { error: { message: "Quota exceeded" } }));
    const sleep = retrySleepMock();

    await expect(clientWith(fetchMock, sleep).list("variable")).rejects.toThrow("GTM API request failed (429)");
    expect(fetchMock).toHaveBeenCalledTimes(GTM_RETRY_DELAYS_MS.length + 1);
    expect(sleep).toHaveBeenCalledTimes(GTM_RETRY_DELAYS_MS.length);
  });

  it("does not retry a non-retryable HTTP 400", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(400, { error: { message: "Invalid payload" } }));
    const sleep = retrySleepMock();

    await expect(clientWith(fetchMock, sleep).list("variable")).rejects.toThrow("GTM API request failed (400): Invalid payload");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("GTM seeder API request caching", () => {
  it("routes every GTM read and write through the supplied shared scheduler", async () => {
    const labels: string[] = [];
    const scheduler: RequestScheduler = {
      async schedule<T>(task: () => Promise<T>, label: string): Promise<T> {
        labels.push(label);
        return task();
      },
      defer: () => undefined,
    };
    const entity = {
      name: "[GTM MIGRATE TEST] Scheduled",
      path: "accounts/1/containers/2/workspaces/3/variables/4",
      variableId: "4",
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" || init?.method === "PUT") return response(200, entity);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("/accounts/1")) return response(200, { accountId: "1", name: "Account" });
      if (url.endsWith("/accounts/1/containers/2")) return response(200, { containerId: "2", name: "Container" });
      if (url.endsWith("/accounts/1/containers/2/workspaces/3")) return response(200, { workspaceId: "3", name: "Workspace" });
      return successList("variable");
    });
    const api = new GtmSeederApiClient(config, async () => "test-token", { scheduler, fetch: fetchMock });

    await api.getWorkspaceIdentity();
    await api.list("variable");
    await api.create("variable", { name: entity.name, type: "c" });
    await api.update("variable", entity.path, { name: entity.name, type: "c" });
    await api.delete("variable", entity.path);

    expect(labels).toHaveLength(7);
    expect(labels.every((label) => /^(GET|POST|PUT|DELETE) /.test(label))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("lists each resource collection only once per run", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successList("variable"));
    const api = clientWith(fetchMock);

    await expect(Promise.all([api.list("variable"), api.list("variable")])).resolves.toEqual([[], []]);
    await expect(api.list("variable")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates the cached collection after a successful create without relisting", async () => {
    const created = {
      name: "[GTM MIGRATE TEST] Cached",
      path: "accounts/1/containers/2/workspaces/3/variables/4",
      variableId: "4",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(successList("variable"))
      .mockResolvedValueOnce(response(200, created));
    const api = clientWith(fetchMock);

    await api.list("variable");
    await api.create("variable", { name: created.name, type: "c" });
    await expect(api.list("variable")).resolves.toEqual([created]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
