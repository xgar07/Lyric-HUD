// Lyric HUD - Background Service Worker (Manifest V3)
const HTTP_SERVER_URL = 'http://127.0.0.1:3000';

let isServerConnected = false;
let lastKnownPayload = null;

console.log('[Lyric HUD] Background service worker started (HTTP Only Mode).');

// Kirim data via HTTP POST
async function sendViaHttp(payload) {
  try {
    const res = await fetch(`${HTTP_SERVER_URL}/api/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    isServerConnected = res.ok;
    return res.ok;
  } catch {
    isServerConnected = false;
    return false;
  }
}

// Handler pengiriman utama
async function dispatchPlayback(payload) {
  lastKnownPayload = payload;

  await sendViaHttp(payload);

  // Update indikator badge pada toolbar browser
  if (isServerConnected) {
    updateBadge(payload.isPlaying ? 'LIVE' : 'PAUS', payload.isPlaying ? '#10b981' : '#f59e0b');
  } else {
    updateBadge('OFF', '#6b7280');
  }
}

// Update Badge di Toolbar Chrome
function updateBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  } catch {}
}

// Listener pesan dari Content Script dan Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAYBACK_UPDATE') {
    const payload = message.payload;
    dispatchPlayback(payload);
    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'GET_EXTENSION_STATUS') {
    sendResponse({
      isServerConnected: isServerConnected,
      lastKnownPayload,
      serverUrl: HTTP_SERVER_URL
    });
    return true;
  }

  if (message.type === 'TEST_SERVER_CONNECTION') {
    fetch(`${HTTP_SERVER_URL}/api/status`)
      .then(res => res.json())
      .then(data => {
        isServerConnected = true;
        sendResponse({ success: true, data });
      })
      .catch(err => {
        isServerConnected = false;
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});
