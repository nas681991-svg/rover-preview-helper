import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { 
  isStableId, buildCssPath, buildXPath, findLabelText, 
  detectFieldType, captureField, resolveSelector, querySelectorDeep 
} from './selector-engine.js';

function setupDOM(html) {
  const dom = new JSDOM(html);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.XPathResult = dom.window.XPathResult;
  globalThis.CSS = { escape: (str) => str.replace(/([:])/g, '\\\\$1') };
  
  // Mock element methods not fully supported in jsdom
  const Element = dom.window.Element;
  Element.prototype.getBoundingClientRect = function() {
    return { top: 10, left: 20, width: 100, height: 20 };
  };
}

describe('selector-engine', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.Node;
    delete globalThis.XPathResult;
    delete globalThis.CSS;
  });

  test('isStableId filters generated ids', () => {
    setupDOM('<div></div>');
    const el = document.createElement('div');
    el.id = 'username';
    assert.equal(isStableId(el), true);
    
    el.id = 'react123';
    assert.equal(isStableId(el), false);

    el.id = 'a1b2c3d4e5';
    assert.equal(isStableId(el), false);
    
    el.id = 'j_id0:j_id1:1234';
    assert.equal(isStableId(el), false);
  });

  test('buildCssPath and buildXPath work', () => {
    setupDOM('<div id="container"><div><input type="text"></div><div><input type="text" id="target"></div></div>');
    const target = document.getElementById('target');
    assert.equal(buildCssPath(target), '#target');
    assert.equal(buildXPath(target), '//*[@id="target"]');

    // Remove id to test path building
    target.removeAttribute('id');
    const cssPath = buildCssPath(target);
    assert.ok(cssPath.includes('div:nth-of-type(2) > input'));
    
    const xpath = buildXPath(target);
    assert.ok(xpath.includes('div[2]/input'));
  });

  test('findLabelText covers all strategies', () => {
    setupDOM(`
      <div>
        <label for="f1">Label 1</label><input id="f1">
        <label>Label 2 <input id="f2"></label>
        <input id="f3" aria-label="Label 3">
        <span id="lbl4">Label 4</span><input id="f4" aria-labelledby="lbl4">
        <input id="f5" placeholder="Label 5">
        <span>Label 6</span><input id="f6">
        <input id="f7">
      </div>
    `);
    
    assert.equal(findLabelText(document.getElementById('f1')), 'Label 1');
    assert.equal(findLabelText(document.getElementById('f2')), 'Label 2');
    assert.equal(findLabelText(document.getElementById('f3')), 'Label 3');
    assert.equal(findLabelText(document.getElementById('f4')), 'Label 4');
    assert.equal(findLabelText(document.getElementById('f5')), 'Label 5');
    assert.equal(findLabelText(document.getElementById('f6')), 'Label 6');
    assert.equal(findLabelText(document.getElementById('f7')), '');
  });

  test('detectFieldType covers elements', () => {
    setupDOM(`
      <select id="t1"></select>
      <textarea id="t2"></textarea>
      <input id="t3" type="checkbox">
      <input id="t4">
      <div id="t5"></div>
      <div id="t6"></div>
    `);
    document.getElementById('t5').contentEditable = 'true';
    assert.equal(detectFieldType(document.getElementById('t1')), 'select');
    assert.equal(detectFieldType(document.getElementById('t2')), 'textarea');
    assert.equal(detectFieldType(document.getElementById('t3')), 'checkbox');
    assert.equal(detectFieldType(document.getElementById('t4')), 'text');
    assert.equal(detectFieldType(document.getElementById('t5')), 'contenteditable');
    assert.equal(detectFieldType(document.getElementById('t6')), 'unknown');
  });

  test('captureField extracts options and constraints', () => {
    setupDOM(`
      <select id="sel" required minlength="2" maxlength="10">
        <option>A</option>
        <option>B</option>
      </select>
      <input id="num" min="1" max="5" pattern="[0-9]">
    `);
    const selEl = document.getElementById('sel');
    selEl.required = true;
    selEl.minLength = 2;
    selEl.maxLength = 10;
    const sel = captureField(selEl, 'A');
    assert.deepEqual(sel.options, ['A', 'B']);
    assert.equal(sel.constraints.required, true);
    assert.equal(sel.constraints.minLength, 2);
    assert.equal(sel.constraints.maxLength, 10);
    
    const num = captureField(document.getElementById('num'), '3');
    assert.equal(num.constraints.min, '1');
    assert.equal(num.constraints.max, '5');
    assert.equal(num.constraints.pattern, '[0-9]');
  });

  test('captureField handles aria-label, name, and coords', () => {
    setupDOM(`
      <label for="f1">Label 1</label>
      <input id="f1" name="fname" aria-label="First Name">
    `);
    const field = captureField(document.getElementById('f1'), 'val', { x: 50, y: 60 });
    assert.equal(field.name, 'fname');
    assert.equal(field.coords.x, 50);
    assert.equal(field.coords.y, 60);
    assert.ok(field.selectorChain.includes('#f1'));
    assert.ok(field.selectorChain.includes('input[name="fname"]'));
    assert.ok(field.selectorChain.includes('[aria-label="First Name"]'));
    assert.ok(field.selectorChain.includes('label[for="f1"] ~ input, label[for="f1"] ~ select, label[for="f1"] ~ textarea'));
  });

  test('resolveSelector resolves selectors', () => {
    setupDOM('<div class="test"><input id="target"></div>');
    const el = document.getElementById('target');
    
    assert.equal(resolveSelector(['#invalid-syntax!!!', '#target']), el);
    assert.equal(resolveSelector(['xpath://*[@id="target"]']), el);
    assert.equal(resolveSelector(['.test input']), el);
    assert.equal(resolveSelector(['#missing']), null);
  });

  test('querySelectorDeep handles shadow DOM', () => {
    setupDOM('<div id="host"></div>');
    const host = document.getElementById('host');
    const shadow = host.attachShadow({ mode: 'open' });
    const el = document.createElement('input');
    el.id = 'shadow-target';
    shadow.appendChild(el);

    assert.equal(querySelectorDeep('#shadow-target'), el);
    assert.equal(querySelectorDeep('#missing-target'), null);
  });
});
