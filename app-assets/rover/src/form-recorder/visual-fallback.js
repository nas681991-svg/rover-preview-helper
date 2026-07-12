/**
 * Visual Fallback (Stage 8)
 * Handles impenetrable DOM elements (Canvas, WebGL) by taking screenshots
 * and sending them to Rover's Vision API to get bounding boxes.
 */

import { acquire, send, release } from './debugger-coordinator.js';

/**
 * Capture a screenshot of the current tab and send to Vision API.
 * Returns the detected bounding box of the input field.
 * @param {number} tabId
 * @param {string} fieldLabel
 * @param {Object} roverConfig
 * @returns {Promise<{x: number, y: number, width: number, height: number} | null>}
 */
export async function locateFieldVisually(tabId, fieldLabel, roverConfig) {
  // 1. Fetch the tab to get its windowId, then capture that specific window
  const tab = await new Promise(resolve => chrome.tabs.get(tabId, resolve));
  if (!tab || chrome.runtime.lastError) return null;

  const dataUrl = await new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 }, (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(data);
      }
    });
  });

  if (!dataUrl) return null;

  // 2. Prepare the payload for Rover Vision API
  const apiBase = roverConfig?.apiBase || 'https://agent.rtrvr.ai';
  const sessionToken = roverConfig?.sessionToken;

  if (!sessionToken) {
    throw new Error('No session token available for Rover Vision API');
  }

  // 3. Call Rover Vision API to find the field bounding box
  try {
    const response = await fetch(`${apiBase}/v2/vision/locate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        image: dataUrl,
        target: fieldLabel,
        task: 'find_input_field'
      })
    });

    if (!response.ok) {
      console.warn('Vision API failed to locate field:', await response.text());
      return null;
    }

    let json = null;
    try {
      json = await response.json();
    } catch {
      console.warn('Vision API response was not valid JSON');
      return null;
    }

    if (json && json.boundingBox) {
      // Expecting { x, y, width, height }
      return json.boundingBox;
    }

    return null;
  } catch (err) {
    console.error('Error calling Vision API:', err);
    return null;
  }
}

/**
 * Simulate a click via Chrome DevTools Protocol at the given coordinates.
 * @param {number} tabId
 * @param {number} x
 * @param {number} y
 */
export async function dispatchCdpClick(tabId, x, y) {
  let lease;
  try {
    lease = await acquire(tabId, 'visual-fallback');

    // Send Mouse Pressed
    await send(lease, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      x: x,
      y: y
    });

    // Send Mouse Released
    await send(lease, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      x: x,
      y: y
    });
  } finally {
    if (lease) {
      await release(lease).catch(() => {});
    }
  }
}
