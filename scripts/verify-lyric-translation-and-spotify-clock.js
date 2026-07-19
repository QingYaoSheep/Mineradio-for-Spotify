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

function verifyTranslationReachesStageRenderer() {
  const rendered = [];
  const context = {
    fx: { particleLyrics: true, lyricTranslation: true, spotifyMode: true },
    stageLyrics: { current: null, currentIdx: -1, currentText: '', outgoing: [] },
    lyricsLines: [{ t: 0, text: 'Original lyric', transText: '歌词翻译', duration: 4, charCount: 14 }],
    lyricsBlankSegments: [],
    playing: true,
    audio: null,
    createLyricsParticles() {},
    clearStageLyrics() {},
    getPlaybackCurrentSeconds: () => 1,
    getLyricPlaybackSeconds: () => 1,
    getActiveLyricBlankSegment: () => null,
    currentLyricFallbackText: () => '',
    showStageLine(line) {
      rendered.push(line);
      context.stageLyrics.current = { userData: { lyric: {} } };
    },
    getLyricLineProgress: () => 0.25,
    updateLyricMeshProgress() {},
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function tickLyricsParticles()')}; this.tick = tickLyricsParticles;`, context);
  context.tick();
  assert.equal(rendered.length, 1, 'A timed lyric line should be sent to the stage renderer');
  assert.deepEqual(JSON.parse(JSON.stringify(rendered[0])), {
    t: 0,
    text: 'Original lyric',
    transText: '歌词翻译',
    duration: 4,
    charCount: 14,
  }, 'The stage renderer should receive the translation together with the original lyric');
}

function verifyTranslationPlaceholdersAreHidden() {
  const context = { String };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function normalizeLyricTranslationText(text)')}; this.normalizeTranslation = normalizeLyricTranslationText;`, context);
  assert.equal(context.normalizeTranslation('//'), '', 'A double-slash placeholder must not be rendered as a translation');
  assert.equal(context.normalizeTranslation(' ／／ '), '', 'The full-width placeholder must not reserve translation space');
  assert.equal(context.normalizeTranslation('   '), '', 'Whitespace-only translations must be empty');
  assert.equal(context.normalizeTranslation('真实翻译'), '真实翻译');
  assert.match(functionSource('function showStageLine(obj, redrawOnly)'), /normalizeLyricTranslationText\(obj\.transText\)/,
    'The stage renderer should guard against placeholder translations even if a provider payload bypasses alignment cleanup');
}

function verifyTranslationTogglePersistsAndRefreshes() {
  let saved = 0;
  let refreshed = 0;
  const toggle = { classList: { toggle() {} } };
  const context = {
    fx: { lyricTranslation: true },
    isDevelopmentLockedFx: () => false,
    document: { getElementById: () => toggle },
    syncFxUniforms() {},
    saveLyricLayout() { saved += 1; },
    refreshCurrentLyricStyle() { refreshed += 1; },
    showToast() {},
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function toggleFx(key)')}; this.toggle = toggleFx;`, context);
  context.toggle('lyricTranslation');
  assert.equal(context.fx.lyricTranslation, false, 'The translation toggle should disable translated lyrics');
  assert.equal(saved, 1, 'The translation preference should be persisted');
  assert.equal(refreshed, 1, 'Changing the translation preference should redraw the current lyric immediately');
}

function verifyTranslationPreferenceDefaultsOn() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionSource('function lyricTranslationPreference(raw)')}; this.readPreference = lyricTranslationPreference;`, context);
  assert.equal(context.readPreference({}), true, 'Translation should be enabled for existing users with no saved preference');
  assert.equal(context.readPreference({ lyricTranslation: true }), true);
  assert.equal(context.readPreference({ lyricTranslation: false }), false, 'An explicit disabled preference should be restored');
}

function verifyKaraokeGlyphOpacityAndTranslationShadowContract() {
  const context = {
    Math, Number, Array, Object,
    THREE: { ShaderMaterial: function(config) { return config; } },
    lyricThreeColor: () => ({}),
    lyricsHasNativeKaraoke: true,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function lyricPendingGlyphOpacity()'),
    functionSource('function lyricReadabilityShadowPasses(fontSize, scale)'),
    functionSource('function makeLyricShaderMaterial(mask, pal)'),
    'this.makeMaterial = makeLyricShaderMaterial;',
    'this.shadowPasses = lyricReadabilityShadowPasses;',
  ].join('\n'), context);

  const material = context.makeMaterial({ texture: {}, textMin: 0.1, textMax: 0.9 }, {});
  assert.match(material.fragmentShader, /float originalGlyphOpacity = mix\(0\.750, 1\.0, clamp\(filled, 0\.0, 1\.0\)\);/,
    'The actual lyric material should render pending original glyphs at 75% and highlighted glyphs at 100%');
  assert.match(material.fragmentShader, /float glyphOpacity = mix\(1\.0, originalGlyphOpacity, original\);/,
    'The actual lyric material should keep translation glyphs at full opacity outside karaoke progression');
  assert.match(material.fragmentShader, /vec3 color = mix\(uHiColor, originalColor, original\);/,
    'Translation glyphs should use the same color as completed karaoke text');
  assert.match(material.fragmentShader, /mask \* uOpacity \* glyphOpacity/,
    'Glyph opacity should remain relative to the existing fade/detail opacity');

  const originalPasses = JSON.parse(JSON.stringify(context.shadowPasses(128, 1)));
  const translationPasses = JSON.parse(JSON.stringify(context.shadowPasses(128, 0.42)));
  assert.equal(originalPasses.length, 4, 'The original lyric should retain four readability shadow passes');
  assert.equal(translationPasses.length, originalPasses.length,
    'Translation should receive the same multi-layer shadow structure');
  originalPasses.forEach((pass, index) => {
    const translated = translationPasses[index];
    assert.equal(translated.alpha, pass.alpha, 'Translation shadow opacity should match the corresponding original pass');
    assert.equal(translated.color, pass.color, 'Translation shadow color should match the corresponding original pass');
    assert.ok(Math.abs(translated.blur - pass.blur * 0.42) < 1e-9,
      'Translation blur radius should scale with its font size');
    assert.ok(Math.abs(translated.lineWidth - pass.lineWidth * 0.42) < 1e-9,
      'Translation shadow width should scale with its font size');
  });

  assert.match(
    html,
    /float filled = \(1\.0 - smoothstep\(uProgress, uProgress \+ uFeather, p\)\) \* original;/,
    'Karaoke fill must remain gated to the original-lyric mask channel',
  );
  assert.match(
    html,
    /float edge = \(1\.0 - smoothstep\(0\.0, uFeather \* 2\.8, abs\(p - uProgress\)\)\) \* original;/,
    'Karaoke edge glow must remain gated to the original-lyric mask channel',
  );
  assert.match(
    html,
    /gl_FragColor = vec4\(color, mask \* uOpacity \* glyphOpacity\);/,
    'The shader should apply the glyph multiplier after the existing group opacity',
  );
  const readabilitySource = functionSource('function makeLyricReadabilityTexture(mask)');
  assert.match(
    readabilitySource,
    /lyricReadabilityShadowPasses\(fontSize,\s*1\)/,
    'Original readability should use the shared shadow pass definition',
  );
  assert.match(
    readabilitySource,
    /lyricReadabilityShadowPasses\(fontSize,\s*transFontSize\s*\/\s*fontSize\)/,
    'Translation readability should use the same passes scaled by its font ratio',
  );
}

function verifySpotifyClockIsFrameContinuousAndCorrectable() {
  let now = 1000;
  const context = {
    performance: { now: () => now },
    spotifyPlaybackClock: {
      progress: 0,
      anchoredAt: 0,
      playing: false,
      correction: 0,
      correctionStartedAt: 0,
      correctionDuration: 300,
      ready: false,
    },
    Math,
    Number,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function readSpotifyPlaybackClock(nowMs)'),
    functionSource('function syncSpotifyPlaybackClock(progressSeconds, isPlaying, opts)'),
    'this.readClock = readSpotifyPlaybackClock;',
    'this.syncClock = syncSpotifyPlaybackClock;',
  ].join('\n'), context);

  context.syncClock(10, true, { snap: true });
  now = 1016;
  assert.ok(Math.abs(context.readClock() - 10.016) < 0.001, 'Spotify playback should advance continuously between animation frames');

  now = 3500;
  context.syncClock(12.3, true);
  assert.ok(Math.abs(context.readClock() - 12.5) < 0.001, 'A small poll correction should not jump on arrival');
  now = 3650;
  assert.ok(Math.abs(context.readClock() - 12.55) < 0.01, 'A small poll correction should blend over 300ms');
  now = 3800;
  assert.ok(Math.abs(context.readClock() - 12.6) < 0.001, 'The corrected clock should converge to the Spotify timeline');

  now = 4000;
  context.syncClock(12.8, false, { snap: true });
  now = 5000;
  assert.equal(context.readClock(), 12.8, 'A paused Spotify clock should remain fixed');

  context.syncClock(30, true);
  assert.equal(context.readClock(), 30, 'A large seek should align immediately instead of easing through stale lyrics');
}

function verifySpotifyModeNeverFallsBackToLocalAudioTime() {
  const context = {
    fx: { spotifyMode: true },
    audio: { paused: false, src: 'stale-local-track.mp3', currentTime: 99 },
    readSpotifyPlaybackClock: () => 12.345,
    isFinite,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function getPlaybackCurrentSeconds()')}; this.getTime = getPlaybackCurrentSeconds;`, context);
  assert.equal(context.getTime(), 12.345, 'Spotify mode should always use the continuous Spotify clock, even if the local audio element retains a stale source');
}

async function verifyQQLyricProviderRunsFirstAndFallsBack() {
  const functionMarkers = [
    'function normalizeLyricProviderPriority(value)',
    'function lyricTagTimeToSeconds(min, sec, frac)',
    'function finalizeLyricLineDurations(lines)',
    'function parseLyricText(text)',
    'function decodeQrcXmlText(text)',
    'function parseQrcText(text)',
    'function isNoLyricText(text)',
    'function isLeadingLyricCreditText(text)',
    'function stripLeadingLyricCredits(lines)',
    'function resolveLyricPayload(payload)',
    'function lyricPayloadHasUsableText(payload)',
    'function lyricPrimaryArtistName(song)',
    'function lyricSearchQuery(song)',
    'function normalizeLyricIdentityText(text)',
    'function lyricVersionTags(title)',
    'function lyricBaseTitleForMatch(title)',
    'function lyricPrimaryArtistForMatch(song)',
    'function lyricArtistNamesForMatch(song)',
    'function lyricCandidateVersionMatches(song, candidate)',
    'function lyricCandidateMatchScore(song, candidate)',
    'function rankLyricSearchCandidates(song, list)',
    'function isReliableOriginalLyricCandidate(song, candidate)',
    'function qqPayloadHasNativeKaraoke(payload)',
    'function lyricPayloadHasPlainText(payload)',
    'async function mapWithConcurrency(items, limit, worker)',
    'function lyricCandidateMetadataSuffix(candidate)',
    'function lyricCandidateRequestUrl(provider, candidate, options)',
    'async function fetchQQLyricPayload(song, options)',
    'async function fetchNeteaseLyricPayload(song, options)',
    'async function fetchOnlineLyricPayload(song, options)',
  ];
  const calls = [];
  let qqPayloadMode = 'lyric';
  const context = {
    fx: { lyricProviderPriority: 'qq' },
    apiJson: async (url) => {
      calls.push(url);
      if (url.startsWith('/api/qq/search')) {
        return { songs: [{ provider: 'qq', mid: 'qq-mid-1', id: 'qq-mid-1', name: 'Test Song', artist: 'Test Artist' }] };
      }
      if (url.startsWith('/api/qq/lyric')) {
        if (qqPayloadMode === 'lyric') return { lyric: '[00:00.00]QQ lyric' };
        if (qqPayloadMode === 'qrc') return { lyric: '', qrc: '[1000,900]QQ(1000,450) lyric(1450,450)' };
        return { lyric: '', qrc: '' };
      }
      if (url.startsWith('/api/lyric')) return { lyric: '[00:00.00]NetEase lyric' };
      throw new Error(`Unexpected URL: ${url}`);
    },
    songProviderKey: (song) => song && song.provider === 'qq' ? 'qq' : 'netease',
    getManualLyricCandidate: () => null,
    isSameTitleArtist: (source, candidate) => source.name === candidate.name && source.artist === candidate.artist,
    encodeURIComponent,
    Array,
    Math,
    Number,
    Object,
    String,
    isFinite,
  };
  vm.createContext(context);
  vm.runInContext([
    ...functionMarkers.map(functionSource),
    'this.fetchOnline = fetchOnlineLyricPayload;',
  ].join('\n'), context);

  const song = { provider: 'netease', id: 123, name: 'Test Song', artist: 'Test Artist' };
  assert.equal(context.normalizeLyricProviderPriority(undefined), 'qq', 'QQ should be the default and highest lyric provider');
  const qqResult = await context.fetchOnline(song);
  assert.equal(qqResult.lyric, '[00:00.00]QQ lyric');
  assert.deepEqual(calls.map((url) => url.split('?')[0]), ['/api/qq/search', '/api/qq/lyric'],
    'QQ search and lyric must run before NetEase when QQ has usable lyrics');

  calls.length = 0;
  qqPayloadMode = 'qrc';
  const qrcResult = await context.fetchOnline(song);
  assert.match(qrcResult.qrc, /QQ\(1000,450\)/, 'QQ QRC should count as usable lyrics');
  assert.deepEqual(calls.map((url) => url.split('?')[0]), ['/api/qq/search', '/api/qq/lyric'],
    'A usable QQ QRC payload must not fall back to NetEase');

  calls.length = 0;
  qqPayloadMode = 'empty';
  const fallbackResult = await context.fetchOnline(song);
  assert.equal(fallbackResult.lyric, '[00:00.00]NetEase lyric');
  assert.deepEqual(calls.map((url) => url.split('?')[0]), ['/api/qq/search', '/api/qq/lyric', '/api/lyric'],
    'NetEase should only run after the preferred QQ source has no usable lyrics');

  calls.length = 0;
  context.fx.lyricProviderPriority = 'netease';
  const neteaseFirstResult = await context.fetchOnline(song);
  assert.equal(neteaseFirstResult.provider, 'netease');
  assert.deepEqual(calls.map((url) => url.split('?')[0]), ['/api/qq/search', '/api/qq/lyric', '/api/lyric'],
    'Automatic matching must keep QQ first even if an old saved setting says NetEase');
}

function verifyQQQrcParsesAsWordTimedLyrics() {
  const context = {
    finalizeLyricLineDurations(lines) { return lines; },
    Math,
    parseInt,
    String,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function decodeQrcXmlText(text)')}\n${functionSource('function parseQrcText(text)')}; this.parseQrc = parseQrcText;`, context);
  const lines = context.parseQrc('[1000,900]QQ(1000,450) lyric(1450,450)');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'QQ lyric');
  assert.deepEqual(JSON.parse(JSON.stringify(lines[0].karaokeTimeline)), [
    { text: 'QQ', start: 1, duration: 0.45, c0: 0, c1: 2, timed: true },
    { text: ' lyric', start: 1.45, duration: 0.45, c0: 2, c1: 8, timed: true },
  ], 'QQ QRC word timings should enter the karaoke timing model');
}

function verifyLyricProviderPriorityIsFixedToQQ() {
  let saved = 0;
  let controlsUpdated = 0;
  const fetches = [];
  const context = {
    fx: { lyricProviderPriority: 'qq' },
    saveLyricLayout() { saved += 1; },
    updateLyricProviderPriorityControls() { controlsUpdated += 1; },
    currentLyricSong: () => ({ id: 123, name: 'Test Song', artist: 'Test Artist' }),
    fetchLyric(song, token) { fetches.push({ song, token }); },
    trackSwitchToken: 7,
    showToast() {},
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function normalizeLyricProviderPriority(value)'),
    functionSource('function setLyricProviderPriority(provider)'),
    'this.setPriority = setLyricProviderPriority;',
  ].join('\n'), context);
  context.setPriority('netease');
  assert.equal(context.fx.lyricProviderPriority, 'qq', 'Automatic lyric priority must remain fixed to QQ');
  assert.equal(saved, 1, 'The fixed QQ priority should replace legacy saved preferences');
  assert.equal(controlsUpdated, 1, 'The setting bar should update immediately');
  assert.equal(fetches.length, 0, 'A disabled fallback choice should not reload lyrics');
  assert.match(html, /id="lyric-provider-priority-seg"[\s\S]*?data-lyric-provider="qq"[\s\S]*?QQ 音乐 · 最高/,
    'The lyric settings panel should expose QQ as the highest provider');
  assert.match(html, /data-lyric-provider="netease"[^>]*disabled[^>]*>网易云 · 自动备用/,
    'NetEase should be displayed as an automatic fallback rather than a selectable priority');

  let stored = '';
  const defaults = new Proxy({}, { get: () => 1 });
  const persistedFx = new Proxy({ lyricProviderPriority: 'netease', lyricTranslation: true }, {
    get(target, key) { return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : 1; },
  });
  const storageContext = {
    fx: persistedFx,
    fxDefaults: defaults,
    localStorage: {
      getItem() { return stored || null; },
      setItem(key, value) { stored = value; },
    },
    LYRIC_LAYOUT_STORE_KEY: 'test-layout',
    VISUAL_PRESET_SCHEMA: 'test-schema',
    startupVisualPreviewActive: false,
    playing: false,
    currentIdx: -1,
    playbackVisualPreset: 0,
    presetMeta: new Array(7),
    clampRange(value, min, max) {
      value = Number(value);
      return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
    },
    normalizeHexColor(value, fallback) { return String(value || fallback || '#000000'); },
    normalizeLyricFontKey(value) { return value || 'sans'; },
    normalizeCustomBackgroundImage(value) { return value || ''; },
    normalizeCustomBackgroundMedia(value) { return value || ''; },
    normalizeDesktopLyricsFps(value) { return value || 60; },
    normalizePerformanceBackgroundMode(value) { return value || 'pause'; },
    normalizePerformanceQuality(value) { return value || 'high'; },
    normalizeCoverResolution(value) { return value || 1; },
    normalizeShelfCameraMode(value) { return value || 'default'; },
    normalizeShelfPresence(value) { return value || 'default'; },
    shelfDefaultAngleForCameraMode() { return 0; },
    packagedDefaultLyricLayoutRaw() { return {}; },
    Number,
    String,
    JSON,
    Math,
  };
  vm.createContext(storageContext);
  vm.runInContext([
    functionSource('function normalizeLyricProviderPriority(value)'),
    functionSource('function lyricTranslationPreference(raw)'),
    functionSource('function saveLyricLayout()'),
    functionSource('function readSavedLyricLayout()'),
    'this.saveLayout = saveLyricLayout;',
    'this.readLayout = readSavedLyricLayout;',
  ].join('\n'), storageContext);
  storageContext.saveLayout();
  assert.equal(JSON.parse(stored).lyricProviderPriority, 'qq', 'The real layout serializer should migrate legacy provider preferences to QQ');
  assert.equal(storageContext.readLayout().lyricProviderPriority, 'qq', 'The real layout loader should always restore QQ priority');
  stored = '{}';
  assert.equal(storageContext.readLayout().lyricProviderPriority, 'qq', 'Existing layouts without the setting should default to QQ');
}

async function verifySpotifyLyricsEnterTheQQFirstResolverDirectly() {
  const directFetches = [];
  const lyricCalls = [];
  const context = {
    spotifyCurrentTrackToken: 11,
    fetch: async (url) => {
      directFetches.push(url);
      return { json: async () => ({ songs: [] }) };
    },
    fetchLyric(song, token) { lyricCalls.push({ song, token }); },
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('async function searchAndFetchSpotifyLyric(title, artist, token)')}; this.loadSpotifyLyrics = searchAndFetchSpotifyLyric;`, context);
  await context.loadSpotifyLyrics('Test Song', 'Test Artist', 11);
  assert.deepEqual(directFetches, [], 'Spotify lyric loading must not pre-call the NetEase search endpoint');
  assert.deepEqual(JSON.parse(JSON.stringify(lyricCalls)), [{
    song: { name: 'Test Song', artist: 'Test Artist', provider: 'spotify', source: 'spotify' },
    token: 11,
  }], 'Spotify metadata should enter the shared QQ-first lyric resolver directly');
}

verifyTranslationReachesStageRenderer();
verifyTranslationPlaceholdersAreHidden();
verifyTranslationTogglePersistsAndRefreshes();
verifyTranslationPreferenceDefaultsOn();
verifyKaraokeGlyphOpacityAndTranslationShadowContract();
verifySpotifyClockIsFrameContinuousAndCorrectable();
verifySpotifyModeNeverFallsBackToLocalAudioTime();
verifyQQLyricProviderRunsFirstAndFallsBack().then(function(){
  verifyQQQrcParsesAsWordTimedLyrics();
  verifyLyricProviderPriorityIsFixedToQQ();
  return verifySpotifyLyricsEnterTheQQFirstResolverDirectly();
}).then(function(){
  console.log('Lyric translation, provider priority and Spotify clock: PASS');
}).catch(function(error){
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
