import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';
import Pusher from 'pusher-js';
import './App.css';

// Format detik ke format mm:ss atau hh:mm:ss
function formatTime(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Binary search efisien (O(log N)) untuk mencari baris aktif berdasarkan currentTime
function findActiveLyricIndex(lines, currentTime) {
  if (!lines || lines.length === 0) return -1;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= currentTime) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [track, setTrack] = useState({
    type: 'playback',
    videoId: '',
    rawTitle: '',
    title: '',
    artist: '',
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    url: ''
  });

  const [lyrics, setLyrics] = useState({
    status: 'idle',
    artist: '',
    title: '',
    candidateDuration: 0,
    lines: [],
    plainLyrics: ''
  });

  const [lyricMode, setLyricMode] = useState('SYNC');

  const [displayTime, setDisplayTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Display Mode: 'normal' | 'dim' | 'ultra-dim' (cocok untuk ruangan gelap/tidur)
  const [displayMode, setDisplayMode] = useState(() => {
    return localStorage.getItem('lyric_hud_dim_mode') || 'normal';
  });

  // Tap UI: Kontrol tersembunyi secara default, muncul saat layar disentuh
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef(null);

  // Modal QR Pairing / Connect Device
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Manual Lyrics Sync Offset
  const [syncOffset, setSyncOffset] = useState(0);
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  // Debug Mode (?debug=1)
  const [debugMode, setDebugMode] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      return false;
    }
  });

  const pusherRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Koneksi Pusher otomatis dengan auto-reconnect
  useEffect(() => {
    let isSubscribed = true;

    function connect() {
      try {
        const pusher = new Pusher(import.meta.env.VITE_PUSHER_KEY || 'dummy_key', {
          cluster: import.meta.env.VITE_PUSHER_CLUSTER || 'ap1'
        });
        pusherRef.current = pusher;

        pusher.connection.bind('state_change', (states) => {
          if (!isSubscribed) return;
          setIsConnected(states.current === 'connected');
        });

        const channel = pusher.subscribe('now-playing');
        
        channel.bind('update', (message) => {
          if (!isSubscribed) return;
          try {
            // Handler pesan lirik
            if (message.type === 'lyrics') {
              setLyrics({
                status: message.status || 'unavailable',
                artist: message.artist || '',
                title: message.title || '',
                candidateDuration: message.candidateDuration || 0,
                lines: Array.isArray(message.lines) ? message.lines : [],
                plainLyrics: message.plainLyrics || ''
              });
              return;
            }

            // Handler pesan playback YouTube
            if (message.type === 'playback' || message.videoId !== undefined) {
              const data = message.payload || message.data || message;

              setTrack(prev => {
                // Jika video/lagu berganti, reset state lirik
                if (data.videoId && data.videoId !== prev.videoId) {
                  setLyrics(l => ({ ...l, status: 'searching', lines: [] }));
                }
                return {
                  type: 'playback',
                  videoId: data.videoId || '',
                  rawTitle: data.rawTitle || data.title || '',
                  title: data.title || '',
                  artist: data.artist || '',
                  currentTime: Number(data.currentTime) || 0,
                  duration: Number(data.duration) || 0,
                  isPlaying: Boolean(data.isPlaying),
                  url: data.url || ''
                };
              });

              setDisplayTime(Number(data.currentTime) || 0);
            }
          } catch (err) {
            console.error('[Lyric HUD] Error parsing Pusher data:', err);
          }
        });

      } catch (err) {
        console.error('[Lyric HUD] Pusher setup error:', err);
      }
    }

    connect();

    return () => {
      isSubscribed = false;
      if (pusherRef.current) {
        pusherRef.current.disconnect();
      }
    };
  }, []);

  // Timer interpolasi 100ms saat playback aktif
  useEffect(() => {
    if (!track.isPlaying) return;

    const interval = setInterval(() => {
      setDisplayTime((prev) => {
        if (track.duration > 0 && prev >= track.duration) {
          return track.duration;
        }
        return Number((prev + 0.1).toFixed(2));
      });
    }, 100);

    return () => clearInterval(interval);
  }, [track.isPlaying, track.duration]);

  // Sinkronisasi displayTime saat server mengirim update currentTime
  useEffect(() => {
    setDisplayTime(track.currentTime || 0);
  }, [track.currentTime, track.videoId]);

  // Load manual sync offset when track changes
  const offsetKey = track.videoId 
    ? `lyric_sync_offset:${track.videoId}` 
    : (track.artist || track.title ? `lyric_sync_offset:${(track.artist||'').toLowerCase()}_${(track.title||'').toLowerCase()}` : null);

  useEffect(() => {
    if (offsetKey) {
      const saved = localStorage.getItem(offsetKey);
      setSyncOffset(saved ? parseFloat(saved) : 0);
    } else {
      setSyncOffset(0);
    }
  }, [offsetKey]);

  const handleOffsetChange = (e, delta) => {
    e.stopPropagation();
    setSyncOffset(prev => {
      let next = prev + delta;
      next = Math.max(-120, Math.min(120, next)); // Clamp to -120s to +120s to support large intro/outro differences
      if (offsetKey) {
        localStorage.setItem(offsetKey, next.toString());
      }
      return next;
    });
  };

  const handleOffsetReset = (e) => {
    e.stopPropagation();
    setSyncOffset(0);
    if (offsetKey) {
      localStorage.removeItem(offsetKey);
    }
  };

  // Load manual lyric mode when track changes
  const modeKey = track.videoId 
    ? `lyric_mode:${track.videoId}` 
    : (track.artist || track.title ? `lyric_mode:${(track.artist||'').toLowerCase()}_${(track.title||'').toLowerCase()}` : null);

  useEffect(() => {
    if (modeKey) {
      const saved = localStorage.getItem(modeKey);
      if (saved) {
        setLyricMode(saved);
      } else {
        setLyricMode(lyrics.status === 'plain' ? 'FULL_TEXT' : 'SYNC');
      }
    }
  }, [modeKey, lyrics.status]);

  const handleModeChange = (newMode) => {
    setLyricMode(newMode);
    if (modeKey) {
      localStorage.setItem(modeKey, newMode);
    }
  };

  // Smart Version Detection
  const durationDiff = track.duration > 0 && lyrics.candidateDuration > 0
    ? Math.round(track.duration - lyrics.candidateDuration)
    : 0;
  const versionMismatch = Math.abs(durationDiff) > 5;

  // Screen WakeLock API agar layar HP tidak mati otomatis
  const toggleWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        if (!wakeLockActive) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          setWakeLockActive(true);
          wakeLockRef.current.addEventListener('release', () => {
            setWakeLockActive(false);
          });
        } else if (wakeLockRef.current) {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
          setWakeLockActive(false);
        }
      } catch (err) {
        console.warn('Wake Lock error:', err);
      }
    }
  };

  // Fullscreen mode
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Tap Layar: Tampilkan kontrol dan sembunyikan otomatis setelah 3.5 detik
  const triggerControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3500);
  }, []);

  const handleScreenTap = () => {
    if (showControls) {
      setShowControls(false);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    } else {
      triggerControls();
    }
  };

  // Siklus Display Brightness Mode: Normal -> Dim -> Ultra Dim -> Normal
  const cycleDisplayMode = () => {
    const modes = ['normal', 'dim', 'ultra-dim'];
    const nextIndex = (modes.indexOf(displayMode) + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setDisplayMode(nextMode);
    localStorage.setItem('lyric_hud_dim_mode', nextMode);
    triggerControls();
  };

  // Buka Modal QR Code Pairing
  const openPairingModal = async (e) => {
    e?.stopPropagation();
    try {
      const url = window.location.href.split('?')[0];
      const qr = await QRCode.toDataURL(url, {
        margin: 1,
        width: 260,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      setQrCodeUrl(qr);
      setShowPairingModal(true);
    } catch (err) {
      console.error('QR code generation error:', err);
    }
  };

  const copyPairingUrl = (e) => {
    e?.stopPropagation();
    const url = window.location.href.split('?')[0];
    navigator.clipboard.writeText(url).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  // Algoritma Penentuan 4 Baris Lirik (Previous, Current, Next 1, Next 2)
  const activeIndex = useMemo(() => {
    const effectiveTime = displayTime - syncOffset;
    const index = findActiveLyricIndex(lyrics.lines, effectiveTime);
    
    // DEBUG LOG
    console.log('[SYNC DEBUG]', {
      currentTime: displayTime,
      syncOffset,
      effectiveTime,
      activeIndex: index
    });

    return index;
  }, [lyrics.lines, displayTime, syncOffset]);



  const hasTrack = Boolean(track.title && track.title !== 'Belum ada lagu yang diputar');
  const progressPercentage = track.duration > 0
    ? Math.min(100, Math.max(0, (displayTime / track.duration) * 100))
    : 0;
  
  const currentMode = lyrics.status === 'plain' ? 'FULL_TEXT' : lyricMode;

  const thumbnailUrl = track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/maxresdefault.jpg` : '';

  return (
    <div
      className={`hud-stage mode-${displayMode}`}
      onClick={handleScreenTap}
    >
      {/* Background Dinamis (Album Art + Blur Overlay) */}
      <div 
        className="hud-background" 
        style={thumbnailUrl ? { backgroundImage: `url(${thumbnailUrl})` } : {}}
      >
        <div className="hud-background-overlay" />
      </div>

      <div className="hud-content">
        {/* 1. Header Informasi Lagu (Atas - Tengah) */}
        <header className="hud-song-header">
          <div className="song-artist-label">
            {hasTrack ? (track.artist || 'YouTube') : ''}
          </div>
          <div className="song-title-label">
            {hasTrack ? track.title : ''}
          </div>
        </header>

        {/* 2. Focused Lyric Stage (Tengah) */}
        <main className="hud-lyric-stage">
          {!isConnected ? (
            /* Belum Tersambung */
            <div className="lyric-state-message">
              <span className="state-pulse-dot" />
              <span className="state-text">CONNECTING...</span>
            </div>
          ) : !hasTrack ? (
            /* Menunggu Lagu */
            <div className="lyric-state-message">
              <span className="state-icon">🎵</span>
              <span className="state-text">WAITING FOR SONG...</span>
            </div>
          ) : lyrics.status === 'searching' ? (
            /* Sedang Mencari Lirik */
            <div className="lyric-state-message">
              <span className="state-text shimmer">SEARCHING LYRICS...</span>
            </div>
          ) : lyrics.status === 'found' && currentMode === 'SYNC' && lyrics.lines.length > 0 ? (
            /* Moving Lyric Window (SYNC MODE) */
            <div className="focused-lyrics-container">
              {activeIndex === -1 && (
                <div className="lyric-slot slot-current" key="intro">
                  ♪ ♪ ♪
                </div>
              )}
              {lyrics.lines.map((line, index) => {
                const diff = index - activeIndex;
                if (diff < -2 || diff > 2) return null;

                let slotClass = '';
                if (diff === -2) slotClass = 'slot-prev-hidden';
                else if (diff === -1) slotClass = 'slot-prev';
                else if (diff === 0) slotClass = 'slot-current';
                else if (diff === 1) slotClass = 'slot-next-1';
                else if (diff === 2) slotClass = 'slot-next-2';

                return (
                  <div key={index} className={`lyric-slot ${slotClass}`}>
                    {line.text || '♪'}
                  </div>
                );
              })}
            </div>
          ) : currentMode === 'FULL_TEXT' && (lyrics.status === 'found' || lyrics.status === 'plain') ? (
            /* Plain Lyrics / Full Text Mode (Manual Scroll) */
            <div className="plain-lyrics-container">
              {lyrics.status === 'plain' && (
                <div className="lyric-state-message" style={{ marginBottom: '1.5rem' }}>
                  <span className="state-text" style={{ fontSize: '1rem', letterSpacing: '1px' }}>Lyrics available — sync unavailable</span>
                </div>
              )}
              <div className="plain-lyrics-text">
                {lyrics.status === 'found' 
                  ? lyrics.lines.map((l, i) => <div key={i} className="plain-line">{l.text || '♪'}</div>)
                  : lyrics.plainLyrics}
              </div>
            </div>
          ) : (
            /* Lirik Sinkron Tidak Tersedia */
            <div className="lyric-state-message unavailable">
              <span className="state-text">LYRICS UNAVAILABLE</span>
            </div>
          )}
        </main>
      </div>

      {/* 3. Full-width Progress Bar (Bawah) */}
      {hasTrack && track.duration > 0 && (
        <div className="hud-full-progress-bar">
          <span className="progress-time">{formatTime(displayTime)}</span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <span className="progress-time">{formatTime(track.duration)}</span>
        </div>
      )}

      {/* 4. Tap-To-Show Controls Overlay (Menghilang Otomatis) */}
      <aside
        className={`hud-controls-overlay ${showControls ? 'active' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overlay-top-row">
          {/* Indikator Koneksi Minimalis */}
          <div className="connection-indicator">
            <span className={`conn-dot ${isConnected ? 'online' : 'offline'}`} />
            <span className="conn-label">
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="overlay-actions">
            {/* Display Brightness Mode */}
            <button
              className="overlay-btn mode-btn"
              onClick={cycleDisplayMode}
              title="Ganti Kecerahan (Normal / Dim / Ultra Dim)"
            >
              {displayMode === 'normal' && '🔆 Normal'}
              {displayMode === 'dim' && '🔅 Dim'}
              {displayMode === 'ultra-dim' && '🌑 Ultra Dim'}
            </button>

            {/* Wake Lock */}
            {'wakeLock' in navigator && (
              <button
                className={`overlay-btn ${wakeLockActive ? 'active' : ''}`}
                onClick={toggleWakeLock}
                title="Layar HP Tetap Menyala"
              >
                💡 {wakeLockActive ? 'Awake' : 'Sleep'}
              </button>
            )}

            {/* Connect Device QR Modal */}
            <button
              className="overlay-btn"
              onClick={openPairingModal}
              title="Hubungkan Perangkat Lain"
            >
              🔗 Connect
            </button>

            {/* Sync Lyrics Button */}
            <button
              className={`overlay-btn ${showSyncPanel ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowSyncPanel(p => !p); }}
              title="Manual Lyrics Sync"
            >
              ⚙
            </button>

            {/* Fullscreen Button */}
            <button
              className="overlay-btn"
              onClick={toggleFullscreen}
              title="Mode Layar Penuh"
            >
              {isFullscreen ? '⤦ Exit' : '⛶ Fullscreen'}
            </button>

            {/* Debug Toggle */}
            {debugMode && (
              <button
                className="overlay-btn active"
                onClick={() => setDebugMode(false)}
                title="Tutup Debug"
              >
                🐞
              </button>
            )}
          </div>
        </div>

        {/* Settings Drawer (Sync & Modes) */}
        {showSyncPanel && (
          <div className="settings-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Mode Switcher */}
            <div className="settings-section">
              <div className="settings-header">LYRICS MODE</div>
              <div className="mode-switcher">
                <button 
                  className={`mode-btn ${currentMode === 'SYNC' ? 'active' : ''}`}
                  onClick={() => handleModeChange('SYNC')}
                  disabled={lyrics.status === 'plain'}
                >
                  SYNC
                </button>
                <button 
                  className={`mode-btn ${currentMode === 'FULL_TEXT' ? 'active' : ''}`}
                  onClick={() => handleModeChange('FULL_TEXT')}
                >
                  FULL TEXT
                </button>
              </div>
            </div>

            {/* Smart Version Warning */}
            {versionMismatch && currentMode === 'SYNC' && (
              <div className="smart-warning-box">
                <div className="warning-text">⚠ Video version may differ</div>
                <button 
                  className="auto-align-btn"
                  onClick={(e) => handleOffsetChange(e, durationDiff - syncOffset)}
                >
                  Apply {durationDiff > 0 ? '+' : ''}{durationDiff}s
                </button>
              </div>
            )}

            {/* Manual Sync Controls */}
            {currentMode === 'SYNC' && (
              <div className="settings-section">
                <div className="settings-header">MANUAL SYNC</div>
                <div className="sync-offset-controls">
                  <button className="sync-btn" onClick={(e) => handleOffsetChange(e, -0.5)}>
                    -0.5s
                  </button>
                  <div className="sync-offset-display">
                    {syncOffset > 0 ? `+${syncOffset.toFixed(1)}` : syncOffset.toFixed(1)}s
                  </div>
                  <button className="sync-btn" onClick={(e) => handleOffsetChange(e, 0.5)}>
                    +0.5s
                  </button>
                </div>
                <button className="sync-reset-btn" onClick={handleOffsetReset}>
                  RESET
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* 5. Modal QR Pairing (Connect Device) */}
      {showPairingModal && (
        <div
          className="pairing-modal-backdrop"
          onClick={() => setShowPairingModal(false)}
        >
          <div
            className="pairing-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pairing-header">
              <h3>Connect Device</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowPairingModal(false)}
              >
                ✕
              </button>
            </div>
            <p className="pairing-subtitle">
              Scan QR code dengan kamera HP untuk membuka Lyric HUD di jaringan Wi-Fi yang sama:
            </p>
            {qrCodeUrl && (
              <div className="qr-container">
                <img src={qrCodeUrl} alt="QR Code Link" className="qr-image" />
              </div>
            )}
            <div className="url-copy-box">
              <span className="url-text">{window.location.href.split('?')[0]}</span>
              <button className="copy-url-btn" onClick={copyPairingUrl}>
                {copyFeedback ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Panel Debug Live (Jika ?debug=1) */}
      {debugMode && (
        <div className="compact-debug-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="debug-drawer-header">
            <span>DEBUG JSON (?debug=1)</span>
            <button onClick={() => setDebugMode(false)}>✕</button>
          </div>
          <pre className="debug-drawer-code">
            <code>
              {JSON.stringify({
                time: displayTime,
                track: { title: track.title, artist: track.artist, isPlaying: track.isPlaying },
                lyrics: { status: lyrics.status, activeIndex, totalLines: lyrics.lines.length }
              }, null, 2)}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}
