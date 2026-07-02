import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bugbugDir = path.join(root, 'extensions', 'bugbug');
const sbaseExtDir = path.join(root, 'extensions', 'sbase-recorder');
const roverExtDir = path.join(root, 'dist');

async function main() {
  console.log('Playwright: Launching browser with extensions...');
  
  const extensions = [bugbugDir, roverExtDir];
  if (existsSync(sbaseExtDir)) {
    extensions.push(sbaseExtDir);
  }
  
  const extensionsStr = extensions.join(',');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionsStr}`,
      `--load-extension=${extensionsStr}`
    ]
  });
  
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://google.com');
  
  console.log('Playwright: Browser launched. All extensions are loaded.');
  console.log('Pausing Playwright so you can use the native Playwright Inspector Recorder, Bugbug, SeleniumBase Recorder, or Rover Recorder concurrently.');
  await page.pause();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
