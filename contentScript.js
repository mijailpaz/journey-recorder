const POINTER_STYLE_ID = '__journey_recorder_pointer_style';
const POINTER_EL_ID = '__journey_recorder_pointer';
const RIPPLE_CLASS = '__journey_recorder_click_ripple';
const NAV_ID = '__journey_recorder_nav';
const NAV_BTN_ID = '__journey_recorder_nav_btn';
const NAV_CLOSE_ID = '__journey_recorder_nav_close';
const NAV_SESSION_KEY = '__journey_recorder_nav_hidden';

let pointerEnabled = false;
let pointerEl = null;
let pointerRaf = null;
const pointerPosition = { x: 0, y: 0 };
let navEl = null;

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

    #${NAV_ID} {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483646;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      gap: 16px;
      background: linear-gradient(120deg, rgba(30, 64, 175, 0.92), rgba(14, 165, 233, 0.92));
      color: #f8fafc;
      padding: 12px 20px 12px 16px;
      border-radius: 999px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.35);
      pointer-events: auto;
      backdrop-filter: blur(8px);
    }

    #${NAV_ID}.hidden {
      display: none;
    }

    #${NAV_ID} button {
      border: none;
      border-radius: 999px;
      padding: 7px 18px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }

    #${NAV_BTN_ID} {
      background: #fef9c3;
      color: #92400e;
      box-shadow: 0 5px 20px rgba(15, 23, 42, 0.35);
    }

    #${NAV_BTN_ID}:active {
      transform: scale(0.98);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.2);
    }

    #${NAV_CLOSE_ID} {
      background: transparent;
      color: #e2e8f0;
      font-size: 1rem;
      padding: 4px 8px;
      line-height: 1;
    }

    #${NAV_CLOSE_ID}:hover {
      color: #fff;
    }

    #${NAV_ID} span {
      font-size: 0.85rem;
      opacity: 0.95;
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
  ensureNavBar(host);
  showNavBar();
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
  hideNavBar();
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

function ensureNavBar(host) {
  if (navEl && navEl.isConnected) return;
  navEl = document.getElementById(NAV_ID);
  if (!navEl) {
    navEl = document.createElement('div');
    navEl.id = NAV_ID;
    navEl.innerHTML = `
      <button id="${NAV_BTN_ID}" type="button">Page load</button>
      <span>Start the journey from the initial load to capture all requests.</span>
      <button id="${NAV_CLOSE_ID}" type="button" aria-label="Dismiss overlay">×</button>
    `;
  }
  navEl.classList.add('hidden');
  host?.appendChild(navEl);
  attachNavHandlers();
}

function attachNavHandlers() {
  if (!navEl) return;
  const btn = navEl.querySelector(`#${NAV_BTN_ID}`);
  const closeBtn = navEl.querySelector(`#${NAV_CLOSE_ID}`);
  if (btn && !btn.dataset.bound) {
    btn.addEventListener('click', handlePageLoadButtonClick);
    btn.dataset.bound = 'true';
  }
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.addEventListener('click', handleNavDismiss);
    closeBtn.dataset.bound = 'true';
  }
}

function showNavBar() {
  if (sessionStorage.getItem(NAV_SESSION_KEY) === 'hidden') {
    navEl?.classList.add('hidden');
    return;
  }
  navEl?.classList.remove('hidden');
}

function hideNavBar() {
  navEl?.classList.add('hidden');
}

function handleNavDismiss(event) {
  event?.stopPropagation();
  sessionStorage.setItem(NAV_SESSION_KEY, 'hidden');
  hideNavBar();
}

function handlePageLoadButtonClick(event) {
  event.stopPropagation();
  event.preventDefault();
  sessionStorage.setItem(NAV_SESSION_KEY, 'hidden');
  hideNavBar();
  try {
    const locationInfo = parseUrl(window.location.href);
    chrome.runtime?.sendMessage({
      type: 'addEvent',
      event: {
        kind: 'click',
        selector: `#${NAV_BTN_ID}`,
        text: 'Page load',
        host: locationInfo.host,
        path: locationInfo.path,
        qs: locationInfo.qs,
        ts: Date.now()
      }
    });
  } catch (_) {
    // swallow errors
  } finally {
    window.location.reload();
  }
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
    if (navEl && navEl.contains(event.target)) {
      return;
    }
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
