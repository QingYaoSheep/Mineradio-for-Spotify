const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readRendererSource } = require('./renderer-source');

const html = readRendererSource();

function functionSource(marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  let depth = 0;
  let end = -1;
  for (let index = html.indexOf('{', start); index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }
  assert.notEqual(end, -1, `${marker} should have a complete body`);
  return html.slice(start, end);
}

async function verifyBothProvidersAreSearchedTogether() {
  const calls = [];
  let qqFails = false;
  const context = {
    apiJson: async (url) => {
      calls.push(url);
      if (url.startsWith('/api/qq/search')) {
        if (qqFails) throw new Error('QQ unavailable');
        return { songs: [{ mid: 'qq-1', name: 'Song', artist: 'Singer', album: 'QQ Album' }] };
      }
      if (url.startsWith('/api/search')) {
        return { songs: [{ id: 101, name: 'Song', artist: 'Singer', album: 'NE Album' }] };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    encodeURIComponent,
    Promise,
    String,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('async function searchLyricCandidates(song, query)')}; this.searchCandidates = searchLyricCandidates;`, context);
  const candidates = await context.searchCandidates({ name: 'Song', artist: 'Singer' }, 'Song Singer');
  assert.deepEqual(calls.map((url) => url.split('?')[0]).sort(), ['/api/qq/search', '/api/search'],
    'The selection page should search QQ Music and NetEase in one action');
  assert.deepEqual(JSON.parse(JSON.stringify(candidates.map((item) => item.provider).sort())), ['netease', 'qq']);
  assert.equal(candidates.find((item) => item.provider === 'qq').mid, 'qq-1');
  assert.equal(candidates.find((item) => item.provider === 'netease').id, 101);

  calls.length = 0;
  qqFails = true;
  const neteaseOnly = await context.searchCandidates({ name: 'Song', artist: 'Singer' }, 'Song Singer');
  assert.deepEqual(JSON.parse(JSON.stringify(neteaseOnly.map((item) => item.provider))), ['netease'],
    'One failed provider should not hide usable results from the other provider');
}

async function verifyAutomaticMatchingPrefersOriginalQrc() {
  const calls = [];
  const payloads = {
    'cover-qrc': { qrc: '[0,1000]Cover(0,1000)', lyric: '' },
    'original-lrc-2': { qrc: '', lyric: '[00:00]Original line 2' },
    'original-lrc-3': { qrc: '', lyric: '[00:00]Original line 3' },
    'original-lrc-4': { qrc: '', lyric: '[00:00]Original line 4' },
    'original-lrc-5': { qrc: '', lyric: '[00:00]Original line 5' },
    'original-lrc': { qrc: '', lyric: '[00:00]Original line' },
    'original-live-qrc': { qrc: '[0,1000]Live(0,1000)', lyric: '' },
    'original-qrc': { qrc: '[0,1000]Original(0,1000)', lyric: '' },
  };
  const searchSongs = [
    { mid: 'cover-qrc', name: 'Test Song', artist: 'Cover Singer', duration: 240 },
    { mid: 'original-lrc', name: 'Test Song', artist: 'Original Singer', duration: 238 },
    { mid: 'original-lrc-2', name: 'Test Song', artist: 'Original Singer', duration: 238 },
    { mid: 'original-lrc-3', name: 'Test Song', artist: 'Original Singer', duration: 238 },
    { mid: 'original-lrc-4', name: 'Test Song', artist: 'Original Singer', duration: 238 },
    { mid: 'original-lrc-5', name: 'Test Song', artist: 'Original Singer', duration: 238 },
    { mid: 'original-live-qrc', name: 'Test Song (Live)', artist: 'Original Singer', duration: 239 },
    { mid: 'original-qrc', name: 'Test Song', artist: 'Original Singer', duration: 260 },
  ];
  const context = {
    apiJson: async (url) => {
      calls.push(url);
      if (url.startsWith('/api/qq/search')) return { songs: searchSongs };
      const mid = new URL(`http://local${url}`).searchParams.get('mid');
      return payloads[mid] || {};
    },
    songProviderKey: (song) => song && song.provider === 'qq' ? 'qq' : 'netease',
    encodeURIComponent,
    Promise,
    Array,
    Math,
    Number,
    Object,
    String,
    Set,
    isFinite,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function normalizeLyricMatchCandidate(candidate)'),
    functionSource('function lyricPrimaryArtistName(song)'),
    functionSource('function lyricSearchQuery(song)'),
    functionSource('function normalizeLyricIdentityText(text)'),
    functionSource('function lyricVersionTags(title)'),
    functionSource('function lyricBaseTitleForMatch(title)'),
    functionSource('function lyricPrimaryArtistForMatch(song)'),
    functionSource('function lyricArtistNamesForMatch(song)'),
    functionSource('function lyricCandidateVersionMatches(song, candidate)'),
    functionSource('function lyricCandidateMatchScore(song, candidate)'),
    functionSource('function rankLyricSearchCandidates(song, list)'),
    functionSource('function isReliableOriginalLyricCandidate(song, candidate)'),
    functionSource('function qqPayloadHasNativeKaraoke(payload)'),
    functionSource('function lyricPayloadHasPlainText(payload)'),
    functionSource('async function mapWithConcurrency(items, limit, worker)'),
    functionSource('function lyricCandidateMetadataSuffix(candidate)'),
    functionSource('function lyricCandidateRequestUrl(provider, candidate, options)'),
    functionSource('async function fetchQQLyricPayload(song, options)'),
    'this.fetchQQ = fetchQQLyricPayload;',
  ].join('\n'), context);

  const studio = await context.fetchQQ({ name: 'Test Song', artist: 'Original Singer', duration: 240, provider: 'spotify' });
  assert.equal(studio.qrc, payloads['original-qrc'].qrc,
    'An original studio QRC should win even when a cover is listed first and its duration is closer');
  assert.equal(calls.some((url) => url.includes('mid=cover-qrc')), false,
    'Cover candidates should remain manual choices rather than automatic lyric probes');

  calls.length = 0;
  const directQqUpgrade = await context.fetchQQ({ provider:'qq', mid:'original-lrc', name:'Test Song', artist:'Original Singer', duration:240 });
  assert.equal(directQqUpgrade.qrc, payloads['original-qrc'].qrc,
    'A directly playable QQ track with only LRC should still search all candidates for an available QRC');

  calls.length = 0;
  payloads['original-qrc'] = { qrc: '', lyric: '[00:00]Original fallback' };
  const originalLine = await context.fetchQQ({ name: 'Test Song', artist: 'Original Singer', duration: 240, provider: 'spotify' });
  assert.match(originalLine.lyric, /Original/, 'Original line lyrics should beat a cover QRC');

  calls.length = 0;
  const live = await context.fetchQQ({ name: 'Test Song (Live)', artist: 'Original Singer', duration: 240, provider: 'spotify' });
  assert.equal(live.qrc, payloads['original-live-qrc'].qrc, 'An explicitly tagged Live track should prefer the matching Live version');
  assert.ok(calls.filter((url) => url.startsWith('/api/qq/lyric')).length <= 12, 'Automatic matching may inspect every QQ search result');

  payloads['original-lrc'] = {};
  payloads['original-qrc'] = {};
  payloads['original-live-qrc'] = {};
  for (let index = 0; index < 5; index += 1) {
    const mid = `empty-original-${index}`;
    payloads[mid] = {};
    searchSongs.unshift({ mid, name:'Test Song', artist:'Original Singer', duration:240 + index });
  }
  const finalCover = await context.fetchQQ({ name: 'Test Song', artist: 'Original Singer', provider: 'spotify' }, { allowCover:true });
  assert.equal(finalCover.qrc, payloads['cover-qrc'].qrc, 'A cover may be used only as the final automatic fallback');
}

async function verifyForcedCandidateRefreshBypassesCache() {
  const calls = [];
  const context = {
    apiJson: async (url) => { calls.push(url); return { lyric: '[00:00]Fresh' }; },
    normalizeLyricMatchCandidate: (candidate) => candidate,
    ensureLyricPayloadRomanization: async (song, payload) => payload,
    currentLyricSong: () => ({ name:'Song', artist:'Singer' }),
    encodeURIComponent,
    Object,
    String,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function lyricCandidateMetadataSuffix(candidate)'),
    functionSource('function lyricCandidateRequestUrl(provider, candidate, options)'),
    functionSource('async function fetchLyricPayloadForCandidate(candidate, options)'),
    'this.fetchCandidate = fetchLyricPayloadForCandidate;',
  ].join('\n'), context);
  await context.fetchCandidate({ provider: 'qq', mid: 'qq-mid', name:'Song', artist:'Singer', album:'Album' }, { refresh: true });
  await context.fetchCandidate({ provider: 'netease', id: 42, name:'Song', artist:'Singer', album:'Album' }, { refresh: true });
  assert.ok(calls[0].includes('refresh=1'), 'Refreshing a QQ selection should bypass its persistent cache');
  assert.ok(calls[1].includes('refresh=1'), 'Refreshing a NetEase selection should bypass its persistent cache');
  assert.ok(calls.every((url) => url.includes('name=Song') && url.includes('artist=Singer')),
    'Lyric requests should carry stable match metadata into the persistent cache');
}

async function verifyPlaybackUsesOneSongCacheBeforeSearching() {
  const song = { provider:'spotify', id:'spotify-track', name:'Cached Song', artist:'Singer', duration:240 };
  const calls = [];
  const context = {
    fetchSongLyricCache: async () => {
      calls.push('cache:get');
      return { provider:'qq', qrc:'[0,1000]Cached(0,1000)', cache:{ hit:true } };
    },
    saveSongLyricCache: async () => { calls.push('cache:set'); },
    getManualLyricCandidate: () => ({ provider:'qq', mid:'manual' }),
    fetchLyricPayloadForCandidate: async () => { calls.push('manual'); return { lyric:'manual' }; },
    fetchQQLyricPayload: async () => { calls.push('qq'); return { lyric:'qq' }; },
    fetchNeteaseLyricPayload: async () => { calls.push('netease'); return { lyric:'netease' }; },
    lyricCacheCandidateFromPayload: (payload) => ({ provider:payload && payload.provider || 'qq' }),
    lyricPayloadHasUsableText: (payload) => Boolean(payload && (payload.qrc || payload.lyric)),
    waitLyricCacheRetryDelay: async (delayMs) => { calls.push(`delay:${delayMs}`); },
    markLyricCacheRetry: () => { calls.push('cache:mark'); },
    scheduleLyricCacheWriteRetry: () => { calls.push('cache:bg'); },
    console: { warn() {} },
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function fetchOnlineLyricPayload(song, options)'),
    'this.resolveLyric = fetchOnlineLyricPayload;',
  ].join('\n'), context);
  const cached = await context.resolveLyric(song);
  assert.equal(cached.cache.hit, true);
  assert.deepEqual(calls, ['cache:get'], 'A song cache hit must bypass manual pins and all provider searches');

  calls.length = 0;
  context.fetchSongLyricCache = async () => { calls.push('cache:get'); return null; };
  context.getManualLyricCandidate = () => null;
  context.fetchQQLyricPayload = async () => { calls.push('qq'); return { provider:'qq', qrc:'[0,1000]Fresh(0,1000)' }; };
  context.saveSongLyricCache = async (currentSong, payload, selection) => {
    calls.push(`cache:set:${selection.mode}`);
    return Object.assign({}, payload, { cache:{ hit:false, stored:true } });
  };
  const fresh = await context.resolveLyric(song);
  await Promise.resolve();
  assert.match(fresh.qrc, /Fresh/);
  assert.deepEqual(calls, ['cache:get', 'qq', 'cache:set:auto'], 'Only the final automatic winner should enter the song cache');

  calls.length = 0;
  context.saveSongLyricCache = async () => { calls.push('cache:set:failed'); throw new Error('disk unavailable'); };
  const uncached = await context.resolveLyric(song);
  for (let flush = 0; flush < 3; flush += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.match(uncached.qrc, /Fresh/, 'A cache write failure must not discard a usable QQ QRC result');
  assert.deepEqual(calls, [
    'cache:get', 'qq',
    'cache:set:failed', 'delay:250',
    'cache:set:failed', 'delay:750',
    'cache:set:failed', 'delay:1500',
    'cache:set:failed', 'cache:mark', 'cache:bg',
  ], 'An automatic QQ cache failure should retry only the local POST and must not fall back to NetEase');

  calls.length = 0;
  context.saveSongLyricCache = async () => { calls.push('cache:set:stale'); return { lyric:'wrong' }; };
  const stale = await context.resolveLyric(song, { canCommit:() => false });
  assert.match(stale.qrc, /Fresh/, 'A stale automatic request may return its payload to the caller for rejection');
  assert.deepEqual(calls, ['cache:get', 'qq'], 'A stale automatic request must not overwrite the current song cache');

  calls.length = 0;
  context.songCustomLyricKey = () => 'retry-key';
  context.lyricCacheRetryKeys = { 'retry-key':true };
  context.getManualLyricCandidate = () => ({ provider:'qq', mid:'old-manual' });
  context.saveSongLyricCache = async (currentSong, payload, selection) => {
    calls.push(`cache:set:${selection.mode}`);
    return Object.assign({}, payload, { cache:{ stored:true } });
  };
  const retried = await context.resolveLyric(song);
  assert.match(retried.lyric, /manual/);
  assert.deepEqual(calls, ['manual', 'cache:set:manual'],
    'A pending manual cache replacement must refetch only the exact saved candidate on the next playback');
  assert.equal(context.lyricCacheRetryKeys['retry-key'], undefined, 'A successful fresh cache write should release the retry bypass');
}

async function verifyAppleTranslationPriorityUsesWholeProviderPayloads() {
  const song = { provider:'spotify', id:'spotify-track', name:'Apple Song', artist:'Singer', duration:240 };
  const calls = [];
  let sourceContext = {
    active:true,
    translationPriority:true,
    policy:'apple-beta:translation-required:us:zh-Hans',
    auth:{ configured:true, valid:true },
  };
  let applePayload = {
    provider:'apple',
    structuredLines:[{ text:'Apple original', karaokeTimeline:[{ text:'Apple', start:0, duration:500, timed:true }] }],
  };
  let qqPayload = { provider:'qq', lyric:'[00:00.00]QQ original', trans:'[00:00.00]QQ translation' };
  let manualCandidate = null;
  const context = {
    appleMusicLyricSourceContext: async () => sourceContext,
    fetchAppleMusicLyricPayload: async () => { calls.push('apple'); return applePayload; },
    fetchQQLyricPayload: async () => { calls.push('qq'); return qqPayload; },
    fetchNeteaseLyricPayload: async () => { calls.push('netease'); return {}; },
    fetchLyricPayloadForCandidate: async (candidate) => {
      calls.push(`manual:${candidate.provider}`);
      return applePayload;
    },
    getManualLyricCandidate: () => manualCandidate,
    lyricPayloadHasUsableText: (payload) => Boolean(payload && (
      payload.lyric || payload.qrc || (Array.isArray(payload.structuredLines) && payload.structuredLines.length)
    )),
    lyricPayloadHasUsefulTranslation: (payload) => Boolean(payload && (
      String(payload.trans || payload.tlyric || '').trim() ||
      (Array.isArray(payload.structuredLines) && payload.structuredLines.some((line) => String(line.transText || '').trim()))
    )),
    ensureLyricPayloadRomanization: async (currentSong, payload) => payload,
    songCustomLyricKey: () => 'apple-policy-song',
    getLyricMatchEntry: () => null,
    console: { warn() {} },
    Array,
    Boolean,
    Object,
    String,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function fetchOnlineLyricPayload(song, options)'),
    'this.resolveLyric = fetchOnlineLyricPayload;',
  ].join('\n'), context);

  let resolved = await context.resolveLyric(song, { store:false, skipSongCache:true, ignoreManual:true });
  assert.equal(resolved.provider, 'qq',
    'Translation priority should replace the complete Apple payload only when QQ has a usable translation');
  assert.deepEqual(calls, ['apple', 'qq']);

  calls.length = 0;
  qqPayload = { provider:'qq', lyric:'[00:00.00]QQ original without translation' };
  resolved = await context.resolveLyric(song, { store:false, skipSongCache:true, ignoreManual:true });
  assert.equal(resolved.provider, 'apple',
    'Apple word timing should remain selected when QQ also has no translation');
  assert.deepEqual(calls, ['apple', 'qq']);

  calls.length = 0;
  applePayload = {
    provider:'apple',
    structuredLines:[{ text:'Apple original', transText:'Apple translation' }],
  };
  resolved = await context.resolveLyric(song, { store:false, skipSongCache:true, ignoreManual:true });
  assert.equal(resolved.provider, 'apple', 'Apple TTML with translation should bypass QQ entirely');
  assert.deepEqual(calls, ['apple']);

  calls.length = 0;
  applePayload = { provider:'apple', structuredLines:[{ text:'Manual Apple without translation' }] };
  manualCandidate = { provider:'apple', id:'apple-song-id', storefront:'us' };
  resolved = await context.resolveLyric(song, { store:false, skipSongCache:true });
  assert.equal(resolved.provider, 'apple',
    'An explicit Apple selection must not be replaced by translation priority');
  assert.deepEqual(calls, ['manual:apple']);
}

async function verifyAppleCandidateCapabilitiesAndAuthFailures() {
  const song = { provider:'spotify', name:'Apple Song', artist:'Singer', album:'Album', duration:200 };
  const candidates = [
    { provider:'apple', id:'word-no-translation', name:'Apple Song', artist:'Singer', album:'Album', duration:200, storefront:'us' },
    { provider:'apple', id:'word-with-translation', name:'Apple Song', artist:'Singer', album:'Album', duration:201, storefront:'us' },
  ];
  let invalidateCalls = 0;
  let rejectLyricsWithAuth = false;
  const context = {
    appleMusicLyricSourceContext: async () => ({
      active:true,
      translationPriority:true,
      policy:'apple-beta:translation-required:us:zh-Hans',
      auth:{ configured:true, valid:true },
    }),
    appleMusicLyricApiJson: async (url) => {
      if (url.includes('/search?')) return { songs:candidates };
      if (rejectLyricsWithAuth) {
        const error = new Error('expired');
        error.status = 401;
        throw error;
      }
      const id = new URL(`http://local${url}`).searchParams.get('id');
      return {
        provider:'apple',
        id,
        timingSource:'apple-ttml-word',
        hasTranslation:id === 'word-with-translation',
        structuredLines:[{ text:'Apple lyric', transText:id === 'word-with-translation' ? '苹果翻译' : '' }],
      };
    },
    apiJson: async (url) => url.startsWith('/api/qq/search') || url.startsWith('/api/search') ? { songs:[] } : {},
    invalidateAppleMusicLyricAuthStatus: () => { invalidateCalls += 1; },
    lyricPayloadHasUsableText: (payload) => Boolean(payload && Array.isArray(payload.structuredLines) && payload.structuredLines.length),
    lyricPayloadHasUsefulTranslation: (payload) => Boolean(payload && (
      payload.hasTranslation || payload.structuredLines && payload.structuredLines.some((line) => line.transText)
    )),
    songProviderKey: () => 'spotify',
    currentLyricSong: () => song,
    encodeURIComponent,
    URL,
    Promise,
    Array,
    Math,
    Number,
    Object,
    String,
    Set,
    isFinite,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function normalizeLyricMatchCandidate(candidate)'),
    functionSource('function lyricPrimaryArtistName(song)'),
    functionSource('function lyricSearchQuery(song)'),
    functionSource('function normalizeLyricIdentityText(text)'),
    functionSource('function lyricVersionTags(title)'),
    functionSource('function lyricBaseTitleForMatch(title)'),
    functionSource('function lyricPrimaryArtistForMatch(song)'),
    functionSource('function lyricArtistNamesForMatch(song)'),
    functionSource('function lyricCandidateVersionMatches(song, candidate)'),
    functionSource('function lyricCandidateMatchScore(song, candidate)'),
    functionSource('function rankLyricSearchCandidates(song, list)'),
    functionSource('function isReliableOriginalLyricCandidate(song, candidate)'),
    functionSource('async function mapWithConcurrency(items, limit, worker)'),
    functionSource('function lyricCandidateMetadataSuffix(candidate)'),
    functionSource('function lyricCandidateRequestUrl(provider, candidate, options)'),
    functionSource('async function enrichAppleMusicLyricCandidates(candidates)'),
    functionSource('async function searchLyricCandidates(song, query)'),
    functionSource('async function fetchAppleMusicLyricPayload(song, options, sourceContext)'),
    'this.searchCandidates = searchLyricCandidates;',
    'this.fetchApple = fetchAppleMusicLyricPayload;',
  ].join('\n'), context);

  const inspected = await context.searchCandidates(song, 'Apple Song Singer');
  const inspectedApple = inspected.filter((candidate) => candidate.provider === 'apple');
  assert.equal(inspectedApple.length, 2);
  assert.equal(inspectedApple[0].timingSource, 'apple-ttml-word');
  assert.equal(inspectedApple[0].capabilitiesInspected, true);
  assert.equal(inspectedApple[0].hasTranslation, false);
  assert.equal(inspectedApple[1].hasTranslation, true,
    'The manual selection page should inspect Apple timing and translation capabilities without caching');

  const preferred = await context.fetchApple(song, {}, await context.appleMusicLyricSourceContext());
  assert.equal(preferred.id, 'word-with-translation',
    'Translation priority should prefer an otherwise equivalent translated Apple TTML candidate');

  rejectLyricsWithAuth = true;
  const unavailable = await context.fetchApple(song, {}, await context.appleMusicLyricSourceContext());
  assert.equal(unavailable, null);
  assert.equal(invalidateCalls, 1,
    'A swallowed candidate-level 401 must still invalidate Apple auth status before silent fallback');
}

async function verifyLatePlaybackRequestCannotApplyAfterManualSelection() {
  let resolvePayload;
  let applied = 0;
  let capturedOptions = null;
  const context = {
    lyricSelectionToken: 4,
    trackSwitchToken: 8,
    fetchOnlineLyricPayload(song, options) {
      capturedOptions = options;
      return new Promise((resolve) => { resolvePayload = resolve; });
    },
    applyLyricPayload() { applied += 1; return true; },
    setOriginalLyricsState() {},
    applyPreferredLyricsForCurrent() {},
    withLyricFallback: () => [],
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('async function fetchLyric(songOrId, token)')}; this.fetchCurrent = fetchLyric;`, context);
  const pending = context.fetchCurrent({ name:'Song', artist:'Singer' }, 8);
  context.lyricSelectionToken = 5;
  resolvePayload({ provider:'qq', qrc:'[0,1000]Late(0,1000)' });
  assert.equal(await pending, false, 'A playback request started before manual selection should be discarded');
  assert.equal(capturedOptions.canCommit(), false, 'The automatic cache commit guard should become stale with the selection token');
  assert.equal(applied, 0, 'A late automatic result must not replace the manually applied lyric');
}

async function verifySourcePolicyRefreshPreservesVisibleLyrics() {
  const fetchSource = functionSource('async function fetchLyric(songOrId, token)');
  async function runCase(fetchResult) {
    let applied = 0;
    let fallbackWrites = 0;
    const context = {
      trackSwitchToken:8,
      lyricSelectionToken:4,
      fetchOnlineLyricPayload:async () => {
        if (fetchResult instanceof Error) throw fetchResult;
        return fetchResult;
      },
      lyricPayloadHasUsableText:(payload) => !!(payload && payload.usable),
      applyLyricPayload() { applied += 1; return true; },
      setOriginalLyricsState() { fallbackWrites += 1; },
      applyPreferredLyricsForCurrent() { fallbackWrites += 1; },
      withLyricFallback:() => [],
      Promise,
    };
    vm.createContext(context);
    vm.runInContext(`${fetchSource}; this.fetchCurrent = fetchLyric;`, context);
    const committed = await context.fetchCurrent(
      { name:'Policy Song', artist:'Singer' },
      8,
      { preserveVisibleLyrics:true },
    );
    return { committed, applied, fallbackWrites };
  }

  assert.deepEqual(await runCase({}), { committed:false, applied:0, fallbackWrites:0 },
    'An empty source-policy refresh must leave the visible lyric untouched');
  assert.deepEqual(await runCase(new Error('Timed out')), { committed:false, applied:0, fallbackWrites:0 },
    'A failed source-policy refresh must leave the visible lyric untouched');
  assert.deepEqual(await runCase({ usable:true }), { committed:true, applied:1, fallbackWrites:0 },
    'A valid source-policy refresh should atomically replace the visible lyric');
}

async function verifySpotifyAutomaticRequestIncludesDuration() {
  let requestedSong = null;
  const context = {
    spotifyCurrentTrackToken: 11,
    window: { spotifyAudioDuration:243.2 },
    fetchLyric: async (song) => { requestedSong = song; return true; },
    Number,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('async function searchAndFetchSpotifyLyric(title, artist, token)')}; this.searchSpotifyLyric = searchAndFetchSpotifyLyric;`, context);
  await context.searchSpotifyLyric('Song', 'Singer', 11);
  assert.equal(requestedSong.duration, 243.2, 'Spotify automatic and manual cache writes must use the same duration identity');
}

async function verifyNeteaseFallbackAvoidsCovers() {
  const calls = [];
  const context = {
    apiJson: async (url) => {
      calls.push(url);
      if (url.startsWith('/api/search')) return { songs: [
        { id: 1, name: 'Test Song', artist: 'Cover Singer' },
        { id: 2, name: 'Test Song', artist: 'Original Singer' },
      ] };
      return { lyric: url.includes('id=2') ? '[00:00]Original' : '[00:00]Cover' };
    },
    songProviderKey: () => 'qq',
    lyricSearchQuery: (song) => `${song.name} ${song.artist}`,
    encodeURIComponent,
    Array,
    Math,
    Number,
    String,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function normalizeLyricIdentityText(text)'),
    functionSource('function lyricPrimaryArtistName(song)'),
    functionSource('function lyricVersionTags(title)'),
    functionSource('function lyricBaseTitleForMatch(title)'),
    functionSource('function lyricPrimaryArtistForMatch(song)'),
    functionSource('function lyricArtistNamesForMatch(song)'),
    functionSource('function lyricCandidateVersionMatches(song, candidate)'),
    functionSource('function lyricCandidateMatchScore(song, candidate)'),
    functionSource('function rankLyricSearchCandidates(song, list)'),
    functionSource('function isReliableOriginalLyricCandidate(song, candidate)'),
    functionSource('function lyricCandidateMetadataSuffix(candidate)'),
    functionSource('function lyricCandidateRequestUrl(provider, candidate, options)'),
    functionSource('async function fetchNeteaseLyricPayload(song, options)'),
    'this.fetchNetease = fetchNeteaseLyricPayload;',
  ].join('\n'), context);
  const payload = await context.fetchNetease({ name: 'Test Song', artist: 'Original Singer', provider: 'spotify' });
  assert.equal(payload.lyric, '[00:00]Original');
  assert.ok(calls.some((url) => url.includes('id=2')));
  assert.equal(calls.some((url) => url.includes('id=1')), false, 'A cover should remain visible only for manual selection');
}

async function verifyRefetchReleasesManualPinAndKeepsDelay() {
  const song = { id:'current', name:'Song', artist:'Singer' };
  let observedCandidate = 'not-called';
  let observedOptions = null;
  let automaticPayload = { lyric:'[00:00]Automatic lyric' };
  let storedSelection = null;
  let applied = 0;
  const context = {
    lyricSelectionToken: 0,
    trackSwitchToken: 9,
    currentLyricCacheInfo: { revision:7 },
    lyricMatchPrefs: { key:{ candidate:{ provider:'qq', mid:'manual' }, delayMs:730 } },
    currentLyricSong: () => song,
    songCustomLyricKey: () => 'key',
    saveLyricMatchPrefs() {},
    updateLyricMatchControls() {},
    setLyricMatchStatus() {},
    showToast() {},
    refreshLyricCacheStatus() {},
    fetchOnlineLyricPayload: async (currentSong, options) => {
      observedCandidate = context.lyricMatchPrefs.key.candidate;
      observedOptions = options;
      return automaticPayload;
    },
    lyricCacheCandidateFromPayload: () => ({ provider:'qq', mid:'automatic' }),
    saveSongLyricCache: async (currentSong, payload, selection) => {
      storedSelection = selection;
      return Object.assign({}, payload, { cache:{ stored:true } });
    },
    lyricPayloadHasUsableText: (payload) => Boolean(payload && payload.lyric),
    applyLyricPayload() { applied += 1; },
    customLyricPrefs: {},
    saveCustomLyricPrefs() {},
    Number,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('async function refreshCurrentLyricCache()')}; this.refreshCurrent = refreshCurrentLyricCache;`, context);
  assert.equal(await context.refreshCurrent(), true);
  assert.equal(observedCandidate.mid, 'manual', 'The working manual pin should remain intact until automatic replacement succeeds');
  assert.equal(observedOptions.ignoreManual, true, 'Refetch should bypass the manual candidate without deleting it first');
  assert.equal(context.lyricMatchPrefs.key.candidate, null, 'A successful automatic replacement should release the manual pin');
  assert.equal(storedSelection.replaceManual, true, 'Only an explicit refetch may authorize replacing a manual cache');
  assert.equal(storedSelection.expectedRevision, 7, 'Explicit replacement should be conditional on the cache revision it started from');
  assert.equal(context.lyricMatchPrefs.key.delayMs, 730, 'Refetch should preserve the current-song correction');
  assert.equal(applied, 1);

  context.lyricMatchPrefs.key.candidate = { provider:'qq', mid:'manual-again' };
  automaticPayload = {};
  assert.equal(await context.refreshCurrent(), false, 'A failed refresh should not replace the working lyric');
  assert.equal(context.lyricMatchPrefs.key.candidate.mid, 'manual-again', 'A failed refresh must preserve the manual pin');
  assert.equal(applied, 1, 'A failed refresh must preserve the currently applied lyric');
}

async function verifyManualSelectionPersistsAndOverridesAutomaticMatching() {
  const saved = [];
  const applied = [];
  const cached = [];
  const removed = [];
  const backgroundRetries = [];
  const preferencesAtApply = [];
  let candidateHasLyrics = true;
  let candidateRequestFails = false;
  let cacheWriteFails = false;
  let cacheWriteTimesOutOnce = false;
  const candidate = { provider: 'netease', id: 202, name: 'Chosen Song', artist: 'Chosen Singer', album: 'Chosen Album' };
  const song = { provider: 'spotify', id: 'spotify-current', name: 'Song', artist: 'Singer' };
  const context = {
    currentLyricSong: () => song,
    songCustomLyricKey: () => 'current-song-key',
    lyricMatchPrefs: {},
    lyricSelectionToken: 0,
    saveLyricMatchPrefs() { saved.push(JSON.parse(JSON.stringify(context.lyricMatchPrefs))); },
    fetchLyricPayloadForCandidate: async () => {
      if (candidateRequestFails) throw new Error('lyric request failed');
      return candidateHasLyrics ? { lyric: '[00:00.00]Chosen lyric' } : { lyric: '' };
    },
    saveSongLyricCache: async (currentSong, payload, selection) => {
      cached.push({ currentSong, payload, selection });
      if (cacheWriteTimesOutOnce) {
        cacheWriteTimesOutOnce = false;
        throw new Error('Timed out');
      }
      return cacheWriteFails ? null : Object.assign({}, payload, { cache:{ stored:true, hit:false } });
    },
    removeSongLyricCache: async (currentSong) => { removed.push(currentSong.id); return true; },
    scheduleLyricCacheWriteRetry(currentSong, payload, selection) {
      backgroundRetries.push({ currentSong, payload, selection });
    },
    waitLyricCacheRetryDelay: async () => {},
    markLyricCacheRetry() {},
    lyricPayloadHasUsableText: (payload) => Boolean(payload && payload.lyric),
    applyLyricPayload(payload, token) {
      preferencesAtApply.push(context.customLyricPrefs['current-song-key']);
      applied.push({ payload, token });
      return true;
    },
    applyOriginalLyricsState() {},
    trackSwitchToken: 17,
    customLyricPrefs: {},
    saveCustomLyricPrefs() {},
    showToast() {},
    updateLyricMatchControls() {},
    Promise,
    String,
    Number,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function normalizeLyricMatchCandidate(candidate)'),
    functionSource('async function saveSongLyricCacheWithLegacyRetry(song, payload, selection, canContinue)'),
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function selectLyricCandidate(candidate)'),
    'this.selectCandidate = selectLyricCandidate;',
  ].join('\n'), context);
  context.customLyricPrefs['current-song-key'] = 'custom';
  assert.equal((await context.selectCandidate(candidate)).ok, true);
  assert.equal(saved.length, 1, 'Choosing a lyric should persist the selection for the current song');
  assert.equal(saved[0]['current-song-key'].candidate.id, 202);
  assert.equal(saved[0]['current-song-key'].candidate.provider, 'netease');
  assert.equal(applied.length, 1, 'Choosing a lyric should apply the selected payload immediately');
  assert.equal(applied[0].payload.lyric, '[00:00.00]Chosen lyric');
  assert.equal(applied[0].token, 17);
  assert.equal(preferencesAtApply[0], 'original',
    'A manual candidate should disable the previous custom lyric before applying the parsed payload');
  assert.equal(cached.length, 1, 'A successful manual selection should replace the current song cache');
  assert.equal(cached[0].selection.mode, 'manual');
  assert.equal(cached[0].selection.candidate.id, 202);

  saved.length = 0;
  cached.length = 0;
  cacheWriteTimesOutOnce = true;
  const recoveredTimeout = await context.selectCandidate({ provider:'qq', mid:'timeout-once', name:'Timeout Once' });
  assert.equal(recoveredTimeout.ok, true, 'A transient local cache timeout must not invalidate parsed manual lyrics');
  assert.equal(recoveredTimeout.cacheStored, true, 'A transient local cache timeout should be retried and persisted');
  assert.equal(cached.length, 2, 'Manual cache persistence should retry one transient Timed out failure');
  assert.equal(context.lyricMatchPrefs['current-song-key'].candidate.mid, 'timeout-once',
    'The successfully retried manual lyric should remain pinned for the next playback');

  saved.length = 0;
  candidateHasLyrics = false;
  const emptyResult = await context.selectCandidate({ provider: 'qq', mid: 'empty-qq', name: 'Empty' });
  assert.equal(emptyResult.ok, false, 'A search result with no lyric payload should be rejected');
  assert.equal(saved.length, 0, 'An empty lyric candidate must not replace the saved working selection');
  assert.equal(context.lyricMatchPrefs['current-song-key'].candidate.mid, 'timeout-once');

  saved.length = 0;
  cached.length = 0;
  candidateHasLyrics = true;
  cacheWriteFails = true;
  const failedCacheReplace = await context.selectCandidate({ provider:'qq', mid:'cache-fail', name:'Cache Fail' });
  assert.equal(failedCacheReplace.ok, true, 'A usable manual lyric should still apply when only its cache write fails');
  assert.equal(failedCacheReplace.cacheStored, false, 'The structured result should distinguish cache failure from an empty lyric');
  assert.equal(applied.at(-1).payload.lyric, '[00:00.00]Chosen lyric', 'The fetched lyric should remain usable for the current playback session');
  assert.equal(context.lyricMatchPrefs['current-song-key'].candidate.mid, 'cache-fail',
    'A transient cache failure must preserve the exact QQ candidate for the next playback');
  assert.equal(context.lyricMatchPrefs['current-song-key'].cachePending, true,
    'The persisted selection should record that its local cache still needs to be written');
  assert.equal(removed.length, 0, 'A transient replacement failure must not delete the last usable song cache');
  assert.equal(saved.length, 1, 'The selected QQ candidate and pending-cache state should be persisted once');
  assert.equal(cached.length, 4, 'Manual persistence should make the initial cache POST plus three foreground retries');
  assert.equal(backgroundRetries.length, 1, 'A failed foreground sequence should queue one bounded background cache job');
  assert.equal(backgroundRetries[0].selection.candidate.mid, 'cache-fail',
    'The background job should reuse the parsed payload and exact candidate without searching QQ again');
  cacheWriteFails = false;

  saved.length = 0;
  candidateHasLyrics = true;
  candidateRequestFails = true;
  const failedRequest = await context.selectCandidate({ provider: 'qq', mid: 'failed-qq', name: 'Failed' });
  assert.equal(failedRequest.ok, false, 'A failed lyric request should not report a successful selection');
  assert.equal(saved.length, 0);
  assert.equal(context.lyricMatchPrefs['current-song-key'].candidate.mid, 'cache-fail');
  candidateRequestFails = false;

  saved.length = 0;
  cached.length = 0;
  backgroundRetries.length = 0;
  cacheWriteFails = true;
  const failedNeteaseCache = await context.selectCandidate({ provider:'netease', id:303, name:'NetEase Failure' });
  assert.equal(failedNeteaseCache.ok, true,
    'A parsed NetEase manual lyric should remain visible for the current playback when caching fails');
  assert.equal(cached.length, 2,
    'NetEase manual caching should retain its legacy initial attempt plus one bounded retry');
  assert.equal(backgroundRetries.length, 0,
    'The new QQ background cache writer must not run for NetEase lyrics');
  assert.equal(context.lyricMatchPrefs['current-song-key'].candidate, null,
    'A failed NetEase cache write should retain the legacy next-play automatic-search behavior');
  assert.equal(context.lyricMatchPrefs['current-song-key'].cachePending, false);
  cacheWriteFails = false;

  const apiCalls = [];
  const resolverContext = {
    fx: { lyricProviderPriority: 'qq' },
    getManualLyricCandidate: () => candidate,
    fetchSongLyricCache: async () => null,
    saveSongLyricCache: async (currentSong, selectedPayload) => selectedPayload,
    fetchLyricPayloadForCandidate: async (selected) => {
      apiCalls.push(`${selected.provider}:${selected.id}`);
      return { lyric: '[00:00.00]Chosen lyric' };
    },
    fetchQQLyricPayload: async () => { apiCalls.push('qq:auto'); return { lyric: '[00:00.00]Wrong lyric' }; },
    fetchNeteaseLyricPayload: async () => { apiCalls.push('netease:auto'); return { lyric: '[00:00.00]Wrong lyric' }; },
    normalizeLyricProviderPriority: (value) => value === 'netease' ? 'netease' : 'qq',
    lyricPayloadHasUsableText: (payload) => Boolean(payload && payload.lyric),
  };
  vm.createContext(resolverContext);
  vm.runInContext([
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function fetchOnlineLyricPayload(song, options)'),
    'this.resolveLyric = fetchOnlineLyricPayload;',
  ].join('\n'), resolverContext);
  const payload = await resolverContext.resolveLyric(song);
  assert.equal(payload.lyric, '[00:00.00]Chosen lyric');
  assert.deepEqual(apiCalls, ['netease:202'], 'A saved manual selection must bypass automatic provider matching');
}

async function verifyLatestSelectionWinsAndOldTrackSearchIsDiscarded() {
  let currentSong = { id: 'song-a', name: 'Song A', artist: 'Singer' };
  const pendingPayloads = new Map();
  let pendingAutoResolve = null;
  let delayAutomaticPayload = false;
  const savedCandidates = [];
  const appliedCandidates = [];
  const context = {
    lyricSelectionToken: 0,
    lyricMatchPrefs: {},
    currentLyricSong: () => currentSong,
    songCustomLyricKey: (song) => song && song.id,
    normalizeLyricMatchCandidate: (candidate) => ({ ...candidate, source: candidate.provider }),
    fetchLyricPayloadForCandidate(candidate) {
      return new Promise((resolve, reject) => pendingPayloads.set(candidate.id, { resolve, reject }));
    },
    saveSongLyricCache: async (currentSong, payload) => payload,
    lyricCacheCandidateFromPayload: (payload) => ({ provider:'qq', id:payload && payload.id || 'auto' }),
    lyricPayloadHasUsableText: (payload) => Boolean(payload && payload.lyric),
    saveLyricMatchPrefs() {
      const selected = context.lyricMatchPrefs['song-a'].candidate;
      savedCandidates.push(selected ? selected.id : null);
    },
    customLyricPrefs: {},
    saveCustomLyricPrefs() {},
    applyLyricPayload(payload) { appliedCandidates.push(payload.id); },
    updateLyricMatchControls() {},
    renderLyricMatchResults() {},
    setLyricMatchStatus() {},
    showToast() {},
    fetchOnlineLyricPayload() {
      if (!delayAutomaticPayload) return Promise.resolve({ id: 'auto', lyric: '[00:00.00]Automatic' });
      return new Promise((resolve) => { pendingAutoResolve = resolve; });
    },
    trackSwitchToken: 31,
    Promise,
    Number,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('async function saveSongLyricCacheWithLegacyRetry(song, payload, selection, canContinue)'),
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function selectLyricCandidate(candidate)'),
    functionSource('async function clearManualLyricCandidate()'),
    'this.selectCandidate = selectLyricCandidate;',
    'this.clearCandidate = clearManualLyricCandidate;',
  ].join('\n'), context);
  const first = context.selectCandidate({ provider: 'netease', id: 1, name: 'First' });
  const second = context.selectCandidate({ provider: 'netease', id: 2, name: 'Second' });
  pendingPayloads.get(2).resolve({ id: 2, lyric: '[00:00.00]Second' });
  await second;
  pendingPayloads.get(1).resolve({ id: 1, lyric: '[00:00.00]First' });
  assert.equal((await first).stale, true, 'A slower earlier selection should be discarded without changing UI status');
  assert.deepEqual(savedCandidates, [2]);
  assert.deepEqual(appliedCandidates, [2]);

  const third = context.selectCandidate({ provider: 'netease', id: 3, name: 'Third' });
  await context.clearCandidate();
  pendingPayloads.get(3).resolve({ id: 3, lyric: '[00:00.00]Third' });
  assert.equal((await third).stale, true, 'Restoring automatic matching should invalidate an in-flight manual selection');
  assert.deepEqual(savedCandidates, [2, null]);
  assert.deepEqual(appliedCandidates, [2, 'auto']);

  delayAutomaticPayload = true;
  const restoringAutomatic = context.clearCandidate();
  const fourth = context.selectCandidate({ provider: 'netease', id: 4, name: 'Fourth' });
  pendingPayloads.get(4).resolve({ id: 4, lyric: '[00:00.00]Fourth' });
  assert.equal((await fourth).ok, true);
  pendingAutoResolve({ id: 'late-auto', lyric: '[00:00.00]Late automatic' });
  assert.equal(await restoringAutomatic, false, 'A late automatic response must not overwrite a newer manual selection');
  assert.equal(context.lyricMatchPrefs['song-a'].candidate.id, 4);
  assert.deepEqual(appliedCandidates, [2, 'auto', 4]);

  const failingOld = context.selectCandidate({ provider:'netease', id:5, name:'Failing old' });
  const succeedingNew = context.selectCandidate({ provider:'netease', id:6, name:'Succeeding new' });
  pendingPayloads.get(6).resolve({ id:6, lyric:'[00:00.00]Newest' });
  assert.equal((await succeedingNew).ok, true);
  pendingPayloads.get(5).reject(new Error('late provider failure'));
  assert.equal((await failingOld).stale, true, 'A delayed rejection from an older selection must not overwrite the newer UI state');
  assert.equal(context.lyricMatchPrefs['song-a'].candidate.id, 6);
  assert.deepEqual(appliedCandidates, [2, 'auto', 4, 6]);

  let resolveSearch;
  const searchContext = {
    lyricMatchUiState: { candidates: [], searchToken: 0, loading: false, searchSongKey: '' },
    currentLyricSong: () => currentSong,
    songCustomLyricKey: (song) => song && song.id,
    document: { getElementById: () => ({ value: 'Song A Singer' }) },
    renderLyricMatchResults() {},
    setLyricMatchStatus() {},
    searchLyricCandidates: () => new Promise((resolve) => { resolveSearch = resolve; }),
    rankLyricSearchCandidates: (song, list) => list,
    isSameTitleArtist: () => true,
    Promise,
    String,
  };
  vm.createContext(searchContext);
  vm.runInContext(`${functionSource('async function runLyricMatchSearch()')}; this.runSearch = runLyricMatchSearch;`, searchContext);
  const search = searchContext.runSearch();
  currentSong = { id: 'song-b', name: 'Song B', artist: 'Singer' };
  resolveSearch([{ provider: 'qq', mid: 'old-song-result', name: 'Song A' }]);
  await search;
  assert.equal(searchContext.lyricMatchUiState.candidates.length, 0, 'Results from the previous track must not enter the current selection page');
}

async function verifyBoundedBackgroundCacheRetriesReuseParsedPayload() {
  const song = { id:'spotify-cache-retry', name:'Retry Song', artist:'Singer' };
  const payload = { provider:'qq', mid:'qq-retry', qrc:'[0,1000]Oh(0,1000)' };
  const candidate = { provider:'qq', mid:'qq-retry', name:'Retry Song', artist:'Singer' };
  const delays = [];
  const posts = [];
  let savedPrefs = 0;
  const context = {
    lyricCacheWriteRetryJobs: {},
    lyricCacheRetryKeys: { key:true },
    lyricMatchPrefs: { key:{ candidate:{ ...candidate }, delayMs:0, cachePending:true } },
    songCustomLyricKey: () => 'key',
    waitLyricCacheRetryDelay: async (delayMs) => { delays.push(delayMs); },
    saveSongLyricCache: async (postedSong, postedPayload, selection) => {
      posts.push({ postedSong, postedPayload, selection });
      if (posts.length < 3) return null;
      return { ...postedPayload, cache:{ stored:true } };
    },
    lyricPayloadHasUsableText: (value) => Boolean(value && value.qrc),
    saveLyricMatchPrefs() { savedPrefs += 1; },
    updateLyricMatchControls() {},
    currentLyricSong: () => song,
    showToast() {},
    JSON,
    Promise,
    String,
    Number,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function scheduleLyricCacheWriteRetry(song, payload, selection)'),
    'this.scheduleRetry = scheduleLyricCacheWriteRetry;',
  ].join('\n'), context);
  const firstJob = context.scheduleRetry(song, payload, { mode:'manual', candidate });
  const duplicateJob = context.scheduleRetry(song, payload, { mode:'manual', candidate });
  assert.equal(firstJob, duplicateJob, 'The same song and payload should share one background cache job');
  const stored = await firstJob;
  assert.equal(stored.cache.stored, true);
  assert.deepEqual(delays, [3000, 8000, 20000],
    'Background writes should follow the agreed bounded schedule and stop immediately after success');
  assert.equal(posts.length, 3);
  posts.forEach((post) => {
    assert.equal(post.postedPayload, payload,
      'Every background POST should reuse the already parsed QQ payload instead of fetching lyrics again');
    assert.equal(post.selection.candidate.mid, 'qq-retry');
  });
  assert.equal(context.lyricMatchPrefs.key.candidate.mid, 'qq-retry');
  assert.equal(context.lyricMatchPrefs.key.cachePending, false,
    'A confirmed background write should clear the persisted pending-cache state');
  assert.equal(context.lyricCacheRetryKeys.key, undefined);
  assert.equal(context.lyricCacheWriteRetryJobs.key, undefined,
    'The completed job should release its per-song slot');
  assert.equal(savedPrefs, 1);
}

async function verifyPendingManualCacheRefetchesExactCandidateAfterRestart(provider = 'qq') {
  const song = { id:'spotify-pending', name:'Pending Song', artist:'Singer' };
  const candidate = provider === 'apple'
    ? { provider:'apple', id:'apple-pending', storefront:'us', name:'Pending Song', artist:'Singer' }
    : { provider:'qq', mid:'qq-pending', name:'Pending Song', artist:'Singer' };
  let cacheReads = 0;
  let candidateFetches = 0;
  let cacheWrites = 0;
  const retryDelays = [];
  const context = {
    lyricCacheRetryKeys: {},
    lyricMatchPrefs: { key:{ candidate, delayMs:0, cachePending:true } },
    appleMusicLyricSourceContext: async () => ({
      active:true,
      translationPriority:false,
      policy:'apple-beta:translation-optional:us:zh-Hans',
      auth:{ configured:true, valid:true },
    }),
    songCustomLyricKey: () => 'key',
    getLyricMatchEntry: () => context.lyricMatchPrefs.key,
    getManualLyricCandidate: () => candidate,
    fetchSongLyricCache: async () => {
      cacheReads += 1;
      return { provider:'qq', mid:'old-cache', qrc:'[0,1000]Old(0,1000)', cache:{ hit:true } };
    },
    syncLyricPreferenceFromSongCache() {},
    fetchLyricPayloadForCandidate: async (selected) => {
      candidateFetches += 1;
      assert.equal(selected.provider, provider);
      return provider === 'apple'
        ? { provider:'apple', id:'apple-pending', structuredLines:[{ text:'New Apple lyric' }] }
        : { provider:'qq', mid:'qq-pending', qrc:'[0,1000]New(0,1000)' };
    },
    saveSongLyricCache: async (currentSong, payload) => {
      cacheWrites += 1;
      if (cacheWrites < 3) throw new Error('temporary local cache failure');
      return { ...payload, cache:{ stored:true } };
    },
    waitLyricCacheRetryDelay: async (delayMs) => { retryDelays.push(delayMs); },
    markLyricCacheRetry() {},
    scheduleLyricCacheWriteRetry() {},
    fetchQQLyricPayload: async () => { throw new Error('Automatic QQ search should not run'); },
    fetchNeteaseLyricPayload: async () => { throw new Error('NetEase fallback should not run'); },
    lyricPayloadHasUsableText: (payload) => Boolean(payload && (
      payload.qrc || payload.lyric || (Array.isArray(payload.structuredLines) && payload.structuredLines.length)
    )),
    lyricCacheCandidateFromPayload: () => candidate,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function fetchOnlineLyricPayload(song, options)'),
    'this.resolveLyric = fetchOnlineLyricPayload;',
  ].join('\n'), context);
  const resolved = await context.resolveLyric(song);
  assert.equal(provider === 'apple' ? resolved.id : resolved.mid, provider === 'apple' ? 'apple-pending' : 'qq-pending');
  assert.equal(cacheReads, 0,
    'A persisted pending manual selection should bypass the stale song cache after restart');
  assert.equal(candidateFetches, 1,
    `The resolver should refetch only the exact saved ${provider} candidate instead of searching all providers`);
  assert.equal(cacheWrites, 3,
    'The restarted exact-candidate path should retry transient local cache writes before giving up');
  assert.deepEqual(retryDelays, [250, 750]);
}

async function verifyEmptyPendingManualCandidateFallsBackToAutomaticSearch() {
  const song = { id:'spotify-empty-pending', name:'Recovered Song', artist:'Singer' };
  const candidate = { provider:'qq', mid:'qq-empty', name:'Recovered Song', artist:'Singer' };
  const automaticPayload = { provider:'qq', mid:'qq-auto-recovered', qrc:'[0,1000]Recovered(0,1000)' };
  let automaticSearches = 0;
  let savedPrefs = 0;
  const context = {
    lyricCacheRetryKeys: {},
    lyricMatchPrefs: { key:{ candidate, delayMs:120, cachePending:true } },
    songCustomLyricKey: () => 'key',
    getLyricMatchEntry: () => context.lyricMatchPrefs.key,
    getManualLyricCandidate: () => candidate,
    fetchSongLyricCache: async () => { throw new Error('Pending selection must bypass stale song cache'); },
    fetchLyricPayloadForCandidate: async () => ({ provider:'qq', mid:'qq-empty' }),
    saveLyricMatchPrefs: () => { savedPrefs += 1; },
    fetchQQLyricPayload: async () => {
      automaticSearches += 1;
      return automaticPayload;
    },
    fetchNeteaseLyricPayload: async () => { throw new Error('Recovered QQ lyrics should win'); },
    lyricPayloadHasUsableText: (payload) => Boolean(payload && (payload.qrc || payload.lyric)),
    lyricCacheCandidateFromPayload: () => ({ provider:'qq', mid:'qq-auto-recovered' }),
    Promise,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function fetchOnlineLyricPayload(song, options)'),
    'this.resolveLyric = fetchOnlineLyricPayload;',
  ].join('\n'), context);
  const resolved = await context.resolveLyric(song, { store:false });
  assert.equal(resolved.mid, 'qq-auto-recovered',
    'A confirmed empty saved candidate should release the manual pin and resume automatic matching');
  assert.equal(automaticSearches, 1);
  assert.equal(context.lyricMatchPrefs.key.candidate, null);
  assert.equal(context.lyricMatchPrefs.key.cachePending, false);
  assert.equal(context.lyricMatchPrefs.key.delayMs, 120,
    'Releasing an empty pending candidate must preserve the per-song delay');
  assert.equal(savedPrefs, 1);
}

async function verifyAutomaticQqReturnsBeforeCachePersistence() {
  const song = { id:'spotify-auto', name:'Automatic Song', artist:'Singer' };
  const payload = { provider:'qq', mid:'qq-auto', qrc:'[0,1000]Oh(0,1000)' };
  let finishCacheWrite;
  let settled = false;
  const context = {
    lyricCacheRetryKeys: {},
    songCustomLyricKey: () => 'auto-key',
    getLyricMatchEntry: () => null,
    getManualLyricCandidate: () => null,
    fetchSongLyricCache: async () => null,
    fetchQQLyricPayload: async () => payload,
    fetchNeteaseLyricPayload: async () => { throw new Error('QQ payload should win before NetEase'); },
    saveSongLyricCache: () => new Promise((resolve) => { finishCacheWrite = resolve; }),
    lyricCacheCandidateFromPayload: () => ({ provider:'qq', mid:'qq-auto' }),
    lyricPayloadHasUsableText: (value) => Boolean(value && value.qrc),
    Promise,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('async function saveSongLyricCacheWithForegroundRetry(song, payload, selection, canContinue)'),
    functionSource('async function fetchOnlineLyricPayload(song, options)'),
    'this.resolveLyric = fetchOnlineLyricPayload;',
  ].join('\n'), context);
  const resolving = context.resolveLyric(song).then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, true,
    'A parsed automatic QQ QRC payload should reach playback without waiting for local cache persistence');
  const resolved = await resolving;
  assert.equal(resolved, payload);
  finishCacheWrite({ ...payload, cache:{ stored:true } });
}

function verifyPerSongDelayPersistsAndOnlyOffsetsTheLyricClock() {
  let saved = 0;
  let globalSaved = 0;
  let stageResamples = 0;
  let desktopPushes = 0;
  const song = { id: 'current', name: 'Song', artist: 'Singer' };
  const context = {
    lyricMatchPrefs: { key: { candidate: { provider: 'qq', mid: 'qq-1' }, delayMs: 0, cachePending: true } },
    globalLyricDelayMs: 300,
    currentLyricSong: () => song,
    songCustomLyricKey: () => 'key',
    saveLyricMatchPrefs() { saved += 1; },
    saveGlobalLyricDelayMs() { globalSaved += 1; },
    getPlaybackCurrentSeconds: () => 12,
    updateLyricMatchControls() {},
    tickLyricsParticles() { stageResamples += 1; },
    runStageLyricFrameStep(label, callback) { callback(); return true; },
    pushDesktopLyricsState(force) { if (force) desktopPushes += 1; },
    showToast() {},
    Math,
    Number,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function getLyricMatchEntry(song)'),
    functionSource('function normalizeLyricDelayMs(value)'),
    functionSource('function getGlobalLyricDelayMs()'),
    functionSource('function getCurrentLyricDelayAdjustmentMs(song)'),
    functionSource('function getLyricDelayMs(song)'),
    functionSource('function resampleLyricsFromClock()'),
    functionSource('function setGlobalLyricDelayMs(value, silent)'),
    functionSource('function setCurrentLyricDelayMs(value, silent)'),
    functionSource('function getLyricPlaybackSeconds()'),
    'this.setDelay = setCurrentLyricDelayMs;',
    'this.setGlobalDelay = setGlobalLyricDelayMs;',
    'this.readLyricClock = getLyricPlaybackSeconds;',
  ].join('\n'), context);

  context.setDelay(750, true);
  assert.equal(saved, 1, 'The current song delay should be persisted');
  assert.equal(context.lyricMatchPrefs.key.delayMs, 750);
  assert.equal(context.lyricMatchPrefs.key.candidate.mid, 'qq-1', 'Changing delay must preserve the selected lyric');
  assert.equal(context.lyricMatchPrefs.key.cachePending, true,
    'Changing delay must not erase the persisted cache-retry state');
  assert.equal(context.readLyricClock(), 10.95, 'The lyric clock should apply global delay plus the current-song correction');
  assert.equal(stageResamples, 1, 'Changing lyric delay should immediately resample the 3D lyric stage');
  assert.equal(desktopPushes, 1, 'Changing lyric delay should immediately push a desktop lyric snapshot');

  context.setDelay(-500, true);
  assert.equal(context.readLyricClock(), 12.2, 'A negative per-song correction should combine with the positive global delay');
  context.setGlobalDelay(1200, true);
  assert.equal(globalSaved, 1, 'The global delay should be persisted independently');
  assert.equal(context.globalLyricDelayMs, 1200);
  assert.equal(context.readLyricClock(), 11.3);
  context.setDelay(90000, true);
  assert.equal(context.lyricMatchPrefs.key.delayMs, 30000, 'Manual delay input should be clamped to thirty seconds');
  context.setDelay(117, true);
  assert.equal(context.lyricMatchPrefs.key.delayMs, 120, 'Delay values should snap to ten millisecond increments');
}

function verifySelectionPageContract() {
  assert.match(html, /id="lyric-match-open-btn"[^>]*onclick="openLyricMatchModal\(\)"/,
    'Lyric settings should expose the selection page');
  assert.match(html, /id="lyric-match-modal"[\s\S]*?id="lyric-match-search-input"[\s\S]*?id="lyric-match-results"/,
    'The selection page should contain search and candidate results');
  assert.match(html, /id="lyric-delay-slider"[^>]*min="-5000"[^>]*max="5000"[^>]*step="10"/,
    'The selection page should expose a precise -5s to +5s delay control');
  assert.match(html, /id="lyric-delay-input"[^>]*type="number"[^>]*min="-30000"[^>]*max="30000"[^>]*step="10"/,
    'The current-song correction should accept direct millisecond input');
  assert.match(html, /id="lyric-global-delay-slider"[^>]*step="10"[\s\S]*?id="lyric-global-delay-input"[^>]*type="number"/,
    'The selection page should expose an independent global delay control');
  assert.match(html, /id="lyric-effective-delay-value"/, 'The effective combined delay should be visible');
  assert.match(html, /id="lyric-cache-status"/, 'The selection page should display lyric cache status');
  assert.match(html, /onclick="refreshCurrentLyricCache\(\)"/, 'Users should be able to refetch the current lyric');
  assert.match(html, /onclick="clearAllLyricCache\(\)"/, 'Users should be able to clear the lyric cache');
  assert.match(html, /onclick="clearManualLyricCandidate\(\)"[^>]*>\s*恢复自动匹配\s*</,
    'Users should be able to return to automatic matching');
  const openSource = functionSource('function openLyricMatchModal()');
  assert.match(openSource, /input\.value = lyricSearchQuery\(song\)/,
    'Opening the selection page should prefill the current title and artist');
  assert.match(openSource, /runLyricMatchSearch\(\)/,
    'The prefilled current song should be searched immediately');
}

function verifyTrackSwitchClearsBothLyricSurfacesImmediately() {
  const calls = [];
  const context = {
    lyricTrackLoading: false,
    lyricsLines: [{ text:'Previous lyric' }],
    lyricsBlankSegments: [{ start:1, end:9 }],
    lyricsHasNativeKaraoke: true,
    lyricsTimingSource: 'qrc-word',
    originalLyricsState: { lines:[{ text:'Previous lyric' }], blankSegments:[], hasNativeKaraoke:true, timingSource:'qrc-word' },
    stageLyrics: { currentText:'Previous lyric' },
    resetStageLyricRuntimeFault() { calls.push('stage:fault-reset'); },
    clearStageLyrics() { calls.push('stage:clear'); },
    pushDesktopLyricsState(force) { calls.push(`desktop:${force}`); },
  };
  context.stageLyrics.starRiver = { visible:true, material:{ uniforms:{ uOpacity:{ value:.8 } } } };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function beginLyricTrackSwitch()')}; this.beginSwitch = beginLyricTrackSwitch;`, context);
  context.beginSwitch();
  assert.equal(context.lyricTrackLoading, true);
  assert.equal(context.lyricsLines.length, 0, 'The old stage lyric data must disappear before the new request starts');
  assert.equal(context.originalLyricsState.lines.length, 0);
  assert.equal(context.stageLyrics.starRiver.visible, false, 'The old lyric star river must disappear in the same switch frame');
  assert.equal(context.stageLyrics.starRiver.material.uniforms.uOpacity.value, 0);
  assert.deepEqual(calls, ['stage:fault-reset', 'stage:clear', 'desktop:true'],
    'Track changes should re-arm the lyric sublayer before clearing both lyric surfaces');
  assert.match(functionSource('async function playQueueAt(idx, opts)'), /trackSwitchToken\+\+;[\s\S]{0,220}beginLyricTrackSwitch\(\)/,
    'Queue playback should clear lyrics immediately after changing the track token');
  assert.match(functionSource('async function pollSpotifyState()'), /trackSwitchToken = spotifyCurrentTrackToken;[\s\S]{0,220}beginLyricTrackSwitch\(\)/,
    'Spotify polling should clear lyrics before starting the next lyric fetch');
  assert.match(functionSource('async function selectLyricCandidateAt(index)'), /if \(!result \|\| result\.stale\) return;/,
    'A stale manual selection must not overwrite the newer selection status');
}

function verifySearchQueryUsesCurrentPrimaryArtist() {
  const context = { String, Array };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function lyricPrimaryArtistName(song)'),
    functionSource('function lyricSearchQuery(song)'),
    'this.query = lyricSearchQuery;',
  ].join('\n'), context);
  assert.equal(context.query({ name:'Current Song', artist:'Main Artist / Guest Artist' }), 'Current Song Main Artist');
  assert.equal(context.query({ name:'Current Song', artists:[{ name:'Main Artist' }, { name:'Guest Artist' }] }), 'Current Song Main Artist');
}

function verifyFeaturedArtistsOnlyAddRankingWeight() {
  const context = { String, Array, Math, Number };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function normalizeLyricIdentityText(text)'),
    functionSource('function lyricPrimaryArtistName(song)'),
    functionSource('function lyricArtistNamesForMatch(song)'),
    functionSource('function lyricVersionTags(title)'),
    functionSource('function lyricBaseTitleForMatch(title)'),
    functionSource('function lyricPrimaryArtistForMatch(song)'),
    functionSource('function lyricCandidateVersionMatches(song, candidate)'),
    functionSource('function lyricCandidateMatchScore(song, candidate)'),
    'this.score = lyricCandidateMatchScore;',
  ].join('\n'), context);
  const source = { name:'Duet', artists:[{ name:'Main Artist' }, { name:'Guest Artist' }] };
  const matchingGuest = { name:'Duet', artists:[{ name:'Main Artist' }, { name:'Guest Artist' }] };
  const differentGuest = { name:'Duet', artists:[{ name:'Main Artist' }, { name:'Other Guest' }] };
  assert.ok(context.score(source, matchingGuest) > context.score(source, differentGuest),
    'A matching featured artist should add ranking weight without replacing the primary-artist requirement');
  assert.equal(context.lyricCandidateVersionMatches(
    { name:"Song (Taylor's Version)" },
    { name:'Song' },
  ), false, 'A re-recorded version should not be treated as the studio original');
  assert.equal(context.lyricCandidateVersionMatches(
    { name:'Song (Sped Up)' },
    { name:'Song (Slowed)' },
  ), false, 'Common speed variants should remain distinct versions');
  const nearDurationScore = context.score(
    { name:'Song', artist:'Singer', duration:200 },
    { name:'Song', artist:'Singer', duration:202 },
  );
  const farDurationScore = context.score(
    { name:'Song', artist:'Singer', duration:200 },
    { name:'Song', artist:'Singer', duration:260 },
  );
  assert.ok(nearDurationScore - farDurationScore >= 200,
    'Duration proximity should materially distinguish otherwise identical original candidates');
}

function verifySeekEntryPointsResampleLyricsImmediately() {
  const seekSource = functionSource('function seekFromProgressPointer(e, emitParticles)');
  const bindSource = functionSource('function bindPlaybackProgressEvents(audioEl)');
  assert.match(seekSource, /resampleLyricsFromClock\(\)/,
    'Dragging the local progress bar should resample lyrics in the same call');
  assert.match(bindSource, /addEventListener\(['"]seeked['"],\s*resampleLyricsFromClock\)/,
    'Native/programmatic seeks should resample lyrics from the seeked event');

  let stageResamples = 0;
  let desktopPushes = 0;
  const context = {
    tickLyricsParticles() { stageResamples += 1; },
    runStageLyricFrameStep(label, callback) { callback(); return true; },
    pushDesktopLyricsState(force) { if (force) desktopPushes += 1; },
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function resampleLyricsFromClock()')}; this.resample = resampleLyricsFromClock;`, context);
  context.resample();
  assert.equal(stageResamples, 1);
  assert.equal(desktopPushes, 1);
}

verifyBothProvidersAreSearchedTogether().then(function(){
  return verifyAutomaticMatchingPrefersOriginalQrc();
}).then(function(){
  return verifyForcedCandidateRefreshBypassesCache();
}).then(function(){
  return verifyPlaybackUsesOneSongCacheBeforeSearching();
}).then(function(){
  return verifyAppleTranslationPriorityUsesWholeProviderPayloads();
}).then(function(){
  return verifyAppleCandidateCapabilitiesAndAuthFailures();
}).then(function(){
  return verifyLatePlaybackRequestCannotApplyAfterManualSelection();
}).then(function(){
  return verifySourcePolicyRefreshPreservesVisibleLyrics();
}).then(function(){
  return verifySpotifyAutomaticRequestIncludesDuration();
}).then(function(){
  return verifyNeteaseFallbackAvoidsCovers();
}).then(function(){
  return verifyRefetchReleasesManualPinAndKeepsDelay();
}).then(function(){
  return verifyManualSelectionPersistsAndOverridesAutomaticMatching();
}).then(function(){
  return verifyBoundedBackgroundCacheRetriesReuseParsedPayload();
}).then(function(){
  return verifyPendingManualCacheRefetchesExactCandidateAfterRestart();
}).then(function(){
  return verifyPendingManualCacheRefetchesExactCandidateAfterRestart('apple');
}).then(function(){
  return verifyEmptyPendingManualCandidateFallsBackToAutomaticSearch();
}).then(function(){
  return verifyAutomaticQqReturnsBeforeCachePersistence();
}).then(function(){
  return verifyLatestSelectionWinsAndOldTrackSearchIsDiscarded();
}).then(function(){
  verifyPerSongDelayPersistsAndOnlyOffsetsTheLyricClock();
  verifySelectionPageContract();
  verifyTrackSwitchClearsBothLyricSurfacesImmediately();
  verifySearchQueryUsesCurrentPrimaryArtist();
  verifyFeaturedArtistsOnlyAddRankingWeight();
  verifySeekEntryPointsResampleLyricsImmediately();
  console.log('Lyric selection and delay: PASS');
}).catch(function(error){
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
