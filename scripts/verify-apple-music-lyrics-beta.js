'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const model = require('../public/js/apple-music-lyrics-beta-model');
const { patchAmllCoreSource } = require('./patch-amll-core-source');

function verifySettings() {
  const normalized = model.normalizeSettings({
    enabled:true,
    anchorPosition:0.9,
    futureBlur:-2,
    autoReturnSeconds:20,
    textColor:'#abc',
    renderQuality:'unknown',
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.anchorPosition, 0.5);
  assert.equal(normalized.futureBlur, 0);
  assert.equal(normalized.autoReturnSeconds, 8);
  assert.equal(normalized.textColor, '#AABBCC');
  assert.equal(normalized.renderQuality, 'auto');
  assert.equal(normalized.wordAdvanceEnabled, true);
  assert.equal(model.normalizeSettings({ wordAdvanceEnabled:false }).wordAdvanceEnabled, false);
  const obsoleteOpacitySettings = model.normalizeSettings({
    translationOpacity:0.72,
    romanizationOpacity:0.91,
    currentOriginalOpacity:2,
    nonCurrentOriginalOpacity:0,
    currentTranslationOpacity:1,
    nonCurrentTranslationOpacity:0.1,
    currentRomanizationOpacity:1,
    nonCurrentRomanizationOpacity:0.1,
    unplayedWordOpacity:0.9,
    backgroundVocalOpacity:0.7,
  });
  [
    'translationOpacity',
    'romanizationOpacity',
    'currentOriginalOpacity',
    'nonCurrentOriginalOpacity',
    'currentTranslationOpacity',
    'nonCurrentTranslationOpacity',
    'currentRomanizationOpacity',
    'nonCurrentRomanizationOpacity',
    'unplayedWordOpacity',
    'backgroundVocalOpacity',
  ].forEach(key => {
    assert.equal(Object.prototype.hasOwnProperty.call(obsoleteOpacitySettings, key), false,
      `${key} must be discarded because AMLL opacity is no longer configurable`);
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'inactiveOpacity'), false,
    'AMLL Core must remain the only owner of line opacity');
}

function verifyReliableQrcConversion() {
  const settings = model.normalizeSettings({});
  const converted = model.toAmllLines([{
    t:1,
    duration:3,
    sourceEnd:4,
    text:'널 부를래',
    source:'qrc-word',
    nativeQqKaraoke:true,
    transText:'我要叫你',
    romanText:'neol bu reul rae',
    romanTokens:[
      { romanized:'neol', sourceNodeIndexes:[0] },
      { romanized:'bu reul rae', sourceNodeIndexes:[1,2,3] },
    ],
    karaokeTimeline:[
      { text:'널 ', start:1, duration:1.2, timed:true },
      { text:'부', start:2.2, duration:.3, timed:true },
      { text:'를', start:2.5, duration:.3, timed:true },
      { text:'래', start:2.8, duration:1.2, timed:true },
    ],
  }, {
    t:3.8,
    duration:1,
    sourceEnd:4.8,
    text:'重叠',
    source:'qrc-word',
    nativeQqKaraoke:true,
    karaokeTimeline:[
      { text:'重', start:3.8, duration:.6, timed:true },
      { text:'叠', start:4.4, duration:.4, timed:true },
    ],
  }], settings, 'qrc-word');

  assert.equal(converted.length, 2);
  assert.deepEqual(
    converted[0].words.map(word => [word.word, word.startTime, word.endTime]),
    [['널 ', 1000, 2200], ['부', 2200, 2500], ['를', 2500, 2800], ['래', 2800, 4000]]
  );
  assert.deepEqual(converted[0].words.map(word => word.romanWord), ['neol', 'bu', 'reul', 'rae']);
  assert.equal(converted[0].translatedLyric, '我要叫你');
  assert.equal(converted[0].romanLyric, '');
  assert.equal(converted[0].endTime, 4000);
  assert.equal(converted[1].startTime, 3800, 'overlapping source timelines must remain overlapping');

  const unevenRomanization = model.toAmllLine({
    t:5,
    duration:2,
    text:'未来',
    nativeQqKaraoke:true,
    romanTokens:[{ romanized:'mirai', c0:0, c1:2, sourceNodeIndexes:[0,1] }],
    karaokeTimeline:[
      { text:'未', c0:0, c1:1, start:5, duration:1, timed:true },
      { text:'来', c0:1, c1:2, start:6, duration:1, timed:true },
    ],
  }, settings, 'qrc-word');
  assert.equal(unevenRomanization.words.length, 2);
  assert(unevenRomanization.words.every(word => word.romanWord && word.romanWord.trim()),
    'every source node in a romanization token must receive an aligned segment');
  assert.equal(unevenRomanization.words.map(word => word.romanWord).join(''), 'mirai');

  const wholeWordKorean = model.toAmllLine({
    t:8,
    duration:1.2,
    text:'뜨거운',
    nativeQqKaraoke:true,
    romanTokens:[{ romanized:'tteu geo un', c0:0, c1:3, sourceNodeIndexes:[0] }],
    karaokeTimeline:[
      { text:'뜨거운', c0:0, c1:3, start:8, duration:1.2, timed:true },
    ],
  }, settings, 'qrc-word');
  assert.equal(wholeWordKorean.words[0].romanWord, 'tteu geo un',
    'a whole-word QRC node must preserve the visible spaces between Korean syllables');

  const screenshotKorean = model.toAmllLine({
    t:32.228,
    duration:2.512,
    sourceEnd:34.74,
    text:'알잖아 이건 언어 이상의 signs',
    nativeQqKaraoke:true,
    source:'qrc-word',
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'알잖아', romanized:'al jan ha', c0:0, c1:3, sourceNodeIndexes:[0] },
      { sourceText:'이건', romanized:'i geon', c0:4, c1:6, sourceNodeIndexes:[1] },
      { sourceText:'언어', romanized:'eo neo', c0:7, c1:9, sourceNodeIndexes:[2] },
      { sourceText:'이상의', romanized:'i sang ui', c0:10, c1:13, sourceNodeIndexes:[3] },
      { sourceText:'signs', romanized:'signs', c0:14, c1:19, sourceNodeIndexes:[4] },
    ],
    karaokeTimeline:[
      { text:'알잖아 ', start:32.228, duration:.328, c0:0, c1:4, timed:true },
      { text:'이건 ', start:32.556, duration:.449, c0:4, c1:7, timed:true },
      { text:'언어 ', start:33.005, duration:.575, c0:7, c1:10, timed:true },
      { text:'이상의 ', start:33.58, duration:.593, c0:10, c1:14, timed:true },
      { text:'signs', start:34.173, duration:.567, c0:14, c1:19, timed:true },
    ],
  }, settings, 'qrc-word');
  assert.deepEqual(screenshotKorean.words.map(word => [word.startTime, word.endTime]), [
    [32228, 32556], [32556, 33005], [33005, 33580], [33580, 34173], [34173, 34740],
  ], 'visible romanization spacing must not alter the QQ QRC source timeline');
  assert.deepEqual(screenshotKorean.words.map(word => word.romanWord), [
    'al jan ha', 'i geon', 'eo neo', 'i sang ui', 'signs',
  ], 'the model must preserve Korean syllable boundaries for the renderer');

  const punctuatedKorean = model.toAmllLine({
    t:10,
    duration:1.4,
    text:'뜨거운,',
    nativeQqKaraoke:true,
    romanTokens:[{ romanized:'tteu geo un,', c0:0, c1:4, sourceNodeIndexes:[0, 1, 2, 3] }],
    karaokeTimeline:[
      { text:'뜨', c0:0, c1:1, start:10, duration:.3, timed:true },
      { text:'거', c0:1, c1:2, start:10.3, duration:.3, timed:true },
      { text:'운', c0:2, c1:3, start:10.6, duration:.4, timed:true },
      { text:',', c0:3, c1:4, start:11, duration:.4, timed:true },
    ],
  }, settings, 'qrc-word');
  assert.deepEqual(punctuatedKorean.words.map(word => word.romanWord),
    ['tteu', 'geo', 'un,', undefined],
    'a standalone punctuation node must not consume a Korean syllable segment');
}

function verifyAppleKoreanLexicalTiming() {
  const settings = model.normalizeSettings({});
  const sourceLine = {
    t:1,
    duration:3,
    sourceEnd:4,
    text:'세상의 장면 중',
    source:'apple-ttml-word',
    nativeAppleKaraoke:true,
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'세상의', romanized:'se sang ui', c0:0, c1:3, sourceNodeIndexes:[0] },
      { sourceText:'장면', romanized:'jang myeon', c0:4, c1:6, sourceNodeIndexes:[1, 2] },
      { sourceText:'중', romanized:'jung', c0:7, c1:8, sourceNodeIndexes:[3] },
    ],
    karaokeTimeline:[
      { text:'세상의 ', c0:0, c1:4, start:1, duration:.6, timed:true },
      { text:'장', c0:4, c1:5, start:1.6, duration:.35, timed:true },
      { text:'면 ', c0:5, c1:7, start:1.95, duration:.45, timed:true },
      { text:'중', c0:7, c1:8, start:2.4, duration:.6, timed:true },
    ],
  };
  const originalTimeline = JSON.parse(JSON.stringify(sourceLine.karaokeTimeline));
  const converted = model.toAmllLine(sourceLine, settings, 'apple-ttml-word');
  const lexicalWord = converted.words.find(word => word.word === '장면');

  assert(lexicalWord, 'split Apple TTML syllables must render as one Korean lexical word');
  assert.equal(lexicalWord.romanWord, 'jang myeon');
  assert.deepEqual(lexicalWord.ruby, [
    { word:'장', startTime:1600, endTime:1950 },
    { word:'면', startTime:1950, endTime:2400 },
  ], 'the merged visual word must retain every source syllable timestamp');
  assert.equal(converted.words.map(word => word.word).join(''), sourceLine.text,
    'visual word grouping must preserve explicit source spaces');
  assert.equal(converted.mineradioAppleKoreanLexicalTiming, true,
    'the renderer must be told that ruby nodes carry hidden Apple timing metadata');
  assert.deepEqual(converted.mineradioAppleKoreanWordColumns, [
    { sourceText:'세상의', romanized:'se sang ui' },
    { sourceText:'장면', romanized:'jang myeon' },
    { sourceText:'중', romanized:'jung' },
  ], 'Apple Korean word layout must use source whitespace instead of TTML timing nodes');
  assert.deepEqual(sourceLine.karaokeTimeline, originalTimeline,
    'display grouping must not mutate the parsed Apple TTML timeline');

  const mixedSingleAndSplitInput = {
    t:8,
    duration:3,
    sourceEnd:11,
    text:'들려줄게 네게',
    source:'apple-ttml-word',
    nativeAppleKaraoke:true,
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'들려줄게', romanized:'deul ryeo jul ge', c0:0, c1:4, sourceNodeIndexes:[0] },
      { sourceText:'네게', romanized:'ne ge', c0:5, c1:7, sourceNodeIndexes:[1, 2] },
    ],
    karaokeTimeline:[
      { text:'들려줄게 ', c0:0, c1:5, start:8, duration:1, timed:true },
      { text:'네', c0:5, c1:6, start:9, duration:.4, timed:true },
      { text:'게', c0:6, c1:7, start:9.4, duration:.6, timed:true },
    ],
  };
  const mixedSingleAndSplitWords = model.toAmllLine(
    mixedSingleAndSplitInput, settings, 'apple-ttml-word'
  );
  assert.deepEqual(mixedSingleAndSplitWords.mineradioAppleKoreanWordColumns, [
    { sourceText:'들려줄게', romanized:'deul ryeo jul ge' },
    { sourceText:'네게', romanized:'ne ge' },
  ], 'single-node and split-node words must share the same whitespace-derived layout metadata');
  const invalidSingleNodeMapping = JSON.parse(JSON.stringify(mixedSingleAndSplitInput));
  invalidSingleNodeMapping.romanTokens[0].sourceNodeIndexes = [2];
  const invalidSingleNodeFallback = model.toAmllLine(
    invalidSingleNodeMapping, settings, 'apple-ttml-word'
  );
  assert.equal(invalidSingleNodeFallback.mineradioAppleKoreanWordColumns, null,
    'an incorrect single-node mapping must disable the whole Apple word-column layout');
  assert.equal(invalidSingleNodeFallback.mineradioAppleKoreanLexicalTiming, false,
    'invalid single-node mapping must also fall back from merged visual timing words');

  const sharedTimingNode = model.toAmllLine({
    t:12,
    duration:1,
    sourceEnd:13,
    text:'가 나',
    source:'apple-ttml-word',
    nativeAppleKaraoke:true,
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'가', romanized:'ga', c0:0, c1:1, sourceNodeIndexes:[0] },
      { sourceText:'나', romanized:'na', c0:2, c1:3, sourceNodeIndexes:[0] },
    ],
    karaokeTimeline:[
      { text:'가 나', c0:0, c1:3, start:12, duration:1, timed:true },
    ],
  }, settings, 'apple-ttml-word');
  assert.deepEqual(sharedTimingNode.mineradioAppleKoreanWordColumns, [
    { sourceText:'가', romanized:'ga' },
    { sourceText:'나', romanized:'na' },
  ], 'one Apple timing node may drive multiple source-whitespace visual words');
  assert.equal(sharedTimingNode.words.map(word => word.word).join(''), '가 나',
    'splitting one timing node into visual words must preserve source spaces');
  assert(sharedTimingNode.words.filter(word => word.word.trim()).every(word =>
    word.startTime === 12000 && word.endTime === 13000),
  'visual words sharing one TTML node must reuse its exact start and end time');

  const standalonePunctuation = model.toAmllLine({
    t:14,
    duration:2,
    sourceEnd:16,
    text:'장면 , signs',
    source:'apple-ttml-word',
    nativeAppleKaraoke:true,
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'장면', romanized:'jang myeon', c0:0, c1:2, sourceNodeIndexes:[0, 1] },
      { sourceText:',', romanized:',', c0:3, c1:4, sourceNodeIndexes:[2] },
      { sourceText:'signs', romanized:'signs', c0:5, c1:10, sourceNodeIndexes:[3] },
    ],
    karaokeTimeline:[
      { text:'장', c0:0, c1:1, start:14, duration:.3, timed:true },
      { text:'면 ', c0:1, c1:3, start:14.3, duration:.4, timed:true },
      { text:', ', c0:3, c1:5, start:14.7, duration:.2, timed:true },
      { text:'signs', c0:5, c1:10, start:14.9, duration:.8, timed:true },
    ],
  }, settings, 'apple-ttml-word');
  assert.deepEqual(standalonePunctuation.mineradioAppleKoreanWordColumns, [
    { sourceText:'장면 ,', romanized:'jang myeon,' },
    { sourceText:'signs', romanized:'signs' },
  ], 'a standalone punctuation token must attach to the preceding Apple visual word');
  assert.equal(standalonePunctuation.words.map(word => word.word).join(''), '장면 , signs',
    'punctuation attachment must preserve the original source text and spaces');
  const punctuatedVisualWord = standalonePunctuation.words.find(word => word.word === '장면 ,');
  assert.deepEqual(punctuatedVisualWord && punctuatedVisualWord.ruby, [
    { word:'장', startTime:14000, endTime:14300 },
    { word:'면 ', startTime:14300, endTime:14700 },
    { word:',', startTime:14700, endTime:14900 },
  ], 'attached punctuation must retain its original Apple timing segment');

  const punctuated = model.toAmllLine({
    t:5,
    duration:2,
    sourceEnd:7,
    text:'장면, signs',
    source:'apple-ttml-word',
    nativeAppleKaraoke:true,
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'장면,', romanized:'jang myeon,', c0:0, c1:3, sourceNodeIndexes:[0, 1] },
      { sourceText:'signs', romanized:'signs', c0:4, c1:9, sourceNodeIndexes:[2] },
    ],
    karaokeTimeline:[
      { text:'장', c0:0, c1:1, start:5, duration:.4, timed:true },
      { text:'면, ', c0:1, c1:4, start:5.4, duration:.5, timed:true },
      { text:'signs', c0:4, c1:9, start:5.9, duration:.8, timed:true },
    ],
  }, settings, 'apple-ttml-word');
  const punctuatedWord = punctuated.words.find(word => word.word === '장면,');
  assert(punctuatedWord, 'trailing punctuation must stay attached to the merged Korean lexical word');
  assert.equal(punctuatedWord.romanWord, 'jang myeon,');
  assert.deepEqual(punctuatedWord.ruby.map(segment => segment.word), ['장', '면,']);
  assert.equal(punctuated.words.map(word => word.word).join(''), '장면, signs');

  const ambiguous = JSON.parse(JSON.stringify(sourceLine));
  ambiguous.romanTokens[1].sourceNodeIndexes = [1, 3];
  const fallback = model.toAmllLine(ambiguous, settings, 'apple-ttml-word');
  assert.equal(fallback.mineradioAppleKoreanLexicalTiming, false,
    'ambiguous node mappings must fall back instead of guessing a Korean word boundary');
  assert.equal(fallback.mineradioAppleKoreanWordColumns, null,
    'ambiguous timing mappings must not publish guessed whitespace layout metadata');
  assert.equal(fallback.words.some(word => word.word === '장면'), false,
    'the ambiguous fallback must preserve the original split timing nodes');

  [[2, 1], [1, 1, 2]].forEach(sourceNodeIndexes => {
    const malformed = JSON.parse(JSON.stringify(sourceLine));
    malformed.romanTokens[1].sourceNodeIndexes = sourceNodeIndexes;
    const malformedFallback = model.toAmllLine(malformed, settings, 'apple-ttml-word');
    assert.equal(malformedFallback.mineradioAppleKoreanLexicalTiming, false,
      `unordered or duplicate node mappings must fall back: ${sourceNodeIndexes.join(',')}`);
  });

  const romanizationDisabled = model.toAmllLine(sourceLine,
    model.normalizeSettings({ showRomanization:false }), 'apple-ttml-word');
  assert.equal(romanizationDisabled.mineradioAppleKoreanLexicalTiming, false,
    'visual word grouping is unnecessary when romanization is disabled');
  assert.equal(romanizationDisabled.mineradioAppleKoreanWordColumns, null,
    'disabled romanization must not publish Apple Korean word layout metadata');
}

function verifyLineOnlyDegrade() {
  const settings = model.normalizeSettings({});
  const line = model.toAmllLine({
    t:12,
    duration:5,
    text:'逐行歌词',
    transText:'//',
    romanText:'chukhae',
    source:'lrc',
  }, settings, 'lrc-line');
  assert.equal(line.words.length, 1);
  assert.equal(line.words[0].startTime, 12000);
  assert.equal(line.words[0].endTime, 12000, 'line lyrics must not invent word timing or long-tone glow');
  assert.equal(line.startTime, 12000);
  assert.equal(line.endTime, 17000);
  assert.equal(line.translatedLyric, '');
  assert.equal(line.romanLyric, 'chukhae');
  assert.equal(line.mineradioReliableQrc, false);

  const koreanLine = model.toAmllLine({
    t:18,
    duration:4,
    text:'한 눈 깜짝',
    transText:'让人瞬间闭上眼',
    romanText:'han nun kkam jjak',
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'한', romanized:'han', c0:0, c1:1 },
      { sourceText:'눈', romanized:'nun', c0:2, c1:3 },
      { sourceText:'깜짝', romanized:'kkam jjak', c0:4, c1:6 },
    ],
    source:'lrc',
  }, settings, 'lrc-line');
  assert.equal(koreanLine.words.length, 1,
    'line-only Korean lyrics must not invent word timing for visual alignment');
  assert.deepEqual(koreanLine.mineradioRomanColumns, [
    { sourceText:'한', romanized:'han' },
    { sourceText:'눈', romanized:'nun' },
    { sourceText:'깜짝', romanized:'kkam jjak' },
  ], 'line-only Korean lyrics must preserve Apple Music-style source/romanization columns');

  const mixedKoreanLine = model.toAmllLine({
    t:23,
    duration:3,
    text:'한 눈, Baby 깜짝',
    romanText:'han nun, Baby kkam jjak',
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'한', romanized:'han', c0:0, c1:1 },
      { sourceText:'눈,', romanized:'nun,', c0:2, c1:4 },
      { sourceText:'Baby', romanized:'Baby', c0:5, c1:9 },
      { sourceText:'깜짝', romanized:'kkam jjak', c0:10, c1:12 },
    ],
    source:'lrc',
  }, settings, 'lrc-line');
  assert.deepEqual(mixedKoreanLine.mineradioRomanColumns, [
    { sourceText:'한', romanized:'han' },
    { sourceText:'눈,', romanized:'nun,' },
    { sourceText:'Baby', romanized:'Baby' },
    { sourceText:'깜짝', romanized:'kkam jjak' },
  ], 'punctuation must stay attached and mixed English must remain unchanged');

  const spacedPunctuation = model.toAmllLine({
    t:26,
    duration:3,
    text:'한 눈 , 깜짝',
    romanText:'han nun , kkam jjak',
    romanLanguage:'ko',
    romanTokens:[
      { sourceText:'한', romanized:'han', c0:0, c1:1 },
      { sourceText:'눈', romanized:'nun', c0:2, c1:3 },
      { sourceText:',', romanized:',', c0:4, c1:5 },
      { sourceText:'깜짝', romanized:'kkam jjak', c0:6, c1:8 },
    ],
    source:'lrc',
  }, settings, 'lrc-line');
  assert.deepEqual(spacedPunctuation.mineradioRomanColumns, [
    { sourceText:'한', romanized:'han' },
    { sourceText:'눈,', romanized:'nun,' },
    { sourceText:'깜짝', romanized:'kkam jjak' },
  ], 'a standalone punctuation token must attach to the previous Korean word column');

  const incompleteMapping = model.toAmllLine({
    t:27,
    duration:3,
    text:'한 눈',
    romanText:'han nun',
    romanLanguage:'ko',
    romanTokens:[{ sourceText:'한 눈', romanized:'han nun', c0:0, c1:3 }],
    source:'lrc',
  }, settings, 'lrc-line');
  assert.equal(incompleteMapping.mineradioRomanColumns, null,
    'an invalid token map must keep the flat romanization fallback instead of dropping text');
  assert.equal(incompleteMapping.romanLyric, 'han nun');
}

function verifyDuetMetadata() {
  const line = model.toAmllLine({
    t:2,
    duration:1,
    text:'reply',
    isDuet:true,
    isBG:true,
  }, model.normalizeSettings({}), 'apple-music-word');
  assert.equal(line.isDuet, true);
  assert.equal(line.isBG, true);

  const grouped = model.toAmllLines([{
    t:1,
    duration:2,
    text:'main',
  }, {
    t:.8,
    duration:2.5,
    text:'background',
    isBG:true,
  }, {
    t:4,
    duration:1,
    text:'next',
  }], model.normalizeSettings({}), 'lrc-line');
  assert.deepEqual(grouped.map(item => [item.words[0].word, item.isBG]),
    [['main', false], ['background', true], ['next', false]],
    'background vocals must remain attached after their owning foreground line');

  const orphanRemoved = model.toAmllLines([{
    t:.5,
    duration:1,
    text:'orphan background',
    isBG:true,
  }, {
    t:2,
    duration:1,
    text:'first foreground',
  }], model.normalizeSettings({}), 'lrc-line');
  assert.deepEqual(orphanRemoved.map(item => item.words[0].word), ['first foreground'],
    'a background vocal without an owning foreground line must never become a foreground group');
}

function verifyAppleBackgroundVocalDisplayText() {
  const settings = model.normalizeSettings({});
  const splitParentheses = {
    t:1,
    duration:1,
    sourceEnd:2,
    text:'(oh)',
    transText:'（哦）',
    romanText:'(oh)',
    source:'apple-ttml-word',
    nativeAppleKaraoke:true,
    isBG:true,
    karaokeTimeline:[
      { text:'(', start:1, duration:.1, timed:true },
      { text:'oh', start:1.1, duration:.8, timed:true },
      { text:')', start:1.9, duration:.1, timed:true },
    ],
  };
  const originalTimeline = JSON.parse(JSON.stringify(splitParentheses.karaokeTimeline));
  const converted = model.toAmllLine(splitParentheses, settings, 'apple-ttml-word');
  assert.deepEqual(converted.words.map(word => [word.word, word.startTime, word.endTime]), [
    ['oh', 1100, 1900],
  ], 'Apple background-vocal wrapper punctuation must not become visible AMLL words');
  assert.equal(converted.translatedLyric, '哦');
  assert.equal(splitParentheses.text, '(oh)', 'display cleanup must not mutate the structured Apple lyric');
  assert.deepEqual(splitParentheses.karaokeTimeline, originalTimeline,
    'display cleanup must not mutate Apple TTML node timing');

  const lineOnly = model.toAmllLine({
    t:3,
    duration:1,
    text:'（echo）',
    transText:'(回声)',
    romanText:'（echo）',
    source:'apple-ttml-line',
    isBG:true,
  }, settings, 'apple-ttml-line');
  assert.equal(lineOnly.words[0].word, 'echo');
  assert.equal(lineOnly.translatedLyric, '回声');
  assert.equal(lineOnly.romanLyric, 'echo');

  const splitRomanParentheses = {
    t:3,
    duration:2,
    sourceEnd:5,
    text:'（오 베이비）',
    romanText:'(o bei bi)',
    source:'apple-ttml-word',
    nativeAppleKaraoke:true,
    isBG:true,
    romanTokens:[
      { sourceText:'오', romanized:'(o', c0:1, c1:2, sourceNodeIndexes:[1] },
      { sourceText:'베이비', romanized:'bei bi)', c0:3, c1:6, sourceNodeIndexes:[2] },
    ],
    karaokeTimeline:[
      { text:'（', start:3, duration:.1, timed:true },
      { text:'오 ', start:3.1, duration:.8, timed:true },
      { text:'베이비', start:3.9, duration:1, timed:true },
      { text:'）', start:4.9, duration:.1, timed:true },
    ],
  };
  const originalRomanTokens = JSON.parse(JSON.stringify(splitRomanParentheses.romanTokens));
  const wordTimedRoman = model.toAmllLine(
    splitRomanParentheses, settings, 'apple-ttml-word'
  );
  assert.deepEqual(wordTimedRoman.words.map(word => word.romanWord), ['o', 'bei bi'],
    'Apple word-timed background romanization must remove one split outer pair');
  assert.deepEqual(splitRomanParentheses.romanTokens, originalRomanTokens,
    'display cleanup must not mutate structured Apple romanization tokens');

  const separatePhrases = model.toAmllLine({
    t:4,
    duration:1,
    text:'(foo) (bar)',
    transText:'（甲）（乙）',
    romanText:'(foo) (bar)',
    source:'apple-ttml-line',
    isBG:true,
  }, settings, 'apple-ttml-line');
  assert.equal(separatePhrases.words[0].word, '(foo) (bar)',
    'separate parenthesized phrases must not be mistaken for one sentence wrapper');
  assert.equal(separatePhrases.translatedLyric, '（甲）（乙）');
  assert.equal(separatePhrases.romanLyric, '(foo) (bar)');

  const qqBackground = model.toAmllLine({
    t:5,
    duration:1,
    text:'(oh)',
    transText:'（哦）',
    isBG:true,
  }, settings, 'lrc-line');
  assert.equal(qqBackground.words[0].word, '(oh)',
    'background-vocal wrapper cleanup must remain Apple-source-only');
  assert.equal(qqBackground.translatedLyric, '（哦）');
}

function verifyAppleMusicPresentationState() {
  const shortGap = [{
    startTime:1000,
    endTime:3000,
  }, {
    startTime:2500,
    endTime:3400,
    isBG:true,
  }, {
    startTime:4000,
    endTime:5000,
  }, {
    startTime:6000,
    endTime:7000,
  }];
  const held = model.presentationGroupState(shortGap, 3500);
  assert.deepEqual(held.states, ['current', 'future', 'future']);
  assert.equal(held.currentGroup, 0);
  assert.equal(held.groups[0].sourceEndTime, 3000,
    'AMLL native interlude timing must use the foreground line end, not the background vocal end');
  assert.equal(held.groups[0].presentationEndTime, 4000,
    'a short blank must retain the completed foreground group until the next foreground line');
  assert.equal(held.interlude, false);

  const advanced = model.presentationGroupState(shortGap, 4000);
  assert.deepEqual(advanced.states, ['past', 'current', 'future']);
  assert.equal(advanced.currentGroup, 1,
    'a background vocal must not create its own presentation group');

  const lastFinished = model.presentationGroupState(shortGap, 7100);
  assert.deepEqual(lastFinished.states, ['past', 'past', 'past']);
  assert.equal(lastFinished.currentGroup, -1,
    'the final lyric must become past at its own source end');

  const longInterlude = model.presentationGroupState([{
    startTime:1000,
    endTime:3000,
  }, {
    startTime:8000,
    endTime:9000,
  }], 3500);
  assert.equal(longInterlude.interlude, true);
  assert.deepEqual(longInterlude.states, ['past', 'future']);
  assert.equal(longInterlude.groups[0].presentationEndTime, 3000,
    'a native AMLL interlude must not retain the previous lyric as current');

  const backgroundDoesNotSuppressInterlude = model.presentationGroupState([{
    startTime:1000,
    endTime:3000,
  }, {
    startTime:2500,
    endTime:6000,
    isBG:true,
  }, {
    startTime:10000,
    endTime:11000,
  }], 3500);
  assert.equal(backgroundDoesNotSuppressInterlude.interlude, true);
  assert.deepEqual(backgroundDoesNotSuppressInterlude.states, ['past', 'future'],
    'background vocal duration must not suppress AMLL native interlude dots');

  const orphanBackground = model.presentationGroupState([{
    startTime:500,
    endTime:1500,
    isBG:true,
  }, {
    startTime:2000,
    endTime:3000,
  }], 1000);
  assert.deepEqual(orphanBackground.states, ['future']);
  assert.equal(orphanBackground.currentGroup, -1,
    'an orphan background vocal must never own the current presentation state');

  const overlappingMain = model.presentationGroupState([{
    startTime:1000,
    endTime:5000,
    mineradioSource:'apple-ttml-word',
    mineradioNativeWordTiming:true,
  }, {
    startTime:4000,
    endTime:6000,
    mineradioSource:'apple-ttml-word',
    mineradioNativeWordTiming:true,
  }], 4500, { advanceWordLines:true });
  assert.deepEqual(overlappingMain.states, ['current', 'current']);
  assert.deepEqual(overlappingMain.currentGroups, [0, 1],
    'overlapping Apple foreground lyrics must remain concurrently active');
  assert.equal(overlappingMain.currentGroup, 1,
    'the newest active Apple lyric must remain the playback-current line');
  assert.equal(overlappingMain.anchorGroup, 0,
    'the first Apple overlap line must keep the scrolling anchor');
  assert.equal(overlappingMain.groups[0].presentationEndTime, 6000,
    'an Apple overlap must hold the previous foreground lyric until the later-starting line ends');
  assert.equal(overlappingMain.groups[0].sourceEndTime, 5000,
    'holding an Apple overlap must preserve the previous foreground lyric source end');
  assert.equal(overlappingMain.groups[0].advance, null,
    'an Apple overlap must never create an early line-advance plan');

  const firstFinishedOverlap = model.presentationGroupState([{
    startTime:1000,
    endTime:5000,
    mineradioSource:'apple-ttml-word',
  }, {
    startTime:4000,
    endTime:6000,
    mineradioSource:'apple-ttml-word',
  }], 5500);
  assert.deepEqual(firstFinishedOverlap.states, ['current', 'current'],
    'a completed first Apple overlap line must stay highlighted until the later line ends');
  assert.deepEqual(firstFinishedOverlap.currentGroups, [0, 1]);
  assert.equal(firstFinishedOverlap.anchorGroup, 0);

  const releasedOverlap = model.presentationGroupState([{
    startTime:1000,
    endTime:5000,
    mineradioSource:'apple-ttml-word',
  }, {
    startTime:4000,
    endTime:6000,
    mineradioSource:'apple-ttml-word',
  }, {
    startTime:7000,
    endTime:8000,
    mineradioSource:'apple-ttml-word',
  }], 6000);
  assert.deepEqual(releasedOverlap.states, ['past', 'past', 'future'],
    'all Apple overlap lines must become past together when the later-starting line ends');
  assert.equal(releasedOverlap.anchorGroup, 2,
    'a released Apple overlap must move the layout anchor to the following line');

  const chainedOverlap = model.presentationGroupState([{
    startTime:1000,
    endTime:5000,
    mineradioSource:'apple-ttml-word',
  }, {
    startTime:3500,
    endTime:6500,
    mineradioSource:'apple-ttml-word',
  }, {
    startTime:4200,
    endTime:7000,
    mineradioSource:'apple-ttml-line',
  }], 4500);
  assert.deepEqual(chainedOverlap.states, ['current', 'current', 'current']);
  assert.deepEqual(chainedOverlap.currentGroups, [0, 1, 2]);
  assert.equal(chainedOverlap.currentGroup, 2);
  assert.equal(chainedOverlap.anchorGroup, 0,
    'a chained Apple overlap must retain the first line as its layout anchor');

  const cappedOverlapLines = [
    [1000, 10000],
    [2000, 9000],
    [3000, 8000],
    [4000, 7000],
    [5000, 8000],
    [6000, 9000],
  ].map(([startTime, endTime]) => ({
    startTime,
    endTime,
    mineradioSource:'apple-ttml-word',
  }));
  const cappedBeforeFourth = model.presentationGroupState(cappedOverlapLines, 3999);
  assert.deepEqual(cappedBeforeFourth.currentGroups, [0, 1, 2],
    'Apple TTML must allow at most the first three foreground overlap lines before line four starts');
  assert.equal(cappedBeforeFourth.anchorGroup, 0);
  const cappedAtFourth = model.presentationGroupState(cappedOverlapLines, 4000);
  assert.deepEqual(cappedAtFourth.states.slice(0, 4), ['past', 'past', 'past', 'current'],
    'the fourth Apple overlap line must release the previous three at its real source start');
  assert.deepEqual(cappedAtFourth.currentGroups, [3]);
  assert.equal(cappedAtFourth.anchorGroup, 3,
    'the fourth Apple overlap line must become the first anchor of the next overlap group');
  const cappedSecondGroup = model.presentationGroupState(cappedOverlapLines, 6500);
  assert.deepEqual(cappedSecondGroup.currentGroups, [3, 4, 5],
    'the next Apple overlap group may independently contain lines four through six');
  assert.equal(cappedSecondGroup.anchorGroup, 3);
  assert(cappedSecondGroup.currentGroups.length <= 3,
    'Apple TTML must never expose more than three concurrent foreground highlight lines');

  const reverseEndOverlap = model.presentationGroupState([{
    startTime:1000,
    endTime:7000,
    mineradioSource:'apple-ttml-word',
  }, {
    startTime:4000,
    endTime:5000,
    mineradioSource:'apple-ttml-word',
  }], 5000);
  assert.deepEqual(reverseEndOverlap.states, ['past', 'past'],
    'the later-starting Apple line must release the group even when an earlier source line is longer');
  assert.equal(reverseEndOverlap.anchorGroup, 2,
    'a final released overlap must anchor the AMLL bottom slot');
}

function verifyWordAdvancePresentation() {
  const qrcLine = (startTime, endTime, words, extra = {}) => ({
    startTime,
    endTime,
    words,
    mineradioReliableQrc:true,
    ...extra,
  });
  const options = { advanceWordLines:true };

  const seamless = [
    qrcLine(1000, 3000, [
      { word:'All ', startTime:1000, endTime:2000 },
      { word:'mine', startTime:2000, endTime:3000 },
    ]),
    qrcLine(3000, 4200, [
      { word:'Next', startTime:3000, endTime:4200 },
    ]),
  ];
  const seamlessFilling = model.presentationGroupState(seamless, 2120, options);
  assert.equal(seamlessFilling.groups[0].advance.mode, 'finish');
  assert.equal(seamlessFilling.groups[0].advance.transitionStartTime, 2040);
  assert.equal(seamlessFilling.groups[0].presentationEndTime, 2200);
  assert.equal(seamlessFilling.groups[1].presentationStartTime, 2200);
  assert.deepEqual(seamlessFilling.states, ['current', 'future']);
  assert.deepEqual(model.wordAdvanceEffect(seamlessFilling.groups[0], 2120), {
    mode:'finish',
    wordTime:2520,
    frozen:false,
  });

  const seamlessSwitched = model.presentationGroupState(seamless, 2210, options);
  assert.deepEqual(seamlessSwitched.states, ['past', 'current']);
  assert.equal(seamlessSwitched.currentGroup, 1);
  assert.equal(seamlessSwitched.earlyCurrentGroup, 1);
  assert.deepEqual(model.wordAdvanceEffect(seamlessSwitched.groups[0], 2210), {
    mode:'finish',
    wordTime:3000,
    frozen:true,
  });

  const lateTailWord = [
    qrcLine(1000, 3000, [
      { word:'Lead ', startTime:1000, endTime:2700 },
      { word:'in', startTime:2700, endTime:3000 },
    ]),
    qrcLine(3000, 4200, [{ word:'Next', startTime:3000, endTime:4200 }]),
  ];
  const lateTailState = model.presentationGroupState(lateTailWord, 2210, options);
  assert.equal(lateTailState.groups[0].advance.transitionStartTime, 2040,
    'a late-starting tail word must not postpone the fixed 960ms finish window');
  assert.equal(lateTailState.groups[0].advance.switchTime, 2200,
    'a late-starting tail word must still hand off exactly 800ms early');
  assert.deepEqual(lateTailState.states, ['past', 'current']);

  const shortPositiveGap = [
    qrcLine(1000, 3000, [{ word:'Done', startTime:2000, endTime:3000 }]),
    qrcLine(3300, 4300, [{ word:'Soon', startTime:3300, endTime:4300 }]),
  ];
  const positiveGapState = model.presentationGroupState(shortPositiveGap, 2420, options);
  assert.deepEqual(model.wordAdvanceEffect(positiveGapState.groups[0], 2420), {
    mode:'finish',
    wordTime:2670,
    frozen:false,
  }, 'accelerated completion must never move a word behind its source-file progress');

  const ordinaryGap = [
    qrcLine(1000, 3000, [
      { word:'Hold ', startTime:1000, endTime:2000 },
      { word:'me', startTime:2000, endTime:3000 },
    ]),
    qrcLine(4000, 5000, [
      { word:'Now', startTime:4000, endTime:5000 },
    ]),
  ];
  const ordinaryAccelerating = model.presentationGroupState(ordinaryGap, 3100, options);
  assert.equal(ordinaryAccelerating.groups[0].advance.mode, 'finish');
  assert.equal(ordinaryAccelerating.groups[0].advance.transitionStartTime, 3040);
  assert.equal(ordinaryAccelerating.groups[0].presentationEndTime, 3200);
  assert.equal(ordinaryAccelerating.groups[1].presentationStartTime, 3200);
  assert.deepEqual(ordinaryAccelerating.states, ['current', 'future']);
  assert.deepEqual(model.wordAdvanceEffect(ordinaryAccelerating.groups[0], 3100), {
    mode:'finish',
    wordTime:3000,
    frozen:false,
  });
  const ordinarySwitched = model.presentationGroupState(ordinaryGap, 3210, options);
  assert.deepEqual(ordinarySwitched.states, ['past', 'current'],
    'a reliable QQ QRC gap must use the fixed 800ms layout takeover');

  const punctuationTail = [
    qrcLine(1000, 3000, [
      { word:'Oh', startTime:2000, endTime:2800 },
      { word:'… ', startTime:2800, endTime:3000 },
    ]),
    qrcLine(4000, 5000, [{ word:'Again', startTime:4000, endTime:5000 }]),
  ];
  const punctuationState = model.presentationGroupState(punctuationTail, 3100, options);
  assert.equal(punctuationState.groups[0].advance.lastWordText, 'Oh');
  assert.equal(punctuationState.groups[0].presentationEndTime, 3200,
    'pure punctuation must not become the accelerated completion anchor');

  const nativeInterlude = model.presentationGroupState([
    qrcLine(1000, 3000, [{ word:'Wait', startTime:2000, endTime:3000 }]),
    qrcLine(8000, 9000, [{ word:'Return', startTime:8000, endTime:9000 }]),
  ], 3500, options);
  assert.equal(nativeInterlude.groups[0].advance, null);
  assert.equal(nativeInterlude.groups[0].presentationEndTime, 3000);
  assert.equal(nativeInterlude.groups[1].presentationStartTime, 8000);
  assert.equal(nativeInterlude.interlude, true);

  const overlap = model.presentationGroupState([
    qrcLine(1000, 3000, [{ word:'One', startTime:2000, endTime:3000 }]),
    qrcLine(2900, 4000, [{ word:'Two', startTime:2900, endTime:4000 }]),
  ], 2850, options);
  assert.equal(overlap.groups[0].advance, null);
  assert.equal(overlap.groups[0].presentationEndTime, 2900);

  const lineOnly = model.presentationGroupState([{
    startTime:1000,
    endTime:3000,
    words:[{ word:'line only', startTime:1000, endTime:1000 }],
    mineradioReliableQrc:false,
  }, qrcLine(4000, 5000, [{ word:'Next', startTime:4000, endTime:5000 }])], 3500, options);
  assert.equal(lineOnly.groups[0].advance, null);
  assert.equal(lineOnly.groups[0].presentationEndTime, 4000,
    'line-only lyrics must keep the existing presentation timing');

  const disabled = model.presentationGroupState(ordinaryGap, 2950, { advanceWordLines:false });
  assert.equal(disabled.groups[0].advance, null);
  assert.deepEqual(disabled.states, ['current', 'future']);

  const finalLine = model.presentationGroupState([
    qrcLine(1000, 3000, [{ word:'Final', startTime:2000, endTime:3000 }]),
  ], 3100, options);
  assert.equal(finalLine.groups[0].advance, null);
  assert.deepEqual(finalLine.states, ['past']);

  const appleLine = (startTime, endTime, words, source = 'apple-ttml-word') => ({
    startTime,
    endTime,
    words:words || [{ word:'Apple', startTime, endTime }],
    mineradioSource:source,
    mineradioNativeWordTiming:source === 'apple-ttml-word',
    mineradioReliableQrc:false,
  });
  const appleLargeGap = [
    appleLine(1000, 3000, [{ word:'Hold', startTime:1000, endTime:3000 }]),
    appleLine(4000, 5000, [{ word:'Next', startTime:4000, endTime:5000 }]),
  ];
  const appleHolding = model.presentationGroupState(appleLargeGap, 3100, options);
  assert.equal(appleHolding.groups[0].advance.mode, 'hold');
  assert.equal(appleHolding.groups[0].advance.switchTime, 3200,
    'an Apple blank over 800ms must hand off up to 800ms before the next source start');
  assert.equal(appleHolding.groups[0].presentationEndTime, 3200);
  assert.equal(appleHolding.groups[1].presentationStartTime, 3200);
  assert.deepEqual(appleHolding.states, ['current', 'future'],
    'a completed Apple lyric must remain current until the 800ms handoff');
  assert.equal(model.wordAdvanceEffect(appleHolding.groups[0], 3150), null,
    'the Apple large-gap handoff must never accelerate or interrupt the completed word mask');
  const appleHandedOff = model.presentationGroupState(appleLargeGap, 3210, options);
  assert.deepEqual(appleHandedOff.states, ['past', 'current']);
  assert.equal(appleHandedOff.earlyCurrentGroup, 1,
    'the incoming Apple lyric must remain frozen until its real source start');

  const appleExactBoundary = model.presentationGroupState([
    appleLine(1000, 3000),
    appleLine(3800, 4800),
  ], 3500, options);
  assert.equal(appleExactBoundary.groups[0].advance, null,
    'exactly 800ms must retain the existing close-gap presentation behavior');
  assert.equal(appleExactBoundary.groups[0].presentationEndTime, 3800);

  const appleLineOnly = model.presentationGroupState([
    appleLine(1000, 3000, null, 'apple-ttml-line'),
    appleLine(4100, 5100, null, 'apple-ttml-line'),
  ], 3600, options);
  assert.equal(appleLineOnly.groups[0].advance.mode, 'hold',
    'Apple line-timed TTML must use the same natural-completion handoff');
  assert.equal(appleLineOnly.groups[0].advance.switchTime, 3300);

  const appleDisabled = model.presentationGroupState(appleLargeGap, 3660, { advanceWordLines:false });
  assert.equal(appleDisabled.groups[0].advance, null);
  assert.deepEqual(appleDisabled.states, ['current', 'future']);

  const appleMicroOverlap = [
    appleLine(1000, 5099, [
      { word:'Almost ', startTime:1000, endTime:4000 },
      { word:'done', startTime:4000, endTime:5099 },
    ]),
    appleLine(5000, 6000, [{ word:'Next', startTime:5000, endTime:6000 }]),
  ];
  const appleMicroPlan = model.presentationGroupState(appleMicroOverlap, 4120, options);
  assert.equal(appleMicroPlan.groups[0].advance.mode, 'finish',
    'a 99ms Apple overlap must use the seamless word-finish plan when line advance is enabled');
  assert.equal(appleMicroPlan.groups[0].advance.transitionStartTime, 4040);
  assert.equal(appleMicroPlan.groups[0].advance.switchTime, 4200);
  assert.equal(appleMicroPlan.groups[0].presentationEndTime, 4200);
  assert.equal(appleMicroPlan.groups[1].presentationStartTime, 4200);
  const appleMicroEffect = model.wordAdvanceEffect(appleMicroPlan.groups[0], 4120);
  assert(appleMicroEffect && appleMicroEffect.mode === 'finish'
    && appleMicroEffect.wordTime > 4120 && appleMicroEffect.wordTime < 5099,
  'a 99ms Apple overlap must visibly accelerate the outgoing final word');
  const appleMicroHandedOff = model.presentationGroupState(appleMicroOverlap, 4210, options);
  assert.deepEqual(appleMicroHandedOff.states, ['past', 'current']);
  assert.equal(appleMicroHandedOff.earlyCurrentGroup, 1,
    'the next Apple micro-overlap line must remain frozen until its real source start');

  const appleExactOverlap = model.presentationGroupState([
    appleLine(1000, 5100),
    appleLine(5000, 6000),
  ], 5050, options);
  assert.deepEqual(appleExactOverlap.currentGroups, [0, 1],
    'an exact 100ms Apple overlap must remain a true concurrent overlap');
  assert.equal(appleExactOverlap.groups[0].advance, null);

  const appleMicroDisabled = model.presentationGroupState(appleMicroOverlap, 5050, {
    advanceWordLines:false,
  });
  assert.deepEqual(appleMicroDisabled.currentGroups, [0, 1],
    'a 99ms Apple overlap must preserve the source timeline when line advance is disabled');
  assert.equal(appleMicroDisabled.groups[0].advance, null);

  const appleMicroLineTimed = model.presentationGroupState([
    appleLine(1000, 5099, [], 'apple-ttml-line'),
    appleLine(5000, 6000, [], 'apple-ttml-line'),
  ], 4480, options);
  assert.equal(appleMicroLineTimed.groups[0].advance.mode, 'hold',
    'line-timed Apple micro-overlaps may hand off layout but must not fabricate word timing');
  assert.equal(model.wordAdvanceEffect(appleMicroLineTimed.groups[0], 4500), null);

  const appleMicroAfterCluster = model.presentationGroupState([
    appleLine(1000, 6000),
    appleLine(3000, 5099, [{ word:'Tail', startTime:3000, endTime:5099 }]),
    appleLine(5000, 6500),
  ], 4570, options);
  assert.deepEqual(appleMicroAfterCluster.states, ['past', 'past', 'current'],
    'a micro-overlap after a true overlap group must release the entire outgoing group at handoff');
  assert.equal(appleMicroAfterCluster.groups[0].appleOverlapCluster.releaseTime, 4200);
  assert.equal(appleMicroAfterCluster.earlyCurrentGroup, 2);

  const appleMicroAfterCappedCluster = [
    appleLine(1000, 10000),
    appleLine(2000, 9000),
    appleLine(3000, 8000),
    appleLine(4000, 4299, [{ word:'Fourth', startTime:4000, endTime:4299 }]),
    appleLine(4200, 5200),
  ];
  const cappedClusterBeforeFourth = model.presentationGroupState(
    appleMicroAfterCappedCluster,
    3999,
    options
  );
  assert.deepEqual(cappedClusterBeforeFourth.currentGroups, [0, 1, 2],
    'a following micro-overlap must not release a capped cluster before line four starts');
  const cappedClusterAtFourth = model.presentationGroupState(
    appleMicroAfterCappedCluster,
    4000,
    options
  );
  assert.deepEqual(cappedClusterAtFourth.currentGroups, [3],
    'line four must become the next anchor before its own micro-overlap can hand off');
  assert.equal(cappedClusterAtFourth.anchorGroup, 3);
  assert.equal(cappedClusterAtFourth.groups[3].advance.switchTime, 4200,
    'a micro-overlap handoff must not skip an outgoing line whose real start follows the normal lead');
  const cappedClusterAtFifth = model.presentationGroupState(
    appleMicroAfterCappedCluster,
    4200,
    options
  );
  assert.deepEqual(cappedClusterAtFifth.currentGroups, [4]);
  assert(cappedClusterBeforeFourth.currentGroups.length <= 3
    && cappedClusterAtFourth.currentGroups.length <= 3
    && cappedClusterAtFifth.currentGroups.length <= 3,
  'a capped cluster followed by a micro-overlap must never expose four current lines');

  const appleInterlude = model.presentationGroupState([
    appleLine(1000, 3000),
    appleLine(9000, 10000),
  ], 3650, options);
  assert.equal(appleInterlude.groups[0].advance, null,
    'AMLL native interludes must remain the sole owner of long Apple blanks');
  assert.equal(appleInterlude.interlude, true);
}

function verifyStaticContract() {
  const root = path.resolve(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'public', 'js', 'apple-music-lyrics-beta.js'), 'utf8');
  const appRuntime = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'css', 'apple-music-lyrics-beta.css'), 'utf8');
  const amllVendor = fs.readFileSync(path.join(root, 'public', 'vendor', 'amll-core.bundle.js'), 'utf8');
  const amllSource = fs.readFileSync(path.join(
    root, 'node_modules', '@applemusic-like-lyrics', 'core', 'dist', 'amll-core.mjs'
  ), 'utf8');
  const patchedAmllSource = patchAmllCoreSource(amllSource);
  const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-amll-vendor.js'), 'utf8');
  const syncScript = fs.readFileSync(path.join(root, 'scripts', 'sync-amll-runtime.js'), 'utf8');
  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(index, /id="apple-music-lyrics-beta-stage"/);
  assert.match(index, /id="apple-music-lyrics-beta-settings"/);
  assert.match(index, /Apple 小于 100ms 的轻微重叠会提前 800ms 接续/,
    'the Beta settings copy must describe Apple micro-overlap line advance');
  assert.match(index, /amll-core\.bundle\.js/);
  assert(index.indexOf('js/lyric-credit-filter.js') < index.indexOf('js/app.js'),
    'the production lyric credit filter must load before the renderer uses it');
  assert.match(runtime, /cleanUnintentionalOverlaps:\s*false/);
  assert.match(runtime, /tryAdvanceStartTime:\s*false/);
  assert.match(runtime, /setCurrentTime\(timeMs,\s*seek/);
  assert.doesNotMatch(runtime, /getLyricBreathDotState|data-mineradio-interlude|apple-music-lyrics-beta-interlude/,
    'Beta lyrics must let AMLL Core own interlude detection and animation');
  assert.doesNotMatch(index, /id="apple-music-lyrics-beta-interlude"/,
    'The removed Mineradio interlude overlay must not remain in the stage');
  assert.doesNotMatch(styles, /\.FmKaba_interludeDots\s*\{[^}]*display:\s*none/s,
    'AMLL Core native interlude dots must remain visible');
  const staticShadowGuard = styles.match(/([^{}]*\.FmKaba_lyricMainLine[^{}]*\.FmKaba_lyricSubLine:nth-child\(3\)[^{}]*\.FmKaba_lyricSubLine:nth-child\(2\)[^{}]*\.FmKaba_romanWord[^{}]*)\{([^}]*)\}/s);
  assert(staticShadowGuard, 'Original, romanization and translation selectors must share one static-shadow guard');
  assert.match(staticShadowGuard[2], /text-shadow:\s*none\s*!important/,
    'Original, romanization and translation layers must forcibly suppress persistent vendor text glow');
  assert.doesNotMatch(styles, /\.FmKaba_emphasize[^}]*\{[^}]*drop-shadow/s,
    'Mineradio CSS must not turn AMLL emphasis words into a persistent glow');
  assert.match(amllVendor, /initEmphasizeAnimation/);
  assert.match(amllVendor, /textShadow:/,
    'AMLL timeline-driven emphasis glow must remain available after persistent shadows are removed');
  assert.match(buildScript, /mineradio-amll-runtime-patch/,
    'the reproducible AMLL vendor build must apply the checked local runtime patch');
  assert.match(patchedAmllSource, /mineradio-amll-source-motion/,
    'the local AMLL patch must create a source-only motion layer for Korean romanized words');
  assert.match(patchedAmllSource, /word\.maskFadeHeight \|\| word\.height/,
    'the local AMLL patch must measure fade width independently of romanization height');
  assert.match(amllVendor, /mineradio-amll-source-motion/,
    'the checked vendor bundle must contain the source-only motion layer patch');
  assert.match(syncScript, /public['"],\s*['"]vendor['"],\s*['"]amll-core\.bundle\.js/,
    'runtime synchronization must copy the patched AMLL vendor bundle');
  assert.match(syncScript, /public['"],\s*['"]js['"],\s*['"]app\.js/,
    'runtime synchronization must copy the host lyric source-policy fix');
  assert.match(notices, /scripts\/patch-amll-core-source\.js/,
    'third-party notices must disclose the checked AMLL Core source patch');
  assert.match(notices, /npm run build:amll/,
    'third-party notices must document how to rebuild the patched AMLL bundle');
  assert.match(styles, /\.mineradio-amll-source-motion\s*\{[^}]*flex-flow:\s*row nowrap/s,
    'the source motion layer must keep original glyphs in one horizontal run');
  assert.match(runtime, /desktopWindow\.onStateChange/);
  assert.match(runtime, /effectiveSourcePolicyKey\(settings\)\s*!==\s*previousSourcePolicy/,
    'AMLL setting changes must reload lyrics only when the effective provider policy changes');
  const resetHandler = runtime.match(
    /if \(reset\) reset\.addEventListener\('click', function\(\) \{([\s\S]*?)\n\s*\}\);/
  );
  assert(resetHandler, 'the AMLL restore-defaults handler must remain available');
  assert.match(resetHandler[1], /effectiveSourcePolicyKey\(settings\)\s*!==\s*previousSourcePolicy/,
    'restoring visual defaults must not reload lyrics unless the effective provider policy changes');
  assert.match(runtime, /stage\.inert\s*=\s*!active/,
    'the inactive AMLL stage must synchronously release pointer and focus ownership');
  assert.match(runtime, /getAnimations\(\{\s*subtree:true\s*\}\)/,
    'disposing AMLL must cancel descendant animations before removing the player');
  const policyReload = appRuntime.match(
    /async function reloadCurrentLyricForSourcePolicy\(\)\s*\{([\s\S]*?)\n\}/
  );
  assert(policyReload, 'the lyric source-policy reload entry point must remain available');
  assert.doesNotMatch(policyReload[1], /beginLyricTrackSwitch\(/,
    'same-track source-policy reloads must not clear visible lyrics before networking');
  assert.match(policyReload[1], /preserveVisibleLyrics:\s*true/,
    'same-track source-policy reloads must preserve the current lyric on empty or failed results');
  assert.match(runtime, /snap:\s*snapToPlaybackTime/,
    'the host playback controls must be able to snap AMLL directly after an explicit seek');
  assert.match(appRuntime, /MineradioAppleMusicLyrics\.snap\(\)/,
    'the shared lyric resample path must snap AMLL instead of relying on frame-delta heuristics');
  assert.match(runtime, /data-mineradio-line-state/,
    'Mineradio must expose the agreed current, past and future presentation states');
  assert.match(runtime, /setMaskAnimationState/,
    'QRC visual-time overrides must use the AMLL public mask clock API');
  assert.match(runtime, /animations\.reduce\(function\(longest, animation\)/,
    'background-vocal clock drift detection must use the longest line animation');
  assert.doesNotMatch(runtime, /splittedWords|maskAnimations|elementAnimations/,
    'Mineradio must not reach into AMLL private word-animation arrays');
  assert.match(index, /data-amll-setting="wordAdvanceEnabled"/);
  assert.match(index, />逐字歌词提前换行</);
  [
    'currentOriginalOpacity',
    'nonCurrentOriginalOpacity',
    'currentTranslationOpacity',
    'nonCurrentTranslationOpacity',
    'currentRomanizationOpacity',
    'nonCurrentRomanizationOpacity',
    'unplayedWordOpacity',
    'backgroundVocalOpacity',
  ].forEach(setting => {
    assert.doesNotMatch(index, new RegExp(`data-amll-setting="${setting}"`),
      `AMLL settings must not expose removed opacity control ${setting}`);
  });
  assert.doesNotMatch(index, /data-amll-setting="(?:translationOpacity|romanizationOpacity)"/,
    'the ambiguous legacy opacity sliders must not remain visible');
  assert.match(styles, /data-mineradio-line-state="current"[^}]*\.mineradio-amll-original-run[^}]*\{[^}]*opacity:\s*1\s*!important/s,
    'current original runs must remain fully opaque before the word mask');
  assert.match(styles, /data-mineradio-line-state="(?:past|future)"[^}]*\.mineradio-amll-original-run[^}]*\{[^}]*opacity:\s*\.58\s*!important/s,
    'past and future original runs must use the fixed fifty-eight-percent opacity');
  assert.match(styles, /data-mineradio-line-state="current"[^}]*\.FmKaba_lyricSubLine:nth-child\(2\)[^}]*\{[^}]*opacity:\s*\.78\s*!important/s,
    'current translations must use the fixed seventy-eight-percent opacity');
  assert.match(styles, /data-mineradio-line-state="(?:past|future)"[^}]*\.FmKaba_lyricSubLine:nth-child\(2\)[^}]*\{[^}]*opacity:\s*\.58\s*!important/s,
    'past and future translations must use the fixed fifty-eight-percent opacity');
  assert.match(styles, /data-mineradio-line-state="current"[^}]*\.FmKaba_romanWord[^}]*\{[^}]*opacity:\s*1\s*!important/s,
    'current embedded romanization must remain fully opaque before the word mask');
  assert.match(styles, /data-mineradio-line-state="(?:past|future)"[^}]*\.FmKaba_romanWord[^}]*\{[^}]*opacity:\s*\.58\s*!important/s,
    'past and future embedded romanization must use the fixed fifty-eight-percent opacity');
  assert.match(styles, /\.mineradio-amll-latin-run\s*\{[^}]*letter-spacing:\s*\.02em/s,
    'Translation and romanization Latin runs must retain the agreed slight tracking');
  assert.match(styles,
    /\.FmKaba_lyricMainLine\s+\.mineradio-amll-original-run\.mineradio-amll-latin-run\s*\{[^}]*letter-spacing:\s*\.01em/s,
    'Latin runs in the scrolling original lyric must use the tighter tracking');
  assert.match(styles, /\.FmKaba_lyricBgLine\s*\{[^}]*opacity:\s*1\s*!important/s,
    'background vocals must not be multiplied by a line-level opacity');
  const wrapperTransition = styles.match(
    /\.mineradio-amll-player\s+\.FmKaba_lyricLineWrapper\s*\{([^}]*)\}/s
  );
  assert(wrapperTransition, 'AMLL wrapper transition contract must exist');
  assert.doesNotMatch(wrapperTransition[1], /\bopacity\b/,
    'a CSS opacity transition must not override AMLL state opacity during rolling updates');
  assert.doesNotMatch(styles, /--amll-beta-past-translation-opacity|\.225/,
    'the old fixed thirty-percent past-translation rule must be removed');
  assert.doesNotMatch(runtime, /translationOpacity\s*\*\s*0\.3|--amll-beta-past-translation-opacity/,
    'runtime settings must never recreate the old thirty-percent multiplier');
  assert.doesNotMatch(runtime, /--amll-beta-(?:translation|roman)-line-opacity/,
    'playback frames must not rewrite sub-lyric opacity settings onto individual wrappers');
  assert.match(runtime, /mineradio-amll-original-run/,
    'runtime must mark original text runs so embedded QRC romanization stays independent');
  assert.match(runtime, /window\.seekPlaybackToSeconds\(targetMs\s*\/\s*1000/,
    'AMLL line clicks must use the shared playback seek interface');
  assert.doesNotMatch(runtime, /spotifyApi\(['"]\/me\/player\/seek/,
    'AMLL must not duplicate Spotify seek transport or clock reconciliation');
  assert.match(runtime, /mineradio-amll-latin-run/,
    'runtime must mark Latin text without changing CJK tracking');
  assert.match(styles, /\.mineradio-amll-roman-wrapped\s*\{[^}]*line-height:\s*1\.32/s,
    'Wrapped QRC romanization rows must receive the agreed internal line spacing');
  assert.match(styles, /\.FmKaba_lyricSubLine:nth-child\(2\)\s*\{[^}]*margin-top:\s*\.24em/s,
    'Translations must be shifted down by the agreed amount');
  assert.match(styles, /\.FmKaba_lyricSubLine:nth-child\(2\)\s*\{[^}]*transition:\s*none\s*!important/s,
    'Translation opacity must not be trapped at the vendor transition start value during playback');
  assert.match(styles, /\.FmKaba_lyricSubLine:nth-child\(3\)\s*\{[^}]*transition:\s*none\s*!important/s,
    'Romanization sub-line opacity must not be trapped at the vendor transition start value');
  assert.match(styles, /\.FmKaba_romanWord\s*\{[^}]*transition:\s*none\s*!important/s,
    'Embedded QRC romanization opacity must not be trapped at the vendor transition start value');
  assert.match(styles, /\.FmKaba_lyricMainLine\.FmKaba_active\s*\{[^}]*--bright-mask-alpha:\s*1\s*!important[^}]*--dark-mask-alpha:\s*\.58\s*!important/s,
    'The current foreground karaoke mask must use fixed one-hundred/fifty-eight-percent alpha');
  assert.match(styles, /\.FmKaba_lyricBgLine[^}]*\.FmKaba_lyricMainLine\.FmKaba_active\s*\{[^}]*--bright-mask-alpha:\s*\.68\s*!important[^}]*--dark-mask-alpha:\s*\.48\s*!important/s,
    'Background karaoke must use fixed sixty-eight/forty-eight-percent alpha');
  assert.doesNotMatch(runtime, /--amll-beta-(?:current|non-current|unplayed-word|bg)-[^'"\s)]+opacity/,
    'runtime must stop injecting configurable lyric opacity variables');
  assert.doesNotMatch(runtime, /--amll-beta-inactive-opacity/,
    'The removed global inactive-opacity setting must not return');
  assert.doesNotMatch(index, /data-amll-setting="inactiveOpacity"/,
    'The removed custom opacity setting must not remain as a dead control');
  assert.match(runtime, /settings\s*=\s*Model\.normalizeSettings\(Model\.DEFAULT_SETTINGS\)/,
    'Resetting AMLL settings must continue to restore the remaining settings');
  assert.match(index, />歌词模糊</,
    'The retained blur-only setting must use the agreed label');
  assert.match(notices, /@applemusic-like-lyrics\/core/);
  assert.match(notices, /AGPL-3\.0-only/);
}

verifySettings();
verifyReliableQrcConversion();
verifyAppleKoreanLexicalTiming();
verifyLineOnlyDegrade();
verifyDuetMetadata();
verifyAppleBackgroundVocalDisplayText();
verifyAppleMusicPresentationState();
verifyWordAdvancePresentation();
verifyStaticContract();
console.log('Apple Music lyrics beta verification passed.');
