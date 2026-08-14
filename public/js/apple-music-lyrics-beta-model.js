(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MineradioAppleMusicLyricsModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var APPLE_TTML_SOURCE_PREFIX = 'apple-ttml-';
  var VOCAL_PARENTHESES = Object.freeze({ '(':')', '（':'）' });

  var DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    appleMusicSourceEnabled: false,
    appleMusicTranslationPriority: false,
    anchorPosition: 0.38,
    fontFamily: 'system',
    fontScale: 1,
    fontWeight: 750,
    textColor: '#ffffff',
    glowEnabled: true,
    glowColor: '#ffffff',
    clarity: 2,
    futureBlur: 1,
    transitionStrength: 1,
    autoReturnSeconds: 3,
    showTranslation: true,
    showRomanization: true,
    translationScale: 0.5,
    romanizationScale: 0.5,
    backgroundVocalScale: 0.7,
    wordAdvanceEnabled: true,
    renderQuality: 'auto',
    reduceMotion: false
  });

  function numberInRange(value, fallback, min, max) {
    var parsed = Number(value);
    if (!isFinite(parsed)) parsed = fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function normalizeHex(value, fallback) {
    var raw = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      return ('#' + raw.slice(1).split('').map(function(ch){ return ch + ch; }).join('')).toUpperCase();
    }
    return fallback;
  }

  function normalizeSettings(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var fontFamilies = { system:1, hei:1, song:1, serif:1, humanist:1, mono:1 };
    var qualities = { auto:1, high:1, power:1 };
    return {
      enabled: raw.enabled === true,
      appleMusicSourceEnabled: raw.appleMusicSourceEnabled === true,
      appleMusicTranslationPriority: raw.appleMusicSourceEnabled === true && raw.appleMusicTranslationPriority === true,
      anchorPosition: numberInRange(raw.anchorPosition, DEFAULT_SETTINGS.anchorPosition, 0.30, 0.50),
      fontFamily: fontFamilies[raw.fontFamily] ? raw.fontFamily : DEFAULT_SETTINGS.fontFamily,
      fontScale: numberInRange(raw.fontScale, DEFAULT_SETTINGS.fontScale, 0.70, 1.45),
      fontWeight: Math.round(numberInRange(raw.fontWeight, DEFAULT_SETTINGS.fontWeight, 500, 900) / 50) * 50,
      textColor: normalizeHex(raw.textColor, DEFAULT_SETTINGS.textColor),
      glowEnabled: raw.glowEnabled !== false,
      glowColor: normalizeHex(raw.glowColor, DEFAULT_SETTINGS.glowColor),
      clarity: Math.round(numberInRange(raw.clarity, DEFAULT_SETTINGS.clarity, 1, 4)),
      futureBlur: numberInRange(raw.futureBlur, DEFAULT_SETTINGS.futureBlur, 0, 1.5),
      transitionStrength: numberInRange(raw.transitionStrength, DEFAULT_SETTINGS.transitionStrength, 0, 1.5),
      autoReturnSeconds: numberInRange(raw.autoReturnSeconds, DEFAULT_SETTINGS.autoReturnSeconds, 1, 8),
      showTranslation: raw.showTranslation !== false,
      showRomanization: raw.showRomanization !== false,
      translationScale: numberInRange(raw.translationScale, DEFAULT_SETTINGS.translationScale, 0.34, 0.72),
      romanizationScale: numberInRange(raw.romanizationScale, DEFAULT_SETTINGS.romanizationScale, 0.34, 0.72),
      backgroundVocalScale: numberInRange(raw.backgroundVocalScale, DEFAULT_SETTINGS.backgroundVocalScale, 0.5, 0.9),
      wordAdvanceEnabled: raw.wordAdvanceEnabled !== false,
      renderQuality: qualities[raw.renderQuality] ? raw.renderQuality : DEFAULT_SETTINGS.renderQuality,
      reduceMotion: raw.reduceMotion === true
    };
  }

  function cleanTranslation(text) {
    var normalized = String(text || '').trim();
    if (!normalized || /^[\/／]{2,}$/.test(normalized.replace(/\s+/g, ''))) return '';
    return normalized;
  }

  function isAppleTtmlSource(source) {
    return String(source || '').indexOf(APPLE_TTML_SOURCE_PREFIX) === 0;
  }

  function hasSingleOuterVocalPair(text) {
    var chars = Array.from(String(text || '').trim());
    if (!chars.length || !VOCAL_PARENTHESES[chars[0]]) return false;
    var stack = [];
    for (var index = 0; index < chars.length; index++) {
      var char = chars[index];
      if (VOCAL_PARENTHESES[char]) {
        stack.push(VOCAL_PARENTHESES[char]);
      } else if (char === ')' || char === '）') {
        if (!stack.length || stack.pop() !== char) return false;
        if (!stack.length && index < chars.length - 1) return false;
      }
    }
    return stack.length === 0;
  }

  function stripOuterVocalParentheses(text) {
    var raw = String(text || '');
    var trimmed = raw.trim();
    if (!hasSingleOuterVocalPair(trimmed)) return raw;
    return trimmed.slice(1, -1).trim();
  }

  function stripOuterVocalParenthesesFromTokens(tokens) {
    if (!Array.isArray(tokens) || !tokens.length) return tokens;
    var combined = tokens.map(function(token) {
      return String(token && token.romanized || '');
    }).filter(function(text){ return text.trim(); }).join(' ').trim();
    if (!hasSingleOuterVocalPair(combined)) return tokens;
    var cloned = tokens.map(function(token){ return Object.assign({}, token); });
    var first = cloned.findIndex(function(token){ return /\S/u.test(String(token && token.romanized || '')); });
    var last = -1;
    for (var index = cloned.length - 1; index >= 0; index--) {
      if (/\S/u.test(String(cloned[index] && cloned[index].romanized || ''))) {
        last = index;
        break;
      }
    }
    if (first >= 0) {
      cloned[first].romanized = String(cloned[first].romanized || '').replace(/^(\s*)[（(]/u, '$1');
    }
    if (last >= 0) {
      cloned[last].romanized = String(cloned[last].romanized || '').replace(/[）)](\s*)$/u, '$1');
    }
    return cloned;
  }

  function appleBackgroundDisplayLine(line, timingSource) {
    var isBackground = line && (line.isBG === true || line.isBackground === true);
    var source = String(line && line.source || timingSource || '');
    if (!isBackground || !isAppleTtmlSource(source)) return line;
    var displayLine = Object.assign({}, line, {
      text: stripOuterVocalParentheses(line.text),
      transText: stripOuterVocalParentheses(line.transText),
      romanText: stripOuterVocalParentheses(line.romanText),
      romanTokens: stripOuterVocalParenthesesFromTokens(line.romanTokens)
    });
    var timeline = Array.isArray(line.karaokeTimeline) ? line.karaokeTimeline : [];
    var combined = timeline.map(function(node){ return String(node && node.text || ''); }).join('').trim();
    if (hasSingleOuterVocalPair(combined)) {
      displayLine.karaokeTimeline = timeline.map(function(node){ return Object.assign({}, node); });
      var first = displayLine.karaokeTimeline.findIndex(function(node){ return /\S/u.test(String(node && node.text || '')); });
      var last = -1;
      for (var index = displayLine.karaokeTimeline.length - 1; index >= 0; index--) {
        if (/\S/u.test(String(displayLine.karaokeTimeline[index] && displayLine.karaokeTimeline[index].text || ''))) {
          last = index;
          break;
        }
      }
      if (first >= 0) {
        displayLine.karaokeTimeline[first].text = String(displayLine.karaokeTimeline[first].text || '')
          .replace(/^(\s*)[（(]/u, '$1');
      }
      if (last >= 0) {
        displayLine.karaokeTimeline[last].text = String(displayLine.karaokeTimeline[last].text || '')
          .replace(/[）)](\s*)$/u, '$1');
      }
    }
    return displayLine;
  }

  function lineTimedEndSeconds(line) {
    var end = null;
    var timeline = line && Array.isArray(line.karaokeTimeline) ? line.karaokeTimeline : [];
    timeline.forEach(function(node) {
      if (!node || !node.timed || !isFinite(node.start) || !isFinite(node.duration) || node.duration < 0) return;
      var nodeEnd = Number(node.start) + Number(node.duration);
      if (end === null || nodeEnd > end) end = nodeEnd;
    });
    if (line && isFinite(line.sourceEnd) && Number(line.sourceEnd) >= Number(line.t || 0)) {
      end = end === null ? Number(line.sourceEnd) : Math.max(end, Number(line.sourceEnd));
    }
    if (end === null && line && isFinite(line.duration)) end = Number(line.t || 0) + Math.max(0, Number(line.duration));
    return end === null ? Number(line && line.t || 0) : end;
  }

  function romanWordsBySourceNode(line) {
    var result = {};
    var timeline = line && Array.isArray(line.karaokeTimeline) ? line.karaokeTimeline : [];
    var tokens = line && Array.isArray(line.romanTokens) ? line.romanTokens : [];
    tokens.forEach(function(token) {
      var indexes = Array.isArray(token && token.sourceNodeIndexes)
        ? token.sourceNodeIndexes.map(Number).filter(function(index){ return isFinite(index) && index >= 0; })
        : [];
      if (!indexes.length) return;
      var lyricIndexes = indexes.filter(function(index) {
        return /[\p{L}\p{N}]/u.test(String(timeline[index] && timeline[index].text || ''));
      });
      if (lyricIndexes.length) indexes = lyricIndexes;
      var romanized = String(token.romanized || '').trim();
      var pieces = romanized.split(/\s+/).filter(Boolean);
      if (pieces.length === indexes.length) {
        indexes.forEach(function(index, pieceIndex){ result[index] = pieces[pieceIndex]; });
        return;
      }
      if (pieces.length > indexes.length) {
        indexes.forEach(function(index, pieceIndex) {
          var start = Math.floor(pieceIndex * pieces.length / indexes.length);
          var end = Math.max(start + 1, Math.floor((pieceIndex + 1) * pieces.length / indexes.length));
          result[index] = pieces.slice(start, Math.min(pieces.length, end)).join(' ') || '\u00a0';
        });
        return;
      }
      var romanChars = Array.from(romanized.replace(/\s+/g, ''));
      var tokenStart = isFinite(token.c0) ? Number(token.c0) : null;
      var tokenEnd = isFinite(token.c1) ? Number(token.c1) : null;
      var weights = indexes.map(function(index) {
        var node = timeline[index];
        if (!node || tokenStart === null || tokenEnd === null || !isFinite(node.c0) || !isFinite(node.c1)) return 1;
        return Math.max(0, Math.min(tokenEnd, Number(node.c1)) - Math.max(tokenStart, Number(node.c0))) || 1;
      });
      var totalWeight = weights.reduce(function(sum, weight){ return sum + weight; }, 0) || indexes.length;
      var consumedWeight = 0;
      var consumedChars = 0;
      indexes.forEach(function(index, indexPosition) {
        consumedWeight += weights[indexPosition];
        var charEnd = indexPosition === indexes.length - 1
          ? romanChars.length
          : Math.max(consumedChars, Math.round(romanChars.length * consumedWeight / totalWeight));
        result[index] = romanChars.slice(consumedChars, charEnd).join('') || '\u00a0';
        consumedChars = charEnd;
      });
    });
    return result;
  }

  function buildQrcWords(line, settings) {
    var romanByNode = settings.showRomanization ? romanWordsBySourceNode(line) : {};
    return line.karaokeTimeline.map(function(node, index) {
      var timed = !!(node && node.timed && isFinite(node.start) && isFinite(node.duration) && Number(node.duration) >= 0);
      var start = timed ? Number(node.start) * 1000 : Number(line.t || 0) * 1000;
      var end = timed ? (Number(node.start) + Number(node.duration)) * 1000 : start;
      var word = {
        word: String(node && node.text || ''),
        startTime: Math.round(start),
        endTime: Math.round(Math.max(start, end))
      };
      if (settings.showRomanization && Object.prototype.hasOwnProperty.call(romanByNode, index)) {
        word.romanWord = romanByNode[index];
      }
      return word;
    }).filter(function(word){ return word.word !== ''; });
  }

  function timedWord(node, text) {
    var timed = !!(node && node.timed && isFinite(node.start)
      && isFinite(node.duration) && Number(node.duration) >= 0);
    var start = timed ? Number(node.start) * 1000 : 0;
    var end = timed ? (Number(node.start) + Number(node.duration)) * 1000 : start;
    return {
      word: String(text == null ? node && node.text || '' : text),
      startTime: Math.round(start),
      endTime: Math.round(Math.max(start, end))
    };
  }

  function appleKoreanLexicalWords(line, settings) {
    if (!settings.showRomanization || !/[가-힣]/u.test(String(line && line.text || ''))) return null;
    var text = String(line && line.text || '');
    var timeline = line && Array.isArray(line.karaokeTimeline) ? line.karaokeTimeline : [];
    var tokens = line && Array.isArray(line.romanTokens) ? line.romanTokens : [];
    var slots = [];
    var matcher = /\S+/gu;
    var match;
    while ((match = matcher.exec(text))) {
      slots.push({ sourceText:match[0], c0:match.index, c1:match.index + match[0].length });
    }
    if (!timeline.length || !slots.length || slots.length !== tokens.length) return null;

    var nodeUseCounts = {};
    var visualTokens = tokens.map(function(token, tokenIndex) {
      var slot = slots[tokenIndex];
      var sourceText = String(token && token.sourceText || '');
      var romanized = String(token && token.romanized || '').trim().replace(/\s+/g, ' ');
      var c0 = Number(token && token.c0);
      var c1 = Number(token && token.c1);
      var indexes = Array.isArray(token && token.sourceNodeIndexes)
        ? token.sourceNodeIndexes.map(Number)
        : [];
      if (!slot || sourceText !== slot.sourceText || c0 !== slot.c0 || c1 !== slot.c1 || !romanized
          || !indexes.length || indexes.some(function(index, position) {
            return !Number.isInteger(index) || index < 0 || index >= timeline.length
              || position > 0 && index <= indexes[position - 1];
          })) return null;
      var expected = [];
      timeline.forEach(function(node, index) {
        var nodeC0 = Number(node && node.c0);
        var nodeC1 = Number(node && node.c1);
        if (isFinite(nodeC0) && isFinite(nodeC1) && nodeC1 > c0 && nodeC0 < c1) expected.push(index);
      });
      if (expected.length !== indexes.length || indexes.some(function(index, position) {
        return index !== expected[position];
      })) return null;
      indexes.forEach(function(index) {
        nodeUseCounts[index] = Number(nodeUseCounts[index] || 0) + 1;
      });
      return {
        sourceText:sourceText,
        romanized:romanized,
        c0:c0,
        c1:c1,
        sourceNodeIndexes:indexes,
        attachedPunctuation:false
      };
    });
    if (!visualTokens.every(Boolean)) return null;

    visualTokens = visualTokens.reduce(function(result, token) {
      if (/^[\p{P}\p{S}]+$/u.test(token.sourceText) && result.length) {
        var previous = result[result.length - 1];
        previous.sourceText = text.slice(previous.c0, token.c1);
        previous.romanized += token.romanized;
        previous.c1 = token.c1;
        previous.sourceNodeIndexes = Array.from(new Set(
          previous.sourceNodeIndexes.concat(token.sourceNodeIndexes)
        )).sort(function(a, b){ return a - b; });
        previous.attachedPunctuation = true;
      } else {
        result.push(token);
      }
      return result;
    }, []);

    var hasComplexTiming = visualTokens.some(function(token) {
      return token.attachedPunctuation || token.sourceNodeIndexes.length > 1
        || token.sourceNodeIndexes.some(function(index){ return nodeUseCounts[index] > 1; });
    });
    if (!hasComplexTiming) return null;

    var visualWords = visualTokens.map(function(token, tokenIndex) {
      var ruby = [];
      var valid = true;
      token.sourceNodeIndexes.forEach(function(index) {
        var node = timeline[index];
        var nodeC0 = Number(node && node.c0);
        var nodeC1 = Number(node && node.c1);
        if (!node || !node.timed || !isFinite(node.start) || !isFinite(node.duration)
            || Number(node.duration) < 0 || !isFinite(nodeC0) || !isFinite(nodeC1)) {
          valid = false;
          return;
        }
        var partC0 = Math.max(token.c0, nodeC0);
        var partC1 = Math.min(token.c1, nodeC1);
        var part = text.slice(partC0, partC1);
        if (!part) {
          valid = false;
          return;
        }
        ruby.push({
          word:part,
          startTime:Math.round(Number(node.start) * 1000),
          endTime:Math.round((Number(node.start) + Number(node.duration)) * 1000)
        });
      });
      if (!valid || ruby.map(function(segment){ return segment.word; }).join('') !== token.sourceText) return null;
      var next = visualTokens[tokenIndex + 1];
      var separator = next ? text.slice(token.c1, next.c0) : text.slice(token.c1);
      var complex = token.attachedPunctuation || token.sourceNodeIndexes.length > 1
        || token.sourceNodeIndexes.some(function(index){ return nodeUseCounts[index] > 1; });
      var word = {
        word:token.sourceText,
        romanWord:token.romanized,
        startTime:Math.min.apply(Math, ruby.map(function(segment){ return segment.startTime; })),
        endTime:Math.max.apply(Math, ruby.map(function(segment){ return segment.endTime; })),
        separator:separator
      };
      if (complex) word.ruby = ruby;
      return word;
    });
    if (!visualWords.every(Boolean)) return null;
    var words = visualWords.reduce(function(result, word) {
      var separator = word.separator;
      delete word.separator;
      result.push(word);
      if (separator) result.push({ word:separator, startTime:word.endTime, endTime:word.endTime });
      return result;
    }, []);
    return {
      words:words,
      columns:visualTokens.map(function(token) {
        return { sourceText:token.sourceText, romanized:token.romanized };
      })
    };
  }

  function buildLineOnlyWord(line) {
    var start = Math.round(Number(line && line.t || 0) * 1000);
    return [{
      word: String(line && line.text || ''),
      startTime: start,
      endTime: start
    }];
  }

  function koreanRomanColumns(line) {
    var text = String(line && line.text || '');
    var tokens = line && Array.isArray(line.romanTokens) ? line.romanTokens : [];
    if (line && line.romanLanguage !== 'ko' || !/[\uac00-\ud7a3]/u.test(text) || !tokens.length) return null;
    var slots = [];
    var matcher = /\S+/gu;
    var match;
    while ((match = matcher.exec(text))) {
      slots.push({ sourceText:match[0], c0:match.index, c1:match.index + match[0].length });
    }
    if (!slots.length || slots.length !== tokens.length) return null;
    var hasKoreanColumn = false;
    var columns = slots.map(function(slot, index) {
      var token = tokens[index] || {};
      var sourceText = String(token.sourceText || '');
      var romanized = String(token.romanized || '').trim().replace(/\s+/g, ' ');
      if (Number(token.c0) !== slot.c0 || Number(token.c1) !== slot.c1
          || sourceText !== slot.sourceText || !romanized) return null;
      var syllableCount = Array.from(sourceText).filter(function(char) {
        return /[\uac00-\ud7a3]/u.test(char);
      }).length;
      if (syllableCount) hasKoreanColumn = true;
      if (syllableCount > 1 && romanized.split(' ').length < syllableCount) return null;
      return { sourceText:sourceText, romanized:romanized };
    });
    if (!hasKoreanColumn || !columns.every(Boolean)) return null;
    return columns.reduce(function(result, column) {
      if (/^[\p{P}\p{S}]+$/u.test(column.sourceText) && result.length) {
        var previous = result[result.length - 1];
        previous.sourceText += column.sourceText;
        previous.romanized += column.romanized;
      } else {
        result.push({ sourceText:column.sourceText, romanized:column.romanized });
      }
      return result;
    }, []);
  }

  function toAmllLine(line, settings, timingSource) {
    line = line || {};
    line = appleBackgroundDisplayLine(line, timingSource);
    var reliableQrc = timingSource === 'qrc-word'
      && line.nativeQqKaraoke === true
      && Array.isArray(line.karaokeTimeline)
      && line.karaokeTimeline.some(function(node) {
        return !!(node && node.timed && isFinite(node.start) && isFinite(node.duration) && Number(node.duration) >= 0);
      });
    var nativeWordTiming = reliableQrc || (timingSource === 'apple-ttml-word'
      && line.nativeAppleKaraoke === true
      && Array.isArray(line.karaokeTimeline)
      && line.karaokeTimeline.some(function(node) {
        return !!(node && node.timed && isFinite(node.start) && isFinite(node.duration) && Number(node.duration) >= 0);
      }));
    var startTime = Math.round(Math.max(0, Number(line.t) || 0) * 1000);
    var endTime = Math.round(Math.max(Number(line.t) || 0, lineTimedEndSeconds(line)) * 1000);
    var appleLexicalWords = nativeWordTiming && timingSource === 'apple-ttml-word'
      ? appleKoreanLexicalWords(line, settings)
      : null;
    var appleWordColumns = appleLexicalWords ? appleLexicalWords.columns : null;
    var words = nativeWordTiming
      ? (appleLexicalWords ? appleLexicalWords.words : buildQrcWords(line, settings))
      : buildLineOnlyWord(line);
    var romanColumns = settings.showRomanization && !nativeWordTiming ? koreanRomanColumns(line) : null;
    if (!words.length) words = buildLineOnlyWord(line);
    return {
      words: words,
      translatedLyric: settings.showTranslation ? cleanTranslation(line.transText) : '',
      romanLyric: settings.showRomanization && !nativeWordTiming ? String(line.romanText || '').trim() : '',
      startTime: startTime,
      endTime: Math.max(startTime, endTime),
      isBG: line.isBG === true || line.isBackground === true,
      isDuet: line.isDuet === true,
      mineradioSource: String(line.source || ''),
      mineradioReliableQrc: reliableQrc,
      mineradioNativeWordTiming: nativeWordTiming,
      mineradioAppleKoreanLexicalTiming: !!appleLexicalWords,
      mineradioAppleKoreanWordColumns: appleWordColumns,
      mineradioRomanColumns: romanColumns
    };
  }

  function foregroundLineGroups(lines) {
    var groups = [];
    (Array.isArray(lines) ? lines : []).forEach(function(line, index) {
      if (!line) return;
      if (line.isBG === true) {
        if (groups.length) groups[groups.length - 1].background.push({ line:line, index:index });
        return;
      }
      groups.push({
        main: { line:line, index:index },
        background: []
      });
    });
    return groups;
  }

  function toAmllLines(lines, settings, timingSource) {
    settings = normalizeSettings(settings);
    var converted = (Array.isArray(lines) ? lines : [])
      .filter(function(line){ return line && !line.fallback && String(line.text || '').trim(); })
      .map(function(line) {
        return toAmllLine(line, settings, timingSource);
      });
    var groups = foregroundLineGroups(converted);
    groups.sort(function(a, b){ return a.main.line.startTime - b.main.line.startTime; });
    return groups.reduce(function(result, group) {
      result.push(group.main.line);
      group.background.sort(function(a, b){ return a.line.startTime - b.line.startTime; });
      return result.concat(group.background.map(function(item){ return item.line; }));
    }, []);
  }

  // Kept in lockstep with @applemusic-like-lyrics/core@0.5.2
  // computeCurrentInterlude. AMLL Core remains the renderer and sole dots owner.
  var AMLL_INTERLUDE_LEAD_MS = 250;
  var AMLL_INTERLUDE_MIN_MS = 4000;
  var SEAMLESS_TRANSITION_LEAD_MS = 960;
  var SEAMLESS_SWITCH_LEAD_MS = 800;
  var APPLE_HOLD_GAP_MIN_MS = 800;
  var APPLE_HOLD_SWITCH_LEAD_MS = 800;
  var APPLE_MAX_CONCURRENT_OVERLAP_LINES = 3;
  var APPLE_MICRO_OVERLAP_MAX_MS = 100;

  function amllInterludeBounds(group, next) {
    if (!group || !next) return null;
    var endTime = Math.max(group.sourceEndTime, next.startTime - AMLL_INTERLUDE_LEAD_MS);
    if (endTime - group.sourceEndTime < AMLL_INTERLUDE_MIN_MS) return null;
    return { startTime:group.sourceEndTime, endTime:endTime };
  }

  function isSungWord(word) {
    var text = String(word && word.word || '');
    return /[\p{L}\p{N}]/u.test(text)
      && isFinite(word.startTime)
      && isFinite(word.endTime)
      && Number(word.endTime) > Number(word.startTime);
  }

  function lastSungWord(line) {
    var words = line && Array.isArray(line.words) ? line.words : [];
    for (var index = words.length - 1; index >= 0; index--) {
      if (isSungWord(words[index])) return words[index];
    }
    return null;
  }

  function isApplePresentationLine(line) {
    return isAppleTtmlSource(line && line.mineradioSource);
  }

  function applePairOverlapMs(group, next) {
    if (!group || !next
        || !isApplePresentationLine(group.sourceLine)
        || !isApplePresentationLine(next.sourceLine)) return 0;
    return group.sourceEndTime - next.startTime;
  }

  function isAppleMicroOverlap(group, next, options) {
    var overlapMs = applePairOverlapMs(group, next);
    return options && options.advanceWordLines === true
      && overlapMs > 0
      && overlapMs < APPLE_MICRO_OVERLAP_MAX_MS;
  }

  function wordAdvanceEffect(group, timeMs) {
    var advance = group && group.advance;
    var now = Math.max(0, Number(timeMs) || 0);
    if (!advance || advance.mode === 'hold' || now < advance.transitionStartTime) return null;
    if (advance.mode === 'finish' && now < advance.switchTime) {
      var duration = Math.max(1, advance.switchTime - advance.transitionStartTime);
      var progress = Math.max(0, Math.min(1, (now - advance.transitionStartTime) / duration));
      var initialTime = Math.max(
        advance.lastWordStartTime,
        Math.min(advance.lastWordEndTime, advance.transitionStartTime)
      );
      var acceleratedTime = initialTime + (advance.lastWordEndTime - initialTime) * progress;
      return {
        mode: 'finish',
        wordTime: Math.round(Math.min(advance.lastWordEndTime, Math.max(now, acceleratedTime))),
        frozen: false
      };
    }
    if (now >= advance.switchTime) {
      return {
        mode: advance.mode,
        wordTime: advance.frozenWordTime,
        frozen: true
      };
    }
    return null;
  }

  function annotateAppleOverlapClusters(groups, options) {
    var clusterId = 0;
    for (var first = 0; first < groups.length;) {
      var firstGroup = groups[first];
      if (!isApplePresentationLine(firstGroup && firstGroup.sourceLine)) {
        first += 1;
        continue;
      }
      var last = first;
      var overlapFrontier = firstGroup.sourceEndTime;
      while (last + 1 < groups.length
          && last - first + 1 < APPLE_MAX_CONCURRENT_OVERLAP_LINES) {
        var candidate = groups[last + 1];
        if (!isApplePresentationLine(candidate && candidate.sourceLine)
            || isAppleMicroOverlap(groups[last], candidate, options)
            || candidate.startTime >= overlapFrontier) break;
        last += 1;
        overlapFrontier = Math.max(overlapFrontier, candidate.sourceEndTime);
      }
      if (last > first) {
        var overflow = groups[last + 1];
        var overflowStartsNewCluster = last - first + 1 === APPLE_MAX_CONCURRENT_OVERLAP_LINES
          && isApplePresentationLine(overflow && overflow.sourceLine)
          && !isAppleMicroOverlap(groups[last], overflow, options)
          && overflow.startTime < overlapFrontier;
        var cluster = {
          id:clusterId++,
          firstGroup:first,
          lastGroup:last,
          releaseTime:overflowStartsNewCluster ? overflow.startTime : groups[last].sourceEndTime
        };
        for (var index = first; index <= last; index++) {
          groups[index].appleOverlapCluster = cluster;
          groups[index].presentationEndTime = cluster.releaseTime;
        }
      }
      first = last + 1;
    }
  }

  function presentationGroups(lines, options) {
    options = options || {};
    var groups = foregroundLineGroups(lines).map(function(sourceGroup) {
      var line = sourceGroup.main.line;
      var startTime = Math.max(0, Number(line.startTime) || 0);
      var endTime = Math.max(startTime, Number(line.endTime) || startTime);
      return {
        lineIndexes: [sourceGroup.main.index].concat(sourceGroup.background.map(function(item){ return item.index; })),
        startTime: startTime,
        presentationStartTime: startTime,
        sourceEndTime: endTime,
        presentationEndTime: endTime,
        interlude: null,
        advance: null,
        appleOverlapCluster: null,
        sourceLine: line
      };
    });
    annotateAppleOverlapClusters(groups, options);
    groups.forEach(function(group, index) {
      var next = groups[index + 1];
      if (!next) return;
      group.interlude = amllInterludeBounds(group, next);
      var applePair = isApplePresentationLine(group.sourceLine)
        && isApplePresentationLine(next.sourceLine);
      var appleMicroOverlap = isAppleMicroOverlap(group, next, options);
      var overlapClusterTail = group.appleOverlapCluster
        && group.appleOverlapCluster.lastGroup === index;
      if (group.appleOverlapCluster && !appleMicroOverlap) {
        group.presentationEndTime = group.appleOverlapCluster.releaseTime;
        return;
      }
      group.presentationEndTime = group.interlude ? group.sourceEndTime : next.startTime;
      if (options.advanceWordLines !== true
          || group.interlude) {
        return;
      }
      if (appleMicroOverlap) {
        var appleTransitionStart = Math.max(
          group.startTime,
          next.startTime - SEAMLESS_TRANSITION_LEAD_MS
        );
        var appleSwitchTime = Math.max(
          appleTransitionStart,
          next.startTime - SEAMLESS_SWITCH_LEAD_MS
        );
        if (appleSwitchTime <= group.startTime) appleSwitchTime = next.startTime;
        var appleLastWord = group.sourceLine.mineradioNativeWordTiming === true
          ? lastSungWord(group.sourceLine)
          : null;
        group.advance = appleLastWord ? {
          mode:'finish',
          transitionStartTime:appleTransitionStart,
          switchTime:appleSwitchTime,
          lastWordStartTime:Number(appleLastWord.startTime),
          lastWordEndTime:Number(appleLastWord.endTime),
          lastWordText:String(appleLastWord.word || ''),
          frozenWordTime:Number(appleLastWord.endTime)
        } : {
          mode:'hold',
          transitionStartTime:appleSwitchTime,
          switchTime:appleSwitchTime
        };
        group.presentationEndTime = appleSwitchTime;
        next.presentationStartTime = Math.min(next.presentationStartTime, appleSwitchTime);
        if (overlapClusterTail) {
          group.appleOverlapCluster.releaseTime = appleSwitchTime;
          for (var memberIndex = group.appleOverlapCluster.firstGroup;
            memberIndex <= group.appleOverlapCluster.lastGroup;
            memberIndex++) {
            groups[memberIndex].presentationEndTime = appleSwitchTime;
          }
        }
        return;
      }
      if (applePair) {
        var appleGap = next.startTime - group.sourceEndTime;
        if (appleGap > APPLE_HOLD_GAP_MIN_MS) {
          var appleSwitchTime = Math.max(group.sourceEndTime, next.startTime - APPLE_HOLD_SWITCH_LEAD_MS);
          group.advance = {
            mode: 'hold',
            transitionStartTime: appleSwitchTime,
            switchTime: appleSwitchTime
          };
          group.presentationEndTime = appleSwitchTime;
          next.presentationStartTime = Math.min(next.presentationStartTime, appleSwitchTime);
        }
        return;
      }
      if (!group.sourceLine.mineradioReliableQrc
          || !next.sourceLine.mineradioReliableQrc
          || next.startTime < group.sourceEndTime) {
        return;
      }
      var lastWord = lastSungWord(group.sourceLine);
      if (!lastWord) return;
      var lastWordStart = Number(lastWord.startTime);
      var lastWordEnd = Number(lastWord.endTime);
      var gap = next.startTime - lastWordEnd;
      if (gap < 0) return;
      var transitionStart = Math.max(0, next.startTime - SEAMLESS_TRANSITION_LEAD_MS);
      var switchTime = Math.max(transitionStart, next.startTime - SEAMLESS_SWITCH_LEAD_MS);
      group.advance = {
        mode: 'finish',
        transitionStartTime: transitionStart,
        switchTime: switchTime,
        lastWordStartTime: lastWordStart,
        lastWordEndTime: lastWordEnd,
        lastWordText: String(lastWord.word || ''),
        frozenWordTime: lastWordEnd
      };
      group.presentationEndTime = group.advance.switchTime;
      next.presentationStartTime = Math.min(next.presentationStartTime, group.advance.switchTime);
    });
    return groups;
  }

  function presentationStateFromGroups(groups, timeMs) {
    groups = Array.isArray(groups) ? groups : [];
    var now = Math.max(0, Number(timeMs) || 0);
    var currentGroups = [];
    var interlude = false;
    groups.forEach(function(group, index) {
      if (group.interlude) {
        var nativeTime = now + 20;
        if (group.interlude.endTime > nativeTime
            && group.interlude.startTime < nativeTime) {
          interlude = true;
        }
      }
      if (group.presentationStartTime <= now && group.presentationEndTime > now) currentGroups.push(index);
    });
    if (interlude) currentGroups = [];
    var currentGroup = currentGroups.length ? currentGroups[currentGroups.length - 1] : -1;
    var states = groups.map(function(group, index) {
      if (currentGroups.indexOf(index) >= 0) return 'current';
      return group.presentationEndTime <= now ? 'past' : 'future';
    });
    var activeOverlap = null;
    for (var activeIndex = 0; activeIndex < currentGroups.length; activeIndex++) {
      var activeCluster = groups[currentGroups[activeIndex]].appleOverlapCluster;
      if (activeCluster) {
        activeOverlap = activeCluster;
        break;
      }
    }
    var releasedOverlap = null;
    if (!activeOverlap && currentGroup < 0) {
      groups.forEach(function(group) {
        var cluster = group.appleOverlapCluster;
        if (!cluster || group !== groups[cluster.firstGroup] || cluster.releaseTime > now) return;
        var nextGroup = groups[cluster.lastGroup + 1];
        if (nextGroup && nextGroup.presentationStartTime <= now) return;
        if (!releasedOverlap || cluster.releaseTime > releasedOverlap.releaseTime) releasedOverlap = cluster;
      });
    }
    var firstFuture = states.indexOf('future');
    var anchorGroup = currentGroup >= 0
      ? currentGroup
      : (firstFuture >= 0 ? firstFuture : groups.length);
    var overlapAnchorGroup = -1;
    if (activeOverlap) {
      anchorGroup = activeOverlap.firstGroup;
      overlapAnchorGroup = anchorGroup;
    } else if (releasedOverlap) {
      anchorGroup = releasedOverlap.lastGroup + 1;
      overlapAnchorGroup = anchorGroup;
    }
    return {
      groups: groups,
      states: states,
      currentGroup: currentGroup,
      currentGroups: currentGroups,
      anchorGroup: anchorGroup,
      overlapAnchorGroup: overlapAnchorGroup,
      earlyCurrentGroup: currentGroup >= 0 && now < groups[currentGroup].startTime ? currentGroup : -1,
      interlude: interlude
    };
  }

  function presentationGroupState(lines, timeMs, options) {
    return presentationStateFromGroups(presentationGroups(lines, options), timeMs);
  }

  return Object.freeze({
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    normalizeSettings: normalizeSettings,
    cleanTranslation: cleanTranslation,
    isAppleTtmlSource: isAppleTtmlSource,
    lineTimedEndSeconds: lineTimedEndSeconds,
    romanWordsBySourceNode: romanWordsBySourceNode,
    toAmllLine: toAmllLine,
    toAmllLines: toAmllLines,
    presentationGroups: presentationGroups,
    presentationGroupState: presentationGroupState,
    presentationStateFromGroups: presentationStateFromGroups,
    wordAdvanceEffect: wordAdvanceEffect
  });
});
