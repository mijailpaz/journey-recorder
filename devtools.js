chrome.devtools.panels.create('Flow Recorder', '', 'panel.html');

const PAYLOAD_PREF_KEY = 'jrIncludePayloads';
let capturePayloadsEnabled = false;

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

function getResponseContentType(response) {
  if (!response) return null;
  const mimeType = response.content?.mimeType;
  if (mimeType) return mimeType;

  const headers = Array.isArray(response.headers) ? response.headers : [];
  const header = headers.find(
    (h) => h?.name && typeof h.name === 'string' && h.name.toLowerCase() === 'content-type'
  );
  return header?.value || null;
}

function isHtmlMimeType(mimeType) {
  if (typeof mimeType !== 'string') return false;
  const normalized = mimeType.toLowerCase();
  return normalized.includes('text/html') || normalized.includes('application/xhtml');
}

function initializePayloadCapturePreference() {
  try {
    chrome?.storage?.local?.get([PAYLOAD_PREF_KEY], (result) => {
      capturePayloadsEnabled = Boolean(result?.[PAYLOAD_PREF_KEY]);
    });
  } catch (error) {
    console.warn('Unable to read payload preference', error);
    capturePayloadsEnabled = false;
  }

  chrome?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes || !(PAYLOAD_PREF_KEY in changes)) {
      return;
    }
    capturePayloadsEnabled = Boolean(changes[PAYLOAD_PREF_KEY]?.newValue);
  });
}

initializePayloadCapturePreference();

chrome.devtools.network.onRequestFinished.addListener((request) => {
  try {
    const req = request.request;
    const res = request.response;
    const urlInfo = parseUrl(req.url);
    const tabId = chrome.devtools.inspectedWindow.tabId;
    const resourceType = request._resourceType || request._type || 'other';
    const isApiRequest = resourceType === 'xhr' || resourceType === 'fetch';
    if (!isApiRequest) {
      return;
    }
    const shouldCapturePayloads =
      capturePayloadsEnabled && isApiRequest;

    const event = {
      kind: 'request',
      method: req.method,
      url: req.url,
      host: urlInfo.host,
      path: urlInfo.path,
      qs: urlInfo.qs,
      status: res.status,
      statusText: res.statusText,
      ts: new Date(request.startedDateTime).getTime(),
      requestId: request._requestId,
      tabId: tabId,
      frameId: request._frameId,
      type: resourceType,
      protocol: request._protocol || res.httpVersion,
      duration: request.time,
      timings: request.timings,
      transferSize: res._transferSize,
      encodedBodySize: res.bodySize,
      decodedBodySize: res.content?.size ?? 0,
      contentType: getResponseContentType(res)
    };

    const isHtmlResponse = isHtmlMimeType(event.contentType);

    if (shouldCapturePayloads && req.postData) {
      event.requestBody = {
        mimeType: req.postData.mimeType,
        text: req.postData.text,
        params: req.postData.params
      };
    }

    const shouldCaptureResponseBody =
      shouldCapturePayloads && !isHtmlResponse && typeof request.getContent === 'function';

    if (shouldCaptureResponseBody) {
      try {
        request.getContent((content, encoding) => {
          event.responseBody =
            content != null
              ? {
                  content,
                  encoding: encoding || 'text'
                }
              : null;
          sendRuntimeMessage({ type: 'addEvent', event });
        });
        return;
      } catch (contentError) {
        console.warn('Unable to capture response body', contentError);
      }
    }

    sendRuntimeMessage({ type: 'addEvent', event });
  } catch (error) {
    if (!isIgnorableRuntimeError(error)) {
      console.warn('Failed to log network request', error);
    }
  }
});
