(() => {
  const availabilityMessage = {
    type: 'ROVER_PREVIEW_HELPER_AVAILABLE',
    source: 'rover-preview-helper',
  };

  const announceAvailability = () => {
    try {
      const targetOrigin = window.location.origin !== 'null' ? window.location.origin : '*';
      window.postMessage(availabilityMessage, targetOrigin);
    } catch {
      // Ignore page messaging failures on locked-down pages.
    }
  };

  const payload = {
    type: 'ROVER_PREVIEW_HELPER_PAGE_READY',
    url: location.href,
    host: location.hostname,
  };

  announceAvailability();

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type !== 'ROVER_PREVIEW_HELPER_PING') return;
    announceAvailability();
  });

  const sendReady = (attempts = 0) => {
    try {
      chrome.runtime.sendMessage(payload).catch(() => {});
    } catch {
      if (attempts < 3) {
        setTimeout(() => sendReady(attempts + 1), 500);
      }
    }
  };
  
  sendReady();
})();
