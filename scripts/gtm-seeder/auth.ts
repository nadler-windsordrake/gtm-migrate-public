import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { GTM_WRITE_SCOPE, type SeederConfig } from "./types";

interface InstalledCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function readInstalledCredentials(filePath: string): Promise<InstalledCredentials> {
  let parsed: unknown;
  try {
    parsed = await readJson(filePath);
  } catch (error) {
    throw new Error(`Unable to read the development OAuth credentials at ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`, {
      cause: error,
    });
  }
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const installed = root.installed && typeof root.installed === "object" ? (root.installed as Record<string, unknown>) : {};
  if (typeof installed.client_id !== "string" || typeof installed.client_secret !== "string") {
    throw new Error("The seeder requires a separate Google OAuth client of type Desktop app (an `installed` credentials JSON file). ");
  }
  return {
    client_id: installed.client_id,
    client_secret: installed.client_secret,
    redirect_uris: Array.isArray(installed.redirect_uris)
      ? installed.redirect_uris.filter((value): value is string => typeof value === "string")
      : undefined,
  };
}

function openAuthorizationPage(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const argumentsToPass = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, argumentsToPass, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

async function saveToken(tokenPath: string, credentials: Credentials): Promise<void> {
  await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
}

async function authorizeInteractively(credentials: InstalledCredentials, tokenPath: string): Promise<OAuth2Client> {
  const state = randomBytes(24).toString("hex");
  let redirectOrigin = "";
  let resolveCode: ((code: string) => void) | undefined;
  let rejectCode: ((error: Error) => void) | undefined;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", redirectOrigin);
    if (requestUrl.pathname !== "/oauth2callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const error = requestUrl.searchParams.get("error");
    const returnedState = requestUrl.searchParams.get("state");
    const code = requestUrl.searchParams.get("code");
    if (error || returnedState !== state || !code) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("GTM seeder authorization failed. You may close this tab.");
      rejectCode?.(new Error(error ? `Google OAuth denied access: ${error}` : "Google OAuth returned an invalid callback."));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("GTM seeder authorization complete. You may close this tab.");
    resolveCode?.(code);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to start the local OAuth callback listener.");
  }
  redirectOrigin = `http://127.0.0.1:${address.port}`;
  const redirectUri = `${redirectOrigin}/oauth2callback`;
  const client = new OAuth2Client(credentials.client_id, credentials.client_secret, redirectUri);
  const authorizationUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GTM_WRITE_SCOPE],
    state,
    include_granted_scopes: false,
  });
  console.log("Opening Google authorization for the development-only GTM write scope.");
  console.log(`If the browser does not open, visit: ${authorizationUrl}`);
  openAuthorizationPage(authorizationUrl);
  const timeout = setTimeout(() => rejectCode?.(new Error("Google OAuth timed out after five minutes.")), 5 * 60 * 1000);
  try {
    const code = await codePromise;
    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
    client.setCredentials(tokens);
    await saveToken(tokenPath, tokens);
    return client;
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

export async function createAccessTokenProvider(config: SeederConfig): Promise<() => Promise<string>> {
  const credentials = await readInstalledCredentials(config.credentialsPath);
  let client: OAuth2Client;
  try {
    const savedToken = (await readJson(config.tokenPath)) as Credentials;
    client = new OAuth2Client(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uris?.[0] ?? "http://localhost",
    );
    client.setCredentials(savedToken);
  } catch {
    client = await authorizeInteractively(credentials, config.tokenPath);
  }
  return async () => {
    try {
      const response = await client.getAccessToken();
      if (!response.token) throw new Error("Google did not return an access token.");
      return response.token;
    } catch (error) {
      throw new Error(
        `Unable to obtain a GTM seeder access token. Remove ${config.tokenPath} and authorize again. ${error instanceof Error ? error.message : ""}`.trim(),
        { cause: error },
      );
    }
  };
}
