# Journey Flow Recorder

Chrome DevTools companion extension that records an interactive session as a synchronized timeline of user clicks, network requests, and tab video. Exports include:

- `trace.json`: raw ordered events with timestamps and metadata
- `journey.webm`: video captured via a desktop capture helper tab
- `flow.mmd`: Mermaid sequence diagram generated from the timeline

## Directory Layout

```
journey-recorder/
├── manifest.json        # MV3 manifest and permissions
├── background.js        # Event hub, storage, and recording tab orchestration
├── devtools.html/js     # Registers DevTools panel and logs network traffic
├── panel.html/js        # DevTools panel UI + export helpers
├── recording_screen.html/js # Standalone capture tab that requests desktop recording
├── contentScript.js     # Captures DOM click metadata
└── FlowRecorder.md      # Original architecture notes
```

## Prerequisites

- Google Chrome 120+ (or Chromium-based browser with DevTools extensions)
- Node is not required; all files are plain JS/HTML

## Developing Locally

1. Clone or copy the repository locally.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this `journey-recorder` folder.
5. Open any tab you want to inspect, then open DevTools (`Cmd+Opt+I` / `Ctrl+Shift+I`).
6. Select the **Flow Recorder** DevTools panel.
7. Use the panel buttons:
   - `Start recording`: clears previous events, begins click + network logging, and opens a temporary helper tab that prompts for desktop capture. **Grant the “Share this tab/window” prompt** and Chrome will refocus the inspected tab automatically.
   - `Stop recording`: stops click/network capture and signals the helper tab to stop the `MediaRecorder`.
   - `Export JSON`: downloads `trace.json` with all events and video metadata.
   - `Export Mermaid`: downloads `flow.mmd` and shows diagram text in the textarea.
   - `Download Video`: downloads `journey.webm` if a capture is available.
8. Make code edits in your editor; Chrome auto-reloads DevTools resources when the panel is reopened. For the background/service worker, click the **reload** icon beside the extension entry in `chrome://extensions` to pick up changes.

## Testing & Verification

Because this project relies on Chrome extension APIs, verification is manual:

1. Load the unpacked extension as described above.
2. Navigate to a target site, open DevTools → Flow Recorder.
3. Click `Start recording`. When the helper tab appears, pick the tab/window you want to capture in the Chrome prompt, then return to the inspected tab. Perform a few UI interactions and trigger network calls.
4. Click `Stop recording` and use each export button. Confirm:
   - `trace.json` contains timestamped `click` and `request` events.
   - `journey.webm` plays back the captured tab session.
   - `flow.mmd` opens in a Mermaid renderer (e.g., VS Code extension, https://mermaid.live/) and matches the observed flow.
5. If something fails, reopen `chrome://extensions`, open the service worker console, and check for runtime errors. The helper tab also prints status text if capture fails (e.g., restricted Chrome pages).

> Tip: If Chrome reports “Extension has not been invoked for the current page”, reload the target tab, reopen DevTools, and click Start again. The helper tab ensures capture works even when DevTools itself cannot call `tabCapture`.
