import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let fillFieldBySelector, waitForDomStability;

function setupDOM(html = '') {
  const dom = new JSDOM(html);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Event = dom.window.Event;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.CSS = { escape: s => s };

  // Mock Element animate
  const Element = dom.window.Element;
  Element.prototype.animate = function() { return { cancel: () => {} }; };
  Element.prototype.getAnimations = function() { return []; };
  Element.prototype.scrollIntoView = function() {};
}

describe('replay-engine', () => {
  let messages = [];

  beforeEach(async () => {
    setupDOM();
    messages = [];
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: (cb) => { messages.push(cb); }
        }
      }
    };
    
    const mod = await import('./replay-engine.js?update=' + Date.now());
    fillFieldBySelector = mod.fillFieldBySelector;
    waitForDomStability = mod.waitForDomStability;
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.Event;
    delete globalThis.KeyboardEvent;
    delete globalThis.MutationObserver;
    delete globalThis.chrome;
    delete globalThis.CSS;
  });

  test('fillFieldBySelector handles inputs', async () => {
    setupDOM('<input id="f1">');
    const res = await fillFieldBySelector({ selectorChain: ['#f1'] }, 'test');
    assert.equal(res.ok, true);
    assert.equal(document.getElementById('f1').value, 'test');
  });

  test('fillFieldBySelector handles select dropdown with match', async () => {
    setupDOM('<select id="s1"><option value="us">United States</option></select>');
    const res = await fillFieldBySelector({ selectorChain: ['#s1'], fieldType: 'select' }, 'USA');
    assert.equal(res.ok, true);
    assert.equal(document.getElementById('s1').value, 'us');
  });

  test('fillFieldBySelector handles select dropdown without match', async () => {
    setupDOM('<select id="s1"><option value="us">United States</option></select>');
    const p = fillFieldBySelector({ selectorChain: ['#s1'], fieldType: 'select' }, 'Mars');
    // It creates an overlay. We need to click the resume button.
    await new Promise(r => setTimeout(r, 10)); // let overlay render
    const btn = document.querySelector('button');
    if (btn) btn.click();
    
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.method, 'human');
  });

  test('fillFieldBySelector handles checkbox', async () => {
    setupDOM('<input type="checkbox" id="c1">');
    const res = await fillFieldBySelector({ selectorChain: ['#c1'], fieldType: 'checkbox' }, 'yes');
    assert.equal(res.ok, true);
    assert.equal(document.getElementById('c1').checked, true);
    
    await fillFieldBySelector({ selectorChain: ['#c1'], fieldType: 'checkbox' }, 'no');
    assert.equal(document.getElementById('c1').checked, false);
  });

  test('fillFieldBySelector handles radio', async () => {
    setupDOM('<input type="radio" id="r1">');
    const res = await fillFieldBySelector({ selectorChain: ['#r1'], fieldType: 'radio' }, 'on');
    assert.equal(res.ok, true);
    assert.equal(document.getElementById('r1').checked, true);
  });

  test('fillFieldBySelector handles date', async () => {
    setupDOM('<input type="date" id="d1">');
    const res = await fillFieldBySelector({ selectorChain: ['#d1'], fieldType: 'date' }, '2020-01-01');
    assert.equal(res.ok, true);
    assert.equal(document.getElementById('d1').value, '2020-01-01');
  });

  test('fillFieldBySelector returns error for invalid selector', async () => {
    setupDOM();
    const res = await fillFieldBySelector({ selectorChain: ['#missing'] }, 'val');
    assert.equal(res.ok, false);
    assert.match(res.error, /No element found/);
  });

  test('fillFieldBySelector throws error if exception during simulation', async () => {
    setupDOM('<input id="f1">');
    const el = document.getElementById('f1');
    Object.defineProperty(el, 'value', {
      set() { throw new Error('Simulated exception'); }
    });
    
    const res = await fillFieldBySelector({ selectorChain: ['#f1'] }, 'val');
    assert.equal(res.ok, false);
    assert.match(res.error, /Simulated exception/);
  });

  test('waitForDomStability resolves after timeouts', async () => {
    setupDOM('<div></div>');
    const p = waitForDomStability(200);
    // Simulate DOM mutation
    document.body.innerHTML = '<span>Changed</span>';
    await p;
    assert.ok(true); // Should resolve
  });

  test('message listener handles FORM_FILL_FIELD', async () => {
    setupDOM('<input id="f1">');
    await new Promise(resolve => setTimeout(resolve, 50)); // let module load
    const cb = messages[0];
    
    await new Promise(resolve => {
      cb({ type: 'FORM_FILL_FIELD', fieldInfo: { selectorChain: ['#f1'] }, value: 'test' }, {}, resolve);
    });
    
    assert.equal(document.getElementById('f1').value, 'test');
  });

  test('message listener handles FORM_CLICK_NAV', async () => {
    setupDOM('<button id="b1">Next</button>');
    await new Promise(resolve => setTimeout(resolve, 50));
    const cb = messages[0];
    
    let clicked = false;
    document.getElementById('b1').addEventListener('click', () => { clicked = true; });

    await new Promise(resolve => {
      // Small timeout to skip stability wait
      globalThis.setTimeout = (f, ms) => f(); 
      cb({ type: 'FORM_CLICK_NAV', navAction: { selector: '#b1', buttonText: 'Next' } }, {}, resolve);
    });
    
    assert.equal(clicked, true);
  });

  test('message listener handles FORM_CLICK_NAV text fallback', async () => {
    setupDOM('<button id="b2">Submit</button>');
    await new Promise(resolve => setTimeout(resolve, 50));
    const cb = messages[0];
    
    let clicked = false;
    document.getElementById('b2').addEventListener('click', () => { clicked = true; });

    await new Promise(resolve => {
      globalThis.setTimeout = (f, ms) => f(); 
      cb({ type: 'FORM_CLICK_NAV', navAction: { selector: '#missing', buttonText: 'submit' } }, {}, resolve);
    });
    
    assert.equal(clicked, true);
  });

  test('message listener handles FORM_DETECT_ERRORS', async () => {
    setupDOM('<input id="err" aria-invalid="true"><span class="error">Bad input</span>');
    await new Promise(resolve => setTimeout(resolve, 50));
    const cb = messages[0];
    
    const res = await new Promise(resolve => {
      cb({ type: 'FORM_DETECT_ERRORS' }, {}, resolve);
    });
    assert.equal(res.errors.length, 1);
  });

  test('message listener handles FORM_WAIT_STABLE', async () => {
    setupDOM();
    await new Promise(resolve => setTimeout(resolve, 50));
    const cb = messages[0];
    
    const res = await new Promise(resolve => {
      globalThis.setTimeout = (f, ms) => f();
      cb({ type: 'FORM_WAIT_STABLE', timeoutMs: 1 }, {}, resolve);
    });
    assert.equal(res.ok, true);
  });
});
