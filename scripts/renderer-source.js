'use strict';

const fs = require('node:fs');
const path = require('node:path');

const publicRoot = path.join(__dirname, '..', 'public');

function listRendererScriptSources() {
  const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
  const localScripts = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const attributes = match[1] || '';
    const sourceMatch = attributes.match(/\bsrc=["']([^"']+)["']/i);
    if (!sourceMatch) {
      if (match[2].trim()) localScripts.push({ source: match[2], location: 'public/index.html' });
      continue;
    }
    const sourcePath = sourceMatch[1];
    if (/^(?:https?:)?\/\//i.test(sourcePath)) continue;
    const resolved = path.resolve(publicRoot, sourcePath.split(/[?#]/, 1)[0]);
    const relative = path.relative(publicRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Renderer script escapes public root: ${sourcePath}`);
    }
    localScripts.push({ source: fs.readFileSync(resolved, 'utf8'), location: resolved });
  }
  return localScripts;
}

function readRendererSource() {
  const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
  return `${html}\n${listRendererScriptSources().map(item => item.source).join('\n')}`;
}

module.exports = {
  publicRoot,
  listRendererScriptSources,
  readRendererSource,
};
