# Build a Chrome Extension with Rover

Use this when you want to test Rover from your own Chrome extension on live sites such as LinkedIn, without installing the Rover npm package.

## Pick a Rover Config First

Start in Rover, then paste the generated values into your extension.

1. Open [https://rtrvr.ai/rover/workspace](https://rtrvr.ai/rover/workspace).
2. Create or select a Rover site.
3. Add the target domain in the site policy, for example `linkedin.com`.
4. Copy the extension/test config JSON from Workspace or Live Test.

For quick demos on arbitrary sites, use the reusable test config from:

- [https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config](https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config)

The config should contain values like:

```json
{
  "siteId": "your_site_id",
  "publicKey": "pk_site_...",
  "siteKeyId": "key_...",
  "apiBase": "https://agent.rtrvr.ai",
  "allowedDomains": ["linkedin.com"],
  "domainScopeMode": "registrable_domain",
  "openOnInit": true,
  "allowActions": true
}
```

Use `publicKey`, not private secrets. Do not put admin tokens, API secrets, or service credentials in an extension.

## Why the Normal Script Tag Fails on Some Sites

Some sites block remote scripts with Content Security Policy. If your extension injects:

```html
<script src="https://rover.rtrvr.ai/embed.js"></script>
```

the page can reject it before Rover boots. Chrome Manifest V3 also expects extension-executed JavaScript to be packaged with the extension, not fetched as remote executable code.

The reliable extension pattern is:

- download Rover runtime files at build time;
- package them inside your extension;
- inject packaged files with `chrome.scripting.executeScript`;
- use Rover config from `rtrvr.ai/rover`.

## Minimal File Layout

```text
my-rover-extension/
  manifest.json
  background.js
  vendor/
    rover-embed.js
    worker.js
```

Download the runtime files once while building your extension:

```bash
mkdir -p vendor
curl -L https://rover.rtrvr.ai/embed-core.js -o vendor/rover-embed.js
curl -L https://rover.rtrvr.ai/worker/worker.js -o vendor/worker.js
```

Keep those files checked into your local hackathon extension or copied into your build output.

For a normal website install, keep using the public `embed.js` snippet. For a
Chrome extension that injects Rover with `chrome.scripting.executeScript`, use
`embed-core.js` as shown here so the full SDK executes without relying on a
page `<script src>` element.

## Manifest Example

This example is scoped to LinkedIn. Change `host_permissions` and `matches` for your target site.

```json
{
  "manifest_version": 3,
  "name": "Rover Hackathon Extension",
  "version": "0.1.0",
  "description": "Run Rover from a packaged Chrome extension.",
  "permissions": ["activeTab", "scripting", "storage", "tabs"],
  "host_permissions": ["https://www.linkedin.com/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_title": "Open Rover"
  },
  "web_accessible_resources": [
    {
      "resources": ["vendor/worker.js"],
      "matches": ["https://www.linkedin.com/*"]
    }
  ]
}
```

## Background Script Example

Click the extension icon to inject Rover into the active tab.

```js
// Clean up ephemeral state on worker startup
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.clear();
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !tab.url) return;

  const url = new URL(tab.url);
  if (!url.hostname.endsWith("linkedin.com")) {
    console.warn("Open a LinkedIn tab first.");
    return;
  }

  // Retrieve state resiliently from session storage
  const sessionState = await chrome.storage.session.get("roverConfig");
  const config = sessionState.roverConfig || {
    siteId: "your_site_id",
    publicKey: "pk_site_...",
    siteKeyId: "key_...",
    apiBase: "https://agent.rtrvr.ai",
    allowedDomains: ["linkedin.com"],
    domainScopeMode: "registrable_domain",
    openOnInit: true,
    allowActions: true,
    workerUrl: chrome.runtime.getURL("vendor/worker.js")
  };

  // Persist active tab tracking
  await chrome.storage.session.set({ lastInjectedTabId: tab.id });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    world: "MAIN",
    injectImmediately: true,
    func: cfg => {
      const rover = window.rover = window.rover || function () {
        (rover.q = rover.q || []).push(arguments);
      };
      rover("boot", cfg);
    },
    args: [config]
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    world: "MAIN",
    injectImmediately: true,
    files: ["vendor/rover-embed.js"]
  });
});
```

## MV3 Service Worker Resilience & Token Management

Manifest V3 service workers are transient and will be killed by the browser after periods of inactivity. To ensure your Rover integration remains stable:

1. **State Storage**: Do not rely on global variables (`const state = {}`) in `background.js` to persist session data. Use `chrome.storage.session` (which stays in memory and survives worker restarts) to store active session IDs and tokens.
2. **Ephemeral Maps**: If you must use global `Map` or `Set` objects for active connections, ensure you have an `onStartup` listener that cleans up stale entries and syncs with `chrome.storage.session`.
3. **Token Auto-Refresh**: If you are using temporary hosted preview tokens instead of persistent Workspace keys, set up a `chrome.alarms` trigger to wake the service worker and refresh the token before it expires.
4. **Telemetry**: Implement structured error logging using `chrome.storage.session` to track silent failures in background tasks that might occur when the popup is closed.

## Use Isolated Content Scripts for Your Own UI

If you are adding your own extension UI or custom automation logic, keep most of it in an isolated content script. Use `world: "MAIN"` only for the small Rover boot bridge above.

Good split:

- `background.js`: extension button, permissions, network calls, storage.
- `content.js`: your overlay UI, DOM reads, click/type helpers.
- `vendor/rover-embed.js`: packaged Rover SDK core.
- `vendor/worker.js`: packaged Rover worker.

This avoids page CSP problems and reduces conflicts with the website's JavaScript.

## Trigger Rover Headlessly And Store Results

If your extension needs to pass user input or a generated prompt into Rover without opening the Rover widget input, use a MAIN-world message bridge and Rover events.

The core shape is:

```js
// MAIN-world bridge, after Rover has booted.
window.rover.send("Extract the visible profile name and headline. Return JSON only.");
window.rover.on("run_completed", result => {
  window.postMessage({
    source: "my-extension-rover-bridge",
    type: "ROVER_HEADLESS_RESULT",
    result
  }, "*");
});
```

Do not expect `rover.send(...)` to return the output directly. It starts an async Rover run. Your extension should listen for `run_completed`, `response_shown`, and `error`, then store the terminal result from the background service worker.

See [HEADLESS_CONTROL.md](./HEADLESS_CONTROL.md) for the full bridge and [examples/headless-control-extension](./examples/headless-control-extension) for a copyable extension skeleton.

## Common Fixes

- **CSP blocks `https://rover.rtrvr.ai/embed.js`**  
  Package `embed-core.js` as `vendor/rover-embed.js` and inject the packaged file.

- **Rover says the host is outside `allowedDomains`**  
  Go back to [https://rtrvr.ai/rover/workspace](https://rtrvr.ai/rover/workspace) and add the domain. `linkedin.com` with `registrable_domain` covers `www.linkedin.com` and its subdomains.

- **Actions are disabled**  
  Make sure the Workspace key has Rover Embed enabled and your config has `allowActions: true`.

- **Worker fails to load**  
  Set `workerUrl: chrome.runtime.getURL("vendor/worker.js")` and include `vendor/worker.js` under `web_accessible_resources`.

- **Windows Native Chrome silently dropping unpacked extensions (`--load-extension` fails)**
  When automating Chrome on Windows via Playwright or Puppeteer, native Chrome installations often silently reject unpacked extensions due to `AutomationControlled` flags. To fix this, do not bind to the native Chrome `channel: 'chrome'`. Instead, use Playwright's bundled Chromium which bypasses this restriction. See the multi-recorder documentation in `README.md`.

- **Extensions not visible during automated testing**
  Our testing harness now supports dynamic extension management and automatically pins extensions to the toolbar by default. If you are building your own harness or launch scripts, ensure you update the `pinned_extensions` preference in the Chrome user data directory to keep your extension visible.
  
  Example snippet for pinning (Node.js):
  ```javascript
  const fs = require('fs');
  const path = require('path');
  const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
  
  if (fs.existsSync(prefsPath)) {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    prefs.extensions = prefs.extensions || {};
    prefs.extensions.pinned_extensions = prefs.extensions.pinned_extensions || [];
    if (!prefs.extensions.pinned_extensions.includes(extensionId)) {
      prefs.extensions.pinned_extensions.push(extensionId);
      fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    }
  }
  ```

- **You need to test many unrelated sites**  
  Use the reusable wildcard config from Live Test. For production-like behavior, use an exact site config from Workspace.

## Replaying Automations with UASL (RAS)

If your extension needs to perform bulk form-filling or record-and-replay tasks, you can leverage the **Unified Automation Script Language (UASL)**.
UASL (exported as `.ras.json`) uses a **Selector Cascade** (CSS -> XPath -> Shadow DOM -> Text -> Vision API) to guarantee field fills even when the DOM changes.

You can trigger a replay programmatically from your background script by sending a message to the `rover-preview-helper`:
```js
chrome.runtime.sendMessage({
  type: 'FORM_REPLAY_START',
  tabId: activeTabId,
  parsedCSV: parsedRasObject // The object output from parseRAS()
});
```
This bypasses fragile single-selector automation and leverages Rover's robust fallback systems.

## Guardrails

- Only automate sites and accounts you are allowed to test.
- Respect target-site terms and rate limits.
- Keep public Rover keys public-only. Never ship private service credentials in an extension.
- Keep extension host permissions narrow when possible.
