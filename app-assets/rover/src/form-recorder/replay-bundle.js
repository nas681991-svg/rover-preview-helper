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
 * Replay Engine — content script injected into the target page during
 * bulk form filling. Receives field descriptors + values from the
 * background worker and fills/submits the form.
 *
 * This file is bundled with selector-engine.js at build time into
 * replay-bundle.js (the import below is stripped by the bundler).
 *
 * Two fill strategies:
 *   1. Selector-based: querySelector through the selectorChain
 *   2. Coordinate-based: fall back to CDP mouse events at recorded x/y
 */

// ── Typing Simulation ────────────────────────────────────────────────────────

function randomDelay(min = 40, max = 140) {
  return min + Math.floor(Math.random() * (max - min));
}

function dispatchInputEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

async function simulateTyping(el, value) {
  // Clear existing value
  el.focus();
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));

  // Type each character with realistic delay
  for (const char of String(value)) {
    el.value += char;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await new Promise(r => setTimeout(r, randomDelay()));
  }

  dispatchInputEvents(el);
}

// ── Select Dropdown Handling ─────────────────────────────────────────────────

function findMatchingOption(selectEl, targetValue) {
  const target = String(targetValue).trim();
  const options = Array.from(selectEl.options);

  // 1. Exact value match
  const exactValue = options.find(o => o.value === target);
  if (exactValue) return exactValue;

  // 2. Exact text match
  const exactText = options.find(o => o.text.trim() === target);
  if (exactText) return exactText;

  // 3. Case-insensitive match
  const lower = target.toLowerCase();
  const caseInsensitive = options.find(o =>
    o.value.toLowerCase() === lower || o.text.trim().toLowerCase() === lower
  );
  if (caseInsensitive) return caseInsensitive;

  // 4. Includes match (e.g., "United States" matches "United States of America")
  const includes = options.find(o =>
    o.text.trim().toLowerCase().includes(lower) ||
    lower.includes(o.text.trim().toLowerCase())
  );
  if (includes) return includes;

  // 5. Levenshtein fuzzy match (threshold: 80% similarity)
  let bestMatch = null;
  let bestScore = 0;
  for (const opt of options) {
    const score = similarity(lower, opt.text.trim().toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      bestMatch = opt;
    }
  }
  if (bestScore >= 0.8) return bestMatch;

  return null;
}

function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[a.length][b.length] / maxLen;
}

// ── Field Filling ────────────────────────────────────────────────────────────

/**
 * Fill a single form field using selector-based resolution.
 * Returns { ok, method, error? }
 */
async function fillFieldBySelector(fieldInfo, value) {
  const el = resolveSelector(fieldInfo.selectorChain);
  if (!el) return { ok: false, method: 'selector', error: 'No element found for any selector' };

  const fieldType = fieldInfo.fieldType || 'text';

  try {
    switch (fieldType) {
      case 'select': {
        const option = findMatchingOption(el, value);
        if (!option) return { ok: false, method: 'selector', error: `No matching option for "${value}"` };
        el.value = option.value;
        dispatchInputEvents(el);
        break;
      }
      case 'checkbox': {
        const shouldCheck = ['true', '1', 'yes', 'on', 'checked'].includes(
          String(value).trim().toLowerCase()
        );
        if (el.checked !== shouldCheck) el.click();
        break;
      }
      case 'radio': {
        if (!el.checked) el.click();
        break;
      }
      case 'date': {
        // Try native date input protocol first
        el.value = String(value);
        dispatchInputEvents(el);
        break;
      }
      default: {
        // text, email, number, tel, url, textarea, etc.
        await simulateTyping(el, value);
        break;
      }
    }
    return { ok: true, method: 'selector' };
  } catch (err) {
    return { ok: false, method: 'selector', error: err.message };
  }
}

// ── Error Detection ──────────────────────────────────────────────────────────

function detectErrors() {
  const errors = [];

  // 1. role="alert" elements
  document.querySelectorAll('[role="alert"]').forEach(el => {
    const text = el.textContent.trim();
    if (text) errors.push({ field: '', message: text });
  });

  // 2. .error, .field-error, .form-error elements
  document.querySelectorAll('.error, .field-error, .form-error, .invalid-feedback').forEach(el => {
    const text = el.textContent.trim();
    if (text && text.length < 200) errors.push({ field: '', message: text });
  });

  // 3. aria-invalid inputs
  document.querySelectorAll('[aria-invalid="true"]').forEach(el => {
    const label = el.getAttribute('aria-label') || el.name || el.id || '';
    // Try to find associated error message
    const describedBy = el.getAttribute('aria-describedby');
    let message = '';
    if (describedBy) {
      const ref = document.getElementById(describedBy);
      if (ref) message = ref.textContent.trim();
    }
    if (!message) {
      // Check next sibling for error text
      const next = el.nextElementSibling;
      if (next && (next.classList.contains('error') || next.classList.contains('invalid-feedback'))) {
        message = next.textContent.trim();
      }
    }
    if (message) errors.push({ field: label, message });
  });

  // 4. Red-bordered inputs (computed style check)
  document.querySelectorAll('input, select, textarea').forEach(el => {
    const style = window.getComputedStyle(el);
    const borderColor = style.borderColor || '';
    // Simple heuristic: check if border is reddish
    if (/rgb\(2[0-2]\d|2[3-5][0-5]|[1-9]\d{0,1},\s*[0-5]?\d,\s*[0-5]?\d\)/.test(borderColor)) {
      const label = el.getAttribute('aria-label') || el.name || el.id || '';
      errors.push({ field: label, message: 'Validation error (red border)' });
    }
  });

  // Deduplicate
  const seen = new Set();
  return errors.filter(e => {
    const key = `${e.field}:${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── DOM Stability Wait ───────────────────────────────────────────────────────

function waitForDomStability(timeoutMs = 5000) {
  return new Promise(resolve => {
    let timer = null;
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      resolve();
    };

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, 800);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true, subtree: true
    });

    // Initial settle timer (in case DOM is already stable)
    timer = setTimeout(done, 1500);

    // Hard timeout
    setTimeout(done, timeoutMs);
  });
}

// ── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'FORM_FILL_FIELD') {
    void (async () => {
      const result = await fillFieldBySelector(message.fieldInfo, message.value);
      sendResponse(result);
    })();
    return true;
  }

  if (message.type === 'FORM_CLICK_NAV') {
    void (async () => {
      const nav = message.navAction;
      let clicked = false;

      // Try selector first
      if (nav.selector) {
        try {
          const el = document.querySelector(nav.selector);
          if (el) {
            el.click();
            clicked = true;
          }
        } catch { /* invalid selector */ }
      }

      // If selector failed, try text-based search
      if (!clicked && nav.buttonText) {
        const buttons = document.querySelectorAll('button, [type="submit"], a, [role="button"]');
        for (const btn of buttons) {
          if (btn.textContent.trim().toLowerCase().includes(nav.buttonText.toLowerCase())) {
            btn.click();
            clicked = true;
            break;
          }
        }
      }

      // Wait for page to settle after navigation
      await waitForDomStability();
      sendResponse({ ok: clicked });
    })();
    return true;
  }

  if (message.type === 'FORM_DETECT_ERRORS') {
    const errors = detectErrors();
    sendResponse({ errors });
    return;
  }

  if (message.type === 'FORM_WAIT_STABLE') {
    void (async () => {
      await waitForDomStability(message.timeoutMs || 5000);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// Export for testing

})();