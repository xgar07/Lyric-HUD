async function runSearchPipeline(artist, title, duration) {
  let finalCandidate = null;

  const exactParams = new URLSearchParams({ track_name: title, artist_name: artist });
  if (duration > 0) exactParams.append('duration', Math.round(duration).toString());
  
  let lrclibData = await fetchLrclib(`/get?${exactParams.toString()}`);
  
  if (lrclibData) {
    console.log(`[LyricsService] Level 1 (Exact): DITEMUKAN untuk "${title}" - ${artist}`);
    return { candidate: lrclibData, score: 100 };
  } 
  
  console.log(`[LyricsService] Level 1 (Exact) GAGAL untuk "${title}" - ${artist} -> Lanjut ke Level 2 (Search)`);
  const searchParams = new URLSearchParams({ track_name: title });
  if (artist) searchParams.append('artist_name', artist);

  const searchResults = await fetchLrclib(`/search?${searchParams.toString()}`);
  
  if (Array.isArray(searchResults) && searchResults.length > 0) {
    let bestScore = -1;
    let bestCandidate = null;

    for (const cand of searchResults) {
      const score = scoreCandidate(cand, artist, title, duration);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }

    if (bestCandidate && bestScore >= 0) {
      console.log(`[LyricsService] Level 2: Kandidat terpilih dengan skor ${bestScore} -> "${bestCandidate.trackName}" - ${bestCandidate.artistName}`);
      return { candidate: bestCandidate, score: bestScore };
    }
  }

  return { candidate: null, score: -1 };
}
