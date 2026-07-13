import { chromium } from 'patchright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bugbugDir = path.join(root, 'extensions', 'bugbug');
const roverExtDir = path.join(root, 'app-assets', 'rover');
const sbaseExtDir = path.join(root, 'app-assets', 'sbase-recorder');
const userDataDir = path.join(root, '.playwright-userDataDir-optimize');

function preseedChromePreferences(dir) {
  const defaultDir = path.join(dir, 'Default');
  const prefsPath = path.join(defaultDir, 'Preferences');
  if (existsSync(prefsPath)) return;
  const prefs = { extensions: { ui: { developer_mode: true } } };
  mkdirSync(defaultDir, { recursive: true });
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

const extensions = [bugbugDir, roverExtDir];
if (existsSync(sbaseExtDir)) {
  extensions.push(sbaseExtDir);
}
const extensionsStr = extensions.join(',');

const configs = [
  {
    name: "Baseline Chromium",
    channel: undefined,
    args: [
      `--disable-extensions-except=${extensionsStr}`,
      `--load-extension=${extensionsStr}`,
      '--enable-extensions'
    ]
  },
  {
    name: "Chrome (with disable-extensions-except)",
    channel: 'chrome',
    args: [
      `--disable-extensions-except=${extensionsStr}`,
      `--load-extension=${extensionsStr}`
    ]
  },
  {
    name: "Chrome (without disable-extensions-except)",
    channel: 'chrome',
    args: [
      `--load-extension=${extensionsStr}`
    ]
  },
  {
    name: "Chrome (with legacy manifest flag)",
    channel: 'chrome',
    args: [
      `--load-extension=${extensionsStr}`,
      `--allow-legacy-extension-manifests`
    ]
  },
];

async function runTests() {
  console.log(`Starting autonomous optimization loop. Testing ${configs.length} configurations...`);
  
  for (const config of configs) {
    console.log(`\n======================================================`);
    console.log(`Testing Config: ${config.name}`);
    console.log(`======================================================`);
    
    // Clean user data dir
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    preseedChromePreferences(userDataDir);

    let context;
    try {
      const launchOptions = {
        headless: false,
        ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
          ...config.args
        ]
      };
      if (config.channel) launchOptions.channel = config.channel;

      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
      
      const page = context.pages()[0] || await context.newPage();
      
      // Check Extensions via CDP
      const cdp = await context.newCDPSession(page);
      const { targetInfos } = await cdp.send('Target.getTargets');
      await cdp.detach();
      const extTargets = targetInfos.filter(t => t.url.startsWith('chrome-extension://'));
      
      console.log(`[Result] Extensions loaded: ${extTargets.length} / ${extensions.length}`);
      extTargets.forEach(t => console.log(`  -> ${t.title || 'Unknown'} (${t.url})`));
      
      let passExtensions = false;
      if (extTargets.length >= extensions.length) {
        passExtensions = true;
      }
      
      // Test chrome://extensions/
      console.log(`\nTesting chrome://extensions/ UI access...`);
      let passUI = false;
      let installedExtensions = [];
      try {
        await page.goto('chrome://extensions/', { timeout: 5000, waitUntil: 'load' });
        // Check if extensions-manager exists and extract names
        installedExtensions = await page.evaluate(() => {
          const manager = document.querySelector('extensions-manager');
          if (!manager) return null;
          const itemList = manager.shadowRoot.querySelector('extensions-item-list');
          if (!itemList) return [];
          const items = Array.from(itemList.shadowRoot.querySelectorAll('extensions-item'));
          return items.map(item => item.shadowRoot.querySelector('#name').textContent.trim());
        });
        
        if (installedExtensions !== null) {
          console.log(`[Result] chrome://extensions/ loaded successfully!`);
          passUI = true;
          console.log(`[Result] Installed Extensions according to UI:`, installedExtensions);
        } else {
          console.log(`[Result] Page loaded but <extensions-manager> element missing (UI blocked).`);
        }
      } catch (err) {
        console.log(`[Result] Failed to load chrome://extensions/: ${err.message}`);
      }
      
      const ourExtsLoaded = installedExtensions && installedExtensions.filter(n => n.includes('Rover') || n.includes('BugBug') || n.includes('SeleniumBase')).length;
      
      console.log(`\n--- SUMMARY FOR ${config.name} ---`);
      console.log(`Our Extensions Loaded: ${ourExtsLoaded >= 3 ? 'PASS' : 'FAIL'} (${ourExtsLoaded || 0}/3)`);
      console.log(`chrome:// UI Access: ${passUI ? 'PASS' : 'FAIL'}`);
      
    } catch (err) {
      console.error(`Config threw error during launch:`, err);
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }
}

runTests().then(() => console.log('\nOptimization complete.'));
