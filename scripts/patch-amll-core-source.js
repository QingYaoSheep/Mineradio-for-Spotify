'use strict';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`AMLL patch target not found: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`AMLL patch target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceExactly(source, search, replacement, expectedCount, label) {
  const count = source.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(`AMLL patch expected ${expectedCount} targets for ${label}, found ${count}`);
  }
  return source.split(search).join(replacement);
}

function patchAmllCoreSource(source) {
  let patched = String(source || '');

  patched = replaceOnce(patched,
    '\t\tconst wordContainer = hasRubyLine ? document.createElement("div") : mainWordEl;\n',
    '\t\tconst wordContainer = hasRubyLine ? document.createElement("div") : mainWordEl;\n'
      + '\t\tconst detachRomanMotion = hasRomanLine && this.lyricLine.words.some((candidate) => /[\\uAC00-\\uD7A3]/u.test(candidate.word));\n'
      + '\t\tconst sourceMotionEl = detachRomanMotion ? document.createElement("span") : null;\n'
      + '\t\tif (sourceMotionEl) sourceMotionEl.classList.add("mineradio-amll-source-motion");\n'
      + '\t\tconst sourceContainer = sourceMotionEl || wordContainer;\n',
    'create Korean source motion layer');

  patched = replaceExactly(patched,
    '\t\t\t\twordContainer.appendChild(charEl);\n',
    '\t\t\t\tsourceContainer.appendChild(charEl);\n',
    2,
    'move emphasized source glyphs');

  patched = replaceOnce(patched,
    '\t\t\twordContainer.appendChild(wordEl);\n',
    '\t\t\tsourceContainer.appendChild(wordEl);\n',
    'move regular source word');

  patched = replaceOnce(patched,
    '\t\tif (hasRomanLine) {\n\t\t\tconst romanWordEl = document.createElement("div");\n',
    '\t\tif (sourceMotionEl) wordContainer.appendChild(sourceMotionEl);\n'
      + '\t\tif (hasRomanLine) {\n\t\t\tconst romanWordEl = document.createElement("div");\n',
    'insert source motion layer before romanization');

  patched = replaceOnce(patched,
    '\t\t\telementAnimations: [this.initFloatAnimation(word, mainWordEl)],\n\t\t\tmaskAnimations: [],\n\t\t\twidth: 0,\n\t\t\theight: 0,\n',
    '\t\t\telementAnimations: [this.initFloatAnimation(word, sourceMotionEl || mainWordEl)],\n'
      + '\t\t\tmaskAnimations: [],\n'
      + '\t\t\tmaskFadeElement: sourceMotionEl,\n'
      + '\t\t\tmaskFadeHeight: 0,\n'
      + '\t\t\twidth: 0,\n'
      + '\t\t\theight: 0,\n',
    'separate source float target and fade measurement');

  patched = replaceOnce(patched,
    '\t\t\t\tword.height = el.clientHeight - word.padding * 2;\n',
    '\t\t\t\tword.height = el.clientHeight - word.padding * 2;\n'
      + '\t\t\t\tconst fadeElement = word.maskFadeElement || el;\n'
      + '\t\t\t\tconst fadeFontSize = Number.parseFloat(getComputedStyle(fadeElement).fontSize);\n'
      + '\t\t\t\tword.maskFadeHeight = Number.isFinite(fadeFontSize) ? fadeFontSize : word.height;\n',
    'measure fade from source font size');

  patched = replaceOnce(patched,
    '\t\t\t\tword.height = 0;\n\t\t\t\tword.padding = 0;\n',
    '\t\t\t\tword.height = 0;\n\t\t\t\tword.maskFadeHeight = 0;\n\t\t\t\tword.padding = 0;\n',
    'reset source fade measurement');

  const fadeNeedle = 'const fadeWidth = word.height * this.lyricPlayer.getWordFadeWidth();';
  const fadeReplacement = 'const fadeWidth = (word.maskFadeHeight || word.height) * this.lyricPlayer.getWordFadeWidth();';
  const fadeMatches = patched.split(fadeNeedle).length - 1;
  if (fadeMatches !== 2) throw new Error(`AMLL fade patch expected 2 targets, found ${fadeMatches}`);
  patched = patched.split(fadeNeedle).join(fadeReplacement);

  return patched;
}

module.exports = { patchAmllCoreSource };
