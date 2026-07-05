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

  // ── Test 9: Config validation (#4) ────────────────────────────────────────
  console.log('\n── Test 9: Config validation UI ──');
  const popupVal = await context.newPage();
  await popupVal.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(1500);

  const cdpVal = await context.newCDPSession(popupVal);

  // 9a: Valid config shows green indicator
  const valid9a = await cdpVal.send('Runtime.evaluate', {
    expression: `(async () => {
      const ta = document.getElementById('config');
      ta.value = JSON.stringify({ siteId: 'test', publicKey: 'pk_test' });
      ta.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const el = document.getElementById('config-validation');
      return {
        display: el?.style.display,
        className: el?.className,
        text: el?.textContent,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const v9a = valid9a.result?.value || {};
  assert(v9a.className?.includes('valid'), 'Valid config shows green indicator', `Got class: ${v9a.className}`);
  assert(v9a.text?.includes('Valid'), 'Valid config text says Valid', `Got: ${v9a.text}`);

  // 9b: Invalid JSON shows red indicator
  const valid9b = await cdpVal.send('Runtime.evaluate', {
    expression: `(async () => {
      const ta = document.getElementById('config');
      ta.value = '{ broken json';
      ta.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const el = document.getElementById('config-validation');
      return {
        className: el?.className,
        text: el?.textContent,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const v9b = valid9b.result?.value || {};
  assert(v9b.className?.includes('error'), 'Invalid JSON shows error indicator', `Got class: ${v9b.className}`);
  assert(v9b.text?.includes('Invalid JSON'), 'Error text mentions Invalid JSON', `Got: ${v9b.text}`);

  // 9c: Missing required fields shows error
  const valid9c = await cdpVal.send('Runtime.evaluate', {
    expression: `(async () => {
      const ta = document.getElementById('config');
      ta.value = JSON.stringify({ mode: 'full' });
      ta.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const el = document.getElementById('config-validation');
      return {
        className: el?.className,
        text: el?.textContent,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const v9c = valid9c.result?.value || {};
  assert(v9c.className?.includes('error'), 'Missing fields shows error indicator', `Got class: ${v9c.className}`);
  assert(v9c.text?.includes('siteId') || v9c.text?.includes('publicKey'), 'Error mentions missing field', `Got: ${v9c.text}`);

  // 9d: Empty config hides indicator
  const valid9d = await cdpVal.send('Runtime.evaluate', {
    expression: `(async () => {
      const ta = document.getElementById('config');
      ta.value = '';
      ta.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const el = document.getElementById('config-validation');
      return { display: el?.style.display };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const v9d = valid9d.result?.value || {};
  assert(v9d.display === 'none', 'Empty config hides validation indicator', `Got display: ${v9d.display}`);

  await cdpVal.detach();
  await popupVal.close();

  // ── Test 10: Diagnostics panel (#2) ────────────────────────────────────────
  console.log('\n── Test 10: Diagnostics system ──');
  const popupDiag = await context.newPage();
  await popupDiag.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(1500);

  const cdpDiag = await context.newCDPSession(popupDiag);

  // Write a diagnostic entry directly to storage, then reload popup
  const diag10 = await cdpDiag.send('Runtime.evaluate', {
    expression: `(async () => {
      const DIAG_KEY = 'rover-preview-helper:diagnostics';
      const testEntries = [
        { ts: Date.now(), level: 'warn', context: 'test-context', message: 'Test warning message' },
        { ts: Date.now(), level: 'error', context: 'test-error', message: 'Test error message' },
      ];
      await chrome.storage.session.set({ [DIAG_KEY]: testEntries });
      return { written: true };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert(diag10.result?.value?.written, 'Diagnostics written to storage');

  // Reload popup to trigger renderDiagnostics
  await popupDiag.reload({ waitUntil: 'load' });
  await sleep(1500);

  const cdpDiag2 = await context.newCDPSession(popupDiag);
  const diag10b = await cdpDiag2.send('Runtime.evaluate', {
    expression: `(async () => {
      const panel = document.getElementById('diagnostics-panel');
      const count = document.getElementById('diag-count');
      const list = document.getElementById('diagnostics-list');
      return {
        panelDisplay: panel?.style.display,
        count: count?.textContent,
        entries: list?.children.length,
        hasWarnEntry: list?.innerHTML.includes('Test warning'),
        hasErrorEntry: list?.innerHTML.includes('Test error'),
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const d10 = diag10b.result?.value || {};
  assert(d10.panelDisplay !== 'none', 'Diagnostics panel visible when entries exist');
  assert(d10.count === '2', 'Diagnostics count shows 2', `Got: ${d10.count}`);
  assert(d10.entries === 2, 'Two diagnostic entries rendered', `Got: ${d10.entries}`);
  assert(d10.hasWarnEntry, 'Warning entry rendered');
  assert(d10.hasErrorEntry, 'Error entry rendered');

  // Test clear button
  const diag10c = await cdpDiag2.send('Runtime.evaluate', {
    expression: `(async () => {
      document.getElementById('diag-clear')?.click();
      await new Promise(r => setTimeout(r, 500));
      const panel = document.getElementById('diagnostics-panel');
      const DIAG_KEY = 'rover-preview-helper:diagnostics';
      const stored = await chrome.storage.session.get(DIAG_KEY);
      return {
        panelDisplay: panel?.style.display,
        storedEntries: (stored[DIAG_KEY] || []).length,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const d10c = diag10c.result?.value || {};
  assert(d10c.panelDisplay === 'none', 'Diagnostics panel hidden after clear');
  assert(d10c.storedEntries === 0, 'Storage cleared after clear click', `Got: ${d10c.storedEntries}`);

  await cdpDiag2.detach();
  await popupDiag.close();

  // ── Test 11: Sessions panel (#5) ─────────────────────────────────────────
  console.log('\n── Test 11: Sessions panel ──');
  const popupSess = await context.newPage();
  await popupSess.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(1500);

  const cdpSess = await context.newCDPSession(popupSess);

  // Seed fake session states for 2 tabs
  const sess11 = await cdpSess.send('Runtime.evaluate', {
    expression: `(async () => {
      await chrome.storage.session.set({
        'rover-preview-helper:tab:99901': {
          siteId: 'site-alpha',
          targetHost: 'alpha.example.com',
          sessionTokenExpiresAt: 0,
          configRefreshedAt: Date.now() - 120000,
        },
        'rover-preview-helper:tab:99902': {
          siteId: 'site-beta',
          targetHost: 'beta.example.com',
          sessionTokenExpiresAt: Date.now() + 30000, // expiring soon
          configRefreshedAt: Date.now() - 60000,
        },
      });
      return { seeded: true };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert(sess11.result?.value?.seeded, 'Session states seeded');

  // Reload popup to render sessions
  await popupSess.reload({ waitUntil: 'load' });
  await sleep(1500);

  const cdpSess2 = await context.newCDPSession(popupSess);
  const sess11b = await cdpSess2.send('Runtime.evaluate', {
    expression: `(async () => {
      const panel = document.getElementById('sessions-panel');
      const count = document.getElementById('sessions-count');
      const list = document.getElementById('sessions-list');
      const rows = list?.querySelectorAll('.session-row') || [];
      const hosts = Array.from(rows).map(r => r.querySelector('.session-host')?.textContent || '');
      const dots = Array.from(rows).map(r => r.querySelector('.session-dot')?.className || '');
      return {
        panelDisplay: panel?.style.display,
        count: count?.textContent,
        rowCount: rows.length,
        hosts,
        dots,
        hasDisconnect: Array.from(rows).every(r => !!r.querySelector('.session-disconnect')),
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const s11 = sess11b.result?.value || {};
  assert(s11.panelDisplay !== 'none', 'Sessions panel visible with active sessions');
  // Count may include other sessions from earlier tests
  assert(Number(s11.count) >= 2, `Sessions count >= 2`, `Got: ${s11.count}`);
  assert(s11.rowCount >= 2, `At least 2 session rows rendered`, `Got: ${s11.rowCount}`);
  assert(s11.hosts.some(h => h.includes('alpha')), 'Alpha host shown in sessions');
  assert(s11.hosts.some(h => h.includes('beta')), 'Beta host shown in sessions');
  assert(s11.dots.some(d => d.includes('expiring')), 'Expiring session has yellow dot');
  assert(s11.hasDisconnect, 'All rows have disconnect button');

  // Clean up fake sessions
  await cdpSess2.send('Runtime.evaluate', {
    expression: `(async () => {
      await chrome.storage.session.remove(['rover-preview-helper:tab:99901', 'rover-preview-helper:tab:99902']);
    })()`,
    awaitPromise: true,
  });

  await cdpSess2.detach();
  await popupSess.close();

  // ── Test 12: Alarms permission (#3) ──────────────────────────────────────
  console.log('\n── Test 12: Alarms permission & registration ──');
  const popupAlarm = await context.newPage();
  await popupAlarm.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(1000);

  const cdpAlarm = await context.newCDPSession(popupAlarm);
  const alarm12 = await cdpAlarm.send('Runtime.evaluate', {
    expression: `(async () => {
      const alarms = await chrome.alarms.getAll();
      const tokenAlarm = alarms.find(a => a.name === 'rover-token-refresh');
      return {
        alarmCount: alarms.length,
        hasTokenAlarm: !!tokenAlarm,
        period: tokenAlarm?.periodInMinutes || null,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const a12 = alarm12.result?.value || {};
  assert(a12.hasTokenAlarm, 'Token refresh alarm registered');
  assert(a12.period === 1, 'Alarm fires every 1 minute', `Got period: ${a12.period}`);

  await cdpAlarm.detach();
  await popupAlarm.close();

  // ── Test 13: New popup UI elements present ───────────────────────────────
  console.log('\n── Test 13: New UI elements present ──');
  const popupUI = await context.newPage();
  await popupUI.goto(`chrome-extension://${extId}/src/popup.html`);
  await sleep(1000);

  const cdpUI = await context.newCDPSession(popupUI);
  const ui13 = await cdpUI.send('Runtime.evaluate', {
    expression: `({
      hasValidation: !!document.getElementById('config-validation'),
      hasSessionsPanel: !!document.getElementById('sessions-panel'),
      hasSessionsList: !!document.getElementById('sessions-list'),
      hasSessionsCount: !!document.getElementById('sessions-count'),
      hasDiagPanel: !!document.getElementById('diagnostics-panel'),
      hasDiagList: !!document.getElementById('diagnostics-list'),
      hasDiagCount: !!document.getElementById('diag-count'),
      hasDiagClear: !!document.getElementById('diag-clear'),
    })`,
    returnByValue: true,
  });
  const u13 = ui13.result?.value || {};
  assert(u13.hasValidation, 'Validation indicator element exists');
  assert(u13.hasSessionsPanel, 'Sessions panel element exists');
  assert(u13.hasSessionsList, 'Sessions list element exists');
  assert(u13.hasSessionsCount, 'Sessions count element exists');
  assert(u13.hasDiagPanel, 'Diagnostics panel element exists');
  assert(u13.hasDiagList, 'Diagnostics list element exists');
  assert(u13.hasDiagCount, 'Diagnostics count element exists');
  assert(u13.hasDiagClear, 'Diagnostics clear button exists');

  await cdpUI.detach();
  await popupUI.close();

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
    configValidation: !!document.getElementById('config-validation'),
    sessionsPanel: !!document.getElementById('sessions-panel'),
    diagPanel: !!document.getElementById('diagnostics-panel'),
    diagClear: !!document.getElementById('diag-clear'),
    injectText: document.getElementById('inject')?.textContent || '',
    reconnectText: document.getElementById('reconnect')?.textContent || '',
  }));

  assert(els.config, 'Config textarea present');
  assert(els.inject, 'Inject button present');
  assert(els.reconnect, 'Reconnect button present');
  assert(els.status, 'Status element present');
  assert(els.tabBadge, 'Tab badge element present');
  assert(els.tabCard, 'Tab card element present');
  assert(els.configValidation, 'Config validation indicator present');
  assert(els.sessionsPanel, 'Sessions panel present');
  assert(els.diagPanel, 'Diagnostics panel present');
  assert(els.diagClear, 'Diagnostics clear button present');
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
        hasValidateConfig: typeof mod.validateConfigInput === 'function',
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
    assert(sharedOk.hasValidateConfig, 'validateConfigInput exported');
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
