'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererSource } = require('./renderer-source');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'desktop', 'preload.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const source = readRendererSource();

assert.match(main, /require\(['"]\.\/app-memory['"]\)/, 'memory operations should live behind a main-process module');
assert.match(main, /ipcMain\.handle\(['"]mineradio-memory-snapshot['"]/);
assert.match(main, /ipcMain\.handle\(['"]mineradio-memory-trim-app['"]/);
assert.match(main, /app\.getAppMetrics\(\)/, 'the trim scope should be limited to Mineradio processes');
assert.match(preload, /getMemorySnapshot:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]mineradio-memory-snapshot['"]\)/);
assert.match(preload, /trimAppMemory:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(['"]mineradio-memory-trim-app['"]/);
assert.match(html, />清理系统内存</, 'advanced settings should expose the confirmed manual cleanup button');
assert.match(html, /id="memory-cleanup-status"/);
assert.match(source, /function clearSystemMemory\(\)/);
assert.match(source, /trimRuntimeCaches\(['"]manual-memory-cleanup['"],\s*true\)/);
assert.match(source, /window\.desktopWindow\.trimAppMemory/);
assert.doesNotMatch(preload, /powershell|execFile|process\./, 'renderer bridge must not expose arbitrary native execution');

const memory = require('../desktop/app-memory');
const snapshot = memory.getMemorySnapshot();
assert.ok(snapshot.totalBytes > 0);
assert.ok(snapshot.process && snapshot.process.rssMB >= 0);
assert.equal(typeof memory.trimAppWorkingSets, 'function');

console.log('Safe app memory cleanup verification passed');
