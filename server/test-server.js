const http = require('node:http');
const { WebSocket } = require('ws');
const { parseLrc, getLyrics, lyricsCache } = require('./lyricsService');

async function runTests() {
  console.log('=== Starting Lyric HUD Lyrics Engine & Integration Tests ===\n');

  // -------------------------------------------------------------
  // Test 1: LRC Parser Verification
  // -------------------------------------------------------------
  console.log('[Test 1] Testing LRC Parser...');
  const sampleLrc = `[ar:Sample Artist]
[ti:Sample Title]
[00:12.50]First line
[00:16.20]Second line
[00:20.100]Third line`;

  const parsed = parseLrc(sampleLrc);
  console.log('   Parsed output:', JSON.stringify(parsed));

  if (parsed.length !== 3) {
    throw new Error(`Expected 3 lines, got ${parsed.length}`);
  }
  if (parsed[0].time !== 12.5 || parsed[0].text !== 'First line') {
    throw new Error(`Line 1 mismatch: expected time 12.5, got ${parsed[0].time}`);
  }
  if (parsed[1].time !== 16.2 || parsed[1].text !== 'Second line') {
    throw new Error(`Line 2 mismatch: expected time 16.2, got ${parsed[1].time}`);
  }
  if (parsed[2].time !== 20.1 || parsed[2].text !== 'Third line') {
    throw new Error(`Line 3 (3-decimal) mismatch: expected time 20.1, got ${parsed[2].time}`);
  }
  console.log('✅ LRC Parser passed (supports MM:SS.xx and MM:SS.xxx)!\n');

  // -------------------------------------------------------------
  // Test 1b: 4-Line Focused Lyric Algorithm Verification
  // -------------------------------------------------------------
  console.log('[Test 1b] Testing 4-Line Focused Lyric Algorithm...');
  function findActiveIndex(lines, time) {
    let low = 0, high = lines.length - 1, res = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lines[mid].time <= time) { res = mid; low = mid + 1; }
      else { high = mid - 1; }
    }
    return res;
  }

  const testLines = [
    { time: 10.0, text: "Line 10" },
    { time: 20.0, text: "Line 20" },
    { time: 30.0, text: "Line 30" },
    { time: 40.0, text: "Line 40" },
    { time: 50.0, text: "Line 50" }
  ];

  // Case 1: Before line 0
  const idxIntro = findActiveIndex(testLines, 5.0);
  if (idxIntro !== -1) throw new Error(`Intro index failed: expected -1, got ${idxIntro}`);

  // Case 2: At line 10
  const idx1 = findActiveIndex(testLines, 10.0);
  if (idx1 !== 0) throw new Error(`Line 0 index failed: expected 0, got ${idx1}`);

  // Case 3: In between line 10 and 20 (15.5s)
  const idxBetween = findActiveIndex(testLines, 15.5);
  if (idxBetween !== 0) throw new Error(`Between index failed: expected 0, got ${idxBetween}`);

  // Case 4: At 35.0s (should be line 30, idx 2)
  const idx2 = findActiveIndex(testLines, 35.0);
  if (idx2 !== 2) throw new Error(`Middle index failed: expected 2, got ${idx2}`);

  // Verify 4-line window at idx 2: prev=Line 20, curr=Line 30, next1=Line 40, next2=Line 50
  const prevLine = testLines[idx2 - 1].text;
  const currLine = testLines[idx2].text;
  const nextLine1 = testLines[idx2 + 1].text;
  const nextLine2 = testLines[idx2 + 2].text;

  if (prevLine !== 'Line 20' || currLine !== 'Line 30' || nextLine1 !== 'Line 40' || nextLine2 !== 'Line 50') {
    throw new Error('4-line window failed to slice correctly');
  }
  console.log(`   Focused Window at 35s:`);
  console.log(`     Prev:   "${prevLine}"`);
  console.log(`     Curr:   "${currLine}"`);
  console.log(`     Next 1: "${nextLine1}"`);
  console.log(`     Next 2: "${nextLine2}"`);
  console.log('✅ 4-Line Focused Lyric Algorithm passed!\n');

  // -------------------------------------------------------------
  // Test 2: Live LRCLIB API Lookup & Cache Test
  // -------------------------------------------------------------
  console.log('[Test 2] Testing Live LRCLIB Lookup (NIKI - Every Summertime)...');
  lyricsCache.clear();

  const liveResult = await getLyrics({
    artist: 'NIKI',
    title: 'Every Summertime',
    duration: 215
  });

  console.log(`   Status:       ${liveResult.status}`);
  console.log(`   Title:        ${liveResult.title}`);
  console.log(`   Artist:       ${liveResult.artist}`);
  console.log(`   Lines count:  ${liveResult.lines.length}`);
  if (liveResult.lines.length > 0) {
    console.log(`   First line:   [${liveResult.lines[0].time}s] "${liveResult.lines[0].text}"`);
  }

  if (liveResult.status !== 'found' || liveResult.lines.length === 0) {
    throw new Error('LRCLIB lookup failed for NIKI - Every Summertime');
  }
  console.log('✅ Live LRCLIB lookup succeeded!');

  // Test 2b: Cache Verification
  console.log('\n[Test 2b] Testing In-Memory Cache...');
  const cacheSizeBefore = lyricsCache.size;
  if (cacheSizeBefore === 0) throw new Error('Expected cache to have at least 1 entry');

  const startCacheTime = Date.now();
  const cachedResult = await getLyrics({
    artist: 'NIKI',
    title: 'Every Summertime',
    duration: 215
  });
  const cacheDuration = Date.now() - startCacheTime;
  console.log(`   Cache retrieval time: ${cacheDuration}ms (instant)`);
  if (cachedResult !== liveResult) {
    throw new Error('Cache did not return cached object reference');
  }
  console.log('✅ In-Memory Cache verified (zero network overhead)!\n');

  // -------------------------------------------------------------
  // Test 3: Server WebSocket & Playback Integration
  // -------------------------------------------------------------
  console.log('[Test 3] Connecting Display Client via WebSocket...');
  const wsMessages = [];
  const displayWs = new WebSocket('ws://127.0.0.1:3099');

  await new Promise((resolve, reject) => {
    displayWs.on('open', () => {
      console.log('✅ Display WebSocket Connected');
      resolve();
    });
    displayWs.on('error', reject);
    displayWs.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      wsMessages.push(parsed);
      if (parsed.type === 'lyrics') {
        console.log(`📩 Display received LYRICS message: status="${parsed.status}" lines=${parsed.lines ? parsed.lines.length : 0}`);
      } else if (parsed.type === 'playback') {
        console.log(`📩 Display received PLAYBACK message: "${parsed.title}" by ${parsed.artist} (${parsed.currentTime}s)`);
      }
    });
  });

  // -------------------------------------------------------------
  // Test 4: Extension sends track 1 -> Verifies lyrics found & broadcast
  // -------------------------------------------------------------
  console.log('\n[Test 4] Extension simulates playing "NIKI - Every Summertime"...');
  const extensionWs = new WebSocket('ws://127.0.0.1:3099');

  await new Promise((resolve, reject) => {
    extensionWs.on('open', () => {
      console.log('✅ Extension WebSocket Connected');
      resolve();
    });
    extensionWs.on('error', reject);
  });

  const song1Payload = {
    type: 'playback',
    videoId: '2FhV81b3l-M',
    rawTitle: 'NIKI - Every Summertime (Official Video)',
    artist: 'NIKI',
    title: 'Every Summertime',
    currentTime: 10.0,
    duration: 215.3,
    isPlaying: true,
    url: 'https://www.youtube.com/watch?v=2FhV81b3l-M'
  };

  extensionWs.send(JSON.stringify(song1Payload));

  // Tunggu broadcast lirik tiba
  console.log('   Waiting for lyrics broadcast to display...');
  let receivedLyricsMsg = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200));
    receivedLyricsMsg = wsMessages.find(m => m.type === 'lyrics' && m.status === 'found' && m.lines.length > 0);
    if (receivedLyricsMsg) break;
  }

  if (!receivedLyricsMsg) {
    throw new Error('Display did not receive synced lyrics broadcast within timeout');
  }
  console.log(`✅ Display successfully received synced lyrics: ${receivedLyricsMsg.lines.length} lines`);

  // -------------------------------------------------------------
  // Test 5: Pause / Seek / Timeupdate does NOT trigger new API request
  // -------------------------------------------------------------
  console.log('\n[Test 5] Simulating Seek & Pause (currentTime change)...');
  const lyricsMsgCountBefore = wsMessages.filter(m => m.type === 'lyrics').length;

  const seekPayload = {
    ...song1Payload,
    currentTime: 65.5,
    isPlaying: false
  };
  extensionWs.send(JSON.stringify(seekPayload));

  await new Promise(r => setTimeout(r, 400));

  const lyricsMsgCountAfter = wsMessages.filter(m => m.type === 'lyrics').length;
  if (lyricsMsgCountAfter > lyricsMsgCountBefore) {
    throw new Error('Seek/pause triggered unexpected lyrics request/broadcast!');
  }
  console.log('✅ Confirmed: currentTime/seek/pause did NOT trigger redundant API requests!');

  // -------------------------------------------------------------
  // Test 6: Track change -> lyrics update
  // -------------------------------------------------------------
  console.log('\n[Test 6] Changing track to "Coldplay - Yellow"...');
  const song2Payload = {
    type: 'playback',
    videoId: 'yKNxeF4KMsY',
    rawTitle: 'Coldplay - Yellow (Official Video)',
    artist: 'Coldplay',
    title: 'Yellow',
    currentTime: 1.0,
    duration: 269.0,
    isPlaying: true,
    url: 'https://www.youtube.com/watch?v=yKNxeF4KMsY'
  };

  extensionWs.send(JSON.stringify(song2Payload));

  let receivedSong2Lyrics = null;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    receivedSong2Lyrics = wsMessages.find(m => m.type === 'lyrics' && m.status === 'found' && (m.title.toLowerCase().includes('yellow') || m.artist.toLowerCase().includes('coldplay')));
    if (receivedSong2Lyrics) break;
  }

  if (!receivedSong2Lyrics) {
    throw new Error('Display did not receive updated lyrics for song 2 (Yellow)');
  }
  console.log(`✅ Track changed and new lyrics received: "${receivedSong2Lyrics.title}" (${receivedSong2Lyrics.lines.length} lines)`);

  // -------------------------------------------------------------
  // Test 7: Seek Forward and Backward Behavior
  // -------------------------------------------------------------
  console.log('\n[Test 7] Testing Seek Forward & Seek Backward...');
  // Seek forward to 180s
  extensionWs.send(JSON.stringify({ ...song2Payload, currentTime: 180.0, isPlaying: true }));
  await new Promise(r => setTimeout(r, 150));
  const pb180 = wsMessages.filter(m => m.type === 'playback').slice(-1)[0];
  if (pb180.currentTime !== 180.0) throw new Error('Seek forward failed');
  console.log(`   Seek forward to ${pb180.currentTime}s verified`);

  // Seek backward to 25s
  extensionWs.send(JSON.stringify({ ...song2Payload, currentTime: 25.0, isPlaying: true }));
  await new Promise(r => setTimeout(r, 150));
  const pb25 = wsMessages.filter(m => m.type === 'playback').slice(-1)[0];
  if (pb25.currentTime !== 25.0) throw new Error('Seek backward failed');
  console.log(`   Seek backward to ${pb25.currentTime}s verified`);
  console.log('✅ Seek forward & backward verified!');

  // -------------------------------------------------------------
  // Test 8: Video without synced lyrics (Fallback verification)
  // -------------------------------------------------------------
  console.log('\n[Test 8] Testing Video without synced lyrics (Fallback test)...');
  const songWithoutLyrics = {
    type: 'playback',
    videoId: 'nonExistentVid999',
    rawTitle: 'Random Nonexistent Video',
    artist: 'NonexistentArtistXYZ',
    title: 'NonexistentTrackABC',
    currentTime: 10.0,
    duration: 120.0,
    isPlaying: true,
    url: 'https://www.youtube.com/watch?v=nonExistentVid999'
  };

  extensionWs.send(JSON.stringify(songWithoutLyrics));

  let fallbackMsg = null;
  for (let i = 0; i < 35; i++) {
    await new Promise(r => setTimeout(r, 200));
    fallbackMsg = wsMessages.find(m => m.type === 'lyrics' && m.title === 'NonexistentTrackABC' && m.status === 'unavailable');
    if (fallbackMsg) break;
  }

  if (!fallbackMsg) {
    throw new Error('Server did not send fallback unavailable status for nonexistent track');
  }
  console.log('✅ Video without synced lyrics handled cleanly with status "unavailable" (no crash)!');

  // -------------------------------------------------------------
  // Test 9: Multiple HP Clients Synchronization
  // -------------------------------------------------------------
  console.log('\n[Test 9] Testing Multiple HP Display synchronization (2 clients)...');
  const hpClient2Messages = [];
  const hpClient2 = new WebSocket('ws://127.0.0.1:3099');

  await new Promise((resolve, reject) => {
    hpClient2.on('open', resolve);
    hpClient2.on('error', reject);
    hpClient2.on('message', (msg) => {
      hpClient2Messages.push(JSON.parse(msg.toString()));
    });
  });

  // Client 2 should immediately receive current state on connect
  await new Promise(r => setTimeout(r, 200));
  const client2InitialPb = hpClient2Messages.find(m => m.type === 'playback');
  const client2InitialLyrics = hpClient2Messages.find(m => m.type === 'lyrics');
  if (!client2InitialPb || !client2InitialLyrics) {
    throw new Error('Second HP client did not receive initial synchronized state on connect');
  }
  console.log(`   Client 2 received initial track: "${client2InitialPb.title}"`);
  console.log(`   Client 2 received initial lyrics: status="${client2InitialLyrics.status}"`);

  // Now extension sends update: verify BOTH clients receive it simultaneously
  extensionWs.send(JSON.stringify({ ...song1Payload, currentTime: 55.0 }));
  await new Promise(r => setTimeout(r, 200));

  const client1HasUpdate = wsMessages.some(m => m.type === 'playback' && m.currentTime === 55.0);
  const client2HasUpdate = hpClient2Messages.some(m => m.type === 'playback' && m.currentTime === 55.0);

  if (!client1HasUpdate || !client2HasUpdate) {
    throw new Error('Broadcast failed to deliver update to multiple clients simultaneously');
  }
  console.log('✅ Multiple HP Displays receive identical synchronized state simultaneously!');

  // -------------------------------------------------------------
  // Test 10: WebSocket Reconnect Simulation
  // -------------------------------------------------------------
  console.log('\n[Test 10] Testing WebSocket Client Reconnection...');
  hpClient2.close();
  await new Promise(r => setTimeout(r, 300));

  // Re-connect
  const hpClient2Reconnected = new WebSocket('ws://127.0.0.1:3099');
  let reconnectedGotState = false;
  await new Promise((resolve, reject) => {
    hpClient2Reconnected.on('open', resolve);
    hpClient2Reconnected.on('error', reject);
    hpClient2Reconnected.on('message', (msg) => {
      const p = JSON.parse(msg.toString());
      if (p.type === 'playback') reconnectedGotState = true;
    });
  });

  await new Promise(r => setTimeout(r, 200));
  if (!reconnectedGotState) {
    throw new Error('Reconnected client failed to receive state after reconnect');
  }
  console.log('✅ Reconnected client successfully restored state sync!');

  displayWs.close();
  extensionWs.close();
  hpClient2Reconnected.close();

  console.log('\n🎉 ALL LYRIC ENGINE & INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
  process.exit(0);
}

// Start server child process on port 3099
const { spawn } = require('node:child_process');
const serverProc = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: '3099' },
  stdio: ['inherit', 'pipe', 'pipe']
});

serverProc.stdout.on('data', (d) => {
  const str = d.toString();
  process.stdout.write(str);
  if (str.includes('LYRIC HUD - LOCAL SERVER READY')) {
    runTests().catch(err => {
      console.error('❌ Test failed:', err);
      serverProc.kill();
      process.exit(1);
    }).then(() => {
      serverProc.kill();
    });
  }
});

serverProc.stderr.on('data', (d) => {
  process.stderr.write(d.toString());
});
