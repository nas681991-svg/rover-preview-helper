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
import { resolveSelector } from './selector-engine.js';

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
export { fillFieldBySelector, findMatchingOption, similarity, detectErrors, waitForDomStability };
