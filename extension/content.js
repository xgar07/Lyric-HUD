// Lyric HUD - YouTube Content Script
(function () {
  'use strict';

  console.log('[Lyric HUD] Content script active on YouTube.');

  let activeVideoElement = null;
  let lastVideoId = '';
  let lastSentState = null;
  let lastTimeUpdateSent = 0;
  const TIMEUPDATE_THROTTLE_MS = 5000; // VERCEL OPTIMIZATION: Kurangi pengiriman data timeupdate dari 300ms jadi 5000ms (hemat API request)

  // 1. Ekstraksi Video ID dari URL atau player
  function extractVideoId() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const v = urlParams.get('v');
      if (v) return v;

      // Dukungan untuk URL shorts jika ada
      const shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

      // Fallback attribute video-id dari ytd-watch-flexy
      const watchFlexy = document.querySelector('ytd-watch-flexy');
      if (watchFlexy) {
        const id = watchFlexy.getAttribute('video-id');
        if (id) return id;
      }
    } catch {
      // Abaikan error parsing URL
    }
    return '';
  }

  // 2. Ekstraksi Judul Mentah (rawTitle) dari DOM YouTube
  function extractRawTitle() {
    const titleSelectors = [
      'h1.ytd-watch-metadata yt-formatted-string',
      'ytd-watch-metadata #title h1 yt-formatted-string',
      '#title h1 yt-formatted-string',
      'h1.title yt-formatted-string',
      '#above-the-fold #title'
    ];

    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }

    // Fallback meta tag title
    const metaTitle = document.querySelector('meta[name="title"]');
    if (metaTitle && metaTitle.content && metaTitle.content.trim()) {
      return metaTitle.content.trim();
    }

    // Fallback document.title
    if (document.title) {
      return document.title.replace(/\s*-\s*YouTube$/i, '').trim();
    }

    return '';
  }

  // 3. Ekstraksi Nama Channel / Artist fallback dari DOM
  function extractChannelName() {
    const channelSelectors = [
      '#channel-name #text a',
      'ytd-channel-name a',
      '#owner #channel-name a',
      '#upload-info #channel-name a',
      '#channel-name yt-formatted-string a'
    ];

    for (const selector of channelSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }

    return '';
  }

  // 4. Membersihkan tag video musik umum tanpa merusak judul lagu
  function cleanMusicVideoTags(str) {
    if (!str) return '';
    return str
      .replace(/\s*[\(\[\{]\s*(?:Official\s*(?:Music\s*|Lyric\s*|Audio\s*)?Video|Official\s*(?:MV|Audio|Lyrics?|Track)|Audio|Lyrics?|Lirik(?: \s*Terjemahan(?: \s*Indonesia)?)?|Terjemahan\s*Indonesia|Lyric\s*Video|Lyrics?\s*Video|Lyrics?\s*Terjemahan|Visualizer|Music\s*Video|MV|HD|4K|Remastered|Performance\s*Video|Live\s*Performance|Audio\s*Stream)\s*[\)\]\}]/gi, '')
      .replace(/\s*(?:\||-|–|—|•)?\s*(?:Official\s*(?:Music\s*|Lyric\s*|Audio\s*)?Video|Official\s*(?:MV|Audio|Lyrics?)|MV|Visualizer|Lyrics?|Lirik(?: \s*Terjemahan(?: \s*Indonesia)?)?|Terjemahan\s*Indonesia|Lyrics?\s*Terjemahan|Audio)\s*$/gi, '')
      .trim();
  }

  function detectVideoType(rawTitle, channelName) {
    const title = (rawTitle || '').toLowerCase();
    const channel = (channelName || '').toLowerCase();

    if (/live/.test(title) || /live/.test(channel)) return 'live';
    if (/remix/.test(title)) return 'remix';
    if (/acoustic/.test(title)) return 'acoustic';
    if (/sped up/.test(title)) return 'sped_up';
    if (/slowed/.test(title)) return 'slowed';
    if (/cover/.test(title)) return 'cover';
    if (/terjemahan|translated|indo/.test(title)) return 'translated';
    if (/lyric/.test(title) || /lirik/.test(title)) return 'lyric';
    if (/- topic/.test(channel) || / topic$/.test(channel)) return 'topic';
    if (/official audio/.test(title)) return 'official_audio';
    if (/official/.test(title) || /vevo/.test(channel)) return 'official';

    return 'unknown';
  }

  // 5. Parser Metadata YouTube
  function parseYouTubeMetadata({ rawTitle, channelName, videoId, duration }) {
    if (!rawTitle) {
      return { videoId, rawTitle: '', artist: '', title: '', channelName, duration, confidence: 'low', videoType: 'unknown' };
    }

    const cleanedTitle = cleanMusicVideoTags(rawTitle);
    const videoType = detectVideoType(rawTitle, channelName);

    let artist = '';
    let title = cleanedTitle;
    let confidence = 'low';

    // 1. Coba deteksi pola "Artist - Title"
    const delimiterMatch = cleanedTitle.match(/\s+[-–—|]\s+/);

    if (delimiterMatch) {
      const delimiter = delimiterMatch[0];
      const parts = cleanedTitle.split(delimiter);

      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();

        artist = artist.replace(/^["']|["']$/g, '').trim();
        title = title.replace(/^["']|["']$/g, '').trim();

        if (artist && title) {
          confidence = 'high';
        }
      }
    }

    // 2. Jika tidak ada delimiter di judul, coba ambil artist dari channelName jika meyakinkan
    if (!artist && channelName) {
      let cleanChannel = channelName
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/\s+Topic$/i, '')
        .replace(/\s+Official(?: Channel)?$/i, '')
        .replace(/\s+VEVO$/i, '')
        .trim();

      const isArtistChannel = /(?:Topic|Official|VEVO)/i.test(channelName);
      
      if (isArtistChannel && cleanChannel) {
        artist = cleanChannel;
        confidence = 'medium';
      } else {
        artist = '';
        confidence = 'low';
      }
    }

    return {
      videoId,
      rawTitle,
      artist,
      title,
      channelName,
      duration,
      confidence,
      videoType
    };
  }

  // 6. Mendapatkan elemen HTMLVideoElement aktif
  function getActiveVideoElement() {
    const mainVideo = document.querySelector('video.html5-main-video') ||
                      document.querySelector('#movie_player video') ||
                      document.querySelector('ytd-player video');

    if (mainVideo) return mainVideo;

    // Fallback: periksa semua video di halaman
    const allVideos = Array.from(document.querySelectorAll('video'));
    for (const v of allVideos) {
      if (!v.paused || v.currentTime > 0 || v.readyState > 0) {
        return v;
      }
    }

    return allVideos[0] || null;
  }

  // 7. Membangun Payload Playback State
  function buildPlaybackPayload() {
    const video = getActiveVideoElement();
    const videoId = extractVideoId();
    const rawTitle = extractRawTitle();
    const channelName = extractChannelName();
    const duration = video && !isNaN(video.duration) ? Number(video.duration.toFixed(2)) : 0;
    const currentTime = video ? Number(video.currentTime.toFixed(2)) : 0;
    const isPlaying = Boolean(video && !video.paused && !video.ended && video.readyState >= 2);

    const metadata = parseYouTubeMetadata({ rawTitle, channelName, videoId, duration });

    return {
      type: 'playback',
      videoId: metadata.videoId,
      rawTitle: metadata.rawTitle,
      artist: metadata.artist,
      title: metadata.title,
      channelName: metadata.channelName,
      confidence: metadata.confidence,
      videoType: metadata.videoType,
      currentTime,
      duration: metadata.duration,
      isPlaying,
      url: window.location.href
    };
  }

  // 8. Kirim State ke Background Service Worker
  function sendPlaybackState(force = false, reason = '') {
    const now = Date.now();

    if (!force && reason === 'timeupdate') {
      if (now - lastTimeUpdateSent < TIMEUPDATE_THROTTLE_MS) {
        return;
      }
    }

    const payload = buildPlaybackPayload();

    const isMetadataChanged = !lastSentState ||
      lastSentState.videoId !== payload.videoId ||
      lastSentState.rawTitle !== payload.rawTitle ||
      lastSentState.artist !== payload.artist ||
      lastSentState.title !== payload.title;

    payload.isNewSong = isMetadataChanged; // Flag untuk serverless backend agar tidak nge-spam LRCLIB

    if (
      !force &&
      !isMetadataChanged &&
      lastSentState &&
      lastSentState.isPlaying === payload.isPlaying &&
      Math.abs(lastSentState.currentTime - payload.currentTime) < 0.25
    ) {
      return;
    }

    if (isMetadataChanged) {
      console.log('\n[YOUTUBE META]');
      console.log(`Raw title: ${payload.rawTitle}`);
      console.log(`Channel: ${payload.channelName}`);
      console.log(`Parsed artist: ${payload.artist}`);
      console.log(`Parsed title: ${payload.title}`);
      console.log(`Duration: ${payload.duration}`);
      console.log(`Video Type: ${payload.videoType}`);
      console.log(`Confidence: ${payload.confidence}\n`);
    }

    lastTimeUpdateSent = now;
    lastSentState = payload;

    try {
      if (chrome?.runtime?.id) {
        chrome.runtime.sendMessage({
          type: 'PLAYBACK_UPDATE',
          payload
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    } catch (e) {}
  }

  // 9. Pasang Listener ke HTMLVideoElement
  function attachVideoListeners() {
    const video = getActiveVideoElement();

    if (!video) return;
    if (activeVideoElement === video) return;

    activeVideoElement = video;
    console.log('[Lyric HUD] HTMLVideoElement attached:', video);

    // Event video element
    const events = [
      { name: 'play', force: true },
      { name: 'pause', force: true },
      { name: 'seeking', force: true },
      { name: 'seeked', force: true },
      { name: 'ratechange', force: true },
      { name: 'ended', force: true },
      { name: 'loadedmetadata', force: true },
      { name: 'timeupdate', force: false }
    ];

    events.forEach(({ name, force }) => {
      video.addEventListener(name, () => {
        sendPlaybackState(force, name);
      }, { passive: true });
    });

    // Kirim initial state seketika
    sendPlaybackState(true, 'video_attached');
  }

  // 10. Listener Navigasi YouTube SPA & Video Change
  function handleNavigationChange() {
    const currentId = extractVideoId();
    if (currentId !== lastVideoId) {
      lastVideoId = currentId;

      if (!currentId) {
        // Pengguna meninggalkan halaman video (misal ke beranda YouTube)
        activeVideoElement = null;
        lastSentState = null;
        try {
          if (chrome?.runtime?.id) {
            chrome.runtime.sendMessage({
              type: 'PLAYBACK_UPDATE',
              payload: {
                type: 'playback',
                videoId: '',
                rawTitle: '',
                artist: '',
                title: '',
                currentTime: 0,
                duration: 0,
                isPlaying: false,
                url: window.location.href
              }
            });
          }
        } catch {}
        return;
      }

      // Beri jeda teratur agar DOM title YouTube siap
      setTimeout(() => {
        attachVideoListeners();
        sendPlaybackState(true, 'video_changed');
      }, 250);
      setTimeout(() => {
        sendPlaybackState(true, 'video_changed_delayed');
      }, 800);
    }
  }

  window.addEventListener('yt-navigate-finish', handleNavigationChange);
  window.addEventListener('yt-page-data-updated', handleNavigationChange);
  window.addEventListener('popstate', handleNavigationChange);

  // 11. Fallback Polling Ringan (400ms)
  // Memastikan deteksi stabil jika YouTube me-replace elemen video atau memperbarui judul
  let lastIntervalSync = Date.now();
  
  setInterval(() => {
    const currentId = extractVideoId();
    if (currentId !== lastVideoId) {
      handleNavigationChange();
      return;
    }

    if (!currentId) return;

    const currentVideo = getActiveVideoElement();
    if (currentVideo && currentVideo !== activeVideoElement) {
      attachVideoListeners();
      return;
    }

    // Deteksi jika judul DOM baru saja terisi setelah navigasi
    const rawTitle = extractRawTitle();
    if (lastSentState && rawTitle && rawTitle !== lastSentState.rawTitle && rawTitle !== 'YouTube') {
      sendPlaybackState(true, 'title_updated');
      return;
    }

    // VERCEL / PUSHER OPTIMIZATION: 
    // Jangan kirim sinkronisasi setiap 400ms karena akan menghabiskan kuota Vercel Functions.
    // Aplikasi React Display sudah melakukan interpolasi waktu (menebak currentTime) secara lokal setiap 100ms.
    // Ekstensi cukup melakukan sinkronisasi ulang (koreksi drift) setiap 5 detik, ATAU saat ada event seeked/play/pause.
    const now = Date.now();
    if (activeVideoElement && !activeVideoElement.paused && (now - lastIntervalSync) > 5000) {
      lastIntervalSync = now;
      sendPlaybackState(false, 'interval_check');
    }
  }, 400);

  // Inisialisasi awal
  lastVideoId = extractVideoId();
  attachVideoListeners();
  setTimeout(() => sendPlaybackState(true, 'init'), 500);
})();
