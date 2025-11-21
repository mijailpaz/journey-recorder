const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const jsonBtn = document.getElementById('exportJsonBtn');
const mermaidBtn = document.getElementById('exportMermaidBtn');
const videoBtn = document.getElementById('downloadVideoBtn');
const layoutToggleBtn = document.getElementById('layoutToggleBtn');
const applyFiltersToggle = document.getElementById('applyFiltersToggle');
const presetFiltersContainer = document.getElementById('presetFilters');
const customRegexInput = document.getElementById('customRegexInput');
const customFilterCountEl = document.getElementById('customFilterCount');
const totalEventsCount = document.getElementById('totalEventsCount');
const filteredEventsCount = document.getElementById('filteredEventsCount');
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
const filtersSectionEl = document.getElementById('filtersSection');
const previewEventList = document.getElementById('previewEventList');
const liveEventsSection = document.getElementById('liveEventsSection');
const liveEventsList = document.getElementById('liveEventsList');
const liveEventsCount = document.getElementById('liveEventsCount');
const liveNetworkStats = document.getElementById('liveNetworkStats');
const liveNetworkCount = document.getElementById('liveNetworkCount');
const liveNetworkStatus = document.getElementById('liveNetworkStatus');
const liveNetworkProgress = document.getElementById('liveNetworkProgress');
const liveNetworkProgressFill = document.getElementById('liveNetworkProgressFill');
const clickSelectionContainer = document.getElementById('clickSelectionContainer');
const clickSelectionList = document.getElementById('clickSelectionList');
const clickSelectionCount = document.getElementById('clickSelectionCount');
const pointerOverlayToggle = document.getElementById('pointerOverlayToggle');
const filterCountElements = new Map();
const filtersResizeObserver =
  typeof ResizeObserver !== 'undefined' && filtersSectionEl
    ? new ResizeObserver(() => syncColumnHeights())
    : null;
filtersResizeObserver?.observe(filtersSectionEl);
window.addEventListener('resize', () => syncColumnHeights());

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
const MAX_LIVE_EVENTS = 40;
const LIVE_CLICK_WINDOW_MS = 10000;
let liveEvents = [];
let activeClickWindow = null;
const POINTER_PREF_KEY = 'jrPointerOverlayEnabled';
let pointerOverlayEnabled = true;
const clickSelectionState = new Map();
let hasClickSelectionRows = false;

try {
  const storedPref = window.localStorage?.getItem(POINTER_PREF_KEY);
  if (storedPref != null) {
    pointerOverlayEnabled = storedPref !== 'false';
  }
} catch (error) {
  console.warn('Unable to read pointer preference', error);
}

if (pointerOverlayToggle) {
  pointerOverlayToggle.checked = pointerOverlayEnabled;
  pointerOverlayToggle.addEventListener('change', () => {
    pointerOverlayEnabled = pointerOverlayToggle.checked;
    try {
      window.localStorage?.setItem(POINTER_PREF_KEY, String(pointerOverlayEnabled));
    } catch (error) {
      console.warn('Unable to persist pointer preference', error);
    }
    syncPointerPreference();
  });
}

function syncPointerPreference() {
  sendRuntimeMessage({ type: 'setPointerPreference', enabled: pointerOverlayEnabled });
}
syncPointerPreference();

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
    { type: 'startRecording', tabId: inspectedTabId, enablePointer: pointerOverlayEnabled },
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
  syncColumnHeights();
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
  filterCountElements.clear();

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

    const count = document.createElement('div');
    count.className = 'filter-count';
    count.dataset.filterId = group.id;
    count.textContent = 'Filtered: 0';
    filterCountElements.set(group.id, count);

    card.appendChild(headerLabel);
    card.appendChild(desc);
    card.appendChild(textarea);
    card.appendChild(helper);
    card.appendChild(count);

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
  if (!totalEventsCount || !filteredEventsCount || !ignoredBreakdownEl) {
    return;
  }

  if (!latestTrace || !Array.isArray(latestTrace.events)) {
    totalEventsCount.textContent = '0';
    filteredEventsCount.textContent = '0';
    ignoredBreakdownEl.textContent = '';
    if (previewEventList) {
      previewEventList.textContent =
        recordingState === RecordingState.RECORDING
          ? 'Recording… events will appear once you stop.'
          : 'No trace loaded yet.';
    }
    currentFilteredEvents = [];
    currentIgnoredCounts = {};
    currentFilteredTrace = null;
    renderJsonViewer(null);
    updateFilterCounts({});
    syncClickSelectionState([]);
    renderClickSelection([]);
    syncColumnHeights();
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
  updateFilterCounts(ignoredCounts);
  renderPreviewEvents(filteredEvents, events.length > 0 ? events[0].ts : 0);
  renderJsonViewer(currentFilteredTrace);
  syncClickSelectionState(currentFilteredEvents);
  renderClickSelection(currentFilteredEvents);
  syncColumnHeights();
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

function updateFilterCounts(counts) {
  filterSettings.groups.forEach((group) => {
    const el = filterCountElements.get(group.id);
    if (!el) return;
    const value = counts[group.id] || 0;
    el.textContent = `Filtered: ${value}`;
  });
  if (customFilterCountEl) {
    const customCount = counts.custom || 0;
    customFilterCountEl.textContent = `Filtered: ${customCount}`;
  }
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

function handleLiveEventMessage(event) {
  if (!event) return;
  if (event.kind === 'click') {
    handleLiveClickEvent(event);
  } else if (event.kind === 'request') {
    handleLiveRequestEvent(event);
  }
}

function handleLiveClickEvent(event) {
  if (recordingState !== RecordingState.RECORDING) return;
  const normalized = {
    ...event,
    ts: typeof event.ts === 'number' ? event.ts : Date.now()
  };
  liveEvents.push(normalized);
  if (liveEvents.length > MAX_LIVE_EVENTS) {
    liveEvents.shift();
  }
  renderLiveEvents();
  startLiveClickWindow(normalized.ts);
}

function handleLiveRequestEvent(event) {
  if (recordingState !== RecordingState.RECORDING) return;
  if (!activeClickWindow) return;
  const eventTs = typeof event.ts === 'number' ? event.ts : Date.now();
  if (eventTs < activeClickWindow.startTs || eventTs > activeClickWindow.endTs) {
    return;
  }
  activeClickWindow.count += 1;
  updateNetworkStatsUI();
}

function renderLiveEvents() {
  if (!liveEventsList || !liveEventsCount) return;
  if (!liveEvents.length) {
    liveEventsList.textContent =
      recordingState === RecordingState.RECORDING
        ? 'Clicks will appear here once you interact with the page.'
        : 'Start a recording to watch clicks appear here.';
    liveEventsCount.textContent = '0';
    return;
  }

  liveEventsList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  liveEvents
    .slice()
    .reverse()
    .forEach((event) => {
      const row = document.createElement('div');
      row.className = 'live-event-row';

      const time = document.createElement('span');
      time.className = 'live-event-time';
      time.textContent = formatLiveEventTime(event.ts);

      const label = document.createElement('span');
      label.className = 'live-event-label';
      label.textContent = formatLiveEventLabel(event);

      row.appendChild(time);
      row.appendChild(label);
      fragment.appendChild(row);
    });

  liveEventsList.appendChild(fragment);
  liveEventsCount.textContent = String(liveEvents.length);
}

function syncClickSelectionState(events) {
  if (!Array.isArray(events) || !events.length) {
    clickSelectionState.clear();
    return;
  }

  const nextKeys = new Set();
  events.forEach((event) => {
    if (!event || event.kind !== 'click') return;
    const key = getClickEventKey(event);
    if (!key) return;
    nextKeys.add(key);
    const existing = clickSelectionState.get(key);
    const includeValue =
      event.include !== undefined
        ? event.include !== false
        : existing?.include ?? true;
    const labelValue =
      typeof event.label === 'string' && event.label.trim().length
        ? event.label.trim()
        : existing?.label ?? getDefaultClickLabel(event);
    clickSelectionState.set(key, { include: includeValue, label: labelValue });
    event.include = includeValue;
    event.label = labelValue;
  });

  Array.from(clickSelectionState.keys()).forEach((key) => {
    if (!nextKeys.has(key)) {
      clickSelectionState.delete(key);
    }
  });
}

function renderClickSelection(events) {
  if (!clickSelectionList || !clickSelectionCount) return;

  const clickEvents = Array.isArray(events)
    ? events.filter((event) => event?.kind === 'click')
    : [];
  hasClickSelectionRows = clickEvents.length > 0;
  clickSelectionContainer?.classList.toggle('hidden', !hasClickSelectionRows);

  if (!hasClickSelectionRows) {
    clickSelectionList.textContent = latestTrace
      ? 'No click events remain after filtering.'
      : 'Load a trace to edit click metadata.';
    clickSelectionCount.textContent = '0';
    applyClickCustomizationsToJson();
    return;
  }

  clickSelectionList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  clickEvents.forEach((event) => {
    const key = getClickEventKey(event);
    const state = key ? clickSelectionState.get(key) : null;
    const row = document.createElement('div');
    row.className = 'click-selection-row';

    const meta = document.createElement('div');
    meta.className = 'click-selection-meta';
    meta.textContent = formatClickSelectionMeta(event);
    row.appendChild(meta);

    const controls = document.createElement('div');
    controls.className = 'click-selection-controls';

    const includeLabel = document.createElement('label');
    includeLabel.className = 'click-selection-include';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state?.include !== false;
    checkbox.addEventListener('change', () => {
      const entry = key ? clickSelectionState.get(key) : null;
      const checked = checkbox.checked;
      if (entry) {
        entry.include = checked;
      } else if (key) {
        clickSelectionState.set(key, { include: checked, label: getDefaultClickLabel(event) });
      }
      event.include = checked;
      applyClickCustomizationsToJson();
    });

    const includeSpan = document.createElement('span');
    includeSpan.textContent = 'Include';
    includeLabel.appendChild(checkbox);
    includeLabel.appendChild(includeSpan);
    controls.appendChild(includeLabel);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'click-selection-input';
    labelInput.value = state?.label ?? getDefaultClickLabel(event);
    labelInput.placeholder = 'Click label';
    labelInput.addEventListener('input', () => {
      const value = labelInput.value.trim();
      const entry = key ? clickSelectionState.get(key) : null;
      const nextValue = value.length ? value : getDefaultClickLabel(event);
      if (entry) {
        entry.label = nextValue;
      } else if (key) {
        clickSelectionState.set(key, { include: checkbox.checked, label: nextValue });
      }
      event.label = nextValue;
      applyClickCustomizationsToJson();
    });
    controls.appendChild(labelInput);

    row.appendChild(controls);
    fragment.appendChild(row);
  });

  clickSelectionList.appendChild(fragment);
  clickSelectionCount.textContent = String(clickEvents.length);
  applyClickCustomizationsToJson();
}

function applyClickCustomizationsToJson() {
  if (!latestTrace || !currentFilteredTrace || !Array.isArray(currentFilteredEvents)) {
    return;
  }

  const customizedEvents = buildCustomizedEventList(currentFilteredEvents);
  currentFilteredTrace = buildTracePayload(latestTrace, customizedEvents);
  renderJsonViewer(currentFilteredTrace);
}

function buildCustomizedEventList(events) {
  if (!Array.isArray(events)) return [];
  const customized = [];
  events.forEach((event) => {
    if (!event) return;
    if (event.kind === 'click' && event.include === false) {
      return;
    }
    if (event.kind === 'click' && typeof event.label === 'string') {
      customized.push({ ...event, label: event.label });
      return;
    }
    customized.push(event);
  });
  return customized;
}

function getClickEventKey(event) {
  if (!event) return null;
  if (event.id != null) {
    return `id:${event.id}`;
  }
  const ts =
    typeof event.ts === 'number' && !Number.isNaN(event.ts)
      ? event.ts
      : Date.now();
  const source = (event.selector || event.text || event.label || 'click')
    .replace(/\s+/g, ' ')
    .trim();
  return `ts:${ts}:${source}`;
}

function getDefaultClickLabel(event) {
  const base = (event?.text || event?.selector || event?.label || 'Click')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'Click';
}

function getClickLabelForMermaid(event) {
  const explicit = typeof event?.label === 'string' ? event.label.trim() : '';
  if (explicit) {
    return explicit;
  }
  return getDefaultClickLabel(event);
}

function formatClickSelectionMeta(event) {
  const parts = [];
  if (event?.id != null) {
    parts.push(`#${event.id}`);
  }
  if (typeof event?.ts === 'number' && !Number.isNaN(event.ts)) {
    parts.push(formatLiveEventTime(event.ts));
  }
  const source = (event?.selector || event?.text || event?.label || 'click')
    .replace(/\s+/g, ' ')
    .trim();
  parts.push(truncate(source, 80));
  return parts.join(' · ');
}

function formatRequestForMermaid(event) {
  if (!event) return null;
  const method = event.method || 'GET';
  const urlString = event.url || '';

  if (isDataUrl(urlString)) {
    const label = summarizeDataUrl(urlString);
    return {
      host: 'embedded_asset',
      description: `${method} ${label}`,
      skipResponse: true
    };
  }

  const url = safeUrl(urlString);
  if (!url) {
    return {
      host: 'server',
      description: `${method} ${truncate(urlString, 80)}`
    };
  }

  const host = normalizeHost(url.host);
  const isTelemetry = isTelemetryRequest(url);
  const pathDescription = formatPathWithParams(url, { isTelemetry });
  return {
    host,
    description: `${method} ${pathDescription}`,
    skipResponse: false
  };
}

function isDataUrl(url) {
  return typeof url === 'string' && url.startsWith('data:');
}

function summarizeDataUrl(url) {
  const match = /^data:([^;,]+)/.exec(url);
  const mime = match ? match[1] : 'embedded asset';
  return mime.length > 40 ? `${mime.slice(0, 39)}…` : `data:${mime}`;
}

function normalizeHost(host) {
  if (!host) return 'server';
  return host.replace(/^www\./i, '');
}

function formatPathWithParams(url, { isTelemetry = false } = {}) {
  const pathname = normalizePath(url.pathname || '/');
  const summary = summarizeQueryParams(url);
  const combined = summary ? `${pathname}?${summary}` : pathname;
  const label = isTelemetry ? `Beacon ${combined}` : combined;
  return truncate(label, 140);
}

function summarizeQueryParams(url) {
  if (!url.search || !url.searchParams) {
    return '';
  }
  const params = [];
  url.searchParams.forEach((value, key) => {
    params.push([key, value]);
  });
  if (!params.length) {
    return '';
  }
  const maxPairs = 2;
  const parts = params.slice(0, maxPairs).map(([key, value]) => {
    const sanitizedValue = value.length > 40 ? `${value.slice(0, 39)}…` : value;
    return `${key}=${sanitizedValue}`;
  });
  if (params.length > maxPairs) {
    parts.push('…');
  }
  return parts.join('&');
}

function isTelemetryRequest(url) {
  const host = (url.host || '').toLowerCase();
  const path = (url.pathname || '').toLowerCase();
  if (!host && !path) return false;
  const TELEMETRY_HOST_PATTERNS = ['online-metrix', 'doubleclick', 'pixel'];
  const TELEMETRY_PATH_PATTERNS = ['pixel', 'clear', 'beacon', 'collect'];
  const hostMatch = TELEMETRY_HOST_PATTERNS.some((pattern) => host.includes(pattern));
  const pathMatch = TELEMETRY_PATH_PATTERNS.some((pattern) => path.includes(pattern));
  return hostMatch || pathMatch;
}

function clearLiveEvents() {
  liveEvents = [];
  renderLiveEvents();
}

function updateLiveEventsVisibility() {
  if (!liveEventsSection) return;
  const shouldShow = recordingState === RecordingState.RECORDING;
  liveEventsSection.classList.toggle('hidden', !shouldShow);
  if (shouldShow) {
    renderLiveEvents();
  }
}

function startLiveClickWindow(startTs) {
  cleanupLiveClickWindowTimers();
  activeClickWindow = {
    startTs,
    endTs: startTs + LIVE_CLICK_WINDOW_MS,
    count: 0,
    active: true,
    timeoutId: null,
    rafId: null
  };
  const remaining = Math.max(0, activeClickWindow.endTs - Date.now());
  activeClickWindow.timeoutId = setTimeout(() => {
    finalizeLiveClickWindow();
  }, remaining);
  setNetworkProgress(0, 0);
  refreshLiveNetworkStatusLabel();
  runLiveClickProgressLoop();
  updateNetworkStatsUI();
}

function finalizeLiveClickWindow() {
  if (!activeClickWindow) return;
  if (activeClickWindow.timeoutId) {
    clearTimeout(activeClickWindow.timeoutId);
    activeClickWindow.timeoutId = null;
  }
  activeClickWindow.active = false;
  setNetworkProgress(100, LIVE_CLICK_WINDOW_MS);
  refreshLiveNetworkStatusLabel();
  if (activeClickWindow.rafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(activeClickWindow.rafId);
    activeClickWindow.rafId = null;
  }
  updateNetworkStatsUI();
}

function cleanupLiveClickWindowTimers() {
  if (!activeClickWindow) return;
  if (activeClickWindow.timeoutId) {
    clearTimeout(activeClickWindow.timeoutId);
    activeClickWindow.timeoutId = null;
  }
  if (activeClickWindow.rafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(activeClickWindow.rafId);
    activeClickWindow.rafId = null;
  }
}

function runLiveClickProgressLoop() {
  if (!activeClickWindow || typeof requestAnimationFrame !== 'function') return;
  const step = () => {
    if (!activeClickWindow) return;
    const elapsed = Date.now() - activeClickWindow.startTs;
    const percent = Math.min(100, (elapsed / LIVE_CLICK_WINDOW_MS) * 100);
    setNetworkProgress(percent, elapsed);
    refreshLiveNetworkStatusLabel();
    if (!activeClickWindow.active && percent >= 100) {
      activeClickWindow.rafId = null;
      return;
    }
    activeClickWindow.rafId = requestAnimationFrame(step);
  };
  activeClickWindow.rafId = requestAnimationFrame(step);
}

function resetLiveNetworkStats() {
  cleanupLiveClickWindowTimers();
  activeClickWindow = null;
  setNetworkProgress(0, 0);
  if (liveNetworkCount) {
    liveNetworkCount.textContent = '0';
  }
  refreshLiveNetworkStatusLabel();
}

function updateNetworkStatsUI() {
  if (!liveNetworkStats || !liveNetworkCount) return;
  if (!activeClickWindow) {
    liveNetworkCount.textContent = '0';
    refreshLiveNetworkStatusLabel();
    return;
  }
  liveNetworkCount.textContent = String(activeClickWindow.count);
  refreshLiveNetworkStatusLabel();
}

function refreshLiveNetworkStatusLabel() {
  if (!liveNetworkStatus) return;
  if (!activeClickWindow) {
    liveNetworkStatus.textContent =
      recordingState === RecordingState.RECORDING
        ? 'Click to start tracking network events.'
        : 'Start recording to track network activity.';
    return;
  }
  if (activeClickWindow.active) {
    const remaining = Math.max(0, activeClickWindow.endTs - Date.now());
    liveNetworkStatus.textContent = `${(remaining / 1000).toFixed(1)}s left in window`;
  } else {
    liveNetworkStatus.textContent = 'Window complete. Waiting for next click.';
  }
}

function setNetworkProgress(percent, elapsedOverrideMs) {
  if (!liveNetworkProgressFill) return;
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  liveNetworkProgressFill.style.width = `${clamped}%`;
  if (liveNetworkProgress) {
    const elapsedMs =
      typeof elapsedOverrideMs === 'number'
        ? elapsedOverrideMs
        : activeClickWindow
          ? Math.min(LIVE_CLICK_WINDOW_MS, Math.max(0, Date.now() - activeClickWindow.startTs))
          : 0;
    liveNetworkProgress.setAttribute('aria-valuenow', (elapsedMs / 1000).toFixed(1));
  }
}

function formatLiveEventTime(ts) {
  if (typeof ts !== 'number' || Number.isNaN(ts)) return '--:--:--';
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatLiveEventLabel(event) {
  const label = (event?.text || event?.selector || 'click').replace(/\s+/g, ' ').trim();
  return truncate(label, 100);
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

  updateLiveEventsVisibility();
  if (state !== RecordingState.RECORDING) {
    clearLiveEvents();
    resetLiveNetworkStats();
  }
  updateNetworkStatsUI();
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

function syncColumnHeights() {
  if (!analysisGrid) return;
  if (!analysisGrid.classList.contains('two-column')) {
    analysisGrid.style.removeProperty('--filters-height');
    if (jsonViewer) {
      jsonViewer.style.removeProperty('max-height');
    }
    return;
  }

  const filtersHeight = filtersSectionEl?.offsetHeight ?? null;
  if (filtersHeight) {
    analysisGrid.style.setProperty('--filters-height', `${filtersHeight}px`);
    if (jsonViewer) {
      jsonViewer.style.maxHeight = `${filtersHeight}px`;
    }
  } else {
    analysisGrid.style.removeProperty('--filters-height');
    if (jsonViewer) {
      jsonViewer.style.removeProperty('max-height');
    }
  }
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
  if (!Array.isArray(events) || !events.length) {
    lines.push('  Note over User,WebApp: No events recorded');
    return lines.join('\n');
  }

  let hasOutput = false;
  let hasActiveClick = false;

  events.forEach((event) => {
    if (event.kind === 'click') {
      const label = getClickLabelForMermaid(event);
      lines.push(`  User->>WebApp: Click "${sanitize(label)}"`);
      hasOutput = true;
      hasActiveClick = true;
      return;
    }

    if (event.kind === 'request') {
      if (!hasActiveClick) {
        return;
      }
      const requestLine = formatRequestForMermaid(event);
      if (!requestLine) {
        return;
      }
      lines.push(`  WebApp->>${requestLine.host}: ${requestLine.description}`);
      if (!requestLine.skipResponse) {
        const status = event.status || 'unknown';
        const statusText = (event.statusText || '').trim();
        lines.push(
          `  ${requestLine.host}-->>WebApp: ${status}${
            statusText ? ` ${statusText}` : ''
          }`
        );
      }
      hasOutput = true;
    }
  });

  if (!hasOutput) {
    lines.push('  Note over User,WebApp: No click-driven events recorded');
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

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'liveEvent') {
      handleLiveEventMessage(msg.event);
    }
  });
}

setRecordingState(RecordingState.IDLE);
initializeFilterUI();
updatePreview();
fetchTrace();
