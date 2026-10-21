# Google OAuth and GTM API setup

GTM Migrate expects a public OAuth client ID tied to your Chrome extension ID; the value in `public/manifest.json` is a placeholder you replace after step 6. A client secret is neither needed nor safe in a Chrome extension. Do not create, download, or commit one. The client-creation steps below remain useful if the extension ID changes or the OAuth client is rotated.

## Setup steps

1. **Create or select a Google Cloud project.** Open [Google Cloud Console](https://console.cloud.google.com/), use the project picker in the top bar, and choose **New Project** (or select a dedicated existing project). A name such as `GTM Migrate Development` is suitable. Ensure that project remains selected for every following step.

2. **Enable the Tag Manager API.** Open **APIs & Services → Library**, search for **Tag Manager API**, open the result published by Google, and click **Enable**. The API endpoint used by this extension is `tagmanager.googleapis.com` v2.

3. **Configure Google Auth / the OAuth consent screen.** Open **Google Auth Platform** (older console layouts call this **APIs & Services → OAuth consent screen**) and complete the app setup:
   - App name: `GTM Migrate Development`
   - User support email: an address you control
   - Audience: **Internal** if this is a Google Workspace-only project and all testers belong to that organization; otherwise **External**
   - Developer contact: an address you monitor
   - Keep the app in **Testing** while developing. For an External app, add every Google account that will test the extension under **Audience → Test users**.
   - No website, privacy-policy URL, logo, or authorized domain is required for private local testing unless your organization policy requires it.

4. **Declare the minimum scope.** In **Data Access / Scopes**, add only:

   ```text
   https://www.googleapis.com/auth/tagmanager.readonly
   ```

   Do not add `tagmanager.edit.containers`, `tagmanager.publish`, or other write scopes. Google may classify the read-only scope as sensitive and show an unverified-app warning while an External app is in Testing; only listed test users should proceed.

5. **Build and load once to determine the extension ID.** From this repository run:

   ```bash
   npm install
   npm run build
   ```

   Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this repository's `dist` directory. Copy the 32-character **ID** shown on the GTM Migrate card. Keep the checkout at the same filesystem path: Chrome derives an unpacked extension's identity from its installation key/path, so moving it can produce a different ID. If the ID later changes, create/update the OAuth client for the new ID.

6. **Create the correct OAuth client.** Return to the same Cloud project. Open **Google Auth Platform → Clients** (older layout: **APIs & Services → Credentials → Create Credentials → OAuth client ID**). Choose application type **Chrome Extension** (sometimes shown as **Chrome app**), name it `GTM Migrate local`, and paste the exact extension ID from step 5. Create the client.

7. **Redirect/origin information.** A Chrome Extension/Chrome app client asks for the extension ID, not a JavaScript origin or manually entered redirect URI. `chrome.identity.getAuthToken` handles the authorized redirect internally. If Google displays the derived redirect identity, it is based on:

   ```text
   https://EXTENSION_ID.chromiumapp.org/
   ```

   Do not create a **Web application** client and do not add `localhost`, a client secret, or an arbitrary origin to the extension.

8. **Put a new client ID in this repository only when rotating it.** Copy the newly generated value ending in `.apps.googleusercontent.com`. In `public/manifest.json`, replace the existing `oauth2.client_id` value, preserving the JSON quotes. Never add a `client_secret` field. Re-run `npm run build` and click the reload icon for GTM Migrate on `chrome://extensions`.

   The OAuth client ID is a public identifier, not a secret.

9. **Load the final unpacked build.** If it is not already loaded, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist` (not the repository root and not `src`). Pin GTM Migrate from Chrome's Extensions menu if desired.

10. **Verify authentication and API access.** Open the extension, click **Sign in with Google**, and choose a test user that both appears on the OAuth consent-screen test-user list (for External testing) and has access to a GTM account. Approve the single read-only Tag Manager permission. Verify that:
    - the account dropdown populates;
    - choosing an account loads its containers;
    - choosing a container loads its workspaces;
    - **Review workspace changes** opens a full review tab;
    - **Load tags** shows the preserved V0.1 tag workflow;
    - analyzing the README test tag resolves its trigger and variable;
    - export downloads a formatted JSON file containing no token or secret.

## Troubleshooting

- **“OAuth client ID is not configured”**: confirm `public/manifest.json` contains a valid `oauth2.client_id`, run `npm run build`, and reload the extension.
- **`bad client id` / `invalid_client`**: confirm that the credential is a Chrome Extension/Chrome app client created for the exact ID shown in `chrome://extensions`, not a Web application client.
- **`Access blocked` or authorization denied**: add the Google account under OAuth **Test users**, confirm the app is in Testing/Internal mode as intended, then retry.
- **HTTP 403**: confirm the Tag Manager API is enabled in the same Cloud project as the client and the signed-in user has access to the selected GTM resource.
- **No accounts**: open [Google Tag Manager](https://tagmanager.google.com/) with the same Google user and verify that it can see at least one account.
- **Extension ID changed**: create a new Chrome Extension OAuth client for the new ID (or restore the original checkout path), update the manifest client ID, rebuild, and reload.

The extension intentionally uses no `.env` file for OAuth. Chrome reads the public client ID and scope from the bundled manifest.
