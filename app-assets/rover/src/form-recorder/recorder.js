/**
 * Form Recorder — content script that watches user interactions with form
 * elements and builds a structured field map with selectors + coordinates.
 *
 * Injected into the ISOLATED world. Communicates with the background
 * service worker via chrome.runtime messaging.
 */
import { captureField } from './selector-engine.js';
import { labelFields } from './labeler.js';
import { wizardState } from './wizard-state.js';
import { startTrace, stopTrace, flushTrace } from './trace-engine.js';

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

export function startRecording() {
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

export function getRecordingState() {
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
