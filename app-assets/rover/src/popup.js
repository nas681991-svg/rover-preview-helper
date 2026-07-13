import { normalizeConfig, validateConfigInput, STORAGE_KEY_PREFIX, STATUS_KEY_PREFIX } from './shared.js';
import { generateTemplate, parseCSV } from './form-recorder/csv-engine.js';
import { generateRAS, parseRAS } from './form-recorder/ras-engine.js';
import { downloadUASL } from './form-recorder/skill-converter.js';

const configEl = document.getElementById('config');
const statusEl = document.getElementById('status');
const injectBtn = document.getElementById('inject');
const reconnectBtn = document.getElementById('reconnect');
const helpEl = document.getElementById('config-help');
const tabBadgeEl = document.getElementById('tab-badge');
const tabCardEl = document.getElementById('tab-card');
const tabSummaryEl = document.getElementById('tab-summary');
const validationEl = document.getElementById('config-validation');
const sessionsPanel = document.getElementById('sessions-panel');
const sessionsList = document.getElementById('sessions-list');
const sessionsCount = document.getElementById('sessions-count');
const diagPanel = document.getElementById('diagnostics-panel');
const diagList = document.getElementById('diagnostics-list');
const diagCount = document.getElementById('diag-count');
const diagClear = document.getElementById('diag-clear');

function buildStorageKey(prefix, tabId) {
  return `${prefix}${tabId}`;
}

function cleanEditorConfig(value) {
  if (!value || typeof value !== 'object') return null;
  const next = { ...value };
  delete next.bootstrapId;
  delete next.targetHost;
  delete next.configRefreshedAt;
  return normalizeConfig(next);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff9a76' : '';
}

function setEditorConfig(config) {
  configEl.value = config ? JSON.stringify(config, null, 2) : '';
  if (helpEl) helpEl.style.display = config ? 'none' : 'block';
}

function renderTabState(tab, state) {
  if (!tabBadgeEl || !tabCardEl || !tabSummaryEl) return;
  if (!tab?.id || !state) {
    tabBadgeEl.style.display = 'none';
    tabCardEl.style.display = 'none';
    tabSummaryEl.textContent = '';
    return;
  }

  let host = String(state.targetHost || '').trim();
  if (!host) {
    try {
      host = tab.url ? new URL(tab.url).host : '';
    } catch {
      host = '';
    }
  }
  const mode = String(state.mode || 'full').trim() || 'full';
  const siteId = String(state.siteId || '').trim();
  const source = state.previewId && state.previewToken ? 'Hosted preview session' : 'Saved reusable config';

  tabBadgeEl.style.display = 'inline-flex';
  tabCardEl.style.display = 'block';
  tabSummaryEl.textContent = '';
  const lines = [
    host ? `Host: ${host}` : '',
    siteId ? `Site: ${siteId}` : '',
    `Mode: ${mode}`,
    `Source: ${source}`,
  ].filter(Boolean);
  lines.forEach((line, i) => {
    const parts = line.split(': ');
    const strong = document.createElement('strong');
    strong.textContent = parts[0] + ': ';
    tabSummaryEl.appendChild(strong);
    tabSummaryEl.appendChild(document.createTextNode(parts.slice(1).join(': ')));
    if (i < lines.length - 1) tabSummaryEl.appendChild(document.createElement('br'));
  });
}

async function loadTabState(tabId) {
  const key = buildStorageKey(STORAGE_KEY_PREFIX, tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] || null;
}

async function loadSavedStatus(tabId) {
  const key = buildStorageKey(STATUS_KEY_PREFIX, tabId);
  const stored = await chrome.storage.session.get(key);
  const value = String(stored[key] || '').trim();
  if (value) {
    setStatus(value, value.toLowerCase().includes('invalid') || value.toLowerCase().includes('failed'));
  } else {
    setStatus('Ready. Use Workspace -> Live Test -> Use Workspace config -> Open target with helper, or paste config JSON below.');
  }
}

async function loadPersistedConfig() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_PREVIEW_HELPER_GET_PERSISTED_CONFIG',
    });
    if (response?.ok && response.config) {
      setEditorConfig(cleanEditorConfig(response.config));
      setStatus('Loaded your last-used config. Click "Inject Rover into this tab" to use it here.');
      return true;
    }
  } catch {
    // Ignore extension messaging failures during initial paint.
  }
  return false;
}

injectBtn.addEventListener('click', async () => {


  injectBtn.disabled = true;
  reconnectBtn.disabled = true;
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('No active tab found.');
    const raw = JSON.parse(String(configEl.value || '{}'));
    const config = normalizeConfig(raw);
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_PREVIEW_HELPER_INJECT',
      tabId: tab.id,
      config,
    });
    if (!response?.ok) throw new Error(response?.error || 'Injection failed.');
    setEditorConfig(cleanEditorConfig(response.state) || config);
    renderTabState(tab, response.state || null);
    setStatus('Rover injected into this tab and your config was saved.');
  } catch (error) {
    setStatus(String(error?.message || error), true);
  } finally {
    injectBtn.disabled = false;
    reconnectBtn.disabled = false;
  }
});

reconnectBtn.addEventListener('click', async () => {
  injectBtn.disabled = true;
  reconnectBtn.disabled = true;
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('No active tab found.');
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_PREVIEW_HELPER_RECONNECT',
      tabId: tab.id,
    });
    if (!response?.ok) throw new Error(response?.error || 'Reconnect failed.');
    const tabState = await loadTabState(tab.id);
    renderTabState(tab, tabState);
    setStatus('Rover reconnect requested for this tab.');
  } catch (error) {
    setStatus(String(error?.message || error), true);
  } finally {
    injectBtn.disabled = false;
    reconnectBtn.disabled = false;
  }
});

configEl.addEventListener('input', () => {
  if (helpEl && configEl.value.trim()) helpEl.style.display = 'none';
  runConfigValidation();
});

// ── Config validation (#4) ──────────────────────────────────────────────────
function runConfigValidation() {
  if (!validationEl) return;
  const raw = configEl.value.trim();
  if (!raw) {
    validationEl.style.display = 'none';
    validationEl.className = 'validation-indicator';
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    const issues = validateConfigInput(parsed);
    if (issues.length === 0) {
      validationEl.textContent = '✓ Valid config';
      validationEl.className = 'validation-indicator valid';
    } else {
      const worst = issues.find(i => i.level === 'error') || issues[0];
      validationEl.textContent = `${worst.level === 'error' ? '✗' : '⚠'} ${worst.message}`;
      validationEl.className = `validation-indicator ${worst.level}`;
    }
    validationEl.style.display = 'block';
  } catch (e) {
    const msg = String(e.message || '').replace(/^JSON\.parse:\s*/, '');
    validationEl.textContent = `✗ Invalid JSON: ${msg}`;
    validationEl.className = 'validation-indicator error';
    validationEl.style.display = 'block';
  }
}

// ── Multi-tab sessions dashboard (#5) ───────────────────────────────────────
function formatAge(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

async function renderSessions() {
  if (!sessionsPanel || !sessionsList || !sessionsCount) return;
  try {
    const allKeys = await chrome.storage.session.get(null);
    const sessions = [];
    const now = Date.now();

    for (const [key, state] of Object.entries(allKeys)) {
      if (!key.startsWith(STORAGE_KEY_PREFIX)) continue;
      if (!state || typeof state !== 'object') continue;
      const tabId = Number(key.replace(STORAGE_KEY_PREFIX, ''));
      if (!Number.isFinite(tabId)) continue;

      const expiresAt = Number(state.sessionTokenExpiresAt || 0);
      let status = 'active';
      if (expiresAt > 0 && expiresAt - now < 120_000) status = 'expiring';

      sessions.push({
        tabId,
        host: state.targetHost || '',
        siteId: state.siteId || '',
        bootstrapId: state.bootstrapId || '',
        age: state.configRefreshedAt ? now - state.configRefreshedAt : 0,
        status,
      });
    }

    if (sessions.length === 0) {
      sessionsPanel.style.display = 'none';
      return;
    }

    sessionsCount.textContent = String(sessions.length);
    sessionsPanel.style.display = 'block';
    sessionsList.innerHTML = '';

    // Resolve tab titles
    let tabMap = {};
    try {
      const tabs = await chrome.tabs.query({});
      tabMap = Object.fromEntries(tabs.map(t => [t.id, t]));
    } catch { /* ignore */ }

    for (const s of sessions) {
      const tab = tabMap[s.tabId];
      let displayHost = s.host;
      if (!displayHost && tab?.url) {
        try { displayHost = new URL(tab.url).hostname; } catch { displayHost = ''; }
      }
      if (!displayHost) displayHost = `Tab ${s.tabId}`;

      const row = document.createElement('div');
      row.className = 'session-row';
      row.title = `Tab ${s.tabId} · ${s.siteId}`;

      row.innerHTML = `
        <span class="session-dot ${s.status}"></span>
        <span class="session-host">${escapeHtml(displayHost)}</span>
        <span class="session-site">${escapeHtml(s.siteId.slice(0, 16))}</span>
        <span class="session-age">${s.age ? formatAge(s.age) : ''}</span>
        <button class="session-disconnect" title="Disconnect">✕</button>
      `;

      // Click row to switch to that tab
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('session-disconnect')) return;
        chrome.tabs.update(s.tabId, { active: true }).catch(() => {});
      });

      // Disconnect button — clears state (does NOT reconnect)
      row.querySelector('.session-disconnect').addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.storage.session.remove(key_for(s.tabId)).catch(() => {});
        // Also remove the status key and tell the background to clean up CSP
        await chrome.storage.session.remove(`${STATUS_KEY_PREFIX}${s.tabId}`).catch(() => {});
        renderSessions();
      });

      sessionsList.appendChild(row);
    }
  } catch {
    sessionsPanel.style.display = 'none';
  }
}

function key_for(tabId) { return `${STORAGE_KEY_PREFIX}${tabId}`; }

function escapeHtml(str) {
  const div = document.createElement('span');
  div.textContent = str;
  return div.innerHTML;
}

// ── Diagnostics panel (#2) ──────────────────────────────────────────────────
const DIAG_KEY = 'rover-preview-helper:diagnostics';

async function renderDiagnostics() {
  if (!diagPanel || !diagList || !diagCount) return;
  try {
    const stored = await chrome.storage.session.get(DIAG_KEY);
    const entries = stored[DIAG_KEY] || [];

    if (entries.length === 0) {
      diagPanel.style.display = 'none';
      return;
    }

    diagCount.textContent = String(entries.length);
    diagPanel.style.display = 'block';
    diagList.innerHTML = '';

    // Show newest first
    for (const entry of entries.slice().reverse()) {
      const div = document.createElement('div');
      div.className = `diag-entry ${entry.level || 'info'}`;

      const time = new Date(entry.ts).toLocaleTimeString();
      div.innerHTML = `
        <div>${escapeHtml(entry.message)}</div>
        <div class="diag-meta">
          <span>${escapeHtml(entry.context || '')}</span>
          <span>${time}</span>
        </div>
      `;
      diagList.appendChild(div);
    }
  } catch {
    diagPanel.style.display = 'none';
  }
}

if (diagClear) {
  diagClear.addEventListener('click', async () => {
    await chrome.storage.session.remove(DIAG_KEY).catch(() => {});
    renderDiagnostics();
  });
}

// ── Form Recorder ───────────────────────────────────────────────────────────
const recorderStartBtn = document.getElementById('recorder-start');
const recorderStopBtn = document.getElementById('recorder-stop');
const recorderStatusBadge = document.getElementById('recorder-status');
const recorderStats = document.getElementById('recorder-stats');
const recorderFieldCount = document.getElementById('recorder-field-count');
const recorderPageCount = document.getElementById('recorder-page-count');
const recorderActions = document.getElementById('recorder-actions');
const downloadCsvBtn = document.getElementById('recorder-download-csv');
const downloadApiBtn = document.getElementById('recorder-download-api');
const downloadRasBtn = document.getElementById('recorder-download-ras');
const downloadUaslBtn = document.getElementById('recorder-download-uasl');
const fastModeContainer = document.getElementById('fast-mode-container');
const fastModeCheckbox = document.getElementById('fast-mode-checkbox');
const uploadCsvInput = document.getElementById('recorder-upload-csv');
const uploadRasInput = document.getElementById('recorder-upload-ras');
const uploadPdfInput = document.getElementById('recorder-pdf-input');
const replayProgress = document.getElementById('replay-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const replayPauseBtn = document.getElementById('replay-pause');
const replayResumeBtn = document.getElementById('replay-resume');
const replayCancelBtn = document.getElementById('replay-cancel');

let currentFormMap = null;

function setRecorderBadge(text, color) {
  if (!recorderStatusBadge) return;
  recorderStatusBadge.textContent = text;
  recorderStatusBadge.style.background = color;
}

if (recorderStartBtn) {
  recorderStartBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) { setStatus('No active tab.', true); return; }

    setRecorderBadge('Starting…', '#666');
    recorderStartBtn.disabled = true;

    const result = await chrome.runtime.sendMessage({
      type: 'FORM_RECORDER_START', tabId: tab.id,
    });

    if (result?.ok) {
      setRecorderBadge('⏺ Recording', '#d63031');
      recorderStopBtn.disabled = false;
      if (recorderStats) recorderStats.style.display = 'flex';
      if (recorderActions) recorderActions.style.display = 'none';
      setStatus('Recording form interactions… Fill out the form, then click Stop.');
    } else {
      setRecorderBadge('Error', '#d63031');
      recorderStartBtn.disabled = false;
      setStatus(result?.error || 'Failed to start recording.', true);
    }
  });
}

if (recorderStopBtn) {
  recorderStopBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return;

    const result = await chrome.runtime.sendMessage({
      type: 'FORM_RECORDER_STOP', tabId: tab.id,
    });

    recorderStartBtn.disabled = false;
    recorderStopBtn.disabled = true;

    if (result?.ok && result.formMap) {
      currentFormMap = result.formMap;
      const fieldCount = result.formMap.fields?.length || 0;
      const pageCount = result.formMap.totalPages || 1;

      setRecorderBadge(`✓ ${fieldCount} fields`, '#00b894');
      if (recorderFieldCount) recorderFieldCount.textContent = String(fieldCount);
      if (recorderPageCount) recorderPageCount.textContent = String(pageCount);
      if (recorderActions) recorderActions.style.display = 'flex';
      
      if (currentFormMap.apiSpec) {
        if (downloadApiBtn) downloadApiBtn.style.display = 'inline-block';
        if (fastModeContainer) fastModeContainer.style.display = 'flex';
      } else {
        if (downloadApiBtn) downloadApiBtn.style.display = 'none';
        if (fastModeContainer) fastModeContainer.style.display = 'none';
      }
      
      setStatus(`Recorded ${fieldCount} fields across ${pageCount} page(s). Download the CSV template or upload data.`);
    } else {
      setRecorderBadge('Ready', 'var(--muted)');
      setStatus(result?.error || 'No fields recorded.', true);
    }
  });
}

// CSV Template Download
if (downloadCsvBtn) {
  downloadCsvBtn.addEventListener('click', () => {
    if (!currentFormMap) { setStatus('No recording to export.', true); return; }
    const csv = generateTemplate(currentFormMap);

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const name = `form-template-${currentFormMap.id || Date.now()}.csv`;
    chrome.downloads.download({ url, filename: name, saveAs: true });
    setStatus(`CSV template "${name}" ready for download.`);
  });
}

// API Spec Download
if (downloadApiBtn) {
  downloadApiBtn.addEventListener('click', () => {
    if (!currentFormMap || !currentFormMap.apiSpec) { setStatus('No API spec to export.', true); return; }
    
    // Quick YAML stringification for the OpenAPI spec
    const yaml = JSON.stringify(currentFormMap.apiSpec, null, 2);
    const blob = new Blob([yaml], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const name = `form-api-spec-${currentFormMap.id || Date.now()}.yaml`;
    chrome.downloads.download({ url, filename: name, saveAs: true });
    setStatus(`API Spec "${name}" ready for download.`);
  });
}

// UASL Script Download
if (downloadUaslBtn) {
  downloadUaslBtn.addEventListener('click', () => {
    if (!currentFormMap) { setStatus('No recording to export.', true); return; }
    downloadUASL(currentFormMap).then(() => {
      setStatus(`UASL format ready for download.`);
    }).catch(err => {
      setStatus(`Failed to download UASL: ${err.message}`, true);
    });
  });
}

// RAS Script Download
if (downloadRasBtn) {
  downloadRasBtn.addEventListener('click', () => {
    if (!currentFormMap) return;
    const ras = generateRAS(currentFormMap);
    const blob = new Blob([ras], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = `rover-script-${currentFormMap.id || Date.now()}.ras.json`;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`RAS script "${name}" ready for download.`);
  });
}

// Filled CSV Upload → Bulk Replay
if (uploadCsvInput) {
  uploadCsvInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentFormMap) return;

    const text = await file.text();
    const tab = await getActiveTab();
    if (!tab?.id) { setStatus('No active tab.', true); return; }

    let parsed;
    try {
      parsed = parseCSV(text);
      if (fastModeContainer) fastModeContainer.style.display = 'flex';
    } catch (err) {
      setStatus(`CSV Error: ${err.message}`, true);
      return;
    }

    setStatus(`Starting bulk fill: ${parsed.rows.length} rows…`);
    if (replayProgress) replayProgress.style.display = 'block';
    if (recorderActions) recorderActions.style.display = 'none';

    chrome.runtime.sendMessage({
      type: 'FORM_REPLAY_START',
      tabId: tab.id,
      formMapId: currentFormMap.id,
      fastMode: fastModeCheckbox && fastModeCheckbox.checked,
      parsedCSV: {
        columns: parsed.columns,
        selectorMap: Object.fromEntries(parsed.selectorMap),
        rows: parsed.rows,
        navActions: parsed.navActions
      },
    });
  });
}

// RAS Script Upload → Bulk Replay
if (uploadRasInput) {
  uploadRasInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentFormMap) return;

    const text = await file.text();
    const tab = await getActiveTab();
    if (!tab?.id) { setStatus('No active tab.', true); return; }

    let parsed;
    try {
      parsed = parseRAS(text);
      if (fastModeContainer) fastModeContainer.style.display = 'flex';
    } catch (err) {
      setStatus(`RAS Error: ${err.message}`, true);
      return;
    }

    setStatus(`Starting replay from RAS script…`);
    if (replayProgress) replayProgress.style.display = 'block';
    if (recorderActions) recorderActions.style.display = 'none';

    chrome.runtime.sendMessage({
      type: 'FORM_REPLAY_START',
      tabId: tab.id,
      formMapId: currentFormMap.id,
      fastMode: fastModeCheckbox && fastModeCheckbox.checked,
      parsedCSV: {
        columns: parsed.columns,
        selectorMap: parsed.selectorMap || {},
        rows: parsed.rows,
        navActions: parsed.navActions
      },
    });
  });
}

// PDF Upload → Extract → CSV
if (uploadPdfInput) {
  uploadPdfInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !currentFormMap) return;

    setStatus('Extracting data from PDF(s)…');

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }
      const base64 = btoa(binary);

      const csvColumns = (currentFormMap.fields || [])
        .map(f => f.label || f.name || 'Field')
        .filter(c => !c.startsWith('__NAV_'));

      const result = await chrome.runtime.sendMessage({
        type: 'FORM_RECORDER_PDF_EXTRACT',
        pdfBase64: base64,
        csvColumns,
      });

      if (result?.ok && result.rows?.length) {
        setStatus(`Extracted ${result.rows.length} row(s) from PDF (${result.source}). Starting fill…`);
        const tab = await getActiveTab();
        if (!tab?.id) continue;

        if (replayProgress) replayProgress.style.display = 'block';
        chrome.runtime.sendMessage({
          type: 'FORM_REPLAY_START', tabId: tab.id,
          formMapId: currentFormMap.id,
          parsedCSV: { columns: csvColumns, selectorMap: {}, rows: result.rows, navActions: [] },
        });
      } else {
        setStatus(`PDF extraction failed: ${result?.error || 'Unknown'}`, true);
      }
    }
  });
}

// Replay Progress Listener
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'FORM_REPLAY_PROGRESS') return;

  const { currentRow, totalRows, status, lastStatus } = message;
  const pct = totalRows > 0 ? Math.round((currentRow / totalRows) * 100) : 0;

  if (progressFill) progressFill.style.width = `${pct}%`;
  if (progressText) progressText.textContent = `${currentRow} / ${totalRows} rows (${lastStatus || status})`;

  if (status === 'complete' || status === 'cancelled') {
    setStatus(`Replay ${status}: ${currentRow}/${totalRows} rows processed.`);
    if (replayProgress) setTimeout(() => { replayProgress.style.display = 'none'; }, 3000);
    if (recorderActions) recorderActions.style.display = 'flex';
  }

  if (status === 'paused') {
    if (replayPauseBtn) replayPauseBtn.style.display = 'none';
    if (replayResumeBtn) replayResumeBtn.style.display = 'inline-block';
  } else {
    if (replayPauseBtn) replayPauseBtn.style.display = 'inline-block';
    if (replayResumeBtn) replayResumeBtn.style.display = 'none';
  }
});

if (replayPauseBtn) replayPauseBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FORM_REPLAY_PAUSE' });
});
if (replayResumeBtn) replayResumeBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FORM_REPLAY_RESUME' });
});
if (replayCancelBtn) replayCancelBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FORM_REPLAY_CANCEL' });
});

// ── Init ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const tab = await getActiveTab();
    let tabState = null;
    if (tab?.id) {
      tabState = await loadTabState(tab.id);
      await loadSavedStatus(tab.id);
      renderTabState(tab, tabState);
    }

    const loadedPersisted = await loadPersistedConfig();
    if (!loadedPersisted && tabState) {
      setEditorConfig(cleanEditorConfig(tabState));
      setStatus('Loaded this tab\'s Rover config. Click "Inject Rover into this tab" to refresh it here.');
    } else if (!loadedPersisted && helpEl) {
      helpEl.style.display = 'block';
    }

    // Run initial validation on whatever config was loaded
    runConfigValidation();

    // Render multi-tab sessions and diagnostics
    renderSessions();
    renderDiagnostics();
  } catch {
    // Ignore initial load failures.
  }
})();

