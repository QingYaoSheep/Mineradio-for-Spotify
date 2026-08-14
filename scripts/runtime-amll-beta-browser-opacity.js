'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const fixturePath = process.env.MINERADIO_AMLL_FIXTURE
  ? path.resolve(process.env.MINERADIO_AMLL_FIXTURE)
  : path.join(__dirname, 'fixtures', 'amll-beta-smoke.html');
const fixtureUrl = `${pathToFileURL(
  fixturePath
).href}?opacitySmoke=1`;
const browserCandidates = [
  process.env.MINERADIO_TEST_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const browser = browserCandidates.find(candidate => fs.existsSync(candidate));

assert(browser, 'Chrome or Edge is required for the AMLL opacity runtime verification');

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-amll-opacity-'));
const run = childProcess.spawnSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '--virtual-time-budget=35000',
  `--user-data-dir=${profileDir}`,
  '--dump-dom',
  fixtureUrl,
], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30000,
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true,
});

try {
  assert.equal(run.status, 0, [
    run.stderr,
    run.error && run.error.message,
    `browser exited with ${run.status}; signal=${run.signal || 'none'}`,
  ].filter(Boolean).join('\n'));
  const output = String(run.stdout || '');
  const match = output.match(
    /<pre id="amll-opacity-smoke-result" data-done="([^"]+)">([\s\S]*?)<\/pre>/
  );
  assert(match, `${run.stderr || ''}\n${output.slice(-1200)}`.trim()
    || 'AMLL opacity smoke did not finish');
  assert.equal(match[1], 'true', match[2]);
  const snapshot = JSON.parse(match[2]);
  const compositeOpacity = layers => layers.reduce(
    (opacity, layer) => opacity * Number(layer.opacity),
    1
  );
  const findLayerRow = (rows, state, layer) => rows.find(line =>
    line.state === state && line[layer]
  );
  const assertLayer = (row, layer, expected, label) => {
    assert(row, `${label} row was not rendered`);
    const actual = compositeOpacity(row[layer]);
    assert(Math.abs(actual - expected) < 0.01,
      `${label} must render at ${expected}, received ${actual}: ${JSON.stringify(row[layer])}`);
  };
  ['before', 'rolling'].forEach(snapshotName => {
    const rows = snapshot[snapshotName];
    const current = findLayerRow(rows, 'current', 'translation');
    const future = findLayerRow(rows, 'future', 'translation');
    assertLayer(current, 'original', 1, `${snapshotName} current original`);
    assertLayer(current, 'translation', 0.78, `${snapshotName} current translation`);
    assertLayer(current, 'romanWord', 1, `${snapshotName} current QRC romanization`);
    ['original', 'translation', 'romanWord'].forEach(layer =>
      assertLayer(future, layer, 0.58, `${snapshotName} future ${layer}`));
    assert(Math.abs(Number(current.brightMaskAlpha) - 1) < 0.01,
      `${snapshotName} current sung mask must be 100%, received ${current.brightMaskAlpha}`);
    assert(Math.abs(Number(current.darkMaskAlpha) - 0.58) < 0.01,
      `${snapshotName} current unsung mask must be 58%, received ${current.darkMaskAlpha}`);
    assert(Math.abs(Number(future.brightMaskAlpha) - 1) < 0.01
      && Math.abs(Number(future.darkMaskAlpha) - 1) < 0.01,
    `${snapshotName} future word mask must not multiply the fixed 58% layer opacity: `
      + `${future.brightMaskAlpha}/${future.darkMaskAlpha}`);
  });

  const assertRomanSyllableGap = (row, romanText, segments, label) => {
    assert(row, `${label} row was not rendered`);
    const word = row.romanWordSegments.find(item => item.text === romanText);
    assert(word, `${label} romanized word was not rendered: ${JSON.stringify(row.romanWordSegments)}`);
    assert.deepEqual(word.segments, segments,
      `${label} must expose one visible element per Korean romanized syllable`);
    word.gapsEm.forEach(gap => assert(gap >= 0.20 && gap <= 0.24,
      `${label} syllable gap must remain approximately 0.22em, received ${gap}`));
  };
  const qrcSpacingCurrent = findLayerRow(snapshot.before, 'current', 'romanWord');
  qrcSpacingCurrent.romanWordSegments.filter(word => word.text !== 'signs').forEach(word => {
    assert(word.maskFadeWidth != null && word.expectedSourceFadeWidth != null,
      `Korean romanized words must expose a source-only mask measurement: ${JSON.stringify(word)}`);
    assert(Math.abs(word.maskFadeWidth - word.expectedSourceFadeWidth) < 1,
      `romanization must not widen the main lyric fade: ${JSON.stringify(word)}`);
    assert.equal(word.sourceMotionCount, 1,
      `each Korean timed word must have exactly one reusable source motion layer: ${JSON.stringify(word)}`);
    assert.equal(word.sourceFloatAnimationCount, 1,
      `each Korean timed word must retain one source float animation: ${JSON.stringify(word)}`);
    assert(word.sourceFloatKeyframes.some(transform => /translateY\(-0\.(?:05|1)em\)/.test(String(transform))),
      `the source-only motion layer must retain AMLL's original upward target: ${JSON.stringify(word)}`);
    assert.equal(word.romanFloatAnimationCount, 0,
      `Korean romanization must not own a float animation: ${JSON.stringify(word)}`);
  });
  const qrcRolling = findLayerRow(snapshot.rolling, 'current', 'romanWord');
  qrcSpacingCurrent.romanWordSegments.filter(word => word.text !== 'signs').forEach(beforeWord => {
    const rollingWord = qrcRolling.romanWordSegments.find(word => word.text === beforeWord.text);
    assert(rollingWord, `rolling Korean word must remain mounted: ${beforeWord.text}`);
    assert(Math.abs(rollingWord.romanOffsetFromMain - beforeWord.romanOffsetFromMain) < 0.5,
      `romanization must stay vertically fixed while the source word floats: ${JSON.stringify({
        before:beforeWord,
        rolling:rollingWord,
      })}`);
  });
  assertRomanSyllableGap(qrcSpacingCurrent, 'al jan ha', ['al', 'jan', 'ha'],
    'QRC Korean romanization');
  assertRomanSyllableGap(qrcSpacingCurrent, 'i geon', ['i', 'geon'],
    'QRC Korean romanization');
  assertRomanSyllableGap(qrcSpacingCurrent, 'eo neo', ['eo', 'neo'],
    'QRC Korean romanization');
  assertRomanSyllableGap(qrcSpacingCurrent, 'i sang ui', ['i', 'sang', 'ui'],
    'QRC Korean romanization');
  const englishQrcWord = qrcSpacingCurrent.romanWordSegments.find(item => item.text === 'signs');
  assert(englishQrcWord && englishQrcWord.segments.length === 0,
    'a pure English QRC word must not be segmented as Korean romanization');
  const japaneseQrcWord = snapshot.before.flatMap(row => row.romanWordSegments)
    .find(item => item.text === 'kimi no');
  assert(japaneseQrcWord && japaneseQrcWord.segments.length === 0,
    'Japanese romanization must not use Korean syllable segmentation');
  assert.equal(japaneseQrcWord.sourceMotionCount, 0,
    'Japanese romanization must remain outside the Korean source-motion patch');

  const laterPast = findLayerRow(snapshot.later, 'past', 'translation');
  const laterCurrent = findLayerRow(snapshot.later, 'current', 'translation');
  ['original', 'translation', 'romanWord'].forEach(layer =>
    assertLayer(laterPast, layer, 0.58, `later past ${layer}`));
  assert(Math.abs(Number(laterPast.brightMaskAlpha) - 1) < 0.01
    && Math.abs(Number(laterPast.darkMaskAlpha) - 1) < 0.01,
  `past word mask must not multiply the fixed 58% layer opacity: `
    + `${laterPast.brightMaskAlpha}/${laterPast.darkMaskAlpha}`);
  assertLayer(laterCurrent, 'original', 1, 'later current original');
  assertLayer(laterCurrent, 'translation', 0.78, 'later current translation');
  assertLayer(laterCurrent, 'romanWord', 1, 'later current QRC romanization');
  assertRomanSyllableGap(laterCurrent, 'tteu geo un,', ['tteu', 'geo', 'un,'],
    'punctuated QRC Korean romanization');
  assertLayer(laterCurrent, 'background', 1, 'background vocal container');
  assert(Math.abs(Number(laterCurrent.backgroundBrightMaskAlpha) - 0.68) < 0.01,
    `background sung mask must be 68%, received ${laterCurrent.backgroundBrightMaskAlpha}`);
  assert(Math.abs(Number(laterCurrent.backgroundDarkMaskAlpha) - 0.48) < 0.01,
    `background unsung mask must be 48%, received ${laterCurrent.backgroundDarkMaskAlpha}`);
  assert(laterCurrent.emphasisAnimations.length > 0,
    `long-tone emphasis animations must survive original-run decoration: ${JSON.stringify(laterCurrent)}`);
  assert.equal(laterPast.translationAnimations.length, 0,
    `past translation opacity transitions must not restart: ${JSON.stringify(laterPast.translationAnimations)}`);
  assert.equal(laterCurrent.romanizationAnimations.length, 0,
    `QRC romanization opacity transitions must not restart: ${JSON.stringify(laterCurrent.romanizationAnimations)}`);

  const assertKoreanColumns = (row, label) => {
    assert(row, `${label} row was not rendered`);
    assert.deepEqual(row.koreanColumns.map(column => [column.sourceText, column.romanized]), [
      ['한', 'han'],
      ['눈', 'nun'],
      ['깜짝', 'kkam jjak'],
      ['감게', 'gam ge'],
      ['해', 'hae'],
      ['Baby', 'Baby'],
    ], `${label} must render one aligned source/romanization column per source word`);
    row.koreanColumns.forEach(column => {
      assert(Math.abs(column.sourceLeft - column.romanLeft) < 1,
        `${label} source and romanization must share a left edge: ${JSON.stringify(column)}`);
      assert(parseFloat(column.romanFontSize) < parseFloat(column.sourceFontSize),
        `${label} romanization must keep its natural smaller size: ${JSON.stringify(column)}`);
      assert(column.romanTransform === 'none',
        `${label} romanization must not be stretched to force alignment: ${JSON.stringify(column)}`);
    });
    assert.equal(row.flatRomanDisplay, 'none',
      `${label} fallback flat romanization row must be hidden after aligned columns render`);
  };
  const lrcCurrent = findLayerRow(snapshot.lrc, 'current', 'romanWord');
  assertLayer(lrcCurrent, 'original', 1, 'LRC current original');
  assertLayer(lrcCurrent, 'translation', 0.78, 'LRC current translation');
  assertLayer(lrcCurrent, 'romanWord', 1, 'LRC aligned romanization');
  assertKoreanColumns(lrcCurrent, 'LRC current');
  assertRomanSyllableGap(lrcCurrent, 'kkam jjak', ['kkam', 'jjak'],
    'LRC Korean romanization');
  assert.equal(lrcCurrent.romanizationAnimations.length, 0,
    `LRC romanization opacity transitions must not restart: ${JSON.stringify(lrcCurrent.romanizationAnimations)}`);
  const rescaledLrcCurrent = findLayerRow(snapshot.lrcRescaled, 'current', 'romanWord');
  assertKoreanColumns(rescaledLrcCurrent, 'rescaled LRC current');
  assert(parseFloat(rescaledLrcCurrent.koreanColumns[0].romanFontSize)
    < parseFloat(lrcCurrent.koreanColumns[0].romanFontSize),
  `romanization size changes must immediately reflow aligned columns: ${JSON.stringify({
    before:lrcCurrent.koreanColumns[0],
    after:rescaledLrcCurrent.koreanColumns[0],
  })}`);
  const resizedLrcCurrent = findLayerRow(snapshot.lrcResized, 'current', 'romanWord');
  assertKoreanColumns(resizedLrcCurrent, 'resized LRC current');
  assert(new Set(resizedLrcCurrent.koreanColumns.map(column => Math.round(column.columnTop))).size > 1,
    `narrow LRC columns must wrap as complete source/romanization pairs: ${JSON.stringify(resizedLrcCurrent)}`);

  const trackedCurrent = findLayerRow(snapshot.rolling, 'current', 'translation');
  const trackingEm = run => parseFloat(run.letterSpacing) / parseFloat(run.fontSize);
  assert(trackedCurrent.latinRuns.some(run => run.text.includes('signs') && run.inOriginal
    && Math.abs(trackingEm(run) - 0.01) < 0.001),
  `mixed original Latin text must use 0.01em tracking: ${JSON.stringify(trackedCurrent.latinRuns)}`);
  assert(trackedCurrent.latinRuns.some(run => run.text.includes('signs') && run.inTranslation
    && Math.abs(trackingEm(run) - 0.02) < 0.001),
  `mixed translation Latin text must retain 0.02em tracking: ${JSON.stringify(trackedCurrent.latinRuns)}`);
  assert(trackedCurrent.latinRuns.some(run => run.inRomanization
    && Math.abs(trackingEm(run) - 0.02) < 0.001),
  `romanization Latin text must retain 0.02em tracking: ${JSON.stringify(trackedCurrent.latinRuns)}`);
  assert(trackedCurrent.nonLatinOriginalRuns.some(run => /알잖아/.test(run.text)),
    `CJK text must remain outside Latin tracking runs: ${JSON.stringify(trackedCurrent.nonLatinOriginalRuns)}`);

  const assertVirtualizedCurrent = (rows, lineNumber, label) => {
    const row = rows.find(line => line.text.includes(`line-${lineNumber}`));
    assert(row, `${label} lyric must stay mounted around its playback time`);
    assert.equal(row.state, 'current',
      `${label} lyric must own current state, received ${row.state}`);
    assertLayer(row, 'original', 1, `${label} current original`);
    assertLayer(row, 'translation', 0.78, `${label} current translation`);
    assertLayer(row, 'romanWord', 1, `${label} current QRC romanization`);
    assert(rows.length < 20,
      `virtualization fixture must unload offscreen groups, mounted ${rows.length}`);
  };
  assertVirtualizedCurrent(snapshot.virtualizedFifth, 5, 'virtualized fifth');
  assertVirtualizedCurrent(snapshot.virtualizedSixth, 6, 'virtualized sixth');
  assertVirtualizedCurrent(snapshot.virtualizedSeventh, 7, 'virtualized seventh');
  assertVirtualizedCurrent(snapshot.virtualizedSeekBack, 5, 'virtualized seek-back fifth');
  assert.equal(snapshot.virtualizedRemount.state, 'future',
    `a naturally remounted offscreen lyric must retain future state: ${JSON.stringify(snapshot.virtualizedRemount)}`);
  assert(snapshot.virtualizedRemount.original,
    `a remounted lyric must be decorated on its first mounted frame: ${JSON.stringify(snapshot.virtualizedRemount)}`);
  assert(Math.abs(compositeOpacity(snapshot.virtualizedRemount.original) - 0.58) < 0.01,
    `a remounted future original must render at 58% immediately: ${JSON.stringify(snapshot.virtualizedRemount)}`);
  assert.deepEqual(snapshot.virtualizedRemount.koreanColumns, [
    ['한', 'han'],
    ['눈', 'nun'],
    ['깜짝', 'kkam jjak'],
    ['line-15', 'line-15'],
  ], 'a remounted Korean LRC line must rebuild its aligned word columns');
  assert.equal(snapshot.virtualizedRemount.flatRomanDisplay, 'none',
    'a remounted Korean LRC line must keep the flat fallback romanization hidden');
  const remountedKoreanWord = snapshot.virtualizedRemount.romanWordSegments
    .find(word => word.text === 'kkam jjak');
  assert.deepEqual(remountedKoreanWord && remountedKoreanWord.segments, ['kkam', 'jjak'],
    'a remounted Korean LRC line must rebuild visible romanized syllable spacing');
  const virtualizedPast = findLayerRow(snapshot.virtualizedFifth, 'past', 'translation');
  const virtualizedFuture = findLayerRow(snapshot.virtualizedFifth, 'future', 'translation');
  ['original', 'translation', 'romanWord'].forEach(layer => {
    assertLayer(virtualizedPast, layer, 0.58, `virtualized past ${layer}`);
    assertLayer(virtualizedFuture, layer, 0.58, `virtualized future ${layer}`);
  });

  const assertBackgroundClock = (beforeRows, startedRows, label) => {
    const before = beforeRows.find(row => row.backgroundAnimations.length);
    const started = startedRows.find(row => row.backgroundAnimations.length);
    assert(before && started, `${label} background vocal must render timed animations`);
    assert(before.backgroundAnimations.every(animation => animation.currentTime < 1
      && animation.playState === 'paused'),
    `${label} background animations must stay frozen before their source start: ${JSON.stringify(before)}`);
    assert(started.backgroundAnimations.some(animation => animation.currentTime >= 200
      && animation.playState === 'running'),
    `${label} background animations must start from their own source clock: ${JSON.stringify(started)}`);
  };
  assertBackgroundClock(snapshot.appleBackgroundBeforeStart, snapshot.appleBackgroundStarted,
    'Apple TTML');
  assertBackgroundClock(snapshot.qrcBackgroundBeforeStart, snapshot.qrcBackgroundStarted,
    'QQ QRC');
  const backgroundClockRow = rows => rows.find(row => row.backgroundAnimations.length);
  const backgroundMaxTime = row => Math.max(...row.backgroundAnimations.map(animation => animation.currentTime));
  const pausedBackground = backgroundClockRow(snapshot.appleBackgroundPaused);
  const pausedBackgroundHeld = backgroundClockRow(snapshot.appleBackgroundPausedHeld);
  const resumedBackground = backgroundClockRow(snapshot.appleBackgroundResumed);
  const seekBackBackground = backgroundClockRow(snapshot.appleBackgroundSeekBack);
  const finishedBackground = backgroundClockRow(snapshot.appleBackgroundFinished);
  assert(pausedBackground.backgroundAnimations.every(animation => animation.playState === 'paused')
    && pausedBackgroundHeld.backgroundAnimations.every(animation => animation.playState === 'paused')
    && pausedBackground.backgroundAnimations.every(animation => Math.abs(animation.currentTime - 400) < 50)
    && Math.abs(backgroundMaxTime(pausedBackgroundHeld) - backgroundMaxTime(pausedBackground)) < 1,
  `paused Apple background animations must remain fixed at their source-derived time: ${JSON.stringify({
    paused:pausedBackground.backgroundAnimations,
    held:pausedBackgroundHeld.backgroundAnimations,
  })}`);
  assert(backgroundMaxTime(resumedBackground) > backgroundMaxTime(pausedBackground) + 100,
    'resumed Apple background animations must continue from the paused source time');
  assert(seekBackBackground.backgroundAnimations.every(animation => animation.currentTime < 1
    && animation.playState === 'paused'),
  'seeking before the Apple background source start must restore the frozen 0% state');
  assert(finishedBackground.backgroundAnimations.every(animation => animation.currentTime >= 1990
    && animation.playState === 'paused'),
  'a completed Apple background vocal must remain fully highlighted and paused');
  const appleBackgroundText = snapshot.appleBackgroundBeforeStart
    .find(row => row.backgroundAnimations.length).backgroundText;
  assert(!/[()（）]/u.test(appleBackgroundText),
    `Apple word-timed background romanization must hide its outer parentheses: ${appleBackgroundText}`);

  const overlapBefore = snapshot.appleOverlapBefore;
  const overlapStarted = snapshot.appleOverlapStarted.filter(row => row.state === 'current');
  const overlapRolling = snapshot.appleOverlapRolling.filter(row => row.state === 'current');
  assert.equal(overlapStarted.length, 2,
    `both overlapping Apple foreground lyrics must become current: ${JSON.stringify(snapshot.appleOverlapStarted)}`);
  assert.equal(overlapRolling.length, 2,
    `both Apple foreground lyrics must remain current while their source timelines overlap: ${JSON.stringify(snapshot.appleOverlapRolling)}`);
  const leadBefore = overlapBefore.find(row => row.text.includes('Lead holding'));
  const nextBefore = overlapBefore.find(row => row.text.includes('Next voice'));
  const leadStarted = overlapStarted.find(row => row.text.includes('Lead holding'));
  const nextStarted = overlapStarted.find(row => row.text.includes('Next voice'));
  const leadRolling = overlapRolling.find(row => row.text.includes('Lead holding'));
  const nextRolling = overlapRolling.find(row => row.text.includes('Next voice'));
  assert(leadBefore && nextBefore && leadStarted && nextStarted && leadRolling && nextRolling,
    'the real AMLL DOM must retain both named Apple foreground lines');
  assert.equal(leadStarted.anchorCurrent, true,
    'the first Apple overlap line must retain the current scroll anchor');
  assert.equal(nextStarted.anchorCurrent, false,
    'the later Apple overlap line must begin highlighting without taking the scroll anchor');
  assert.equal(leadRolling.anchorCurrent, true,
    'resuming natural playback must keep the first Apple overlap line as the scroll anchor');
  assert.equal(nextRolling.anchorCurrent, false,
    'resuming natural playback must not let the later Apple overlap line take the anchor');
  assert(Math.abs(leadStarted.wrapperTop - leadBefore.wrapperTop) < 1,
    `the first Apple overlap line must not move when the second line starts: ${JSON.stringify({
      before:leadBefore.wrapperTop,
      started:leadStarted.wrapperTop,
    })}`);
  assert(Math.abs(nextStarted.wrapperTop - nextBefore.wrapperTop) < 1,
    `the second Apple overlap line must start in its existing position: ${JSON.stringify({
      before:nextBefore.wrapperTop,
      started:nextStarted.wrapperTop,
    })}`);
  assert(leadBefore.backgroundText.includes('oh')
    && !/[()（）]/u.test(leadBefore.backgroundText),
  `Apple background-vocal display text must omit wrapper parentheses: ${leadBefore.backgroundText}`);
  assert(leadRolling.maskAnimationTimes.length > 0
    && leadRolling.maskAnimationTimes.some((time, index) =>
      time > Number(leadBefore.maskAnimationTimes[index] || -Infinity)),
  `the previous Apple lyric mask must keep advancing after the next overlapping line starts: ${JSON.stringify({
    before:leadBefore.maskAnimationTimes,
    rolling:leadRolling.maskAnimationTimes,
  })}`);
  assert(nextRolling.maskAnimationTimes.some((time, index) =>
    time > Number(nextStarted.maskAnimationTimes[index] || -Infinity)),
  `the second Apple lyric must begin its own word animation in place: ${JSON.stringify({
    started:nextStarted.maskAnimationTimes,
    rolling:nextRolling.maskAnimationTimes,
  })}`);
  const heldLead = snapshot.appleOverlapFirstHeld.find(row => row.text.includes('Lead holding'));
  const heldNext = snapshot.appleOverlapFirstHeld.find(row => row.text.includes('Next voice'));
  assert(heldLead && heldNext && heldLead.state === 'current' && heldNext.state === 'current',
    'the completed first line must stay current until the later-starting overlap line ends');
  assert.equal(heldLead.anchorCurrent, true,
    'the completed first overlap line must keep the fixed layout anchor');
  assertLayer(heldLead, 'original', 1, 'held completed Apple overlap original');
  assert(heldLead.maskAnimationTimes.some(time => time >= 3900),
    `the completed first overlap line must remain fully highlighted: ${JSON.stringify(heldLead.maskAnimationTimes)}`);
  const releasedLead = snapshot.appleOverlapReleased.find(row => row.text.includes('Lead holding'));
  const releasedNext = snapshot.appleOverlapReleased.find(row => row.text.includes('Next voice'));
  const afterOverlap = snapshot.appleOverlapReleased.find(row => row.text.includes('After overlap'));
  assert(releasedLead && releasedNext
    && releasedLead.state === 'past' && releasedNext.state === 'past',
  'both Apple overlap lines must become past together when the later-starting line ends');
  assert(afterOverlap && afterOverlap.anchorCurrent,
    'releasing an Apple overlap group must move the layout anchor to the following line');
  assert(releasedLead.wrapperTop < heldLead.wrapperTop - 5
    && releasedNext.wrapperTop < heldNext.wrapperTop - 5,
  `both released Apple overlap lines must move upward together: ${JSON.stringify({
    lead:[heldLead.wrapperTop, releasedLead.wrapperTop],
    next:[heldNext.wrapperTop, releasedNext.wrapperTop],
  })}`);
  ['original', 'translation', 'romanWord'].forEach(layer => {
    if (releasedLead[layer]) assertLayer(releasedLead, layer, 0.58, `released lead ${layer}`);
    if (releasedNext[layer]) assertLayer(releasedNext, layer, 0.58, `released next ${layer}`);
  });
  const reverseRollingLead = snapshot.appleReverseOverlapRolling
    .find(row => row.text.includes('Long first voice'));
  const reverseReleasedLead = snapshot.appleReverseOverlapReleased
    .find(row => row.text.includes('Long first voice'));
  const reverseReleasedSecond = snapshot.appleReverseOverlapReleased
    .find(row => row.text.includes('Short second voice'));
  assert(reverseRollingLead && reverseReleasedLead && reverseReleasedSecond,
    'the reverse-ending Apple overlap fixture must render both foreground lines');
  assert(reverseReleasedLead.state === 'past' && reverseReleasedSecond.state === 'past',
    'the later-starting Apple line must release both lines even when the first source line is longer');
  assert(reverseReleasedLead.maskAnimationTimes.some(time => time >= 5900),
    `a truncated earlier Apple line must be visually completed before becoming past: ${JSON.stringify({
      rolling:reverseRollingLead.maskAnimationTimes,
      released:reverseReleasedLead.maskAnimationTimes,
    })}`);
  const reverseSeekBackLead = snapshot.appleReverseOverlapSeekBack
    .find(row => row.text.includes('Long first voice'));
  assert(reverseSeekBackLead && reverseSeekBackLead.state === 'current'
    && reverseSeekBackLead.anchorCurrent,
  'seeking back into a reverse-ending Apple overlap must restore its fixed first-line state');
  assert(reverseSeekBackLead.maskAnimationTimes.every(time => time < 5900),
    `seeking back must restore the earlier line source-time mask instead of keeping it complete: `
      + JSON.stringify(reverseSeekBackLead.maskAnimationTimes));
  const chainedRolling = snapshot.appleChainedOverlapRolling
    .filter(row => row.text.includes('Chain ') && row.state === 'current');
  const chainedHeld = snapshot.appleChainedOverlapHeld
    .filter(row => row.text.includes('Chain ') && row.state === 'current');
  const chainedReleased = snapshot.appleChainedOverlapReleased
    .filter(row => row.text.includes('Chain ') && row.state === 'past');
  assert.equal(chainedRolling.length, 3,
    'all three chained Apple overlap lines must highlight concurrently');
  assert.equal(chainedHeld.length, 3,
    'completed earlier members of a chained overlap must remain current until the last-starting line ends');
  assert.equal(chainedRolling.filter(row => row.anchorCurrent).length, 1,
    'a chained Apple overlap must expose exactly one fixed layout anchor');
  assert(chainedRolling.find(row => row.text.includes('Chain first')).anchorCurrent,
    'the first line must own the chained Apple overlap layout anchor');
  assert(chainedHeld.find(row => row.text.includes('Chain first')).anchorCurrent,
    'the first line must keep the chained Apple overlap anchor after earlier members finish');
  assert.equal(chainedReleased.length, 3,
    'the full chained Apple overlap must become past when its last-starting line ends');
  const afterChain = snapshot.appleChainedOverlapReleased
    .find(row => row.text.includes('After chain'));
  assert(afterChain && afterChain.anchorCurrent,
    'a released chained Apple overlap must hand the layout anchor to the following line');
  [
    ['first mount', snapshot.appleVirtualOverlapFirstMount],
    ['remount', snapshot.appleVirtualOverlapRemount],
  ].forEach(([label, rows]) => {
    const virtualFirst = rows.find(row => row.text.includes('Virtual overlap first'));
    const virtualSecond = rows.find(row => row.text.includes('Virtual overlap second'));
    assert(virtualFirst && virtualSecond
      && virtualFirst.state === 'current' && virtualSecond.state === 'current',
    `virtualized Apple overlap ${label} must restore both current lines`);
    assert(virtualFirst.anchorCurrent && !virtualSecond.anchorCurrent,
      `virtualized Apple overlap ${label} must restore the fixed first-line anchor`);
  });
  [
    ['first mount', snapshot.appleVirtualMicroFirstMount],
    ['remount', snapshot.appleVirtualMicroRemount],
  ].forEach(([label, rows]) => {
    const outgoing = rows.find(row => row.text.includes('Virtual micro outgoing'));
    const incoming = rows.find(row => row.text.includes('Virtual micro incoming'));
    assert(outgoing && incoming && outgoing.state === 'past' && incoming.state === 'current',
      `virtualized Apple micro-overlap ${label} must restore the early handoff state`);
    assert(incoming.anchorCurrent
      && incoming.maskAnimationTimes.every(time => Math.abs(time) < 1),
    `virtualized Apple micro-overlap ${label} must keep the incoming line frozen at 0%`);
  });

  const capBefore = snapshot.appleOverlapCapBeforeFourth
    .filter(row => row.state === 'current' && row.text.includes('Cap '));
  assert.equal(capBefore.length, 3,
    `Apple TTML must allow exactly three concurrent foreground highlights: ${JSON.stringify(capBefore)}`);
  assert(capBefore.find(row => row.text.includes('Cap first')).anchorCurrent,
    'the first member must own the three-line Apple overlap anchor');
  const capAtFourthRows = snapshot.appleOverlapCapAtFourth;
  const capAtFourthCurrent = capAtFourthRows.filter(row => row.state === 'current');
  assert.equal(capAtFourthCurrent.length, 1,
    `the fourth Apple line must end the previous three-line group: ${JSON.stringify(capAtFourthRows)}`);
  const capFourth = capAtFourthRows.find(row => row.text.includes('Cap fourth'));
  assert(capFourth && capFourth.state === 'current' && capFourth.anchorCurrent,
    'the fourth Apple line must become the first anchor of the next overlap group');
  [
    ['Cap first', 8900],
    ['Cap second', 6900],
    ['Cap third', 4900],
  ].forEach(([text, completedTime]) => {
    const beforeRow = snapshot.appleOverlapCapBeforeFourth.find(row => row.text.includes(text));
    const releasedRow = capAtFourthRows.find(row => row.text.includes(text));
    assert(releasedRow && releasedRow.state === 'past'
      && releasedRow.maskAnimationTimes.some(time => time >= completedTime),
    `${text} must be visually completed when the fourth Apple line starts`);
    assert(beforeRow && releasedRow.wrapperTop < beforeRow.wrapperTop - 5,
      `${text} must move upward with the released three-line group`);
  });
  const capSecondGroup = snapshot.appleOverlapCapSecondGroup
    .filter(row => row.state === 'current' && row.text.includes('Cap '));
  assert.equal(capSecondGroup.length, 3,
    'lines four through six may form a new three-line Apple overlap group');
  assert(capSecondGroup.find(row => row.text.includes('Cap fourth')).anchorCurrent,
    'the fourth line must remain the second overlap group anchor');

  const microBefore = snapshot.appleMicroOverlapBefore
    .find(row => row.text.includes('Micro almost done'));
  const microAccelerating = snapshot.appleMicroOverlapAccelerating
    .find(row => row.text.includes('Micro almost done'));
  assert(microBefore && microAccelerating
    && microBefore.state === 'current' && microAccelerating.state === 'current',
  'the outgoing 99ms Apple overlap line must remain current while its final word accelerates');
  assert(Math.max(...microAccelerating.maskAnimationTimes)
    > Math.max(...microBefore.maskAnimationTimes),
  `the outgoing 99ms Apple overlap mask must visibly accelerate: ${JSON.stringify({
    before:microBefore.maskAnimationTimes,
    accelerating:microAccelerating.maskAnimationTimes,
  })}`);
  const microHandoffOutgoing = snapshot.appleMicroOverlapHandoff
    .find(row => row.text.includes('Micro almost done'));
  const microHandoffIncoming = snapshot.appleMicroOverlapHandoff
    .find(row => row.text.includes('Micro next line'));
  assert(microHandoffOutgoing && microHandoffOutgoing.state === 'past'
    && microHandoffOutgoing.maskAnimationTimes.some(time => time >= 4090),
  'the outgoing 99ms Apple overlap line must reach 100% before handoff');
  assert(microHandoffIncoming && microHandoffIncoming.state === 'current'
    && microHandoffIncoming.anchorCurrent
    && microHandoffIncoming.maskAnimationTimes.every(time => Math.abs(time) < 1),
  'the incoming 99ms Apple overlap line must be positioned early but frozen at 0%');
  const microStarted = snapshot.appleMicroOverlapStarted
    .find(row => row.text.includes('Micro next line'));
  assert(microStarted && microStarted.maskAnimationTimes.some(time => time > 0),
    'the incoming 99ms Apple overlap line must start highlighting at its real TTML time');
  const microSeekBack = snapshot.appleMicroOverlapSeekBack
    .find(row => row.text.includes('Micro almost done'));
  assert(microSeekBack && microSeekBack.state === 'current' && microSeekBack.anchorCurrent,
    'seeking back into the 99ms acceleration window must restore the outgoing line state');
  const microClusterTail = snapshot.appleMicroOverlapClusterTail;
  const microClusterIncoming = microClusterTail
    .find(row => row.text.includes('Micro cluster incoming'));
  assert(microClusterIncoming && microClusterIncoming.state === 'current'
    && microClusterIncoming.anchorCurrent
    && microClusterIncoming.maskAnimationTimes.every(time => Math.abs(time) < 1),
  'a micro-overlap after a true overlap group must hand the anchor to the frozen incoming line');
  ['Micro cluster first', 'Micro cluster tail'].forEach(text => {
    const row = microClusterTail.find(candidate => candidate.text.includes(text));
    assert(row && row.state === 'past'
      && row.maskAnimationTimes.some(time => time >= (text.endsWith('first') ? 4900 : 2000)),
    `${text} must be fully highlighted when the outgoing overlap group hands off: `
      + JSON.stringify(row && row.maskAnimationTimes));
  });

  const gapHolding = snapshot.appleGapHolding.find(row => row.text.includes('Natural finish'));
  const gapEarly = snapshot.appleGapEarly.find(row => row.text.includes('Word handoff'));
  const gapStarted = snapshot.appleGapStarted.find(row => row.text.includes('Word handoff'));
  assert(gapHolding && gapHolding.state === 'current',
    'a naturally completed Apple word line must remain current before the 800ms handoff');
  assert(gapHolding.maskAnimationTimes.some(time => time >= 1900),
    `the completed Apple word must reach its source-file end without interruption: ${JSON.stringify(gapHolding)}`);
  assert(gapEarly && gapEarly.state === 'current',
    'an Apple gap over 800ms must switch to the next word line up to 800ms early');
  assert(gapEarly.maskAnimationTimes.length > 0
    && gapEarly.maskAnimationTimes.every(time => Math.abs(time) < 1),
  `the early Apple word line must remain frozen at 0% before its real source start: ${JSON.stringify(gapEarly)}`);
  assert(gapStarted && gapStarted.maskAnimationTimes.some(time => time >= 5),
    `the early Apple word line must resume from its real source start: ${JSON.stringify(gapStarted)}`);

  const lineEarly = snapshot.appleLineEarly.find(row => row.text.includes('Line handoff'));
  const lineDisabled = snapshot.appleLineDisabled.find(row => row.text.includes('Line finish'));
  assert(lineEarly && lineEarly.state === 'current',
    'Apple line-timed TTML must use the 800ms early layout handoff');
  assert(lineDisabled && lineDisabled.state === 'current',
    'disabling word advance must keep the completed Apple line current until the real next start');

  const assertAppleKoreanLexicalWord = (rows, sourceText, romanized, rubyTimes, label) => {
    const row = rows.find(candidate => candidate.appleKoreanLexicalWords
      .some(word => word.sourceText === sourceText));
    assert(row, `${label} must render in the real AMLL DOM`);
    assert.equal(row.appleKoreanLexicalTiming, true,
      `${label} row must retain its Apple lexical-timing word marker`);
    assert.equal(row.appleKoreanLexicalMarkerCount, row.appleKoreanLexicalWords.length,
      `${label} must mark only words that actually own internal timing segments`);
    const word = row.appleKoreanLexicalWords.find(candidate => candidate.sourceText === sourceText);
    assert.equal(word.lexicalTiming, true,
      `${label} marker must belong to the concrete visual word rather than its shared wrapper`);
    assert.equal(word.romanized, romanized,
      `${label} must keep one natural romanization row for the whole Korean word`);
    assert(Number.isFinite(word.sourceGapEm) && Math.abs(word.sourceGapEm) <= 0.04,
      `${label} Korean syllables must use natural contiguous glyph spacing: ${JSON.stringify(word)}`);
    assert(Math.abs(word.sourceLeft - word.romanLeft) < 1,
      `${label} source and romanization must share one word-level left edge: ${JSON.stringify(word)}`);
    assert.equal(word.rubyDisplay, 'none',
      `${label} internal AMLL timing metadata must never appear as a visible ruby row`);
    assert.deepEqual(word.rubyTimes, rubyTimes,
      `${label} must preserve every Apple TTML source-node timestamp`);
    const romanWord = row.romanWordSegments.find(candidate => candidate.text === romanized);
    assert(romanWord, `${label} romanized word must be decorated after AMLL mounts`);
    romanWord.gapsEm.forEach(gap => assert(gap >= 0.20 && gap <= 0.24,
      `${label} romanized syllable gap must remain approximately 0.22em, received ${gap}`));
  };
  assertAppleKoreanLexicalWord(snapshot.appleKoreanLexicalFirst, '장면', 'jang myeon', [
    { text:'장', start:1600, end:1950 },
    { text:'면', start:1950, end:2400 },
  ], 'split Apple word 장면');
  const firstSyllableMask = snapshot.appleKoreanLexicalFirst
    .flatMap(row => row.appleKoreanLexicalWords)
    .find(word => word.sourceText === '장면').maskPosition;
  const secondSyllableMask = snapshot.appleKoreanLexicalSecondSyllable
    .flatMap(row => row.appleKoreanLexicalWords)
    .find(word => word.sourceText === '장면').maskPosition;
  assert.notEqual(secondSyllableMask, firstSyllableMask,
    `the visible word mask must keep advancing across the original 장/면 TTML boundary: `
      + `${firstSyllableMask} -> ${secondSyllableMask}`);
  assertAppleKoreanLexicalWord(snapshot.appleKoreanLexicalSecond, '반응해', 'ba neung hae', [
    { text:'반', start:4700, end:5000 },
    { text:'응해', start:5000, end:5800 },
  ], 'split Apple word 반응해');
  assertAppleKoreanLexicalWord(snapshot.appleKoreanLexicalRebuilt, '장면', 'jang myeon', [
    { text:'장', start:1600, end:1950 },
    { text:'면', start:1950, end:2400 },
  ], 'rebuilt split Apple word 장면');
  assertAppleKoreanLexicalWord(snapshot.appleKoreanLexicalVirtualized, '장면', 'jang myeon', [
    { text:'장', start:43600, end:43950 },
    { text:'면', start:43950, end:44400 },
  ], 'virtualized split Apple word 장면');
  assertAppleKoreanLexicalWord(snapshot.appleKoreanLexicalBackground, '장면', 'jang myeon', [
    { text:'장', start:1800, end:2150 },
    { text:'면', start:2150, end:2600 },
  ], 'background split Apple word 장면');
  const backgroundLexicalWord = snapshot.appleKoreanLexicalBackground
    .flatMap(row => row.appleKoreanLexicalWords)
    .find(word => word.sourceText === '장면');
  assert.equal(backgroundLexicalWord.isBackground, true,
    'background lexical timing must be decorated on the background lyric line itself');

  const assertAppleKoreanWordColumns = (rows, expected, label) => {
    const row = rows.find(candidate => candidate.appleKoreanWordColumns
      .some(word => word.sourceText === expected[0][0]));
    assert(row, `${label} must render in the real AMLL DOM`);
    assert.deepEqual(row.appleKoreanWordColumns.map(word => [word.sourceText, word.romanized]), expected,
      `${label} must derive one visual column per source-whitespace word`);
    row.appleKoreanWordColumns.forEach(word => {
      assert.equal(word.wordLayout, true,
        `${label} must decorate every word in a line that contains internal Apple timing: ${JSON.stringify(word)}`);
      assert(Math.abs(word.sourceLeft - word.romanLeft) < 1,
        `${label} source and romanization must share a left edge: ${JSON.stringify(word)}`);
      assert(word.glyphTopSpreadEm < 0.2,
        `${label} source glyphs must remain on one horizontal row apart from emphasis motion: ${JSON.stringify(word)}`);
      assert(word.columnWidth <= Math.max(word.sourceWidth, word.romanWidth) + 2,
        `${label} word columns must not gain elastic empty width: ${JSON.stringify(word)}`);
      assert(word.maskFadeWidth != null && word.expectedSourceFadeWidth != null
        && Math.abs(word.maskFadeWidth - word.expectedSourceFadeWidth) < 1,
      `${label} romanization must not widen the main lyric fade: ${JSON.stringify(word)}`);
      assert.equal(word.sourceMotionCount, 1,
        `${label} must keep exactly one source motion layer after remount or reflow: ${JSON.stringify(word)}`);
      assert.equal(word.sourceFloatAnimationCount, 1,
        `${label} must keep exactly one source float animation: ${JSON.stringify(word)}`);
      assert(word.sourceFloatKeyframes.some(transform => /translateY\(-0\.(?:05|1)em\)/.test(String(transform))),
        `${label} source motion must retain AMLL's upward target: ${JSON.stringify(word)}`);
      assert.equal(word.romanFloatAnimationCount, 0,
        `${label} romanization must remain outside the float animation: ${JSON.stringify(word)}`);
    });
  };
  assertAppleKoreanWordColumns(snapshot.appleKoreanAlignmentFirst, [
    ['들려줄게', 'deul ryeo jul ge'],
    ['네게', 'ne ge'],
  ], 'mixed single/split Apple line 들려줄게 네게');
  const glowingAlignmentRow = snapshot.appleKoreanAlignmentFirst.find(row =>
    row.appleKoreanWordColumns.some(word => word.sourceText === '들려줄게'));
  assert(glowingAlignmentRow.emphasisAnimations.length > 0,
    `moving source glyphs into a horizontal word column must preserve AMLL emphasis/glow animations: ${JSON.stringify(glowingAlignmentRow)}`);
  assertAppleKoreanWordColumns(snapshot.appleKoreanAlignmentSecond, [
    ['해독하고', 'hae dok ha go'],
    ['싶어', 'si peo'],
    ['Baby', 'Baby'],
  ], 'mixed Korean/English Apple line 해독하고 싶어 Baby');
  assertAppleKoreanWordColumns(snapshot.appleKoreanAlignmentThird, [
    ['생각해', 'saeng gak hae'],
    ['종일', 'jong il'],
    ['너만', 'neo man'],
  ], 'first-word alignment Apple line 생각해 종일 너만');
  assertAppleKoreanWordColumns(snapshot.appleKoreanAlignmentRescaled, [
    ['생각해', 'saeng gak hae'],
    ['종일', 'jong il'],
    ['너만', 'neo man'],
  ], 'rescaled Apple line 생각해 종일 너만');
  const regularAlignmentWord = snapshot.appleKoreanAlignmentThird
    .flatMap(row => row.appleKoreanWordColumns).find(word => word.sourceText === '생각해');
  const rescaledAlignmentWord = snapshot.appleKoreanAlignmentRescaled
    .flatMap(row => row.appleKoreanWordColumns).find(word => word.sourceText === '생각해');
  assert(parseFloat(rescaledAlignmentWord.romanFontSize) > parseFloat(regularAlignmentWord.romanFontSize),
    `Apple word columns must immediately remeasure after romanization size changes: ${JSON.stringify({
      regularAlignmentWord,
      rescaledAlignmentWord,
    })}`);
  assert(Math.abs(rescaledAlignmentWord.maskFadeWidth - regularAlignmentWord.maskFadeWidth) < 1,
    `changing romanization size must not change the original lyric fade width: ${JSON.stringify({
      regularAlignmentWord,
      rescaledAlignmentWord,
    })}`);
  assertAppleKoreanWordColumns(snapshot.appleKoreanLexicalVirtualized, [
    ['세상의', 'se sang ui'],
    ['장면', 'jang myeon'],
    ['중', 'jung'],
  ], 'virtualized Apple word layout 세상의 장면 중');
  assertAppleKoreanWordColumns(snapshot.appleKoreanLexicalBackground, [
    ['세상의', 'se sang ui'],
    ['장면', 'jang myeon'],
    ['중', 'jung'],
  ], 'background Apple word layout 세상의 장면 중');
  const narrowWordRow = snapshot.appleKoreanAlignmentNarrow.find(row =>
    row.appleKoreanWordColumns.some(word => word.sourceText === '생각해'));
  assert(narrowWordRow, 'narrow Apple Korean word layout must remain mounted');
  assert(new Set(narrowWordRow.appleKoreanWordColumns.map(word => Math.round(word.columnTop))).size > 1,
    `narrow Apple Korean lyrics must wrap only between complete word columns: ${JSON.stringify(narrowWordRow)}`);
  narrowWordRow.appleKoreanWordColumns.forEach(word => assert(word.glyphTopSpreadEm < 0.2,
    `narrow layout must never split a source word into vertical glyphs: ${JSON.stringify(word)}`));

  snapshot.removedOpacitySettings.forEach(key => {
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot.savedSettings, key), false,
      `${key} must be removed from persisted settings`);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot.reloadSettings, key), false,
      `${key} must remain absent after a real document reload`);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot.resetState.settings, key), false,
      `${key} must remain absent after restoring defaults`);
  });
  assert.equal(snapshot.savedSettings.futureBlur, 1.25,
    'a retained setting change must trigger normalized persistence');
  assert.equal(snapshot.reloadSettings.futureBlur, 1.25,
    'retained settings must survive reload while obsolete opacity fields stay removed');
  assert(Math.abs(Number(snapshot.resetState.brightMaskAlpha) - 1) < 0.01,
    `reset must preserve the fixed sung mask, received ${snapshot.resetState.brightMaskAlpha}`);
  assert(Math.abs(Number(snapshot.resetState.darkMaskAlpha) - 0.58) < 0.01,
    `reset must preserve the fixed unsung mask, received ${snapshot.resetState.darkMaskAlpha}`);
  assert.deepEqual(snapshot.disabledLifecycle, {
    settingsEnabled:false,
    bodyActive:false,
    stageActive:false,
    stageAriaHidden:'true',
    stageInert:true,
    surfacePointerEvents:'none',
    regularLyricsVisible:true,
    lyricsPreserved:true,
    reloadCalls:0,
    playerCount:0,
    playerAnimationCount:0,
    hitTarget:'amll-disable-drag-target',
    dragReceived:true,
  }, `disabling AMLL must synchronously restore the ordinary lyric stage and release interaction: ${JSON.stringify(snapshot.disabledLifecycle)}`);
  assert.deepEqual(snapshot.failedRendererLifecycle, {
    attempts:1,
    playerCount:0,
    surfaceChildren:0,
  }, `a failed AMLL renderer must be cleaned once and blocked from frame-by-frame recreation: ${JSON.stringify(snapshot.failedRendererLifecycle)}`);
  assert.deepEqual(snapshot.repeatedToggleLifecycle, {
    reloadCalls:0,
    playerCount:0,
    regularLyricsVisible:true,
    surfacePointerEvents:'none',
  }, `repeated AMLL toggles must not leak players, animations, or lyric reloads: ${JSON.stringify(snapshot.repeatedToggleLifecycle)}`);
  console.log('AMLL browser opacity runtime: PASS');
} finally {
  fs.rmSync(profileDir, { recursive:true, force:true });
}
