import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  saveFormMap, getFormMap, listFormMaps, startReplay, 
  pauseReplay, resumeReplay, cancelReplay, getReplayState 
} from './replay-worker.js';
import { initializeListeners, setTestOverrides, clearTestOverrides } from './debugger-coordinator.js';

describe('replay-worker', () => {
  let sessionStore = {};
  let localStore = {};
  let messages = [];
  let scriptExecutions = [];

  beforeEach(async () => {
    sessionStore = {};
    localStore = {};
    messages = [];
    scriptExecutions = [];


    globalThis.chrome = {
      storage: {
        session: {
          get: async (key) => ({ [key]: sessionStore[key] }),
          set: async (obj) => { Object.assign(sessionStore, obj); },
          remove: async (key) => { delete sessionStore[key]; }
        },
        local: {
          get: async (key) => ({ [key]: localStore[key] }),
          set: async (obj) => { Object.assign(localStore, obj); }
        }
      },
      scripting: {
        executeScript: async (opts) => {
          scriptExecutions.push(opts);
          if (opts.func) {
            const oldWindow = globalThis.window;
            globalThis.window = {
              scrollTo: () => {},
              innerWidth: 1000,
              innerHeight: 800,
              scrollX: 0,
              scrollY: 0
            };
            try {
              return [{ result: opts.func(...(opts.args || [])) }];
            } finally {
              if (oldWindow === undefined) delete globalThis.window;
              else globalThis.window = oldWindow;
            }
          }
        }
      },
      tabs: {
        sendMessage: async (tabId, msg) => {
          messages.push(msg);
          if (msg.type === 'FORM_FILL_FIELD') {
            if (msg.value === 'fail_me') return { ok: false };
            if (msg.value === 'error_me') throw new Error('Tab error');
            return { ok: true };
          }
          if (msg.type === 'FORM_CLICK_NAV') return { ok: true };
          if (msg.type === 'FORM_DETECT_ERRORS') {
            if (tabId === 99) return { errors: [{ field: 'Test', message: 'Err' }] };
            return { errors: [] };
          }
          if (msg.type === 'FORM_WAIT_STABLE') return { ok: true };
        },
        update: async () => ({ status: 'loading' }),
        onUpdated: {
          addListener: (cb) => {
            // Instantly resolve
            setTimeout(() => cb(1, { status: 'complete' }), 0);
          },
          removeListener: () => {}
        },
        captureVisibleTab: (tabId, opts, cb) => {
          cb('data:image/jpeg;base64,mock');
        },
        get: async (tabId) => ({ id: tabId, url: 'http://t' }),
        onRemoved: { addListener: () => {}, removeListener: () => {} }
      },
      debugger: {
        attach: async () => {},
        detach: async () => {},
        sendCommand: async (target, method, params) => {
          commands.push({ method, params });
        },
        onEvent: { addListener: () => {}, removeListener: () => {} },
        onDetach: { addListener: () => {}, removeListener: () => {} }
      },
      runtime: {
        sendMessage: async () => {},
        getURL: (path) => path
      }
    };
    
    // Initialize listeners after chrome is set up
    setTestOverrides({
      acquire: async (tabId, owner) => {
        return { tabId, leaseId: `lease_${tabId}`, owner };
      },
      send: async (lease, method, params) => {
        return {};
      },
      release: async (lease) => {
        // No-op for tests
      }
    });
    
    // Initialize listeners after chrome is set up
    initializeListeners();
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.window;

    clearTestOverrides();
  });

  test('saveFormMap, getFormMap, listFormMaps', async () => {
    const id = await saveFormMap({ name: 'Test', fields: [{}] });
    assert.ok(id.startsWith('form_'));

    const map = await getFormMap(id);
    assert.equal(map.name, 'Test');

    const list = await listFormMaps();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Test');
    assert.equal(list[0].fieldCount, 1);
  });

  test('pauseReplay, resumeReplay, cancelReplay manage state', async () => {
    await saveFormMap({ id: 'form1', name: 'Form 1' });
    
    // Start a dummy replay that will check state
    const parsedCSV = {
      columns: [], selectorMap: new Map(), navActions: [],
      rows: [ { 'F1': 'val1' }, { 'F1': 'val2' } ]
    };
    const formMap = { id: 'form1', fields: [{ label: 'F1', page: 0 }], startUrl: 'http://different' };

    // Set up a trap to pause the replay during the loop
    const originalTabsUpdate = chrome.tabs.update;
    let updateCount = 0;
    chrome.tabs.update = async (tabId, opts) => {
      updateCount++;
      if (updateCount === 1) {
        await pauseReplay();
        setTimeout(() => resumeReplay(), 2000);
      }
      return originalTabsUpdate(tabId, opts);
    };

    const promise = startReplay(1, formMap, parsedCSV);
    
    // Check pause state
    await new Promise(r => setTimeout(r, 100));
    const state = await getReplayState();
    assert.equal(state.status, 'paused');
    
    const result = await promise;
    assert.equal(result.status, 'complete');
  });

  test('startReplay fills fields and clicks nav', async () => {
    const parsedCSV = {
      columns: [], selectorMap: new Map(), navActions: [],
      rows: [ { 'F1': 'val1', 'F2': 'val2' } ]
    };
    const formMap = { 
      id: 'form1', startUrl: 'http://t', totalPages: 2,
      fields: [{ label: 'F1', page: 0 }, { label: 'F2', page: 1 }],
      navActions: [{ page: 0, selector: '#next' }]
    };

    const res = await startReplay(1, formMap, parsedCSV);
    assert.equal(res.status, 'complete');
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].status, 'success');

    const fillMessages = messages.filter(m => m.type === 'FORM_FILL_FIELD');
    assert.equal(fillMessages.length, 2);
    
    const navMessages = messages.filter(m => m.type === 'FORM_CLICK_NAV');
    assert.equal(navMessages.length, 1);
  });

  test('startReplay handles errors and coordinate fallback', async () => {
    const parsedCSV = {
      columns: [], selectorMap: new Map(), navActions: [],
      rows: [ { 'F1': 'fail_me', 'F2': 'error_me' } ]
    };
    const formMap = { 
      id: 'form1', startUrl: 'http://t',
      fields: [
        { label: 'F1', page: 0, coords: { pageX: 100, pageY: 200 } },
        { label: 'F2', page: 0 } // No coords, should trigger vision fallback error
      ]
    };

    const res = await startReplay(99, formMap, parsedCSV); // 99 triggers FORM_DETECT_ERRORS
    assert.equal(res.status, 'complete');
    assert.equal(res.results[0].status, 'error');
    // F1 coordinate fallback will succeed
    // F2 visual fallback will fail (mock)
    assert.match(res.results[0].errorReason, /No active Rover session token/);
    // Tab 99 returns a simulated validation error
    assert.match(res.results[0].errorReason, /Test: Err/);
  });

  test('cancelReplay stops loop', async () => {
    const parsedCSV = { rows: [ { 'F1': 'val1' }, { 'F1': 'val2' } ] };
    const formMap = { id: 'form1', fields: [{ label: 'F1' }] };

    const promise = startReplay(1, formMap, parsedCSV);
    await cancelReplay(); // Cancel immediately
    const res = await promise;
    
    assert.equal(res.status, 'cancelled');
  });
});
