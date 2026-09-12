const Pusher = require('pusher');
const { getLyrics } = require('../server/lyricsService.js');

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'ap1',
  useTLS: true
});

module.exports = async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body.payload || req.body;
    
    // 1. Broadcast Playback State via Pusher
    await pusher.trigger('now-playing', 'update', payload);

    // 2. Jika lagu berubah (isNewSong = true), lakukan pencarian Lirik secara asinkron
    if (payload.isNewSong && payload.title && payload.title !== 'Belum ada lagu yang diputar') {
      
      // Kirim status searching ke client
      await pusher.trigger('now-playing', 'update', {
        type: 'lyrics',
        status: 'searching',
        artist: payload.artist,
        title: payload.title,
        lines: []
      });

      // Vercel Serverless Function: Kita tidak menggunakan await untuk mencegah timeout Vercel,
      // tetapi Vercel akan membunuh proses jika response dikembalikan sebelum getLyrics selesai.
      // Jadi kita await pencariannya.
      try {
        const lyricsResult = await getLyrics({
          artist: payload.artist,
          title: payload.title,
          duration: payload.duration,
          videoType: payload.videoType
        });
        
        await pusher.trigger('now-playing', 'update', lyricsResult);
      } catch (err) {
        console.error('[Vercel API] Gagal mendapatkan lirik:', err.message);
        await pusher.trigger('now-playing', 'update', {
          type: 'lyrics',
          status: 'unavailable',
          artist: payload.artist,
          title: payload.title,
          lines: []
        });
      }
    }

    return res.status(200).json({ success: true, timestamp: Date.now() });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
