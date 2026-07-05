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
  const id = el.id;
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
    let segment = current.tagName.toLowerCase();
    if (current.id && isStableId(current)) {
      parts.unshift(`#${CSS.escape(current.id)}`);
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
    let segment = current.tagName.toLowerCase();
    if (current.id && isStableId(current)) {
      parts.unshift(`//*[@id="${current.id}"]`);
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
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
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

  // Priority 1: ID
  if (el.id && isStableId(el)) {
    selectors.push(`#${CSS.escape(el.id)}`);
  }

  // Priority 2: name attribute
  if (el.name) {
    const nameSelector = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    selectors.push(nameSelector);
  }

  // Priority 3: aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    selectors.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
  }

  // Priority 4: label[for] -> find input by label
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) {
      selectors.push(`label[for="${CSS.escape(el.id)}"] ~ input, label[for="${CSS.escape(el.id)}"] ~ select, label[for="${CSS.escape(el.id)}"] ~ textarea`);
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
    name: el.name || '',
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
 * Returns the first matching element.
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
        const el = document.querySelector(selector);
        if (el) return el;
      }
    } catch {
      // Invalid selector syntax — skip to next
    }
  }
  return null;
}

// Re-export utilities for testing

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

/** @type {Array<Object>} ordered list of navigation actions (wizard pages) */
const navActions = [];

/** @type {number} current wizard page index */
let currentPage = 0;

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
  if (el.id) return `id:${el.id}`;
  if (el.name) return `name:${el.name}`;
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
  descriptor.page = currentPage;

  const key = fieldKey(el);
  fieldMap.set(key, descriptor);

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
  navActions.push({
    type: '__NAV__',
    page: currentPage,
    buttonText: (el.textContent || '').trim(),
    selector: el.id ? `#${el.id}` : buildQuickSelector(el),
    coords: {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      pageX: Math.round(rect.left + window.scrollX + rect.width / 2),
      pageY: Math.round(rect.top + window.scrollY + rect.height / 2),
    },
    timestamp: Date.now(),
  });

  currentPage++;
  void persistFields();
}

function buildQuickSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || '').trim().slice(0, 30);
  if (text) return `${tag}:has-text("${text}")`;
  return tag;
}

// ── DOM Mutation Observer ────────────────────────────────────────────────────
// Watches for new form fields appearing (conditional logic, wizard pages).
let mutationTimer = null;
const observer = new MutationObserver(() => {
  if (!recording) return;
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    // Auto-discover any new form fields that appeared
    const fields = document.querySelectorAll('input, select, textarea, [contenteditable="true"][role="textbox"]');
    fields.forEach(el => {
      if (!isFormField(el)) return;
      const key = fieldKey(el);
      if (fieldMap.has(key)) return; // already captured
      // Pre-capture with empty value (user hasn't interacted yet)
      const descriptor = captureField(el, '', null);
      descriptor.page = currentPage;
      descriptor.autoDiscovered = true;
      fieldMap.set(key, descriptor);
    });
    void persistFields();
  }, 1500); // 1.5s debounce for DOM stability
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistFields() {
  const fields = Array.from(fieldMap.values());
  try {
    await chrome.storage.session.set({
      [STORAGE_KEY]: fields,
      [NAV_STORAGE_KEY]: navActions,
      [META_KEY]: {
        startUrl,
        currentPage,
        fieldCount: fields.length,
        navCount: navActions.length,
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
  currentPage = 0;
  fieldMap.clear();
  navActions.length = 0;

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
    descriptor.page = currentPage;
    descriptor.autoDiscovered = true;
    fieldMap.set(fieldKey(el), descriptor);
  });

  void persistFields();
  return { ok: true, fieldCount: fieldMap.size };
}

function stopRecording() {
  if (!recording) return { ok: false, reason: 'Not recording' };

  recording = false;

  // Detach listeners
  document.removeEventListener('mousemove', trackMouse);
  document.removeEventListener('input', handleFieldInteraction, { capture: true });
  document.removeEventListener('change', handleFieldInteraction, { capture: true });
  document.removeEventListener('focus', handleFieldInteraction, { capture: true });
  document.removeEventListener('click', handlePossibleNavigation, { capture: true });
  observer.disconnect();

  void persistFields();

  return {
    ok: true,
    fields: Array.from(fieldMap.values()),
    navActions: [...navActions],
    startUrl,
    totalPages: currentPage + 1,
  };
}

function getRecordingState() {
  return {
    recording,
    fieldCount: fieldMap.size,
    currentPage,
    navCount: navActions.length,
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
    const result = stopRecording();
    sendResponse(result);
    return;
  }

  if (message.type === 'FORM_RECORDER_STATUS') {
    sendResponse(getRecordingState());
    return;
  }
});

})();