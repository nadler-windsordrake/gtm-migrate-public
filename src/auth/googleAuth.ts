const CLIENT_ID_PLACEHOLDER = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";
const AUTH_REQUEST_TIMEOUT_MS = 90_000;

export class AuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
  }
}

function getClientId(): string {
  if (typeof chrome === "undefined" || !chrome.runtime?.getManifest) return "";
  return chrome.runtime.getManifest().oauth2?.client_id ?? "";
}

export function isOAuthConfigured(): boolean {
  const clientId = getClientId();
  return Boolean(clientId) && clientId !== CLIENT_ID_PLACEHOLDER && clientId.endsWith(".apps.googleusercontent.com");
}

function authDebug(event: string, details?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.debug("[GTM Migrate auth]", event, details ?? {});
  }
}

function authMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/access_denied|cancel|denied|closed|not approve|turned down|not granted|revoked/i.test(message)) {
    return "Google sign-in was cancelled or access was denied.";
  }
  if (/bad client id|invalid_client/i.test(message)) {
    return "Google OAuth is not configured correctly. Follow GOOGLE_SETUP.md.";
  }
  return `Google authentication failed: ${message}`;
}

function requestAccessToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finishWithError(new Error("Google sign-in timed out. Close any open authorization window and try again."));
    }, AUTH_REQUEST_TIMEOUT_MS);

    const finishWithToken = (token: string | undefined): void => {
      if (settled) return;
      if (!token) {
        finishWithError(
          new Error(interactive ? "No access token was returned. Sign-in may have been cancelled." : "No cached Google session is available."),
        );
        return;
      }
      settled = true;
      clearTimeout(timeout);
      authDebug("Token request succeeded", { interactive });
      resolve(token);
    };

    const finishWithError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      authDebug("Token request failed", { interactive, error: message });
      reject(error instanceof Error ? error : new Error(message));
    };

    authDebug("Token request started", { interactive });
    try {
      const possiblePromise = chrome.identity.getAuthToken({ interactive }, (token) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          finishWithError(new Error(runtimeError.message || "Chrome could not complete Google authentication."));
          return;
        }
        finishWithToken(token);
      }) as unknown as Promise<chrome.identity.GetAuthTokenResult> | undefined;

      // Chrome uses the callback when one is supplied. Supporting a returned
      // promise as well makes failures deterministic in compatible runtimes and tests.
      if (possiblePromise && typeof possiblePromise.then === "function") {
        void possiblePromise.then((result) => finishWithToken(result.token)).catch(finishWithError);
      }
    } catch (error) {
      finishWithError(error);
    }
  });
}

export async function getAccessToken(interactive: boolean): Promise<string> {
  if (!isOAuthConfigured()) {
    throw new AuthError("Google OAuth client ID is not configured. Follow GOOGLE_SETUP.md, then rebuild the extension.");
  }

  try {
    return await requestAccessToken(interactive);
  } catch (error) {
    throw new AuthError(authMessage(error), { cause: error });
  }
}

export async function invalidateAccessToken(token: string): Promise<void> {
  authDebug("Invalidating cached token");
  await chrome.identity.removeCachedAuthToken({ token });
}

export async function signOut(): Promise<void> {
  authDebug("Clearing cached authentication state");
  await chrome.identity.clearAllCachedAuthTokens();
}
