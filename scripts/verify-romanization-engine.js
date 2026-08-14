const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { RomanizationEngine, loadRomanizationOverrides } = require('../romanization-engine');

async function verifyKoreanWordSlotsReuseSourceTiming() {
  const engine = new RomanizationEngine();
  const result = await engine.romanizeLines([
    {
      t: 0,
      text: '널 부를래 Baby',
      source: 'qrc-word',
      nativeQqKaraoke: true,
      karaokeTimeline: [
        { text:'널', start:0, duration:.6, c0:0, c1:1, timed:true },
        { text:'부', start:.6, duration:.3, c0:2, c1:3, timed:true },
        { text:'를', start:.9, duration:.3, c0:3, c1:4, timed:true },
        { text:'래', start:1.2, duration:.4, c0:4, c1:5, timed:true },
        { text:'Baby', start:1.6, duration:.8, c0:6, c1:10, timed:true },
      ],
    },
  ]);

  assert.equal(result.language, 'ko');
  assert.equal(result.engineVersion, '2');
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.processedLineIndexes, [0]);
  assert.equal(result.lines[0].text, 'neol bu reul rae Baby');
  assert.deepEqual(result.lines[0].tokens.map((token) => ({
    sourceText:token.sourceText,
    romanized:token.romanized,
    c0:token.c0,
    c1:token.c1,
    sourceNodeIndexes:token.sourceNodeIndexes,
  })), [
    { sourceText:'널', romanized:'neol', c0:0, c1:1, sourceNodeIndexes:[0] },
    { sourceText:'부를래', romanized:'bu reul rae', c0:2, c1:5, sourceNodeIndexes:[1, 2, 3] },
    { sourceText:'Baby', romanized:'Baby', c0:6, c1:10, sourceNodeIndexes:[4] },
  ]);
}

async function verifyPureEnglishLinesDoNotCreateRomanizationRows() {
  const engine = new RomanizationEngine();
  const result = await engine.romanizeLines([{ t:0, text:'Baby I love you' }], { languageHint:'ko' });
  assert.equal(result.lines.length, 0);
}

async function verifyKoreanCommonPronunciationRules() {
  const engine = new RomanizationEngine();
  const result = await engine.romanizeLines([
    { t:0, text:'한국어' },
    { t:1, text:'같이' },
    { t:2, text:'좋아' },
  ]);
  assert.deepEqual(result.lines.map((line) => line.text), [
    'han gu geo',
    'ga chi',
    'jo a',
  ]);
}

async function verifyKoreanOverridesInvalidateCachedRomanization() {
  const defaultEngine = new RomanizationEngine();
  const overridden = new RomanizationEngine({ overrides:{ ko:{ 널:'neol-custom' } } });
  const result = await overridden.romanizeLines([{ t:0, text:'널 Baby' }]);
  assert.equal(result.lines[0].tokens[0].romanized, 'neol-custom');
  assert.notEqual(overridden.engineVersion, defaultEngine.engineVersion);
}

async function verifyKoreanRomanizationKeepsOneSegmentPerSyllable() {
  const engine = new RomanizationEngine({ overrides:{ ko:{ 뜨거운:'tteugeoun' } } });
  const result = await engine.romanizeLines([{
    t:0,
    text:'뜨거운 Baby',
    source:'qrc-word',
    nativeQqKaraoke:true,
    karaokeTimeline:[
      { text:'뜨', start:0, duration:.3, c0:0, c1:1, timed:true },
      { text:'거', start:.3, duration:.3, c0:1, c1:2, timed:true },
      { text:'운', start:.6, duration:.4, c0:2, c1:3, timed:true },
      { text:'Baby', start:1, duration:.8, c0:4, c1:8, timed:true },
    ],
  }]);

  assert.equal(result.lines[0].text, 'tteu geo un Baby');
  assert.equal(result.lines[0].tokens[0].romanized, 'tteu geo un');
  assert.deepEqual(result.lines[0].tokens[0].sourceNodeIndexes, [0, 1, 2]);

  const segmentedOverride = new RomanizationEngine({ overrides:{ ko:{ 뜨거운:'tteu geo woon' } } });
  const overridden = await segmentedOverride.romanizeLines([{ t:0, text:'뜨거운' }]);
  assert.equal(overridden.lines[0].text, 'tteu geo woon',
    'a multi-syllable override remains valid when it provides one segment per Hangul syllable');
}

async function verifyJapaneseDictionaryReadingsAndWordAlignment() {
  const engine = new RomanizationEngine();
  const result = await engine.romanizeLines([
    {
      t:0,
      text:'君の名は Baby',
      source:'qrc-word',
      nativeQqKaraoke:true,
      karaokeTimeline:[
        { text:'君', start:0, duration:.4, c0:0, c1:1, timed:true },
        { text:'の', start:.4, duration:.3, c0:1, c1:2, timed:true },
        { text:'名', start:.7, duration:.4, c0:2, c1:3, timed:true },
        { text:'は', start:1.1, duration:.3, c0:3, c1:4, timed:true },
        { text:'Baby', start:1.4, duration:.8, c0:5, c1:9, timed:true },
      ],
    },
  ]);
  assert.equal(result.language, 'ja');
  assert.equal(result.lines[0].text, 'kimi no na wa Baby');
  assert.deepEqual(result.lines[0].tokens.map((token) => token.sourceText), ['君', 'の', '名', 'は', 'Baby']);
  assert.deepEqual(result.lines[0].tokens[0].sourceNodeIndexes, [0]);
  assert.deepEqual(result.lines[0].tokens[4].sourceNodeIndexes, [4]);
  assert.equal(result.lines[0].coverage, 1);
  assert.equal(result.lines[0].mode, 'qrc-word');
}

async function verifyLineLyricsNeverInventWordTiming() {
  const engine = new RomanizationEngine();
  const result = await engine.romanizeLines([{ t:0, text:'널 사랑해', source:'lrc' }]);
  assert.equal(result.lines[0].mode, 'line');
  assert.deepEqual(result.lines[0].tokens.flatMap((token) => token.sourceNodeIndexes), []);
}

async function verifyJapaneseCorpusDetectionAndOverrides() {
  const engine = new RomanizationEngine();
  const result = await engine.romanizeLines([
    { t:0, text:'君は' },
    { t:1, text:'世界' },
  ]);
  assert.equal(result.language, 'ja');
  assert.equal(result.lines.length, 2);

  const chineseOnly = await engine.romanizeLines([{ t:0, text:'我爱你' }]);
  assert.equal(chineseOnly.language, '');
  assert.equal(chineseOnly.lines.length, 0);

  const overridden = new RomanizationEngine({ overrides:{ ja:{ 君:'kimi-custom' } } });
  const custom = await overridden.romanizeLines([{ t:0, text:'君は' }]);
  assert.equal(custom.lines[0].tokens[0].romanized, 'kimi-custom');
  assert.notEqual(custom.engineVersion, result.engineVersion);
}

async function verifyMixedJapaneseAndKoreanLinesAreRomanizedIndependently() {
  const engine = new RomanizationEngine();
  const result = await engine.romanizeLines([
    { t:0, text:'君の名は' },
    { t:1, text:'사랑해' },
    { t:2, text:'未来' },
  ]);
  assert.equal(result.language, 'mixed');
  assert.deepEqual(result.processedLineIndexes, [0, 1, 2]);
  assert.deepEqual(result.lines.map((line) => line.language), ['ja', 'ko', 'ja']);
  assert.equal(result.lines[0].text, 'kimi no na wa');
  assert.equal(result.lines[1].text, 'sa rang hae');
  assert.equal(result.lines[2].text, 'mirai');
}

async function verifyKnownAllHanJapaneseUsesStrictDictionaryCoverage() {
  const engine = new RomanizationEngine();
  const japanese = await engine.romanizeLines([
    { t:0, text:'東京 未来' },
    { t:1, text:'君は' },
  ]);
  assert.equal(japanese.language, 'ja');
  assert.equal(japanese.lines.length, 2);
  assert.equal(japanese.lines[0].coverage, 1);

  const explicitlyJapanese = await engine.romanizeLines(
    [{ t:0, text:'東京 未来' }],
    { languageHint:'ja' },
  );
  assert.equal(explicitlyJapanese.language, 'ja');
  assert.equal(explicitlyJapanese.lines.length, 1);

  const chineseOnly = await engine.romanizeLines([{ t:0, text:'我爱你' }]);
  assert.equal(chineseOnly.language, '');
  assert.equal(chineseOnly.lines.length, 0);

  const ambiguousChinese = await engine.romanizeLines([{ t:0, text:'月亮代表我的心' }]);
  assert.equal(ambiguousChinese.language, '');
  assert.equal(ambiguousChinese.lines.length, 0);
}

async function verifyOverrideFileIsOptionalAndCorruptionSafe() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-romanization-'));
  const overridePath = path.join(directory, 'romanization-overrides.json');
  try {
    fs.writeFileSync(overridePath, JSON.stringify({ ja:{ 君:'kimi-user' } }), 'utf8');
    assert.deepEqual(loadRomanizationOverrides(overridePath), { ja:{ 君:'kimi-user' } });
    fs.writeFileSync(overridePath, '{broken', 'utf8');
    assert.deepEqual(loadRomanizationOverrides(overridePath), {});
    assert.deepEqual(loadRomanizationOverrides(path.join(directory, 'missing.json')), {});
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
}

verifyKoreanWordSlotsReuseSourceTiming()
  .then(verifyPureEnglishLinesDoNotCreateRomanizationRows)
  .then(verifyKoreanCommonPronunciationRules)
  .then(verifyKoreanOverridesInvalidateCachedRomanization)
  .then(verifyKoreanRomanizationKeepsOneSegmentPerSyllable)
  .then(verifyJapaneseDictionaryReadingsAndWordAlignment)
  .then(verifyLineLyricsNeverInventWordTiming)
  .then(verifyJapaneseCorpusDetectionAndOverrides)
  .then(verifyMixedJapaneseAndKoreanLinesAreRomanizedIndependently)
  .then(verifyKnownAllHanJapaneseUsesStrictDictionaryCoverage)
  .then(verifyOverrideFileIsOptionalAndCorruptionSafe)
  .then(() => console.log('Romanization engine: PASS'))
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
