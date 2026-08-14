'use strict';

const sax = require('sax');

const MAX_TTML_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_XML = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

function attr(node, localName) {
  if (!node || !node.attributes) return '';
  const expected = String(localName || '').toLowerCase();
  const value = Object.values(node.attributes).find((item) => {
    const local = String(item && (item.local || item.name) || '').toLowerCase();
    return local === expected || local.endsWith(`:${expected}`);
  });
  return String(value && (value.value == null ? value : value.value) || '');
}

function localName(node) {
  return String(node && (node.local || node.name) || '').toLowerCase().replace(/^.*:/, '');
}

function parseXmlTree(xml) {
  const source = String(xml || '');
  if (!source.trim()) throw new Error('Empty Apple Music TTML');
  if (Buffer.byteLength(source) > MAX_TTML_BYTES) throw new Error('Apple Music TTML exceeds size limit');
  if (FORBIDDEN_XML.test(source)) throw new Error('DOCTYPE and ENTITY are forbidden in Apple Music TTML');
  const parser = sax.parser(true, { xmlns:true, trim:false, normalize:false, position:false });
  let root = null;
  const stack = [];
  parser.onopentag = (tag) => {
    const node = { name:tag.name, local:tag.local, attributes:tag.attributes || {}, children:[] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root = node;
    stack.push(node);
  };
  parser.ontext = (text) => {
    if (stack.length && text) stack[stack.length - 1].children.push({ text });
  };
  parser.oncdata = parser.ontext;
  parser.onclosetag = () => { stack.pop(); };
  parser.ondoctype = () => { throw new Error('DOCTYPE is forbidden in Apple Music TTML'); };
  parser.onerror = (error) => { throw error; };
  parser.write(source).close();
  if (!root || localName(root) !== 'tt') throw new Error('Invalid Apple Music TTML root');
  return root;
}

function descendants(node, wanted, result = []) {
  if (!node || !Array.isArray(node.children)) return result;
  node.children.forEach((child) => {
    if (!child || child.text != null) return;
    if (!wanted || localName(child) === wanted) result.push(child);
    descendants(child, wanted, result);
  });
  return result;
}

function textContent(node, options = {}) {
  if (!node) return '';
  if (node.text != null) return String(node.text);
  return (node.children || []).map((child) => {
    if (child && child.text == null && typeof options.exclude === 'function' && options.exclude(child)) return '';
    return textContent(child, options);
  }).join('');
}

function parseTimeSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let match = raw.match(/^([0-9]+(?:\.[0-9]+)?)ms$/i);
  if (match) return Number(match[1]) / 1000;
  match = raw.match(/^([0-9]+(?:\.[0-9]+)?)s$/i);
  if (match) return Number(match[1]);
  match = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (match) return (Number(match[1]) || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}

function roleOf(node) {
  return `${attr(node, 'role')} ${attr(node, 'type')}`.toLowerCase();
}

function isBackgroundNode(node) {
  return /(?:^|\s)x-bg(?:\s|$)/.test(roleOf(node));
}

function isTranslationNode(node) {
  return /translation/.test(roleOf(node));
}

function isRomanizationNode(node) {
  return /transliteration|romanization|x-roman/.test(roleOf(node));
}

function localizationMap(root, containerName, languagePattern) {
  const container = descendants(root, containerName)[0];
  const result = { main:new Map(), background:new Map() };
  if (!container) return result;
  descendants(container).forEach((group) => {
    const groupName = localName(group);
    if (groupName !== 'translation' && groupName !== 'transliteration' && groupName !== 'romanization') return;
    const language = attr(group, 'lang') || attr(group, 'locale');
    if (languagePattern && language && !languagePattern.test(language)) return;
    descendants(group, 'text').forEach((textNode) => {
      const key = attr(textNode, 'for') || attr(textNode, 'key') || attr(textNode, 'id');
      const value = textContent(textNode, { exclude:isBackgroundNode }).trim();
      if (key && value) result.main.set(key, value);
      const backgroundValues = backgroundRoots(textNode).map((node) => textContent(node).trim()).filter(Boolean);
      if (key && backgroundValues.length) result.background.set(key, backgroundValues);
    });
  });
  return result;
}

function timedLeafSpans(lineNode, options = {}) {
  const result = [];
  function visit(node, root) {
    if (!node || node.text != null) return;
    if (!root && options.excludeBackground && isBackgroundNode(node)) return;
    if (isTranslationNode(node) || isRomanizationNode(node)) return;
    const childTimed = (node.children || []).some((child) => child && child.text == null
      && (parseTimeSeconds(attr(child, 'begin')) != null || descendants(child, 'span').some((nested) => parseTimeSeconds(attr(nested, 'begin')) != null)));
    if (localName(node) === 'span' && !childTimed
        && parseTimeSeconds(attr(node, 'begin')) != null
        && parseTimeSeconds(attr(node, 'end')) != null) {
      result.push(node);
      return;
    }
    (node.children || []).forEach((child) => visit(child, false));
  }
  visit(lineNode, true);
  return result;
}

function timedLeafCandidates(lineNode, options = {}) {
  const result = [];
  function visit(node, root) {
    if (!node || node.text != null) return;
    if (!root && options.excludeBackground && isBackgroundNode(node)) return;
    if (isTranslationNode(node) || isRomanizationNode(node)) return;
    const nestedTimed = (node.children || []).some((child) => child && child.text == null
      && (attr(child, 'begin') || attr(child, 'end') || descendants(child, 'span').some((nested) => attr(nested, 'begin') || attr(nested, 'end'))));
    if (localName(node) === 'span' && !nestedTimed) {
      result.push(node);
      return;
    }
    (node.children || []).forEach((child) => visit(child, false));
  }
  visit(lineNode, true);
  return result;
}

function timedSpanTexts(lineNode, spans, options = {}) {
  const spanSet = new Set(spans);
  const values = new Map();
  let pendingPrefix = '';
  let lastSpan = null;
  function appendLooseText(raw) {
    let value = String(raw || '');
    if (!value) return;
    if (/^[\s\r\n\t]+$/.test(value) && /[\r\n\t]/.test(value)) return;
    if (/[\r\n\t]/.test(value)) value = value.replace(/\s+/g, ' ');
    if (lastSpan) values.set(lastSpan, String(values.get(lastSpan) || '') + value);
    else pendingPrefix += value;
  }
  function visit(node, root) {
    if (!node) return;
    if (node.text != null) { appendLooseText(node.text); return; }
    if (!root && options.excludeBackground && isBackgroundNode(node)) return;
    if (isTranslationNode(node) || isRomanizationNode(node)) return;
    if (spanSet.has(node)) {
      values.set(node, pendingPrefix + textContent(node));
      pendingPrefix = '';
      lastSpan = node;
      return;
    }
    (node.children || []).forEach((child) => visit(child, false));
  }
  visit(lineNode, true);
  return values;
}

function backgroundRoots(paragraph) {
  const result = [];
  function visit(node) {
    if (!node || !Array.isArray(node.children)) return;
    node.children.forEach((child) => {
      if (!child || child.text != null || isTranslationNode(child) || isRomanizationNode(child)) return;
      if (isBackgroundNode(child)) result.push(child);
      else visit(child);
    });
  }
  visit(paragraph);
  return result;
}

function parseAppleMusicTtml(xml) {
  const root = parseXmlTree(xml);
  const translations = localizationMap(root, 'translations', /^(?:zh(?:[-_](?:hans|cn|sg))?|cmn)/i);
  const transliterations = localizationMap(root, 'transliterations', null);
  const paragraphs = descendants(root, 'p');
  let hasWordTiming = false;
  function lineFromNode(node, paragraph, background, backgroundIndex) {
    let spans = timedLeafSpans(node, { excludeBackground:!background });
    const spanStarts = spans.map((span) => parseTimeSeconds(attr(span, 'begin'))).filter((value) => value != null);
    const spanEnds = spans.map((span) => parseTimeSeconds(attr(span, 'end'))).filter((value) => value != null);
    const begin = parseTimeSeconds(attr(node, 'begin'))
      ?? (spanStarts.length ? Math.min.apply(Math, spanStarts) : parseTimeSeconds(attr(paragraph, 'begin')));
    const end = parseTimeSeconds(attr(node, 'end'))
      ?? (spanEnds.length ? Math.max.apply(Math, spanEnds) : parseTimeSeconds(attr(paragraph, 'end')));
    if (begin == null) return null;
    const lineEnd = end == null || end < begin ? begin : end;
    const timedCandidates = timedLeafCandidates(node, { excludeBackground:!background });
    const invalidWordTiming = timedCandidates.length !== spans.length || spans.some((span) => {
      const wordStart = parseTimeSeconds(attr(span, 'begin'));
      const wordEnd = parseTimeSeconds(attr(span, 'end'));
      return wordStart == null || wordEnd == null || wordEnd <= wordStart
        || wordStart < begin || lineEnd > begin && wordEnd > lineEnd;
    });
    if (invalidWordTiming) spans = [];
    const spanTexts = timedSpanTexts(node, spans, { excludeBackground:!background });
    const key = attr(paragraph, 'key') || attr(paragraph, 'id');
    const agent = attr(node, 'agent') || attr(paragraph, 'agent');
    const inlineTranslation = descendants(node, 'span').find(isTranslationNode);
    const inlineRomanization = descendants(node, 'span').find(isRomanizationNode);
    const originalText = textContent(node, {
      exclude: (child) => isTranslationNode(child) || isRomanizationNode(child) || !background && isBackgroundNode(child),
    }).replace(/^\s+|\s+$/g, '');
    let cursor = 0;
    const karaokeTimeline = spans.map((span) => {
      const wordStart = parseTimeSeconds(attr(span, 'begin'));
      const wordEnd = parseTimeSeconds(attr(span, 'end'));
      const text = String(spanTexts.get(span) || textContent(span));
      const c0 = cursor;
      cursor += text.length;
      hasWordTiming = true;
      return {
        text,
        start: wordStart,
        duration: Math.round(Math.max(0, wordEnd - wordStart) * 1000) / 1000,
        c0,
        c1: cursor,
        timed: true,
      };
    });
    return {
      t: begin,
      sourceEnd: lineEnd,
      duration: Math.max(0, lineEnd - begin),
      text: originalText || karaokeTimeline.map((word) => word.text).join('').trim(),
      transText: String((background
        ? (translations.background.get(key) || [])[backgroundIndex]
        : translations.main.get(key)) || textContent(inlineTranslation).trim() || ''),
      romanText: String((background
        ? (transliterations.background.get(key) || [])[backgroundIndex]
        : transliterations.main.get(key)) || textContent(inlineRomanization).trim() || ''),
      source: karaokeTimeline.length ? 'apple-ttml-word' : 'apple-ttml-line',
      nativeAppleKaraoke: karaokeTimeline.length > 0,
      karaokeTimeline,
      isBG:background,
      isDuet:false,
      agent,
      ttmlKey: key,
    };
  }
  const lines = [];
  paragraphs.forEach((paragraph) => {
    const paragraphIsBackground = isBackgroundNode(paragraph);
    const main = lineFromNode(paragraph, paragraph, paragraphIsBackground);
    if (main && main.text) lines.push(main);
    if (paragraphIsBackground) return;
    backgroundRoots(paragraph).forEach((background, backgroundIndex) => {
      const line = lineFromNode(background, paragraph, true, backgroundIndex);
      if (line && line.text) lines.push(line);
    });
  });
  const firstAgent = lines.filter((line) => !line.isBG).map((line) => line.agent).find(Boolean) || '';
  lines.forEach((line) => { line.isDuet = Boolean(line.agent && firstAgent && line.agent !== firstAgent); });
  if (!lines.length) throw new Error('Apple Music TTML contains no usable lyric lines');
  return {
    lines,
    timingSource: hasWordTiming ? 'apple-ttml-word' : 'apple-ttml-line',
    hasNativeKaraoke: hasWordTiming,
    hasTranslation: lines.some((line) => String(line.transText || '').trim()),
  };
}

module.exports = {
  MAX_TTML_BYTES,
  parseAppleMusicTtml,
  parseTimeSeconds,
};
