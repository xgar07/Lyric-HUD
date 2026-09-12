const { getLyrics } = require('./server/lyricsService');

function cleanMusicVideoTags(str) {
  if (!str) return '';
  return str
    .replace(/\s*[\(\[\{]\s*(?:Official\s*(?:Music\s*|Lyric\s*|Audio\s*)?Video|Official\s*(?:MV|Audio|Lyrics?|Track)|Audio|Lyrics?|Lirik(?: \s*Terjemahan(?: \s*Indonesia)?)?|Terjemahan\s*Indonesia|Lyric\s*Video|Lyrics?\s*Video|Lyrics?\s*Terjemahan|Visualizer|Music\s*Video|MV|HD|4K|Remastered|Performance\s*Video|Live\s*Performance|Audio\s*Stream)\s*[\)\]\}]/gi, '')
    .replace(/\s*(?:\||-|–|—|•)?\s*(?:Official\s*(?:Music\s*|Lyric\s*|Audio\s*)?Video|Official\s*(?:MV|Audio|Lyrics?)|MV|Visualizer|Lyrics?|Lirik(?: \s*Terjemahan(?: \s*Indonesia)?)?|Terjemahan\s*Indonesia|Lyrics?\s*Terjemahan|Audio)\s*$/gi, '')
    .trim();
}

function parseYouTubeMetadata({ rawTitle, channelName }) {
  const cleanedTitle = cleanMusicVideoTags(rawTitle);
  let artist = '';
  let title = cleanedTitle;

  const delimiterMatch = cleanedTitle.match(/\s+[-–—|]\s+/);

  if (delimiterMatch) {
    const delimiter = delimiterMatch[0];
    const parts = cleanedTitle.split(delimiter);
    if (parts.length >= 2) {
      artist = parts[0].replace(/^["']|["']$/g, '').trim();
      title = parts.slice(1).join(' - ').replace(/^["']|["']$/g, '').trim();
    }
  }

  return { artist, title };
}

const tests = [
  "Let Down - Radiohead | Lirik Terjemahan Indonesia",
  "Radiohead - Let Down | Lyrics",
  "Let Down (Radiohead) | Lirik Terjemahan Indonesia"
];

async function run() {
  for (const rawTitle of tests) {
    console.log(`\n==================================================`);
    console.log(`[TESTING YOUTUBE TITLE]`);
    console.log(`Raw: "${rawTitle}"\n`);
    
    // Simulate extension parsing
    const parsed = parseYouTubeMetadata({ rawTitle, channelName: "Indolirik" });
    console.log(`[Extension Extracted]`);
    console.log(`Artist : "${parsed.artist}"`);
    console.log(`Title  : "${parsed.title}"\n`);

    // Simulate server lookup
    const result = await getLyrics({ artist: parsed.artist, title: parsed.title, duration: 299 });
    
    console.log(`\n[Server Final Payload]`);
    console.log(`Artist : ${result.artist}`);
    console.log(`Title  : ${result.title}`);
    console.log(`Status : ${result.status}`);
    console.log(`==================================================\n`);
    
    await new Promise(r => setTimeout(r, 2000)); // sleep for rate limit
  }
}

run().catch(console.error);
