(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MineradioLyricCreditFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var CHINESE_LABELS = [
    '歌曲名称', '歌曲名', '歌名', '制作统筹', '配唱制作人', '人声编辑', '音频编辑',
    '录音工程师', '混音工程师', '母带工程师', '和声编写', '和声设计', '弦乐编写',
    '出品人', '作词', '填词', '歌词', '作曲', '编曲', '制作人', '制作', '录音师',
    '录音', '混音师', '混音', '母带师', '母带', '和声', '监制', '统筹', '出品',
    '策划', '宣发', '演唱者', '演唱', '歌手', '吉他', '贝斯', '鼓手', '鼓',
    '弦乐', '钢琴', '键盘', '发行', '出版', '版权', 'OP', 'SP', '词', '曲'
  ];
  var ENGLISH_BY_LABELS = [
    'Lyrics by', 'Lyric by', 'Written by', 'Composed by', 'Music by', 'Arranged by',
    'Produced by', 'Mixed by', 'Mastered by', 'Recorded by', 'Vocals by', 'Vocal by',
    'Performed by', 'Published by'
  ];
  var ENGLISH_LABELS = [
    'Song Title', 'Songwriters', 'Songwriter', 'Lyricists', 'Lyricist', 'Composers',
    'Composer', 'Arrangers', 'Arranger', 'Executive Producers', 'Executive Producer',
    'Vocal Producers', 'Vocal Producer', 'Producers', 'Producer',
    'Mixing & Mastering', 'Mixing and Mastering', 'Mixing Engineers', 'Mixing Engineer',
    'Mixing', 'Mastering Engineers', 'Mastering Engineer', 'Mastering',
    'Recording Engineers', 'Recording Engineer', 'Recording', 'Background Vocals',
    'Background Vocal', 'Publishers', 'Publisher', 'Copyright', 'Guitarists', 'Guitarist',
    'Guitars', 'Guitar', 'Bassists', 'Bassist', 'Bass', 'Drummers', 'Drummer', 'Drums',
    'Drum', 'Strings', 'String', 'Piano', 'Keyboards', 'Keyboard', 'Studio'
  ];
  var COMPACT_CHINESE_LABELS = [
    '制作统筹', '配唱制作人', '人声编辑', '音频编辑', '录音工程师', '混音工程师',
    '母带工程师', '和声编写', '和声设计', '弦乐编写', '出品人', '制作人',
    '录音师', '混音师', '母带师', '演唱者', '作词', '填词', '作曲', '编曲',
    '录音', '混音', '母带', '监制', '统筹', '出品', '策划', '宣发', '吉他',
    '贝斯', '鼓手', '弦乐', '钢琴', '键盘', '发行', '出版'
  ];
  var COMPACT_ENGLISH_LABELS = ENGLISH_BY_LABELS.concat([
    'Songwriter', 'Lyricist', 'Composer', 'Arranger', 'ExecutiveProducer',
    'VocalProducer', 'Producer', 'MixingEngineer', 'Mixing', 'MasteringEngineer',
    'Mastering', 'RecordingEngineer', 'Recording', 'Publisher'
  ]);
  var ENGLISH_SENTENCE_WORDS = {
    of:1, in:1, for:1, is:1, was:1, were:1, to:1, from:1, with:1, and:1, or:1
  };
  var CHINESE_SENTENCE_PREFIXES = /^(?:的|是|了|着|过|在|把|将|我|你|他|她|它|这|那|为|与|和|却|而|让|要|会|能|都|也)/;
  var SEPARATOR_PREFIX = /^\s*[:：/／|｜=＝\-—–]+\s*/;
  var TRANSLATION_PLATFORM = '(?:QQ\\s*音乐|QQ\\s*Music|网易云音乐|网易云|NetEase\\s*Cloud\\s*Music)';
  var TRANSLATION_METADATA_PATTERNS = [
    new RegExp('^(?:歌词)?翻译(?:版权)?(?:由|来自)?\\s*' + TRANSLATION_PLATFORM + '\\s*(?:版权所有)?$', 'i'),
    new RegExp('^' + TRANSLATION_PLATFORM + '\\s*(?:歌词)?翻译(?:版权)?\\s*(?:版权所有)?$', 'i'),
    /^(?:歌词|翻译)(?:版权|版权所有)(?:声明)?$/i,
    /^(?:translation|translated)\s*(?:by|from|copyright)\b/i,
    /^(?:lyrics?\s+)?translation\s+copyright\b/i
  ];
  var LYRIC_METADATA_SANITIZED_VERSION = 1;
  var TIMED_LYRIC_PREFIX = /^(\s*(?:\[(?:\d{1,2}:\d{1,2}(?:\.\d{1,3})?|\d+,\d+)\]\s*)+)/;
  var LYRIC_ROW_BREAK = /(\r\n|\n|&#10;|&#x0*A;)/i;

  function unwrap(text) {
    var normalized = String(text || '').trim();
    var previous = '';
    while (normalized && normalized !== previous) {
      previous = normalized;
      normalized = normalized
        .replace(/^[\[【(（{｛《〈]\s*/, '')
        .replace(/\s*[\]】)）}｝》〉]$/, '')
        .trim();
    }
    return normalized;
  }

  function startsWithLabel(text, label, ignoreCase) {
    if (ignoreCase) return text.slice(0, label.length).toLowerCase() === label.toLowerCase();
    return text.slice(0, label.length) === label;
  }

  function matchesLabeledValue(text, labels, ignoreCase, rejectEnglishSentence) {
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      if (!startsWithLabel(text, label, ignoreCase)) continue;
      var rest = text.slice(label.length);
      if (!rest) return true;
      if (SEPARATOR_PREFIX.test(rest)) return true;
      if (!/^\s+/.test(rest)) continue;
      var value = rest.trim();
      if (!value) return true;
      if (rejectEnglishSentence) {
        var firstWord = String(value.split(/\s+/)[0] || '').toLowerCase();
        if (ENGLISH_SENTENCE_WORDS[firstWord]) continue;
      }
      return true;
    }
    return false;
  }

  function compactNameValue(text, labels, language) {
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      var ignoreCase = language === 'en';
      if (!startsWithLabel(text, label, ignoreCase)) continue;
      var value = text.slice(label.length);
      if (!value || /^\s/.test(value) || SEPARATOR_PREFIX.test(value) || value.length > 32) continue;
      if (language === 'zh') {
        if (CHINESE_SENTENCE_PREFIXES.test(value)) continue;
        if (/^[\p{L}\p{N}·•.,，、&＆/／'’\-—–]{1,32}$/u.test(value)) return true;
      } else if (/^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ0-9·.'’\-]{1,31}$/.test(value)) {
        return true;
      }
    }
    return false;
  }

  function isLeadingCreditText(text) {
    var normalized = unwrap(text);
    if (!normalized) return false;
    return matchesLabeledValue(normalized, CHINESE_LABELS, true, false)
      || matchesLabeledValue(normalized, ENGLISH_BY_LABELS, true, false)
      || matchesLabeledValue(normalized, ENGLISH_LABELS, true, true)
      || compactNameValue(normalized, COMPACT_CHINESE_LABELS, 'zh')
      || compactNameValue(normalized, COMPACT_ENGLISH_LABELS, 'en');
  }

  function isLeadingTranslationMetadataText(text) {
    var normalized = unwrap(text)
      .replace(/\s*[:：/／|｜=＝\-—–]+\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return false;
    var compact = normalized.replace(/\s+/g, '');
    if (/^(?:歌词)?翻译QQ音乐版权所有$/i.test(compact)) return true;
    return TRANSLATION_METADATA_PATTERNS.some(function(pattern) {
      return pattern.test(normalized);
    });
  }

  function providerDropsOpeningLine(provider) {
    provider = String(provider || '').trim().toLowerCase();
    return provider === 'qq' || provider === 'netease';
  }

  function timedLyricRow(row) {
    var match = String(row || '').match(TIMED_LYRIC_PREFIX);
    if (!match) return null;
    return {
      prefix:match[1],
      text:String(row).slice(match[1].length)
        .replace(/\(-?\d+,-?\d+\)/g, '')
        .trim()
    };
  }

  function transformLyricRows(text, transform) {
    var parts = String(text || '').split(LYRIC_ROW_BREAK);
    for (var index = 0; index < parts.length; index += 2) {
      parts[index] = transform(parts[index]);
    }
    return parts.join('').trim();
  }

  function transformQrcOrLrcText(text, transform) {
    var source = String(text || '');
    var foundXmlContent = false;
    var transformed = source.replace(/(LyricContent\s*=\s*")([^"]*)(")/gi, function(_, before, content, after) {
      foundXmlContent = true;
      return before + transformLyricRows(content, transform) + after;
    });
    return foundXmlContent ? transformed.trim() : transformLyricRows(source, transform);
  }

  function removeOpeningOriginalMetadata(text) {
    var droppedFirst = false;
    var scanningCredits = true;
    return transformQrcOrLrcText(text, function(row) {
      var timed = timedLyricRow(row);
      if (!timed) return row;
      if (!timed.text) return row;
      if (!droppedFirst) {
        droppedFirst = true;
        return '';
      }
      if (scanningCredits && isLeadingCreditText(timed.text)) return '';
      scanningCredits = false;
      return row;
    })
      .replace(/(?:\r?\n){2,}/g, '\n')
      .replace(/(?:&#10;){2,}/gi, '&#10;')
      .replace(/(?:&#x0*A;){2,}/gi, '&#10;');
  }

  function clearOpeningTranslationMetadata(text) {
    var scanningMetadata = true;
    return transformQrcOrLrcText(text, function(row) {
      var timed = timedLyricRow(row);
      if (!timed || !scanningMetadata) return row;
      if (isLeadingTranslationMetadataText(timed.text)) return timed.prefix.trimEnd();
      if (timed.text) scanningMetadata = false;
      return row;
    });
  }

  function sanitizeCachedLyricPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (Number(payload.lyricMetadataSanitizedVersion) >= LYRIC_METADATA_SANITIZED_VERSION) return payload;
    var selection = payload.cacheSelection && payload.cacheSelection.candidate;
    var provider = payload.provider || (selection && selection.provider);
    if (!provider && String(payload.qrc || '').trim()) provider = 'qq';
    if (!provider && /^qq(?:-|$)/i.test(String(payload.source || ''))) provider = 'qq';
    if (!provider && /^(?:lyric|lyric_new)$/i.test(String(payload.source || ''))) provider = 'netease';
    if (!providerDropsOpeningLine(provider)) return payload;
    var sanitized = Object.assign({}, payload);
    if (String(sanitized.qrc || '').trim()) sanitized.qrc = removeOpeningOriginalMetadata(sanitized.qrc);
    if (String(sanitized.lyric || '').trim()) sanitized.lyric = removeOpeningOriginalMetadata(sanitized.lyric);
    if (String(sanitized.tlyric || '').trim()) sanitized.tlyric = clearOpeningTranslationMetadata(sanitized.tlyric);
    sanitized.lyricMetadataSanitizedVersion = LYRIC_METADATA_SANITIZED_VERSION;
    return sanitized;
  }

  return Object.freeze({
    isLeadingCreditText: isLeadingCreditText,
    isLeadingTranslationMetadataText: isLeadingTranslationMetadataText,
    providerDropsOpeningLine: providerDropsOpeningLine,
    clearOpeningTranslationMetadata: clearOpeningTranslationMetadata,
    sanitizeCachedLyricPayload: sanitizeCachedLyricPayload,
    LYRIC_METADATA_SANITIZED_VERSION: LYRIC_METADATA_SANITIZED_VERSION
  });
});
