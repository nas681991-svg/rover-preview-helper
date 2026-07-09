import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { detectCaptcha, requestHumanIntervention } from './confidence.js';

function setupDOM(html = '') {
  const dom = new JSDOM(html);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.HTMLElement = dom.window.HTMLElement;
}

describe('confidence', () => {
  beforeEach(() => {
    setupDOM();
    globalThis.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          if (msg.type === 'REQUEST_ATTENTION') return;
        }
      }
    };
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.HTMLElement;
    delete globalThis.chrome;
  });

  test('detectCaptcha identifies recaptcha', () => {
    setupDOM('<div><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>');
    assert.equal(detectCaptcha(), true);
  });

  test('detectCaptcha identifies hcaptcha', () => {
    setupDOM('<div><iframe src="https://hcaptcha.com/"></iframe></div>');
    assert.equal(detectCaptcha(), true);
  });

  test('detectCaptcha returns false when no captcha', () => {
    setupDOM('<div><input></div>');
    assert.equal(detectCaptcha(), false);
  });

  test('requestHumanIntervention shows overlay and waits for click', async () => {
    setupDOM('<input id="target">');
    const target = document.getElementById('target');
    
    // Mock Element methods not in jsdom
    target.scrollIntoView = () => {};
    target.animate = () => ({ cancel: () => {} });
    target.getAnimations = () => [{ cancel: () => {} }];

    let promiseResolved = false;
    const p = requestHumanIntervention('Fix this', target).then(() => {
      promiseResolved = true;
    });

    // Let the event loop run to create the overlay
    await new Promise(r => setTimeout(r, 0));

    // Verify overlay exists
    const btn = document.querySelector('button');
    assert.ok(btn);
    assert.equal(btn.textContent, 'I fixed it — Resume Replay');
    
    // Trigger hover events just for branch coverage
    if (btn.onmouseover) btn.onmouseover();
    if (btn.onmouseout) btn.onmouseout();

    // Click to resume
    btn.click();
    
    await p;
    assert.equal(promiseResolved, true);
    assert.equal(document.querySelector('button'), null); // Overlay removed
  });

  test('requestHumanIntervention handles missing chrome.runtime', async () => {
    delete globalThis.chrome.runtime;
    setupDOM();
    
    let promiseResolved = false;
    const p = requestHumanIntervention('Error without target').then(() => {
      promiseResolved = true;
    });

    await new Promise(r => setTimeout(r, 0));
    document.querySelector('button').click();
    await p;
    assert.equal(promiseResolved, true);
  });
});
