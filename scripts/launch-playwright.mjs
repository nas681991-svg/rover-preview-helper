import { chromium } from 'patchright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bugbugDir = path.join(root, 'extensions', 'bugbug');
const roverExtDir = path.join(root, 'app-assets', 'rover');
const sbaseExtDir = path.join(root, 'app-assets', 'sbase-recorder');
let userDataDir = path.join(root, '.playwright-userDataDir');

function preseedChromePreferences(dir) {
  const defaultDir = path.join(dir, 'Default');
  const prefsPath = path.join(defaultDir, 'Preferences');
  if (existsSync(prefsPath)) return;
  const prefs = { extensions: { ui: { developer_mode: true } } };
  mkdirSync(defaultDir, { recursive: true });
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

function killZombies() {
  console.log('[AUTO-HEAL] Attempting to terminate zombie Chrome/Chromium processes...');
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
      execSync('taskkill /F /IM msedge.exe /T', { stdio: 'ignore' });
    } else {
      execSync('pkill -f chrome', { stdio: 'ignore' });
      execSync('pkill -f chromium', { stdio: 'ignore' });
    }
  } catch (e) {
    // ignore
  }
}

function cleanProfile() {
  console.log('[AUTO-HEAL] Wiping corrupted Playwright user data directory...');
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      killZombies();
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch (err) {
        console.error('[AUTO-HEAL] Unable to delete profile directory. Bypassing lock by generating a fresh ephemeral profile...');
        userDataDir = path.join(root, `.playwright-userDataDir-${Date.now()}`);
      }
    }
  }
}

async function attemptLaunch() {
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
  if (extTargets.length < extensions.length) {
    console.log(`WARNING: Expected ${extensions.length} extensions but only ${extTargets.length} loaded in the browser!`);
    throw new Error('EXTENSIONS_FAILED_TO_LOAD');
  } else {
    extTargets.forEach(t => console.log(`- ${t.title || 'Unknown'} (${t.url})`));
  }
  console.log('---------------------------------------');

  console.log('Pausing Playwright so you can use the native Playwright Inspector Recorder, Bugbug, SeleniumBase Recorder, or Rover Recorder concurrently.');
  await page.pause();
}

async function main(retries = 3) {
  try {
    await attemptLaunch();
  } catch (err) {
    console.error(`\n[CRITICAL FAILURE] Launch crashed: ${err.message}`);
    if (retries === 0) {
      console.error('[AUTO-HEAL] Out of retries. Aborting.');
      process.exit(1);
    }
    
    console.log(`[AUTO-HEAL] Initiating recovery sequence... (${retries} retries left)`);
    cleanProfile();
    
    // Slight backoff
    await new Promise(r => setTimeout(r, 2000));
    await main(retries - 1);
  }
}

main();
