const { listRendererScriptSources } = require('./renderer-source');
let checked = 0;

for (const item of listRendererScriptSources()) {
  const source = item.source.trim();
  if (!source) continue;
  // Parse only. Browser globals are intentionally not evaluated here.
  new Function(source);
  checked += 1;
}

if (!checked) throw new Error('No renderer scripts were found');
console.log(`Renderer script syntax: PASS (${checked} blocks)`);
