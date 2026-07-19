const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

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
    'original-lrc': { qrc: '', lyric: '[00:00]Original line' },
    'original-live-qrc': { qrc: '[0,1000]Live(0,1000)', lyric: '' },
    'original-qrc': { qrc: '[0,1000]Original(0,1000)', lyric: '' },
  };
  const searchSongs = [
    { mid: 'cover-qrc', name: 'Test Song', artist: 'Cover Singer', duration: 240 },
    { mid: 'original-lrc', name: 'Test Song', artist: 'Original Singer', duration: 238 },
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
    songProviderKey: () => 'netease',
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
  payloads['original-qrc'] = { qrc: '', lyric: '[00:00]Original fallback' };
  const originalLine = await context.fetchQQ({ name: 'Test Song', artist: 'Original Singer', duration: 240, provider: 'spotify' });
  assert.match(originalLine.lyric, /Original/, 'Original line lyrics should beat a cover QRC');

  calls.length = 0;
  const live = await context.fetchQQ({ name: 'Test Song (Live)', artist: 'Original Singer', duration: 240, provider: 'spotify' });
  assert.equal(live.qrc, payloads['original-live-qrc'].qrc, 'An explicitly tagged Live track should prefer the matching Live version');
  assert.ok(calls.filter((url) => url.startsWith('/api/qq/lyric')).length <= 5, 'Automatic matching should inspect at most five QQ candidates');

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
  let applied = 0;
  const context = {
    lyricSelectionToken: 0,
    trackSwitchToken: 9,
    lyricMatchPrefs: { key:{ candidate:{ provider:'qq', mid:'manual' }, delayMs:730 } },
    currentLyricSong: () => song,
    songCustomLyricKey: () => 'key',
    saveLyricMatchPrefs() {},
    updateLyricMatchControls() {},
    setLyricMatchStatus() {},
    showToast() {},
    refreshLyricCacheStatus() {},
    fetchOnlineLyricPayload: async () => {
      observedCandidate = context.lyricMatchPrefs.key.candidate;
      return { lyric:'[00:00]Automatic lyric' };
    },
    lyricPayloadHasUsableText: () => true,
    applyLyricPayload() { applied += 1; },
    Number,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('async function refreshCurrentLyricCache()')}; this.refreshCurrent = refreshCurrentLyricCache;`, context);
  assert.equal(await context.refreshCurrent(), true);
  assert.equal(observedCandidate, null, 'Refetch should rerun automatic matching instead of refreshing the pinned candidate');
  assert.equal(context.lyricMatchPrefs.key.delayMs, 730, 'Refetch should preserve the current-song correction');
  assert.equal(applied, 1);
}

async function verifyManualSelectionPersistsAndOverridesAutomaticMatching() {
  const saved = [];
  const applied = [];
  let candidateHasLyrics = true;
  let candidateRequestFails = false;
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
    lyricPayloadHasUsableText: (payload) => Boolean(payload && payload.lyric),
    applyLyricPayload(payload, token) { applied.push({ payload, token }); return true; },
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
    functionSource('async function selectLyricCandidate(candidate)'),
    'this.selectCandidate = selectLyricCandidate;',
  ].join('\n'), context);
  await context.selectCandidate(candidate);
  assert.equal(saved.length, 1, 'Choosing a lyric should persist the selection for the current song');
  assert.equal(saved[0]['current-song-key'].candidate.id, 202);
  assert.equal(saved[0]['current-song-key'].candidate.provider, 'netease');
  assert.equal(applied.length, 1, 'Choosing a lyric should apply the selected payload immediately');
  assert.equal(applied[0].payload.lyric, '[00:00.00]Chosen lyric');
  assert.equal(applied[0].token, 17);

  saved.length = 0;
  candidateHasLyrics = false;
  const emptyResult = await context.selectCandidate({ provider: 'qq', mid: 'empty-qq', name: 'Empty' });
  assert.equal(emptyResult, false, 'A search result with no lyric payload should be rejected');
  assert.equal(saved.length, 0, 'An empty lyric candidate must not replace the saved working selection');
  assert.equal(context.lyricMatchPrefs['current-song-key'].candidate.id, 202);

  candidateHasLyrics = true;
  candidateRequestFails = true;
  const failedRequest = await context.selectCandidate({ provider: 'qq', mid: 'failed-qq', name: 'Failed' });
  assert.equal(failedRequest, false, 'A failed lyric request should not report a successful selection');
  assert.equal(saved.length, 0);
  assert.equal(context.lyricMatchPrefs['current-song-key'].candidate.id, 202);

  const apiCalls = [];
  const resolverContext = {
    fx: { lyricProviderPriority: 'qq' },
    getManualLyricCandidate: () => candidate,
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
  vm.runInContext(`${functionSource('async function fetchOnlineLyricPayload(song, options)')}; this.resolveLyric = fetchOnlineLyricPayload;`, resolverContext);
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
      return new Promise((resolve) => pendingPayloads.set(candidate.id, resolve));
    },
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
    functionSource('async function selectLyricCandidate(candidate)'),
    functionSource('async function clearManualLyricCandidate()'),
    'this.selectCandidate = selectLyricCandidate;',
    'this.clearCandidate = clearManualLyricCandidate;',
  ].join('\n'), context);
  const first = context.selectCandidate({ provider: 'netease', id: 1, name: 'First' });
  const second = context.selectCandidate({ provider: 'netease', id: 2, name: 'Second' });
  pendingPayloads.get(2)({ id: 2, lyric: '[00:00.00]Second' });
  await second;
  pendingPayloads.get(1)({ id: 1, lyric: '[00:00.00]First' });
  assert.equal(await first, false, 'A slower earlier selection should be discarded');
  assert.deepEqual(savedCandidates, [2]);
  assert.deepEqual(appliedCandidates, [2]);

  const third = context.selectCandidate({ provider: 'netease', id: 3, name: 'Third' });
  await context.clearCandidate();
  pendingPayloads.get(3)({ id: 3, lyric: '[00:00.00]Third' });
  assert.equal(await third, false, 'Restoring automatic matching should invalidate an in-flight manual selection');
  assert.deepEqual(savedCandidates, [2, null]);
  assert.deepEqual(appliedCandidates, [2, 'auto']);

  delayAutomaticPayload = true;
  const restoringAutomatic = context.clearCandidate();
  const fourth = context.selectCandidate({ provider: 'netease', id: 4, name: 'Fourth' });
  pendingPayloads.get(4)({ id: 4, lyric: '[00:00.00]Fourth' });
  assert.equal(await fourth, true);
  pendingAutoResolve({ id: 'late-auto', lyric: '[00:00.00]Late automatic' });
  assert.equal(await restoringAutomatic, false, 'A late automatic response must not overwrite a newer manual selection');
  assert.equal(context.lyricMatchPrefs['song-a'].candidate.id, 4);
  assert.deepEqual(appliedCandidates, [2, 'auto', 4]);

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

function verifyPerSongDelayPersistsAndOnlyOffsetsTheLyricClock() {
  let saved = 0;
  let globalSaved = 0;
  let stageResamples = 0;
  let desktopPushes = 0;
  const song = { id: 'current', name: 'Song', artist: 'Singer' };
  const context = {
    lyricMatchPrefs: { key: { candidate: { provider: 'qq', mid: 'qq-1' }, delayMs: 0 } },
    globalLyricDelayMs: 300,
    currentLyricSong: () => song,
    songCustomLyricKey: () => 'key',
    saveLyricMatchPrefs() { saved += 1; },
    saveGlobalLyricDelayMs() { globalSaved += 1; },
    getPlaybackCurrentSeconds: () => 12,
    updateLyricMatchControls() {},
    tickLyricsParticles() { stageResamples += 1; },
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
  return verifyNeteaseFallbackAvoidsCovers();
}).then(function(){
  return verifyRefetchReleasesManualPinAndKeepsDelay();
}).then(function(){
  return verifyManualSelectionPersistsAndOverridesAutomaticMatching();
}).then(function(){
  return verifyLatestSelectionWinsAndOldTrackSearchIsDiscarded();
}).then(function(){
  verifyPerSongDelayPersistsAndOnlyOffsetsTheLyricClock();
  verifySelectionPageContract();
  verifySearchQueryUsesCurrentPrimaryArtist();
  verifyFeaturedArtistsOnlyAddRankingWeight();
  verifySeekEntryPointsResampleLyricsImmediately();
  console.log('Lyric selection and delay: PASS');
}).catch(function(error){
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
