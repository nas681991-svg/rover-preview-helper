import { chromium } from 'patchright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bugbugDir = path.join(root, 'extensions', 'bugbug');
const sbaseExtDir = path.join(root, 'extensions', 'sbase-recorder');
const roverExtDir = path.join(root, 'dist');
const userDataDir = path.join(root, '.playwright-userDataDir');

function preseedChromePreferences(dir) {
  const defaultDir = path.join(dir, 'Default');
  const prefsPath = path.join(defaultDir, 'Preferences');
  if (existsSync(prefsPath)) return;
  const prefs = { extensions: { ui: { developer_mode: true } } };
  mkdirSync(defaultDir, { recursive: true });
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

async function main() {
  console.log('Playwright: Launching browser with extensions...');
  
  const extensions = [bugbugDir, roverExtDir];
  if (existsSync(sbaseExtDir)) {
    extensions.push(sbaseExtDir);
  }
  
  const extensionsStr = extensions.join(',');
  preseedChromePreferences(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionsStr}`,
      `--load-extension=${extensionsStr}`,
      '--disable-blink-features=AutomationControlled',
      '--enable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--enable-logging',
      '--v=1',
    ]
  });
  
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://google.com');
  
  console.log('Playwright: Browser launched. Verifying loaded extensions via CDP...');
  
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  await cdp.detach();
  const extTargets = targetInfos.filter(t => t.url.startsWith('chrome-extension://'));
  
  console.log('--- ACTUAL LOADED EXTENSION TARGETS ---');
  if (extTargets.length === 0) {
    console.log('WARNING: ZERO extensions loaded in the browser!');
  } else {
    extTargets.forEach(t => console.log(`- ${t.title || 'Unknown'} (${t.url})`));
  }
  console.log('---------------------------------------');

  console.log('Pausing Playwright so you can use the native Playwright Inspector Recorder, Bugbug, SeleniumBase Recorder, or Rover Recorder concurrently.');
  await page.pause();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
