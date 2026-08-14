const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lyricSongCacheKey } = require('../lyric-cache');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function serverFunctionSource(marker) {
  const start = serverSource.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  let depth = 0;
  let end = -1;
  for (let index = serverSource.indexOf('{', start); index < serverSource.length; index += 1) {
    if (serverSource[index] === '{') depth += 1;
    if (serverSource[index] === '}') depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }
  assert.notEqual(end, -1, `${marker} should have a complete body`);
  return serverSource.slice(start, end);
}

async function verifyQQMusicuRetriesOneConnectionReset() {
  let calls = 0;
  const context = {
    qqMusicRequest: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('read ECONNRESET');
        error.code = 'ECONNRESET';
        throw error;
      }
      return { lyric:{ data:{ qrc:'retry-success' } } };
    },
    Promise,
    String,
  };
  vm.createContext(context);
  vm.runInContext([
    serverFunctionSource('function isTransientQQLyricRequestError(error)'),
    serverFunctionSource('async function requestQQLyricMusicu(payload, opts)'),
    'this.requestQQLyricMusicu = requestQQLyricMusicu;',
  ].join('\n'), context);
  const recovered = await context.requestQQLyricMusicu({ lyric:{} }, { cookie:true });
  assert.equal(calls, 2, 'QQ musicu should retry exactly once after ECONNRESET');
  assert.equal(recovered.lyric.data.qrc, 'retry-success', 'A successful retry should preserve the native QRC response');
}

function openPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForResponse(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited with ${child.exitCode}`);
    try { return await fetch(url); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('Server did not start');
}

(async () => {
  await verifyQQMusicuRetriesOneConnectionReset();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-lyric-http-'));
  const legacySong = { name:'Legacy Metadata Song', artist:'Legacy Artist', duration:180 };
  const legacyKey = lyricSongCacheKey(legacySong);
  const legacyFile = 'legacy-metadata.json';
  const legacyPayload = {
    provider:'netease',
    lyric:'[00:00]旧韩文歌名\n[00:01]Lyrics by Alice\n[00:10]第一句正文',
    tlyric:'[00:00]歌词翻译QQ音乐版权所有\n[00:10]第一句翻译',
  };
  fs.writeFileSync(path.join(cacheDir, legacyFile), JSON.stringify(legacyPayload));
  fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify({
    version:3,
    entries:{
      [legacyKey]:{
        file:legacyFile,
        size:Buffer.byteLength(JSON.stringify(legacyPayload)),
        createdAt:1,
        updatedAt:1,
        accessedAt:1,
        translationCheckedAt:1,
        hasTranslation:true,
        revision:1,
      },
    },
  }));
  const port = await openPort();
  const child = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MINERADIO_LYRIC_CACHE_DIR: cacheDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const statusResponse = await waitForResponse(`http://127.0.0.1:${port}/api/lyric/cache/status`, child);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.entries, 1);
    assert.equal(status.maxBytes, 100 * 1024 * 1024);

    const legacyUrl = `http://127.0.0.1:${port}/api/lyric/cache/song?name=${encodeURIComponent(legacySong.name)}&artist=${encodeURIComponent(legacySong.artist)}&duration=${legacySong.duration}`;
    const migratedLegacy = await (await fetch(legacyUrl)).json();
    assert.equal(migratedLegacy.lyric, '[00:10]第一句正文',
      'Reading an old NetEase cache must rewrite its title and opening credits in place');
    assert.equal(migratedLegacy.tlyric, '[00:00]\n[00:10]第一句翻译');
    assert.equal(migratedLegacy.lyricMetadataSanitizedVersion, 1);
    const migratedIndex = JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8'));
    const migratedDiskPayload = JSON.parse(fs.readFileSync(
      path.join(cacheDir, migratedIndex.entries[legacyKey].file),
      'utf8',
    ));
    assert.equal(migratedDiskPayload.lyric, migratedLegacy.lyric,
      'The migrated metadata-free payload must replace the old cache file');

    await fetch(`http://127.0.0.1:${port}/api/lyric/cache`, { method:'DELETE' });

    const romanizationResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/romanize`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body:JSON.stringify({
        lines:[{
          t:0,
          text:'널 부를래 Baby',
          source:'qrc-word',
          karaokeTimeline:[
            { text:'널', start:0, duration:.5, c0:0, c1:1, timed:true },
            { text:'부를래', start:.5, duration:1, c0:2, c1:5, timed:true },
            { text:'Baby', start:1.5, duration:.8, c0:6, c1:10, timed:true },
          ],
        }],
      }),
    });
    assert.equal(romanizationResponse.status, 200);
    const romanization = await romanizationResponse.json();
    assert.equal(romanization.engineVersion, '2');
    assert.equal(romanization.language, 'ko');
    assert.equal(romanization.lines[0].text, 'neol bu reul rae Baby');
    assert.deepEqual(romanization.lines[0].tokens[0].sourceNodeIndexes, [0]);

    const rejectedRomanization = await fetch(`http://127.0.0.1:${port}/api/lyric/romanize`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Origin:'https://evil.example' },
      body:JSON.stringify({ lines:[{ t:0, text:'널' }] }),
    });
    assert.equal(rejectedRomanization.status, 403);

    const appleSong = { name:'Apple TTML Song', artist:'Singer', duration:180 };
    const rawTtml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:01.000" end="00:02.000">First Apple line</p></div></body></tt>';
    const appleWriteResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body:JSON.stringify({
        song:appleSong,
        payload:{
          provider:'apple',
          id:'apple-42',
          storefront:'us',
          rawTtml,
          structuredLines:[{ t:1, sourceEnd:2, duration:1, text:'First Apple line', transText:'第一句', source:'apple-ttml-line' }],
        },
        selection:{
          mode:'auto',
          policy:'apple-beta:translation-required:us:zh-Hans',
          candidate:{ provider:'apple', id:'apple-42', storefront:'us', name:appleSong.name, artist:appleSong.artist },
        },
      }),
    });
    assert.equal(appleWriteResponse.status, 200);
    const appleWritten = await appleWriteResponse.json();
    assert.equal(appleWritten.cache.hasTtml, true);
    assert.equal(appleWritten.rawTtml, undefined, 'Raw TTML must not be echoed from the canonical cache response');
    assert.equal(appleWritten.structuredLines[0].text, 'First Apple line', 'Apple lyrics must not use QQ/NetEase first-line deletion');
    const appleTtmlPath = path.join(cacheDir, appleWritten.cache.ttmlFile);
    assert.equal(fs.readFileSync(appleTtmlPath, 'utf8'), rawTtml);
    const appleSongUrl = `http://127.0.0.1:${port}/api/lyric/cache/song?name=${encodeURIComponent(appleSong.name)}&artist=${encodeURIComponent(appleSong.artist)}&duration=${appleSong.duration}`;
    const appleHit = await (await fetch(appleSongUrl)).json();
    assert.equal(appleHit.cache.hit, true);
    assert.equal(appleHit.cacheSelection.policy, 'apple-beta:translation-required:us:zh-Hans');
    assert.equal(appleHit.rawTtml, undefined);
    const appleReplaceResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body:JSON.stringify({
        song:appleSong,
        payload:{ provider:'qq', mid:'qq-replacement', lyric:'[00:00]Title\n[00:01]QQ replacement' },
        selection:{ mode:'auto', policy:'apple-beta:translation-required:us:zh-Hans', candidate:{ provider:'qq', mid:'qq-replacement' } },
      }),
    });
    assert.equal(appleReplaceResponse.status, 200);
    const appleReplaced = await appleReplaceResponse.json();
    assert.equal(fs.existsSync(appleTtmlPath), false, 'Replacing Apple lyrics must remove the paired TTML artifact');
    const appleDeleteResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method:'DELETE',
      headers:{ 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body:JSON.stringify({ song:appleSong, expectedRevision:appleReplaced.cache.revision }),
    });
    assert.equal(appleDeleteResponse.status, 200);

    const songUrl = `http://127.0.0.1:${port}/api/lyric/cache/song?name=${encodeURIComponent('Cache Song (Live)')}&artist=${encodeURIComponent('Singer / Guest')}&duration=240000`;
    const writeResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body: JSON.stringify({
        song: { provider:'spotify', id:'spotify-id', name:'Cache Song (Live)', artist:'Singer / Guest', duration:240000 },
        payload: {
          provider:'qq',
          mid:'qq-qrc',
          qrc:'[0,100]\n[100,700]Cache Song(100,700)\n[1000,1000]Cached(1000,1000)',
          lyric:'',
          tlyric:'[00:00]歌词翻译QQ音乐版权所有\n[00:01]缓存翻译',
        },
        selection: { mode:'manual', candidate:{ provider:'qq', mid:'qq-qrc', name:'Cache Song (Live)', artist:'Singer' } },
      }),
    });
    assert.equal(writeResponse.status, 200);
    const written = await writeResponse.json();
    assert.equal(written.cache.stored, true);
    assert.equal(written.qrc, '[0,100]\n[1000,1000]Cached(1000,1000)',
      'A newly stored QQ cache must remove its first non-empty original lyric line');
    assert.equal(written.tlyric, '[00:00]\n[00:01]缓存翻译',
      'A newly stored cache must blank opening translation copyright text without shifting timestamps');
    assert.equal(written.lyricMetadataSanitizedVersion, 1);

    const lyricResponse = await fetch(songUrl);
    const lyric = await lyricResponse.json();
    assert.equal(lyric.qrc, '[0,100]\n[1000,1000]Cached(1000,1000)');
    assert.equal(lyric.cache.hit, true, 'Playback should resolve lyrics through the canonical song cache');
    assert.equal(lyric.cacheSelection.candidate.mid, 'qq-qrc');
    assert.equal(lyric.cache.romanizationEngineVersion, '2');
    assert.ok(lyric.cache.romanizationSessionId);

    const patchRomanizationResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body:JSON.stringify({
        song:{ name:'Cache Song (Live)', artist:'Singer', duration:240 },
        expectedRevision:lyric.cache.revision,
        romanization:{
          engineVersion:lyric.cache.romanizationEngineVersion,
          language:'ko',
          lines:[{ lineIndex:0, text:'kae si', tokens:[] }],
        },
      }),
    });
    assert.equal(patchRomanizationResponse.status, 200);
    const patchedRomanization = await patchRomanizationResponse.json();
    assert.equal(patchedRomanization.romanization.language, 'ko');
    assert.equal(patchedRomanization.qrc, lyric.qrc,
      'Refreshing romanization must not replace the selected original QRC payload');
    assert.equal(patchedRomanization.tlyric, lyric.tlyric,
      'Refreshing romanization must not replace the selected translation payload');
    assert.deepEqual(patchedRomanization.cacheSelection, lyric.cacheSelection,
      'Refreshing romanization must preserve the manual lyric selection metadata');
    assert.equal(patchedRomanization.lyricMetadataSanitizedVersion, lyric.lyricMetadataSanitizedVersion,
      'Refreshing romanization must preserve unrelated cached lyric metadata');

    const replaceResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body: JSON.stringify({
        song: { provider:'netease', id:42, name:'Cache Song - Live', artist:'Singer', duration:241 },
        payload: {
          provider:'netease',
          id:42,
          lyric:'[00:00]Cache Song\n[00:01]Manual replacement',
          qrc:'',
        },
        selection: { mode:'manual', candidate:{ provider:'netease', id:42, name:'Cache Song - Live', artist:'Singer' } },
      }),
    });
    assert.equal(replaceResponse.status, 200);
    const replacedStatus = await (await fetch(`http://127.0.0.1:${port}/api/lyric/cache/status`)).json();
    assert.equal(replacedStatus.entries, 1, 'Replacing a song lyric must not create a second candidate cache');
    const replaced = await (await fetch(songUrl)).json();
    assert.equal(replaced.lyric, '[00:01]Manual replacement');
    assert.equal(replaced.cacheSelection.mode, 'manual');

    const legacyFallbackResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:`http://localhost:${port}` },
      body: JSON.stringify({
        song: { provider:'spotify', id:'spotify-legacy', name:'Legacy Fallback Song', artist:'Singer', duration:212 },
        payload: {
          provider:'qq',
          mid:'qq-legacy-after-reset',
          qrc:'',
          lyric:'[00:00.00]Legacy Fallback Song\n[00:01.00]Legacy lyric after musicu ECONNRESET',
          tlyric:'[00:00.00]歌词翻译QQ音乐版权所有\n[00:01.00]回退歌词翻译',
          source:'qq-legacy',
        },
        selection: { mode:'manual', candidate:{ provider:'qq', mid:'qq-legacy-after-reset', name:'Legacy Fallback Song', artist:'Singer' } },
      }),
    });
    assert.equal(legacyFallbackResponse.status, 200,
      'A loopback localhost renderer must be allowed to cache usable QQ legacy lyrics after musicu ECONNRESET');
    const legacyFallback = await legacyFallbackResponse.json();
    assert.equal(legacyFallback.cache.stored, true);
    assert.equal(legacyFallback.cacheSelection.candidate.mid, 'qq-legacy-after-reset');
    const rejectedExternalOrigin = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:'https://evil.example' },
      body: JSON.stringify({
        song: { name:'Rejected Origin Song', artist:'Singer' },
        payload: { provider:'qq', lyric:'[00:00.00]Must not be stored' },
        selection: { mode:'manual', candidate:{ provider:'qq', mid:'rejected-origin' } },
      }),
    });
    assert.equal(rejectedExternalOrigin.status, 403, 'External web origins must remain blocked from local cache writes');

    const staleAutoResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body: JSON.stringify({
        song: { provider:'spotify', name:'Cache Song (Live)', artist:'Singer', duration:240 },
        payload: {
          provider:'qq',
          mid:'stale-auto',
          qrc:'[0,500]Cache Song(0,500)\n[500,1000]Stale(500,1000)',
        },
        selection: { mode:'auto', candidate:{ provider:'qq', mid:'stale-auto' } },
      }),
    });
    assert.equal(staleAutoResponse.status, 409, 'A normal automatic request must not overwrite a manual cache');
    const afterStaleAuto = await (await fetch(songUrl)).json();
    assert.equal(afterStaleAuto.lyric, '[00:01]Manual replacement');

    const newerManualResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body: JSON.stringify({
        song: { provider:'spotify', name:'Cache Song (Live)', artist:'Singer', duration:240 },
        payload: {
          provider:'netease',
          id:43,
          lyric:'[00:00]Cache Song\n[00:01]Newer manual',
        },
        selection: { mode:'manual', candidate:{ provider:'netease', id:43 } },
      }),
    });
    assert.equal(newerManualResponse.status, 200);
    const newerManual = await newerManualResponse.json();

    const staleRestoreResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body: JSON.stringify({
        song: { provider:'spotify', name:'Cache Song (Live)', artist:'Singer', duration:240 },
        payload: {
          provider:'qq',
          mid:'old-restore',
          qrc:'[0,500]Cache Song(0,500)\n[500,1000]Old restore(500,1000)',
        },
        selection: { mode:'auto', candidate:{ provider:'qq', mid:'old-restore' } },
        replaceManual: true,
        expectedRevision: afterStaleAuto.cache.revision,
      }),
    });
    assert.equal(staleRestoreResponse.status, 409, 'An older restore-auto request must not overwrite a newer manual choice');
    assert.equal((await (await fetch(songUrl)).json()).lyric, '[00:01]Newer manual');

    const explicitAutoResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body: JSON.stringify({
        song: { provider:'spotify', name:'Cache Song (Live)', artist:'Singer', duration:240 },
        payload: {
          provider:'qq',
          mid:'fresh-auto',
          qrc:'[0,500]Cache Song(0,500)\n[500,1000]Fresh(500,1000)',
        },
        selection: { mode:'auto', candidate:{ provider:'qq', mid:'fresh-auto' } },
        replaceManual: true,
        expectedRevision: newerManual.cache.revision,
      }),
    });
    assert.equal(explicitAutoResponse.status, 200, 'An explicit restore-auto action may replace a manual cache');
    const afterExplicitAuto = await (await fetch(songUrl)).json();
    assert.equal(afterExplicitAuto.qrc, '[500,1000]Fresh(500,1000)');
    assert.equal(afterExplicitAuto.cacheSelection.mode, 'auto');

    const staleDeleteResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method:'DELETE',
      headers:{ 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body:JSON.stringify({ song:{ name:'Cache Song (Live)', artist:'Singer', duration:240 }, expectedRevision:newerManual.cache.revision }),
    });
    assert.equal(staleDeleteResponse.status, 409, 'An old manual selection must not delete a newer cache entry');
    const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache/song`, {
      method:'DELETE',
      headers:{ 'Content-Type':'application/json', Origin:`http://127.0.0.1:${port}` },
      body:JSON.stringify({ song:{ name:'Cache Song (Live)', artist:'Singer', duration:240 }, expectedRevision:afterExplicitAuto.cache.revision }),
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).removed, true, 'The matching failed-selection revision should be removable without clearing other songs');
    assert.equal((await (await fetch(songUrl)).json()).cache.hit, false);

    const clearResponse = await fetch(`http://127.0.0.1:${port}/api/lyric/cache`, { method: 'DELETE' });
    assert.equal(clearResponse.status, 200);
    const cleared = await clearResponse.json();
    assert.equal(cleared.entries, 0);
    console.log('Lyric cache HTTP: PASS');
  } finally {
    child.kill();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    if (stderr && child.exitCode != null && child.exitCode !== 0) process.stderr.write(stderr);
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
