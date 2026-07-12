/**
 * Replay Worker — background orchestrator for bulk form filling.
 *
 * Manages the row queue, coordinates content script injection,
 * handles pause/resume/cancel, tracks progress, and generates
 * the output CSV with Status + Error_Reason columns.
 *
 * Imported by background.js (runs in the MV3 service worker).
 */

const REPLAY_STATE_KEY = 'rover-form-replay:state';
const FORM_MAPS_KEY = 'rover-form-recorder:maps';

import { locateFieldVisually } from './visual-fallback.js';
import { acquire, send, release } from './debugger-coordinator.js';

// ── State Management ─────────────────────────────────────────────────────────

async function getReplayState() {
  const stored = await chrome.storage.session.get(REPLAY_STATE_KEY);
  return stored[REPLAY_STATE_KEY] || null;
}

async function setReplayState(state) {
  await chrome.storage.session.set({ [REPLAY_STATE_KEY]: state });
}

async function clearReplayState() {
  await chrome.storage.session.remove(REPLAY_STATE_KEY);
}

// ── Form Map Storage ─────────────────────────────────────────────────────────

export async function saveFormMap(formMap) {
  const stored = await chrome.storage.local.get(FORM_MAPS_KEY);
  const maps = stored[FORM_MAPS_KEY] || {};
  const id = formMap.id || `form_${Date.now()}`;
  formMap.id = id;
  maps[id] = formMap;
  await chrome.storage.local.set({ [FORM_MAPS_KEY]: maps });
  return id;
}

export async function getFormMap(id) {
  const stored = await chrome.storage.local.get(FORM_MAPS_KEY);
  const maps = stored[FORM_MAPS_KEY] || {};
  return maps[id] || null;
}

export async function listFormMaps() {
  const stored = await chrome.storage.local.get(FORM_MAPS_KEY);
  const maps = stored[FORM_MAPS_KEY] || {};
  return Object.values(maps).map(m => ({
    id: m.id,
    name: m.name || 'Unnamed Form',
    startUrl: m.startUrl || '',
    fieldCount: (m.fields || []).length,
    totalPages: m.totalPages || 1,
    recordedAt: m.recordedAt || 0,
  }));
}

// ── Replay Orchestration ─────────────────────────────────────────────────────

/**
 * Inject the replay-bundle.js content script into a tab.
 */
async function injectReplayEngine(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: 'ISOLATED',
    files: ['src/form-recorder/replay-bundle.js'],
  });
}

/**
 * Fill a single field in the target tab.
 */
async function fillField(tabId, fieldInfo, value) {
  try {
    const responses = await chrome.tabs.sendMessage(tabId, {
      type: 'FORM_FILL_FIELD',
      fieldInfo,
      value,
    });
    return responses || { ok: false, error: 'No response' };
  } catch (err) {
    return { ok: false, error: err.message, method: 'message-failed' };
  }
}

/**
 * Fall back to coordinate-based filling via Chrome DevTools Protocol.
 * Used when selector-based filling fails.
 */
async function fillFieldByCoordinates(tabId, fieldInfo, value) {
  // Try to use provided coords, but if missing we will fall back to visual
  let lease;
  try {
    // Acquire lease
    lease = await acquire(tabId, 'replay-worker');

    // Scroll to the coordinate and get viewport-relative x/y
    const scrollResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: (pageX, pageY) => {
        window.scrollTo({
          left: Math.max(0, pageX - window.innerWidth / 2),
          top: Math.max(0, pageY - window.innerHeight / 2),
          behavior: 'instant'
        });
        return {
          x: pageX - window.scrollX,
          y: pageY - window.scrollY
        };
      },
      args: [fieldInfo.coords?.pageX || 0, fieldInfo.coords?.pageY || 0]
    });
    
    let { x, y } = scrollResult[0].result;
    
    // If we have no standard coords or it's a Canvas/Shadow DOM, try Rover Vision fallback
    if (!fieldInfo.coords?.pageX) {
      // Retrieve sessionToken and apiBase from tab state
      const tabStateKey = `rover-preview-helper:tab:${tabId}`;
      const tabStored = await chrome.storage.session.get(tabStateKey);
      const config = tabStored[tabStateKey] || {};
      
      if (!config.sessionToken) {
        throw new Error('No active Rover session token found for visual fallback.');
      }
      
      const bbox = await locateFieldVisually(tabId, fieldInfo.label || fieldInfo.name, { 
        sessionToken: config.sessionToken,
        apiBase: config.apiBase || 'https://agent.rtrvr.ai'
      });
      if (bbox) {
        x = bbox.x + bbox.width / 2;
        y = bbox.y + bbox.height / 2;
      } else {
        throw new Error('Visual AI failed to locate field');
      }
    }

    // Click at the resolved coordinates
    await send(lease, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await send(lease, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });

    // Wait briefly for focus
    await new Promise(r => setTimeout(r, 200));

    // Type the value character by character
    for (const char of String(value)) {
      await send(lease, 'Input.dispatchKeyEvent', {
        type: 'keyDown', text: char,
      });
      await send(lease, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: char,
      });
      await new Promise(r => setTimeout(r, 50 + Math.random() * 80));
    }

    return { ok: true, method: 'coordinates' };
  } catch (err) {
    return { ok: false, method: 'coordinates', error: err.message };
  } finally {
    if (lease) {
      await release(lease).catch(() => {});
    }
  }
}

/**
 * Click a navigation button in the target tab.
 */
async function clickNavigation(tabId, navAction) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'FORM_CLICK_NAV',
      navAction,
    });
    return result || { ok: false };
  } catch {
    // Fall back to coordinate click via debugger
    if (navAction.coords?.pageX && navAction.coords?.pageY) {
      let lease;
      try {
        lease = await acquire(tabId, 'replay-worker');
        const scrollResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: (pageX, pageY) => {
            window.scrollTo({
              left: Math.max(0, pageX - window.innerWidth / 2),
              top: Math.max(0, pageY - window.innerHeight / 2),
              behavior: 'instant'
            });
            return { x: pageX - window.scrollX, y: pageY - window.scrollY };
          },
          args: [navAction.coords.pageX, navAction.coords.pageY]
        });
        
        const { x, y } = scrollResult[0].result;
        await send(lease, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button: 'left', clickCount: 1,
        });
        await send(lease, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
        });
        // Wait for navigation
        await new Promise(r => setTimeout(r, 2000));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        if (lease) {
          await release(lease).catch(() => {});
        }
      }
    }
    return { ok: false, error: 'Navigation click failed' };
  }
}

/**
 * Detect form errors on the current page.
 */
async function detectErrors(tabId) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'FORM_DETECT_ERRORS' });
    return result?.errors || [];
  } catch {
    return [];
  }
}

/**
 * Wait for DOM stability in the target tab.
 */
async function waitForStability(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'FORM_WAIT_STABLE', timeoutMs: 5000 });
  } catch {
    // If content script isn't ready, just wait
    await new Promise(r => setTimeout(r, 2000));
  }
}

/**
 * Send a progress update to the popup (and any listening UI).
 */
function broadcastProgress(state) {
  chrome.runtime.sendMessage({
    type: 'FORM_REPLAY_PROGRESS',
    currentRow: state.currentRow,
    totalRows: state.totalRows,
    lastStatus: state.lastStatus || '',
    status: state.status,
  }).catch(() => {});
}

// ── Main Replay Loop ─────────────────────────────────────────────────────────

/**
 * Start the bulk replay process.
 *
 * @param {number} tabId - The tab to fill forms in
 * @param {Object} formMap - The recorded form map
 * @param {Object} parsedCSV - Output from csv-engine.parseCSV()
 */
export async function startReplay(tabId, formMap, parsedCSV, fastMode = false) {
  const { columns, selectorMap, rows, navActions } = parsedCSV;

  const state = {
    status: 'running',
    formMapId: formMap.id,
    tabId,
    totalRows: rows.length,
    currentRow: 0,
    results: [],
    startedAt: Date.now(),
    lastStatus: '',
  };
  await setReplayState(state);
  broadcastProgress(state);

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    // Check for pause/cancel
    const currentState = await getReplayState();
    if (!currentState || currentState.status === 'cancelled') {
      state.status = 'cancelled';
      await setReplayState(state);
      broadcastProgress(state);
      return state;
    }
    if (currentState.status === 'paused') {
      // Wait for resume
      await new Promise(resolve => {
        const checkInterval = setInterval(async () => {
          const s = await getReplayState();
          if (!s || s.status !== 'paused') {
            clearInterval(checkInterval);
            resolve();
          }
        }, 1000);
      });
      const resumedState = await getReplayState();
      if (!resumedState || resumedState.status === 'cancelled') {
        state.status = 'cancelled';
        await setReplayState(state);
        broadcastProgress(state);
        return state;
      }
      state.status = resumedState.status;
    }

    state.currentRow = rowIdx + 1;
    const row = rows[rowIdx];
    let rowStatus = 'success';
    let rowError = '';

    try {
      // Navigate to start URL (if not in Fast Mode)
      if (!fastMode || !formMap.apiSpec) {
        const tab = await chrome.tabs.get(tabId);
        let needsNav = true;
        try {
          needsNav = new URL(tab.url).href !== new URL(formMap.startUrl).href;
        } catch { }

        if (needsNav || tab.status !== 'complete') {
          if (needsNav) await chrome.tabs.update(tabId, { url: formMap.startUrl });
          // Wait for page to load
          await new Promise(resolve => {
            const listener = (updatedTabId, changeInfo) => {
              if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            // Safety timeout
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
          });
        }
      }

      // Fast Mode API Bypass
      if (fastMode && formMap.apiSpec) {
        try {
          const spec = formMap.apiSpec;
          const endpointPath = spec?.paths ? Object.keys(spec.paths)[0] : null;
          const method = endpointPath && spec.paths[endpointPath] ? Object.keys(spec.paths[endpointPath])[0] : null;
          const targetUrl = (spec?.servers?.[0]?.url || '') + (endpointPath || '');
          
          if (!endpointPath || !method || !targetUrl) {
            throw new Error("Incomplete API spec mapping.");
          }
          
          // Build payload by mapping CSV values to field names
          const payload = {};
          for (const field of formMap.fields) {
            const columnName = field.label || field.name || '';
            if (row[columnName] !== undefined && row[columnName] !== '') {
              payload[field.name] = row[columnName];
            }
          }
          
          const response = await fetch(targetUrl, {
            method: method.toUpperCase(),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          
          if (!response.ok) {
            rowStatus = 'error';
            rowError = `API Error: ${response.status} ${response.statusText}`;
          }
        } catch (err) {
          rowStatus = 'error';
          rowError = `API Request failed: ${err.message}`;
        }
      } else {
        // --- Standard UI DOM Filling (Fallback) ---
        // Inject replay engine
        await injectReplayEngine(tabId);
        await waitForStability(tabId);

        // Group fields by page using the form map
        const fieldsByPage = new Map();
        for (const field of formMap.fields) {
          const page = field.page || 0;
          if (!fieldsByPage.has(page)) fieldsByPage.set(page, []);
          fieldsByPage.get(page).push(field);
        }
        const totalPages = formMap.totalPages || 1;

        for (let page = 0; page < totalPages; page++) {
          const pageFields = fieldsByPage.get(page) || [];

          // Fill each field on this page
          for (const field of pageFields) {
            // Find the matching column in the CSV
            const columnName = field.label || field.name || '';
            const csvValue = row[columnName];
            if (csvValue === undefined || csvValue === '') continue;

            // Try selector-based filling first
            let result = await fillField(tabId, field, csvValue);

            // If selector failed, try coordinate-based or Visual fallback
            if (!result.ok) {
              result = await fillFieldByCoordinates(tabId, field, csvValue);
            }

            if (!result.ok) {
              rowError += `${columnName}: ${result.error || 'fill failed'}; `;
              // Stage 9: Trigger Human-in-the-Loop
              try {
                await chrome.tabs.sendMessage(tabId, {
                  type: 'FORM_REQUEST_INTERVENTION',
                  message: `Failed to autofill "${columnName}" (${result.error}). Please fill it manually and click Resume.`,
                  fieldInfo: field
                });
              } catch (e) {
                // If it timed out waiting for human (message port closed)
                state.status = 'paused';
                await setReplayState(state);
                broadcastProgress(state);
                
                // Wait for the user to explicitly resume via the popup
                await new Promise(resolve => {
                  const checkInterval = setInterval(async () => {
                    const s = await getReplayState();
                    if (!s || s.status !== 'paused') {
                      clearInterval(checkInterval);
                      resolve();
                    }
                  }, 1000);
                });
              }
            }

            // Small delay between fields for stability
            await new Promise(r => setTimeout(r, 150));
          }

          // Click navigation button if not on the last page
          if (page < totalPages - 1) {
            const nav = (formMap.navActions || []).find(n => n.page === page);
            if (nav) {
              await clickNavigation(tabId, nav);
              
              // Wait for navigation (MPA full reload) or DOM stability (SPA)
              await new Promise(resolve => {
                const listener = (updatedTabId, changeInfo) => {
                  if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                  }
                };
                chrome.tabs.onUpdated.addListener(listener);
                setTimeout(() => {
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }, 5000); // 5s timeout assumes SPA or slow load
              });

              // Re-inject replay engine after page transition
              await injectReplayEngine(tabId);
              await waitForStability(tabId);
            }
          }
        }

        // After filling all pages, check for errors
        const errors = await detectErrors(tabId);
        if (errors.length > 0) {
          rowStatus = 'error';
          rowError += errors.map(e => `${e.field}: ${e.message}`).join('; ');
        }
      }

    } catch (err) {
      rowStatus = 'error';
      rowError = err.message || 'Unknown error';
    }

    state.results.push({ row, status: rowStatus, errorReason: rowError.trim() });
    state.lastStatus = rowStatus;
    
    // Sync status from storage before overwriting, in case pauseReplay or cancelReplay was called mid-row
    const latestState = await getReplayState();
    if (latestState) {
      state.status = latestState.status;
    }
    
    await setReplayState(state);
    broadcastProgress(state);
  }

  // Only mark complete if not cancelled
  const finalState = await getReplayState();
  if (finalState && finalState.status !== 'cancelled') {
    state.status = 'complete';
    await setReplayState(state);
    broadcastProgress(state);
  }
  return state;
}

/**
 * Pause the current replay.
 */
export async function pauseReplay() {
  const state = await getReplayState();
  if (state && state.status === 'running') {
    state.status = 'paused';
    await setReplayState(state);
    broadcastProgress(state);
  }
}

/**
 * Resume a paused replay.
 */
export async function resumeReplay() {
  const state = await getReplayState();
  if (state && state.status === 'paused') {
    state.status = 'running';
    await setReplayState(state);
    broadcastProgress(state);
  }
}

/**
 * Cancel the current replay.
 */
export async function cancelReplay() {
  const state = await getReplayState();
  if (state) {
    state.status = 'cancelled';
    await setReplayState(state);
    broadcastProgress(state);
  }
}

/**
 * Get the current replay state.
 */
export { getReplayState };
