// Lyric HUD - LRCLIB Lyrics Service
// Fallback pipeline: Level 1 (Exact) -> Level 2 (Search & Score) -> Level 3 (Plain fallback)

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const USER_AGENT = 'LyricHUD/1.0 (local personal project)';

const lyricsCache = new Map();

function normalizeKey(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:feat\.?|ft\.?)\b/gi, 'feat')
    .replace(/[.,!?;:'"\\~@#$%^*_=+<>\/|\[\]\{\}\(\)\-–—•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCacheKey(artist, title) {
  const normArtist = normalizeKey(artist);
  const normTitle = normalizeKey(title);
  return `${normArtist}:::${normTitle}`;
}

function parseLrc(lrcContent) {
  if (!lrcContent || typeof lrcContent !== 'string') return [];
  const lines = lrcContent.split(/\r?\n/);
  const parsedEntries = [];
  const timeTagRegex = /\[(?:(\d{1,2}):)?(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^\[[a-zA-Z]+:/.test(line)) continue;

    const matches = Array.from(line.matchAll(timeTagRegex));
    if (matches.length === 0) continue;

    const text = line.replace(timeTagRegex, '').trim();

    for (const match of matches) {
      const hours = match[1] ? parseInt(match[1], 10) : 0;
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      const totalSeconds = Number((hours * 3600 + minutes * 60 + seconds).toFixed(2));

      parsedEntries.push({ time: totalSeconds, text });
    }
  }

  parsedEntries.sort((a, b) => a.time - b.time);
  return parsedEntries;
}

// Menghitung distance sederhana (bisa diganti Levenshtein, tapi untuk ini cukup exact/includes)
function getStringSimilarity(a, b) {
  const normA = normalizeKey(a);
  const normB = normalizeKey(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 10;
  if (normA.includes(normB) || normB.includes(normA)) return 5;
  return 0;
}

function scoreCandidate(candidate, inputArtist, inputTitle, inputDuration, videoType) {
  let score = 0;
  
  const titleSim = getStringSimilarity(candidate.trackName, inputTitle);
  const artistSim = getStringSimilarity(candidate.artistName, inputArtist);
  
  score += titleSim;
  score += artistSim;

  // Duration difference
  if (inputDuration > 0 && candidate.duration) {
    const diff = Math.abs(inputDuration - candidate.duration);
    if (diff <= 2) score += 10;
    else if (diff <= 5) score += 5;
    else if (diff <= 15) score -= 5;
    else {
      // Reject if > 15s UNLESS title/artist is an exact match (score >= 15)
      if (titleSim + artistSim < 15) return -1;
      score -= 10;
    }
  }

  if (candidate.syncedLyrics) score += 20;
  else if (candidate.plainLyrics) score += 5;

  if (videoType) {
    if (['official', 'official_audio', 'topic'].includes(videoType)) score += 5;
    else if (['translated', 'live', 'remix', 'acoustic', 'sped_up', 'slowed', 'cover'].includes(videoType)) score -= 5;
  }

  return score;
}

async function fetchLrclib(endpoint) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(`${LRCLIB_BASE_URL}${endpoint}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 404) return null;
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      console.warn(`[LyricsService] Rate limited (429). Retry-After: ${retryAfter}s`);
      // We return null to fail gracefully instead of crashing/blocking
      return null;
    }

    if (!response.ok) {
      console.error(`[LyricsService] HTTP Error: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name !== 'AbortError') {
      console.error('[LyricsService] Fetch error:', err.message);
    }
    return null;
  }
}

async function getLyrics({ artist, title, duration, videoType }) {
  const cleanArtist = (artist || '').trim();
  const cleanTitle = (title || '').trim();
  const dur = Number(duration) || 0;

  if (!cleanTitle || cleanTitle === 'Belum ada lagu yang diputar' || cleanTitle === 'Menunggu YouTube...') {
    return { type: 'lyrics', status: 'unavailable', artist: cleanArtist, title: cleanTitle, lines: [] };
  }

  const cacheKey = buildCacheKey(cleanArtist, cleanTitle);
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  console.log(`\n[LyricsService] Lookup: "${cleanTitle}" - ${cleanArtist} (${dur}s)`);

  async function runSearchPipeline(searchArtist, searchTitle, searchDuration) {
    let bestResult = { candidate: null, score: -1 };

    // LEVEL 1 - EXACT LOOKUP
    const exactParams = new URLSearchParams({ track_name: searchTitle, artist_name: searchArtist });
    if (searchDuration > 0) exactParams.append('duration', Math.round(searchDuration).toString());
    
    let lrclibData = await fetchLrclib(`/get?${exactParams.toString()}`);
    
    if (lrclibData) {
      console.log(`[LyricsService] Level 1 (Exact): DITEMUKAN untuk "${searchTitle}" - ${searchArtist}`);
      let exactScore = 100;
      if (lrclibData.syncedLyrics) {
        exactScore += 20 + parseLrc(lrclibData.syncedLyrics).length; // Bonus baris untuk tie-breaker
      } else if (lrclibData.plainLyrics) {
        exactScore += 5;
      }
      bestResult = { candidate: lrclibData, score: exactScore };
    } 
    
    // Walaupun Exact ketemu, kita tetap bisa fallback ke Search jika exact tidak punya synced lyrics, 
    // tapi untuk kecepatan, kita asumsikan Exact sudah bagus jika skornya > 100.
    if (bestResult.score >= 120) {
      return bestResult;
    }

    console.log(`[LyricsService] Lanjut ke Level 2 (Search) untuk "${searchTitle}" - ${searchArtist}`);
    const searchParams = new URLSearchParams({ track_name: searchTitle });
    if (searchArtist) searchParams.append('artist_name', searchArtist);

    const searchResults = await fetchLrclib(`/search?${searchParams.toString()}`);
    
    if (Array.isArray(searchResults) && searchResults.length > 0) {
      let bestScore = -1;
      let bestCandidate = null;

      for (const cand of searchResults) {
        let score = scoreCandidate(cand, searchArtist, searchTitle, searchDuration, videoType);
        if (cand.syncedLyrics) {
           score += parseLrc(cand.syncedLyrics).length; // Tie-breaker
        }
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = cand;
        }
      }

      if (bestCandidate && bestScore > bestResult.score) {
        console.log(`[LyricsService] Level 2: Kandidat terpilih dengan skor ${bestScore} -> "${bestCandidate.trackName}" - ${bestCandidate.artistName}`);
        return { candidate: bestCandidate, score: bestScore };
      }
    }
    
    return bestResult;
  }

  console.log(`[LyricsService] Memulai validasi kandidat (A/B/C)...`);

  // Candidate A: Normal Artist - Title
  let candidateA = await runSearchPipeline(cleanArtist, cleanTitle, dur);
  
  // Candidate B: Swapped (Title - Artist)
  let candidateB = { candidate: null, score: -1 };
  if (cleanArtist && cleanTitle) {
    candidateB = await runSearchPipeline(cleanTitle, cleanArtist, dur);
  }

  // Candidate C: Extract Title (Artist)
  let candidateC = { candidate: null, score: -1 };
  const match = cleanTitle.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (match) {
    candidateC = await runSearchPipeline(match[2].trim(), match[1].trim(), dur);
  }

  let bestMatch = candidateA;
  
  if (candidateB.score > bestMatch.score) {
    console.log(`[LyricsService] Candidate B (Swapped) menang dengan skor ${candidateB.score} vs ${bestMatch.score}`);
    bestMatch = candidateB;
  }
  
  if (candidateC.score > bestMatch.score) {
    console.log(`[LyricsService] Candidate C (Extracted) menang dengan skor ${candidateC.score} vs ${bestMatch.score}`);
    bestMatch = candidateC;
  }

  let finalCandidate = bestMatch.candidate;

  // LEVEL 3 - PLAIN FALLBACK & RESULT FORMATTING
  let resultPayload;

  if (finalCandidate && finalCandidate.syncedLyrics) {
    resultPayload = {
      type: 'lyrics',
      status: 'found',
      artist: finalCandidate.artistName || cleanArtist,
      title: finalCandidate.trackName || cleanTitle,
      candidateDuration: finalCandidate.duration || 0,
      lines: parseLrc(finalCandidate.syncedLyrics),
      plainLyrics: finalCandidate.plainLyrics || ''
    };
    console.log(`[LyricsService] ✅ Status: FOUND_SYNCED (${resultPayload.lines.length} baris)`);
  } else if (finalCandidate && finalCandidate.plainLyrics) {
    resultPayload = {
      type: 'lyrics',
      status: 'plain',
      artist: finalCandidate.artistName || cleanArtist,
      title: finalCandidate.trackName || cleanTitle,
      candidateDuration: finalCandidate.duration || 0,
      lines: [],
      plainLyrics: finalCandidate.plainLyrics
    };
    console.log(`[LyricsService] ℹ️ Status: FOUND_PLAIN (Sinkronisasi tidak tersedia)`);
  } else {
    resultPayload = {
      type: 'lyrics',
      status: 'unavailable',
      artist: cleanArtist,
      title: cleanTitle,
      lines: []
    };
    console.log(`[LyricsService] ⚠️ Status: NOT_FOUND`);
  }

  lyricsCache.set(cacheKey, resultPayload);
  if (lyricsCache.size > 100) {
    lyricsCache.delete(lyricsCache.keys().next().value);
  }

  return resultPayload;
}

module.exports = {
  getLyrics,
  parseLrc,
  lyricsCache,
  normalizeKey
};
