/**
 * Structured diagnostic logger for the Rover Preview Helper.
 *
 * Stores the last N diagnostic entries in chrome.storage.session so they
 * survive service worker restarts. The popup can read and display them
 * for instant troubleshooting.
 *
 * Usage:
 *   import { logDiagnostic, getDiagnostics, clearDiagnostics } from './diagnostics.js';
 *   await logDiagnostic('warn', 'csp-bypass', error);
 */

const MAX_ENTRIES = 30;
const DIAG_KEY = 'rover-preview-helper:diagnostics';

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} context - Short label: 'csp-bypass', 'inject', 'fetch-preview', etc.
 * @param {Error|string|unknown} error
 */
export async function logDiagnostic(level, context, error) {
  try {
    const entry = {
      ts: Date.now(),
      level,
      context,
      message: String(error?.message || error || 'Unknown'),
    };
    // Capture a trimmed stack for errors (skip for info/warn without stacks)
    if (error?.stack) {
      entry.stack = String(error.stack).split('\n').slice(0, 4).join('\n');
    }
    const stored = await chrome.storage.session.get(DIAG_KEY);
    let log = stored[DIAG_KEY];
    if (!Array.isArray(log)) log = [];
    log = log.slice(-(MAX_ENTRIES - 1));
    log.push(entry);
    await chrome.storage.session.set({ [DIAG_KEY]: log });
  } catch {
    // Best-effort — never let diagnostics logging itself cause failures.
  }
}

/**
 * Retrieve all stored diagnostic entries.
 * @returns {Promise<Array<{ts:number, level:string, context:string, message:string, stack?:string}>>}
 */
export async function getDiagnostics() {
  try {
    const stored = await chrome.storage.session.get(DIAG_KEY);
    return Array.isArray(stored[DIAG_KEY]) ? stored[DIAG_KEY] : [];
  } catch {
    return [];
  }
}

/**
 * Clear all diagnostic entries.
 */
export async function clearDiagnostics() {
  try {
    await chrome.storage.session.remove(DIAG_KEY);
  } catch {
    // Best-effort
  }
}
