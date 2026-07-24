/**
 * src/fingerprint-manager.cjs
 * 
 * SOTA Anti-Detect Fingerprint Generator & Noise Shifter.
 * Provides coherent profile generation and CDP init scripts to bypass bot detection
 * and achieve a 0-suspect / 100% trust rating on CreepJS and advanced fingerprint scanners.
 */

const fs = require('fs');
const path = require('path');

const GPU_DRIVERS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11-30.0.15.1215)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11-30.0.15002.1004)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4502)' }
];

const USER_AGENTS = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'Win32',
    brands: [
      { brand: 'Chromium', version: '124' },
      { brand: 'Google Chrome', version: '124' },
      { brand: 'Not-A.Brand', version: '99' }
    ]
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    platform: 'Win32',
    brands: [
      { brand: 'Chromium', version: '125' },
      { brand: 'Google Chrome', version: '125' },
      { brand: 'Not-A.Brand', version: '24' }
    ]
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    brands: [
      { brand: 'Chromium', version: '124' },
      { brand: 'Google Chrome', version: '124' },
      { brand: 'Not-A.Brand', version: '99' }
    ]
  }
];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates a randomized, coherent fingerprint configuration object.
 */
function generateFingerprintSeed() {
  const gpu = getRandomItem(GPU_DRIVERS);
  const uaConfig = getRandomItem(USER_AGENTS);
  const hardwareConcurrency = getRandomItem([8, 12, 16, 24]);
  const deviceMemory = getRandomItem([8, 16, 32]);
  
  // Subtle noise seeds (fractional offsets)
  const canvasNoiseR = (Math.random() * 0.00002) - 0.00001;
  const canvasNoiseG = (Math.random() * 0.00002) - 0.00001;
  const canvasNoiseB = (Math.random() * 0.00002) - 0.00001;
  const audioNoise = (Math.random() * 0.0000001) - 0.00000005;

  return {
    userAgent: uaConfig.ua,
    platform: uaConfig.platform,
    brands: uaConfig.brands,
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    hardwareConcurrency,
    deviceMemory,
    screenWidth: getRandomItem([1920, 2560, 1536, 1440]),
    screenHeight: getRandomItem([1080, 1440, 960, 900]),
    colorDepth: 24,
    canvasNoise: { r: canvasNoiseR, g: canvasNoiseG, b: canvasNoiseB },
    audioNoise,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Builds the JavaScript stealth injection payload for page context initialization.
 */
function buildCDPStealthScript(fp) {
  return `
    (() => {
      try {
        // Native toString emulation map to prevent CreepJS / Proxy Lie Detection
        const nativeFnMap = new WeakMap();
        const origToString = Function.prototype.toString;
        
        function makeNative(fn, name) {
          nativeFnMap.set(fn, \`function \${name || fn.name || ''}() { [native code] }\`);
          return fn;
        }

        Function.prototype.toString = new Proxy(origToString, {
          apply(target, thisArg, args) {
            if (nativeFnMap.has(thisArg)) {
              return nativeFnMap.get(thisArg);
            }
            return Reflect.apply(target, thisArg, args);
          }
        });
        nativeFnMap.set(Function.prototype.toString, 'function toString() { [native code] }');

        // 1. WebGL Fingerprint Spoofing with native toString emulation
        const origGetParameter = WebGLRenderingContext ? WebGLRenderingContext.prototype.getParameter : null;
        if (origGetParameter) {
          const patchedGetParameter = function getParameter(param) {
            // 37445: UNMASKED_VENDOR_WEBGL, 37446: UNMASKED_RENDERER_WEBGL
            if (param === 37445) return ${JSON.stringify(fp.webglVendor)};
            if (param === 37446) return ${JSON.stringify(fp.webglRenderer)};
            return origGetParameter.call(this, param);
          };
          makeNative(patchedGetParameter, 'getParameter');
          WebGLRenderingContext.prototype.getParameter = patchedGetParameter;
          if (typeof WebGL2RenderingContext !== 'undefined') {
            WebGL2RenderingContext.prototype.getParameter = patchedGetParameter;
          }
        }

        // 2. Canvas 2D Noise Shifter with stealth getContext & getImageData
        const noiseR = ${fp.canvasNoise.r};
        const noiseG = ${fp.canvasNoise.g};
        const noiseB = ${fp.canvasNoise.b};

        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        const patchedGetImageData = function getImageData(...args) {
          const imageData = originalGetImageData.apply(this, args);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, data[i] + Math.round(noiseR * 255)));
            data[i+1] = Math.min(255, Math.max(0, data[i+1] + Math.round(noiseG * 255)));
            data[i+2] = Math.min(255, Math.max(0, data[i+2] + Math.round(noiseB * 255)));
          }
          return imageData;
        };
        makeNative(patchedGetImageData, 'getImageData');
        CanvasRenderingContext2D.prototype.getImageData = patchedGetImageData;

        // 3. AudioContext Noise Shifter
        const audioNoise = ${fp.audioNoise};
        if (typeof AudioBuffer !== 'undefined') {
          const originalGetChannelData = AudioBuffer.prototype.getChannelData;
          const patchedGetChannelData = function getChannelData(channel) {
            const channelData = originalGetChannelData.call(this, channel);
            for (let i = 0; i < channelData.length; i += 100) {
              channelData[i] = channelData[i] + audioNoise;
            }
            return channelData;
          };
          makeNative(patchedGetChannelData, 'getChannelData');
          AudioBuffer.prototype.getChannelData = patchedGetChannelData;
        }

        // 4. Permissions Query Hook
        if (navigator.permissions && navigator.permissions.query) {
          const origQuery = navigator.permissions.query;
          const patchedQuery = function query(parameters) {
            if (parameters && parameters.name === 'notifications') {
              return Promise.resolve({ state: Notification.permission, onchange: null });
            }
            return origQuery.call(this, parameters);
          };
          makeNative(patchedQuery, 'query');
          navigator.permissions.query = patchedQuery;
        }

        // 5. Navigator Properties & Hardware Spoofing
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${fp.hardwareConcurrency}, configurable: true });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => ${fp.deviceMemory}, configurable: true });
        Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(fp.platform)}, configurable: true });
        Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });

        if (navigator.userAgentData) {
          Object.defineProperty(navigator.userAgentData, 'brands', {
            get: () => ${JSON.stringify(fp.brands)},
            configurable: true
          });
        }

        // 6. Screen Resolution Spoofing
        Object.defineProperty(screen, 'width', { get: () => ${fp.screenWidth}, configurable: true });
        Object.defineProperty(screen, 'height', { get: () => ${fp.screenHeight}, configurable: true });
        Object.defineProperty(screen, 'availWidth', { get: () => ${fp.screenWidth}, configurable: true });
        Object.defineProperty(screen, 'availHeight', { get: () => ${fp.screenHeight - 40}, configurable: true });
        Object.defineProperty(screen, 'colorDepth', { get: () => ${fp.colorDepth}, configurable: true });

        // 7. Chrome Automation Marker Cleansing
        for (const key of Object.keys(window)) {
          if (key.startsWith('cdc_')) {
            try { delete window[key]; } catch (e) {}
          }
        }
        delete window.__playwright;
        delete window.__pw_manual;
        delete window.__pwInitScripts;

      } catch (err) {
        console.warn('[FingerprintManager] Initialization error:', err);
      }
    })();
  `;
}

/**
 * Applies stealth fingerprinting scripts to a Patchright/Playwright browser context.
 */
async function applyFingerprintToContext(context, fp = generateFingerprintSeed()) {
  const script = buildCDPStealthScript(fp);
  await context.addInitScript(script);
  return fp;
}

module.exports = {
  generateFingerprintSeed,
  buildCDPStealthScript,
  applyFingerprintToContext
};
