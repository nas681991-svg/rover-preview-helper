import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startNetworkCapture, stopNetworkCapture } from './network-capture.js';
import { initializeListeners, setTestOverrides, clearTestOverrides } from './debugger-coordinator.js';

describe('network-capture', () => {
  let listeners = [];
  let attached = new Set();
  let commands = [];

  beforeEach(async () => {
    listeners = [];
    attached.clear();
    commands = [];
    
    globalThis.chrome = {
      debugger: {
        attach: async (target, version) => {
          if (target.tabId === 999) throw new Error('Cannot attach to this target');
          if (target.tabId === 998) throw new Error('Some other error');
          attached.add(target.tabId);
        },
        detach: async (target) => {
          if (target.tabId === 997) throw new Error('Detach error');
          attached.delete(target.tabId);
        },
        sendCommand: async (target, method, params) => {
          commands.push({ target, method, params });
          if (method === 'Network.getResponseBody') {
            if (params.requestId === 'req-1') return { body: '{"success":true}' };
            throw new Error('No body available');
          }
        },
        onEvent: {
          addListener: (cb) => listeners.push(cb),
          removeListener: (cb) => {
            listeners = listeners.filter(l => l !== cb);
          }
        },
        onDetach: { addListener: () => {}, removeListener: () => {} }
      },
      tabs: { onRemoved: { addListener: () => {}, removeListener: () => {} } }
    };

    // Mock coordinator functions
    setTestOverrides({
      acquire: async (tabId, owner) => {
        if (tabId === 999) throw new Error('Cannot attach to this target');
        if (tabId === 998) throw new Error('Some other error');
        attached.add(tabId);
        return { tabId, leaseId: `lease_${tabId}`, owner };
      },
      send: async (lease, method, params) => {
        commands.push({ target: { tabId: lease.tabId }, method, params });
        if (method === 'Network.getResponseBody') {
          if (params.requestId === 'req-1') return { body: '{"success":true}' };
          throw new Error('No body available');
        }
        return {};
      },
      release: async (lease) => {
        if (lease.tabId === 997) throw new Error('Detach error');
        attached.delete(lease.tabId);
      },
      addEventListener: (owner, fn) => {
        listeners.push(fn);
      },
      removeEventListener: (owner, fn) => {
        listeners = listeners.filter(l => l !== fn);
      }
    });
    
    // Initialize listeners after chrome is set up
    initializeListeners();
  });

  afterEach(() => {
    delete globalThis.chrome;
    clearTestOverrides();
  });

  test('startNetworkCapture attaches and enables network', async () => {
    const res = await startNetworkCapture(1);
    assert.equal(res, true);
    assert.ok(attached.has(1));
    assert.equal(commands[0].method, 'Network.enable');
  });

  test('startNetworkCapture handles "Cannot attach to this target"', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    const res = await startNetworkCapture(999);
    console.warn = originalWarn;
    assert.equal(res, false);
  });

  test('startNetworkCapture throws other errors', async () => {
    await assert.rejects(startNetworkCapture(998), /Some other error/);
  });

  test('captures requests and fetches response body', async () => {
    await startNetworkCapture(2);
    
    // Simulate events (use the last registered listener, which is onEvent)
    const cb = listeners[listeners.length - 1];
    
    // Request 1: Valid POST
    cb({ tabId: 2 }, 'Network.requestWillBeSent', {
      requestId: 'req-1',
      type: 'XHR',
      request: {
        url: 'https://api.test/submit',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        postData: '{"name":"Alice"}',
        hasPostData: true
      }
    });

    // Request 2: Ignore wrong tab
    cb({ tabId: 3 }, 'Network.requestWillBeSent', {});

    // Request 3: Ignore GET
    cb({ tabId: 2 }, 'Network.requestWillBeSent', {
      requestId: 'req-2',
      type: 'Fetch',
      request: { method: 'GET' }
    });

    // Response 1
    cb({ tabId: 2 }, 'Network.responseReceived', {
      requestId: 'req-1',
      response: { status: 200, mimeType: 'application/json' }
    });

    // Ignore unknown response
    cb({ tabId: 2 }, 'Network.responseReceived', {
      requestId: 'unknown',
      response: {}
    });

    // Loading Finished 1
    cb({ tabId: 2 }, 'Network.loadingFinished', {
      requestId: 'req-1'
    });

    // Ignore unknown loading
    cb({ tabId: 2 }, 'Network.loadingFinished', {
      requestId: 'unknown'
    });

    // Wait for the async getResponseBody command to resolve
    await new Promise(r => setTimeout(r, 10));

    // Test Stop
    const reqs = await stopNetworkCapture(2);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].url, 'https://api.test/submit');
    assert.equal(reqs[0].responseBody, '{"success":true}');
    assert.equal(reqs[0].responseStatus, 200);
  });

  test('stopNetworkCapture handles missing session and detach errors', async () => {
    const empty = await stopNetworkCapture(5);
    assert.deepEqual(empty, []);

    await startNetworkCapture(997);
    const res = await stopNetworkCapture(997);
    assert.ok(Array.isArray(res));
  });

  test('startNetworkCapture restarts if called on same tab', async () => {
    await startNetworkCapture(10);
    await startNetworkCapture(10); // Should stop the old one
    assert.ok(attached.has(10));
    await stopNetworkCapture(10);
  });
});
