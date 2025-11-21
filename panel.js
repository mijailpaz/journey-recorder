const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const jsonBtn = document.getElementById('exportJsonBtn');
const mermaidBtn = document.getElementById('exportMermaidBtn');
const videoBtn = document.getElementById('downloadVideoBtn');
const layoutToggleBtn = document.getElementById('layoutToggleBtn');
const applyFiltersToggle = document.getElementById('applyFiltersToggle');
const presetFiltersContainer = document.getElementById('presetFilters');
const customRegexInput = document.getElementById('customRegexInput');
const totalEventsCount = document.getElementById('totalEventsCount');
const filteredEventsCount = document.getElementById('filteredEventsCount');
const previewEventList = document.getElementById('previewEventList');
const ignoredBreakdownEl = document.getElementById('ignoredBreakdown');
const previewNotice = document.getElementById('previewNotice');
const jsonViewer = document.getElementById('jsonViewer');
const videoSection = document.getElementById('videoSection');
const analysisSection = document.getElementById('analysisSection');
const restartFooter = document.getElementById('restartFooter');
const restartBtn = document.getElementById('restartBtn');
const statusBadge = document.getElementById('statusBadge');
const recordingHint = document.getElementById('recordingHint');
const analysisGrid = document.getElementById('analysisGrid');

const runtimeApi = (typeof chrome !== 'undefined' && (chrome.runtime || chrome.extension)) || null;
const inspectedTabId = chrome.devtools?.inspectedWindow?.tabId ?? null;

let latestTrace = null;
let currentFilteredEvents = [];
let currentIgnoredCounts = {};
let currentFilteredTrace = null;

const RecordingState = {
  IDLE: 'idle',
  RECORDING: 'recording',
  STOPPED: 'stopped'
};

let recordingState = RecordingState.IDLE;
let hasDownloadedVideo = false;

const FILTER_GROUPS = [
  {
    id: 'static-assets',
    label: 'Static assets',
    description: 'Images, CSS, fonts, and Next.js chunks.',
    defaultEnabled: true,
    patterns: [
      '\\.(png|jpg|jpeg|gif|svg|webp|ico)(\\?.*)?$',
      '\\.(css|scss|woff2?|ttf|otf)(\\?.*)?$',
      '/_next/static/',
      'assets-event-page\\.svc\\.sympla\\.com\\.br/_next/'
    ]
  },
  {
    id: 'tracking',
    label: 'Tracking & analytics',
    description: 'GA, TikTok, Facebook, Bing, etc.',
    defaultEnabled: true,
    patterns: [
      'google-analytics\\.com',
      'googletagmanager\\.com',
      'g\\.doubleclick\\.net',
      'pagead2\\.googlesyndication\\.com',
      'facebook\\.net',
      'analytics\\.tiktok\\.com',
      'clarity\\.ms',
      'bat\\.bing\\.com',
      'topsort',
      'cdn\\.cookielaw\\.org'
    ]
  },
  {
    id: 'extensions',
    label: 'Chrome extensions',
    description: 'Extension self-requests (chrome-extension://).',
    defaultEnabled: true,
    patterns: ['^chrome-extension://']
  },
  {
    id: 'preflight',
    label: 'CORS preflight & cached',
    description: 'OPTIONS requests and 304 responses.',
    defaultEnabled: true,
    patterns: ['method:^OPTIONS$', 'status:^304$']
  }
];

const filterSettings = {
  applyFilters: true,
  customRegexText: '',
  groups: FILTER_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    description: group.description,
    enabled: group.defaultEnabled !== false,
    patternsText: group.patterns.join('\n')
  }))
};


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
  if (recordingState === RecordingState.RECORDING) return;
  setRecordingState(RecordingState.RECORDING);
  clearTraceData();
  sendRuntimeMessage(
    { type: 'startRecording', tabId: inspectedTabId },
    {
      expectResponse: true,
      onResponse: (err) => {
        if (err) {
          console.warn('Unable to start recording', err.message || err);
          setRecordingState(RecordingState.IDLE);
          if (recordingHint) {
            recordingHint.textContent = 'Failed to start. Please retry.';
          }
        } else if (recordingHint) {
          recordingHint.textContent = 'Recording in progress…';
        }
      }
    }
  );
};

stopBtn.onclick = () => {
  if (recordingState !== RecordingState.RECORDING) return;
  sendRuntimeMessage(
    { type: 'stopRecording' },
    {
      expectResponse: true,
      onResponse: (err) => {
        if (err) {
          console.warn('Unable to stop recording', err.message || err);
          setRecordingState(RecordingState.IDLE);
          return;
        }
        setRecordingState(RecordingState.STOPPED);
        fetchTrace();
      }
    }
  );
};

restartBtn?.addEventListener('click', () => {
  resetPanelState();
});

layoutToggleBtn?.addEventListener('click', () => {
  if (!analysisGrid) return;
  const twoColumn = analysisGrid.classList.toggle('two-column');
  layoutToggleBtn.textContent = twoColumn ? 'Switch to single-column' : 'Switch to 2-column layout';
});

jsonBtn.onclick = () => {
  const useCached = getTraceForExport(latestTrace);
  if (useCached) {
    downloadTraceJson(useCached);
    return;
  }

  fetchTrace((trace) => {
    const payload = getTraceForExport(trace);
    if (!payload) return;
    downloadTraceJson(payload);
  });
};

videoBtn.onclick = () => {
  const handleTrace = (trace) => {
    if (!trace || !trace.videoDataUrl) {
      console.warn('Video not available yet. Start sharing when prompted.');
      return;
    }
    download(dataUrlToBlob(trace.videoDataUrl), 'journey.webm');
    markVideoDownloaded();
  };

  if (latestTrace?.videoDataUrl) {
    handleTrace(latestTrace);
  } else {
    fetchTrace(handleTrace);
  }
};

mermaidBtn.onclick = () => {
  if (latestTrace) {
    downloadMermaid(getEventsForExport(latestTrace));
    return;
  }

  fetchTrace((trace) => {
    downloadMermaid(getEventsForExport(trace));
  });
};

function downloadTraceJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  download(blob, 'trace.json');
}

function downloadMermaid(events) {
  const mermaid = generateMermaid(events);
  download(new Blob([mermaid], { type: 'text/plain' }), 'flow.mmd');
}

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
        updatePreview();
        callback?.(trace);
      }
    }
  );
}

function initializeFilterUI() {
  if (!applyFiltersToggle) return;

  renderPresetFilters();

  applyFiltersToggle.checked = filterSettings.applyFilters;
  applyFiltersToggle.addEventListener('change', () => {
    filterSettings.applyFilters = applyFiltersToggle.checked;
    updatePreviewNotice();
    updatePreview();
  });

  if (customRegexInput) {
    customRegexInput.value = filterSettings.customRegexText;
    customRegexInput.addEventListener('input', (event) => {
      filterSettings.customRegexText = event.target.value;
      updatePreview();
    });
  }

  updatePreviewNotice();
}

function renderPresetFilters() {
  if (!presetFiltersContainer) return;

  presetFiltersContainer.innerHTML = '';

  filterSettings.groups.forEach((group) => {
    const card = document.createElement('div');
    card.className = 'filter-card';
    card.dataset.filterId = group.id;

    const headerLabel = document.createElement('label');
    headerLabel.className = 'toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = group.enabled;
    checkbox.addEventListener('change', () => {
      updateGroupEnabled(group.id, checkbox.checked);
      updatePreview();
    });

    const title = document.createElement('span');
    title.textContent = group.label;

    headerLabel.appendChild(checkbox);
    headerLabel.appendChild(title);

    const desc = document.createElement('p');
    desc.textContent = group.description;

    const textarea = document.createElement('textarea');
    textarea.value = group.patternsText;
    textarea.addEventListener('input', (event) => {
      updateGroupPatterns(group.id, event.target.value);
      updatePreview();
    });

    const helper = document.createElement('small');
    helper.textContent = 'Prefix with method: or status: to match method/status.';

    card.appendChild(headerLabel);
    card.appendChild(desc);
    card.appendChild(textarea);
    card.appendChild(helper);

    presetFiltersContainer.appendChild(card);
  });
}

function updateGroupEnabled(groupId, enabled) {
  const group = filterSettings.groups.find((entry) => entry.id === groupId);
  if (group) {
    group.enabled = enabled;
  }
}

function updateGroupPatterns(groupId, text) {
  const group = filterSettings.groups.find((entry) => entry.id === groupId);
  if (group) {
    group.patternsText = text;
  }
}

function compileActiveRules() {
  const groups = [];
  filterSettings.groups.forEach((group) => {
    if (!group.enabled) return;
    const rules = parseRulesFromText(group.patternsText);
    if (rules.length) {
      groups.push({ id: group.id, label: group.label, rules });
    }
  });

  const customRules = parseRulesFromText(filterSettings.customRegexText);
  if (customRules.length) {
    groups.push({ id: 'custom', label: 'Custom', rules: customRules });
  }

  return groups;
}

function parseRulesFromText(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => buildRuleFromLine(line))
    .filter(Boolean);
}

function buildRuleFromLine(line) {
  let target = 'url';
  let pattern = line;

  if (line.startsWith('method:')) {
    target = 'method';
    pattern = line.slice(7).trim();
  } else if (line.startsWith('status:')) {
    target = 'status';
    pattern = line.slice(7).trim();
  }

  if (!pattern) return null;
  const regex = buildRegExp(pattern);
  if (!regex) return null;
  return { target, regex };
}

function buildRegExp(pattern) {
  try {
    const literalMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
    if (literalMatch) {
      return new RegExp(literalMatch[1], literalMatch[2]);
    }
    return new RegExp(pattern, 'i');
  } catch (error) {
    console.warn('Invalid regex pattern ignored:', pattern, error);
    return null;
  }
}

function applyFiltersToEvents(events) {
  if (!Array.isArray(events)) {
    return { filteredEvents: [], ignoredCounts: {} };
  }

  if (!filterSettings.applyFilters) {
    return { filteredEvents: events, ignoredCounts: {} };
  }

  const compiledGroups = compileActiveRules();
  if (!compiledGroups.length) {
    return { filteredEvents: events, ignoredCounts: {} };
  }

  const ignoredCounts = {};
  const filteredEvents = [];

  events.forEach((event) => {
    if (event.kind !== 'request') {
      filteredEvents.push(event);
      return;
    }

    const matchedGroupId = matchEventAgainstGroups(event, compiledGroups);
    if (matchedGroupId) {
      ignoredCounts[matchedGroupId] = (ignoredCounts[matchedGroupId] || 0) + 1;
      return;
    }

    filteredEvents.push(event);
  });

  return { filteredEvents, ignoredCounts };
}

function matchEventAgainstGroups(event, groups) {
  for (const group of groups) {
    for (const rule of group.rules) {
      const value = getEventFieldByTarget(event, rule.target);
      if (value && rule.regex.test(value)) {
        return group.id;
      }
    }
  }
  return null;
}

function getEventFieldByTarget(event, target) {
  if (target === 'method') return event.method || '';
  if (target === 'status') return String(event.status ?? '');
  return event.url || '';
}

function updatePreview() {
  if (!totalEventsCount || !filteredEventsCount || !previewEventList || !ignoredBreakdownEl) {
    return;
  }

  if (!latestTrace || !Array.isArray(latestTrace.events)) {
    totalEventsCount.textContent = '0';
    filteredEventsCount.textContent = '0';
    ignoredBreakdownEl.textContent = '';
    previewEventList.textContent =
      recordingState === RecordingState.RECORDING
        ? 'Recording… events will appear once you stop.'
        : 'No trace loaded yet.';
    currentFilteredEvents = [];
    currentIgnoredCounts = {};
    currentFilteredTrace = null;
    renderJsonViewer(null);
    return;
  }

  const events = latestTrace.events;
  const { filteredEvents, ignoredCounts } = applyFiltersToEvents(events);
  currentFilteredEvents = filteredEvents;
  currentIgnoredCounts = ignoredCounts;
  currentFilteredTrace = buildTracePayload(latestTrace, filteredEvents);

  totalEventsCount.textContent = String(events.length);
  filteredEventsCount.textContent = String(filteredEvents.length);

  renderIgnoredBreakdown(ignoredCounts);
  renderPreviewEvents(filteredEvents, events.length > 0 ? events[0].ts : 0);
  renderJsonViewer(currentFilteredTrace);
}

function renderIgnoredBreakdown(counts) {
  if (!ignoredBreakdownEl) return;

  ignoredBreakdownEl.innerHTML = '';
  const entries = Object.entries(counts);

  if (!entries.length) {
    const span = document.createElement('span');
    span.textContent = filterSettings.applyFilters ? 'No events filtered' : 'Filtering disabled';
    ignoredBreakdownEl.appendChild(span);
    return;
  }

  entries.forEach(([groupId, count]) => {
    const chip = document.createElement('span');
    chip.textContent = `${getGroupLabel(groupId)}: ${count}`;
    ignoredBreakdownEl.appendChild(chip);
  });
}

function getGroupLabel(groupId) {
  if (groupId === 'custom') return 'Custom';
  return filterSettings.groups.find((group) => group.id === groupId)?.label || groupId;
}

function renderPreviewEvents(events, baseTs) {
  if (!previewEventList) return;

  if (!events.length) {
    previewEventList.textContent = filterSettings.applyFilters
      ? 'All requests were filtered by the current rules.'
      : 'Trace is empty.';
    return;
  }

  const limit = 25;
  const lines = events.slice(0, limit).map((event) => formatEventForPreview(event, baseTs));
  let text = lines.join('\n');
  if (events.length > limit) {
    text += `\n… ${events.length - limit} more events`;
  }
  previewEventList.textContent = text;
}

function formatEventForPreview(event, baseTs) {
  const delta = typeof event.ts === 'number' && typeof baseTs === 'number' ? event.ts - baseTs : null;
  const deltaText = delta != null ? ` @+${formatDelta(delta)}` : '';

  if (event.kind === 'click') {
    const label = (event.text || event.selector || 'click').replace(/\s+/g, ' ').trim();
    return `[${event.id ?? '?'}${deltaText}] CLICK ${truncate(label, 80)}`;
  }

  if (event.kind === 'request') {
    const method = event.method || 'GET';
    const status = event.status != null ? ` (${event.status})` : '';
    const url = safeUrl(event.url);
    const host = url ? url.host : 'unknown';
    const path = url ? normalizePath(url.pathname) : event.url || '';
    return `[${event.id ?? '?'}${deltaText}] ${method} ${host}${path}${status}`;
  }

  return `[${event.id ?? '?'}${deltaText}] ${event.kind || 'event'}`;
}

function normalizePath(pathname) {
  if (!pathname) return '/';
  return pathname.replace(/\/+/g, '/');
}

function formatDelta(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '0ms';
  if (Math.abs(ms) < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function truncate(text, length) {
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1)}…`;
}

function getTraceForExport(trace) {
  if (!trace || !Array.isArray(trace.events)) {
    return null;
  }

  if (trace === latestTrace && currentFilteredTrace) {
    return currentFilteredTrace;
  }

  const events = filterSettings.applyFilters ? applyFiltersToEvents(trace.events).filteredEvents : trace.events;
  return buildTracePayload(trace, events);
}

function getEventsForExport(trace) {
  return getTraceForExport(trace)?.events ?? [];
}

function updatePreviewNotice() {
  if (!previewNotice) return;
  previewNotice.textContent = filterSettings.applyFilters
    ? 'Filtered events will be exported.'
    : 'Filtering disabled — exports use raw events.';
}

function buildTracePayload(trace, eventsOverride) {
  if (!trace) return null;
  const { videoDataUrl, events, ...rest } = trace;
  return {
    ...rest,
    events: Array.isArray(eventsOverride) ? eventsOverride : Array.isArray(events) ? events : [],
    videoAvailable: Boolean(videoDataUrl)
  };
}

function renderJsonViewer(tracePayload) {
  if (!jsonViewer) return;

  if (!tracePayload) {
    const emptyMessage =
      recordingState === RecordingState.RECORDING
        ? 'Recording… trace will appear once you stop.'
        : recordingState === RecordingState.STOPPED
          ? 'Preparing trace…'
          : 'No trace loaded yet.';
    jsonViewer.textContent = emptyMessage;
    return;
  }

  try {
    jsonViewer.textContent = JSON.stringify(tracePayload, null, 2);
  } catch (error) {
    jsonViewer.textContent = `Unable to render trace: ${error?.message || error}`;
  }
}

function clearTraceData() {
  latestTrace = null;
  currentFilteredEvents = [];
  currentFilteredTrace = null;
  currentIgnoredCounts = {};
  updatePreview();
}

function resetPanelState() {
  clearTraceData();
  setRecordingState(RecordingState.IDLE);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setRecordingState(state) {
  if (state !== RecordingState.STOPPED) {
    hasDownloadedVideo = false;
  }

  recordingState = state;
  updateStatusBadge(state);

  if (startBtn) {
    const showStart = state === RecordingState.IDLE;
    startBtn.classList.toggle('hidden', !showStart);
    startBtn.disabled = !showStart;
  }

  if (stopBtn) {
    stopBtn.classList.toggle('hidden', state !== RecordingState.RECORDING);
  }

  const showVideoGate = state === RecordingState.STOPPED && !hasDownloadedVideo;
  const showAnalysis = state === RecordingState.STOPPED && hasDownloadedVideo;

  if (videoSection) {
    videoSection.classList.toggle('hidden', !showVideoGate);
  }

  if (analysisSection) {
    analysisSection.classList.toggle('hidden', !showAnalysis);
  }

  if (restartFooter) {
    restartFooter.classList.toggle('hidden', !showAnalysis);
  }

  if (recordingHint) {
    let hint = 'Start recording to capture a new user journey.';
    if (state === RecordingState.RECORDING) {
      hint = 'Stop when you are done capturing interactions.';
    } else if (state === RecordingState.STOPPED) {
      hint = hasDownloadedVideo
        ? 'Review the trace below or start another capture.'
        : 'Download the video to continue.';
    }
    recordingHint.textContent = hint;
  }
}

function markVideoDownloaded() {
  if (recordingState !== RecordingState.STOPPED || hasDownloadedVideo) return;
  hasDownloadedVideo = true;
  setRecordingState(recordingState);
}

function updateStatusBadge(state) {
  if (!statusBadge) return;
  const labels = {
    [RecordingState.IDLE]: 'Idle',
    [RecordingState.RECORDING]: 'Recording',
    [RecordingState.STOPPED]: 'Captured'
  };
  statusBadge.textContent = labels[state] || state;
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

setRecordingState(RecordingState.IDLE);
initializeFilterUI();
updatePreview();
fetchTrace();
