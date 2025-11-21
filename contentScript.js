const POINTER_STYLE_ID = '__journey_recorder_pointer_style';
const POINTER_EL_ID = '__journey_recorder_pointer';
const RIPPLE_CLASS = '__journey_recorder_click_ripple';

let pointerEnabled = false;
let pointerEl = null;
let pointerRaf = null;
const pointerPosition = { x: 0, y: 0 };

function ensurePointerStyle() {
  if (document.getElementById(POINTER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = POINTER_STYLE_ID;
  style.textContent = `
    #${POINTER_EL_ID} {
      position: fixed;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: 2px solid rgba(239, 68, 68, 0.95);
      background: rgba(239, 68, 68, 0.5);
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25);
      pointer-events: none;
      transform: translate(-50%, -50%);
      opacity: 0;
      transition: opacity 120ms ease-out;
      z-index: 2147483647;
    }

    #${POINTER_EL_ID}.visible {
      opacity: 1;
    }

    .${RIPPLE_CLASS} {
      position: fixed;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 2px solid rgba(239, 68, 68, 0.8);
      background: rgba(239, 68, 68, 0.25);
      pointer-events: none;
      transform: translate(-50%, -50%) scale(0.1);
      animation: jr-pointer-ripple 500ms ease-out forwards;
      z-index: 2147483646;
    }

    @keyframes jr-pointer-ripple {
      from {
        opacity: 0.6;
        transform: translate(-50%, -50%) scale(0.1);
      }
      to {
        opacity: 0;
        transform: translate(-50%, -50%) scale(2.4);
      }
    }
  `;
  document.documentElement.appendChild(style);
}

function getOverlayHost() {
  return document.body || document.documentElement;
}

function ensurePointerElement(host) {
  if (!host) return null;
  let el = document.getElementById(POINTER_EL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = POINTER_EL_ID;
  }
  if (!el.isConnected) {
    host.appendChild(el);
  }
  return el;
}

function handlePointerMove(event) {
  if (!pointerEnabled || !pointerEl) return;
  pointerPosition.x = event.clientX;
  pointerPosition.y = event.clientY;
  pointerEl.classList.add('visible');
  schedulePointerRender();
}

function handlePointerLeave() {
  pointerEl?.classList.remove('visible');
}

function schedulePointerRender() {
  if (!pointerEnabled || pointerRaf) return;
  pointerRaf = requestAnimationFrame(renderPointerPosition);
}

function renderPointerPosition() {
  pointerRaf = null;
  if (!pointerEl) return;
  pointerEl.style.left = `${pointerPosition.x}px`;
  pointerEl.style.top = `${pointerPosition.y}px`;
}

function enablePointerOverlay() {
  if (pointerEnabled) return;
  const host = getOverlayHost();
  if (!host) return;
  ensurePointerStyle();
  pointerEl = ensurePointerElement(host);
  pointerEl?.classList.remove('visible');
  pointerEnabled = true;
  document.addEventListener('pointermove', handlePointerMove, true);
  document.addEventListener('pointerleave', handlePointerLeave, true);
  window.addEventListener('blur', handlePointerLeave);
}

function disablePointerOverlay() {
  if (!pointerEnabled) return;
  pointerEnabled = false;
  document.removeEventListener('pointermove', handlePointerMove, true);
  document.removeEventListener('pointerleave', handlePointerLeave, true);
  window.removeEventListener('blur', handlePointerLeave);
  if (pointerEl) {
    pointerEl.remove();
    pointerEl = null;
  }
  if (pointerRaf) {
    cancelAnimationFrame(pointerRaf);
    pointerRaf = null;
  }
}

function createRipple(x, y) {
  const host = getOverlayHost();
  if (!pointerEnabled || !host) return;
  const ripple = document.createElement('span');
  ripple.className = RIPPLE_CLASS;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  host.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

function maybeShowRipple(event) {
  if (!pointerEnabled || event.button !== 0) return;
  createRipple(event.clientX, event.clientY);
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'jrPointerToggle') {
      if (msg.enabled) {
        enablePointerOverlay();
      } else {
        disablePointerOverlay();
      }
    }
  });
}

function getSelector(el) {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
  const classes = el.classList && el.classList.length ? `.${[...el.classList].join('.')}` : '';
  return `${tag}${classes}`;
}

function parseUrl(urlString) {
  try {
    const url = new URL(urlString);
    return {
      host: url.host,
      path: url.pathname,
      qs: url.search || null
    };
  } catch (error) {
    return {
      host: null,
      path: null,
      qs: null
    };
  }
}

function getClickUrlInfo(el) {
  const pageUrl = window.location.href;
  const pageInfo = parseUrl(pageUrl);
  
  // If clicked element is a link, get its href
  let targetUrl = null;
  let targetInfo = null;
  
  if (el.tagName === 'A' && el.href) {
    targetUrl = el.href;
    targetInfo = parseUrl(targetUrl);
  } else {
    // Check if element is inside a link
    const linkParent = el.closest('a');
    if (linkParent && linkParent.href) {
      targetUrl = linkParent.href;
      targetInfo = parseUrl(targetUrl);
    }
  }
  
  return {
    ...pageInfo,
    targetUrl: targetUrl || null,
    targetHost: targetInfo?.host || null,
    targetPath: targetInfo?.path || null,
    targetQs: targetInfo?.qs || null
  };
}

document.addEventListener(
  'click',
  (event) => {
    try {
      const el = event.target;
      const urlInfo = getClickUrlInfo(el);
      chrome.runtime.sendMessage({
        type: 'addEvent',
        event: {
          kind: 'click',
          selector: getSelector(el),
          text: (el.innerText || '').trim().substring(0, 80),
          host: urlInfo.host,
          path: urlInfo.path,
          qs: urlInfo.qs,
          targetUrl: urlInfo.targetUrl,
          targetHost: urlInfo.targetHost,
          targetPath: urlInfo.targetPath,
          targetQs: urlInfo.targetQs,
          ts: Date.now()
        }
      });
      maybeShowRipple(event);
    } catch (error) {
      console.warn('Failed to capture click', error);
    }
  },
  true
);
