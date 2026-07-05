import {
  extractPreviewLaunchParams,
  extractHelperConfigFragment,
  hasHelperConfigFragment,
  isHostAllowed,
  normalizeConfig,
  normalizeHost,
  serializeConfigForSeed,
  STATUS_KEY_PREFIX,
  STORAGE_KEY_PREFIX,
  stripPreviewLaunchParams,
} from './shared.js';
import { enableCspBypass, disableCspBypass, cleanupOrphanedRules } from './csp-bypass.js';
import { logDiagnostic } from './diagnostics.js';
import {
  saveFormMap, getFormMap, listFormMaps,
  startReplay, pauseReplay, resumeReplay, cancelReplay, getReplayState,
} from './form-recorder/replay-worker.js';
import { extractFromPDF, extractFromMultiplePDFs } from './form-recorder/pdf-pipeline.js';

// Clean up stale CSP rules from previous sessions on every SW start.
cleanupOrphanedRules();

// Also run cleanup on browser startup (handles SW restarts mid-session).
chrome.runtime.onStartup.addListener(() => {
  cleanupOrphanedRules();
});

// ── Ephemeral in-memory caches ──────────────────────────────────────────────
// These Maps are HOT CACHES ONLY. MV3 service workers are killed after ~30s
// of inactivity, wiping all in-memory state. None of these Maps are
// correctness gates — they are performance optimizations. The system must
// function correctly even when they start empty after a worker restart.
const MAX_IN_MEMORY_STATES = 50;
const inMemoryState = new Map();
const pendingInjects = new Map();     // dedup guard (optimization, not correctness)
const refreshPromises = new Map();    // inflight coalescing (safe to lose)
const pendingHydrations = new Map(); // dedup guard (safe to lose)
const PERSISTED_CONFIG_KEY = 'rover-preview-helper:last-config';

async function persistConfig(config) {
  const toStore = { ...config };
  delete toStore.bootstrapId;
  delete toStore.targetHost;
  delete toStore.configRefreshedAt;
  delete toStore.sessionToken;
  delete toStore.sessionTokenExpiresAt;
  await chrome.storage.local.set({ [PERSISTED_CONFIG_KEY]: toStore });
}

async function getPersistedConfig() {
  const stored = await chrome.storage.local.get(PERSISTED_CONFIG_KEY);
  return stored[PERSISTED_CONFIG_KEY] || null;
}

function storageKey(tabId) {
  return `${STORAGE_KEY_PREFIX}${tabId}`;
}

function statusKey(tabId) {
  return `${STATUS_KEY_PREFIX}${tabId}`;
}

async function getSessionValue(key) {
  return await chrome.storage.session.get(key);
}

async function setSessionValue(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

async function removeSessionValue(key) {
  await chrome.storage.session.remove(key);
}

async function readState(tabId) {
  const memory = inMemoryState.get(tabId);
  if (memory) return memory;
  const stored = await getSessionValue(storageKey(tabId));
  const value = stored[storageKey(tabId)];
  if (value) {
    inMemoryState.set(tabId, value);
    return value;
  }
  return null;
}

async function writeState(tabId, state) {
  inMemoryState.set(tabId, state);
  if (inMemoryState.size > MAX_IN_MEMORY_STATES) {
    const firstKey = inMemoryState.keys().next().value;
    if (firstKey !== undefined) inMemoryState.delete(firstKey);
  }
  await setSessionValue(storageKey(tabId), state);
}

async function clearState(tabId) {
  inMemoryState.delete(tabId);
  await removeSessionValue(storageKey(tabId));
}

async function writeStatus(tabId, message) {
  await setSessionValue(statusKey(tabId), String(message || '').trim());
}

async function sanitizeTabUrl(tabId, url) {
  const cleanUrl = stripPreviewLaunchParams(url);
  if (!cleanUrl || cleanUrl === url) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      injectImmediately: true,
      func: nextUrl => {
        try {
          if (window.location.href !== nextUrl) {
            window.history.replaceState(window.history.state, '', nextUrl);
          }
        } catch {
          // Ignore URL rewrite failures on locked-down pages.
        }
      },
      args: [cleanUrl],
    });
  } catch (e) {
    // If this fails, the preview still works; the params just remain visible.
    void logDiagnostic('warn', 'sanitize-url', e);
  }
}

async function fetchPreviewConfig(params, tabUrl) {
  const apiBase = String(params.apiBase || 'https://agent.rtrvr.ai').replace(/\/+$/, '');
  const ALLOWED_API_HOSTS = ['agent.rtrvr.ai', 'api.rtrvr.ai', 'agent.pioneer.ai'];
  try {
    const parsed = new URL(apiBase);
    if (!ALLOWED_API_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
      throw new Error(`Untrusted API host: ${parsed.hostname}`);
    }
  } catch (e) {
    if (e.message.startsWith('Untrusted')) throw e;
    throw new Error(`Invalid apiBase URL: ${apiBase}`);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(
      `${apiBase}/v2/rover/previews/${encodeURIComponent(params.previewId)}?previewToken=${encodeURIComponent(params.previewToken)}`,
      {
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Preview fetch failed (${response.status}).`);
  }

  const payload = await response.json().catch(() => ({}));
  const data = payload?.data || payload || {};
  const fetchedAt = Date.now();
  const helperConfig = normalizeConfig({
    previewId: params.previewId,
    previewToken: params.previewToken,
    ...(data.helperConfig || {}),
    siteId: data.helperConfig?.siteId || data.siteId,
    sessionToken: data.helperConfig?.sessionToken || data.runtimeSessionToken,
    sessionId: data.helperConfig?.sessionId || data.sessionId,
    sessionTokenExpiresAt: data.runtimeSessionTokenExpiresAt || data.helperConfig?.sessionTokenExpiresAt,
    targetUrl: data.helperConfig?.targetUrl || data.targetUrl || tabUrl,
    apiBase,
    requestId: data.helperConfig?.requestId || data.activeLaunch?.requestId,
    attachToken: data.helperConfig?.attachToken || data.activeLaunch?.attachToken,
    launchUrl: data.helperConfig?.launchUrl || '',
    previewLabel: data.helperConfig?.previewLabel || `Rover Preview · ${data.host || normalizeHost(tabUrl) || 'site'}`,
    allowedDomains:
      data.helperConfig?.allowedDomains
      || (data.host ? [data.host] : []),
    domainScopeMode: data.helperConfig?.domainScopeMode || 'host_only',
    sessionScope: data.helperConfig?.sessionScope || 'shared_site',
    openOnInit: data.helperConfig?.openOnInit !== false,
    configRefreshedAt: fetchedAt,
  });

  if (!helperConfig.siteId || !helperConfig.sessionToken) {
    throw new Error('Preview response is missing siteId or runtime session token.');
  }

  return helperConfig;
}

function shouldRefreshState(state, nowMs = Date.now()) {
  if (!state?.previewId || !state?.previewToken) return false;
  const refreshedAt = Number(state.configRefreshedAt || 0);
  const sessionTokenExpiresAt = Number(state.sessionTokenExpiresAt || 0);
  if (!refreshedAt) return true;
  if (!sessionTokenExpiresAt) return nowMs - refreshedAt > 15_000;
  if (sessionTokenExpiresAt - nowMs < 60_000) return true;
  return nowMs - refreshedAt > 15_000;
}

async function refreshStateFromBackend(tabId, state, tabUrl, options = {}) {
  if (!state) return null;
  if (!state.previewId || !state.previewToken) return state;
  if (!options.force && !shouldRefreshState(state)) {
    return state;
  }
  if (!options.force && refreshPromises.has(tabId)) {
    return refreshPromises.get(tabId);
  }
  
  const promise = (async () => {
    const refreshed = await fetchPreviewConfig({
      previewId: state.previewId,
      previewToken: state.previewToken,
      apiBase: state.apiBase,
    }, tabUrl || state.targetUrl || '');
    const targetHost = buildTargetHost(tabUrl || refreshed.targetUrl || state.targetUrl, refreshed) || state.targetHost;
    const shouldLockTargetHost = Boolean(refreshed.previewId && refreshed.previewToken);
    const nextState = normalizeConfig({
      ...state,
      ...refreshed,
      targetHost: shouldLockTargetHost ? targetHost : '',
      configRefreshedAt: Date.now(),
    });
    const persistedState = {
      ...nextState,
      targetHost: shouldLockTargetHost ? targetHost : '',
    };
    await writeState(tabId, persistedState);
    return persistedState;
  })();
  
  refreshPromises.set(tabId, promise);
  try {
    return await promise;
  } finally {
    if (refreshPromises.get(tabId) === promise) {
      refreshPromises.delete(tabId);
    }
  }
}

async function maybeHydratePreviewFromUrl(tabId, tabUrl) {
  const params = extractPreviewLaunchParams(tabUrl);
  if (!params) return null;

  const key = `${tabId}:${tabUrl}`;
  if (pendingHydrations.has(key)) return pendingHydrations.get(key);

  const promise = (async () => {
    try {
      const config = await fetchPreviewConfig(params, tabUrl);
      await sanitizeTabUrl(tabId, tabUrl);
      return await injectFromTab(tabId, config);
    } finally {
      setTimeout(() => pendingHydrations.delete(key), 1000);
    }
  })();
  pendingHydrations.set(key, promise);
  return promise;
}

async function maybeHydrateGenericConfigFromUrl(tabId, tabUrl) {
  if (!hasHelperConfigFragment(tabUrl)) return null;

  const key = `${tabId}:${tabUrl}`;
  if (pendingHydrations.has(key)) return pendingHydrations.get(key);

  const promise = (async () => {
    try {
      const rawConfig = extractHelperConfigFragment(tabUrl);
      if (!rawConfig) return null;
      const config = normalizeConfig(rawConfig);
      await sanitizeTabUrl(tabId, tabUrl);
      if (config.previewId && config.previewToken) {
        const previewConfig = await fetchPreviewConfig({
          previewId: config.previewId,
          previewToken: config.previewToken,
          apiBase: config.apiBase,
        }, tabUrl);
        return await injectFromTab(tabId, {
          ...config,
          ...previewConfig,
        });
      }
      return await injectFromTab(tabId, config);
    } finally {
      setTimeout(() => pendingHydrations.delete(key), 1000);
    }
  })();
  pendingHydrations.set(key, promise);
  return promise;
}

function buildTargetHost(tabUrl, fallbackState) {
  const fromTab = normalizeHost(tabUrl);
  if (fromTab) return fromTab;
  return String(fallbackState?.targetHost || '').toLowerCase();
}

function shouldLockStateToTargetHost(state) {
  return Boolean(state?.previewId && state?.previewToken);
}

function canReinjectStateOnUrl(state, url) {
  const host = normalizeHost(url);
  if (!host) return false;
  if (shouldLockStateToTargetHost(state)) {
    return !state.targetHost || state.targetHost === host;
  }
  return isHostAllowed(host, state.allowedDomains, state.domainScopeMode);
}

async function injectMainWorldState(tabId, state) {
  if (!state) return false;
  const signature = `${state.siteId}:${state.publicKey || ''}:${state.sessionToken || ''}:${state.launchUrl || state.requestId || ''}:${state.attachToken || ''}`;
  const existing = pendingInjects.get(tabId);
  // Dedup optimization: skip re-injection if the same config is already being
  // applied. This guard is ephemeral — after a SW restart pendingInjects is
  // empty and we safely re-inject (idempotent: rover('boot') is safe to call
  // multiple times with the same config).
  if (existing === signature) return true;
  pendingInjects.set(tabId, signature);

  // Load the Rover worker from the packaged file (resolved relative to the
  // extension, not the page) unless the caller pinned an explicit workerUrl.
  // embed.js is injected via executeScript below, so its document.currentScript
  // is null and it can't derive the worker path on its own.
  const seedState = {
    ...state,
    workerUrl: state.workerUrl || chrome.runtime.getURL('vendor/worker.js'),
    bootstrapId: signature,
  };

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      injectImmediately: true,
      func: previewState => {
        window.__ROVER_PREVIEW_HELPER_STATE__ = previewState;
      },
      args: [serializeConfigForSeed(seedState)],
    });

    // Sets up the rover() queue and calls rover('boot', config) with workerUrl.
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      injectImmediately: true,
      func: () => {
        const bootState = window.__ROVER_PREVIEW_HELPER_STATE__;
        if (!bootState) return;
        const currentHost = String(location.hostname || '').toLowerCase();
        const allowed = Array.isArray(bootState.allowedDomains) ? bootState.allowedDomains : [];
        const explicitHost = String(bootState.targetHost || '').toLowerCase();
        if (explicitHost && explicitHost !== currentHost) {
          return;
        }

        const launchUrl = String(bootState.launchUrl || '').trim();
        if (launchUrl) {
          try {
            const next = new URL(launchUrl, location.href);
            if (next.origin === location.origin) {
              history.replaceState(history.state, '', next.toString());
            }
          } catch {
            // Ignore URL normalization failures and keep current location.
          }
        } else if (bootState.requestId && bootState.attachToken) {
          const next = new URL(location.href);
          next.searchParams.set('rover_launch', bootState.requestId);
          next.searchParams.set('rover_attach', bootState.attachToken);
          history.replaceState(history.state, '', next.toString());
        }

        const apiBase = String(bootState.apiBase || 'https://agent.rtrvr.ai').trim() || 'https://agent.rtrvr.ai';
        const siteId = String(bootState.siteId || '').trim();
        const publicKey = String(bootState.publicKey || '').trim();
        if (!siteId && !publicKey) return;

        const sessionToken = String(bootState.sessionToken || '').trim();
        const sessionId = String(bootState.sessionId || '').trim();
        const siteKeyId = String(bootState.siteKeyId || '').trim();
        const workerUrl = String(bootState.workerUrl || '').trim();
        const domainScopeMode = bootState.domainScopeMode === 'host_only' ? 'host_only' : 'registrable_domain';
        const sessionScope = bootState.sessionScope === 'shared_site' || bootState.sessionScope === 'tab'
          ? bootState.sessionScope
          : '';
        const allowedDomains = allowed.length ? allowed : [location.hostname];
        
        const normalizeSpotlightColor = (value) => {
          const raw = String(value || '').trim();
          const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
          return match ? `#${match[1].toUpperCase()}` : undefined;
        };

        const rover = window.rover = window.rover || function () {
          (rover.q = rover.q || []).push(arguments);
        };
        rover.l = +new Date();

        const bootConfig = {
          siteId,
          apiBase,
          allowedDomains,
          domainScopeMode,
          openOnInit: bootState.openOnInit !== false,
          ui: { muted: true },
        };
        
        if (typeof bootState.cloudSandboxEnabled === 'boolean') {
          bootConfig.cloudSandboxEnabled = bootState.cloudSandboxEnabled;
        }
        if (bootState.pageConfig && typeof bootState.pageConfig === 'object' && typeof bootState.pageConfig.disableAutoScroll === 'boolean') {
          bootConfig.pageConfig = { disableAutoScroll: bootState.pageConfig.disableAutoScroll };
        }
        if (bootState.ui && typeof bootState.ui === 'object') {
          const voice = bootState.ui.voice;
          if (voice && typeof voice === 'object') {
            const nextVoice = {};
            if (typeof voice.enabled === 'boolean') nextVoice.enabled = voice.enabled;
            const language = String(voice.language || '').trim();
            if (language) nextVoice.language = language;
            const autoStopMs = Number(voice.autoStopMs);
            if (Number.isFinite(autoStopMs)) nextVoice.autoStopMs = autoStopMs;
            if (Object.keys(nextVoice).length > 0) bootConfig.ui.voice = nextVoice;
          }
          const actionSpotlight = bootState.ui.experience?.motion?.actionSpotlight;
          const actionSpotlightColor = normalizeSpotlightColor(bootState.ui.experience?.motion?.actionSpotlightColor) || '#FF4C00';
          bootConfig.ui.experience = {
            motion: {
              actionSpotlight: actionSpotlight !== false,
              actionSpotlightColor,
            },
          };
        } else {
          bootConfig.ui.experience = { motion: { actionSpotlight: true, actionSpotlightColor: '#FF4C00' } };
        }
        
        if (publicKey) bootConfig.publicKey = publicKey;
        if (sessionToken) bootConfig.sessionToken = sessionToken;
        if (sessionId) bootConfig.sessionId = sessionId;
        if (siteKeyId) bootConfig.siteKeyId = siteKeyId;
        if (workerUrl) bootConfig.workerUrl = workerUrl;
        if (sessionScope) bootConfig.sessionScope = sessionScope;
        if (bootState.mode) bootConfig.mode = bootState.mode;
        if (typeof bootState.allowActions === 'boolean') bootConfig.allowActions = bootState.allowActions;

        rover('boot', bootConfig);
      },
    });

    // Inject the packaged Rover runtime directly. Scripts injected via
    // executeScript bypass the page's CSP, so this works on hardened sites where
    // a remote <script src="https://rover.rtrvr.ai/embed.js"> tag is blocked.
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      injectImmediately: true,
      files: ['vendor/rover-embed.js'],
    });

    return true;
  } finally {
    pendingInjects.delete(tabId);
  }
}

// Inject Rover into a tab, first ensuring the page CSP won't block its egress.
// The CSP relaxation only takes effect on the next document load, so the first
// time we enable it for a tab we reload and let the readiness/navigation hooks
// re-run injection on the clean page. Subsequent calls inject directly.
async function applyStateToTab(tabId, state) {
  if (!state) return false;
  try {
    const newlyEnabled = await enableCspBypass(tabId);
    if (newlyEnabled) {
      await writeStatus(tabId, `Reloading ${state.targetHost || 'tab'} to clear its CSP, then injecting Rover…`);
      await chrome.tabs.reload(tabId);
      return false;
    }
    return await injectMainWorldState(tabId, state);
  } catch (error) {
    console.error(`Failed to apply state to tab ${tabId}:`, error);
    void logDiagnostic('error', 'apply-state', error);
    return false;
  }
}

async function injectFromTab(tabId, config) {
  const tab = await chrome.tabs.get(tabId);
  const currentUrl = String(tab.url || '');
  const currentHost = normalizeHost(currentUrl);
  const targetHost = buildTargetHost(currentUrl, config);
  const shouldLockTargetHost = shouldLockStateToTargetHost(config);

  if (!targetHost) {
    throw new Error('Target host is required to inject Rover.');
  }
  if (shouldLockTargetHost && currentHost && targetHost && currentHost !== targetHost) {
    throw new Error(`Tab host mismatch. Expected ${targetHost}, got ${currentHost}.`);
  }
  const normalized = normalizeConfig({
    ...config,
    targetHost: shouldLockTargetHost ? targetHost : '',
  });
  if (!normalized.siteId || (!normalized.publicKey && !normalized.sessionToken)) {
    throw new Error('siteId and either publicKey or sessionToken are required.');
  }
  if (!isHostAllowed(targetHost, normalized.allowedDomains, normalized.domainScopeMode)) {
    throw new Error(`This tab host (${targetHost}) is outside allowedDomains. Update your Workspace config or open a matching host.`);
  }
  const launchUrl = normalized.launchUrl || '';
  const state = {
    ...normalized,
    targetHost: shouldLockTargetHost ? targetHost : '',
    launchUrl,
    bootstrapId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };

  await writeState(tabId, state);
  await persistConfig(state);
  const injected = await applyStateToTab(tabId, state);
  if (injected) {
    await writeStatus(tabId, `Rover injected for ${targetHost}.`);
  }

  return state;
}

async function reconnectTab(tabId) {
  const state = await readState(tabId);
  if (!state) throw new Error('No saved preview state for this tab.');
  let refreshed = state;
  try {
    refreshed = await refreshStateFromBackend(tabId, state, state.targetUrl || '', { force: true }) || state;
  } catch (e) {
    void logDiagnostic('warn', 'reconnect-refresh', e);
    refreshed = state;
  }
  return await applyStateToTab(tabId, refreshed);
}

function getTabIdFromSender(sender) {
  return Number.isFinite(sender?.tab?.id) ? sender.tab.id : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ROVER_PREVIEW_HELPER_PAGE_READY') {
    const tabId = getTabIdFromSender(sender);
    if (tabId === null) return;
    void (async () => {
      const pageUrl = String(message.url || sender?.tab?.url || '');
      if (pageUrl) {
        try {
          const hydrated = await maybeHydratePreviewFromUrl(tabId, pageUrl);
          if (hydrated) return;
        } catch (e) {
          // Fall through to stored-state reconnect.
          void logDiagnostic('warn', 'page-ready-hydrate', e);
        }
        try {
          const hydrated = await maybeHydrateGenericConfigFromUrl(tabId, pageUrl);
          if (hydrated) return;
        } catch (error) {
          await sanitizeTabUrl(tabId, pageUrl).catch(() => {});
          await writeStatus(tabId, String(error?.message || error || 'Invalid Rover helper handoff.'));
        }
      }
      const state = await readState(tabId);
      if (!state) return;
      if (pageUrl && !canReinjectStateOnUrl(state, pageUrl)) return;
      try {
        const refreshed = await refreshStateFromBackend(tabId, state, pageUrl).catch(() => state);
        const injected = await applyStateToTab(tabId, refreshed || state);
        if (injected) {
          await writeStatus(tabId, `Rover reconnected for ${buildTargetHost(pageUrl, refreshed || state) || 'this tab'}.`);
        }
      } catch (e) {
        // Ignore readiness races; tab navigation hooks will retry.
        void logDiagnostic('info', 'page-ready-race', e);
      }
    })();
    return;
  }

  if (message.type === 'ROVER_PREVIEW_HELPER_GET_PERSISTED_CONFIG') {
    void (async () => {
      const config = await getPersistedConfig();
      try { sendResponse({ ok: true, config }); } catch { /* port closed */ }
    })().catch(error => {
      try { sendResponse({ ok: false, error: String(error?.message || error) }); } catch { /* port closed */ }
    });
    return true;
  }

  if (message.type === 'ROVER_PREVIEW_HELPER_SET_CONFIG' || message.type === 'ROVER_PREVIEW_HELPER_INJECT') {
    const tabId = Number(message.tabId);
    const config = normalizeConfig(message.config || {});
    void (async () => {
      const state = await injectFromTab(tabId, config);
      try { sendResponse({ ok: true, state }); } catch { /* port closed */ }
    })().catch(error => {
      try { sendResponse({ ok: false, error: String(error?.message || error) }); } catch { /* port closed */ }
    });
    return true;
  }

  if (message.type === 'ROVER_PREVIEW_HELPER_RECONNECT') {
    const tabId = Number(message.tabId);
    void (async () => {
      await reconnectTab(tabId);
      try { sendResponse({ ok: true }); } catch { /* port closed */ }
    })().catch(error => {
      try { sendResponse({ ok: false, error: String(error?.message || error) }); } catch { /* port closed */ }
    });
    return true;
  }

  // ── Form Recorder Messages ──────────────────────────────────────────────

  if (message.type === 'FORM_RECORDER_START') {
    const tabId = Number(message.tabId);
    void (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          world: 'ISOLATED',
          files: ['src/form-recorder/recorder-bundle.js'],
        });
        const result = await chrome.tabs.sendMessage(tabId, { type: 'FORM_RECORDER_START' });
        try { sendResponse({ ok: true, ...result }); } catch { /* port closed */ }
      } catch (err) {
        try { sendResponse({ ok: false, error: err.message }); } catch { /* port closed */ }
      }
    })();
    return true;
  }

  if (message.type === 'FORM_RECORDER_STOP') {
    const tabId = Number(message.tabId);
    void (async () => {
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'FORM_RECORDER_STOP' });
        // Auto-save the form map
        if (result?.ok && result.fields) {
          const tab = await chrome.tabs.get(tabId).catch(() => null);
          const formMap = {
            name: tab?.title || 'Recorded Form',
            startUrl: result.startUrl || tab?.url || '',
            recordedAt: Date.now(),
            totalPages: result.totalPages || 1,
            fields: result.fields,
            navActions: result.navActions || [],
          };
          const id = await saveFormMap(formMap);
          formMap.id = id;
          try { sendResponse({ ok: true, formMap }); } catch { /* port closed */ }
        } else {
          try { sendResponse(result || { ok: false }); } catch { /* port closed */ }
        }
      } catch (err) {
        try { sendResponse({ ok: false, error: err.message }); } catch { /* port closed */ }
      }
    })();
    return true;
  }

  if (message.type === 'FORM_RECORDER_STATUS') {
    const tabId = Number(message.tabId);
    void (async () => {
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'FORM_RECORDER_STATUS' });
        try { sendResponse(result || {}); } catch { /* port closed */ }
      } catch {
        try { sendResponse({ recording: false }); } catch { /* port closed */ }
      }
    })();
    return true;
  }

  if (message.type === 'FORM_RECORDER_LIST_MAPS') {
    void (async () => {
      const maps = await listFormMaps();
      try { sendResponse({ ok: true, maps }); } catch { /* port closed */ }
    })();
    return true;
  }

  if (message.type === 'FORM_REPLAY_START') {
    const tabId = Number(message.tabId);
    void (async () => {
      try {
        const formMap = await getFormMap(message.formMapId);
        if (!formMap) {
          try { sendResponse({ ok: false, error: 'Form map not found' }); } catch { /* port closed */ }
          return;
        }
        try { sendResponse({ ok: true, status: 'started' }); } catch { /* port closed */ }
        // Run replay in the background (don't await — it's long-running)
        startReplay(tabId, formMap, message.parsedCSV).catch(err => {
          void logDiagnostic('error', 'replay', err);
        });
      } catch (err) {
        try { sendResponse({ ok: false, error: err.message }); } catch { /* port closed */ }
      }
    })();
    return true;
  }

  if (message.type === 'FORM_REPLAY_PAUSE') {
    void pauseReplay();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'FORM_REPLAY_RESUME') {
    void resumeReplay();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'FORM_REPLAY_CANCEL') {
    void cancelReplay();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'FORM_REPLAY_STATUS') {
    void (async () => {
      const state = await getReplayState();
      try { sendResponse(state || { status: 'idle' }); } catch { /* port closed */ }
    })();
    return true;
  }

  if (message.type === 'FORM_RECORDER_PDF_EXTRACT') {
    void (async () => {
      try {
        const pdfBuffer = Uint8Array.from(atob(message.pdfBase64), c => c.charCodeAt(0)).buffer;
        const result = await extractFromPDF(pdfBuffer, message.csvColumns);
        try { sendResponse({ ok: true, ...result }); } catch { /* port closed */ }
      } catch (err) {
        try { sendResponse({ ok: false, error: err.message }); } catch { /* port closed */ }
      }
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  void clearState(tabId);
  void disableCspBypass(tabId);
});

async function handleNavigation(tabId, url) {
  try {
    const hydrated = await maybeHydratePreviewFromUrl(tabId, url);
    if (hydrated) return;
  } catch (e) {
    console.warn('maybeHydratePreviewFromUrl failed:', e);
    void logDiagnostic('warn', 'hydrate-preview', e);
  }
  // Defensive: always read from storage (in-memory Map may be empty after SW restart).
  const state = await readState(tabId);
  if (!state) return;
  if (!canReinjectStateOnUrl(state, url)) return;
  const refreshed = await refreshStateFromBackend(tabId, state, url).catch((e) => {
    void logDiagnostic('warn', 'nav-refresh', e);
    return state;
  });
  await applyStateToTab(tabId, refreshed || state);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = String(changeInfo.url || tab.url || '');
  if (!url) return;
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
    void handleNavigation(tabId, url);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId !== 0) return;
  void handleNavigation(details.tabId, details.url || '');
});

chrome.webNavigation.onCompleted.addListener(details => {
  if (details.frameId !== 0) return;
  void handleNavigation(details.tabId, details.url || '');
});

// ── Improvement #3: Proactive token refresh via chrome.alarms ─────────────
// Tokens only refresh on navigation events. If a user stays on one page for
// minutes, the session token can expire silently. This alarm proactively
// checks all active tab states and refreshes any expiring tokens.
const TOKEN_REFRESH_ALARM = 'rover-token-refresh';

if (typeof chrome !== 'undefined' && chrome.alarms) {
  try {
    chrome.alarms.create(TOKEN_REFRESH_ALARM, { periodInMinutes: 1 });
  } catch {
    // alarms.create may fail in constrained environments
  }

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== TOKEN_REFRESH_ALARM) return;
    try {
      const allKeys = await chrome.storage.session.get(null);
      for (const [key, state] of Object.entries(allKeys)) {
        if (!key.startsWith(STORAGE_KEY_PREFIX)) continue;
        if (!state || typeof state !== 'object') continue;
        if (!shouldRefreshState(state)) continue;
        const tabId = Number(key.replace(STORAGE_KEY_PREFIX, ''));
        if (!Number.isFinite(tabId)) continue;
        try {
          await refreshStateFromBackend(tabId, state, state.targetUrl || '');
        } catch (e) {
          void logDiagnostic('warn', 'alarm-refresh', e);
        }
      }
    } catch (e) {
      void logDiagnostic('error', 'alarm-handler', e);
    }
  });
}
