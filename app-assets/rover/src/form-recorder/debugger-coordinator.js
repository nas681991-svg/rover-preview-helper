/**
 * Debugger Coordinator (T1)
 * Single-owner chrome.debugger coordinator with lease-based access control.
 * 
 * Ensures exactly one attach per tab, with detach only after the last lease releases.
 * Provides MV3 SW restart-safety by clearing state on external detach/tab close.
 */

// State: tabId -> { refCount: number, attached: boolean, leases: Map<leaseId, owner> }
const sessions = new Map();

// Event listeners: owner -> Set<function>
const listeners = new Map();

// In-flight attach promises: tabId -> Promise<null>
// Serializes concurrent first-time attach attempts per tab
const inFlightAttaches = new Map();

// Generate unique lease IDs
let leaseCounter = 0;

function generateLeaseId() {
  return `lease_${++leaseCounter}_${Date.now()}`;
}

/**
 * Initialize event listeners (called when chrome is available)
 */
function initializeListeners() {
  if (typeof chrome !== 'undefined' && chrome.debugger && chrome.tabs) {
    /**
     * Fan out debugger events to owners holding a lease on the emitting tab
     */
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (!source.tabId) return;
      const session = sessions.get(source.tabId);
      if (!session || !session.attached) return;

      // Find all unique owners that currently hold a lease on this tab
      const activeOwners = new Set(session.leases.values());
      
      for (const owner of activeOwners) {
        const ownerListeners = listeners.get(owner);
        if (ownerListeners) {
          for (const fn of ownerListeners) {
            try {
              fn(source, method, params);
            } catch (err) {
              console.error(`Error in debugger event listener for ${owner}:`, err);
            }
          }
        }
      }
    });

    /**
     * Clean up on external detach (MV3 SW restart-safety)
     */
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId) {
        const session = sessions.get(source.tabId);
        if (session) {
          session.attached = false;
          session.leases.clear();
          session.refCount = 0;
        }
      }
    });

    /**
     * Clean up on tab close
     */
    chrome.tabs.onRemoved.addListener((tabId) => {
      sessions.delete(tabId);
    });
  }
}

// Initialize listeners if chrome is available at module load time
if (typeof chrome !== 'undefined') {
  initializeListeners();
}

export { initializeListeners };

// Test hooks - allow overriding for testing
let _acquireOverride = null;
let _sendOverride = null;
let _releaseOverride = null;
let _isValidOverride = null;
let _addEventListenerOverride = null;
let _removeEventListenerOverride = null;

export function setTestOverrides(overrides) {
  if (overrides.acquire) _acquireOverride = overrides.acquire;
  if (overrides.send) _sendOverride = overrides.send;
  if (overrides.release) _releaseOverride = overrides.release;
  if (overrides.isValid) _isValidOverride = overrides.isValid;
  if (overrides.addEventListener) _addEventListenerOverride = overrides.addEventListener;
  if (overrides.removeEventListener) _removeEventListenerOverride = overrides.removeEventListener;
}

export function clearTestOverrides() {
  _acquireOverride = null;
  _sendOverride = null;
  _releaseOverride = null;
  _isValidOverride = null;
  _addEventListenerOverride = null;
  _removeEventListenerOverride = null;
}

// Test-only: reset all coordinator state
export function _resetCoordinatorState() {
  sessions.clear();
  listeners.clear();
  inFlightAttaches.clear();
}

/**
 * Acquire a lease for debugger access on a tab.
 * @param {number} tabId - The tab to attach to
 * @param {string} owner - Identifier for the lease owner (e.g., 'network-capture', 'replay-worker')
 * @returns {Promise<{tabId: number, leaseId: string, owner: string}>} The lease object
 */
export async function acquire(tabId, owner) {
  if (_acquireOverride) return _acquireOverride(tabId, owner);
  
  const leaseId = generateLeaseId();
  
  let session = sessions.get(tabId);
  if (!session) {
    session = { refCount: 0, attached: false, leases: new Map() };
    sessions.set(tabId, session);
  }
  
  // Attach if not already attached
  if (!session.attached) {
    // Check if there's an in-flight attach for this tab
    let inFlightAttach = inFlightAttaches.get(tabId);
    
    if (!inFlightAttach) {
      // We're the first to attempt attach - create the promise
      inFlightAttach = (async () => {
        try {
          await chrome.debugger.attach({ tabId }, '1.3');
          session.attached = true;
        } catch (err) {
          // Only delete session if it's still in the state we created it in
          // (i.e., not yet attached by another concurrent acquire)
          const currentSession = sessions.get(tabId);
          if (currentSession && !currentSession.attached && currentSession.refCount === 0) {
            sessions.delete(tabId);
          }
          throw err;
        } finally {
          // Clear in-flight attach regardless of outcome
          inFlightAttaches.delete(tabId);
        }
      })();
      inFlightAttaches.set(tabId, inFlightAttach);
    }
    
    // Await the in-flight attach (whether we created it or another caller did)
    await inFlightAttach;
  }
  
  session.refCount++;
  session.leases.set(leaseId, owner);
  
  return { tabId, leaseId, owner };
}

/**
 * Send a debugger command using a lease.
 * @param {Object} lease - The lease object from acquire()
 * @param {string} method - The CDP method name
 * @param {Object} params - The CDP parameters
 * @returns {Promise<Object>} The command result
 * @throws {Error} If the lease is invalid or stale
 */
export async function send(lease, method, params) {
  if (_sendOverride) return _sendOverride(lease, method, params);
  
  const session = sessions.get(lease.tabId);
  
  // Validate lease
  if (!session || !session.leases.has(lease.leaseId) || session.leases.get(lease.leaseId) !== lease.owner || !session.attached) {
    throw new Error(`Invalid or stale lease: ${lease.leaseId}`);
  }
  
  return chrome.debugger.sendCommand({ tabId: lease.tabId }, method, params);
}

/**
 * Release a lease, detaching if it was the last one.
 * @param {Object} lease - The lease object from acquire()
 */
export async function release(lease) {
  if (_releaseOverride) return _releaseOverride(lease);
  
  const session = sessions.get(lease.tabId);
  
  // Over-release or wrong-owner release: do nothing, don't detach active session
  if (!session || !session.leases.has(lease.leaseId) || session.leases.get(lease.leaseId) !== lease.owner) {
    return;
  }
  
  session.leases.delete(lease.leaseId);
  session.refCount--;
  
  // Detach only when last lease is released
  if (session.refCount === 0 && session.attached) {
    try {
      await chrome.debugger.detach({ tabId: lease.tabId });
    } catch {
      // Ignore detach errors (tab may have closed)
    }
    session.attached = false;
    sessions.delete(lease.tabId);
  }
}

/**
 * Check if a lease is still valid.
 * @param {Object} lease - The lease object to check
 * @returns {boolean} True if the lease is valid
 */
export function isValid(lease) {
  if (_isValidOverride) return _isValidOverride(lease);
  
  const session = sessions.get(lease.tabId);
  return !!(session && session.leases.has(lease.leaseId) && session.leases.get(lease.leaseId) === lease.owner && session.attached);
}

/**
 * Register a listener for chrome.debugger.onEvent targeting a specific lease owner.
 * @param {string} owner - Identifier for the lease owner (e.g., 'network-capture')
 * @param {Function} fn - The callback function(source, method, params)
 */
export function addEventListener(owner, fn) {
  if (_addEventListenerOverride) return _addEventListenerOverride(owner, fn);
  
  let ownerListeners = listeners.get(owner);
  if (!ownerListeners) {
    ownerListeners = new Set();
    listeners.set(owner, ownerListeners);
  }
  ownerListeners.add(fn);
}

/**
 * Remove a previously registered listener.
 * @param {string} owner - Identifier for the lease owner
 * @param {Function} fn - The callback function to remove
 */
export function removeEventListener(owner, fn) {
  if (_removeEventListenerOverride) return _removeEventListenerOverride(owner, fn);
  
  const ownerListeners = listeners.get(owner);
  if (ownerListeners) {
    ownerListeners.delete(fn);
    if (ownerListeners.size === 0) {
      listeners.delete(owner);
    }
  }
}
