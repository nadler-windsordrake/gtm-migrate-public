import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, getAccessToken } from "./googleAuth";

type TokenCallback = (token?: string, grantedScopes?: string[]) => void;
type TokenRequest = (
  details: chrome.identity.TokenDetails,
  callback: TokenCallback,
) => void | Promise<chrome.identity.GetAuthTokenResult>;

function installChromeMock(getAuthToken: TokenRequest): { lastError?: { message?: string } } {
  const runtime: { lastError?: { message?: string } } = {};
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        getManifest: () => ({
          oauth2: {
            client_id: "configured-client.apps.googleusercontent.com",
            scopes: ["https://www.googleapis.com/auth/tagmanager.readonly"],
          },
        }),
        get lastError() {
          return runtime.lastError;
        },
      },
      identity: { getAuthToken },
    },
  });
  return runtime;
}

describe("getAccessToken", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves a callback token without logging its value", async () => {
    installChromeMock((_details, callback) => callback("sensitive-token-value"));

    await expect(getAccessToken(true)).resolves.toBe("sensitive-token-value");
    expect(JSON.stringify(vi.mocked(console.debug).mock.calls)).not.toContain("sensitive-token-value");
  });

  it("surfaces chrome.runtime.lastError for an access denial", async () => {
    const runtime = installChromeMock((_details, callback) => callback());
    runtime.lastError = { message: "OAuth2 request failed: access_denied" };

    await expect(getAccessToken(true)).rejects.toEqual(
      expect.objectContaining<AuthError>({
        name: "AuthError",
        message: "Google sign-in was cancelled or access was denied.",
      }),
    );
  });

  it("surfaces a promise rejection as a readable cancellation error", async () => {
    installChromeMock(() => Promise.reject(new Error("The authorization window was closed by the user")));

    await expect(getAccessToken(true)).rejects.toThrow("Google sign-in was cancelled or access was denied.");
  });

  it("surfaces a synchronous Identity API failure", async () => {
    installChromeMock(() => {
      throw new Error("Identity API unavailable");
    });

    await expect(getAccessToken(true)).rejects.toThrow("Google authentication failed: Identity API unavailable");
  });

  it("rejects an unsettled OAuth request after a bounded timeout", async () => {
    vi.useFakeTimers();
    installChromeMock(() => undefined);

    const request = getAccessToken(true);
    const expectation = expect(request).rejects.toThrow("Google sign-in timed out");
    await vi.advanceTimersByTimeAsync(90_000);
    await expectation;
  });
});
