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

function evaluateFunctions(markers, extras = {}) {
  const context = { Math, Number, String, Array, Object, isFinite, ...extras };
  vm.createContext(context);
  vm.runInContext(markers.map(functionSource).join('\n'), context);
  return context;
}

function verifyWordProgressUsesOnlySourceTimings() {
  const context = { Math, Number, isFinite };
  vm.createContext(context);
  vm.runInContext(`${functionSource('function getLyricLineProgress(line, nextLine, now)')}; this.progress = getLyricLineProgress;`, context);
  const line = {
    t: 0,
    duration: 1.5,
    text: 'AB',
    charCount: 2,
    karaokeTimeline: [
      { text: 'A', start: 0, duration: 1, c0: 0, c1: 1, timed: true },
      { text: 'B', start: 1, duration: 0.5, c0: 1, c1: 2, timed: true },
    ],
  };
  assert.equal(context.progress(line, null, 0.5), 0.25, 'Halfway through the first timed word should mean 25% of the two-character line');
  assert.equal(context.progress(line, null, 1.25), 0.75, 'Halfway through the second timed word should mean 75%');
  assert.equal(context.progress(line, null, 1.5), 1, 'The highlight should finish exactly when the final source word ends');
  assert.equal(context.progress(line, { t: 20 }, 12), 1, 'The highlight must remain stopped during a long instrumental gap');

  const lrcLine = { t: 0, text: 'Line lyric', charCount: 10, source: 'lrc' };
  assert.equal(context.progress(lrcLine, { t: 10 }, 0.1), 1, 'LRC without word timings should display as a complete line instead of inventing karaoke progress');
  const incompleteNativeLine = { t: 0, text: 'AB', charCount: 2, karaokeTimeline: [{ text: 'B', start: 1, duration: 0.5, c0: 1, c1: 2, timed: true }] };
  assert.ok(Math.abs(context.progress(incompleteNativeLine, null, 1.1) - 0.6) < 1e-9,
    'Missing word timing must no longer invalidate otherwise legal source-timed nodes');
}

function verifyOverlappingQrcUsesTheRightmostSourceProgress() {
  const context = evaluateFunctions(['function getLyricLineProgress(line, nextLine, now)']);
  const line = {
    t: 0,
    sourceEnd: 3,
    text: 'AB',
    charCount: 2,
    source: 'qrc-word',
    karaokeTimeline: [
      { text: 'A', start: 0, duration: 2, c0: 0, c1: 1, timed: true },
      { text: 'B', start: 1, duration: 2, c0: 1, c1: 2, timed: true },
    ],
  };
  assert.equal(context.getLyricLineProgress(line, null, 1.5), 0.625,
    'Overlapping QRC words should advance to the rightmost source-timed frontier instead of disabling karaoke');
}

function verifyOutOfOrderQrcStillUsesTheRightmostTextFrontier() {
  const context = evaluateFunctions(['function getLyricLineProgress(line, nextLine, now)']);
  const line = {
    t: 0,
    sourceEnd: 4,
    text: 'ABC',
    charCount: 3,
    source: 'qrc-word',
    karaokeTimeline: [
      { text: 'A', start: 2, duration: 1, c0: 0, c1: 1, timed: true },
      { text: 'B', start: 0, duration: 4, c0: 1, c1: 2, timed: true },
      { text: 'C', start: 1, duration: 2, c0: 2, c1: 3, timed: true },
    ],
  };
  assert.equal(context.getLyricLineProgress(line, null, 2), 5 / 6,
    'Out-of-order QRC timestamps must be trusted while the visual frontier stays at the rightmost active text node');
}

function verifyZeroDurationQrcNodesCompleteInstantly() {
  const context = evaluateFunctions(['function getLyricLineProgress(line, nextLine, now)']);
  const line = {
    t: 0,
    sourceEnd: 2,
    text: 'AB',
    charCount: 2,
    source: 'qrc-word',
    karaokeTimeline: [
      { text: 'A', start: 0.5, duration: 0, c0: 0, c1: 1, timed: true },
      { text: 'B', start: 1, duration: 1, c0: 1, c1: 2, timed: true },
    ],
  };
  assert.equal(context.getLyricLineProgress(line, null, 0.499), 0, 'A zero-duration node must not highlight early');
  assert.equal(context.getLyricLineProgress(line, null, 0.5), 0.5, 'A zero-duration node should complete exactly at its source start');
}

function verifyNativeParsersPreserveExactSourceTiming() {
  const context = evaluateFunctions([
    'function finalizeLyricLineDurations(lines)',
    'function parseYrcText(text)',
    'function decodeQrcXmlText(text)',
    'function parseQrcText(text)',
  ]);
  const qrc = context.parseQrcText('[1000,4000]A(1000,1000)B(2000,2500)');
  assert.equal(qrc.length, 1);
  assert.equal(qrc[0].sourceEnd, 5, 'QRC line end must preserve the source line duration');
  assert.equal(qrc[0].karaokeTimeline[0].duration, 1, 'QRC word duration must not receive a minimum-duration correction');
  assert.equal(qrc[0].karaokeTimeline[0].start, 1, 'QRC word starts must be read directly from the source timeline');
  assert.equal(qrc[0].karaokeTimeline[1].duration, 2.5);
  assert.equal(Object.prototype.hasOwnProperty.call(qrc[0], 'words'), false, 'QRC should retain one canonical pre-parsed timeline instead of a duplicate words model');

  const yrc = context.parseYrcText('[1000,4000](1000,1000,0)A(2000,2500,0)B');
  assert.equal(yrc.length, 1);
  assert.equal(yrc[0].sourceEnd, 5, 'YRC line end must preserve the source line duration');
  assert.equal(yrc[0].text, 'AB');
  assert.equal(yrc[0].source, 'yrc-line', 'YRC should be retained only as line-timed text');
  assert.equal(Object.prototype.hasOwnProperty.call(yrc[0], 'words'), false, 'YRC must never expose word timing to the karaoke engine');
  assert.equal(Array.isArray(yrc[0].karaokeTimeline), false);

  const invalid = context.parseQrcText('[0,2000]A(0,0)B(1000,500)');
  assert.equal(invalid[0].karaokeTimeline.length, 2, 'Zero-duration QRC nodes remain valid source-timed nodes');
  assert.equal(invalid[0].karaokeTimeline[0].duration, 0);
  assert.equal(invalid[0].karaokeTimeline[0].timed, true);
  const negative = context.parseQrcText('[0,2000]A(-100,500)B(1000,500)');
  assert.equal(negative[0].text, 'AB');
  assert.equal(negative[0].karaokeTimeline[0].timed, false, 'Negative source tuples become untimed nodes without invalidating the line');
  assert.equal(negative[0].karaokeTimeline[1].timed, true);
}

function verifyRealQrcKeepsKaraokeProgress() {
  const context = evaluateFunctions([
    'function finalizeLyricLineDurations(lines)',
    'function decodeQrcXmlText(text)',
    'function parseQrcText(text)',
    'function getLyricLineProgress(line, nextLine, now)',
  ]);
  const lines = context.parseQrcText("[19488,670]cause (19488,210)you're (19698,260)a(19958,200)");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].karaokeTimeline.length > 1, 'The QRC fixture must exercise multiple consecutive source-timed words');
  const halfwayThroughFirstWord = context.getLyricLineProgress(lines[0], null, 19.593);
  assert.ok(halfwayThroughFirstWord > 0 && halfwayThroughFirstWord < 1,
    'A real millisecond QRC line must retain partial karaoke progress instead of degrading to a fully highlighted line');

  const fullSourceLine = context.parseQrcText("[19488,2660]cause (19488,210)you're (19698,260)a (19958,200)sky (20158,1130)full (21288,220)of (21508,260)stars(21768,380)")[0];
  const fullSourceProgress = context.getLyricLineProgress(fullSourceLine, null, 19.593);
  assert.ok(fullSourceProgress > 0 && fullSourceProgress < 1,
    'The original multi-word QRC reproduction should keep its karaoke sweep');
}

function verifyQrcBadNodesPreserveTextAndValidKaraoke() {
  const context = evaluateFunctions([
    'function finalizeLyricLineDurations(lines)',
    'function decodeQrcXmlText(text)',
    'function parseQrcText(text)',
    'function getLyricLineProgress(line, nextLine, now)',
  ]);
  const line = context.parseQrcText('[0,2000]A(-100,500)B(1000,1000)')[0];
  assert.equal(line.text, 'AB', 'Malformed QRC timing must not delete its lyric text');
  assert.equal(line.karaokeTimeline.length, 2);
  assert.equal(line.karaokeTimeline[0].timed, false, 'A negative source timestamp should become an untimed node');
  assert.equal(line.karaokeTimeline[1].timed, true);
  assert.equal(context.getLyricLineProgress(line, null, 1.5), 0.75,
    'A valid later word should retain karaoke even when an earlier word has bad timing');
  assert.equal(context.getLyricLineProgress(line, null, 2), 1,
    'A line containing bad nodes should finish at the QRC source line end');

  const trailingBad = context.parseQrcText('[0,3000]A(0,1000)B(-1,500)')[0];
  assert.equal(context.getLyricLineProgress(trailingBad, null, 2.999), 0.5,
    'An untimed trailing node must not invent a sweep before the source line ends');
  assert.equal(context.getLyricLineProgress(trailingBad, null, 3), 1,
    'The source line end must complete a line that contains an untimed trailing node');

  const nonNumeric = context.parseQrcText('[0,2500]A(oops,500)B(1000,1000)')[0];
  assert.equal(nonNumeric.text, 'AB', 'A non-numeric QRC tuple must be removed without deleting its word text');
  assert.equal(nonNumeric.karaokeTimeline[0].timed, false, 'A non-numeric QRC tuple should become an untimed node');
  assert.equal(nonNumeric.karaokeTimeline[1].text, 'B', 'A later valid tuple must apply only to its own preceding word');
}

function verifyQrcXmlWrapperIsDecodedBeforeParsing() {
  const context = evaluateFunctions([
    'function finalizeLyricLineDurations(lines)',
    'function decodeQrcXmlText(text)',
    'function parseQrcText(text)',
  ]);
  const wrapped = '<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[0,2000]A(0,1000)B(1000,1000)&#10;[3000,1000]C(3000,1000)"/></QrcInfos>';
  const lines = context.parseQrcText(wrapped);
  assert.equal(lines.length, 2, 'QQ QRC XML payloads should expose their embedded LyricContent lines');
  assert.equal(lines[0].text, 'AB');
  assert.equal(lines[0].karaokeTimeline.length, 2);
}

function verifyTimelineStateIsClonedWithoutSharingNodes() {
  const context = evaluateFunctions(['function cloneLyricLine(line)']);
  const source = {
    text: 'A',
    words: [{ text: 'A', t: 0, d: 1, c0: 0, c1: 1 }],
    karaokeTimeline: [{ text: 'A', start: 0, duration: 1, c0: 0, c1: 1, timed: true }],
  };
  const clone = context.cloneLyricLine(source);
  assert.notEqual(clone.karaokeTimeline, source.karaokeTimeline, 'The pre-parsed QRC timeline array must be cloned with lyric state');
  assert.notEqual(clone.karaokeTimeline[0], source.karaokeTimeline[0], 'Timeline nodes must not be shared across original/custom lyric state');

  const legacyClone = context.cloneLyricLine({ text: 'B', words: [{ text: 'B', t: 1, d: 2, c0: 0, c1: 1 }] });
  assert.equal(Object.prototype.hasOwnProperty.call(legacyClone, 'words'), false, 'Legacy word arrays should be normalized at the state boundary');
  assert.deepEqual(JSON.parse(JSON.stringify(legacyClone.karaokeTimeline)), [
    { text: 'B', start: 1, duration: 2, c0: 0, c1: 1, timed: true },
  ]);
}

function verifyCustomQrcXmlUsesTheWordTimelineParser() {
  const context = evaluateFunctions([
    'function finalizeLyricLineDurations(lines)',
    'function decodeQrcXmlText(text)',
    'function parseQrcText(text)',
    'function parseCustomLyricText(text)',
  ], {
    parseYrcText: () => [],
    parseLyricText: () => [],
    isNoLyricText: () => false,
    audio: null,
  });
  const wrapped = '<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[0,2000]A(0,1000)B(1000,1000)"/></QrcInfos>';
  const lines = context.parseCustomLyricText(wrapped);
  assert.equal(lines.length, 1, 'A custom QQ QRC XML payload should not degrade to plain custom text');
  assert.equal(lines[0].source, 'qrc-word');
  assert.equal(lines[0].karaokeTimeline.length, 2);
}

function verifyPayloadResolutionUsesOnlyQqQrcForKaraoke() {
  const context = evaluateFunctions([
    'function lyricTagTimeToSeconds(min, sec, frac)',
    'function finalizeLyricLineDurations(lines)',
    'function parseLyricText(text)',
    'function decodeQrcXmlText(text)',
    'function parseQrcText(text)',
    'function isNoLyricText(text)',
    'function isLeadingLyricCreditText(text)',
    'function stripLeadingLyricCredits(lines)',
    'function resolveLyricPayload(payload)',
  ]);
  const qqQrc = context.resolveLyricPayload({
    provider: 'qq',
    qrc: '[0,2000]A(0,1000)B(1000,1000)',
    lyric: '[00:00]QQ line',
  });
  assert.equal(qqQrc.timingSource, 'qrc-word');
  assert.equal(qqQrc.hasNativeKaraoke, true);

  const qqBrokenQrc = context.resolveLyricPayload({
    provider: 'qq',
    qrc: '[0,2000]No usable word timing',
    lyric: '[00:00]QQ fallback line',
  });
  assert.equal(qqBrokenQrc.timingSource, 'lrc-line', 'QQ LRC should replace a QRC payload with no timed nodes');
  assert.equal(qqBrokenQrc.lines[0].text, 'QQ fallback line');

  const qqPlaceholderQrc = context.resolveLyricPayload({
    provider: 'qq',
    qrc: '[0,2000]暂无歌词(0,2000)',
    lyric: '[00:00]QQ real LRC',
  });
  assert.equal(qqPlaceholderQrc.timingSource, 'lrc-line', 'A timed QQ placeholder must not block the same QQ payload LRC');
  assert.equal(qqPlaceholderQrc.lines[0].text, 'QQ real LRC');

  const qqPlaceholderOnly = context.resolveLyricPayload({ provider: 'qq', lyric: '[00:00]纯音乐，请欣赏' });
  assert.equal(qqPlaceholderOnly.timingSource, 'fallback', 'QQ placeholder LRC should remain unusable so automatic matching can continue to NetEase');
  assert.equal(qqPlaceholderOnly.lines.length, 0);

  const netease = context.resolveLyricPayload({
    provider: 'netease',
    yrc: '[0,2000](0,1000,0)A(1000,1000,0)B',
    lyric: '[00:00]NetEase line only',
  });
  assert.equal(netease.timingSource, 'lrc-line', 'NetEase YRC must be ignored permanently');
  assert.equal(netease.hasNativeKaraoke, false);
  assert.equal(netease.lines[0].text, 'NetEase line only');

  const yrcOnly = context.resolveLyricPayload({ provider: 'netease', yrc: '[0,1000](0,1000,0)A' });
  assert.equal(yrcOnly.timingSource, 'fallback', 'NetEase YRC alone is not a usable lyric result');
  assert.equal(yrcOnly.lines.length, 0);
}

function verifyLeadingCreditsAreRemovedWithoutTouchingLyrics() {
  const context = evaluateFunctions(['function isLeadingLyricCreditText(text)', 'function stripLeadingLyricCredits(lines)']);
  const lines = [
    { t: 1, text: '作词：Alice' },
    { t: 3, text: '编曲 / Bob' },
    { t: 10, text: '第一句真实歌词' },
    { t: 20, text: '作词的人也会唱歌' },
  ];
  const filtered = JSON.parse(JSON.stringify(context.stripLeadingLyricCredits(lines)));
  assert.deepEqual(filtered.map((line) => line.text), ['第一句真实歌词', '作词的人也会唱歌'],
    'Only the leading metadata block should be removed');
  assert.equal(filtered[0].t, 10, 'The first real lyric timestamp must stay unchanged so the intro gap can be detected');
}

function verifyBlankSegmentRules() {
  const context = evaluateFunctions([
    'function lyricLineFirstTimedStart(line)',
    'function lyricLineTimedEnd(line)',
    'function lyricLineTimingIsReliable(line)',
    'function parseLrcBlankMarkers(text)',
    'function buildLyricBlankSegments(lines, options)',
    'function getActiveLyricBlankSegment(segments, now)',
    'function getLyricBreathDotState(segment, now)',
  ], { lyricTagTimeToSeconds(min, sec, frac) {
    let value = Number(min) * 60 + Number(sec);
    if (frac) value += Number(frac) / (10 ** Math.min(3, frac.length));
    return value;
  } });

  const nativeLines = [
    { t: 0, sourceEnd: 3, source: 'qrc-word', karaokeTimeline: [{ start: 0, duration: 3, c0: 0, c1: 1, timed: true }] },
    { t: 10, sourceEnd: 12, source: 'qrc-word', karaokeTimeline: [{ start: 10, duration: 2, c0: 0, c1: 1, timed: true }] },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(context.buildLyricBlankSegments(nativeLines, { timingSource: 'qrc-word' }))), [
    { start: 3, end: 10, duration: 7, kind: 'between' },
  ], 'Native blank segments should span exact source line end to next source word start');

  const exactFive = [
    { t: 0, sourceEnd: 3, source: 'qrc-word', karaokeTimeline: [{ start: 0, duration: 3, c0: 0, c1: 1, timed: true }] },
    { t: 8, sourceEnd: 9, source: 'qrc-word', karaokeTimeline: [{ start: 8, duration: 1, c0: 0, c1: 1, timed: true }] },
  ];
  assert.equal(context.buildLyricBlankSegments(exactFive, { timingSource: 'qrc-word' }).length, 0, 'A gap of exactly five seconds is not eligible');

  const introNine = [{ t: 9, sourceEnd: 10, source: 'qrc-word', karaokeTimeline: [{ start: 9, duration: 1, c0: 0, c1: 1, timed: true }] }];
  assert.deepEqual(JSON.parse(JSON.stringify(context.buildLyricBlankSegments(introNine, { timingSource: 'qrc-word' }))), [
    { start: 0, end: 9, duration: 9, kind: 'intro' },
  ]);
  const introEight = [{ t: 8, sourceEnd: 9, source: 'qrc-word', karaokeTimeline: [{ start: 8, duration: 1, c0: 0, c1: 1, timed: true }] }];
  assert.deepEqual(JSON.parse(JSON.stringify(context.buildLyricBlankSegments(introEight, { timingSource: 'qrc-word' }))), [
    { start: 0, end: 8, duration: 8, kind: 'intro' },
  ], 'An intro of exactly eight seconds should create dots');
  const introWithUntimedFirstLine = [{ t: 9, sourceEnd: 10, source: 'qrc-line', karaokeTimeline: [{ text: 'A', start: null, duration: null, c0: 0, c1: 1, timed: false }] }];
  assert.deepEqual(JSON.parse(JSON.stringify(context.buildLyricBlankSegments(introWithUntimedFirstLine, { timingSource: 'qrc-word' }))), [
    { start: 0, end: 9, duration: 9, kind: 'intro' },
  ], 'A valid QRC line start should still define a long intro when its word tuple is unusable');

  const overlap = [
    { t: 0, sourceEnd: 6, source: 'qrc-word', karaokeTimeline: [{ start: 0, duration: 6, c0: 0, c1: 1, timed: true }] },
    { t: 5, sourceEnd: 7, source: 'qrc-word', karaokeTimeline: [{ start: 5, duration: 2, c0: 0, c1: 1, timed: true }] },
  ];
  assert.equal(context.buildLyricBlankSegments(overlap, { timingSource: 'qrc-word' }).length, 0, 'Overlapping source timing must not be repaired into a blank segment');
  const wordOverlap = [
    { t: 0, sourceEnd: 4, text: 'AB', charCount: 2, source: 'qrc-word', karaokeTimeline: [{ start: 0, duration: 4, c0: 0, c1: 1, timed: true }, { start: 3, duration: 1, c0: 1, c1: 2, timed: true }] },
    { t: 10, sourceEnd: 11, text: 'C', charCount: 1, source: 'qrc-word', karaokeTimeline: [{ start: 10, duration: 1, c0: 0, c1: 1, timed: true }] },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(context.buildLyricBlankSegments(wordOverlap, { timingSource: 'qrc-word' }))), [
    { start: 4, end: 10, duration: 6, kind: 'between' },
  ], 'Overlapping word timings remain legal and should still expose the exact source-defined instrumental gap');
  const unreliableLineEnd = [
    { t: 0, sourceEnd: 1, source: 'qrc-word', karaokeTimeline: [{ start: 0, duration: 3, c0: 0, c1: 1, timed: true }] },
    { t: 10, sourceEnd: 11, source: 'qrc-word', karaokeTimeline: [{ start: 10, duration: 1, c0: 0, c1: 1, timed: true }] },
  ];
  assert.equal(context.buildLyricBlankSegments(unreliableLineEnd, { timingSource: 'qrc-word' })[0].start, 3, 'A source line end earlier than the last word should fall back to the last word end');
  assert.equal(context.buildLyricBlankSegments([{ t: 0, sourceEnd: 1, source: 'qrc-word', karaokeTimeline: [{ start: 0, duration: 1, c0: 0, c1: 1, timed: true }] }], { timingSource: 'qrc-word' }).length, 0, 'Outro gaps must never create dots');

  const lrcLines = [{ t: 0, text: 'A', source: 'lrc' }, { t: 20, text: 'B', source: 'lrc' }];
  const lrcSegments = context.buildLyricBlankSegments(lrcLines, { timingSource: 'lrc-line', lrcText: '[00:00]A\n[00:10.00]\n[00:20]B' });
  assert.deepEqual(JSON.parse(JSON.stringify(lrcSegments)), [{ start: 10, end: 20, duration: 10, kind: 'between' }]);
  assert.equal(context.buildLyricBlankSegments(lrcLines, { timingSource: 'lrc-line', lrcText: '[00:00]A\n[00:10]间奏\n[00:20]B' }).length, 0, 'Text such as 间奏 must not be treated as a blank marker');

  const segment = { start: 10, end: 19, duration: 9, kind: 'between' };
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLyricBreathDotState(segment, 12.25).pulses)), [1, 0, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLyricBreathDotState(segment, 14.5).pulses)), [1, 1, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLyricBreathDotState(segment, 16.75).pulses)), [1, 1, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getLyricBreathDotState(segment, 18.5).pulses)), [1, 1, 1],
    'The final quarter should hold all dots at their completed state');
  assert.equal(context.getActiveLyricBlankSegment([segment], 19), null, 'The dots stop exactly at the next lyric boundary');
}

function verifyThreeDimensionalDotsAreClockDriven() {
  assert.match(html, /lyricsBlankSegments\s*=\s*\[\]/, 'The active lyric state should retain parsed blank segments');
  assert.match(html, /function buildLyricBreathDotsMesh\(\)/, 'The main 3D lyric stage should provide a dedicated dots mesh');
  assert.match(html, /function showStageBreathDots\(segment\)/, 'Blank segments should replace the current lyric with breathing dots');
  assert.match(html, /getActiveLyricBlankSegment\(lyricsBlankSegments, t\)/, 'Dot selection must use the delay-adjusted lyric playback clock');
  assert.match(html, /getLyricBreathDotState\(activeBlank, t\)/, 'Dot breathing must be sampled from the lyric clock on every tick');
  assert.doesNotMatch(html, /if \(!playing[^\n]+breathDots\) return;/, 'Paused dots must still resample after seeking or changing lyric delay');
  assert.doesNotMatch(html, /lyric-breath[^\n]*animation\s*:/i, 'Breathing must not run on an independent CSS animation clock');
  assert.match(functionSource('function applyLyricPaletteToMesh(mesh)'), /data\.dotHighlightColor = new THREE\.Color\(0xffffff\)/,
    'Palette refreshes must keep completed dots pure white');
  assert.match(html, /data\.dots\[di\]\.scale\.setScalar\(0\.86 \+ dotPulse \* 0\.64\)/,
    'Completed dots should remain at 1.5 times scale');
  assert.match(html, /data\.dotMaterials\[di\]\.opacity = dotPulse >= 0\.999999 \? 1 : opacity \* \(0\.30 \+ dotPulse \* 0\.70\)/,
    'Completed dots should hold at exact full material opacity');
  const desktopSnapshot = functionSource('function currentDesktopLyricSnapshot()');
  assert.match(desktopSnapshot, /var t = getLyricPlaybackSeconds\(\)/,
    'Desktop lyrics must sample the same delay-adjusted playback clock as the 3D lyrics');
  assert.match(desktopSnapshot, /getLyricLineProgress\(curLine, nextLine, t\)/,
    'Desktop and 3D lyrics must share the same source-timeline progress engine');
  assert.doesNotMatch(desktopSnapshot, /t\s*\+\s*0\.05/,
    'Desktop line selection must not add an independent timing offset');
}

function verifyPausedDotsRealignAfterSeek() {
  let now = 14.5;
  const rendered = [];
  const context = {
    Math, Number, Array, Object, String, JSON, isFinite,
    fx: { particleLyrics: true, spotifyMode: true },
    playing: false,
    audio: null,
    lyricsLines: [{ t: 0, text: 'A', charCount: 1 }, { t: 19, text: 'B', charCount: 1 }],
    lyricsBlankSegments: [{ start: 10, end: 19, duration: 9, kind: 'between' }],
    stageLyrics: {
      currentIdx: -3,
      currentText: '__lyric_breath_dots__10:19',
      current: { userData: { lyric: { breathDots: true } } },
      outgoing: [],
    },
    getLyricPlaybackSeconds: () => now,
    clearStageLyrics() {},
    showStageBreathDots() {},
    updateLyricBreathDots(mesh, state) { mesh.userData.lyric.breathState = state; },
    showStageLine(line) {
      rendered.push(line.text);
      context.stageLyrics.current = { userData: { lyric: {} } };
      context.stageLyrics.currentText = line.text;
    },
    getLyricLineProgress: () => 1,
    updateLyricMeshProgress() {},
    currentLyricFallbackText: () => '',
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource('function getActiveLyricBlankSegment(segments, now)'),
    functionSource('function getLyricBreathDotState(segment, now)'),
    functionSource('function tickLyricsParticles()'),
    'this.tick = tickLyricsParticles;',
  ].join('\n'), context);
  context.tick();
  assert.deepEqual(JSON.parse(JSON.stringify(context.stageLyrics.current.userData.lyric.breathState.pulses)), [1, 1, 0], 'Paused dots should remain sampled at the frozen lyric time');
  now = 19;
  context.tick();
  assert.deepEqual(rendered, ['B'], 'Seeking past the blank while paused should immediately replace dots with the target lyric');
}

verifyWordProgressUsesOnlySourceTimings();
verifyOverlappingQrcUsesTheRightmostSourceProgress();
verifyOutOfOrderQrcStillUsesTheRightmostTextFrontier();
verifyZeroDurationQrcNodesCompleteInstantly();
verifyNativeParsersPreserveExactSourceTiming();
verifyRealQrcKeepsKaraokeProgress();
verifyQrcBadNodesPreserveTextAndValidKaraoke();
verifyQrcXmlWrapperIsDecodedBeforeParsing();
verifyTimelineStateIsClonedWithoutSharingNodes();
verifyCustomQrcXmlUsesTheWordTimelineParser();
verifyPayloadResolutionUsesOnlyQqQrcForKaraoke();
verifyLeadingCreditsAreRemovedWithoutTouchingLyrics();
verifyBlankSegmentRules();
verifyThreeDimensionalDotsAreClockDriven();
verifyPausedDotsRealignAfterSeek();
console.log('Lyric source timeline and interludes: PASS');
