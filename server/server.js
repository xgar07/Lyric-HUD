const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getLyrics } = require('./lyricsService');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const DIST_DIR = path.resolve(__dirname, '../display/dist');

// In-memory playback state (tanpa database, realtime di RAM)
let currentTrack = {
  type: 'playback',
  videoId: '',
  rawTitle: 'Belum ada lagu yang diputar',
  title: 'Belum ada lagu yang diputar',
  artist: 'Menunggu YouTube...',
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  url: '',
  updatedAt: Date.now()
};

// In-memory synced lyrics state
let currentLyrics = {
  type: 'lyrics',
  status: 'unavailable',
  artist: '',
  title: '',
  lines: []
};

let lastLyricsQueryKey = '';

// Fungsi update playback state terpusat
function updatePlaybackState(payload) {
  if (!payload || typeof payload !== 'object') return currentTrack;

  currentTrack = {
    type: 'playback',
    videoId: typeof payload.videoId === 'string' ? payload.videoId : (currentTrack.videoId || ''),
    rawTitle: typeof payload.rawTitle === 'string'
      ? payload.rawTitle.trim()
      : (typeof payload.title === 'string' ? payload.title.trim() : (currentTrack.rawTitle || '')),
    title: typeof payload.title === 'string' ? payload.title.trim() : (currentTrack.title || ''),
    artist: typeof payload.artist === 'string' ? payload.artist.trim() : (currentTrack.artist || ''),
    currentTime: typeof payload.currentTime === 'number' ? payload.currentTime : (Number(payload.currentTime) || 0),
    duration: typeof payload.duration === 'number' ? payload.duration : (Number(payload.duration) || 0),
    isPlaying: Boolean(payload.isPlaying),
    url: typeof payload.url === 'string' ? payload.url : (currentTrack.url || ''),
    videoType: typeof payload.videoType === 'string' ? payload.videoType : (currentTrack.videoType || 'unknown'),
    updatedAt: Date.now()
  };

  return currentTrack;
}

// Logika pencarian lirik: Hanya mencari jika video/lagu berganti
async function checkAndFetchLyrics(track) {
  if (!track.title || track.title === 'Belum ada lagu yang diputar' || track.title === 'Menunggu YouTube...') {
    if (lastLyricsQueryKey !== '') {
      lastLyricsQueryKey = '';
      currentLyrics = {
        type: 'lyrics',
        status: 'idle',
        artist: '',
        title: '',
        lines: []
      };
      broadcastToDisplays(currentLyrics);
    }
    return;
  }

  const queryKey = `${track.videoId || ''}:::${(track.artist || '').toLowerCase().trim()}:::${(track.title || '').toLowerCase().trim()}`;

  // FIX: JANGAN request ulang jika lagunya sama (baik sedang mencari, ketemu, atau tidak ada)
  if (queryKey === lastLyricsQueryKey) {
    return;
  }

  lastLyricsQueryKey = queryKey;
  console.log(`[Server] Lagu berganti -> Lookup lirik LRCLIB: "${track.title}" - ${track.artist}`);

  // Segera reset state lirik agar lirik lagu sebelumnya tidak tertinggal di layar HP
  currentLyrics = {
    type: 'lyrics',
    status: 'searching',
    artist: track.artist,
    title: track.title,
    lines: []
  };
  broadcastToDisplays(currentLyrics);

  try {
    const lyricsResult = await getLyrics({
      artist: track.artist,
      title: track.title,
      duration: track.duration,
      videoType: track.videoType
    });

    // Pengecekan race-condition:
    // Pastikan lagu yang aktif belum berganti lagi selama kita menunggu API
    const activeKey = `${currentTrack.videoId || ''}:::${(currentTrack.artist || '').toLowerCase().trim()}:::${(currentTrack.title || '').toLowerCase().trim()}`;
    if (activeKey === queryKey) {
      currentLyrics = lyricsResult;
      broadcastToDisplays(currentLyrics);
    }
  } catch (err) {
    console.error('[Server] Gagal mendapatkan lirik:', err.message);
    const activeKey = `${currentTrack.videoId || ''}:::${(currentTrack.artist || '').toLowerCase().trim()}:::${(currentTrack.title || '').toLowerCase().trim()}`;
    if (activeKey === queryKey) {
      currentLyrics = {
        type: 'lyrics',
        status: 'unavailable',
        artist: track.artist,
        title: track.title,
        lines: []
      };
      broadcastToDisplays(currentLyrics);
    }
  }
}

// MIME types untuk static file serving dari Vite build
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Mendapatkan semua IP LAN lokal untuk dibuka di HP
function getLanIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const interfaceName of Object.keys(interfaces)) {
    const ifaceList = interfaces[interfaceName];
    if (!ifaceList) continue;

    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: interfaceName,
          address: iface.address
        });
      }
    }
  }

  return addresses;
}

// Inisialisasi HTTP Server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Endpoint 1: Health check & status
  if (pathname === '/api/status' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      track: currentTrack,
      lyricsStatus: currentLyrics.status
    }, null, 2));
    return;
  }

  // Endpoint 2: GET current playback state
  if (pathname === '/api/playback' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(currentTrack));
    return;
  }

  // Endpoint 3: GET current lyrics state
  if (pathname === '/api/lyrics' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(currentLyrics));
    return;
  }

  // Endpoint 4: POST update playback dari Chrome Extension (HTTP Fallback)
  if ((pathname === '/api/playback' || pathname === '/api/update') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        updatePlaybackState(payload.payload || payload);
        broadcastToDisplays(currentTrack);

        // Cek dan lookup lirik jika video/lagu berubah
        checkAndFetchLyrics(currentTrack);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, timestamp: currentTrack.updatedAt, track: currentTrack }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload', message: err.message }));
      }
    });
    return;
  }

  // Endpoint 5: Serve React Production Build dari folder display/dist
  serveStaticOrFallback(req, res, pathname);
});

// Helper fungsi untuk serve static files dari display/dist
function serveStaticOrFallback(req, res, pathname) {
  const distExists = fs.existsSync(DIST_DIR);

  if (!distExists) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Lyric HUD - Server Active</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #0c0d14; color: #f3f4f6; margin: 0; padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; box-sizing: border-box; }
          .card { background: #161826; border: 1px solid #282b40; border-radius: 12px; padding: 2rem; max-width: 540px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          h1 { margin-top: 0; color: #38bdf8; font-size: 1.5rem; }
          .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 6px 12px; border-radius: 9999px; font-weight: bold; font-size: 0.875rem; margin-bottom: 1rem; }
          .dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981; }
          code { background: #222538; padding: 3px 8px; border-radius: 6px; font-family: monospace; color: #a5b4fc; }
          pre { background: #10121d; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.9rem; color: #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="status"><span class="dot"></span> Server Berjalan</div>
          <h1>Lyric HUD Local Server</h1>
          <p>Display React production build belum ditemukan di folder <code>display/dist</code>.</p>
          <p>Jalankan perintah:</p>
          <pre>npm run build</pre>
          <p style="margin-top: 1.5rem; font-size: 0.85rem; color: #94a3b8;">
            Status API: <a href="/api/status" style="color: #38bdf8;">/api/status</a> |
            Playback Data: <a href="/api/playback" style="color: #38bdf8;">/api/playback</a> |
            Lyrics Data: <a href="/api/lyrics" style="color: #38bdf8;">/api/lyrics</a>
          </p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(DIST_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
        });
        res.end(content);
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

// Inisialisasi Pusher
const Pusher = require('pusher');
require('dotenv').config();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || 'dummy_app_id',
  key: process.env.PUSHER_KEY || 'dummy_key',
  secret: process.env.PUSHER_SECRET || 'dummy_secret',
  cluster: process.env.PUSHER_CLUSTER || 'ap1',
  useTLS: true
});

let lastPusherUpdate = 0;
let lastPusherPlayState = null;
let lastPusherVideoId = null;

function broadcastToDisplays(messageObj) {
  // Throttling hanya untuk pesan playback
  if (messageObj.type === 'playback') {
    const now = Date.now();
    const isStateChange = lastPusherPlayState !== currentTrack.isPlaying;
    const isVideoChange = lastPusherVideoId !== currentTrack.videoId;
    
    if (!isStateChange && !isVideoChange && (now - lastPusherUpdate) < 1000) {
      return; // Throttle pesan playback posisi yang terlalu sering
    }
    
    lastPusherUpdate = now;
    lastPusherPlayState = currentTrack.isPlaying;
    lastPusherVideoId = currentTrack.videoId;
  }

  // Trigger event 'update' ke channel 'now-playing'
  pusher.trigger('now-playing', 'update', messageObj).catch(err => {
    console.error('[Pusher] Trigger error:', err);
  });
}

// Menjalankan server pada port dan host 0.0.0.0
server.listen(PORT, HOST, () => {
  const lanIps = getLanIpAddresses();

  console.log('\n======================================================');
  console.log('   🎵  LYRIC HUD - LOCAL SERVER READY  🎵');
  console.log('======================================================');
  console.log(`Local Access (Laptop):  http://localhost:${PORT}`);

  if (lanIps.length > 0) {
    console.log('\n Akses dari HP (Pastikan satu jaringan Wi-Fi):');
    lanIps.forEach(net => {
      console.log(`   👉 http://${net.address}:${PORT}  (${net.interface})`);
    });
  }

  console.log(`\nPusher Endpoint:         Pusher Channel 'now-playing'`);
  console.log(`Health Check Endpoint:   http://localhost:${PORT}/api/status`);
  console.log(`Lyrics API Endpoint:     http://localhost:${PORT}/api/lyrics`);
  console.log('======================================================\n');
});
