const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const kuromoji = require('kuromoji');
const wanakana = require('wanakana');

const ENGINE_VERSION = '2';

const KOREAN_INITIALS = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];
const KOREAN_VOWELS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo',
  'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];
const KOREAN_FINALS = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'p', 'l', 'l', 'p', 'l',
  'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't',
];
const KOREAN_LIAISON_ONSETS = {
  1:0, 2:1, 4:2, 7:3, 8:5, 16:6, 17:7, 19:9, 20:10, 22:12,
  23:14, 24:15, 25:16, 26:17,
};
const KOREAN_COMPLEX_LIAISON = {
  3:{ final:1, onset:9 },
  5:{ final:4, onset:12 },
  6:{ final:4, onset:18 },
  9:{ final:8, onset:0 },
  10:{ final:8, onset:6 },
  11:{ final:8, onset:7 },
  12:{ final:8, onset:9 },
  13:{ final:8, onset:16 },
  14:{ final:8, onset:17 },
  15:{ final:8, onset:18 },
  18:{ final:17, onset:9 },
};

function isHangulSyllable(char) {
  const code = String(char || '').codePointAt(0);
  return Number.isFinite(code) && code >= 0xac00 && code <= 0xd7a3;
}

function hasHangul(text) {
  return /[\uac00-\ud7a3]/u.test(String(text || ''));
}

function hasJapaneseKana(text) {
  return /[\u3040-\u30ff]/u.test(String(text || ''));
}

function hasJapaneseHan(text) {
  return /[\u3400-\u9fff]/u.test(String(text || ''));
}

function romanizeHangulSyllable(char) {
  const syllable = decomposeHangulSyllable(char);
  if (!syllable) return char;
  return romanizeKoreanSyllable(syllable);
}

function decomposeHangulSyllable(char) {
  const offset = String(char || '').codePointAt(0) - 0xac00;
  if (offset < 0 || offset > 11171) return null;
  return {
    initial:Math.floor(offset / 588),
    vowel:Math.floor((offset % 588) / 28),
    final:offset % 28,
  };
}

function romanizeKoreanSyllable(syllable) {
  return KOREAN_INITIALS[syllable.initial]
    + KOREAN_VOWELS[syllable.vowel]
    + KOREAN_FINALS[syllable.final];
}

function applyKoreanPronunciationRules(syllables) {
  for (let index = 0; index < syllables.length - 1; index++) {
    const current = syllables[index];
    const next = syllables[index + 1];
    if (!current.final || next.initial !== 11) continue;

    if ((current.final === 7 || current.final === 25) && next.vowel === 20) {
      const palatalizedOnset = current.final === 7 ? 12 : 14;
      current.final = 0;
      next.initial = palatalizedOnset;
      continue;
    }
    if (current.final === 27) {
      current.final = 0;
      continue;
    }
    const complex = KOREAN_COMPLEX_LIAISON[current.final];
    if (complex) {
      current.final = complex.final;
      next.initial = complex.onset;
      continue;
    }
    const liaisonOnset = KOREAN_LIAISON_ONSETS[current.final];
    if (Number.isInteger(liaisonOnset)) {
      current.final = 0;
      next.initial = liaisonOnset;
    }
  }
  return syllables;
}

function romanizeKoreanRun(text) {
  const syllables = Array.from(text).map(decomposeHangulSyllable).filter(Boolean);
  applyKoreanPronunciationRules(syllables);
  return syllables.map(romanizeKoreanSyllable).join(' ');
}

function romanizeKoreanSlot(text) {
  return (String(text || '').match(/[\uac00-\ud7a3]+|[^\uac00-\ud7a3]+/gu) || [])
    .map((part) => hasHangul(part) ? romanizeKoreanRun(part) : part)
    .join('')
    .replace(/\s+([,.;:!?…，。！？])/g, '$1')
    .trim();
}

function koreanRomanizationOverride(sourceText, override) {
  const value = typeof override === 'string' ? override.trim() : '';
  if (!value) return '';
  const syllableCount = Array.from(String(sourceText || '')).filter(isHangulSyllable).length;
  if (syllableCount <= 1) return value;
  return value.split(/\s+/).filter(Boolean).length === syllableCount ? value : '';
}

function wordSlots(text) {
  const slots = [];
  const matcher = /\S+/gu;
  let match;
  while ((match = matcher.exec(String(text || '')))) {
    slots.push({ text:match[0], c0:match.index, c1:match.index + match[0].length });
  }
  return slots;
}

function sourceNodeIndexes(line, c0, c1) {
  const timeline = line && Array.isArray(line.karaokeTimeline) ? line.karaokeTimeline : [];
  const indexes = [];
  timeline.forEach((node, index) => {
    if (!node || !Number.isFinite(Number(node.c0)) || !Number.isFinite(Number(node.c1))) return;
    if (Number(node.c1) > c0 && Number(node.c0) < c1) indexes.push(index);
  });
  return indexes;
}

let sharedJapaneseTokenizerPromise = null;
function getJapaneseTokenizer() {
  if (sharedJapaneseTokenizerPromise) return sharedJapaneseTokenizerPromise;
  const packageDir = path.dirname(require.resolve('kuromoji/package.json'));
  sharedJapaneseTokenizerPromise = new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath:path.join(packageDir, 'dict') }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });
  return sharedJapaneseTokenizerPromise;
}

function japaneseTokenRanges(text, analyzed) {
  let cursor = 0;
  return (Array.isArray(analyzed) ? analyzed : []).map((token) => {
    const surface = String(token && token.surface_form || '');
    let c0 = text.indexOf(surface, cursor);
    if (c0 < 0) c0 = cursor;
    const c1 = Math.min(text.length, c0 + surface.length);
    cursor = c1;
    return { token, surface, c0, c1 };
  }).filter((entry) => entry.surface && entry.c1 > entry.c0);
}

function isLatinToken(text) {
  return /^[\p{Script=Latin}\p{Mark}\p{N}'’\-‐‑‒–—]+$/u.test(String(text || ''));
}

function isPunctuationToken(text) {
  return /^[\p{P}\p{S}]+$/u.test(String(text || ''));
}

function romanizeJapaneseReading(reading) {
  const value = wanakana.toRomaji(String(reading || ''), { convertLongVowelMark:true });
  return String(value || '').toLowerCase();
}

function normalizeOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const language of ['ja', 'ko']) {
    const entries = value[language];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    const cleanEntries = {};
    for (const [source, romanized] of Object.entries(entries)) {
      if (!source || typeof romanized !== 'string' || !romanized.trim()) continue;
      cleanEntries[source] = romanized.trim();
    }
    if (Object.keys(cleanEntries).length) normalized[language] = cleanEntries;
  }
  return normalized;
}

function loadRomanizationOverrides(filePath) {
  if (!filePath) return {};
  try {
    return normalizeOverrides(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (_) {
    return {};
  }
}

class RomanizationEngine {
  constructor(options = {}) {
    this.overrides = normalizeOverrides(
      options.overrides || loadRomanizationOverrides(options.overridesPath)
    );
    const overrideEntries = ['ja', 'ko'].flatMap((language) => (
      Object.entries(this.overrides[language] || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, romanized]) => [language, source, romanized])
    ));
    this.engineVersion = overrideEntries.length
      ? `${ENGINE_VERSION}-${crypto.createHash('sha256').update(JSON.stringify(overrideEntries)).digest('hex').slice(0, 10)}`
      : ENGINE_VERSION;
  }

  preload() {
    return getJapaneseTokenizer();
  }

  async romanizeJapaneseLine(line, lineIndex) {
    const text = String(line && line.text || '');
    const tokenizer = await getJapaneseTokenizer();
    const analyzed = tokenizer.tokenize(text);
    const ranges = japaneseTokenRanges(text, analyzed);
    const tokens = [];
    let targetCharacters = 0;
    let convertedCharacters = 0;

    ranges.forEach((entry) => {
      const sourceText = entry.surface;
      if (/^\s+$/u.test(sourceText)) return;
      const targetCount = Array.from(sourceText).filter((char) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(char)).length;
      targetCharacters += targetCount;
      if (isPunctuationToken(sourceText) && tokens.length) {
        const previous = tokens[tokens.length - 1];
        previous.sourceText += sourceText;
        previous.romanized += sourceText;
        previous.c1 = entry.c1;
        previous.sourceNodeIndexes = Array.from(new Set(previous.sourceNodeIndexes.concat(sourceNodeIndexes(line, entry.c0, entry.c1))));
        return;
      }
      let romanized = '';
      if (isLatinToken(sourceText)) {
        romanized = sourceText;
      } else {
        const override = this.overrides.ja && this.overrides.ja[sourceText];
        const reading = override || (entry.token && (entry.token.pronunciation || entry.token.reading));
        if (reading && reading !== '*') romanized = override ? String(override) : romanizeJapaneseReading(reading);
        else if (hasJapaneseKana(sourceText) && !hasJapaneseHan(sourceText)) romanized = romanizeJapaneseReading(sourceText);
        else romanized = sourceText;
      }
      if (targetCount > 0 && romanized && romanized !== sourceText) convertedCharacters += targetCount;
      tokens.push({
        sourceText,
        romanized,
        c0:entry.c0,
        c1:entry.c1,
        sourceNodeIndexes:sourceNodeIndexes(line, entry.c0, entry.c1),
      });
    });

    const coverage = targetCharacters > 0 ? convertedCharacters / targetCharacters : 0;
    const hanOnly = hasJapaneseHan(text) && !hasJapaneseKana(text);
    const hasUnknownHan = hanOnly && ranges.some((entry) => (
      hasJapaneseHan(entry.surface)
      && (!entry.token || entry.token.word_type !== 'KNOWN' || !entry.token.reading || entry.token.reading === '*')
    ));
    if (!targetCharacters || coverage < (hanOnly ? 1 : 0.7) || hasUnknownHan) return null;
    return {
      lineIndex,
      t:Number(line && line.t) || 0,
      text:tokens.map((token) => token.romanized).filter(Boolean).join(' '),
      tokens,
      language:'ja',
      coverage,
      mode:Array.isArray(line && line.karaokeTimeline) && line.karaokeTimeline.some((node) => node && node.timed)
        ? 'qrc-word'
        : 'line',
    };
  }

  async romanizeLines(lines, options = {}) {
    lines = Array.isArray(lines) ? lines : [];
    const corpus = lines.map((line) => String(line && line.text || '')).join('\n');
    const hinted = options.languageHint === 'ja' || options.languageHint === 'ko' ? options.languageHint : '';
    const japaneseCorpus = hasJapaneseKana(corpus);
    const romanizedLines = [];
    const processedLineIndexes = [];
    const languages = new Set();

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const text = String(line && line.text || '');
      const lineLanguage = hasHangul(text)
        ? 'ko'
        : (hasJapaneseKana(text) || (hasJapaneseHan(text) && (hinted === 'ja' || japaneseCorpus))
          ? 'ja'
          : '');
      if (!lineLanguage) continue;
      processedLineIndexes.push(lineIndex);
      languages.add(lineLanguage);
      if (lineLanguage === 'ja') {
        const japaneseLine = await this.romanizeJapaneseLine(line, lineIndex);
        if (japaneseLine) romanizedLines.push(japaneseLine);
        continue;
      }
      if (lineLanguage !== 'ko') continue;
      const tokens = wordSlots(text).map((slot) => ({
          sourceText:slot.text,
          romanized:hasHangul(slot.text)
            ? koreanRomanizationOverride(
              slot.text,
              this.overrides.ko && this.overrides.ko[slot.text]
            ) || romanizeKoreanSlot(slot.text)
            : slot.text,
          c0:slot.c0,
          c1:slot.c1,
          sourceNodeIndexes:sourceNodeIndexes(line, slot.c0, slot.c1),
        }));
        romanizedLines.push({
          lineIndex,
          t:Number(line && line.t) || 0,
          text:tokens.map((token) => token.romanized).join(' '),
          tokens,
          language:'ko',
          coverage:1,
          mode:Array.isArray(line && line.karaokeTimeline) && line.karaokeTimeline.some((node) => node && node.timed)
            ? 'qrc-word'
            : 'line',
        });
    }

    const language = languages.size === 1
      ? Array.from(languages)[0]
      : (languages.size > 1 ? (hinted || 'mixed') : '');
    return {
      engineVersion:this.engineVersion,
      language,
      lines:romanizedLines,
      processedLineIndexes,
    };
  }
}

module.exports = {
  ENGINE_VERSION,
  RomanizationEngine,
  loadRomanizationOverrides,
};
