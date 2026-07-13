import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let startRecording, stopRecording, getRecordingState;

function setupDOM(html = '') {
  const dom = new JSDOM(html, { url: 'https://test.com' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.Node = dom.window.Node;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.CSS = { escape: (s) => s };
  
  // Mock missing layout methods
  globalThis.window.scrollX = 0;
  globalThis.window.scrollY = 0;
  
  const Element = dom.window.Element;
  Element.prototype.getBoundingClientRect = function() {
    return { top: 10, left: 20, width: 100, height: 20 };
  };
}

describe('recorder', () => {
  let messages = [];

  beforeEach(async () => {
    setupDOM();
    messages = [];
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (cb) => { messages.push(cb); }
        }
      },
      storage: {
        session: {
          set: async () => {}
        }
      }
    };
    
    const mod = await import('./recorder.js?update=' + Date.now());
    startRecording = mod.startRecording;
    stopRecording = mod.stopRecording;
    getRecordingState = mod.getRecordingState;
  });

  afterEach(async () => {
    await stopRecording();
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.location;
    delete globalThis.chrome;
    delete globalThis.Node;
    delete globalThis.MutationObserver;
    delete globalThis.CSS;
  });

  test('startRecording initializes state and finds existing fields', () => {
    setupDOM('<input id="f1"><select id="s1"></select>');
    const res = startRecording();
    assert.equal(res.ok, true);
    assert.equal(res.fieldCount, 2);
    
    const state = getRecordingState();
    assert.equal(state.recording, true);
    assert.equal(state.fieldCount, 2);

    const res2 = startRecording();
    assert.equal(res2.ok, false);
    assert.equal(res2.reason, 'Already recording');
  });

  test('stopRecording returns captured fields and resets state', async () => {
    setupDOM('<input id="f1" name="fname">');
    startRecording();
    const res = await stopRecording();
    assert.equal(res.ok, true);
    assert.equal(res.fields.length, 1);
    assert.equal(res.fields[0].columnName, 'Fname'); // heuristic label fallback
    assert.equal(res.totalPages, 1);
    assert.equal(res.startUrl, 'https://test.com/');

    const res2 = await stopRecording();
    assert.equal(res2.ok, false);
    assert.equal(res2.reason, 'Not recording');
  });

  test('records input and mouse events', async () => {
    setupDOM('<input id="f1" name="fname"><button id="btn">Next</button>');
    startRecording();

    // Trigger mousemove
    const mouseEvent = new window.MouseEvent('mousemove', { clientX: 50, clientY: 60 });
    document.dispatchEvent(mouseEvent);

    // Trigger input interaction
    const input = document.getElementById('f1');
    input.value = 'John';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    // Trigger click on button
    const btn = document.getElementById('btn');
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const res = await stopRecording();
    
    assert.equal(res.fields[0].value, 'John');
    assert.equal(res.fields[0].coords.x, 50); // From mouse X
    assert.equal(res.fields[0].coords.y, 60); // From mouse Y
    assert.equal(res.fields[0].coords.pageX, 70); // Computed from rect
    assert.equal(res.fields[0].coords.pageY, 20); // Computed from rect

    assert.equal(res.navActions.length, 1);
    assert.equal(res.navActions[0].buttonText, 'Next');
    assert.equal(res.navActions[0].selector, '#btn');
  });

  test('handles unknown tags and ignored fields', async () => {
    setupDOM('<div id="d1"></div><input type="hidden" id="h1"><input type="submit" id="s1">');
    startRecording();
    const res = await stopRecording();
    assert.equal(res.fields.length, 0); // They should be ignored
  });

  test('discovers dynamically added fields via MutationObserver', async () => {
    setupDOM();
    startRecording();

    document.body.innerHTML = '<input id="dynamic">';
    // MutationObserver is async, so we must wait
    await new Promise(r => setTimeout(r, 1600));

    const state = getRecordingState();
    assert.equal(state.fieldCount, 1);

    await stopRecording();
  });
});
