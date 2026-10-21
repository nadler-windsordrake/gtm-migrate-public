import { beforeEach, describe, expect, it, vi } from "vitest";
import { GtmClient } from "./gtmClient";

vi.mock("../auth/googleAuth", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
  invalidateAccessToken: vi.fn(async () => undefined),
}));

describe("GtmClient V0.2 read-only endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests official workspace status endpoint with GET", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ workspaceChange: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GtmClient().getWorkspaceStatus("a", "c", "w");
    expect(result).toEqual({ workspaceChange: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://tagmanager.googleapis.com/tagmanager/v2/accounts/a/containers/c/workspaces/w/status",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );
  });

  it("requests the official published container version endpoint", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ containerVersionId: "7", name: "Live" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(new GtmClient().getLiveContainerVersion("a", "c")).resolves.toMatchObject({ containerVersionId: "7" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://tagmanager.googleapis.com/tagmanager/v2/accounts/a/containers/c/versions:live",
    );
  });

  it("treats a missing published version as an empty baseline instead of failing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 })));
    await expect(new GtmClient().getLiveContainerVersion("a", "c")).resolves.toBeUndefined();
  });
});
