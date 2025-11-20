const statusEl = document.getElementById('status');

let sourceTabId = null;
let mediaRecorder = null;
let captureStream = null;
let chunks = [];
let recordingStartedAt = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'initRecorder') {
    sourceTabId = msg.sourceTabId || null;
    beginDesktopCapture();
  }

  if (msg.type === 'stopScreenRecording') {
    stopRecording();
  }
});

function beginDesktopCapture() {
  updateStatus('Requesting screen/tab permission…');
  chrome.desktopCapture.chooseDesktopMedia(['tab', 'window', 'screen'], (streamId) => {
    if (!streamId) {
      notifyError('User cancelled screen selection');
      window.close();
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId
          }
        }
      })
      .then((stream) => {
        captureStream = stream;
        recordingStartedAt = Date.now();
        chunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = (evt) => {
          if (evt.data && evt.data.size > 0) {
            chunks.push(evt.data);
          }
        };
        mediaRecorder.onerror = (evt) => {
          notifyError(evt.error?.message || evt.error || 'MediaRecorder error');
          stopRecording();
        };
        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const dataUrl = await blobToDataUrl(blob);
          chrome.runtime.sendMessage({
            type: 'videoRecorded',
            dataUrl
          });
          window.close();
        };

        chrome.runtime.sendMessage({ type: 'videoStarted', ts: recordingStartedAt });
        chrome.runtime.sendMessage({ type: 'recordingReady', tabId: sourceTabId });

        mediaRecorder.start();
        updateStatus('Recording… use the inspected tab, then click Stop in Flow Recorder.');
      })
      .catch((error) => {
        notifyError(error?.message || error);
        window.close();
      });
  });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (captureStream) {
    captureStream.getTracks().forEach((track) => track.stop());
    captureStream = null;
  }
}

function notifyError(message) {
  chrome.runtime.sendMessage({ type: 'recordingError', error: message });
  updateStatus(`Recording error: ${message}`);
}

function updateStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
