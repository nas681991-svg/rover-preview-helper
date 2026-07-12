/**
 * Network Capture (Stage 7a)
 * Attaches chrome.debugger to sniff API requests during form submission.
 */

import { acquire, send, release, addEventListener, removeEventListener } from './debugger-coordinator.js';

const activeSessions = new Map();

/**
 * Attaches the debugger and starts listening to network traffic.
 */
export async function startNetworkCapture(tabId) {
  if (activeSessions.has(tabId)) {
    await stopNetworkCapture(tabId);
  }

  let lease;
  try {
    lease = await acquire(tabId, 'network-capture');
    try {
      await send(lease, 'Network.enable');
    } catch (sendErr) {
      // Re-throw to be caught by the outer catch, after releasing the lease
      await release(lease);
      throw sendErr;
    }
  } catch (err) {
    if (err.message && err.message.includes('Cannot attach to this target')) {
      console.warn('Network capture skipped: Tab already being debugged or restricted URL.');
      return false;
    }
    throw err;
  }

  const requests = new Map();
  const capturedRequests = [];

  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;

    if (method === 'Network.requestWillBeSent') {
      // Only capture XHR/Fetch POST/PUT requests
      if (['XHR', 'Fetch'].includes(params.type) && ['POST', 'PUT', 'PATCH'].includes(params.request.method)) {
        const req = {
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          postData: params.request.postData,
          hasPostData: params.request.hasPostData,
          contentType: params.request.headers['Content-Type'] || params.request.headers['content-type'],
        };
        requests.set(params.requestId, req);
        capturedRequests.push(req);
      }
    } else if (method === 'Network.responseReceived') {
      const req = requests.get(params.requestId);
      if (req) {
        req.responseStatus = params.response.status;
        req.responseMimeType = params.response.mimeType;
      }
    } else if (method === 'Network.loadingFinished') {
      const req = requests.get(params.requestId);
      if (req) {
        // Fetch response body asynchronously
        send(lease, 'Network.getResponseBody', { requestId: params.requestId })
          .then(res => {
            req.responseBody = res.body;
          })
          .catch(() => { /* Body not available */ });
      }
    }
  };

  addEventListener('network-capture', onEvent);

  activeSessions.set(tabId, { lease, onEvent, capturedRequests });
  return true;
}

/**
 * Detaches the debugger and returns all captured POST/PUT API calls.
 */
export async function stopNetworkCapture(tabId) {
  const session = activeSessions.get(tabId);
  if (!session) return [];

  removeEventListener('network-capture', session.onEvent);
  
  try {
    await release(session.lease);
  } catch {
    // Ignore release errors if the tab was closed
  }
  
  activeSessions.delete(tabId);
  return session.capturedRequests;
}
