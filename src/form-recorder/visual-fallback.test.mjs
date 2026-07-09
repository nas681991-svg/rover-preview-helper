import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { locateFieldVisually, dispatchCdpClick } from './visual-fallback.js';

describe('visual-fallback', () => {
  let commands = [];
  let attached = new Set();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    commands = [];
    attached.clear();
    
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        get: (tabId, cb) => cb({ windowId: tabId }),
        captureVisibleTab: (windowId, options, cb) => {
          if (windowId === 999) {
            globalThis.chrome.runtime.lastError = { message: 'Capture Error' };
            cb(null);
            globalThis.chrome.runtime.lastError = null;
          } else if (windowId === 998) {
            cb(null); // No data URL
          } else {
            cb('data:image/jpeg;base64,test');
          }
        }
      },
      debugger: {
        attach: async (target) => {
          if (target.tabId === 999) throw new Error('Attach Error');
          attached.add(target.tabId);
        },
        detach: async (target) => {
          attached.delete(target.tabId);
        },
        sendCommand: async (target, method, params) => {
          commands.push({ method, params });
        }
      }
    };
  });

  afterEach(() => {
    delete globalThis.chrome;
    globalThis.fetch = originalFetch;
  });

  test('locateFieldVisually captures tab and calls Vision API', async () => {
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /vision\/locate/);
      assert.equal(opts.headers['Authorization'], 'Bearer test_token');
      const body = JSON.parse(opts.body);
      assert.equal(body.target, 'Test Field');
      return { ok: true, json: async () => ({ boundingBox: { x: 10, y: 20, width: 100, height: 30 } }) };
    };

    const bbox = await locateFieldVisually(null, 'Test Field', { sessionToken: 'test_token' });
    assert.deepEqual(bbox, { x: 10, y: 20, width: 100, height: 30 });
  });

  test('locateFieldVisually handles missing token', async () => {
    await assert.rejects(locateFieldVisually(null, 'Test', {}), /No session token/);
  });

  test('locateFieldVisually handles capture error', async () => {
    globalThis.chrome.tabs.captureVisibleTab = (winId, opts, cb) => {
      globalThis.chrome.runtime.lastError = { message: 'Capture Error' };
      cb(null);
      globalThis.chrome.runtime.lastError = null;
    };
    await assert.rejects(locateFieldVisually(999, 'Test', { sessionToken: 'test' }), /Capture Error/);
  });

  test('locateFieldVisually handles missing dataUrl', async () => {
    globalThis.chrome.tabs.captureVisibleTab = (winId, opts, cb) => {
      cb(null);
    };
    const res = await locateFieldVisually(998, 'Test', { sessionToken: 'test' });
    assert.equal(res, null);
  });

  test('locateFieldVisually handles fetch error', async () => {
    globalThis.fetch = async () => { throw new Error('Fetch Error'); };
    const originalError = console.error;
    console.error = () => {};
    const res = await locateFieldVisually(null, 'Test', { sessionToken: 't' });
    console.error = originalError;
    assert.equal(res, null);
  });

  test('locateFieldVisually handles not ok response', async () => {
    globalThis.fetch = async () => ({ ok: false, text: async () => 'err' });
    const originalWarn = console.warn;
    console.warn = () => {};
    const res = await locateFieldVisually(null, 'Test', { sessionToken: 't' });
    console.warn = originalWarn;
    assert.equal(res, null);
  });

  test('locateFieldVisually handles missing boundingBox', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    const res = await locateFieldVisually(null, 'Test', { sessionToken: 't' });
    assert.equal(res, null);
  });

  test('dispatchCdpClick attaches, sends clicks, and detaches', async () => {
    await dispatchCdpClick(1, 100, 200);
    assert.equal(commands.length, 2);
    assert.equal(commands[0].method, 'Input.dispatchMouseEvent');
    assert.equal(commands[0].params.type, 'mousePressed');
    assert.equal(commands[0].params.x, 100);
    assert.equal(commands[1].params.type, 'mouseReleased');
    assert.equal(attached.size, 0); // Attached then detached
  });

  test('dispatchCdpClick handles already attached', async () => {
    attached.add(999);
    await dispatchCdpClick(999, 10, 20); // attach will throw, so it continues
    assert.equal(commands.length, 2);
    assert.equal(attached.size, 1); // Doesn't detach if it didn't attach
  });
});
