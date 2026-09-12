const { getLyrics, lyricsCache } = require('./server/lyricsService');

const songs = [
  { artist: 'NIKI', title: 'Every Summertime', duration: 236 },
  { artist: 'Joji', title: 'Glimpse of Us', duration: 233 },
  { artist: 'YOASOBI', title: 'Idol', duration: 226 },
  { artist: 'Nadin Amizah', title: 'Sorai', duration: 239 }, // Indo
  { artist: 'Denny Caknan', title: 'Los Dol', duration: 320 } // Jawa
];

// We override console.log temporarily to capture the exact/search candidates info.
const originalLog = console.log;

async function run() {
  for (const song of songs) {
    let exactFound = false;
    let searchCandidates = 0;
    let selectedCandidate = null;

    console.log = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('Level 1 (Exact): DITEMUKAN')) exactFound = true;
      if (msg.includes('Level 2: Ditemukan')) {
        const match = msg.match(/Ditemukan (\d+) kandidat/);
        if (match) searchCandidates = parseInt(match[1]);
      }
      if (msg.includes('Kandidat terpilih')) {
        // e.g. Kandidat terpilih dengan skor 45 -> "Sorai" - Nadin Amizah (239s)
        const match = msg.match(/-> "(.*)" - (.*) \((\d+)s\)/);
        if (match) {
          selectedCandidate = {
            title: match[1],
            artist: match[2],
            duration: parseInt(match[3])
          };
        }
      }
      originalLog(...args); // print the original log for debug
    };

    lyricsCache.clear();
    const result = await getLyrics(song);

    // Restore original console.log for the final formatted output
    console.log = originalLog;

    console.log(`\n==================================================`);
    console.log(`[LYRICS TEST]`);
    console.log(`Input:`);
    console.log(`Artist: ${song.artist}`);
    console.log(`Title: ${song.title}`);
    console.log(`Duration: ${song.duration}`);
    console.log(``);
    console.log(`Exact:`);
    console.log(exactFound ? `FOUND` : `NOT FOUND`);
    console.log(``);
    console.log(`Search:`);
    console.log(`CANDIDATES = ${searchCandidates}`);
    console.log(``);
    console.log(`Selected:`);
    
    // In our payload, result contains artist and title. If it was found/plain, we have candidate info.
    if (result.status === 'found' || result.status === 'plain') {
      const diff = selectedCandidate && selectedCandidate.duration ? Math.abs(song.duration - selectedCandidate.duration) : (exactFound ? 0 : 'Unknown');
      
      console.log(`Artist: ${result.artist}`);
      console.log(`Title: ${result.title}`);
      console.log(`Duration: ${selectedCandidate ? selectedCandidate.duration : (exactFound ? song.duration : 'N/A')}`);
      console.log(`Duration diff: ${diff}`);
      console.log(`Synced: ${result.status === 'found' ? 'Yes' : 'No'}`);
      console.log(`Plain: ${result.plainLyrics ? 'Yes' : 'No'}`);
    } else {
      console.log(`Artist: N/A`);
      console.log(`Title: N/A`);
      console.log(`Duration: N/A`);
      console.log(`Duration diff: N/A`);
      console.log(`Synced: No`);
      console.log(`Plain: No`);
    }
    
    console.log(``);
    console.log(`Final:`);
    if (result.status === 'found') console.log(`FOUND_SYNCED`);
    else if (result.status === 'plain') console.log(`FOUND_PLAIN`);
    else console.log(`NOT_FOUND`);
    console.log(`==================================================\n`);
    
    // sleep to respect rate limit
    await new Promise(r => setTimeout(r, 2000));
  }
}

run().catch(console.error);
