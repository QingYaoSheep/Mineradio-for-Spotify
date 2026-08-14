const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readRendererSource } = require('./renderer-source');

const html = readRendererSource();
const root = path.resolve(__dirname, '..');

function functionSource(marker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${marker} should exist`);
  let depth = 0;
  for (let index = html.indexOf('{', start); index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`${marker} should have a complete body`);
}

function verifyPayloadMapping() {
  const context = { Array, Number, Object, String };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource('function applyRomanizationToLyricLines(lines, romanization)')}; this.applyRoman = applyRomanizationToLyricLines;`,
    context,
  );
  const lines = [{ t:0, text:'널' }];
  context.applyRoman(lines, {
    language:'ko',
    lines:[{
      lineIndex:0,
      text:'neol',
      mode:'qrc-word',
      tokens:[{ sourceText:'널', romanized:'neol', c0:0, c1:1, sourceNodeIndexes:[0] }],
    }],
  });
  assert.equal(lines[0].romanText, 'neol');
  assert.equal(lines[0].romanMode, 'qrc-word');
  assert.equal(lines[0].romanLanguage, 'ko');
  assert.deepEqual(lines[0].romanTokens[0].sourceNodeIndexes, [0]);
}

function verifyRendererContract() {
  assert.match(html, /id="t-lyricRomanization"[^>]+toggleFx\('lyricRomanization'\)/);
  assert.match(html, /lyricRomanization:\s*true/);
  assert.match(html, /lyricRomanization:\s*raw\.lyricRomanization !== false/);
  assert.match(html, /lyricRomanization:\s*fx\.lyricRomanization !== false/);

  const mask = functionSource('function makeLyricMask(text, romanText, transText, lyricLine)');
  assert.match(mask, /romanScale = 0\.42/);
  assert.match(mask, /translationScale = 0\.34/);
  assert.match(mask, /fontSize \* 0\.16/);
  assert.match(mask, /fontSize \* 0\.22/);
  assert.match(mask, /y0 = H \/ 2 \+ fontSize \* 0\.32/,
    'The original lyric baseline should not move when secondary rows appear');
  assert.doesNotMatch(mask, /slotScaleRequirement|localScale|rowScale/,
    'Romanization must keep its natural glyph aspect ratio without local or row-wide horizontal scaling');
  assert.match(mask, /drawScale:1/);
  assert.match(mask, /lyricLine\.romanLanguage === 'ko'/);
  assert.match(mask, /koreanRomanOpticalShift = romanFontSize \* 0\.10/,
    'Korean romanization should use a small, fixed rightward optical shift instead of stretching');
  assert.match(mask, /sourceLeft \+ koreanRomanOpticalShift/,
    'Korean romanization should shift right, not left');
  assert.match(mask, /originalLayout\.push/);
  assert.match(mask, /if \(!sourceBoundaryPixels\)/,
    'QRC lines without romanization should still materialize the exact source boundary map');
  assert.match(mask, /translationCenter:x/,
    'Translation should retain its independent centered anchor');
  assert.match(mask, /baseCanvasWidth:baseCanvasWidth/,
    'Naturally wide romanization should expand the texture without changing glyph size');

  const material = functionSource('function makeLyricRomanMaterial(texture, pal, glowLayer)');
  assert.match(material, /mix\(0\.75,1\.0,filled\)/,
    'Pending romanized glyphs should use the same 75% karaoke opacity');
  assert.match(material, /wave\*0\.60/,
    'Romanized long-tone glow should use 60% of the white soft-glow signal');
  assert.doesNotMatch(material, /scale\s*=|transformed\.y|lift/,
    'Romanized lyrics must not inherit original-word scale or lift motion');

  const update = functionSource('function updateLyricRomanization(mesh, line, now, lineProgress)');
  assert.match(update, /item\.sourceSlices/);
  assert.match(update, /var tokenProgress = qrcMode\s*\?\s*0/,
    'QRC romanization without valid source slices must not fall back to independently computed line progress');
  assert.match(update, /item\.sourceNodeIndexes/,
    'The defensive QRC fallback must still derive progress from original source nodes');
  assert.match(update, /line\.nativeQqKaraoke === true/,
    'Only reliable native QQ QRC should enable romanized long-tone glow');
  assert.match(update, /romanMode === 'qrc-word'/);

  const wordLift = functionSource('function buildLyricWordLiftData(line, mask)');
  assert.match(wordLift, /mask\.sourceBoundaryPixels/,
    'QRC lift and glow ranges must follow the expanded Korean source layout');

  const stage = functionSource('function showStageLine(obj, redrawOnly)');
  assert.match(stage, /fx\.lyricRomanization !== false/);
  assert.match(stage, /buildLyricMesh\(text, romanText, transText/);
}

function verifyDataFlowContract() {
  const ensure = functionSource('async function ensureLyricPayloadRomanization(song, payload)');
  assert.match(ensure, /resolveLyricPayload\(payload, song\)/,
    'Romanization must be generated only after metadata stripping and final lyric parsing');
  assert.match(ensure, /languageHint = lyricRomanizationLanguageHint\(song, resolved\.lines\)/);
  assert.match(ensure, /lyricPayloadRomanizationIsCurrent\(payload, resolved\.lines, languageHint\)/,
    'A version match alone must not hide missing Japanese or Korean romanization rows');
  assert.match(ensure, /requestLyricRomanization\(\s*resolved\.lines,\s*languageHint/);

  const cacheCurrent = functionSource('function lyricPayloadRomanizationIsCurrent(payload, lines, languageHint)');
  assert.match(cacheCurrent, /romanization\.engineVersion !== currentVersion/,
    'A stale romanization engine version must trigger a romanization-only cache refresh');
  assert.match(cacheCurrent, /requiredIndexes/);
  assert.match(cacheCurrent, /completedIndexes/);
  assert.match(cacheCurrent, /requiredIndexes\.every/,
    'Current-version cached romanization should be complete for every target-language line');

  const cacheContext = {
    Array, Number, Object, Set, String,
    lyricLineNeedsRomanization:function(){ return true; },
  };
  vm.createContext(cacheContext);
  vm.runInContext(`${cacheCurrent}; this.cacheCurrent = lyricPayloadRomanizationIsCurrent;`, cacheContext);
  const cachedLines = [{ t:0, text:'뜨거운', source:'qrc-word' }];
  const cachedRomanization = {
    language:'ko',
    lines:[{ lineIndex:0, text:'tteu geo un' }],
    processedLineIndexes:[0],
  };
  assert.equal(cacheContext.cacheCurrent({
    romanization:{ ...cachedRomanization, engineVersion:'1' },
    cache:{ romanizationEngineVersion:'2' },
  }, cachedLines, 'ko'), false,
  'Engine version 1 romanization must be rejected after the version 2 upgrade');
  assert.equal(cacheContext.cacheCurrent({
    romanization:{ ...cachedRomanization, engineVersion:'2' },
    cache:{ romanizationEngineVersion:'2' },
  }, cachedLines, 'ko'), true,
  'A complete engine version 2 romanization cache should remain reusable');

  const atlas = functionSource('function makeLyricWordEffectAtlas(mask, entries, kind)');
  assert.match(atlas, /fontSize \* 0\.36/);
  assert.match(atlas, /fontSize \* 0\.20 \* renderScale/,
    'QRC glow should use the tightened diffusion profile');
  assert.match(atlas, /lyricReadabilityShadowPasses\(renderFontSize, 1, 0\.72\)/,
    'QRC readability shadows should be tighter without changing translation shadows');

  const request = functionSource('async function requestLyricRomanization(lines, languageHint)');
  assert.match(request, /languageHint:languageHint === 'ja' \|\| languageHint === 'ko'/);
  assert.match(request, /romanizationRequestFailedThisSession = true/,
    'A structured backend failure must trip the same-session retry guard');

  const online = functionSource('async function fetchOnlineLyricPayload(song, options)');
  assert.ok(
    online.indexOf('ensureLyricPayloadRomanization(song, payload)') <
      online.indexOf("selection = { mode:'auto'"),
    'Automatic lyrics should gain romanization before entering the one-song cache',
  );

  const custom = functionSource('async function saveCustomLyricForCurrent()');
  assert.match(custom, /await requestLyricRomanization\(lines, lyricRomanizationLanguageHint\(song, lines\)\)/,
    'Saving custom lyrics should rebuild romanization before applying them');

  const runtimeSync = fs.readFileSync(path.join(root, 'scripts', 'sync-amll-runtime.js'), 'utf8');
  assert.match(runtimeSync, /romanization-engine\.js/,
    'The unpacked runtime sync must include the local romanization engine');
}

verifyPayloadMapping();
verifyRendererContract();
verifyDataFlowContract();
console.log('Lyric romanization renderer: PASS');
