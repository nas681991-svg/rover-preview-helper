const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { chromium } = require('patchright');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const crypto = require('crypto');
const isWin = process.platform === 'win32';

const extDataDir = path.join(app.getPath('userData'), 'live-extensions');
const bugbugDir = path.join(extDataDir, 'bugbug');


const { resolveLaunchPlan, acquireExtension } = require('./src/launch-plan.cjs');

/**
 * Pre-seed Chrome Preferences into the user-data-dir so that the browser
 * launches with Developer Mode enabled for extensions.
 * Only writes if the Preferences file does not yet exist (avoids clobbering
 * an established profile where the user may have customised settings).
 */
function computeExtensionId(extPath) {
  const normalised = isWin ? extPath.toLowerCase().replace(/\\/g, '/') : extPath;
  const hash = crypto.createHash('sha256').update(normalised, 'utf8').digest('hex');
  const HEX_TO_CHROME = 'abcdefghijklmnop';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += HEX_TO_CHROME[parseInt(hash[i], 16)];
  }
  return id;
}

function preseedChromePreferences(userDataDir, extensionPaths = []) {
  const defaultDir = path.join(userDataDir, 'Default');
  const prefsPath = path.join(defaultDir, 'Preferences');
  fs.mkdirSync(defaultDir, { recursive: true });

  let prefs = {};
  if (fs.existsSync(prefsPath)) {
    try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8')); } catch (_) { prefs = {}; }
  }

  if (!prefs.extensions) prefs.extensions = {};
  if (!prefs.extensions.ui) prefs.extensions.ui = {};
  if (!prefs.extensions.settings) prefs.extensions.settings = {};

  prefs.extensions.ui.developer_mode = true;

  if (!prefs.background_mode) prefs.background_mode = {};
  prefs.background_mode.enabled = false;

  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

const assetsDir = path.join(process.resourcesPath, 'app-assets');
const localAssetsDir = path.join(__dirname, 'app-assets');
const activeAssetsDir = fs.existsSync(assetsDir) ? assetsDir : localAssetsDir;
const roverExtDir = path.join(activeAssetsDir, 'rover');
const sbaseExtDir = path.join(activeAssetsDir, 'sbase-recorder');

let mainWindow;



let launchInProgress = false;

ipcMain.handle('launch-recorder', async (event, mode = 'playwright-trace') => {
  if (launchInProgress) return 'Error: Recording session already in progress.';
  launchInProgress = true;
  try {
    fs.mkdirSync(extDataDir, { recursive: true });

    const env = {
      extDataDir, bugbugDir, sbaseExtDir, roverExtDir,
      devDist: path.join(__dirname, 'dist'),
      existsSync: fs.existsSync,
      pathJoin: path.join
    };
    
    const plan = resolveLaunchPlan(mode, env);
    if (plan.error) {
      launchInProgress = false;
      return `Error: ${plan.error}`;
    }

    const sys = {
      fetch: fetch.bind(global),
      mkdirSync: fs.mkdirSync,
      writeFileSync: fs.writeFileSync,
      readFileSync: fs.readFileSync,
      renameSync: fs.renameSync,
      existsSync: fs.existsSync,
      pathDirname: path.dirname,
      pathJoin: path.join,
      AdmZip: AdmZip,
      Buffer: Buffer
    };

    if (plan.warnings && plan.warnings.length > 0) {
      for (const warn of plan.warnings) {
        console.warn(`[WARN] ${warn}`);
      }
    }

    if (plan.missingRequired && plan.missingRequired.length > 0) {
      launchInProgress = false;
      return `Error: Required extensions missing: ${plan.missingRequired.join(', ')}`;
    }

    for (const source of plan.targetSources) {
      try {
        await acquireExtension(source, sys);
      } catch (e) {
        if (mode === 'all') {
          console.warn(`[WARN] ${source.name} update failed:`, e.message);
        } else {
          // If we fail to acquire and it doesn't already exist, fail loud
          if (!fs.existsSync(source.extractDir)) {
             launchInProgress = false;
             return `Error: Failed to acquire ${source.name}: ${e.message}`;
          }
        }
      }
    }

    const finalExtensions = [];
    for (const ext of plan.extensions) {
      if (fs.existsSync(ext.dir)) {
        finalExtensions.push(ext.dir);
      } else {
        if (mode === 'all') {
          console.warn(`[WARN] Extension '${ext.id}' remains unavailable after acquisition attempt.`);
        } else {
          launchInProgress = false;
          return `Error: Required extension '${ext.id}' is missing after acquisition attempt.`;
        }
      }
    }
    const extensionsStr = finalExtensions.join(',');

    const userDataDir = path.join(app.getPath('userData'), 'browser-data');
    const myRecordsPath = path.join(app.getPath('desktop'), 'MyRecords');
    fs.mkdirSync(myRecordsPath, { recursive: true });

    // ── Atomic Pre-Flight Pipeline ─────────────────────────────
    try {
      fs.accessSync(myRecordsPath, fs.constants.W_OK);
      for (const ext of finalExtensions) {
         if (!fs.existsSync(path.join(ext, 'manifest.json'))) {
            throw new Error(`Extension at ${ext} lacks a manifest.json`);
         }
      }
    } catch (preFlightErr) {
       launchInProgress = false;
       return `Error: Pre-Flight Pipeline failed: ${preFlightErr.message}`;
    }

    // Pre-seed Chrome profile so extensions launch with Developer Mode on.
    preseedChromePreferences(userDataDir, finalExtensions);

    let context = null;
    let launchError = null;
    const channels = [undefined, 'chrome', 'msedge'];

    for (const channel of channels) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, {
          channel,
          headless: false,
          ignoreDefaultArgs: ['--disable-extensions'],
          acceptDownloads: true,
          downloadsPath: myRecordsPath,
          args: [
            ...(extensionsStr ? [
              `--disable-extensions-except=${extensionsStr}`,
              `--load-extension=${extensionsStr}`
            ] : []),
            '--disable-blink-features=AutomationControlled',
            '--enable-extensions',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars',
          ]
        });
        break; // successfully launched
      } catch (err) {
        launchError = { message: `${channel}: ${err.message}`, original: err };
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
        const tracePath = path.join(myRecordsPath, `trace-${Date.now()}-part${chunkCount - 1}.zip`);
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

    // ── Full Interaction Telemetry & Advanced Logging ───────────────────
    const ts = Date.now();
    const unifiedStream = fs.createWriteStream(path.join(myRecordsPath, `unified-telemetry-${ts}.jsonl`), { flags: 'a' });
    const sessionReplayStream = fs.createWriteStream(path.join(myRecordsPath, `session-replay-${ts}.json`), { flags: 'a' });

    sessionReplayStream.write('['); // Start JSON array for rrweb

    await context.exposeBinding('__advancedLogFlush', async (_source, batch) => {
      if (!Array.isArray(batch) || batch.length === 0) return;
      for (const evt of batch) {
        unifiedStream.write(JSON.stringify(evt) + '\n');
      }
    });

    await context.exposeBinding('__rrwebFlush', async (_source, batch) => {
      if (!Array.isArray(batch) || batch.length === 0) return;
      for (const evt of batch) {
        sessionReplayStream.write(JSON.stringify(evt) + ',');
      }
    });

    context.on('request', req => {
      unifiedStream.write(JSON.stringify({ type: 'request', url: req.url(), method: req.method(), headers: req.headers(), ts: Date.now() }) + '\n');
    });

    context.on('response', async res => {
      const status = res.status();
      const req = res.request();
      unifiedStream.write(JSON.stringify({
        type: 'response', url: res.url(), status, timing: req.timing(), ts: Date.now()
      }) + '\n');
      if (status >= 300 && status < 400) {
        unifiedStream.write(JSON.stringify({ type: 'redirect', url: req.url(), status, redirectedTo: res.headers()['location'], ts: Date.now() }) + '\n');
      }
    });

    context.on('console', msg => {
      unifiedStream.write(JSON.stringify({ type: 'console', text: msg.text(), typeOf: msg.type(), ts: Date.now() }) + '\n');
    });

    context.on('pageerror', error => {
      unifiedStream.write(JSON.stringify({ type: 'pageerror', message: error.message, stack: error.stack, ts: Date.now() }) + '\n');
    });

    context.on('frameattached', frame => {
      unifiedStream.write(JSON.stringify({ type: 'frameattached', url: frame.url(), name: frame.name(), ts: Date.now() }) + '\n');
    });

    context.on('framenavigated', frame => {
      unifiedStream.write(JSON.stringify({ type: 'framenavigated', url: frame.url(), name: frame.name(), ts: Date.now() }) + '\n');
    });

    const closeStreams = () => {
      try {
        unifiedStream.end();
        sessionReplayStream.write('null]');
        sessionReplayStream.end();

        // ── Package Output into .mrec Archive ─────────────────────
        setTimeout(() => {
            try {
              const zip = new AdmZip();
              const telemetryPath = path.join(myRecordsPath, `unified-telemetry-${ts}.jsonl`);
              const replayPath = path.join(myRecordsPath, `session-replay-${ts}.json`);
              const tracePattern = `trace-${ts}`;
              
              if (fs.existsSync(telemetryPath)) zip.addLocalFile(telemetryPath);
              if (fs.existsSync(replayPath)) zip.addLocalFile(replayPath);
              
              const files = fs.readdirSync(myRecordsPath);
              files.filter(f => f.startsWith(tracePattern) && f.endsWith('.zip')).forEach(f => {
                 zip.addLocalFile(path.join(myRecordsPath, f));
              });

              const archivePath = path.join(myRecordsPath, `recording-${ts}.mrec`);
              zip.writeZip(archivePath);
              console.log(`✅ Session packaged successfully into ${archivePath}`);

              // Cleanup loose files
              if (fs.existsSync(telemetryPath)) fs.unlinkSync(telemetryPath);
              if (fs.existsSync(replayPath)) fs.unlinkSync(replayPath);
              files.filter(f => f.startsWith(tracePattern) && f.endsWith('.zip')).forEach(f => {
                 fs.unlinkSync(path.join(myRecordsPath, f));
              });

            } catch (err) {
              console.error('❌ Failed to package .mrec archive:', err);
            }
        }, 3000); // Wait for streams to fully flush

      } catch (_) { }
    };
    context.on('close', closeStreams);

    // Add rrweb dependency
    await context.addInitScript({ path: path.join(__dirname, 'node_modules', 'rrweb', 'dist', 'rrweb.umd.min.cjs') });

    await context.addInitScript(() => {
      // ── rrweb Session Replay ──────────────────────────────────────────
      if (window.rrweb && !window.__rrwebStarted) {
        window.__rrwebStarted = true;
        const _rrwebBuffer = [];
        window.rrweb.record({
          emit(event) {
            _rrwebBuffer.push(event);
          }
        });
        setInterval(() => {
          if (_rrwebBuffer.length > 0) {
            try { window.__rrwebFlush(_rrwebBuffer.splice(0)); } catch (_) { }
          }
        }, 2000);
      }

      // ── Web Vitals & Performance Metrics ──────────────────────────────
      if (!window.__perfStarted) {
        window.__perfStarted = true;
        const pushPerf = (type, metric) => {
          try { window.__advancedLogFlush([{ type, ...metric, ts: Date.now() }]); } catch (_) { }
        };

        try {
          const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach(entry => {
              if (['paint', 'largest-contentful-paint', 'layout-shift', 'longtask'].includes(entry.entryType)) {
                pushPerf('perf', {
                  entryType: entry.entryType,
                  name: entry.name,
                  startTime: entry.startTime,
                  duration: entry.duration,
                  url: location.href
                });
              } else if (entry.entryType === 'resource') {
                pushPerf('resource', {
                  entryType: entry.entryType,
                  name: entry.name,
                  startTime: entry.startTime,
                  duration: entry.duration,
                  url: location.href
                });
              }
            });
          });
          observer.observe({ entryTypes: ['paint', 'largest-contentful-paint', 'layout-shift', 'longtask', 'resource'] });
        } catch (e) { }
      }

      // ── DOM Mutation Observer ─────────────────────────────────────────
      if (!window.__domObserverStarted) {
        window.__domObserverStarted = true;
        let mutationsBatch = { added: 0, removed: 0, attrs: 0, chars: 0 };
        const domObserver = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'childList') {
              mutationsBatch.added += m.addedNodes.length;
              mutationsBatch.removed += m.removedNodes.length;
            } else if (m.type === 'attributes') {
              mutationsBatch.attrs++;
            } else if (m.type === 'characterData') {
              mutationsBatch.chars++;
            }
          }
        });
        domObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });

        setInterval(() => {
          if (mutationsBatch.added > 0 || mutationsBatch.removed > 0 || mutationsBatch.attrs > 0 || mutationsBatch.chars > 0) {
            try { window.__advancedLogFlush([{ type: 'dom_mutation_summary', ...mutationsBatch, ts: Date.now(), url: location.href }]); } catch (_) { }
            mutationsBatch = { added: 0, removed: 0, attrs: 0, chars: 0 };
          }
        }, 5000);
      }
    });

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
            chrome.runtime.sendMessage({ ping: true }).catch(() => { });
          }
        } catch (e) { }
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
      page.on('load', async () => {
        try {
          await page.addScriptTag({ path: path.join(__dirname, 'node_modules', 'axe-core', 'axe.js') });
          const results = await page.evaluate(() => window.axe ? window.axe.run() : null);
          if (results && results.violations && results.violations.length > 0) {
            unifiedStream.write(JSON.stringify({ type: 'a11y-audit', url: page.url(), violations: results.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.length })), ts: Date.now() }) + '\n');
          }
        } catch (e) { }
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

    // ── Bidirectional CDP Integration ─────────────────────────────
    try {
      const cdpSession = await context.newCDPSession(page1);
      await cdpSession.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      cdpSession.on('Target.attachedToTarget', async (event) => {
         const { sessionId, targetInfo } = event;
         if (targetInfo.url.startsWith('chrome-extension://')) {
            console.log(`[CDP] Attached to extension: ${targetInfo.url}`);
         }
      });
    } catch (e) {
      console.warn('[CDP] Failed to establish bidirectional channel:', e);
    }

    if (mode === 'bugbug') {
      await page1.goto('https://app.bugbug.io/sign-in/');
    } else if (mode === 'rover') {
      await page1.goto('https://rover.rtrvr.ai/login');
    } else {
      await page1.goto('https://google.com');
    }

    const extPage = await context.newPage();
    await extPage.goto('chrome://extensions/');
    await extPage.bringToFront();
    // Wait for extensions to load and render
    await extPage.waitForTimeout(3000);
    // Request a desktop screenshot visually verifying the extensions page
    fs.writeFileSync(path.join(__dirname, 'request_screenshot.txt'), 'capture');
    await extPage.waitForTimeout(2000); // Give daemon time to capture
    // Return to original page
    await page1.bringToFront();

    let mcpProcess = null;
    if (mode === 'all') {
      try {
        const mcpCommand = isWin ? 'npx.cmd' : 'npx';
        mcpProcess = spawn(mcpCommand, ['-y', '@playwright/mcp@latest'], {
          stdio: 'ignore',
          detached: true
        });
        mcpProcess.unref();
      } catch (e) {
        console.error('Failed to launch Playwright MCP:', e);
      }
    }

    // Wait for the browser to be closed by the user before reporting success.
    await new Promise(resolve => context.on('close', resolve));
    if (mcpProcess) {
      try { process.kill(isWin ? mcpProcess.pid : -mcpProcess.pid); } catch (_) { }
    }
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
    })).sort((a, b) => b.name.localeCompare(a.name));
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
    const normalizedBase = (isWin ? myRecordsPath.toLowerCase() : myRecordsPath) + (myRecordsPath.endsWith(path.sep) ? '' : path.sep);
    if (!normalizedResolved.startsWith(normalizedBase)) {
      return 'Error: Access denied — path outside MyRecords directory.';
    }
    return fs.readFileSync(resolved, 'utf-8');
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
});

ipcMain.handle('extract-pdf', async (event, base64, filename) => {
  try {
    if (!process.env.LLAMAPARSE_API_KEY && !process.env.MINDEE_API_KEY) {
      return { ok: false, error: 'No PDF extraction API keys configured. Please provide LLAMAPARSE_API_KEY or MINDEE_API_KEY.' };
    }

    // Dynamically import the ES modules
    const { extractFromPDF } = await import('file://' + path.resolve(__dirname, 'src/form-recorder/pdf-pipeline.js'));
    const { convertToSkill } = await import('file://' + path.resolve(__dirname, 'src/form-recorder/skill-converter.js'));

    const buffer = Buffer.from(base64, 'base64');
    const defaultColumns = [
      'invoiceNumber', 'invoiceDate', 'dueDate', 'supplierName',
      'supplierAddress', 'customerName', 'customerAddress',
      'totalAmount', 'totalNet', 'totalTax', 'currency'
    ];

    // ArrayBuffer is required by the pipeline
    const { rows } = await extractFromPDF(buffer.buffer, defaultColumns);
    const row = rows[0] || {};

    const formMap = {
      name: filename.replace(/\.[^/.]+$/, ''),
      startUrl: 'https://example.com/invoice-entry',
      fields: Object.keys(row).filter(k => row[k]).map(k => ({
        name: k,
        label: k,
        columnName: k,
        fieldType: 'string'
      }))
    };

    const skill = convertToSkill(formMap);

    const myRecordsPath = path.join(app.getPath('desktop'), 'MyRecords');
    fs.mkdirSync(myRecordsPath, { recursive: true });

    const outPath = path.join(myRecordsPath, `${formMap.name}.skill.json`);
    fs.writeFileSync(outPath, JSON.stringify(skill, null, 2));

    return { ok: true, skill };
  } catch (err) {
    console.error('PDF extraction error:', err);
    return { ok: false, error: err.message };
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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    
    // Auto launch for testing
    setTimeout(() => {
      console.log('AUTO-LAUNCHING RECORDER FOR TESTING...');
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`document.querySelector('#launchBtn').click()`).catch(console.error);
      }
    }, 2000);

  // ── Integrated Visual Capture Daemon ─────────────────────────────
  setInterval(async () => {
    const reqFile = path.join(__dirname, 'request_screenshot.txt');
    if (fs.existsSync(reqFile)) {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
        if (sources.length > 0) {
          const imgBuffer = sources[0].thumbnail.toPNG();
          fs.writeFileSync(path.join(__dirname, 'desktop.png'), imgBuffer);
          console.log('✅ Screenshot saved to desktop.png (Node.js integrated)');
        }
      } catch (e) {
        console.error('❌ Failed to capture screen:', e);
      }
      try { fs.unlinkSync(reqFile); } catch (_) { }
    }
  }, 500);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
