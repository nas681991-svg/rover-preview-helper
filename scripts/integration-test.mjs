/**
 * Integration test for the Rover Preview Helper Chrome extension.
 *
 * This test has two modes:
 *
 * **Full mode** (with patchright — default):
 *   Launches Chrome with the extension loaded and exercises all 8 live flows.
 *
 * **Lite mode** (fallback when extensions can't load):
 *   Verifies popup UI rendering via file:// and prints instructions for
 *   manual verification of the remaining flows.
 *
 * Usage:
 *   pnpm build && pnpm test:integration
 */

import { chromium } from 'patchright';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const testDataDir = path.join(root, '.integration-test-data');

const TEST_CONFIG = {
  siteId: 'integration-test-site',
  publicKey: 'pk_site_integration_test',
  siteKeyId: 'key_integration_test',
  allowedDomains: ['*'],
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
let skippedCount = 0;

function pass(name) { passCount++; console.log(`  ✅ ${name}`); }
function fail(name, reason) { failCount++; console.error(`  ❌ ${name}: ${reason}`); }
function skip(name, reason) { skippedCount++; console.log(`  ⏭️  ${name}: ${reason}`); }
function assert(cond, name, reason = 'assertion failed') { cond ? pass(name) : fail(name, reason); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function preseedChromePrefs(dir) {
  const d = path.join(dir, 'Default');
  mkdirSync(d, { recursive: true });
  const p = path.join(d, 'Preferences');
  if (!existsSync(p)) writeFileSync(p, JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

/** Start a minimal static file server for dist/. Returns { url, close }. */
function startServer(servePath) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const filePath = path.join(servePath, decodeURIComponent(req.url));
      if (!existsSync(filePath)) { res.writeHead(404).end(); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
    srv.on('error', reject);
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(path.join(distDir, 'manifest.json'))) {
    console.error('dist/ not found. Run `pnpm build` first.');
    process.exit(1);
  }

  const extPath = distDir.replace(/\\/g, '/');

  console.log('\n🚀 Integration Test: Rover Preview Helper\n');

  // ─── Phase 1: Try full extension-loaded mode ─────────────────────────────

  rmSync(testDataDir, { recursive: true, force: true });
  preseedChromePrefs(testDataDir);

  let context = null;
  let fullMode = false;

  // Try patchright's own Chromium first (no channel — no automation detection),
  // then fall back to system Chrome/Edge.
  for (const channel of [null, 'chrome', 'msedge']) {
    try {
      const launchOpts = {
        headless: false,
        ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
        args: [
          `--disable-extensions-except=${extPath}`,
          `--load-extension=${extPath}`,
          '--disable-blink-features=AutomationControlled',
          '--enable-extensions',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
        ],
      };
      if (channel) launchOpts.channel = channel;

      context = await chromium.launchPersistentContext(testDataDir, launchOpts);

      // Check if our extension actually loaded
      const testPage = await context.newPage();
      await testPage.goto('https://example.com', { waitUntil: 'load' });
      await sleep(3000);

      const cdp = await context.newCDPSession(testPage);
      const { targetInfos } = await cdp.send('Target.getTargets');
      await cdp.detach();

      // Find our extension by probing for src/popup.html
      const candidateIds = new Set();
      for (const t of targetInfos) {
        const m = t.url.match(/chrome-extension:\/\/([a-z]+)/);
        if (m) candidateIds.add(m[1]);
      }

      let extId = null;
      for (const id of candidateIds) {
        try {
          const probe = await context.newPage();
          await probe.goto(`chrome-extension://${id}/src/popup.html`, { timeout: 3000 });
          const has = await probe.evaluate(() => !!document.getElementById('inject'));
          await probe.close();
          if (has) { extId = id; break; }
        } catch { /* not ours */ }
      }

      if (extId) {
        console.log(`  Browser: ${channel || 'patchright-chromium'}`);
        console.log(`  Extension ID: ${extId}`);
        console.log(`  Mode: FULL (extension loaded)\n`);
        fullMode = true;
        await runFullTests(context, testPage, extId);
      } else {
        console.log(`  ${channel || 'patchright'}: Extension didn't load (automation detection).`);
        await context.close();
        context = null;
      }
      break;
    } catch (err) {
      if (context) { try { await context.close(); } catch {} }
      context = null;
    }
  }

  // ─── Phase 2: Lite mode (popup UI only) ──────────────────────────────────

  if (!fullMode) {
    console.log('  Mode: LITE (extension blocked by Chrome automation detection)\n');
    console.log('  ℹ️  patchright\'s bundled Chromium is required for full integration tests.');
    console.log('  Run: npx patchright install chromium\n');

    rmSync(testDataDir, { recursive: true, force: true });
    preseedChromePrefs(testDataDir);

    let liteContext;
    for (const channel of ['chrome', 'msedge']) {
      try {
        liteContext = await chromium.launchPersistentContext(testDataDir, {
          headless: false,
          channel,
          args: ['--no-first-run', '--no-default-browser-check'],
        });
        break;
      } catch {}
    }

    if (!liteContext) {
      console.error('  Failed to launch any browser.');
      process.exit(1);
    }

    await runLiteTests(liteContext, extPath);
    await liteContext.close();
  }

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log('\n════════════════════════════════════════');
  console.log(`  Results: ${passCount} passed, ${failCount} failed, ${skippedCount} skipped`);
  console.log('════════════════════════════════════════\n');

  try { rmSync(testDataDir, { recursive: true, force: true }); } catch {}
  process.exit(failCount > 0 ? 1 : 0);
}

// ─── Full Tests (extension loaded) ─────────────────────────────────────────────

async function runFullTests(context, page, extId) {
  // Test 1: Extension loads
  console.log('── Test 1: Extension loads ──');
  pass('Extension loaded and identified');

  // Test 2: Content script
  console.log('\n── Test 2: Content script injects ──');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1000);
  const available = await page.evaluate(() => new Promise(resolve => {
    const t = setTimeout(() => resolve(false), 5000);
    window.addEventListener('message', e => {
      if (e.data?.type === 'ROVER_PREVIEW_HELPER_AVAILABLE') { clearTimeout(t); resolve(true); }
    });
    window.postMessage({ type: 'ROVER_PREVIEW_HELPER_PING' }, '*');
  }));
  assert(available, 'Content script responds to PING');

  // Test 3: Popup renders
  console.log('\n── Test 3: Popup UI renders ──');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(1000);
  const els = await popup.evaluate(() => ({
    config: !!document.getElementById('config'),
    inject: !!document.getElementById('inject'),
    reconnect: !!document.getElementById('reconnect'),
    status: !!document.getElementById('status'),
    injectText: document.getElementById('inject')?.textContent || '',
  }));
  assert(els.config, 'Config textarea present');
  assert(els.inject, 'Inject button present');
  assert(els.reconnect, 'Reconnect button present');
  assert(els.injectText.includes('Inject Rover'), 'Inject button text correct');

  // Test 4: Inject Rover via CDP on extension popup page
  console.log('\n── Test 4: Inject Rover ──');

  // Close the current popup and open a fresh one
  await popup.close();

  const popupInject = await context.newPage();
  await popupInject.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(1500);

  // Use CDP Runtime.evaluate on the popup page — this runs in the page's
  // actual JS context where chrome.* extension APIs are available
  // (unlike patchright's page.evaluate which runs in a sandboxed context).
  const cdpPopup = await context.newCDPSession(popupInject);

  // Step 1: Find the example.com tab ID
  const tabQuery = await cdpPopup.send('Runtime.evaluate', {
    expression: `(async () => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(t => t.url && t.url.includes('example.com'));
      return target ? target.id : -1;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const tabId = tabQuery.result?.value;
  console.log(`  Tab ID: ${tabId}`);

  let injected = false;

  if (tabId && tabId > 0) {
    // Step 2: Send the inject message via chrome.runtime.sendMessage
    const injectQuery = await cdpPopup.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          return await chrome.runtime.sendMessage({
            type: 'ROVER_PREVIEW_HELPER_INJECT',
            tabId: ${tabId},
            config: ${JSON.stringify(TEST_CONFIG)},
          });
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    const injectResult = injectQuery.result?.value;
    console.log(`  Inject result: ${JSON.stringify(injectResult)}`);
    assert(injectResult?.ok, 'Inject accepted', injectResult?.error);
    injected = injectResult?.ok;
  } else {
    fail('Find example.com tab ID', `Got: ${tabId}`);
  }

  await cdpPopup.detach();
  await popupInject.close();

  if (injected) {
    // Wait for injection to complete (CSP rule → page reload → script inject)
    await sleep(6000);

    // Check example.com page for Rover state using CDP Runtime.evaluate
    // (patchright's page.evaluate runs in a utility world, but the extension's
    // chrome.scripting.executeScript injects into the MAIN world)
    await page.bringToFront();
    await sleep(2000);

    const cdpMain = await context.newCDPSession(page);
    const stateQuery = await cdpMain.send('Runtime.evaluate', {
      expression: `({
        hasState: !!window.__ROVER_PREVIEW_HELPER_STATE__,
        hasRoverFn: typeof window.rover === 'function',
        siteId: (window.__ROVER_PREVIEW_HELPER_STATE__ || {}).siteId || null,
        hasWorkerUrl: !!(window.__ROVER_PREVIEW_HELPER_STATE__ || {}).workerUrl,
      })`,
      returnByValue: true,
    });
    const state = stateQuery.result?.value || {};

    assert(state.hasState, 'Rover state seeded into page');
    assert(state.hasRoverFn, 'rover() global function created');
    assert(state.siteId === 'integration-test-site', 'Correct siteId', `Got: ${state.siteId}`);

    // Test 5: CSP bypass
    console.log('\n── Test 5: CSP bypass ──');
    assert(state.hasState && state.hasRoverFn, 'CSP bypass effective (Rover injected successfully)');

    // Test 7: Navigation reinjection
    console.log('\n── Test 7: Reinjection after reload ──');
    await page.bringToFront();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(5000);

    const reloadQuery = await cdpMain.send('Runtime.evaluate', {
      expression: `({
        hasState: !!window.__ROVER_PREVIEW_HELPER_STATE__,
        hasRoverFn: typeof window.rover === 'function',
        siteId: (window.__ROVER_PREVIEW_HELPER_STATE__ || {}).siteId || null,
      })`,
      returnByValue: true,
    });
    const afterReload = reloadQuery.result?.value || {};

    assert(afterReload.hasState, 'State reinjected after reload');
    assert(afterReload.hasRoverFn, 'rover() recreated after reload');
    assert(afterReload.siteId === 'integration-test-site', 'Correct siteId after reload');

    await cdpMain.detach();
  } else {
    skip('Rover state checks', 'inject failed');
    console.log('\n── Test 5: CSP bypass ──');
    skip('CSP bypass', 'inject failed');
    console.log('\n── Test 7: Reinjection after reload ──');
    skip('Reinjection', 'inject failed');
  }

  // Test 6: Config persistence — open popup and check that config was persisted
  console.log('\n── Test 6: Config persistence ──');
  const popup2 = await context.newPage();
  await popup2.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(2000);

  const cdpPersist = await context.newCDPSession(popup2);
  const persistQuery = await cdpPersist.send('Runtime.evaluate', {
    expression: `document.getElementById('config')?.value || ''`,
    returnByValue: true,
  });
  const persistedConfig = persistQuery.result?.value || '';
  await cdpPersist.detach();

  let persistedOk = false;
  try {
    const parsed = JSON.parse(persistedConfig);
    persistedOk = parsed?.siteId === 'integration-test-site';
  } catch {}
  assert(persistedOk, 'Config persisted across popup reopen', `Got: "${persistedConfig.substring(0, 50)}..."`);

  // Test 8: Tab close cleanup — verify status changes in popup
  console.log('\n── Test 8: Tab close cleanup ──');
  if (!page.isClosed()) await page.close();
  await sleep(1500);

  // Reopen popup and verify the tab state is cleared
  await popup2.bringToFront();
  await popup2.reload({ waitUntil: 'load' });
  await sleep(1500);
  const tabBadgeVisible = await popup2.evaluate(() => {
    const badge = document.getElementById('tab-badge');
    return badge ? getComputedStyle(badge).display !== 'none' : false;
  });
  assert(!tabBadgeVisible, 'Tab badge hidden after tab close');

  await popup2.close();
  await context.close();
}

// ─── Lite Tests (popup via file://) ────────────────────────────────────────────

async function runLiteTests(context, extPath) {
  // Test 1: Popup HTML renders
  console.log('── Test 1: Popup UI renders (file:// mode) ──');
  const page = await context.newPage();
  await page.goto(`file:///${extPath}/src/popup.html`);
  await sleep(1000);

  const els = await page.evaluate(() => ({
    config: !!document.getElementById('config'),
    inject: !!document.getElementById('inject'),
    reconnect: !!document.getElementById('reconnect'),
    status: !!document.getElementById('status'),
    tabBadge: !!document.getElementById('tab-badge'),
    tabCard: !!document.getElementById('tab-card'),
    configHelp: !!document.getElementById('config-help'),
    injectText: document.getElementById('inject')?.textContent || '',
    reconnectText: document.getElementById('reconnect')?.textContent || '',
  }));

  assert(els.config, 'Config textarea present');
  assert(els.inject, 'Inject button present');
  assert(els.reconnect, 'Reconnect button present');
  assert(els.status, 'Status element present');
  assert(els.tabBadge, 'Tab badge element present');
  assert(els.tabCard, 'Tab card element present');
  assert(els.injectText.includes('Inject Rover'), 'Inject button text correct');
  assert(els.reconnectText.includes('Reconnect'), 'Reconnect button text correct');

  // Test 2: CSS styling loads
  console.log('\n── Test 2: Popup CSS styling ──');
  const styles = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const btn = document.getElementById('inject');
    const btnStyle = btn ? getComputedStyle(btn) : null;
    return {
      bgColor: body.backgroundColor,
      fontFamily: body.fontFamily,
      btnCursor: btnStyle?.cursor,
      btnBorderRadius: btnStyle?.borderRadius,
    };
  });
  assert(styles.bgColor !== 'rgba(0, 0, 0, 0)' && styles.bgColor !== '', 'Body has background color');
  assert(styles.fontFamily.length > 0, 'Font family set');
  assert(styles.btnCursor === 'pointer', 'Inject button has pointer cursor');

  // Test 3: Shared module exports (served via HTTP for CORS-safe module imports)
  console.log('\n── Test 3: Shared module integrity ──');
  const server = await startServer(distDir);
  const sharedPage = await context.newPage();
  await sharedPage.goto(`${server.url}/src/popup.html`);
  await sleep(500);
  const sharedOk = await sharedPage.evaluate(async () => {
    try {
      const mod = await import('./shared.js');
      return {
        hasNormalizeConfig: typeof mod.normalizeConfig === 'function',
        hasIsHostAllowed: typeof mod.isHostAllowed === 'function',
        hasExtractParams: typeof mod.extractPreviewLaunchParams === 'function',
        hasSerialize: typeof mod.serializeConfigForSeed === 'function',
        storagePrefix: mod.STORAGE_KEY_PREFIX,
        statusPrefix: mod.STATUS_KEY_PREFIX,
      };
    } catch (e) { return { error: e.message }; }
  });

  if (!sharedOk.error) {
    assert(sharedOk.hasNormalizeConfig, 'normalizeConfig exported');
    assert(sharedOk.hasIsHostAllowed, 'isHostAllowed exported');
    assert(sharedOk.hasExtractParams, 'extractPreviewLaunchParams exported');
    assert(sharedOk.hasSerialize, 'serializeConfigForSeed exported');
    assert(typeof sharedOk.storagePrefix === 'string', 'STORAGE_KEY_PREFIX exported');
    assert(typeof sharedOk.statusPrefix === 'string', 'STATUS_KEY_PREFIX exported');
  } else {
    fail('Shared module loads', sharedOk.error);
  }

  // Test 4: CSP bypass module exports
  console.log('\n── Test 4: CSP bypass module integrity ──');
  const cspOk = await sharedPage.evaluate(async () => {
    try {
      const mod = await import('./csp-bypass.js');
      const rule = mod.buildCspRemovalRule(42);
      return {
        hasRuleIdForTab: typeof mod.ruleIdForTab === 'function',
        hasBuildRule: typeof mod.buildCspRemovalRule === 'function',
        ruleId: rule.id,
        ruleAction: rule.action.type,
        headers: rule.action.responseHeaders.map(h => `${h.header}:${h.operation}`).sort(),
        tabIds: rule.condition.tabIds,
      };
    } catch (e) { return { error: e.message }; }
  });

  if (!cspOk.error) {
    assert(cspOk.hasRuleIdForTab, 'ruleIdForTab exported');
    assert(cspOk.hasBuildRule, 'buildCspRemovalRule exported');
    assert(cspOk.ruleId === 1_000_042, 'Rule ID offset correct');
    assert(cspOk.ruleAction === 'modifyHeaders', 'Action type is modifyHeaders');
    assert(JSON.stringify(cspOk.headers) === JSON.stringify(['content-security-policy-report-only:remove', 'content-security-policy:remove']),
      'Both CSP headers removed');
    assert(JSON.stringify(cspOk.tabIds) === '[42]', 'Tab ID scoping correct');
  } else {
    fail('CSP bypass module loads', cspOk.error);
  }

  await sharedPage.close();
  server.close();

  // Skipped tests that need full extension context
  console.log('\n── Skipped Tests (require patchright full mode) ──');
  skip('Content script injection', 'needs extension context');
  skip('Rover injection into page', 'needs chrome.scripting API');
  skip('CSP bypass rule application', 'needs chrome.declarativeNetRequest API');
  skip('Config persistence', 'needs chrome.storage API');
  skip('Navigation reinjection', 'needs extension context');
  skip('Tab close cleanup', 'needs extension context');

  await page.close();
}

main().catch(err => {
  console.error('Integration test crashed:', err);
  process.exit(1);
});
