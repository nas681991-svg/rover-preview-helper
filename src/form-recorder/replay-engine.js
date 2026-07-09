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
import { findBestMatch } from './fuzzy-matcher.js';
import { detectErrors as detectErrorsAdv } from './error-detector.js';
import { requestHumanIntervention, detectCaptcha } from './confidence.js';

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
// Now handled by fuzzy-matcher.js

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
        const optionsText = Array.from(el.options).map(o => o.text);
        const matchResult = findBestMatch(String(value), optionsText, 0.8);
        
        if (!matchResult) {
          await requestHumanIntervention(`Low confidence mapping for dropdown value "${value}". Please select the correct option manually.`, el);
          return { ok: true, method: 'human' };
        }
        
        const optionEl = Array.from(el.options).find(o => o.text === matchResult.match);
        if (optionEl) {
          el.value = optionEl.value;
          dispatchInputEvents(el);
        } else {
          return { ok: false, method: 'selector', error: `No matching option for "${value}"` };
        }
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
// Handled by error-detector.js

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
      if (detectCaptcha()) {
        await requestHumanIntervention('CAPTCHA detected. Please solve the CAPTCHA manually to resume the bulk run.');
      }
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
    const errors = detectErrorsAdv();
    // Return them formatted for the UI/CSV logging as `{ field: '', message: '' }` objects.
    // detectErrorsAdv returns an array of strings like "Email: invalid", so let's map them.
    const mappedErrors = errors.map(str => {
      const [field, ...msgParts] = str.split(': ');
      return { field: field, message: msgParts.join(': ') };
    });
    sendResponse({ errors: mappedErrors });
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
export { fillFieldBySelector, waitForDomStability };
