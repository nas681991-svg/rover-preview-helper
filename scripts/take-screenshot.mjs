import { chromium } from 'patchright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const userDataDir = path.join(root, '.screenshot-data');

async function main() {
  const extPath = distDir.replace(/\\/g, '/');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
    ]
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://example.com');
  
  await new Promise(r => setTimeout(r, 2000));

  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  await cdp.detach();

  let extId = null;
  for (const t of targetInfos) {
    const m = t.url.match(/chrome-extension:\/\/([a-z]+)/);
    if (m) { extId = m[1]; break; }
  }

  if (extId) {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/src/popup.html`);
    await new Promise(r => setTimeout(r, 1000));
    
    const screenshotPath = process.argv[2] || 'screenshot.png';
    await popup.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);
  } else {
    console.error('Extension not found');
  }

  await context.close();
}

main().catch(console.error);
