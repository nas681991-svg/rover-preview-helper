import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { vendorBase, vendorTargets, looksLikeRoverRuntime, vendorSeleniumBaseRecorder } from './vendor.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { rm, stat } from 'node:fs/promises';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('vendor', () => {
  test('vendorBase uses env or default', () => {
    assert.equal(vendorBase({}), 'https://rover.rtrvr.ai');
    assert.equal(vendorBase({ ROVER_EMBED_BASE: 'http://test.com/' }), 'http://test.com');
  });

  test('vendorTargets returns targets', () => {
    const targets = vendorTargets('http://base', '/dist');
    assert.equal(targets.length, 2);
    assert.equal(targets[0].name, 'embed');
    assert.equal(targets[0].url, 'http://base/embed-core.js');
    assert.equal(targets[1].name, 'worker');
    assert.equal(targets[1].url, 'http://base/worker/worker.js');
  });

  test('looksLikeRoverRuntime validates embed', () => {
    assert.equal(looksLikeRoverRuntime('embed', 'short'), false);
    assert.equal(looksLikeRoverRuntime('embed', '<!doctype html>' + 'a'.repeat(2000)), false);
    
    const validEmbed = 'a'.repeat(1024) + '__roverSDK __ROVER_SCRIPT_URL__ window.rover agent.rtrvr.ai data-rover-methods';
    assert.equal(looksLikeRoverRuntime('embed', validEmbed), true);
    
    const invalidEmbed = 'a'.repeat(1024) + '__roverSDK __ROVER_SCRIPT_URL__';
    assert.equal(looksLikeRoverRuntime('embed', invalidEmbed), false);
  });

  test('looksLikeRoverRuntime validates worker', () => {
    const validWorker = 'a'.repeat(1024) + 'self.onmessage self.postMessage';
    assert.equal(looksLikeRoverRuntime('worker', validWorker), true);
    
    const invalidWorker = 'a'.repeat(1024) + 'self.onmessage';
    assert.equal(looksLikeRoverRuntime('worker', invalidWorker), false);
  });
});

describe('vendorSeleniumBaseRecorder', () => {
  const originalFetch = global.fetch;
  const testDestDir = path.join(rootDir, 'test-sbase-recorder');
  const testCacheDir = path.join(rootDir, 'test-sbase-cache');

  afterEach(async () => {
    global.fetch = originalFetch;
    await rm(testDestDir, { recursive: true, force: true });
    await rm(testCacheDir, { recursive: true, force: true });
  });

  function createMockWheel(candidates) {
    const wheelZip = new AdmZip();
    for (const c of candidates) {
      if (c.notZip) {
        wheelZip.addFile(c.name, Buffer.from('not a zip file'));
      } else {
        const extZip = new AdmZip();
        if (c.manifest) {
          extZip.addFile('manifest.json', Buffer.from(JSON.stringify(c.manifest)));
        }
        if (c.otherFile) {
          extZip.addFile(c.otherFile, Buffer.from('content'));
        }
        wheelZip.addFile(c.name, extZip.toBuffer());
      }
    }
    return wheelZip.toBuffer();
  }

  test('fails if PyPI json fetch fails', async () => {
    global.fetch = async () => ({ ok: false, status: 500 });
    
    await assert.rejects(
      vendorSeleniumBaseRecorder({ log: () => {}, destDir: testDestDir, cacheDir: testCacheDir }),
      /PyPI returned 500/
    );
  });

  test('fails if wheel url not found in json', async () => {
    global.fetch = async (url) => {
      if (url.includes('json')) return { ok: true, json: async () => ({ urls: [{ filename: 'test.tar.gz' }] }) };
    };
    
    await assert.rejects(
      vendorSeleniumBaseRecorder({ log: () => {}, destDir: testDestDir, cacheDir: testCacheDir }),
      /No \.whl found/
    );
  });

  test('fails if wheel download fails', async () => {
    global.fetch = async (url) => {
      if (url.includes('json')) return { ok: true, json: async () => ({ urls: [{ filename: 'test.whl', url: 'http://test.whl' }] }) };
      if (url === 'http://test.whl') return { ok: false, status: 404 };
    };
    
    await assert.rejects(
      vendorSeleniumBaseRecorder({ log: () => {}, destDir: testDestDir, cacheDir: testCacheDir }),
      /Wheel download failed with status 404/
    );
  });

  test('fails if no valid candidate discovered', async () => {
    const mockWheel = createMockWheel([
      { name: 'invalid1.zip', manifest: { name: 'Wrong Name' }, otherFile: 'content.js' },
      { name: 'no-manifest.zip', otherFile: 'content.js' },
      { name: 'bad-zip.zip', notZip: true }
    ]);

    global.fetch = async (url) => {
      if (url.includes('json')) return { ok: true, json: async () => ({ urls: [{ filename: 'test.whl', url: 'http://test.whl' }] }) };
      if (url === 'http://test.whl') return { ok: true, arrayBuffer: async () => mockWheel };
    };
    
    await assert.rejects(
      vendorSeleniumBaseRecorder({ log: () => {}, destDir: testDestDir, cacheDir: testCacheDir }),
      /No valid recorder extension candidate discovered/
    );
  });

  test('extracts successfully when valid candidate is found', async () => {
    const mockWheel = createMockWheel([
      { name: 'invalid1.zip', manifest: { name: 'Wrong Name' }, otherFile: 'content.js' },
      { name: 'valid.zip', manifest: { name: 'SeleniumBase Recorder' }, otherFile: 'background.js' }
    ]);

    global.fetch = async (url) => {
      if (url.includes('json')) return { ok: true, json: async () => ({ urls: [{ filename: 'test.whl', url: 'http://test.whl' }] }) };
      if (url === 'http://test.whl') return { ok: true, arrayBuffer: async () => mockWheel };
    };
    
    await vendorSeleniumBaseRecorder({ log: () => {}, destDir: testDestDir, cacheDir: testCacheDir });
    
    const manifestStat = await stat(path.join(testDestDir, 'manifest.json'));
    assert.ok(manifestStat.isFile());
    const bgStat = await stat(path.join(testDestDir, 'background.js'));
    assert.ok(bgStat.isFile());
  });

  test('uses cached wheel when refresh is false', async () => {
    const mockWheel = createMockWheel([
      { name: 'valid.zip', manifest: { name: 'SeleniumBase Recorder' }, otherFile: 'cached.js' }
    ]);
    
    // Write fake cache first
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(testCacheDir, { recursive: true });
    await writeFile(path.join(testCacheDir, 'seleniumbase-4.50.6.whl'), mockWheel);
    
    // Set network to fail to prove it doesn't use network
    global.fetch = async () => ({ ok: false, status: 500 });
    
    await vendorSeleniumBaseRecorder({ log: () => {}, destDir: testDestDir, refresh: false, cacheDir: testCacheDir });
    
    const bgStat = await stat(path.join(testDestDir, 'cached.js'));
    assert.ok(bgStat.isFile());
  });

  test('uses cached wheel when refresh is true but network fails', async () => {
    const mockWheel = createMockWheel([
      { name: 'valid.zip', manifest: { name: 'SeleniumBase Recorder' }, otherFile: 'fallback.js' }
    ]);
    
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(testCacheDir, { recursive: true });
    await writeFile(path.join(testCacheDir, 'seleniumbase-4.50.6.whl'), mockWheel);
    
    // Set network to fail
    global.fetch = async () => ({ ok: false, status: 500 });
    
    await vendorSeleniumBaseRecorder({ log: () => {}, destDir: testDestDir, refresh: true, cacheDir: testCacheDir });
    
    const bgStat = await stat(path.join(testDestDir, 'fallback.js'));
    assert.ok(bgStat.isFile());
  });

});
