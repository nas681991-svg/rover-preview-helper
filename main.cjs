const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { chromium } = require('playwright-core');
const fs = require('fs');
const AdmZip = require('adm-zip');
const isWin = process.platform === 'win32';

const extDataDir = path.join(app.getPath('userData'), 'live-extensions');
const bugbugDir = path.join(extDataDir, 'bugbug');

const EXTENSION_SOURCES = [
  {
    name: 'Bugbug',
    url: 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Doiedehaafceacbnnmindilfblafincjb%26uc',
    destZip: () => path.join(extDataDir, 'bugbug.crx'),
    extractDir: bugbugDir,
    isCrx: true,
  }
];

/**
 * Pre-seed Chrome Preferences into the user-data-dir so that the browser
 * launches with Developer Mode enabled for extensions.
 * Only writes if the Preferences file does not yet exist (avoids clobbering
 * an established profile where the user may have customised settings).
 */
function preseedChromePreferences(userDataDir) {
  const defaultDir = path.join(userDataDir, 'Default');
  const prefsPath = path.join(defaultDir, 'Preferences');
  if (fs.existsSync(prefsPath)) return;

  const prefs = {
    extensions: {
      ui: { developer_mode: true }
    }
  };

  fs.mkdirSync(defaultDir, { recursive: true });
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

const assetsDir = path.join(process.resourcesPath, 'app-assets');
const localAssetsDir = path.join(__dirname, 'app-assets');
const activeAssetsDir = fs.existsSync(assetsDir) ? assetsDir : localAssetsDir;
const roverExtDir = path.join(activeAssetsDir, 'rover');
const sbaseExtDir = path.join(activeAssetsDir, 'sbase-recorder');

let mainWindow;

async function downloadExtensionUpdate(url, destZip, extractDir, isCrx = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to download from ${url}`);
    const buffer = await response.arrayBuffer();
    let zipBuffer = Buffer.from(buffer);

    if (isCrx) {
      const magic = zipBuffer.readUInt32LE(0);
      if (magic === 0x34327243) { // 'Cr24'
        const version = zipBuffer.readUInt32LE(4);
        if (version === 2) {
          const publicKeyLength = zipBuffer.readUInt32LE(8);
          const signatureLength = zipBuffer.readUInt32LE(12);
          zipBuffer = zipBuffer.slice(16 + publicKeyLength + signatureLength);
        } else if (version === 3) {
          const headerSize = zipBuffer.readUInt32LE(8);
          zipBuffer = zipBuffer.slice(12 + headerSize);
        }
      }
    }

    fs.mkdirSync(path.dirname(destZip), { recursive: true });
    fs.writeFileSync(destZip, zipBuffer);

    const zip = new AdmZip(destZip);
    await new Promise((resolve, reject) => {
      zip.extractAllToAsync(extractDir, true, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } finally {
    clearTimeout(timeout);
  }
}

let launchInProgress = false;

ipcMain.handle('launch-recorder', async (event, mode = 'playwright-trace') => {
  if (launchInProgress) return 'Error: Recording session already in progress.';
  launchInProgress = true;
  try {
    fs.mkdirSync(extDataDir, { recursive: true });
    
    // Determine which extensions to update and load based on mode
    let targetSources = [];
    if (mode === 'bugbug') targetSources = [EXTENSION_SOURCES.find(e => e.name === 'Bugbug')];
    // 'rover', 'seleniumbase', and 'playwright-trace' don't need external downloads

    for (const ext of targetSources) {
      try {
        await downloadExtensionUpdate(ext.url, ext.destZip(), ext.extractDir, ext.isCrx);
      } catch (e) {
        console.error(`${ext.name} update failed:`, e);
      }
    }

    let extensions = [];
    if (mode === 'rover') {
      extensions = [roverExtDir];
    } else if (mode === 'bugbug') {
      if (fs.existsSync(bugbugDir)) extensions.push(bugbugDir);
    } else if (mode === 'seleniumbase') {
      if (fs.existsSync(sbaseExtDir)) extensions.push(sbaseExtDir);
    }
    const extensionsStr = extensions.join(',');
    
    const userDataDir = path.join(app.getPath('userData'), 'browser-data');
    const myRecordsPath = path.join(app.getPath('desktop'), 'MyRecords');
    fs.mkdirSync(myRecordsPath, { recursive: true });

    // Pre-seed Chrome profile so extensions launch with Developer Mode on.
    preseedChromePreferences(userDataDir);

    let context = null;
    let launchError = null;
    const channels = ['chrome', 'msedge'];
    
    for (const channel of channels) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
          channel: channel, 
          acceptDownloads: true,
          downloadsPath: myRecordsPath,
          ignoreDefaultArgs: ['--enable-automation'],
          args: [
            ...(extensionsStr ? [`--disable-extensions-except=${extensionsStr}`, `--load-extension=${extensionsStr}`] : []),
            '--disable-blink-features=AutomationControlled',
            '--enable-extensions',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars',
          ]
        });
        break; // successfully launched
      } catch (err) {
        launchError = err;
      }
    }

    if (!context) {
      throw new Error(`Failed to launch browser. Please ensure Google Chrome or Microsoft Edge is installed on your system. Details: ${launchError?.message}`);
    }
    
    // Start Native Playwright Tracing with Chunking
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await context.tracing.startChunk({ title: 'Chunk 1' });
    
    let chunkCount = 1;
    const chunkInterval = setInterval(async () => {
      chunkCount++;
      try {
        const tracePath = path.join(myRecordsPath, `trace-${Date.now()}-part${chunkCount-1}.zip`);
        await context.tracing.stopChunk({ path: tracePath });
        await context.tracing.startChunk({ title: `Chunk ${chunkCount}` });
      } catch (err) {
        console.error('Failed to save trace chunk:', err);
      }
    }, 3 * 60 * 1000);
    
    let tracingStopped = false;
    const stopTracing = async () => {
      if (tracingStopped) return;
      clearInterval(chunkInterval);
      const tracePath = path.join(myRecordsPath, `trace-${Date.now()}-part${chunkCount}.zip`);
      await context.tracing.stop({ path: tracePath });
      tracingStopped = true;
    };

    // MV3 Keep-alive ping and SBase sync
    let globalSBaseState = {};
    await context.exposeBinding('syncSBaseState', async (source, state) => {
      if (state) {
        globalSBaseState = { ...globalSBaseState, ...state };
      }
      return globalSBaseState;
    });

    await context.route('https://rover.internal/sbase-state', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(globalSBaseState)
      });
    });

    await context.addInitScript(() => {
      setInterval(() => {
        try {
          if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ping: true}).catch(() => {});
          }
        } catch (e) {}
      }, 20000);
    });

    // Use a counter to track open pages instead of context.pages().length
    // which is unreliable during close events.
    let openPageCount = context.pages().length;
    const attachPageListener = (page) => {
      page.on('close', async () => {
        openPageCount--;
        if (openPageCount <= 0) {
          await stopTracing();
        }
      });
    };

    // Attach to existing pages
    context.pages().forEach(attachPageListener);
    // Attach to future pages
    context.on('page', (page) => {
      openPageCount++;
      attachPageListener(page);
    });
    // Safety net: stop tracing when the entire context closes
    context.on('close', () => void stopTracing());

    const page1 = context.pages()[0] || await context.newPage();
    
    if (mode === 'bugbug') {
      await page1.goto('https://app.bugbug.io/sign-in/');
    } else if (mode === 'rover') {
      await page1.goto('https://rover.rtrvr.ai/login');
    } else {
      await page1.goto('https://google.com'); 
    }
    
    await page1.bringToFront();

    // Wait for the browser to be closed by the user before reporting success.
    await new Promise(resolve => context.on('close', resolve));
    await stopTracing();
    return 'success';
  } catch (error) {
    console.error(error);
    return error.message || 'Unknown error occurred launching Playwright';
  } finally {
    launchInProgress = false;
  }
});

ipcMain.handle('list-records', async () => {
  try {
    const myRecordsPath = path.join(app.getPath('desktop'), 'MyRecords');
    if (!fs.existsSync(myRecordsPath)) return [];
    const files = fs.readdirSync(myRecordsPath);
    return files.map(file => ({
      name: file,
      path: path.join(myRecordsPath, file)
    })).sort((a,b) => b.name.localeCompare(a.name));
  } catch (err) {
    console.error(err);
    return [];
  }
});

ipcMain.handle('read-record', async (event, filePath) => {
  try {
    const myRecordsPath = path.join(app.getPath('desktop'), 'MyRecords');
    const resolved = fs.realpathSync(path.resolve(filePath));
    const normalizedResolved = isWin ? resolved.toLowerCase() : resolved;
    const normalizedBase = isWin ? myRecordsPath.toLowerCase() : myRecordsPath;
    if (!normalizedResolved.startsWith(normalizedBase)) {
      return 'Error: Access denied — path outside MyRecords directory.';
    }
    return fs.readFileSync(resolved, 'utf-8');
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
