import { chromium } from 'patchright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyFingerprintToContext } = require('../src/fingerprint-manager.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const userDataDir = path.join(root, '.screenshot-fingerprint-data');

async function testFingerprintStealth() {
  console.log('Launching Patchright browser with stealth fingerprint manager...');
  
  let context = null;
  const channels = [undefined, 'chrome', 'msedge'];
  for (const channel of channels) {
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel,
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check'
        ]
      });
      break;
    } catch (e) {
      console.log(`Channel ${channel} launch failed, trying next...`);
    }
  }
  if (!context) {
    throw new Error('Failed to launch browser across all available channels');
  }

  const fp = await applyFingerprintToContext(context);
  console.log('Fingerprint seed applied:', fp);

  const page = context.pages()[0] || await context.newPage();
  
  // Test bot sannysoft detection page
  console.log('Navigating to bot detection test page...');
  await page.goto('https://bot.sannysoft.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const screenshotPath = path.join(root, 'fingerprint_stealth_verification.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`✅ Visual verification screenshot saved to: ${screenshotPath}`);

  await context.close();
}

testFingerprintStealth().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
