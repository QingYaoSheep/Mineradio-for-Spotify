'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererSource } = require('./renderer-source');

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
const source = readRendererSource();

assert.match(main, /CHROMIUM_SAFE_PERFORMANCE_SWITCHES/);
assert.match(main, /CHROMIUM_OPT_IN_PERFORMANCE_SWITCHES/);
assert.match(main, /MINERADIO_KEEP_BACKGROUND_RENDERING/);
const mainWindowOptions = main.slice(
  main.indexOf('mainWindow = new BrowserWindow'),
  main.indexOf('mainWindow.webContents.setWindowOpenHandler')
);
assert.match(
  mainWindowOptions,
  /backgroundThrottling:\s*process\.env\.MINERADIO_KEEP_BACKGROUND_RENDERING !== '1'/,
  'the main renderer must keep background throttling enabled by default'
);
assert.doesNotMatch(mainWindowOptions, /backgroundThrottling:\s*false/);
const safeSwitches = main.slice(
  main.indexOf('const CHROMIUM_SAFE_PERFORMANCE_SWITCHES'),
  main.indexOf('const CHROMIUM_OPT_IN_PERFORMANCE_SWITCHES')
);
assert.doesNotMatch(
  safeSwitches,
  /disable-background-timer-throttling/,
  'background throttling bypass must never be a default switch'
);
assert.match(source, /function trimVisualCachesForBackground\(\)/);
assert.match(source, /renderer\.renderLists\.dispose\(\)/);
assert.match(source, /function shouldSkipAdaptiveRenderFrame\(now\)/);

console.log('Background performance policy verification passed');
