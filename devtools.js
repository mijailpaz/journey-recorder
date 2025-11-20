chrome.devtools.panels.create('Flow Recorder', '', 'panel.html');

const runtimeApi = (typeof chrome !== 'undefined' && (chrome.runtime || chrome.extension)) || null;

function sendRuntimeMessage(message, { expectResponse = false, onResponse } = {}) {
  if (!runtimeApi || typeof runtimeApi.sendMessage !== 'function') {
    console.warn('Runtime messaging API unavailable in DevTools context.', message);
    if (typeof onResponse === 'function') onResponse(new Error('extension-unavailable'));
    return;
  }

  if (expectResponse || typeof onResponse === 'function') {
    runtimeApi.sendMessage(message, (...args) => {
      const err = chrome && chrome.runtime && chrome.runtime.lastError;
      onResponse?.(err || null, ...args);
    });
  } else {
    runtimeApi.sendMessage(message);
  }
}

chrome.devtools.network.onRequestFinished.addListener((request) => {
  try {
    const req = request.request;
    const res = request.response;
    const event = {
      kind: 'request',
      method: req.method,
      url: req.url,
      status: res.status,
      statusText: res.statusText,
      ts: new Date(request.startedDateTime).getTime()
    };

    sendRuntimeMessage({ type: 'addEvent', event });
  } catch (error) {
    console.warn('Failed to log network request', error);
  }
});
