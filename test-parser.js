function cleanMusicVideoTags(str) {
  if (!str) return '';
  return str
    .replace(/\s*[\(\[\{]\s*(?:Official\s*(?:Music\s*|Lyric\s*|Audio\s*)?Video|Official\s*(?:MV|Audio|Lyrics?|Track)|Audio|Lyrics?|Lirik|Lyric\s*Video|Visualizer|Music\s*Video|MV|HD|4K|Remastered|Performance\s*Video|Live\s*Performance|Audio\s*Stream)\s*[\)\]\}]/gi, '')
    .replace(/\s*(?:\||-|–|—|•)?\s*(?:Official\s*(?:Music\s*|Lyric\s*|Audio\s*)?Video|Official\s*(?:MV|Audio|Lyrics?)|MV|Visualizer|Lyrics?|Lirik|Audio)\s*$/gi, '')
    .trim();
}

function parseYouTubeMetadata({ rawTitle, channelName, videoId, duration }) {
  if (!rawTitle) {
    return { videoId, rawTitle: '', artist: '', title: '', channelName, duration, confidence: 'low' };
  }

  const cleanedTitle = cleanMusicVideoTags(rawTitle);
  let artist = '';
  let title = cleanedTitle;
  let confidence = 'low';

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

  if (!artist && channelName) {
    let cleanChannel = channelName
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/\s+Topic$/i, '')
      .replace(/\s+Official(?: Channel)?$/i, '')
      .replace(/\s+VEVO$/i, '')
      .trim();

    // If channel is exactly "Some Random Guy" and the title is "Titik Nadir",
    // the user explicitly asked:
    // "Titik Nadir" => jangan menebak artist secara agresif. Kalau artist tidak bisa diketahui: artist = "", title = cleaned title, confidence = low
    // So we shouldn't just grab "Some Random Guy" blindly.
    // How to know if channelName is actually an artist? 
    // If it had "Topic" or "Official" or "VEVO", it's high confidence that it's an artist channel.
    // Otherwise, we shouldn't guess.
    const isArtistChannel = /(?:Topic|Official|VEVO)/i.test(channelName);
    
    if (isArtistChannel && cleanChannel) {
      artist = cleanChannel;
      confidence = 'medium';
    } else {
      // Just keep artist empty as per requirement: "Jangan menebak artist secara agresif"
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
    confidence
  };
}

const tests = [
  { rawTitle: "Nadin Amizah - Sorai (Official Music Video)", channelName: "Nadin Amizah" },
  { rawTitle: "Denny Caknan - Los Dol (Official Music Video)", channelName: "Denny Caknan Official" },
  { rawTitle: "NIKI - Every Summertime", channelName: "88rising" },
  { rawTitle: "YOASOBI「アイドル」 Official Music Video", channelName: "Ayase / YOASOBI" },
  { rawTitle: "Titik Nadir", channelName: "Some Random Guy" },
  { rawTitle: "Artist - Song [Lirik]", channelName: "Lirik Lagu" },
  { rawTitle: "Artist - Song (Official Audio)", channelName: "Artist Topic" },
  { rawTitle: "Artist – Song | Official MV", channelName: "ArtistVEVO" },
  { rawTitle: "Lathi (ꦭꦛꦶ)", channelName: "Weird Genius - Topic" }
];

tests.forEach(t => {
  console.log(parseYouTubeMetadata({ ...t, videoId: '123', duration: 200 }));
});
