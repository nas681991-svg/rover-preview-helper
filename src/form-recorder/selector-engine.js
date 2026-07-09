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
export function captureField(el, value, coords = null) {
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
export function resolveSelector(chain) {
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
    return null;
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
export { isStableId, buildCssPath, buildXPath, findLabelText, detectFieldType, querySelectorDeep };
