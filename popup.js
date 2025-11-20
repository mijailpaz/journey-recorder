const startBtn = document.getElementById('startCaptureBtn');
const stopBtn = document.getElementById('stopCaptureBtn');
const downloadBtn = document.getElementById('downloadCaptureBtn');
const statusEl = document.getElementById('status');

let mediaRecorder = null;
let captureStream = null;
let videoChunks = [];
let lastVideoBlob = null;

startBtn.onclick = async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    updateStatus('Capture already running.');
    return;
  }

  try {
    captureStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });
    videoChunks = [];
    lastVideoBlob = null;
    updateStatus('Capture started. Sharing current screen/tab.');

    chrome.runtime.sendMessage({ type: 'videoStarted', ts: Date.now() }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to notify background about video start', chrome.runtime.lastError);
      }
    });

    mediaRecorder = new MediaRecorder(captureStream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        videoChunks.push(event.data);
      }
    };
    mediaRecorder.onstop = handleRecorderStop;
    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error', event.error);
      updateStatus('Recorder error. See console for details.');
    };
    mediaRecorder.start();

    captureStream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      };
    });
  } catch (error) {
    console.warn('Display capture denied or failed', error);
    updateStatus('Unable to start capture: ' + (error?.message || error));
  }
};

stopBtn.onclick = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else if (captureStream) {
    captureStream.getTracks().forEach((track) => track.stop());
    captureStream = null;
    updateStatus('Capture stopped.');
  } else {
    updateStatus('No active capture to stop.');
  }
};

downloadBtn.onclick = () => {
  if (!lastVideoBlob) {
    updateStatus('No finished capture to download yet.');
    return;
  }
  download(lastVideoBlob, 'journey-popup.webm');
};

function handleRecorderStop() {
  if (captureStream) {
    captureStream.getTracks().forEach((track) => track.stop());
    captureStream = null;
  }

  if (videoChunks.length > 0) {
    lastVideoBlob = new Blob(videoChunks, { type: 'video/webm' });
    chrome.runtime.sendMessage({ type: 'videoSaved', blob: lastVideoBlob }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to send video blob to background', chrome.runtime.lastError);
      }
    });
    updateStatus('Capture finished. You can download from popup or DevTools panel.');
  } else {
    lastVideoBlob = null;
    updateStatus('Capture ended with no data.');
  }

  mediaRecorder = null;
  videoChunks = [];
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function updateStatus(message) {
  statusEl.textContent = message;
}
