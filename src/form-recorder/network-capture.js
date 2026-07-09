/**
 * Network Capture (Stage 7a)
 * Attaches chrome.debugger to sniff API requests during form submission.
 */

const activeSessions = new Map();

/**
 * Attaches the debugger and starts listening to network traffic.
 */
export async function startNetworkCapture(tabId) {
  if (activeSessions.has(tabId)) {
    await stopNetworkCapture(tabId);
  }

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Network.enable');
  } catch (err) {
    if (err.message.includes('Cannot attach to this target')) {
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
        requests.set(params.requestId, {
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          postData: params.request.postData,
          hasPostData: params.request.hasPostData,
          contentType: params.request.headers['Content-Type'] || params.request.headers['content-type'],
        });
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
        chrome.debugger.sendCommand(target, 'Network.getResponseBody', { requestId: params.requestId })
          .then(res => {
            req.responseBody = res.body;
            capturedRequests.push(req);
          })
          .catch(() => { /* Body not available */ });
      }
    }
  };

  chrome.debugger.onEvent.addListener(onEvent);

  activeSessions.set(tabId, { target, onEvent, capturedRequests });
  return true;
}

/**
 * Detaches the debugger and returns all captured POST/PUT API calls.
 */
export async function stopNetworkCapture(tabId) {
  const session = activeSessions.get(tabId);
  if (!session) return [];

  chrome.debugger.onEvent.removeListener(session.onEvent);
  
  try {
    await chrome.debugger.detach(session.target);
  } catch {
    // Ignore detach errors if the tab was closed
  }
  
  activeSessions.delete(tabId);
  return session.capturedRequests;
}
