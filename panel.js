const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const jsonBtn = document.getElementById('exportJsonBtn');
const mermaidBtn = document.getElementById('exportMermaidBtn');
const videoBtn = document.getElementById('downloadVideoBtn');
const output = document.getElementById('output');

const runtimeApi = (typeof chrome !== 'undefined' && (chrome.runtime || chrome.extension)) || null;
const inspectedTabId = chrome.devtools?.inspectedWindow?.tabId ?? null;

let latestTrace = null;

function sendRuntimeMessage(message, { expectResponse = false, onResponse } = {}) {
  if (!runtimeApi || typeof runtimeApi.sendMessage !== 'function') {
    console.warn('Runtime messaging API unavailable in this context.', message);
    if (typeof onResponse === 'function') onResponse(null, null);
    return;
  }

  if (expectResponse || typeof onResponse === 'function') {
    runtimeApi.sendMessage(message, (...args) => {
      const err = chrome?.runtime?.lastError || null;
      onResponse?.(err, ...args);
    });
  } else {
    runtimeApi.sendMessage(message);
  }
}

startBtn.onclick = () => {
  sendRuntimeMessage(
    { type: 'startRecording', tabId: inspectedTabId },
    {
      expectResponse: true,
      onResponse: (err) => {
        if (err) console.warn('Unable to start recording', err.message || err);
      }
    }
  );
};

stopBtn.onclick = () => {
  sendRuntimeMessage(
    { type: 'stopRecording' },
    {
      expectResponse: true,
      onResponse: (err) => {
        if (err) console.warn('Unable to stop recording', err.message || err);
      }
    }
  );
};

jsonBtn.onclick = () => {
  fetchTrace((trace) => {
    if (!trace) return;
    const { videoDataUrl, ...rest } = trace;
    const payload = {
      ...rest,
      videoAvailable: Boolean(videoDataUrl)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    download(blob, 'trace.json');
  });
};

videoBtn.onclick = () => {
  const handleTrace = (trace) => {
    if (!trace || !trace.videoDataUrl) {
      console.warn('Video not available yet. Start sharing when prompted.');
      return;
    }
    download(dataUrlToBlob(trace.videoDataUrl), 'journey.webm');
  };

  if (latestTrace?.videoDataUrl) {
    handleTrace(latestTrace);
  } else {
    fetchTrace(handleTrace);
  }
};

mermaidBtn.onclick = () => {
  fetchTrace((trace) => {
    if (!trace) return;
    const mermaid = generateMermaid(trace.events || []);
    output.value = mermaid;
    download(new Blob([mermaid], { type: 'text/plain' }), 'flow.mmd');
  });
};

function fetchTrace(callback) {
  sendRuntimeMessage(
    { type: 'getTrace' },
    {
      expectResponse: true,
      onResponse: (err, trace) => {
        if (err) {
          console.warn('Unable to retrieve trace', err.message || err);
          callback?.(null);
          return;
        }
        latestTrace = trace;
        callback?.(trace);
      }
    }
  );
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(',');
  const mimeMatch = /data:(.*?);base64/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : 'video/webm';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function generateMermaid(events) {
  const lines = ['sequenceDiagram', '  autonumber'];
  events.forEach((event) => {
    if (event.kind === 'click') {
      const label = event.text || event.selector || 'click';
      lines.push(`  User->>WebApp: Click "${sanitize(label)}"`);
    } else if (event.kind === 'request') {
      const url = safeUrl(event.url);
      const host = url ? url.host : 'server';
      const path = url ? url.pathname + url.search : event.url;
      const method = event.method || 'GET';
      const status = event.status || 'unknown';
      const statusText = event.statusText || '';
      lines.push(`  WebApp->>${host}: ${method} ${path}`);
      lines.push(`  ${host}-->>WebApp: ${status} ${statusText}`);
    }
  });
  if (lines.length === 2) {
    lines.push('  Note over User,WebApp: No events recorded');
  }
  return lines.join('\n');
}

function sanitize(text) {
  return String(text || '').replace(/"/g, '\\"');
}

function safeUrl(urlString) {
  try {
    return new URL(urlString);
  } catch (_) {
    return null;
  }
}
