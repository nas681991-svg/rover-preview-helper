// Auto-generated bundle — do not edit directly
(() => {
/**
 * Selector Engine — generates resilient, ranked CSS selectors for form elements.
 * Each element gets a `selectorChain` (ordered list of selectors to try),
 * enabling auto-healing when a site's markup changes.
 *
 * Priority: #id > [name] > [aria-label] > label[for] > CSS path > XPath
 */

/**
 * @param {Element} el
 * @returns {boolean}
 */
function isStableId(el) {
  const id = el.getAttribute('id');
  if (!id) return false;
  // Reject IDs that look auto-generated (random hex/uuid patterns)
  if (/^[a-f0-9]{8,}$/i.test(id)) return false;
  if (/^(ember|react|vue|ng-|mat-|mdc-|rc-)\d/i.test(id)) return false;
  if (id.includes(':') && /\d{4,}/.test(id)) return false; // e.g. "j_id0:j_id1:..."
  return true;
}

/**
 * Build a CSS nth-of-type path from the element up to the nearest
 * stable ancestor (body, form, [id]).
 * @param {Element} el
 * @returns {string}
 */
function buildCssPath(el) {
  const parts = [];
  let current = el;
  while (current && current !== document.body && current !== document.documentElement) {
    if (!current.tagName) {
      current = current.parentElement;
      continue;
    }
    let segment = current.tagName.toLowerCase();
    const id = current.getAttribute('id');
    if (id && isStableId(current)) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        segment += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(segment);
    current = parent;
  }
  
  if (current === document.body && parts.length > 0 && !parts[0].startsWith('#')) {
    parts.unshift('body');
  } else if (current === document.documentElement && parts.length > 0 && !parts[0].startsWith('#')) {
    parts.unshift('html');
  }
  
  return parts.join(' > ');
}

/**
 * Build a full XPath for the element.
 * @param {Element} el
 * @returns {string}
 */
function buildXPath(el) {
  const parts = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (!current.tagName) {
      current = current.parentElement;
      continue;
    }
    let segment = current.tagName.toLowerCase();
    const id = current.getAttribute('id');
    if (id && isStableId(current)) {
      parts.unshift(`//*[@id="${id}"]`);
      return parts.join('/');
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        segment += `[${idx}]`;
      }
    }
    parts.unshift(segment);
    current = parent;
  }
  return '/' + parts.join('/');
}

/**
 * Find the associated <label> text for a form element.
 * @param {Element} el
 * @returns {string}
 */
function findLabelText(el) {
  // 1. Explicit <label for="...">
  const id = el.getAttribute('id');
  if (id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) return label.textContent.trim();
    } catch {
      // CSS.escape might fail or invalid selector
    }
  }
  // 2. Wrapping <label>
  const parent = el.closest('label');
  if (parent) {
    // Get text excluding the input's own text
    const clone = parent.cloneNode(true);
    const inputs = clone.querySelectorAll('input,select,textarea,button');
    inputs.forEach(i => i.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }
  // 3. aria-label / aria-labelledby
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref) return ref.textContent.trim();
  }
  // 4. placeholder
  if (el.placeholder) return el.placeholder.trim();
  // 5. Nearest preceding text node / sibling
  const prev = el.previousElementSibling;
  if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'P')) {
    return prev.textContent.trim();
  }
  return '';
}

/**
 * Detect form field type from the element.
 * @param {Element} el
 * @returns {string}
 */
function detectFieldType(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    return type;
  }
  if (el.contentEditable === 'true') return 'contenteditable';
  return 'unknown';
}

/**
 * Extract dropdown options from a <select> element.
 * @param {Element} el
 * @returns {string[]}
 */
function extractOptions(el) {
  if (el.tagName.toLowerCase() !== 'select') return [];
  return Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
}

/**
 * Extract constraints from a form field.
 * @param {Element} el
 * @returns {Object}
 */
function extractConstraints(el) {
  const constraints = {};
  if (el.required) constraints.required = true;
  if (el.pattern) constraints.pattern = el.pattern;
  if (el.minLength > 0) constraints.minLength = el.minLength;
  if (el.maxLength > 0 && el.maxLength < 524288) constraints.maxLength = el.maxLength;
  if (el.min) constraints.min = el.min;
  if (el.max) constraints.max = el.max;
  return constraints;
}

/**
 * Generate a full field descriptor with ranked selector chain.
 * @param {Element} el
 * @param {string} value - The value the user entered
 * @param {{ x: number, y: number }} coords - Click/focus coordinates
 * @returns {Object}
 */
function captureField(el, value, coords = null) {
  const selectors = [];
  const id = el.getAttribute('id');
  const name = el.getAttribute('name');

  // Priority 1: ID
  if (id && isStableId(el)) {
    selectors.push(`#${CSS.escape(id)}`);
  }

  // Priority 2: name attribute
  if (name) {
    const nameSelector = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    selectors.push(nameSelector);
  }

  // Priority 3: aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    selectors.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
  }

  // Priority 4: label[for] -> find input by label
  if (id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) {
        selectors.push(`label[for="${CSS.escape(id)}"] ~ input, label[for="${CSS.escape(id)}"] ~ select, label[for="${CSS.escape(id)}"] ~ textarea`);
      }
    } catch {
      // Ignore
    }
  }

  // Priority 5: CSS path
  const cssPath = buildCssPath(el);
  if (cssPath) selectors.push(cssPath);

  // Priority 6: XPath
  const xpath = buildXPath(el);
  if (xpath) selectors.push(`xpath:${xpath}`);

  const rect = el.getBoundingClientRect();
  const fieldCoords = coords || {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };

  return {
    selectorChain: selectors,
    fieldType: detectFieldType(el),
    label: findLabelText(el),
    name: name || '',
    value: value ?? '',
    options: extractOptions(el),
    constraints: extractConstraints(el),
    coords: {
      x: fieldCoords.x,
      y: fieldCoords.y,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      pageX: Math.round(rect.left + window.scrollX + rect.width / 2),
      pageY: Math.round(rect.top + window.scrollY + rect.height / 2),
    },
    timestamp: Date.now(),
  };
}

/**
 * Try to resolve an element using a selectorChain (auto-healing).
 * Returns the first matching element, piercing Shadow DOM boundaries.
 * @param {string[]} chain
 * @returns {Element|null}
 */
function resolveSelector(chain) {
  for (const selector of chain) {
    try {
      if (selector.startsWith('xpath:')) {
        const xpath = selector.slice(6);
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue) return result.singleNodeValue;
      } else {
        const el = querySelectorDeep(selector);
        if (el) return el;
      }
    } catch {
      // Invalid selector syntax — skip to next
    }
  }
  return null;
}

function querySelectorDeep(selector, root = document) {
  let el;
  try {
    el = root.querySelector(selector);
    if (el) return el;
  } catch {
    // Ignore invalid selector syntax for this root, still check Shadow DOM
  }
  
  const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, null, false);
  let node;
  while ((node = iter.nextNode())) {
    if (node.shadowRoot) {
      const match = querySelectorDeep(selector, node.shadowRoot);
      if (match) return match;
    }
  }
  return null;
}

// Re-export utilities for testing

/**
 * AI Semantic Field Labeler (Stage 2)
 * Connects raw recorded DOM selectors to Rover's AI to auto-generate human-readable CSV column names.
 */

/**
 * Heuristic fallback for labeling fields if AI fails or is disabled.
 * Converts snake_case or camelCase to Title Case.
 */
function heuristicLabel(name) {
  if (!name) return 'Unknown Field';
  
  // Replace underscores and dashes with spaces
  let clean = name.replace(/[_-]/g, ' ');
  
  // Insert space before capital letters (camelCase)
  clean = clean.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // Capitalize words and remove double spaces
  return clean.replace(/\s+/g, ' ').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()).trim();
}

/**
 * Main labeler function that enriches the fieldMap with 'columnName'.
 * 
 * @param {Array} fieldMap - The raw array of field objects recorded by recorder.js
 * @returns {Promise<Array>} - The enriched fieldMap
 */
export async function labelFields(fieldMap) {
  // If there are no fields, just return
  if (!Array.isArray(fieldMap) || fieldMap.length === 0) return fieldMap;

  // Attempt to use Rover AI if available in the execution environment
  try {
    if (typeof window !== 'undefined' && window.rover && typeof window.rover.send === 'function') {
      const prompt = `
Given these form fields, return a JSON array mapping each to a human-readable CSV column name:
${JSON.stringify(fieldMap.map(f => ({ selector: f.selectorChain?.[0] || f.selector, label: f.label, name: f.name, type: f.type, options: f.options })), null, 2)}
Return EXACTLY this JSON structure and nothing else:
[{ "selector": "...", "columnName": "..." }]
      `.trim();

      const response = await window.rover.send({ type: 'ai-prompt', prompt });
      
      let aiLabels = [];
      try {
        aiLabels = JSON.parse(response);
      } catch (parseError) {
        // Response might have markdown code blocks, try stripping them
        const stripped = response.replace(/```json/g, '').replace(/```/g, '').trim();
        aiLabels = JSON.parse(stripped);
      }

      if (Array.isArray(aiLabels)) {
        // Map the AI results back to our field map
        const selectorToName = {};
        for (const labelObj of aiLabels) {
          if (labelObj.selector && labelObj.columnName) {
            selectorToName[labelObj.selector] = labelObj.columnName;
          }
        }

        return fieldMap.map(f => {
          const mainSelector = f.selectorChain?.[0] || f.selector;
          return {
            ...f,
            columnName: selectorToName[mainSelector] || f.label || heuristicLabel(f.name) || 'Unknown Field'
          };
        });
      }
    }
  } catch (error) {
    console.warn('Rover AI semantic labeling failed, falling back to heuristics:', error);
  }

  // Fallback if AI fails or isn't available
  return fieldMap.map(f => ({
    ...f,
    columnName: f.label || heuristicLabel(f.name) || 'Unknown Field'
  }));
}

/**
 * Wizard State Machine (Stage 4)
 * Tracks multi-page navigation and conditional field dependencies.
 */

class WizardState {
  constructor() {
    this.currentPage = 0;
    this.navActions = [];
    this.lastInteraction = null; // { fieldKey: string, value: string, timestamp: number }
  }

  reset() {
    this.currentPage = 0;
    this.navActions = [];
    this.lastInteraction = null;
  }

  /**
   * Called when a user interacts with a field.
   */
  recordInteraction(key, value) {
    this.lastInteraction = { fieldKey: key, value, timestamp: Date.now() };
  }

  /**
   * Called when a user clicks a navigation button.
   */
  recordNavigation(navAction) {
    this.navActions.push({
      ...navAction,
      page: this.currentPage,
      type: '__NAV__',
      timestamp: Date.now(),
    });
    this.currentPage++;
  }

  /**
   * Called when new fields appear in the DOM.
   * Checks if they might be conditionally dependent on the last interaction.
   */
  checkDependencies(newFields) {
    const deps = [];
    if (!Array.isArray(newFields)) return deps;

    // If fields appeared within 5 seconds of an interaction, assume they are dependent.
    if (this.lastInteraction && (Date.now() - this.lastInteraction.timestamp < 5000)) {
      for (const field of newFields) {
        deps.push({
          dependentField: field.key,
          dependsOn: {
            field: this.lastInteraction.fieldKey,
            operator: 'equals',
            value: this.lastInteraction.value
          }
        });
      }
    }
    return deps;
  }

  getState() {
    return {
      currentPage: this.currentPage,
      navActions: this.navActions,
    };
  }
}

// Singleton instance for the content script
const wizardState = new WizardState();

/**
 * Trace Engine for High-Fidelity Recording
 * 
 * Captures a dense, millisecond-precision timeline of viewport states, 
 * interactions, and live DOM mutations. Output is strictly optimized 
 * for machine readability (dense arrays).
 */

const TRACE_BUFFER_LIMIT = 50000; // Cap to prevent out-of-memory on extreme pages

// Dense Type Enums
const T_MOUSEMOVE = 0;
const T_CLICK = 1;
const T_SCROLL = 2;
const T_RESIZE = 3;
const T_KEY = 4;
const T_MUTATION = 5;

let isTracing = false;
let traceLog = [];
let observer = null;

let lastMouseX = 0;
let lastMouseY = 0;
let mouseThrottle = null;

function pushTrace(entry) {
  if (!isTracing || traceLog.length >= TRACE_BUFFER_LIMIT) return;
  traceLog.push(entry);
}

function handleMouseMove(e) {
  if (!isTracing) return;
  if (mouseThrottle) return;
  
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  
  mouseThrottle = setTimeout(() => {
    pushTrace([Math.round(performance.now()), T_MOUSEMOVE, lastMouseX, lastMouseY]);
    mouseThrottle = null;
  }, 50); // 20fps for mouse to save space
}

function quickSelector(el) {
  if (!el) return '?';
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  let path = el.tagName.toLowerCase();
  if (el.className && typeof el.className === 'string') {
    path += '.' + el.className.trim().split(/\s+/).join('.');
  }
  return path;
}

function handleClick(e) {
  if (!isTracing) return;
  const el = e.target;
  let rect = { left: 0, top: 0, width: 0, height: 0 };
  let nodeName = '?';
  let selector = '?';
  if (el && el.getBoundingClientRect) {
    rect = el.getBoundingClientRect();
    nodeName = safeNodeName(el);
    selector = quickSelector(el);
  }
  
  // Format: [ts, T_CLICK, clickX, clickY, button, nodeName, selector, elemLeft, elemTop, elemWidth, elemHeight]
  pushTrace([
    Math.round(performance.now()), 
    T_CLICK, 
    e.clientX, 
    e.clientY, 
    e.button,
    nodeName,
    selector,
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height)
  ]);
}

let scrollThrottle = null;
function handleScroll() {
  if (!isTracing) return;
  if (scrollThrottle) return;
  scrollThrottle = setTimeout(() => {
    pushTrace([Math.round(performance.now()), T_SCROLL, window.scrollX, window.scrollY]);
    scrollThrottle = null;
  }, 100);
}

let resizeThrottle = null;
function handleResize() {
  if (!isTracing) return;
  if (resizeThrottle) return;
  resizeThrottle = setTimeout(() => {
    pushTrace([Math.round(performance.now()), T_RESIZE, window.innerWidth, window.innerHeight]);
    resizeThrottle = null;
  }, 500);
}

function handleKeyDown(e) {
  pushTrace([Math.round(performance.now()), T_KEY, e.key]);
}

// Compact string
function safeNodeName(node) {
  return node ? (node.nodeName || 'TEXT').substring(0, 20) : '?';
}

function safeValue(val) {
  if (!val) return '';
  const str = String(val);
  return str.length > 50 ? str.substring(0, 50) + '...' : str;
}

function handleMutations(mutations) {
  if (!isTracing) return;
  const ts = Math.round(performance.now());
  
  for (const m of mutations) {
    let mType = 0; // 0=childList, 1=attributes, 2=characterData
    let val = '';
    
    if (m.type === 'childList') {
      mType = 0;
      val = `+${m.addedNodes.length},-${m.removedNodes.length}`;
    } else if (m.type === 'attributes') {
      mType = 1;
      val = m.attributeName;
    } else if (m.type === 'characterData') {
      mType = 2;
      val = safeValue(m.target.textContent);
    }
    
    pushTrace([
      ts, 
      T_MUTATION, 
      mType, 
      safeNodeName(m.target), 
      val
    ]);
  }
}

function startTrace() {
  if (isTracing) return;
  isTracing = true;
  traceLog = [];
  
  // Log initial state
  pushTrace([Math.round(performance.now()), T_RESIZE, window.innerWidth, window.innerHeight]);
  pushTrace([Math.round(performance.now()), T_SCROLL, window.scrollX, window.scrollY]);

  // Bind events
  window.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
  window.addEventListener('mousedown', handleClick, { passive: true, capture: true });
  window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
  window.addEventListener('resize', handleResize, { passive: true, capture: true });
  window.addEventListener('keydown', handleKeyDown, { passive: true, capture: true });

  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: false,
    characterDataOldValue: false
  });
}

function stopTrace() {
  if (!isTracing) return;
  isTracing = false;

  window.removeEventListener('mousemove', handleMouseMove, { capture: true });
  window.removeEventListener('mousedown', handleClick, { capture: true });
  window.removeEventListener('scroll', handleScroll, { capture: true });
  window.removeEventListener('resize', handleResize, { capture: true });
  window.removeEventListener('keydown', handleKeyDown, { capture: true });

  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function flushTrace() {
  const currentLog = traceLog;
  // We do not clear traceLog here because we want the whole session traced. 
  // However, we could chunk it if needed. For now, just return it.
  return currentLog;
}

/**
 * Form Recorder — content script that watches user interactions with form
 * elements and builds a structured field map with selectors + coordinates.
 *
 * Injected into the ISOLATED world. Communicates with the background
 * service worker via chrome.runtime messaging.
 */




const STORAGE_KEY = 'rover-form-recorder:fields';
const NAV_STORAGE_KEY = 'rover-form-recorder:nav';
const META_KEY = 'rover-form-recorder:meta';

/** @type {Map<string, Object>} field key -> field descriptor */
const fieldMap = new Map();

// Wizard state handles currentPage and navActions

/** @type {boolean} whether the recorder is active */
let recording = false;

/** @type {string} the URL where recording started */
let startUrl = '';

// ── Coordinate Tracking ─────────────────────────────────────────────────────
// We track the last known mouse position so every field interaction
// includes the exact screen coordinates the user clicked/focused.
let lastMouseX = 0;
let lastMouseY = 0;

function trackMouse(e) {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
}

// ── Field Key ────────────────────────────────────────────────────────────────
// Generates a stable dedup key for a form element so we update (not duplicate)
// fields when the user re-interacts with the same input.
function fieldKey(el) {
  const id = el.getAttribute('id');
  const name = el.getAttribute('name');
  if (id) return `id:${id}`;
  if (name) return `name:${name}`;
  const path = [];
  let cur = el;
  while (cur && cur !== document.body) {
    const parent = cur.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
    const idx = siblings.indexOf(cur);
    path.unshift(`${cur.tagName}[${idx}]`);
    cur = parent;
  }
  if (cur === document.body) {
    path.unshift('BODY');
  } else if (cur === document.documentElement) {
    path.unshift('HTML');
  }
  return `path:${path.join('>')}`;
}

// ── Event Handlers ───────────────────────────────────────────────────────────

function isFormField(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const skip = ['hidden', 'submit', 'button', 'reset', 'image'];
    return !skip.includes((el.type || '').toLowerCase());
  }
  return tag === 'select' || tag === 'textarea' ||
         (el.contentEditable === 'true' && el.getAttribute('role') === 'textbox');
}

function handleFieldInteraction(e) {
  if (!recording) return;
  const el = e.target;
  if (!isFormField(el)) return;

  const value = el.tagName.toLowerCase() === 'select'
    ? el.options[el.selectedIndex]?.text || el.value
    : el.value;

  const coords = { x: lastMouseX, y: lastMouseY };
  const descriptor = captureField(el, value, coords);
  descriptor.page = wizardState.currentPage;

  const key = fieldKey(el);
  fieldMap.set(key, descriptor);
  
  wizardState.recordInteraction(key, value);

  // Persist incrementally
  void persistFields();
}

function handlePossibleNavigation(e) {
  if (!recording) return;
  const el = e.target?.closest?.('button, [type="submit"], a, [role="button"]');
  if (!el) return;

  const text = (el.textContent || '').trim().toLowerCase();
  const navKeywords = ['next', 'continue', 'proceed', 'forward', 'step', 'submit', 'save'];
  const isNavButton = navKeywords.some(kw => text.includes(kw)) ||
                      el.type === 'submit';

  if (!isNavButton) return;

  // Capture the navigation action with coordinates
  const rect = el.getBoundingClientRect();
  const id = el.getAttribute('id');
  wizardState.recordNavigation({
    buttonText: (el.textContent || '').trim(),
    selector: id ? `#${CSS.escape(id)}` : buildQuickSelector(el),
    coords: {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      pageX: Math.round(rect.left + window.scrollX + rect.width / 2),
      pageY: Math.round(rect.top + window.scrollY + rect.height / 2),
    }
  });

  void persistFields();
}

function buildQuickSelector(el) {
  const id = el.getAttribute('id');
  const name = el.getAttribute('name');
  if (id) return `#${CSS.escape(id)}`;
  if (name) return `[name="${CSS.escape(name)}"]`;
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || '').trim().slice(0, 30);
  if (text) return `${tag}:has-text("${text}")`;
  return tag;
}

// ── DOM Mutation Observer ────────────────────────────────────────────────────
// Watches for new form fields appearing (conditional logic, wizard pages).
let mutationTimer = null;
let lastDiscoveryTime = 0;

function runDiscovery() {
  lastDiscoveryTime = Date.now();
  // Auto-discover any new form fields that appeared
  const fields = document.querySelectorAll('input, select, textarea, [contenteditable="true"][role="textbox"]');
  const newlyDiscovered = [];
  
  fields.forEach(el => {
    if (!isFormField(el)) return;
    const key = fieldKey(el);
    if (fieldMap.has(key)) return; // already captured
    // Pre-capture with empty value (user hasn't interacted yet)
    const descriptor = captureField(el, '', null);
    descriptor.page = wizardState.currentPage;
    descriptor.autoDiscovered = true;
    fieldMap.set(key, descriptor);
    newlyDiscovered.push({ key, descriptor });
  });
  
  if (newlyDiscovered.length > 0) {
    const deps = wizardState.checkDependencies(newlyDiscovered);
    for (const dep of deps) {
      const field = fieldMap.get(dep.dependentField);
      if (field) {
        field.appearsWhen = dep.dependsOn;
      }
    }
  }
  void persistFields();
}

const observer = new MutationObserver(() => {
  if (!recording) return;
  const now = Date.now();
  if (now - lastDiscoveryTime > 3000) {
    // Force a run if continuous mutations have been starving the debounce
    clearTimeout(mutationTimer);
    runDiscovery();
    return;
  }
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(runDiscovery, 1500); // 1.5s debounce for DOM stability
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistFields() {
  const fields = Array.from(fieldMap.values());
  try {
    await chrome.storage.session.set({
      [STORAGE_KEY]: fields,
      [NAV_STORAGE_KEY]: wizardState.navActions,
      [META_KEY]: {
        startUrl,
        currentPage: wizardState.currentPage,
        fieldCount: fields.length,
        navCount: wizardState.navActions.length,
        recording,
        lastUpdated: Date.now(),
      },
    });
  } catch {
    // storage.session may be unavailable in some contexts
  }
}

// ── Public API (called via chrome.runtime messages) ──────────────────────────

function startRecording() {
  if (recording) return { ok: false, reason: 'Already recording' };

  recording = true;
  startUrl = location.href;
  wizardState.reset();
  fieldMap.clear();

  startTrace();

  // Attach listeners
  document.addEventListener('mousemove', trackMouse, { passive: true });
  document.addEventListener('input', handleFieldInteraction, { capture: true, passive: true });
  document.addEventListener('change', handleFieldInteraction, { capture: true, passive: true });
  document.addEventListener('focus', handleFieldInteraction, { capture: true, passive: true });
  document.addEventListener('click', handlePossibleNavigation, { capture: true });

  // Start observing DOM mutations for conditional fields
  observer.observe(document.body, { childList: true, subtree: true });

  // Auto-discover existing fields on the page
  const existingFields = document.querySelectorAll('input, select, textarea');
  existingFields.forEach(el => {
    if (!isFormField(el)) return;
    const descriptor = captureField(el, '', null);
    descriptor.page = wizardState.currentPage;
    descriptor.autoDiscovered = true;
    fieldMap.set(fieldKey(el), descriptor);
  });

  void persistFields();
  return { ok: true, fieldCount: fieldMap.size };
}

export async function stopRecording() {
  if (!recording) return { ok: false, reason: 'Not recording' };

  recording = false;
  stopTrace();

  // Detach listeners
  document.removeEventListener('mousemove', trackMouse);
  document.removeEventListener('input', handleFieldInteraction, { capture: true });
  document.removeEventListener('change', handleFieldInteraction, { capture: true });
  document.removeEventListener('focus', handleFieldInteraction, { capture: true });
  document.removeEventListener('click', handlePossibleNavigation, { capture: true });
  observer.disconnect();

  const rawFields = Array.from(fieldMap.values());
  const labeledFields = await labelFields(rawFields);

  fieldMap.clear();
  labeledFields.forEach(f => fieldMap.set(f.selectorChain?.[0] || f.selector, f));

  void persistFields();

  return {
    ok: true,
    fields: labeledFields,
    navActions: [...wizardState.navActions],
    startUrl,
    totalPages: wizardState.currentPage + 1,
    telemetry: flushTrace(),
  };
}

function getRecordingState() {
  return {
    recording,
    fieldCount: fieldMap.size,
    currentPage: wizardState.currentPage,
    navCount: wizardState.navActions.length,
    startUrl,
  };
}

// ── Message Listener ─────────────────────────────────────────────────────────
// The background script and popup communicate with this content script
// via chrome.runtime messages.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'FORM_RECORDER_START') {
    const result = startRecording();
    sendResponse(result);
    return;
  }

  if (message.type === 'FORM_RECORDER_STOP') {
    stopRecording().then(sendResponse);
    return true; // Indicate async response
  }

  if (message.type === 'FORM_RECORDER_STATUS') {
    sendResponse(getRecordingState());
    return;
  }
});

})();