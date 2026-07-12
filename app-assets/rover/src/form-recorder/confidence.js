/**
 * Confidence & Human-in-the-Loop System (Stage 9)
 * Tracks the confidence of the bulk replay engine. Pauses for human
 * intervention if confidence drops too low or if CAPTCHAs are detected.
 */

const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.9,
  MEDIUM: 0.8,
  LOW: 0.7
};

/**
 * Checks for common CAPTCHA elements on the page.
 */
export function detectCaptcha() {
  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '#captcha',
    '.g-recaptcha',
    '#px-captcha', // PerimeterX
    'iframe[src*="arkoselabs"]'
  ];

  for (const selector of captchaSelectors) {
    if (document.querySelector(selector)) {
      return true;
    }
  }
  return false;
}

let interventionOverlay = null;

/**
 * Creates and shows a UI overlay on the page to ask the human for help.
 * 
 * @param {string} message - The reason for the intervention.
 * @param {HTMLElement} [targetField] - The field causing issues (will be highlighted).
 * @returns {Promise<void>} - Resolves when the user clicks 'Resume'.
 */
export function requestHumanIntervention(message, targetField = null) {
  return new Promise((resolve) => {
    // Attempt to bring tab to foreground via background worker
    try {
      chrome.runtime.sendMessage({ type: 'REQUEST_ATTENTION' }).catch(() => {});
    } catch (e) {
      // Ignore if chrome.runtime is unavailable
    }

    if (targetField && targetField.style) {
      try {
        targetField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        // scrollIntoView might not exist on all SVG/custom nodes
      }
      targetField.style.outline = '4px solid #ff4c00';
      targetField.style.outlineOffset = '2px';
      targetField.style.boxShadow = '0 0 15px rgba(255, 76, 0, 0.5)';
      
      // Pulse animation
      if (targetField.animate) {
      targetField.animate([
        { outlineColor: '#ff4c00', boxShadow: '0 0 15px rgba(255, 76, 0, 0.5)' },
        { outlineColor: 'transparent', boxShadow: '0 0 0px transparent' },
        { outlineColor: '#ff4c00', boxShadow: '0 0 15px rgba(255, 76, 0, 0.5)' }
      ], {
        duration: 1500,
        iterations: Infinity
      });
      }
    }

    // Build the overlay
    interventionOverlay = document.createElement('div');
    interventionOverlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: #1e1e1e;
      color: #fff;
      padding: 20px 24px;
      border-radius: 8px;
      border: 1px solid #333;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      backdrop-filter: blur(8px);
    `;

    const title = document.createElement('h3');
    title.textContent = '⏸️ Human Intervention Required';
    title.style.cssText = 'margin: 0; font-size: 16px; color: #ffaa00; font-weight: 600;';

    const desc = document.createElement('p');
    desc.textContent = message;
    desc.style.cssText = 'margin: 0; font-size: 14px; line-height: 1.4; color: #e0e0e0;';

    const resumeBtn = document.createElement('button');
    resumeBtn.textContent = 'I fixed it — Resume Replay';
    resumeBtn.style.cssText = `
      margin-top: 8px;
      background: #ff4c00;
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    `;
    resumeBtn.onmouseover = () => resumeBtn.style.background = '#e64400';
    resumeBtn.onmouseout = () => resumeBtn.style.background = '#ff4c00';

    resumeBtn.onclick = () => {
      // Cleanup
      if (targetField && targetField.style) {
        targetField.style.outline = '';
        targetField.style.outlineOffset = '';
        targetField.style.boxShadow = '';
        targetField.getAnimations?.().forEach(a => a.cancel());
      }
      interventionOverlay.remove();
      interventionOverlay = null;
      resolve();
    };

    interventionOverlay.appendChild(title);
    interventionOverlay.appendChild(desc);
    interventionOverlay.appendChild(resumeBtn);
    document.body.appendChild(interventionOverlay);
  });
}
