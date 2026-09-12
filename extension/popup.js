// Lyric HUD - Popup Logic
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateUI(status) {
  const badge = document.getElementById('server-badge');
  const titleEl = document.getElementById('track-title');
  const artistEl = document.getElementById('track-artist');
  const progressBar = document.getElementById('progress-bar');
  const currentEl = document.getElementById('time-current');
  const durationEl = document.getElementById('time-duration');
  const statusPill = document.getElementById('playback-status');

  if (status.isServerConnected) {
    badge.textContent = 'Server: Online';
    badge.className = 'badge badge-online';
  } else {
    badge.textContent = 'Server: Offline';
    badge.className = 'badge badge-offline';
  }

  const payload = status.lastKnownPayload;
  if (payload) {
    titleEl.textContent = payload.title || 'Tidak ada judul';
    artistEl.textContent = payload.artist || '-';
    currentEl.textContent = formatTime(payload.currentTime);
    durationEl.textContent = formatTime(payload.duration);

    const progress = payload.duration > 0 ? (payload.currentTime / payload.duration) * 100 : 0;
    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;

    if (payload.isPlaying) {
      statusPill.textContent = 'PLAYING';
      statusPill.className = 'status-pill playing';
    } else {
      statusPill.textContent = 'PAUSED';
      statusPill.className = 'status-pill paused';
    }
  } else {
    titleEl.textContent = 'Buka video di YouTube...';
    artistEl.textContent = '-';
    statusPill.textContent = 'IDLE';
    statusPill.className = 'status-pill';
  }
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'GET_EXTENSION_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      // Background worker might be waking up
      return;
    }
    updateUI(response);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  refreshStatus();

  // Polling update UI tiap 1 detik saat popup terbuka
  const interval = setInterval(refreshStatus, 1000);
  window.addEventListener('unload', () => clearInterval(interval));

  // Tombol buka display
  document.getElementById('btn-open-display').addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:3000' });
  });

  // Tombol test koneksi server
  document.getElementById('btn-test-conn').addEventListener('click', () => {
    const badge = document.getElementById('server-badge');
    badge.textContent = 'Checking...';
    chrome.runtime.sendMessage({ type: 'TEST_SERVER_CONNECTION' }, (response) => {
      refreshStatus();
    });
  });
});
