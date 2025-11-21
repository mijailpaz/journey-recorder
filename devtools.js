chrome.devtools.panels.create('Flow Recorder', '', 'panel.html');

function getRuntimeApi() {
  return (typeof chrome !== 'undefined' && (chrome.runtime || chrome.extension)) || null;
}

function isIgnorableRuntimeError(error) {
  if (!error) return false;
  const message = String(error?.message || error);
  return message.includes('Extension context invalidated');
}

function sendRuntimeMessage(message, { expectResponse = false, onResponse } = {}) {
  const runtimeApi = getRuntimeApi();
  if (!runtimeApi || typeof runtimeApi.sendMessage !== 'function') {
    console.warn('Runtime messaging API unavailable in DevTools context.', message);
    if (typeof onResponse === 'function') onResponse(new Error('extension-unavailable'));
    return;
  }

  const invokeSend = () => {
    if (expectResponse || typeof onResponse === 'function') {
      runtimeApi.sendMessage(message, (...args) => {
        const err = chrome && chrome.runtime && chrome.runtime.lastError;
        onResponse?.(err || null, ...args);
      });
    } else {
      runtimeApi.sendMessage(message);
    }
  };

  try {
    invokeSend();
  } catch (error) {
    if (!isIgnorableRuntimeError(error)) {
      console.warn('Failed to send runtime message', error);
    }
    onResponse?.(error);
  }
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

chrome.devtools.network.onRequestFinished.addListener((request) => {
  try {
    const req = request.request;
    const res = request.response;
    const urlInfo = parseUrl(req.url);
    const event = {
      kind: 'request',
      method: req.method,
      url: req.url,
      host: urlInfo.host,
      path: urlInfo.path,
      qs: urlInfo.qs,
      status: res.status,
      statusText: res.statusText,
      ts: new Date(request.startedDateTime).getTime()
    };

    sendRuntimeMessage({ type: 'addEvent', event });
  } catch (error) {
    if (!isIgnorableRuntimeError(error)) {
      console.warn('Failed to log network request', error);
    }
  }
});
