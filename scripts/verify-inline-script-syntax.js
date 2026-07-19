const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let match;
let checked = 0;

while ((match = scriptPattern.exec(html))) {
  const source = match[1].trim();
  if (!source) continue;
  // Parse only. Browser globals are intentionally not evaluated here.
  new Function(source);
  checked += 1;
}

if (!checked) throw new Error('No inline scripts were found');
console.log(`Inline script syntax: PASS (${checked} blocks)`);
