/**
 * Trace Engine for High-Fidelity Recording
 * 
 * Captures a dense, millisecond-precision timeline of viewport states, 
 * interactions, and live DOM mutations. Output is strictly optimized 
 * for machine readability (dense arrays).
 */

const TRACE_BUFFER_LIMIT = 50000; // Cap to prevent out-of-memory on extreme pages

// Dense Type Enums
const T_MOUSEMOVE = 0;
const T_CLICK = 1;
const T_SCROLL = 2;
const T_RESIZE = 3;
const T_KEY = 4;
const T_MUTATION = 5;

let isTracing = false;
let traceLog = [];
let observer = null;

let lastMouseX = 0;
let lastMouseY = 0;
let mouseThrottle = null;

function pushTrace(entry) {
  if (!isTracing || traceLog.length >= TRACE_BUFFER_LIMIT) return;
  traceLog.push(entry);
}

function handleMouseMove(e) {
  if (!isTracing) return;
  if (mouseThrottle) return;
  
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  
  mouseThrottle = setTimeout(() => {
    pushTrace([Math.round(performance.now()), T_MOUSEMOVE, lastMouseX, lastMouseY]);
    mouseThrottle = null;
  }, 50); // 20fps for mouse to save space
}

function quickSelector(el) {
  if (!el) return '?';
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  let path = el.tagName.toLowerCase();
  if (el.className && typeof el.className === 'string') {
    path += '.' + el.className.trim().split(/\s+/).join('.');
  }
  return path;
}

function handleClick(e) {
  if (!isTracing) return;
  const el = e.target;
  let rect = { left: 0, top: 0, width: 0, height: 0 };
  let nodeName = '?';
  let selector = '?';
  if (el && el.getBoundingClientRect) {
    rect = el.getBoundingClientRect();
    nodeName = safeNodeName(el);
    selector = quickSelector(el);
  }
  
  // Format: [ts, T_CLICK, clickX, clickY, button, nodeName, selector, elemLeft, elemTop, elemWidth, elemHeight]
  pushTrace([
    Math.round(performance.now()), 
    T_CLICK, 
    e.clientX, 
    e.clientY, 
    e.button,
    nodeName,
    selector,
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height)
  ]);
}

let scrollThrottle = null;
function handleScroll() {
  if (!isTracing) return;
  if (scrollThrottle) return;
  scrollThrottle = setTimeout(() => {
    pushTrace([Math.round(performance.now()), T_SCROLL, window.scrollX, window.scrollY]);
    scrollThrottle = null;
  }, 100);
}

let resizeThrottle = null;
function handleResize() {
  if (!isTracing) return;
  if (resizeThrottle) return;
  resizeThrottle = setTimeout(() => {
    pushTrace([Math.round(performance.now()), T_RESIZE, window.innerWidth, window.innerHeight]);
    resizeThrottle = null;
  }, 500);
}

function handleKeyDown(e) {
  pushTrace([Math.round(performance.now()), T_KEY, e.key]);
}

// Compact string
function safeNodeName(node) {
  return node ? (node.nodeName || 'TEXT').substring(0, 20) : '?';
}

function safeValue(val) {
  if (!val) return '';
  const str = String(val);
  return str.length > 50 ? str.substring(0, 50) + '...' : str;
}

function handleMutations(mutations) {
  if (!isTracing) return;
  const ts = Math.round(performance.now());
  
  for (const m of mutations) {
    let mType = 0; // 0=childList, 1=attributes, 2=characterData
    let val = '';
    
    if (m.type === 'childList') {
      mType = 0;
      val = `+${m.addedNodes.length},-${m.removedNodes.length}`;
    } else if (m.type === 'attributes') {
      mType = 1;
      val = m.attributeName;
    } else if (m.type === 'characterData') {
      mType = 2;
      val = safeValue(m.target.textContent);
    }
    
    pushTrace([
      ts, 
      T_MUTATION, 
      mType, 
      safeNodeName(m.target), 
      val
    ]);
  }
}

export function startTrace() {
  if (isTracing) return;
  isTracing = true;
  traceLog = [];
  
  // Log initial state
  pushTrace([Math.round(performance.now()), T_RESIZE, window.innerWidth, window.innerHeight]);
  pushTrace([Math.round(performance.now()), T_SCROLL, window.scrollX, window.scrollY]);

  // Bind events
  window.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
  window.addEventListener('mousedown', handleClick, { passive: true, capture: true });
  window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
  window.addEventListener('resize', handleResize, { passive: true, capture: true });
  window.addEventListener('keydown', handleKeyDown, { passive: true, capture: true });

  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: false,
    characterDataOldValue: false
  });
}

export function stopTrace() {
  if (!isTracing) return;
  isTracing = false;

  window.removeEventListener('mousemove', handleMouseMove, { capture: true });
  window.removeEventListener('mousedown', handleClick, { capture: true });
  window.removeEventListener('scroll', handleScroll, { capture: true });
  window.removeEventListener('resize', handleResize, { capture: true });
  window.removeEventListener('keydown', handleKeyDown, { capture: true });

  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

export function flushTrace() {
  const currentLog = traceLog;
  // We do not clear traceLog here because we want the whole session traced. 
  // However, we could chunk it if needed. For now, just return it.
  return currentLog;
}
