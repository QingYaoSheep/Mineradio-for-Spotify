const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readRendererSource } = require('./renderer-source');
const lyricCreditFilter = require('../public/js/lyric-credit-filter');

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

function verifyLongToneOnlyGlowSettings() {
  assert.match(html, /<label>辉光强度<\/label><input id="fx-lyricglow"/,
    'The retained strength slider should be named for the long-tone glow effect');
  assert.doesNotMatch(html, /id="t-lyricGlow(?:Beat|Particles)?"/,
    'Whole-line lyric bloom, beat bloom and lyric particle toggles must be removed');
  assert.match(html, /id="t-lyricLongWordGlow"[\s\S]*歌词辉光效果/,
    'The reliable QQ QRC long-tone glow toggle must remain available');
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
    updateLyricWordLift() {},
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
    functionSource('function makeLyricShaderMaterial(mask, pal, lift)'),
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
  assert.equal(originalPasses.length, 2, 'The original lyric should retain only dark readability shadow passes');
  assert.equal(translationPasses.length, originalPasses.length,
    'Translation should receive the same multi-layer shadow structure');
  assert.ok(originalPasses.every((pass) => pass.color === 'rgba(0,0,0,1)'),
    'Ordinary lyric readability must not reintroduce white halo passes');
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

function verifyLyricTextureResolutionAndGlowScale() {
  const resolutionContext = {
    Math, Number,
    fx: { lyricTextureClarity: 2 },
    renderer: { capabilities: { maxTextureSize: 2048 } },
  };
  vm.createContext(resolutionContext);
  vm.runInContext([
    functionSource('function lyricGpuMaxTextureSize()'),
    functionSource('function normalizeLyricTextureClarity(value)'),
    functionSource('function lyricTextureMemoryBudgetBytes(tier)'),
    functionSource('function lyricTextureResolutionScale()'),
    functionSource('function lyricTextureCanvasScale(width, height)'),
    functionSource('function lyricTextureCanvasMetrics(width, height)'),
    'this.readScale = lyricTextureResolutionScale;',
    'this.readCanvasScale = lyricTextureCanvasScale;',
    'this.readCanvasMetrics = lyricTextureCanvasMetrics;',
  ].join('\n'), resolutionContext);
  assert.equal(resolutionContext.readScale(), 1,
    'The lyric texture resolution boost should clamp to the active GPU texture limit');
  resolutionContext.renderer.capabilities.maxTextureSize = 4096;
  assert.equal(resolutionContext.readScale(), 2,
    'A capable GPU should receive the requested higher-resolution lyric texture');
  resolutionContext.renderer.capabilities.maxTextureSize = 2048;
  const cappedGlowScale = resolutionContext.readCanvasScale(2230, 760);
  assert.ok(cappedGlowScale < 1 && Math.ceil(2230 * cappedGlowScale) <= 2048,
    'An expanded glow canvas should be proportionally capped before texture upload');
  assert.deepEqual(JSON.parse(JSON.stringify(resolutionContext.readCanvasMetrics(4096, 1024))), {
    scale: 0.5,
    width: 2048,
    height: 512,
  }, 'The texture-cap branch should return the exact scaled canvas metadata used by the glow texture');

  const glowSource = functionSource('function makeLyricGlowTexture(text, transText, fontSize, textWidth, lines, lineHeight, fitScaleX, transLines, transFontSize, transLineHeight)');
  assert.match(glowSource, /var resolutionScale = lyricTextureResolutionScale\(\)/,
    'The fallback glow texture should use the same effective resolution scale as the lyric mask');
  assert.match(glowSource, /34 \* glowPixelScale/,
    'The fallback glow blur should preserve its visual radius at higher texture resolutions');
  assert.match(glowSource, /7 \* glowPixelScale/,
    'The fallback glow spread should preserve its visual radius at higher texture resolutions');
  assert.match(glowSource, /canvasMetrics = lyricTextureCanvasMetrics\(W, H\)/,
    'The actual fallback glow canvas should apply the GPU texture cap');
}

function verifyNativeQrcWordsFloatFromTheirSourceStarts() {
  const context = { Math, Number, Array, isFinite, LYRIC_WORD_LIFT_DURATION_SECONDS:2 };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function getLyricWordLiftState(line, now, target)')}; this.getLift = getLyricWordLiftState;`, context);
  const line = {
    source:'qrc-word',
    nativeQqKaraoke:true,
    karaokeTimeline:[
      { start:1, duration:.4, c0:0, c1:2, timed:true },
      { start:1.5, duration:.4, c0:2, c1:5, timed:true },
    ],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLift(line, .99))), [0, 0]);
  const rising = context.getLift(line, 1.09);
  assert.ok(Math.abs(rising[0] - 0.129016125) < 1e-6, 'A word should use a two-second cubic ease-out from its QRC source start');
  assert.equal(rising[1], 0, 'Later words must remain fixed until their own source start');
  const overlappingRise = context.getLift(line, 1.75);
  assert.ok(Math.abs(overlappingRise[0] - 0.755859375) < 1e-6, 'Earlier words should continue their own two-second rise');
  assert.ok(Math.abs(overlappingRise[1] - 0.330078125) < 1e-6, 'Rapid words should rise independently from their own source starts');
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLift(line, 3.5))), [1, 1],
    'Sung words should remain elevated until the line exits');
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLift({ source:'lrc-line', karaokeTimeline:line.karaokeTimeline }, 2))), [],
    'Line-timed lyrics must never receive synthetic word movement');
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLift({ source:'qrc-word', karaokeTimeline:line.karaokeTimeline }, 2))), [],
    'Custom or otherwise unverified word-timed text must not receive native QQ QRC movement');

  const materialSource = functionSource('function makeLyricShaderMaterial(mask, pal, lift)');
  assert.match(materialSource, /uWordLiftMap/, 'The actual lyric material should receive a clock-driven per-word lift map');
  assert.match(materialSource, /uOriginalMinY[\s\S]*uOriginalMaxY/, 'The main shader should restrict movement to original glyph rows');
  assert.match(materialSource, /uWordLiftUv/, 'The shader should move glyph pixels by a font-relative amount');
  const meshBuilderSource = functionSource('function buildLyricMesh(text, romanText, transText, lyricLine)');
  assert.match(meshBuilderSource, /translationTextMat = makeLyricTextureLayerMaterial\(translationTextTex/,
    'Translated glyphs must render through a fixed material instead of the word-lift shader');
  assert.match(meshBuilderSource, /makeLyricTextTexture\(mask,\s*'original'\)[\s\S]*makeLyricTextTexture\(mask,\s*'translation'\)/,
    'Original and translated glyphs must be split so translation pixels cannot be sampled by a rising QRC word');
  assert.match(html, /var LYRIC_WORD_LIFT_DURATION_SECONDS = 2\.0;[\s\S]*var LYRIC_WORD_LIFT_HEIGHT_RATIO = 0\.06;/,
    'The agreed two-second duration and 6% height should have one named source of truth');
  assert.match(materialSource, /uWordLiftUv:[\s\S]*mask\.fontSize \/ mask\.height\) \* LYRIC_WORD_LIFT_HEIGHT_RATIO/,
    'The completed glyph lift should equal 6% of the original lyric font height');
  const effectLayerSource = functionSource('function buildLyricWordEffectLayers(mask, wordLift, worldW, worldH, pal)');
  assert.match(effectLayerSource,
    /liftWorld = worldH \* \(mask\.fontSize \/ mask\.height\) \* LYRIC_WORD_LIFT_HEIGHT_RATIO/,
    'Independent word shadows and glow should rise by the same 6% font-relative distance');
  assert.match(meshBuilderSource, /makeLyricReadabilityTexture\(mask, 'original'\)[\s\S]*makeLyricReadabilityTexture\(mask, 'translation'\)/,
    'Original and translated readability shadows should be separate layers');
  assert.match(meshBuilderSource, /translationReadabilityMat = makeLyricTextureLayerMaterial\(translationReadabilityTex/,
    'The translation shadow layer must remain fixed while original QRC words rise');
  const liftBuilderSource = functionSource('function buildLyricWordLiftData(line, mask)');
  assert.match(liftBuilderSource, /nativeQqKaraoke !== true[\s\S]*return null;[\s\S]*new THREE\.DataTexture/,
    'Non-QRC lyrics should return before allocating a word-lift texture');
  assert.doesNotMatch(liftBuilderSource, /effectTexture|effectPadding/,
    'Word lift data must not use a shared padded effect map that can move a later word early');
  assert.match(liftBuilderSource, /startPixel[\s\S]*Math\.round\(startUv \* size\)[\s\S]*endPixel[\s\S]*Math\.round\(endUv \* size\)/,
    'Touching QRC words should share one rounded pixel boundary without floor/ceil overlap');
  assert.doesNotMatch(liftBuilderSource, /Math\.ceil\(endUv|Math\.floor\(startUv/,
    'Glyph lift ranges must not overlap by rounding opposite sides of a shared word boundary');
  assert.match(effectLayerSource,
    /makeLyricWordEffectAtlas\(mask, wordLift\.effectEntries, 'glow'\)[\s\S]*makeLyricWordEffectAtlas\(mask, wordLift\.effectEntries, 'readability'\)[\s\S]*makeLyricWordEffectAtlas\(mask, wordLift\.effectEntries, 'glyph'\)/,
    'A QRC line should build one bounded atlas each for character halo, shadow and solid emphasis glyphs');
  assert.match(effectLayerSource,
    /makeLyricWordEffectBatch\(glowTexture[\s\S]*makeLyricWordEffectBatch\(readabilityTexture[\s\S]*makeLyricWordEffectBatch\(glyphTexture/,
    'Per-character effects should remain batched into a small fixed number of draw layers');
  assert.match(effectLayerSource, /wordLift\.effectEntries[\s\S]*effectRanges/,
    'Each native QRC grapheme should retain an independent batched range');
  assert.match(effectLayerSource, /mask\.originalCenterOffsetY/,
    'Word effects should reuse the original baseline calculated by the canonical lyric mask layout');
  const atlasSource = functionSource('function makeLyricWordEffectAtlas(mask, entries, kind)');
  assert.match(atlasSource, /maxAtlasSize\s*=\s*Math\.max\(1024,\s*lyricGpuMaxTextureSize\(\)\)/,
    'Word atlases should respect the active GPU texture-size limit');
  assert.match(atlasSource, /targetRenderScale\s*=\s*1[\s\S]*\(maxAtlasSize - 20\) \/ maxRequestedWidth/,
    'Effect atlases should keep the selected lyric clarity and shrink only to avoid GPU clipping');
  assert.match(atlasSource, /var pages = \[\][\s\S]*finishPage\(\)[\s\S]*pages\.map/,
    'Long QRC lines should split into bounded atlas pages');
  assert.match(atlasSource, /ctx\.rect\(layout\.x, layout\.y, layout\.width, layout\.height\);[\s\S]*ctx\.clip\(\);/,
    'Every word effect must be clipped to its own atlas cell before blur is applied');
  assert.match(functionSource('function makeLyricWordEffectBatch(texture, wordLift, mask, worldW, worldH, baseY, z, heightScale, material)'),
    /layout\.width \/ renderScale \/ mask\.width[\s\S]*layout\.height \/ renderScale \/ mask\.height/,
    'Downsampled atlas cells should recover their intended world-space size in the batched geometry');
  const emphasisMaterialSource = functionSource('function makeLyricWordEffectMaterial(texture, kind, color, wordLift, mask, worldH)');
  assert.match(emphasisMaterialSource, /uLyricTime[\s\S]*aDelay[\s\S]*aPulseDuration/,
    'The GPU emphasis material should derive every character frame directly from lyric source time');
  assert.match(emphasisMaterialSource, /lyricLongTonePulseVertexShaderLines\(\)/,
    'The glow and original glyph layers should share one long-tone pulse shader source');
  assert.match(functionSource('function lyricLongTonePulseVertexShaderLines()'),
    /sin\(3\.14159265\*clamp\(rawPhase,0\.0,1\.0\)\)/,
    'Each character pulse should rise and return inside its assigned QRC window');
  assert.doesNotMatch(functionSource('function buildLyricMesh(text, romanText, transText, lyricLine)'),
    /PlaneGeometry\(worldW, worldH, longToneSegments/,
    'The removed whole-texture stretching mesh must not return');
  assert.match(functionSource('function showStageLine(obj, redrawOnly)'), /releaseLyricWordEffectLayers\(stageLyrics\.current\)[\s\S]*stageLyrics\.outgoing\.push/,
    'A departing line should release its word atlases before entering the outgoing animation');
  assert.match(functionSource('function tickLyricsParticles()'), /!lyricsLines\.length[\s\S]*releaseLyricWordEffectLayers\(stageLyrics\.current\)[\s\S]*stageLyrics\.outgoing\.push/,
    'Clearing the lyric list should release current word atlases before the line exits');
  assert.doesNotMatch(functionSource('function makeLyricTextureLayerMaterial(texture, options)'), /uWordLiftMap|ShaderMaterial/,
    'Line-timed and fixed translation layers should never retain the removed shared effect sampler');

  const updaterSource = functionSource('function updateLyricWordLift(mesh, line, now)');
  assert.match(updaterSource, /updateLyricGpuEmphasisUniforms\(lift, now\)/,
    'The active word update path should send source time directly to GPU uniforms');
  assert.doesNotMatch(updaterSource, /positionAttribute\.needsUpdate|effectColorAttributes/,
    'The active word update path must not upload per-frame character geometry or color buffers');
  assert.match(functionSource('function tickLyricsParticles()'), /updateLyricWordLift\(stageLyrics\.current, curLine, t\)/,
    'The word lift must resample from the lyric clock every frame');
}

function verifySourceTimedAppleStyleLongToneFrames() {
  const context = {
    Math, Number, String, isFinite,
    LYRIC_LONG_TONE_MIN_SECONDS:1,
    LYRIC_LONG_TONE_FULL_SECONDS:4,
    LYRIC_LONG_TONE_SCALE_RATIO:.10,
    LYRIC_LONG_TONE_LIFT_RATIO:.025,
    LYRIC_LONG_TONE_STAGGER_RATIO:.40,
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function lyricLongToneEligibility(text, duration)'),
    functionSource('function lyricLongToneDurationStrength(duration)'),
    functionSource('function lyricLongToneQualityProfile(value)'),
    functionSource('function sampleLyricLongToneGlyph(entry, now, glyphIndex, glyphCount, target)'),
    'this.isEligible = lyricLongToneEligibility;',
    'this.durationStrength = lyricLongToneDurationStrength;',
    'this.qualityProfile = lyricLongToneQualityProfile;',
    'this.sampleGlyph = sampleLyricLongToneGlyph;',
  ].join('\n'), context);

  assert.equal(context.isEligible('啊', 1), true, 'A one-second CJK QRC syllable should receive a long-tone pulse');
  assert.equal(context.isEligible('Oh', 1), true, 'A 2-letter Latin QRC word should remain eligible at one second');
  assert.equal(context.isEligible("I'm", 1), true, 'Internal apostrophes should not count against the net Latin-letter length');
  assert.equal(context.isEligible('Été', 1), true, 'Unicode Latin letters with accents should use the same 2-7 letter rule');
  assert.equal(context.isEligible('All my', 4), false, 'Whitespace-separated words must not be merged into one eligible Latin block');
  assert.equal(context.isEligible('A', 4), false, 'A single Latin letter should not create a distracting pulse');
  assert.equal(context.isEligible('Together', 4), false, 'Latin words longer than seven letters should not be treated as a held syllable');
  assert.equal(context.isEligible('Oh2', 4), false, 'Digit-mixed QRC blocks must not be simplified into an eligible sung word');
  assert.equal(context.isEligible('...', 4), false, 'Punctuation and spaces must never trigger long-tone motion');
  assert.equal(context.isEligible('爱', .999), false, 'Durations below one second must stay fixed');
  assert.equal(context.isEligible('Oh', Infinity), false, 'Only finite QRC source durations may drive long-tone motion');

  assert.equal(context.durationStrength(1), .22, 'One-second nodes should begin with a subtle pulse');
  assert.equal(context.durationStrength(2), .45, 'Two-second nodes should reach the agreed light-to-medium strength');
  assert.equal(context.durationStrength(3), .72, 'Three-second nodes should reach the agreed obvious threshold');
  assert.equal(context.durationStrength(4), 1, 'Four-second and longer QRC nodes should reach the guarded full strength');

  const entry = { start:1, duration:4, longToneStrength:1, terminalBoost:false };
  const firstPeak = context.sampleGlyph(entry, 2.2, 0, 4);
  const lastBeforeStart = context.sampleGlyph(entry, 2.2, 3, 4);
  const lastPeak = context.sampleGlyph(entry, 3.8, 3, 4);
  const firstAfterPulse = context.sampleGlyph(entry, 3.8, 0, 4);
  const ended = context.sampleGlyph(entry, 5, 3, 4);
  assert.ok(Math.abs(firstPeak.pulse - 1) < 1e-6 && Math.abs(firstPeak.scale - 1.1) < 1e-6,
    'The first glyph should reach a ten-percent scale peak from source time');
  assert.equal(lastBeforeStart.pulse, 0, 'Later glyphs must not glow before their visual stagger reaches them');
  assert.ok(Math.abs(lastPeak.pulse - 1) < 1e-6,
    'The long-tone pulse should travel from left to right across the QRC node');
  assert.equal(firstAfterPulse.pulse, 0, 'Earlier glyphs should return instead of leaving a stretched trail');
  assert.equal(ended.pulse, 0, 'The temporary pulse must end exactly with the QRC node');
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.sampleGlyph(entry, 3.8, 3, 4))),
    JSON.parse(JSON.stringify(lastPeak)),
    'Seeking or resampling the same source time must reproduce the same frame without accumulated animation state',
  );

  const terminalPeak = context.sampleGlyph({ ...entry, terminalBoost:true }, 2.2, 0, 4);
  assert.ok(Math.abs(terminalPeak.scale - 1.125) < 1e-6,
    'The final long-tone word should increase motion amplitude by twenty-five percent');
  assert.ok(Math.abs(terminalPeak.glow - 1.3) < 1e-6,
    'The final long-tone word should increase halo intensity by thirty percent');
  assert.equal(terminalPeak.temporaryLiftRatio, 0.03125,
    'Temporary motion should peak at 2.5% of glyph height with the terminal amplitude boost');

  assert.deepEqual(JSON.parse(JSON.stringify(context.qualityProfile('high'))), { motion:1, halo:1 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.qualityProfile('balanced'))), { motion:.85, halo:.72 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.qualityProfile('eco'))), { motion:.65, halo:.45 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.qualityProfile('ultra'))), { motion:1, halo:1 });
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
    progressDragState: { active:false, previewSeconds:NaN },
    audio: { paused: false, src: 'stale-local-track.mp3', currentTime: 99 },
    readSpotifyPlaybackClock: () => 12.345,
    isFinite,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function getPlaybackCurrentSeconds()')}; this.getTime = getPlaybackCurrentSeconds;`, context);
  assert.equal(context.getTime(), 12.345, 'Spotify mode should always use the continuous Spotify clock, even if the local audio element retains a stale source');
  context.progressDragState.active = true;
  context.progressDragState.previewSeconds = 48.25;
  assert.equal(context.getTime(), 48.25, 'An active Spotify drag must expose its local preview instead of a stale poll clock');
}

function verifySpotifySeekGuardRejectsStaleEmptyPolls() {
  const pollSource = functionSource('async function pollSpotifyState()');
  assert.match(pollSource,
    /if \(res\.status === 204\) \{\s*if \(progressDragState\.active \|\| playbackSeekState\.guardUntil > performance\.now\(\)\) return;/,
    'A 204 response must not enter the idle stage during drag preview or the optimistic seek guard');
  assert.match(pollSource,
    /if \(!data \|\| !data\.item\) \{\s*if \(progressDragState\.active\) return;/,
    'An empty 200 response must not clear an active drag preview');
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
    'function normalizeLyricMetadataIdentityText(text)',
    'function isCurrentSongIdentityLyricText(text, song)',
    'function lyricProviderDropsOpeningLine(provider)',
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
    MineradioLyricCreditFilter: lyricCreditFilter,
    apiJson: async (url) => {
      calls.push(url);
      if (url.startsWith('/api/qq/search')) {
        return { songs: [{ provider: 'qq', mid: 'qq-mid-1', id: 'qq-mid-1', name: 'Test Song', artist: 'Test Artist' }] };
      }
      if (url.startsWith('/api/qq/lyric')) {
        if (qqPayloadMode === 'lyric') return { lyric: '[00:00.00]QQ title\n[00:01.00]QQ lyric' };
        if (qqPayloadMode === 'qrc') return {
          lyric: '',
          qrc: '[0,900]QQ title(0,900)\n[1000,900]QQ(1000,450) lyric(1450,450)',
        };
        return { lyric: '', qrc: '' };
      }
      if (url.startsWith('/api/lyric')) return { lyric: '[00:00.00]NetEase title\n[00:01.00]NetEase lyric' };
      throw new Error(`Unexpected URL: ${url}`);
    },
    songProviderKey: (song) => song && song.provider === 'qq' ? 'qq' : 'netease',
    getManualLyricCandidate: () => null,
    fetchSongLyricCache: async () => null,
    saveSongLyricCache: async (song, payload) => payload,
    lyricCacheCandidateFromPayload: (payload) => ({ provider:payload && payload.provider || 'qq' }),
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
  assert.equal(qqResult.lyric, '[00:00.00]QQ title\n[00:01.00]QQ lyric');
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
  assert.equal(fallbackResult.lyric, '[00:00.00]NetEase title\n[00:01.00]NetEase lyric');
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
    normalizeLyricTextureClarity(value) { return Number(value) || 2; },
    normalizeSonicWorkshopValue(value) { return Number(value) || 1; },
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
    window: { spotifyAudioDuration:246.5 },
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
    song: { name: 'Test Song', artist: 'Test Artist', provider: 'spotify', source: 'spotify', duration:246.5 },
    token: 11,
  }], 'Spotify metadata should enter the shared QQ-first lyric resolver directly');
}

verifyTranslationReachesStageRenderer();
verifyLongToneOnlyGlowSettings();
verifyTranslationPlaceholdersAreHidden();
verifyTranslationTogglePersistsAndRefreshes();
verifyTranslationPreferenceDefaultsOn();
verifyKaraokeGlyphOpacityAndTranslationShadowContract();
verifyLyricTextureResolutionAndGlowScale();
verifyNativeQrcWordsFloatFromTheirSourceStarts();
verifySourceTimedAppleStyleLongToneFrames();
verifySpotifyClockIsFrameContinuousAndCorrectable();
verifySpotifyModeNeverFallsBackToLocalAudioTime();
verifySpotifySeekGuardRejectsStaleEmptyPolls();
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
