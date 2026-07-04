import { normalizeConfig, validateConfigInput, STORAGE_KEY_PREFIX, STATUS_KEY_PREFIX } from './shared.js';

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
