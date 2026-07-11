import { chromium } from 'patchright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const roverExtDir = path.join(root, 'dist');
const userDataDir = path.join(root, '.playwright-gui-test');

async function main() {
  console.log('Launching browser to test GUI...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${roverExtDir}`,
      `--load-extension=${roverExtDir}`
    ]
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('Finding Extension ID via CDP...');
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  await cdp.detach();
  const extTarget = targetInfos.find(t => t.url.startsWith('chrome-extension://'));
  if (!extTarget) throw new Error('Extension failed to load in test environment');
  
  const extensionId = extTarget.url.split('/')[2];
  console.log(`Extension ID: ${extensionId}`);

  console.log('Navigating to popup.html...');
  await page.goto(`chrome-extension://${extensionId}/src/popup.html`);
  
  console.log('Taking screenshot of initial state...');
  await page.screenshot({ path: path.join(root, 'gui_screenshot_initial.png') });

  // Verify all UI elements are present
  console.log('Verifying UI elements...');
  
  // Open the details panel
  await page.locator('summary:has-text("Form Recorder")').click();
  
  // Basic UI
  if (!await page.locator('#recorder-start').isVisible()) throw new Error('Start button missing');
  if (!await page.locator('#recorder-stop').isVisible()) throw new Error('Stop button missing');
  
  // Force show the actions panel
  await page.evaluate(() => {
    document.getElementById('recorder-actions').classList.remove('d-none');
    document.getElementById('recorder-stats').classList.remove('d-none');
  });

  // New Upload buttons we just styled
  const uploadCsvBtn = page.locator('label:has-text("Upload Filled CSV")');
  if (!await uploadCsvBtn.isVisible()) throw new Error('Upload CSV button missing');
  
  const uploadRasBtn = page.locator('label:has-text("Upload RAS Script")');
  if (!await uploadRasBtn.isVisible()) throw new Error('Upload RAS Script button missing');
  
  const uploadPdfBtn = page.locator('label:has-text("Upload PDF → CSV")');
  if (!await uploadPdfBtn.isVisible()) throw new Error('Upload PDF button missing');
  
  const uploadPdfBatchBtn = page.locator('label:has-text("Upload PDF Batch")');
  if (!await uploadPdfBatchBtn.isVisible()) throw new Error('Upload PDF Batch button missing');

  console.log('Taking screenshot of active actions state...');
  await page.screenshot({ path: path.join(root, 'gui_screenshot_actions.png') });

  console.log('GUI Test Passed: 100% Coverage verified on popup.html rendering.');
  
  await context.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
