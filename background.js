let isRecording = false;
let events = [];
let eventCounter = 0;

let videoStartedAt = null;

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
let videoDataUrl = null;
let recordingTabId = null;
let recordingSourceTabId = null;
let pointerPreference = true;
let navDismissed = false;

function notifyRecordingState(enabled, targetTabId = recordingSourceTabId) {
  if (typeof targetTabId !== 'number') return;
  chrome.tabs.sendMessage(
    targetTabId,
    { type: 'jrRecordingToggle', enabled: Boolean(enabled) },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function notifyPointerState(enabled, targetTabId = recordingSourceTabId) {
  if (typeof targetTabId !== 'number') return;
  chrome.tabs.sendMessage(
    targetTabId,
    { type: 'jrPointerToggle', enabled: Boolean(enabled) },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function notifyNavState(visible, targetTabId = recordingSourceTabId) {
  if (typeof targetTabId !== 'number') return;
  chrome.tabs.sendMessage(
    targetTabId,
    { type: 'jrNavToggle', visible: Boolean(visible) },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function syncPointerState(targetTabId = recordingSourceTabId) {
  if (!isRecording || !pointerPreference) {
    notifyPointerState(false, targetTabId);
    return;
  }
  notifyPointerState(true, targetTabId);
}

function setPointerPreference(enabled) {
  const nextValue = Boolean(enabled);
  if (pointerPreference === nextValue) return;
  pointerPreference = nextValue;
  syncPointerState();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'startRecording') {
    if (typeof msg.enablePointer === 'boolean') {
      pointerPreference = msg.enablePointer;
    }
    navDismissed = false;
    startRecording(msg.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error('Unable to start recording', error);
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }

  if (msg.type === 'stopRecording') {
    stopRecording();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'setPointerPreference') {
    setPointerPreference(msg.enabled);
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === 'jrPointerReady') {
    const targetId = sender?.tab?.id;
    if (typeof targetId === 'number') {
      if (isRecording && targetId === recordingSourceTabId) {
        notifyRecordingState(true, targetId);
        if (pointerPreference) {
          notifyPointerState(true, targetId);
        } else {
          notifyPointerState(false, targetId);
        }
      } else {
        notifyRecordingState(false, targetId);
        notifyPointerState(false, targetId);
      }
      if (isRecording && !navDismissed && targetId === recordingSourceTabId) {
        notifyNavState(true, targetId);
      } else {
        notifyNavState(false, targetId);
      }
    }
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === 'jrNavDismissed') {
    navDismissed = true;
    const targetId = sender?.tab?.id;
    notifyNavState(false, targetId);
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === 'addEvent') {
    if (isRecording) {
      const now = Date.now();
      const incoming = msg.event || {};
      const storedEvent = {
        ...incoming,
        id: eventCounter++,
        ts: typeof incoming.ts === 'number' ? incoming.ts : now,
        kind: incoming.kind || 'unknown'
      };
      events.push(storedEvent);
      if (storedEvent.kind === 'click' || storedEvent.kind === 'request') {
        chrome.runtime.sendMessage({
          type: 'liveEvent',
          event: storedEvent
        });
      }
    }
    return;
  }

  if (msg.type === 'getTrace') {
    const sorted = [...events].sort((a, b) => a.ts - b.ts);
    const response = {
      events: sorted,
      videoStartedAt,
      videoDataUrl,
      videoAvailable: Boolean(videoDataUrl)
    };
    sendResponse(response);
    return true;
  }

  if (msg.type === 'recordingReady') {
    const targetId = msg.tabId || recordingSourceTabId;
    if (targetId) {
      chrome.tabs.update(targetId, { active: true }, () => {
        void chrome.runtime.lastError;
      });
    }
    return;
  }

  if (msg.type === 'videoStarted') {
    videoStartedAt = typeof msg.ts === 'number' ? msg.ts : Date.now();
    return;
  }

  if (msg.type === 'videoRecorded') {
    videoDataUrl = msg.dataUrl || null;
    recordingTabId = null;
    isRecording = false;
    notifyRecordingState(false);
    notifyPointerState(false);
    notifyNavState(false);
    navDismissed = false;
    recordingSourceTabId = null;
    return;
  }

  if (msg.type === 'recordingError') {
    console.warn('Screen recording error', msg.error);
    recordingTabId = null;
    isRecording = false;
    notifyRecordingState(false);
    notifyPointerState(false);
    notifyNavState(false);
    navDismissed = false;
    recordingSourceTabId = null;
    return;
  }
});

async function startRecording(tabId) {
  if (isRecording) return;

  isRecording = true;
  events = [];
  eventCounter = 0;
  videoStartedAt = null;
  videoDataUrl = null;

  recordingSourceTabId = typeof tabId === 'number' ? tabId : await getActiveTabId();

  if (typeof recordingSourceTabId === 'number') {
    notifyRecordingState(true, recordingSourceTabId);
    syncPointerState(recordingSourceTabId);
    if (!navDismissed) {
      notifyNavState(true, recordingSourceTabId);
    } else {
      notifyNavState(false, recordingSourceTabId);
    }
  }

  try {
    await openRecordingTab();
  } catch (error) {
    notifyRecordingState(false);
    notifyPointerState(false);
    recordingSourceTabId = null;
    isRecording = false;
    throw error;
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  notifyRecordingState(false);
  notifyPointerState(false);
  notifyNavState(false);
  navDismissed = false;
  recordingSourceTabId = null;
  if (recordingTabId) {
    chrome.tabs.sendMessage(recordingTabId, { type: 'stopScreenRecording' }, () => {
      void chrome.runtime.lastError;
    });
  }
}

async function getActiveTabId() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id ?? null;
  } catch (error) {
    console.warn('Unable to resolve active tab id', error);
    return null;
  }
}

async function openRecordingTab() {
  recordingTabId = null;
  try {
    const recorderTab = await chrome.tabs.create({
      url: chrome.runtime.getURL('recording_screen.html'),
      pinned: true,
      active: true
    });
    recordingTabId = recorderTab.id;
    const handleUpdated = (tabId, info) => {
      if (tabId === recordingTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(handleUpdated);
        chrome.tabs.sendMessage(
          recordingTabId,
          {
            type: 'initRecorder',
            sourceTabId: recordingSourceTabId
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      }
    };
    chrome.tabs.onUpdated.addListener(handleUpdated);
  } catch (error) {
    console.error('Unable to open recording tab', error);
    throw error;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId) {
    recordingTabId = null;
    if (isRecording) {
      isRecording = false;
    }
  }
  if (tabId === recordingSourceTabId) {
    notifyRecordingState(false, tabId);
    notifyPointerState(false, tabId);
    notifyNavState(false, tabId);
    navDismissed = false;
    recordingSourceTabId = null;
    if (isRecording) {
      isRecording = false;
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!isRecording || tabId !== recordingSourceTabId) return;
  if (info.status === 'complete') {
    notifyRecordingState(true, tabId);
    syncPointerState(tabId);
    if (!navDismissed) {
      notifyNavState(true, tabId);
    }
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (!isRecording) return;
  if (details.tabId !== recordingSourceTabId) return;
  if (details.frameId !== 0) return;

  const urlInfo = parseUrl(details.url);
  const navEvent = {
    kind: 'navigation',
    id: eventCounter++,
    transitionType: details.transitionType,
    transitionQualifiers: details.transitionQualifiers || [],
    url: details.url,
    host: urlInfo.host,
    path: urlInfo.path,
    qs: urlInfo.qs,
    ts: Date.now()
  };

  events.push(navEvent);

  chrome.runtime.sendMessage({
    type: 'liveEvent',
    event: navEvent
  });
});
